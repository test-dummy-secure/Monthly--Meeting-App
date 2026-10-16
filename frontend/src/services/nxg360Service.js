// NXG360 Integration Layer — Phase-1 static mock implementation
// Tenant-scoped findings pipeline with 11 security categories.
// AI task generation derives tasks from findings; tasks are NEVER
// auto-published — AM approval is required before tracker visibility.

// ─── Category definitions ─────────────────────────────────────────────────
export const NXG360_CATEGORIES = {
  RISKY_USERS:             { key: 'risky_users',            label: 'Risky Users',                icon: 'user-x' },
  RISKY_DEVICES:           { key: 'risky_devices',          label: 'Risky Devices',              icon: 'monitor-x' },
  MFA_ENABLED_USERS:       { key: 'mfa_enabled_users',      label: 'MFA Enabled Users',          icon: 'shield-check' },
  MFA_ENABLED_DEVICES:     { key: 'mfa_enabled_devices',    label: 'MFA Enabled Devices',        icon: 'shield-check' },
  MFA_MISSING_USERS:       { key: 'mfa_missing_users',      label: 'MFA Missing Users',          icon: 'shield-alert' },
  MFA_MISSING_DEVICES:     { key: 'mfa_missing_devices',    label: 'MFA Missing Devices',        icon: 'shield-alert' },
  DORMANT_ACCOUNTS:        { key: 'dormant_accounts',       label: 'Dormant Accounts',           icon: 'clock' },
  BREACHED_CREDENTIALS:    { key: 'breached_credentials',   label: 'Breached Credentials',       icon: 'key-round' },
  ASSIGNED_USERS_DEVICES:  { key: 'assigned_users_devices', label: 'Assigned Users to Devices',  icon: 'laptop' },
  EDR_COVERAGE:            { key: 'edr_coverage',           label: 'EDR Coverage',               icon: 'shield' },
  PATCH_COMPLIANCE:        { key: 'patch_compliance',       label: 'Patch Compliance',           icon: 'package' },
};

// ─── Priority mapping ─────────────────────────────────────────────────────
export const PRIORITY_MAP = {
  critical: 'P1',
  high:     'P2',
  medium:   'P3',
  low:      'P4',
};

