const express = require('express');
const router = express.Router();
const customerRepository = require('../repositories/customer.repository');
const auditLogRepository = require('../repositories/audit-log.repository');
const auth = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');

router.use(auth, tenantMiddleware);

// POST /api/integrations/connect - Connect calendar
router.post('/connect', async (req, res, next) => {
  const { provider, email } = req.body;
  try {
    const updated = await customerRepository.connectCalendar(req.tenantId, provider);
    await auditLogRepository.create(req.tenantId, req.user.email, 'Calendar Connection Created', { provider, email });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/integrations/disconnect - Disconnect calendar
router.post('/disconnect', async (req, res, next) => {
  const { provider } = req.body;
  try {
    const updated = await customerRepository.disconnectCalendar(req.tenantId, provider);
    await auditLogRepository.create(req.tenantId, req.user.email, 'Calendar Connection Revoked', { provider });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
