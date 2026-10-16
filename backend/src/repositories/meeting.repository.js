const db              = require('../config/db');
const logger          = require('../utils/logger');
const FindingsProvider = require('../services/ai/FindingsProvider');

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
  rescheduleCount:   row.rescheduleCount   || 0,
  rescheduleHistory: row.rescheduleHistory || [],
  createdBy:         row.createdBy         || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  // Phase 11 — Microsoft / Calendly booking fields (null-safe; columns added by migration 030)
  bookingPending:       row.bookingPending       ?? false,
  bookingLinkSentAt:    row.bookingLinkSentAt    || null,
  customerContactEmail: row.customerContactEmail || null,
  customerContactName:  row.customerContactName  || null,
  msEventId:            row.msEventId            || null,
  teamsJoinUrl:         row.teamsJoinUrl         || null,
  teamsMeetingId:       row.teamsMeetingId       || null,
  transcriptStatus:     row.transcriptStatus     || 'not_started',
  transcriptText:       row.transcriptText       || null,
  transcriptFetchedAt:   row.transcriptFetchedAt   || null,
  firefliesTranscriptId: row.firefliesTranscriptId || null,
  calendarCancelledAt:   row.calendarCancelledAt   || null,
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
  findingId: row.findingId,
  tenantId: row.tenantId,
  title: row.title,
  actionPlan: row.actionPlan,
  riskReductionScore: row.riskReductionScore,
  approvalStatus: row.approvalStatus,
  remediationStatus: row.remediationStatus,
  status: row.remediationStatus,
  ownershipTeam: row.ownershipTeam,
  ownerName: row.ownerName,
  ownerType: row.ownerType,
  priority: row.priority,
  dueDate: row.dueDate,
  progressPercentage: row.progressPercentage || 0,
  carryForwardCount: row.carryForwardCount || 0,
  escalationCount: row.escalationCount || 0,
  meetingTimeline: row.meetingTimeline,
  primaryOwner: row.primaryOwner || {},
  secondaryOwner: row.secondaryOwner || {},
  timeline: row.timeline || [],
  notes: row.notes,
  lastUpdatedDate: row.lastUpdatedAt || row.createdAt,
  createdAt: row.createdAt,
  customerName: row.customerName,
  sourceFindingId: row.sourceFindingId,
  severity: row.severity,
  category: row.category,
  systemAffected: row.systemAffected
});

const defaultOwner = (tenantName, accountManager) => ({
  id: `owner-${tenantName.replace(/\s+/g, '-').toLowerCase()}`,
  name: accountManager || 'Account Manager',
  role: 'Account Manager',
  email: accountManager ? `${accountManager.toLowerCase().replace(/\s+/g, '.')}@bmmj.com` : 'manager@bmmj.com',
  avatar: accountManager
    ? accountManager.split(' ').map((part) => part[0]).join('').slice(0, 2)
    : 'AM'
});

const defaultSecondaryOwner = (tenantName) => ({
  id: `customer-${tenantName.replace(/\s+/g, '-').toLowerCase()}`,
  name: `${tenantName} Security Lead`,
  role: 'Customer Security Lead',
  email: `security@${tenantName.toLowerCase().replace(/\s+/g, '')}.com`,
  avatar: tenantName.split(' ').map((part) => part[0]).join('').slice(0, 2)
});

// ── Recurrence helpers ────────────────────────────────────────────────────────

/**
 * Given the scheduledStart of the most-recent meeting and a recurrence pattern,
 * return the Date for the next occurrence.  Always applies the config's meeting_time.
 */
/**
 * Add N months to a date, clamping to the last day of the target month.
 * e.g. Jan 31 + 1 month → Feb 28/29 (not Mar 2/3).
 */
