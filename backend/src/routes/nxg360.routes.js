'use strict';

const express                    = require('express');
const router                     = express.Router();
const auth                       = require('../middleware/auth.middleware');
const tenantAccessService        = require('../services/tenantAccess.service');
const nxg360Service              = require('../services/nxg360Service');
const nxg360ConnectionRepository = require('../repositories/nxg360-connection.repository');
const NXG360ValidationService    = require('../integrations/nxg360/NXG360ValidationService');
const NXG360FindingsService      = require('../integrations/nxg360/NXG360FindingsService');
const nxg360SyncJob              = require('../jobs/nxg360Sync.job');
const { encrypt }                = require('../utils/encryption');
const auditLogRepository         = require('../repositories/audit-log.repository');
const logger                     = require('../utils/logger');

// All NXG360 routes require authentication
router.use(auth);

// ── Findings ──────────────────────────────────────────────────────────────────

// GET /api/nxg360/tenant/:tenantId/findings
// Returns all NXG360 findings (11 categories) for the specified tenant.
router.get('/tenant/:tenantId/findings', async (req, res, next) => {
  try {
    await tenantAccessService.ensureTenantAccess(req.user, req.params.tenantId);
    const result = await nxg360Service.getFindingsByTenant(req.params.tenantId);
    res.json(result);
  } catch (err) {
    logger.error('NXG360 findings fetch failed', { error: err.message, tenantId: req.params.tenantId });
    next(err);
  }
});

// GET /api/nxg360/findings/:findingId
// Returns a single NXG360 finding by source ID from the local findings table.
router.get('/findings/:findingId', async (req, res, next) => {
  try {
    const finding = await nxg360Service.getFindingById(req.params.findingId);
    if (!finding) return res.status(404).json({ error: 'Finding not found' });
    await tenantAccessService.ensureTenantAccess(req.user, finding.tenantId);
    res.json(finding);
  } catch (err) {
    next(err);
  }
});

// ── Connection management (Super Admin + AM read) ─────────────────────────────

// GET /api/nxg360/connections/:tenantId
// Returns connection status for a tenant. API key is never returned.
router.get('/connections/:tenantId', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    await tenantAccessService.ensureTenantAccess(req.user, tenantId);

    const conn = await nxg360ConnectionRepository.findByTenant(tenantId);
    if (!conn || conn.status === 'disconnected') {
      return res.json({ connected: false, status: 'disconnected' });
    }

    res.json({
      connected:    conn.status === 'connected',
      status:       conn.status,
      workspaceId:  conn.workspaceId,
      apiEndpoint:  conn.apiEndpoint,
      lastSyncedAt: conn.lastSyncedAt,
      keyHint:      conn.syncMetadata?.keyHint || null,
    });
  } catch (err) {
    logger.error('NXG360 connection GET failed', { error: err.message, tenantId: req.params.tenantId });
    next(err);
  }
});

