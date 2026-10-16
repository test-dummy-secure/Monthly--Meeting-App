// src/services/monitoringMockData.js
// ─── Monitoring Dashboard Mock Data Service ───────────────────────────────────
// Business Logic:
//   Day 7  → Notify Customer
//   Day 14 → Notify Account Manager
//   Day 21 → Notify Customer Again
//   Day 28 → Escalate to Customer Senior Stakeholder

const now = new Date();
const daysAgo = (d) => new Date(now.getTime() - d * 86400000);
const daysFromNow = (d) => new Date(now.getTime() + d * 86400000);
const formatDate = (d) => d.toISOString().split('T')[0];
const formatDateTime = (d) => d.toISOString().replace('T', ' ').slice(0, 19);

// ─── Escalation Thresholds ────────────────────────────────────────────────────
export const ESCALATION_RULES = [
  { day: 7,  action: 'notify_customer',        label: 'Customer Notified',           level: 1, color: '#f59e0b' },
  { day: 14, action: 'notify_account_manager',  label: 'Account Manager Notified',    level: 2, color: '#f97316' },
  { day: 21, action: 'notify_customer_again',   label: 'Customer Re-Notified',        level: 3, color: '#ef4444' },
  { day: 28, action: 'escalate_stakeholder',    label: 'Senior Stakeholder Escalated', level: 4, color: '#dc2626' },
];

// ─── Customers ────────────────────────────────────────────────────────────────
const customers = [
  { id: 'CUST-001', name: 'Acme Corp',           accountManager: 'Sarah Chen',      seniorStakeholder: 'James Rodriguez' },
  { id: 'CUST-002', name: 'TechVault Inc.',       accountManager: 'Michael Patel',   seniorStakeholder: 'Lisa Thompson' },
  { id: 'CUST-003', name: 'DataFlow Systems',     accountManager: 'Sarah Chen',      seniorStakeholder: 'Robert Kim' },
  { id: 'CUST-004', name: 'SecureNet Global',     accountManager: 'Jessica Liu',     seniorStakeholder: 'David Martinez' },
  { id: 'CUST-005', name: 'CloudPeak Solutions',  accountManager: 'Michael Patel',   seniorStakeholder: 'Amanda Foster' },
  { id: 'CUST-006', name: 'InfraShield Corp',     accountManager: 'Jessica Liu',     seniorStakeholder: 'Thomas Brown' },
  { id: 'CUST-007', name: 'CyberEdge Partners',   accountManager: 'Sarah Chen',      seniorStakeholder: 'Michelle Lee' },
  { id: 'CUST-008', name: 'Nexus Technologies',   accountManager: 'Michael Patel',   seniorStakeholder: 'Kevin Wright' },
];

