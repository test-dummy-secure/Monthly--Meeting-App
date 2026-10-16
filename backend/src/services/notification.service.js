'use strict';

const db     = require('../config/db');
const logger = require('../utils/logger');

// ── Recipient resolution ───────────────────────────────────────────────────
// Called ONCE per tenant before any notification loop — never per task.
// Resolves the primary AM via tenant_assignments (is_primary = TRUE).
// Falls back: if no primary AM → super_admin. If no super_admin → logs warning.
async function resolveRecipients(tenantId) {
  const [amResult, saResult] = await Promise.all([
    db.query(
      `SELECT u.email
       FROM   users u
       JOIN   tenant_assignments ta ON ta.user_id = u.id
       WHERE  ta.tenant_id  = $1
         AND  ta.is_primary = TRUE
         AND  u.is_active   = TRUE
       LIMIT  1`,
      [tenantId]
    ),
    db.query(
      `SELECT email FROM users WHERE role = 'super_admin' ORDER BY created_at ASC LIMIT 1`
    ),
  ]);

  const amEmail         = amResult.rows[0]?.email || null;
  const superAdminEmail = saResult.rows[0]?.email || null;

  if (!amEmail) {
    logger.warn('notification.service: no primary AM found in tenant_assignments', { tenantId });
  }
  if (!superAdminEmail) {
    logger.warn('notification.service: no super_admin user found — escalation routing degraded');
  }

  return {
    amEmail:         amEmail         || superAdminEmail,
    superAdminEmail: superAdminEmail || amEmail,
  };
}

// ── Core writer ────────────────────────────────────────────────────────────
// Writes one notification row to DB then fires the delivery extension point.
// Never throws — all errors are absorbed so callers are never disrupted.
async function notify({ tenantId, type, recipientRole, recipientEmail,
                        title, body, payload, taskId = null, meetingId = null }) {
  try {
    const { rows } = await db.query(
      `INSERT INTO notifications
         (tenant_id, task_id, meeting_id, type,
          recipient_role, recipient_email, title, body, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING id,
                 type,
                 recipient_role  AS "recipientRole",
                 recipient_email AS "recipientEmail"`,
      [
        tenantId, taskId || null, meetingId || null, type,
        recipientRole, recipientEmail || null,
        title, body || null,
        JSON.stringify(payload || {}),
      ]
    );

    const notification = rows[0];

    setImmediate(() => {
      deliver(notification).catch((err) =>
        logger.warn('notification.service: delivery failed (non-fatal)', {
          notificationId: notification.id,
          error:          err.message,
        })
      );
    });
  } catch (err) {
    logger.error('notification.service: failed to write notification to DB', {
      tenantId, type, recipientRole, error: err.message,
    });
  }
}

// ── Delivery extension point ───────────────────────────────────────────────
// Writes the notification to DB then queues an email job for types that have
// an HTML template. Types without a template are marked delivered immediately
// (in-app only). The email worker handles actual sending + final status update.
const EMAILABLE_TYPES = new Set([
  'carry_forward_warning',
  'carry_forward_alert',
  'auto_escalation_assigned',
  'auto_escalation_notice',
  'weekly_report_generated',
  'monthly_report_generated',
]);

async function deliver(notification) {
  // No email address — in-app notification only.
  if (!notification.recipientEmail) {
    await db.query(
      `UPDATE notifications SET status = 'delivered', delivered_at = NOW() WHERE id = $1`,
      [notification.id]
    );
    return;
  }

  // Type has no email template — mark delivered without sending email.
  if (!EMAILABLE_TYPES.has(notification.type)) {
    await db.query(
      `UPDATE notifications SET status = 'delivered', delivered_at = NOW() WHERE id = $1`,
      [notification.id]
    );
    return;
  }

  // Add to BullMQ email queue — worker handles send + status update.
  // jobId is idempotent so duplicate deliver() calls never double-send.
  try {
    const emailQueue = require('../queues/email.queue');
    await emailQueue.add(
      'notification-email',
      { jobType: 'notification', notificationId: notification.id },
      { jobId: `notif-${notification.id}` }
    );
    logger.info('notification.service: email job queued', {
      id:   notification.id,
      type: notification.type,
      to:   notification.recipientEmail,
    });
  } catch (err) {
    // Queue unavailable (Redis down) — mark delivered so it doesn't stay pending forever.
    logger.error('notification.service: failed to queue email — marking delivered', {
      id: notification.id, error: err.message,
    });
    await db.query(
      `UPDATE notifications SET status = 'delivered', delivered_at = NOW() WHERE id = $1`,
      [notification.id]
    );
  }
}

