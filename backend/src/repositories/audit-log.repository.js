'use strict';

const db     = require('../database/index');
const logger = require('../utils/logger');

const auditLogRepository = {

  async create(tenantId, userEmail, action, details = {}, ipAddress = null) {
    try {
      const { rows } = await db.query(
        `INSERT INTO audit_logs (tenant_id, user_email, action, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tenant_id, user_email, action, details, ip_address, created_at`,
        [tenantId || null, userEmail || 'system', action, JSON.stringify(details || {}), ipAddress || null]
      );
      logger.info(`AUDIT: [${action}] by ${userEmail || 'system'}`);
      return rows[0];
    } catch (err) {
      // Never let audit log failure crash the caller — log and continue
      logger.error('Audit log write failed', { action, userEmail, error: err.message });
      return null;
    }
  },

  async findAll({ tenantId, limit = 200, offset = 0, action } = {}) {
    const params  = [];
    const clauses = [];

    if (tenantId) { params.push(tenantId); clauses.push(`tenant_id = $${params.length}`); }
    if (action)   { params.push(action);   clauses.push(`action    = $${params.length}`); }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit, offset);

    const { rows } = await db.query(
      `SELECT id, tenant_id, user_email, action, details, ip_address, created_at
       FROM   audit_logs
       ${where}
       ORDER  BY created_at DESC
       LIMIT  $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows;
  },

  async findByTenant(tenantId, limit = 100) {
    const { rows } = await db.query(
      `SELECT id, tenant_id, user_email, action, details, ip_address, created_at
       FROM   audit_logs
       WHERE  tenant_id = $1
       ORDER  BY created_at DESC
       LIMIT  $2`,
      [tenantId, limit]
    );
    return rows;
  },
};

module.exports = auditLogRepository;
