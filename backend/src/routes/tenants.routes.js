const express          = require('express');
const router           = express.Router();
const auth             = require('../middleware/auth.middleware');
const tenantController = require('../controllers/tenant.controller');

// Note: authMiddleware is applied at the app level (app.js).
// Route-level middlewares here are for role checks only.

// GET /api/tenants — list tenants (role-scoped: SA = all, AM = assigned only)
router.get('/', tenantController.list);

// POST /api/tenants/validate — validate NXG360 credentials (Super Admin only)
// Must be defined before /:id to avoid being caught by the dynamic param.
router.post('/validate', auth.requireRole(['super_admin']), tenantController.validate);

// GET /api/tenants/:id — single tenant (access-checked per role)
router.get('/:id', tenantController.getById);

// POST /api/tenants — create tenant with optional NXG360 integration (Super Admin only)
router.post('/', auth.requireRole(['super_admin']), tenantController.create);

// PUT /api/tenants/:id — update tenant fields (Super Admin only)
router.put('/:id', auth.requireRole(['super_admin']), tenantController.update);

// GET /api/tenants/:id/findings — live NXG360 findings (role-scoped access check inside service)
router.get('/:id/findings', tenantController.getFindings);

module.exports = router;