// POST /api/nxg360/connections/:tenantId
// Validates NXG360 credentials against the live API, then saves the encrypted
// key. Replaces any existing connection (upsert). Super Admin only.
router.post('/connections/:tenantId', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { workspaceId, apiKey, apiEndpoint } = req.body;

    if (!workspaceId?.trim() || !apiKey?.trim()) {
      return res.status(400).json({ error: 'workspaceId and apiKey are required' });
    }

    await tenantAccessService.ensureTenantAccess(req.user, tenantId);

    // Live validation — always check before persisting
    logger.info('NXG360 connection: validating before save', { tenantId, workspaceId: workspaceId.trim() });
    const validation = await NXG360ValidationService.validate(workspaceId.trim(), apiKey.trim());
    if (!validation.valid) {
      return res.status(422).json({
        error: `NXG360 validation failed: ${validation.message || 'invalid credentials'}`,
      });
    }

    const apiKeyEnc = encrypt(apiKey.trim());
    const keyHint   = apiKey.trim().slice(-4); // last 4 chars for display

    const conn = await nxg360ConnectionRepository.upsert({
      tenantId,
      apiKeyEnc,
      apiEndpoint: apiEndpoint?.trim() || 'https://nxg360.nxgsecure.com/api',
      workspaceId: workspaceId.trim(),
      connectionType: 'api_key',
      status:      'connected',
      syncMetadata: { keyHint },
    });

    auditLogRepository.create(
      tenantId, req.user.email, 'NXG360 Connection Updated', { workspaceId: workspaceId.trim() }, req.ip
    ).catch(() => {});

    logger.info('NXG360 connection saved', { tenantId, workspaceId: workspaceId.trim(), by: req.user.email });

    // Kick off an immediate background sync so findings are available right away
    // instead of waiting up to 6 hours for the next scheduled cycle.
    setImmediate(() => {
      nxg360SyncJob.syncTenant(tenantId).catch((err) =>
        logger.warn('NXG360 immediate post-save sync failed (non-fatal)', { tenantId, error: err.message })
      );
    });

    res.json({
      connected:    true,
      status:       conn.status,
      workspaceId:  conn.workspaceId,
      apiEndpoint:  conn.apiEndpoint,
      lastSyncedAt: conn.lastSyncedAt,
      keyHint:      conn.syncMetadata?.keyHint || null,
    });
  } catch (err) {
    logger.error('NXG360 connection save failed', { error: err.message, tenantId: req.params.tenantId });
    next(err);
  }
});

// POST /api/nxg360/connections/:tenantId/sync
// Forces an immediate NXG360 sync for a tenant — super_admin only.
// Useful when findings are stale or after troubleshooting connection issues.
router.post('/connections/:tenantId/sync', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    await tenantAccessService.ensureTenantAccess(req.user, tenantId);

    const conn = await nxg360ConnectionRepository.findByTenant(tenantId);
    if (!conn || conn.status !== 'connected') {
      return res.status(404).json({ error: 'No active NXG360 connection for this tenant' });
    }

    const result = await nxg360SyncJob.syncTenant(tenantId);
    if (!result.success) {
      return res.status(502).json({ error: `NXG360 sync failed: ${result.error}` });
    }

    auditLogRepository.create(tenantId, req.user.email, 'NXG360 Manual Sync', {}, req.ip).catch(() => {});
    logger.info('NXG360 manual sync completed', { tenantId, by: req.user.email });
    res.json({ success: true, syncedAt: new Date().toISOString() });
  } catch (err) {
    logger.error('NXG360 manual sync failed', { error: err.message, tenantId: req.params.tenantId });
    next(err);
  }
});

// POST /api/nxg360/connections/:tenantId/test
// Tests an existing connection using the stored encrypted key.
// Attempts a real findings fetch — returns finding count on success.
router.post('/connections/:tenantId/test', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    await tenantAccessService.ensureTenantAccess(req.user, tenantId);

    const conn = await nxg360ConnectionRepository.findByTenant(tenantId);
    if (!conn || conn.status !== 'connected') {
      return res.status(404).json({ success: false, error: 'No active NXG360 connection for this tenant' });
    }

    // Use the live findings service (uses stored encrypted key internally)
    const result = await NXG360FindingsService.getFindings(tenantId);
    const findingCount = result?.findings?.length ?? 0;

    logger.info('NXG360 connection test passed', { tenantId, findingCount });
    res.json({ success: true, findingCount, testedAt: new Date().toISOString() });
  } catch (err) {
    logger.warn('NXG360 connection test failed', { error: err.message, tenantId: req.params.tenantId });
    res.json({ success: false, error: err.message });
  }
});

// DELETE /api/nxg360/connections/:tenantId
// Removes the NXG360 connection for a tenant. Super Admin only.
router.delete('/connections/:tenantId', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    await tenantAccessService.ensureTenantAccess(req.user, tenantId);

    await nxg360ConnectionRepository.delete(tenantId);

    auditLogRepository.create(
      tenantId, req.user.email, 'NXG360 Connection Removed', {}, req.ip
    ).catch(() => {});

    logger.info('NXG360 connection removed', { tenantId, by: req.user.email });
    res.status(204).end();
  } catch (err) {
    logger.error('NXG360 connection delete failed', { error: err.message, tenantId: req.params.tenantId });
    next(err);
  }
});

module.exports = router;
