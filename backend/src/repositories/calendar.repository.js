'use strict';
const db     = require('../database/index');
const logger = require('../utils/logger');

const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertUUID = (val, label = 'id') => {
  if (!UUID_RE.test(val)) throw Object.assign(new Error(`Invalid ${label}`), { statusCode: 400 });
};

// ─── Row mappers ─────────────────────────────────────────────────────────────

const mapConn = (row) => ({
  id:               row.id,
  tenantId:         row.tenant_id,
  userId:           row.user_id           || null, // migration 036 — AM user who owns the token
  provider:         row.provider,
  connectedEmail:   row.connected_email,
  status:           row.status,
  scopes:           row.scopes || [],
  connectedAt:      row.connected_at,
  lastUsedAt:       row.last_used_at,
  createdAt:        row.created_at,
  updatedAt:        row.updated_at,
  // Phase 11 Microsoft columns (null-safe — columns added by migration 030)
  calendlyUrl:      row.calendly_url      || null,
  msUserId:         row.ms_user_id        || null,
  accessTokenEnc:   row.access_token_enc  || null,
  refreshTokenEnc:  row.refresh_token_enc || null,
  tokenExpiresAt:   row.token_expires_at  || null,
  lastError:        row.last_error        || null,
  lastErrorAt:      row.last_error_at     || null,
  lastVerifiedAt:   row.last_verified_at  || null,
});

const mapSyncLog = (row) => ({
  id:           row.id,
  tenantId:     row.tenant_id,
  meetingId:    row.meeting_id,
  connectionId: row.connection_id,
  provider:     row.provider,
  syncType:     row.sync_type,
  syncStatus:   row.sync_status,
  payload:      row.payload || {},
  errorMessage: row.error_message,
  startedAt:    row.started_at,
  completedAt:  row.completed_at,
  createdAt:    row.created_at,
});

const mapConfig = (row) => ({
  id:                      row.id,
  tenantId:                row.tenant_id,
  firstMeetingDate:        row.first_meeting_date,
  meetingTime:             row.meeting_time,
  timezone:                row.timezone,
  recurrencePattern:       row.recurrence_pattern,
  defaultCalendarProvider: row.default_calendar_provider,
  meetingDurationMinutes:  row.meeting_duration_minutes,
  reminderSchedule:        row.reminder_schedule || [7, 3, 1],
  calendarAccount:         row.calendar_account,
  createdAt:               row.created_at,
  updatedAt:               row.updated_at,
});

const CONN_COLS = `id, tenant_id, user_id, provider, connected_email, status, scopes,
                   connected_at, last_used_at, created_at, updated_at,
                   calendly_url, ms_user_id, access_token_enc, refresh_token_enc,
                   token_expires_at, last_error, last_error_at, last_verified_at`;

