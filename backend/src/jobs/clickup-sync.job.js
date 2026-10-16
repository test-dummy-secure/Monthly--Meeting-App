'use strict';

const { Queue, Worker } = require('bullmq');
const { connection }    = require('../config/bullmq');
const db                = require('../config/db');
const { decrypt }       = require('../utils/encryption');
const ClickUpClient     = require('../integrations/clickup/ClickUpClient');
const clickupRepo       = require('../repositories/clickup-connection.repository');
const logger            = require('../utils/logger');

const QUEUE_NAME    = 'clickup-sync';
const INTERVAL_MS   = 30 * 60 * 1000; // 30 minutes

const clickupSyncQueue = new Queue(QUEUE_NAME, { connection });

let _worker = null;

// Pulls one task's live status from ClickUp and mirrors it into our DB —
// the actual per-task work, factored out so both the bulk sweep below and
// an on-demand single-task refresh call the exact same logic.
async function syncOneTask(client, task) {
  const cu = await client.getTask(task.clickup_task_id);

  await db.query(
    `UPDATE tasks
     SET    clickup_status    = $1,
            clickup_synced_at = NOW(),
            last_updated_at   = NOW()
     WHERE  id = $2`,
    [cu.status, task.id]
  );

  // Auto-mirror ClickUp's terminal states into remediation_status so an
  // AM never has to set the same status twice in two systems. Matches
  // several real-world synonyms for "done" — ClickUp lists commonly use
  // 'complete', 'completed', 'done', or 'closed' depending on how the
  // list was set up, and a bare 'complete' check alone silently matched
  // none of this tenant's real statuses (confirmed live: this org's
  // ClickUp list uses 'completed'). Also had `updated_at` — a column
  // that doesn't exist on tasks (only last_updated_at does), so even a
  // matching status would have thrown here every time.
  const cuStatus = cu.status?.toLowerCase();
  if (['complete', 'completed', 'done', 'closed'].includes(cuStatus)) {
    await db.query(
      `UPDATE tasks
       SET    remediation_status = 'completed', last_updated_at = NOW()
       WHERE  id = $1
         AND  remediation_status NOT IN ('completed', 'closed')`,
      [task.id]
    );
  } else if (cuStatus === 'blocked') {
    await db.query(
      `UPDATE tasks
       SET    remediation_status = 'blocked', last_updated_at = NOW()
       WHERE  id = $1
         AND  remediation_status NOT IN ('completed', 'closed', 'blocked')`,
      [task.id]
    );
  }

  return cu;
}

// Optional filters make this one function serve three callers with the
// identical logic: the scheduled sweep (no filter — every tenant, every
// task), an on-demand tenant-wide "sync now" (tenantId), and an on-demand
// single-task refresh (taskId) — e.g. an AM asking "is this task really
// missing from ClickUp?" gets a live answer instead of waiting up to
// INTERVAL_MS for the next scheduled pass. Purely additive: no tenant or
// task is special-cased anywhere here.
async function runSync({ tenantId, taskId } = {}) {
  const conn = await clickupRepo.get();
  if (!conn || conn.status !== 'connected') {
    logger.info('ClickUp sync: no active connection — skipping');
    return { synced: 0, failed: 0, total: 0 };
  }

  const conditions = ['clickup_task_id IS NOT NULL'];
  const params = [];
  if (tenantId) { params.push(tenantId); conditions.push(`tenant_id = $${params.length}`); }
  if (taskId)   { params.push(taskId);   conditions.push(`id = $${params.length}`); }
  // Bulk syncs (scheduled or tenant-wide) skip already-terminal tasks as an
  // optimization — no point re-checking something already closed. An
  // explicit single-task request always checks live regardless of our
  // stored status, since that's exactly what "is this really there?" needs.
  if (!taskId) conditions.push(`remediation_status NOT IN ('closed', 'completed')`);

  const { rows: tasks } = await db.query(
    `SELECT id, tenant_id, clickup_task_id, due_date
     FROM   tasks
     WHERE  ${conditions.join(' AND ')}`,
    params
  );

  if (tasks.length === 0) {
    logger.info('ClickUp sync: no tasks to sync', { tenantId, taskId });
    return { synced: 0, failed: 0, total: 0 };
  }

  const apiKey = decrypt(conn.api_key_enc);
  const client = new ClickUpClient(apiKey);
  let synced = 0;
  let failed = 0;

  for (const task of tasks) {
    try {
      await syncOneTask(client, task);
      synced++;
    } catch (err) {
      logger.warn('ClickUp sync: failed to fetch task status', {
        taskId: task.id, clickupTaskId: task.clickup_task_id, error: err.message,
      });
      failed++;
    }
  }

  logger.info('ClickUp sync: complete', { synced, failed, total: tasks.length, tenantId, taskId });
  return { synced, failed, total: tasks.length };
}

async function start() {
  _worker = new Worker(
    QUEUE_NAME,
    async () => { await runSync(); },
    { connection, concurrency: 1 }
  );

  _worker.on('failed', (job, err) => {
    logger.error('ClickUp sync job failed', { jobId: job?.id, error: err.message });
  });

  await clickupSyncQueue.upsertJobScheduler(
    'clickup-sync-cron',
    { every: INTERVAL_MS },
    { name: 'sync', data: {}, opts: { attempts: 2 } }
  );

  logger.info('ClickUp sync job started (every 30 minutes)'); // was logging "6 hours" — didn't match INTERVAL_MS above
}

async function stop() {
  if (_worker) await _worker.close();
}

module.exports = { start, stop, runSync };