// ─── Monitored Tasks (stale / at-risk) ────────────────────────────────────────
const monitoredTasks = [
  // 7+ days stale
  { id: 'TSK-1021', title: 'Implement MFA for VPN access',           customerId: 'CUST-001', severity: 'critical', assignedTo: 'John Miller',     lastUpdated: daysAgo(8),  dueDate: daysAgo(2),   status: 'in_progress' },
  { id: 'TSK-1034', title: 'Patch Exchange Server CVE-2024-3400',    customerId: 'CUST-002', severity: 'critical', assignedTo: 'Emily Watson',    lastUpdated: daysAgo(9),  dueDate: daysAgo(1),   status: 'open' },
  { id: 'TSK-1047', title: 'Update firewall egress rules',           customerId: 'CUST-003', severity: 'high',     assignedTo: 'Raj Patel',       lastUpdated: daysAgo(10), dueDate: daysAgo(3),   status: 'in_progress' },
  { id: 'TSK-1055', title: 'Enable DNSSEC for primary domain',       customerId: 'CUST-005', severity: 'medium',   assignedTo: 'Carlos Mendez',   lastUpdated: daysAgo(11), dueDate: daysFromNow(5), status: 'open' },
  { id: 'TSK-1062', title: 'Review IAM privilege escalation paths',  customerId: 'CUST-001', severity: 'high',     assignedTo: 'John Miller',     lastUpdated: daysAgo(12), dueDate: daysAgo(5),   status: 'open' },
  // 14+ days stale
  { id: 'TSK-1009', title: 'Deploy EDR on legacy endpoints',         customerId: 'CUST-004', severity: 'critical', assignedTo: 'Anna Schmidt',    lastUpdated: daysAgo(16), dueDate: daysAgo(10),  status: 'in_progress' },
  { id: 'TSK-1013', title: 'Remediate SQL injection in checkout',    customerId: 'CUST-002', severity: 'critical', assignedTo: 'Emily Watson',    lastUpdated: daysAgo(15), dueDate: daysAgo(8),   status: 'open' },
  { id: 'TSK-1018', title: 'Rotate compromised API keys',            customerId: 'CUST-006', severity: 'high',     assignedTo: 'Maria Lopez',     lastUpdated: daysAgo(17), dueDate: daysAgo(12),  status: 'open' },
  { id: 'TSK-1025', title: 'Harden Kubernetes cluster RBAC',         customerId: 'CUST-003', severity: 'high',     assignedTo: 'Raj Patel',       lastUpdated: daysAgo(14), dueDate: daysAgo(7),   status: 'in_progress' },
  // 21+ days stale
  { id: 'TSK-0987', title: 'Disable TLS 1.0/1.1 across services',   customerId: 'CUST-007', severity: 'high',     assignedTo: 'Derek Zhang',     lastUpdated: daysAgo(23), dueDate: daysAgo(16),  status: 'open' },
  { id: 'TSK-0991', title: 'Segment OT network from corporate LAN', customerId: 'CUST-004', severity: 'critical', assignedTo: 'Anna Schmidt',    lastUpdated: daysAgo(22), dueDate: daysAgo(15),  status: 'in_progress' },
  { id: 'TSK-0995', title: 'Implement privileged session recording', customerId: 'CUST-008', severity: 'medium',   assignedTo: 'Chris Taylor',    lastUpdated: daysAgo(24), dueDate: daysAgo(18),  status: 'open' },
  // 28+ days stale — ESCALATED
  { id: 'TSK-0962', title: 'Replace EOL FortiGate appliances',       customerId: 'CUST-001', severity: 'critical', assignedTo: 'John Miller',     lastUpdated: daysAgo(32), dueDate: daysAgo(25),  status: 'escalated' },
  { id: 'TSK-0970', title: 'Migrate off unsupported Windows 2012R2', customerId: 'CUST-006', severity: 'critical', assignedTo: 'Maria Lopez',     lastUpdated: daysAgo(35), dueDate: daysAgo(28),  status: 'escalated' },
  { id: 'TSK-0975', title: 'Remediate open S3 buckets',              customerId: 'CUST-005', severity: 'high',     assignedTo: 'Carlos Mendez',   lastUpdated: daysAgo(30), dueDate: daysAgo(22),  status: 'escalated' },
  { id: 'TSK-0980', title: 'Fix broken certificate chain on WAF',    customerId: 'CUST-002', severity: 'critical', assignedTo: 'Emily Watson',    lastUpdated: daysAgo(29), dueDate: daysAgo(20),  status: 'escalated' },
  // Recently active (healthy)
  { id: 'TSK-1070', title: 'Configure SIEM alert correlation rules', customerId: 'CUST-007', severity: 'medium',   assignedTo: 'Derek Zhang',     lastUpdated: daysAgo(2),  dueDate: daysFromNow(10), status: 'in_progress' },
  { id: 'TSK-1075', title: 'Implement DLP policies for email',       customerId: 'CUST-008', severity: 'low',      assignedTo: 'Chris Taylor',    lastUpdated: daysAgo(1),  dueDate: daysFromNow(14), status: 'in_progress' },
  { id: 'TSK-1080', title: 'Deploy WAF rules for OWASP Top 10',      customerId: 'CUST-003', severity: 'high',     assignedTo: 'Raj Patel',       lastUpdated: daysAgo(3),  dueDate: daysFromNow(7),  status: 'in_progress' },
  { id: 'TSK-1085', title: 'Review and update incident response plan', customerId: 'CUST-004', severity: 'medium', assignedTo: 'Anna Schmidt',    lastUpdated: daysAgo(0),  dueDate: daysFromNow(21), status: 'open' },
];

