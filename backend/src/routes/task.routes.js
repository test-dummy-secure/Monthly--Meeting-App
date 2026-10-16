const express = require('express');
const router = express.Router();
const meetingRepository = require('../repositories/meeting.repository');
const auth = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const { validate } = require('../middleware/validate');

router.use(auth, tenantMiddleware);

// GET /api/tasks/open — all open/active tasks for the tenant (used by Action Points tab)
router.get('/open', async (req, res, next) => {
  try {
    const tasks = await meetingRepository.findOpenTasksForTenant(req.tenantId);
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

// PUT /api/tasks/:taskId/status - Update task status
router.put('/:taskId/status', validate('taskStatus'), async (req, res, next) => {
  const { taskId } = req.params;
  const { approvalStatus, notes } = req.body;
  try {
    const updated = await meetingRepository.updateTaskStatus(taskId, approvalStatus, notes, req.tenantId);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/:taskId/push-clickup — re-enqueue ClickUp push for an approved task
// Safe to call multiple times — skips if already pushed (clickup_task_id exists)
router.post('/:taskId/push-clickup', async (req, res, next) => {
  const { taskId } = req.params;
  try {
    const db = require('../config/db');
    const { rows } = await db.query(
      `SELECT id, tenant_id, clickup_task_id
       FROM   tasks
       WHERE  id = $1 AND tenant_id = $2`,
      [taskId, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    if (rows[0].clickup_task_id) return res.json({ skipped: true, reason: 'Already pushed to ClickUp' });

    const { enqueueClickUpPush } = require('../jobs/clickup-push.job');
    await enqueueClickUpPush(taskId, req.tenantId);
    res.json({ queued: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/:taskId/sync-clickup — pull this one task's live status
// from ClickUp right now, instead of waiting for the next scheduled sweep.
// The direct fix for "an AM can't tell if a task is really missing from
// ClickUp or just showing stale data" — gives a live, on-demand answer.
router.post('/:taskId/sync-clickup', async (req, res, next) => {
  const { taskId } = req.params;
  try {
    const db = require('../config/db');
    const { rows } = await db.query(
      `SELECT id FROM tasks WHERE id = $1 AND tenant_id = $2 AND clickup_task_id IS NOT NULL`,
      [taskId, req.tenantId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Task not found, or not yet pushed to ClickUp' });
    }

    const clickupSyncJob = require('../jobs/clickup-sync.job');
    const result = await clickupSyncJob.runSync({ tenantId: req.tenantId, taskId });
    if (result.failed > 0) {
      return res.status(502).json({ error: 'Could not reach ClickUp to refresh this task — try again shortly' });
    }

    // Return the fresh values so the caller can update its display in place
    // instead of needing a full page reload to see the result.
    const { rows: fresh } = await db.query(
      `SELECT clickup_status AS "clickupStatus", clickup_url AS "clickupUrl",
              remediation_status AS "remediationStatus"
       FROM   tasks WHERE id = $1`,
      [taskId]
    );
    res.json({ synced: true, ...fresh[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/sync-clickup — pull live status for every task in the
// current tenant, on demand, instead of waiting for the scheduled sweep.
router.post('/sync-clickup', async (req, res, next) => {
  try {
    const clickupSyncJob = require('../jobs/clickup-sync.job');
    const result = await clickupSyncJob.runSync({ tenantId: req.tenantId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
