'use strict';

const { Queue, Worker } = require('bullmq');
const { connection, onWorkerError } = require('../config/bullmq');
const logger            = require('../utils/logger');

const getMeetingRepo    = () => require('../repositories/meeting.repository');
const getAuditRepo      = () => require('../repositories/audit-log.repository');
const getEmailService   = () => require('../services/email.service');
const getTokenStore     = () => require('../services/microsoft/MicrosoftTokenStore');
const getCalClient      = () => require('../services/microsoft/MicrosoftCalendarClient');

const QUEUE_NAME        = 'transcript-fetch';
const POLL_INTERVAL     = 5  * 60 * 1000;  // 5 minutes between polls
const MAX_DURATION      = 2  * 60 * 60 * 1000; // 2-hour total window
const MAX_ATTEMPTS      = Math.ceil(MAX_DURATION / POLL_INTERVAL); // 24

let queue  = null;
let worker = null;

// ── Core processor ────────────────────────────────────────────────────────────

async function processTranscript(job) {
  const { meetingId, tenantId, teamsJoinUrl, attempt = 1, startedAt } = job.data;
  const start = startedAt || Date.now();

  // Time-box: if we've been trying for > 2 hours, give up
  if (Date.now() - start >= MAX_DURATION) {
    logger.info('transcriptFetch: 2-hour window elapsed, giving up', { meetingId });
    await _handleNoTranscript(meetingId, tenantId, 'timeout');
    return;
  }

  const meeting = await getMeetingRepo().findById(meetingId, tenantId);
  if (!meeting || meeting.status !== 'conducted') {
    logger.info('transcriptFetch: meeting not in conducted state, stopping', { meetingId, status: meeting?.status });
    return;
  }

  // If Fireflies already captured the transcript, stop — don't overwrite
  if (meeting.transcriptStatus === 'captured') {
    logger.info('transcriptFetch: transcript already captured by Fireflies, stopping', { meetingId });
    return;
  }

  // ── Step 1: Get Teams meeting object ID from join URL ──────────────────────
  const { MicrosoftTokenStore, TokenExpiredError, PermissionDeniedError } = getTokenStore();
  let accessToken;
  try {
    accessToken = await MicrosoftTokenStore.load(tenantId);
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof PermissionDeniedError) {
      logger.warn('transcriptFetch: Microsoft auth failed, stopping', { meetingId, error: err.message });
      await _handleAuthFailure(meetingId, tenantId, err.message);
      return;
    }
    // Transient — retry
    await _requeue({ meetingId, tenantId, teamsJoinUrl, attempt: attempt + 1, startedAt: start });
    return;
  }

  const calClient = getCalClient();

  // Resolve teamsMeetingId if we don't have it yet
  let teamsMeetingId = meeting.teamsMeetingId;
  if (!teamsMeetingId && teamsJoinUrl) {
    try {
      const onlineMeeting = await calClient.getOnlineMeetingByJoinUrl(accessToken, teamsJoinUrl);
      if (onlineMeeting?.id) {
        teamsMeetingId = onlineMeeting.id;
        await getMeetingRepo().updateTeamsMeetingId(meetingId, teamsMeetingId);
      }
    } catch (err) {
      logger.warn('transcriptFetch: could not resolve teamsMeetingId', { meetingId, error: err.message });
      // Continue — will retry next poll
    }
  }

  if (!teamsMeetingId) {
    if (!teamsJoinUrl) {
      // Meeting has no Teams join URL — it was not held via Teams (e.g. Fireflies-only).
      // Stop immediately without sending an email; the Fireflies job handles it.
      logger.info('transcriptFetch: no teamsJoinUrl and no teamsMeetingId — not a Teams meeting, stopping', { meetingId });
      await getMeetingRepo().updateTranscriptStatus(meetingId, 'unavailable').catch(() => {});
      return;
    }
    logger.info('transcriptFetch: no teamsMeetingId yet, retrying', { meetingId, attempt });
    await _requeue({ meetingId, tenantId, teamsJoinUrl, attempt: attempt + 1, startedAt: start });
    return;
  }

  // ── Step 2: Poll for transcripts ──────────────────────────────────────────
  let transcripts;
  try {
    transcripts = await calClient.getTranscripts(accessToken, teamsMeetingId);
  } catch (err) {
    const { GraphApiUnavailableError } = getTokenStore();
    if (err instanceof GraphApiUnavailableError) {
      logger.warn('transcriptFetch: Graph transient error, retrying', { meetingId, attempt, error: err.message });
      await _requeue({ meetingId, tenantId, teamsJoinUrl, attempt: attempt + 1, startedAt: start });
      return;
    }
    throw err;
  }

  if (!transcripts || transcripts.length === 0) {
    logger.info('transcriptFetch: no transcript yet', { meetingId, attempt });
    await _requeue({ meetingId, tenantId, teamsJoinUrl, attempt: attempt + 1, startedAt: start });
    return;
  }

  // ── Step 3: Download and save transcript ──────────────────────────────────
  const latestTranscript = transcripts[transcripts.length - 1];
  logger.info(`transcriptFetch: transcript metadata id=${latestTranscript.id} contentUrl=${latestTranscript.transcriptContentUrl || 'none'} created=${latestTranscript.createdDateTime}`);
  let transcriptText;
  try {
    transcriptText = await calClient.downloadTranscript(accessToken, teamsMeetingId, latestTranscript.id, latestTranscript.transcriptContentUrl);
  } catch (err) {
    logger.warn('transcriptFetch: transcript download failed, retrying', { meetingId, error: err.message });
    await _requeue({ meetingId, tenantId, teamsJoinUrl, attempt: attempt + 1, startedAt: start });
    return;
  }

  if (!transcriptText || transcriptText.trim().length === 0) {
    logger.warn('transcriptFetch: transcript empty, retrying', { meetingId });
    await _requeue({ meetingId, tenantId, teamsJoinUrl, attempt: attempt + 1, startedAt: start });
    return;
  }

  // ── Step 4: Persist transcript ────────────────────────────────────────────
  await getMeetingRepo().saveTranscript(meetingId, tenantId, transcriptText);
  await MicrosoftTokenStore.markVerified(tenantId);

  logger.info('transcriptFetch: transcript saved successfully', {
    meetingId,
    length: transcriptText.length,
    attempt,
  });

  await getAuditRepo().create(tenantId, 'system@bmmj.internal', 'Meeting Transcript Imported', {
    meetingId, source: 'ms_teams_transcript', length: transcriptText.length,
  }).catch(() => {});

  // ── Step 5: Run notes pipeline → generates AI task recommendations ────────
  // Fire-and-forget: transcript feeds through preprocessor → structurer → AI
  // → ai_task_recommendations rows (analysis_type='post_meeting') for AM review.
  setImmediate(async () => {
    try {
      const MeetingNotesService = require('../services/meetingNotes.service');
      await MeetingNotesService.processNotes('microsoft', meetingId, tenantId, {
        transcriptText,
      });
      logger.info('transcriptFetch: notes pipeline triggered', { meetingId });
    } catch (err) {
      logger.warn('transcriptFetch: notes pipeline failed (non-fatal)', {
        meetingId, error: err.message,
      });
    }
  });

  // ── Step 6: Notify AM ─────────────────────────────────────────────────────
  await _sendPostMeetingNotification(meetingId, tenantId, 'transcript_ready');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _requeue(data) {
  try {
    await queue.add('fetch', data, {
      delay:            POLL_INTERVAL,
      removeOnComplete: { count: 20 },
      removeOnFail:     { count: 10 },
    });
  } catch (err) {
    logger.error('transcriptFetch: re-queue failed', { meetingId: data.meetingId, error: err.message });
  }
}

