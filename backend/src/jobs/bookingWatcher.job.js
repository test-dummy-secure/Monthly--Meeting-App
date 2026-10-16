'use strict';

const { Queue, Worker } = require('bullmq');
const { connection, onWorkerError } = require('../config/bullmq');
const logger            = require('../utils/logger');

// Lazy-load to avoid circular deps at startup
const getMeetingRepo       = () => require('../repositories/meeting.repository');
const getCalRepo           = () => require('../repositories/calendar.repository');
const getEmailService      = () => require('../services/email.service');
const getAuditRepo         = () => require('../repositories/audit-log.repository');
const getTokenStore        = () => require('../services/microsoft/MicrosoftTokenStore');
const getCalClient         = () => require('../services/microsoft/MicrosoftCalendarClient');
const getFirefliesService  = () => require('../services/fireflies.service');
const getFirefliesConnRepo = () => require('../repositories/fireflies-connection.repository');
const { decrypt }          = require('../utils/encryption');

const WATCHER_QUEUE   = 'booking-watcher';
const CONDUCT_QUEUE   = 'meeting-auto-conduct';
const BOT_INJECT_QUEUE = 'fireflies-bot-inject';
const POLL_INTERVAL   = 2  * 60 * 1000;   // 2 minutes
const EXPIRY_WINDOW   = 7  * 24 * 60 * 60 * 1000; // 7 days
const CONDUCT_BUFFER  = 30 * 60 * 1000;   // 30 min after scheduled_end
const BOT_LEAD_TIME   = 5  * 60 * 1000;   // inject bot 5 min before scheduledStart

let watcherQueue   = null;
let conductQueue   = null;
let botInjectQueue = null;
let watcherWorker  = null;
let conductWorker   = null;
let botInjectWorker = null;
let _sweepTimer     = null;

// ── Lifecycle sweep (Calendly & direct bookings) ──────────────────────────────
// Calendly-booked meetings land in BMMJ with status='scheduled', booking_pending=false,
// and a teamsJoinUrl — but NO delayed jobs are queued because they bypass the
// bookingWatcher poll flow entirely.  This sweep runs every 2 minutes and uses
// idempotent BullMQ jobIds so meetings already covered by bookingWatcher (which has
// its own auto-conduct delayed job) are never double-processed.
//
// For each confirmed upcoming meeting within the bot-injection window:
//   → queue bot-inject  (fires at scheduledStart − BOT_LEAD_TIME, or immediately if past)
// For each confirmed meeting past scheduledEnd + CONDUCT_BUFFER:
//   → queue auto-conduct (fires immediately)

async function sweepScheduledMeetings() {
  const db = require('../config/db');

  let meetings;
  try {
    const { rows } = await db.query(
      `SELECT id,
              tenant_id       AS "tenantId",
              title,
              teams_join_url  AS "teamsJoinUrl",
              scheduled_start AS "scheduledStart",
              scheduled_end   AS "scheduledEnd"
       FROM   meetings
       WHERE  status           = 'scheduled'
         AND  booking_pending  = false
         AND  scheduled_start  IS NOT NULL`,
    );
    meetings = rows;
  } catch (err) {
    logger.warn('meetingSweep: DB query failed', { error: err.message });
    return;
  }

  if (meetings.length === 0) return;

  const now = Date.now();

  for (const m of meetings) {
    // ── Resolve Calendly redirect URLs to real Teams join URLs ───────────────
    // Calendly wraps the Teams URL in a redirect (https://calendly.com/events/…/microsoft_teams).
    // The actual teams.microsoft.com URL is in the organizer's MS 365 calendar event.
    // Resolve it once here and persist it so bot injection and transcript fetch work.
    let teamsJoinUrl = m.teamsJoinUrl;
    if (teamsJoinUrl && teamsJoinUrl.startsWith('https://calendly.com/')) {
      teamsJoinUrl = await _resolveCalendlyTeamsUrl(m, db) || teamsJoinUrl;
    }

    const startMs = new Date(m.scheduledStart).getTime();
    const endMs   = m.scheduledEnd
      ? new Date(m.scheduledEnd).getTime()
      : startMs + 60 * 60 * 1000; // assume 60-min meeting if no end time

    // ── Bot injection ───────────────────────────────────────────────────────
    // Window: from BOT_LEAD_TIME before start until 30 min after start.
    // Prevents injecting the bot into a meeting that started more than 30 min ago
    // (it has almost certainly ended or has no useful recording time left).
    const botWindowOpen  = startMs - BOT_LEAD_TIME;
    const botWindowClose = startMs + 30 * 60 * 1000;

    if (teamsJoinUrl && !teamsJoinUrl.startsWith('https://calendly.com/') &&
        now >= botWindowOpen && now < botWindowClose && botInjectQueue) {
      const botDelay = Math.max(startMs - BOT_LEAD_TIME - now, 0);
      await botInjectQueue.add('inject-bot', {
        meetingId:    m.id,
        tenantId:     m.tenantId,
        teamsJoinUrl,
        meetingTitle: m.title,
      }, {
        jobId:            `bot-inject-${m.id}`,   // idempotent — BullMQ rejects duplicates
        delay:            botDelay,
        removeOnComplete: { count: 50 },
        removeOnFail:     { count: 20 },
      }).catch(() => {}); // silently ignore "already exists" rejections
    }

    // ── Auto-conduct ────────────────────────────────────────────────────────
    // Fire when scheduledEnd + CONDUCT_BUFFER has elapsed.
    if (now >= endMs + CONDUCT_BUFFER && conductQueue) {
      await conductQueue.add('auto-conduct', {
        meetingId: m.id,
        tenantId:  m.tenantId,
      }, {
        jobId:            `auto-conduct-${m.id}`,  // idempotent
        delay:            0,
        removeOnComplete: { count: 50 },
        removeOnFail:     { count: 20 },
      }).catch(() => {});
    }
  }
}

