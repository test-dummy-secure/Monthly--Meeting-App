const db     = require('../database/index');
const logger = require('../utils/logger');

const mapRow = (row) => ({
  id:                  row.id,
  tenantId:            row.tenant_id,
  meetingId:           row.meeting_id,
  findingId:           row.finding_id,
  title:               row.title,
  actionPlan:          row.action_plan,
  businessImpact:      row.business_impact      || null,
  remediationStrategy: row.remediation_strategy  || null,
  riskReductionScore:  row.risk_reduction_score,
  severity:            row.severity,
  category:            row.category,
  recommendedOwner:     row.recommended_owner,
  recommendedOwnerType: row.recommended_owner_type || null,
  dueDateSuggestion:    row.due_date_suggestion,
  approvalStatus:      row.approval_status,
  approvedBy:          row.approved_by,
  approvedAt:          row.approved_at,
  rejectedReason:      row.rejected_reason,
  aiModel:             row.ai_model,
  aiConfidence:        row.ai_confidence,
  correlationId:       row.correlation_id        || null,
  rawAiResponse:       row.raw_ai_response,
  analysisType:        row.analysis_type         || 'pre_meeting',
  generatedAt:         row.generated_at,
  createdAt:           row.created_at,
  taskId:              row.task_id               || null,
  clickupTaskId:       row.clickup_task_id       || null,
  clickupUrl:          row.clickup_url           || null,
});

const aiRecommendationRepository = {

  create: async ({ tenantId, meetingId, findingId, title, actionPlan,
                   riskReductionScore, severity, category, recommendedOwner,
                   dueDateSuggestion, aiModel, aiConfidence, rawAiResponse }) => {
    const { rows } = await db.query(
      `INSERT INTO ai_task_recommendations (
         tenant_id, meeting_id, finding_id, title, action_plan,
         risk_reduction_score, severity, category, recommended_owner,
         due_date_suggestion, ai_model, ai_confidence, raw_ai_response
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        tenantId, meetingId, findingId || null, title, actionPlan || null,
        riskReductionScore || 0, severity || null, category || null,
        recommendedOwner || null, dueDateSuggestion || null,
        aiModel || 'claude-sonnet-4-6',
        aiConfidence !== undefined ? aiConfidence : null,
        rawAiResponse ? JSON.stringify(rawAiResponse) : null,
      ]
    );
    logger.info('AI recommendation created', { id: rows[0].id, tenantId, meetingId });
    return mapRow(rows[0]);
  },

  createBatch: async (recommendations) => {
    if (!recommendations || recommendations.length === 0) return [];
    const results = [];
    for (const rec of recommendations) {
      results.push(await aiRecommendationRepository.create(rec));
    }
    return results;
  },

  findByMeeting: async (meetingId, tenantId = null) => {
    const base = `
      SELECT r.*, t.id AS task_id, t.clickup_task_id, t.clickup_url
      FROM   ai_task_recommendations r
      LEFT JOIN tasks t ON t.source_recommendation_id = r.id
      WHERE  r.meeting_id = $1`;
    const { rows } = tenantId
      ? await db.query(`${base} AND r.tenant_id = $2 ORDER BY r.generated_at DESC`, [meetingId, tenantId])
      : await db.query(`${base} ORDER BY r.generated_at DESC`, [meetingId]);
    return rows.map(mapRow);
  },

  findPending: async (tenantId) => {
    const { rows } = await db.query(
      `SELECT * FROM ai_task_recommendations
       WHERE tenant_id = $1 AND approval_status = 'pending'
       ORDER BY generated_at DESC`,
      [tenantId]
    );
    return rows.map(mapRow);
  },

  // Edits allowed only while the recommendation is still pending.
  update: async (id, tenantId, fields) => {
    const ALLOWED = ['title', 'action_plan', 'business_impact', 'remediation_strategy',
                     'severity', 'category', 'recommended_owner', 'recommended_owner_type',
                     'due_date_suggestion', 'risk_reduction_score'];

    const setClauses = [];
    const values     = [];
    for (const [col, val] of Object.entries(fields)) {
      if (ALLOWED.includes(col)) {
        values.push(val);
        setClauses.push(`${col} = $${values.length}`);
      }
    }
    if (setClauses.length === 0) {
      throw Object.assign(new Error('No valid fields provided for update'), { statusCode: 400 });
    }

    values.push(id, tenantId);
    const { rows } = await db.query(
      `UPDATE ai_task_recommendations
       SET    ${setClauses.join(', ')}, updated_at = NOW()
       WHERE  id              = $${values.length - 1}
         AND  tenant_id       = $${values.length}
         AND  approval_status = 'pending'
       RETURNING *`,
      values
    );
    if (!rows[0]) {
      throw Object.assign(
        new Error('Recommendation not found or is no longer pending'),
        { statusCode: 404 }
      );
    }
    logger.info('AI recommendation updated', { id, tenantId });
    return mapRow(rows[0]);
  },

  approve: async (id, approvedBy, tenantId = null) => {
    const base = `
      UPDATE ai_task_recommendations
      SET    approval_status = 'approved',
             approved_by     = $1,
             approved_at     = NOW()
      WHERE  id = $2`;
    const { rows } = tenantId
      ? await db.query(`${base} AND tenant_id = $3 RETURNING *`, [approvedBy, id, tenantId])
      : await db.query(`${base} RETURNING *`, [approvedBy, id]);
    if (!rows[0]) throw Object.assign(new Error('Recommendation not found'), { statusCode: 404 });
    logger.info('AI recommendation approved', { id, approvedBy });
    return mapRow(rows[0]);
  },

  reject: async (id, rejectedReason, approvedBy, tenantId = null) => {
    const base = `
      UPDATE ai_task_recommendations
      SET    approval_status = 'rejected',
             rejected_reason = $1,
             approved_by     = $2,
             approved_at     = NOW()
      WHERE  id = $3`;
    const { rows } = tenantId
      ? await db.query(`${base} AND tenant_id = $4 RETURNING *`, [rejectedReason, approvedBy, id, tenantId])
      : await db.query(`${base} RETURNING *`, [rejectedReason, approvedBy, id]);
    if (!rows[0]) throw Object.assign(new Error('Recommendation not found'), { statusCode: 404 });
    logger.info('AI recommendation rejected', { id, approvedBy });
    return mapRow(rows[0]);
  },
};

module.exports = aiRecommendationRepository;
