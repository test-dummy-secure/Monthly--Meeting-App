'use strict';

const db = require('../database/index');

const mapRow = (row) => ({
  id:           row.id,
  tenantId:     row.tenant_id,
  meetingId:    row.meeting_id,
  providerType: row.provider_type,
  syncStatus:   row.sync_status,
  errorMessage: row.error_message,
  startedAt:    row.started_at,
  completedAt:  row.completed_at,
  createdAt:    row.created_at,
});

const providerSyncLogRepository = {

  create: async ({ tenantId, meetingId, providerType }) => {
    const { rows } = await db.query(
      `INSERT INTO provider_sync_logs
         (tenant_id, meeting_id, provider_type, sync_status, started_at)
       VALUES ($1, $2, $3, 'running', NOW())
       RETURNING *`,
      [tenantId, meetingId || null, providerType]
    );
    return mapRow(rows[0]);
  },

  updateStatus: async (id, syncStatus, errorMessage = null) => {
    const { rows } = await db.query(
      `UPDATE provider_sync_logs
       SET  sync_status   = $1,
            error_message = $2,
            completed_at  = CASE WHEN $1 IN ('completed','failed') THEN NOW() ELSE completed_at END
       WHERE id = $3
       RETURNING *`,
      [syncStatus, errorMessage, id]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  findByTenant: async (tenantId, limit = 50) => {
    const { rows } = await db.query(
      `SELECT * FROM provider_sync_logs
       WHERE  tenant_id = $1
       ORDER  BY created_at DESC
       LIMIT  $2`,
      [tenantId, limit]
    );
    return rows.map(mapRow);
  },

  findByMeeting: async (meetingId) => {
    const { rows } = await db.query(
      `SELECT * FROM provider_sync_logs
       WHERE  meeting_id = $1
       ORDER  BY created_at DESC`,
      [meetingId]
    );
    return rows.map(mapRow);
  },
};

module.exports = providerSyncLogRepository;
