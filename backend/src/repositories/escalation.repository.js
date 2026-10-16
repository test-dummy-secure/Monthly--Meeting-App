const db     = require('../database/index');
const logger = require('../utils/logger');

const mapRow = (row) => ({
  id:             row.id,
  taskId:         row.task_id,
  tenantId:       row.tenant_id,
  escalatedBy:    row.escalated_by,
  escalatedTo:    row.escalated_to    || null,
  reason:         row.reason,
  blockerType:    row.blocker_type    || null,
  status:         row.status,
  resolvedAt:     row.resolved_at     || null,
  resolvedBy:     row.resolved_by     || null,
  resolutionNote: row.resolution_note || null,
  taskTitle:      row.task_title      || null,
  createdAt:      row.created_at,
  updatedAt:      row.updated_at,
});

const escalationRepository = {

  create: async ({ taskId, tenantId, escalatedBy, escalatedTo, reason, blockerType }) => {
    const { rows } = await db.query(
      `INSERT INTO escalations (task_id, tenant_id, escalated_by, escalated_to, reason, blocker_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [taskId, tenantId, escalatedBy, escalatedTo || null, reason, blockerType || null]
    );
    logger.info('Escalation created', { id: rows[0].id, taskId, tenantId });
    return mapRow(rows[0]);
  },

  findByTenant: async (tenantId, status = null) => {
    const base = `
      SELECT e.*, t.title AS task_title
      FROM   escalations e
      JOIN   tasks t ON t.id = e.task_id
      WHERE  e.tenant_id = $1`;
    const { rows } = status
      ? await db.query(`${base} AND e.status = $2 ORDER BY e.created_at DESC`, [tenantId, status])
      : await db.query(`${base} ORDER BY e.created_at DESC`, [tenantId]);
    return rows.map(mapRow);
  },

  findByTask: async (taskId) => {
    const { rows } = await db.query(
      `SELECT * FROM escalations WHERE task_id = $1 ORDER BY created_at DESC`,
      [taskId]
    );
    return rows.map(mapRow);
  },

  resolve: async (id, resolvedBy, resolutionNote, tenantId = null) => {
    const base = `
      UPDATE escalations
      SET    status          = 'resolved',
             resolved_at     = NOW(),
             resolved_by     = $1,
             resolution_note = $2,
             updated_at      = NOW()
      WHERE  id = $3`;
    const { rows } = tenantId
      ? await db.query(`${base} AND tenant_id = $4 RETURNING *`, [resolvedBy, resolutionNote || null, id, tenantId])
      : await db.query(`${base} RETURNING *`, [resolvedBy, resolutionNote || null, id]);
    if (!rows[0]) throw Object.assign(new Error('Escalation not found'), { statusCode: 404 });
    logger.info('Escalation resolved', { id, resolvedBy });
    return mapRow(rows[0]);
  },

  countOpenByTenant: async (tenantId) => {
    const { rows } = await db.query(
      `SELECT COUNT(*) FROM escalations WHERE tenant_id = $1 AND status = 'open'`,
      [tenantId]
    );
    return parseInt(rows[0].count) || 0;
  },
};

module.exports = escalationRepository;
