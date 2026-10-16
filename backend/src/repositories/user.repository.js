const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const db       = require('../database/index');
const { config } = require('../config/index');
const logger   = require('../utils/logger');

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Store a SHA-256 hash of the refresh token — never the raw JWT — so a DB
// breach cannot be replayed immediately.
const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

const mapUser = (row) => ({
  id:                   row.id,
  email:                row.email,
  password_hash:        row.password_hash,
  first_name:           row.first_name,
  last_name:            row.last_name,
  role:                 row.role,
  tenant_id:            row.tenant_id,
  is_active:            row.is_active,
  must_change_password: row.must_change_password || false,
  created_at:           row.created_at,
  updated_at:           row.updated_at,
});

// ─── Repository ──────────────────────────────────────────────────────────────

const userRepository = {

  // ── Lookups ────────────────────────────────────────────────────────────────

  findByEmail: async (email) => {
    const { rows } = await db.query(
      `SELECT * FROM users WHERE email = $1 AND is_active = true`,
      [email.toLowerCase().trim()]
    );
    return rows[0] ? mapUser(rows[0]) : null;
  },

  findById: async (id) => {
    const { rows } = await db.query(
      `SELECT * FROM users WHERE id = $1 AND is_active = true`,
      [id]
    );
    return rows[0] ? mapUser(rows[0]) : null;
  },

  listAll: async () => {
    const { rows } = await db.query(
      `SELECT id, email, first_name, last_name, role, tenant_id, is_active, created_at
       FROM users
       ORDER BY created_at ASC`
    );
    return rows.map(mapUser);
  },

  // ── Mutations ──────────────────────────────────────────────────────────────

  createUser: async ({ email, password, firstName, lastName, role, tenantId = null }) => {
    if (!['super_admin', 'account_manager'].includes(role)) {
      throw Object.assign(new Error(`Invalid role: ${role}`), { statusCode: 400 });
    }
    const password_hash = await bcrypt.hash(password, config.bcryptRounds);
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [email.toLowerCase().trim(), password_hash, firstName, lastName, role, tenantId || null]
    );
    logger.info(`User created in DB: ${email} (${role})`);
    return mapUser(rows[0]);
  },

  // ── Role-scoped queries ────────────────────────────────────────────────────

  // Returns all users with the given role regardless of is_active status.
  // Callers wanting active-only must filter themselves.
  findByRole: async (role) => {
    const { rows } = await db.query(
      `SELECT id, email, first_name, last_name, role, tenant_id, is_active, created_at, updated_at
       FROM users
       WHERE role = $1
       ORDER BY created_at ASC`,
      [role]
    );
    return rows.map(mapUser);
  },

  // Activate or deactivate a user.
  // Does NOT revoke tokens here — caller is responsible for revocation if
  // deactivating, so that it can be done in a single request context.
  setActiveStatus: async (id, isActive) => {
    const { rows } = await db.query(
      `UPDATE users
       SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, first_name, last_name, role, tenant_id, is_active, created_at, updated_at`,
      [isActive, id]
    );
    return rows[0] ? mapUser(rows[0]) : null;
  },

  // ── Refresh token management ───────────────────────────────────────────────

  saveRefreshToken: async (userId, rawToken, expiresAt) => {
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO NOTHING`,
      [userId, hashToken(rawToken), expiresAt]
    );
  },

  findRefreshToken: async (rawToken) => {
    const { rows } = await db.query(
      `SELECT id, user_id, token, expires_at, revoked
       FROM refresh_tokens
       WHERE token = $1
         AND revoked   = false
         AND expires_at > NOW()`,
      [hashToken(rawToken)]
    );
    if (!rows[0]) return null;
    return {
      token:      rows[0].token,
      user_id:    rows[0].user_id,
      expires_at: rows[0].expires_at,
      revoked:    rows[0].revoked,
    };
  },

  revokeRefreshToken: async (rawToken) => {
    await db.query(
      `UPDATE refresh_tokens SET revoked = true WHERE token = $1`,
      [hashToken(rawToken)]
    );
  },

  // Invalidates every active session for a user — used by super_admin revoke
  // and as a security measure when a password change is detected.
  revokeAllUserTokens: async (userId) => {
    const { rowCount } = await db.query(
      `UPDATE refresh_tokens SET revoked = true
       WHERE user_id = $1 AND revoked = false`,
      [userId]
    );
    logger.info(`Revoked ${rowCount} active tokens for user ${userId}`);
  },

  // Updates the user's password hash and immediately revokes all active sessions
  // so any stolen access is invalidated the moment a password reset completes.
  updatePassword: async (userId, newPasswordHash) => {
    await db.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newPasswordHash, userId]
    );
    await userRepository.revokeAllUserTokens(userId);
    logger.info(`Password updated and all sessions revoked for user ${userId}`);
  },

  // Sets or clears the must_change_password flag.
  // Pass true when Super Admin resets an AM's password so the AM is forced
  // to change it on next login. Pass false once the AM has done so.
  setMustChangePassword: async (userId, flag) => {
    await db.query(
      `UPDATE users SET must_change_password = $1, updated_at = NOW() WHERE id = $2`,
      [flag, userId]
    );
  },

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  // Bootstraps exactly one super_admin account so a fresh database is never
  // unreachable. In production the email/password come from
  // SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD (validated in config/validate.js
  // — startup throws before this ever runs if either is missing). In
  // development, falls back to a fixed convenience login so local setup
  // needs no extra config.
  //
  // account_manager accounts are intentionally NOT auto-seeded here — they
  // should be created deliberately by a super_admin via the UI, or by
  // `npm run seed` for demo data. Auto-creating manager logins with a shared
  // hardcoded password was a real credential-leak risk (the source is
  // public in the repo) and has been removed.
  ensureDefaultUsers: async () => {
    const isProd = process.env.NODE_ENV === 'production';

    const email    = isProd ? process.env.SUPER_ADMIN_EMAIL    : (process.env.SUPER_ADMIN_EMAIL    || 'admin@bmmj.com');
    const password = isProd ? process.env.SUPER_ADMIN_PASSWORD : (process.env.SUPER_ADMIN_PASSWORD || 'admin123');

    if (!email || !password) {
      // Only reachable in dev if someone unsets both env vars explicitly —
      // production is already guarded by validateConfig() before this runs.
      logger.warn('SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set — skipping default admin bootstrap');
      return;
    }

    const { rows } = await db.query(
      `SELECT id FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (rows.length === 0) {
      await userRepository.createUser({
        email,
        password,
        firstName: process.env.SUPER_ADMIN_FIRST_NAME || 'Super',
        lastName:  process.env.SUPER_ADMIN_LAST_NAME  || 'Admin',
        role: 'super_admin',
      });
      logger.info(`Seeded default super_admin: ${email}`);
    }
    logger.info('Default admin bootstrap complete');
  },
};

module.exports = userRepository;