// Looks up the organizer's MS 365 calendar to find the real Teams join URL for
// a Calendly-created meeting (Calendly only exposes its own redirect URL via API).
// Updates the DB record in-place and returns the resolved URL, or null on failure.
//
// Token fallback: an AM may manage multiple BMMJ tenants but has only one Microsoft
// calendar. If the meeting's own tenant has no calendar connection (e.g. a newer
// customer tenant where the AM hasn't re-connected), we fall back to any other tenant
// managed by the same AM that does have a connected token — same Microsoft account,
// same calendar view.
async function _resolveCalendlyTeamsUrl(meeting, db) {
  try {
    const { MicrosoftTokenStore } = getTokenStore();
    const calClient = getCalClient();

    let accessToken;
    try {
      accessToken = await MicrosoftTokenStore.load(meeting.tenantId);
    } catch {
      // No token for this tenant — look for a connected tenant managed by the same AM
      const { rows: fallback } = await db.query(
        `SELECT cc.tenant_id
         FROM   calendar_connections cc
         JOIN   customers c   ON c.id   = cc.tenant_id
         JOIN   customers src ON src.account_manager_id = c.account_manager_id
         WHERE  src.id        = $1
           AND  cc.status     = 'connected'
           AND  cc.tenant_id != $1
         LIMIT  1`,
        [meeting.tenantId]
      );
      if (!fallback.length) {
        logger.info('meetingSweep: no calendar token for tenant or AM, skipping URL resolve', {
          meetingId: meeting.id, tenantId: meeting.tenantId,
        });
        return null;
      }
      accessToken = await MicrosoftTokenStore.load(fallback[0].tenant_id);
      logger.info('meetingSweep: using fallback tenant token to resolve Calendly URL', {
        meetingId: meeting.id, fallbackTenant: fallback[0].tenant_id,
      });
    }

    // Search calendar events whose start time falls within ±45 min of scheduledStart.
    // Uses calendarView (filters by event start time) not getCalendarEvents (filters by
    // createdDateTime) — the Calendly meeting may have been created days before we run
    // this resolver, so a createdDateTime filter would miss it entirely.
    const startMs    = new Date(meeting.scheduledStart).getTime();
    const windowFrom = new Date(startMs - 45 * 60 * 1000).toISOString();
    const windowTo   = new Date(startMs + 45 * 60 * 1000).toISOString();

    const events = await calClient.getCalendarView(accessToken, windowFrom, windowTo);
    const target  = (events || []).find((e) => e.onlineMeeting?.joinUrl);

    if (!target?.onlineMeeting?.joinUrl) return null;

    const realUrl = target.onlineMeeting.joinUrl;

    // Patch the Teams meeting to allow recording by all participants.
    // Calendly-created meetings default to organizer-only recording, which blocks
    // the Fireflies bot even when the org admin policy has recording enabled.
    try {
      const onlineMeeting = await calClient.getOnlineMeetingByJoinUrl(accessToken, realUrl);
      if (onlineMeeting?.id) {
        await calClient.updateOnlineMeetingRecording(accessToken, onlineMeeting.id);
        logger.info('meetingSweep: patched Teams meeting to allow recording + transcription', {
          meetingId: meeting.id, onlineMeetingId: onlineMeeting.id,
        });
      }
    } catch (patchErr) {
      // Non-fatal: URL is still saved and bot will attempt to join regardless.
      logger.warn('meetingSweep: could not patch Teams meeting recording (non-fatal)', {
        meetingId: meeting.id, error: patchErr.message,
      });
    }

    await db.query(
      `UPDATE meetings SET teams_join_url = $1, updated_at = NOW() WHERE id = $2`,
      [realUrl, meeting.id]
    );
    logger.info('meetingSweep: resolved Calendly redirect to real Teams URL', {
      meetingId: meeting.id, teamsJoinUrl: realUrl,
    });
    return realUrl;
  } catch (err) {
    logger.warn('meetingSweep: could not resolve Calendly Teams URL (non-fatal)', {
      meetingId: meeting.id, error: err.message,
    });
    return null;
  }
}

