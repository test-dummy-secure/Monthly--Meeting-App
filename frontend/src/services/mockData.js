// Interactive mock data state engine for BMMJ demo
// Persists state in localStorage to allow live demonstrations of mutations

export const ACCOUNT_MANAGERS = [
  { id: 'am-1', name: 'Sarah Jenkins', email: 'sarah.jenkins@bmmj.com' },
  { id: 'am-2', name: 'Alex Rivera', email: 'alex.rivera@bmmj.com' },
  { id: 'am-3', name: 'Marcus Vance', email: 'marcus.vance@bmmj.com' },
  { id: 'am-4', name: 'Priya Sharma', email: 'priya.sharma@bmmj.com' },
];

export const INDUSTRIES = [
  'Financial Services',
  'Healthcare',
  'Aerospace & Defense',
  'Technology',
  'Retail & E-Commerce',
  'Energy & Utilities',
  'Manufacturing',
  'Government',
  'Education',
  'Other',
];

export const TIMEZONES = [
  { value: 'America/New_York', label: 'America/New_York (EST/EDT)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST/CDT)' },
  { value: 'America/Denver', label: 'America/Denver (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET/CEST)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST)' },
  { value: 'UTC', label: 'Coordinated Universal Time (UTC)' },
];

export const MEETING_PLATFORMS = [
  { value: 'microsoft_teams', label: 'Microsoft Teams', provider: 'microsoft' },
];

const DEFAULT_CUSTOMERS = [
  {
    id: 'tenant-uuid-1',
    name: 'FinTech Global Inc.',
    domain: 'fintechglobal.com',
    industry: 'Financial Services',
    timezone: 'America/New_York',
    meetingPlatform: 'microsoft_teams',
    status: 'active',
    connectedCalendars: ['microsoft'],
    accountManager: 'Sarah Jenkins',
    createdAt: '2026-01-15T09:00:00Z',
  },
  {
    id: 'tenant-uuid-2',
    name: 'AeroSpace Dynamics',
    domain: 'aerodynamics.io',
    industry: 'Aerospace & Defense',
    timezone: 'Europe/London',
    meetingPlatform: 'microsoft_teams',
    status: 'active',
    connectedCalendars: ['microsoft'],
    accountManager: 'Sarah Jenkins',
    createdAt: '2026-02-10T10:30:00Z',
  },
  {
    id: 'tenant-uuid-3',
    name: 'MedTech Solutions',
    domain: 'medtechhealth.org',
    industry: 'Healthcare',
    timezone: 'America/Chicago',
    meetingPlatform: 'microsoft_teams',
    status: 'inactive',
    connectedCalendars: [],
    accountManager: 'Alex Rivera',
    createdAt: '2026-04-01T14:15:00Z',
  },
];

const DEFAULT_MEETING_CONFIGS = [
  {
    id: 'config-uuid-1',
    tenantId: 'tenant-uuid-1',
    firstMeetingDate: '2026-06-05',
    meetingTime: '10:00',
    timezone: 'America/New_York',
    recurrencePattern: 'monthly_day_of_month',
  },
  {
    id: 'config-uuid-2',
    tenantId: 'tenant-uuid-2',
    firstMeetingDate: '2026-06-12',
    meetingTime: '14:00',
    timezone: 'Europe/London',
    recurrencePattern: 'monthly_day_of_week',
  },
];

// Phase-1 meeting statuses: scheduled | rescheduled | completed
// Internal statuses for workflow: scheduled, approval_pending, reschedule_requested, approved, conducted, closed
const DEFAULT_MEETINGS = [
  {
    id: 'meet-uuid-1',
    tenantId: 'tenant-uuid-1',
    scheduledStart: '2026-06-05T14:00:00Z',
    scheduledEnd: '2026-06-05T15:00:00Z',
    calendarEventId: 'google_evt_10928374',
    status: 'approval_pending',
    triggerDate: '2026-06-03T14:00:00Z',
    title: 'Buyer Monthly Review - FinTech Global',
    provider: 'microsoft',
    meetingPlatform: 'microsoft_teams',
    rescheduleRequest: null,
  },
  {
    id: 'meet-uuid-2',
    tenantId: 'tenant-uuid-2',
    scheduledStart: '2026-06-12T13:00:00Z',
    scheduledEnd: '2026-06-12T14:00:00Z',
    calendarEventId: 'ms_evt_99882231',
    status: 'scheduled',
    triggerDate: '2026-06-10T13:00:00Z',
    title: 'Vulnerability Remediation Check - AeroSpace Dynamics',
    provider: 'microsoft',
    meetingPlatform: 'microsoft_teams',
    rescheduleRequest: null,
  },
  {
    id: 'meet-uuid-3',
    tenantId: 'tenant-uuid-1',
    scheduledStart: '2026-05-05T14:00:00Z',
    scheduledEnd: '2026-05-05T15:00:00Z',
    calendarEventId: 'google_evt_10482910',
    status: 'completed',
    triggerDate: '2026-05-03T14:00:00Z',
    title: 'Buyer Monthly Review - FinTech Global',
    provider: 'microsoft',
    meetingPlatform: 'microsoft_teams',
    rescheduleRequest: null,
  },
];

const DEFAULT_FINDINGS = [
  {
    id: 'find-uuid-1',
    meetingId: 'meet-uuid-1',
    sourceFindingId: 'NXG-VULN-8082',
    severity: 'critical',
    category: 'Cloud Configuration',
    title: 'Exposed S3 Buckets containing Client PII Data',
    description: 'Public read access is granted to Amazon S3 buckets matching fintech-production-invoice-*. Sensitive files containing SSNs and financial histories are downloadable without authentication.',
    systemAffected: 'AWS Production S3 Service',
  },
  {
    id: 'find-uuid-2',
    meetingId: 'meet-uuid-1',
    sourceFindingId: 'NXG-VULN-9021',
    severity: 'high',
    category: 'Identity & Access Management',
    title: 'Active Developer Accounts without Multi-Factor Authentication',
    description: 'Twelve active administrative accounts in the production AWS IAM pool do not have MFA devices activated.',
    systemAffected: 'AWS Identity Management (IAM)',
  },
  {
    id: 'find-uuid-3',
    meetingId: 'meet-uuid-1',
    sourceFindingId: 'NXG-VULN-3342',
    severity: 'medium',
    category: 'Vulnerability Scanning',
    title: 'Outdated OpenSSL Version on Public Web Gateways',
    description: 'Nginx web servers running version 1.20 are utilizing OpenSSL v1.1.1k which contains known medium severity denial-of-service vulnerabilities.',
    systemAffected: 'Edge Load Balancer Fleet',
  },
];

