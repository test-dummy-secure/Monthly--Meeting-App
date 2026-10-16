'use strict';

const db                        = require('../config/db');
const actionPointsEmailService  = require('../services/actionPointsEmail.service');
const logger                    = require('../utils/logger');

// Check every 6 hours — coarse enough to avoid hammering the DB, fine enough
// that a task due tomorrow is caught within the same day it becomes eligible.
const INTERVAL_MS = 6 * 60 * 60 * 1000;

let _timer = null;

// Atomically marks all un-notified tasks due in `daysLeft` days, then sends
// reminder emails. "Mark first, send second" ensures a crash between the two
// steps results in a missed email rather than a duplicate.
async function sendRemindersForDay(daysLeft) {
  const flagCol = daysLeft === 1 ? 'due_1d_reminder_sent' : 'due_2d_reminder_sent';

  // CTE: lock eligible rows, mark them, return full task details in one round-trip.
  // FOR UPDATE SKIP LOCKED means a concurrent job instance skips already-locked
  // rows instead of waiting, making re-runs and horizontal scaling safe.
  const { rows: tasks } = await db.query(
    `WITH locked AS (
       SELECT id FROM tasks
       WHERE  due_date::date          = CURRENT_DATE + INTERVAL '${daysLeft} days'
         AND  ${flagCol}              = FALSE
         AND  approval_status         = 'approved'
         AND  remediation_status NOT IN ('completed', 'closed')
       FOR UPDATE SKIP LOCKED
     ),
     flagged AS (
       UPDATE tasks
       SET    ${flagCol} = TRUE
       WHERE  id IN (SELECT id FROM locked)
       RETURNING id
     )
     SELECT
       t.id,
       t.tenant_id,
       t.title,
       t.action_plan,
       t.due_date,
       t.remediation_status,
       t.owner_name,
       c.name  AS customer_name,
       m.title AS meeting_title
     FROM   tasks t
     JOIN   flagged f ON f.id = t.id
     LEFT JOIN customers c ON c.id = t.tenant_id
     LEFT JOIN meetings  m ON m.id = t.meeting_id`
  );

  if (tasks.length === 0) return;

  logger.info(`Task due reminder job: found ${tasks.length} task(s) due in ${daysLeft} day(s)`);

  await actionPointsEmailService.sendTaskDueReminderBatch(tasks, daysLeft);
}

async function runOnce() {
  try {
    await sendRemindersForDay(2);
  } catch (err) {
    logger.error('Task due reminder job: T-2 error', { error: err.message, stack: err.stack });
  }

  try {
    await sendRemindersForDay(1);
  } catch (err) {
    logger.error('Task due reminder job: T-1 error', { error: err.message, stack: err.stack });
  }
}

function start() {
  if (_timer) return;

  runOnce();
  _timer = setInterval(runOnce, INTERVAL_MS);
  _timer.unref();
  logger.info('Task due reminder job started', { intervalMs: INTERVAL_MS });
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info('Task due reminder job stopped');
  }
}

module.exports = { start, stop };
