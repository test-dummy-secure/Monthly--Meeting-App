const db     = require('../database/index');
const logger = require('../utils/logger');

const mapRow = (row) => ({
  id:               row.id,
  meetingId:        row.meeting_id,
  tenantId:         row.tenant_id,
  provider:         row.provider,
  transcriptSource: row.transcript_source,
  transcriptUrl:    row.transcript_url,
  transcriptText:   row.transcript_text,
  summary:          row.summary,
  actionItems:      row.action_items      || [],
  followUpActions:  row.follow_up_actions || [],
  meetingSummary:   row.meeting_summary,
  decisionsTaken:   row.decisions_taken   || [],
  risksDiscussed:   row.risks_discussed   || [],
  topics:           row.topics            || [],
  aiStatus:         row.ai_status,
  createdAt:        row.created_at,
  updatedAt:        row.updated_at,
});

const meetingLogRepository = {

  findByMeeting: async (meetingId) => {
    const { rows } = await db.query(
      `SELECT * FROM meeting_notes WHERE meeting_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [meetingId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  findByTenant: async (tenantId, { page = 1, pageSize = 20 } = {}) => {
    const offset = (page - 1) * pageSize;
    const { rows } = await db.query(
      `SELECT * FROM meeting_notes
       WHERE  tenant_id = $1
       ORDER  BY created_at DESC
       LIMIT  $2 OFFSET $3`,
      [tenantId, pageSize, offset]
    );
    return rows.map(mapRow);
  },

  updateAiStatus: async (meetingId, aiStatus, metadata = null) => {
    const params = metadata
      ? [aiStatus, JSON.stringify(metadata), meetingId]
      : [aiStatus, meetingId];
    const sql = metadata
      ? `UPDATE meeting_notes
         SET    ai_status           = $1,
                processing_metadata = $2::jsonb,
                updated_at          = NOW()
         WHERE  meeting_id = $3
         RETURNING *`
      : `UPDATE meeting_notes
         SET    ai_status  = $1,
                updated_at = NOW()
         WHERE  meeting_id = $2
         RETURNING *`;
    const { rows } = await db.query(sql, params);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  upsert: async ({ meetingId, tenantId, provider, transcriptSource, transcriptUrl,
                   transcriptText, summary, actionItems, followUpActions,
                   meetingSummary, decisionsTaken, risksDiscussed, topics, aiStatus }) => {
    const { rows } = await db.query(
      `INSERT INTO meeting_notes (
         meeting_id, tenant_id, provider, transcript_source, transcript_url,
         transcript_text, summary, action_items, follow_up_actions,
         meeting_summary, decisions_taken, risks_discussed, topics, ai_status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (meeting_id) DO UPDATE SET
         provider          = EXCLUDED.provider,
         transcript_source = EXCLUDED.transcript_source,
         transcript_url    = EXCLUDED.transcript_url,
         transcript_text   = EXCLUDED.transcript_text,
         summary           = EXCLUDED.summary,
         action_items      = EXCLUDED.action_items,
         follow_up_actions = EXCLUDED.follow_up_actions,
         meeting_summary   = EXCLUDED.meeting_summary,
         decisions_taken   = EXCLUDED.decisions_taken,
         risks_discussed   = EXCLUDED.risks_discussed,
         topics            = EXCLUDED.topics,
         ai_status         = EXCLUDED.ai_status,
         updated_at        = NOW()
       RETURNING *`,
      [
        meetingId, tenantId, provider || null, transcriptSource || 'manual',
        transcriptUrl || null, transcriptText || null, summary || null,
        JSON.stringify(actionItems      || []),
        JSON.stringify(followUpActions  || []),
        meetingSummary || null,
        JSON.stringify(decisionsTaken   || []),
        JSON.stringify(risksDiscussed   || []),
        JSON.stringify(topics           || []),
        aiStatus || 'completed',
      ]
    );
    logger.info('Meeting log upserted', { meetingId, tenantId });
    return mapRow(rows[0]);
  },
  patchNotes: async (meetingId, { meetingSummary, actionItems, followUpActions, decisionsTaken, risksDiscussed }) => {
    // Block manual edits while the AI pipeline is active to prevent silent data loss.
    // notes_status = 'notes_added' means it's queued; 'processing' means it's running.
    const { rows: statusRows } = await db.query(
      `SELECT notes_status FROM meetings WHERE id = $1`,
      [meetingId]
    );
    const ns = statusRows[0]?.notes_status;
    if (ns === 'processing' || ns === 'notes_added') {
      throw Object.assign(
        new Error('AI analysis is currently running. Wait for it to complete before editing notes.'),
        { statusCode: 409 }
      );
    }

    // Reset topics on manual edit rather than leaving a stale grouping —
    // the old groups would still contain the pre-edit item text, which no
    // longer matches anything in the freshly-edited flat lists. An empty
    // array just falls back to the flat view (always accurate) until the
    // next re-analyze regenerates real groups from the edited content.
    const { rows } = await db.query(
      `UPDATE meeting_notes
       SET    meeting_summary   = $2,
              summary           = $2,
              action_items      = $3::jsonb,
              follow_up_actions = $4::jsonb,
              decisions_taken   = $5::jsonb,
              risks_discussed   = $6::jsonb,
              topics            = '[]'::jsonb,
              updated_at        = NOW()
       WHERE  meeting_id = $1
       RETURNING *`,
      [
        meetingId,
        meetingSummary ?? null,
        JSON.stringify(actionItems      || []),
        JSON.stringify(followUpActions  || []),
        JSON.stringify(decisionsTaken   || []),
        JSON.stringify(risksDiscussed   || []),
      ]
    );
    if (rows[0]) logger.info('Meeting notes patched (manual edit)', { meetingId });
    return rows[0] ? mapRow(rows[0]) : null;
  },
};

module.exports = meetingLogRepository;