// ── Public: carry-forward warning ─────────────────────────────────────────
// Called from actionItem.service carryForwardForMeeting() per task.
// amEmail resolved once by the caller — not fetched here.
// count = 1: silent. count = 2: warning. count >= 3: alert.
async function notifyCarryForward({ tenantId, taskId, task, amEmail }) {
  const count = task.carryForwardCount;
  if (count < 2) return;

  const isAlert = count >= 3;
  const type    = isAlert ? 'carry_forward_alert' : 'carry_forward_warning';
  const title   = isAlert
    ? `🚨 Task carried forward ${count} times — auto-escalation pending: "${task.title}"`
    : `⚠️ Task carried forward twice — action needed: "${task.title}"`;
  const body    = isAlert
    ? `Task has been carried forward ${count} consecutive meetings without resolution. Auto-escalation will trigger on the next scheduled run.`
    : `Task carried forward for the 2nd time. Please review before the next meeting to avoid auto-escalation.`;

  await notify({
    tenantId,
    taskId,
    type,
    recipientRole:  'ACCOUNT_MANAGER',
    recipientEmail: amEmail,
    title,
    body,
    payload: {
      carryForwardCount: count,
      ownerType:         task.ownerType,
      priority:          task.priority,
    },
  });
}

// ── Public: auto-escalation notifications ─────────────────────────────────
// Called from overdue.job autoEscalateCarryForwardTasks() after escalation fires.
// amEmail + superAdminEmail resolved once per tenant by the caller.
//
// Routing:
//   CUSTOMER          → AM gets assignment + customer gets notice
//   ACCOUNT_MANAGER   → Super Admin gets assignment + AM gets notice
//   SHARED            → AM gets assignment + customer gets notice
async function notifyEscalation({ tenantId, taskId, task, amEmail, superAdminEmail }) {
  const { ownerType, title: taskTitle, carryForwardCount, ownerEmail } = task;

  if (ownerType === 'ACCOUNT_MANAGER') {
    // Escalation stops at the primary AM — see overdue.job.js for why
    // super_admin is never the target here (scoped to onboarding/
    // integrations, not account service delivery, and typically has no
    // access to that tenant's M365 to act on anything).
    const isPrimaryAMsOwnTask = ownerEmail && amEmail
      && ownerEmail.toLowerCase() === amEmail.toLowerCase();

    if (isPrimaryAMsOwnTask) {
      // No one above the primary AM to hand this to — the task's own
      // 'escalated' status is the visible flag; no notification goes out.
      return;
    }

    // A non-primary AM's task — notify the primary AM (assigned to follow up)
    await notify({
      tenantId, taskId,
      type:           'auto_escalation_assigned',
      recipientRole:  'ACCOUNT_MANAGER',
      recipientEmail: amEmail,
      title:          `🚨 Team task escalated to you: "${taskTitle}"`,
      body:           `A task owned by a team member was auto-escalated after ${carryForwardCount} consecutive carry-forwards without resolution.`,
      payload:        { carryForwardCount, ownerType },
    });
    // The AM whose task it was gets a notice they were escalated over
    if (ownerEmail) {
      await notify({
        tenantId, taskId,
        type:           'auto_escalation_notice',
        recipientRole:  'ACCOUNT_MANAGER',
        recipientEmail: ownerEmail,
        title:          `Your task has been escalated to your primary AM: "${taskTitle}"`,
        body:           `Auto-escalated after ${carryForwardCount} carry-forwards without resolution.`,
        payload:        { carryForwardCount, ownerType },
      });
    }

  } else {
    // CUSTOMER or SHARED — AM gets assignment
    await notify({
      tenantId, taskId,
      type:           'auto_escalation_assigned',
      recipientRole:  'ACCOUNT_MANAGER',
      recipientEmail: amEmail,
      title:          ownerType === 'SHARED'
        ? `🚨 Shared task auto-escalated: "${taskTitle}"`
        : `🚨 Customer task escalated to you: "${taskTitle}"`,
      body:           `Task auto-escalated after ${carryForwardCount} consecutive carry-forwards. ` +
                      (ownerType === 'SHARED'
                        ? 'Both AM and customer action required.'
                        : 'Follow up with the customer immediately.'),
      payload:        { carryForwardCount, ownerType },
    });
    // Customer gets a notice when they are responsible
    if (ownerEmail) {
      await notify({
        tenantId, taskId,
        type:           'auto_escalation_notice',
        recipientRole:  'CUSTOMER',
        recipientEmail: ownerEmail,
        title:          `Action required — task escalated: "${taskTitle}"`,
        body:           `This task has been outstanding for ${carryForwardCount} consecutive review meetings without resolution. Immediate action is required.`,
        payload:        { carryForwardCount, ownerType },
      });
    }
  }
}

