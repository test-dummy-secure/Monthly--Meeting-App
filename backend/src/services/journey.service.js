const db = require('../config/db');
const tenantAccessService = require('./tenantAccess.service');
const actionItemService   = require('./actionItem.service');

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const defaultOwner = (tenant, meeting, role = 'Account Manager') => ({
  id: `owner-${tenant.id}`,
  name: tenant.accountManager || role,
  role,
  email: tenant.accountManager ? `${tenant.accountManager.toLowerCase().replace(/\s+/g, '.')}@bmmj.com` : 'manager@bmmj.com',
  avatar: tenant.accountManager
    ? tenant.accountManager
        .split(' ')
        .map((segment) => segment[0])
        .join('')
        .slice(0, 2)
    : 'AM'
});

const defaultSecondaryOwner = (tenant) => ({
  id: `tenant-contact-${tenant.id}`,
  name: `${tenant.name} Security Lead`,
  role: 'Customer Security Lead',
  email: `security@${tenant.domain || 'tenant'}`,
  avatar: tenant.name
    .split(' ')
    .map((segment) => segment[0])
    .join('')
    .slice(0, 2)
});

const defaultTimeline = (status, actor) => ([
  {
    id: `evt-${Date.now()}-1`,
    date: new Date().toISOString(),
    event: `Task created for ${status.replace(/_/g, ' ')}`,
    actor,
    type: 'created'
  }
]);

const mapTenantRow = (row) => ({
  id: row.id,
  name: row.name,
  domain: row.domain,
  accountManager: row.accountManager,
  status: row.status,
  connectedCalendars: row.connectedCalendars || []
});

