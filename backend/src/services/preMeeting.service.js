'use strict';

const db                      = require('../config/db');
const AIRecommendationService = require('./ai/AIRecommendationService');
const { SYSTEM_ACTOR }        = require('../config/systemActor');
const logger                  = require('../utils/logger');

// Must match the fallback sourceFindingId used in meeting.repository.js generateFindingsAndTasks.
// Changing one requires changing both.
const PLACEHOLDER_FINDING_ID = 'PENDING-NXG360';

const preMeetingService = {
  /**
   * Triggered at T-48 after workflow fires.
   * Runs AI analysis in the background — errors are absorbed so the caller
   * is never blocked and T-48 workflow success is unaffected.
   */
  async autoAnalyze(meetingId, tenantId, modelOverride) {
    setImmediate(async () => {
      try {
        // Fast-path: another caller already started analysis for this meeting.
        // Let the first run complete — no need to queue a duplicate.
        if (AIRecommendationService.isAnalyzing(meetingId)) {
          logger.info('Pre-meeting AI auto-analyze skipped — already in progress', { meetingId, tenantId });
          return;
        }

        // IS DISTINCT FROM handles NULL correctly: a finding with a NULL source_finding_id
        // came from NXG360 without an ID — that is still a real finding, not a placeholder.
        const { rows } = await db.query(
          `SELECT COUNT(*) FILTER (
             WHERE source_finding_id IS DISTINCT FROM $2
           ) AS real_count
           FROM findings
           WHERE meeting_id = $1`,
          [meetingId, PLACEHOLDER_FINDING_ID]
        );

        if (parseInt(rows[0].real_count, 10) === 0) {
          logger.info('Pre-meeting AI auto-analyze skipped — only placeholder findings present', {
            meetingId, tenantId,
          });
          return;
        }

        logger.info('Pre-meeting AI auto-analyze started', { meetingId, tenantId });

        const recs = await AIRecommendationService.analyze({
          tenantId,
          meetingId,
          user:  SYSTEM_ACTOR,
          model: modelOverride,
        });

        logger.info('Pre-meeting AI auto-analyze complete', {
          meetingId,
          tenantId,
          recommendations: recs.length,
        });
      } catch (err) {
        // 409 means a concurrent run beat us to the lock between our isAnalyzing()
        // check and the analyze() call — not a real failure, demote to info.
        if (err.statusCode === 409) {
          logger.info('Pre-meeting AI auto-analyze skipped — concurrent run detected', { meetingId, tenantId });
          return;
        }
        // Any other error is a real failure — log at error so it's visible.
        logger.error('Pre-meeting AI auto-analyze failed', {
          meetingId,
          tenantId,
          error: err.message,
        });
      }
    });
  },

  /**
   * Returns the pre-meeting brief for a single meeting:
   * – NXG360 findings inserted at T-48 (from findings table)
   * – AI recommendations generated at T-48 (approval_status = 'pending')
   * Returns null if the meeting isn't found or isn't accessible.
   */
  async getBrief(meetingId, tenantId) {
    const { rows: mtgRows } = await db.query(
      `SELECT m.id,
              m.tenant_id     AS "tenantId",
              m.title,
              m.status,
              m.scheduled_start AS "scheduledStart",
              c.name          AS "customerName"
       FROM   meetings m
       JOIN   customers c ON c.id = m.tenant_id
       WHERE  m.id = $1 AND m.tenant_id = $2
       LIMIT  1`,
      [meetingId, tenantId]
    );

    if (!mtgRows[0]) return null;
    const meeting = mtgRows[0];

    const [findingsResult, recsResult] = await Promise.all([
      db.query(
        `SELECT id,
                source_finding_id AS "sourceFindingId",
                severity,
                category,
                title,
                description,
                system_affected   AS "systemAffected",
                created_at        AS "createdAt"
         FROM   findings
         WHERE  meeting_id = $1
         ORDER  BY CASE severity
                     WHEN 'critical' THEN 0
                     WHEN 'high'     THEN 1
                     WHEN 'medium'   THEN 2
                     ELSE 3
                   END`,
        [meetingId]
      ),
      db.query(
        `SELECT id,
                title,
                action_plan          AS "actionPlan",
                business_impact      AS "businessImpact",
                remediation_strategy AS "remediationStrategy",
                risk_reduction_score AS "riskReductionScore",
                severity,
                category,
                recommended_owner     AS "recommendedOwner",
                recommended_owner_type AS "recommendedOwnerType",
                due_date_suggestion   AS "dueDateSuggestion",
                approval_status       AS "approvalStatus",
                ai_model              AS "aiModel",
                ai_confidence         AS "aiConfidence",
                generated_at          AS "generatedAt"
         FROM   ai_task_recommendations
         WHERE  meeting_id = $1 AND tenant_id = $2
         ORDER  BY CASE severity
                     WHEN 'critical' THEN 0
                     WHEN 'high'     THEN 1
                     WHEN 'medium'   THEN 2
                     ELSE 3
                   END`,
        [meetingId, tenantId]
      ),
    ]);

    return {
      meeting,
      findings:        findingsResult.rows,
      recommendations: recsResult.rows,
    };
  },

  /**
   * Generates a PDF of the pre-meeting brief (findings + AI recs) for download.
   * Returns a Buffer containing the PDF binary.
   */
  async exportBriefPDF(meetingId, tenantId) {
    const brief = await this.getBrief(meetingId, tenantId);
    if (!brief) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });

    const PDFDocument = require('pdfkit');
    const SEV_LABEL   = { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };

    return new Promise((resolve, reject) => {
      const doc     = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];
      doc.on('data',  (chunk) => buffers.push(chunk));
      doc.on('end',   ()      => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const scheduledDate = brief.meeting.scheduledStart
        ? new Date(brief.meeting.scheduledStart).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
        : 'TBD';

      // Header
      doc.fontSize(18).fillColor('#1e293b').font('Helvetica-Bold')
         .text('Pre-Meeting Brief', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(13).fillColor('#334155').font('Helvetica-Bold')
         .text(brief.meeting.title, { align: 'center' });
      doc.fontSize(10).fillColor('#64748b').font('Helvetica')
         .text(`Customer: ${brief.meeting.customerName}`, { align: 'center' })
         .text(`Scheduled: ${scheduledDate}`, { align: 'center' });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
      doc.moveDown(0.5);

      // Findings
      doc.fontSize(12).fillColor('#1e293b').font('Helvetica-Bold')
         .text(`NXG360 Findings (${brief.findings.length})`);
      doc.moveDown(0.3);

      if (brief.findings.length === 0) {
        doc.fontSize(10).fillColor('#94a3b8').font('Helvetica-Oblique')
           .text('No findings for this meeting.');
      } else {
        for (const f of brief.findings) {
          doc.fontSize(10).fillColor('#374151').font('Helvetica-Bold')
             .text(`[${SEV_LABEL[f.severity] || f.severity.toUpperCase()}]  `, { continued: true })
             .font('Helvetica').fillColor('#1e293b').text(f.title);
          const meta = [f.category, f.systemAffected].filter(Boolean).join(' · ');
          if (meta) {
            doc.fontSize(9).fillColor('#94a3b8').text(`  ${meta}`, { indent: 15 });
          }
          doc.moveDown(0.25);
        }
      }

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
      doc.moveDown(0.5);

      // AI Recommendations
      doc.fontSize(12).fillColor('#1e293b').font('Helvetica-Bold')
         .text(`AI Recommendations (${brief.recommendations.length})`);
      doc.moveDown(0.3);

      if (brief.recommendations.length === 0) {
        doc.fontSize(10).fillColor('#94a3b8').font('Helvetica-Oblique')
           .text('No AI recommendations generated yet.');
      } else {
        for (const r of brief.recommendations) {
          doc.fontSize(10).fillColor('#374151').font('Helvetica-Bold')
             .text(`[${SEV_LABEL[r.severity] || r.severity.toUpperCase()}]  `, { continued: true })
             .font('Helvetica').fillColor('#1e293b').text(r.title);
          if (r.actionPlan) {
            doc.fontSize(9).fillColor('#475569').text(`  Action: ${r.actionPlan}`, { indent: 15 });
          }
          const parts = [
            r.riskReductionScore != null ? `Risk reduction: ${r.riskReductionScore}%` : null,
            r.recommendedOwner           ? `Owner: ${r.recommendedOwner}`              : null,
            r.approvalStatus             ? `Status: ${r.approvalStatus}`               : null,
          ].filter(Boolean);
          if (parts.length) {
            doc.fontSize(9).fillColor('#94a3b8').text(`  ${parts.join('  ·  ')}`, { indent: 15 });
          }
          doc.moveDown(0.3);
        }
      }

      // Footer
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
      doc.moveDown(0.3);
      doc.fontSize(8).fillColor('#94a3b8').font('Helvetica')
         .text(
           `Generated by NxgSecure Platform · ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}`,
           { align: 'center' }
         );

      doc.end();
    });
  },
};

module.exports = preMeetingService;