export const PRIORITY_LABELS = {
  P1: { label: 'P1 — Critical', color: 'bg-rose-500/20 text-rose-400 border-rose-500/25' },
  P2: { label: 'P2 — High',     color: 'bg-amber-500/20 text-amber-400 border-amber-500/25' },
  P3: { label: 'P3 — Medium',   color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/25' },
  P4: { label: 'P4 — Low',      color: 'bg-slate-500/20 text-slate-400 border-slate-700/50' },
};

// ─── Static mock findings per tenant ─────────────────────────────────────
const TENANT_FINDINGS = {
  'tenant-uuid-1': [
    {
      id: 'nxg-t1-001',
      tenantId: 'tenant-uuid-1',
      sourceFindingId: 'NXG-2026-1001',
      category: 'risky_users',
      label: 'Risky Users',
      severity: 'critical',
      title: '8 User Accounts with Anomalous Login Patterns Detected',
      description: 'Behavioral analytics flagged 8 active user accounts performing logins from multiple geographically dispersed IP addresses within 30-minute windows, indicating potential credential compromise or account takeover.',
      systemAffected: 'Active Directory / Azure AD',
      affectedCount: 8,
      riskScore: 92,
      recommendation: 'Immediately suspend flagged accounts, force password reset, and enforce conditional access policies.',
      detectedAt: '2026-06-03T06:00:00Z',
    },
    {
      id: 'nxg-t1-002',
      tenantId: 'tenant-uuid-1',
      sourceFindingId: 'NXG-2026-1002',
      category: 'mfa_missing_users',
      label: 'MFA Missing Users',
      severity: 'critical',
      title: '12 Administrative Accounts without MFA Enforcement',
      description: '12 privileged IAM accounts in the production AWS environment do not have multi-factor authentication activated, violating SOC2 Type II and PCI-DSS compliance mandates.',
      systemAffected: 'AWS Identity Management (IAM)',
      affectedCount: 12,
      riskScore: 88,
      recommendation: 'Deploy SCP to enforce MFA for all console and API access. Notify non-compliant accounts and set 48-hour remediation deadline.',
      detectedAt: '2026-06-03T06:05:00Z',
    },
    {
      id: 'nxg-t1-003',
      tenantId: 'tenant-uuid-1',
      sourceFindingId: 'NXG-2026-1003',
      category: 'breached_credentials',
      label: 'Breached Credentials',
      severity: 'critical',
      title: '3 Corporate Email Credentials Found in Dark Web Breach Database',
      description: 'NXG360 dark web intelligence module matched 3 active employee email addresses to credential sets published in recent breach databases. Passwords may still be in use across corporate systems.',
      systemAffected: 'Email / SSO Identity Provider',
      affectedCount: 3,
      riskScore: 95,
      recommendation: 'Force immediate password reset for all 3 affected accounts. Audit SSO sessions and revoke active tokens.',
      detectedAt: '2026-06-03T06:10:00Z',
    },
    {
      id: 'nxg-t1-004',
      tenantId: 'tenant-uuid-1',
      sourceFindingId: 'NXG-2026-1004',
      category: 'dormant_accounts',
      label: 'Dormant Accounts',
      severity: 'high',
      title: '24 Dormant Service Accounts Active for 90+ Days Without Use',
      description: '24 service accounts have not been used in 90 or more days but remain active with full permissions, creating unnecessary attack surface for lateral movement.',
      systemAffected: 'Azure Active Directory Service Principals',
      affectedCount: 24,
      riskScore: 74,
      recommendation: 'Disable unused service accounts via lifecycle policy. Implement Just-in-Time provisioning for privileged accounts.',
      detectedAt: '2026-06-03T06:15:00Z',
    },
    {
      id: 'nxg-t1-005',
      tenantId: 'tenant-uuid-1',
      sourceFindingId: 'NXG-2026-1005',
      category: 'patch_compliance',
      label: 'Patch Compliance',
      severity: 'high',
      title: '37 Production Servers Missing Critical OS Security Patches',
      description: '37 Windows Server instances in the production environment are missing 1 or more critical security patches released in the last 60 days, exposing known exploitable vulnerabilities.',
      systemAffected: 'Windows Server Fleet (Production VPC)',
      affectedCount: 37,
      riskScore: 78,
      recommendation: 'Initiate emergency patch cycle via WSUS/SCCM. Prioritize CVE-rated patches. Schedule maintenance windows for high-availability servers.',
      detectedAt: '2026-06-03T06:20:00Z',
    },
    {
      id: 'nxg-t1-006',
      tenantId: 'tenant-uuid-1',
      sourceFindingId: 'NXG-2026-1006',
      category: 'edr_coverage',
      label: 'EDR Coverage',
      severity: 'high',
      title: 'EDR Agent Missing on 19 Endpoint Devices',
      description: '19 endpoint devices registered in the asset inventory do not have an active Endpoint Detection & Response agent installed, leaving them unmonitored for threat detection.',
      systemAffected: 'Endpoint Fleet — Corporate Devices',
      affectedCount: 19,
      riskScore: 71,
      recommendation: 'Deploy EDR agent to all 19 endpoints via MDM. Enable auto-enrollment for new device registrations.',
      detectedAt: '2026-06-03T06:25:00Z',
    },
    {
      id: 'nxg-t1-007',
      tenantId: 'tenant-uuid-1',
      sourceFindingId: 'NXG-2026-1007',
      category: 'risky_devices',
      label: 'Risky Devices',
      severity: 'medium',
      title: '6 Unmanaged Devices Accessing Corporate Resources',
      description: '6 devices accessing the corporate network and SaaS applications are not enrolled in the Mobile Device Management platform, bypassing security policy enforcement.',
      systemAffected: 'Intune MDM / Conditional Access',
      affectedCount: 6,
      riskScore: 58,
      recommendation: 'Block non-compliant device access via Conditional Access policies. Require MDM enrollment before granting resource access.',
      detectedAt: '2026-06-03T06:30:00Z',
    },
    {
      id: 'nxg-t1-008',
      tenantId: 'tenant-uuid-1',
      sourceFindingId: 'NXG-2026-1008',
      category: 'mfa_enabled_users',
      label: 'MFA Enabled Users',
      severity: 'low',
      title: 'MFA Compliance Summary — 156 of 168 Users Enrolled',
      description: 'Current MFA enrollment rate is 92.8% (156/168 users). 12 accounts remain non-compliant. This is an informational finding tracking the remediation progress.',
      systemAffected: 'AWS IAM / Azure AD',
      affectedCount: 156,
      riskScore: 15,
      recommendation: 'Track remaining 12 non-compliant accounts. Set automated alerts for new accounts created without MFA.',
      detectedAt: '2026-06-03T06:35:00Z',
    },
    {
      id: 'nxg-t1-009',
      tenantId: 'tenant-uuid-1',
      sourceFindingId: 'NXG-2026-1009',
      category: 'mfa_enabled_devices',
      label: 'MFA Enabled Devices',
      severity: 'low',
      title: 'Device MFA Compliance — 98 of 112 Devices Enrolled',
      description: '87.5% of managed devices have device-level MFA configured. 14 devices remain without device certificate or biometric authentication.',
      systemAffected: 'Intune Managed Device Fleet',
      affectedCount: 98,
      riskScore: 20,
      recommendation: 'Enforce device compliance policy for the remaining 14 devices. Remove from network access until compliant.',
      detectedAt: '2026-06-03T06:40:00Z',
    },
    {
      id: 'nxg-t1-010',
      tenantId: 'tenant-uuid-1',
      sourceFindingId: 'NXG-2026-1010',
      category: 'assigned_users_devices',
      label: 'Assigned Users to Devices',
      severity: 'medium',
      title: '11 Shared Devices Without Assigned User Attribution',
      description: '11 corporate-owned devices in the inventory have no assigned primary user, making it impossible to attribute activity logs to specific individuals for forensic purposes.',
      systemAffected: 'Intune Device Registry',
      affectedCount: 11,
      riskScore: 45,
      recommendation: 'Assign primary owners to all shared devices. Enforce per-user authentication even on shared workstations.',
      detectedAt: '2026-06-03T06:45:00Z',
    },
    {
      id: 'nxg-t1-011',
      tenantId: 'tenant-uuid-1',
      sourceFindingId: 'NXG-2026-1011',
      category: 'mfa_missing_devices',
      label: 'MFA Missing Devices',
      severity: 'medium',
      title: '14 Devices Without Device-Level Authentication Configured',
      description: '14 managed endpoints are accessing corporate resources without device certificate validation or hardware-backed authentication, relying solely on user credentials.',
      systemAffected: 'MDM Conditional Access Policy',
      affectedCount: 14,
      riskScore: 52,
      recommendation: 'Configure device compliance policy requiring TPM-backed certificate or FIDO2 hardware key for these devices.',
      detectedAt: '2026-06-03T06:50:00Z',
    },
  ],

  'tenant-uuid-2': [
    {
      id: 'nxg-t2-001',
      tenantId: 'tenant-uuid-2',
      sourceFindingId: 'NXG-2026-2001',
      category: 'patch_compliance',
      label: 'Patch Compliance',
      severity: 'critical',
      title: 'Critical CVE-2024-21412 Unpatched on 14 Systems',
      description: 'CVE-2024-21412 (Windows Defender SmartScreen bypass) has not been patched on 14 systems in the engineering environment, enabling potential code execution via crafted files.',
      systemAffected: 'Windows Engineering Workstations',
      affectedCount: 14,
      riskScore: 90,
      recommendation: 'Apply KB5034441 immediately via WSUS. Isolate affected systems from external network access until patched.',
      detectedAt: '2026-06-10T06:00:00Z',
    },
    {
      id: 'nxg-t2-002',
      tenantId: 'tenant-uuid-2',
      sourceFindingId: 'NXG-2026-2002',
      category: 'edr_coverage',
      label: 'EDR Coverage',
      severity: 'high',
      title: 'CrowdStrike Falcon Sensor Not Active on 8 OT Devices',
      description: '8 operational technology devices are running without an active EDR agent, creating blind spots in the threat detection coverage for critical manufacturing systems.',
      systemAffected: 'OT Network — Industrial Control Systems',
      affectedCount: 8,
      riskScore: 82,
      recommendation: 'Deploy Falcon sensor compatible with OT OS versions. Coordinate with OT team for maintenance windows.',
      detectedAt: '2026-06-10T06:05:00Z',
    },
    {
      id: 'nxg-t2-003',
      tenantId: 'tenant-uuid-2',
      sourceFindingId: 'NXG-2026-2003',
      category: 'mfa_missing_users',
      label: 'MFA Missing Users',
      severity: 'high',
      title: '7 VPN Access Accounts Without MFA',
      description: '7 employee accounts with VPN access permissions do not have MFA enrolled, allowing single-factor authentication for remote network access.',
      systemAffected: 'Cisco AnyConnect VPN',
      affectedCount: 7,
      riskScore: 76,
      recommendation: 'Enforce RADIUS-based MFA for all VPN connections. Disable VPN access for non-compliant accounts until enrolled.',
      detectedAt: '2026-06-10T06:10:00Z',
    },
    {
      id: 'nxg-t2-004',
      tenantId: 'tenant-uuid-2',
      sourceFindingId: 'NXG-2026-2004',
      category: 'dormant_accounts',
      label: 'Dormant Accounts',
      severity: 'medium',
      title: '16 Former Contractor Accounts Still Active',
      description: '16 contractor accounts from completed engagements have not been deprovisioned. These accounts retain access to collaboration tools and development environments.',
      systemAffected: 'Azure AD / Office 365',
      affectedCount: 16,
      riskScore: 60,
      recommendation: 'Immediately disable all 16 accounts. Implement contractor offboarding workflow in HR system.',
      detectedAt: '2026-06-10T06:15:00Z',
    },
    {
      id: 'nxg-t2-005',
      tenantId: 'tenant-uuid-2',
      sourceFindingId: 'NXG-2026-2005',
      category: 'risky_devices',
      label: 'Risky Devices',
      severity: 'medium',
      title: '4 Devices with Disabled Security Software Detected',
      description: '4 devices have had Windows Defender or third-party AV disabled, running without real-time threat protection.',
      systemAffected: 'Corporate Endpoint Fleet',
      affectedCount: 4,
      riskScore: 55,
      recommendation: 'Re-enable security software via GPO. Investigate why software was disabled — potential insider threat indicator.',
      detectedAt: '2026-06-10T06:20:00Z',
    },
  ],

  'tenant-uuid-3': [
    {
      id: 'nxg-t3-001',
      tenantId: 'tenant-uuid-3',
      sourceFindingId: 'NXG-2026-3001',
      category: 'breached_credentials',
      label: 'Breached Credentials',
      severity: 'critical',
      title: '5 Staff Credentials Identified in Healthcare Breach Database',
      description: 'NXG360 threat intelligence matched 5 MedTech employee credentials to entries in a recently disclosed healthcare sector breach. Credentials may be actively exploited.',
      systemAffected: 'HIPAA-Regulated Systems / EHR Platform',
      affectedCount: 5,
      riskScore: 97,
      recommendation: 'Immediately force password reset and revoke all active sessions. Notify CISO and legal per HIPAA breach notification requirements.',
      detectedAt: '2026-05-20T06:00:00Z',
    },
  ],
};

// ─── AI Task generation per finding category ─────────────────────────────
const AI_TASK_TEMPLATES = {
  risky_users: {
    remediationStrategy: 'Policy Enforcement',
    actionPlanTemplate: (f) =>
      `1. Suspend all ${f.affectedCount} flagged accounts immediately via IAM console.\n2. Force full password reset and revoke all active SSO sessions.\n3. Enable impossible-travel detection in identity provider.\n4. Conduct 30-day audit of affected account activity logs.\n5. Verify remediation via NXG360 re-scan within 7 days.`,
    dueDays: 3,
  },
  risky_devices: {
    remediationStrategy: 'Configuration Change',
    actionPlanTemplate: (f) =>
      `1. Block network access for ${f.affectedCount} unmanaged devices via Conditional Access policy.\n2. Require MDM enrollment and compliance check before re-granting access.\n3. Enable automated device compliance enforcement via Intune.\n4. Review device inventory and remove stale entries.\n5. Validate through NXG360 re-scan within 14 days.`,
    dueDays: 14,
  },
  mfa_enabled_users: {
    remediationStrategy: 'Monitoring',
    actionPlanTemplate: (f) =>
      `1. Generate MFA compliance report for all ${f.affectedCount} enrolled users.\n2. Set automated alert for any MFA de-enrollment event.\n3. Confirm enrollment for remaining non-compliant accounts.\n4. Document compliance rate for SOC2 audit evidence.\n5. Schedule quarterly MFA compliance review.`,
    dueDays: 30,
  },
  mfa_enabled_devices: {
    remediationStrategy: 'Monitoring',
    actionPlanTemplate: (f) =>
      `1. Export device MFA compliance report from MDM for ${f.affectedCount} enrolled devices.\n2. Validate hardware-backed authentication for certificate-enrolled devices.\n3. Document as compliance evidence for device security controls.\n4. Schedule quarterly review of device authentication posture.`,
    dueDays: 30,
  },
  mfa_missing_users: {
    remediationStrategy: 'Policy Enforcement',
    actionPlanTemplate: (f) =>
      `1. Identify all ${f.affectedCount} non-compliant accounts from MFA audit report.\n2. Send automated enforcement notification with 48-hour deadline.\n3. Deploy SCP or Conditional Access policy blocking console and API access without MFA.\n4. Set session token expiration to maximum 4 hours for all privileged accounts.\n5. Validate 100% MFA enrollment via NXG360 re-scan within 7 days.`,
    dueDays: 7,
  },
  mfa_missing_devices: {
    remediationStrategy: 'Configuration Change',
    actionPlanTemplate: (f) =>
      `1. Configure device compliance policy in MDM requiring TPM-backed certificate for ${f.affectedCount} devices.\n2. Block non-compliant devices from accessing corporate resources.\n3. Provision FIDO2 hardware keys for high-value targets.\n4. Validate device MFA enrollment within 14 days.`,
    dueDays: 14,
  },
  dormant_accounts: {
    remediationStrategy: 'Decommission & Replace',
    actionPlanTemplate: (f) =>
      `1. Export list of ${f.affectedCount} dormant accounts older than 90 days.\n2. Notify account owners and managers with 5-day response window.\n3. Disable all non-responsive accounts after deadline.\n4. Implement lifecycle policy for automatic disable after 60 days of inactivity.\n5. Verify deprovisioning via NXG360 re-scan.`,
    dueDays: 10,
  },
  breached_credentials: {
    remediationStrategy: 'Policy Enforcement',
    actionPlanTemplate: (f) =>
      `1. Immediately force password reset for all ${f.affectedCount} compromised accounts.\n2. Revoke all active sessions, tokens, and API keys associated with these accounts.\n3. Notify affected users and their managers per security incident policy.\n4. Audit last 30 days of activity for all affected accounts for signs of unauthorized access.\n5. Verify credential hygiene via NXG360 dark web re-scan within 72 hours.`,
    dueDays: 1,
  },
  assigned_users_devices: {
    remediationStrategy: 'Configuration Change',
    actionPlanTemplate: (f) =>
      `1. Run device attribution audit for all ${f.affectedCount} unassigned devices in MDM.\n2. Contact device custodians to confirm primary user assignments.\n3. Update device registry with primary user field.\n4. Configure per-user login audit logging on all shared workstations.\n5. Validate all devices have assigned users within 21 days.`,
    dueDays: 21,
  },
  edr_coverage: {
    remediationStrategy: 'Patch & Update',
    actionPlanTemplate: (f) =>
      `1. Generate gap report for ${f.affectedCount} endpoints missing EDR agent in MDM inventory.\n2. Deploy EDR agent to all affected endpoints via MDM push policy.\n3. Configure auto-enrollment policy for new device registrations.\n4. Validate agent health and threat detection connectivity.\n5. Confirm 100% EDR coverage via NXG360 re-scan within 14 days.`,
    dueDays: 14,
  },
  patch_compliance: {
    remediationStrategy: 'Patch & Update',
    actionPlanTemplate: (f) =>
      `1. Export unpatched system list for ${f.affectedCount} non-compliant servers from WSUS/SCCM.\n2. Prioritize CVE-rated critical patches — schedule emergency maintenance windows.\n3. Apply patches in staging environment first; validate application compatibility.\n4. Roll out to production using blue-green deployment pattern.\n5. Confirm patch compliance via NXG360 compliance re-scan within 14 days.`,
    dueDays: 14,
  },
};

// ─── Service API ─────────────────────────────────────────────────────────
const nxg360Service = {
  // GET /tenant/:tenantId/findings  —  returns all 11-category findings for a tenant
  getFindingsByTenant: (tenantId) => {
    const findings = TENANT_FINDINGS[tenantId] || [];
    const summary = {
      totalFindings: findings.length,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byCategory: {},
    };
    findings.forEach((f) => {
      if (summary.bySeverity[f.severity] !== undefined) summary.bySeverity[f.severity]++;
      summary.byCategory[f.category] = (summary.byCategory[f.category] || 0) + 1;
    });
    return { tenantId, findings, summary, retrievedAt: new Date().toISOString() };
  },

  // Generate AI task recommendations from findings — returns draft tasks pending AM approval.
  // Tasks are NEVER auto-published.
  generateAITasks: (tenantId, meetingId, findings) => {
    const tasks = findings
      .filter((f) => f.severity !== 'low' || f.riskScore > 50)
      .map((f) => {
        const template = AI_TASK_TEMPLATES[f.category] || AI_TASK_TEMPLATES.patch_compliance;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + template.dueDays);

        return {
          id: `ai-task-${f.id}-${Date.now()}`,
          findingId: f.id,
          sourceFindingId: f.sourceFindingId,
          meetingId,
          tenantId,
          title: f.title,
          description: f.description,
          severity: f.severity,
          priority: PRIORITY_MAP[f.severity] || 'P4',
          category: f.label,
          systemAffected: f.systemAffected,
          remediationStrategy: template.remediationStrategy,
          actionPlan: template.actionPlanTemplate(f),
          riskReductionScore: f.riskScore,
          recommendedDueDate: dueDate.toISOString(),
          dueDate: dueDate.toISOString(),
          // AI tasks start as pending — AM approval required
          approvalStatus: 'pending',
          remediationStatus: 'open',
          notes: '',
          generatedAt: new Date().toISOString(),
        };
      });

    return {
      meetingId,
      tenantId,
      tasks,
      totalGenerated: tasks.length,
      requiresAMApproval: true,
      message: `${tasks.length} AI task recommendations generated. AM review and approval required before tracker publication.`,
    };
  },

  // Check if a finding category is a risk indicator (needs action)
  isRiskCategory: (category) =>
    ['risky_users', 'risky_devices', 'mfa_missing_users', 'mfa_missing_devices',
      'dormant_accounts', 'breached_credentials', 'patch_compliance', 'edr_coverage'].includes(category),

  // Get category metadata
  getCategoryMeta: (categoryKey) =>
    Object.values(NXG360_CATEGORIES).find((c) => c.key === categoryKey) || { key: categoryKey, label: categoryKey },
};

export default nxg360Service;