// ── Booking detection ─────────────────────────────────────────────────────────

async function processWatcher(job) {
  const { meetingId, tenantId } = job.data;
  const meetingRepo = getMeetingRepo();

  // Load meeting — if gone or no longer pending, stop silently
  const meeting = await meetingRepo.findById(meetingId, tenantId);
  if (!meeting) {
    logger.info('bookingWatcher: meeting no longer exists, stopping', { meetingId });
    return { done: true, reason: 'meeting_deleted' };
  }
  if (!meeting.bookingPending) {
    logger.info('bookingWatcher: meeting already confirmed, stopping', { meetingId });
    return { done: true, reason: 'already_confirmed' };
  }

  // Check expiry — 7 days since booking link was sent
  const sentAt   = new Date(meeting.bookingLinkSentAt);
  const elapsed  = Date.now() - sentAt.getTime();
  if (elapsed >= EXPIRY_WINDOW) {
    logger.info('bookingWatcher: booking link expired', { meetingId });
    await _handleExpiry(meeting);
    return { done: true, reason: 'expired' };
  }

  // Load AM's Microsoft token
  const { MicrosoftTokenStore, TokenExpiredError, PermissionDeniedError, GraphApiUnavailableError } = getTokenStore();
  let accessToken;
  try {
    accessToken = await MicrosoftTokenStore.load(tenantId);
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof PermissionDeniedError) {
      logger.warn('bookingWatcher: Microsoft auth failed, stopping watcher', { meetingId, error: err.message });
      await _handleAuthFailure(meeting, err.message);
      return { done: true, reason: 'auth_failure' };
    }
    // Transient — re-queue and retry
    logger.warn('bookingWatcher: transient token error, will retry', { meetingId, error: err.message });
    await _requeue(job.data);
    return { done: false, reason: 'transient_token_error' };
  }

  // Fetch calendar events created after the booking link was sent
  const calClient = getCalClient();
  let events;
  try {
    events = await calClient.getCalendarEvents(accessToken, meeting.bookingLinkSentAt);
    await MicrosoftTokenStore.markVerified(tenantId);
  } catch (err) {
    const { GraphApiUnavailableError: GErr } = getTokenStore();
    if (err instanceof GErr) {
      logger.warn('bookingWatcher: Graph API transient error, will retry', { meetingId, error: err.message });
      await _requeue(job.data);
      return { done: false, reason: 'graph_transient' };
    }
    throw err;
  }

  // Match: Teams link present + customer email attendee + correct duration
  const match = _findBookingMatch(events, meeting);
  if (!match) {
    // Not booked yet — re-queue
    await _requeue(job.data);
    return { done: false, reason: 'not_booked_yet' };
  }

  // Booking confirmed — update the meeting record
  logger.info('bookingWatcher: booking detected!', {
    meetingId,
    subject:    match.subject,
    start:      match.start?.dateTime,
    customerEmail: meeting.customerContactEmail,
  });

  await meetingRepo.confirmBooking(meetingId, tenantId, {
    scheduledStart: match.start.dateTime,
    scheduledEnd:   match.end.dateTime,
    msEventId:      match.id,
    teamsJoinUrl:   match.onlineMeeting.joinUrl,
  });

  // Schedule auto-conduct delayed job at scheduledEnd + 15 min
  const conductAt = new Date(match.end.dateTime).getTime() + CONDUCT_BUFFER;
  const delay     = Math.max(conductAt - Date.now(), 0);
  await conductQueue.add('auto-conduct', { meetingId, tenantId }, {
    jobId:  `auto-conduct-${meetingId}`,
    delay,
    removeOnComplete: { count: 50 },
    removeOnFail:     { count: 20 },
  });

  // Schedule Fireflies bot injection 5 min before scheduledStart so the bot
  // is waiting in the lobby when the meeting opens.  If the meeting starts in
  // less than 5 min, delay = 0 (inject immediately).
  if (botInjectQueue) {
    const botAt    = new Date(match.start.dateTime).getTime() - BOT_LEAD_TIME;
    const botDelay = Math.max(botAt - Date.now(), 0);
    await botInjectQueue.add('inject-bot', {
      meetingId,
      tenantId,
      teamsJoinUrl:  match.onlineMeeting.joinUrl,
      meetingTitle:  match.subject || meeting.title,
    }, {
      jobId:            `bot-inject-${meetingId}`,
      delay:            botDelay,
      removeOnComplete: { count: 50 },
      removeOnFail:     { count: 20 },
    });
    logger.info('bookingWatcher: Fireflies bot injection scheduled', {
      meetingId,
      delay: `${Math.round(botDelay / 60000)} min`,
    });
  }

  // Audit log
  await getAuditRepo().create(tenantId, 'system@bmmj.internal', 'Booking Confirmed via Microsoft Calendar', {
    meetingId,
    msEventId:    match.id,
    teamsJoinUrl: match.onlineMeeting.joinUrl,
    start:        match.start.dateTime,
  }).catch(() => {});

  logger.info('bookingWatcher: auto-conduct scheduled', { meetingId, delay: `${Math.round(delay / 60000)} min` });
  return { done: true, reason: 'booking_confirmed' };
}

