'use strict';

const db     = require('../database/index');
const logger = require('../utils/logger');

const mapRow = (row) => ({
  id:           row.id,
  tenantId:     row.tenant_id,
  userId:       row.user_id       || null,
  apiKeyEnc:    row.api_key_enc,
  status:       row.status,
  lastSyncedAt: row.last_synced_at,
  syncMetadata: row.sync_metadata || {},
  createdAt:    row.created_at,
  updatedAt:    row.updated_at,
});

const firefliesConnectionRepository = {

  // Primary lookup after migration 043 — resolves via the AM currently assigned
  // to the tenant, exactly mirroring findConnectionForTenant in calendar.repository.
  // Falls back to the legacy per-tenant row (user_id IS NULL) for pre-migration data.
  findForTenant: async (tenantId, userId) => {
    // 1. User-scoped: find by the current AM's user_id
    if (userId) {
      const { rows } = await db.query(
        `SELECT * FROM fireflies_connections WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      if (rows[0]) return mapRow(rows[0]);
    }
    // 2. Fallback: legacy tenant-keyed row (user_id IS NULL — pre-migration data)
    const { rows } = await db.query(
      `SELECT * FROM fireflies_connections WHERE tenant_id = $1 AND user_id IS NULL LIMIT 1`,
      [tenantId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  // Legacy method kept for internal callers that only have tenantId (e.g. scheduled jobs).
  // Filters to connected rows only and prefers the most recently updated so a
  // disconnected user-scoped row never shadows an active one when multiple AMs
  // exist under the same tenant.
  findByTenant: async (tenantId) => {
    const { rows } = await db.query(
      `SELECT * FROM fireflies_connections
       WHERE  tenant_id = $1 AND status = 'connected'
       ORDER  BY updated_at DESC
       LIMIT  1`,
      [tenantId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  // Upserts by user_id (new path). Falls back to tenant-keyed upsert for legacy callers.
  upsert: async ({ userId, tenantId, apiKeyEnc, status = 'connected', syncMetadata = {} }) => {
    let rows;
    if (userId) {
      // Remove any legacy tenant-keyed row (user_id IS NULL) for this tenant
      // before inserting the user-scoped row — otherwise the old tenant_id unique
      // constraint fires and blocks the insert (migration 043 didn't drop that index).
      await db.query(
        `DELETE FROM fireflies_connections WHERE tenant_id = $1 AND user_id IS NULL`,
        [tenantId]
      );

      // User-scoped upsert — one Fireflies key per AM covers all their tenants.
      ({ rows } = await db.query(
        `INSERT INTO fireflies_connections
           (user_id, tenant_id, api_key_enc, status, sync_metadata, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE SET
           tenant_id      = EXCLUDED.tenant_id,
           api_key_enc    = EXCLUDED.api_key_enc,
           status         = EXCLUDED.status,
           sync_metadata  = EXCLUDED.sync_metadata,
           last_synced_at = NOW(),
           updated_at     = NOW()
         RETURNING *`,
        [userId, tenantId, apiKeyEnc, status, JSON.stringify(syncMetadata)]
      ));
    } else {
      // Legacy per-tenant upsert (no userId available).
      ({ rows } = await db.query(
        `INSERT INTO fireflies_connections
           (tenant_id, api_key_enc, status, sync_metadata, last_synced_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (tenant_id) DO UPDATE SET
           api_key_enc    = EXCLUDED.api_key_enc,
           status         = EXCLUDED.status,
           sync_metadata  = EXCLUDED.sync_metadata,
           last_synced_at = NOW(),
           updated_at     = NOW()
         RETURNING *`,
        [tenantId, apiKeyEnc, status, JSON.stringify(syncMetadata)]
      ));
    }
    logger.info('Fireflies connection upserted', { userId, tenantId, status });
    return mapRow(rows[0]);
  },

  // Updates status — tries user_id first, falls back to tenant_id for legacy rows.
  setStatus: async (tenantId, status, userId = null) => {
    if (userId) {
      const { rows } = await db.query(
        `UPDATE fireflies_connections
         SET status = $1, updated_at = NOW()
         WHERE user_id = $2 RETURNING *`,
        [status, userId]
      );
      if (rows[0]) return mapRow(rows[0]);
    }
    const { rows } = await db.query(
      `UPDATE fireflies_connections
       SET status = $1, updated_at = NOW()
       WHERE tenant_id = $2 AND user_id IS NULL RETURNING *`,
      [status, tenantId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  // Removes the current AM's connection. Falls back to legacy tenant-keyed row.
  delete: async (tenantId, userId = null) => {
    if (userId) {
      await db.query(
        `DELETE FROM fireflies_connections WHERE user_id = $1`,
        [userId]
      );
      logger.info('Fireflies connection removed (user-scoped)', { userId, tenantId });
      return;
    }
    await db.query(
      `DELETE FROM fireflies_connections WHERE tenant_id = $1`,
      [tenantId]
    );
    logger.info('Fireflies connection removed (tenant-scoped)', { tenantId });
  },
};

module.exports = firefliesConnectionRepository;
