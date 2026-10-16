const db     = require('../database/index');
const logger = require('../utils/logger');

const mapRow = (row) => ({
  id:         row.id,
  taskId:     row.task_id,
  tenantId:   row.tenant_id,
  actionType: row.action_type,
  actor:      row.actor,
  actorRole:  row.actor_role,
  oldValue:   row.old_value  || null,
  newValue:   row.new_value  || null,
  notes:      row.notes,
  createdAt:  row.created_at,
});

const taskHistoryRepository = {

  record: async ({ taskId, tenantId, actionType, actor, actorRole, oldValue, newValue, notes }) => {
    const { rows } = await db.query(
      `INSERT INTO task_history
         (task_id, tenant_id, action_type, actor, actor_role, old_value, new_value, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        taskId, tenantId, actionType, actor, actorRole || null,
        oldValue  ? JSON.stringify(oldValue)  : null,
        newValue  ? JSON.stringify(newValue)  : null,
        notes     || null,
      ]
    );
    return mapRow(rows[0]);
  },

  findByTask: async (taskId, limit = 100) => {
    const { rows } = await db.query(
      `SELECT * FROM task_history
       WHERE  task_id = $1
       ORDER  BY created_at DESC
       LIMIT  $2`,
      [taskId, limit]
    );
    return rows.map(mapRow);
  },

  findByTenant: async (tenantId, { limit = 200, actionType } = {}) => {
    const params   = [tenantId];
    let   whereClause = 'WHERE tenant_id = $1';
    if (actionType) {
      params.push(actionType);
      whereClause += ` AND action_type = $${params.length}`;
    }
    params.push(limit);
    const { rows } = await db.query(
      `SELECT * FROM task_history
       ${whereClause}
       ORDER  BY created_at DESC
       LIMIT  $${params.length}`,
      params
    );
    return rows.map(mapRow);
  },
};

module.exports = taskHistoryRepository;
