const tenantService         = require('../services/tenant.service');
const auditLogRepository    = require('../repositories/audit-log.repository');
const logger                = require('../utils/logger');

// ─── TenantController ─────────────────────────────────────────────────────────
// Thin HTTP layer — no business logic.
// All decisions live in tenantService.

const tenantController = {

  // GET /api/tenants
  list: async (req, res, next) => {
    try {
      const tenants = await tenantService.list(req.user);
      res.json(tenants);
    } catch (err) {
      logger.error('tenantController.list', { error: err.message });
      next(err);
    }
  },

  // GET /api/tenants/:id
  getById: async (req, res, next) => {
    try {
      const tenant = await tenantService.getById(req.user, req.params.id);
      res.json(tenant);
    } catch (err) {
      logger.error('tenantController.getById', { error: err.message, id: req.params.id });
      next(err);
    }
  },

  // POST /api/tenants
  create: async (req, res, next) => {
    try {
      const tenant = await tenantService.create(req.user, req.body);
      auditLogRepository.create(
        tenant.id, req.user.email, 'Tenant Created', { name: tenant.name }, req.ip
      ).catch(() => {});
      res.status(201).json(tenant);
    } catch (err) {
      logger.error('tenantController.create', { error: err.message });
      next(err);
    }
  },

  // PUT /api/tenants/:id
  update: async (req, res, next) => {
    try {
      const tenant = await tenantService.update(req.user, req.params.id, req.body);
      auditLogRepository.create(
        req.params.id, req.user.email, 'Tenant Updated', req.body, req.ip
      ).catch(() => {});
      res.json(tenant);
    } catch (err) {
      logger.error('tenantController.update', { error: err.message, id: req.params.id });
      next(err);
    }
  },

  // POST /api/tenants/validate
  validate: async (req, res, next) => {
    try {
      const { nxg360TenantId, apiKey } = req.body;
      if (!nxg360TenantId || !apiKey) {
        return res.status(400).json({ error: 'nxg360TenantId and apiKey are required' });
      }
      const result = await tenantService.validateNXG360(nxg360TenantId, apiKey);
      res.json(result);
    } catch (err) {
      logger.error('tenantController.validate', { error: err.message });
      next(err);
    }
  },

  // GET /api/tenants/:id/findings
  getFindings: async (req, res, next) => {
    try {
      const result = await tenantService.getFindings(req.user, req.params.id);
      res.json(result);
    } catch (err) {
      logger.error('tenantController.getFindings', { error: err.message, id: req.params.id });
      next(err);
    }
  },
};

module.exports = tenantController;
