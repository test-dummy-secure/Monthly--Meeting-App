'use strict';

const { Queue, Worker }       = require('bullmq');
const { connection, onWorkerError } = require('../config/bullmq');
const db                      = require('../config/db');
const actionItemService       = require('../services/actionItem.service');
const taskRepository          = require('../repositories/task.repository');
const journeyService          = require('../services/journey.service');
const { notifyReportGenerated, notifyCarryForward, resolveRecipients } = require('../services/notification.service');
const logger                  = require('../utils/logger');

// Synthetic system user — gives generateReport() full cross-tenant access,
// same pattern the manual "Generate Report" button uses for a real AM/admin,
// just without a real logged-in session behind this scheduled job.
const SYSTEM_USER = { role: 'super_admin', email: 'system@bmmj.internal' };

const QUEUE_NAME = 'weekly-report';

let queue  = null;
let worker = null;

// Runs every Monday at 08:00 local server time.
// Generates one weekly_report row per active tenant.
// Idempotent: skips tenants that already have a report for the current week.
async function processWeeklyReports() {
  // Resolve current ISO week window (Sunday → Saturday, matching generateWeeklyReportInternal)
  const now      = new Date();
  const dayIdx   = now.getDay(); // 0 = Sun
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayIdx);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartDate = weekStart.toISOString().split('T')[0];

  // All active tenants
  const { rows: tenants } = await db.query(
    `SELECT id, name FROM customers WHERE status = 'active' ORDER BY name ASC`
  );

  if (tenants.length === 0) {
    logger.info('Weekly report job: no active tenants found');
    return;
  }

  logger.info('Weekly report job: starting run', {
    weekStart: weekStartDate,
    tenantCount: tenants.length,
  });

  let generated = 0;
  let skipped   = 0;
  let failed    = 0;

  for (const tenant of tenants) {
    try {
      // Idempotency: skip if this week's report already exists for this tenant
      const { rows: existing } = await db.query(
        `SELECT id FROM weekly_reports
         WHERE  tenant_id  = $1
           AND  week_start = $2
         LIMIT  1`,
        [tenant.id, weekStartDate]
      );

      if (existing.length > 0) {
        logger.info('Weekly report job: report already exists — skipping', {
          tenantId: tenant.id, tenantName: tenant.name, weekStart: weekStartDate,
        });
        skipped++;
        continue;
      }

      const result = await actionItemService.generateWeeklyReportInternal(
        tenant.id,
        'System Auto-Generate (Monday job)'
      );

      // Also write into the `reports` table — the ONE the frontend's Reports
      // page actually queries (GET /api/reports → JourneyService.getReports).
      // generateWeeklyReportInternal above only writes to `weekly_reports`, a
      // separate table with no UI reader at all — every automated weekly
      // report was previously invisible in the app regardless of tenant,
      // even though it was generating correctly server-side. Mirrors the
      // existing manual "Generate Report" button's path (same function,
      // same table) rather than duplicating insert logic here.
      try {
        const { rows: recentMeeting } = await db.query(
          `SELECT id FROM meetings
           WHERE  tenant_id = $1
           ORDER BY COALESCE(scheduled_start, created_at) DESC
           LIMIT 1`,
          [tenant.id]
        );
        if (recentMeeting[0]) {
          // generateReport() has its own duplicate check keyed on week_number —
          // a rolling week-index (weeks since epoch) so it always increments,
          // never collides across month/year boundaries, and never defaults
          // to the same value on a later run the way an unset weekNumber
          // (silently defaulting to 1 every time) would.
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          const rollingWeekNumber = Math.floor(weekStart.getTime() / (7 * 24 * 60 * 60 * 1000));

          await journeyService.generateReport({
            user:        SYSTEM_USER,
            tenantId:    tenant.id,
            meetingId:   recentMeeting[0].id,
            reportType:  'weekly_progress',
            generatedBy: 'System Auto-Generate (Monday job)',
            weekNumber:  rollingWeekNumber,
            weekStart:   weekStartDate,
            weekEnd:     weekEnd.toISOString().split('T')[0],
          });
        } else {
          logger.warn('Weekly report job: no meeting found — skipped reports-table mirror', {
            tenantId: tenant.id, tenantName: tenant.name,
          });
        }
      } catch (mirrorErr) {
        // Must not block weekly_reports/notifications for this tenant if the
        // UI-visible mirror fails — logged loudly so it's not silently missed.
        logger.error('Weekly report job: failed to mirror into reports table (UI will not show it)', {
          tenantId: tenant.id, tenantName: tenant.name, error: mirrorErr.message,
        });
      }

      // Notify AM — fire-and-forget, must not block remaining tenants
      notifyReportGenerated({
        tenantId:   tenant.id,
        meetingId:  null,
        reportId:   result.report.id,
        reportType: 'weekly_report_generated',
        summary:    result.summary,
      }).catch((err) => logger.warn('Weekly report job: notification failed', {
        tenantId: tenant.id, error: err.message,
      }));

      // Increment carry_forward_count for all unresolved tasks this week.
      // Escalation is driven by weekly inactivity (not monthly meeting closes).
      // Tasks reaching the threshold are auto-escalated here; the overdue job
      // then creates the formal escalation record and sends notifications.
      const cfRows = await taskRepository.weeklyIncrementCarryForward(tenant.id);
      if (cfRows.length > 0) {
        // Resolve AM email once per tenant — not once per task
        let amEmail = null;
        try {
          const recipients = await resolveRecipients(tenant.id);
          amEmail = recipients.amEmail;
        } catch (resolveErr) {
          logger.warn('Weekly report job: could not resolve AM email for carry-forward notifications', {
            tenantId: tenant.id, error: resolveErr.message,
          });
        }
        for (const task of cfRows) {
          notifyCarryForward({ tenantId: tenant.id, taskId: task.id, task, amEmail })
            .catch(() => {});
        }
      }

      logger.info('Weekly report job: report generated', {
        tenantId: tenant.id, tenantName: tenant.name, weekStart: weekStartDate,
        carryForwardIncremented: cfRows.length,
      });
      generated++;
    } catch (tenantErr) {
      // One failing tenant must not block the rest.
      logger.error('Weekly report job: failed to generate report for tenant', {
        tenantId:   tenant.id,
        tenantName: tenant.name,
        weekStart:  weekStartDate,
        error:      tenantErr.message,
      });
      failed++;
    }
  }

  logger.info('Weekly report job: run complete', {
    weekStart: weekStartDate,
    generated,
    skipped,
    failed,
  });
}

