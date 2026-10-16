const jwt    = require('jsonwebtoken');
const logger = require('../utils/logger');
const { config } = require('../config/index');

// ─── Authentication middleware ────────────────────────────────────────────────
// Validates the Bearer access token on every protected route.
// Attaches req.user = { id, email, role, first_name, last_name, tenant_id }.

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7); // trim 'Bearer '

  let payload;
  try {
    payload = jwt.verify(token, config.jwtAccessSecret);
  } catch (err) {
    logger.warn('Access token invalid', { reason: err.message });
    return res.status(401).json({ error: 'Invalid or expired access token' });
  }

  // Prevent a refresh token from being used as an access token.
  if (payload.tokenType !== 'access') {
    logger.warn('Token type substitution attempt', {
      userId:    payload.id,
      tokenType: payload.tokenType,
    });
    return res.status(401).json({ error: 'Invalid token type' });
  }

  req.user = {
    id:         payload.id,
    email:      payload.email,
    role:       payload.role,
    first_name: payload.first_name,
    last_name:  payload.last_name,
    tenant_id:  payload.tenant_id,
  };

  next();
};

// ─── Inline role helper (kept for routes that already use auth.requireRole) ──
// New routes should prefer role.middleware.js — but this shim ensures zero
// call-site changes are required in existing routes.
authMiddleware.requireRole = (...roles) => (req, res, next) => {
  const allowed = Array.isArray(roles[0]) ? roles[0] : roles;
  if (!req.user || !allowed.includes(req.user.role)) {
    logger.warn('Role check failed', {
      email:    req.user?.email,
      has:      req.user?.role,
      requires: allowed,
    });
    return res.status(403).json({ error: 'Access forbidden: insufficient permissions' });
  }
  next();
};

module.exports = authMiddleware;