function addMonthsClamped(date, n) {
  const originalDay = date.getDate();
  const targetMonth = date.getMonth() + n;
  // Use day=0 trick: day 0 of (month+1) is the last day of month
  const lastDayOfTarget = new Date(date.getFullYear(), targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(originalDay, lastDayOfTarget);
  return new Date(date.getFullYear(), targetMonth, clampedDay,
                  date.getHours(), date.getMinutes(), 0, 0);
}

function computeNextDate(fromDate, pattern, meetingTime) {
  const [hours, minutes] = (meetingTime || '10:00').split(':').map(Number);
  const base = new Date(fromDate);
  base.setHours(hours, minutes, 0, 0);

  switch (pattern) {
    case 'weekly':
      base.setDate(base.getDate() + 7);
      return base;
    case 'biweekly':
      base.setDate(base.getDate() + 14);
      return base;
    case 'quarterly':
      return addMonthsClamped(base, 3);
    case 'monthly_day_of_week': {
      const dayOfWeek      = base.getDay();
      const weekOccurrence = Math.ceil(base.getDate() / 7);
      const targetMonth    = base.getMonth() + 1;
      const targetYear     = base.getMonth() === 11 ? base.getFullYear() + 1 : base.getFullYear();
      // Find first occurrence of dayOfWeek in target month
      const first = new Date(targetYear, targetMonth % 12, 1, hours, minutes, 0, 0);
      while (first.getDay() !== dayOfWeek) first.setDate(first.getDate() + 1);
      // Advance to Nth occurrence
      first.setDate(first.getDate() + (weekOccurrence - 1) * 7);
      // If 5th occurrence overflowed into next month, fall back to 4th
      if (first.getMonth() !== targetMonth % 12) first.setDate(first.getDate() - 7);
      return first;
    }
    case 'monthly':
    case 'monthly_day_of_month':
    default:
      return addMonthsClamped(base, 1);
  }
}

// Derive the next meeting title from the closed meeting's title by swapping the month/year.
// Preserves whatever naming format the original title used (e.g. "May 2026 — Security Review"
// becomes "June 2026 — Security Review"; "May Monthly Review — Acme" becomes "June Monthly Review — Acme").
function deriveNextTitle(closedTitle, baseDate) {
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const nextMonth = MONTHS[baseDate.getMonth()];
  const nextYear  = String(baseDate.getFullYear());
  for (const month of MONTHS) {
    if (closedTitle.includes(month)) {
      let t = closedTitle.replace(month, nextMonth);
      t = t.replace(/\b20\d{2}\b/, nextYear);
      return t;
    }
  }
  return closedTitle;
}

const meetingRepository = {
  findAll: async (tenantId = null) => {
    const MS_COLS = `booking_pending AS "bookingPending",
               booking_link_sent_at AS "bookingLinkSentAt",
               customer_contact_email AS "customerContactEmail",
               customer_contact_name AS "customerContactName",
               ms_event_id AS "msEventId",
               teams_join_url AS "teamsJoinUrl",
               teams_meeting_id AS "teamsMeetingId",
               transcript_status AS "transcriptStatus",
               transcript_text AS "transcriptText",
               transcript_fetched_at AS "transcriptFetchedAt",
               fireflies_transcript_id AS "firefliesTranscriptId",
               calendar_cancelled_at AS "calendarCancelledAt"`;
    const query = tenantId
      ? `SELECT id,
               tenant_id AS "tenantId",
               meeting_config_id AS "meetingConfigId",
               scheduled_start AS "scheduledStart",
               scheduled_end AS "scheduledEnd",
               meeting_type AS "meetingType",
               meeting_duration_minutes AS "meetingDurationMinutes",
               calendar_event_id AS "calendarEventId",
               status,
               trigger_date AS "triggerDate",
               title,
               provider,
               meeting_notes AS "meetingNotes",
               attendees,
               reschedule_request AS "rescheduleRequest",
               created_at AS "createdAt",
               updated_at AS "updatedAt",
               ${MS_COLS}
         FROM meetings
         WHERE tenant_id = $1
         ORDER BY scheduled_start DESC`
      : `SELECT id,
               tenant_id AS "tenantId",
               meeting_config_id AS "meetingConfigId",
               scheduled_start AS "scheduledStart",
               scheduled_end AS "scheduledEnd",
               meeting_type AS "meetingType",
               meeting_duration_minutes AS "meetingDurationMinutes",
               calendar_event_id AS "calendarEventId",
               status,
               trigger_date AS "triggerDate",
               title,
               provider,
               meeting_notes AS "meetingNotes",
               attendees,
               reschedule_request AS "rescheduleRequest",
               created_at AS "createdAt",
               updated_at AS "updatedAt",
               ${MS_COLS}
         FROM meetings
         ORDER BY scheduled_start DESC`;

    const { rows } = tenantId ? await db.query(query, [tenantId]) : await db.query(query);
    return rows.map(mapMeetingRow);
  },

  findById: async (id, tenantId = null) => {
    const MS_COLS = `booking_pending AS "bookingPending",
               booking_link_sent_at AS "bookingLinkSentAt",
               customer_contact_email AS "customerContactEmail",
               customer_contact_name AS "customerContactName",
               ms_event_id AS "msEventId",
               teams_join_url AS "teamsJoinUrl",
               teams_meeting_id AS "teamsMeetingId",
               transcript_status AS "transcriptStatus",
               transcript_text AS "transcriptText",
               transcript_fetched_at AS "transcriptFetchedAt",
               fireflies_transcript_id AS "firefliesTranscriptId",
               calendar_cancelled_at AS "calendarCancelledAt"`;
    const query = tenantId
      ? `SELECT id,
               tenant_id AS "tenantId",
               meeting_config_id AS "meetingConfigId",
               scheduled_start AS "scheduledStart",
               scheduled_end AS "scheduledEnd",
               meeting_type AS "meetingType",
               meeting_duration_minutes AS "meetingDurationMinutes",
               calendar_event_id AS "calendarEventId",
               status,
               trigger_date AS "triggerDate",
               title,
               provider,
               meeting_notes AS "meetingNotes",
               attendees,
               reschedule_request AS "rescheduleRequest",
               created_at AS "createdAt",
               updated_at AS "updatedAt",
               ${MS_COLS}
         FROM meetings
         WHERE id = $1 AND tenant_id = $2`
      : `SELECT id,
               tenant_id AS "tenantId",
               meeting_config_id AS "meetingConfigId",
               scheduled_start AS "scheduledStart",
               scheduled_end AS "scheduledEnd",
               meeting_type AS "meetingType",
               meeting_duration_minutes AS "meetingDurationMinutes",
               calendar_event_id AS "calendarEventId",
               status,
               trigger_date AS "triggerDate",
               title,
               provider,
               meeting_notes AS "meetingNotes",
               attendees,
               reschedule_request AS "rescheduleRequest",
               created_at AS "createdAt",
               updated_at AS "updatedAt",
               ${MS_COLS}
         FROM meetings
         WHERE id = $1`;

    const { rows } = tenantId ? await db.query(query, [id, tenantId]) : await db.query(query, [id]);
    return rows[0] ? mapMeetingRow(rows[0]) : null;
  },

  createConfig: async (configData) => {
    const {
      tenantId, meetingTime, timezone, recurrencePattern,
      customerContactEmail  = null,
      customerContactName   = null,
      additionalParticipants = [],
    } = configData;
    // firstMeetingDate is optional — default to today so the meeting row is created
    // immediately with booking_pending=TRUE; actual date is set when the customer books.
    const firstMeetingDate = configData.firstMeetingDate
      || new Date().toISOString().slice(0, 10);

    const { rows } = await db.query(
      `INSERT INTO meeting_configs (tenant_id, first_meeting_date, meeting_time, timezone, recurrence_pattern)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, firstMeetingDate, meetingTime, timezone, recurrencePattern]
    );

    const config = rows[0];
    const meeting = await meetingRepository.generateMeetingForConfig(config, {
      bookingPending:        !!customerContactEmail,
      customerContactEmail:  customerContactEmail,
      customerContactName:   customerContactName,
      additionalParticipants,
    });
    logger.info(`Saved meeting config for tenant: ${tenantId}`);
    return { config, meeting };
  },

  generateMeetingForConfig: async (config, opts = {}) => {
    const {
      bookingPending         = false,
      customerContactEmail   = null,
      customerContactName    = null,
      additionalParticipants = [],
    } = opts;
    const bookingLinkSentAt = bookingPending ? new Date().toISOString() : null;
    // Build attendees: customer email first (role=primary) so reminder emails reach them,
    // followed by any additional CC participants.
    const attendees = [
      ...(customerContactEmail
        ? [{ email: customerContactEmail, name: customerContactName || '', role: 'primary' }]
        : []),
      ...additionalParticipants.map((email) => ({ email, name: '', role: 'participant' })),
    ];

    const firstMeetingDate = typeof config.first_meeting_date === 'string'
      ? config.first_meeting_date
      : new Date(config.first_meeting_date).toISOString().slice(0, 10);
    const baseDate = new Date(`${firstMeetingDate}T${config.meeting_time}`);
    const triggerDate = new Date(baseDate);
    triggerDate.setHours(triggerDate.getHours() - 48);

    const { rows: tenantRows } = await db.query(
      `SELECT id, name, account_manager AS "accountManager" FROM customers WHERE id = $1 LIMIT 1`,
      [config.tenant_id]
    );
    const tenant = tenantRows[0] || { id: config.tenant_id, name: `Tenant ${config.tenant_id}`, accountManager: 'Account Manager' };
    const MONTHS_GEN = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    const title = `${MONTHS_GEN[baseDate.getMonth()]} Monthly Review — ${tenant.name}`;

    const { rows } = await db.query(
      `INSERT INTO meetings (
         tenant_id, meeting_config_id, scheduled_start, scheduled_end, meeting_type, meeting_duration_minutes,
         calendar_event_id, status, trigger_date, title, provider, attendees,
         booking_pending, customer_contact_email, customer_contact_name, booking_link_sent_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id,
                 tenant_id AS "tenantId",
                 meeting_config_id AS "meetingConfigId",
                 scheduled_start AS "scheduledStart",
                 scheduled_end AS "scheduledEnd",
                 meeting_type AS "meetingType",
                 meeting_duration_minutes AS "meetingDurationMinutes",
                 calendar_event_id AS "calendarEventId",
                 status,
                 trigger_date AS "triggerDate",
                 title,
                 provider,
                 attendees,
                 reschedule_request AS "rescheduleRequest",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt",
                 booking_pending AS "bookingPending",
                 booking_link_sent_at AS "bookingLinkSentAt",
                 customer_contact_email AS "customerContactEmail",
                 customer_contact_name AS "customerContactName"`,
      [
        config.tenant_id,
        config.id,
        baseDate.toISOString(),
        new Date(baseDate.getTime() + 60 * 60 * 1000).toISOString(),
        'monthly_review',
        60,
        `ms_evt_${Math.floor(Math.random() * 10000000)}`,
        'scheduled',
        triggerDate.toISOString(),
        title,
        'microsoft',
        JSON.stringify(attendees),
        bookingPending,
        customerContactEmail,
        customerContactName,
        bookingLinkSentAt,
      ]
    );

    const meeting = mapMeetingRow(rows[0]);
    await meetingRepository.generateFindingsAndTasks(meeting.id, tenant);
    return meeting;
  },

  generateNextMeetingForClosedMeeting: async (meeting) => {
    // Only auto-schedule when a recurring config exists
    if (!meeting.meetingConfigId) {
      logger.info('Skip auto-schedule: no meeting config', { meetingId: meeting.id });
      return null;
    }

    // Fetch config to honour recurrence_pattern and canonical meeting_time
    const { rows: configRows } = await db.query(
      `SELECT recurrence_pattern, meeting_time, timezone
       FROM meeting_configs WHERE id = $1 LIMIT 1`,
      [meeting.meetingConfigId]
    );
    if (!configRows[0]) {
      logger.warn('Skip auto-schedule: config not found', { configId: meeting.meetingConfigId });
      return null;
    }
    const config = configRows[0];

    const baseDate    = computeNextDate(
      new Date(meeting.scheduledStart),
      config.recurrence_pattern || 'monthly',
      config.meeting_time       || '10:00'
    );
    const triggerDate = new Date(baseDate);
    triggerDate.setHours(triggerDate.getHours() - 48);

    // Guard: skip if ANY non-closed meeting for this tenant falls within ±3 days
    // of baseDate — tenant-scoped so meetings from sibling configs are also detected.
    const windowStart = new Date(baseDate.getTime() - 3 * 24 * 60 * 60 * 1000);
    const windowEnd   = new Date(baseDate.getTime() + 3 * 24 * 60 * 60 * 1000);
    const { rows: existing } = await db.query(
      `SELECT id FROM meetings
       WHERE tenant_id       = $1
         AND scheduled_start BETWEEN $2 AND $3
         AND status          != 'closed'
       LIMIT 1`,
      [meeting.tenantId, windowStart.toISOString(), windowEnd.toISOString()]
    );
    if (existing.length > 0) {
      logger.info('Skip auto-schedule: meeting already exists near target date', {
        tenantId: meeting.tenantId,
        configId: meeting.meetingConfigId,
        existingId: existing[0].id,
      });
      return null;
    }

    // Derive the next title from the closed meeting's own title (preserves naming format)
    const title = deriveNextTitle(meeting.title || '', baseDate);

    let rows;
    try {
      ({ rows } = await db.query(
        `INSERT INTO meetings (
           tenant_id, meeting_config_id, scheduled_start, scheduled_end, meeting_type, meeting_duration_minutes,
           calendar_event_id, status, trigger_date, title, provider, attendees
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id,
                   tenant_id AS "tenantId",
                   meeting_config_id AS "meetingConfigId",
                   scheduled_start AS "scheduledStart",
                   scheduled_end AS "scheduledEnd",
                   meeting_type AS "meetingType",
                   meeting_duration_minutes AS "meetingDurationMinutes",
                   calendar_event_id AS "calendarEventId",
                   status,
                   trigger_date AS "triggerDate",
                   title,
                   provider,
                   attendees,
                   reschedule_request AS "rescheduleRequest",
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [
          meeting.tenantId,
          meeting.meetingConfigId,
          baseDate.toISOString(),
          new Date(baseDate.getTime() + 60 * 60 * 1000).toISOString(),
          meeting.meetingType || 'monthly_review',
          meeting.meetingDurationMinutes || 60,
          `ms_evt_${Math.floor(Math.random() * 10000000)}`,
          'scheduled',
          triggerDate.toISOString(),
          title,
          meeting.provider,
          JSON.stringify(meeting.attendees || [])
        ]
      ));
    } catch (insertErr) {
      // DB constraint: a meeting for this tenant+config already exists in the same
      // calendar month. Treat it the same as the ±3-day guard above — skip silently
      // so the closeMeeting operation still succeeds.
      if (insertErr.message && insertErr.message.includes('DUPLICATE_MEETING')) {
        logger.warn('Skip auto-schedule: DB duplicate-meeting constraint fired', {
          tenantId:  meeting.tenantId,
          configId:  meeting.meetingConfigId,
          targetDate: baseDate.toISOString(),
        });
        return null;
      }
      throw insertErr; // re-throw unexpected DB errors
    }

    logger.info('Auto-scheduled next meeting after close', {
      closedId: meeting.id,
      newId: rows[0].id,
      title,
      scheduledStart: baseDate.toISOString(),
    });
    return mapMeetingRow(rows[0]);
  },

  generateFindingsAndTasks: async (meetingId, tenant = null) => {
    const { rows: meetingRows } = tenant
      ? await db.query(
          `SELECT m.id, m.tenant_id AS "tenantId", m.title,
                  c.name, c.account_manager AS "accountManager"
           FROM meetings m JOIN customers c ON c.id = m.tenant_id
           WHERE m.id = $1 AND m.tenant_id = $2 LIMIT 1`,
          [meetingId, tenant.id]
        )
      : await db.query(
          `SELECT m.id, m.tenant_id AS "tenantId", m.title,
                  c.name, c.account_manager AS "accountManager"
           FROM meetings m JOIN customers c ON c.id = m.tenant_id
           WHERE m.id = $1 LIMIT 1`,
          [meetingId]
        );

    const meeting = meetingRows[0];
    if (!meeting) throw new Error('Meeting not found');

    // Fetch live NXG360 findings for this tenant.
    // FindingsProvider never throws — returns [] on any error.
    const nxgFindings = await FindingsProvider.getNormalized(meeting.tenantId);

    // Sort critical → high → medium → low, take top 10.
    const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...nxgFindings].sort(
      (a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9)
    );
    const toInsert = sorted.slice(0, 10);

    // Fallback when NXG360 is unreachable — one placeholder so AM knows to check.
    if (toInsert.length === 0) {
      toInsert.push({
        sourceFindingId: 'PENDING-NXG360',
        severity:        'medium',
        category:        'Data Unavailable',
        title:           'NXG360 findings unavailable — manual review required',
        description:     'NXG360 could not be reached at T-48. Review live findings manually before the meeting.',
        systemAffected:  null,
      });
    }

    const insertedFindings = [];
    for (let i = 0; i < toInsert.length; i++) {
      const f = toInsert[i];
      const { rows } = await db.query(
        `INSERT INTO findings
           (meeting_id, tenant_id, source_finding_id, severity, category, title, description, system_affected)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id,
                   meeting_id        AS "meetingId",
                   source_finding_id AS "sourceFindingId",
                   severity, category, title, description,
                   system_affected   AS "systemAffected",
                   created_at        AS "createdAt"`,
        [
          meetingId,
          meeting.tenantId,
          f.sourceFindingId || `NXG360-${Date.now()}-${i}`,
          f.severity        || 'medium',
          f.category        || null,
          f.title,
          f.description     || '',
          f.systemAffected  || null,
        ]
      );
      insertedFindings.push(mapFindingRow(rows[0]));
    }

    logger.info('generateFindingsAndTasks: real findings inserted', {
      meetingId,
      tenantId: meeting.tenantId,
      count:    insertedFindings.length,
    });

    return { findings: insertedFindings };
  },

  requestReschedule: async (meetingId, requestedDate, requestedTime, reason) => {
    const newStart = new Date(`${requestedDate}T${requestedTime}:00`);
    const triggerDate = new Date(newStart);
    triggerDate.setHours(triggerDate.getHours() - 48);
    const rescheduleRequest = {
      requestedStart:  newStart.toISOString(),
      requestedTime,
      requestedDate,
      requestedReason: reason,
      requestedAt:     new Date().toISOString(),
      reviewStatus:    'pending',
      reviewerNotes:   null
    };

    const { rows: cur } = await db.query(
      `SELECT reschedule_history FROM meetings WHERE id = $1`, [meetingId]
    );
    const history    = cur[0]?.reschedule_history || [];
    const newHistory = [...history, { ...rescheduleRequest, entryIndex: history.length }];

    const { rows } = await db.query(
      `UPDATE meetings
       SET reschedule_request  = $1,
           reschedule_history  = $2,
           trigger_date        = $3,
           status              = $4,
           updated_at          = NOW()
       WHERE id = $5
       RETURNING id,
                 tenant_id AS "tenantId",
                 meeting_config_id AS "meetingConfigId",
                 scheduled_start AS "scheduledStart",
                 scheduled_end AS "scheduledEnd",
                 meeting_type AS "meetingType",
                 meeting_duration_minutes AS "meetingDurationMinutes",
                 calendar_event_id AS "calendarEventId",
                 status,
                 trigger_date AS "triggerDate",
                 title,
                 provider,
                 attendees,
                 reschedule_request AS "rescheduleRequest",
                 reschedule_count AS "rescheduleCount",
                 reschedule_history AS "rescheduleHistory",
                 created_by AS "createdBy",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [JSON.stringify(rescheduleRequest), JSON.stringify(newHistory), triggerDate.toISOString(), 'reschedule_requested', meetingId]
    );
    if (!rows[0]) throw new Error('Meeting not found');
    return mapMeetingRow(rows[0]);
  },

  reviewReschedule: async (meetingId, approved, notes = '') => {
    const { rows } = await db.query(
      `SELECT reschedule_request, reschedule_history, reschedule_count FROM meetings WHERE id = $1`,
      [meetingId]
    );
    const meeting = rows[0];
    if (!meeting) throw new Error('Meeting not found');
    if (!meeting.reschedule_request) throw new Error('No reschedule request exists');

    const request  = meeting.reschedule_request;
    const history  = meeting.reschedule_history || [];
    const count    = meeting.reschedule_count   || 0;

    request.reviewStatus  = approved ? 'approved' : 'rejected';
    request.reviewerNotes = notes;
    request.reviewedAt    = new Date().toISOString();

    // Update last history entry with review result
    const newHistory = history.length > 0
      ? [...history.slice(0, -1), { ...history[history.length - 1], reviewStatus: request.reviewStatus, reviewedAt: request.reviewedAt, reviewerNotes: notes }]
      : history;

    const RETURN_COLS = `
      id,
      tenant_id AS "tenantId",
      meeting_config_id AS "meetingConfigId",
      scheduled_start AS "scheduledStart",
      scheduled_end AS "scheduledEnd",
      meeting_type AS "meetingType",
      meeting_duration_minutes AS "meetingDurationMinutes",
      calendar_event_id AS "calendarEventId",
      status,
      trigger_date AS "triggerDate",
      title,
      provider,
      attendees,
      reschedule_request AS "rescheduleRequest",
      reschedule_count AS "rescheduleCount",
      reschedule_history AS "rescheduleHistory",
      created_by AS "createdBy",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      ms_event_id AS "msEventId",
      teams_join_url AS "teamsJoinUrl",
      booking_pending AS "bookingPending",
      customer_contact_email AS "customerContactEmail",
      customer_contact_name AS "customerContactName"`;

    if (approved) {
      const newStart       = new Date(request.requestedStart);
      const newTriggerDate = new Date(newStart);
      newTriggerDate.setHours(newTriggerDate.getHours() - 48);

      // Run in a transaction: clear stale NXG360 data, then update the meeting.
      // Stale findings must be removed so triggerWorkflow() fetches fresh NXG360 data
      // for the new meeting date — it skips the fetch when findings already exist.
      return await db.withTransaction(async (client) => {
        // Delete dependents first to respect FK ordering (finding_id → findings.id ON DELETE SET NULL).
        // Only clear pending recs — approved/rejected represent the AM's prior decisions and must survive.
        await client.query(
          `DELETE FROM ai_task_recommendations
           WHERE meeting_id      = $1
             AND analysis_type   = 'pre_meeting'
             AND approval_status = 'pending'`,
          [meetingId]
        );
        await client.query(
          `DELETE FROM findings WHERE meeting_id = $1`,
          [meetingId]
        );

        const { rows: updatedRows } = await client.query(
          `UPDATE meetings
           SET reschedule_request  = $1,
               reschedule_history  = $2,
               reschedule_count    = $3,
               scheduled_start     = $4,
               scheduled_end       = $5,
               trigger_date        = $6,
               status              = $7,
               updated_at          = NOW()
           WHERE id = $8
           RETURNING ${RETURN_COLS}`,
          [
            JSON.stringify(request),
            JSON.stringify(newHistory),
            count + 1,
            newStart.toISOString(),
            new Date(newStart.getTime() + 60 * 60 * 1000).toISOString(),
            newTriggerDate.toISOString(),
            'scheduled',
            meetingId,
          ]
        );

        logger.info('reviewReschedule: stale findings cleared, new trigger_date set', {
          meetingId,
          newStart:       newStart.toISOString(),
          newTriggerDate: newTriggerDate.toISOString(),
        });
        return mapMeetingRow(updatedRows[0]);
      });
    }

    const { rows: updatedRows } = await db.query(
      `UPDATE meetings
       SET reschedule_request = $1,
           reschedule_history = $2,
           status             = $3,
           updated_at         = NOW()
       WHERE id = $4
       RETURNING ${RETURN_COLS}`,
      [JSON.stringify(request), JSON.stringify(newHistory), 'scheduled', meetingId]
    );
    return mapMeetingRow(updatedRows[0]);
  },

  conductMeeting: async (meetingId) => {
    const { rows } = await db.query(
      `UPDATE meetings
       SET status = $1,
           meeting_notes = COALESCE(meeting_notes, 'Meeting conducted and recorded.'),
           updated_at = NOW()
       WHERE id = $2
       RETURNING id,
                 tenant_id AS "tenantId",
                 meeting_config_id AS "meetingConfigId",
                 scheduled_start AS "scheduledStart",
                 scheduled_end AS "scheduledEnd",
                 meeting_type AS "meetingType",
                 meeting_duration_minutes AS "meetingDurationMinutes",
                 calendar_event_id AS "calendarEventId",
                 status,
                 trigger_date AS "triggerDate",
                 title,
                 provider,
                 meeting_notes AS "meetingNotes",
                 attendees,
                 reschedule_request AS "rescheduleRequest",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      ['conducted', meetingId]
    );
    if (!rows[0]) throw new Error('Meeting not found');
    return mapMeetingRow(rows[0]);
  },

  closeMeeting: async (meetingId) => {
    const { rows } = await db.query(
      `UPDATE meetings
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id,
                 tenant_id AS "tenantId",
                 meeting_config_id AS "meetingConfigId",
                 scheduled_start AS "scheduledStart",
                 scheduled_end AS "scheduledEnd",
                 meeting_type AS "meetingType",
                 meeting_duration_minutes AS "meetingDurationMinutes",
                 calendar_event_id AS "calendarEventId",
                 status,
                 trigger_date AS "triggerDate",
                 title,
                 provider,
                 attendees,
                 reschedule_request AS "rescheduleRequest",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      ['closed', meetingId]
    );
    if (!rows[0]) throw new Error('Meeting not found');
    const closedMeeting = mapMeetingRow(rows[0]);
    await meetingRepository.generateNextMeetingForClosedMeeting(closedMeeting);
    return closedMeeting;
  },

  triggerWorkflow: async (meetingId) => {
    const { rows } = await db.query(
      `UPDATE meetings
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id,
                 tenant_id AS "tenantId",
                 meeting_config_id AS "meetingConfigId",
                 scheduled_start AS "scheduledStart",
                 scheduled_end AS "scheduledEnd",
                 meeting_type AS "meetingType",
                 meeting_duration_minutes AS "meetingDurationMinutes",
                 calendar_event_id AS "calendarEventId",
                 status,
                 trigger_date AS "triggerDate",
                 title,
                 provider,
                 attendees,
                 reschedule_request AS "rescheduleRequest",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      ['approval_pending', meetingId]
    );
    if (!rows[0]) throw new Error('Meeting not found');

    // Skip generation only when REAL findings exist.
    // If every stored finding is a PENDING-NXG360 placeholder the NXG360 sync
    // had not run yet at meeting-creation time — delete the placeholders and
    // regenerate so real findings are fetched now that the sync may have run.
    const { rows: existing } = await db.query(
      `SELECT id, title FROM findings WHERE meeting_id = $1`,
      [meetingId]
    );
    const hasReal = existing.some((f) => f.title !== 'PENDING-NXG360');

    if (!hasReal) {
      if (existing.length > 0) {
        await db.query(
          `DELETE FROM findings WHERE meeting_id = $1 AND title = 'PENDING-NXG360'`,
          [meetingId]
        );
        logger.info('triggerWorkflow: removed PENDING-NXG360 placeholders, regenerating', {
          meetingId, removed: existing.length,
        });
      }
      await meetingRepository.generateFindingsAndTasks(meetingId);
    } else {
      logger.info('triggerWorkflow: real findings already exist, skipping generation', {
        meetingId, count: existing.filter((f) => f.title !== 'PENDING-NXG360').length,
      });
    }

    logger.info(`Remediation scan workflow executed manually for meeting: ${meetingId}`);
    return mapMeetingRow(rows[0]);
  },

  findFindingsForMeeting: async (meetingId) => {
    const { rows } = await db.query(
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
    );
    return rows.map(mapFindingRow);
  },

  findTasksForMeeting: async (meetingId) => {
    const { rows } = await db.query(
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
              t.priority,
              t.owner_type AS "ownerType",
              t.last_updated_at AS "lastUpdatedAt",
              t.created_at AS "createdAt",
              f.source_finding_id AS "sourceFindingId",
              f.severity,
              f.category,
              f.system_affected AS "systemAffected",
              c.name AS "customerName"
       FROM tasks t
       LEFT JOIN findings f ON f.id = t.finding_id
       JOIN meetings m ON m.id = t.meeting_id
       JOIN customers c ON c.id = m.tenant_id
       WHERE t.meeting_id = $1
       ORDER BY t.created_at DESC`,
      [meetingId]
    );
    return rows.map(mapTaskRow);
  },

  findOpenTasksForTenant: async (tenantId) => {
    const { rows } = await db.query(
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
              t.priority,
              t.owner_type AS "ownerType",
              t.last_updated_at AS "lastUpdatedAt",
              t.created_at AS "createdAt",
              f.source_finding_id AS "sourceFindingId",
              f.severity,
              f.category,
              f.system_affected AS "systemAffected",
              c.name AS "customerName"
       FROM   tasks t
       LEFT JOIN findings f ON f.id = t.finding_id
       JOIN   customers c ON c.id = t.tenant_id
       WHERE  t.tenant_id = $1
         AND  t.remediation_status NOT IN ('completed', 'closed')
       ORDER BY
         CASE t.remediation_status
           WHEN 'overdue'       THEN 1
           WHEN 'carry_forward' THEN 2
           WHEN 'blocked'       THEN 3
           WHEN 'in_progress'   THEN 4
           ELSE 5
         END,
         CASE t.priority
           WHEN 'critical' THEN 1
           WHEN 'high'     THEN 2
           WHEN 'medium'   THEN 3
           ELSE 4
         END,
         t.due_date ASC NULLS LAST`,
      [tenantId]
    );
    return rows.map(mapTaskRow);
  },

  create: async ({ tenantId, title, scheduledStart, scheduledEnd, durationMinutes, meetingType, attendees, createdBy, teamsJoinUrl, timezone, meetingTime, recurrencePattern }) => {
    const start      = new Date(scheduledStart);
    const end        = scheduledEnd ? new Date(scheduledEnd) : new Date(start.getTime() + (durationMinutes || 60) * 60 * 1000);
    const triggerDate = new Date(start.getTime() - 48 * 60 * 60 * 1000);

    // Seed a recurring meeting_configs row so that once this meeting is
    // closed (AI tasks generated + approved), generateNextMeetingForClosedMeeting
    // (called from closeMeeting()) can auto-schedule the next occurrence.
    // Replaces the old separate "Journey Configuration" panel — every meeting
    // now carries its own cadence, set up in the same New Meeting step instead
    // of a second one. Non-fatal if it fails: the meeting itself still gets
    // created, just without auto-schedule-on-close for this one.
    let meetingConfigId = null;
    try {
      const { rows: configRows } = await db.query(
        `INSERT INTO meeting_configs (tenant_id, first_meeting_date, meeting_time, timezone, recurrence_pattern)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          tenantId,
          start.toISOString().slice(0, 10),
          meetingTime || '10:00',
          timezone || 'UTC',
          recurrencePattern || 'monthly_day_of_month',
        ]
      );
      meetingConfigId = configRows[0]?.id || null;
    } catch (cfgErr) {
      logger.warn('Meeting create: failed to seed recurring config — auto-schedule-on-close will be skipped for this meeting', {
        tenantId, error: cfgErr.message,
      });
    }

    const { rows } = await db.query(
      `INSERT INTO meetings (
         tenant_id, meeting_config_id, scheduled_start, scheduled_end, meeting_type, meeting_duration_minutes,
         status, trigger_date, title, attendees, created_by, teams_join_url
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id,
                 tenant_id AS "tenantId",
                 meeting_config_id AS "meetingConfigId",
                 scheduled_start AS "scheduledStart",
                 scheduled_end AS "scheduledEnd",
                 meeting_type AS "meetingType",
                 meeting_duration_minutes AS "meetingDurationMinutes",
                 calendar_event_id AS "calendarEventId",
                 status,
                 trigger_date AS "triggerDate",
                 title,
                 provider,
                 meeting_notes AS "meetingNotes",
                 attendees,
                 reschedule_request AS "rescheduleRequest",
                 reschedule_count AS "rescheduleCount",
                 reschedule_history AS "rescheduleHistory",
                 created_by AS "createdBy",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt",
                 teams_join_url AS "teamsJoinUrl"`,
      [
        tenantId, meetingConfigId, start.toISOString(), end.toISOString(),
        meetingType || 'monthly_review', durationMinutes || 60,
        'scheduled', triggerDate.toISOString(), title,
        JSON.stringify(attendees || []), createdBy || null, teamsJoinUrl || null
      ]
    );
    logger.info('Meeting created directly', { id: rows[0].id, tenantId, meetingConfigId });
    return mapMeetingRow(rows[0]);
  },

  update: async (id, tenantId, updates) => {
    const setClauses = ['updated_at = NOW()'];
    const params     = [];

    if (updates.title !== undefined) {
      params.push(updates.title);
      setClauses.push(`title = $${params.length}`);
    }
    if (updates.attendees !== undefined) {
      params.push(JSON.stringify(updates.attendees));
      setClauses.push(`attendees = $${params.length}`);
    }
    if (updates.meetingNotes !== undefined) {
      params.push(updates.meetingNotes);
      setClauses.push(`meeting_notes = $${params.length}`);
    }
    if (updates.teamsJoinUrl !== undefined) {
      params.push(updates.teamsJoinUrl || null);
      setClauses.push(`teams_join_url = $${params.length}`);
    }
    if (updates.teamsMeetingId !== undefined) {
      params.push(updates.teamsMeetingId || null);
      setClauses.push(`teams_meeting_id = $${params.length}`);
    }
    if (updates.msEventId !== undefined) {
      params.push(updates.msEventId || null);
      setClauses.push(`ms_event_id = $${params.length}`);
    }

    if (params.length === 0) {
      throw Object.assign(new Error('No valid fields to update'), { statusCode: 400 });
    }

    params.push(id);
    params.push(tenantId);

    const { rows } = await db.query(
      `UPDATE meetings
       SET ${setClauses.join(', ')}
       WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
       RETURNING id,
                 tenant_id AS "tenantId",
                 meeting_config_id AS "meetingConfigId",
                 scheduled_start AS "scheduledStart",
                 scheduled_end AS "scheduledEnd",
                 meeting_type AS "meetingType",
                 meeting_duration_minutes AS "meetingDurationMinutes",
                 calendar_event_id AS "calendarEventId",
                 status,
                 trigger_date AS "triggerDate",
                 title,
                 provider,
                 meeting_notes AS "meetingNotes",
                 attendees,
                 reschedule_request AS "rescheduleRequest",
                 reschedule_count AS "rescheduleCount",
                 reschedule_history AS "rescheduleHistory",
                 created_by AS "createdBy",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      params
    );
    if (!rows[0]) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });
    return mapMeetingRow(rows[0]);
  },

  getHistory: async (id, tenantId) => {
    const { rows: meetingRows } = await db.query(
      `SELECT m.id,
              m.tenant_id AS "tenantId",
              m.meeting_config_id AS "meetingConfigId",
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
              m.reschedule_count AS "rescheduleCount",
              m.reschedule_history AS "rescheduleHistory",
              m.created_by AS "createdBy",
              m.created_at AS "createdAt",
              m.updated_at AS "updatedAt",
              c.name AS "tenantName",
              c.account_manager AS "accountManager"
       FROM meetings m
       JOIN customers c ON c.id = m.tenant_id
       WHERE m.id = $1 AND m.tenant_id = $2
       LIMIT 1`,
      [id, tenantId]
    );
    if (!meetingRows[0]) return null;

    const meeting = mapMeetingRow(meetingRows[0]);

    const [findingRows, taskRows, noteRows, fileRows] = await Promise.all([
      db.query(
        `SELECT id, meeting_id AS "meetingId", source_finding_id AS "sourceFindingId",
                severity, category, title, description, system_affected AS "systemAffected", created_at AS "createdAt"
         FROM findings WHERE meeting_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      db.query(
        `SELECT id, meeting_id AS "meetingId", finding_id AS "findingId", tenant_id AS "tenantId",
                title, action_plan AS "actionPlan", risk_reduction_score AS "riskReductionScore",
                approval_status AS "approvalStatus", remediation_status AS "remediationStatus",
                ownership_team AS "ownershipTeam", owner_name AS "ownerName", due_date AS "dueDate",
                progress_percentage AS "progressPercentage", carry_forward_count AS "carryForwardCount",
                escalation_count AS "escalationCount", meeting_timeline AS "meetingTimeline",
                primary_owner AS "primaryOwner", secondary_owner AS "secondaryOwner",
                timeline, notes, last_updated_at AS "lastUpdatedAt", created_at AS "createdAt"
         FROM tasks WHERE meeting_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      db.query(
        `SELECT meeting_id AS "meetingId", tenant_id AS "tenantId", provider, transcript_source AS "transcriptSource",
                summary, action_items AS "actionItems", follow_up_actions AS "followUpActions",
                meeting_summary AS "meetingSummary", decisions_taken AS "decisionsTaken",
                risks_discussed AS "risksDiscussed", ai_status AS "aiStatus",
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM meeting_notes WHERE meeting_id = $1 LIMIT 1`,
        [id]
      ),
      db.query(
        `SELECT id, meeting_id AS "meetingId", tenant_id AS "tenantId", file_name AS "fileName",
                original_name AS "originalName", file_path AS "filePath",
                file_size_bytes AS "fileSizeBytes", mime_type AS "mimeType",
                source_type AS "sourceType", uploaded_by AS "uploadedBy", created_at AS "createdAt"
         FROM meeting_files WHERE meeting_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
    ]);

    return {
      ...meeting,
      tenantName:      meetingRows[0].tenantName,
      accountManager:  meetingRows[0].accountManager,
      findings:        findingRows.rows.map(mapFindingRow),
      tasks:           taskRows.rows.map(mapTaskRow),
      notes:           noteRows.rows[0] || null,
      files:           fileRows.rows,
      rescheduleHistory: meeting.rescheduleHistory || [],
    };
  },

  updateTaskStatus: async (taskId, approvalStatus, notes = '', tenantId = null) => {
    const { rows } = await db.query(
      `UPDATE tasks
       SET approval_status = $1,
           notes = $2,
           last_updated_at = NOW()
       WHERE id = $3 ${tenantId ? 'AND tenant_id = $4' : ''}
       RETURNING id,
                 meeting_id AS "meetingId",
                 finding_id AS "findingId",
                 tenant_id AS "tenantId",
                 title,
                 action_plan AS "actionPlan",
                 risk_reduction_score AS "riskReductionScore",
                 approval_status AS "approvalStatus",
                 remediation_status AS "remediationStatus",
                 ownership_team AS "ownershipTeam",
                 owner_name AS "ownerName",
                 due_date AS "dueDate",
                 progress_percentage AS "progressPercentage",
                 carry_forward_count AS "carryForwardCount",
                 escalation_count AS "escalationCount",
                 meeting_timeline AS "meetingTimeline",
                 primary_owner AS "primaryOwner",
                 secondary_owner AS "secondaryOwner",
                 timeline,
                 notes,
                 last_updated_at AS "lastUpdatedAt",
                 created_at AS "createdAt"`,
      tenantId ? [approvalStatus, notes, taskId, tenantId] : [approvalStatus, notes, taskId]
    );
    if (!rows[0]) throw new Error('Task not found');
    return mapTaskRow(rows[0]);
  },

  /**
   * Called by the daily recurrence job for a single config row.
   * If no non-closed meeting already exists for this config, finds the latest
   * closed meeting and schedules the next occurrence using computeNextDate.
   * Returns { generated: true, meeting } or { generated: false, reason }.
   */
  ensureUpcomingMeeting: async (config) => {
    // 1. Check whether a non-closed meeting already exists for this config
    // 1. Tenant-scoped check: if ANY non-closed meeting exists in the future (or recent past)
    //    for this tenant — across all configs — do not generate another one.
    const { rows: open } = await db.query(
      `SELECT id FROM meetings
       WHERE tenant_id     = $1
         AND status        != 'closed'
         AND scheduled_start > NOW() - INTERVAL '7 days'
       LIMIT 1`,
      [config.tenantId]
    );
    if (open.length > 0) {
      return { generated: false, reason: 'open_meeting_exists' };
    }

    // 2. Find the latest closed meeting for this specific config
    const { rows: closed } = await db.query(
      `SELECT id,
              tenant_id              AS "tenantId",
              meeting_config_id      AS "meetingConfigId",
              scheduled_start        AS "scheduledStart",
              meeting_type           AS "meetingType",
              meeting_duration_minutes AS "meetingDurationMinutes",
              title,
              provider,
              attendees
       FROM meetings
       WHERE meeting_config_id = $1
         AND status            = 'closed'
       ORDER BY scheduled_start DESC
       LIMIT 1`,
      [config.id]
    );
    if (closed.length === 0) {
      return { generated: false, reason: 'no_closed_meeting_found' };
    }

    // 3. Delegate to the existing generator (includes duplicate guard + audit log)
    const next = await meetingRepository.generateNextMeetingForClosedMeeting({
      id:                    closed[0].id,
      tenantId:              closed[0].tenantId,
      meetingConfigId:       closed[0].meetingConfigId,
      scheduledStart:        closed[0].scheduledStart,
      meetingType:           closed[0].meetingType,
      meetingDurationMinutes: closed[0].meetingDurationMinutes,
      title:                 closed[0].title,
      provider:              closed[0].provider,
      attendees:             closed[0].attendees || [],
    });

    return next
      ? { generated: true,  meeting: next }
      : { generated: false, reason: 'guard_prevented_duplicate' };
  },

  /**
   * Returns all meeting_configs (used by the recurrence job).
   */
  getAllConfigs: async () => {
    const { rows } = await db.query(
      `SELECT id, tenant_id AS "tenantId", recurrence_pattern AS "recurrencePattern",
              meeting_time AS "meetingTime", timezone
       FROM meeting_configs
       ORDER BY created_at ASC`
    );
    return rows;
  },

  // Returns meetings in the reminder zone (scheduled_start within next 7 days).
  // Called by the reminder-windows BullMQ job every 5 min. Covers both statuses
  // because approval_pending meetings still need attendee reminders.
  findMeetingsNeedingReminders: async () => {
    const { rows } = await db.query(
      `SELECT id,
              tenant_id       AS "tenantId",
              title,
              scheduled_start AS "scheduledStart"
       FROM   meetings
       WHERE  status          IN ('scheduled', 'approval_pending')
         AND  scheduled_start >  NOW()
         AND  scheduled_start <= NOW() + INTERVAL '7 days 1 hour'
       ORDER  BY scheduled_start ASC`
    );
    return rows;
  },

  // ── Phase 11 — Calendly / Microsoft booking methods ─────────────────────────

  // Called by meeting.routes when AM clicks "Send Booking Link".
  // Sets booking_pending=TRUE, stores customer contact details and additional participants.
  sendBookingLink: async (meetingId, tenantId, { customerContactEmail, customerContactName, additionalParticipants = [] }) => {
    // Customer email goes in attendees as 'primary' so reminder emails (queueMeetingReminderEmails)
    // reach them automatically — not just at booking-link time but also at T-48.
    const attendees = [
      { email: customerContactEmail, name: customerContactName || '', role: 'primary' },
      ...additionalParticipants.map((email) => ({ email, name: '', role: 'participant' })),
    ];
    const { rows } = await db.query(
      `UPDATE meetings
       SET booking_pending        = TRUE,
           booking_link_sent_at   = NOW(),
           customer_contact_email = $1,
           customer_contact_name  = $2,
           attendees              = $3,
           updated_at             = NOW()
       WHERE id = $4 AND tenant_id = $5
       RETURNING id, tenant_id AS "tenantId", title, status,
                 booking_pending AS "bookingPending",
                 booking_link_sent_at AS "bookingLinkSentAt",
                 customer_contact_email AS "customerContactEmail",
                 customer_contact_name AS "customerContactName",
                 attendees,
                 scheduled_start AS "scheduledStart",
                 meeting_duration_minutes AS "meetingDurationMinutes"`,
      [customerContactEmail, customerContactName || null, JSON.stringify(attendees), meetingId, tenantId]
    );
    if (!rows[0]) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });
    return rows[0];
  },

  // Replace the attendees list for a meeting. Called by the AM via the Participants panel.
  // The primary-role attendee (customer) is preserved; callers pass the full desired list.
  updateAttendees: async (meetingId, tenantId, attendees) => {
    const { rows } = await db.query(
      `UPDATE meetings
       SET attendees   = $1,
           updated_at  = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, attendees`,
      [JSON.stringify(attendees), meetingId, tenantId]
    );
    if (!rows[0]) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });
    return rows[0];
  },

  // Called by bookingWatcher.job when a matching calendar event is found.
  // Confirms the booking: stores event ID, Teams URL, and actual scheduled times.
  confirmBooking: async (meetingId, tenantId, { msEventId, teamsJoinUrl, scheduledStart, scheduledEnd }) => {
    const { rows } = await db.query(
      `UPDATE meetings
       SET booking_pending  = FALSE,
           ms_event_id      = $1,
           teams_join_url   = $2,
           scheduled_start  = COALESCE($3, scheduled_start),
           scheduled_end    = COALESCE($4, scheduled_end),
           trigger_date     = COALESCE($3::timestamptz - INTERVAL '48 hours', trigger_date),
           updated_at       = NOW()
       WHERE id = $5 AND tenant_id = $6
       RETURNING id, tenant_id AS "tenantId", title, status,
                 scheduled_start AS "scheduledStart",
                 scheduled_end AS "scheduledEnd",
                 teams_join_url AS "teamsJoinUrl",
                 ms_event_id AS "msEventId"`,
      [msEventId || null, teamsJoinUrl || null, scheduledStart || null, scheduledEnd || null, meetingId, tenantId]
    );
    if (!rows[0]) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });
    return rows[0];
  },

  // Returns all meetings with booking_pending=TRUE (used by startup recovery scan).
  findBookingPendingMeetings: async () => {
    const { rows } = await db.query(
      `SELECT id,
              tenant_id               AS "tenantId",
              title,
              scheduled_start         AS "scheduledStart",
              booking_link_sent_at    AS "bookingLinkSentAt"
       FROM   meetings
       WHERE  booking_pending = TRUE
         AND  status          = 'scheduled'
       ORDER  BY booking_link_sent_at ASC`
    );
    return rows;
  },

  // Updates transcript_status column (e.g. fetching → captured / unavailable)
  updateTranscriptStatus: async (meetingId, status) => {
    await db.query(
      `UPDATE meetings SET transcript_status = $1, updated_at = NOW() WHERE id = $2`,
      [status, meetingId]
    );
  },

  // Persists the downloaded transcript text and marks status as captured.
  saveTranscript: async (meetingId, tenantId, transcriptText) => {
    await db.query(
      `UPDATE meetings
       SET transcript_text      = $1,
           transcript_status    = 'captured',
           transcript_fetched_at = NOW(),
           updated_at           = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [transcriptText, meetingId, tenantId]
    );
  },

  // Stores the internal Teams meeting ID (resolved from the join URL via Graph API).
  updateTeamsMeetingId: async (meetingId, teamsMeetingId) => {
    await db.query(
      `UPDATE meetings SET teams_meeting_id = $1, updated_at = NOW() WHERE id = $2`,
      [teamsMeetingId, meetingId]
    );
  },

  // Marks a booking as expired (link sent but no booking made within 7 days).
  updateBookingExpired: async (meetingId) => {
    await db.query(
      `UPDATE meetings
       SET booking_pending = FALSE,
           updated_at      = NOW()
       WHERE id = $1`,
      [meetingId]
    );
  },

  // Returns conducted Teams meetings whose transcript_status is still 'fetching'.
  // Scoped to teams_join_url IS NOT NULL so the Teams recovery scan never
  // touches Fireflies meetings (which also use transcript_status='fetching').
  // Used by transcriptFetch.job.js recovery scan at startup.
  findTranscriptFetchingMeetings: async () => {
    const { rows } = await db.query(
      `SELECT id,
              tenant_id                    AS "tenantId",
              teams_join_url               AS "teamsJoinUrl",
              transcript_polling_started_at AS "transcriptPollingStartedAt"
       FROM   meetings
       WHERE  transcript_status = 'fetching'
         AND  status            = 'conducted'
         AND  teams_join_url    IS NOT NULL
       ORDER  BY updated_at ASC`
    );
    return rows;
  },

  // Returns conducted meetings whose transcript_status is still 'fetching'
  // for the Fireflies recovery scan. The original teams_join_url IS NULL
  // guard was too strict — tenants can have BOTH a Teams join URL and a
  // Fireflies connection (bot joins the Teams call). The Fireflies job
  // already handles the "transcript already captured by MS Graph" case
  // gracefully (stops with 'transcript already captured'), so it is safe
  // to include Teams meetings here. Recovery is skipped per-meeting when
  // no active Fireflies connection exists for that tenant.
  findFirefliesFetchingMeetings: async () => {
    const { rows } = await db.query(
      `SELECT id,
              tenant_id                    AS "tenantId",
              transcript_polling_started_at AS "transcriptPollingStartedAt"
       FROM   meetings
       WHERE  transcript_status = 'fetching'
         AND  status            = 'conducted'
       ORDER  BY updated_at ASC`
    );
    return rows;
  },

  // Returns scheduled meetings whose T-48 trigger window has arrived but whose
  // meeting date is still in the future. Called by the t48 BullMQ job every 5 min.
  findDueT48: async () => {
    const { rows } = await db.query(
      `SELECT id,
              tenant_id      AS "tenantId",
              title,
              scheduled_start AS "scheduledStart",
              trigger_date    AS "triggerDate"
       FROM   meetings
       WHERE  trigger_date    <= NOW()
         AND  status           = 'scheduled'
         AND  scheduled_start  > NOW()
         AND  booking_pending  = FALSE
       ORDER  BY trigger_date ASC`
    );
    return rows;
  },
};

module.exports = meetingRepository;