async function _handleNoTranscript(meetingId, tenantId, reason) {
  try {
    await getMeetingRepo().updateTranscriptStatus(meetingId, 'unavailable');
    logger.info('transcriptFetch: marked unavailable (no email sent)', { meetingId, reason });
  } catch (err) {
    logger.error('transcriptFetch: handleNoTranscript failed', { meetingId, error: err.message });
  }
}

async function _handleAuthFailure(meetingId, tenantId, errorMessage) {
  try {
    await getMeetingRepo().updateTranscriptStatus(meetingId, 'unavailable');
    const calRepo = require('../repositories/calendar.repository');
    await calRepo.updateConnectionError(tenantId, 'microsoft', 'expired', errorMessage);
    logger.warn('transcriptFetch: auth failure — connection marked expired', { meetingId });
  } catch (err) {
    logger.error('transcriptFetch: auth failure handler failed', { error: err.message });
  }
}

async function _sendPostMeetingNotification(meetingId, tenantId, type) {
  try {
    const meeting = await getMeetingRepo().findById(meetingId, tenantId);
    if (!meeting) return;

    const db      = require('../config/db');
    const { rows } = await db.query(
      `SELECT u.email, u.first_name
       FROM   customers c
       JOIN   users u ON u.id = c.account_manager_id
       WHERE  c.id = $1 LIMIT 1`,
      [tenantId]
    );
    if (!rows[0]) return;

    const amEmail     = rows[0].email;
    const amFirstName = rows[0].first_name || 'there';

    const isReady  = type === 'transcript_ready';
    const subject  = isReady
      ? `Meeting Notes Ready — ${meeting.title}`
      : `Meeting Complete — ${meeting.title}`;

    const frontendBase = process.env.CLIENT_URL || 'http://localhost:5173';

    await getEmailService().send({
      to:           amEmail,
      subject,
      templateName: 'post-meeting-summary',
      vars: {
        recipientName:  amFirstName,
        meetingTitle:   meeting.title,
        bodyMessage:    isReady
          ? 'Your meeting has been completed and the Teams transcript has been imported. Please review the notes and approve any AI task recommendations.'
          : 'Your meeting has been completed. No transcript was available from Microsoft Teams — you can add meeting notes manually in NxgSecure.',
        notesStatus:    isReady ? 'Transcript imported from Microsoft Teams' : 'No transcript available',
        badgeColor:     isReady ? '#0f766e' : '#475569',
        badgeTextColor: isReady ? '#ccfbf1' : '#e2e8f0',
        badgeLabel:     isReady ? 'Notes Ready' : 'Meeting Complete',
        accentColor:    isReady ? '#14b8a6' : '#64748b',
        ctaColor:       isReady ? '#0f766e' : '#2563eb',
        ctaLabel:       isReady ? 'Review Meeting &amp; Approve Tasks' : 'Review Meeting',
        reviewUrl:      `${frontendBase}/meetings`,
        emailSubject:   subject,
      },
      rawVars: {
        additionalNote: '',
      },
    });

    logger.info('transcriptFetch: post-meeting notification sent', { meetingId, amEmail, type });
  } catch (err) {
    logger.warn('transcriptFetch: notification send failed (non-fatal)', { meetingId, error: err.message });
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function start() {
  try {
    queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 50 } },
    });

    worker = new Worker(QUEUE_NAME, processTranscript, { connection, concurrency: 3 });

    worker.on('completed', (job) => {
      logger.info('transcriptFetch worker: job completed', { jobId: job.id });
    });
    worker.on('failed', (job, err) => {
      logger.error('transcriptFetch worker: job failed', { jobId: job?.id, error: err.message });
    });
    worker.on('error', onWorkerError('transcriptFetch worker'));

    // Recovery: re-queue transcript fetch for any meetings still in 'fetching' state.
    // Catches cases where a server restart interrupted an active polling job — BullMQ
    // marks active jobs failed on reconnect, so the polling chain would otherwise stop.
    setImmediate(async () => {
      try {
        // S-4: drain orphan jobs whose 2-hour window already elapsed so they
        // never reach _handleNoTranscript and send a duplicate email.
        const staleDelayed = await queue.getDelayed().catch(() => []);
        for (const job of staleDelayed) {
          if (job.data && Date.now() - (job.data.startedAt || 0) >= MAX_DURATION) {
            await job.remove().catch(() => {});
            logger.info('transcriptFetch: removed expired orphan job', { jobId: job.id });
          }
        }

        const stuck = await getMeetingRepo().findTranscriptFetchingMeetings();
        if (stuck.length === 0) return;
        logger.info('transcriptFetch: recovery scan re-queuing stuck meetings', { count: stuck.length });
        for (const m of stuck) {
          // S-3: restore the authoritative start time from DB so the 2-hour window
          // is shared across restarts. Fall back to now only for pre-migration rows.
          const startedAt = m.transcriptPollingStartedAt
            ? new Date(m.transcriptPollingStartedAt).getTime()
            : Date.now();
          // S-1: stable jobId — BullMQ silently rejects if a chain is already pending,
          // so N restarts produce exactly ONE active chain per meeting.
          await queue.add('fetch', {
            meetingId:    m.id,
            tenantId:     m.tenantId,
            teamsJoinUrl: m.teamsJoinUrl || null,
            attempt:      1,
            startedAt,
          }, {
            jobId:            `transcript-recovery-${m.id}`,
            delay:            POLL_INTERVAL,
            removeOnComplete: { count: 20 },
            removeOnFail:     { count: 10 },
          });
        }
      } catch (err) {
        logger.warn('transcriptFetch: recovery scan failed (non-fatal)', { error: err.message });
      }
    });

    logger.info('transcriptFetch job started');
  } catch (err) {
    logger.error('transcriptFetch: failed to start — Redis may be unavailable', { error: err.message });
  }
}

