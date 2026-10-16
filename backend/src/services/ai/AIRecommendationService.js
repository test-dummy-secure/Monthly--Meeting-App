'use strict';

const { randomUUID }            = require('crypto');
const db                        = require('../../config/db');
const customerRepository        = require('../../repositories/customer.repository');
const aiRecommendationRepository = require('../../repositories/ai-recommendation.repository');
const taskRepository            = require('../../repositories/task.repository');
const tenantAccessService       = require('../tenantAccess.service');
const auditLogRepository        = require('../../repositories/audit-log.repository');
const FindingsProvider          = require('./FindingsProvider');
const PromptBuilder             = require('./PromptBuilder');
const RecommendationGenerator   = require('./RecommendationGenerator');
const providerFactory           = require('./providerFactory');
const logger                    = require('../../utils/logger');

const httpError = (msg, code) => Object.assign(new Error(msg), { statusCode: code });

// ── In-memory analysis lock ───────────────────────────────────────────────────
// Prevents concurrent duplicate analysis runs for the same meeting.
// Node.js is single-threaded, so the Set is safe without mutex primitives:
// add() is called synchronously before the first await in analyze(), so two
// calls racing through setImmediate cannot both pass the has() check.
const _analyzingMeetings = new Set();

// ── Provider factory ─────────────────────────────────────────────────────────

function makeProvider(modelOverride) {
  return providerFactory.getPrimaryProvider(modelOverride);
}

function makeFallbackProvider(primary) {
  return providerFactory.getFallbackProvider(primary);
}

// ── Generate with automatic fallback ─────────────────────────────────────────

async function generateWithFallback({ provider, prompt, correlationId }) {
  try {
    return await RecommendationGenerator.generate({ provider, prompt, correlationId });
  } catch (primaryErr) {
    if (!providerFactory.isTransientAIError(primaryErr)) throw primaryErr;

    const fallback = makeFallbackProvider(provider);
    if (!fallback) {
      logger.warn('AI: primary provider failed, no fallback configured', {
        correlationId, primary: provider.name, error: primaryErr.message,
      });
      throw primaryErr;
    }

    logger.warn('AI: primary failed, retrying with fallback model', {
      correlationId, primary: provider.name, fallback: fallback.name, error: primaryErr.message,
    });
    return await RecommendationGenerator.generate({ provider: fallback, prompt, correlationId });
  }
}

// ─── Row mapper (includes new columns from migration 011) ────────────────────

const mapRec = (row) => ({
  id:                  row.id,
  tenantId:            row.tenant_id,
  meetingId:           row.meeting_id,
  findingId:           row.finding_id,
  title:               row.title,
  actionPlan:          row.action_plan,
  businessImpact:      row.business_impact,
  remediationStrategy: row.remediation_strategy,
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
  correlationId:       row.correlation_id,
  analysisType:        row.analysis_type || 'pre_meeting',
  generatedAt:         row.generated_at,
  createdAt:           row.created_at,
  taskId:              row.task_id        || null,
  clickupTaskId:       row.clickup_task_id || null,
  clickupUrl:          row.clickup_url    || null,
});

// ── Pre-meeting task title builder ────────────────────────────────────────────
// Constructs the task title directly from finding data so llama3.2's tendency
// to latch onto the device name rather than the security control is bypassed.
// Compliance-matrix finding titles follow two patterns from parseComplianceMatrixRows:
//   "<Control> missing / not configured — <Device> (<OS>)"
//   "<Control> non-compliant [<value>] — <Device> (<OS>)"
//   "<Control> missing / not configured — N devices"   ← aggregated
const TITLE_VERB_MAP = {
  'EDR Coverage':             'Deploy',
  'MFA':                      'Enforce',
  'Device Management':        'Enroll',
  'Configuration':            'Enable',
  'Patching':                 'Patch',
  'Access Control':           'Enforce',
  'Network Security':         'Configure',
  'Compliance':               'Remediate',
  'Vulnerability Management': 'Remediate',
  'Security Compliance':      'Remediate',
};

