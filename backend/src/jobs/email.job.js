'use strict';

const { Worker }   = require('bullmq');
const { connection, onWorkerError } = require('../config/bullmq');
const emailQueue     = require('../queues/email.queue');
const logger         = require('../utils/logger');

// Notification type → template name mapping.
// Only types listed here produce an email — all others are in-app only.
const TYPE_TO_TEMPLATE = {
  carry_forward_warning:    'carry-forward',
  carry_forward_alert:      'carry-forward',
  auto_escalation_assigned: 'escalation',
  auto_escalation_notice:   'escalation',
  weekly_report_generated:  'weekly-report',
  monthly_report_generated: 'weekly-report',
};

// ── Job processors ─────────────────────────────────────────────────────────

async function processNotificationEmail({ notificationId }) {
  const db           = require('../config/db');
  const emailService = require('../services/email.service');

  const { rows } = await db.query(
    `SELECT n.*,
            c.name AS tenant_name,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS recipient_name_resolved,
            t.title AS task_title
     FROM   notifications n
     LEFT   JOIN customers c ON c.id = n.tenant_id
     LEFT   JOIN users     u ON LOWER(u.email) = LOWER(n.recipient_email)
     LEFT   JOIN tasks     t ON t.id = n.task_id
     WHERE  n.id = $1`,
    [notificationId]
  );

  if (!rows[0]) {
    logger.warn('email.job: notification not found', { notificationId });
    return;
  }

  const notif    = rows[0];
  const template = TYPE_TO_TEMPLATE[notif.type];

  if (!template) {
    // No email template for this type — mark delivered and skip.
    await db.query(
      `UPDATE notifications SET status = 'delivered', delivered_at = NOW() WHERE id = $1`,
      [notificationId]
    );
    return;
  }

  const payload       = typeof notif.payload === 'string'
    ? JSON.parse(notif.payload)
    : (notif.payload || {});
  const recipientName = notif.recipient_name_resolved
    || (notif.recipient_email ? notif.recipient_email.split('@')[0] : 'User');

  const vars = buildNotificationVars(notif, payload, recipientName);

  await emailService.send({
    to:           notif.recipient_email,
    subject:      notif.title,
    templateName: template,
    vars,
  });

  await db.query(
    `UPDATE notifications SET status = 'delivered', delivered_at = NOW() WHERE id = $1`,
    [notificationId]
  );
}

function buildNotificationVars(notif, payload, recipientName) {
  const base = {
    recipientName,
    tenantName: notif.tenant_name || '',
  };

  switch (notif.type) {
    case 'carry_forward_warning':
      return {
        ...base,
        taskTitle:         notif.task_title || '',
        carryForwardCount: String(payload.carryForwardCount ?? 2),
        alertLevel:        'Warning',
        message:           notif.body || '',
      };

    case 'carry_forward_alert':
      return {
        ...base,
        taskTitle:         notif.task_title || '',
        carryForwardCount: String(payload.carryForwardCount ?? 3),
        alertLevel:        'Alert',
        message:           notif.body || '',
      };

    case 'auto_escalation_assigned':
    case 'auto_escalation_notice':
      return {
        ...base,
        taskTitle:         notif.task_title || '',
        carryForwardCount: String(payload.carryForwardCount ?? ''),
        actionRequired:    notif.body || '',
      };

    case 'weekly_report_generated':
    case 'monthly_report_generated': {
      const summary  = payload.summary || {};
      const now      = new Date();
      const dayIdx   = now.getDay();
      const wStart   = new Date(now);
      wStart.setDate(now.getDate() - dayIdx);
      const wEnd     = new Date(wStart);
      wEnd.setDate(wStart.getDate() + 6);
      const fmt = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      return {
        ...base,
        weekStart:         fmt(wStart),
        weekEnd:           fmt(wEnd),
        carryForwardTotal: String(summary.carryForwardTotal ?? 0),
        escalatedTotal:    String(summary.escalatedTotal    ?? 0),
        overdueTotal:      String(summary.overdueTotal      ?? 0),
        reportDate:        fmt(now),
      };
    }

    default:
      return base;
  }
}

// ── Invitation processor ────────────────────────────────────────────────────

async function processInvitationEmail({ invitationId }) {
  const db           = require('../config/db');
  const emailService = require('../services/email.service');

  const { rows } = await db.query(
    `SELECT mi.id,
            mi.recipient_email,
            mi.recipient_name,
            mi.recipient_type,
            m.title          AS meeting_title,
            m.scheduled_start,
            COALESCE(m.teams_join_url, m.meeting_link) AS meeting_link,
            c.name           AS tenant_name,
            (SELECT TRIM(CONCAT(u.first_name, ' ', u.last_name))
             FROM   users u
             JOIN   tenant_assignments ta ON ta.user_id = u.id
             WHERE  ta.tenant_id = mi.tenant_id
               AND  ta.is_primary = TRUE
             LIMIT  1)       AS organizer_name
     FROM   meeting_invitations mi
     JOIN   meetings  m ON m.id = mi.meeting_id
     JOIN   customers c ON c.id = mi.tenant_id
     WHERE  mi.id = $1`,
    [invitationId]
  );

  if (!rows[0]) {
    logger.warn('email.job: invitation not found', { invitationId });
    return;
  }

  const inv            = rows[0];
  const scheduledStart = new Date(inv.scheduled_start);
  const fmt            = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const timeFmt        = { hour: '2-digit', minute: '2-digit' };

  const vars = {
    recipientName:  inv.recipient_name || inv.recipient_email.split('@')[0],
    meetingTitle:   inv.meeting_title,
    meetingDate:    scheduledStart.toLocaleDateString('en-US', fmt),
    meetingTime:    scheduledStart.toLocaleTimeString('en-US', timeFmt),
    tenantName:     inv.tenant_name,
    organizerName:  inv.organizer_name || 'NxgSecure Platform',
  };

  const rawVars = {
    meetingLinkButton: emailService.buildMeetingLinkButton(inv.meeting_link),
  };

  await emailService.send({
    to:           inv.recipient_email,
    subject:      `Meeting Invitation: ${inv.meeting_title}`,
    templateName: 'meeting-invitation',
    vars,
    rawVars,
  });

  await db.query(
    `UPDATE meeting_invitations
     SET    status = 'sent', sent_at = NOW(), updated_at = NOW()
     WHERE  id = $1`,
    [invitationId]
  );
}

