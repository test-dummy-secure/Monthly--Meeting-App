// backend/src/routes/findings.js
const express = require('express');
const router = express.Router();
const { getAllFindings, getFindingById, getAITasksForFinding } = require('../controllers/findingsController');

// GET /api/findings - list all findings with optional filters
router.get('/', getAllFindings);

// GET /api/findings/:id - single finding detail
router.get('/:id', getFindingById);

// GET /api/findings/:id/ai-tasks - AI remediation tasks for a finding
router.get('/:id/ai-tasks', getAITasksForFinding);

module.exports = router;
