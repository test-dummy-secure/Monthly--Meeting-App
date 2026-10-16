'use strict';

const express = require('express');
const router = express.Router();
const JourneyService = require('../services/journey.service');
const auth = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const logger = require('../utils/logger');

router.use(auth, tenantMiddleware);

router.get('/dashboard', async (req, res, next) => {
  try {
    const data = await JourneyService.getMonitoringDashboard({
      user: req.user,
      tenantId: req.tenantId,
    });
    res.json(data);
  } catch (err) {
    logger.error('Monitoring dashboard failed', { error: err.message, stack: err.stack });
    next(err);
  }
});

module.exports = router;