const calendarRepository = {

  // ── calendar_connections ────────────────────────────────────────────────────

  findConnections: async (tenantId, userId) => {
    assertUUID(tenantId, 'tenantId');
    assertUUID(userId, 'userId');
    // Return ONLY the current user's own OAuth connection row.
    // Legacy tenant-keyed rows (user_id IS NULL) are intentionally excluded —
    // they belong to whoever was the primary AM at setup time and must not be
    // visible to other AMs sharing the same tenant (the credential leakage bug).
    // Those rows are still used by findConnectionForTenant for background jobs.
    const { rows } = await db.query(
      `SELECT ${CONN_COLS} FROM calendar_connections
       WHERE  user_id = $1
       ORDER  BY last_used_at DESC NULLS LAST`,
      [userId]
    );
    return rows.map(mapConn);
  },

  findConnectionById: async (id, tenantId, userId = null) => {
    assertUUID(id, 'id');
    assertUUID(tenantId, 'tenantId');
    // Accept ownership via tenant_id (legacy rows) OR user_id (post-migration 036 rows).
    // User-scoped rows have tenant_id = NULL so the tenant check alone would miss them.
    const { rows } = await db.query(
      `SELECT ${CONN_COLS} FROM calendar_connections
       WHERE id = $1
         AND (tenant_id = $2 OR ($3::uuid IS NOT NULL AND user_id = $3))`,
      [id, tenantId, userId || null]
    );
    return rows[0] ? mapConn(rows[0]) : null;
  },

  findConnectionByProvider: async (tenantId, provider) => {
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `SELECT ${CONN_COLS} FROM calendar_connections
       WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider]
    );
    return rows[0] ? mapConn(rows[0]) : null;
  },

  // Find the user-scoped connection (migration 036) for a given AM user + provider.
  findConnectionByUserId: async (userId, provider) => {
    assertUUID(userId, 'userId');
    const { rows } = await db.query(
      `SELECT ${CONN_COLS} FROM calendar_connections
       WHERE user_id = $1 AND provider = $2
         AND user_id IS NOT NULL
       ORDER BY last_used_at DESC NULLS LAST
       LIMIT 1`,
      [userId, provider]
    );
    return rows[0] ? mapConn(rows[0]) : null;
  },

  saveCalendlyUrl: async (userId, provider, url) => {
    assertUUID(userId, 'userId');
    const { rows } = await db.query(
      `UPDATE calendar_connections
       SET calendly_url = $1, updated_at = NOW()
       WHERE user_id = $2 AND provider = $3 AND user_id IS NOT NULL
       RETURNING ${CONN_COLS}`,
      [url || null, userId, provider]
    );
    return rows[0] ? mapConn(rows[0]) : null;
  },

  // Save encrypted Calendly Personal Access Token for the AM (migration 039)
  saveCalendlyToken: async (userId, provider, encryptedToken) => {
    assertUUID(userId, 'userId');
    const { rows } = await db.query(
      `UPDATE calendar_connections
       SET calendly_token_enc = $1, updated_at = NOW()
       WHERE user_id = $2 AND provider = $3 AND user_id IS NOT NULL
       RETURNING id`,
      [encryptedToken || null, userId, provider]
    );
    return rows[0] || null;
  },

  // Retrieve raw encrypted token — decryption is the caller's responsibility
  getCalendlyTokenEnc: async (userId, provider) => {
    assertUUID(userId, 'userId');
    const { rows } = await db.query(
      `SELECT calendly_token_enc FROM calendar_connections
       WHERE user_id = $1 AND provider = $2 AND user_id IS NOT NULL
       ORDER BY last_used_at DESC NULLS LAST LIMIT 1`,
      [userId, provider]
    );
    return rows[0]?.calendly_token_enc || null;
  },

  upsertConnection: async (tenantId, { provider, connectedEmail, scopes = [] }) => {
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `INSERT INTO calendar_connections (tenant_id, provider, connected_email, status, scopes)
       VALUES ($1, $2, $3, 'connected', $4)
       ON CONFLICT (tenant_id, provider)
       DO UPDATE SET
         connected_email = EXCLUDED.connected_email,
         status          = 'connected',
         scopes          = EXCLUDED.scopes,
         last_used_at    = NOW(),
         updated_at      = NOW()
       RETURNING ${CONN_COLS}`,
      [tenantId, provider, connectedEmail || null, JSON.stringify(scopes)]
    );
    return mapConn(rows[0]);
  },

  updateConnectionStatus: async (id, tenantId, status, userId = null) => {
    assertUUID(id, 'id');
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `UPDATE calendar_connections
       SET status = $1, updated_at = NOW()
       WHERE id = $2
         AND (tenant_id = $3 OR ($4::uuid IS NOT NULL AND user_id = $4))
       RETURNING ${CONN_COLS}`,
      [status, id, tenantId, userId || null]
    );
    return rows[0] ? mapConn(rows[0]) : null;
  },

  deleteConnection: async (id, tenantId, userId = null) => {
    assertUUID(id, 'id');
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `DELETE FROM calendar_connections
       WHERE id = $1
         AND (tenant_id = $2 OR ($3::uuid IS NOT NULL AND user_id = $3))
       RETURNING id`,
      [id, tenantId, userId || null]
    );
    return rows[0] || null;
  },

  // ── calendar_sync_logs ──────────────────────────────────────────────────────

  createSyncLog: async ({ tenantId, meetingId, connectionId, provider, syncType, payload = {} }) => {
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `INSERT INTO calendar_sync_logs
         (tenant_id, meeting_id, connection_id, provider, sync_type, sync_status, payload, started_at)
       VALUES ($1, $2, $3, $4, $5, 'running', $6, NOW())
       RETURNING *`,
      [
        tenantId,
        meetingId    || null,
        connectionId || null,
        provider     || 'manual',
        syncType     || 'sync',
        JSON.stringify(payload),
      ]
    );
    return mapSyncLog(rows[0]);
  },

  updateSyncLogStatus: async (id, syncStatus, errorMessage = null) => {
    assertUUID(id, 'id');
    const terminal = ['completed', 'failed'].includes(syncStatus);
    const { rows } = await db.query(
      `UPDATE calendar_sync_logs
       SET sync_status   = $1,
           error_message = $2
           ${terminal ? ', completed_at = NOW()' : ''}
       WHERE id = $3
       RETURNING *`,
      [syncStatus, errorMessage, id]
    );
    return rows[0] ? mapSyncLog(rows[0]) : null;
  },

  findSyncLogs: async (tenantId, { meetingId, limit = 50 } = {}) => {
    assertUUID(tenantId, 'tenantId');
    const params = [tenantId];
    let where = 'WHERE tenant_id = $1';

    if (meetingId) {
      assertUUID(meetingId, 'meetingId');
      params.push(meetingId);
      where += ` AND meeting_id = $${params.length}`;
    }

    params.push(Math.min(parseInt(limit, 10) || 50, 200));
    const { rows } = await db.query(
      `SELECT * FROM calendar_sync_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map(mapSyncLog);
  },

  // Returns all reminder sync log entries for the given meeting IDs so the
  // reminder-windows job can skip windows that have already been dispatched.
  // Checks ALL statuses (running/completed) — a running entry means a trigger
  // is already in-flight, so we must not fire again.
  findFiredReminders: async (meetingIds) => {
    if (!meetingIds || meetingIds.length === 0) return [];
    const { rows } = await db.query(
      `SELECT meeting_id AS "meetingId",
              payload->>'reminderType' AS "reminderType"
       FROM   calendar_sync_logs
       WHERE  meeting_id = ANY($1)
         AND  sync_type  = 'reminder'`,
      [meetingIds]
    );
    return rows;
  },

  // ── meeting_configs calendar settings ──────────────────────────────────────

  findConfig: async (tenantId) => {
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `SELECT id, tenant_id, first_meeting_date, meeting_time, timezone, recurrence_pattern,
              default_calendar_provider, meeting_duration_minutes, reminder_schedule, calendar_account,
              created_at, updated_at
       FROM meeting_configs
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId]
    );
    return rows[0] ? mapConfig(rows[0]) : null;
  },

  // ── Microsoft Phase-11 methods ──────────────────────────────────────────────

  storeOAuthTokens: async (tenantId, { accessTokenEnc, refreshTokenEnc, tokenExpiresAt, email, msUserId }) => {
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `UPDATE calendar_connections
       SET access_token_enc  = $1,
           refresh_token_enc = $2,
           token_expires_at  = $3,
           connected_email   = COALESCE($4, connected_email),
           ms_user_id        = COALESCE($5, ms_user_id),
           status            = 'connected',
           last_error        = NULL,
           last_error_at     = NULL,
           last_used_at      = NOW(),
           updated_at        = NOW()
       WHERE tenant_id = $6 AND provider = 'microsoft'
       RETURNING ${CONN_COLS}`,
      [accessTokenEnc, refreshTokenEnc, tokenExpiresAt, email || null, msUserId || null, tenantId]
    );
    return rows[0] ? mapConn(rows[0]) : null;
  },

  updateConnectionError: async (tenantId, provider, errorStatus, errorMessage) => {
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `UPDATE calendar_connections
       SET status       = $1,
           last_error   = $2,
           last_error_at = NOW(),
           updated_at   = NOW()
       WHERE tenant_id = $3 AND provider = $4
       RETURNING ${CONN_COLS}`,
      [errorStatus, errorMessage || null, tenantId, provider]
    );
    return rows[0] ? mapConn(rows[0]) : null;
  },

  updateConnectionVerified: async (tenantId, provider) => {
    assertUUID(tenantId, 'tenantId');
    const { rows } = await db.query(
      `UPDATE calendar_connections
       SET last_verified_at = NOW(),
           last_used_at     = NOW(),
           updated_at       = NOW()
       WHERE tenant_id = $1 AND provider = $2
       RETURNING ${CONN_COLS}`,
      [tenantId, provider]
    );
    return rows[0] ? mapConn(rows[0]) : null;
  },

  // ── Migration 036: user-scoped methods ─────────────────────────────────────

  // Looks up the Microsoft connection for a tenant by resolving the AM's user_id.
  // This is the primary lookup after migration 036 — a new tenant automatically
  // inherits the AM's existing connection without requiring a fresh OAuth flow.
  // Falls back to the legacy tenant-keyed row for pre-migration rows.
  findConnectionForTenant: async (tenantId, provider) => {
    assertUUID(tenantId, 'tenantId');
    // Primary: user-scoped connection via AM join — checks EVERY AM assigned to
    // this tenant (not just the primary), since a secondary/shared AM's own
    // Microsoft 365 connection should also work for tenants they're assigned to.
    const { rows: userRows } = await db.query(
      `SELECT cc.*
       FROM   calendar_connections cc
       JOIN   tenant_assignments   ta ON ta.user_id = cc.user_id
       WHERE  ta.tenant_id = $1
         AND  cc.provider  = $2
         AND  cc.user_id   IS NOT NULL
       ORDER BY cc.last_used_at DESC NULLS LAST
       LIMIT  1`,
      [tenantId, provider]
    );
    if (userRows[0]) return mapConn(userRows[0]);

    // Fallback: legacy tenant-keyed row (pre-migration data)
    const { rows: tenantRows } = await db.query(
      `SELECT ${CONN_COLS}
       FROM   calendar_connections
       WHERE  tenant_id = $1 AND provider = $2
       LIMIT  1`,
      [tenantId, provider]
    );
    return tenantRows[0] ? mapConn(tenantRows[0]) : null;
  },

  // UPSERT a user-scoped OAuth token row (no tenant_id — covers all that AM's tenants).
  // Called from MicrosoftTokenStore.save(userId, tokens) after the OAuth callback.
  storeOAuthTokensByUser: async (userId, { accessTokenEnc, refreshTokenEnc, tokenExpiresAt, email, msUserId }) => {
    assertUUID(userId, 'userId');
    const { rows } = await db.query(
      `INSERT INTO calendar_connections
         (user_id, provider, access_token_enc, refresh_token_enc, token_expires_at,
          connected_email, ms_user_id, status, scopes)
       VALUES ($1, 'microsoft', $2, $3, $4, $5, $6, 'connected',
               '["Calendars.ReadWrite","OnlineMeetings.ReadWrite","offline_access","User.Read"]'::jsonb)
       ON CONFLICT (user_id, provider) WHERE user_id IS NOT NULL
       DO UPDATE SET
         access_token_enc  = EXCLUDED.access_token_enc,
         refresh_token_enc = EXCLUDED.refresh_token_enc,
         token_expires_at  = EXCLUDED.token_expires_at,
         connected_email   = COALESCE(EXCLUDED.connected_email,  calendar_connections.connected_email),
         ms_user_id        = COALESCE(EXCLUDED.ms_user_id,       calendar_connections.ms_user_id),
         status            = 'connected',
         last_error        = NULL,
         last_error_at     = NULL,
         last_used_at      = NOW(),
         updated_at        = NOW()
       RETURNING ${CONN_COLS}`,
      [userId, accessTokenEnc, refreshTokenEnc, tokenExpiresAt,
       email || null, msUserId || null]
    );
    return rows[0] ? mapConn(rows[0]) : null;
  },

  // Update error state by connection primary key (used in MicrosoftTokenStore.load).
  updateConnectionErrorById: async (connId, errorStatus, errorMessage) => {
    assertUUID(connId, 'connId');
    await db.query(
      `UPDATE calendar_connections
       SET status        = $1,
           last_error    = $2,
           last_error_at = NOW(),
           updated_at    = NOW()
       WHERE id = $3`,
      [errorStatus, errorMessage || null, connId]
    );
  },

  // Mark connection as verified by primary key (used after a successful Graph API call).
  updateConnectionVerifiedById: async (connId) => {
    assertUUID(connId, 'connId');
    await db.query(
      `UPDATE calendar_connections
       SET last_verified_at = NOW(),
           last_used_at     = NOW(),
           updated_at       = NOW()
       WHERE id = $1`,
      [connId]
    );
  },

  updateConfig: async (tenantId, updates) => {
    assertUUID(tenantId, 'tenantId');

    const FIELD_MAP = {
      defaultCalendarProvider: 'default_calendar_provider',
      meetingDurationMinutes:  'meeting_duration_minutes',
      reminderSchedule:        'reminder_schedule',
      calendarAccount:         'calendar_account',
      timezone:                'timezone',
      recurrencePattern:       'recurrence_pattern',
    };

    const setClauses = ['updated_at = NOW()'];
    const values     = [];
    let   idx        = 1;

    for (const [key, col] of Object.entries(FIELD_MAP)) {
      if (updates[key] !== undefined) {
        const val = (col === 'reminder_schedule') ? JSON.stringify(updates[key]) : updates[key];
        setClauses.push(`${col} = $${idx++}`);
        values.push(val);
      }
    }

    if (setClauses.length === 1) {
      throw Object.assign(new Error('No valid fields to update'), { statusCode: 400 });
    }

    values.push(tenantId);
    const { rows } = await db.query(
      `UPDATE meeting_configs
       SET ${setClauses.join(', ')}
       WHERE id = (
         SELECT id FROM meeting_configs WHERE tenant_id = $${idx} ORDER BY created_at DESC LIMIT 1
       )
       RETURNING id, tenant_id, first_meeting_date, meeting_time, timezone, recurrence_pattern,
                 default_calendar_provider, meeting_duration_minutes, reminder_schedule, calendar_account,
                 created_at, updated_at`,
      values
    );
    if (!rows[0]) throw Object.assign(new Error('Meeting config not found'), { statusCode: 404 });
    logger.info('Calendar config updated', { tenantId });
    return mapConfig(rows[0]);
  },
};

module.exports = calendarRepository;
