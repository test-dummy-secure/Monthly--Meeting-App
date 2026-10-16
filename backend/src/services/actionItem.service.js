'use strict';

const taskRepository         = require('../repositories/task.repository');
const escalationRepository   = require('../repositories/escalation.repository');
const weeklyReportRepository = require('../repositories/weekly-report.repository');
const tenantAccessService    = require('./tenantAccess.service');
const notificationService    = require('./notification.service');
const auditLogRepository     = require('../repositories/audit-log.repository');
const logger                 = require('../utils/logger');

const actionItemService = {

  list: async (tenantId, user, filters = {}) => {
    await tenantAccessService.ensureTenantAccess(user, tenantId);
    return taskRepository.findActionItems(tenantId, filters);
  },

  getById: async (taskId, user) => {
    const task = await taskRepository.findById(taskId);
    if (!task) throw Object.assign(new Error('Action item not found'), { statusCode: 404 });
    await tenantAccessService.ensureTenantAccess(user, task.tenantId);
    return task;
  },

  create: async (data, user) => {
    await tenantAccessService.ensureTenantAccess(user, data.tenantId);
    const actorName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;

    const task = await taskRepository.create({
      meetingId:       data.meetingId,
      tenantId:        data.tenantId,
      title:           data.title,
      description:     data.description     || null,
      actionPlan:      data.actionPlan      || null,
      priority:        data.priority        || 'medium',
      ownerType:       data.ownerType       || 'ACCOUNT_MANAGER',
      ownerName:       data.ownerName       || null,
      ownerEmail:      data.ownerEmail      || null,
      ownerDepartment: data.ownerDepartment || null,
      dueDate:         data.dueDate         || null,
      riskReductionScore: data.riskReductionScore || 0,
      createdBy:       actorName,
    });

    auditLogRepository.create(data.tenantId, user.email, 'action_item_created', {
      taskId: task.id, title: data.title,
    }).catch(() => {});

    return task;
  },

  update: async (taskId, updates, user) => {
    const task = await taskRepository.findById(taskId);
    if (!task) throw Object.assign(new Error('Action item not found'), { statusCode: 404 });
    await tenantAccessService.ensureTenantAccess(user, task.tenantId);

    const actorName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
    const updated   = await taskRepository.updateActionItem(taskId, updates, task.tenantId);

    if (updates.remediationStatus) {
      await taskRepository.appendTimelineEvent(taskId, {
        id:    `evt-${Date.now()}`,
        date:  new Date().toISOString(),
        event: `Status updated to ${updates.remediationStatus}`,
        actor: actorName,
        type:  'status_change',
      });
    }

    auditLogRepository.create(task.tenantId, user.email, 'action_item_updated', {
      taskId, updates,
    }).catch(() => {});

    return updated;
  },

  escalate: async (taskId, { reason, blockerType, escalatedTo }, user) => {
    const task = await taskRepository.findById(taskId);
    if (!task) throw Object.assign(new Error('Action item not found'), { statusCode: 404 });
    await tenantAccessService.ensureTenantAccess(user, task.tenantId);

    const actorName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;

    // Write dedicated escalation record
    const escalation = await escalationRepository.create({
      taskId,
      tenantId:    task.tenantId,
      escalatedBy: actorName,
      escalatedTo: escalatedTo  || null,
      reason,
      blockerType: blockerType  || null,
    });

    // Update task escalation state (existing logic, preserves escalation_history JSONB)
    const updatedTask = await taskRepository.triggerEscalation(taskId, {
      blockerType:      blockerType || 'other',
      escalationReason: reason,
      escalatedBy:      actorName,
      notifyContact:    escalatedTo || '',
      tenantId:         task.tenantId,
    });

    await taskRepository.appendTimelineEvent(taskId, {
      id:    `evt-${Date.now()}`,
      date:  new Date().toISOString(),
      event: `Escalated: ${reason}`,
      actor: actorName,
      type:  'escalation',
    }).catch(() => {});

    auditLogRepository.create(task.tenantId, user.email, 'action_item_escalated', {
      taskId, escalationId: escalation.id, reason,
    }).catch(() => {});

    return { task: updatedTask, escalation };
  },

  resolveEscalation: async (taskId, { resolutionNote }, user) => {
    const task = await taskRepository.findById(taskId);
    if (!task) throw Object.assign(new Error('Action item not found'), { statusCode: 404 });
    await tenantAccessService.ensureTenantAccess(user, task.tenantId);

    if (task.remediationStatus !== 'escalated') {
      throw Object.assign(
        new Error(`Task is not currently escalated (status: ${task.remediationStatus})`),
        { statusCode: 409 }
      );
    }

    // Find the most recent open escalation record for this task
    const escalations = await escalationRepository.findByTask(taskId);
    const openEscalation = escalations.find((e) => e.status === 'open');
    if (!openEscalation) {
      throw Object.assign(new Error('No open escalation found for this task'), { statusCode: 404 });
    }

    const actorName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;

    // Resolve the escalation record
    await escalationRepository.resolve(openEscalation.id, actorName, resolutionNote || null, task.tenantId);

    // Move task back to in_progress so work can resume
    const updatedTask = await taskRepository.updateActionItem(taskId, { remediationStatus: 'in_progress' }, task.tenantId);

    await taskRepository.appendTimelineEvent(taskId, {
      id:    `evt-${Date.now()}`,
      date:  new Date().toISOString(),
      event: `Escalation resolved${resolutionNote ? ': ' + resolutionNote : ''}`,
      actor: actorName,
      type:  'escalation_resolved',
    }).catch(() => {});

    auditLogRepository.create(task.tenantId, user.email, 'escalation_resolved', {
      taskId, escalationId: openEscalation.id, resolutionNote,
    }).catch(() => {});

    logger.info('Escalation resolved', { taskId, escalationId: openEscalation.id, by: actorName });
    return { task: updatedTask, escalationId: openEscalation.id };
  },

  // Called by meeting.routes.js after closeMeeting() — carries forward all unresolved tasks.
  carryForwardForMeeting: async (meetingId, tenantId, actorName) => {
    const carriedTasks = await taskRepository.carryForwardTasks(meetingId, tenantId);

    // Resolve AM email once for the whole meeting — not once per task (Gap 3 fix)
    let amEmail = null;
    try {
      const recipients = await notificationService.resolveRecipients(tenantId);
      amEmail = recipients.amEmail;
    } catch (resolveErr) {
      logger.warn('carryForwardForMeeting: could not resolve AM email for notifications', {
        tenantId, error: resolveErr.message,
      });
    }

    for (const task of carriedTasks) {
      // Timeline event — best-effort, fire-and-forget
      taskRepository.appendTimelineEvent(task.id, {
        id:    `evt-${Date.now()}-${task.id.slice(0, 8)}`,
        date:  new Date().toISOString(),
        event: 'Task carried forward — meeting closed with unresolved status',
        actor: actorName,
        type:  'carry_forward',
      }).catch(() => {});

      // Carry-forward warning notification — fire-and-forget, must not block meeting close
      notificationService.notifyCarryForward({
        tenantId,
        taskId: task.id,
        task,
        amEmail,
      }).catch(() => {});
    }

    logger.info('Carry-forward complete', { meetingId, tenantId, count: carriedTasks.length });
    return carriedTasks;
  },

  getStats: async (tenantId, user) => {
    await tenantAccessService.ensureTenantAccess(user, tenantId);
    return taskRepository.getActionItemStats(tenantId);
  },

  // Internal variant — no user/tenant access check. Called by the weekly-report job only.
  generateWeeklyReportInternal: async (tenantId, generatedBy) => {
    const [tasks, stats] = await Promise.all([
      taskRepository.findApprovedByTenant(tenantId),
      taskRepository.getActionItemStats(tenantId),
    ]);

    const now      = new Date();
    const dayIdx   = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayIdx);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const fmtDate = (d) => d.toISOString().split('T')[0];

    const carryForwardItems = tasks.filter(
      (t) => t.carryForwardCount > 0 && !['completed', 'closed', 'cancelled'].includes(t.remediationStatus)
    );
    const escalatedItems = tasks.filter((t) => t.remediationStatus === 'escalated');
    const overdueItems   = tasks.filter(
      (t) => t.dueDate && new Date(t.dueDate) < now && !['completed', 'closed', 'cancelled'].includes(t.remediationStatus)
    );

    const summary = {
      ...stats,
      weekStart:         fmtDate(weekStart),
      weekEnd:           fmtDate(weekEnd),
      generatedAt:       now.toISOString(),
      carryForwardTotal: carryForwardItems.length,
      escalatedTotal:    escalatedItems.length,
      overdueTotal:      overdueItems.length,
    };

    const tasksSnapshot = tasks.map((t) => ({
      id:                t.id,
      title:             t.title,
      remediationStatus: t.remediationStatus,
      ownerType:         t.ownerType,
      ownerName:         t.ownerName,
      dueDate:           t.dueDate,
      carryForwardCount: t.carryForwardCount,
      priority:          t.priority,
    }));

    const report = await weeklyReportRepository.create({
      tenantId,
      meetingId:  null,
      weekStart:  fmtDate(weekStart),
      weekEnd:    fmtDate(weekEnd),
      generatedBy,
      summary,
      tasksSnapshot,
    });

    auditLogRepository.create(tenantId, 'system@bmmj.internal', 'weekly_report_generated', {
      reportId: report.id, weekStart: fmtDate(weekStart),
    }).catch(() => {});

    return { report, summary, carryForwardItems, escalatedItems, overdueItems };
  },

  generateWeeklyReport: async (tenantId, meetingId, generatedBy, user) => {
    await tenantAccessService.ensureTenantAccess(user, tenantId);

    const [{ items: tasks }, stats] = await Promise.all([
      taskRepository.findActionItems(tenantId, { pageSize: 500 }),
      taskRepository.getActionItemStats(tenantId),
    ]);

    const now     = new Date();
    const dayIdx  = now.getDay(); // 0 = Sun
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayIdx);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const fmtDate = (d) => d.toISOString().split('T')[0];

    const carryForwardItems = tasks.filter(
      (t) => t.carryForwardCount > 0 && !['completed', 'closed', 'cancelled'].includes(t.remediationStatus)
    );
    const escalatedItems = tasks.filter((t) => t.remediationStatus === 'escalated');
    const overdueItems   = tasks.filter(
      (t) => t.dueDate && new Date(t.dueDate) < now && !['completed', 'closed', 'cancelled'].includes(t.remediationStatus)
    );

    const summary = {
      ...stats,
      weekStart:         fmtDate(weekStart),
      weekEnd:           fmtDate(weekEnd),
      generatedAt:       now.toISOString(),
      carryForwardTotal: carryForwardItems.length,
      escalatedTotal:    escalatedItems.length,
      overdueTotal:      overdueItems.length,
    };

    const tasksSnapshot = tasks.map((t) => ({
      id:               t.id,
      title:            t.title,
      remediationStatus: t.remediationStatus,
      ownerType:        t.ownerType,
      ownerName:        t.ownerName,
      dueDate:          t.dueDate,
      carryForwardCount: t.carryForwardCount,
      priority:         t.priority,
    }));

    const report = await weeklyReportRepository.create({
      tenantId,
      meetingId:    meetingId || null,
      weekStart:    fmtDate(weekStart),
      weekEnd:      fmtDate(weekEnd),
      generatedBy,
      summary,
      tasksSnapshot,
    });

    auditLogRepository.create(tenantId, user.email, 'weekly_report_generated', {
      reportId: report.id, weekStart: fmtDate(weekStart),
    }).catch(() => {});

    return { report, summary, carryForwardItems, escalatedItems, overdueItems };
  },
};

module.exports = actionItemService;
