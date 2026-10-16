'use strict';

const db     = require('../database/index');
const logger = require('../utils/logger');

const mapRow = (row) => ({
  userId:     row.user_id,
  tenantId:   row.tenant_id,
  isPrimary:  row.is_primary,
  role:       row.role,
  assignedAt: row.assigned_at,
  assignedBy: row.assigned_by,
  name:       row.am_name   || null,
  email:      row.am_email  || null,
  firstName:  row.am_first  || null,
  lastName:   row.am_last   || null,
  isActive:   row.am_active != null ? row.am_active : null,
});

const tenantAssignmentRepository = {

  findByTenant: async (tenantId) => {
    const { rows } = await db.query(`
      SELECT ta.*,
             TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS am_name,
             u.email      AS am_email,
             u.first_name AS am_first,
             u.last_name  AS am_last,
             u.is_active  AS am_active
      FROM   tenant_assignments ta
      JOIN   users u ON u.id = ta.user_id
      WHERE  ta.tenant_id = $1
      ORDER  BY ta.is_primary DESC, ta.assigned_at ASC
    `, [tenantId]);
    return rows.map(mapRow);
  },

  // Returns the list of tenant IDs that this user is assigned to.
  findTenantIdsByUser: async (userId) => {
    const { rows } = await db.query(`
      SELECT tenant_id FROM tenant_assignments WHERE user_id = $1
    `, [userId]);
    return rows.map((r) => r.tenant_id);
  },

  isAssigned: async (tenantId, userId) => {
    const { rows } = await db.query(`
      SELECT 1 FROM tenant_assignments WHERE tenant_id = $1 AND user_id = $2
    `, [tenantId, userId]);
    return rows.length > 0;
  },

  // Idempotent — silently skips on duplicate (UNIQUE user_id+tenant_id).
  add: async (tenantId, userId, assignedBy) => {
    await db.query(`
      INSERT INTO tenant_assignments (user_id, tenant_id, role, assigned_by, is_primary)
      VALUES ($1, $2, 'account_manager', $3, FALSE)
      ON CONFLICT (user_id, tenant_id) DO NOTHING
    `, [userId, tenantId, assignedBy]);
    logger.info('AM assigned to tenant', { userId, tenantId });
  },

  // Single-statement insert used during tenant creation when an AM is selected
  // in the creation form. is_primary = TRUE because this is the first and only
  // AM on a brand-new tenant — no need to clear existing primaries first.
  // ON CONFLICT handles the edge case where a duplicate call is made.
  addAsPrimary: async (tenantId, userId, assignedBy) => {
    await db.query(`
      INSERT INTO tenant_assignments (user_id, tenant_id, role, assigned_by, is_primary)
      VALUES ($1, $2, 'account_manager', $3, TRUE)
      ON CONFLICT (user_id, tenant_id) DO UPDATE SET is_primary = TRUE
    `, [userId, tenantId, assignedBy]);
    logger.info('AM assigned as primary on tenant create', { userId, tenantId });
  },

  remove: async (tenantId, userId) => {
    const { rowCount } = await db.query(`
      DELETE FROM tenant_assignments WHERE tenant_id = $1 AND user_id = $2
    `, [tenantId, userId]);
    if (rowCount > 0) logger.info('AM unassigned from tenant', { userId, tenantId });
    return rowCount > 0;
  },

  // Atomically: clear all primaries for tenant, set the new one,
  // then sync customers.account_manager_id (which triggers text sync).
  setPrimary: async (tenantId, userId) => {
    await db.withTransaction(async (client) => {
      await client.query(`
        UPDATE tenant_assignments SET is_primary = FALSE WHERE tenant_id = $1
      `, [tenantId]);
      await client.query(`
        UPDATE tenant_assignments SET is_primary = TRUE
        WHERE  tenant_id = $1 AND user_id = $2
      `, [tenantId, userId]);
      await client.query(`
        UPDATE customers SET account_manager_id = $1, updated_at = NOW() WHERE id = $2
      `, [userId, tenantId]);
    });
    logger.info('Primary AM changed', { tenantId, userId });
  },

  // Call when the last AM is removed — clears the FK on the customer row.
  clearPrimary: async (tenantId) => {
    await db.query(`
      UPDATE customers SET account_manager_id = NULL, updated_at = NOW() WHERE id = $1
    `, [tenantId]);
  },
};

module.exports = tenantAssignmentRepository;
