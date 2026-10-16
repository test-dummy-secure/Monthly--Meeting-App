'use strict';
/**
 * Demo seed — 2 tenants, clean lifecycle data.
 *
 * Run:   cd backend && npm run seed
 * Safe to re-run: deletes and re-creates all demo records each time.
 *
 * ── TENANT OVERVIEW ─────────────────────────────────────────────────────────
 *
 * Acme Financial Services  (onboarded April 2026, America/New_York)
 *   May-12 meeting  : CLOSED    — full lifecycle trail (findings, tasks, AI recs,
 *                                  notes, monthly report). 3 tasks: 1 completed,
 *                                  2 carried forward to June.
 *   Jun-12 meeting  : CONDUCTED — T-48 fired Jun-10. Meeting conducted Jun-12.
 *                                  Today (Jun-15) it is 3 days past — awaiting
 *                                  closure. 4 tasks: CF×2 + CF×3 from May + 2 new.
 *                                  Carry-forward counts elevated to demo notifications.
 *   Jul-12 meeting  : auto-generated when user closes June (not seeded here).
 *
 * TechNova Solutions  (onboarded June 1, 2026, America/Chicago)
 *   Jul-01 meeting  : SCHEDULED — first-ever meeting. T-48 fires Jun-29.
 *                                  No findings, no tasks, no AI recs yet.
 *
 * ── CREDENTIALS ─────────────────────────────────────────────────────────────
 *   admin@bmmj.com          Seed@Demo2026  super_admin
 *   sarah.johnson@bmmj.com  Seed@Demo2026  account_manager (Acme)
 *   michael.chen@bmmj.com   Seed@Demo2026  account_manager (TechNova)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { createCipheriv, randomBytes } = require('crypto');

// Encrypt a plain-text token using the same AES-256-GCM format as MicrosoftTokenStore.
// Seeds a realistic-looking connection so the UI shows "Connected to Microsoft."
// The placeholder token is intentionally invalid — Graph API calls will fail gracefully.
function encryptToken(plainText) {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY || '';
  const key    = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    console.warn('⚠️  TOKEN_ENCRYPTION_KEY missing or wrong length — calendar connection will show as not_connected');
    return null;
  }
  const iv     = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let   enc    = cipher.update(plainText, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${enc}`;
}

// ─── Deterministic UUIDs ─────────────────────────────────────────────────────

const T = {
  ACME: '11111111-1111-1111-1111-111111111111',
  TECH: '22222222-2222-2222-2222-222222222222',
};

const U = {
  ADMIN: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  AM1:   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', // sarah  — Acme
  AM2:   'cccccccc-cccc-cccc-cccc-cccccccccccc', // michael — TechNova
};

const MC = {
  ACME: '11111111-1111-4444-aaaa-111111111111',
  TECH: '22222222-2222-4444-aaaa-222222222222',
};

// 3 meetings total across both tenants
const M = {
  A_MAY: '11111111-0000-0000-aaaa-000000000001', // Acme  May-12 CLOSED
  A_JUN: '11111111-0000-0000-aaaa-000000000002', // Acme  Jun-12 CONDUCTED
  T_JUL: '22222222-0000-0000-aaaa-000000000001', // TechNova Jul-01 SCHEDULED
};

// 4 findings — all for Acme (TechNova has none yet)
const F = {
  A_MAY_1: '11111111-0000-0000-bbbb-000000000001', // Critical CVE in auth service (May)
  A_MAY_2: '11111111-0000-0000-bbbb-000000000002', // High    stale IAM service accounts (May)
  A_JUN_1: '11111111-0000-0000-bbbb-000000000003', // High    unencrypted legacy S3 data (Jun)
  A_JUN_2: '11111111-0000-0000-bbbb-000000000004', // Medium  TLS 1.0/1.1 on public APIs (Jun)
};

// 7 tasks — all for Acme
//   May meeting  : 3 tasks (1 completed, 2 carry-forward → carried to June)
//   June meeting : 4 tasks (CF×2 + CF×3 from May + 2 new from June findings)
//                  CF counts bumped from 1 to 2/3 to demo the notification pipeline.
const TSK = {
  A_MAY_1:   '11111111-0000-0000-cccc-000000000001', // completed
  A_MAY_2:   '11111111-0000-0000-cccc-000000000002', // carry_forward → A_JUN_CF1
  A_MAY_3:   '11111111-0000-0000-cccc-000000000003', // carry_forward → A_JUN_CF2
  A_JUN_CF1: '11111111-0000-0000-cccc-000000000004', // CF×2 of A_MAY_2 — triggers carry_forward_warning → AM
  A_JUN_CF2: '11111111-0000-0000-cccc-000000000005', // CF×3 of A_MAY_3 — triggers carry_forward_alert + auto-escalation
  A_JUN_1:   '11111111-0000-0000-cccc-000000000006', // new — S3 encryption
  A_JUN_2:   '11111111-0000-0000-cccc-000000000007', // new — TLS modernisation
};

const ESC = {
  A1: '11111111-0000-0000-dddd-000000000001',
};

// 5 seed notifications — demonstrate full carry-forward warning → auto-escalation pipeline
const NOTIF = {
  CF_WARN_1:    '11111111-0000-0000-8888-000000000001', // carry_forward_warning  — IAM task CF×2 → AM
  CF_ALERT_1:   '11111111-0000-0000-8888-000000000002', // carry_forward_alert    — PAM task CF×3 → AM
  ESC_ASSIGN_1: '11111111-0000-0000-8888-000000000003', // auto_escalation_assigned — PAM task → Super Admin
  ESC_NOTICE_1: '11111111-0000-0000-8888-000000000004', // auto_escalation_notice   — PAM task → AM
  WKR_GEN_1:    '11111111-0000-0000-8888-000000000005', // weekly_report_generated  — Jun weekly → AM
};

// 4 AI recs — all for Acme, all approved
//   A_MAY_1 / A_MAY_2 → T-48 fired May-10, approved May-11 → spawned May tasks
//   A_JUN_1 / A_JUN_2 → T-48 fired Jun-10, approved Jun-11 → spawned June new tasks
const AI = {
  A_MAY_1: '11111111-0000-0000-eeee-000000000001',
  A_MAY_2: '11111111-0000-0000-eeee-000000000002',
  A_JUN_1: '11111111-0000-0000-eeee-000000000003',
  A_JUN_2: '11111111-0000-0000-eeee-000000000004',
};

const RPT = {
  A_MAY:    '11111111-0000-0000-ffff-000000000001', // Acme May monthly summary
  A_MAY_W1: '11111111-0000-0000-ffff-000000000010', // Acme May week 1 progress (May 12-18)
  A_MAY_W2: '11111111-0000-0000-ffff-000000000011', // Acme May week 2 progress (May 19-25)
  A_MAY_W3: '11111111-0000-0000-ffff-000000000012', // Acme May week 3 progress (May 26-Jun 1)
  A_JUN_W1: '11111111-0000-0000-ffff-000000000013', // Acme June week 1 progress (Jun 9-15)
};

const WKR = {
  // Acme May cycle — 3 weekly reports covering the closed meeting period
  A_MAY_1: '11111111-0000-0000-1234-000000000010', // week May 12-18 (meeting closed, tasks created)
  A_MAY_2: '11111111-0000-0000-1234-000000000011', // week May 19-25 (tasks in progress)
  A_MAY_3: '11111111-0000-0000-1234-000000000012', // week May 26-Jun 1 (carry-forward decisions)
  // Acme June cycle
  A_JUN:   '11111111-0000-0000-1234-000000000001', // week Jun 09-15 (conducted, awaiting closure)
};

const CALCONN = {
  ACME: 'aaaaaaaa-0000-0000-cafe-000000000001', // Acme Microsoft 365
  TECH: 'bbbbbbbb-0000-0000-cafe-000000000001', // TechNova Microsoft 365
};

const SL = {
  A_MAY_T48:  '11111111-0000-0000-cafe-000000000001', // Acme May T-48 NXG360 sync
  A_JUN_T48:  '11111111-0000-0000-cafe-000000000002', // Acme Jun T-48 NXG360 sync
  A_JUN_REM7: '11111111-0000-0000-cafe-000000000003', // Acme Jun 7-day reminder
  T_JUL_INV:  '22222222-0000-0000-cafe-000000000001', // TechNova Jul invite sync
};

const SARAH   = 'sarah.johnson@bmmj.com';
const MICHAEL = 'michael.chen@bmmj.com';
const ADMIN   = 'admin@bmmj.com';
const JOHN    = 'john.smith@acmefinancial.com';
const PRIYA   = 'priya.patel@technovasolutions.com';

const j = (v) => JSON.stringify(v);

// ─── Main ─────────────────────────────────────────────────────────────────────
async function seed() {
  const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME     || 'bmmj_db',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  const client = await pool.connect();

  console.log('⏳  Hashing demo passwords…');
  const pwHash = await bcrypt.hash('Seed@Demo2026', 12);

  // Check schema capabilities before the transaction so we can use the right INSERT.
  const { rows: cfColRows } = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'carry_forward_count'
  `);
  const hasCfCount = cfColRows.length > 0;

  // Check whether migration 024 (notifications) has run.
  const { rows: notifTableRows } = await client.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
  `);
  const hasNotifications = notifTableRows.length > 0;

  try {
    await client.query('BEGIN');

    // ── 0. CLEAN (cascade removes all child rows) ─────────────────────────────
    console.log('🗑   Cleaning previous seed data…');
    await client.query(`DELETE FROM customers WHERE id IN ($1,$2)`, [T.ACME, T.TECH]);
    await client.query(
      `DELETE FROM users WHERE id IN ($1,$2,$3) OR email IN ($4,$5,$6)`,
      [U.ADMIN, U.AM1, U.AM2, ADMIN, SARAH, MICHAEL],
    );

    // ── 1. USERS ──────────────────────────────────────────────────────────────
    // Users must be inserted before customers so we can reference their UUIDs
    // in account_manager_id (FK).
    console.log('👤  Inserting users…');
    await client.query(`
      INSERT INTO users
        (id, email, password_hash, first_name, last_name, role, tenant_id, is_active)
      VALUES
        ($1,$4,$7,'System', 'Admin',  'super_admin',    NULL, true),
        ($2,$5,$7,'Sarah',  'Johnson','account_manager',NULL, true),
        ($3,$6,$7,'Michael','Chen',   'account_manager',NULL, true)
    `, [U.ADMIN, U.AM1, U.AM2, ADMIN, SARAH, MICHAEL, pwHash]);

    // ── 2. CUSTOMERS ──────────────────────────────────────────────────────────
    console.log('🏢  Inserting tenants…');
    await client.query(`
      INSERT INTO customers
        (id, name, domain, industry, timezone, meeting_platform,
         status, account_manager_id, connected_calendars)
      VALUES
        ($1,'Acme Financial Services','acmefinancial.com','Finance',
            'America/New_York','microsoft_teams','active',$3,$5),
        ($2,'TechNova Solutions','technovasolutions.com','Technology',
            'America/Chicago','microsoft_teams','active',$4,$5)
    `, [T.ACME, T.TECH, U.AM1, U.AM2, j(['manual'])]);

    // ── 3. TENANT ASSIGNMENTS ─────────────────────────────────────────────────
    console.log('🔗  Inserting tenant assignments…');
    await client.query(`
      INSERT INTO tenant_assignments (user_id, tenant_id, role, assigned_by, is_primary)
      VALUES ($1,$3,'account_manager',$5,TRUE), ($2,$4,'account_manager',$5,TRUE)
    `, [U.AM1, U.AM2, T.ACME, T.TECH, U.ADMIN]);

    // ── 4. MEETING CONFIGS ────────────────────────────────────────────────────
    // first_meeting_date is the anchor date the recurrence engine uses.
    //   Acme:     May-12 — first ever meeting (onboarded April)
    //   TechNova: Jul-01 — first ever meeting (onboarded June 1)
    console.log('⚙️   Inserting meeting configs…');
    await client.query(`
      INSERT INTO meeting_configs
        (id, tenant_id, first_meeting_date, meeting_time, timezone,
         recurrence_pattern, default_calendar_provider, meeting_duration_minutes,
         reminder_schedule, calendar_account)
      VALUES
        ($1,$3,'2026-05-12','10:00','America/New_York','monthly_day_of_month','microsoft',60,$5,$6),
        ($2,$4,'2026-07-01','10:00','America/Chicago', 'monthly_day_of_month','microsoft',60,$5,$7)
    `, [MC.ACME, MC.TECH, T.ACME, T.TECH, j([7, 3, 1]), SARAH, MICHAEL]);

    // ── 5. MEETINGS ───────────────────────────────────────────────────────────
    // Times in UTC:
    //   Acme timezone America/New_York (EDT = UTC−4)   → 10:00 AM = 14:00 UTC
    //   TechNova timezone America/Chicago (CDT = UTC−5) → 10:00 AM = 15:00 UTC
    console.log('📅  Inserting meetings…');
    const acmeAtt = j([
      { email: JOHN,  name: 'John Smith',    role: 'contact' },
      { email: SARAH, name: 'Sarah Johnson', role: 'manager' },
    ]);
    const techAtt = j([
      { email: PRIYA,   name: 'Priya Patel',  role: 'contact' },
      { email: MICHAEL, name: 'Michael Chen', role: 'manager' },
    ]);

    // [id, tenantId, mcId, start, end, triggerDate, calendarEventId, title, status, provider, att, createdBy]
    const meetings = [
      [
        M.A_MAY, T.ACME, MC.ACME,
        '2026-05-12 14:00+00', '2026-05-12 15:00+00',
        '2026-05-10 14:00+00', 'ms_evt_acme_may12_2026',
        'May Monthly Review — Acme Financial Services',
        'closed', 'microsoft', acmeAtt, SARAH,
      ],
      [
        M.A_JUN, T.ACME, MC.ACME,
        '2026-06-12 14:00+00', '2026-06-12 15:00+00',
        '2026-06-10 14:00+00', 'ms_evt_acme_jun12_2026',
        'June Monthly Review — Acme Financial Services',
        'conducted', 'microsoft', acmeAtt, SARAH,
      ],
      [
        M.T_JUL, T.TECH, MC.TECH,
        '2026-07-01 15:00+00', '2026-07-01 16:00+00',
        '2026-06-29 15:00+00', 'msft_evt_tech_jul01_2026',
        'July Monthly Review — TechNova Solutions',
        'scheduled', 'microsoft', techAtt, MICHAEL,
      ],
    ];

    for (const [id, tenantId, mcId, start, end, triggerDate, calEvtId, title, status, provider, att, createdBy] of meetings) {
      await client.query(`
        INSERT INTO meetings
          (id, tenant_id, meeting_config_id, scheduled_start, scheduled_end,
           trigger_date, calendar_event_id, title, meeting_type, status,
           provider, attendees, created_by, reschedule_count, meeting_duration_minutes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'monthly_review',$9,$10,$11,$12,0,60)
      `, [id, tenantId, mcId, start, end, triggerDate, calEvtId, title, status, provider, att, createdBy]);
    }

    // ── 6. FINDINGS ───────────────────────────────────────────────────────────
    // TechNova has zero findings — T-48 hasn't fired yet (first meeting Jul-01,
    // T-48 fires Jun-29, today is Jun-15).
    console.log('🔍  Inserting findings…');
    const findings = [
      // ── Acme May-12 findings (surfaced at T-48 May-10, discussed May-12) ──────
      [F.A_MAY_1, M.A_MAY, T.ACME, 'critical', 'Vulnerability Management',
        'CVE-2026-0421 RCE in authentication service (CVSS 9.8)',
        'Unauthenticated remote code execution confirmed in auth-service v2.4.1. Vendor advisory released May 6. Active exploitation detected in FS-ISAC threat feed.',
        'Authentication Service — Production'],
      [F.A_MAY_2, M.A_MAY, T.ACME, 'high', 'Identity & Access Management',
        '17 stale service accounts retain admin-level privileges',
        'IAM audit identified 17 service accounts that were never deprovisioned after project closure. All carry broad admin scopes including key management and billing roles.',
        'AWS IAM — Production Account'],

      // ── Acme Jun-12 findings (surfaced at T-48 Jun-10, discussed Jun-12) ──────
      [F.A_JUN_1, M.A_JUN, T.ACME, 'high', 'Data Protection',
        'Unencrypted data-at-rest in 4 legacy S3 buckets',
        'Compliance scan identified 4 S3 buckets containing PII and financial records with server-side encryption disabled. Buckets predate the 2025 encryption mandate and were not included in the migration project.',
        'AWS S3 — Data Lake Buckets'],
      [F.A_JUN_2, M.A_JUN, T.ACME, 'medium', 'Network Security',
        'TLS 1.0 and 1.1 still enabled on 3 public-facing API endpoints',
        'External TLS scan confirms 3 APIs still negotiate TLS 1.0/1.1 connections. PCI-DSS 4.0 requires TLS 1.2+ by June 30, 2026. Downgrade attack surface is active.',
        'API Gateway — Public Endpoints'],
    ];

    for (const [id, meetingId, tenantId, severity, category, title, description, systemAffected] of findings) {
      await client.query(`
        INSERT INTO findings (id, meeting_id, tenant_id, severity, category, title, description, system_affected)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [id, meetingId, tenantId, severity, category, title, description, systemAffected]);
    }

    // ── 7. TASKS ──────────────────────────────────────────────────────────────
    // Acme May meeting: 3 tasks — 1 completed, 2 carry-forward → both carried to June
    // Acme June meeting: 4 tasks — 2 CF×1 from May + 2 new from June findings
    // TechNova: zero tasks (no T-48 fired yet)
    console.log('✅  Inserting tasks…');

    const sarahOwner = j({ name: 'Sarah Johnson', email: SARAH, role: 'account_manager' });
    const johnOwner  = j({ name: 'John Smith',    email: JOHN,  role: 'customer_contact' });

    const acmeMayTasks = [
      {
        id: TSK.A_MAY_1, meetingId: M.A_MAY, findingId: F.A_MAY_1, tenantId: T.ACME,
        title: 'Patch CVE-2026-0421 on all auth-service production instances',
        actionPlan: 'Apply vendor patch v2.4.2, test in staging environment, deploy to production during maintenance window May 9, verify via authenticated vulnerability scan post-deployment.',
        riskScore: 92, approvalStatus: 'approved', remediationStatus: 'completed',
        reviewOutcome: 'on_track', escalationStatus: 'resolved',
        ownerType: 'ACCOUNT_MANAGER', ownerEmail: SARAH, priority: 'critical', progress: 100,
        dueDate: '2026-05-09', primaryOwner: sarahOwner, secondaryOwner: johnOwner,
        notes: 'Patch applied to all 8 production instances across 2 availability zones. Post-patch vulnerability scan returned clean. Vendor confirmed fix closes CVE-2026-0421.',
        completedAt: '2026-05-09 14:30+00', createdBy: SARAH,
        carryForwardCount: 0,
        timeline: j([
          { date: '2026-05-10', status: 'open',        note: 'Created from May T-48 AI recommendation — approved by Sarah' },
          { date: '2026-05-09', status: 'in_progress', note: 'Vendor patch acquired and tested in staging — production deploy tonight' },
          { date: '2026-05-09', status: 'completed',   note: 'All 8 production instances patched. Scan clean.' },
        ]),
      },
      {
        id: TSK.A_MAY_2, meetingId: M.A_MAY, findingId: F.A_MAY_2, tenantId: T.ACME,
        title: 'Audit and deprovision 17 stale IAM service accounts',
        actionPlan: 'Export full IAM service account list, map each account to originating project, validate no active usage via CloudTrail, deprovision with documented approval per account.',
        riskScore: 68, approvalStatus: 'approved', remediationStatus: 'carry_forward',
        reviewOutcome: 'customer_dependency', escalationStatus: 'eligible',
        ownerType: 'CUSTOMER', ownerEmail: JOHN, priority: 'high', progress: 40,
        dueDate: '2026-06-12', primaryOwner: johnOwner, secondaryOwner: sarahOwner,
        notes: 'Carried forward to June cycle. 7 of 17 accounts audited and scheduled for removal. 10 accounts still under project-owner review — procurement freeze delayed sign-off.',
        completedAt: null, createdBy: SARAH,
        carryForwardCount: 0,
        timeline: j([
          { date: '2026-05-10', status: 'open',          note: 'Created from May T-48 AI recommendation — approved by Sarah' },
          { date: '2026-05-16', status: 'in_progress',   note: '7 accounts mapped and approved for removal' },
          { date: '2026-05-28', status: 'carry_forward', note: '10 accounts still awaiting project-owner approval — carried to June cycle' },
        ]),
      },
      {
        id: TSK.A_MAY_3, meetingId: M.A_MAY, findingId: F.A_MAY_2, tenantId: T.ACME,
        title: 'Implement Privileged Access Management (PAM) solution evaluation and PoC',
        actionPlan: 'Evaluate CyberArk Privilege Cloud vs BeyondTrust PAM, present business case to CISO, secure budget approval, conduct 30-day PoC in lower environment.',
        riskScore: 72, approvalStatus: 'approved', remediationStatus: 'carry_forward',
        reviewOutcome: 'escalation_required', escalationStatus: 'escalated',
        ownerType: 'ACCOUNT_MANAGER', ownerEmail: SARAH, priority: 'high', progress: 20,
        dueDate: '2026-06-12', primaryOwner: sarahOwner, secondaryOwner: johnOwner,
        notes: 'ESCALATED: Budget approval stalled — no response from CISO office after three follow-ups (May 20, May 27, Jun 3). Carried to June cycle with escalation.',
        completedAt: null, createdBy: SARAH,
        carryForwardCount: 0,
        timeline: j([
          { date: '2026-05-10', status: 'open',          note: 'Created from May T-48 AI recommendation — approved by Sarah' },
          { date: '2026-05-18', status: 'in_progress',   note: 'Vendor comparison complete — business case sent to CISO for budget approval' },
          { date: '2026-05-31', status: 'carry_forward', note: 'No budget response — escalated, carried to June cycle' },
        ]),
      },
    ];

    const acmeJuneTasks = [
      // ── Carried forward from May ─────────────────────────────────────────────
      {
        id: TSK.A_JUN_CF1, meetingId: M.A_JUN, findingId: F.A_MAY_2, tenantId: T.ACME,
        title: 'Audit and deprovision 17 stale IAM service accounts',
        actionPlan: 'Complete audit of remaining 10 accounts. Deprovision with documented approval. Verify removal via CloudTrail within 24h. Update IAM inventory.',
        riskScore: 68, approvalStatus: 'approved', remediationStatus: 'in_progress',
        reviewOutcome: 'on_track', escalationStatus: 'eligible',
        ownerType: 'CUSTOMER', ownerEmail: JOHN, priority: 'high', progress: 65,
        dueDate: '2026-06-30', primaryOwner: johnOwner, secondaryOwner: sarahOwner,
        notes: 'CF×2 from Apr/May. 11 of 17 accounts now audited and deprovisioned. 6 remaining — customer IT scheduled batch removal for June 20. ⚠️ Warning notification sent to AM (carry_forward_warning — CF×2 threshold).',
        completedAt: null, createdBy: SARAH,
        carryForwardCount: 2,
        timeline: j([
          { date: '2026-04-30', status: 'open',          note: 'Original task created — pre-existing IAM gap from April security review' },
          { date: '2026-05-10', status: 'in_progress',   note: 'Carried forward from April to May cycle (CF×1) — 7 accounts mapped and approved for removal' },
          { date: '2026-05-28', status: 'carry_forward', note: 'Carried forward from May to June cycle (CF×2) — 10 accounts still pending project-owner approval. ⚠️ carry_forward_warning notification sent to AM.' },
          { date: '2026-06-10', status: 'in_progress',   note: '11/17 accounts deprovisioned — 6 pending Jun-20 batch removal' },
        ]),
      },
      {
        id: TSK.A_JUN_CF2, meetingId: M.A_JUN, findingId: F.A_MAY_2, tenantId: T.ACME,
        title: 'Implement Privileged Access Management (PAM) solution evaluation and PoC',
        actionPlan: 'Evaluate CyberArk Privilege Cloud (SaaS/OpEx model) as budget-compliant alternative. Present revised proposal to CISO. Conduct 30-day PoC if approved.',
        riskScore: 72, approvalStatus: 'approved', remediationStatus: 'escalated',
        reviewOutcome: 'escalation_required', escalationStatus: 'escalated',
        ownerType: 'ACCOUNT_MANAGER', ownerEmail: SARAH, priority: 'high', progress: 20,
        dueDate: '2026-06-30', primaryOwner: sarahOwner, secondaryOwner: johnOwner,
        notes: 'CF×3 from Apr/May/Jun. ESCALATED: Budget approval remains blocked across 3 consecutive meetings. System auto-escalated to super_admin after CF×3 threshold. 🚨 carry_forward_alert + auto_escalation_assigned (admin@bmmj.com) + auto_escalation_notice (sarah) notifications sent.',
        completedAt: null, createdBy: SARAH,
        carryForwardCount: 3,
        timeline: j([
          { date: '2026-04-30', status: 'open',          note: 'Original task created — PAM gap identified in April security review' },
          { date: '2026-05-10', status: 'in_progress',   note: 'Carried forward from April to May cycle (CF×1) — vendor comparison submitted to CISO for budget approval' },
          { date: '2026-05-31', status: 'carry_forward', note: 'Carried forward from May to June cycle (CF×2) — escalated to CISO office (3 unanswered follow-ups). 🚨 carry_forward_alert notification sent.' },
          { date: '2026-06-05', status: 'escalated',     note: 'SaaS alternative proposal submitted — bypasses CapEx freeze. Awaiting CISO response.' },
          { date: '2026-06-12', status: 'carry_forward', note: 'Carried forward from June cycle (CF×3). System auto-escalation triggered — management notified. Manual escalation ESC.A1 already open.' },
        ]),
      },
      // ── New tasks from June findings ─────────────────────────────────────────
      {
        id: TSK.A_JUN_1, meetingId: M.A_JUN, findingId: F.A_JUN_1, tenantId: T.ACME,
        title: 'Enable AWS KMS server-side encryption on 4 legacy S3 buckets',
        actionPlan: 'Enable SSE-KMS on all 4 affected buckets, re-encrypt existing objects via S3 Batch Operations, update bucket policies to deny unencrypted PUTs, validate via compliance scan.',
        riskScore: 74, approvalStatus: 'approved', remediationStatus: 'open',
        reviewOutcome: 'on_track', escalationStatus: 'eligible',
        ownerType: 'CUSTOMER', ownerEmail: JOHN, priority: 'high', progress: 0,
        dueDate: '2026-06-30', primaryOwner: johnOwner, secondaryOwner: sarahOwner,
        notes: 'New task from June meeting. KMS key policy draft submitted for legal review. S3 Batch Operations job estimated at 6–8 hours for re-encryption.',
        completedAt: null, createdBy: SARAH,
        carryForwardCount: 0,
        timeline: j([
          { date: '2026-06-12', status: 'open', note: 'Created from June meeting — June T-48 AI recommendation approved by Sarah Jun-11' },
        ]),
      },
      {
        id: TSK.A_JUN_2, meetingId: M.A_JUN, findingId: F.A_JUN_2, tenantId: T.ACME,
        title: 'Enforce TLS 1.2+ minimum on all public-facing API gateway endpoints',
        actionPlan: 'Update API Gateway security policy to set minimum TLS version to 1.2, disable TLS_RSA cipher suites, test with TLS scanner, deploy via blue-green rollout, validate PCI-DSS compliance.',
        riskScore: 58, approvalStatus: 'approved', remediationStatus: 'in_progress',
        reviewOutcome: 'on_track', escalationStatus: 'eligible',
        ownerType: 'SHARED', ownerEmail: JOHN, priority: 'medium', progress: 30,
        dueDate: '2026-06-25', primaryOwner: johnOwner, secondaryOwner: sarahOwner,
        notes: 'New task from June meeting. Security policy update applied in staging — passing TLS scanner. Production blue-green cutover scheduled June 19.',
        completedAt: null, createdBy: SARAH,
        carryForwardCount: 0,
        timeline: j([
          { date: '2026-06-12', status: 'open',        note: 'Created from June meeting — June T-48 AI recommendation approved by Sarah Jun-11' },
          { date: '2026-06-13', status: 'in_progress', note: 'TLS policy update applied in staging — TLS scanner passing. Prod cutover Jun-19.' },
        ]),
      },
    ];

    for (const t of [...acmeMayTasks, ...acmeJuneTasks]) {
      if (hasCfCount) {
        await client.query(`
          INSERT INTO tasks
            (id, meeting_id, finding_id, tenant_id, title, action_plan, risk_reduction_score,
             approval_status, remediation_status, review_outcome, escalation_status,
             owner_type, owner_email, priority, progress_percentage, due_date,
             primary_owner, secondary_owner, notes, created_by, completed_at, timeline,
             carry_forward_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        `, [
          t.id, t.meetingId, t.findingId, t.tenantId, t.title, t.actionPlan, t.riskScore,
          t.approvalStatus, t.remediationStatus, t.reviewOutcome, t.escalationStatus,
          t.ownerType, t.ownerEmail, t.priority, t.progress, t.dueDate,
          t.primaryOwner, t.secondaryOwner, t.notes, t.createdBy, t.completedAt, t.timeline,
          t.carryForwardCount,
        ]);
      } else {
        await client.query(`
          INSERT INTO tasks
            (id, meeting_id, finding_id, tenant_id, title, action_plan, risk_reduction_score,
             approval_status, remediation_status, review_outcome, escalation_status,
             owner_type, owner_email, priority, progress_percentage, due_date,
             primary_owner, secondary_owner, notes, created_by, completed_at, timeline)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        `, [
          t.id, t.meetingId, t.findingId, t.tenantId, t.title, t.actionPlan, t.riskScore,
          t.approvalStatus, t.remediationStatus, t.reviewOutcome, t.escalationStatus,
          t.ownerType, t.ownerEmail, t.priority, t.progress, t.dueDate,
          t.primaryOwner, t.secondaryOwner, t.notes, t.createdBy, t.completedAt, t.timeline,
        ]);
      }
    }

    // ── 8. ESCALATIONS ────────────────────────────────────────────────────────
    console.log('🚨  Inserting escalations…');
    await client.query(`
      INSERT INTO escalations
        (id, task_id, tenant_id, escalated_by, escalated_to, reason, blocker_type, status)
      VALUES
        ($1,$2,$3,$4,$5,
         'PAM budget approval stalled since May-18. Three follow-up emails to CISO office (May-20, May-27, Jun-03) with no response. Revised SaaS-model proposal submitted Jun-05 — still no reply as of Jun-12 meeting.',
         'budget','open')
    `, [ESC.A1, TSK.A_JUN_CF2, T.ACME, SARAH, ADMIN]);

    // ── 9. MEETING NOTES ──────────────────────────────────────────────────────
    // Notes for both Acme meetings; TechNova has none (meeting not yet conducted).
    console.log('📝  Inserting meeting notes…');
    const meetingNotes = [
      {
        meetingId: M.A_MAY, tenantId: T.ACME,
        summary: 'May-12 review: 1 critical RCE (CVE-2026-0421) patched same day — outstanding response from IT team. IAM service account cleanup underway (7/17 deprovisioned). PAM evaluation approved but budget stalled at CISO level. Notes will feed June T-48 AI generation on Jun-10.',
        actionItems: j([
          { title: 'Complete IAM account audit — 10 remaining',              owner: JOHN,  dueDate: '2026-06-12', status: 'carry_forward' },
          { title: 'Escalate PAM budget to CISO; explore SaaS model option', owner: SARAH, dueDate: '2026-06-05', status: 'escalated' },
        ]),
        decisions: j([
          { decision: 'CVE-2026-0421 patch confirmed complete — vulnerability closed', decidedBy: 'Sarah Johnson' },
          { decision: 'IAM cleanup to complete by June 12 — procurement freeze lifted', decidedBy: 'John Smith' },
          { decision: 'PAM evaluation to explore SaaS/OpEx model to bypass CapEx freeze', decidedBy: 'Sarah Johnson' },
        ]),
        risks: j([
          { risk: '10 stale admin accounts still active — lateral movement risk until removed', severity: 'high' },
          { risk: 'PAM gap leaves privileged access uncontrolled — escalation unresolved',      severity: 'high' },
        ]),
      },
      {
        meetingId: M.A_JUN, tenantId: T.ACME,
        summary: 'Jun-12 review (conducted, awaiting closure): IAM cleanup at 65% — on track for Jun-30. PAM escalation still unresolved despite SaaS proposal. Two new findings: legacy S3 encryption gap and TLS 1.0/1.1 on public APIs (PCI-DSS 4.0 deadline Jun-30). Both tasks created and immediately assigned. Next closure will auto-schedule Jul-12 meeting.',
        actionItems: j([
          { title: 'S3 KMS encryption — 4 buckets; legal review in progress',  owner: JOHN,  dueDate: '2026-06-30', status: 'open' },
          { title: 'TLS 1.2+ enforcement — staging tested, prod cutover Jun-19', owner: JOHN,  dueDate: '2026-06-25', status: 'in_progress' },
          { title: 'Close PAM escalation — CISO response overdue',             owner: SARAH, dueDate: '2026-06-20', status: 'escalated' },
        ]),
        decisions: j([
          { decision: 'S3 encryption to use SSE-KMS with customer-managed keys',          decidedBy: 'John Smith' },
          { decision: 'TLS cutover via blue-green on June 19 — no downtime window needed', decidedBy: 'Sarah Johnson' },
          { decision: 'PAM escalation to be raised to board-level if no CISO response by Jun-20', decidedBy: 'Sarah Johnson' },
        ]),
        risks: j([
          { risk: 'PCI-DSS 4.0 deadline Jun-30 — TLS and S3 tasks must complete this month', severity: 'high' },
          { risk: 'PAM escalation unresolved for 6+ weeks — privileged access exposure continues', severity: 'high' },
          { risk: 'TLS blue-green cutover on Jun-19 carries low rollback risk', severity: 'low' },
        ]),
      },
    ];

    for (const n of meetingNotes) {
      await client.query(`
        INSERT INTO meeting_notes
          (meeting_id, tenant_id, provider, transcript_source, summary,
           action_items, decisions_taken, risks_discussed, ai_status)
        VALUES ($1,$2,'manual','manual',$3,$4,$5,$6,'completed')
      `, [n.meetingId, n.tenantId, n.summary, n.actionItems, n.decisions, n.risks]);
    }

    // ── 10. AI TASK RECOMMENDATIONS ───────────────────────────────────────────
    // All 4 recs are APPROVED (meeting lifecycle is past approval stage).
    //   A_MAY_1 / A_MAY_2 → T-48 fired May-10, reviewed May-11, approved → spawned May tasks
    //   A_JUN_1 / A_JUN_2 → T-48 fired Jun-10, reviewed Jun-11, approved → spawned June new tasks
    console.log('🤖  Inserting AI recommendations…');

    const aiRecs = [
      // ── Acme May T-48 batch (generated May-10, approved May-11) ───────────────
      {
        id: AI.A_MAY_1, tenantId: T.ACME, meetingId: M.A_MAY, findingId: F.A_MAY_2,
        title: 'Automate IAM service account lifecycle with AWS Identity Center governance rules',
        actionPlan: 'Enable AWS Identity Center access review workflow. Configure quarterly auto-review tasks for all service accounts. Integrate with HR offboarding to auto-flag accounts on employee departure.',
        riskScore: 68, severity: 'high', category: 'Identity & Access Management',
        recommendedOwner: JOHN, recommendedOwnerType: 'CUSTOMER',
        dueDateSuggestion: '2026-06-30', approvalStatus: 'approved',
        approvedBy: SARAH, approvedAt: '2026-05-11 10:00+00', rejectedReason: null,
        generatedAt: '2026-05-10 09:00+00',
        aiModel: 'llama3.2', aiConfidence: 0.8640,
        businessImpact: 'Closes the manual-process gap that allowed 17 accounts to accumulate admin privileges post-project. Automated quarterly reviews prevent recurrence without engineering overhead.',
        remediationStrategy: 'AWS Identity Center Access Reviews + Lambda trigger on HR events. Scope: all service accounts tagged with project lifecycle metadata.',
        correlationId: 'acme-may2026-batch-001',
      },
      {
        id: AI.A_MAY_2, tenantId: T.ACME, meetingId: M.A_MAY, findingId: F.A_MAY_2,
        title: 'Deploy CyberArk Privilege Cloud (SaaS) for privileged session management',
        actionPlan: 'Evaluate CyberArk Privilege Cloud SaaS tier vs BeyondTrust PAM SaaS. Present OpEx cost model to CISO. Run 30-day PoC in lower environment covering admin and service account vaulting.',
        riskScore: 72, severity: 'high', category: 'Identity & Access Management',
        recommendedOwner: SARAH, recommendedOwnerType: 'ACCOUNT_MANAGER',
        dueDateSuggestion: '2026-06-30', approvalStatus: 'approved',
        approvedBy: SARAH, approvedAt: '2026-05-11 10:00+00', rejectedReason: null,
        generatedAt: '2026-05-10 09:00+00',
        aiModel: 'llama3.2', aiConfidence: 0.8310,
        businessImpact: 'SaaS model removes CapEx barrier while closing privileged access gap immediately. Vaulted credentials eliminate direct admin account exposure.',
        remediationStrategy: 'CyberArk Privilege Cloud SaaS — 30-day trial, covers up to 100 privileged accounts. Propose under OpEx budget to bypass the current CapEx freeze at Acme.',
        correlationId: 'acme-may2026-batch-001',
      },
      // ── Acme June T-48 batch (generated Jun-10, approved Jun-11) ──────────────
      {
        id: AI.A_JUN_1, tenantId: T.ACME, meetingId: M.A_JUN, findingId: F.A_JUN_1,
        title: 'Enable SSE-KMS encryption on all legacy S3 buckets via S3 Batch Operations',
        actionPlan: 'Create customer-managed KMS key with appropriate key policy. Enable SSE-KMS as default on all 4 buckets. Run S3 Batch Operations job to re-encrypt existing objects. Enforce deny-unencrypted-PUT via bucket policy.',
        riskScore: 74, severity: 'high', category: 'Data Protection',
        recommendedOwner: JOHN, recommendedOwnerType: 'CUSTOMER',
        dueDateSuggestion: '2026-06-30', approvalStatus: 'approved',
        approvedBy: SARAH, approvedAt: '2026-06-11 10:00+00', rejectedReason: null,
        generatedAt: '2026-06-10 09:00+00',
        aiModel: 'llama3.2', aiConfidence: 0.8820,
        businessImpact: 'Closes PCI-DSS data-at-rest encryption gap before the June-30 compliance deadline. S3 Batch Operations completes re-encryption with zero downtime to existing consumers.',
        remediationStrategy: 'AWS SSE-KMS via S3 Batch Operations. Estimated job time 6–8 hours. KMS key policy to require kms:GenerateDataKey permission for all S3 service principals.',
        correlationId: 'acme-jun2026-batch-001',
      },
      {
        id: AI.A_JUN_2, tenantId: T.ACME, meetingId: M.A_JUN, findingId: F.A_JUN_2,
        title: 'Enforce TLS 1.2 minimum on API Gateway and retire legacy cipher suites',
        actionPlan: 'Set SecurityPolicy to TLS_1_2 on all API Gateway custom domains. Disable TLS_RSA_* cipher suites. Validate with external TLS scanner. Deploy via blue-green for zero-downtime cutover.',
        riskScore: 58, severity: 'medium', category: 'Network Security',
        recommendedOwner: JOHN, recommendedOwnerType: 'CUSTOMER',
        dueDateSuggestion: '2026-06-25', approvalStatus: 'approved',
        approvedBy: SARAH, approvedAt: '2026-06-11 10:00+00', rejectedReason: null,
        generatedAt: '2026-06-10 09:00+00',
        aiModel: 'llama3.2', aiConfidence: 0.8170,
        businessImpact: 'Satisfies PCI-DSS 4.0 requirement 4.2.1 (TLS 1.2+ by June 30, 2026). Eliminates downgrade attack surface on 3 public APIs handling cardholder data.',
        remediationStrategy: 'AWS API Gateway SecurityPolicy TLS_1_2 + blue-green stage swap. External validation via ssllabs.com scan against all 3 affected hostnames post-deployment.',
        correlationId: 'acme-jun2026-batch-001',
      },
    ];

    for (const r of aiRecs) {
      await client.query(`
        INSERT INTO ai_task_recommendations
          (id, tenant_id, meeting_id, finding_id, title, action_plan, risk_reduction_score,
           severity, category, recommended_owner, recommended_owner_type, due_date_suggestion,
           approval_status, approved_by, approved_at, rejected_reason,
           ai_model, ai_confidence, business_impact, remediation_strategy, correlation_id,
           generated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      `, [
        r.id, r.tenantId, r.meetingId, r.findingId, r.title, r.actionPlan, r.riskScore,
        r.severity, r.category, r.recommendedOwner, r.recommendedOwnerType, r.dueDateSuggestion,
        r.approvalStatus, r.approvedBy, r.approvedAt, r.rejectedReason,
        r.aiModel, r.aiConfidence, r.businessImpact, r.remediationStrategy, r.correlationId,
        r.generatedAt,
      ]);
    }

    // ── 11. REPORTS ───────────────────────────────────────────────────────────
    // Reports table is what the Reports Dashboard reads.
    // Includes: 1 monthly summary (May close) + 4 weekly progress reports
    //   (3 × May cycle + 1 × June current week).
    // June monthly report generated when user closes the June meeting.
    // TechNova has no reports yet.
    console.log('📊  Inserting reports…');

    // Monthly summary — Acme May (generated when meeting was closed May-12)
    await client.query(`
      INSERT INTO reports
        (id, tenant_id, meeting_id, report_type, title, summary,
         open_tasks_count, closed_tasks_count, overdue_tasks_count,
         escalated_tasks_count, carry_forward_tasks_count,
         progress_percentage, generated_by, export_payload, generated_at, report_status)
      VALUES
        ($1,$2,$3,'monthly_summary',
         'May Monthly Summary — Acme Financial Services',
         'May-12 review completed. Critical CVE-2026-0421 patched immediately — zero-day to remediation in 27 hours. IAM service account audit underway (40% complete). PAM evaluation escalated after budget stall. 2 tasks carried forward to June cycle. Overall risk posture improved by 14 points.',
         0,1,0,1,2,33,$4,$5,'2026-05-12 16:30+00','published')
    `, [
      RPT.A_MAY, T.ACME, M.A_MAY, SARAH,
      j({
        generatedAt: '2026-05-12T16:30:00Z', version: '1.0',
        tenantName: 'Acme Financial Services', aiRecsGenerated: 2,
        highlights: ['CVE-2026-0421 patched in 27h — critical threat eliminated', 'PAM escalation opened — CISO response required'],
      }),
    ]);

    // Weekly progress reports — Acme May cycle (3 weeks)
    // week 1: May 12-18 — meeting just closed, CVE done, IAM+PAM tasks opened
    await client.query(`
      INSERT INTO reports
        (id, tenant_id, meeting_id, report_type, title, summary,
         open_tasks_count, closed_tasks_count, overdue_tasks_count,
         escalated_tasks_count, carry_forward_tasks_count,
         progress_percentage, week_number, report_period_start, report_period_end,
         generated_by, export_payload, generated_at, report_status)
      VALUES
        ($1,$2,$3,'weekly_progress',
         'Week 1 Progress — May Cycle (May 12–18)',
         'May-12 meeting closed. CVE-2026-0421 emergency hotfix confirmed clean. IAM service account audit and PAM evaluation tasks created and assigned.',
         2,1,0,0,0,33,1,'2026-05-12','2026-05-18',$4,$5,'2026-05-18 07:00+00','published')
    `, [
      RPT.A_MAY_W1, T.ACME, M.A_MAY, SARAH,
      j({ weekStart: '2026-05-12', weekEnd: '2026-05-18', tasksOpen: 2, tasksDone: 1, overallProgress: 33 }),
    ]);

    // week 2: May 19-25 — tasks in progress
    await client.query(`
      INSERT INTO reports
        (id, tenant_id, meeting_id, report_type, title, summary,
         open_tasks_count, closed_tasks_count, overdue_tasks_count,
         escalated_tasks_count, carry_forward_tasks_count,
         progress_percentage, week_number, report_period_start, report_period_end,
         generated_by, export_payload, generated_at, report_status)
      VALUES
        ($1,$2,$3,'weekly_progress',
         'Week 2 Progress — May Cycle (May 19–25)',
         'IAM audit underway — 7 of 17 accounts mapped and approved for removal. PAM vendor comparison done; business case sent to CISO for budget approval. Overall progress improving.',
         2,1,0,0,0,42,2,'2026-05-19','2026-05-25',$4,$5,'2026-05-25 07:00+00','published')
    `, [
      RPT.A_MAY_W2, T.ACME, M.A_MAY, SARAH,
      j({ weekStart: '2026-05-19', weekEnd: '2026-05-25', tasksOpen: 2, tasksDone: 1, overallProgress: 42 }),
    ]);

    // week 3: May 26-Jun 1 — carry-forward decisions, escalation raised
    await client.query(`
      INSERT INTO reports
        (id, tenant_id, meeting_id, report_type, title, summary,
         open_tasks_count, closed_tasks_count, overdue_tasks_count,
         escalated_tasks_count, carry_forward_tasks_count,
         progress_percentage, week_number, report_period_start, report_period_end,
         generated_by, export_payload, generated_at, report_status)
      VALUES
        ($1,$2,$3,'weekly_progress',
         'Week 3 Progress — May Cycle (May 26–Jun 1)',
         'IAM cleanup carried forward — 10 accounts blocked by procurement freeze (40% done). PAM evaluation escalated to CISO office after 3 unanswered follow-ups; also carried forward. 2 tasks move to June cycle.',
         0,1,0,1,2,33,3,'2026-05-26','2026-06-01',$4,$5,'2026-06-01 07:00+00','published')
    `, [
      RPT.A_MAY_W3, T.ACME, M.A_MAY, SARAH,
      j({ weekStart: '2026-05-26', weekEnd: '2026-06-01', carryForward: 2, escalated: 1, overallProgress: 33 }),
    ]);

    // Weekly progress — Acme June cycle, current week (Jun 9-15)
    await client.query(`
      INSERT INTO reports
        (id, tenant_id, meeting_id, report_type, title, summary,
         open_tasks_count, closed_tasks_count, overdue_tasks_count,
         escalated_tasks_count, carry_forward_tasks_count,
         progress_percentage, week_number, report_period_start, report_period_end,
         generated_by, export_payload, generated_at, report_status)
      VALUES
        ($1,$2,$3,'weekly_progress',
         'Week 1 Progress — June Cycle (Jun 9–15)',
         'Jun-12 meeting conducted and awaiting closure. IAM CF×1 at 65% on track. TLS 1.2 staging passed — prod cutover Jun-19. S3 encryption legal review in progress. PAM escalation CF×2 unresolved.',
         3,0,0,1,2,29,1,'2026-06-09','2026-06-15',$4,$5,'2026-06-15 07:00+00','published')
    `, [
      RPT.A_JUN_W1, T.ACME, M.A_JUN, SARAH,
      j({ weekStart: '2026-06-09', weekEnd: '2026-06-15', meetingStatus: 'conducted', pendingClosure: true, overallProgress: 29 }),
    ]);

    // ── 12. WEEKLY REPORTS ────────────────────────────────────────────────────
    // Acme May cycle: 3 weekly reports tracking the 3 May tasks after the May-12 close.
    //   Week May 12-18: tasks just created, CVE already done (emergency hotfix May-9)
    //   Week May 19-25: IAM + PAM in progress, progressing steadily
    //   Week May 26-Jun 1: carry-forward decisions made for both open tasks
    // Acme June cycle: 1 snapshot for current week (Jun 9-15), CONDUCTED state
    // TechNova: no weekly reports (first meeting not yet conducted)
    console.log('📋  Inserting weekly reports…');

    // ── May Week 1: May 12-18 — meeting closed, tasks just kicked off ──────────
    await client.query(`
      INSERT INTO weekly_reports
        (id, tenant_id, meeting_id, week_start, week_end, generated_by, summary, tasks_snapshot)
      VALUES ($1,$2,$3,'2026-05-12','2026-05-18',$4,$5,$6)
    `, [
      WKR.A_MAY_1, T.ACME, M.A_MAY, SARAH,
      j({
        totalTasks: 3, completedTasks: 1, inProgressTasks: 0,
        openTasks: 2, escalatedTasks: 0, overdueTasksCount: 0, overallProgress: 33,
        meetingStatus: 'closed',
        weeklyHighlight: 'May-12 meeting closed. CVE-2026-0421 already patched as emergency hotfix (May-9) — confirmed clean by post-patch scan. IAM cleanup and PAM evaluation tasks created and assigned.',
        weeklyRisk: 'IAM stale accounts still active until audit completes. PAM evaluation requires CISO budget sign-off — no confirmation yet.',
        generatedAt: '2026-05-18T07:00:00Z',
      }),
      j([
        { id: TSK.A_MAY_1, title: 'Patch CVE-2026-0421 on auth-service instances',        status: 'completed',  progress: 100 },
        { id: TSK.A_MAY_2, title: 'Audit and deprovision 17 stale IAM service accounts',  status: 'open',       progress: 0   },
        { id: TSK.A_MAY_3, title: 'Implement PAM solution evaluation and PoC',             status: 'open',       progress: 0   },
      ]),
    ]);

    // ── May Week 2: May 19-25 — tasks in progress ─────────────────────────────
    await client.query(`
      INSERT INTO weekly_reports
        (id, tenant_id, meeting_id, week_start, week_end, generated_by, summary, tasks_snapshot)
      VALUES ($1,$2,$3,'2026-05-19','2026-05-25',$4,$5,$6)
    `, [
      WKR.A_MAY_2, T.ACME, M.A_MAY, SARAH,
      j({
        totalTasks: 3, completedTasks: 1, inProgressTasks: 2,
        openTasks: 0, escalatedTasks: 0, overdueTasksCount: 0, overallProgress: 42,
        meetingStatus: 'closed',
        weeklyHighlight: 'IAM audit underway — 7 of 17 accounts mapped to originating projects and approved for removal. PAM vendor comparison complete (CyberArk vs BeyondTrust); business case drafted and submitted to CISO for budget approval.',
        weeklyRisk: 'CISO has not responded to PAM budget request (submitted May-18). 10 IAM accounts still pending project-owner approval due to procurement freeze.',
        generatedAt: '2026-05-25T07:00:00Z',
      }),
      j([
        { id: TSK.A_MAY_1, title: 'Patch CVE-2026-0421 on auth-service instances',        status: 'completed',   progress: 100 },
        { id: TSK.A_MAY_2, title: 'Audit and deprovision 17 stale IAM service accounts',  status: 'in_progress', progress: 25  },
        { id: TSK.A_MAY_3, title: 'Implement PAM solution evaluation and PoC',             status: 'in_progress', progress: 15  },
      ]),
    ]);

    // ── May Week 3: May 26-Jun 1 — carry-forward decisions, escalation raised ──
    await client.query(`
      INSERT INTO weekly_reports
        (id, tenant_id, meeting_id, week_start, week_end, generated_by, summary, tasks_snapshot)
      VALUES ($1,$2,$3,'2026-05-26','2026-06-01',$4,$5,$6)
    `, [
      WKR.A_MAY_3, T.ACME, M.A_MAY, SARAH,
      j({
        totalTasks: 3, completedTasks: 1, inProgressTasks: 0,
        openTasks: 0, escalatedTasks: 1, carryForwardTasks: 2, overdueTasksCount: 0, overallProgress: 33,
        meetingStatus: 'closed',
        weeklyHighlight: 'IAM task carried forward to June cycle — 10 accounts blocked by procurement freeze on project-owner approvals (40% done). PAM task escalated and carried forward — three follow-ups to CISO with no response.',
        weeklyRisk: 'Both open May tasks now carry-forward to June cycle. PAM escalation formally opened. 17 stale admin accounts — 10 still active.',
        carryForwardCount: 2,
        generatedAt: '2026-06-01T07:00:00Z',
      }),
      j([
        { id: TSK.A_MAY_1, title: 'Patch CVE-2026-0421 on auth-service instances',        status: 'completed',     progress: 100 },
        { id: TSK.A_MAY_2, title: 'Audit and deprovision 17 stale IAM service accounts',  status: 'carry_forward', progress: 40  },
        { id: TSK.A_MAY_3, title: 'Implement PAM solution evaluation and PoC',             status: 'carry_forward', progress: 20  },
      ]),
    ]);

    // ── June Week 1: Jun 9-15 — CONDUCTED meeting, 4 tasks active ─────────────
    await client.query(`
      INSERT INTO weekly_reports
        (id, tenant_id, meeting_id, week_start, week_end, generated_by, summary, tasks_snapshot)
      VALUES ($1,$2,$3,'2026-06-09','2026-06-15',$4,$5,$6)
    `, [
      WKR.A_JUN, T.ACME, M.A_JUN, SARAH,
      j({
        totalTasks: 4, completedTasks: 0, inProgressTasks: 2,
        openTasks: 1, escalatedTasks: 1, overdueTasksCount: 0, overallProgress: 29,
        meetingStatus: 'conducted',
        weeklyHighlight: 'Jun-12 meeting conducted. IAM cleanup at 65% — CF×2 on track for Jun-30. TLS 1.2 staging test passed; prod cutover scheduled Jun-19.',
        weeklyRisk: 'PAM escalation unresolved (CF×3, 3 consecutive meetings with no CISO response). System auto-escalated PAM task to super_admin. S3 encryption legal review in progress. PCI-DSS 4.0 Jun-30 deadline for both S3 and TLS tasks.',
        pendingClosure: true,
        carryForwardTotal: 2,
        escalatedTotal: 1,
        overdueTotal: 0,
        generatedAt: '2026-06-15T07:00:00Z',
      }),
      j([
        { id: TSK.A_JUN_CF1, title: 'Audit & deprovision stale IAM accounts (CF×2)', status: 'in_progress', progress: 65, carryForwardCount: 2 },
        { id: TSK.A_JUN_CF2, title: 'PAM solution evaluation & PoC (CF×3)',           status: 'escalated',   progress: 20, carryForwardCount: 3 },
        { id: TSK.A_JUN_1,   title: 'Enable KMS encryption on 4 legacy S3 buckets',  status: 'open',        progress: 0  },
        { id: TSK.A_JUN_2,   title: 'Enforce TLS 1.2+ on public API endpoints',       status: 'in_progress', progress: 30 },
      ]),
    ]);

    // ── 13. MEETING INVITATIONS ───────────────────────────────────────────────
    // Acme Jun-12: invitations sent when meeting was auto-generated on May-12 (at close).
    // TechNova Jul-01: invitations sent June 2 when meeting was created on onboarding.
    console.log('📨  Inserting meeting invitations…');
    const invitations = [
      // Acme June — conducted (invitations sent May-12 when meeting was auto-generated)
      [M.A_JUN, T.ACME, JOHN,                                  'John Smith',           'attendee',  'sent', '2026-05-12 16:30+00'],
      [M.A_JUN, T.ACME, SARAH,                                 'Sarah Johnson',         'organizer', 'sent', '2026-05-12 16:30+00'],
      [M.A_JUN, T.ACME, 'finance.compliance@acmefinancial.com', 'Finance Compliance',   'observer',  'sent', '2026-05-12 16:30+00'],
      // TechNova July — scheduled (invitations sent June 2 on onboarding)
      [M.T_JUL, T.TECH, PRIYA,                                 'Priya Patel',           'attendee',  'sent',    '2026-06-02 09:00+00'],
      [M.T_JUL, T.TECH, MICHAEL,                               'Michael Chen',          'organizer', 'sent',    '2026-06-02 09:00+00'],
      [M.T_JUL, T.TECH, 'security.ops@technovasolutions.com',  'Security Ops Team',     'observer',  'pending', null],
    ];

    for (const [meetingId, tenantId, email, name, recipientType, status, sentAt] of invitations) {
      await client.query(`
        INSERT INTO meeting_invitations
          (meeting_id, tenant_id, recipient_email, recipient_name, recipient_type, status, sent_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [meetingId, tenantId, email, name, recipientType, status, sentAt]);
    }

    // ── 14. CALENDAR CONNECTIONS ──────────────────────────────────────────────
    // Both tenants are connected to Microsoft 365 / Teams.
    // Placeholder encrypted tokens let the UI show "Connected" for demo purposes.
    // Real tokens are issued only after a live OAuth flow — the placeholders will
    // fail gracefully on any actual Graph API call.
    console.log('📆  Inserting calendar connections…');
    const acmeAccessEnc   = encryptToken('seed_placeholder_access_token_acme');
    const acmeRefreshEnc  = encryptToken('seed_placeholder_refresh_token_acme');
    const techAccessEnc   = encryptToken('seed_placeholder_access_token_tech');
    const techRefreshEnc  = encryptToken('seed_placeholder_refresh_token_tech');
    // user_id (migration 036): token is keyed to the AM user so all their tenants
    // share one connection row — U.AM1 = sarah (Acme), U.AM2 = michael (TechNova).
    await client.query(`
      INSERT INTO calendar_connections
        (id, tenant_id, user_id, provider, connected_email, status, scopes, connected_at, last_used_at,
         ms_user_id, access_token_enc, refresh_token_enc, token_expires_at, last_verified_at)
      VALUES
        ($1,$3,$11,'microsoft',$5,'connected',
         '["Calendars.Read","OnlineMeetings.Read","offline_access","User.Read"]'::jsonb,
         '2026-04-01 09:00+00','2026-06-10 09:00+00',
         'demo_ms_user_acme',$7,$8,'2030-01-01 00:00+00','2026-06-10 09:00+00'),
        ($2,$4,$12,'microsoft',$6,'connected',
         '["Calendars.ReadWrite","OnlineMeetings.ReadWrite"]'::jsonb,
         '2026-06-01 09:00+00','2026-06-02 09:00+00',
         'demo_ms_user_tech',$9,$10,'2030-01-01 00:00+00','2026-06-02 09:00+00')
    `, [CALCONN.ACME, CALCONN.TECH, T.ACME, T.TECH, SARAH, MICHAEL,
        acmeAccessEnc, acmeRefreshEnc, techAccessEnc, techRefreshEnc,
        U.AM1, U.AM2]);

    // ── 15. CALENDAR SYNC LOGS ────────────────────────────────────────────────
    // Only include meaningful sync events; no noise.
    console.log('🔄  Inserting calendar sync logs…');
    const syncLogs = [
      // Acme — T-48 NXG360 sync for May-12 meeting (fired May-10)
      [SL.A_MAY_T48, T.ACME, M.A_MAY, CALCONN.ACME, 'microsoft', 'sync', 'completed',
       j({ trigger: 't48_workflow', findingsAttached: 2, agendaUpdated: true, meetingId: M.A_MAY }),
       '2026-05-10 08:58+00', '2026-05-10 09:02+00', '2026-05-10 08:58+00'],
      // Acme — 7-day reminder for June-12 meeting (sent June 5)
      [SL.A_JUN_REM7, T.ACME, M.A_JUN, CALCONN.ACME, 'microsoft', 'reminder', 'completed',
       j({ reminderType: '7d', recipientCount: 3, deliveredCount: 3 }),
       '2026-06-05 09:00+00', '2026-06-05 09:01+00', '2026-06-05 09:00+00'],
      // Acme — T-48 NXG360 sync for June-12 meeting (fired June-10)
      [SL.A_JUN_T48, T.ACME, M.A_JUN, CALCONN.ACME, 'microsoft', 'sync', 'completed',
       j({ trigger: 't48_workflow', findingsAttached: 2, agendaUpdated: true, meetingId: M.A_JUN }),
       '2026-06-10 08:58+00', '2026-06-10 09:04+00', '2026-06-10 08:58+00'],
      // TechNova — invitation sync when July-01 meeting was created (June 2)
      [SL.T_JUL_INV, T.TECH, M.T_JUL, CALCONN.TECH, 'microsoft', 'invitation', 'completed',
       j({ recipients: [PRIYA, MICHAEL, 'security.ops@technovasolutions.com'], count: 3, calendarEventId: 'msft_evt_tech_jul01_2026' }),
       '2026-06-02 08:58+00', '2026-06-02 09:00+00', '2026-06-02 08:58+00'],
    ];

    for (const [id, tenantId, meetingId, connId, provider, syncType, syncStatus, payload, startedAt, completedAt, createdAt] of syncLogs) {
      await client.query(`
        INSERT INTO calendar_sync_logs
          (id, tenant_id, meeting_id, connection_id, provider, sync_type, sync_status,
           payload, started_at, completed_at, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [id, tenantId, meetingId, connId, provider, syncType, syncStatus, payload, startedAt, completedAt, createdAt]);
    }

    // ── 16. PROVIDER CONNECTIONS ──────────────────────────────────────────────
    console.log('🔌  Inserting provider connections…');
    const providerConns = [
      [T.ACME, 'MANUAL',         'Manual Entry',    'connected'],
      [T.ACME, 'UPLOAD',         'File Upload',      'connected'],
      [T.TECH, 'MANUAL',         'Manual Entry',    'connected'],
      [T.TECH, 'MICROSOFT_TEAMS','Microsoft Teams', 'pending'],
    ];
    for (const [tenantId, type, name, status] of providerConns) {
      await client.query(`
        INSERT INTO provider_connections (tenant_id, provider_type, provider_name, connection_status)
        VALUES ($1,$2,$3,$4)
      `, [tenantId, type, name, status]);
    }

    // ── 17. NXG360 CONNECTIONS ────────────────────────────────────────────────
    // Acme:     last_synced = Jun-10 (T-48 for Jun-12 meeting)
    // TechNova: last_synced = Jun-01 (connection test on onboarding day)
    //           First real T-48 sync fires Jun-29 (T-48 for Jul-01 meeting).
    console.log('🛡️   Inserting NXG360 connections…');
    await client.query(`
      INSERT INTO nxg360_connections
        (tenant_id, api_endpoint, workspace_id, connection_type, status,
         last_synced_at, sync_metadata)
      VALUES
        ($1,'https://nxg360.nxgsecure.com/api','acme-ws-001','api_key','connected',
         '2026-06-10 09:00+00',$3),
        ($2,'https://nxg360.nxgsecure.com/api','tech-ws-002','api_key','connected',
         '2026-06-01 09:00+00',$4)
    `, [
      T.ACME, T.TECH,
      j({ lastFindingCount: 2, lastSyncDurationMs: 1104, syncStatus: 'success', triggeredBy: 't48_scheduler', meetingId: M.A_JUN }),
      j({ lastFindingCount: 0, lastSyncDurationMs: 620,  syncStatus: 'success', triggeredBy: 'onboarding_test', meetingId: null }),
    ]);

    // ── 18. NOTIFICATIONS ─────────────────────────────────────────────────────
    // Demonstrates the full carry-forward warning → alert → auto-escalation pipeline.
    //
    //   NOTIF.CF_WARN_1    carry_forward_warning  → AM (Sarah)
    //                       IAM task (CF×2) fired when May cycle closed with count=2
    //   NOTIF.CF_ALERT_1   carry_forward_alert    → AM (Sarah)
    //                       PAM task (CF×3) fired when June cycle closed with count=3
    //   NOTIF.ESC_ASSIGN_1 auto_escalation_assigned → Super Admin (admin@bmmj.com)
    //                       PAM task — ACCOUNT_MANAGER owned → routes UP to super_admin
    //   NOTIF.ESC_NOTICE_1 auto_escalation_notice  → AM (Sarah)
    //                       AM informed their task was escalated to management
    //   NOTIF.WKR_GEN_1    weekly_report_generated → AM (Sarah)
    //                       Monday auto-job for June week 1 (Jun 9-15)
    //
    // Skipped silently if migration 024_notifications.sql has not yet been run.
    if (hasNotifications) {
      console.log('🔔  Inserting notifications…');
      const notifications = [
        // ── carry_forward_warning — IAM task (CF×2) → AM ────────────────────────
        [
          NOTIF.CF_WARN_1,
          T.ACME, TSK.A_JUN_CF1, M.A_JUN,
          'carry_forward_warning', 'ACCOUNT_MANAGER', SARAH,
          '⚠️ Task carried forward twice — action needed: "Audit and deprovision 17 stale IAM service accounts"',
          'This CUSTOMER-owned task has been carried forward for the 2nd time without resolution. Please review before the next meeting to avoid auto-escalation at CF×3.',
          j({ carryForwardCount: 2, ownerType: 'CUSTOMER', ownerEmail: JOHN, priority: 'high' }),
          'delivered', '2026-05-28 16:35+00', '2026-05-28 16:35+00',
        ],
        // ── carry_forward_alert — PAM task (CF×3) → AM ──────────────────────────
        [
          NOTIF.CF_ALERT_1,
          T.ACME, TSK.A_JUN_CF2, M.A_JUN,
          'carry_forward_alert', 'ACCOUNT_MANAGER', SARAH,
          '🚨 Task carried forward 3 times — auto-escalation triggered: "Implement Privileged Access Management (PAM) solution evaluation and PoC"',
          'This ACCOUNT_MANAGER-owned task has been carried forward 3 consecutive meetings without resolution. Auto-escalation has been sent to management.',
          j({ carryForwardCount: 3, ownerType: 'ACCOUNT_MANAGER', ownerEmail: SARAH, priority: 'high' }),
          'delivered', '2026-06-12 16:40+00', '2026-06-12 16:40+00',
        ],
        // ── auto_escalation_assigned — PAM task → Super Admin ───────────────────
        [
          NOTIF.ESC_ASSIGN_1,
          T.ACME, TSK.A_JUN_CF2, null,
          'auto_escalation_assigned', 'SUPER_ADMIN', ADMIN,
          '🚨 Escalation assigned — AM-owned task carried forward 3 times: "Implement Privileged Access Management (PAM) solution evaluation and PoC"',
          'An Account Manager-owned task was auto-escalated to management after 3 consecutive carry-forwards with no resolution. Customer: Acme Financial Services. AM: Sarah Johnson. Immediate review required.',
          j({ carryForwardCount: 3, ownerType: 'ACCOUNT_MANAGER', ownerEmail: SARAH, amEmail: SARAH, tenantName: 'Acme Financial Services', escalatedBy: 'system@bmmj.internal' }),
          'delivered', '2026-06-15 02:00+00', '2026-06-15 02:00+00',
        ],
        // ── auto_escalation_notice — PAM task → AM (informed) ───────────────────
        [
          NOTIF.ESC_NOTICE_1,
          T.ACME, TSK.A_JUN_CF2, null,
          'auto_escalation_notice', 'ACCOUNT_MANAGER', SARAH,
          'Your task has been escalated to management: "Implement Privileged Access Management (PAM) solution evaluation and PoC"',
          'This task was auto-escalated to the super admin after 3 carry-forwards without resolution. Management has been notified and will follow up.',
          j({ carryForwardCount: 3, ownerType: 'ACCOUNT_MANAGER', escalatedTo: ADMIN, escalatedBy: 'system@bmmj.internal' }),
          'delivered', '2026-06-15 02:00+00', '2026-06-15 02:00+00',
        ],
        // ── weekly_report_generated — June cycle → AM ────────────────────────────
        [
          NOTIF.WKR_GEN_1,
          T.ACME, null, M.A_JUN,
          'weekly_report_generated', 'ACCOUNT_MANAGER', SARAH,
          'Weekly progress report generated — Acme Financial Services (Jun 9–15)',
          'Carry-forward: 2 | Escalated: 1 | Overdue: 0 | Overall progress: 29%',
          j({ reportId: WKR.A_JUN, weekStart: '2026-06-09', weekEnd: '2026-06-15', summary: { carryForwardTotal: 2, escalatedTotal: 1, overdueTotal: 0, overallProgress: 29 } }),
          'delivered', '2026-06-15 08:05+00', '2026-06-15 08:00+00',
        ],
      ];

      for (const [id, tenantId, taskId, meetingId, type, recipientRole, recipientEmail, title, body, payload, status, deliveredAt, createdAt] of notifications) {
        await client.query(`
          INSERT INTO notifications
            (id, tenant_id, task_id, meeting_id, type, recipient_role, recipient_email,
             title, body, payload, status, delivered_at, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `, [id, tenantId, taskId, meetingId, type, recipientRole, recipientEmail, title, body, payload, status, deliveredAt, createdAt]);
      }
    } else {
      console.log('⏭️   Notifications table not found (migration 024 pending) — skipping notification seed.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    await client.query('COMMIT');

    console.log('');
    console.log('✅  Seed complete!');
    console.log('');
    console.log('  ┌─ ACME FINANCIAL SERVICES ──────────────────────────────────────────────┐');
    console.log('  │  May-12 meeting  : CLOSED    (full lifecycle — notes, report, tasks)    │');
    console.log('  │  Jun-12 meeting  : CONDUCTED (T-48 Jun-10 ✓, awaiting closure)         │');
    console.log('  │  Jul-12 meeting  : not yet seeded — auto-generates on Jun close        │');
    console.log('  │  Findings        : 4  (2 from May, 2 from June)                       │');
    console.log('  │  Tasks           : 7  (3 May + 4 June [CF×2 + CF×3 + 2 new])         │');
    console.log('  │  AI Recs         : 4  (all approved)                                  │');
    console.log('  │  Escalations     : 1  (PAM budget — manual by Sarah, status open)      │');
    console.log('  │  Reports         : 5  (1 monthly summary + 3 May weekly + 1 Jun weekly)│');
    console.log('  │  Weekly Reports  : 4  (3 × May cycle + 1 × Jun current week)         │');
    console.log('  │  Notifications   : 5  (CF×2 warning, CF×3 alert, 2 escalation,        │');
    console.log('  │                        1 weekly report) — skipped if mig-024 pending   │');
    console.log('  │                                                                        │');
    console.log('  │  📬 NOTIFICATION PIPELINE DEMO (Acme):                                │');
    console.log('  │    IAM task  (CF×2, CUSTOMER)       → ⚠️  carry_forward_warning → Sarah│');
    console.log('  │    PAM task  (CF×3, ACCT_MGR)       → 🚨 carry_forward_alert   → Sarah│');
    console.log('  │    PAM task  auto-escalated          → 🚨 assigned  → admin@bmmj.com  │');
    console.log('  │    PAM task  auto-escalated          → 📬 notice    → Sarah            │');
    console.log('  │    Jun weekly report generated       → 📋 report    → Sarah            │');
    console.log('  └────────────────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('  ┌─ TECHNOVA SOLUTIONS ───────────────────────────────────────────────┐');
    console.log('  │  Jul-01 meeting  : SCHEDULED (first ever — onboarded Jun-01)       │');
    console.log('  │  T-48 trigger    : Jun-29 (fires in 14 days)                       │');
    console.log('  │  Findings        : 0  (T-48 not yet fired)                        │');
    console.log('  │  Tasks           : 0                                               │');
    console.log('  │  AI Recs         : 0                                               │');
    console.log('  └───────────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('  Login password: Seed@Demo2026');
    console.log('  admin@bmmj.com          → super_admin');
    console.log('  sarah.johnson@bmmj.com  → Acme Financial Services');
    console.log('  michael.chen@bmmj.com   → TechNova Solutions');
    console.log('');
    console.log('  ▶  To close the June meeting and auto-schedule July:');
    console.log('     Login as sarah → Meetings → June Monthly Review → Close Meeting');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('');
    console.error('❌  Seed FAILED — transaction rolled back.');
    console.error('    Error:', err.message);
    if (err.detail) console.error('    Detail:', err.detail);
    if (err.hint)   console.error('    Hint:',   err.hint);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
