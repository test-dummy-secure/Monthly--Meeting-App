'use strict';

const db = require('../database/index');

const mapRow = (row) => ({
  id:                   row.id,
  meetingId:            row.meeting_id,
  tenantId:             row.tenant_id,
  providerType:         row.provider_type,
  providerConnectionId: row.provider_connection_id,
  sourceType:           row.source_type,
  createdAt:            row.created_at,
  // Joined fields from provider_connections (present on findByMeeting)
  connectionStatus:     row.connection_status     || null,
  oauthAccountEmail:    row.oauth_account_email   || null,
  lastSyncAt:           row.last_sync_at          || null,
});

const meetingProviderMappingRepository = {

  findByMeeting: async (meetingId) => {
    const { rows } = await db.query(
      `SELECT mpm.*,
              pc.connection_status,
              pc.oauth_account_email,
              pc.last_sync_at
       FROM   meeting_provider_mapping mpm
       LEFT JOIN provider_connections pc ON mpm.provider_connection_id = pc.id
       WHERE  mpm.meeting_id = $1
       LIMIT  1`,
      [meetingId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  // Upsert: one mapping per meeting
  upsert: async ({ meetingId, tenantId, providerType, providerConnectionId, sourceType }) => {
    const { rows } = await db.query(
      `INSERT INTO meeting_provider_mapping
         (meeting_id, tenant_id, provider_type, provider_connection_id, source_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (meeting_id) DO UPDATE SET
         provider_type          = EXCLUDED.provider_type,
         provider_connection_id = EXCLUDED.provider_connection_id,
         source_type            = EXCLUDED.source_type
       RETURNING *`,
      [
        meetingId,
        tenantId,
        providerType   || 'MANUAL',
        providerConnectionId || null,
        sourceType     || 'manual',
      ]
    );
    return mapRow(rows[0]);
  },
};

module.exports = meetingProviderMappingRepository;