// ─── Derive escalation level from staleness ───────────────────────────────────
const getEscalationLevel = (lastUpdated) => {
  const staleDays = Math.floor((now - new Date(lastUpdated)) / 86400000);
  if (staleDays >= 28) return 4;
  if (staleDays >= 21) return 3;
  if (staleDays >= 14) return 2;
  if (staleDays >= 7) return 1;
  return 0;
};

const getEscalationStatus = (level) => {
  if (level === 0) return 'healthy';
  if (level <= 2) return 'warning';
  if (level === 3) return 'critical';
  return 'escalated';
};

const getStaleDays = (lastUpdated) => Math.floor((now - new Date(lastUpdated)) / 86400000);

// ─── Notification History ─────────────────────────────────────────────────────
const notificationHistory = [
  // Day 7 notifications
  { id: 'NTF-001', taskId: 'TSK-1021', type: 'customer_notification',       recipient: 'John Miller (Acme Corp)',           subject: 'Task Requires Update - MFA for VPN',             sentAt: formatDateTime(daysAgo(1)),  channel: 'email', status: 'delivered', escalationLevel: 1 },
  { id: 'NTF-002', taskId: 'TSK-1034', type: 'customer_notification',       recipient: 'Emily Watson (TechVault Inc.)',     subject: 'Task Requires Update - Patch Exchange Server',    sentAt: formatDateTime(daysAgo(2)),  channel: 'email', status: 'delivered', escalationLevel: 1 },
  { id: 'NTF-003', taskId: 'TSK-1047', type: 'customer_notification',       recipient: 'Raj Patel (DataFlow Systems)',      subject: 'Task Requires Update - Firewall Egress Rules',    sentAt: formatDateTime(daysAgo(3)),  channel: 'email', status: 'delivered', escalationLevel: 1 },
  { id: 'NTF-004', taskId: 'TSK-1055', type: 'customer_notification',       recipient: 'Carlos Mendez (CloudPeak)',         subject: 'Task Requires Update - DNSSEC Configuration',     sentAt: formatDateTime(daysAgo(4)),  channel: 'email', status: 'delivered', escalationLevel: 1 },
  { id: 'NTF-005', taskId: 'TSK-1062', type: 'customer_notification',       recipient: 'John Miller (Acme Corp)',           subject: 'Task Requires Update - IAM Privilege Review',     sentAt: formatDateTime(daysAgo(5)),  channel: 'email', status: 'delivered', escalationLevel: 1 },
  // Day 14 notifications
  { id: 'NTF-006', taskId: 'TSK-1009', type: 'account_manager_notification', recipient: 'Jessica Liu (Account Manager)',    subject: 'Escalation: EDR Deployment Stale 16 Days',        sentAt: formatDateTime(daysAgo(2)),  channel: 'email', status: 'delivered', escalationLevel: 2 },
  { id: 'NTF-007', taskId: 'TSK-1013', type: 'account_manager_notification', recipient: 'Michael Patel (Account Manager)',  subject: 'Escalation: SQL Injection Remediation Stale',     sentAt: formatDateTime(daysAgo(1)),  channel: 'email', status: 'delivered', escalationLevel: 2 },
  { id: 'NTF-008', taskId: 'TSK-1018', type: 'account_manager_notification', recipient: 'Jessica Liu (Account Manager)',    subject: 'Escalation: API Key Rotation Overdue',            sentAt: formatDateTime(daysAgo(3)),  channel: 'email', status: 'delivered', escalationLevel: 2 },
  { id: 'NTF-009', taskId: 'TSK-1025', type: 'account_manager_notification', recipient: 'Sarah Chen (Account Manager)',     subject: 'Escalation: Kubernetes RBAC Hardening Stale',     sentAt: formatDateTime(daysAgo(0)),  channel: 'in-app', status: 'read',     escalationLevel: 2 },
  // Day 21 notifications
  { id: 'NTF-010', taskId: 'TSK-0987', type: 'customer_renotification',      recipient: 'Derek Zhang (CyberEdge Partners)', subject: 'URGENT: TLS Deprecation Still Pending',          sentAt: formatDateTime(daysAgo(2)),  channel: 'email', status: 'delivered', escalationLevel: 3 },
  { id: 'NTF-011', taskId: 'TSK-0991', type: 'customer_renotification',      recipient: 'Anna Schmidt (SecureNet Global)',  subject: 'URGENT: OT Network Segmentation Required',       sentAt: formatDateTime(daysAgo(1)),  channel: 'email', status: 'delivered', escalationLevel: 3 },
  { id: 'NTF-012', taskId: 'TSK-0995', type: 'customer_renotification',      recipient: 'Chris Taylor (Nexus Technologies)', subject: 'URGENT: Privileged Session Recording Overdue',  sentAt: formatDateTime(daysAgo(3)),  channel: 'email', status: 'bounced',   escalationLevel: 3 },
  // Day 28 escalations
  { id: 'NTF-013', taskId: 'TSK-0962', type: 'stakeholder_escalation',       recipient: 'James Rodriguez (Senior Stakeholder)', subject: 'CRITICAL ESCALATION: EOL Appliance Replacement', sentAt: formatDateTime(daysAgo(4)), channel: 'email', status: 'delivered', escalationLevel: 4 },
  { id: 'NTF-014', taskId: 'TSK-0970', type: 'stakeholder_escalation',       recipient: 'Thomas Brown (Senior Stakeholder)',   subject: 'CRITICAL ESCALATION: Windows 2012R2 Migration', sentAt: formatDateTime(daysAgo(7)), channel: 'email', status: 'delivered', escalationLevel: 4 },
  { id: 'NTF-015', taskId: 'TSK-0975', type: 'stakeholder_escalation',       recipient: 'Amanda Foster (Senior Stakeholder)',  subject: 'CRITICAL ESCALATION: Open S3 Buckets',          sentAt: formatDateTime(daysAgo(2)), channel: 'email', status: 'delivered', escalationLevel: 4 },
  { id: 'NTF-016', taskId: 'TSK-0980', type: 'stakeholder_escalation',       recipient: 'Lisa Thompson (Senior Stakeholder)', subject: 'CRITICAL ESCALATION: Certificate Chain Failure', sentAt: formatDateTime(daysAgo(1)), channel: 'email', status: 'delivered', escalationLevel: 4 },
  // Misc
  { id: 'NTF-017', taskId: 'TSK-1021', type: 'customer_notification',        recipient: 'John Miller (Acme Corp)',           subject: 'Automated Reminder - MFA Implementation',        sentAt: formatDateTime(daysAgo(0)),  channel: 'in-app', status: 'unread',   escalationLevel: 1 },
  { id: 'NTF-018', taskId: 'TSK-1009', type: 'customer_notification',        recipient: 'Anna Schmidt (SecureNet Global)',   subject: 'Task Update Required - EDR Deployment',          sentAt: formatDateTime(daysAgo(9)),  channel: 'email', status: 'delivered', escalationLevel: 1 },
];

