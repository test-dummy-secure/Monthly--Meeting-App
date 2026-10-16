const express = require('express');
const router = express.Router();
const auditLogRepository = require('../repositories/audit-log.repository');
const auth = require('../middleware/auth.middleware');

router.use(auth);

// GET /api/audit-logs - List audit logs
router.get('/', async (req, res, next) => {
  try {
    const list = await auditLogRepository.findAll();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