async function stop() {
  try {
    if (worker) await worker.close();
    if (queue)  await queue.close();
    logger.info('transcriptFetch job stopped');
  } catch (err) {
    logger.warn('transcriptFetch stop error', { error: err.message });
  }
}

/**
 * Called by meeting.routes.js POST /:id/conduct
 * Schedules the first transcript fetch attempt.
 */
async function schedule(meetingId, tenantId, teamsJoinUrl) {
  if (!queue) {
    logger.error('transcriptFetch.schedule: queue not initialized');
    return;
  }
  const db = require('../config/db');
  // S-3: stamp authoritative poll-start time once — used by recovery scans
  // to restore the shared 2-hour window instead of resetting it on each restart.
  await db.query(
    `UPDATE meetings SET transcript_polling_started_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND transcript_polling_started_at IS NULL`,
    [meetingId]
  ).catch(() => {});
  // S-1: stable jobId — BullMQ silently rejects a second add() while this job
  // is pending/active, preventing duplicate chains from multiple conduct calls.
  await queue.add('fetch', {
    meetingId,
    tenantId,
    teamsJoinUrl: teamsJoinUrl || null,
    attempt:   1,
    startedAt: Date.now(),
  }, {
    jobId:            `transcript-active-${meetingId}`,
    delay:            0,
    removeOnComplete: { count: 20 },
    removeOnFail:     { count: 10 },
  });
  await getMeetingRepo().updateTranscriptStatus(meetingId, 'fetching');
  logger.info('transcriptFetch: scheduled', { meetingId });
}

module.exports = { start, stop, schedule };
