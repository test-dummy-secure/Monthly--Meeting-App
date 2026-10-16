'use strict';

const db                          = require('../config/db');
const taskRepository              = require('../repositories/task.repository');
const escalationRepository        = require('../repositories/escalation.repository');
const aiRecommendationRepository  = require('../repositories/ai-recommendation.repository');
const { resolveRecipients,
        notifyEscalation }        = require('../services/notification.service');
const logger                      = require('../utils/logger');

const CARRY_FORWARD_ESCALATION_THRESHOLD = 3; // auto-escalate after this many consecutive carry-forwards

// How far back to keep retrying a failed report email before giving up.
// Bounded so a permanently-bad address doesn't get hammered forever — after
// this window it simply stops being picked up by the query below.
const FAILED_REPORT_RETRY_WINDOW_DAYS = 7;

// Run every hour (3 600 000 ms). Kept as a named constant so it's easy to tune.
const INTERVAL_MS = 60 * 60 * 1000;

let _timer = null;

// Auto-approves pending pre_meeting recommendations for conducted meetings that
// have had no completed notes for more than 7 days (grace period).
// Creates a tracker task for each auto-approved recommendation.
async function autoApproveStalePremeetingRecs() {
  const { rows: staleMeetings } = await db.query(
    `SELECT m.id, m.tenant_id
     FROM   meetings m
     WHERE  m.status          = 'conducted'
       AND  m.scheduled_start < NOW() - INTERVAL '7 days'
       AND  COALESCE(m.notes_status, '') != 'completed'
       AND  NOT EXISTS (
              SELECT 1 FROM meeting_notes mn
              WHERE  mn.meeting_id = m.id AND mn.ai_status = 'completed'
            )`,
    []
  );

  if (staleMeetings.length === 0) return;

  logger.info('Overdue job: found stale conducted meetings for pre-meeting rec auto-approval', {
    count: staleMeetings.length,
  });

  for (const meeting of staleMeetings) {
    const { rows: pendingRecs } = await db.query(
      `SELECT id FROM ai_task_recommendations
       WHERE  meeting_id      = $1
         AND  tenant_id       = $2
         AND  analysis_type   = 'pre_meeting'
         AND  approval_status = 'pending'`,
      [meeting.id, meeting.tenant_id]
    );

    for (const recRow of pendingRecs) {
      try {
        const rec  = await aiRecommendationRepository.approve(
          recRow.id,
          'System Auto-Approve (7-day grace period)',
          meeting.tenant_id
        );
        const task = await taskRepository.createFromRecommendation(rec);
        logger.info('Overdue job: pre-meeting rec auto-approved', {
          recommendationId: recRow.id,
          meetingId:        meeting.id,
          taskId:           task.id,
        });
      } catch (recErr) {
        logger.error('Overdue job: failed to auto-approve recommendation', {
          recommendationId: recRow.id,
          meetingId:        meeting.id,
          error:            recErr.message,
        });
      }
    }
  }
}