const mapMeetingRow = (row) => ({
  id: row.id,
  tenantId: row.tenantId,
  meetingConfigId: row.meetingConfigId,
  scheduledStart: row.scheduledStart,
  scheduledEnd: row.scheduledEnd,
  meetingType: row.meetingType || 'monthly_review',
  meetingDurationMinutes: row.meetingDurationMinutes || 60,
  calendarEventId: row.calendarEventId,
  status: row.status,
  triggerDate: row.triggerDate,
  title: row.title,
  provider: row.provider,
  meetingNotes: row.meetingNotes,
  attendees: row.attendees || [],
  rescheduleRequest: row.rescheduleRequest || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

const mapFindingRow = (row) => ({
  id: row.id,
  meetingId: row.meetingId,
  sourceFindingId: row.sourceFindingId,
  severity: row.severity,
  category: row.category,
  title: row.title,
  description: row.description,
  systemAffected: row.systemAffected,
  createdAt: row.createdAt
});

const mapTaskRow = (row) => ({
  id: row.id,
  meetingId: row.meetingId,
  originalMeetingId: row.originalMeetingId || row.meetingId,
  findingId: row.findingId,
  tenantId: row.tenantId,
  title: row.title,
  actionPlan: row.actionPlan,
  riskReductionScore: row.riskReductionScore,
  approvalStatus: row.approvalStatus,
  remediationStatus: row.remediationStatus,
  status: row.remediationStatus,
  reviewOutcome: row.reviewOutcome || null,
  escalationStatus: row.escalationStatus || 'none',
  escalationHistory: row.escalationHistory || [],
  priority: row.priority || null,
  blockerReason: row.blockerReason || null,
  ownershipTeam: row.ownershipTeam,
  ownerName: row.ownerName,
  dueDate: row.dueDate,
  progressPercentage: row.progressPercentage || 0,
  carryForwardCount: row.carryForwardCount || 0,
  escalationCount: row.escalationCount || 0,
  meetingTimeline: row.meetingTimeline,
  primaryOwner: row.primaryOwner || null,
  secondaryOwner: row.secondaryOwner || null,
  timeline: row.timeline || [],
  notes: row.notes,
  lastUpdatedDate: row.lastUpdatedAt || row.createdAt,
  lastReviewedBy: row.lastReviewedBy || null,
  lastReviewedDate: row.lastReviewedDate || null,
  createdAt: row.createdAt,
  customerName: row.customerName,
  sourceFindingId: row.sourceFindingId,
  severity: row.severity,
  category: row.category,
  systemAffected: row.systemAffected,
  description: row.description,
  meetingDate: row.meetingDate,
  meetingTitle: row.meetingTitle,
  clickupTaskId: row.clickupTaskId || null,
  clickupStatus: row.clickupStatus || null,
  clickupUrl: row.clickupUrl || null,
});

const mapReportRow = (row) => ({
  id: row.id,
  tenantId: row.tenantId,
  meetingId: row.meetingId,
  reportType: row.reportType,
  title: row.title,
  summary: row.summary,
  openTasksCount: row.openTasksCount,
  closedTasksCount: row.closedTasksCount,
  overdueTasksCount: row.overdueTasksCount ?? 0,
  blockedTasksCount: row.blockedTasksCount ?? 0,
  escalatedTasksCount: row.escalatedTasksCount,
  carryForwardTasksCount: row.carryForwardTasksCount,
  progressPercentage: row.progressPercentage,
  weekNumber: row.weekNumber ?? null,
  reportPeriodStart: row.reportPeriodStart ?? null,
  reportPeriodEnd: row.reportPeriodEnd ?? null,
  reportStatus: row.reportStatus || 'published',
  generatedBy: row.generatedBy,
  generatedAt: row.generatedAt,
  exportPayload: row.exportPayload || {}
});

const mapMeetingLogRow = (row) => ({
  id: row.meetingId || row.id,
  meetingId: row.meetingId || row.id,
  tenantId: row.tenantId,
  meetingDate: row.scheduledStart,
  meetingTime: row.scheduledStart,
  meetingDuration: row.meetingDurationMinutes || 60,
  meetingType: row.meetingType || 'monthly_review',
  meetingStatus: row.meetingStatus || row.status,
  customer: row.customerName,
  accountManager: row.accountManager,
  attendees: row.attendees || [],
  meetingNotes: row.meetingNotes || row.summary || '',
  findingsDiscussed: row.findingsDiscussed || [],
  tasksDiscussed: row.tasksDiscussed || [],
  risksDiscussed: row.risksDiscussed || [],
  decisionsTaken: row.decisionsTaken || [],
  topics: row.topics || [],
  taskTracking: row.taskTracking || [],
  carryForward: row.carryForward || [],
  escalations: row.escalations || [],
  meetingSummary: row.meetingSummary || row.summary || '',
  actionItems: row.actionItems || [],
  followUpActions: row.followUpActions || [],
  aiStatus: row.aiStatus || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

const JourneyService = {
  async listTenants(user) {
    const tenants = await tenantAccessService.listAccessibleTenants(user);
    return tenants.map(mapTenantRow);
  },

  async getDashboardSummary({ user, tenantId }) {
    const scopedTenantId = await tenantAccessService.resolveTenantId(user, tenantId);
    const tenantIds = scopedTenantId ? [scopedTenantId] : await tenantAccessService.getAccessibleTenantIds(user);
    const tenantInfoQuery = await db.query(
      `SELECT id, name, domain, account_manager AS "accountManager", status, connected_calendars AS "connectedCalendars"
       FROM customers
       WHERE id = ANY($1)
       ORDER BY name ASC`,
      [tenantIds]
    );
    const tenants = tenantInfoQuery.rows.map(mapTenantRow);

    const meetingQuery = await db.query(
      `SELECT m.id,
              m.tenant_id AS "tenantId",
              m.scheduled_start AS "scheduledStart",
              m.scheduled_end AS "scheduledEnd",
              m.meeting_type AS "meetingType",
              m.meeting_duration_minutes AS "meetingDurationMinutes",
              m.calendar_event_id AS "calendarEventId",
              m.status,
              m.trigger_date AS "triggerDate",
              m.title,
              m.provider,
              m.meeting_notes AS "meetingNotes",
              m.attendees,
              m.reschedule_request AS "rescheduleRequest",
              m.created_at AS "createdAt",
              m.updated_at AS "updatedAt"
       FROM meetings m
       WHERE m.tenant_id = ANY($1)
       ORDER BY m.scheduled_start DESC`,
      [tenantIds]
    );

    const meetings = meetingQuery.rows.map(mapMeetingRow);
    const meetingIds = meetings.map((meeting) => meeting.id);

    let findings = [];
    let tasks = [];
    if (meetingIds.length > 0) {
      const findingsResult = await db.query(
        `SELECT f.id,
                f.meeting_id AS "meetingId",
                f.source_finding_id AS "sourceFindingId",
                f.severity,
                f.category,
                f.title,
                f.description,
                f.system_affected AS "systemAffected",
                f.created_at AS "createdAt"
         FROM findings f
         WHERE f.meeting_id = ANY($1)
         ORDER BY f.created_at DESC`,
        [meetingIds]
      );
      findings = findingsResult.rows.map(mapFindingRow);

      const taskQuery = await db.query(
        `SELECT t.id,
                t.meeting_id AS "meetingId",
                t.finding_id AS "findingId",
                t.tenant_id AS "tenantId",
                t.title,
                t.action_plan AS "actionPlan",
                t.risk_reduction_score AS "riskReductionScore",
                t.approval_status AS "approvalStatus",
                t.remediation_status AS "remediationStatus",
                t.ownership_team AS "ownershipTeam",
                t.owner_name AS "ownerName",
                t.due_date AS "dueDate",
                t.progress_percentage AS "progressPercentage",
                t.carry_forward_count AS "carryForwardCount",
                t.escalation_count AS "escalationCount",
                t.meeting_timeline AS "meetingTimeline",
                t.primary_owner AS "primaryOwner",
                t.secondary_owner AS "secondaryOwner",
                t.timeline,
                t.notes,
                t.last_updated_at AS "lastUpdatedAt",
                t.created_at AS "createdAt",
                f.source_finding_id AS "sourceFindingId",
                f.severity,
                f.category,
                f.system_affected AS "systemAffected",
                c.name AS "customerName"
         FROM tasks t
         JOIN meetings m ON m.id = t.meeting_id
         LEFT JOIN findings f ON f.id = t.finding_id
         JOIN customers c ON c.id = m.tenant_id
         WHERE t.tenant_id = ANY($1)
         ORDER BY COALESCE(t.due_date, t.created_at) DESC`,
        [tenantIds]
      );
      tasks = taskQuery.rows.map(mapTaskRow);
    }

    const trackerStatusCounts = {
      open: tasks.filter((task) => task.remediationStatus === 'open').length,
      in_progress: tasks.filter((task) => task.remediationStatus === 'in_progress').length,
      awaiting_validation: tasks.filter((task) => task.approvalStatus === 'pending').length,
      completed: tasks.filter((task) => task.remediationStatus === 'closed' || task.progressPercentage >= 100).length,
      escalated: tasks.filter((task) => task.escalationCount > 0).length,
      overdue: tasks.filter((task) => task.dueDate && new Date(task.dueDate) < new Date() && task.remediationStatus !== 'closed').length
    };

    const trackerSeverityCounts = {
      critical: tasks.filter((task) => task.severity === 'critical').length,
      high: tasks.filter((task) => task.severity === 'high').length,
      medium: tasks.filter((task) => task.severity === 'medium').length,
      low: tasks.filter((task) => task.severity === 'low').length
    };

    // Severity breakdown of the FULL findings set (not the 6-item recentFindings
    // slice below) — used by the Open Findings KPI detail view.
    const findingsSeverityCounts = {
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length
    };

    const tenantStatusCounts = {
      active: tenants.filter((t) => t.status === 'active').length,
      inactive: tenants.filter((t) => t.status !== 'active').length
    };

    // Real distribution of tasks.remediation_status — unlike trackerStatusCounts
    // above (which mixes independent/overlapping flags), every task has exactly
    // ONE remediation_status value, so these counts genuinely sum to totalTasks.
    // Only include statuses that actually appear, so the chart doesn't carry
    // empty zero-value slices for the schema's unused enum values.
    const remediationStatusCounts = tasks.reduce((acc, task) => {
      const status = task.remediationStatus || 'open';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    const activityFeed = tasks
      .flatMap((task) =>
        (task.timeline || []).map((event) => ({
          ...event,
          taskId: task.id,
          taskTitle: task.title,
          severity: task.severity,
          customerName: task.customerName
        }))
      )
      .sort((left, right) => new Date(right.date) - new Date(left.date))
      .slice(0, 8);

    const recentFindings = findings.slice(0, 6);
    // Lean, displayable task list for KPI drill-down views — full `tasks`
    // objects carry heavier fields (timeline, notes) not needed there.
    const taskList = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      ownerName: task.ownerName,
      dueDate: task.dueDate,
      remediationStatus: task.remediationStatus,
      approvalStatus: task.approvalStatus,
      severity: task.severity,
      carryForwardCount: task.carryForwardCount || 0,
      escalationCount: task.escalationCount || 0,
      customerName: task.customerName,
    }));

    const totalTasks = tasks.length;
    const completedTasks = trackerStatusCounts.completed;
    const openTasks = trackerStatusCounts.open + trackerStatusCounts.in_progress + trackerStatusCounts.awaiting_validation;
    const escalatedTasks = trackerStatusCounts.escalated;
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const averageProgress = totalTasks > 0
      ? Math.round(tasks.reduce((sum, task) => sum + (task.progressPercentage || 0), 0) / totalTasks)
      : 0;

    const meetingSummary = meetings.map((meeting) => ({
      ...meeting,
      findingsCount: findings.filter((finding) => finding.meetingId === meeting.id).length,
      tasksCount: tasks.filter((task) => task.meetingId === meeting.id).length
    }));

    return {
      selectedTenant: tenants[0] || null,
      tenants,
      totalCustomers: tenants.length,
      activeMeetings: meetings.filter((meeting) => ['scheduled', 'approval_pending', 'approved'].includes(meeting.status)).length,
      upcomingMeetings: meetings.filter((meeting) => new Date(meeting.scheduledStart) > new Date()).length,
      openFindings: findings.filter((finding) => finding.severity !== 'low').length,
      findingsSeverityCounts,
      tenantStatusCounts,
      remediationStatusCounts,
      taskList,
      escalatedTasks,
      riskTrend: ['Jan', 'Feb', 'Mar', 'Apr', 'May'].map((month, index) => ({
        month,
        risk: Math.max(1, Math.min(100, averageProgress + (index * 2) - 8))
      })),
      recentActivities: activityFeed.map((event) => ({
        id: event.id,
        type: event.type === 'created' ? 'Meeting' : event.type === 'escalated' ? 'Escalation' : 'Finding',
        description: event.event,
        time: event.date,
        taskId: event.taskId,
        taskTitle: event.taskTitle
      })),
      recentFindings,
      meetings: meetingSummary,
      tenantSummary: {
        totalTasks,
        completedTasks,
        openTasks,
        escalatedTasks,
        averageProgress,
        totalCarryForwards: tasks.reduce((sum, t) => sum + (t.carryForwardCount || 0), 0),
        taskStatusCounts: trackerStatusCounts,
        severityCounts: trackerSeverityCounts
      }
    };
  },

  async listTrackerTasks({ user, tenantId, filters = {}, page = 1, pageSize = 20 }) {
    const scopedTenantId = await tenantAccessService.resolveTenantId(user, tenantId);
    const tenantIds = scopedTenantId ? [scopedTenantId] : await tenantAccessService.getAccessibleTenantIds(user);
    const params = [tenantIds];
    const conditions = ['t.tenant_id = ANY($1)'];

    if (filters.severity) {
      params.push(filters.severity);
      conditions.push(`f.severity = $${params.length}`);
    }

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`t.remediation_status = $${params.length}`);
    }

    if (filters.ownershipTeam) {
      params.push(filters.ownershipTeam);
      conditions.push(`t.ownership_team = $${params.length}`);
    }

    if (filters.customer) {
      params.push(filters.customer);
      conditions.push(`c.name = $${params.length}`);
    }

    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`(t.title ILIKE $${params.length} OR f.source_finding_id ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }

    const offset = (page - 1) * pageSize;
    params.push(pageSize);
    params.push(offset);

    const taskQuery = `
      SELECT t.id,
             t.meeting_id AS "meetingId",
             t.finding_id AS "findingId",
             t.tenant_id AS "tenantId",
             t.title,
             t.action_plan AS "actionPlan",
             t.risk_reduction_score AS "riskReductionScore",
             t.approval_status AS "approvalStatus",
             t.remediation_status AS "remediationStatus",
             t.ownership_team AS "ownershipTeam",
             t.owner_name AS "ownerName",
             t.due_date AS "dueDate",
             t.progress_percentage AS "progressPercentage",
             t.carry_forward_count AS "carryForwardCount",
             t.escalation_count AS "escalationCount",
             t.meeting_timeline AS "meetingTimeline",
             t.primary_owner AS "primaryOwner",
             t.secondary_owner AS "secondaryOwner",
             t.timeline,
             t.notes,
             t.last_updated_at AS "lastUpdatedAt",
             t.created_at AS "createdAt",
             f.source_finding_id AS "sourceFindingId",
             f.severity,
             f.category,
             f.system_affected AS "systemAffected",
             c.name AS "customerName",
             t.clickup_task_id AS "clickupTaskId",
             t.clickup_status AS "clickupStatus",
             t.clickup_url AS "clickupUrl"
      FROM tasks t
      JOIN meetings m ON m.id = t.meeting_id
      LEFT JOIN findings f ON f.id = t.finding_id
      JOIN customers c ON c.id = m.tenant_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(t.due_date, t.created_at) DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const countQuery = `
      SELECT COUNT(*)::INT AS count
      FROM tasks t
      JOIN meetings m ON m.id = t.meeting_id
      LEFT JOIN findings f ON f.id = t.finding_id
      JOIN customers c ON c.id = m.tenant_id
      WHERE ${conditions.join(' AND ')}
    `;

    const [{ rows: taskRows }, { rows: countRows }] = await Promise.all([
      db.query(taskQuery, params),
      db.query(countQuery, params.slice(0, -2))
    ]);

    const tasks = taskRows.map(mapTaskRow);
    const total = countRows[0]?.count || 0;

    const byStatus = {
      open: tasks.filter((task) => task.remediationStatus === 'open').length,
      in_progress: tasks.filter((task) => task.remediationStatus === 'in_progress').length,
      awaiting_validation: tasks.filter((task) => task.approvalStatus === 'pending').length,
      completed: tasks.filter((task) => task.remediationStatus === 'closed' || task.progressPercentage >= 100).length,
      escalated: tasks.filter((task) => task.escalationCount > 0).length,
      overdue: tasks.filter((task) => task.dueDate && new Date(task.dueDate) < new Date() && task.remediationStatus !== 'closed').length
    };

    const bySeverity = {
      critical: tasks.filter((task) => task.severity === 'critical').length,
      high: tasks.filter((task) => task.severity === 'high').length,
      medium: tasks.filter((task) => task.severity === 'medium').length,
      low: tasks.filter((task) => task.severity === 'low').length
    };

    const byTenant = tasks.reduce((accumulator, task) => {
      accumulator[task.customerName] = (accumulator[task.customerName] || 0) + 1;
      return accumulator;
    }, {});

    const totalTasks = tasks.length;
    const completedTasks = byStatus.completed;

    return {
      items: tasks,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      },
      stats: {
        byStatus,
        bySeverity,
        byTenant,
        totalTasks,
        completedTasks,
        overallProgress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        avgProgress: totalTasks > 0 ? Math.round(tasks.reduce((sum, task) => sum + task.progressPercentage, 0) / totalTasks) : 0,
        totalCarryForwards: tasks.reduce((sum, task) => sum + (task.carryForwardCount || 0), 0),
        totalEscalations: tasks.reduce((sum, task) => sum + (task.escalationCount || 0), 0),
        overdueCount: byStatus.overdue,
        activeTasks: totalTasks - completedTasks
      }
    };
  },

  async getTaskById({ user, taskId }) {
    const accessibleTenantIds = await tenantAccessService.getAccessibleTenantIds(user);
    const { rows } = await db.query(
      `SELECT t.id,
              t.meeting_id AS "meetingId",
              t.original_meeting_id AS "originalMeetingId",
              t.finding_id AS "findingId",
              t.tenant_id AS "tenantId",
              t.title,
              t.action_plan AS "actionPlan",
              t.risk_reduction_score AS "riskReductionScore",
              t.approval_status AS "approvalStatus",
              t.remediation_status AS "remediationStatus",
              t.review_outcome AS "reviewOutcome",
              t.escalation_status AS "escalationStatus",
              t.escalation_history AS "escalationHistory",
              t.priority,
              t.blocker_reason AS "blockerReason",
              t.ownership_team AS "ownershipTeam",
              t.owner_name AS "ownerName",
              t.due_date AS "dueDate",
              t.progress_percentage AS "progressPercentage",
              t.carry_forward_count AS "carryForwardCount",
              t.escalation_count AS "escalationCount",
              t.meeting_timeline AS "meetingTimeline",
              t.primary_owner AS "primaryOwner",
              t.secondary_owner AS "secondaryOwner",
              t.timeline,
              t.notes,
              t.last_updated_at AS "lastUpdatedAt",
              t.created_at AS "createdAt",
              f.source_finding_id AS "sourceFindingId",
              f.severity,
              f.category,
              f.system_affected AS "systemAffected",
              f.description,
              m.title AS "meetingTitle",
              m.scheduled_start AS "meetingDate",
              c.name AS "customerName"
       FROM tasks t
       JOIN meetings m ON m.id = t.meeting_id
       LEFT JOIN findings f ON f.id = t.finding_id
       JOIN customers c ON c.id = m.tenant_id
       WHERE t.id = $1 AND t.tenant_id = ANY($2)
       LIMIT 1`,
      [taskId, accessibleTenantIds]
    );

    return rows[0] ? mapTaskRow(rows[0]) : null;
  },

  async updateTask({ user, taskId, progressPercentage, status, notes }) {
    const accessibleTenantIds = await tenantAccessService.getAccessibleTenantIds(user);
    const { rows } = await db.query(
      `UPDATE tasks
       SET progress_percentage = COALESCE($1, progress_percentage),
           remediation_status  = COALESCE($2, remediation_status),
           notes               = COALESCE($3, notes),
           last_updated_at     = NOW()
       WHERE id = $4 AND tenant_id = ANY($5)
       RETURNING id, progress_percentage AS "progressPercentage",
                 remediation_status AS "remediationStatus",
                 notes, last_updated_at AS "lastUpdatedAt"`,
      [
        progressPercentage != null ? Number(progressPercentage) : null,
        status || null,
        notes != null ? notes : null,
        taskId,
        accessibleTenantIds,
      ]
    );
    if (!rows[0]) throw Object.assign(new Error('Task not found or access denied'), { statusCode: 404 });
    return rows[0];
  },

  async saveReview({ user, taskId, outcome, actorName }) {
    const accessibleTenantIds = await tenantAccessService.getAccessibleTenantIds(user);
    const { rows } = await db.query(
      `UPDATE tasks
       SET review_outcome    = $1,
           last_updated_at   = NOW()
       WHERE id = $2 AND tenant_id = ANY($3)
       RETURNING id, review_outcome AS "reviewOutcome", last_updated_at AS "lastUpdatedAt"`,
      [outcome, taskId, accessibleTenantIds]
    );
    if (!rows[0]) throw Object.assign(new Error('Task not found or access denied'), { statusCode: 404 });
    return { ...rows[0], lastReviewedBy: actorName, lastReviewedDate: rows[0].lastUpdatedAt };
  },

  async triggerEscalation({ user, taskId, blockerType, reason, notifyContact }) {
    const accessibleTenantIds = await tenantAccessService.getAccessibleTenantIds(user);
    const actorEmail = user.email;
    const escalationEntry = {
      blockerType,
      reason,
      notifyContact: notifyContact || null,
      escalatedBy: actorEmail,
      escalatedAt: new Date().toISOString(),
    };
    const { rows } = await db.query(
      `UPDATE tasks
       SET escalation_status  = 'escalated',
           escalation_count   = escalation_count + 1,
           blocker_reason     = $1,
           escalation_history = COALESCE(escalation_history, '[]'::jsonb) || $2::jsonb,
           review_outcome     = 'escalation_required',
           last_updated_at    = NOW()
       WHERE id = $3 AND tenant_id = ANY($4)
       RETURNING id,
                 escalation_status AS "escalationStatus",
                 escalation_count AS "escalationCount",
                 escalation_history AS "escalationHistory",
                 blocker_reason AS "blockerReason",
                 review_outcome AS "reviewOutcome",
                 last_updated_at AS "lastUpdatedAt"`,
      [reason, JSON.stringify(escalationEntry), taskId, accessibleTenantIds]
    );
    if (!rows[0]) throw Object.assign(new Error('Task not found or access denied'), { statusCode: 404 });
    return rows[0];
  },

  async getCustomerTaskSummary({ user, tenantId }) {
    const scopedTenantId = await tenantAccessService.resolveTenantId(user, tenantId);
    const targetTenantId = scopedTenantId;
    if (!targetTenantId) {
      return null;
    }

    const [{ rows: customerRows }, { rows: meetingRows }, { rows: taskRows }, { rows: logRows }] = await Promise.all([
      db.query(
        `SELECT id, name, domain, account_manager AS "accountManager", status, connected_calendars AS "connectedCalendars"
         FROM customers
         WHERE id = $1
         LIMIT 1`,
        [targetTenantId]
      ),
      db.query(
        `SELECT id, tenant_id AS "tenantId", scheduled_start AS "scheduledStart", scheduled_end AS "scheduledEnd", status, title, provider
         FROM meetings
         WHERE tenant_id = $1
         ORDER BY scheduled_start DESC`,
        [targetTenantId]
      ),
      db.query(
        `SELECT t.id,
                t.meeting_id AS "meetingId",
                t.finding_id AS "findingId",
                t.tenant_id AS "tenantId",
                t.title,
                t.action_plan AS "actionPlan",
                t.risk_reduction_score AS "riskReductionScore",
                t.approval_status AS "approvalStatus",
                t.remediation_status AS "remediationStatus",
                t.ownership_team AS "ownershipTeam",
                t.owner_name AS "ownerName",
                t.due_date AS "dueDate",
                t.progress_percentage AS "progressPercentage",
                t.carry_forward_count AS "carryForwardCount",
                t.escalation_count AS "escalationCount",
                t.meeting_timeline AS "meetingTimeline",
                t.primary_owner AS "primaryOwner",
                t.secondary_owner AS "secondaryOwner",
                t.timeline,
                t.notes,
                t.last_updated_at AS "lastUpdatedAt",
                t.created_at AS "createdAt"
         FROM tasks t
         WHERE t.tenant_id = $1
         ORDER BY COALESCE(t.due_date, t.created_at) DESC`,
        [targetTenantId]
      ),
      db.query(
        `SELECT id, meeting_id AS "meetingId", tenant_id AS "tenantId", meeting_summary AS "meetingSummary", action_items AS "actionItems",
                follow_up_actions AS "followUpActions", summary, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM meeting_notes
         WHERE tenant_id = $1
         ORDER BY created_at DESC`,
        [targetTenantId]
      )
    ]);

    const customer = customerRows[0] ? mapTenantRow(customerRows[0]) : null;
    const meetings = meetingRows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
      status: row.status,
      title: row.title,
      provider: row.provider
    }));
    const tasks = taskRows.map(mapTaskRow);
    const meetingLogs = logRows.map((row) => ({
      id: row.id,
      meetingId: row.meetingId,
      tenantId: row.tenantId,
      meetingSummary: row.meetingSummary || row.summary || '',
      actionItems: row.actionItems || [],
      followUpActions: row.followUpActions || [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));

    const total = tasks.length;
    const completed = tasks.filter((task) => task.remediationStatus === 'closed' || task.progressPercentage >= 100).length;
    const open = tasks.filter((task) => task.remediationStatus === 'open' || task.remediationStatus === 'in_progress').length;
    const escalated = tasks.filter((task) => task.escalationCount > 0).length;
    const carryForward = tasks.reduce((sum, task) => sum + (task.carryForwardCount || 0), 0);

    return {
      customer,
      meetings,
      tasks,
      meetingLogs,
      summary: {
        totalTasks: total,
        completedTasks: completed,
        openTasks: open,
        escalatedTasks: escalated,
        carryForwardTasks: carryForward,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0
      }
    };
  },

  async getReports({ user, tenantId, reportType, page = 1, pageSize = 20 }) {
    const scopedTenantId = await tenantAccessService.resolveTenantId(user, tenantId);
    const tenantIds = scopedTenantId ? [scopedTenantId] : await tenantAccessService.getAccessibleTenantIds(user);
    const conditions = ['r.tenant_id = ANY($1)'];
    const params = [tenantIds];

    if (reportType) {
      params.push(reportType);
      conditions.push(`r.report_type = $${params.length}`);
    }

    const offset = (page - 1) * pageSize;
    params.push(pageSize);
    params.push(offset);

    const reportQuery = `
      SELECT r.id,
             r.tenant_id AS "tenantId",
             r.meeting_id AS "meetingId",
             r.report_type AS "reportType",
             r.title,
             r.summary,
             r.open_tasks_count AS "openTasksCount",
             r.closed_tasks_count AS "closedTasksCount",
             r.overdue_tasks_count AS "overdueTasksCount",
             r.blocked_tasks_count AS "blockedTasksCount",
             r.escalated_tasks_count AS "escalatedTasksCount",
             r.carry_forward_tasks_count AS "carryForwardTasksCount",
             r.progress_percentage AS "progressPercentage",
             r.week_number AS "weekNumber",
             r.report_period_start AS "reportPeriodStart",
             r.report_period_end AS "reportPeriodEnd",
             r.report_status AS "reportStatus",
             r.generated_by AS "generatedBy",
             r.export_payload AS "exportPayload",
             r.generated_at AS "generatedAt",
             c.name AS "customerName"
      FROM reports r
      JOIN customers c ON c.id = r.tenant_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.generated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const countQuery = `
      SELECT COUNT(*)::INT AS count
      FROM reports r
      WHERE ${conditions.join(' AND ')}
    `;

    const [{ rows: reportRows }, { rows: countRows }] = await Promise.all([
      db.query(reportQuery, params),
      db.query(countQuery, params.slice(0, -2))
    ]);

    const reports = reportRows.map(mapReportRow).map((report) => ({
      ...report,
      customerName: reportRows.find((row) => row.id === report.id)?.customerName || ''
    }));

    return {
      items: reports,
      pagination: {
        page,
        pageSize,
        total: countRows[0]?.count || 0,
        totalPages: Math.max(1, Math.ceil((countRows[0]?.count || 0) / pageSize))
      }
    };
  },

  async generateReport({ user, tenantId, meetingId, reportType, generatedBy, weekNumber, weekStart, weekEnd }) {
    const scopedTenantId = await tenantAccessService.resolveTenantId(user, tenantId);
    const targetTenantId = scopedTenantId;

    // Weekly progress reports track ALL tenant tasks across every meeting cycle so reports
    // show the complete remediation portfolio (closed, open, overdue) regardless of which
    // meeting is selected. Monthly summaries stay scoped to the specific meeting.
    const taskQuery = reportType === 'weekly_progress'
      ? db.query(
          `SELECT id, tenant_id AS "tenantId", title, approval_status AS "approvalStatus",
                  remediation_status AS "remediationStatus", progress_percentage AS "progressPercentage",
                  carry_forward_count AS "carryForwardCount", escalation_count AS "escalationCount",
                  due_date AS "dueDate"
           FROM tasks
           WHERE tenant_id = $1
           ORDER BY created_at ASC`,
          [targetTenantId]
        )
      : db.query(
          `SELECT id, tenant_id AS "tenantId", title, approval_status AS "approvalStatus",
                  remediation_status AS "remediationStatus", progress_percentage AS "progressPercentage",
                  carry_forward_count AS "carryForwardCount", escalation_count AS "escalationCount",
                  due_date AS "dueDate"
           FROM tasks
           WHERE meeting_id = $1 AND tenant_id = $2
           ORDER BY created_at ASC`,
          [meetingId, targetTenantId]
        );

    const [{ rows: meetingRows }, { rows: taskRows }, { rows: customerRows }] = await Promise.all([
      db.query(
        `SELECT id, tenant_id AS "tenantId", scheduled_start AS "scheduledStart", scheduled_end AS "scheduledEnd", status, title, provider
         FROM meetings
         WHERE id = $1 AND tenant_id = $2
         LIMIT 1`,
        [meetingId, targetTenantId]
      ),
      taskQuery,
      db.query(
        `SELECT id, name, domain, account_manager AS "accountManager", status
         FROM customers
         WHERE id = $1
         LIMIT 1`,
        [targetTenantId]
      )
    ]);

    const meeting = meetingRows[0];
    const customer = customerRows[0];
    if (!meeting || !customer) {
      const error = new Error('Meeting or tenant not found');
      error.statusCode = 404;
      throw error;
    }

    // Resolve week metadata for weekly_progress reports
    let resolvedWeekNumber = null;
    let resolvedPeriodStart = null;
    let resolvedPeriodEnd = null;

    if (reportType === 'weekly_progress') {
      resolvedWeekNumber = weekNumber || 1;
      if (weekStart && weekEnd) {
        resolvedPeriodStart = weekStart;
        resolvedPeriodEnd = weekEnd;
      } else {
        const meetingDate = new Date(meeting.scheduledStart);
        const year = meetingDate.getFullYear();
        const month = meetingDate.getMonth();
        const weekStarts = [1, 8, 15, 22];
        const lastDay = new Date(year, month + 1, 0).getDate();
        const weekEnds = [7, 14, 21, lastDay];
        const idx = Math.min(resolvedWeekNumber - 1, 3);
        resolvedPeriodStart = new Date(year, month, weekStarts[idx]).toISOString().slice(0, 10);
        resolvedPeriodEnd   = new Date(year, month, weekEnds[idx]).toISOString().slice(0, 10);
      }
    }

    const totalTasks = taskRows.length;
    const closedTasks = taskRows.filter((t) => t.remediationStatus === 'closed' || t.progressPercentage >= 100).length;
    const openTasks   = taskRows.filter((t) => t.remediationStatus !== 'closed' && t.progressPercentage < 100).length;
    const escalatedTasks    = taskRows.filter((t) => t.escalationCount > 0).length;
    const carryForwardTasks = taskRows.reduce((sum, t) => sum + (t.carryForwardCount || 0), 0);
    const progressPercentage = totalTasks > 0
      ? Math.round(taskRows.reduce((sum, t) => sum + (t.progressPercentage || 0), 0) / totalTasks)
      : 0;

    const cutoffDate = resolvedPeriodEnd ? new Date(resolvedPeriodEnd) : new Date();
    const overdueTasks = taskRows.filter((t) => {
      if (!t.dueDate) return false;
      const isActive = !['completed', 'closed', 'cancelled'].includes(t.remediationStatus);
      return isActive && new Date(t.dueDate) < cutoffDate;
    }).length;
    const blockedTasks = taskRows.filter((t) => t.remediationStatus === 'blocked').length;

    // Idempotency: prevent duplicate weekly reports for the same week number.
    if (reportType === 'weekly_progress' && resolvedWeekNumber) {
      const { rows: dupRows } = await db.query(
        `SELECT id FROM reports
         WHERE tenant_id = $1 AND meeting_id = $2 AND report_type = 'weekly_progress' AND week_number = $3
         LIMIT 1`,
        [targetTenantId, meetingId, resolvedWeekNumber]
      );
      if (dupRows.length > 0) {
        const err = new Error(`A Week ${resolvedWeekNumber} progress report already exists for this meeting. Delete the existing report first to regenerate.`);
        err.statusCode = 409;
        throw err;
      }
    }

    const monthLabel = new Date(meeting.scheduledStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    // Date range, not the raw weekNumber, drives the human-facing title/summary —
    // weekNumber itself is only a collision-safety key for the duplicate-report
    // check above (the automated weekly job passes a large rolling index there
    // so it never collides across month/year boundaries; showing that raw
    // number to a reader would look like "Week 102954").
    const weekRangeLabel = resolvedPeriodStart && resolvedPeriodEnd
      ? `Week of ${resolvedPeriodStart} – ${resolvedPeriodEnd}`
      : `Week ${resolvedWeekNumber}`;
    const title = reportType === 'monthly_summary'
      ? `Monthly Meeting Summary — ${customer.name} — ${monthLabel}`
      : `${weekRangeLabel} Progress Report — ${customer.name} — ${monthLabel}`;

    const summary = reportType === 'monthly_summary'
      ? `Monthly compliance journey review for ${customer.name}. ${closedTasks} of ${totalTasks} remediation tasks resolved. Overall progress: ${progressPercentage}%. Escalated items: ${escalatedTasks}.`
      : `${weekRangeLabel}: ${closedTasks} of ${totalTasks} tasks completed. ${blockedTasks} blocked. ${overdueTasks} overdue. Overall progress: ${progressPercentage}%.`;

    const exportPayload = {
      customer,
      meeting,
      tasks: taskRows,
      summary: { openTasks, closedTasks, escalatedTasks, carryForwardTasks, overdueTasks, blockedTasks, progressPercentage },
      ...(resolvedWeekNumber && { weekNumber: resolvedWeekNumber, reportPeriodStart: resolvedPeriodStart, reportPeriodEnd: resolvedPeriodEnd })
    };

    const insertResult = await db.query(
      `INSERT INTO reports (
         tenant_id, meeting_id, report_type, title, summary,
         open_tasks_count, closed_tasks_count, overdue_tasks_count, escalated_tasks_count,
         carry_forward_tasks_count, blocked_tasks_count, progress_percentage,
         week_number, report_period_start, report_period_end, report_status,
         generated_by, export_payload
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id, tenant_id AS "tenantId", meeting_id AS "meetingId", report_type AS "reportType",
                 title, summary, open_tasks_count AS "openTasksCount", closed_tasks_count AS "closedTasksCount",
                 overdue_tasks_count AS "overdueTasksCount", escalated_tasks_count AS "escalatedTasksCount",
                 carry_forward_tasks_count AS "carryForwardTasksCount", blocked_tasks_count AS "blockedTasksCount",
                 progress_percentage AS "progressPercentage", week_number AS "weekNumber",
                 report_period_start AS "reportPeriodStart", report_period_end AS "reportPeriodEnd",
                 report_status AS "reportStatus", generated_by AS "generatedBy",
                 export_payload AS "exportPayload", generated_at AS "generatedAt"`,
      [
        targetTenantId, meetingId, reportType, title, summary,
        openTasks, closedTasks, overdueTasks, escalatedTasks,
        carryForwardTasks, blockedTasks, progressPercentage,
        resolvedWeekNumber, resolvedPeriodStart, resolvedPeriodEnd, 'published',
        generatedBy, JSON.stringify(exportPayload)
      ]
    );

    const report = mapReportRow(insertResult.rows[0]);
    return { ...report, customerName: customer.name, exportPayload };
  },

  async getReportById({ user, reportId, tenantId }) {
    const scopedTenantId = await tenantAccessService.resolveTenantId(user, tenantId);
    const tenantIds = scopedTenantId
      ? [scopedTenantId]
      : await tenantAccessService.getAccessibleTenantIds(user);

    const { rows } = await db.query(
      `SELECT r.id, r.tenant_id AS "tenantId", r.meeting_id AS "meetingId",
              r.report_type AS "reportType", r.title, r.summary,
              r.open_tasks_count AS "openTasksCount", r.closed_tasks_count AS "closedTasksCount",
              r.overdue_tasks_count AS "overdueTasksCount", r.escalated_tasks_count AS "escalatedTasksCount",
              r.carry_forward_tasks_count AS "carryForwardTasksCount", r.blocked_tasks_count AS "blockedTasksCount",
              r.progress_percentage AS "progressPercentage", r.week_number AS "weekNumber",
              r.report_period_start AS "reportPeriodStart", r.report_period_end AS "reportPeriodEnd",
              r.report_status AS "reportStatus", r.generated_by AS "generatedBy",
              r.export_payload AS "exportPayload", r.generated_at AS "generatedAt",
              c.name AS "customerName"
       FROM reports r
       JOIN customers c ON c.id = r.tenant_id
       WHERE r.id = $1 AND r.tenant_id = ANY($2)`,
      [reportId, tenantIds]
    );

    if (!rows[0]) return null;
    return { ...mapReportRow(rows[0]), customerName: rows[0].customerName };
  },

  async getMonitoringDashboard({ user, tenantId }) {
    const scopedTenantId = await tenantAccessService.resolveTenantId(user, tenantId);
    const tenantIds = scopedTenantId
      ? [scopedTenantId]
      : await tenantAccessService.getAccessibleTenantIds(user);

    // All open tasks with DB-computed staleness
    const { rows: taskRows } = await db.query(
      `SELECT
         t.id,
         t.title,
         t.remediation_status                                              AS "remediationStatus",
         t.owner_name                                                      AS "ownerName",
         t.due_date                                                        AS "dueDate",
         t.escalation_count                                                AS "escalationCount",
         t.last_updated_at                                                 AS "lastUpdatedAt",
         FLOOR(
           EXTRACT(EPOCH FROM (NOW() - COALESCE(t.last_updated_at, t.created_at))) / 86400
         )::INT                                                            AS "staleDays",
         COALESCE(f.severity, 'low')                                       AS severity,
         f.category,
         c.id                                                              AS "tenantId",
         c.name                                                            AS "customerName",
         c.account_manager                                                 AS "accountManager"
       FROM tasks t
       JOIN meetings m ON m.id = t.meeting_id
       LEFT JOIN findings f ON f.id = t.finding_id
       JOIN customers c ON c.id = m.tenant_id
       WHERE t.tenant_id = ANY($1)
         AND t.remediation_status NOT IN ('closed', 'completed')
       ORDER BY "staleDays" DESC`,
      [tenantIds]
    );

    const getLevel = (d) => {
      if (d >= 28) return 4;
      if (d >= 21) return 3;
      if (d >= 14) return 2;
      if (d >= 7)  return 1;
      return 0;
    };

    const tasks = taskRows.map(t => ({
      ...t,
      escalationLevel: getLevel(t.staleDays),
      isOverdue: !!(t.dueDate && new Date(t.dueDate) < new Date()),
    }));

    // KPI stats
    const stats = {
      staleTasks7:     tasks.filter(t => t.staleDays >= 7  && t.staleDays < 14).length,
      staleTasks14:    tasks.filter(t => t.staleDays >= 14 && t.staleDays < 21).length,
      staleTasks21:    tasks.filter(t => t.staleDays >= 21 && t.staleDays < 28).length,
      escalatedTasks:  tasks.filter(t => t.staleDays >= 28).length,
      totalStaleTasks: tasks.filter(t => t.staleDays >= 7).length,
      healthyTasks:    tasks.filter(t => t.staleDays < 7).length,
    };

    // Escalation distribution
    const escalation = {
      totalEscalations: tasks.filter(t => t.escalationLevel >= 1).length,
      byLevel: {
        level1: tasks.filter(t => t.escalationLevel === 1).length,
        level2: tasks.filter(t => t.escalationLevel === 2).length,
        level3: tasks.filter(t => t.escalationLevel === 3).length,
        level4: tasks.filter(t => t.escalationLevel === 4).length,
      },
    };

    // Per-customer health scores
    const { rows: custRows } = await db.query(
      `SELECT id, name, account_manager AS "accountManager"
       FROM customers WHERE id = ANY($1) ORDER BY name`,
      [tenantIds]
    );

    const LEVEL_PENALTY = { 1: 5, 2: 12, 3: 20, 4: 30 };
    const SEV_PENALTY   = { critical: 5, high: 3 };

    const customers = custRows.map(c => {
      const ct = tasks.filter(t => t.tenantId === c.id);
      let penalty = 0;
      ct.forEach(t => {
        penalty += LEVEL_PENALTY[t.escalationLevel] || 0;
        penalty += SEV_PENALTY[t.severity] || 0;
      });
      const score = Math.max(0, Math.min(100, 100 - penalty));
      let grade, gradeColor;
      if      (score >= 90) { grade = 'A'; gradeColor = '#10b981'; }
      else if (score >= 75) { grade = 'B'; gradeColor = '#3b82f6'; }
      else if (score >= 60) { grade = 'C'; gradeColor = '#f59e0b'; }
      else if (score >= 40) { grade = 'D'; gradeColor = '#f97316'; }
      else                  { grade = 'F'; gradeColor = '#ef4444'; }

      return {
        id:              c.id,
        name:            c.name,
        accountManager:  c.accountManager || 'Unassigned',
        healthScore:     score,
        grade,
        gradeColor,
        totalTasks:      ct.length,
        staleTasks:      ct.filter(t => t.staleDays >= 7).length,
        escalatedTasks:  ct.filter(t => t.staleDays >= 28).length,
      };
    });

    const avgHealthScore = customers.length > 0
      ? Math.round(customers.reduce((s, c) => s + c.healthScore, 0) / customers.length)
      : 100;

    stats.avgHealthScore = avgHealthScore;

    return { stats, escalation, customers, tasks };
  },

  async createMeetingLog({ meeting, findings = [], tasks = [], notes = {} }) {
    const result = await db.query(
      `INSERT INTO meeting_notes (
         meeting_id, tenant_id, provider, transcript_source, transcript_url, transcript_text,
         summary, action_items, follow_up_actions, meeting_summary, ai_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, meeting_id AS "meetingId", tenant_id AS "tenantId", summary, action_items AS "actionItems",
                 follow_up_actions AS "followUpActions", meeting_summary AS "meetingSummary",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        meeting.id,
        meeting.tenantId,
        notes.provider || meeting.provider,
        notes.transcriptSource || 'manual',
        notes.transcriptUrl || null,
        notes.transcriptText || null,
        notes.summary || meeting.meetingNotes || '',
        JSON.stringify(notes.actionItems || []),
        JSON.stringify(notes.followUpActions || []),
        notes.meetingSummary || meeting.meetingNotes || '',
        notes.aiStatus || 'completed'
      ]
    );

    return result.rows[0];
  },

  async listMeetingLogs({ user, tenantId, page = 1, pageSize = 20 }) {
    const scopedTenantId = await tenantAccessService.resolveTenantId(user, tenantId);
    const tenantIds = scopedTenantId ? [scopedTenantId] : await tenantAccessService.getAccessibleTenantIds(user);
    const offset = (page - 1) * pageSize;

    const [{ rows: logs }, { rows: countRows }] = await Promise.all([
      db.query(
        `SELECT m.id AS "meetingId",
                m.tenant_id AS "tenantId",
                m.scheduled_start AS "scheduledStart",
                m.scheduled_end AS "scheduledEnd",
                m.meeting_type AS "meetingType",
                m.meeting_duration_minutes AS "meetingDurationMinutes",
                m.status AS "meetingStatus",
                m.title,
                m.provider,
                m.meeting_notes AS "meetingNotes",
                m.attendees,
                c.name AS "customerName",
                c.account_manager AS "accountManager",
                COALESCE(
                  mn.summary,
                  m.meeting_notes,
                  CONCAT('Meeting recap for ', c.name)
                ) AS summary,
                mn.action_items AS "actionItems",
                mn.follow_up_actions AS "followUpActions",
                mn.meeting_summary AS "meetingSummary",
                mn.created_at AS "createdAt",
                mn.updated_at AS "updatedAt"
         FROM meetings m
         JOIN customers c ON c.id = m.tenant_id
         LEFT JOIN meeting_notes mn ON mn.meeting_id = m.id
         WHERE m.tenant_id = ANY($1)
         ORDER BY m.scheduled_start DESC
         LIMIT $2 OFFSET $3`,
        [tenantIds, pageSize, offset]
      ),
      db.query(
        `SELECT COUNT(*)::INT AS count FROM meetings WHERE tenant_id = ANY($1)`,
        [tenantIds]
      ),
    ]);

    const total = countRows[0]?.count || 0;
    const meetingLogs = logs.map(mapMeetingLogRow);
    return {
      items: meetingLogs,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    };
  },

  async getMeetingLogById({ user, meetingId }) {
    const accessibleTenantIds = await tenantAccessService.getAccessibleTenantIds(user);
    const { rows } = await db.query(
      `SELECT m.id AS "meetingId",
              m.tenant_id AS "tenantId",
              m.scheduled_start AS "scheduledStart",
              m.scheduled_end AS "scheduledEnd",
              m.meeting_type AS "meetingType",
              m.meeting_duration_minutes AS "meetingDurationMinutes",
              m.status AS "meetingStatus",
              m.title,
              m.provider,
              m.meeting_notes AS "meetingNotes",
              m.attendees,
              c.name AS "customerName",
              c.account_manager AS "accountManager",
              mn.summary,
              mn.action_items AS "actionItems",
              mn.follow_up_actions AS "followUpActions",
              mn.meeting_summary AS "meetingSummary",
              mn.decisions_taken AS "decisionsTaken",
              mn.risks_discussed AS "risksDiscussed",
              mn.topics AS "topics",
              mn.ai_status AS "aiStatus",
              mn.created_at AS "createdAt",
              mn.updated_at AS "updatedAt"
       FROM meetings m
       JOIN customers c ON c.id = m.tenant_id
       LEFT JOIN meeting_notes mn ON mn.meeting_id = m.id
       WHERE m.id = $1 AND m.tenant_id = ANY($2)
       LIMIT 1`,
      [meetingId, accessibleTenantIds]
    );

    if (!rows[0]) {
      return null;
    }

    const meetingLog = mapMeetingLogRow(rows[0]);

    const [findingRows, taskRows] = await Promise.all([
      db.query(
        `SELECT id,
                meeting_id AS "meetingId",
                source_finding_id AS "sourceFindingId",
                severity,
                category,
                title,
                description,
                system_affected AS "systemAffected",
                created_at AS "createdAt"
         FROM findings
         WHERE meeting_id = $1
         ORDER BY created_at DESC`,
        [meetingId]
      ),
      db.query(
        `SELECT id,
                meeting_id AS "meetingId",
                finding_id AS "findingId",
                title,
                approval_status AS "approvalStatus",
                remediation_status AS "remediationStatus",
                owner_name AS "ownerName",
                ownership_team AS "ownershipTeam",
                due_date AS "dueDate",
                progress_percentage AS "progressPercentage",
                carry_forward_count AS "carryForwardCount",
                escalation_count AS "escalationCount",
                timeline,
                created_at AS "createdAt"
         FROM tasks
         WHERE meeting_id = $1
         ORDER BY created_at DESC`,
        [meetingId]
      )
    ]);

    const findingsDiscussed = findingRows.rows.map(mapFindingRow);
    const tasksDiscussed = taskRows.rows.map(mapTaskRow);

    return {
      ...meetingLog,
      findingsDiscussed,
      tasksDiscussed,
      taskTracking: tasksDiscussed.map((task) => ({
        id: task.id,
        status: task.remediationStatus,
        owner: task.ownerName,
        ownershipTeam: task.ownershipTeam,
        dueDate: task.dueDate,
        progressPercentage: task.progressPercentage
      })),
      carryForward: tasksDiscussed.filter((task) => task.carryForwardCount > 0),
      escalations: tasksDiscussed.filter((task) => task.escalationCount > 0)
    };
  },

  async resolveEscalation({ user, taskId, resolutionNote }) {
    return actionItemService.resolveEscalation(taskId, { resolutionNote }, user);
  },
};

module.exports = JourneyService;
