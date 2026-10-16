'use strict';

const NXG360FindingsService = require('../../integrations/nxg360/NXG360FindingsService');
const redisClient           = require('../../config/redisClient');
const logger                = require('../../utils/logger');

const CACHE_KEY   = (tenantId) => `nxg360:findings:${tenantId}`;
const CACHE_TTL_S = 12 * 60 * 60; // 12 hours

// Maps raw NXG360 shape → the shape the AI service expects.
// Extracted so both the cache-hit path and the live-call path use identical mapping.
function normalize(rawFindings) {
  return rawFindings.map((f) => ({
    id:              f.id,
    sourceFindingId: f.sourceFindingId,
    title:           f.title || f.label || 'Untitled Finding',
    description:     f.description || '',
    severity:        f.severity || 'medium',
    category:        f.category || null,
    systemAffected:  f.systemAffected || null,
    affectedCount:   f.affectedCount || 0,
    riskScore:       f.riskScore || 50,
  }));
}

/**
 * Normalises NXG360 findings into the format the AI service consumes.
 * The AI service NEVER calls NXG360 directly — it always goes through this provider.
 * Checks Redis cache first (populated by nxg360Prefetch.job.js at T-24 per meeting,
 * or by on-demand syncTenant() calls) so AI jobs are resilient to NXG360 unavailability.
 */
const FindingsProvider = {
  async getNormalized(tenantId) {
    try {
      // 1. Redis cache check — skips live NXG360 call when sync job has already
      //    fetched fresh findings within the last 12 hours.
      try {
        const cached = await redisClient.get(CACHE_KEY(tenantId));
        if (cached) {
          const raw = JSON.parse(cached);
          logger.info('FindingsProvider: cache hit', { tenantId, count: raw.length });
          return normalize(raw);
        }
      } catch (cacheErr) {
        // Redis down or JSON parse error — fall through to live API, never throw.
        logger.warn('FindingsProvider: cache read failed, falling back to live NXG360', {
          tenantId,
          error: cacheErr.message,
        });
      }

      // 2. Cache miss — call NXG360 live.
      const result = await NXG360FindingsService.getFindings(tenantId);

      if (result.error) {
        logger.warn('FindingsProvider: NXG360 returned error result', {
          tenantId,
          error: result.error,
        });
        return [];
      }

      const raw = result.findings || [];

      // 3. Populate cache so the next T-48 (or sync cycle) skips the live call.
      try {
        await redisClient.set(CACHE_KEY(tenantId), JSON.stringify(raw), { EX: CACHE_TTL_S });
      } catch (cacheErr) {
        logger.warn('FindingsProvider: cache write failed', { tenantId, error: cacheErr.message });
      }

      return normalize(raw);
    } catch (err) {
      logger.error('FindingsProvider: unexpected error', { tenantId, error: err.message });
      return [];
    }
  },
};

module.exports = FindingsProvider;