const DEFAULT_REMEDIATION_TASKS = [
  {
    id: 'task-uuid-1',
    meetingId: 'meet-uuid-1',
    findingId: 'find-uuid-1',
    title: 'Enforce S3 Block Public Access & Enable KMS Encryption',
    actionPlan: '1. Apply AWS BlockPublicAccess configuration at the account level.\n2. Revoke wildcard * Principal permission in Bucket Policies.\n3. Enable default server-side encryption using customer-managed AWS KMS keys.',
    riskReductionScore: 95,
    priority: 'P1',
    severity: 'critical',
    remediationStrategy: 'Configuration Change',
    approvalStatus: 'pending',
    remediationStatus: 'open',
    originalMeetingId: 'meet-uuid-1',
    currentMeetingId: 'meet-uuid-1',
    carryForwardCount: 0,
    escalationStatus: 'none',
    meetingHistory: [
      { meetingId: 'meet-uuid-1', meetingTitle: 'Buyer Monthly Review - FinTech Global', meetingDate: '2026-06-05T14:00:00Z', action: 'created' },
    ],
    createdAt: '2026-05-25T08:00:00Z',
  },
  {
    id: 'task-uuid-2',
    meetingId: 'meet-uuid-1',
    findingId: 'find-uuid-2',
    title: 'Enforce IAM MFA Policy & Temporary Session Tokens',
    actionPlan: '1. Deploy an IAM Policy restricting all API & Console actions until MFA is authenticated.\n2. Send automated Slack notifications to the 12 non-compliant developer accounts.\n3. Set session token expiration to maximum 4 hours.',
    riskReductionScore: 80,
    priority: 'P2',
    severity: 'high',
    remediationStrategy: 'Policy Enforcement',
    approvalStatus: 'pending',
    remediationStatus: 'open',
    originalMeetingId: 'meet-uuid-1',
    currentMeetingId: 'meet-uuid-1',
    carryForwardCount: 0,
    escalationStatus: 'none',
    meetingHistory: [
      { meetingId: 'meet-uuid-1', meetingTitle: 'Buyer Monthly Review - FinTech Global', meetingDate: '2026-06-05T14:00:00Z', action: 'created' },
    ],
    createdAt: '2026-05-25T08:15:00Z',
  },
  {
    id: 'task-uuid-3',
    meetingId: 'meet-uuid-1',
    findingId: 'find-uuid-3',
    title: 'Upgrade Gateway Nginx Fleet to Stable OpenSSL Package',
    actionPlan: '1. Update Docker base image builds to Alpine 3.19.\n2. Perform blue-green rolling deployment on public application gates.\n3. Validate TLS handshakes and cipher configurations.',
    riskReductionScore: 45,
    priority: 'P3',
    severity: 'medium',
    remediationStrategy: 'Patch & Update',
    approvalStatus: 'pending',
    remediationStatus: 'open',
    originalMeetingId: 'meet-uuid-1',
    currentMeetingId: 'meet-uuid-1',
    carryForwardCount: 0,
    escalationStatus: 'none',
    meetingHistory: [
      { meetingId: 'meet-uuid-1', meetingTitle: 'Buyer Monthly Review - FinTech Global', meetingDate: '2026-06-05T14:00:00Z', action: 'created' },
    ],
    createdAt: '2026-05-25T08:30:00Z',
  },
  // Demo task carried forward from the May 2026 meeting — shows full carry-forward chain
  {
    id: 'task-uuid-cf-demo',
    meetingId: 'meet-uuid-1',
    findingId: 'find-uuid-2',
    title: 'Remediate Leaked AWS Root Access Keys from Legacy CI Pipeline',
    actionPlan: '1. Rotate all AWS root access keys immediately.\n2. Audit CI/CD pipeline secrets for any hardcoded credentials.\n3. Migrate to IAM role-based access for all pipeline operations.\n4. Enable AWS CloudTrail alerting for root account usage.',
    riskReductionScore: 98,
    priority: 'P1',
    severity: 'critical',
    remediationStrategy: 'Policy Enforcement',
    approvalStatus: 'approved',
    remediationStatus: 'in_progress',
    progressPercentage: 45,
    originalMeetingId: 'meet-uuid-3',
    currentMeetingId: 'meet-uuid-1',
    carryForwardCount: 2,
    escalationStatus: 'eligible',
    meetingHistory: [
      { meetingId: 'meet-uuid-3', meetingTitle: 'Buyer Monthly Review - FinTech Global (Apr)', meetingDate: '2026-04-05T14:00:00Z', action: 'created' },
      { meetingId: 'meet-uuid-3', meetingTitle: 'Buyer Monthly Review - FinTech Global (Apr)', meetingDate: '2026-04-05T14:00:00Z', action: 'carry_forward', carryForwardAt: '2026-04-05T16:00:00Z', reason: 'Key rotation pending CISO sign-off' },
      { meetingId: 'meet-uuid-1', meetingTitle: 'Buyer Monthly Review - FinTech Global (May)', meetingDate: '2026-05-05T14:00:00Z', action: 'carry_forward', carryForwardAt: '2026-05-05T16:00:00Z', reason: 'Pipeline migration blocked by DevOps team capacity' },
      { meetingId: 'meet-uuid-1', meetingTitle: 'Buyer Monthly Review - FinTech Global (Jun)', meetingDate: '2026-06-05T14:00:00Z', action: 'reattached', reattachedAt: '2026-06-03T10:00:00Z' },
    ],
    notes: 'Carried forward from April and May meetings. Escalation review required if not resolved this cycle.',
    createdAt: '2026-04-05T08:00:00Z',
  },
];

const DEFAULT_AUDIT_LOGS = [
  {
    id: 'log-uuid-1',
    tenantId: 'tenant-uuid-1',
    userEmail: 'manager@bmmj.com',
    action: 'Calendar Connection Created',
    details: { provider: 'microsoft', email: 'sarah.j@fintechglobal.com' },
    ipAddress: '192.168.10.45',
    createdAt: '2026-05-20T10:14:22Z',
  },
  {
    id: 'log-uuid-2',
    tenantId: 'tenant-uuid-2',
    userEmail: 'manager@bmmj.com',
    action: 'Meeting Configured',
    details: { recurrence: 'monthly', time: '14:00', timezone: 'Europe/London' },
    ipAddress: '192.168.10.45',
    createdAt: '2026-05-21T11:05:10Z',
  },
  {
    id: 'log-uuid-3',
    tenantId: 'tenant-uuid-1',
    userEmail: 'admin@bmmj.com',
    action: 'Customer Tenant Created',
    details: { name: 'FinTech Global Inc.' },
    ipAddress: '192.168.1.12',
    createdAt: '2026-05-19T09:00:00Z',
  },
];

const DEFAULT_MEETING_NOTE_PROVIDERS = [
  { id: 'microsoft-teams', name: 'Microsoft Teams Meeting Notes', provider: 'teams', connected: false, accountEmail: '' },
  { id: 'microsoft-copilot', name: 'Microsoft Copilot Meeting Notes', provider: 'copilot', connected: false, accountEmail: '' },
  { id: 'zoom-ai', name: 'Zoom AI Companion Notes', provider: 'zoom', connected: false, accountEmail: '' },
  { id: 'google-meet', name: 'Google Meet Notes', provider: 'google-meet', connected: false, accountEmail: '' },
  { id: 'otter', name: 'Otter.ai', provider: 'otter', connected: false, accountEmail: '' },
  { id: 'fireflies', name: 'Fireflies.ai', provider: 'fireflies', connected: false, accountEmail: '' },
  { id: 'avoma', name: 'Avoma', provider: 'avoma', connected: false, accountEmail: '' },
  { id: 'grain', name: 'Grain', provider: 'grain', connected: false, accountEmail: '' },
  { id: 'sembly', name: 'Sembly', provider: 'sembly', connected: false, accountEmail: '' },
];