function buildPreMeetingTitle(finding) {
  const t = finding.title || '';

  // Per-device: "CrowdStrike EDR missing / not configured — MURARI-190221 (Win11 25H2)"
  //             "JumpCloud MDM non-compliant [Not Enrolled] — AKSHIT-270625"
  const perDevice = t.match(
    /^(.+?)\s+(?:missing\s*\/\s*not\s+configured|non-compliant\s*\[[^\]]*\])\s+—\s+(.+)$/i
  );
  if (perDevice) {
    const control = perDevice[1].trim();
    const device  = perDevice[2].trim();
    const verb    = TITLE_VERB_MAP[finding.category] || 'Remediate';
    return `${verb} ${control} on ${device}`.slice(0, 255);
  }

  // Aggregated: "CrowdStrike EDR missing / not configured — 4 devices"
  const agg = t.match(/^(.+?)\s+missing\s*(?:\/\s*not\s+configured)?\s+—\s+(\d+\s+devices?)$/i);
  if (agg) {
    const control = agg[1].trim();
    const scope   = agg[2].trim();
    const verb    = TITLE_VERB_MAP[finding.category] || 'Deploy';
    return `${verb} ${control} on ${scope}`.slice(0, 255);
  }

  return null; // non-compliance-matrix finding — let AI generate the title
}

// ─── Service ─────────────────────────────────────────────────────────────────

