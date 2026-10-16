// ============================================================
// BMMJ — Weekly Reports Module Mock Data Store
// production-ready Mock Layer persisting state in localStorage
// ============================================================

import { getStore } from './mockData';
import { trackerService } from './trackerMockData';

const REPORTS_STORE_KEY = 'bmmj_weekly_reports';
const REPORTS_VERSION = '2';
const REPORTS_VERSION_KEY = 'bmmj_reports_version';

// Default reports to seed the application
const DEFAULT_REPORTS = [
  {
    id: 'rep-wk-001',
    meetingId: 'meet-uuid-1',
    meetingTimeline: 'June 2026 — Monthly Review Cycle',
    customerName: 'FinTech Global Inc.',
    tenantId: 'tenant-uuid-1',
    reportType: 'weekly_progress',
    title: 'Weekly Progress Report — June Week 1',
    openTasksCount: 2,
    closedTasksCount: 1,
    overdueTasksCount: 0,
    escalatedTasksCount: 0,
    carryForwardTasksCount: 1,
    progressPercentage: 40,
    upcomingMeetingDate: '2026-06-05T14:00:00Z',
    ownership: 'Sarah Jenkins (Lead AM) / David Park (Cloud Security)',
    generatedAt: '2026-06-01T08:00:00Z',
    generatedBy: 'Sarah Jenkins',
    description: 'Weekly checkpoint report analyzing progress on Cloud S3 configuration upgrades, developer identity security policies, and edge web gateway patches.',
    taskList: [
      { id: 'trk-task-001', title: 'Enforce S3 Block Public Access & Enable KMS Encryption', status: 'in_progress', severity: 'critical', progress: 35, reviewOutcome: 'on_track', owner: 'Sarah Jenkins' },
      { id: 'trk-task-002', title: 'Enforce IAM MFA Policy & Rotate Stale Session Tokens', status: 'awaiting_validation', severity: 'high', progress: 72, reviewOutcome: 'awaiting_approval', owner: 'Sarah Jenkins' },
      { id: 'trk-task-003', title: 'Upgrade Nginx Fleet to Patched OpenSSL — Rolling Blue/Green Deploy', status: 'open', severity: 'medium', progress: 15, reviewOutcome: 'customer_dependency', owner: 'Sarah Jenkins' }
    ],
    reviewOutcomeBreakdown: { on_track: 1, customer_dependency: 1, awaiting_approval: 1, escalation_required: 0 },
    taskOwnershipBreakdown: [
      { owner: 'Sarah Jenkins', role: 'Account Manager',          taskCount: 3 },
      { owner: 'David Park',    role: 'Cloud Security Engineer',  taskCount: 1 },
      { owner: 'Priya Nair',   role: 'IAM & Identity Lead',      taskCount: 1 },
      { owner: 'Tom Bradley',  role: 'DevOps Engineer',           taskCount: 1 },
    ],
    taskStatusBreakdown: { open: 1, in_progress: 1, awaiting_validation: 1, completed: 0, carry_forward: 1, escalated: 0, overdue: 0 },
  },
  {
    id: 'rep-ms-001',
    meetingId: 'meet-uuid-3',
    meetingTimeline: 'May 2026 — Monthly Review Cycle',
    customerName: 'FinTech Global Inc.',
    tenantId: 'tenant-uuid-1',
    reportType: 'monthly_summary',
    title: 'Monthly Meeting Summary — May 2026 Review',
    openTasksCount: 0,
    closedTasksCount: 2,
    overdueTasksCount: 0,
    escalatedTasksCount: 0,
    carryForwardTasksCount: 0,
    progressPercentage: 100,
    upcomingMeetingDate: '2026-06-05T14:00:00Z',
    ownership: 'Sarah Jenkins (Lead AM)',
    generatedAt: '2026-05-10T12:00:00Z',
    generatedBy: 'Sarah Jenkins',
    description: 'Executive summary report generated upon conclusion of the May 2026 review cycle. Focuses on secrets rotation policies and edge security rules.',
    taskList: [
      { id: 'trk-task-007', title: 'Rotate Exposed AWS API Keys in Version-Controlled Repositories', status: 'completed', severity: 'critical', progress: 100, reviewOutcome: 'on_track', owner: 'Sarah Jenkins' },
      { id: 'trk-task-008', title: 'Deploy WAF Rules to Mitigate OWASP Top 10 on Payment Gateway', status: 'completed', severity: 'critical', progress: 100, reviewOutcome: 'on_track', owner: 'Sarah Jenkins' }
    ],
    reviewOutcomeBreakdown: { on_track: 2, customer_dependency: 0, awaiting_approval: 0, escalation_required: 0 },
    taskOwnershipBreakdown: [
      { owner: 'Sarah Jenkins', role: 'Account Manager',                  taskCount: 2 },
      { owner: 'David Park',    role: 'Cloud Security Engineer',          taskCount: 1 },
      { owner: 'Monica Redd',   role: 'Application Security Engineer',    taskCount: 1 },
    ],
    taskStatusBreakdown: { open: 0, in_progress: 0, awaiting_validation: 0, completed: 2, carry_forward: 0, escalated: 0, overdue: 0 },
  },
  {
    id: 'rep-wk-002',
    meetingId: 'meet-uuid-2',
    meetingTimeline: 'June 2026 — Monthly Review Cycle',
    customerName: 'AeroSpace Dynamics',
    tenantId: 'tenant-uuid-2',
    reportType: 'weekly_progress',
    title: 'Weekly Progress Report — June Week 1',
    openTasksCount: 3,
    closedTasksCount: 0,
    overdueTasksCount: 1,
    escalatedTasksCount: 2,
    carryForwardTasksCount: 0,
    progressPercentage: 48,
    upcomingMeetingDate: '2026-06-12T13:00:00Z',
    ownership: 'Alex Rivera (Lead AM) / Chen Wei (Network Lead)',
    generatedAt: '2026-06-02T09:00:00Z',
    generatedBy: 'Alex Rivera',
    description: 'Weekly review checkpoint analyzing AKS container defenses, SSH exposure rules, and custom Azure RBAC profile deployments.',
    taskList: [
      { id: 'trk-task-004', title: 'Restrict Public SSH Exposure on Development Jumpboxes', status: 'overdue', severity: 'high', progress: 0, reviewOutcome: 'escalation_required', owner: 'Alex Rivera' },
      { id: 'trk-task-005', title: 'Implement RBAC & Least-Privilege for Azure AD Service Principals', status: 'in_progress', severity: 'high', progress: 55, reviewOutcome: 'on_track', owner: 'Alex Rivera' },
      { id: 'trk-task-006', title: 'Enable Azure Defender for Containers & Kubernetes RBAC Hardening', status: 'awaiting_validation', severity: 'critical', progress: 90, reviewOutcome: 'on_track', owner: 'Alex Rivera' }
    ],
    reviewOutcomeBreakdown: { on_track: 2, customer_dependency: 0, awaiting_approval: 0, escalation_required: 1 },
    taskOwnershipBreakdown: [
      { owner: 'Alex Rivera',    role: 'Account Manager',             taskCount: 3 },
      { owner: 'Chen Wei',       role: 'Network Security Architect',  taskCount: 1 },
      { owner: 'Lisa Hoffman',   role: 'Azure Identity Engineer',     taskCount: 1 },
      { owner: 'Marcus Thompson',role: 'Kubernetes & Platform SRE',   taskCount: 1 },
    ],
    taskStatusBreakdown: { open: 0, in_progress: 1, awaiting_validation: 1, completed: 0, carry_forward: 0, escalated: 1, overdue: 1 },
  },
  {
    id: 'rep-ms-002',
    meetingId: 'meet-uuid-2',
    meetingTimeline: 'May 2026 — Monthly Review Cycle',
    customerName: 'AeroSpace Dynamics',
    tenantId: 'tenant-uuid-2',
    reportType: 'monthly_summary',
    title: 'Monthly Meeting Summary — May 2026 AeroSpace Review',
    openTasksCount: 1,
    closedTasksCount: 2,
    overdueTasksCount: 0,
    escalatedTasksCount: 0,
    carryForwardTasksCount: 1,
    progressPercentage: 72,
    upcomingMeetingDate: '2026-06-12T13:00:00Z',
    ownership: 'Alex Rivera (Lead AM) / Marcus Thompson (Platform SRE)',
    generatedAt: '2026-05-15T10:30:00Z',
    generatedBy: 'Alex Rivera',
    description: 'Monthly closure summary for AeroSpace Dynamics May 2026 security review cycle. Covers Kubernetes hardening milestones, Azure RBAC rollout, and outstanding SSH exposure remediation carried into June.',
    taskList: [
      { id: 'trk-task-004', title: 'Restrict Public SSH Exposure on Development Jumpboxes', status: 'carry_forward', severity: 'high', progress: 0, reviewOutcome: 'customer_dependency', owner: 'Alex Rivera' },
      { id: 'trk-task-005', title: 'Implement RBAC & Least-Privilege for Azure AD Service Principals', status: 'completed', severity: 'high', progress: 100, reviewOutcome: 'on_track', owner: 'Alex Rivera' },
      { id: 'trk-task-006', title: 'Enable Azure Defender for Containers & Kubernetes RBAC Hardening', status: 'completed', severity: 'critical', progress: 100, reviewOutcome: 'on_track', owner: 'Alex Rivera' },
    ],
    reviewOutcomeBreakdown: { on_track: 2, customer_dependency: 1, awaiting_approval: 0, escalation_required: 0 },
    taskOwnershipBreakdown: [
      { owner: 'Alex Rivera',    role: 'Account Manager',            taskCount: 3 },
      { owner: 'Marcus Thompson',role: 'Kubernetes & Platform SRE',  taskCount: 2 },
      { owner: 'Lisa Hoffman',   role: 'Azure Identity Engineer',    taskCount: 1 },
    ],
    taskStatusBreakdown: { open: 0, in_progress: 0, awaiting_validation: 0, completed: 2, carry_forward: 1, escalated: 0, overdue: 0 },
  },
];