// ─── Escalation Timeline (per task) ──────────────────────────────────────────
const buildEscalationTimeline = (task) => {
  const staleDays = getStaleDays(task.lastUpdated);
  const timeline = [];
  const taskAssignDate = new Date(task.lastUpdated.getTime() - 5 * 86400000); // assigned 5 days before last update

  timeline.push({
    date: formatDateTime(taskAssignDate),
    event: 'Task Assigned',
    detail: `Assigned to ${task.assignedTo}`,
    level: 0,
    icon: 'assign',
  });

  timeline.push({
    date: formatDateTime(task.lastUpdated),
    event: 'Last Updated',
    detail: `Customer last updated this task`,
    level: 0,
    icon: 'update',
  });

  ESCALATION_RULES.forEach((rule) => {
    if (staleDays >= rule.day) {
      const triggerDate = new Date(task.lastUpdated.getTime() + rule.day * 86400000);
      const cust = customers.find((c) => c.id === task.customerId);
      let recipientDetail = '';
      if (rule.action === 'notify_customer' || rule.action === 'notify_customer_again') {
        recipientDetail = `Notification sent to ${task.assignedTo} (${cust?.name})`;
      } else if (rule.action === 'notify_account_manager') {
        recipientDetail = `Notification sent to ${cust?.accountManager} (Account Manager)`;
      } else if (rule.action === 'escalate_stakeholder') {
        recipientDetail = `Escalated to ${cust?.seniorStakeholder} (Senior Stakeholder)`;
      }

      timeline.push({
        date: formatDateTime(triggerDate),
        event: rule.label,
        detail: recipientDetail,
        level: rule.level,
        icon: rule.level >= 3 ? 'escalation' : 'notification',
        color: rule.color,
      });
    }
  });

  return timeline.sort((a, b) => new Date(a.date) - new Date(b.date));
};

