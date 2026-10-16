'use strict';

const db = require('../config/db');

class FindingsService {
  static async getAllFindings({ tenantId = null } = {}) {
    const params = [];
    const tenantClause = tenantId
      ? (params.push(tenantId), `WHERE m.tenant_id = $${params.length}`)
      : '';

    const query = `
      SELECT f.id, f.meeting_id, f.source_finding_id AS source_id, f.severity, f.category,
             f.title, f.description, f.system_affected, f.created_at AS detected_at,
             c.name AS customer_name
        FROM findings f
        JOIN meetings  m ON f.meeting_id = m.id
        JOIN customers c ON m.tenant_id  = c.id
        ${tenantClause}
       ORDER BY f.created_at DESC;
    `;
    const { rows } = await db.query(query, params);
    return rows;
  }

  static async getFindingById(id, { tenantId = null } = {}) {
    const params = [id];
    const tenantClause = tenantId
      ? (params.push(tenantId), `AND m.tenant_id = $${params.length}`)
      : '';

    const query = `
      SELECT f.id, f.meeting_id, f.source_finding_id AS source_id, f.severity, f.category,
             f.title, f.description, f.system_affected, f.created_at AS detected_at,
             c.name AS customer_name
        FROM findings f
        JOIN meetings  m ON f.meeting_id = m.id
        JOIN customers c ON m.tenant_id  = c.id
       WHERE f.id = $1 ${tenantClause}
       LIMIT 1;
    `;
    const { rows } = await db.query(query, params);
    return rows[0] || null;
  }

  static async getAITasksForFinding(findingId, { tenantId = null } = {}) {
    // Confirm the finding is accessible to this tenant before returning its tasks
    const finding = await this.getFindingById(findingId, { tenantId });
    if (!finding) return null; // signals 404 / access denied to controller

    const query = `
      SELECT t.id, t.finding_id, t.title, t.action_plan, t.risk_reduction_score,
             t.approval_status, t.remediation_status, t.notes,
             f.category AS finding_category
        FROM tasks    t
        JOIN findings f ON t.finding_id = f.id
       WHERE t.finding_id = $1
       ORDER BY t.created_at DESC;
    `;
    const { rows } = await db.query(query, [findingId]);
    return rows;
  }
}

module.exports = FindingsService;