const initReportsStore = () => {
  const stored = localStorage.getItem(REPORTS_VERSION_KEY);
  if (!localStorage.getItem(REPORTS_STORE_KEY) || stored !== REPORTS_VERSION) {
    localStorage.setItem(REPORTS_STORE_KEY, JSON.stringify(DEFAULT_REPORTS));
    localStorage.setItem(REPORTS_VERSION_KEY, REPORTS_VERSION);
  }
};

initReportsStore();

export const reportsService = {
  // Retrieve all reports
  getAllReports: () => {
    const list = JSON.parse(localStorage.getItem(REPORTS_STORE_KEY) || '[]');
    return list.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  },

  // Retrieve report details by ID
  getReportById: (reportId) => {
    const list = JSON.parse(localStorage.getItem(REPORTS_STORE_KEY) || '[]');
    return list.find(r => r.id === reportId) || null;
  },

  // Retrieve reports by Tenant ID
  getReportsByTenant: (tenantId) => {
    const list = JSON.parse(localStorage.getItem(REPORTS_STORE_KEY) || '[]');
    return list.filter(r => r.tenantId === tenantId);
  },

  // Generate a dynamic report using the active database state
  generateReport: (tenantId, meetingId, reportType, generatedByActor = 'System Engine') => {
    // 1. Fetch meeting context
    const meetings = getStore('meetings') || [];
    const meeting = meetings.find(m => m.id === meetingId) || null;
    if (!meeting) throw new Error('Meeting not found');

    // 2. Fetch customer info
    const customers = getStore('customers') || [];
    const customer = customers.find(c => c.id === tenantId) || null;
    if (!customer) throw new Error('Customer tenant not found');

    // 3. Fetch active tasks for this meeting
    const meetingTasks = trackerService.getTasksByMeeting(meetingId);
    if (meetingTasks.length === 0) throw new Error('No remediation tasks found for this meeting cycle');

    // 4. Calculate aggregates
    const total = meetingTasks.length;
    const closed = meetingTasks.filter(t => t.status === 'completed').length;
    const open = total - closed;
    const overdue = meetingTasks.filter(t => t.status === 'overdue').length;
    const escalated = meetingTasks.filter(t => t.status === 'escalated').length;
    const carryForward = meetingTasks.reduce((sum, t) => sum + (t.carryForwardCount > 0 ? 1 : 0), 0);
    const progressPercent = Math.round(
      meetingTasks.reduce((sum, t) => sum + t.progressPercentage, 0) / total
    );

    // Collect distinct owners for ownership summary
    const ownersSet = new Set();
    ownersSet.add(customer.accountManager || 'Account Manager');
    meetingTasks.forEach(t => {
      if (t.secondaryOwner?.name) ownersSet.add(t.secondaryOwner.name);
    });
    const ownershipSummary = Array.from(ownersSet).join(' / ');

    // Collect simplified tasks list for details view
    const simplifiedTasks = meetingTasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      severity: t.severity,
      progress: t.progressPercentage,
      reviewOutcome: t.reviewOutcome || 'on_track',
      owner: t.primaryOwner?.name || t.ownerName || customer.accountManager || 'AM',
    }));

    // Review outcome breakdown
    const reviewOutcomeBreakdown = { on_track: 0, customer_dependency: 0, awaiting_approval: 0, escalation_required: 0 };
    meetingTasks.forEach(t => {
      const k = t.reviewOutcome || 'on_track';
      if (reviewOutcomeBreakdown[k] !== undefined) reviewOutcomeBreakdown[k]++;
    });

    // Task ownership breakdown
    const ownerMap = {};
    meetingTasks.forEach(t => {
      const name = t.primaryOwner?.name || t.ownerName || 'Account Manager';
      const role = t.primaryOwner?.role || 'Account Manager';
      if (!ownerMap[name]) ownerMap[name] = { owner: name, role, taskCount: 0 };
      ownerMap[name].taskCount++;
    });
    const taskOwnershipBreakdown = Object.values(ownerMap);

    // Task status breakdown
    const taskStatusBreakdown = { open: 0, in_progress: 0, awaiting_validation: 0, completed: 0, carry_forward: 0, escalated: 0, overdue: 0 };
    meetingTasks.forEach(t => {
      const s = t.status || 'open';
      if (taskStatusBreakdown[s] !== undefined) taskStatusBreakdown[s]++;
    });

    // Find next upcoming meeting date
    const nextMeeting = meetings
      .filter(m => m.tenantId === tenantId && new Date(m.scheduledStart) > new Date(meeting.scheduledStart))
      .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart))[0];
    const upcomingMeetingDate = nextMeeting ? nextMeeting.scheduledStart : meeting.scheduledStart;

    const reportId = `rep-${reportType === 'weekly_progress' ? 'wk' : 'ms'}-${Date.now()}`;
    const reportWeekLabel = reportType === 'weekly_progress' ? ` — Week Checkpoint` : ' — Closing Review';

    const newReport = {
      id: reportId,
      meetingId,
      meetingTimeline: meeting.title.includes('Review') ? meeting.title : `${meeting.title} Cycle`,
      customerName: customer.name,
      tenantId,
      reportType,
      title: `${reportType === 'weekly_progress' ? 'Weekly Progress' : 'Monthly Meeting Summary'}${reportWeekLabel} (${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`,
      openTasksCount: open,
      closedTasksCount: closed,
      overdueTasksCount: overdue,
      escalatedTasksCount: escalated,
      carryForwardTasksCount: carryForward,
      progressPercentage: progressPercent,
      upcomingMeetingDate,
      ownership: ownershipSummary,
      generatedAt: new Date().toISOString(),
      generatedBy: generatedByActor,
      description: reportType === 'weekly_progress'
        ? `Remediation status report tracking active milestones, resolution checkouts, and key security deliverables between review cycles.`
        : `Official closure report summarizing completed findings, active risk mitigation rates, and final approvals.`,
      taskList: simplifiedTasks,
      reviewOutcomeBreakdown,
      taskOwnershipBreakdown,
      taskStatusBreakdown,
    };

    const currentReports = JSON.parse(localStorage.getItem(REPORTS_STORE_KEY) || '[]');
    currentReports.unshift(newReport);
    localStorage.setItem(REPORTS_STORE_KEY, JSON.stringify(currentReports));

    return newReport;
  }
};