// Bump this version whenever seed data schema changes to force a localStorage reset
const STORE_VERSION = '3';

// Initialize localStorage — resets automatically when STORE_VERSION changes
const initStore = () => {
  const storedVersion = localStorage.getItem('bmmj_store_version');
  const needsReset = storedVersion !== STORE_VERSION;

  if (needsReset) {
    localStorage.setItem('bmmj_customers', JSON.stringify(DEFAULT_CUSTOMERS));
    localStorage.setItem('bmmj_configs', JSON.stringify(DEFAULT_MEETING_CONFIGS));
    localStorage.setItem('bmmj_meetings', JSON.stringify(DEFAULT_MEETINGS));
    localStorage.setItem('bmmj_findings', JSON.stringify(DEFAULT_FINDINGS));
    localStorage.setItem('bmmj_tasks', JSON.stringify(DEFAULT_REMEDIATION_TASKS));
    localStorage.setItem('bmmj_logs', JSON.stringify(DEFAULT_AUDIT_LOGS));
    localStorage.setItem('bmmj_reports', JSON.stringify([]));
    localStorage.setItem('bmmj_meeting_notes', JSON.stringify([]));
    localStorage.setItem('bmmj_meeting_note_providers', JSON.stringify(DEFAULT_MEETING_NOTE_PROVIDERS));
    localStorage.setItem('bmmj_store_version', STORE_VERSION);
  }
};

initStore();

export const getStore = (key) => JSON.parse(localStorage.getItem(`bmmj_${key}`));
export const setStore = (key, data) => localStorage.setItem(`bmmj_${key}`, JSON.stringify(data));

const safeArray = (value) => (Array.isArray(value) ? value : []);

const getCurrentUser = () => {
  try { return JSON.parse(localStorage.getItem('bmmj_user') || 'null'); } catch { return null; }
};

const getSavedTenantId = () => localStorage.getItem('bmmj_selected_tenant');
const getCustomersList = () => safeArray(getStore('customers'));
const getMeetingsList = () => safeArray(getStore('meetings'));
const getFindingsList = () => safeArray(getStore('findings'));
const getTasksList = () => safeArray(getStore('tasks'));
const getReportsList = () => safeArray(getStore('reports'));
const getAuditLogsList = () => safeArray(getStore('logs'));
const getMeetingNotesList = () => safeArray(getStore('meeting_notes'));
const getMeetingNotesProviders = () => safeArray(getStore('meeting_note_providers'));

const initialsFromName = (name = 'User') =>
  String(name).split(' ').filter(Boolean).map((s) => s[0]).join('').slice(0, 2).toUpperCase() || 'U';

// Phase-1 display status: maps internal workflow states → Scheduled | Rescheduled | Completed
export const getPhase1Status = (internalStatus) => {
  if (!internalStatus) return 'Scheduled';
  const s = internalStatus.toLowerCase();
  if (s === 'completed' || s === 'closed') return 'Completed';
  if (s === 'reschedule_requested' || s === 'rescheduled') return 'Rescheduled';
  return 'Scheduled';
};

// Provider → human-readable meeting platform
export const getMeetingPlatformLabel = (provider, meetingPlatform) => {
  if (meetingPlatform === 'microsoft_teams' || provider === 'microsoft') return 'Microsoft Teams';
  return provider || 'Microsoft Teams';
};

const resolveTenantId = (tenantId) => {
  return tenantId || getSavedTenantId() || getCustomersList()[0]?.id || null;
};

const findCustomerById = (tenantId) =>
  getCustomersList().find((c) => String(c.id) === String(tenantId));
const findMeetingById = (meetingId) =>
  getMeetingsList().find((m) => String(m.id) === String(meetingId));
const findFindingById = (findingId) =>
  getFindingsList().find((f) => String(f.id) === String(findingId));

const buildOwner = (customer, task) => ({
  id: task?.primaryOwner?.id || `owner-${customer.id}`,
  name: task?.ownerName || task?.primaryOwner?.name || customer.accountManager || 'Account Manager',
  role: task?.primaryOwner?.role || 'Account Manager',
  email: task?.primaryOwner?.email || `${initialsFromName(customer.accountManager || 'manager').toLowerCase()}@bmmj.com`,
  avatar: task?.primaryOwner?.avatar || initialsFromName(task?.ownerName || customer.accountManager || 'AM'),
});

const buildSecondaryOwner = (customer, task) => ({
  id: task?.secondaryOwner?.id || `secondary-${customer.id}`,
  name: task?.secondaryOwner?.name || `${customer.name} Security Lead`,
  role: task?.secondaryOwner?.role || 'Customer Security Lead',
  email: task?.secondaryOwner?.email || `security@${customer.domain || 'tenant.local'}`,
  avatar: task?.secondaryOwner?.avatar || initialsFromName(customer.name),
});

const buildTimeline = (task, meeting, finding) => {
  if (Array.isArray(task?.timeline) && task.timeline.length > 0) return task.timeline;

  const taskTitle = task?.title || finding?.title || 'Remediation Task';
  const owner = task?.ownerName || 'Account Manager';
  const baseDate = new Date(meeting?.scheduledStart || new Date().toISOString());
  const createdAt = new Date(baseDate.getTime() - 1000 * 60 * 60 * 24);
  const updatedAt = new Date(baseDate.getTime() - 1000 * 60 * 60 * 6);

  return [
    { id: `${task?.id}-created`, date: createdAt.toISOString(), event: `${taskTitle} created`, actor: owner, type: 'created' },
    { id: `${task?.id}-assigned`, date: updatedAt.toISOString(), event: `Assigned to ${task?.ownershipTeam || 'Security Operations'}`, actor: owner, type: 'assigned' },
  ];
};

const buildMeetingNotesPayload = (meeting, providerRecord, notesSource = {}) => {
  const meetingCustomer = findCustomerById(meeting.tenantId);
  const tasks = getTasksList().filter((t) => t.meetingId === meeting.id).map(normalizeTask);
  const findings = getFindingsList().filter((f) => f.meetingId === meeting.id);
  const transcriptText = notesSource.transcriptText ||
    `Transcript capture for ${meeting.title}. ${meetingCustomer?.name || 'Customer'} reviewed ${findings.length} findings and ${tasks.length} remediation tasks.`;
  const summary = notesSource.summary ||
    `${meetingCustomer?.name || 'Customer'} reviewed ${findings.length} findings, ${tasks.length} remediation tasks.`;
  const actionItems = notesSource.actionItems || tasks.slice(0, 3).map((t) => `${t.title} — ${t.ownerName}`);
  const followUpActions = notesSource.followUpActions || [
    'Send recap to account manager',
    'Validate owners and due dates for open remediation tasks',
  ];

  return {
    id: notesSource.id || `meeting-notes-${meeting.id}`,
    meetingId: meeting.id,
    tenantId: meeting.tenantId,
    provider: providerRecord?.provider || meeting.provider || 'manual',
    providerName: providerRecord?.name || 'Manual Upload',
    transcriptSource: notesSource.transcriptSource || providerRecord?.provider || 'manual',
    transcriptUrl: notesSource.transcriptUrl || null,
    transcriptText,
    summary,
    actionItems,
    followUpActions,
    meetingSummary: notesSource.meetingSummary || summary,
    aiStatus: notesSource.aiStatus || 'completed',
    capturedAt: notesSource.capturedAt || new Date().toISOString(),
    participants: notesSource.participants || meeting.attendees || [],
  };
};

