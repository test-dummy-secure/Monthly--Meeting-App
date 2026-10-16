const customerRepository           = require('../repositories/customer.repository');
const nxg360ConnectionRepository   = require('../repositories/nxg360-connection.repository');
const tenantAssignmentRepository   = require('../repositories/tenant-assignment.repository');
const NXG360ValidationService      = require('../integrations/nxg360/NXG360ValidationService');
const NXG360FindingsService        = require('../integrations/nxg360/NXG360FindingsService');
const tenantAccessService          = require('./tenantAccess.service');
const { encrypt }                  = require('../utils/encryption');
const logger                       = require('../utils/logger');
const db                           = require('../config/db');

const UUID_RE    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid     = (v) => typeof v === 'string' && UUID_RE.test(v);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const httpError = (message, statusCode) =>
  Object.assign(new Error(message), { statusCode });

// ─── TenantService ────────────────────────────────────────────────────────────
// Business logic layer for tenant management.
// All NXG360 interaction happens here — controllers stay thin.

const tenantService = {

  // ── List (role-scoped) ────────────────────────────────────────────────────

  list: async (user) => {
    return tenantAccessService.listAccessibleTenants(user);
  },

  // ── Get by ID (access-checked) ────────────────────────────────────────────

  getById: async (user, id) => {
    await tenantAccessService.ensureTenantAccess(user, id);
    const tenant = await customerRepository.findById(id);
    if (!tenant) throw httpError('Tenant not found', 404);
    return tenant;
  },

  // ── Create with optional NXG360 gate ─────────────────────────────────────
  //
  // If nxg360TenantId + nxg360ApiKey are supplied:
  //   1. Validate them against the live NXG360 API first (pre-check gate)
  //   2. Only create the tenant if validation passes
  //   3. Persist the encrypted key in nxg360_connections
  //
  // If neither field is supplied, tenant is created without NXG360.
  // If only one field is supplied, request is rejected (must be both or neither).

  create: async (user, data) => {
    const {
      name, domain, industry, timezone, meetingPlatform, accountManagerId, status,
      nxg360TenantId, nxg360ApiKey,
    } = data;

    if (!name || !String(name).trim()) {
      throw httpError('Customer name is required', 400);
    }

    const nxgId  = nxg360TenantId ? String(nxg360TenantId).trim() : '';
    const nxgKey = nxg360ApiKey   ? String(nxg360ApiKey).trim()   : '';

    if ((nxgId && !nxgKey) || (!nxgId && nxgKey)) {
      throw httpError(
        'NXG360 Tenant ID and API Key must both be provided together',
        400
      );
    }

    // Pre-validation gate — runs BEFORE creating the tenant row
    let nxgValidResult = null;
    if (nxgId && nxgKey) {
      logger.info('NXG360 pre-validation for tenant creation', { nxg360TenantId: nxgId });
      nxgValidResult = await NXG360ValidationService.validate(nxgId, nxgKey);

      if (!nxgValidResult.valid) {
        throw httpError(
          `NXG360 validation failed: ${nxgValidResult.message}`,
          422
        );
      }
    }

    // Validate accountManagerId before creating the tenant so we can return a
    // clean 400 instead of hitting a FK violation deep in the DB call stack.
    let resolvedAmId = null;
    if (accountManagerId) {
      if (!isUuid(accountManagerId)) {
        throw httpError('Invalid accountManagerId — must be a valid UUID', 400);
      }
      const { rows: amRows } = await db.query(
        `SELECT id FROM users WHERE id = $1 AND role = 'account_manager' AND is_active = TRUE`,
        [accountManagerId]
      );
      if (amRows.length === 0) {
        throw httpError('Account Manager not found or is inactive', 400);
      }
      resolvedAmId = accountManagerId;
    }

    // Create the tenant record
    const tenant = await customerRepository.create({
      name:             String(name).trim(),
      domain:           domain           || null,
      industry:         industry         || 'Other',
      timezone:         timezone         || 'UTC',
      meetingPlatform:  meetingPlatform  || 'microsoft_teams',
      accountManagerId: resolvedAmId,
      status:           status           || 'active',
    });

    // Wire the AM into tenant_assignments so they can see this tenant immediately.
    // customers.account_manager_id (set above) is the display FK used in the
    // super admin list. The access system (tenantAccessService) reads
    // tenant_assignments exclusively — without this row the AM has no visibility.
    if (resolvedAmId) {
      await tenantAssignmentRepository.addAsPrimary(tenant.id, resolvedAmId, user.id);
    }

    // Persist encrypted NXG360 connection
    if (nxgId && nxgKey && nxgValidResult?.valid) {
      const apiKeyEnc = encrypt(nxgKey);
      const keyHint   = nxgKey.slice(-4);           // last 4 chars — shown in UI

      await nxg360ConnectionRepository.upsert({
        tenantId:      tenant.id,
        apiKeyEnc,
        workspaceId:   nxgId,
        connectionType: 'api_key',
        status:        'connected',
        syncMetadata:  { keyHint },
      });

      logger.info('NXG360 connection persisted', {
        tenantId:       tenant.id,
        nxg360TenantId: nxgId,
      });
    }

    // Auto-create ClickUp folder+list for this tenant (fire-and-forget — never blocks tenant creation)
    setImmediate(async () => {
      try {
        const clickupRepo   = require('../repositories/clickup-connection.repository');
        const ClickUpClient = require('../integrations/clickup/ClickUpClient');
        const { decrypt }   = require('../utils/encryption');

        const conn = await clickupRepo.get();
        if (!conn || conn.status !== 'connected' || !conn.space_id) return;

        const client = new ClickUpClient(decrypt(conn.api_key_enc));
        const { folder, list } = await client.createTenantResources(conn.space_id, tenant.name);
        await clickupRepo.upsertFolderMapping({
          tenantId:   tenant.id,
          folderId:   folder.id,
          folderName: folder.name,
          listId:     list.id,
          listName:   list.name,
        });
        logger.info('ClickUp folder auto-created for new tenant', { tenantId: tenant.id, tenantName: tenant.name });
      } catch (err) {
        logger.warn('ClickUp folder auto-create failed (non-fatal)', { tenantId: tenant.id, error: err.message });
      }
    });

    return tenant;
  },

  // ── Update (Super Admin only) ─────────────────────────────────────────────

  update: async (user, id, data) => {
    if (user.role !== 'super_admin') {
      throw httpError('Only Super Admin may update tenants', 403);
    }
    const tenant = await customerRepository.update(id, data);
    return tenant;
  },

  // ── Validate NXG360 credentials ───────────────────────────────────────────
  // Returns { valid: true, tenantId, status } or { valid: false, message }.
  // Never throws — all failures are structured result objects.

  validateNXG360: async (nxg360TenantId, apiKey) => {
    return NXG360ValidationService.validate(nxg360TenantId, apiKey);
  },

  // ── Get live NXG360 findings (access-checked) ─────────────────────────────

  getFindings: async (user, tenantId) => {
    await tenantAccessService.ensureTenantAccess(user, tenantId);
    return NXG360FindingsService.getFindings(tenantId);
  },
};

module.exports = tenantService;
