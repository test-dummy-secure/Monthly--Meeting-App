'use strict';

const db                     = require('../config/db');
const NXG360FindingsService  = require('../integrations/nxg360/NXG360FindingsService');
const redisClient            = require('../config/redisClient');
const logger                 = require('../utils/logger');

const CACHE_KEY    = (tenantId) => `nxg360:findings:${tenantId}`;
const CACHE_TTL_S  = 12 * 60 * 60; // 12 hours

// syncTenant is the core utility used by:
//   • nxg360Prefetch.job.js  — T-24 per-meeting data pull
//   • nxg360.routes.js       — manual on-demand sync endpoint
//   • meeting.routes.js      — refresh-findings endpoint
// The global 6-hour interval has been replaced by per-meeting T-24 scheduling.
async function syncTenant(tenantId) {
  try {
    const result = await NXG360FindingsService.getFindings(tenantId);

    if (result.error) {
      logger.warn('NXG360 sync: API returned error for tenant', { tenantId, error: result.error });
    } else {
      const findings = result.findings || [];
      logger.info('NXG360 sync: tenant synced', { tenantId, findingCount: findings.length });

      try {
        await redisClient.set(CACHE_KEY(tenantId), JSON.stringify(findings), { EX: CACHE_TTL_S });
      } catch (cacheErr) {
        logger.warn('NXG360 sync: cache write failed', { tenantId, error: cacheErr.message });
      }
    }

    // Update last_synced_at regardless — even a partial/error response is a sync attempt
    await db.query(
      `UPDATE nxg360_connections
       SET    last_synced_at = NOW(), updated_at = NOW()
       WHERE  tenant_id = $1`,
      [tenantId]
    );

    return { success: true };
  } catch (err) {
    logger.error('NXG360 sync: unexpected error for tenant', { tenantId, error: err.message });
    return { success: false, error: err.message };
  }
}

// No-ops — the global interval has been removed.
// NXG360 data is now pulled by nxg360Prefetch.job.js at T-24 per meeting.
// start/stop are kept so server.js does not need to be restructured.
function start() {
  logger.info('NXG360 sync: interval-based polling disabled — data pulled at T-24 per meeting by nxg360Prefetch.job.js');
}

function stop() {}

module.exports = { start, stop, syncTenant };
