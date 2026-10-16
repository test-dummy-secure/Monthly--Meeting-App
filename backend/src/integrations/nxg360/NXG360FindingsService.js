const { randomUUID } = require('crypto');
const NXG360Client                 = require('./NXG360Client');
const nxg360ConnectionRepository  = require('../../repositories/nxg360-connection.repository');
const { decrypt }                  = require('../../utils/encryption');
const logger                       = require('../../utils/logger');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_SEVERITIES  = new Set(['critical', 'high', 'medium', 'low']);
const VALID_CATEGORIES  = new Set([
  'risky_users', 'risky_devices',
  'mfa_enabled_users', 'mfa_enabled_devices',
  'mfa_missing_users', 'mfa_missing_devices',
  'dormant_accounts', 'breached_credentials',
  'assigned_users_devices', 'edr_coverage', 'patch_compliance',
]);

// ─── Normalizers ──────────────────────────────────────────────────────────────

const normalizeFindings = (raw, tenantDbId) => {
  const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.findings) ? raw.findings : []);
  return arr
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      id:              f.id || f.findingId || randomUUID(),
      tenantId:        tenantDbId,
      sourceFindingId: f.id || f.findingId || f.sourceFindingId || null,
      category:        VALID_CATEGORIES.has(f.category) ? f.category : 'other',
      label:           f.label || f.name || f.category || 'Unknown',
      severity:        VALID_SEVERITIES.has(f.severity) ? f.severity : 'medium',
      title:           f.title || f.description || 'Untitled Finding',
      affectedCount:   typeof f.affectedCount === 'number' ? f.affectedCount : (Number(f.count) || 0),
      riskScore:       typeof f.riskScore    === 'number' ? f.riskScore    : 50,
      detectedAt:      f.detectedAt || f.createdAt || new Date().toISOString(),
      systemAffected:  f.systemAffected || f.system || null,
      description:     f.description || null,
    }));
};

const buildSummary = (findings) => {
  const s = { totalFindings: findings.length, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, byCategory: {} };
  for (const f of findings) {
    if (s.bySeverity[f.severity] !== undefined) s.bySeverity[f.severity]++;
    s.byCategory[f.category] = (s.byCategory[f.category] || 0) + 1;
  }
  return s;
};

const errorResult = (tenantDbId, message) => ({
  tenantId:    tenantDbId,
  findings:    [],
  summary:     buildSummary([]),
  retrievedAt: new Date().toISOString(),
  error:       message,
});

// ─── Service ──────────────────────────────────────────────────────────────────

const NXG360FindingsService = {

  // Always fetches latest findings directly from NXG360.
  // Never serves cached data — no permanent findings storage yet.
  getFindings: async (tenantDbId) => {
    const correlationId = randomUUID();

    // ── Step 1: Load connection config ────────────────────────────────────
    const connection = await nxg360ConnectionRepository.findByTenant(tenantDbId);

    if (!connection || !connection.apiKeyEnc || !connection.workspaceId) {
      logger.warn('NXG360 not configured for tenant', { correlationId, tenantDbId });
      return errorResult(tenantDbId, 'NXG360 integration is not configured for this tenant');
    }

    // ── Step 2: Decrypt key — never log the decrypted value ───────────────
    let apiKey;
    try {
      apiKey = decrypt(connection.apiKeyEnc);
    } catch (err) {
      logger.error('NXG360 key decryption failed', { correlationId, tenantDbId, error: err.message });
      return errorResult(tenantDbId, 'Failed to load NXG360 credentials — contact administrator');
    }

    // ── Step 3: Fetch from NXG360 ─────────────────────────────────────────
    logger.info('NXG360 findings fetch started', {
      correlationId,
      tenantDbId,
      nxg360TenantId: connection.workspaceId,
    });

    try {
      const client      = new NXG360Client(apiKey);
      const rawResponse = await client.getFindings(connection.workspaceId);
      const findings    = normalizeFindings(rawResponse, tenantDbId);

      // ── Step 4: Mark connection healthy ────────────────────────────────
      await nxg360ConnectionRepository.updateLastSynced(tenantDbId, 'connected');

      logger.info('NXG360 findings retrieved', {
        correlationId,
        tenantDbId,
        count: findings.length,
      });

      return {
        tenantId:    tenantDbId,
        findings,
        summary:     buildSummary(findings),
        retrievedAt: new Date().toISOString(),
      };

    } catch (err) {
      logger.error('NXG360 findings fetch failed', {
        correlationId,
        tenantDbId,
        code:  err.code,
        error: err.message,
      });

      // Mark connection as errored so dashboards show stale indicator
      try {
        await nxg360ConnectionRepository.updateLastSynced(tenantDbId, 'error');
      } catch (_) { /* non-fatal */ }

      const userMessage =
        err.code === 'NXG360_UNCONFIGURED'
          ? 'NXG360 API URL is not configured on this server'
          : err.code === 'NXG360_TIMEOUT'
            ? 'NXG360 service did not respond — please retry'
            : err.message || 'Failed to retrieve findings from NXG360';

      return errorResult(tenantDbId, userMessage);
    }
  },
};

module.exports = NXG360FindingsService;