async function start() {
  try {
    queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 52 }, // keep one year of Monday runs
        removeOnFail:     { count: 10 },
      },
    });

    worker = new Worker(
      QUEUE_NAME,
      async () => { await processWeeklyReports(); },
      { connection, concurrency: 1 }
    );

    worker.on('completed', (job) => {
      logger.info('Weekly report worker: job completed', { jobId: job.id });
    });

    worker.on('failed', (job, err) => {
      logger.error('Weekly report worker: job failed', { jobId: job?.id, error: err.message });
    });

    worker.on('error', onWorkerError('Weekly report worker'));

    // Every Monday at 08:00 — cron: minute=0, hour=8, day-of-week=1
    await queue.upsertJobScheduler(
      'weekly-report-scheduler',
      { pattern: '0 8 * * 1' },
      { name: 'generate', data: {} }
    );

    logger.info('Weekly report scheduler started', { schedule: '0 8 * * 1 (Mon 08:00)' });
  } catch (err) {
    // Redis being unavailable must not crash the server.
    logger.error('Weekly report scheduler failed to start — Redis may be unavailable', {
      error: err.message,
    });
  }
}

async function stop() {
  try {
    if (worker) await worker.close();
    if (queue)  await queue.close();
    logger.info('Weekly report scheduler stopped');
  } catch (err) {
    logger.warn('Weekly report scheduler stop error', { error: err.message });
  }
}

module.exports = { start, stop };