// Carry-forward: task is escalation-eligible after 2+ carry-forwards
const ESCALATION_THRESHOLD = 2;

const computeEscalationStatus = (carryForwardCount, currentStatus) => {
  if (currentStatus === 'escalated') return 'escalated';
  if (carryForwardCount >= ESCALATION_THRESHOLD) return 'eligible';
  return 'none';
};

const SEVERITY_PRIORITY_MAP = { critical: 'P1', high: 'P2', medium: 'P3', low: 'P4' };

const normalizeTask = (task) => {
  const meeting = findMeetingById(task.currentMeetingId || task.meetingId);
  const originalMeeting = task.originalMeetingId ? findMeetingById(task.originalMeetingId) : meeting;
  const customer = meeting ? findCustomerById(meeting.tenantId) : null;
  const finding = task.findingId ? findFindingById(task.findingId) : null;
  const dueDate = task.dueDate ||
    new Date(new Date(meeting?.scheduledStart || new Date()).getTime() + 1000 * 60 * 60 * 24 * 7).toISOString();
  const remediationStatus = task.remediationStatus ||
    (task.approvalStatus === 'approved' ? 'completed' : 'open');
  const progressPercentage = task.progressPercentage ??
    (remediationStatus === 'completed' ? 100 : remediationStatus === 'in_progress' ? 55 :
      remediationStatus === 'awaiting_validation' ? 80 : remediationStatus === 'carry_forward' ? 20 : 20);
  const carryForwardCount = task.carryForwardCount ?? 0;
  const severity = task.severity || finding?.severity || 'medium';
  const escalationStatus = task.escalationStatus || computeEscalationStatus(carryForwardCount, remediationStatus);

  return {
    ...task,
    tenantId: task.tenantId || meeting?.tenantId || customer?.id || null,
    customerName: customer?.name || task.customerName || 'Unknown Customer',
    sourceFindingId: task.sourceFindingId || finding?.sourceFindingId || 'NXG-UNKNOWN',
    severity,
    priority: task.priority || SEVERITY_PRIORITY_MAP[severity] || 'P4',
    category: task.category || finding?.category || 'General',
    systemAffected: task.systemAffected || finding?.systemAffected || 'Unspecified',
    remediationStrategy: task.remediationStrategy || 'Configuration Change',
    ownerName: task.ownerName || customer?.accountManager || 'Account Manager',
    ownershipTeam: task.ownershipTeam || 'Security Operations',
    dueDate,
    progressPercentage,
    carryForwardCount,
    escalationCount: task.escalationCount ?? (remediationStatus === 'escalated' ? 1 : 0),
    escalationStatus,
    // Carry-forward chain
    originalMeetingId: task.originalMeetingId || task.meetingId,
    currentMeetingId: task.currentMeetingId || task.meetingId,
    meetingHistory: task.meetingHistory || [
      { meetingId: task.meetingId, meetingTitle: meeting?.title || 'Monthly Review', meetingDate: meeting?.scheduledStart || task.createdAt, action: 'created' },
    ],
    openSinceMeeting: originalMeeting?.title || task.meetingTimeline || 'Monthly Review',
    openSinceMeetingDate: originalMeeting?.scheduledStart || task.createdAt,
    meetingTimeline: task.meetingTimeline || meeting?.title || 'Monthly Review',
    primaryOwner: buildOwner(customer || { id: 'tenant', accountManager: 'Account Manager' }, task),
    secondaryOwner: buildSecondaryOwner(customer || { id: 'tenant', name: 'Tenant', domain: 'tenant.local' }, task),
    timeline: buildTimeline(task, meeting, finding),
    notes: task.notes || '',
    status: remediationStatus,
    remediationStatus,
    lastUpdatedDate: task.lastUpdatedDate || task.lastUpdatedAt || task.updatedAt || task.createdAt || new Date().toISOString(),
  };
};

const normalizeMeeting = (meeting) => {
  const customer = findCustomerById(meeting.tenantId);
  const tasks = getTasksList().filter((t) => t.meetingId === meeting.id).map(normalizeTask);
  const findings = getFindingsList().filter((f) => f.meetingId === meeting.id);
  const openTasks = tasks.filter((t) => ['open', 'in_progress', 'awaiting_validation', 'escalated', 'overdue'].includes(t.status));
  const closedTasks = tasks.filter((t) => t.status === 'completed');

  return {
    ...meeting,
    title: meeting.title || `Monthly Review - ${customer?.name || 'Customer'}`,
    provider: meeting.provider || 'microsoft',
    meetingPlatform: meeting.meetingPlatform || customer?.meetingPlatform || 'microsoft_teams',
    meetingPlatformLabel: getMeetingPlatformLabel(meeting.provider, meeting.meetingPlatform || customer?.meetingPlatform),
    status: meeting.status || 'scheduled',
    phase1Status: getPhase1Status(meeting.status),
    meetingType: meeting.meetingType || 'monthly_review',
    meetingDurationMinutes: meeting.meetingDurationMinutes || 60,
    meetingNotes: meeting.meetingNotes || 'Meeting notes will appear here after the review.',
    attendees: meeting.attendees || [customer?.accountManager || 'Account Manager'],
    accountManager: customer?.accountManager || meeting.accountManager || 'Account Manager',
    customerName: customer?.name || meeting.customerName || 'Customer',
    findingsDiscussed: findings,
    tasksDiscussed: tasks,
    risksDiscussed: findings.filter((f) => ['critical', 'high'].includes(String(f.severity).toLowerCase())),
    decisionsTaken: meeting.decisionsTaken || ['Review remediation progress', 'Validate overdue tasks'],
    taskTracking: tasks.map((t) => ({ id: t.id, status: t.status, owner: t.ownerName, ownershipTeam: t.ownershipTeam, dueDate: t.dueDate, progress: t.progressPercentage })),
    carryForward: tasks.filter((t) => t.carryForwardCount > 0),
    escalations: tasks.filter((t) => t.escalationCount > 0 || t.status === 'escalated'),
    meetingSummary: meeting.meetingSummary || `${tasks.length} tasks tracked, ${openTasks.length} open and ${closedTasks.length} closed.`,
    actionItems: meeting.actionItems || tasks.slice(0, 3).map((t) => `${t.title} - ${t.ownerName}`),
    followUpActions: meeting.followUpActions || ['Review open items before the next monthly meeting'],
    meetingDuration: meeting.meetingDuration || meeting.meetingDurationMinutes || 60,
  };
};