// Auto-escalates tasks that have been carried forward >= THRESHOLD times
// without resolution. Skips tasks that already have an open escalation so
// re-runs are idempotent. Splits owner_type so notifications can be routed
// to the right side (AM vs customer) in Phase 2.
async function autoEscalateCarryForwardTasks() {
  const { rows: candidates } = await db.query(
    `SELECT t.id,
            t.tenant_id           AS "tenantId",
            t.title,
            t.owner_type          AS "ownerType",
            t.owner_email         AS "ownerEmail",
            t.owner_name          AS "ownerName",
            t.carry_forward_count AS "carryForwardCount",
            t.priority
     FROM   tasks t
     WHERE  t.carry_forward_count >= $1
       AND  t.remediation_status  IN ('carry_forward', 'escalated')
       AND  t.approval_status      = 'approved'
       AND  NOT EXISTS (
              SELECT 1 FROM escalations e
              WHERE  e.task_id = t.id
                AND  e.status IN ('open', 'acknowledged')
            )`,
    [CARRY_FORWARD_ESCALATION_THRESHOLD]
  );

  if (candidates.length === 0) return;

  logger.info('Overdue job: carry-forward threshold reached — auto-escalating', {
    count: candidates.length,
    threshold: CARRY_FORWARD_ESCALATION_THRESHOLD,
  });

  // Resolve AM + super_admin emails once per unique tenant — not once per task (Gap 3 fix)
  const uniqueTenantIds = [...new Set(candidates.map((t) => t.tenantId))];
  const recipientMap = {};
  await Promise.all(
    uniqueTenantIds.map(async (tid) => {
      try {
        recipientMap[tid] = await resolveRecipients(tid);
      } catch (err) {
        logger.warn('Overdue job: could not resolve recipients for tenant', {
          tenantId: tid, error: err.message,
        });
        recipientMap[tid] = { amEmail: null, superAdminEmail: null };
      }
    })
  );

  for (const task of candidates) {
    try {
      const { amEmail, superAdminEmail } = recipientMap[task.tenantId] || {};

      // Escalation stops at the primary AM — this app's two-role model
      // (super_admin / account_manager) has no tier above the primary AM for
      // account service delivery; super_admin is scoped to onboarding/
      // offboarding and integrations, and typically isn't even integrated
      // into a given tenant's M365, so routing a stuck task there wouldn't
      // give them any way to actually act on it.
      //
      // - CUSTOMER / SHARED task → primary AM (unchanged).
      // - A non-primary AM's own task → primary AM (new: previously went to
      //   super_admin regardless of which AM owned it).
      // - The primary AM's OWN task → no external recipient. There's no one
      //   left to hand it to; the task's 'escalated' status (set below by
      //   triggerEscalation, independent of escalatedTo) is the visible flag.
      const isPrimaryAMsOwnTask = task.ownerType === 'ACCOUNT_MANAGER'
        && task.ownerEmail && amEmail
        && task.ownerEmail.toLowerCase() === amEmail.toLowerCase();

      const escalatedTo = isPrimaryAMsOwnTask ? null : (amEmail || null);

      const reason = `Auto-escalated by system: task carried forward ${task.carryForwardCount} consecutive meetings without resolution.`;

      // 1. Write escalation record with correct escalatedTo
      await escalationRepository.create({
        taskId:      task.id,
        tenantId:    task.tenantId,
        escalatedBy: 'system@bmmj.internal',
        escalatedTo,
        reason,
        blockerType: 'recurring_unresolved',
      });

      // 2. Update task: status → escalated, escalation_count++, escalation_history JSONB
      await taskRepository.triggerEscalation(task.id, {
        blockerType:      'recurring_unresolved',
        escalationReason: reason,
        escalatedBy:      'System Auto-Escalation',
        notifyContact:    escalatedTo || '',
        tenantId:         task.tenantId,
      });

      // 3. Timeline entry
      await taskRepository.appendTimelineEvent(task.id, {
        id:    `evt-auto-esc-${Date.now()}-${task.id.slice(0, 8)}`,
        date:  new Date().toISOString(),
        event: `Auto-escalated after ${task.carryForwardCount} carry-forwards (threshold: ${CARRY_FORWARD_ESCALATION_THRESHOLD})`,
        actor: 'system@bmmj.internal',
        type:  'auto_escalation',
      });

      // 4. Notifications — fire-and-forget, one failing must not block other tasks
      notifyEscalation({ tenantId: task.tenantId, taskId: task.id, task, amEmail, superAdminEmail })
        .catch((err) => logger.warn('Overdue job: escalation notification failed', {
          taskId: task.id, error: err.message,
        }));

      logger.info('Overdue job: task auto-escalated', {
        taskId:            task.id,
        tenantId:          task.tenantId,
        title:             task.title,
        ownerType:         task.ownerType,
        escalatedTo,
        carryForwardCount: task.carryForwardCount,
      });

    } catch (taskErr) {
      logger.error('Overdue job: failed to auto-escalate task', {
        taskId: task.id,
        error:  taskErr.message,
      });
    }
  }
}

