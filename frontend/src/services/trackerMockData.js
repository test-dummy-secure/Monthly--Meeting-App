// ============================================================
// BMMJ — Tracker Module Mock Data Store
// Production-ready mock layer with localStorage persistence
// ============================================================

import { getStore, setStore } from './mockData';

// ─── Tracker Task Statuses ───────────────────────────────────
export const TASK_STATUSES = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  AWAITING_VALIDATION: 'awaiting_validation',
  COMPLETED: 'completed',
  CARRY_FORWARD: 'carry_forward',
  ESCALATED: 'escalated',
  OVERDUE: 'overdue',
};

// ─── Priority Levels ─────────────────────────────────────────
export const PRIORITY_LEVELS = {
  P1: { label: 'P1', description: 'Critical', color: 'bg-rose-500/20 text-rose-400 border-rose-500/25' },
  P2: { label: 'P2', description: 'High',     color: 'bg-amber-500/20 text-amber-400 border-amber-500/25' },
  P3: { label: 'P3', description: 'Medium',   color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/25' },
  P4: { label: 'P4', description: 'Low',      color: 'bg-slate-500/20 text-slate-400 border-slate-700/50' },
};

// ─── Escalation Statuses ─────────────────────────────────────
export const ESCALATION_STATUSES = {
  NONE: 'none',
  ELIGIBLE: 'eligible',
  ESCALATED: 'escalated',
};

// ─── Weekly Review Outcomes ───────────────────────────────────
export const REVIEW_OUTCOMES = {
  on_track:             { key: 'on_track',             label: 'On Track',             color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/25' },
  customer_dependency:  { key: 'customer_dependency',  label: 'Customer Dependency',  color: 'bg-amber-500/20 text-amber-400 border-amber-500/25' },
  awaiting_approval:    { key: 'awaiting_approval',    label: 'Awaiting Approval',    color: 'bg-sky-500/20 text-sky-400 border-sky-500/25' },
  escalation_required:  { key: 'escalation_required',  label: 'Escalation Required',  color: 'bg-rose-500/20 text-rose-400 border-rose-500/25' },
};

// ─── Escalation Blocker Types (AM must verify one before submitting) ──
export const BLOCKER_TYPES = {
  customer_dependency: { key: 'customer_dependency', label: 'Customer Dependency',  description: 'Action requires customer team input or sign-off' },
  resource_constraint: { key: 'resource_constraint', label: 'Resource Constraint',  description: 'Insufficient staffing, budget, or tooling available' },
  awaiting_approval:   { key: 'awaiting_approval',   label: 'Awaiting Approval',    description: 'Pending sign-off from stakeholder or change board' },
  valid_delay:         { key: 'valid_delay',          label: 'Valid Delay',          description: 'Justified postponement due to dependency or sequencing' },
};

export const SEVERITY_LEVELS = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFORMATIONAL: 'informational',
};

export const REMEDIATION_STRATEGIES = {
  PATCH: 'Patch & Update',
  CONFIGURATION: 'Configuration Change',
  ARCHITECTURAL: 'Architectural Redesign',
  POLICY: 'Policy Enforcement',
  MONITORING: 'Enhanced Monitoring',
  DECOMMISSION: 'Decommission & Replace',
};

// ─── Default Tracker Tasks ───────────────────────────────────
const DEFAULT_TRACKER_TASKS = [
  // FinTech Global — meet-uuid-1 tasks
  {
    id: 'trk-task-001',
    meetingId: 'meet-uuid-1',
    meetingDate: '2026-06-05T14:00:00Z',
    meetingTimeline: 'June 2026 — Monthly Review Cycle',
    customerName: 'FinTech Global Inc.',
    tenantId: 'tenant-uuid-1',
    findingId: 'find-uuid-1',
    sourceFindingId: 'NXG-VULN-8082',
    title: 'Enforce S3 Block Public Access & Enable KMS Encryption',
    description:
      'Public read access is granted to Amazon S3 buckets matching fintech-production-invoice-*. Sensitive files containing SSNs and financial histories are downloadable without authentication. Immediate remediation required to meet SOC2 Type II and PCI-DSS compliance mandates.',
    severity: 'critical',
    category: 'Cloud Configuration',
    systemAffected: 'AWS Production S3 Service',
    primaryOwner: {
      id: 'usr-am-001',
      name: 'Sarah Jenkins',
      role: 'Account Manager',
      email: 'sarah.jenkins@bmmj.com',
      avatar: 'SJ',
    },
    secondaryOwner: {
      id: 'usr-clt-001',
      name: 'David Park',
      role: 'Cloud Security Engineer',
      email: 'd.park@fintechglobal.com',
      avatar: 'DP',
    },
    ownershipTeam: 'Cloud Infrastructure & Security',
    dueDate: '2026-06-12T23:59:59Z',
    progressPercentage: 35,
    status: 'in_progress',
    remediationStatus: 'in_progress',
    priority: 'P1',
    remediationStrategy: 'Configuration Change',
    originalMeetingId: 'meet-uuid-1',
    currentMeetingId: 'meet-uuid-1',
    carryForwardCount: 0,
    escalationStatus: 'none',
    escalationHistory: [],
    reviewOutcome: 'on_track',
    lastReviewedBy: 'Sarah Jenkins',
    lastReviewedDate: '2026-06-04T10:00:00Z',
    meetingHistory: [
      { meetingId: 'meet-uuid-1', meetingTitle: 'Buyer Monthly Review - FinTech Global', meetingDate: '2026-06-05T14:00:00Z', action: 'created' },
    ],
    resolutionSteps: [
      'Apply AWS BlockPublicAccess configuration at the account level via Terraform.',
      'Revoke wildcard * Principal permission in all Bucket Policies in production environment.',
      'Enable default server-side encryption using customer-managed AWS KMS CMK keys.',
      'Configure S3 Access Logs and enable AWS Macie for PII detection on affected buckets.',
      'Conduct post-remediation validation scan via NXG360 and document evidence for compliance audit.',
    ],
    lastUpdatedDate: '2026-06-03T10:22:00Z',
    carryForwardCount: 0,
    escalationCount: 0,
    notes:
      'KMS key rotation policy under discussion with CISO. Terraform plan drafted but pending review by cloud team.',
    timeline: [
      {
        id: 'evt-001-1',
        date: '2026-05-25T08:00:00Z',
        event: 'Task Created',
        actor: 'AI Remediation Engine',
        type: 'created',
      },
      {
        id: 'evt-001-2',
        date: '2026-05-26T09:15:00Z',
        event: 'Task Approved for Execution',
        actor: 'Sarah Jenkins',
        type: 'approved',
      },
      {
        id: 'evt-001-3',
        date: '2026-05-28T14:00:00Z',
        event: 'Assigned to David Park (Cloud Security)',
        actor: 'Sarah Jenkins',
        type: 'assigned',
      },
      {
        id: 'evt-001-4',
        date: '2026-06-01T11:30:00Z',
        event: 'Status updated to In Progress — Terraform plan drafted',
        actor: 'David Park',
        type: 'progress',
      },
      {
        id: 'evt-001-5',
        date: '2026-06-03T10:22:00Z',
        event: 'KMS CMK rotation policy sent for CISO approval',
        actor: 'David Park',
        type: 'update',
      },
    ],
  },
  {
    id: 'trk-task-002',
    meetingId: 'meet-uuid-1',
    meetingDate: '2026-06-05T14:00:00Z',
    meetingTimeline: 'June 2026 — Monthly Review Cycle',
    customerName: 'FinTech Global Inc.',
    tenantId: 'tenant-uuid-1',
    findingId: 'find-uuid-2',
    sourceFindingId: 'NXG-VULN-9021',
    title: 'Enforce IAM MFA Policy & Rotate Stale Session Tokens',
    description:
      'Twelve active administrative accounts in the production AWS IAM pool do not have MFA devices activated, violating SOC2 CC6.1 and ISO 27001 A.9.4.2 controls. Attackers can leverage credential stuffing to gain unrestricted administrative access.',
    severity: 'high',
    category: 'Identity & Access Management',
    systemAffected: 'AWS Identity Management (IAM)',
    primaryOwner: {
      id: 'usr-am-001',
      name: 'Sarah Jenkins',
      role: 'Account Manager',
      email: 'sarah.jenkins@bmmj.com',
      avatar: 'SJ',
    },
    secondaryOwner: {
      id: 'usr-clt-002',
      name: 'Priya Nair',
      role: 'IAM & Identity Lead',
      email: 'p.nair@fintechglobal.com',
      avatar: 'PN',
    },
    ownershipTeam: 'Identity & Access Management',
    dueDate: '2026-06-10T23:59:59Z',
    progressPercentage: 72,
    status: 'awaiting_validation',
    remediationStatus: 'awaiting_validation',
    priority: 'P2',
    remediationStrategy: 'Policy Enforcement',
    originalMeetingId: 'meet-uuid-3',
    currentMeetingId: 'meet-uuid-1',
    carryForwardCount: 1,
    escalationStatus: 'none',
    escalationHistory: [],
    reviewOutcome: 'awaiting_approval',
    lastReviewedBy: 'Sarah Jenkins',
    lastReviewedDate: '2026-06-04T10:00:00Z',
    meetingHistory: [
      { meetingId: 'meet-uuid-3', meetingTitle: 'Buyer Monthly Review - FinTech Global (May)', meetingDate: '2026-05-05T14:00:00Z', action: 'created' },
      { meetingId: 'meet-uuid-3', meetingTitle: 'Buyer Monthly Review - FinTech Global (May)', meetingDate: '2026-05-05T14:00:00Z', action: 'carry_forward', carryForwardAt: '2026-05-05T16:00:00Z', reason: '3 contractor accounts pending MFA enrollment' },
      { meetingId: 'meet-uuid-1', meetingTitle: 'Buyer Monthly Review - FinTech Global (Jun)', meetingDate: '2026-06-05T14:00:00Z', action: 'reattached', reattachedAt: '2026-06-03T08:00:00Z' },
    ],
    resolutionSteps: [
      'Deploy SCPs (Service Control Policies) that deny all API actions unless MFA is authenticated.',
      'Send automated Slack notifications to the 12 non-compliant developer accounts requiring immediate MFA enrollment.',
      'Set IAM session token expiration to maximum 4 hours for all human users.',
      'Create a compliance dashboard report showing MFA enrollment status for audit trail.',
      'Schedule follow-up verification scan in NXG360 within 72 hours of implementation.',
    ],
    lastUpdatedDate: '2026-06-02T16:45:00Z',
    carryForwardCount: 1,
    escalationCount: 0,
    notes:
      '9 of 12 accounts have enrolled MFA. Remaining 3 are contractors — access revoked pending enrollment.',
    timeline: [
      {
        id: 'evt-002-1',
        date: '2026-05-25T08:15:00Z',
        event: 'Task Created',
        actor: 'AI Remediation Engine',
        type: 'created',
      },
      {
        id: 'evt-002-2',
        date: '2026-05-26T09:20:00Z',
        event: 'Task Approved for Execution',
        actor: 'Sarah Jenkins',
        type: 'approved',
      },
      {
        id: 'evt-002-3',
        date: '2026-05-27T11:00:00Z',
        event: 'Carried Forward from May 2026 cycle',
        actor: 'System',
        type: 'carry_forward',
      },
      {
        id: 'evt-002-4',
        date: '2026-06-01T09:00:00Z',
        event: 'SCP policy deployed — 9/12 accounts MFA-enrolled',
        actor: 'Priya Nair',
        type: 'progress',
      },
      {
        id: 'evt-002-5',
        date: '2026-06-02T16:45:00Z',
        event: 'Validation requested — awaiting NXG360 re-scan confirmation',
        actor: 'Priya Nair',
        type: 'validation',
      },
    ],
  },
  {
    id: 'trk-task-003',
    meetingId: 'meet-uuid-1',
    meetingDate: '2026-06-05T14:00:00Z',
    meetingTimeline: 'June 2026 — Monthly Review Cycle',
    customerName: 'FinTech Global Inc.',
    tenantId: 'tenant-uuid-1',
    findingId: 'find-uuid-3',
    sourceFindingId: 'NXG-VULN-3342',
    title: 'Upgrade Nginx Fleet to Patched OpenSSL — Rolling Blue/Green Deploy',
    description:
      'Nginx web servers running v1.20 utilize OpenSSL v1.1.1k which contains CVE-2021-3449 (Denial of Service via malicious client hello) and CVE-2021-3450 (CA certificate bypass). Exploitation can result in service disruption to the public payment gateway.',
    severity: 'medium',
    category: 'Vulnerability Management',
    systemAffected: 'Edge Load Balancer Fleet (8 nodes)',
    primaryOwner: {
      id: 'usr-am-001',
      name: 'Sarah Jenkins',
      role: 'Account Manager',
      email: 'sarah.jenkins@bmmj.com',
      avatar: 'SJ',
    },
    secondaryOwner: {
      id: 'usr-clt-003',
      name: 'Tom Bradley',
      role: 'DevOps Engineer',
      email: 't.bradley@fintechglobal.com',
      avatar: 'TB',
    },
    ownershipTeam: 'Platform Engineering',
    dueDate: '2026-06-20T23:59:59Z',
    progressPercentage: 15,
    status: 'open',
    priority: 'P3',
    remediationStrategy: 'Patch & Update',
    originalMeetingId: 'meet-uuid-1',
    currentMeetingId: 'meet-uuid-1',
    carryForwardCount: 0,
    escalationStatus: 'none',
    escalationHistory: [],
    reviewOutcome: 'customer_dependency',
    lastReviewedBy: 'Sarah Jenkins',
    lastReviewedDate: '2026-06-04T10:00:00Z',
    meetingHistory: [
      { meetingId: 'meet-uuid-1', meetingTitle: 'Buyer Monthly Review - FinTech Global', meetingDate: '2026-06-05T14:00:00Z', action: 'created' },
    ],
    resolutionSteps: [
      'Update Dockerfile base image builds to Alpine 3.19 which includes patched OpenSSL 3.x.',
      'Test updated Docker images in staging environment and validate TLS handshake configurations.',
      'Perform blue-green rolling deployment across the 8-node load balancer fleet.',
      'Validate cipher suite configurations and confirm no degraded TLS performance.',
      'Update internal knowledge base with new Docker image tag and CI/CD pipeline references.',
    ],
    lastUpdatedDate: '2026-05-26T09:00:00Z',
    carryForwardCount: 0,
    escalationCount: 0,
    notes: 'Waiting for DevOps team sprint planning to schedule deployment window.',
    timeline: [
      {
        id: 'evt-003-1',
        date: '2026-05-25T08:30:00Z',
        event: 'Task Created',
        actor: 'AI Remediation Engine',
        type: 'created',
      },
      {
        id: 'evt-003-2',
        date: '2026-05-26T09:20:00Z',
        event: 'Task Approved for Execution',
        actor: 'Sarah Jenkins',
        type: 'approved',
      },
    ],
  },
  // ─── AeroSpace Dynamics — meet-uuid-2 tasks
  {
    id: 'trk-task-004',
    meetingId: 'meet-uuid-2',
    meetingDate: '2026-06-12T13:00:00Z',
    meetingTimeline: 'June 2026 — Monthly Review Cycle',
    customerName: 'AeroSpace Dynamics',
    tenantId: 'tenant-uuid-2',
    findingId: 'find-uuid-aero-1',
    sourceFindingId: 'NXG-VULN-5512',
    title: 'Restrict Public SSH Exposure on Development Jumpboxes',
    description:
      'Public network security group rules allow unrestricted SSH (Port 22) connections from 0.0.0.0/0 to development and staging jumpbox instances. This exposes the enterprise network boundary to brute-force, credential-stuffing, and nation-state dictionary attacks.',
    severity: 'high',
    category: 'Network Security',
    systemAffected: 'Development Staging VPN Jumpbox (3 instances)',
    primaryOwner: {
      id: 'usr-am-002',
      name: 'Alex Rivera',
      role: 'Account Manager',
      email: 'alex.rivera@bmmj.com',
      avatar: 'AR',
    },
    secondaryOwner: {
      id: 'usr-clt-004',
      name: 'Chen Wei',
      role: 'Network Security Architect',
      email: 'c.wei@aerodynamics.io',
      avatar: 'CW',
    },
    ownershipTeam: 'Network & Perimeter Security',
    dueDate: '2026-06-08T23:59:59Z',
    progressPercentage: 0,
    status: 'overdue',
    priority: 'P2',
    remediationStrategy: 'Configuration Change',
    originalMeetingId: 'meet-uuid-2',
    currentMeetingId: 'meet-uuid-2',
    carryForwardCount: 0,
    escalationStatus: 'escalated',
    escalationHistory: [
      {
        id: 'esc-trk-task-004-1',
        tenantId: 'tenant-uuid-2',
        taskId: 'trk-task-004',
        carryForwardCount: 0,
        escalationReason: 'Azure Bastion provisioning blocked by budget approval. Due date passed without remediation action.',
        escalatedBy: 'Alex Rivera',
        escalationDate: '2026-06-01T08:00:00Z',
        blockerType: 'resource_constraint',
        notifyContact: 'cto@aerodynamics.io',
      },
    ],
    reviewOutcome: 'escalation_required',
    lastReviewedBy: 'Alex Rivera',
    lastReviewedDate: '2026-06-04T09:00:00Z',
    meetingHistory: [
      { meetingId: 'meet-uuid-2', meetingTitle: 'Vulnerability Remediation Check - AeroSpace Dynamics', meetingDate: '2026-06-12T13:00:00Z', action: 'created' },
    ],
    resolutionSteps: [
      'Modify Azure Network Security Group rules to restrict port 22 to corporate VPN IP CIDR ranges only.',
      'Enable Azure Bastion service as the primary administrative SSH gateway for all jumpboxes.',
      'Implement port-knocking sequence as secondary authentication layer for emergency access.',
      'Configure Azure Security Center alerts for any future public port exposure events.',
      'Document updated network architecture diagram and share with CISO.',
    ],
    lastUpdatedDate: '2026-06-01T08:00:00Z',
    carryForwardCount: 0,
    escalationCount: 1,
    notes:
      'ESCALATED: Due date passed without action. Azure Bastion provisioning blocked by budget approval process.',
    timeline: [
      {
        id: 'evt-004-1',
        date: '2026-05-28T10:00:00Z',
        event: 'Task Created',
        actor: 'AI Remediation Engine',
        type: 'created',
      },
      {
        id: 'evt-004-2',
        date: '2026-05-29T09:00:00Z',
        event: 'Task Approved for Execution',
        actor: 'Alex Rivera',
        type: 'approved',
      },
      {
        id: 'evt-004-3',
        date: '2026-06-01T08:00:00Z',
        event: 'ESCALATED — Budget approval for Azure Bastion pending. Due date at risk.',
        actor: 'System',
        type: 'escalated',
      },
    ],
  },
  {
    id: 'trk-task-005',
    meetingId: 'meet-uuid-2',
    meetingDate: '2026-06-12T13:00:00Z',
    meetingTimeline: 'June 2026 — Monthly Review Cycle',
    customerName: 'AeroSpace Dynamics',
    tenantId: 'tenant-uuid-2',
    findingId: 'find-uuid-aero-2',
    sourceFindingId: 'NXG-VULN-6634',
    title: 'Implement RBAC & Least-Privilege for Azure AD Service Principals',
    description:
      'Fourteen Azure Active Directory service principals have been granted Contributor-level access at the subscription scope instead of targeted resource group scopes, violating the principle of least privilege and creating lateral movement opportunities.',
    severity: 'high',
    category: 'Identity & Access Management',
    systemAffected: 'Azure Active Directory (Tenant-wide)',
    primaryOwner: {
      id: 'usr-am-002',
      name: 'Alex Rivera',
      role: 'Account Manager',
      email: 'alex.rivera@bmmj.com',
      avatar: 'AR',
    },
    secondaryOwner: {
      id: 'usr-clt-005',
      name: 'Lisa Hoffman',
      role: 'Azure Identity Engineer',
      email: 'l.hoffman@aerodynamics.io',
      avatar: 'LH',
    },
    ownershipTeam: 'Identity & Access Management',
    dueDate: '2026-06-25T23:59:59Z',
    progressPercentage: 55,
    status: 'in_progress',
    priority: 'P2',
    remediationStrategy: 'Architectural Redesign',
    originalMeetingId: 'meet-uuid-2',
    currentMeetingId: 'meet-uuid-2',
    carryForwardCount: 0,
    escalationStatus: 'none',
    escalationHistory: [],
    reviewOutcome: 'on_track',
    lastReviewedBy: 'Alex Rivera',
    lastReviewedDate: '2026-06-04T09:00:00Z',
    meetingHistory: [
      { meetingId: 'meet-uuid-2', meetingTitle: 'Vulnerability Remediation Check - AeroSpace Dynamics', meetingDate: '2026-06-12T13:00:00Z', action: 'created' },
    ],
    resolutionSteps: [
      'Audit all 14 service principals and document their actual required resource access.',
      'Create targeted custom RBAC roles scoped to specific resource groups using ARM templates.',
      'Migrate all service principals from Contributor (subscription-scope) to custom least-privilege roles.',
      'Enable Azure AD Privileged Identity Management (PIM) for all human admin accounts.',
      'Configure Azure Monitor alerts for any future subscription-scope role assignments.',
    ],
    lastUpdatedDate: '2026-06-03T14:30:00Z',
    carryForwardCount: 0,
    escalationCount: 0,
    notes:
      '8 of 14 service principals migrated. Custom RBAC template being extended for CI/CD pipeline principals.',
    timeline: [
      {
        id: 'evt-005-1',
        date: '2026-05-28T10:30:00Z',
        event: 'Task Created',
        actor: 'AI Remediation Engine',
        type: 'created',
      },
      {
        id: 'evt-005-2',
        date: '2026-05-29T09:10:00Z',
        event: 'Task Approved for Execution',
        actor: 'Alex Rivera',
        type: 'approved',
      },
      {
        id: 'evt-005-3',
        date: '2026-06-01T11:00:00Z',
        event: 'ARM templates drafted for custom RBAC roles',
        actor: 'Lisa Hoffman',
        type: 'progress',
      },
      {
        id: 'evt-005-4',
        date: '2026-06-03T14:30:00Z',
        event: '8/14 service principals migrated to least-privilege RBAC',
        actor: 'Lisa Hoffman',
        type: 'progress',
      },
    ],
  },
  {
    id: 'trk-task-006',
    meetingId: 'meet-uuid-2',
    meetingDate: '2026-06-12T13:00:00Z',
    meetingTimeline: 'June 2026 — Monthly Review Cycle',
    customerName: 'AeroSpace Dynamics',
    tenantId: 'tenant-uuid-2',
    findingId: 'find-uuid-aero-3',
    sourceFindingId: 'NXG-VULN-7741',
    title: 'Enable Azure Defender for Containers & Kubernetes RBAC Hardening',
    description:
      'Azure Kubernetes Service (AKS) clusters are running without Microsoft Defender for Containers enabled. Additionally, several pods have hostNetwork: true and privileged: true security contexts, enabling potential container escape attacks.',
    severity: 'critical',
    category: 'Container Security',
    systemAffected: 'AKS Production Cluster (v1.28)',
    primaryOwner: {
      id: 'usr-am-002',
      name: 'Alex Rivera',
      role: 'Account Manager',
      email: 'alex.rivera@bmmj.com',
      avatar: 'AR',
    },
    secondaryOwner: {
      id: 'usr-clt-006',
      name: 'Marcus Thompson',
      role: 'Kubernetes & Platform SRE',
      email: 'm.thompson@aerodynamics.io',
      avatar: 'MT',
    },
    ownershipTeam: 'Platform Engineering',
    dueDate: '2026-06-07T23:59:59Z',
    progressPercentage: 90,
    status: 'awaiting_validation',
    priority: 'P1',
    remediationStrategy: 'Configuration Change',
    originalMeetingId: 'meet-uuid-2',
    currentMeetingId: 'meet-uuid-2',
    carryForwardCount: 0,
    escalationStatus: 'none',
    escalationHistory: [
      {
        id: 'esc-trk-task-006-1',
        tenantId: 'tenant-uuid-2',
        taskId: 'trk-task-006',
        carryForwardCount: 0,
        escalationReason: 'No action taken within 72 hours of approval. AKS cluster remediation had not commenced.',
        escalatedBy: 'System',
        escalationDate: '2026-05-31T08:00:00Z',
        blockerType: 'valid_delay',
        notifyContact: 'cto@aerodynamics.io',
        resolvedAt: '2026-06-01T16:00:00Z',
        resolvedBy: 'Alex Rivera',
        resolution: 'Marcus Thompson assigned and work commenced immediately.',
      },
    ],
    reviewOutcome: 'on_track',
    lastReviewedBy: 'Alex Rivera',
    lastReviewedDate: '2026-06-04T09:00:00Z',
    meetingHistory: [
      { meetingId: 'meet-uuid-2', meetingTitle: 'Vulnerability Remediation Check - AeroSpace Dynamics', meetingDate: '2026-06-12T13:00:00Z', action: 'created' },
    ],
    resolutionSteps: [
      'Enable Microsoft Defender for Containers on all AKS clusters via Azure Security Center policy.',
      'Implement OPA Gatekeeper admission controller with policies rejecting hostNetwork and privileged pods.',
      'Audit and remediate all existing pod security contexts — remove hostNetwork: true and privileged: true.',
      'Deploy Pod Security Standards (restricted profile) cluster-wide via namespace labels.',
      'Configure Falco runtime security monitoring for anomalous container behavior detection.',
    ],
    lastUpdatedDate: '2026-06-03T17:00:00Z',
    carryForwardCount: 0,
    escalationCount: 1,
    notes:
      'Defender for Containers enabled. Gatekeeper policies applied. Awaiting NXG360 re-scan to confirm closure. Previously escalated due to initial delay.',
    timeline: [
      {
        id: 'evt-006-1',
        date: '2026-05-28T11:00:00Z',
        event: 'Task Created',
        actor: 'AI Remediation Engine',
        type: 'created',
      },
      {
        id: 'evt-006-2',
        date: '2026-05-29T09:15:00Z',
        event: 'Task Approved for Execution',
        actor: 'Alex Rivera',
        type: 'approved',
      },
      {
        id: 'evt-006-3',
        date: '2026-05-31T08:00:00Z',
        event: 'ESCALATED — No action taken within 72 hours of approval',
        actor: 'System',
        type: 'escalated',
      },
      {
        id: 'evt-006-4',
        date: '2026-06-01T16:00:00Z',
        event: 'Escalation resolved — Marcus Thompson assigned, work commenced',
        actor: 'Alex Rivera',
        type: 'update',
      },
      {
        id: 'evt-006-5',
        date: '2026-06-02T10:00:00Z',
        event: 'Defender for Containers enabled on all 3 AKS clusters',
        actor: 'Marcus Thompson',
        type: 'progress',
      },
      {
        id: 'evt-006-6',
        date: '2026-06-03T17:00:00Z',
        event: 'OPA Gatekeeper policies applied — awaiting NXG360 validation scan',
        actor: 'Marcus Thompson',
        type: 'validation',
      },
    ],
  },
  // ─── FinTech Global — Completed Task (Older Meeting)
  {
    id: 'trk-task-007',
    meetingId: 'meet-uuid-3',
    meetingDate: '2026-05-05T14:00:00Z',
    meetingTimeline: 'May 2026 — Monthly Review Cycle',
    customerName: 'FinTech Global Inc.',
    tenantId: 'tenant-uuid-1',
    findingId: 'find-uuid-past-1',
    sourceFindingId: 'NXG-VULN-1099',
    title: 'Rotate Exposed AWS API Keys in Version-Controlled Repositories',
    description:
      'Long-lived AWS API keys (Access Key IDs) belonging to production IAM users were discovered committed to the internal GitHub Enterprise monorepo in plaintext configuration files. Keys were active with S3 full access and RDS read permissions.',
    severity: 'critical',
    category: 'Secrets Management',
    systemAffected: 'GitHub Enterprise & AWS IAM',
    primaryOwner: {
      id: 'usr-am-001',
      name: 'Sarah Jenkins',
      role: 'Account Manager',
      email: 'sarah.jenkins@bmmj.com',
      avatar: 'SJ',
    },
    secondaryOwner: {
      id: 'usr-clt-001',
      name: 'David Park',
      role: 'Cloud Security Engineer',
      email: 'd.park@fintechglobal.com',
      avatar: 'DP',
    },
    ownershipTeam: 'Cloud Infrastructure & Security',
    dueDate: '2026-05-10T23:59:59Z',
    progressPercentage: 100,
    status: 'completed',
    priority: 'P1',
    remediationStrategy: 'Patch & Update',
    originalMeetingId: 'meet-uuid-3',
    currentMeetingId: 'meet-uuid-3',
    carryForwardCount: 0,
    escalationStatus: 'none',
    escalationHistory: [],
    reviewOutcome: 'on_track',
    lastReviewedBy: 'Sarah Jenkins',
    lastReviewedDate: '2026-05-09T14:00:00Z',
    meetingHistory: [
      { meetingId: 'meet-uuid-3', meetingTitle: 'Buyer Monthly Review - FinTech Global', meetingDate: '2026-05-05T14:00:00Z', action: 'created' },
    ],
    resolutionSteps: [
      'Immediately revoke all discovered AWS API keys in the IAM console.',
      'Run git-secrets and trufflehog across all repository history to identify additional leaked secrets.',
      'Migrate all secrets to AWS Secrets Manager with automatic 30-day rotation configured.',
      'Implement GitHub Advanced Security secret scanning with push protection enabled.',
      'Conduct developer training session on secrets hygiene and pre-commit hook configuration.',
    ],
    lastUpdatedDate: '2026-05-09T14:00:00Z',
    carryForwardCount: 0,
    escalationCount: 0,
    notes: 'All 4 exposed API keys rotated. AWS Secrets Manager integration complete. Git history purged.',
    timeline: [
      {
        id: 'evt-007-1',
        date: '2026-04-28T08:00:00Z',
        event: 'Task Created',
        actor: 'AI Remediation Engine',
        type: 'created',
      },
      {
        id: 'evt-007-2',
        date: '2026-04-28T09:00:00Z',
        event: 'Task Approved — Priority elevated to P0',
        actor: 'Sarah Jenkins',
        type: 'approved',
      },
      {
        id: 'evt-007-3',
        date: '2026-04-28T11:00:00Z',
        event: 'All 4 exposed API keys revoked in IAM',
        actor: 'David Park',
        type: 'progress',
      },
      {
        id: 'evt-007-4',
        date: '2026-05-02T15:00:00Z',
        event: 'AWS Secrets Manager integration deployed to all services',
        actor: 'David Park',
        type: 'progress',
      },
      {
        id: 'evt-007-5',
        date: '2026-05-07T10:00:00Z',
        event: 'GitHub Advanced Security enabled with push protection',
        actor: 'David Park',
        type: 'progress',
      },
      {
        id: 'evt-007-6',
        date: '2026-05-09T14:00:00Z',
        event: 'Task Completed — All remediation steps validated by NXG360',
        actor: 'Sarah Jenkins',
        type: 'completed',
      },
    ],
  },
  {
    id: 'trk-task-008',
    meetingId: 'meet-uuid-3',
    meetingDate: '2026-05-05T14:00:00Z',
    meetingTimeline: 'May 2026 — Monthly Review Cycle',
    customerName: 'FinTech Global Inc.',
    tenantId: 'tenant-uuid-1',
    findingId: 'find-uuid-past-2',
    sourceFindingId: 'NXG-VULN-2203',
    title: 'Deploy WAF Rules to Mitigate OWASP Top 10 on Payment Gateway',
    description:
      'The public-facing payment gateway REST API lacks Web Application Firewall coverage. Load testing combined with OWASP ZAP scan revealed SQLi, XSS, and path traversal vulnerabilities in 3 API endpoints handling transaction data.',
    severity: 'critical',
    category: 'Application Security',
    systemAffected: 'Payment Gateway API v2.3',
    primaryOwner: {
      id: 'usr-am-001',
      name: 'Sarah Jenkins',
      role: 'Account Manager',
      email: 'sarah.jenkins@bmmj.com',
      avatar: 'SJ',
    },
    secondaryOwner: {
      id: 'usr-clt-007',
      name: 'Monica Redd',
      role: 'Application Security Engineer',
      email: 'm.redd@fintechglobal.com',
      avatar: 'MR',
    },
    ownershipTeam: 'Application Security',
    dueDate: '2026-05-15T23:59:59Z',
    progressPercentage: 100,
    status: 'completed',
    priority: 'P1',
    remediationStrategy: 'Architectural Redesign',
    originalMeetingId: 'meet-uuid-3',
    currentMeetingId: 'meet-uuid-3',
    carryForwardCount: 0,
    escalationStatus: 'none',
    escalationHistory: [],
    reviewOutcome: 'on_track',
    lastReviewedBy: 'Sarah Jenkins',
    lastReviewedDate: '2026-05-14T11:00:00Z',
    meetingHistory: [
      { meetingId: 'meet-uuid-3', meetingTitle: 'Buyer Monthly Review - FinTech Global', meetingDate: '2026-05-05T14:00:00Z', action: 'created' },
    ],
    resolutionSteps: [
      'Deploy AWS WAF v2 with managed rule groups (AWSManagedRulesCommonRuleSet, AWSManagedRulesSQLiRuleSet).',
      'Configure custom WAF rules to block path traversal patterns and malicious request signatures.',
      'Implement API Gateway request validation and input sanitization middleware.',
      'Enable CloudFront WAF integration for DDoS protection on the payment gateway.',
      'Run OWASP ZAP and Burp Suite post-remediation scan to validate all findings are closed.',
    ],
    lastUpdatedDate: '2026-05-14T11:00:00Z',
    carryForwardCount: 0,
    escalationCount: 0,
    notes: 'AWS WAF deployed. All 3 OWASP ZAP findings closed. PCI-DSS compliance report updated.',
    timeline: [
      {
        id: 'evt-008-1',
        date: '2026-04-28T08:30:00Z',
        event: 'Task Created',
        actor: 'AI Remediation Engine',
        type: 'created',
      },
      {
        id: 'evt-008-2',
        date: '2026-04-29T10:00:00Z',
        event: 'Task Approved for Execution',
        actor: 'Sarah Jenkins',
        type: 'approved',
      },
      {
        id: 'evt-008-3',
        date: '2026-05-05T14:00:00Z',
        event: 'AWS WAF v2 deployed with managed rule groups',
        actor: 'Monica Redd',
        type: 'progress',
      },
      {
        id: 'evt-008-4',
        date: '2026-05-10T16:00:00Z',
        event: 'Custom WAF rules configured and tested in staging',
        actor: 'Monica Redd',
        type: 'progress',
      },
      {
        id: 'evt-008-5',
        date: '2026-05-14T11:00:00Z',
        event: 'Task Completed — OWASP ZAP post-scan confirms all issues resolved',
        actor: 'Sarah Jenkins',
        type: 'completed',
      },
    ],
  },
];

// ─── Initialize tracker store ────────────────────────────────
const TRACKER_STORE_KEY = 'bmmj_tracker_tasks';
const TRACKER_VERSION = '2';
const TRACKER_VERSION_KEY = 'bmmj_tracker_version';

const initTrackerStore = () => {
  const stored = localStorage.getItem(TRACKER_VERSION_KEY);
  if (!localStorage.getItem(TRACKER_STORE_KEY) || stored !== TRACKER_VERSION) {
    localStorage.setItem(TRACKER_STORE_KEY, JSON.stringify(DEFAULT_TRACKER_TASKS));
    localStorage.setItem(TRACKER_VERSION_KEY, TRACKER_VERSION);
  }
};

initTrackerStore();

// ─── Tracker Service API ─────────────────────────────────────
export const trackerService = {
  getAllTasks: () => {
    const tasks = JSON.parse(localStorage.getItem(TRACKER_STORE_KEY) || '[]');
    return tasks;
  },

  getTaskById: (taskId) => {
    const tasks = JSON.parse(localStorage.getItem(TRACKER_STORE_KEY) || '[]');
    return tasks.find((t) => t.id === taskId) || null;
  },

  getTasksByTenant: (tenantId) => {
    const tasks = JSON.parse(localStorage.getItem(TRACKER_STORE_KEY) || '[]');
    return tasks.filter((t) => t.tenantId === tenantId);
  },

  getTasksByMeeting: (meetingId) => {
    const tasks = JSON.parse(localStorage.getItem(TRACKER_STORE_KEY) || '[]');
    return tasks.filter((t) => t.meetingId === meetingId);
  },

  updateTask: (taskId, updates) => {
    const tasks = JSON.parse(localStorage.getItem(TRACKER_STORE_KEY) || '[]');
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      tasks[idx] = {
        ...tasks[idx],
        ...updates,
        lastUpdatedDate: new Date().toISOString(),
      };
      localStorage.setItem(TRACKER_STORE_KEY, JSON.stringify(tasks));

      // Add timeline event
      if (updates.timelineEvent) {
        tasks[idx].timeline.push({
          id: `evt-${taskId}-${Date.now()}`,
          date: new Date().toISOString(),
          event: updates.timelineEvent,
          actor: updates.actor || 'Account Manager',
          type: updates.eventType || 'update',
        });
        localStorage.setItem(TRACKER_STORE_KEY, JSON.stringify(tasks));
      }
      return tasks[idx];
    }
    throw new Error('Task not found');
  },

  updateTaskStatus: (taskId, newStatus, actorName = 'Account Manager') => {
    const tasks = JSON.parse(localStorage.getItem(TRACKER_STORE_KEY) || '[]');
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      const oldStatus = tasks[idx].status;
      tasks[idx].status = newStatus;
      tasks[idx].lastUpdatedDate = new Date().toISOString();

      const statusLabels = {
        open: 'Open',
        in_progress: 'In Progress',
        awaiting_validation: 'Awaiting Validation',
        completed: 'Completed',
        escalated: 'Escalated',
        overdue: 'Overdue',
      };

      tasks[idx].timeline.push({
        id: `evt-${taskId}-${Date.now()}`,
        date: new Date().toISOString(),
        event: `Status changed from ${statusLabels[oldStatus] || oldStatus} to ${statusLabels[newStatus] || newStatus}`,
        actor: actorName,
        type: newStatus === 'completed' ? 'completed' : newStatus === 'escalated' ? 'escalated' : 'update',
      });

      if (newStatus === 'completed') tasks[idx].progressPercentage = 100;
      if (newStatus === 'escalated') tasks[idx].escalationCount += 1;

      localStorage.setItem(TRACKER_STORE_KEY, JSON.stringify(tasks));
      return tasks[idx];
    }
    throw new Error('Task not found');
  },

  updateProgress: (taskId, percentage) => {
    const tasks = JSON.parse(localStorage.getItem(TRACKER_STORE_KEY) || '[]');
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      tasks[idx].progressPercentage = Math.max(0, Math.min(100, percentage));
      tasks[idx].lastUpdatedDate = new Date().toISOString();
      localStorage.setItem(TRACKER_STORE_KEY, JSON.stringify(tasks));
      return tasks[idx];
    }
    throw new Error('Task not found');
  },

  getTrackerAnalytics: () => {
    const tasks = JSON.parse(localStorage.getItem(TRACKER_STORE_KEY) || '[]');

    const byStatus = {
      open: tasks.filter((t) => t.status === 'open').length,
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      awaiting_validation: tasks.filter((t) => t.status === 'awaiting_validation').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      escalated: tasks.filter((t) => t.status === 'escalated').length,
      overdue: tasks.filter((t) => t.status === 'overdue').length,
    };

    const bySeverity = {
      critical: tasks.filter((t) => t.severity === 'critical').length,
      high: tasks.filter((t) => t.severity === 'high').length,
      medium: tasks.filter((t) => t.severity === 'medium').length,
      low: tasks.filter((t) => t.severity === 'low').length,
    };

    const byTenant = tasks.reduce((acc, t) => {
      acc[t.customerName] = (acc[t.customerName] || 0) + 1;
      return acc;
    }, {});

    const totalTasks = tasks.length;
    const completedTasks = byStatus.completed;
    const overallProgress =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const avgProgress =
      totalTasks > 0
        ? Math.round(tasks.reduce((sum, t) => sum + t.progressPercentage, 0) / totalTasks)
        : 0;

    const totalCarryForwards = tasks.reduce((sum, t) => sum + t.carryForwardCount, 0);
    const totalEscalations = tasks.reduce((sum, t) => sum + t.escalationCount, 0);

    const overdueCount = tasks.filter((t) => {
      const due = new Date(t.dueDate);
      const now = new Date();
      return due < now && t.status !== 'completed';
    }).length;

    return {
      byStatus,
      bySeverity,
      byTenant,
      totalTasks,
      completedTasks,
      overallProgress,
      avgProgress,
      totalCarryForwards,
      totalEscalations,
      overdueCount,
      activeTasks: totalTasks - completedTasks,
    };
  },

  // Set weekly review outcome for a task (AM records review decision)
  setReviewOutcome: (taskId, outcome, actorName = 'Account Manager') => {
    const tasks = JSON.parse(localStorage.getItem(TRACKER_STORE_KEY) || '[]');
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) throw new Error('Task not found');
    tasks[idx].reviewOutcome = outcome;
    tasks[idx].lastReviewedBy = actorName;
    tasks[idx].lastReviewedDate = new Date().toISOString();
    tasks[idx].lastUpdatedDate = new Date().toISOString();
    const label = REVIEW_OUTCOMES[outcome]?.label || outcome;
    tasks[idx].timeline = tasks[idx].timeline || [];
    tasks[idx].timeline.push({
      id: `evt-${taskId}-${Date.now()}`,
      date: new Date().toISOString(),
      event: `Weekly review outcome set to "${label}"`,
      actor: actorName,
      type: 'review',
    });
    localStorage.setItem(TRACKER_STORE_KEY, JSON.stringify(tasks));
    return tasks[idx];
  },

  // Trigger escalation workflow — AM must have verified a blocker type first
  triggerEscalation: (taskId, { blockerType, escalationReason, escalatedBy, notifyContact = '' }) => {
    const tasks = JSON.parse(localStorage.getItem(TRACKER_STORE_KEY) || '[]');
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) throw new Error('Task not found');
    if (!blockerType || !escalationReason || !escalatedBy) throw new Error('blockerType, escalationReason, escalatedBy are required');
    const task = tasks[idx];
    const entry = {
      id: `esc-${taskId}-${Date.now()}`,
      tenantId: task.tenantId,
      taskId: task.id,
      carryForwardCount: task.carryForwardCount || 0,
      escalationReason,
      escalatedBy,
      escalationDate: new Date().toISOString(),
      blockerType,
      notifyContact,
    };
    tasks[idx].escalationStatus = 'escalated';
    tasks[idx].escalationCount = (task.escalationCount || 0) + 1;
    tasks[idx].reviewOutcome = 'escalation_required';
    tasks[idx].escalationHistory = [...(task.escalationHistory || []), entry];
    tasks[idx].lastReviewedBy = escalatedBy;
    tasks[idx].lastReviewedDate = new Date().toISOString();
    tasks[idx].lastUpdatedDate = new Date().toISOString();
    tasks[idx].timeline = tasks[idx].timeline || [];
    const blockerLabel = BLOCKER_TYPES[blockerType]?.label || blockerType;
    tasks[idx].timeline.push({
      id: `evt-${taskId}-${Date.now()}`,
      date: new Date().toISOString(),
      event: `Escalated by ${escalatedBy} — Blocker: ${blockerLabel}. ${escalationReason.slice(0, 100)}`,
      actor: escalatedBy,
      type: 'escalated',
    });
    localStorage.setItem(TRACKER_STORE_KEY, JSON.stringify(tasks));
    return tasks[idx];
  },

  resetToDefaults: () => {
    localStorage.setItem(TRACKER_STORE_KEY, JSON.stringify(DEFAULT_TRACKER_TASKS));
    localStorage.setItem(TRACKER_VERSION_KEY, TRACKER_VERSION);
  },
};