// ─── Customer Health Score ────────────────────────────────────────────────────
const calculateHealthScore = (customerId) => {
  const custTasks = monitoredTasks.filter((t) => t.customerId === customerId);
  if (custTasks.length === 0) return 100;

  let penalty = 0;
  custTasks.forEach((t) => {
    const level = getEscalationLevel(t.lastUpdated);
    if (level === 1) penalty += 5;
    if (level === 2) penalty += 12;
    if (level === 3) penalty += 20;
    if (level === 4) penalty += 30;
    if (t.severity === 'critical') penalty += 5;
    if (t.severity === 'high') penalty += 3;
  });

  return Math.max(0, Math.min(100, 100 - penalty));
};

const getHealthGrade = (score) => {
  if (score >= 90) return { grade: 'A', label: 'Excellent', color: '#10b981' };
  if (score >= 75) return { grade: 'B', label: 'Good', color: '#3b82f6' };
  if (score >= 60) return { grade: 'C', label: 'Fair', color: '#f59e0b' };
  if (score >= 40) return { grade: 'D', label: 'At Risk', color: '#f97316' };
  return { grade: 'F', label: 'Critical', color: '#ef4444' };
};

// ─── Service API ──────────────────────────────────────────────────────────────
export const monitoringService = {
  // Dashboard data
  getDashboardStats() {
    const stale7 = monitoredTasks.filter((t) => getStaleDays(t.lastUpdated) >= 7 && getStaleDays(t.lastUpdated) < 14);
    const stale14 = monitoredTasks.filter((t) => getStaleDays(t.lastUpdated) >= 14 && getStaleDays(t.lastUpdated) < 21);
    const stale21 = monitoredTasks.filter((t) => getStaleDays(t.lastUpdated) >= 21 && getStaleDays(t.lastUpdated) < 28);
    const stale28 = monitoredTasks.filter((t) => getStaleDays(t.lastUpdated) >= 28);
    const allStale = monitoredTasks.filter((t) => getStaleDays(t.lastUpdated) >= 7);
    const healthy = monitoredTasks.filter((t) => getStaleDays(t.lastUpdated) < 7);

    return {
      totalTasks: monitoredTasks.length,
      staleTasks7: stale7.length,
      staleTasks14: stale14.length,
      staleTasks21: stale21.length,
      escalatedTasks: stale28.length,
      totalStaleTasks: allStale.length,
      healthyTasks: healthy.length,
      avgHealthScore: Math.round(customers.reduce((sum, c) => sum + calculateHealthScore(c.id), 0) / customers.length),
    };
  },

  // All tasks with enriched data
  getMonitoredTasks() {
    return monitoredTasks.map((task) => {
      const staleDays = getStaleDays(task.lastUpdated);
      const level = getEscalationLevel(task.lastUpdated);
      const cust = customers.find((c) => c.id === task.customerId);

      return {
        ...task,
        lastUpdated: formatDate(task.lastUpdated),
        dueDate: formatDate(task.dueDate),
        staleDays,
        escalationLevel: level,
        escalationStatus: getEscalationStatus(level),
        customerName: cust?.name || 'Unknown',
        accountManager: cust?.accountManager || 'Unassigned',
        seniorStakeholder: cust?.seniorStakeholder || 'N/A',
        isOverdue: new Date(task.dueDate) < now,
      };
    });
  },

  // Tasks filtered by staleness bucket
  getTasksByBucket(bucket) {
    const tasks = this.getMonitoredTasks();
    switch (bucket) {
      case '7+': return tasks.filter((t) => t.staleDays >= 7 && t.staleDays < 14);
      case '14+': return tasks.filter((t) => t.staleDays >= 14 && t.staleDays < 21);
      case '21+': return tasks.filter((t) => t.staleDays >= 21 && t.staleDays < 28);
      case '28+': return tasks.filter((t) => t.staleDays >= 28);
      case 'escalated': return tasks.filter((t) => t.escalationLevel >= 4);
      case 'all-stale': return tasks.filter((t) => t.staleDays >= 7);
      default: return tasks;
    }
  },

  // Escalation timeline for a specific task
  getEscalationTimeline(taskId) {
    const task = monitoredTasks.find((t) => t.id === taskId);
    if (!task) return [];
    return buildEscalationTimeline(task);
  },

  // Customer health scores
  getCustomerHealthScores() {
    return customers.map((c) => {
      const score = calculateHealthScore(c.id);
      const { grade, label, color } = getHealthGrade(score);
      const custTasks = monitoredTasks.filter((t) => t.customerId === c.id);
      const staleTasks = custTasks.filter((t) => getStaleDays(t.lastUpdated) >= 7);
      const escalated = custTasks.filter((t) => getStaleDays(t.lastUpdated) >= 28);

      return {
        ...c,
        healthScore: score,
        grade,
        gradeLabel: label,
        gradeColor: color,
        totalTasks: custTasks.length,
        staleTasks: staleTasks.length,
        escalatedTasks: escalated.length,
      };
    }).sort((a, b) => a.healthScore - b.healthScore);
  },

  // Notification history
  getNotifications(filters = {}) {
    let result = [...notificationHistory];
    if (filters.type) result = result.filter((n) => n.type === filters.type);
    if (filters.level) result = result.filter((n) => n.escalationLevel === filters.level);
    if (filters.status) result = result.filter((n) => n.status === filters.status);
    if (filters.taskId) result = result.filter((n) => n.taskId === filters.taskId);
    return result.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  },

  getNotificationStats() {
    return {
      total: notificationHistory.length,
      delivered: notificationHistory.filter((n) => n.status === 'delivered').length,
      read: notificationHistory.filter((n) => n.status === 'read').length,
      unread: notificationHistory.filter((n) => n.status === 'unread').length,
      bounced: notificationHistory.filter((n) => n.status === 'bounced').length,
      byType: {
        customer: notificationHistory.filter((n) => n.type === 'customer_notification').length,
        accountManager: notificationHistory.filter((n) => n.type === 'account_manager_notification').length,
        renotification: notificationHistory.filter((n) => n.type === 'customer_renotification').length,
        stakeholder: notificationHistory.filter((n) => n.type === 'stakeholder_escalation').length,
      },
      byChannel: {
        email: notificationHistory.filter((n) => n.channel === 'email').length,
        inApp: notificationHistory.filter((n) => n.channel === 'in-app').length,
      },
    };
  },

  // Escalation Center data
  getEscalationSummary() {
    const tasks = this.getMonitoredTasks();
    const escalatedTasks = tasks.filter((t) => t.escalationLevel >= 1);

    return {
      totalEscalations: escalatedTasks.length,
      byLevel: {
        level1: tasks.filter((t) => t.escalationLevel === 1).length,
        level2: tasks.filter((t) => t.escalationLevel === 2).length,
        level3: tasks.filter((t) => t.escalationLevel === 3).length,
        level4: tasks.filter((t) => t.escalationLevel === 4).length,
      },
      bySeverity: {
        critical: escalatedTasks.filter((t) => t.severity === 'critical').length,
        high: escalatedTasks.filter((t) => t.severity === 'high').length,
        medium: escalatedTasks.filter((t) => t.severity === 'medium').length,
        low: escalatedTasks.filter((t) => t.severity === 'low').length,
      },
      recentEscalations: escalatedTasks
        .sort((a, b) => b.staleDays - a.staleDays)
        .slice(0, 10),
    };
  },

  // Customers list
  getCustomers() {
    return customers;
  },
};

export default monitoringService;