// Automatically re-sends weekly/monthly report emails that failed to deliver
// the first time — e.g. an SMTP hiccup or Redis blip when the report job
// originally tried to queue them. Runs every hour (piggybacking on this job's
// existing schedule), so a report notification gets many chances to go out
// instead of permanently failing after one exhausted retry budget.
//
// Re-queues through the SAME worker (email.job.js's processNotificationEmail)
// the original send used — NOT a direct emailService.send() with the generic
// notification-retry.html template. That generic template only renders a bare
// title + one-line body with no branding beyond the header, which is a real,
// visible downgrade from each type's actual template (e.g. weekly-report.html's
// full stat cards and explainer text) — re-queuing reuses the real per-type
// template + variables instead of a worse stand-in for it.
async function autoRetryFailedReportNotifications() {
  const { rows: failed } = await db.query(
    `SELECT id, recipient_email AS "recipientEmail"
     FROM   notifications
     WHERE  status  = 'failed'
       AND  type IN ('weekly_report_generated', 'monthly_report_generated')
       AND  created_at >= NOW() - INTERVAL '${FAILED_REPORT_RETRY_WINDOW_DAYS} days'
       AND  recipient_email IS NOT NULL`,
    []
  );

  if (failed.length === 0) return;

  logger.info('Overdue job: retrying failed report notifications', { count: failed.length });

  const emailQueue = require('../queues/email.queue');
  let requeued = 0;
  for (const notif of failed) {
    try {
      // Unique jobId per attempt — the original send's jobId (`notif-${id}`)
      // may still be sitting in the queue's failed set (removeOnFail keeps the
      // last 500), which would silently no-op a re-add using that same id.
      await emailQueue.add(
        'notification-email',
        { jobType: 'notification', notificationId: notif.id },
        { jobId: `notif-retry-${notif.id}-${Date.now()}` }
      );
      requeued++;
      logger.info('Overdue job: report notification re-queued for retry', {
        notificationId: notif.id, to: notif.recipientEmail,
      });
    } catch (sendErr) {
      // Still failed — leave status as 'failed' so it's picked up again next
      // hour (within the retry window) or retried manually in the meantime.
      logger.warn('Overdue job: report notification auto-retry failed again', {
        notificationId: notif.id, to: notif.recipientEmail, error: sendErr.message,
      });
    }
  }

  logger.info('Overdue job: report notification retry sweep complete', {
    attempted: failed.length, requeued,
  });
}

async function runOnce() {
  try {
    const affected = await taskRepository.markOverdueTasks();
    if (affected.length > 0) {
      logger.info('Overdue job: tasks marked overdue', { count: affected.length });
    }
  } catch (err) {
    logger.error('Overdue job error', { error: err.message, stack: err.stack });
  }

  try {
    await autoApproveStalePremeetingRecs();
  } catch (err) {
    logger.error('Overdue job: auto-approve stale recs error', { error: err.message, stack: err.stack });
  }

  try {
    await autoEscalateCarryForwardTasks();
  } catch (err) {
    logger.error('Overdue job: auto-escalate carry-forward error', { error: err.message, stack: err.stack });
  }

  try {
    await autoRetryFailedReportNotifications();
  } catch (err) {
    logger.error('Overdue job: report notification retry sweep error', { error: err.message, stack: err.stack });
  }
}

function start() {
  if (_timer) return; // already running

  // Fire immediately on startup, then on every interval
  runOnce();
  _timer = setInterval(runOnce, INTERVAL_MS);
  _timer.unref(); // prevent the interval from keeping the process alive during tests
  logger.info('Overdue detection job started', { intervalMs: INTERVAL_MS });
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info('Overdue detection job stopped');
  }
}

module.exports = { start, stop };
