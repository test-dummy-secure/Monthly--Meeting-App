'use strict';

const db     = require('../database/index');
const logger = require('../utils/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const assertUUID = (value, name) => {
  if (!value || !UUID_RE.test(value)) {
    throw Object.assign(new Error(`Invalid ${name}`), { statusCode: 400 });
  }
};

const mapRow = (row) => ({
  id:                  row.id,
  tenantId:            row.tenant_id,
  providerType:        row.provider_type,
  providerName:        row.provider_name,
  connectionStatus:    row.connection_status,
  oauthAccountEmail:   row.oauth_account_email,
  providerWorkspaceId: row.provider_workspace_id,
  lastSyncAt:          row.last_sync_at,
  createdAt:           row.created_at,
  updatedAt:           row.updated_at,
});

const providerRepository = {

  findByTenant: async (tenantId) => {
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `SELECT * FROM provider_connections WHERE tenant_id = $1 ORDER BY created_at ASC`,
      [tenantId]
    );
    return rows.map(mapRow);
  },

  findById: async (id, tenantId) => {
    assertUUID(id, 'id');
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `SELECT * FROM provider_connections WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  findByType: async (tenantId, providerType) => {
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `SELECT * FROM provider_connections WHERE tenant_id = $1 AND provider_type = $2 LIMIT 1`,
      [tenantId, providerType]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  // Upsert: one row per (tenant_id, provider_type)
  upsert: async ({ tenantId, providerType, providerName, connectionStatus, oauthAccountEmail, providerWorkspaceId }) => {
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `INSERT INTO provider_connections
         (tenant_id, provider_type, provider_name, connection_status, oauth_account_email, provider_workspace_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, provider_type) DO UPDATE SET
         provider_name         = EXCLUDED.provider_name,
         connection_status     = EXCLUDED.connection_status,
         oauth_account_email   = EXCLUDED.oauth_account_email,
         provider_workspace_id = EXCLUDED.provider_workspace_id,
         updated_at            = NOW()
       RETURNING *`,
      [
        tenantId,
        providerType,
        providerName || providerType,
        connectionStatus || 'connected',
        oauthAccountEmail || null,
        providerWorkspaceId || null,
      ]
    );
    logger.info('Provider connection upserted', { tenantId, providerType });
    return mapRow(rows[0]);
  },

  update: async (id, tenantId, updates) => {
    assertUUID(id, 'id');
    assertUUID(tenantId, 'tenantId');

    const colMap = {
      connectionStatus:    'connection_status',
      oauthAccountEmail:   'oauth_account_email',
      providerWorkspaceId: 'provider_workspace_id',
      providerName:        'provider_name',
      lastSyncAt:          'last_sync_at',
    };

    const setClauses = [];
    const values     = [];
    let   idx        = 1;

    for (const [key, col] of Object.entries(colMap)) {
      if (updates[key] !== undefined) {
        setClauses.push(`${col} = $${idx}`);
        values.push(updates[key]);
        idx++;
      }
    }

    if (setClauses.length === 0) {
      throw Object.assign(new Error('No updatable fields provided'), { statusCode: 400 });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id, tenantId);

    const { rows } = await db.query(
      `UPDATE provider_connections
       SET    ${setClauses.join(', ')}
       WHERE  id = $${idx} AND tenant_id = $${idx + 1}
       RETURNING *`,
      values
    );

    return rows[0] ? mapRow(rows[0]) : null;
  },

  delete: async (id, tenantId) => {
    assertUUID(id, 'id');
    assertUUID(tenantId, 'tenantId');
    await db.query(
      `DELETE FROM provider_connections WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
  },
};

module.exports = providerRepository;
