const express = require('express');
const router = express.Router();
const JourneyService = require('../services/journey.service');
const auth = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const logger = require('../utils/logger');

router.use(auth, tenantMiddleware);

router.get('/', async (req, res, next) => {
  try {
    const reports = await JourneyService.getReports({
      user: req.user,
      tenantId: req.tenantId,
      reportType: req.query.reportType,
      page: parseInteger(req.query.page, 1),
      pageSize: Math.min(parseInteger(req.query.pageSize, 20), 100)
    });
    res.json(reports);
  } catch (error) {
    logger.error('Report list failed', { error: error.message, stack: error.stack });
    next(error);
  }
});

router.post('/generate', async (req, res, next) => {
  try {
    const report = await JourneyService.generateReport({
      user: req.user,
      tenantId: req.tenantId || req.body.tenantId,
      meetingId: req.body.meetingId,
      reportType: req.body.reportType || 'weekly_progress',
      weekNumber: req.body.weekNumber ? parseInt(req.body.weekNumber, 10) : null,
      weekStart: req.body.weekStart || null,
      weekEnd: req.body.weekEnd || null,
      generatedBy: `${req.user.first_name} ${req.user.last_name}`
    });
    res.status(201).json(report);
  } catch (error) {
    logger.error('Report generation failed', { error: error.message, stack: error.stack });
    next(error);
  }
});

router.get('/:reportId', async (req, res, next) => {
  try {
    const report = await JourneyService.getReportById({
      user: req.user,
      reportId: req.params.reportId,
      tenantId: req.tenantId,
    });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    // Enrich with live task + finding data for the linked meeting
    let tasks = [];
    let findings = [];
    if (report.meetingId) {
      const db = require('../database/index');
      const [taskRows, findingRows] = await Promise.all([
        db.query(
          `SELECT t.id, t.title, t.remediation_status AS "remediationStatus",
                  t.owner_name AS "ownerName", t.owner_type AS "ownerType",
                  t.review_outcome AS "reviewOutcome",
                  t.due_date AS "dueDate", t.progress_percentage AS "progressPercentage",
                  t.carry_forward_count AS "carryForwardCount",
                  t.escalation_count AS "escalationCount",
                  t.priority, t.created_at AS "createdAt",
                  f.severity, f.category, f.source_finding_id AS "sourceFindingId"
           FROM tasks t
           LEFT JOIN findings f ON f.id = t.finding_id
           WHERE t.meeting_id = $1
           ORDER BY COALESCE(t.due_date, t.created_at) ASC`,
          [report.meetingId]
        ),
        db.query(
          `SELECT id, title, severity, category, source_finding_id AS "sourceFindingId",
                  system_affected AS "systemAffected", description
           FROM findings WHERE meeting_id = $1 ORDER BY severity DESC`,
          [report.meetingId]
        ),
      ]);
      tasks    = taskRows.rows;
      findings = findingRows.rows;
    }

    res.json({ ...report, tasks, findings });
  } catch (error) {
    logger.error('Report detail failed', { error: error.message, stack: error.stack });
    next(error);
  }
});

module.exports = router;

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
