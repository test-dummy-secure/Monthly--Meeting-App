const logger = require('../utils/logger');

const ROLES = Object.freeze({
  SUPER_ADMIN:      'super_admin',
  ACCOUNT_MANAGER:  'account_manager',
});

// ─── requireRole(...roles) ────────────────────────────────────────────────────
// Factory that returns a middleware allowing only the listed roles.
// Usage:
//   router.delete('/:id', auth, requireRole('super_admin'), handler)
//   router.get('/',       auth, requireRole('super_admin', 'account_manager'), handler)

const requireRole = (...roles) => {
  const allowed = roles.flat(); // accept both requireRole('a','b') and requireRole(['a','b'])
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowed.includes(req.user.role)) {
      logger.warn('Role authorization denied', {
        email:    req.user.email,
        has:      req.user.role,
        requires: allowed,
        path:     req.originalUrl,
      });
      return res.status(403).json({ error: 'Access forbidden: insufficient role' });
    }
    next();
  };
};

// ─── Named shortcuts ──────────────────────────────────────────────────────────

// Only super_admin
const requireSuperAdmin = requireRole(ROLES.SUPER_ADMIN);

// account_manager OR super_admin (super_admin is always permitted to do what
// an AM can do — they're a superset).
const requireAccountManager = requireRole(ROLES.ACCOUNT_MANAGER, ROLES.SUPER_ADMIN);

module.exports = { requireRole, requireSuperAdmin, requireAccountManager, ROLES };
