const NXG360FindingsService = require('../integrations/nxg360/NXG360FindingsService');
const FindingsProvider       = require('./ai/FindingsProvider');
const db                     = require('../config/db');

// ─── nxg360Service ────────────────────────────────────────────────────────────
// Thin façade used by nxg360.routes.js and the frontend-facing findings route.

const PRIORITY_MAP = { critical: 'P1', high: 'P2', medium: 'P3', low: 'P4' };

function buildSummary(findings) {
  const s = { totalFindings: findings.length, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, byCategory: {} };
  for (const f of findings) {
    if (s.bySeverity[f.severity] !== undefined) s.bySeverity[f.severity]++;
    s.byCategory[f.category] = (s.byCategory[f.category] || 0) + 1;
  }
  return s;
}

const nxg360Service = {

  // Returns findings for the given tenant. Checks the Redis cache maintained by
  // nxg360Sync.job.js first — falls back to a live NXG360 API call on cache miss.
  // This keeps the dashboard responsive even when NXG360 is temporarily unavailable
  // and avoids redundant API calls when the sync job has already fetched fresh data.
  getFindingsByTenant: async (tenantId) => {
    // FindingsProvider: Redis cache-first → live API fallback → writes cache on miss
    const findings = await FindingsProvider.getNormalized(tenantId);

    // If FindingsProvider got data (cache or live), wrap it in the expected response shape
    if (findings.length > 0) {
      return {
        tenantId,
        findings,
        summary:     buildSummary(findings),
        retrievedAt: new Date().toISOString(),
      };
    }

    // findings === [] can mean: cache miss + live call failed, or tenant genuinely
    // has no findings. Fall through to the live service to get the proper error shape.
    return NXG360FindingsService.getFindings(tenantId);
  },

  // Looks up a finding by its NXG360 source ID from the local findings table.
  // The NXG360 API has no per-ID endpoint; findings are stored locally at T-48.
  // Returns the most recently inserted row for that source ID, or null.
  getFindingById: async (findingId) => {
    const { rows } = await db.query(
      `SELECT id,
              meeting_id        AS "meetingId",
              tenant_id         AS "tenantId",
              source_finding_id AS "sourceFindingId",
              severity,
              category,
              title,
              description,
              system_affected   AS "systemAffected",
              created_at        AS "createdAt"
       FROM   findings
       WHERE  source_finding_id = $1
       ORDER  BY created_at DESC
       LIMIT  1`,
      [findingId]
    );
    return rows[0] || null;
  },

  getPriorityForFinding: (finding) => PRIORITY_MAP[finding?.severity] || 'P4',
};

module.exports = nxg360Service;
