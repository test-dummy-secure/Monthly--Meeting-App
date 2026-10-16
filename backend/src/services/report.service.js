'use strict';

const db                        = require('../config/db');
const { notifyReportGenerated } = require('./notification.service');
const logger                    = require('../utils/logger');

const FALLBACK_WINDOW_DAYS = 30;

/**
 * Auto-generates a monthly_summary report for the given meeting at T-48.
 * Consolidates all weekly_reports since the previous meeting's scheduled_start
 * plus a live task snapshot across the tenant at the moment of generation.
 *
 * Idempotent: skips silently if a monthly_summary already exists for this meeting_id.
 */
async function autoGenerateMonthlyReport(meetingId, tenantId) {
  // ── 1. Idempotency guard ───────────────────────────────────────────────────
  const { rows: existing } = await db.query(
    `SELECT id FROM reports WHERE meeting_id = $1 AND report_type = 'monthly_summary' LIMIT 1`,
    [meetingId]
  );
  if (existing.length > 0) {
    logger.info('Monthly report already exists — skipping auto-generate', {
      meetingId, existingReportId: existing[0].id,
    });
    return;
  }

  // ── 2. Load the upcoming meeting ──────────────────────────────────────────
  const { rows: meetingRows } = await db.query(
    `SELECT id, tenant_id AS "tenantId", title,
            scheduled_start AS "scheduledStart", scheduled_end AS "scheduledEnd",
            status, provider
     FROM   meetings
     WHERE  id = $1 AND tenant_id = $2
     LIMIT  1`,
    [meetingId, tenantId]
  );
  if (meetingRows.length === 0) {
    logger.warn('Monthly report auto-generate: meeting not found', { meetingId, tenantId });
    return;
  }
  const meeting = meetingRows[0];

  // ── 3. Find window start: previous meeting's scheduled_start for this tenant ──
  const { rows: prevRows } = await db.query(
    `SELECT scheduled_start AS "scheduledStart"
     FROM   meetings
     WHERE  tenant_id       = $1
       AND  status          IN ('closed', 'conducted')
       AND  scheduled_start < $2
     ORDER  BY scheduled_start DESC
     LIMIT  1`,
    [tenantId, meeting.scheduledStart]
  );

  const now = new Date();
  const windowStart = prevRows.length > 0
    ? new Date(prevRows[0].scheduledStart)
    : new Date(now.getTime() - FALLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const fmtDate = (d) => new Date(d).toISOString().split('T')[0];

  // ── 4. Pull weekly_reports in the window ───────────────────────────────────
  const { rows: weeklyRows } = await db.query(
    `SELECT id, week_start AS "weekStart", week_end AS "weekEnd", summary
     FROM   weekly_reports
     WHERE  tenant_id  = $1
       AND  week_start >= $2
     ORDER  BY week_start ASC`,
    [tenantId, fmtDate(windowStart)]
  );

  // ── 5. Live task snapshot — all approved non-cancelled tasks for the tenant ─
  const { rows: taskRows } = await db.query(
    `SELECT id, title, meeting_id AS "meetingId",
            remediation_status AS "remediationStatus",
            escalation_status  AS "escalationStatus",
            progress_percentage AS "progressPercentage",
            carry_forward_count AS "carryForwardCount",
            escalation_count    AS "escalationCount",
            owner_type          AS "ownerType",
            priority,
            due_date            AS "dueDate"
     FROM   tasks
     WHERE  tenant_id      = $1
       AND  approval_status = 'approved'
       AND  remediation_status NOT IN ('cancelled')
     ORDER  BY created_at ASC`,
    [tenantId]
  );

  // ── 6. Compute buckets ────────────────────────────────────────────────────
  const completed    = taskRows.filter((t) => t.remediationStatus === 'completed' || t.progressPercentage >= 100);
  const closed       = taskRows.filter((t) => t.remediationStatus === 'closed');
  const inProgress   = taskRows.filter((t) => t.remediationStatus === 'in_progress' && t.progressPercentage > 0 && t.progressPercentage < 100);
  const notStarted   = taskRows.filter((t) => ['pending', 'open'].includes(t.remediationStatus) && (t.progressPercentage || 0) === 0);
  const carryForward = taskRows.filter((t) => t.remediationStatus === 'carry_forward');
  const blocked      = taskRows.filter((t) => t.remediationStatus === 'blocked');
  const escalated    = taskRows.filter((t) => t.escalationStatus === 'escalated');
  const overdue      = taskRows.filter((t) => {
    if (!t.dueDate) return false;
    const inactive = ['completed', 'closed', 'cancelled'];
    return !inactive.includes(t.remediationStatus) && new Date(t.dueDate) < now;
  });

  const total = taskRows.length;
  const progressPct = total > 0
    ? Math.round(taskRows.reduce((s, t) => s + (t.progressPercentage || 0), 0) / total)
    : 0;

  // ── 7. Build weekly trend ─────────────────────────────────────────────────
  const weeklyTrend = weeklyRows.map((w) => ({
    week:         fmtDate(w.weekStart),
    carryForward: w.summary?.carryForwardTotal ?? 0,
    escalated:    w.summary?.escalatedTotal    ?? 0,
    overdue:      w.summary?.overdueTotal      ?? 0,
  }));

  let trendDirection = 'stable';
  if (weeklyTrend.length >= 2) {
    const first = weeklyTrend[0].carryForward;
    const last  = weeklyTrend[weeklyTrend.length - 1].carryForward;
    if (last < first) trendDirection = 'improving';
    else if (last > first) trendDirection = 'worsening';
  }

  // ── 8. Build report fields ────────────────────────────────────────────────
  const monthLabel = new Date(meeting.scheduledStart)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const { rows: customerRows } = await db.query(
    `SELECT name FROM customers WHERE id = $1 LIMIT 1`,
    [tenantId]
  );
  const customerName = customerRows[0]?.name || tenantId;

  const title = `Monthly Meeting Summary — ${customerName} — ${monthLabel}`;

  const summary =
    `Pre-meeting consolidated report for ${customerName} (generated at T-48). ` +
    `${completed.length + closed.length} of ${total} tasks resolved. ` +
    `${carryForward.length} carry-forward. ` +
    `${escalated.length} escalated. ` +
    `Overall progress: ${progressPct}%. ` +
    `Weekly reports consolidated: ${weeklyRows.length}.`;

  const exportPayload = {
    generatedAt:        now.toISOString(),
    trigger:            't48_auto',
    reportPeriod: {
      from: fmtDate(windowStart),
      to:   fmtDate(now),
    },
    taskSnapshot: {
      total,
      completed:    completed.length,
      closed:       closed.length,
      inProgress:   inProgress.length,
      notStarted:   notStarted.length,
      carryForward: carryForward.length,
      blocked:      blocked.length,
      overdue:      overdue.length,
      escalated:    escalated.length,
      progressPct,
    },
    weeklyTrend,
    trendDirection,
    weeklyReportCount: weeklyRows.length,
    tasks: taskRows.map((t) => ({
      id:                t.id,
      title:             t.title,
      meetingId:         t.meetingId,
      remediationStatus: t.remediationStatus,
      escalationStatus:  t.escalationStatus,
      progressPercentage: t.progressPercentage,
      carryForwardCount: t.carryForwardCount,
      escalationCount:   t.escalationCount,
      ownerType:         t.ownerType,
      priority:          t.priority,
      dueDate:           t.dueDate,
    })),
  };

  // ── 9. Write to reports table ─────────────────────────────────────────────
  const { rows: inserted } = await db.query(
    `INSERT INTO reports (
       tenant_id, meeting_id, report_type, title, summary,
       open_tasks_count, closed_tasks_count, overdue_tasks_count,
       escalated_tasks_count, carry_forward_tasks_count, blocked_tasks_count,
       progress_percentage, generated_by, export_payload
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      tenantId,
      meetingId,
      'monthly_summary',
      title,
      summary,
      notStarted.length + inProgress.length + carryForward.length + blocked.length, // open_tasks_count
      closed.length + completed.length,                                              // closed_tasks_count
      overdue.length,
      escalated.length,
      carryForward.length,
      blocked.length,
      progressPct,
      'System Auto-Generate (T-48)',
      JSON.stringify(exportPayload),
    ]
  );

  logger.info('Monthly summary report auto-generated at T-48', {
    meetingId,
    tenantId,
    reportId:      inserted[0].id,
    totalTasks:    total,
    carryForward:  carryForward.length,
    escalated:     escalated.length,
    weeklyReports: weeklyRows.length,
    trendDirection,
  });

  // Notify AM — fire-and-forget, must not fail the report generation
  notifyReportGenerated({
    tenantId,
    meetingId,
    reportId:   inserted[0].id,
    reportType: 'monthly_report_generated',
    summary: {
      carryForwardTotal: carryForward.length,
      escalatedTotal:    escalated.length,
      overdueTotal:      overdue.length,
    },
  }).catch((err) => logger.warn('report.service: monthly report notification failed', {
    meetingId, error: err.message,
  }));
}

module.exports = { autoGenerateMonthlyReport };
