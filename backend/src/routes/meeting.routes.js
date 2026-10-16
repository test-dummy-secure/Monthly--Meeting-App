'use strict';

const express             = require('express');
const multer              = require('multer');
const router              = express.Router();
const meetingRepository   = require('../repositories/meeting.repository');
const calendarRepository  = require('../repositories/calendar.repository');
const auditLogRepository  = require('../repositories/audit-log.repository');
const actionItemService   = require('../services/actionItem.service');
const invitationService   = require('../services/invitation.service');
const preMeetingService   = require('../services/preMeeting.service');
const reportService       = require('../services/report.service');
const emailService        = require('../services/email.service');
const journeyService      = require('../services/journey.service');
const nxg360SyncJob       = require('../jobs/nxg360Sync.job');
const db                  = require('../config/db');
const { enrichWithInternalFlag } = require('../utils/attendees');
const auth                = require('../middleware/auth.middleware');
const tenantMiddleware    = require('../middleware/tenant.middleware');
const logger              = require('../utils/logger');

// Multer — memory storage for test-findings upload (buffer parsed in-process, not saved to disk)
const _testFindingsUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize:      5 * 1024 * 1024, // 5 MB
    fieldNameSize: 100,              // mitigates deeply-nested field-name DoS (GHSA-72gw-mp4g-v24j)
    fields:        5,
    files:         1,
    parts:         10,
  },
  fileFilter: (_req, file, cb) => {
    const ok = new Set([
      'text/csv', 'application/csv', 'text/plain',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ]);
    if (ok.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Only CSV, XLSX, and DOCX files are accepted'), { statusCode: 400 }), false);
  },
});

// Lazy-load to avoid circular dep at startup
const getPrefetchJob = () => require('../jobs/nxg360Prefetch.job');

// Parse comma-separated participant emails from a string or array.
// Returns a deduplicated array of valid lowercase email strings.
const _parseParticipants = (raw) => {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const seen = new Set();
  return list
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !seen.has(e) && seen.add(e));
};

// Builds a Calendly booking URL with UTM params so the sync job can correlate
// the returned booking back to the specific BMMJ meeting and avoid duplicates.
const _buildBookingUrl = (rawUrl, tenantId, meetingId) => {
  try {
    const u = new URL(rawUrl);
    u.searchParams.set('utm_campaign', tenantId);
    u.searchParams.set('utm_content',  meetingId);
    return u.toString();
  } catch {
    return rawUrl; // malformed URL — return as-is
  }
};

// Lazy-load Phase-11 deps to avoid circular dependency issues
const getCalendarRepo    = () => require('../repositories/calendar.repository');
const getBookingWatcher  = () => require('../jobs/bookingWatcher.job');
const getTranscriptFetch = () => require('../jobs/transcriptFetch.job');
const getFirefliesFetch  = () => require('../jobs/firefliesFetch.job');
const getTokenStore      = () => require('../services/microsoft/MicrosoftTokenStore');
const getCalClient       = () => require('../services/microsoft/MicrosoftCalendarClient');

const FIREFLIES_BOT_EMAIL     = 'fred@fireflies.ai';
const getFirefliesConnRepo    = () => require('../repositories/fireflies-connection.repository');
const getFirefliesService     = () => require('../services/fireflies.service');
const { decrypt: decryptKey } = require('../utils/encryption');

// Returns true when the AM assigned to this tenant has an active Fireflies connection.
// One Fireflies API key per AM covers all their tenants (migration 043).
const isFirefliesActiveForTenant = async (tenantId) => {
  try {
    // Primary: look up EVERY AM assigned to this tenant (not just the primary —
    // a secondary/shared AM's own connection counts too, since Fireflies connect
    // is user-scoped per migration 043 and allowed for any assigned AM, not just
    // the primary), check whether any of them has a connected user-level key.
    const { rows } = await db.query(
      `SELECT fc.status
       FROM   tenant_assignments ta
       JOIN   fireflies_connections fc ON fc.user_id = ta.user_id
       WHERE  ta.tenant_id = $1 AND fc.status = 'connected'
       LIMIT  1`,
      [tenantId]
    );
    if (rows[0]) return true;
    // Fallback: legacy per-tenant row (pre-migration 043 data, user_id IS NULL).
    const conn = await getFirefliesConnRepo().findByTenant(tenantId);
    return conn?.status === 'connected';
  } catch {
    return false;
  }
};

router.use(auth, tenantMiddleware);

// ─── State machine ────────────────────────────────────────────────────────────
// Each key is an action name; value is the set of statuses it may be applied to.
const ALLOWED_FROM = {
  'trigger-workflow':   new Set(['scheduled']),
  'conduct':            new Set(['approval_pending', 'scheduled']),
  'close':              new Set(['conducted']),
  'request-reschedule': new Set(['scheduled', 'approval_pending']),
  'review-reschedule':  new Set(['reschedule_requested']),
};

/**
 * Throws 409 when the meeting's current status is not valid for the requested action.
 */
function assertTransition(meeting, action) {
  const allowed = ALLOWED_FROM[action];
  if (!allowed || !allowed.has(meeting.status)) {
    const err = new Error(
      `Cannot perform '${action}' on a meeting with status '${meeting.status}'. ` +
      `Allowed from: ${[...(allowed || [])].join(', ') || 'none'}.`
    );
    err.statusCode = 409;
    err.code       = 'INVALID_STATUS_TRANSITION';
    throw err;
  }
}