const buildReport = (meeting) => {
  const meetingLog = normalizeMeeting(meeting);
  const tasks = meetingLog.tasksDiscussed || [];
  const openTasks = tasks.filter((t) => ['open', 'in_progress', 'awaiting_validation', 'escalated', 'overdue'].includes(t.status));
  const closedTasks = tasks.filter((t) => t.status === 'completed');
  const escalatedTasks = tasks.filter((t) => t.status === 'escalated' || t.escalationCount > 0);
  const existing = getReportsList().find((r) => String(r.meetingId) === String(meeting.id));

  return existing || {
    id: `report-${meeting.id}`,
    tenantId: meeting.tenantId,
    meetingId: meeting.id,
    reportType: meeting.status === 'completed' ? 'monthly_summary' : 'weekly_progress',
    title: `${meeting.title} - ${meeting.status === 'completed' ? 'Monthly Summary' : 'Weekly Progress'}`,
    summary: meetingLog.meetingSummary,
    openTasksCount: openTasks.length,
    closedTasksCount: closedTasks.length,
    escalatedTasksCount: escalatedTasks.length,
    carryForwardTasksCount: tasks.filter((t) => t.carryForwardCount > 0).length,
    progressPercentage: tasks.length > 0 ? Math.round((closedTasks.length / tasks.length) * 100) : 0,
    generatedBy: meeting.accountManager || 'System',
    generatedAt: meeting.updatedAt || meeting.scheduledStart || new Date().toISOString(),
    customerName: meetingLog.customerName,
    exportPayload: { meeting: meetingLog, tasks },
  };
};

const buildTrackerStats = (tasks) => {
  const byStatus = { open: 0, in_progress: 0, awaiting_validation: 0, completed: 0, escalated: 0, overdue: 0 };
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byTenant = {};
  let totalCarryForwards = 0;
  let totalEscalations = 0;
  let progressSum = 0;

  tasks.forEach((t) => {
    if (byStatus[t.status] !== undefined) byStatus[t.status] += 1;
    if (bySeverity[t.severity] !== undefined) bySeverity[t.severity] += 1;
    byTenant[t.customerName] = (byTenant[t.customerName] || 0) + 1;
    totalCarryForwards += t.carryForwardCount || 0;
    totalEscalations += t.escalationCount || 0;
    progressSum += t.progressPercentage || 0;
  });

  const totalTasks = tasks.length;
  const completedTasks = byStatus.completed;
  return {
    byStatus, bySeverity, byTenant, totalTasks, completedTasks,
    overallProgress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    avgProgress: totalTasks > 0 ? Math.round(progressSum / totalTasks) : 0,
    totalCarryForwards, totalEscalations,
    overdueCount: byStatus.overdue,
    activeTasks: totalTasks - completedTasks,
  };
};

const buildDashboardSummary = (tenantId) => {
  const scopeTenantId = resolveTenantId(tenantId);
  const customers = scopeTenantId ? [findCustomerById(scopeTenantId)].filter(Boolean) : getCustomersList();
  const meetings = getMeetingsList()
    .filter((m) => !scopeTenantId || String(m.tenantId) === String(scopeTenantId))
    .map(normalizeMeeting);
  const tasks = meetings.flatMap((m) => m.tasksDiscussed || []);
  const findings = meetings.flatMap((m) => m.findingsDiscussed || []);
  const upcomingMeetings = meetings.filter((m) => new Date(m.scheduledStart) > new Date()).length;
  const activeMeetings = meetings.filter((m) =>
    ['scheduled', 'approval_pending', 'reschedule_requested', 'conducted'].includes(m.status)
  ).length;

  return {
    totalCustomers: customers.length,
    activeMeetings,
    upcomingMeetings,
    openFindings: findings.length,
    escalatedTasks: tasks.filter((t) => t.status === 'escalated' || t.escalationCount > 0).length,
    tenantSummary: {
      openTasks: tasks.filter((t) => ['open', 'in_progress', 'awaiting_validation', 'escalated', 'overdue'].includes(t.status)).length,
      completedTasks: tasks.filter((t) => t.status === 'completed').length,
      escalatedTasks: tasks.filter((t) => t.status === 'escalated' || t.escalationCount > 0).length,
    },
    riskTrend: [
      { month: 'Jan', value: 12 },
      { month: 'Feb', value: 18 },
      { month: 'Mar', value: 15 },
      { month: 'Apr', value: 22 },
      { month: 'May', value: 19 },
    ],
    recentActivities: tasks
      .flatMap((t) => (t.timeline || []).map((e) => ({ ...e, taskId: t.id, description: e.event, time: e.date, type: e.type === 'created' ? 'Finding' : 'Meeting' })))
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 6),
    recentFindings: findings.slice(0, 6).map((f) => ({
      id: f.id, title: f.title,
      severity: f.severity.charAt(0).toUpperCase() + f.severity.slice(1),
      status: 'Open',
    })),
  };
};

