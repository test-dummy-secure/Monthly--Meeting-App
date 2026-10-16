const db = require('../database/index');

const mapRow = (row) => ({
  id:            row.id,
  tenantId:      row.tenant_id,
  meetingId:     row.meeting_id     || null,
  weekStart:     row.week_start,
  weekEnd:       row.week_end,
  generatedBy:   row.generated_by,
  summary:       row.summary        || {},
  tasksSnapshot: row.tasks_snapshot || [],
  createdAt:     row.created_at,
});

const weeklyReportRepository = {

  create: async ({ tenantId, meetingId, weekStart, weekEnd, generatedBy, summary, tasksSnapshot }) => {
    const { rows } = await db.query(
      `INSERT INTO weekly_reports
         (tenant_id, meeting_id, week_start, week_end, generated_by, summary, tasks_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       RETURNING *`,
      [
        tenantId,
        meetingId || null,
        weekStart,
        weekEnd,
        generatedBy,
        JSON.stringify(summary   || {}),
        JSON.stringify(tasksSnapshot || []),
      ]
    );
    return mapRow(rows[0]);
  },

  findByTenant: async (tenantId, limit = 12) => {
    const { rows } = await db.query(
      `SELECT * FROM weekly_reports
       WHERE  tenant_id = $1
       ORDER  BY week_start DESC
       LIMIT  $2`,
      [tenantId, limit]
    );
    return rows.map(mapRow);
  },

  findLatest: async (tenantId) => {
    const { rows } = await db.query(
      `SELECT * FROM weekly_reports
       WHERE  tenant_id = $1
       ORDER  BY week_start DESC
       LIMIT  1`,
      [tenantId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },
};

module.exports = weeklyReportRepository;
