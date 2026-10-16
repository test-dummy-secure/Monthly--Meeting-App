const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const JourneyService = require('../services/journey.service');

router.use(auth, tenantMiddleware);

// GET /api/analytics - Get security metrics
router.get('/', async (req, res, next) => {
  try {
    const summary = await JourneyService.getDashboardSummary({
      user: req.user,
      tenantId: req.tenantId
    });

    res.json(summary);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