export const mockService = {
  // Authentication — Phase-1 roles only: super_admin, account_manager
  login: (email, password) => {
    if (email === 'admin@bmmj.com' && password === 'admin123') {
      return {
        token: 'mock-jwt-admin-token',
        user: { email, first_name: 'Super', last_name: 'Admin', role: 'super_admin', tenant_id: null },
      };
    }
    if (email === 'manager@bmmj.com' && password === 'manager123') {
      return {
        token: 'mock-jwt-manager-token',
        user: { email, first_name: 'Sarah', last_name: 'Jenkins', role: 'account_manager', tenant_id: 'tenant-uuid-1' },
      };
    }
    throw new Error('Invalid email or password');
  },

  // Account Managers list
  getAccountManagers: () => ACCOUNT_MANAGERS,

  // Customers / Tenants
  getCustomers: () => {
    const currentUser = getCurrentUser();
    const customers = getCustomersList();
    if (currentUser?.role === 'account_manager') {
      const managerName = `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim();
      return customers.filter((c) => !managerName || c.accountManager === managerName);
    }
    return customers;
  },

  createCustomer: (customerData) => {
    const customers = getStore('customers');
    const tenantId = `tenant-${Date.now()}`;
    const newCustomer = {
      id: tenantId,
      name: customerData.name,
      domain: customerData.domain || '',
      industry: customerData.industry || 'Other',
      timezone: customerData.timezone || 'UTC',
      meetingPlatform: customerData.meetingPlatform || 'microsoft_teams',
      status: customerData.status || 'active',
      connectedCalendars: [],
      accountManager: customerData.accountManager || ACCOUNT_MANAGERS[0].name,
      createdAt: new Date().toISOString(),
    };
    customers.push(newCustomer);
    setStore('customers', customers);
    mockService.addAuditLog(newCustomer.id, 'Customer Tenant Created', { name: newCustomer.name });
    return newCustomer;
  },

  updateCustomer: (id, updates) => {
    const customers = getStore('customers');
    const index = customers.findIndex((c) => c.id === id);
    if (index === -1) throw new Error('Customer not found');
    customers[index] = { ...customers[index], ...updates, updatedAt: new Date().toISOString() };
    setStore('customers', customers);
    mockService.addAuditLog(id, 'Customer Tenant Updated', updates);
    return customers[index];
  },

  reassignAccountManager: (tenantId, newAccountManager) => {
    return mockService.updateCustomer(tenantId, { accountManager: newAccountManager });
  },

  deleteCustomer: (id) => {
    const customers = getStore('customers').filter((c) => c.id !== id);
    setStore('customers', customers);
    mockService.addAuditLog(id, 'Customer Tenant Deleted', { id });
  },

  // Meeting Configs
  getConfigs: () => getStore('configs'),
  saveConfig: (configData) => {
    const configs = getStore('configs');
    const newConfig = { id: `config-uuid-${Date.now()}`, ...configData };
    configs.push(newConfig);
    setStore('configs', configs);
    mockService.generateInitialMeetingForConfig(newConfig);
    mockService.addAuditLog(configData.tenantId, 'Meeting Configured', {
      firstMeetingDate: configData.firstMeetingDate,
      time: configData.meetingTime,
      timezone: configData.timezone,
    });
    return newConfig;
  },

  generateInitialMeetingForConfig: (config) => {
    const meetings = getStore('meetings');
    const baseDate = new Date(`${config.firstMeetingDate}T${config.meetingTime}:00`);
    const customer = getStore('customers').find((c) => c.id === config.tenantId);
    const provider = customer?.connectedCalendars?.[0] || 'microsoft';
    const meetingPlatform = customer?.meetingPlatform || 'microsoft_teams';
    const triggerDate = new Date(baseDate.getTime() - 48 * 60 * 60 * 1000);

    meetings.push({
      id: `meet-uuid-${Date.now()}`,
      tenantId: config.tenantId,
      meetingConfigId: config.id,
      scheduledStart: baseDate.toISOString(),
      scheduledEnd: new Date(baseDate.getTime() + 60 * 60 * 1000).toISOString(),
      calendarEventId: `${provider}_evt_${Math.floor(Math.random() * 10000000)}`,
      status: 'approval_pending',
      triggerDate: triggerDate.toISOString(),
      title: `Monthly Review - ${customer?.name || 'Client'}`,
      provider,
      meetingPlatform,
      rescheduleRequest: null,
    });

    const newMeetingId = meetings[meetings.length - 1].id;
    setStore('meetings', meetings);
    mockService.generateFindingsAndTasksForMeeting(newMeetingId);
  },

  generateNextMeetingForClosedMeeting: (meeting) => {
    const meetings = getStore('meetings');
    const configs = getStore('configs');
    const config = configs.find((c) => c.id === meeting.meetingConfigId);
    if (!config) return;

    const nextDate = new Date(meeting.scheduledStart);
    nextDate.setMonth(nextDate.getMonth() + 1);
    const triggerDate = new Date(nextDate.getTime() - 48 * 60 * 60 * 1000);
    const customer = getStore('customers').find((c) => c.id === meeting.tenantId);
    const provider = customer?.connectedCalendars?.[0] || meeting.provider || 'microsoft';
    const meetingPlatform = customer?.meetingPlatform || meeting.meetingPlatform || 'microsoft_teams';

    meetings.push({
      id: `meet-uuid-${Date.now()}`,
      tenantId: meeting.tenantId,
      meetingConfigId: meeting.meetingConfigId,
      scheduledStart: nextDate.toISOString(),
      scheduledEnd: new Date(nextDate.getTime() + 60 * 60 * 1000).toISOString(),
      calendarEventId: `${provider}_evt_${Math.floor(Math.random() * 10000000)}`,
      status: 'scheduled',
      triggerDate: triggerDate.toISOString(),
      title: meeting.title,
      provider,
      meetingPlatform,
      rescheduleRequest: null,
    });

    setStore('meetings', meetings);
    mockService.addAuditLog(meeting.tenantId, 'Next Meeting Created', { nextMeetingId: meetings[meetings.length - 1].id });
  },

  generateFindingsAndTasksForMeeting: (meetingId) => {
    const findings = getStore('findings');
    const tasks = getStore('tasks');
    const ts = Date.now();

    const f1Id = `find-uuid-${ts}-1`;
    findings.push({
      id: f1Id, meetingId, sourceFindingId: 'NXG-VULN-1011', severity: 'critical',
      category: 'Endpoint Security', title: 'Outdated Antivirus Fleet on Core Domain Controllers',
      description: 'Windows Defender signatures outdated by 45 days on active AD Controllers.',
      systemAffected: 'Primary & Secondary Active Directory Domain Controllers',
    });
    tasks.push({
      id: `task-uuid-${ts}-1`, meetingId, findingId: f1Id,
      title: 'Force Antivirus Signature Updates & Active Threat Scan',
      actionPlan: '1. Trigger immediate update task in group policy.\n2. Force full signature scan.\n3. Validate compliance dashboard.',
      riskReductionScore: 92, priority: 'P1', severity: 'critical', remediationStrategy: 'Patch & Update',
      approvalStatus: 'pending', remediationStatus: 'open',
      originalMeetingId: meetingId, currentMeetingId: meetingId,
      carryForwardCount: 0, escalationStatus: 'none',
      meetingHistory: [{ meetingId, meetingTitle: `Monthly Review`, meetingDate: new Date().toISOString(), action: 'created' }],
      createdAt: new Date().toISOString(),
    });

    const f2Id = `find-uuid-${ts}-2`;
    findings.push({
      id: f2Id, meetingId, sourceFindingId: 'NXG-VULN-2022', severity: 'high',
      category: 'Network Defense', title: 'External Port SSH (22) Exposed on Development Jumpboxes',
      description: 'Public security rules allow open SSH connections to staging subnets.',
      systemAffected: 'Development Staging VPN Jumpbox',
    });
    tasks.push({
      id: `task-uuid-${ts}-2`, meetingId, findingId: f2Id,
      title: 'Reconfigure Firewall Rules & Restrict to Corporate VPN Block',
      actionPlan: '1. Modify network security group rules.\n2. Restrict port 22 to office IP ranges.\n3. Set Azure Bastion for SSH sessions.',
      riskReductionScore: 85, priority: 'P2', severity: 'high', remediationStrategy: 'Configuration Change',
      approvalStatus: 'pending', remediationStatus: 'open',
      originalMeetingId: meetingId, currentMeetingId: meetingId,
      carryForwardCount: 0, escalationStatus: 'none',
      meetingHistory: [{ meetingId, meetingTitle: `Monthly Review`, meetingDate: new Date().toISOString(), action: 'created' }],
      createdAt: new Date().toISOString(),
    });

    setStore('findings', findings);
    setStore('tasks', tasks);
  },

  // Meetings
  getMeetings: () => getMeetingsList().map(normalizeMeeting),
  getMeetingById: (id) => {
    const meetings = getMeetingsList().map(normalizeMeeting);
    return meetings.find((m) => m.id === id || m.meetingId === id) || null;
  },

  triggerWorkflowNow: (meetingId) => {
    const meetings = getStore('meetings');
    const index = meetings.findIndex((m) => m.id === meetingId);
    if (index === -1) throw new Error('Meeting not found');
    meetings[index].status = 'approval_pending';
    setStore('meetings', meetings);
    mockService.generateFindingsAndTasksForMeeting(meetingId);
    mockService.addAuditLog(meetings[index].tenantId, 'Remediation Workflow Triggered', { meetingId });
    return meetings[index];
  },

  requestReschedule: (meetingId, requestedDate, requestedTime, reason) => {
    const meetings = getStore('meetings');
    const index = meetings.findIndex((m) => m.id === meetingId);
    if (index === -1) throw new Error('Meeting not found');
    const requestedStart = new Date(`${requestedDate}T${requestedTime}:00`).toISOString();
    const triggerDate = new Date(new Date(requestedStart).getTime() - 48 * 60 * 60 * 1000).toISOString();
    meetings[index].rescheduleRequest = {
      requestedStart, requestedTime, requestedDate,
      requestedReason: reason,
      requestedAt: new Date().toISOString(),
      requestedBy: localStorage.getItem('bmmj_user_email') || 'manager@bmmj.com',
      reviewStatus: 'pending',
      reviewerNotes: null,
    };
    meetings[index].status = 'reschedule_requested';
    meetings[index].triggerDate = triggerDate;
    setStore('meetings', meetings);
    mockService.addAuditLog(meetings[index].tenantId, 'Reschedule Requested', { meetingId, requestedStart, reason });
    return meetings[index];
  },

  reviewReschedule: (meetingId, approved, reviewerNotes = '') => {
    const meetings = getStore('meetings');
    const index = meetings.findIndex((m) => m.id === meetingId);
    if (index === -1) throw new Error('Meeting not found');
    if (!meetings[index].rescheduleRequest) throw new Error('No reschedule request exists');

    const req = meetings[index].rescheduleRequest;
    req.reviewStatus = approved ? 'approved' : 'rejected';
    req.reviewerNotes = reviewerNotes;
    req.reviewedAt = new Date().toISOString();

    if (approved) {
      const newStart = new Date(req.requestedStart);
      meetings[index].scheduledStart = newStart.toISOString();
      meetings[index].scheduledEnd = new Date(newStart.getTime() + 60 * 60 * 1000).toISOString();
      meetings[index].triggerDate = new Date(newStart.getTime() - 48 * 60 * 60 * 1000).toISOString();
      meetings[index].status = 'scheduled';
      mockService.addAuditLog(meetings[index].tenantId, 'Reschedule Approved', { meetingId, newStart: meetings[index].scheduledStart, reviewerNotes });
    } else {
      meetings[index].status = 'scheduled';
      mockService.addAuditLog(meetings[index].tenantId, 'Reschedule Rejected', { meetingId, reviewerNotes });
    }

    setStore('meetings', meetings);
    return meetings[index];
  },

  conductMeeting: (meetingId) => {
    const meetings = getStore('meetings');
    const index = meetings.findIndex((m) => m.id === meetingId);
    if (index === -1) throw new Error('Meeting not found');
    meetings[index].status = 'conducted';
    meetings[index].conductedAt = new Date().toISOString();
    setStore('meetings', meetings);
    mockService.addAuditLog(meetings[index].tenantId, 'Meeting Conducted', { meetingId });
    return meetings[index];
  },

  closeMeeting: (meetingId) => {
    const allMeetings = getStore('meetings');
    const index = allMeetings.findIndex((m) => m.id === meetingId);
    if (index === -1) throw new Error('Meeting not found');

    const closingMeeting = allMeetings[index];
    closingMeeting.status = 'completed';
    closingMeeting.closedAt = new Date().toISOString();
    setStore('meetings', allMeetings);

    // Generate next recurring meeting first so we have its ID for task relinking
    mockService.generateNextMeetingForClosedMeeting(closingMeeting);
    const updatedMeetings = getStore('meetings');
    const nextMeeting = updatedMeetings[updatedMeetings.length - 1];

    // ── Carry-Forward Logic ───────────────────────────────────────────────
    // Any task in this meeting that is NOT completed gets attached to the next
    // meeting: carryForwardCount++, meetingHistory appended, escalationStatus updated.
    const tasks = getStore('tasks');
    const INCOMPLETE = ['open', 'in_progress', 'awaiting_validation', 'carry_forward', 'escalated', 'overdue'];
    const now = new Date().toISOString();
    let cfCount = 0;

    tasks.forEach((task, i) => {
      const isForThisMeeting = task.currentMeetingId === meetingId || task.meetingId === meetingId;
      if (!isForThisMeeting) return;
      if (!INCOMPLETE.includes(task.remediationStatus || 'open')) return;

      const newCarryForwardCount = (task.carryForwardCount ?? 0) + 1;
      const newEscalationStatus = computeEscalationStatus(newCarryForwardCount, task.remediationStatus);

      tasks[i] = {
        ...task,
        currentMeetingId: nextMeeting?.id || task.currentMeetingId,
        carryForwardCount: newCarryForwardCount,
        escalationStatus: newEscalationStatus,
        remediationStatus: 'carry_forward',
        meetingHistory: [
          ...(task.meetingHistory || []),
          {
            meetingId: closingMeeting.id,
            meetingTitle: closingMeeting.title,
            meetingDate: closingMeeting.scheduledStart,
            action: 'carry_forward',
            carryForwardAt: now,
            reason: 'Task incomplete at meeting closure',
          },
        ],
        lastUpdatedDate: now,
      };
      cfCount++;
    });

    setStore('tasks', tasks);
    mockService.addAuditLog(closingMeeting.tenantId, 'Meeting Completed', { meetingId, tasksCarriedForward: cfCount });
    if (cfCount > 0) {
      mockService.addAuditLog(closingMeeting.tenantId, 'Tasks Carried Forward', { meetingId, nextMeetingId: nextMeeting?.id, count: cfCount });
    }
    return closingMeeting;
  },

  // Calendar Integrations
  connectCalendar: (tenantId, provider, email) => {
    const customers = getStore('customers');
    const index = customers.findIndex((c) => c.id === tenantId);
    if (index === -1) throw new Error('Customer not found');
    const connected = customers[index].connectedCalendars || [];
    if (!connected.includes(provider)) connected.push(provider);
    customers[index].connectedCalendars = connected;
    if (provider === 'microsoft' && !customers[index].meetingPlatform) customers[index].meetingPlatform = 'microsoft_teams';
    if (provider === 'microsoft' && !customers[index].meetingPlatform) customers[index].meetingPlatform = 'microsoft_teams';
    setStore('customers', customers);
    mockService.addAuditLog(tenantId, 'Calendar Connection Created', { provider, email });
    return customers[index];
  },

  disconnectCalendar: (tenantId, provider) => {
    const customers = getStore('customers');
    const index = customers.findIndex((c) => c.id === tenantId);
    if (index === -1) throw new Error('Customer not found');
    customers[index].connectedCalendars = (customers[index].connectedCalendars || []).filter((p) => p !== provider);
    setStore('customers', customers);
    mockService.addAuditLog(tenantId, 'Calendar Connection Revoked', { provider });
    return customers[index];
  },

  // Findings & Tasks
  getFindingsForMeeting: (meetingId) => getFindingsList().filter((f) => f.meetingId === meetingId),
  getTasksForMeeting: (meetingId) => getTasksList().filter((t) => t.meetingId === meetingId).map(normalizeTask),
  updateTaskStatus: (taskId, approvalStatus, notes = '') => {
    const tasks = getTasksList();
    const index = tasks.findIndex((t) => t.id === taskId);
    if (index === -1) throw new Error('Task not found');
    tasks[index].approvalStatus = approvalStatus;
    tasks[index].remediationStatus = approvalStatus === 'approved' ? 'completed' : tasks[index].remediationStatus;
    if (notes) tasks[index].notes = notes;
    setStore('tasks', tasks);

    const meetingId = tasks[index].meetingId;
    const meetingTasks = tasks.filter((t) => t.meetingId === meetingId);
    const allResolved = meetingTasks.every((t) => t.approvalStatus !== 'pending');
    if (allResolved) {
      const meetings = getStore('meetings');
      const meetIndex = meetings.findIndex((m) => m.id === meetingId);
      if (meetIndex !== -1 && meetings[meetIndex].status === 'approval_pending') {
        meetings[meetIndex].status = 'approved';
        setStore('meetings', meetings);
        mockService.addAuditLog(meetings[meetIndex].tenantId, 'All Remediation Tasks Approved', { meetingId });
      }
    }
    return tasks[index];
  },

  // Audit Logs
  getAuditLogs: () => getAuditLogsList(),
  addAuditLog: (tenantId, action, details) => {
    const logs = getAuditLogsList();
    logs.unshift({
      id: `log-uuid-${Date.now()}`,
      tenantId,
      userEmail: getCurrentUser()?.email || 'manager@bmmj.com',
      action,
      details,
      ipAddress: '127.0.0.1',
      createdAt: new Date().toISOString(),
    });
    setStore('logs', logs);
  },

  // Tracker
  getTrackerList: ({ tenantId, page = 1, pageSize = 20, severity = '', status = '', ownershipTeam = '' } = {}) => {
    const scopeTenantId = resolveTenantId(tenantId);
    const meetings = getMeetingsList()
      .filter((m) => !scopeTenantId || String(m.tenantId) === String(scopeTenantId))
      .map(normalizeMeeting);
    let tasks = meetings.flatMap((m) => m.tasksDiscussed || []);
    if (severity) tasks = tasks.filter((t) => t.severity === severity);
    if (status) tasks = tasks.filter((t) => t.status === status);
    if (ownershipTeam) tasks = tasks.filter((t) => t.ownershipTeam === ownershipTeam);
    const stats = buildTrackerStats(tasks);
    const total = tasks.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const startIndex = (page - 1) * pageSize;
    return { items: tasks.slice(startIndex, startIndex + pageSize), pagination: { page, pageSize, total, totalPages }, stats };
  },

  getCustomerSummary: (tenantId) => {
    const scopeTenantId = resolveTenantId(tenantId);
    const customer = findCustomerById(scopeTenantId);
    const meetings = getMeetingsList()
      .filter((m) => String(m.tenantId) === String(scopeTenantId))
      .map(normalizeMeeting);
    const tasks = meetings.flatMap((m) => m.tasksDiscussed || []);
    return {
      customer: customer ? { id: customer.id, name: customer.name, tenant: customer.name, accountManager: customer.accountManager, meetingStatus: meetings[0]?.status || 'scheduled' } : null,
      tasks,
      meetings,
    };
  },

  // Reports
  getReports: ({ tenantId, reportType = '', page = 1, pageSize = 20 } = {}) => {
    const scopeTenantId = resolveTenantId(tenantId);
    const meetings = getMeetingsList()
      .filter((m) => !scopeTenantId || String(m.tenantId) === String(scopeTenantId))
      .map(normalizeMeeting);
    const derived = meetings.map(buildReport).concat(
      getReportsList().filter((r) => !scopeTenantId || String(r.tenantId) === String(scopeTenantId))
    );
    const reports = reportType ? derived.filter((r) => r.reportType === reportType) : derived;
    const total = reports.length;
    const startIndex = (page - 1) * pageSize;
    return { items: reports.slice(startIndex, startIndex + pageSize), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  },

  generateReport: ({ tenantId, meetingId, reportType = 'weekly_progress', generatedBy = 'System' } = {}) => {
    const scopeTenantId = resolveTenantId(tenantId);
    const meeting = findMeetingById(meetingId);
    if (!meeting) throw new Error('Meeting not found');
    if (String(meeting.tenantId) !== String(scopeTenantId)) throw new Error('Tenant mismatch');
    const meetingLog = normalizeMeeting(meeting);
    const tasks = meetingLog.tasksDiscussed || [];
    const report = {
      id: `report-${Date.now()}`,
      tenantId: meeting.tenantId,
      meetingId: meeting.id,
      reportType,
      title: `${meeting.title} - ${reportType === 'monthly_summary' ? 'Monthly Summary' : 'Weekly Progress'}`,
      summary: meetingLog.meetingSummary,
      openTasksCount: tasks.filter((t) => ['open', 'in_progress', 'awaiting_validation', 'escalated', 'overdue'].includes(t.status)).length,
      closedTasksCount: tasks.filter((t) => t.status === 'completed').length,
      escalatedTasksCount: tasks.filter((t) => t.status === 'escalated' || t.escalationCount > 0).length,
      carryForwardTasksCount: tasks.filter((t) => t.carryForwardCount > 0).length,
      progressPercentage: tasks.length > 0 ? Math.round((tasks.filter((t) => t.status === 'completed').length / tasks.length) * 100) : 0,
      generatedBy,
      generatedAt: new Date().toISOString(),
      customerName: meetingLog.customerName,
      exportPayload: { meeting: meetingLog, tasks },
    };
    const reports = getReportsList();
    reports.unshift(report);
    setStore('reports', reports);
    return report;
  },

  // Meeting Logs
  getMeetingLogs: ({ tenantId, page = 1, pageSize = 20 } = {}) => {
    const scopeTenantId = resolveTenantId(tenantId);
    const meetings = getMeetingsList()
      .filter((m) => !scopeTenantId || String(m.tenantId) === String(scopeTenantId))
      .map(normalizeMeeting)
      .sort((a, b) => new Date(b.scheduledStart) - new Date(a.scheduledStart));
    const total = meetings.length;
    const startIndex = (page - 1) * pageSize;
    return {
      items: meetings.slice(startIndex, startIndex + pageSize).map((m) => ({ ...m, meetingDate: m.scheduledStart })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  },

  getMeetingLogById: (meetingId) => {
    const meeting = findMeetingById(meetingId);
    return meeting ? { ...normalizeMeeting(meeting), meetingDate: meeting.scheduledStart } : null;
  },

  getDashboardSummary: (tenantId) => buildDashboardSummary(tenantId),
  getAnalytics: (tenantId) => buildDashboardSummary(tenantId),
};
