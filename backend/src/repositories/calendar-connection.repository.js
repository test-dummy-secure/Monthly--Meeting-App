const db     = require('../database/index');
const logger = require('../utils/logger');

const mapRow = (row) => ({
  id:               row.id,
  tenantId:         row.tenant_id,
  provider:         row.provider,
  accessTokenEnc:   row.access_token_enc,
  refreshTokenEnc:  row.refresh_token_enc,
  tokenExpiresAt:   row.token_expires_at,
  connectedEmail:   row.connected_email,
  status:           row.status,
  scopes:           row.scopes        || [],
  connectedAt:      row.connected_at,
  lastUsedAt:       row.last_used_at,
  createdAt:        row.created_at,
  updatedAt:        row.updated_at,
});

const calendarConnectionRepository = {

  findByTenant: async (tenantId) => {
    const { rows } = await db.query(
      `SELECT * FROM calendar_connections WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );
    return rows.map(mapRow);
  },

  findByTenantAndProvider: async (tenantId, provider) => {
    const { rows } = await db.query(
      `SELECT * FROM calendar_connections
       WHERE tenant_id = $1 AND provider = $2
       LIMIT 1`,
      [tenantId, provider]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  upsert: async ({ tenantId, provider, accessTokenEnc, refreshTokenEnc,
                   tokenExpiresAt, connectedEmail, status = 'connected', scopes = [] }) => {
    const { rows } = await db.query(
      `INSERT INTO calendar_connections
         (tenant_id, provider, access_token_enc, refresh_token_enc,
          token_expires_at, connected_email, status, scopes, connected_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (tenant_id, provider) DO UPDATE SET
         access_token_enc  = COALESCE(EXCLUDED.access_token_enc,  calendar_connections.access_token_enc),
         refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, calendar_connections.refresh_token_enc),
         token_expires_at  = COALESCE(EXCLUDED.token_expires_at,  calendar_connections.token_expires_at),
         connected_email   = COALESCE(EXCLUDED.connected_email,   calendar_connections.connected_email),
         status            = EXCLUDED.status,
         scopes            = EXCLUDED.scopes,
         connected_at      = NOW(),
         updated_at        = NOW()
       RETURNING *`,
      [
        tenantId, provider,
        accessTokenEnc  || null, refreshTokenEnc || null,
        tokenExpiresAt  || null, connectedEmail  || null,
        status, JSON.stringify(scopes),
      ]
    );
    logger.info('Calendar connection upserted', { tenantId, provider, status });
    return mapRow(rows[0]);
  },

  setStatus: async (tenantId, provider, status) => {
    const { rows } = await db.query(
      `UPDATE calendar_connections
       SET status = $1, updated_at = NOW()
       WHERE tenant_id = $2 AND provider = $3
       RETURNING *`,
      [status, tenantId, provider]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  updateTokens: async (tenantId, provider, { accessTokenEnc, refreshTokenEnc, tokenExpiresAt }) => {
    const { rows } = await db.query(
      `UPDATE calendar_connections
       SET access_token_enc  = $1,
           refresh_token_enc = COALESCE($2, refresh_token_enc),
           token_expires_at  = $3,
           status            = 'connected',
           last_used_at      = NOW(),
           updated_at        = NOW()
       WHERE tenant_id = $4 AND provider = $5
       RETURNING *`,
      [accessTokenEnc, refreshTokenEnc || null, tokenExpiresAt || null, tenantId, provider]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  delete: async (tenantId, provider) => {
    await db.query(
      `DELETE FROM calendar_connections WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider]
    );
    logger.info('Calendar connection removed', { tenantId, provider });
  },
};

module.exports = calendarConnectionRepository;