// POST /api/meetings - Create meeting directly (no calendar required)
router.post('/', async (req, res, next) => {
  try {
    const { title, scheduledStart, scheduledEnd, durationMinutes, meetingType, attendees, teamsJoinUrl: bodyTeamsUrl, timezone, meetingTime, recurrencePattern } = req.body;
    if (!title || !scheduledStart) {
      return res.status(400).json({ error: 'title and scheduledStart are required' });
    }
    const tenantId = req.tenantId || req.body.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });

    // Reject dates more than 24 hours in the past. The 24-hour buffer accommodates
    // any UTC offset without falsely blocking same-day bookings from non-UTC timezones.
    const startMs = new Date(scheduledStart).getTime();
    if (isNaN(startMs)) {
      return res.status(400).json({ error: 'scheduledStart is not a valid date' });
    }
    if (startMs < Date.now() - 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Meeting cannot be scheduled in the past' });
    }

    // Require the scheduling AM's own Microsoft 365 connection before allowing
    // a new meeting at all — without it, Teams meeting creation, calendar
    // invites, and (if Fireflies is off) transcript capture all silently fail
    // downstream. Checked per-user (findConnectionByUserId), matching what
    // this AM sees on their own Integrations page — not the tenant's primary
    // AM connection, which a secondary AM may not have access to.
    const msConn = await calendarRepository.findConnectionByUserId(req.user.id, 'microsoft');
    if (!msConn || !msConn.accessTokenEnc || msConn.status === 'disconnected') {
      return res.status(424).json({
        error: 'Microsoft 365 is not connected for your account. Connect it in Integrations before scheduling a meeting.',
        code:  'MS365_NOT_CONNECTED',
      });
    }

    const meeting = await meetingRepository.create({
      tenantId, title, scheduledStart, scheduledEnd,
      durationMinutes, meetingType, attendees,
      createdBy:    req.user.email,
      teamsJoinUrl: bodyTeamsUrl || null,
      timezone, meetingTime, recurrencePattern,
    });
    await auditLogRepository.create(meeting.tenantId, req.user.email, 'Meeting Created', {
      meetingId: meeting.id, title,
    });

    // Auto-create an Outlook Calendar event with embedded Teams link.
    // Skipped when the user supplied their own Teams URL (meeting already exists
    // in their calendar — creating another would make a duplicate).
    // Non-blocking: the BMMJ meeting record is always returned regardless of
    // whether Microsoft's API succeeds.
    if (bodyTeamsUrl) {
      logger.info('POST /meetings: skipping Outlook auto-create — user supplied Teams URL', {
        meetingId: meeting.id,
      });
    }
    if (!bodyTeamsUrl) try {
      const { MicrosoftTokenStore } = getTokenStore();
      const accessToken = await MicrosoftTokenStore.load(tenantId);
      const startISO = new Date(scheduledStart).toISOString();
      const endISO   = scheduledEnd
        ? new Date(scheduledEnd).toISOString()
        : new Date(new Date(scheduledStart).getTime() + (Number(durationMinutes) || 60) * 60 * 1000).toISOString();

      // When Fireflies is enabled, inject fred@fireflies.ai so the bot joins.
      // This is the free-tier approach — Fireflies reads the calendar invite and
      // sends its bot to the meeting without any manual step per meeting.
      const calAttendees = Array.isArray(attendees) ? [...attendees] : [];
      if (await isFirefliesActiveForTenant(tenantId) && !calAttendees.some((a) => a?.email === FIREFLIES_BOT_EMAIL)) {
        calAttendees.push({ email: FIREFLIES_BOT_EMAIL, name: 'Fireflies AI Notetaker' });
      }

      const calEvent = await getCalClient().createCalendarEvent(accessToken, {
        subject:       title,
        startDateTime: startISO,
        endDateTime:   endISO,
        timeZone:      req.body.timezone || 'UTC',
        attendees:     calAttendees,
      });

      if (calEvent?.id) {
        const teamsJoinUrl = calEvent.onlineMeeting?.joinUrl
          || calEvent.onlineMeetingUrl
          || null;
        await meetingRepository.update(meeting.id, tenantId, {
          msEventId:    calEvent.id,
          teamsJoinUrl,
        });
        meeting.msEventId    = calEvent.id;
        meeting.teamsJoinUrl = teamsJoinUrl;
        logger.info('POST /meetings: Outlook Calendar event created', {
          meetingId: meeting.id, msEventId: calEvent.id, hasTeamsLink: !!teamsJoinUrl,
        });
      }
    } catch (calErr) {
      // Microsoft not connected, token missing, or insufficient scopes — not fatal.
      // The BMMJ meeting exists; the AM can connect Microsoft in Integrations to
      // enable auto-calendar sync going forward.
      logger.warn('POST /meetings: Outlook Calendar auto-create skipped (non-fatal)', {
        meetingId: meeting.id, error: calErr.message,
      });
    }

    // Schedule T-24 NXG360 prefetch. Non-blocking — a scheduling failure must
    // never prevent the meeting creation response from reaching the client.
    getPrefetchJob().schedule(meeting.id, meeting.tenantId, meeting.scheduledStart)
      .catch((err) => logger.warn('POST /meetings: failed to schedule T-24 prefetch (non-fatal)', {
        meetingId: meeting.id, error: err.message,
      }));

    // Queue BMMJ invitation emails to all participants.
    // Outlook already sends a calendar invite when MS is connected; this sends
    // an additional BMMJ-branded email regardless of MS connection status.
    const invitees = Array.isArray(attendees)
      ? attendees.filter((a) => a?.email).map((a) => ({
          recipientEmail: a.email,
          recipientName:  a.name  || '',
          recipientType:  'attendee',
        }))
      : [];
    if (invitees.length > 0) {
      setImmediate(() => {
        invitationService.send(meeting.id, tenantId, invitees, req.user)
          .catch((err) => logger.warn('POST /meetings: invitation emails failed (non-fatal)', {
            meetingId: meeting.id, error: err.message,
          }));
      });
    }

    res.status(201).json(meeting);
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings - List all meetings
router.get('/', async (req, res, next) => {
  try {
    const list = await meetingRepository.findAll(req.tenantId);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings/:id - Get meeting by ID
router.get('/:id', async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    // Enrich attendees with isInternal flag on every read.
    // enrichWithInternalFlag checks @nxgsecure.com domain first, then falls back
    // to a name-match against the users table so manually-added NxgSecure team
    // members (who may have no email stored in the attendees JSON) still appear
    // on the correct NxgSecure Team side rather than Customer Side.
    if (meeting.attendees && meeting.attendees.length > 0) {
      const { rows: internalUsers } = await db.query(
        `SELECT CONCAT(first_name, ' ', last_name) AS full_name, email
           FROM users
          WHERE email ILIKE '%@nxgsecure.com' AND is_active = true`
      );
      meeting.attendees = enrichWithInternalFlag(meeting.attendees, internalUsers);
    }

    res.json(meeting);
  } catch (err) {
    next(err);
  }
});

// PUT /api/meetings/:id - Update meeting fields
router.put('/:id', async (req, res, next) => {
  try {
    // Reject backdated reschedules — same 24-hour buffer as POST /meetings
    if (req.body.scheduledStart !== undefined) {
      const startMs = new Date(req.body.scheduledStart).getTime();
      if (isNaN(startMs)) {
        return res.status(400).json({ error: 'scheduledStart is not a valid date' });
      }
      if (startMs < Date.now() - 24 * 60 * 60 * 1000) {
        return res.status(400).json({ error: 'Meeting cannot be rescheduled to a date in the past' });
      }

      // Same gate as POST /meetings — rescheduling silently no-ops on the
      // calendar sync below when msEventId is missing, which is exactly how
      // the "meeting doesn't show on my calendar" bug happened. Require the
      // AM's own M365 connection before allowing a date change at all.
      const msConn = await calendarRepository.findConnectionByUserId(req.user.id, 'microsoft');
      if (!msConn || !msConn.accessTokenEnc || msConn.status === 'disconnected') {
        return res.status(424).json({
          error: 'Microsoft 365 is not connected for your account. Connect it in Integrations before rescheduling a meeting.',
          code:  'MS365_NOT_CONNECTED',
        });
      }
    }

    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const updated = await meetingRepository.update(req.params.id, req.tenantId, req.body);
    await auditLogRepository.create(updated.tenantId, req.user.email, 'Meeting Updated', { meetingId: req.params.id });

    // Keep the Outlook Calendar event in sync when the schedule changes.
    // Also ensure fred@fireflies.ai is in the attendees whenever the time changes —
    // the bot re-schedules itself based on calendar invites, so it must be present
    // at the new time regardless of when Fireflies was connected.
    if (req.body.scheduledStart && updated.msEventId) {
      setImmediate(async () => {
        try {
          const { MicrosoftTokenStore } = getTokenStore();
          const accessToken = await MicrosoftTokenStore.load(req.tenantId);
          const newStart = new Date(updated.scheduledStart).toISOString();
          const newEnd   = updated.scheduledEnd
            ? new Date(updated.scheduledEnd).toISOString()
            : new Date(new Date(updated.scheduledStart).getTime() + (updated.meetingDurationMinutes || 60) * 60 * 1000).toISOString();
          const patch = { startDateTime: newStart, endDateTime: newEnd, timeZone: req.body.timezone || 'UTC' };
          if (req.body.title) patch.subject = req.body.title;
          await getCalClient().updateCalendarEvent(accessToken, updated.msEventId, patch);
          logger.info('PUT /meetings: Outlook Calendar event updated', {
            meetingId: req.params.id, msEventId: updated.msEventId,
          });
          // Re-inject Fireflies bot after any time change so it joins at the new time
          if (await isFirefliesActiveForTenant(req.tenantId)) {
            await getCalClient().addAttendeesToEvent(accessToken, updated.msEventId, [
              { email: FIREFLIES_BOT_EMAIL, name: 'Fireflies AI Notetaker' },
            ]).catch((e) => logger.warn('PUT /meetings: Fireflies bot re-injection failed (non-fatal)', {
              meetingId: req.params.id, error: e.message,
            }));
          }
        } catch (calErr) {
          logger.warn('PUT /meetings: Outlook Calendar update skipped (non-fatal)', {
            meetingId: req.params.id, error: calErr.message,
          });
        }
      });
    }

    // When scheduledStart changes: always reschedule T-24, and auto-fire T-48
    // pipeline if the new date lands within the 48h window.
    if (req.body.scheduledStart && ['scheduled', 'approval_pending'].includes(updated.status)) {
      // Reschedule T-24 regardless of how far out the new date is.
      // Without this, moving a meeting from July 1 → July 15 would leave the
      // old prefetch job targeting June 30 and never schedule one for July 14.
      getPrefetchJob().reschedule(req.params.id, updated.tenantId, updated.scheduledStart)
        .catch((e) => logger.warn('PUT /meetings: failed to reschedule T-24 prefetch (non-fatal)', {
          meetingId: req.params.id, error: e.message,
        }));

      const hoursUntil = (new Date(updated.scheduledStart) - Date.now()) / 36e5;
      if (hoursUntil > 0 && hoursUntil <= 48) {
        // Transition scheduled → approval_pending now (awaited so client gets correct status)
        let meetingForTasks = updated;
        if (updated.status === 'scheduled') {
          try {
            meetingForTasks = await meetingRepository.triggerWorkflow(req.params.id);
            await auditLogRepository.create(updated.tenantId, req.user.email, 'Remediation Workflow Triggered', {
              meetingId: req.params.id, trigger: 'auto-t48-reschedule',
            });
          } catch (wfErr) {
            logger.warn('auto-T48 workflow transition failed (non-fatal)', {
              meetingId: req.params.id, error: wfErr.message,
            });
          }
        }
        // Fire T-48 tasks non-blocking (AI analysis now belongs to T-24 prefetch)
        setImmediate(() => {
          reportService.autoGenerateMonthlyReport(req.params.id, meetingForTasks.tenantId)
            .catch((e) => logger.error('auto-T48: monthly report failed', { meetingId: req.params.id, error: e.message }));
          emailService.queueMeetingReminderEmails(req.params.id, meetingForTasks.tenantId)
            .catch((e) => logger.error('auto-T48: reminder emails failed', { meetingId: req.params.id, error: e.message }));
        });
        logger.info('auto-T48 triggered: scheduledStart moved into 48h window', {
          meetingId: req.params.id, hoursUntil: hoursUntil.toFixed(1),
        });
        return res.json(meetingForTasks);
      }
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings/:id/history - Full meeting history (notes, files, tasks, reschedule trail)
router.get('/:id/history', async (req, res, next) => {
  try {
    const history = await meetingRepository.getHistory(req.params.id, req.tenantId);
    if (!history) return res.status(404).json({ error: 'Meeting not found' });
    res.json(history);
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/configs - Create recurring meeting config and send customer booking invite
router.post('/configs', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const {
      meetingTime, timezone, recurrencePattern,
      customerContactEmail, customerContactName, additionalParticipants,
    } = req.body;

    const participants = _parseParticipants(additionalParticipants);

    // Create config + meeting row (meeting created with booking_pending=TRUE when email provided)
    const { config, meeting } = await meetingRepository.createConfig({
      tenantId, meetingTime, timezone, recurrencePattern,
      customerContactEmail:  customerContactEmail || null,
      customerContactName:   customerContactName  || null,
      additionalParticipants: participants,
    });

    await auditLogRepository.create(tenantId, req.user.email, 'Meeting Configured', {
      meetingId: meeting.id, time: meetingTime, timezone,
    });

    // ── Booking link: send email + start watcher ─────────────────────────────
    let bookingLinkSent = false;
    let calendlyUrl     = null;
    let warning         = null;

    if (customerContactEmail) {
      const calRepo = getCalendarRepo();
      const msConn  = await calRepo.findConnectionByProvider(tenantId, 'microsoft');

      if (!msConn || msConn.status !== 'connected' || !msConn.calendlyUrl) {
        warning = msConn?.status !== 'connected'
          ? 'Meeting created but booking link not sent — Microsoft 365 is not connected. Connect it in Integrations, then use "Send Booking Link" from the meeting.'
          : 'Meeting created but booking link not sent — Calendly URL not configured. Add it in Integrations → Microsoft 365, then use "Send Booking Link" from the meeting.';
      } else {
        calendlyUrl = msConn.calendlyUrl;

        // Send the booking-link email to the customer
        try {
          const { rows: tenantRows } = await db.query(
            `SELECT c.name AS "tenantName", u.first_name AS "amFirstName", u.last_name AS "amLastName"
             FROM customers c
             LEFT JOIN users u ON u.id = c.account_manager_id
             WHERE c.id = $1 LIMIT 1`,
            [tenantId]
          );
          const tenantName = tenantRows[0]?.tenantName || 'your organization';
          const amName     = [tenantRows[0]?.amFirstName, tenantRows[0]?.amLastName].filter(Boolean).join(' ')
                             || req.user.first_name || 'Your Account Manager';

          const emailVars = {
            meetingTitle:       meeting.title,
            tenantName,
            durationMinutes:    String(meeting.meetingDurationMinutes || 60),
            accountManagerName: amName,
            bookingUrl:         _buildBookingUrl(msConn.calendlyUrl, tenantId, meeting.id),
          };

          await emailService.send({
            to:           customerContactEmail,
            subject:      `Schedule Your Security Review — ${meeting.title}`,
            templateName: 'booking-link',
            vars: { ...emailVars, recipientName: customerContactName || 'there' },
          });
          bookingLinkSent = true;

          // Fan-out to additional participants (non-fatal per recipient)
          for (const pEmail of participants) {
            try {
              await emailService.send({
                to:           pEmail,
                subject:      `Schedule Your Security Review — ${meeting.title}`,
                templateName: 'booking-link',
                vars: { ...emailVars, recipientName: 'there' },
              });
            } catch (pErr) {
              logger.warn('POST /configs: participant email failed (non-fatal)', { to: pEmail, error: pErr.message });
            }
          }
        } catch (emailErr) {
          logger.warn('POST /configs: email send failed (non-fatal)', { meetingId: meeting.id, error: emailErr.message });
          warning = 'Meeting created but the booking email could not be sent. Use "Send Booking Link" from the meeting to retry.';
        }

        // Start booking watcher (non-fatal on failure)
        try {
          await getBookingWatcher().scheduleWatcher(meeting.id, tenantId);
        } catch (watchErr) {
          logger.error('POST /configs: failed to start booking watcher', { meetingId: meeting.id, error: watchErr.message });
        }

        if (bookingLinkSent) {
          await auditLogRepository.create(tenantId, req.user.email, 'Booking Link Sent', {
            meetingId: meeting.id, to: customerContactEmail,
          });
        }
      }
    }

    res.status(201).json({ config, meeting, bookingLinkSent, calendlyUrl, warning });
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/trigger-workflow - Trigger T-48h security findings and AI compile
router.post('/:id/trigger-workflow', async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    assertTransition(meeting, 'trigger-workflow');
    const updatedMeeting = await meetingRepository.triggerWorkflow(req.params.id);
    await auditLogRepository.create(updatedMeeting.tenantId, req.user.email, 'Remediation Workflow Triggered', { meetingId: req.params.id });
    // Fire AI analysis in the background — non-blocking, errors absorbed inside service.
    preMeetingService.autoAnalyze(req.params.id, updatedMeeting.tenantId)
      .catch((err) => logger.error('trigger-workflow: autoAnalyze failed', { meetingId: req.params.id, error: err.message }));
    // Auto-generate monthly summary (idempotent — skips if one already exists for this meeting).
    reportService.autoGenerateMonthlyReport(req.params.id, updatedMeeting.tenantId)
      .catch((err) => logger.error('trigger-workflow: monthly report failed', { meetingId: req.params.id, error: err.message }));
    res.json(updatedMeeting);
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings/:id/pre-meeting-brief - NXG360 findings + AI recommendations for approval_pending meetings
router.get('/:id/pre-meeting-brief', async (req, res, next) => {
  try {
    const brief = await preMeetingService.getBrief(req.params.id, req.tenantId);
    if (!brief) return res.status(404).json({ error: 'Meeting not found' });
    res.json(brief);
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings/:id/brief/export - Download pre-meeting brief as PDF
router.get('/:id/brief/export', async (req, res, next) => {
  try {
    const pdfBuffer = await preMeetingService.exportBriefPDF(req.params.id, req.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="brief-${req.params.id.slice(0, 8)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/request-reschedule - Customer requests a meeting time change
router.post('/:id/request-reschedule', async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    assertTransition(meeting, 'request-reschedule');
    const { requestedDate, requestedTime, reason } = req.body;
    const updatedMeeting = await meetingRepository.requestReschedule(req.params.id, requestedDate, requestedTime, reason);
    await auditLogRepository.create(updatedMeeting.tenantId, req.user.email, 'Reschedule Requested', { meetingId: req.params.id, requestedDate, requestedTime });
    res.json(updatedMeeting);
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/review-reschedule - Account manager approves/rejects a reschedule request
router.post('/:id/review-reschedule', async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    assertTransition(meeting, 'review-reschedule');
    const { approved, notes } = req.body;

    // Only approving a reschedule touches the calendar (see below) — rejecting
    // one is a pure status change and shouldn't require M365 to be connected.
    if (approved) {
      const msConn = await calendarRepository.findConnectionByUserId(req.user.id, 'microsoft');
      if (!msConn || !msConn.accessTokenEnc || msConn.status === 'disconnected') {
        return res.status(424).json({
          error: 'Microsoft 365 is not connected for your account. Connect it in Integrations before approving a reschedule.',
          code:  'MS365_NOT_CONNECTED',
        });
      }
    }

    const updatedMeeting = await meetingRepository.reviewReschedule(req.params.id, approved, notes);

    let calendarSynced = false;

    if (approved) {
      const hoursUntil = (new Date(updatedMeeting.scheduledStart) - Date.now()) / 36e5;
      const needsT48   = hoursUntil > 0 && hoursUntil <= 48;

      // ── Immediate: calendar sync + Fireflies bot injection ────────────────
      // These run synchronously before the response so the AM gets confirmation
      // that the calendar is already updated and the bot is already invited.
      // The Fireflies bot determines its join time from the calendar event, so
      // both operations must complete before we return — not fire-and-forget.
      if (updatedMeeting.msEventId) {
        try {
          const { MicrosoftTokenStore } = getTokenStore();
          const accessToken = await MicrosoftTokenStore.load(updatedMeeting.tenantId);
          const newStart = new Date(updatedMeeting.scheduledStart).toISOString();
          const newEnd   = updatedMeeting.scheduledEnd
            ? new Date(updatedMeeting.scheduledEnd).toISOString()
            : new Date(new Date(updatedMeeting.scheduledStart).getTime() + (updatedMeeting.meetingDurationMinutes || 60) * 60 * 1000).toISOString();

          await getCalClient().updateCalendarEvent(accessToken, updatedMeeting.msEventId, {
            startDateTime: newStart,
            endDateTime:   newEnd,
            timeZone:      'UTC',
          });
          calendarSynced = true;
          logger.info('review-reschedule: Outlook Calendar event updated immediately', {
            meetingId: req.params.id, newStart,
          });

          if (await isFirefliesActiveForTenant(updatedMeeting.tenantId)) {
            await getCalClient().addAttendeesToEvent(accessToken, updatedMeeting.msEventId, [
              { email: FIREFLIES_BOT_EMAIL, name: 'Fireflies AI Notetaker' },
            ]).catch((botErr) => logger.warn('review-reschedule: Fireflies bot injection failed (non-fatal)', {
              meetingId: req.params.id, error: botErr.message,
            }));
            logger.info('review-reschedule: Fireflies bot ensured in calendar event', {
              meetingId: req.params.id,
            });
          }
        } catch (calErr) {
          // Log but don't fail the reschedule approval — the DB is already updated.
          // The AM can use the "Add Bot" button to retry the calendar sync manually.
          logger.error('review-reschedule: Outlook Calendar sync failed', {
            meetingId: req.params.id, error: calErr.message,
          });
        }
      }

      // ── Background: heavy side effects (non-blocking) ─────────────────────
      setImmediate(async () => {
        // Invitation regeneration
        try {
          const result = await invitationService.regenerateAfterReschedule(
            req.params.id, updatedMeeting.tenantId, req.user
          );
          await auditLogRepository.create(updatedMeeting.tenantId, req.user.email, 'Invitations Regenerated', {
            meetingId: req.params.id, regenerated: result.regenerated, trigger: 'reschedule_approval',
          });
          logger.info('Invitations auto-regenerated after reschedule approval', {
            meetingId: req.params.id, count: result.regenerated,
          });
        } catch (invErr) {
          logger.warn('Auto invite regeneration failed (non-fatal)', {
            meetingId: req.params.id, error: invErr.message,
          });
        }

        // T-48 pipeline — only when new date is within the 48h window
        if (needsT48) {
          if (updatedMeeting.status === 'scheduled') {
            meetingRepository.triggerWorkflow(req.params.id).catch((e) =>
              logger.warn('auto-T48 (reschedule approval) workflow transition failed', {
                meetingId: req.params.id, error: e.message,
              })
            );
          }
          reportService.autoGenerateMonthlyReport(req.params.id, updatedMeeting.tenantId)
            .catch((e) => logger.error('auto-T48: monthly report failed', { meetingId: req.params.id, error: e.message }));
          emailService.queueMeetingReminderEmails(req.params.id, updatedMeeting.tenantId)
            .catch((e) => logger.error('auto-T48: reminder emails failed', { meetingId: req.params.id, error: e.message }));
          logger.info('auto-T48 triggered: reschedule approved within 48h window', {
            meetingId: req.params.id, hoursUntil: hoursUntil.toFixed(1),
          });
        }

        // Always reschedule T-24 prefetch to the approved new date
        getPrefetchJob().reschedule(req.params.id, updatedMeeting.tenantId, updatedMeeting.scheduledStart)
          .catch((e) => logger.warn('reschedule approval: failed to reschedule T-24 prefetch (non-fatal)', {
            meetingId: req.params.id, error: e.message,
          }));
      });
    }

    await auditLogRepository.create(updatedMeeting.tenantId, req.user.email, approved ? 'Reschedule Approved' : 'Reschedule Rejected', { meetingId: req.params.id, notes });
    res.json({ ...updatedMeeting, calendarSynced });
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/send-booking-link
// AM clicks this after creating a placeholder meeting.
// Sends the Calendly booking link to the customer and starts the booking watcher.
router.post('/:id/send-booking-link', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });

    const meeting = await meetingRepository.findById(req.params.id, tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.status !== 'scheduled') {
      return res.status(409).json({ error: `Cannot send booking link for a meeting with status '${meeting.status}'` });
    }
    if (meeting.bookingPending) {
      return res.status(409).json({ error: 'Booking link already sent for this meeting' });
    }

    const { customerContactEmail, customerContactName, additionalParticipants } = req.body;
    if (!customerContactEmail) {
      return res.status(400).json({ error: 'customerContactEmail is required' });
    }

    const participants = _parseParticipants(additionalParticipants);

    // Get the Microsoft connection to retrieve the Calendly URL
    const calRepo = getCalendarRepo();
    const msConn  = await calRepo.findConnectionByProvider(tenantId, 'microsoft');
    if (!msConn || msConn.status !== 'connected') {
      return res.status(400).json({ error: 'Microsoft 365 is not connected. Connect it in Integrations first.' });
    }
    if (!msConn.calendlyUrl) {
      return res.status(400).json({ error: 'No Calendly URL configured. Add it in Integrations → Microsoft 365.' });
    }

    // Mark meeting as booking_pending, store contact + participant details
    const updatedMeeting = await meetingRepository.sendBookingLink(
      req.params.id, tenantId, { customerContactEmail, customerContactName, additionalParticipants: participants }
    );

    // Send the booking-link email to the customer and any additional participants
    try {
      const durationMinutes = meeting.meetingDurationMinutes || 60;
      const { rows: tenantRows } = await db.query(
        `SELECT c.name AS "tenantName", u.first_name AS "amFirstName", u.last_name AS "amLastName"
         FROM customers c
         LEFT JOIN users u ON u.id = c.account_manager_id
         WHERE c.id = $1 LIMIT 1`,
        [tenantId]
      );
      const tenantName = tenantRows[0]?.tenantName || 'your organization';
      const amName     = [tenantRows[0]?.amFirstName, tenantRows[0]?.amLastName].filter(Boolean).join(' ')
                         || req.user.first_name || 'Your Account Manager';

      const emailVars = {
        meetingTitle:       meeting.title,
        tenantName,
        durationMinutes:    String(durationMinutes),
        accountManagerName: amName,
        bookingUrl:         _buildBookingUrl(msConn.calendlyUrl, tenantId, meeting.id),
      };

      await emailService.send({
        to:           customerContactEmail,
        subject:      `Schedule Your Security Review — ${meeting.title}`,
        templateName: 'booking-link',
        vars: { ...emailVars, recipientName: customerContactName || 'there' },
      });

      // Fan-out to additional participants (non-fatal per recipient)
      for (const pEmail of participants) {
        try {
          await emailService.send({
            to:           pEmail,
            subject:      `Schedule Your Security Review — ${meeting.title}`,
            templateName: 'booking-link',
            vars: { ...emailVars, recipientName: 'there' },
          });
        } catch (pErr) {
          logger.warn('send-booking-link: participant email failed (non-fatal)', { to: pEmail, error: pErr.message });
        }
      }
    } catch (emailErr) {
      logger.warn('send-booking-link: email send failed (non-fatal)', { meetingId: req.params.id, error: emailErr.message });
    }

    // Start the booking watcher for this meeting
    try {
      await getBookingWatcher().scheduleWatcher(req.params.id, tenantId);
    } catch (watchErr) {
      logger.error('send-booking-link: failed to schedule booking watcher', { meetingId: req.params.id, error: watchErr.message });
    }

    await auditLogRepository.create(tenantId, req.user.email, 'Booking Link Sent', {
      meetingId: req.params.id, to: customerContactEmail,
    });

    logger.info('send-booking-link: done', { meetingId: req.params.id, to: customerContactEmail });
    res.json({ ...updatedMeeting, calendlyUrl: msConn.calendlyUrl });
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/conduct - Mark a meeting as conducted
router.post('/:id/conduct', async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    assertTransition(meeting, 'conduct');
    const updatedMeeting = await meetingRepository.conductMeeting(req.params.id);
    await auditLogRepository.create(updatedMeeting.tenantId, req.user.email, 'Meeting Conducted', { meetingId: req.params.id });

    // If the calendar event is still "upcoming", move it to the past so Teams/Outlook
    // stops showing it as "starting in N minutes" after the meeting is conducted early.
    if (meeting.msEventId) {
      const now          = new Date();
      const scheduledEnd = meeting.scheduledEnd ? new Date(meeting.scheduledEnd) : null;
      if (!scheduledEnd || scheduledEnd > now) {
        setImmediate(async () => {
          try {
            const { MicrosoftTokenStore } = getTokenStore();
            const accessToken = await MicrosoftTokenStore.load(req.tenantId);
            const durationMs  = (meeting.scheduledEnd && meeting.scheduledStart)
              ? new Date(meeting.scheduledEnd).getTime() - new Date(meeting.scheduledStart).getTime()
              : 60 * 60 * 1000;
            await getCalClient().updateCalendarEvent(accessToken, meeting.msEventId, {
              startDateTime: new Date(now.getTime() - durationMs).toISOString(),
              endDateTime:   now.toISOString(),
            });
            logger.info('conduct: calendar event moved to past', {
              meetingId: req.params.id, msEventId: meeting.msEventId,
            });
          } catch (err) {
            logger.warn('conduct: could not update calendar event time (non-fatal)', {
              meetingId: req.params.id, error: err.message,
            });
          }
        });
      }
    }

    // Transcript fetch: Fireflies (free-tier, Hindi+English) takes priority when
    // enabled. MS Graph is the fallback for Teams-native transcription.
    if (await isFirefliesActiveForTenant(req.tenantId)) {
      // Fireflies: poll API every 5 min for up to 2 hrs after meeting ends.
      // The Fireflies bot was invited as an attendee when the meeting was booked.
      setImmediate(async () => {
        try {
          await getFirefliesFetch().schedule(req.params.id, req.tenantId);
          logger.info('conduct: Fireflies fetch scheduled', { meetingId: req.params.id });
        } catch (err) {
          logger.warn('conduct: Fireflies fetch schedule failed (non-fatal)', { meetingId: req.params.id, error: err.message });
        }
      });
    } else if (meeting.teamsJoinUrl) {
      // Fallback: MS Graph Teams transcript (English only)
      setImmediate(async () => {
        try {
          await getTranscriptFetch().schedule(req.params.id, req.tenantId, meeting.teamsJoinUrl);
          logger.info('conduct: MS Graph transcript fetch scheduled', { meetingId: req.params.id });
        } catch (err) {
          logger.warn('conduct: MS Graph transcript fetch schedule failed (non-fatal)', { meetingId: req.params.id, error: err.message });
        }
      });
    }

    // Auto-generate the monthly summary report on conduct — idempotent, skips if already exists.
    // This covers meetings that were conducted without going through T-48 (e.g. first meeting of
    // a new tenant, meetings conducted before the T-48 window had a chance to fire).
    reportService.autoGenerateMonthlyReport(req.params.id, updatedMeeting.tenantId)
      .catch((err) => logger.warn('conduct: monthly report auto-generate failed (non-fatal)', {
        meetingId: req.params.id, error: err.message,
      }));

    res.json(updatedMeeting);
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/close - Close a meeting and carry forward unresolved action items
router.post('/:id/close', async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    assertTransition(meeting, 'close');
    const updatedMeeting = await meetingRepository.closeMeeting(req.params.id);

    // Carry forward all unresolved action items — non-blocking; failure must not prevent closure
    const actorName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email;
    let carriedCount = 0;
    try {
      const carried = await actionItemService.carryForwardForMeeting(
        req.params.id, updatedMeeting.tenantId, actorName
      );
      carriedCount = carried.length;
    } catch (cfErr) {
      logger.warn('Carry-forward failed (non-fatal)', { meetingId: req.params.id, error: cfErr.message });
    }

    await auditLogRepository.create(updatedMeeting.tenantId, req.user.email, 'Meeting Closed', {
      meetingId: req.params.id, carriedForwardCount: carriedCount,
    });
    res.json({ ...updatedMeeting, carriedForwardCount: carriedCount });
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings/:id/findings - Get security findings
router.get('/:id/findings', async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const f = await meetingRepository.findFindingsForMeeting(req.params.id);
    res.json(f);
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings/:id/tasks - Get AI remediation tasks
router.get('/:id/tasks', async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const t = await meetingRepository.findTasksForMeeting(req.params.id);
    res.json(t);
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/invitations/regenerate — re-send after a reschedule approval
router.post('/:id/invitations/regenerate', async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const result = await invitationService.regenerateAfterReschedule(
      req.params.id, req.tenantId, req.user
    );
    await auditLogRepository.create(req.tenantId, req.user.email, 'Invitations Regenerated', {
      meetingId: req.params.id, regenerated: result.regenerated,
    });
    res.json(result);
  } catch (err) {
    logger.error('Invitation regenerate failed', { error: err.message });
    next(err);
  }
});

// GET /api/meetings/:id/invitations — list all invitations for a meeting
router.get('/:id/invitations', async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const data = await invitationService.getForMeeting(req.params.id, req.tenantId);
    res.json(data);
  } catch (err) {
    logger.error('Invitation list failed', { error: err.message });
    next(err);
  }
});

// POST /api/meetings/:id/refresh-findings — super_admin only
// Forces an immediate NXG360 sync for the meeting's tenant, clears any
// PENDING-NXG360 placeholders, then regenerates findings and AI tasks.
// Use when NXG360 was unreachable at meeting creation time and findings
// need to be populated before the 6-hour background sync fires.
router.post('/:id/refresh-findings', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    // 1. Sync tenant's NXG360 data into Redis cache right now
    const syncResult = await nxg360SyncJob.syncTenant(meeting.tenantId);
    if (!syncResult.success) {
      logger.warn('refresh-findings: NXG360 sync failed, proceeding with cached data', {
        meetingId: req.params.id, tenantId: meeting.tenantId, error: syncResult.error,
      });
    }

    // 2. Remove PENDING-NXG360 placeholder findings so generateFindingsAndTasks
    //    doesn't skip due to the existing-findings guard
    await db.query(
      `DELETE FROM findings WHERE meeting_id = $1 AND title = 'PENDING-NXG360'`,
      [req.params.id]
    );

    // 3. Regenerate findings + AI task recommendations from freshly cached data
    await meetingRepository.generateFindingsAndTasks(req.params.id);

    const findings = await meetingRepository.findFindingsForMeeting(req.params.id);

    await auditLogRepository.create(meeting.tenantId, req.user.email, 'Findings Refreshed', {
      meetingId: req.params.id, findingCount: findings.length, syncSuccess: syncResult.success,
    });

    logger.info('refresh-findings: complete', {
      meetingId: req.params.id, tenantId: meeting.tenantId, findingCount: findings.length,
    });

    res.json({ refreshed: true, findingCount: findings.length, findings });
  } catch (err) {
    logger.error('refresh-findings failed', { error: err.message, meetingId: req.params.id });
    next(err);
  }
});

// POST /api/meetings/:id/trigger-t48 — super_admin only
// Manually fires all three T-48 background tasks (AI analysis, monthly report,
// reminder emails) for a specific meeting. Also transitions the meeting from
// scheduled → approval_pending if it hasn't been triggered yet.
// Use for testing, for meetings created after their T-48 window passed, or to
// re-run the pipeline after fixing data issues.
router.post('/:id/trigger-t48', auth.requireRole(['super_admin', 'account_manager']), async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    if (!['scheduled', 'approval_pending'].includes(meeting.status)) {
      return res.status(409).json({
        error: `Cannot run T-48 on a meeting with status '${meeting.status}'. Allowed: scheduled, approval_pending.`,
      });
    }

    // Transition scheduled → approval_pending if not already done
    let updatedMeeting = meeting;
    if (meeting.status === 'scheduled') {
      updatedMeeting = await meetingRepository.triggerWorkflow(req.params.id);
      await auditLogRepository.create(meeting.tenantId, req.user.email, 'Remediation Workflow Triggered', {
        meetingId: req.params.id, trigger: 'manual-t48',
      });
    }

    // Fire all three T-48 tasks in background — non-blocking, errors absorbed per task
    preMeetingService.autoAnalyze(req.params.id, updatedMeeting.tenantId)
      .catch((err) => logger.error('manual T-48: autoAnalyze failed', { meetingId: req.params.id, error: err.message }));

    reportService.autoGenerateMonthlyReport(req.params.id, updatedMeeting.tenantId)
      .catch((err) => logger.error('manual T-48: monthly report failed', { meetingId: req.params.id, error: err.message }));

    emailService.queueMeetingReminderEmails(req.params.id, updatedMeeting.tenantId)
      .catch((err) => logger.error('manual T-48: reminder emails failed', { meetingId: req.params.id, error: err.message }));

    await auditLogRepository.create(meeting.tenantId, req.user.email, 'Manual T-48 Triggered', {
      meetingId: req.params.id, tasksQueued: 3,
    });

    logger.info('manual T-48 triggered', { meetingId: req.params.id, tenantId: meeting.tenantId, by: req.user.email });

    res.json({
      triggered:   true,
      meetingId:   req.params.id,
      status:      updatedMeeting.status,
      tasksQueued: 3,
      tasks:       ['ai-analysis', 'monthly-report', 'reminder-emails'],
    });
  } catch (err) {
    logger.error('trigger-t48 failed', { error: err.message, meetingId: req.params.id });
    next(err);
  }
});

// POST /api/meetings/:id/generate-report — super_admin / account_manager
// Generates the monthly summary report for any meeting regardless of status.
// Safe for conducted/closed meetings that missed the T-48 trigger.
// autoGenerateMonthlyReport is idempotent — skips if a report already exists.
router.post('/:id/generate-report', auth.requireRole(['super_admin', 'account_manager']), async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    await reportService.autoGenerateMonthlyReport(req.params.id, meeting.tenantId);
    await auditLogRepository.create(meeting.tenantId, req.user.email, 'Monthly Report Generated', {
      meetingId: req.params.id, trigger: 'manual',
    });

    res.json({ triggered: true, meetingId: req.params.id, status: meeting.status });
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/trigger-t24 — super_admin / account_manager
// Manually fires the T-24 pipeline: fresh NXG360 pull → AI recommendations.
// Use when NXG360 data was unavailable at T-24 or to force a re-run after
// fixing a connection issue without waiting for an automatic retry.
router.post('/:id/trigger-t24', auth.requireRole(['super_admin', 'account_manager']), async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    if (!['scheduled', 'approval_pending'].includes(meeting.status)) {
      return res.status(409).json({
        error: `Cannot run T-24 on a meeting with status '${meeting.status}'. Allowed: scheduled, approval_pending.`,
      });
    }

    // reschedule() removes any existing delayed job first, then adds with delay=0.
    // Using schedule() here would silently no-op if a job with this jobId already exists.
    await getPrefetchJob().reschedule(meeting.id, meeting.tenantId, new Date(Date.now() + 1000).toISOString());

    await auditLogRepository.create(meeting.tenantId, req.user.email, 'Manual T-24 Triggered', {
      meetingId: req.params.id,
    });

    logger.info('manual T-24 triggered', { meetingId: req.params.id, tenantId: meeting.tenantId, by: req.user.email });

    res.json({
      triggered: true,
      meetingId: req.params.id,
      tasks:     ['nxg360-sync', 'ai-analysis'],
    });
  } catch (err) {
    logger.error('trigger-t24 failed', { error: err.message, meetingId: req.params.id });
    next(err);
  }
});

// POST /api/meetings/:id/upload-test-findings
// Testing fallback: upload CSV / XLSX / DOCX of NXG360 findings when the live
// API is unavailable. Writes findings into the Redis cache that FindingsProvider
// reads, then immediately runs the T-24 AI analysis pipeline.
// NOT for production — this endpoint bypasses live NXG360 entirely.
router.post(
  '/:id/upload-test-findings',
  auth.requireRole(['super_admin', 'account_manager']),
  _testFindingsUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded. Send the file as multipart/form-data field named "file".' });

      const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
      if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

      if (!['scheduled', 'approval_pending', 'conducted'].includes(meeting.status)) {
        return res.status(409).json({
          error: `Cannot upload findings for a meeting with status '${meeting.status}'. Allowed: scheduled, approval_pending, conducted.`,
        });
      }

      // Parse the uploaded file into the NXG360 findings shape
      const { parse } = require('../utils/findingsFileParser');
      let findings;
      try {
        findings = await parse(req.file.buffer, req.file.mimetype, req.file.originalname);
      } catch (parseErr) {
        return res.status(422).json({ error: parseErr.message });
      }

      if (findings.length === 0) {
        return res.status(422).json({
          error: 'No valid findings found. Ensure severity column contains "critical", "high", "medium", or "low" and title column is not empty.',
        });
      }

      // Write to Redis cache — same key FindingsProvider reads at AI analysis time
      const redisClient = require('../config/redisClient');
      await redisClient.set(
        `nxg360:findings:${meeting.tenantId}`,
        JSON.stringify(findings),
        { EX: 12 * 60 * 60 }  // 12-hour TTL — same as live NXG360 sync
      );

      // Persist findings to the DB so getBrief() and autoAnalyze() can read them
      // after a page refresh (Redis is ephemeral; DB is the source of truth for the brief panel).
      // Also clear stale pending AI tasks so the UI doesn't show recommendations that were
      // generated from a previous (possibly broken) upload — fresh upload = fresh analysis.
      await db.query('DELETE FROM findings WHERE meeting_id = $1', [req.params.id]);
      await db.query(
        `DELETE FROM ai_task_recommendations WHERE meeting_id = $1 AND approval_status = 'pending'`,
        [req.params.id]
      );
      for (const f of findings) {
        await db.query(
          `INSERT INTO findings
             (meeting_id, tenant_id, source_finding_id, severity, category, title, description, system_affected)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.params.id,
            meeting.tenantId,
            f.sourceFindingId,
            f.severity,
            f.category   || null,
            f.title,
            f.description || null,
            f.systemAffected || null,
          ]
        );
      }

      // Also update last_synced_at so the Integrations page doesn't show stale
      await db.query(
        `UPDATE nxg360_connections
         SET last_synced_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $1`,
        [meeting.tenantId]
      );

      // Run AI recommendations immediately (non-blocking)
      preMeetingService.autoAnalyze(req.params.id, meeting.tenantId)
        .catch((err) => logger.error('upload-test-findings: autoAnalyze failed', {
          meetingId: req.params.id, error: err.message,
        }));

      await auditLogRepository.create(meeting.tenantId, req.user.email, 'Test Findings Uploaded', {
        meetingId:    req.params.id,
        findingCount: findings.length,
        fileName:     req.file.originalname,
      });

      logger.info('upload-test-findings: complete', {
        meetingId:    req.params.id,
        tenantId:     meeting.tenantId,
        findingCount: findings.length,
        fileName:     req.file.originalname,
        by:           req.user.email,
      });

      res.json({
        uploaded:     true,
        findingCount: findings.length,
        fileName:     req.file.originalname,
        findings:     findings.map((f) => ({ title: f.title, severity: f.severity, category: f.category })),
        nextStep:     'AI analysis is running in the background. Refresh the Pre-Meeting Brief panel in ~30 seconds.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/meetings/:id/re-analyze
// Re-runs AI recommendation generation on already-saved findings without needing a file re-upload.
// Useful when Ollama was offline during the original upload or when the prompt has been updated.
router.post('/:id/re-analyze', auth.requireRole(['super_admin', 'account_manager']), async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    if (!['scheduled', 'approval_pending', 'conducted'].includes(meeting.status)) {
      return res.status(409).json({
        error: `Cannot re-analyze a meeting with status '${meeting.status}'. Allowed: scheduled, approval_pending, conducted.`,
      });
    }

    const { rows } = await db.query(
      `SELECT COUNT(*) AS count FROM findings WHERE meeting_id = $1`,
      [req.params.id]
    );
    if (parseInt(rows[0].count, 10) === 0) {
      return res.status(422).json({ error: 'No findings saved for this meeting. Upload a findings file first.' });
    }

    const { model } = req.body;
    preMeetingService.autoAnalyze(req.params.id, meeting.tenantId, model || undefined)
      .catch((err) => logger.error('re-analyze: autoAnalyze failed', { meetingId: req.params.id, error: err.message }));

    await auditLogRepository.create(meeting.tenantId, req.user.email, 'AI Re-Analysis Triggered', {
      meetingId: req.params.id,
    });

    res.json({ started: true, message: 'AI re-analysis started. Check back in ~30 seconds.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/invitations — send invitations to recipients
router.post('/:id/invitations', async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const { recipients } = req.body;
    if (!recipients) return res.status(400).json({ error: 'recipients array is required' });
    const result = await invitationService.send(
      req.params.id, req.tenantId, recipients, req.user
    );
    await auditLogRepository.create(req.tenantId, req.user.email, 'Invitations Sent', {
      meetingId: req.params.id, count: result.invitations.length,
    });
    res.status(201).json(result);
  } catch (err) {
    logger.error('Invitation send failed', { error: err.message });
    next(err);
  }
});

// PUT /api/meetings/:id/attendees — replace the full attendees list for a meeting.
// AM uses this via the Participants panel to add/remove people in real time.
router.put('/:id/attendees', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const { attendees } = req.body;

    if (!Array.isArray(attendees)) {
      return res.status(400).json({ error: 'attendees must be an array' });
    }

    // Validate each entry has an email; coerce role to a safe value
    const clean = attendees
      .filter((a) => a && typeof a.email === 'string' && a.email.includes('@'))
      .map((a) => ({
        email: a.email.trim().toLowerCase(),
        name:  (a.name  || '').trim(),
        role:  a.role === 'primary' ? 'primary' : 'participant',
      }));

    const result = await meetingRepository.updateAttendees(req.params.id, tenantId, clean);
    await auditLogRepository.create(tenantId, req.user.email, 'Meeting Participants Updated', {
      meetingId: req.params.id, count: clean.length,
    });
    res.json({ attendees: result.attendees });
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/add-bot — super_admin / account_manager
// Injects fred@fireflies.ai into the meeting's Outlook Calendar event so the
// Fireflies bot joins at the scheduled time. Safe to call multiple times —
// the addAttendeesToEvent helper is idempotent (no-op if bot already present).
// Use when: Fireflies was connected after the meeting was originally created,
// or when a rescheduled meeting needs the bot re-invited at the new time.
router.post('/:id/add-bot', auth.requireRole(['super_admin', 'account_manager']), async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    if (!['scheduled', 'approval_pending', 'reschedule_requested'].includes(meeting.status)) {
      return res.status(409).json({
        error: `Cannot add bot to a meeting with status '${meeting.status}'. Meeting must be upcoming (scheduled or approval_pending).`,
      });
    }

    const ffActive = await isFirefliesActiveForTenant(req.tenantId);
    if (!ffActive) {
      return res.status(422).json({
        error: 'Fireflies AI is not connected for this tenant. Connect it in Integrations → Fireflies AI first.',
      });
    }

    const { MicrosoftTokenStore } = getTokenStore();
    const accessToken = await MicrosoftTokenStore.load(req.tenantId);
    const calClient   = getCalClient();

    const newStart = new Date(meeting.scheduledStart).toISOString();
    const newEnd   = meeting.scheduledEnd
      ? new Date(meeting.scheduledEnd).toISOString()
      : new Date(new Date(meeting.scheduledStart).getTime() + (meeting.meetingDurationMinutes || 60) * 60 * 1000).toISOString();

    let msEventId = meeting.msEventId;

    // If the meeting has no linked calendar event (e.g. came in via Calendly sync
    // or was created before M365 was connected), create one now so the bot can be added.
    if (!msEventId) {
      const existingAttendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
      const calEvent = await calClient.createCalendarEvent(accessToken, {
        subject:       meeting.title,
        startDateTime: newStart,
        endDateTime:   newEnd,
        timeZone:      'UTC',
        attendees:     existingAttendees,
      });
      msEventId = calEvent.id;
      // Persist the new event ID so future operations (reschedule, conduct) can use it
      await meetingRepository.update(req.params.id, req.tenantId, { msEventId });
      logger.info('add-bot: created Outlook Calendar event for meeting', {
        meetingId: req.params.id, msEventId,
      });
    } else {
      // Event exists — sync its time to match DB in case it drifted
      await calClient.updateCalendarEvent(accessToken, msEventId, {
        startDateTime: newStart,
        endDateTime:   newEnd,
        timeZone:      'UTC',
      });
    }

    logger.info('add-bot: calendar event time synced to DB scheduled_start', {
      meetingId: req.params.id, newStart,
    });

    // Step 1 — Calendar invite: add fred@fireflies.ai as attendee.
    // Works for future meetings: bot receives the invite and joins at scheduledStart.
    // addAttendeesToEvent is idempotent — returns null (no-op) if bot already present.
    const botResult = await calClient.addAttendeesToEvent(accessToken, msEventId, [
      { email: FIREFLIES_BOT_EMAIL, name: 'Fireflies AI Notetaker' },
    ]);
    const botAlreadyPresent = !botResult;

    // Step 2 — Live injection: if the meeting has already started and has a Teams
    // join URL, also call addToLiveMeeting so the bot dispatches to the active
    // session immediately.  The calendar invite alone is insufficient once the
    // meeting is running — Fireflies only reads calendar invites for future events.
    const meetingStarted = meeting.scheduledStart && new Date(meeting.scheduledStart) <= new Date();
    let liveInjected = false;

    if (meetingStarted && meeting.teamsJoinUrl) {
      try {
        const ffConn = await getFirefliesConnRepo().findByTenant(req.tenantId);
        if (ffConn?.status === 'connected' && ffConn.apiKeyEnc) {
          const apiKey = decryptKey(ffConn.apiKeyEnc);
          const liveResult = await getFirefliesService().scheduleBotForMeeting(
            apiKey,
            meeting.teamsJoinUrl,
            meeting.title,
          );
          liveInjected = liveResult.success === true;
          logger.info('add-bot: live injection attempted', {
            meetingId: req.params.id,
            success:   liveResult.success,
            message:   liveResult.message,
          });
        }
      } catch (liveErr) {
        // Non-fatal — calendar invite is still in place; log and continue.
        logger.warn('add-bot: live injection failed (non-fatal)', {
          meetingId: req.params.id, error: liveErr.message,
        });
      }
    }

    await auditLogRepository.create(req.tenantId, req.user.email, 'Fireflies Bot Synced', {
      meetingId: req.params.id, botEmail: FIREFLIES_BOT_EMAIL,
      calendarSynced: true, botAlreadyPresent, liveInjected,
    });

    logger.info('add-bot: complete', {
      meetingId: req.params.id, msEventId, botAlreadyPresent, liveInjected, by: req.user.email,
    });

    const alreadyStarted = meetingStarted && meeting.teamsJoinUrl;
    res.json({
      calendarSynced: true,
      botAdded:       !botAlreadyPresent,
      liveInjected,
      botEmail:       FIREFLIES_BOT_EMAIL,
      scheduledStart: newStart,
      message: alreadyStarted
        ? liveInjected
          ? 'Fireflies bot dispatched to your live meeting and will join within 1–2 minutes.'
          : 'Calendar invite sent. The bot could not be dispatched live — check Fireflies connection in Integrations.'
        : botAlreadyPresent
          ? 'Calendar updated to correct time. Fireflies bot was already invited and will join at the scheduled time.'
          : 'Calendar updated and Fireflies bot invited. The bot will join automatically at the scheduled time.',
    });
  } catch (err) {
    logger.error('add-bot failed', { error: err.message, meetingId: req.params.id });
    next(err);
  }
});

// POST /api/meetings/:id/retry-transcript — super_admin / account_manager
// Clears stale transcript data and re-queues the Fireflies fetch job.
// Resets the polling window so the 2-hour timeout restarts from scratch.
router.post('/:id/retry-transcript', auth.requireRole(['super_admin', 'account_manager']), async (req, res, next) => {
  try {
    const meeting = await meetingRepository.findById(req.params.id, req.tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    if (!['conducted', 'closed'].includes(meeting.status)) {
      return res.status(409).json({
        error: `retry-transcript requires a conducted or closed meeting (current: ${meeting.status})`,
      });
    }

    const ffConn = await getFirefliesConnRepo().findByTenant(req.tenantId);
    if (!ffConn || ffConn.status !== 'connected') {
      return res.status(422).json({
        error: 'No active Fireflies connection for this tenant. Re-connect Fireflies in Integrations first.',
      });
    }

    // 1. Wipe transcript columns + reset polling timestamps so the 2-hour window restarts
    await db.query(
      `UPDATE meetings
       SET  transcript_text                = NULL,
            fireflies_transcript_id        = NULL,
            transcript_status              = 'not_started',
            transcript_fetched_at          = NULL,
            transcript_polling_started_at  = NULL,
            notes_status                   = NULL,
            updated_at                     = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    // 2. Delete structured notes so the pipeline starts fresh
    await db.query(
      `DELETE FROM meeting_notes WHERE meeting_id = $1`,
      [req.params.id]
    );

    // 3. Remove only pending AI recommendations (keep approved/rejected — AM decisions)
    await db.query(
      `DELETE FROM ai_task_recommendations
       WHERE meeting_id    = $1
         AND analysis_type = 'post_meeting'
         AND approval_status = 'pending'`,
      [req.params.id]
    );

    // 4. Re-schedule Fireflies fetch (resets polling_started_at so 2-hour window is fresh)
    await getFirefliesFetch().schedule(req.params.id, req.tenantId);

    await auditLogRepository.create(req.tenantId, req.user.email, 'Transcript Retry Requested', {
      meetingId: req.params.id,
    });

    logger.info('retry-transcript: Fireflies re-fetch scheduled', {
      meetingId: req.params.id,
      tenantId:  req.tenantId,
      by:        req.user.email,
    });

    res.json({
      scheduled: true,
      meetingId: req.params.id,
      message:   'Transcript data cleared. Fireflies fetch re-queued — transcript will arrive within 5–15 minutes.',
    });
  } catch (err) {
    logger.error('retry-transcript failed', { error: err.message, meetingId: req.params.id });
    next(err);
  }
});

module.exports = router;
