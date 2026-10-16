const express = require('express');
const router = express.Router();
const JourneyService = require('../services/journey.service');
const auth = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const logger = require('../utils/logger');

router.use(auth, tenantMiddleware);

router.get('/summary', async (req, res, next) => {
  try {
    const summary = await JourneyService.listTrackerTasks({
      user: req.user,
      tenantId: req.tenantId,
      filters: {
        severity: req.query.severity,
        status: req.query.status,
        ownershipTeam: req.query.ownershipTeam,
        customer: req.query.customer,
        search: req.query.search
      },
      page: toNumber(req.query.page, 1),
      pageSize: Math.min(toNumber(req.query.pageSize, 20), 100)
    });

    res.json(summary);
  } catch (error) {
    logger.error('Tracker summary request failed', { error: error.message, stack: error.stack });
    next(error);
  }
});

router.get('/tasks', async (req, res, next) => {
  try {
    const result = await JourneyService.listTrackerTasks({
      user: req.user,
      tenantId: req.tenantId,
      filters: {
        severity: req.query.severity,
        status: req.query.status,
        ownershipTeam: req.query.ownershipTeam,
        customer: req.query.customer,
        search: req.query.search
      },
      page: toNumber(req.query.page, 1),
      pageSize: Math.min(toNumber(req.query.pageSize, 20), 100)
    });

    res.json(result);
  } catch (error) {
    logger.error('Tracker task list failed', { error: error.message, stack: error.stack });
    next(error);
  }
});

router.get('/tasks/:taskId', async (req, res, next) => {
  try {
    const task = await JourneyService.getTaskById({ user: req.user, taskId: req.params.taskId });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    logger.error('Tracker task detail failed', { error: error.message, stack: error.stack });
    next(error);
  }
});

const VALID_TASK_STATUSES = [
  'open', 'in_progress', 'awaiting_validation',
  'completed', 'carry_forward', 'escalated', 'overdue', 'blocked',
];
const VALID_REVIEW_OUTCOMES = [
  'on_track', 'customer_dependency', 'awaiting_approval', 'escalation_required',
];
const VALID_BLOCKER_TYPES = [
  'customer_dependency', 'resource_constraint', 'awaiting_approval', 'valid_delay',
];

// PATCH /api/tracker/tasks/:taskId — update progress, status, notes
router.patch('/tasks/:taskId', async (req, res, next) => {
  try {
    const { progressPercentage, status, notes } = req.body;

    if (progressPercentage !== undefined) {
      const pct = Number(progressPercentage);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ error: 'progressPercentage must be a number between 0 and 100' });
      }
    }
    if (status !== undefined && !VALID_TASK_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_TASK_STATUSES.join(', ')}` });
    }
    if (notes !== undefined && typeof notes !== 'string') {
      return res.status(400).json({ error: 'notes must be a string' });
    }

    const updated = await JourneyService.updateTask({
      user: req.user,
      taskId: req.params.taskId,
      progressPercentage,
      status,
      notes,
    });
    res.json(updated);
  } catch (err) {
    logger.error('Task update failed', { error: err.message });
    next(err);
  }
});

// POST /api/tracker/tasks/:taskId/review — save weekly review outcome
router.post('/tasks/:taskId/review', async (req, res, next) => {
  try {
    const { outcome, actorName } = req.body;
    if (!outcome) return res.status(400).json({ error: 'outcome is required' });
    if (!VALID_REVIEW_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: `outcome must be one of: ${VALID_REVIEW_OUTCOMES.join(', ')}` });
    }
    const updated = await JourneyService.saveReview({
      user: req.user,
      taskId: req.params.taskId,
      outcome,
      actorName: actorName || req.user.email,
    });
    res.json(updated);
  } catch (err) {
    logger.error('Review save failed', { error: err.message });
    next(err);
  }
});

// POST /api/tracker/tasks/:taskId/resolve-escalation — close an open escalation and return task to in_progress
router.post('/tasks/:taskId/resolve-escalation', async (req, res, next) => {
  try {
    const { resolutionNote } = req.body;
    const result = await JourneyService.resolveEscalation({
      user: req.user,
      taskId: req.params.taskId,
      resolutionNote,
    });
    res.json(result);
  } catch (err) {
    logger.error('Resolve escalation failed', { error: err.message });
    next(err);
  }
});

// POST /api/tracker/tasks/:taskId/escalate — trigger formal escalation
router.post('/tasks/:taskId/escalate', async (req, res, next) => {
  try {
    const { blockerType, reason, notifyContact } = req.body;
    if (!blockerType || !reason) {
      return res.status(400).json({ error: 'blockerType and reason are required' });
    }
    if (!VALID_BLOCKER_TYPES.includes(blockerType)) {
      return res.status(400).json({ error: `blockerType must be one of: ${VALID_BLOCKER_TYPES.join(', ')}` });
    }
    if (typeof reason !== 'string' || reason.trim().length < 10) {
      return res.status(400).json({ error: 'reason must be at least 10 characters' });
    }
    const updated = await JourneyService.triggerEscalation({
      user: req.user,
      taskId: req.params.taskId,
      blockerType,
      reason: reason.trim(),
      notifyContact,
    });
    res.json(updated);
  } catch (err) {
    logger.error('Escalation failed', { error: err.message });
    next(err);
  }
});

router.get('/customers/:tenantId/summary', async (req, res, next) => {
  try {
    const summary = await JourneyService.getCustomerTaskSummary({
      user: req.user,
      tenantId: req.params.tenantId
    });

    if (!summary) {
      return res.status(404).json({ error: 'Customer summary not found' });
    }

    res.json(summary);
  } catch (error) {
    logger.error('Customer task summary failed', { error: error.message, stack: error.stack });
    next(error);
  }
});

function toNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

module.exports = router;
