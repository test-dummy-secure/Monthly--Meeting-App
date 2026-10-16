const db     = require('../database/index');
const logger = require('../utils/logger');

const mapRow = (row) => ({
  id:             row.id,
  tenantId:       row.tenant_id,
  apiKeyEnc:      row.api_key_enc,
  apiEndpoint:    row.api_endpoint,
  workspaceId:    row.workspace_id,
  connectionType: row.connection_type,
  status:         row.status,
  lastSyncedAt:   row.last_synced_at,
  syncMetadata:   row.sync_metadata || {},
  createdAt:      row.created_at,
  updatedAt:      row.updated_at,
});

const nxg360ConnectionRepository = {

  findByTenant: async (tenantId) => {
    const { rows } = await db.query(
      `SELECT * FROM nxg360_connections WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  upsert: async ({ tenantId, apiKeyEnc, apiEndpoint, workspaceId,
                   connectionType = 'api_key', status = 'connected', syncMetadata = {} }) => {
    const { rows } = await db.query(
      `INSERT INTO nxg360_connections
         (tenant_id, api_key_enc, api_endpoint, workspace_id, connection_type, status, sync_metadata, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         api_key_enc     = COALESCE(EXCLUDED.api_key_enc,  nxg360_connections.api_key_enc),
         api_endpoint    = COALESCE(EXCLUDED.api_endpoint, nxg360_connections.api_endpoint),
         workspace_id    = COALESCE(EXCLUDED.workspace_id, nxg360_connections.workspace_id),
         connection_type = EXCLUDED.connection_type,
         status          = EXCLUDED.status,
         sync_metadata   = EXCLUDED.sync_metadata,
         last_synced_at  = NOW(),
         updated_at      = NOW()
       RETURNING *`,
      [tenantId, apiKeyEnc || null, apiEndpoint || null, workspaceId || null,
       connectionType, status, JSON.stringify(syncMetadata)]
    );
    logger.info('NXG360 connection upserted', { tenantId, status });
    return mapRow(rows[0]);
  },

  setStatus: async (tenantId, status) => {
    const { rows } = await db.query(
      `UPDATE nxg360_connections
       SET status = $1, updated_at = NOW()
       WHERE tenant_id = $2 RETURNING *`,
      [status, tenantId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  updateLastSynced: async (tenantId, status = 'connected') => {
    await db.query(
      `UPDATE nxg360_connections
       SET    last_synced_at = NOW(),
              status         = $1,
              updated_at     = NOW()
       WHERE  tenant_id = $2`,
      [status, tenantId]
    );
  },

  delete: async (tenantId) => {
    await db.query(
      `DELETE FROM nxg360_connections WHERE tenant_id = $1`,
      [tenantId]
    );
    logger.info('NXG360 connection removed', { tenantId });
  },
};

module.exports = nxg360ConnectionRepository;