const AIRecommendationService = {

  /**
   * Runs AI analysis for a tenant meeting.
   * Loads findings + context → builds prompt → calls Ollama → validates → persists.
   * Also increments carry_forward_count on still-open tasks from previous meeting cycles.
   * Returns the persisted recommendation rows.
   */
  /** Returns true if an analysis is currently running for the given meetingId. */
  isAnalyzing(meetingId) {
    return _analyzingMeetings.has(meetingId);
  },

  async analyze({ tenantId, meetingId, user, model }) {
    // Guard: reject concurrent duplicate analysis for the same meeting.
    // add() is called synchronously before the first await so two racing
    // setImmediate callbacks cannot both slip through.
    if (_analyzingMeetings.has(meetingId)) {
      logger.warn('AI analysis rejected — already in progress', { meetingId, tenantId });
      throw httpError('AI analysis is already running for this meeting. Please wait for it to complete.', 409);
    }
    _analyzingMeetings.add(meetingId);

    const correlationId = randomUUID();
    logger.info('AI analysis started', { correlationId, tenantId, meetingId, user: user.email, model: model || 'default' });

    try {

    // 1. Access check
    await tenantAccessService.ensureTenantAccess(user, tenantId);

    // 2. Validate meeting belongs to tenant
    const { rows: mtgRows } = await db.query(
      `SELECT id, meeting_type FROM meetings WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [meetingId, tenantId]
    );
    if (!mtgRows[0]) throw httpError('Meeting not found or access denied', 404);

    // 3. Load tenant profile
    const tenant = await customerRepository.findById(tenantId);
    if (!tenant) throw httpError('Tenant not found', 404);

    // 4. Load findings from DB first (persisted, never expires).
    //    FindingsProvider reads Redis which has a 12-hour TTL — after expiry it returns 0 findings
    //    and the analysis produces no tasks. The DB findings table is the reliable source.
    const { rows: dbFindingRows } = await db.query(
      `SELECT source_finding_id AS "sourceFindingId",
              severity, category, title, description,
              system_affected AS "systemAffected"
       FROM findings
       WHERE meeting_id = $1
       ORDER BY CASE severity
                  WHEN 'critical' THEN 0
                  WHEN 'high'     THEN 1
                  WHEN 'medium'   THEN 2
                  ELSE 3
                END`,
      [meetingId]
    );

    const findingsSource = dbFindingRows.length > 0 ? 'db' : 'redis/nxg360';
    const findings = dbFindingRows.length > 0
      ? dbFindingRows.map((f) => ({ ...f, affectedCount: 0, riskScore: 50 }))
      : await FindingsProvider.getNormalized(tenantId);

    if (findings.length === 0) {
      throw httpError('No findings available for this meeting. Upload a findings file first.', 422);
    }

    logger.info('AI analysis: findings loaded', {
      correlationId,
      source:   findingsSource,
      total:    findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      high:     findings.filter((f) => f.severity === 'high').length,
      medium:   findings.filter((f) => f.severity === 'medium').length,
      low:      findings.filter((f) => f.severity === 'low').length,
    });

    // 5. Load context in parallel
    const [openTasksResult, carryForwardResult, previousNotesResult] = await Promise.all([
      db.query(
        `SELECT title, remediation_status, owner_name, due_date, carry_forward_count
         FROM tasks
         WHERE tenant_id = $1 AND remediation_status NOT IN ('closed', 'completed', 'escalated')
         ORDER BY COALESCE(due_date, created_at) ASC
         LIMIT 20`,
        [tenantId]
      ),
      db.query(
        `SELECT title, remediation_status, owner_name, due_date, carry_forward_count
         FROM tasks
         WHERE tenant_id = $1 AND carry_forward_count > 0
           AND remediation_status NOT IN ('closed', 'completed')
         ORDER BY carry_forward_count DESC
         LIMIT 10`,
        [tenantId]
      ),
      db.query(
        `SELECT mn.summary,
                mn.action_items      AS "actionItems",
                mn.decisions_taken   AS "decisionsTaken"
         FROM   meeting_notes mn
         JOIN   meetings m ON m.id = mn.meeting_id
         WHERE  m.tenant_id   = $1
           AND  mn.ai_status  = 'completed'
           AND  mn.meeting_id != $2
         ORDER  BY mn.created_at DESC
         LIMIT  1`,
        [tenantId, meetingId]
      ),
    ]);

    const openTasks = openTasksResult.rows.map((r) => ({
      title:             r.title,
      remediationStatus: r.remediation_status,
      ownerName:         r.owner_name,
      dueDate:           r.due_date,
      carryForwardCount: r.carry_forward_count,
    }));

    const carryForwardTasks = carryForwardResult.rows.map((r) => ({
      title:             r.title,
      carryForwardCount: r.carry_forward_count,
      dueDate:           r.due_date,
    }));

    // previousNotes kept for future use in carry-forward context
    void carryForwardTasks;
    void previousNotesResult;

    // 6. (carry_forward_count is incremented by task.repository.carryForwardTasks when
    //    a meeting closes — NOT here. Incrementing on every analyze() call caused counts
    //    to grow by one on every re-analysis click rather than once per meeting cycle.)

    // 7. Per-finding generation — the only reliable approach with llama3.2.
    //    Batch calls (even 5 findings at once) always produce exactly 1 task because llama3.2
    //    treats the JSON schema example as "output one object." generateOne is called once per
    //    finding with a single-finding focused prompt, guaranteeing 1 task per call.
    const provider = makeProvider(model);

    // Dynamic per-severity slot allocation.
    // Problem with a single .slice(0, N) on a priority-sorted array: if one tenant has
    // 64 critical findings (e.g. CrowdStrike missing on every device), all N slots are
    // consumed by critical and medium/low never get a single task generated.
    //
    // Solution — two phases:
    //   Phase 1: Guarantee AI_MIN_TASKS_PER_SEVERITY (default 3) tasks for every severity
    //            level that actually has findings in this tenant's report.
    //   Phase 2: Fill remaining slots up to AI_MAX_TASKS_PER_ANALYSIS (default 30) with
    //            leftover findings in priority order (critical first).
    //
    // Both constants are overridable via env so no tenant-specific hardcoding is needed.
    const MAX_TASKS   = parseInt(process.env.AI_MAX_TASKS_PER_ANALYSIS   || '30', 10);
    const MIN_PER_SEV = parseInt(process.env.AI_MIN_TASKS_PER_SEVERITY   || '3',  10);
    const SEV_ORDER   = ['critical', 'high', 'medium', 'low'];

    const bySev = Object.fromEntries(
      SEV_ORDER.map((s) => [s, findings.filter((f) => f.severity === s)])
    );

    // Phase 1 — guaranteed minimum per severity that has findings
    const guaranteed = [];
    for (const sev of SEV_ORDER) {
      if (bySev[sev].length) guaranteed.push(...bySev[sev].slice(0, MIN_PER_SEV));
    }

    // Phase 2 — fill remaining slots with overflow in priority order
    const slotsLeft = Math.max(0, MAX_TASKS - guaranteed.length);
    const overflow   = SEV_ORDER.flatMap((s) => bySev[s].slice(MIN_PER_SEV));
    const priorityFindings = [...guaranteed, ...overflow.slice(0, slotsLeft)];

    // 8. Delete stale pending recs BEFORE the generation loop so each task is inserted
    //    as soon as it's generated — frontend polling sees tasks appear one by one
    //    rather than waiting for all 10 calls to complete (~5 min) before anything shows.
    await db.query(
      `DELETE FROM ai_task_recommendations
       WHERE meeting_id = $1 AND tenant_id = $2 AND approval_status = 'pending'`,
      [meetingId, tenantId]
    );

    const seenTitles    = new Set();
    const recommendations = [];

    // Pre-seed seenTitles with titles the user has already approved or rejected so
    // Re-Analyze never creates a duplicate pending copy of an already-actioned task.
    // This is the primary guard; the per-insert DB check below is the safety net.
    const { rows: actioned } = await db.query(
      `SELECT LOWER(TRIM(title)) AS title_key
       FROM ai_task_recommendations
       WHERE meeting_id = $1 AND tenant_id = $2
         AND approval_status IN ('approved', 'rejected')`,
      [meetingId, tenantId]
    );
    for (const { title_key } of actioned) {
      if (title_key) seenTitles.add(title_key);
    }

    logger.info('AI analysis: pre-seeded dedup set', {
      correlationId, skipping: seenTitles.size,
    });

    // Helper: ISO date N days from today — mirrors PromptBuilder.addDays
    const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

    // Owner map — deterministic, mirrors PromptBuilder.buildPreMeetingFinding OWNER_MAP
    const OWNER_MAP = {
      Devices:    { name: `${tenant.name} IT Operations Team`,  type: 'CUSTOMER' },
      Identity:   { name: 'Identity & Access Management Team',  type: 'SHARED' },
      Response:   { name: 'Security Operations Center (SOC)',    type: 'ACCOUNT_MANAGER' },
      Compliance: { name: 'Security & Compliance Team',          type: 'SHARED' },
      Code:       { name: `${tenant.name} DevSecOps Team`,      type: 'CUSTOMER' },
      Network:    { name: 'Network Security Team',               type: 'ACCOUNT_MANAGER' },
    };

    for (const finding of priorityFindings) {
      const sevLower     = (finding.severity || 'medium').toLowerCase();
      // Derive the task title from the finding structure so llama3.2 only needs to
      // generate actionPlan and businessImpact — not guess the control name from the title.
      const derivedTitle = buildPreMeetingTitle(finding);
      const findingPrompt = PromptBuilder.buildPreMeetingFinding({ tenant, finding, openTasks, taskTitle: derivedTitle });

      // Pre-compute deterministic fields — override whatever the model generates.
      // title is included when derivable so the correct control name always appears.
      const preFields = {
        ...(derivedTitle ? { title: derivedTitle } : {}),
        severity:             finding.severity,
        remediationStrategy:  { critical: 'immediate_fix', high: 'immediate_fix', medium: 'long_term_fix', low: 'long_term_fix' }[sevLower] || 'long_term_fix',
        riskReductionScore:   { critical: 92, high: 78, medium: 55, low: 35 }[sevLower] || 55,
        category:             finding.category || null,
        dueDateSuggestion:    { critical: addDays(14), high: addDays(30), medium: addDays(90), low: addDays(90) }[sevLower] || addDays(90),
        recommendedOwner:     (OWNER_MAP[finding.category] || { name: 'Security Operations Team' }).name,
        recommendedOwnerType: (OWNER_MAP[finding.category] || { type: 'ACCOUNT_MANAGER' }).type,
      };

      logger.info('AI per-finding started', {
        correlationId,
        finding:  finding.title,
        severity: finding.severity,
      });

      try {
        const rec = await RecommendationGenerator.generateOne({
          provider,
          prompt:     findingPrompt,
          correlationId,
          maxTokens:  1000,  // full JSON with 4-step action plan needs 600-800 tokens; 1000 is safe headroom
          numCtx:     4096,  // compliance matrix descriptions are longer; 4k avoids KV-cache overflow
        });

        // Enforce all pre-computed fields — override anything the model got wrong.
        // This eliminates template placeholder text leaking into production data.
        Object.assign(rec, preFields);

        // In-memory dedup: skip if same title already generated in this run.
        const titleKey = rec.title.trim().toLowerCase();
        if (seenTitles.has(titleKey)) {
          logger.info('AI per-finding: in-memory duplicate skipped', { correlationId, title: rec.title });
          continue;
        }
        seenTitles.add(titleKey);

        // DB-level dedup: safety net in case two runs overlap despite the lock,
        // or a title was edited after approval causing the in-memory set to miss it.
        // Checks pending AND approved — never regenerate a task the user already acted on.
        const { rows: existing } = await db.query(
          `SELECT id FROM ai_task_recommendations
           WHERE meeting_id = $1 AND approval_status IN ('pending', 'approved')
             AND LOWER(TRIM(title)) = LOWER(TRIM($2))
           LIMIT 1`,
          [meetingId, rec.title]
        );
        if (existing.length > 0) {
          logger.info('AI per-finding: DB-level duplicate skipped', { correlationId, title: rec.title });
          continue;
        }

        // Insert immediately so frontend polling sees the task right away.
        const { rows } = await db.query(
          `INSERT INTO ai_task_recommendations (
             tenant_id, meeting_id, title, action_plan, business_impact,
             remediation_strategy, risk_reduction_score, severity, category,
             recommended_owner, recommended_owner_type, due_date_suggestion,
             ai_model, ai_confidence, raw_ai_response, correlation_id, analysis_type
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pre_meeting')
           RETURNING *`,
          [
            tenantId,
            meetingId,
            rec.title,
            rec.actionPlan,
            rec.businessImpact       || null,
            rec.remediationStrategy  || null,
            rec.riskReductionScore   || 0,
            rec.severity,
            rec.category             || null,
            rec.recommendedOwner     || null,
            rec.recommendedOwnerType || null,
            rec.dueDateSuggestion    || null,
            provider.name,
            rec.aiConfidence != null ? rec.aiConfidence : null,
            JSON.stringify({ correlationId, findingsSource }),
            correlationId,
          ]
        );
        recommendations.push(mapRec(rows[0]));

        logger.info('AI per-finding complete + saved', {
          correlationId,
          finding: finding.title,
          task:    rec.title,
          totalSoFar: recommendations.length,
        });
      } catch (err) {
        if (err.code === 'OLLAMA_TIMEOUT') throw err;

        logger.warn('AI per-finding: generateOne failed — building description fallback', {
          correlationId,
          finding:    finding.title,
          errorCode:  err.code,
          error:      err.message,
          rawPreview: err.rawPreview || '(not captured)',
        });

        // Build a task directly from the finding's own data.
        // Compliance matrix findings already contain structured remediation steps
        // in their description so a useful task can be created without the LLM.
        try {
          const FALLBACK_VERB = { critical: 'Remediate', high: 'Enforce', medium: 'Configure', low: 'Review' };
          const sevLower = (finding.severity || 'medium').toLowerCase();

          // Strip the status clause ("missing / not configured — ") to get a clean subject.
          const cleanSubject = finding.title
            .replace(/\s+(missing\s*\/\s*not\s+configured|non-compliant\s*\[[^\]]*\])\s+—\s+/i, ' on ')
            .replace(/\s+—\s+/, ' on ')
            .slice(0, 80);
          const fallbackTitle = `${FALLBACK_VERB[sevLower] || 'Remediate'}: ${cleanSubject}`.slice(0, 255);

          // Build context-aware fallback steps from the finding's structured data.
          // Title format (post-derivedTitle): "Deploy/Enable/Enforce <Control> on <Device> (OS)"
          // Title format (raw parser):        "<Control> missing / not configured — <Device> (OS)"
          // Extract control and device from whichever format is present.
          const controlExtract = finding.title.match(/^(.+?)\s+(?:missing\s*\/\s*not\s+configured|non-compliant)/i);
          const controlName    = controlExtract ? controlExtract[1].trim() : (finding.category || 'the security control');
          const deviceName     = finding.systemAffected || 'the affected device';
          const assignedUser   = finding.description?.match(/Assigned user:\s*(.+?)(?:\s*\n|$)/i)?.[1]?.trim() || null;

          const fallbackActionPlan = [
            `1. Locate ${deviceName} in the ${controlName} management console and confirm the control is not active.`,
            `2. Contact the IT administrator for ${deviceName} and direct them to deploy or configure ${controlName}.`,
            assignedUser
              ? `3. Notify ${assignedUser} of the required action and set a deadline for completion.`
              : `3. Verify ${deviceName} appears compliant in the ${controlName} console within 24 hours of remediation.`,
            `4. Document the remediation date and update the compliance tracker.`,
          ].join(' ');

          const fallbackBusinessImpact =
            `Without remediation, ${finding.systemAffected || 'this device'} remains non-compliant, ` +
            `increasing the organisation's attack surface and audit risk.`;

          const fallbackRec = Object.assign(
            { title: fallbackTitle, actionPlan: fallbackActionPlan, businessImpact: fallbackBusinessImpact, aiConfidence: null },
            preFields
          );

          const fbKey = fallbackRec.title.trim().toLowerCase();
          if (!seenTitles.has(fbKey)) {
            seenTitles.add(fbKey);

            const { rows: fbExist } = await db.query(
              `SELECT id FROM ai_task_recommendations
               WHERE meeting_id = $1 AND approval_status IN ('pending', 'approved')
                 AND LOWER(TRIM(title)) = LOWER(TRIM($2))
               LIMIT 1`,
              [meetingId, fallbackRec.title]
            );

            if (fbExist.length === 0) {
              const { rows: fbRows } = await db.query(
                `INSERT INTO ai_task_recommendations (
                   tenant_id, meeting_id, title, action_plan, business_impact,
                   remediation_strategy, risk_reduction_score, severity, category,
                   recommended_owner, recommended_owner_type, due_date_suggestion,
                   ai_model, ai_confidence, raw_ai_response, correlation_id, analysis_type
                 )
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pre_meeting')
                 RETURNING *`,
                [
                  tenantId, meetingId,
                  fallbackRec.title,        fallbackRec.actionPlan,
                  fallbackRec.businessImpact  || null,
                  fallbackRec.remediationStrategy || null,
                  fallbackRec.riskReductionScore  || 0,
                  fallbackRec.severity,
                  fallbackRec.category            || null,
                  fallbackRec.recommendedOwner    || null,
                  fallbackRec.recommendedOwnerType || null,
                  fallbackRec.dueDateSuggestion   || null,
                  'description-fallback', null,
                  JSON.stringify({ correlationId, findingsSource, fallback: true }),
                  correlationId,
                ]
              );
              recommendations.push(mapRec(fbRows[0]));
              logger.info('AI per-finding: fallback task saved', {
                correlationId, finding: finding.title, task: fallbackRec.title,
              });
            }
          }
        } catch (fallbackErr) {
          logger.error('AI per-finding: fallback also failed — finding skipped', {
            correlationId, finding: finding.title, error: fallbackErr.message,
          });
        }
      }
    }

    auditLogRepository.create(tenantId, user.email, 'ai_analysis_completed', {
      correlationId,
      meetingId,
      count: recommendations.length,
      provider: provider.name,
    }).catch(() => {});

    logger.info('AI analysis complete', {
      correlationId,
      findingsProcessed: priorityFindings.length,
      persisted:         recommendations.length,
      findingsSource,
      tenantId,
    });

    return recommendations;

    } finally {
      // Always release the lock so a future re-analysis can run.
      _analyzingMeetings.delete(meetingId);
    }
  },

  /**
   * Lists recommendations for accessible tenants with optional filters.
   * analysisType: 'pre_meeting' | 'post_meeting' — omit to return both.
   */
  async listRecommendations({ user, tenantId, meetingId, status, analysisType }) {
    const scopedTenantId = await tenantAccessService.resolveTenantId(user, tenantId);
    const tenantIds = scopedTenantId
      ? [scopedTenantId]
      : await tenantAccessService.getAccessibleTenantIds(user);

    if (tenantIds.length === 0) return [];

    const conditions = ['r.tenant_id = ANY($1)'];
    const params     = [tenantIds];

    if (meetingId) {
      params.push(meetingId);
      conditions.push(`r.meeting_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`r.approval_status = $${params.length}`);
    }

    if (analysisType) {
      params.push(analysisType);
      conditions.push(`r.analysis_type = $${params.length}`);
    }

    const { rows } = await db.query(
      `SELECT r.*, c.name AS customer_name,
              t.id AS task_id, t.clickup_task_id, t.clickup_url
       FROM ai_task_recommendations r
       JOIN customers c ON c.id = r.tenant_id
       LEFT JOIN tasks t ON t.source_recommendation_id = r.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.generated_at DESC
       LIMIT 200`,
      params
    );

    return rows.map((row) => ({ ...mapRec(row), customerName: row.customer_name }));
  },

  /**
   * Get a single recommendation by ID (with tenant isolation).
   */
  async getRecommendation({ id, user }) {
    const accessibleIds = await tenantAccessService.getAccessibleTenantIds(user);
    const { rows } = await db.query(
      `SELECT r.*, c.name AS customer_name
       FROM ai_task_recommendations r
       JOIN customers c ON c.id = r.tenant_id
       WHERE r.id = $1 AND r.tenant_id = ANY($2)
       LIMIT 1`,
      [id, accessibleIds]
    );
    if (!rows[0]) throw httpError('Recommendation not found', 404);
    return { ...mapRec(rows[0]), customerName: rows[0].customer_name };
  },

  /**
   * Approve a recommendation — creates a real tracker task.
   * This is the ONLY code path that creates tasks from AI recommendations.
   */
  async approveRecommendation({ id, user, tenantId }) {
    await tenantAccessService.ensureTenantAccess(user, tenantId);

    const approvedBy = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;

    // Update recommendation status
    const rec = await aiRecommendationRepository.approve(id, approvedBy, tenantId);

    // Create tracker task from the approved recommendation
    const task = await taskRepository.createFromRecommendation(rec);

    auditLogRepository.create(tenantId, user.email, 'ai_recommendation_approved', {
      recommendationId: id,
      taskId: task.id,
      title: rec.title,
    }).catch(() => {});

    // Push approved task to ClickUp (fire-and-forget — never blocks the approve response)
    const { enqueueClickUpPush } = require('../../jobs/clickup-push.job');
    enqueueClickUpPush(task.id, tenantId).catch((err) => {
      logger.warn('ClickUp enqueue failed (non-fatal)', { taskId: task.id, error: err.message });
    });

    logger.info('AI recommendation approved → task created', {
      recommendationId: id,
      taskId: task.id,
      tenantId,
      approvedBy,
    });

    return { recommendation: rec, task };
  },

  /**
   * Returns live provider config: currently configured model, fallback, and
   * the list of models installed on this Ollama instance (from /api/tags).
   */
  async getProviderConfig() {
    const base          = (process.env.OLLAMA_BASE_URL || '').replace(/\/+$/, '');
    const primaryModel  = process.env.OLLAMA_MODEL          || 'llama3.1';
    const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || null;
    const configured    = !!base;

    let availableModels = [];
    let online = false;
    if (configured) {
      try {
        const ctrl  = new AbortController();
        setTimeout(() => ctrl.abort(), 5000);
        const res   = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          availableModels = (data.models || []).map((m) => ({
            name:       m.name,
            size:       m.size,
            modifiedAt: m.modified_at,
          }));
          online = true;
        }
      } catch {
        // Ollama unreachable — online stays false, don't crash
      }
    }

    return {
      provider:        'ollama',
      baseUrl:         base || null,
      configured,
      online,
      primaryModel,
      fallbackModel,
      availableModels,
      maxPromptChars:  parseInt(process.env.AI_MAX_PROMPT_CHARS || '24000', 10),
    };
  },

  /**
   * Reject a recommendation — stored for audit history, never deleted.
   */
  async rejectRecommendation({ id, user, tenantId, reason }) {
    await tenantAccessService.ensureTenantAccess(user, tenantId);

    const rejectedBy = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
    const rec = await aiRecommendationRepository.reject(
      id,
      reason || 'Rejected by account manager',
      rejectedBy,
      tenantId
    );

    auditLogRepository.create(tenantId, user.email, 'ai_recommendation_rejected', {
      recommendationId: id,
      reason,
    }).catch(() => {});

    logger.info('AI recommendation rejected', { recommendationId: id, tenantId, rejectedBy });

    return { recommendation: rec };
  },

  /**
   * Update editable fields on a pending recommendation.
   * Only allowed while approval_status = 'pending' — once approved/rejected the
   * record is immutable (the task was already created from the original values).
   */
  async updateRecommendation({ id, user, tenantId, fields }) {
    await tenantAccessService.ensureTenantAccess(user, tenantId);

    const VALID_SEVERITIES  = new Set(['critical', 'high', 'medium', 'low']);
    const VALID_STRATEGIES  = new Set(['immediate_fix', 'workaround', 'long_term_fix', 'escalation']);
    const VALID_OWNER_TYPES = new Set(['CUSTOMER', 'ACCOUNT_MANAGER', 'SHARED']);
    const DATE_RE           = /^\d{4}-\d{2}-\d{2}$/;

    // Map camelCase input → DB column names, validating each field
    const dbFields = {};

    if (fields.title !== undefined) {
      if (!fields.title || typeof fields.title !== 'string' || !fields.title.trim()) {
        throw Object.assign(new Error('title must be a non-empty string'), { statusCode: 400 });
      }
      dbFields.title = fields.title.trim().slice(0, 255);
    }
    if (fields.actionPlan !== undefined) {
      dbFields.action_plan = String(fields.actionPlan).trim() || null;
    }
    if (fields.businessImpact !== undefined) {
      dbFields.business_impact = fields.businessImpact ? String(fields.businessImpact).trim() : null;
    }
    if (fields.severity !== undefined) {
      const sev = (fields.severity || '').toLowerCase();
      if (!VALID_SEVERITIES.has(sev)) {
        throw Object.assign(new Error(`severity must be one of: ${[...VALID_SEVERITIES].join(', ')}`), { statusCode: 400 });
      }
      dbFields.severity = sev;
    }
    if (fields.category !== undefined) {
      dbFields.category = fields.category ? String(fields.category).trim().slice(0, 100) : null;
    }
    if (fields.remediationStrategy !== undefined) {
      if (!VALID_STRATEGIES.has(fields.remediationStrategy)) {
        throw Object.assign(new Error(`remediationStrategy must be one of: ${[...VALID_STRATEGIES].join(', ')}`), { statusCode: 400 });
      }
      dbFields.remediation_strategy = fields.remediationStrategy;
    }
    if (fields.recommendedOwner !== undefined) {
      dbFields.recommended_owner = fields.recommendedOwner ? String(fields.recommendedOwner).trim().slice(0, 200) : null;
    }
    if (fields.recommendedOwnerType !== undefined) {
      const owt = (fields.recommendedOwnerType || '').toUpperCase();
      if (!VALID_OWNER_TYPES.has(owt)) {
        throw Object.assign(new Error(`recommendedOwnerType must be one of: ${[...VALID_OWNER_TYPES].join(', ')}`), { statusCode: 400 });
      }
      dbFields.recommended_owner_type = owt;
    }
    if (fields.dueDateSuggestion !== undefined) {
      if (fields.dueDateSuggestion && !DATE_RE.test(fields.dueDateSuggestion)) {
        throw Object.assign(new Error('dueDateSuggestion must be YYYY-MM-DD'), { statusCode: 400 });
      }
      dbFields.due_date_suggestion = fields.dueDateSuggestion || null;
    }
    if (fields.riskReductionScore !== undefined) {
      const score = Number(fields.riskReductionScore);
      if (Number.isNaN(score) || score < 0 || score > 100) {
        throw Object.assign(new Error('riskReductionScore must be 0–100'), { statusCode: 400 });
      }
      dbFields.risk_reduction_score = Math.round(score);
    }

    if (Object.keys(dbFields).length === 0) {
      throw Object.assign(new Error('No valid fields to update'), { statusCode: 400 });
    }

    const rec = await aiRecommendationRepository.update(id, tenantId, dbFields);

    auditLogRepository.create(tenantId, user.email, 'ai_recommendation_updated', {
      recommendationId: id,
      updatedFields: Object.keys(dbFields),
    }).catch(() => {});

    logger.info('AI recommendation updated', { recommendationId: id, tenantId, fields: Object.keys(dbFields) });

    return { recommendation: rec };
  },
};

module.exports = AIRecommendationService;
