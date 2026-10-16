'use strict';

const express    = require('express');
const router     = express.Router();
const aiController = require('../controllers/ai.controller');
const auth       = require('../middleware/auth.middleware');

// All routes inherit auth from app.js mount.
// Additional role guards applied per-route where needed.

// GET /api/ai/providers — returns Ollama status + installed model list
router.get('/providers', aiController.getProviders);

// POST /api/ai/analyze — SA + AM can trigger analysis
router.post('/analyze', aiController.analyze);

// GET /api/ai/recommendations — list (filtered by tenant access)
router.get('/recommendations', aiController.listRecommendations);

// GET /api/ai/recommendations/:id — single (tenant isolation enforced in service)
// Must be defined BEFORE /:id/approve and /:id/reject to avoid shadowing
router.get('/recommendations/:id', aiController.getRecommendation);

// PATCH /api/ai/recommendations/:id — edit pending recommendation (AM or SA only)
router.patch(
  '/recommendations/:id',
  auth.requireRole(['super_admin', 'account_manager']),
  aiController.updateRecommendation
);

// POST /api/ai/recommendations/:id/approve — AM or SA only
router.post(
  '/recommendations/:id/approve',
  auth.requireRole(['super_admin', 'account_manager']),
  aiController.approveRecommendation
);

// POST /api/ai/recommendations/:id/reject — AM or SA only
router.post(
  '/recommendations/:id/reject',
  auth.requireRole(['super_admin', 'account_manager']),
  aiController.rejectRecommendation
);

module.exports = router;
