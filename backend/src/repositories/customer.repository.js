'use strict';

const db     = require('../database/index');
const logger = require('../utils/logger');

// ─── Base SELECT (always JOINs users for AM name + email) ────────────────────

const TENANT_SELECT = `
  SELECT
    c.id,
    c.name,
    c.domain,
    c.industry,
    c.timezone,
    c.meeting_platform,
    c.status,
    c.connected_calendars,
    c.account_manager_id,
    c.created_at,
    c.updated_at,
    u.first_name  AS am_first_name,
    u.last_name   AS am_last_name,
    u.email       AS am_email
  FROM customers c
  LEFT JOIN users u ON u.id = c.account_manager_id
`;

// ─── Row mapper — DB snake_case → app camelCase ───────────────────────────────

const mapRow = (row) => ({
  id:                  row.id,
  name:                row.name,
  domain:              row.domain,
  industry:            row.industry,
  timezone:            row.timezone,
  meetingPlatform:     row.meeting_platform,
  status:              row.status,
  connectedCalendars:  row.connected_calendars || [],
  accountManagerId:    row.account_manager_id  || null,
  accountManagerName:  row.am_first_name
                         ? `${row.am_first_name} ${row.am_last_name || ''}`.trim()
                         : null,
  accountManagerEmail: row.am_email || null,
  createdAt:           row.created_at,
  updatedAt:           row.updated_at,
});

// ─── Repository ──────────────────────────────────────────────────────────────

const customerRepository = {

  findAll: async () => {
    const { rows } = await db.query(
      `${TENANT_SELECT} ORDER BY c.created_at DESC`
    );
    return rows.map(mapRow);
  },

  findById: async (id) => {
    const { rows } = await db.query(
      `${TENANT_SELECT} WHERE c.id = $1`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  // Returns tenants whose account_manager_id (primary AM) matches this user.
  // Kept for backwards-compat; prefer findByIds via tenant_assignments for multi-AM.
  findByAccountManagerId: async (userId) => {
    const { rows } = await db.query(
      `${TENANT_SELECT} WHERE c.account_manager_id = $1 ORDER BY c.created_at DESC`,
      [userId]
    );
    return rows.map(mapRow);
  },

  // Fetch multiple tenants by their IDs in a single query.
  findByIds: async (ids) => {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await db.query(
      `${TENANT_SELECT} WHERE c.id IN (${placeholders}) ORDER BY c.created_at DESC`,
      ids
    );
    return rows.map(mapRow);
  },

  create: async (data) => {
    const { rows } = await db.query(
      `INSERT INTO customers
         (name, domain, industry, timezone, meeting_platform,
          status, account_manager_id, connected_calendars)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        data.name,
        data.domain           || null,
        data.industry         || 'Other',
        data.timezone         || 'UTC',
        data.meetingPlatform  || 'microsoft_teams',
        data.status           || 'active',
        data.accountManagerId || null,
        JSON.stringify(data.connectedCalendars || []),
      ]
    );
    logger.info(`Tenant created in DB: ${rows[0].id} — ${data.name}`);
    // Re-fetch with JOIN so the caller gets accountManagerName + accountManagerEmail.
    return customerRepository.findById(rows[0].id);
  },

  update: async (id, updates) => {
    const FIELD_MAP = {
      name:              'name',
      domain:            'domain',
      industry:          'industry',
      timezone:          'timezone',
      meetingPlatform:   'meeting_platform',
      status:            'status',
      accountManagerId:  'account_manager_id',
    };

    const setClauses = [];
    const values     = [];
    let   idx        = 1;

    for (const [key, col] of Object.entries(FIELD_MAP)) {
      if (updates[key] !== undefined) {
        setClauses.push(`${col} = $${idx++}`);
        values.push(updates[key]);
      }
    }

    if (updates.connectedCalendars !== undefined) {
      setClauses.push(`connected_calendars = $${idx++}`);
      values.push(JSON.stringify(updates.connectedCalendars));
    }

    if (setClauses.length === 0) {
      throw Object.assign(new Error('No valid fields to update'), { statusCode: 400 });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const { rowCount } = await db.query(
      `UPDATE customers SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      values
    );

    if (rowCount === 0) {
      throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
    }

    logger.info(`Tenant updated in DB: ${id}`);
    // Re-fetch with JOIN so the caller gets accountManagerName + accountManagerEmail.
    return customerRepository.findById(id);
  },

  connectCalendar: async (id, provider) => {
    const tenant = await customerRepository.findById(id);
    if (!tenant) throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
    const list = Array.from(new Set([...(tenant.connectedCalendars || []), provider]));
    return customerRepository.update(id, { connectedCalendars: list });
  },

  disconnectCalendar: async (id, provider) => {
    const tenant = await customerRepository.findById(id);
    if (!tenant) throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
    const list = (tenant.connectedCalendars || []).filter((p) => p !== provider);
    return customerRepository.update(id, { connectedCalendars: list });
  },

  delete: async (id) => {
    const { rowCount } = await db.query(`DELETE FROM customers WHERE id = $1`, [id]);
    if (rowCount === 0) {
      throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
    }
    logger.info(`Tenant deleted from DB: ${id}`);
  },
};

module.exports = customerRepository;