// ── Reminder processor ─────────────────────────────────────────────────────

async function processReminderEmail({ meetingId, to, recipientName }) {
  const db           = require('../config/db');
  const emailService = require('../services/email.service');

  const { rows } = await db.query(
    `SELECT m.title, m.scheduled_start, m.meeting_link, c.name AS tenant_name
     FROM   meetings  m
     JOIN   customers c ON c.id = m.tenant_id
     WHERE  m.id = $1`,
    [meetingId]
  );

  if (!rows[0]) {
    logger.warn('email.job: meeting not found for reminder', { meetingId });
    return;
  }

  const meeting        = rows[0];
  const scheduledStart = new Date(meeting.scheduled_start);
  const now            = new Date();
  const hoursUntil     = Math.max(0, Math.round((scheduledStart - now) / (1000 * 60 * 60)));
  const fmt            = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const timeFmt        = { hour: '2-digit', minute: '2-digit' };

  const vars = {
    recipientName: recipientName || to.split('@')[0],
    meetingTitle:  meeting.title,
    meetingDate:   scheduledStart.toLocaleDateString('en-US', fmt),
    meetingTime:   scheduledStart.toLocaleTimeString('en-US', timeFmt),
    tenantName:    meeting.tenant_name,
    hoursUntil:    String(hoursUntil),
  };

  const rawVars = {
    meetingLinkButton: emailService.buildMeetingLinkButton(meeting.meeting_link),
  };

  await emailService.send({
    to,
    subject:      `Reminder: ${meeting.title} in ${hoursUntil} hour${hoursUntil !== 1 ? 's' : ''}`,
    templateName: 'meeting-reminder',
    vars,
    rawVars,
  });

  logger.info('email.job: reminder sent', { meetingId, to, hoursUntil });
}

// ── Worker lifecycle ───────────────────────────────────────────────────────

let worker = null;

async function start() {
  try {
    worker = new Worker(
      'email-delivery',
      async (job) => {
        const { jobType } = job.data;
        logger.info('email.job: processing', { jobId: job.id, jobType });

        if (jobType === 'notification') {
          await processNotificationEmail(job.data);
        } else if (jobType === 'invitation') {
          await processInvitationEmail(job.data);
        } else if (jobType === 'reminder') {
          await processReminderEmail(job.data);
        } else {
          logger.warn('email.job: unknown jobType', { jobType, jobId: job.id });
        }
      },
      {
        connection,
        concurrency: 5,  // nodemailer pool (maxConnections:5) already rate-limits sends
      }
    );

    worker.on('completed', (job) => {
      logger.info('email.job: completed', { jobId: job.id, jobType: job.data.jobType });
    });

    worker.on('failed', async (job, err) => {
      // BullMQ fires 'failed' on every attempt, not just the last one.
      // Only update DB when all retries are exhausted (final failure).
      const isFinalFailure = !job || job.attemptsMade >= (job.opts?.attempts ?? 1);

      logger.error('email.job: job failed', {
        jobId:       job?.id,
        jobType:     job?.data?.jobType,
        attempt:     job?.attemptsMade,
        maxAttempts: job?.opts?.attempts,
        final:       isFinalFailure,
        error:       err.message,
      });

      if (!isFinalFailure) return; // Will be retried — do not mark as permanently failed yet.

      // Final failure — mark DB records accordingly.
      const db = require('../config/db');
      if (job?.data?.jobType === 'notification' && job?.data?.notificationId) {
        // notifications table has no updated_at column (migration 024).
        await db.query(
          `UPDATE notifications SET status = 'failed' WHERE id = $1`,
          [job.data.notificationId]
        ).catch(() => {});
      }
      if (job?.data?.jobType === 'invitation' && job?.data?.invitationId) {
        await db.query(
          `UPDATE meeting_invitations
           SET    status = 'failed', error_message = $1, updated_at = NOW()
           WHERE  id = $2`,
          [err.message.slice(0, 500), job.data.invitationId]
        ).catch(() => {});
      }
    });

    worker.on('error', onWorkerError('email.job worker'));

    logger.info('Email delivery worker started', { queue: 'email-delivery', concurrency: 5 });
  } catch (err) {
    // Redis being unavailable must not crash the server.
    logger.error('Email delivery worker failed to start — Redis may be unavailable', {
      error: err.message,
    });
  }
}

async function stop() {
  try {
    if (worker) await worker.close();
    await emailQueue.close();
    logger.info('Email delivery worker stopped');
  } catch (err) {
    logger.warn('Email delivery worker stop error', { error: err.message });
  }
}

module.exports = { start, stop, queue: emailQueue, processNotificationEmail };
