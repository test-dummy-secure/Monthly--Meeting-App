'use strict';
const db = require('../database/index');

const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertUUID = (val, label = 'id') => {
  if (!UUID_RE.test(val)) throw Object.assign(new Error(`Invalid ${label}`), { statusCode: 400 });
};

const mapRow = (row) => ({
  id:             row.id,
  meetingId:      row.meeting_id,
  tenantId:       row.tenant_id,
  recipientEmail: row.recipient_email,
  recipientName:  row.recipient_name,
  recipientType:  row.recipient_type,
  status:         row.status,
  sentAt:         row.sent_at,
  errorMessage:   row.error_message,
  createdAt:      row.created_at,
  updatedAt:      row.updated_at,
});

const invitationRepository = {

  findByMeeting: async (meetingId, tenantId) => {
    assertUUID(meetingId, 'meetingId');
    assertUUID(tenantId,  'tenantId');
    const { rows } = await db.query(
      `SELECT * FROM meeting_invitations
       WHERE meeting_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC`,
      [meetingId, tenantId]
    );
    return rows.map(mapRow);
  },

  create: async ({ meetingId, tenantId, recipientEmail, recipientName, recipientType = 'attendee' }) => {
    assertUUID(meetingId, 'meetingId');
    assertUUID(tenantId,  'tenantId');
    const { rows } = await db.query(
      `INSERT INTO meeting_invitations
         (meeting_id, tenant_id, recipient_email, recipient_name, recipient_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [meetingId, tenantId, recipientEmail, recipientName || null, recipientType]
    );
    return mapRow(rows[0]);
  },

  bulkCreate: async (records) => {
    if (!records.length) return [];
    const created = [];
    for (const r of records) {
      created.push(await invitationRepository.create(r));
    }
    return created;
  },

  updateStatus: async (id, { status, sentAt, errorMessage }) => {
    assertUUID(id, 'id');
    const { rows } = await db.query(
      `UPDATE meeting_invitations
       SET status        = $1,
           sent_at       = $2,
           error_message = $3,
           updated_at    = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, sentAt || null, errorMessage || null, id]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  cancelByMeeting: async (meetingId) => {
    assertUUID(meetingId, 'meetingId');
    const { rows } = await db.query(
      `UPDATE meeting_invitations
       SET status = 'cancelled', updated_at = NOW()
       WHERE meeting_id = $1 AND status IN ('pending')
       RETURNING id`,
      [meetingId]
    );
    return rows.map((r) => r.id);
  },

  countByMeeting: async (meetingId) => {
    assertUUID(meetingId, 'meetingId');
    const { rows } = await db.query(
      `SELECT status, COUNT(*) AS count
       FROM meeting_invitations
       WHERE meeting_id = $1
       GROUP BY status`,
      [meetingId]
    );
    return rows.reduce((acc, r) => ({ ...acc, [r.status]: parseInt(r.count, 10) }), {});
  },
};

module.exports = invitationRepository;
