'use strict';

const { Queue, Worker } = require('bullmq');
const { connection }    = require('../config/bullmq');
const db                = require('../config/db');
const { decrypt }       = require('../utils/encryption');
const ClickUpClient     = require('../integrations/clickup/ClickUpClient');
const clickupRepo       = require('../repositories/clickup-connection.repository');
const logger            = require('../utils/logger');

const QUEUE_NAME = 'clickup-push';

const clickupPushQueue = new Queue(QUEUE_NAME, { connection });

let _worker = null;

async function start() {
  _worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { taskId, tenantId } = job.data;
      logger.info('ClickUp push: processing', { taskId, tenantId });

      const conn = await clickupRepo.get();
      if (!conn || conn.status !== 'connected') {
        logger.warn('ClickUp push: no active connection — skipping', { taskId });
        return;
      }

      const mapping = await clickupRepo.getFolderMapping(tenantId);
      if (!mapping) {
        logger.warn('ClickUp push: no folder mapping for tenant — skipping', { taskId, tenantId });
        return;
      }

      // Load task from DB
      const { rows } = await db.query(
        `SELECT id, title, action_plan, due_date, owner_name,
                category, severity, clickup_task_id
         FROM   tasks
         WHERE  id = $1 AND tenant_id = $2`,
        [taskId, tenantId]
      );
      if (rows.length === 0) {
        logger.warn('ClickUp push: task not found', { taskId, tenantId });
        return;
      }
      const task = rows[0];

      if (task.clickup_task_id) {
        logger.info('ClickUp push: already pushed, skipping', { taskId });
        return;
      }

      const apiKey      = decrypt(conn.api_key_enc);
      const client      = new ClickUpClient(apiKey);
      const clickupTask = await client.createTask(mapping.list_id, {
        title:      task.title,
        actionPlan: task.action_plan,
        dueDate:    task.due_date,
        owner:      task.owner_name,
        category:   task.category,
        severity:   task.severity,
      });

      await db.query(
        `UPDATE tasks
         SET    clickup_task_id   = $1,
                clickup_url       = $2,
                clickup_status    = 'to do',
                clickup_synced_at = NOW(),
                last_updated_at   = NOW()
         WHERE  id = $3`,
        [clickupTask.id, clickupTask.url, taskId]
      );

      logger.info('ClickUp push: task created in ClickUp', {
        taskId, tenantId, clickupTaskId: clickupTask.id, clickupUrl: clickupTask.url,
      });
    },
    { connection, concurrency: 3 }
  );

  _worker.on('failed', (job, err) => {
    logger.error('ClickUp push job failed', { jobId: job?.id, error: err.message });
  });

  logger.info('ClickUp push worker started');
}

async function stop() {
  if (_worker) await _worker.close();
}

async function enqueueClickUpPush(taskId, tenantId) {
  await clickupPushQueue.add(
    'push-task',
    { taskId, tenantId },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );
  logger.info('ClickUp push: job enqueued', { taskId, tenantId });
}

module.exports = { start, stop, enqueueClickUpPush };
