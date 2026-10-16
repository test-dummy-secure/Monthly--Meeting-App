const db     = require('../database/index');
const logger = require('../utils/logger');

// ─── Row mapper ──────────────────────────────────────────────────────────────

const mapRow = (row) => ({
  id:                  row.id,
  meetingId:           row.meeting_id,
  findingId:           row.finding_id,
  tenantId:            row.tenant_id,
  title:               row.title,
  description:         row.description         || null,
  actionPlan:          row.action_plan,
  riskReductionScore:  row.risk_reduction_score,
  approvalStatus:      row.approval_status,
  remediationStatus:   row.remediation_status,
  status:              row.remediation_status,
  reviewOutcome:       row.review_outcome,
  escalationStatus:    row.escalation_status,
  escalationHistory:   row.escalation_history  || [],
  ownerType:           row.owner_type           || 'ACCOUNT_MANAGER',
  ownershipTeam:       row.ownership_team,
  ownerName:           row.owner_name,
  ownerEmail:          row.owner_email          || null,
  ownerDepartment:     row.owner_department     || null,
  blockerReason:       row.blocker_reason       || null,
  dueDate:             row.due_date,
  completedAt:         row.completed_at         || null,
  progressPercentage:  row.progress_percentage  || 0,
  priority:            row.priority             || 'medium',
  carryForwardCount:   row.carry_forward_count  || 0,
  escalationCount:     row.escalation_count     || 0,
  meetingTimeline:     row.meeting_timeline,
  primaryOwner:        row.primary_owner        || null,
  secondaryOwner:      row.secondary_owner      || null,
  timeline:            row.timeline             || [],
  notes:               row.notes,
  createdBy:           row.created_by           || null,
  originalMeetingId:   row.original_meeting_id  || null,
  lastUpdatedDate:     row.last_updated_at      || row.created_at,
  createdAt:           row.created_at,
  // joined columns
  sourceFindingId:     row.source_finding_id,
  severity:            row.severity,
  category:            row.category,
  systemAffected:      row.system_affected,
  customerName:        row.customer_name,
});

const TASK_SELECT = `
  SELECT t.id,
         t.meeting_id,
         t.finding_id,
         t.tenant_id,
         t.title,
         t.description,
         t.action_plan,
         t.risk_reduction_score,
         t.approval_status,
         t.remediation_status,
         t.review_outcome,
         t.escalation_status,
         t.escalation_history,
         t.owner_type,
         t.ownership_team,
         t.owner_name,
         t.owner_email,
         t.owner_department,
         t.blocker_reason,
         t.due_date,
         t.completed_at,
         t.progress_percentage,
         t.priority,
         t.carry_forward_count,
         t.escalation_count,
         t.meeting_timeline,
         t.primary_owner,
         t.secondary_owner,
         t.timeline,
         t.notes,
         t.created_by,
         t.original_meeting_id,
         t.last_updated_at,
         t.created_at,
         f.source_finding_id,
         f.severity,
         f.category,
         f.system_affected,
         c.name AS customer_name
  FROM   tasks t
  JOIN   meetings  m ON m.id = t.meeting_id
  LEFT JOIN findings f ON f.id = t.finding_id
  JOIN   customers c ON c.id = t.tenant_id
`;

// ─── Repository ──────────────────────────────────────────────────────────────

