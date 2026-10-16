const logger = require('../utils/logger');

// ─── Permission registry ──────────────────────────────────────────────────────
// Maps permission string → roles that are granted it.
// super_admin is explicitly included on every AM-level permission so a single
// check is sufficient — callers never need to add super_admin as a fallback.

const PERMISSIONS = Object.freeze({
  // Tenant management
  'tenant:read':           ['super_admin', 'account_manager'],
  'tenant:write':          ['super_admin'],
  'tenant:delete':         ['super_admin'],
  'tenant:assign_manager': ['super_admin'],

  // User management
  'user:read':             ['super_admin'],
  'user:write':            ['super_admin'],
  'user:deactivate':       ['super_admin'],

  // Meetings
  'meeting:read':          ['super_admin', 'account_manager'],
  'meeting:write':         ['super_admin', 'account_manager'],
  'meeting:delete':        ['super_admin'],

  // Tasks
  'task:read':             ['super_admin', 'account_manager'],
  'task:write':            ['super_admin', 'account_manager'],
  'task:delete':           ['super_admin'],

  // Weekly tracker / review outcomes
  'review_outcome:write':  ['super_admin', 'account_manager'],

  // Escalations
  'escalation:read':       ['super_admin', 'account_manager'],
  'escalation:write':      ['super_admin', 'account_manager'],

  // Reports
  'report:read':           ['super_admin', 'account_manager'],
  'report:generate':       ['super_admin', 'account_manager'],

  // AI recommendations — AM must explicitly approve before anything publishes
  'ai:read':               ['super_admin', 'account_manager'],
  'ai:approve':            ['super_admin', 'account_manager'],
  'ai:reject':             ['super_admin', 'account_manager'],

  // Integrations
  'integration:read':      ['super_admin', 'account_manager'],
  'integration:write':     ['super_admin'],

  // Audit logs
  'audit:read':            ['super_admin'],
});

// ─── requirePermission(permission) ───────────────────────────────────────────
// Factory that returns a middleware enforcing the given permission.
// Must be placed after authMiddleware so req.user is populated.
// Usage:
//   router.post('/approve', auth, requirePermission('ai:approve'), handler)

const requirePermission = (permission) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const allowedRoles = PERMISSIONS[permission];

  if (!allowedRoles) {
    logger.error('requirePermission: unknown permission key', { permission });
    return res.status(500).json({ error: 'Permission configuration error' });
  }

  if (!allowedRoles.includes(req.user.role)) {
    logger.warn('Permission denied', {
      email:      req.user.email,
      role:       req.user.role,
      permission,
      path:       req.originalUrl,
    });
    return res.status(403).json({
      error: `Access forbidden: requires '${permission}' permission`,
    });
  }

  next();
};

module.exports = { requirePermission, PERMISSIONS };
