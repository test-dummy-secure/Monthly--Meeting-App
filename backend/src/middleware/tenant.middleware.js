const logger = require('../utils/logger');
const tenantAccessService = require('../services/tenantAccess.service');

// Middleware to isolate and validate multi-tenant queries
const tenantMiddleware = async (req, res, next) => {
  try {
    const requestedTenantId = req.headers['x-tenant-id'] || req.query.tenantId || req.body?.tenantId;
    const accessibleTenantIds = await tenantAccessService.getAccessibleTenantIds(req.user);
    const tenantId = await tenantAccessService.resolveTenantId(req.user, requestedTenantId);

    req.accessibleTenantIds = accessibleTenantIds;
    req.tenantId = tenantId;
    req.tenantFilter = tenantId ? { tenantId } : {};

    next();
  } catch (error) {
    logger.warn('Tenant middleware blocked request', {
      error: error.message,
      userEmail: req.user?.email,
      requestedTenantId: req.headers['x-tenant-id'] || req.query.tenantId || req.body?.tenantId
    });
    return res.status(error.statusCode || 403).json({ error: error.message || 'Tenant access denied' });
  }
};

module.exports = tenantMiddleware;