const taskRepository = {

  findByTenant: async (tenantId) => {
    const { rows } = await db.query(
      `${TASK_SELECT}
       WHERE t.tenant_id = $1
       ORDER BY COALESCE(t.due_date, t.created_at) DESC`,
      [tenantId]
    );
    return rows.map(mapRow);
  },

  // Unbounded fetch for internal background jobs — approved, non-cancelled tasks only.
  // Not for API use: no pagination, no LIMIT. Scoped strictly to one tenant.
  findApprovedByTenant: async (tenantId) => {
    const { rows } = await db.query(
      `${TASK_SELECT}
       WHERE t.tenant_id      = $1
         AND t.approval_status = 'approved'
         AND t.remediation_status NOT IN ('cancelled')
       ORDER BY COALESCE(t.due_date, t.created_at) DESC`,
      [tenantId]
    );
    return rows.map(mapRow);
  },

  findByMeeting: async (meetingId) => {
    const { rows } = await db.query(
      `${TASK_SELECT}
       WHERE t.meeting_id = $1
       ORDER BY t.created_at DESC`,
      [meetingId]
    );
    return rows.map(mapRow);
  },

  findById: async (taskId, tenantId = null) => {
    const base = `${TASK_SELECT} WHERE t.id = $1`;
    const { rows } = tenantId
      ? await db.query(`${base} AND t.tenant_id = $2 LIMIT 1`, [taskId, tenantId])
      : await db.query(`${base} LIMIT 1`, [taskId]);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  // Paginated list for Joint Action Tracker with flexible filters.
  // status 'active'        → open / in_progress / blocked / overdue / awaiting_validation
  // status 'carry_forward' → carry_forward_count > 0, not done
  // status 'done'          → completed / closed / cancelled
  // any other value        → exact remediation_status match
  findActionItems: async (tenantId, { status, ownerType, meetingId, search, page = 1, pageSize = 50 } = {}) => {
    const conditions = ["t.tenant_id = $1", "t.approval_status = 'approved'"];
    const params     = [tenantId];

    if (status) {
      if (status === 'active') {
        conditions.push("t.remediation_status IN ('open','in_progress','blocked','overdue','awaiting_validation')");
      } else if (status === 'carry_forward') {
        conditions.push('t.carry_forward_count > 0');
        conditions.push("t.remediation_status NOT IN ('completed','closed','cancelled')");
      } else if (status === 'done') {
        conditions.push("t.remediation_status IN ('completed','closed','cancelled')");
      } else {
        params.push(status);
        conditions.push(`t.remediation_status = $${params.length}`);
      }
    }

    if (ownerType) {
      params.push(ownerType);
      conditions.push(`t.owner_type = $${params.length}`);
    }

    if (meetingId) {
      params.push(meetingId);
      conditions.push(`t.meeting_id = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      const pidx = params.length;
      conditions.push(`(t.title ILIKE $${pidx} OR COALESCE(t.description,'') ILIKE $${pidx})`);
    }

    const whereStr  = conditions.join(' AND ');
    const baseParams = [...params];

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM tasks t WHERE ${whereStr}`,
      baseParams
    );

    params.push(pageSize);
    const limitParam  = params.length;
    params.push((page - 1) * pageSize);
    const offsetParam = params.length;

    const { rows } = await db.query(
      `${TASK_SELECT}
       WHERE ${whereStr}
       ORDER BY COALESCE(t.due_date, t.created_at) DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    return {
      items:    rows.map(mapRow),
      total:    parseInt(countRows[0].count) || 0,
      page,
      pageSize,
    };
  },

  getActionItemStats: async (tenantId) => {
    const { rows } = await db.query(
      `SELECT
         COUNT(*)                                                                           AS total,
         COUNT(*) FILTER (WHERE t.remediation_status = 'open')                            AS open_count,
         COUNT(*) FILTER (WHERE t.remediation_status = 'in_progress')                     AS in_progress_count,
         COUNT(*) FILTER (WHERE t.remediation_status = 'blocked')                         AS blocked_count,
         COUNT(*) FILTER (WHERE t.remediation_status = 'escalated')                       AS escalated_count,
         COUNT(*) FILTER (WHERE t.remediation_status = 'carry_forward')                   AS carry_forward_count,
         COUNT(*) FILTER (WHERE t.remediation_status IN ('completed','closed'))            AS completed_count,
         COUNT(*) FILTER (WHERE t.remediation_status = 'cancelled')                       AS cancelled_count,
         COUNT(*) FILTER (WHERE t.remediation_status = 'overdue')                         AS overdue_count,
         COUNT(*) FILTER (WHERE t.due_date < NOW()
                           AND  t.remediation_status NOT IN ('completed','closed','cancelled')) AS past_due_count,
         COUNT(*) FILTER (WHERE t.owner_type = 'CUSTOMER')                                AS customer_owned,
         COUNT(*) FILTER (WHERE t.owner_type = 'ACCOUNT_MANAGER')                         AS am_owned,
         COUNT(*) FILTER (WHERE t.owner_type = 'SHARED')                                  AS shared_owned
       FROM tasks t
       WHERE t.tenant_id = $1 AND t.approval_status = 'approved'`,
      [tenantId]
    );
    const r = rows[0];
    return {
      total:        parseInt(r.total)              || 0,
      open:         parseInt(r.open_count)         || 0,
      inProgress:   parseInt(r.in_progress_count)  || 0,
      blocked:      parseInt(r.blocked_count)      || 0,
      escalated:    parseInt(r.escalated_count)    || 0,
      carryForward: parseInt(r.carry_forward_count) || 0,
      completed:    parseInt(r.completed_count)    || 0,
      cancelled:    parseInt(r.cancelled_count)    || 0,
      overdue:      parseInt(r.overdue_count)      || 0,
      pastDue:      parseInt(r.past_due_count)     || 0,
      byOwnerType: {
        CUSTOMER:        parseInt(r.customer_owned) || 0,
        ACCOUNT_MANAGER: parseInt(r.am_owned)       || 0,
        SHARED:          parseInt(r.shared_owned)   || 0,
      },
    };
  },

  // Dynamic field update for action item management.
  updateActionItem: async (taskId, updates, tenantId = null) => {
    const setClauses = [];
    const params     = [];

    const addField = (col, val) => {
      params.push(val);
      setClauses.push(`${col} = $${params.length}`);
    };

    if (updates.remediationStatus !== undefined) {
      addField('remediation_status', updates.remediationStatus);
      if (updates.remediationStatus === 'completed' || updates.remediationStatus === 'closed') {
        addField('completed_at', new Date().toISOString());
      }
    }
    if (updates.priority           !== undefined) addField('priority',            updates.priority);
    if (updates.ownerType          !== undefined) addField('owner_type',          updates.ownerType);
    if (updates.ownerName          !== undefined) addField('owner_name',          updates.ownerName);
    if (updates.ownerEmail         !== undefined) addField('owner_email',         updates.ownerEmail);
    if (updates.ownerDepartment    !== undefined) addField('owner_department',    updates.ownerDepartment);
    if (updates.dueDate            !== undefined) addField('due_date',            updates.dueDate || null);
    if (updates.blockerReason      !== undefined) addField('blocker_reason',      updates.blockerReason);
    if (updates.notes              !== undefined) addField('notes',               updates.notes);
    if (updates.progressPercentage !== undefined) addField('progress_percentage', updates.progressPercentage);
    if (updates.title              !== undefined) addField('title',               updates.title);
    if (updates.description        !== undefined) addField('description',         updates.description);
    if (updates.timeline           !== undefined) addField('timeline',            JSON.stringify(updates.timeline));

    if (setClauses.length === 0) return taskRepository.findById(taskId, tenantId);

    addField('last_updated_at', new Date().toISOString());
    params.push(taskId);
    const taskIdParam = `$${params.length}`;

    let whereClause = `WHERE id = ${taskIdParam}`;
    if (tenantId) {
      params.push(tenantId);
      whereClause += ` AND tenant_id = $${params.length}`;
    }

    const { rows } = await db.query(
      `UPDATE tasks SET ${setClauses.join(', ')} ${whereClause} RETURNING id`,
      params
    );
    if (!rows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    return taskRepository.findById(taskId);
  },

  // Mark all unresolved tasks in a meeting as carry_forward when the meeting closes.
  // Does NOT increment carry_forward_count — that is the weekly job's sole responsibility
  // so the count always reflects weeks of inactivity, never monthly meeting cadence.
  carryForwardTasks: async (meetingId, tenantId) => {
    const { rows } = await db.query(
      `UPDATE tasks
       SET    remediation_status = CASE
                WHEN remediation_status IN ('open','in_progress','blocked','overdue','awaiting_validation','carry_forward')
                THEN 'carry_forward'
                ELSE remediation_status
              END,
              last_updated_at = NOW()
       WHERE  meeting_id = $1
         AND  tenant_id  = $2
         AND  remediation_status NOT IN ('completed','closed','cancelled','escalated')
       RETURNING id,
                 title,
                 carry_forward_count AS "carryForwardCount",
                 remediation_status  AS "remediationStatus",
                 owner_type          AS "ownerType",
                 owner_email         AS "ownerEmail",
                 priority`,
      [meetingId, tenantId]
    );
    logger.info('Carry-forward status applied at meeting close', { meetingId, tenantId, count: rows.length });
    return rows;
  },

  // Increments carry_forward_count only for tasks that are genuinely stalled,
  // not just "still open." Called by the weekly report job every Monday.
  //
  // A task counts as stalled — and only then gets penalized — when:
  //   - it has no ClickUp link at all (no real progress signal to check,
  //     so it falls back to the original weekly-timer behavior), OR
  //   - it has a ClickUp link AND its clickup_status is IDENTICAL to what it
  //     was at the last weekly check (clickup_status_at_last_cf_check) — i.e.
  //     it genuinely hasn't moved since last week.
  // A task whose ClickUp status changed since last week (real movement, e.g.
  // "To Do" → "In Progress") is left alone entirely this run.
  //
  // clickup_status_at_last_cf_check is refreshed to the CURRENT clickup_status
  // for every open task regardless of whether it was penalized, so next
  // week's comparison is always against this week's real value — including
  // the first time a ClickUp-linked task is ever checked (no prior baseline
  // yet, so it's exempt from penalty that first run purely to establish one).
  weeklyIncrementCarryForward: async (tenantId, threshold = 3) => {
    const { rows } = await db.query(
      `WITH candidates AS (
         SELECT id,
                (clickup_task_id IS NULL
                  OR (clickup_status_at_last_cf_check IS NOT NULL
                      AND clickup_status IS NOT DISTINCT FROM clickup_status_at_last_cf_check)
                ) AS is_stalled
         FROM   tasks
         WHERE  tenant_id = $1
           AND  remediation_status NOT IN ('completed','closed','cancelled','escalated')
       ),
       updated AS (
         UPDATE tasks t
         SET    carry_forward_count = CASE
                  WHEN c.is_stalled THEN LEAST(t.carry_forward_count + 1, $2)
                  ELSE t.carry_forward_count
                END,
                remediation_status  = CASE
                  WHEN c.is_stalled AND (t.carry_forward_count + 1) >= $2
                    AND t.remediation_status NOT IN ('completed','closed','cancelled','escalated')
                  THEN 'escalated'
                  WHEN c.is_stalled AND t.remediation_status IN ('open','in_progress','blocked','overdue','awaiting_validation','carry_forward')
                  THEN 'carry_forward'
                  ELSE t.remediation_status
                END,
                escalation_status   = CASE
                  WHEN c.is_stalled AND (t.carry_forward_count + 1) >= $2
                    AND t.escalation_status != 'escalated'
                  THEN 'escalated'
                  ELSE t.escalation_status
                END,
                review_outcome      = CASE
                  WHEN c.is_stalled AND (t.carry_forward_count + 1) >= $2
                    AND (t.review_outcome IS NULL OR t.review_outcome != 'escalation_required')
                  THEN 'escalation_required'
                  ELSE t.review_outcome
                END,
                escalation_count    = CASE
                  WHEN c.is_stalled AND (t.carry_forward_count + 1) >= $2
                  THEN t.escalation_count + 1
                  ELSE t.escalation_count
                END,
                clickup_status_at_last_cf_check = COALESCE(t.clickup_status, t.clickup_status_at_last_cf_check),
                last_updated_at = NOW()
         FROM   candidates c
         WHERE  t.id = c.id
         RETURNING t.id,
                   t.title,
                   t.carry_forward_count AS "carryForwardCount",
                   t.remediation_status  AS "remediationStatus",
                   t.owner_type          AS "ownerType",
                   t.owner_email         AS "ownerEmail",
                   t.priority,
                   c.is_stalled          AS "wasPenalized"
       )
       SELECT id, title, "carryForwardCount", "remediationStatus", "ownerType", "ownerEmail", priority
       FROM   updated
       WHERE  "wasPenalized" = true`,
      [tenantId, threshold]
    );
    const escalated = rows.filter((r) => r.remediationStatus === 'escalated').length;
    logger.info('Weekly carry-forward increment applied', { tenantId, count: rows.length, autoEscalated: escalated, threshold });
    return rows;
  },

  create: async ({ meetingId, findingId, tenantId, title, description, actionPlan,
                   riskReductionScore, ownershipTeam, ownerName, ownerEmail,
                   ownerDepartment, ownerType, dueDate, primaryOwner, secondaryOwner,
                   timeline, notes, meetingTimeline, priority, createdBy }) => {
    const { rows } = await db.query(
      `INSERT INTO tasks (
         meeting_id, finding_id, tenant_id, title, description, action_plan,
         risk_reduction_score, ownership_team, owner_name, owner_email,
         owner_department, owner_type, due_date,
         primary_owner, secondary_owner, timeline, notes, meeting_timeline,
         priority, created_by, approval_status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'approved')
       RETURNING *`,
      [
        meetingId,
        findingId      || null,
        tenantId,
        title,
        description    || null,
        actionPlan     || null,
        riskReductionScore || 0,
        ownershipTeam  || null,
        ownerName      || null,
        ownerEmail     || null,
        ownerDepartment || null,
        ownerType      || 'ACCOUNT_MANAGER',
        dueDate        || null,
        primaryOwner   ? JSON.stringify(primaryOwner)   : null,
        secondaryOwner ? JSON.stringify(secondaryOwner) : null,
        JSON.stringify(timeline || []),
        notes          || null,
        meetingTimeline || null,
        priority       || 'medium',
        createdBy      || null,
      ]
    );
    logger.info('Task created', { taskId: rows[0].id, tenantId });
    return taskRepository.findById(rows[0].id);
  },

  updateStatus: async (taskId, approvalStatus, notes = '', tenantId = null) => {
    const base = `
      UPDATE tasks
      SET    approval_status = $1,
             notes           = $2,
             last_updated_at = NOW()
      WHERE  id = $3`;
    const { rows } = tenantId
      ? await db.query(`${base} AND tenant_id = $4 RETURNING id`, [approvalStatus, notes, taskId, tenantId])
      : await db.query(`${base} RETURNING id`, [approvalStatus, notes, taskId]);
    if (!rows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    return taskRepository.findById(taskId);
  },

  setReviewOutcome: async (taskId, outcome, actorName, tenantId = null) => {
    const base = `
      UPDATE tasks
      SET    review_outcome  = $1,
             last_updated_at = NOW()
      WHERE  id = $2`;
    const { rows } = tenantId
      ? await db.query(`${base} AND tenant_id = $3 RETURNING id`, [outcome, taskId, tenantId])
      : await db.query(`${base} RETURNING id`, [outcome, taskId]);
    if (!rows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    logger.info('Review outcome set', { taskId, outcome, actor: actorName });
    return taskRepository.findById(taskId);
  },

  triggerEscalation: async (taskId, { blockerType, escalationReason, escalatedBy,
                                       notifyContact = '', tenantId = null }) => {
    const task = await taskRepository.findById(taskId, tenantId);
    if (!task) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

    const entry = {
      id:               `esc-${Date.now()}`,
      blockerType,
      escalationReason,
      escalatedBy,
      notifyContact,
      escalationDate:   new Date().toISOString(),
      carryForwardCount: task.carryForwardCount,
      resolved:         false,
    };

    const updatedHistory = [...task.escalationHistory, entry];
    const { rows } = await db.query(
      `UPDATE tasks
       SET    escalation_status  = 'escalated',
              review_outcome     = 'escalation_required',
              remediation_status = 'escalated',
              escalation_count   = escalation_count + 1,
              escalation_history = $1::jsonb,
              last_updated_at    = NOW()
       WHERE  id = $2
       RETURNING id`,
      [JSON.stringify(updatedHistory), taskId]
    );
    if (!rows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    logger.info('Escalation triggered', { taskId, escalatedBy, blockerType });
    return taskRepository.findById(taskId);
  },

  updateProgress: async (taskId, progressPercentage, tenantId = null) => {
    const remediationStatus = progressPercentage >= 100 ? 'completed' : 'in_progress';
    const base = `
      UPDATE tasks
      SET    progress_percentage = $1,
             remediation_status  = $2,
             last_updated_at     = NOW()
      WHERE  id = $3`;
    const { rows } = tenantId
      ? await db.query(`${base} AND tenant_id = $4 RETURNING id`, [progressPercentage, remediationStatus, taskId, tenantId])
      : await db.query(`${base} RETURNING id`, [progressPercentage, remediationStatus, taskId]);
    if (!rows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    return taskRepository.findById(taskId);
  },

  appendTimelineEvent: async (taskId, event) => {
    const { rows } = await db.query(
      `UPDATE tasks
       SET    timeline        = timeline || $1::jsonb,
              last_updated_at = NOW()
       WHERE  id = $2
       RETURNING id`,
      [JSON.stringify([event]), taskId]
    );
    if (!rows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    return taskRepository.findById(taskId);
  },

  // Creates a live tracker task from an approved AI recommendation.
  // Called exclusively by AIRecommendationService.approveRecommendation().
  // Bulk-mark tasks as overdue when due_date has passed and status is still active.
  markOverdueTasks: async () => {
    const { rows } = await db.query(
      `UPDATE tasks
       SET    remediation_status = 'overdue',
              last_updated_at    = NOW()
       WHERE  due_date           < NOW()
         AND  approval_status    = 'approved'
         AND  remediation_status IN ('open','in_progress','blocked','awaiting_validation')
       RETURNING id, tenant_id`
    );
    if (rows.length > 0) {
      logger.info('Overdue detection: marked tasks', { count: rows.length });
    }
    return rows;
  },

  createFromRecommendation: async (rec) => {
    const primaryOwner = rec.recommendedOwner
      ? { name: rec.recommendedOwner, role: rec.recommendedOwner }
      : null;

    const timeline = [{
      id:    `evt-${Date.now()}`,
      date:  new Date().toISOString(),
      event: 'Task created from AI recommendation',
      actor: rec.approvedBy || 'Account Manager',
      type:  'created',
    }];

    const sourceType = rec.analysisType === 'post_meeting' ? 'post_meeting'
                     : rec.analysisType === 'pre_meeting'  ? 'pre_meeting'
                     : 'manual';

    const { rows } = await db.query(
      `INSERT INTO tasks (
         meeting_id, finding_id, tenant_id, title, description, action_plan,
         risk_reduction_score, owner_name, ownership_team, due_date,
         primary_owner, timeline, approval_status, remediation_status,
         owner_type, created_by, source_type, source_recommendation_id,
         category, severity
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'approved','open',$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        rec.meetingId,
        rec.findingId                || null,
        rec.tenantId,
        rec.title,
        rec.businessImpact           || null,
        rec.actionPlan               || null,
        rec.riskReductionScore       || 0,
        rec.recommendedOwner         || null,
        null,
        rec.dueDateSuggestion        || null,
        primaryOwner ? JSON.stringify(primaryOwner) : null,
        JSON.stringify(timeline),
        rec.recommendedOwnerType     || 'ACCOUNT_MANAGER',
        rec.approvedBy               || null,
        sourceType,
        rec.id                       || null,
        rec.category                 || null,
        rec.severity                 || null,
      ]
    );
    logger.info('Task created from AI recommendation', {
      taskId: rows[0].id,
      recommendationId: rec.id,
      tenantId: rec.tenantId,
    });
    return taskRepository.findById(rows[0].id);
  },
};

module.exports = taskRepository;