// ── Auto-conduct ──────────────────────────────────────────────────────────────

async function processAutoConduct(job) {
  const { meetingId, tenantId } = job.data;
  const meetingRepo = getMeetingRepo();

  const meeting = await meetingRepo.findById(meetingId, tenantId);
  if (!meeting) {
    logger.info('autoConduct: meeting not found', { meetingId });
    return;
  }

  // Only conduct from scheduled or approval_pending
  if (!['scheduled', 'approval_pending'].includes(meeting.status)) {
    logger.info('autoConduct: meeting already past conductable state', { meetingId, status: meeting.status });
    return;
  }

  try {
    // If still in scheduled, transition to approval_pending first
    if (meeting.status === 'scheduled') {
      await meetingRepo.triggerWorkflow(meetingId);
      logger.info('autoConduct: transitioned scheduled → approval_pending', { meetingId });
    }

    await meetingRepo.conductMeeting(meetingId);
    logger.info('autoConduct: meeting marked as conducted', { meetingId });

    await getAuditRepo().create(tenantId, 'system@bmmj.internal', 'Meeting Auto-Conducted', {
      meetingId, trigger: 'auto-conduct-job',
    }).catch(() => {});

    // Fire transcript fetch jobs (non-blocking, schedule independently).
    // MS Teams transcript: polls Graph API for the Teams meeting recording.
    // Fireflies transcript: polls Fireflies AI if the bot was present in the meeting.
    // Both run in parallel — whichever captures the transcript first wins; the other
    // stops when it sees transcript_status = 'captured'.
    const transcriptJob  = require('./transcriptFetch.job');
    const firefliesJob   = require('./firefliesFetch.job');
    await transcriptJob.schedule(meetingId, tenantId, meeting.teamsJoinUrl);
    await firefliesJob.schedule(meetingId, tenantId);

  } catch (err) {
    logger.error('autoConduct: failed to conduct meeting', { meetingId, error: err.message });
    throw err;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _findBookingMatch(events, meeting) {
  const customerEmail  = (meeting.customerContactEmail || '').toLowerCase();
  const expectedMinutes = meeting.meetingDurationMinutes || 60;

  for (const event of events) {
    // Must have a Teams meeting URL (Calendly's Teams integration creates this)
    if (!event.onlineMeeting?.joinUrl) continue;

    // Must have the customer's email as an attendee
    const hasCustomer = (event.attendees || []).some(
      a => (a.emailAddress?.address || '').toLowerCase() === customerEmail
    );
    if (!hasCustomer) continue;

    // Must be in the future
    if (event.start?.dateTime && new Date(event.start.dateTime) <= new Date()) continue;

    // Duration must match expected (±10 min tolerance)
    if (event.start?.dateTime && event.end?.dateTime) {
      const durationMin = (new Date(event.end.dateTime) - new Date(event.start.dateTime)) / 60000;
      if (Math.abs(durationMin - expectedMinutes) > 10) continue;
    }

    return event; // First match wins
  }
  return null;
}

async function _requeue(data) {
  try {
    await watcherQueue.add('watch', data, {
      jobId:            `watch-${data.meetingId}`,
      delay:            POLL_INTERVAL,
      removeOnComplete: { count: 10 },
      removeOnFail:     { count: 10 },
    });
  } catch (err) {
    logger.error('bookingWatcher: failed to re-queue', { meetingId: data.meetingId, error: err.message });
  }
}

async function _handleExpiry(meeting) {
  try {
    await getMeetingRepo().updateBookingExpired(meeting.id, meeting.tenantId);
    await getEmailService().send({
      to:           meeting.customerContactEmail || '',
      subject:      `Booking Link Expired — ${meeting.title}`,
      templateName: 'booking-expired',
      vars: {
        recipientName: meeting.customerContactName || 'there',
        meetingTitle:  meeting.title,
      },
    }).catch(() => {});
    logger.info('bookingWatcher: booking expired, AM notified', { meetingId: meeting.id });
  } catch (err) {
    logger.error('bookingWatcher: expiry handler failed', { meetingId: meeting.id, error: err.message });
  }
}

async function _handleAuthFailure(meeting, errorMessage) {
  try {
    await getCalRepo().updateConnectionError(
      meeting.tenantId, 'microsoft', 'expired', errorMessage
    );
    logger.warn('bookingWatcher: Microsoft auth failed, connection marked expired', {
      meetingId: meeting.id, tenantId: meeting.tenantId,
    });
  } catch (err) {
    logger.error('bookingWatcher: auth failure handler failed', { error: err.message });
  }
}

// ── Fireflies bot injection ───────────────────────────────────────────────────

async function processBotInject(job) {
  const { meetingId, tenantId, teamsJoinUrl, meetingTitle } = job.data;

  if (!teamsJoinUrl) {
    logger.info('botInject: no teamsJoinUrl, skipping', { meetingId });
    return;
  }

  // Load per-tenant Fireflies connection
  const ffConn = await getFirefliesConnRepo().findByTenant(tenantId).catch(() => null);
  if (!ffConn || ffConn.status !== 'connected') {
    logger.info('botInject: no active Fireflies connection for tenant, skipping', { meetingId, tenantId });
    return;
  }

  let apiKey;
  try {
    apiKey = decrypt(ffConn.apiKeyEnc);
  } catch (err) {
    logger.error('botInject: could not decrypt Fireflies API key', { meetingId, error: err.message });
    return;
  }

  try {
    const result = await getFirefliesService().scheduleBotForMeeting(apiKey, teamsJoinUrl, meetingTitle);
    if (result.success) {
      logger.info('botInject: Fireflies bot successfully scheduled for meeting', { meetingId, message: result.message });
    } else {
      logger.warn('botInject: Fireflies bot scheduling returned success=false', { meetingId, message: result.message });
    }
    await getAuditRepo().create(tenantId, 'system@bmmj.internal', 'Fireflies Bot Scheduled', {
      meetingId, teamsJoinUrl, success: result.success, message: result.message,
    }).catch(() => {});
  } catch (err) {
    // Non-fatal: bot inject failure should not block the meeting lifecycle.
    // The meeting will still be auto-conducted and transcript polling will run.
    logger.error('botInject: Fireflies bot scheduling failed (non-fatal)', {
      meetingId, error: err.message, code: err.code,
    });
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function start() {
  try {
    const queueOpts = {
      connection,
      defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 50 } },
    };

    watcherQueue   = new Queue(WATCHER_QUEUE,    queueOpts);
    conductQueue   = new Queue(CONDUCT_QUEUE,    queueOpts);
    botInjectQueue = new Queue(BOT_INJECT_QUEUE, queueOpts);

    watcherWorker   = new Worker(WATCHER_QUEUE,    processWatcher,    { connection, concurrency: 5 });
    conductWorker   = new Worker(CONDUCT_QUEUE,    processAutoConduct, { connection, concurrency: 3 });
    botInjectWorker = new Worker(BOT_INJECT_QUEUE, processBotInject,   { connection, concurrency: 3 });

    _attachWorkerEvents(watcherWorker,   'bookingWatcher');
    _attachWorkerEvents(conductWorker,   'autoConduct');
    _attachWorkerEvents(botInjectWorker, 'botInject');

    // Recovery: re-queue watchers for meetings still in booking_pending
    setImmediate(async () => {
      try {
        const pending = await getMeetingRepo().findBookingPendingMeetings();
        if (pending.length > 0) {
          logger.info('bookingWatcher: recovery scan found pending meetings', { count: pending.length });
          for (const m of pending) {
            await watcherQueue.add('watch', { meetingId: m.id, tenantId: m.tenantId }, {
              jobId:            `watch-${m.id}`,
              delay:            POLL_INTERVAL,
              removeOnComplete: { count: 10 },
              removeOnFail:     { count: 10 },
            });
          }
        }
      } catch (err) {
        logger.warn('bookingWatcher: recovery scan failed', { error: err.message });
      }
    });

    // Lifecycle sweep: every 2 min, find confirmed meetings that need bot injection
    // or auto-conduct but have no BullMQ job queued (Calendly-booked meetings bypass
    // the bookingWatcher poll and land without any delayed jobs).
    // Runs once immediately at startup to catch meetings created while server was down.
    setImmediate(() => sweepScheduledMeetings().catch((e) =>
      logger.warn('meetingSweep: startup run failed', { error: e.message })
    ));
    _sweepTimer = setInterval(
      () => sweepScheduledMeetings().catch((e) =>
        logger.warn('meetingSweep: interval run failed', { error: e.message })
      ),
      POLL_INTERVAL, // every 2 minutes — same cadence as booking watcher
    );
    _sweepTimer.unref();

    logger.info('bookingWatcher + autoConduct + botInject + meetingSweep started');
  } catch (err) {
    logger.error('bookingWatcher: failed to start — Redis may be unavailable', { error: err.message });
  }
}

async function stop() {
  try {
    if (_sweepTimer)     { clearInterval(_sweepTimer); _sweepTimer = null; }
    if (watcherWorker)   await watcherWorker.close();
    if (conductWorker)   await conductWorker.close();
    if (botInjectWorker) await botInjectWorker.close();
    if (watcherQueue)    await watcherQueue.close();
    if (conductQueue)    await conductQueue.close();
    if (botInjectQueue)  await botInjectQueue.close();
    logger.info('bookingWatcher + autoConduct + botInject + meetingSweep stopped');
  } catch (err) {
    logger.warn('bookingWatcher stop error', { error: err.message });
  }
}

/**
 * Called by meeting.routes.js after sending booking link email.
 * Immediately queues the first watcher poll.
 */
async function scheduleWatcher(meetingId, tenantId) {
  if (!watcherQueue) {
    logger.error('bookingWatcher.scheduleWatcher: queue not initialized');
    return;
  }
  await watcherQueue.add('watch', { meetingId, tenantId }, {
    jobId:            `watch-${meetingId}`,
    delay:            0,
    removeOnComplete: { count: 10 },
    removeOnFail:     { count: 10 },
  });
  logger.info('bookingWatcher: watcher queued', { meetingId });
}

function _attachWorkerEvents(worker, name) {
  worker.on('completed', (job) => {
    logger.info(`${name}: job completed`, { jobId: job.id });
  });
  worker.on('failed', (job, err) => {
    logger.error(`${name}: job failed`, { jobId: job?.id, error: err.message });
  });
  worker.on('error', onWorkerError(`${name} worker`));
}

module.exports = { start, stop, scheduleWatcher };