// ── Public: report generation notification ────────────────────────────────
// Called after weekly or monthly report is generated.
// Resolves the primary AM email from tenant_assignments so the email is
// actually delivered — not just stored as an in-app notification.
async function notifyReportGenerated({ tenantId, meetingId, reportId, reportType, summary }) {
  // Monthly report emails: send at most ONE per tenant per calendar month.
  // Multiple test meetings in the same month would otherwise each trigger an email.
  if (reportType === 'monthly_report_generated') {
    const { rows: dup } = await db.query(
      `SELECT id FROM notifications
       WHERE  tenant_id   = $1
         AND  type        = 'monthly_report_generated'
         AND  created_at >= date_trunc('month', NOW())
       LIMIT  1`,
      [tenantId]
    );
    if (dup.length > 0) {
      logger.info('notifyReportGenerated: monthly report email already sent this month — skipping', {
        tenantId, meetingId, existingNotifId: dup[0].id,
      });
      return;
    }
  }

  // Resolve primary AM email dynamically from tenant_assignments.
  const { rows } = await db.query(
    `SELECT u.email
     FROM   users u
     JOIN   tenant_assignments ta ON ta.user_id = u.id
     WHERE  ta.tenant_id  = $1
       AND  ta.is_primary = TRUE
       AND  u.is_active   = TRUE
     LIMIT  1`,
    [tenantId]
  );
  const amEmail = rows[0]?.email || null;

  if (!amEmail) {
    logger.warn('notifyReportGenerated: no primary AM found — skipping email', { tenantId });
  }

  const isMonthly = reportType === 'monthly_report_generated';
  const title = isMonthly
    ? 'Monthly summary report is ready for review (generated at T-48)'
    : 'Weekly progress report has been generated';
  const body = summary
    ? `Carry-forward: ${summary.carryForwardTotal ?? 0} | Escalated: ${summary.escalatedTotal ?? 0} | Overdue: ${summary.overdueTotal ?? 0}`
    : null;

  await notify({
    tenantId,
    meetingId:      meetingId || null,
    type:           reportType,
    recipientRole:  'ACCOUNT_MANAGER',
    recipientEmail: amEmail,
    title,
    body,
    payload:        { reportId, summary: summary || {} },
  });
}

module.exports = {
  resolveRecipients,
  notifyCarryForward,
  notifyEscalation,
  notifyReportGenerated,
};
