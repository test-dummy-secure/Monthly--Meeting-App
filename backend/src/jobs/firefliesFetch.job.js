'use strict';

/**
 * firefliesFetch.job.js
 *
 * BullMQ polling job that checks Fireflies AI for a transcript matching a
 * conducted BMMJ meeting. Mirrors the pattern of transcriptFetch.job.js.
 *
 * Lifecycle:
 *   schedule(meetingId, tenantId) called from conduct endpoint
 *     → first attempt after 5 min (Fireflies needs time to process)
 *     → retries every 5 min up to 2 hours
 *     → on match: saves transcript + triggers Ollama notes pipeline + emails AM
 *     → on timeout / already captured by MS Graph: stops gracefully
 *
 * Always starts with the server; checks per-tenant DB connection before polling.
 */

const { Queue, Worker } = require('bullmq');
const { connection, onWorkerError } = require('../config/bullmq');
const logger            = require('../utils/logger');

const getMeetingRepo        = () => require('../repositories/meeting.repository');
const getAuditRepo          = () => require('../repositories/audit-log.repository');
const getEmailService       = () => require('../services/email.service');
const getFireflies          = () => require('../services/fireflies.service');
const getFirefliesConnRepo  = () => require('../repositories/fireflies-connection.repository');
const { decrypt }           = require('../utils/encryption');
const { enrichWithInternalFlag } = require('../utils/attendees');
const db                    = require('../config/db');

const QUEUE_NAME    = 'fireflies-fetch';
const POLL_INTERVAL = 15 * 60 * 1000;       // 15 min between polls
const FIRST_DELAY   = 15 * 60 * 1000;       // Wait 15 min before first attempt
const MAX_DURATION  = 2  * 60 * 60 * 1000;  // 2-hour total window

let queue  = null;
let worker = null;

// ── Core processor ────────────────────────────────────────────────────────────

async function processFireflies(job) {
  const { meetingId, tenantId, attempt = 1, startedAt } = job.data;
  const start = startedAt || Date.now();

  // Hard time-box — give up after 2 hours
  if (Date.now() - start >= MAX_DURATION) {
    logger.info('firefliesFetch: 2-hour window elapsed, stopping', { meetingId });
    const meeting = await getMeetingRepo().findById(meetingId, tenantId).catch(() => null);
    if (meeting && meeting.transcriptStatus !== 'captured') {
      await getMeetingRepo().updateTranscriptStatus(meetingId, 'unavailable').catch(() => {});
    }
    return;
  }

  const meeting = await getMeetingRepo().findById(meetingId, tenantId).catch(() => null);

  if (!meeting) {
    logger.warn('firefliesFetch: meeting not found, stopping', { meetingId });
    return;
  }

  if (meeting.status !== 'conducted') {
    logger.info('firefliesFetch: meeting not conducted, stopping', { meetingId, status: meeting.status });
    return;
  }

  // If MS Graph already captured the transcript, Fireflies is not needed
  if (meeting.transcriptStatus === 'captured') {
    logger.info('firefliesFetch: transcript already captured, stopping', { meetingId });
    return;
  }

  // ── Step 0: Load per-tenant API key from DB ───────────────────────────────

  const ffConn = await getFirefliesConnRepo().findByTenant(tenantId).catch(() => null);
  if (!ffConn || ffConn.status !== 'connected') {
    logger.info('firefliesFetch: no active Fireflies connection, stopping', { meetingId, tenantId });
    return;
  }
  let apiKey;
  try {
    apiKey = decrypt(ffConn.apiKeyEnc);
  } catch (err) {
    logger.error('firefliesFetch: could not decrypt API key, stopping', { meetingId, error: err.message });
    return;
  }

  logger.info('firefliesFetch: polling Fireflies API', { meetingId, attempt });

  // ── Step 1: Search for matching transcript (exclusivity-safe) ────────────

  let candidates;
  try {
    candidates = await getFireflies().findTranscriptId(
      apiKey, meeting.title, meeting.scheduledStart, meeting.scheduledEnd,
      meeting.teamsJoinUrl || null
    );
  } catch (err) {
    logger.warn('firefliesFetch: API error', { meetingId, attempt, error: err.message, code: err.code, status: err.status, retryAfter: err.retryAfter });

    // Unrecoverable authorization errors: mark tenant connection disconnected
    if (err.status === 401 || err.status === 403) {
      try {
        await getFirefliesConnRepo().setStatus(tenantId, 'disconnected');
        logger.error('firefliesFetch: Fireflies API unauthorized — marked disconnected', { meetingId, tenantId, status: err.status });
      } catch (setErr) {
        logger.warn('firefliesFetch: failed to set Fireflies connection status', { tenantId, error: setErr.message });
      }
      return;
    }

    // Rate limit handling: if server supplied Retry-After, use that delay (seconds)
    if (err.status === 429 && err.retryAfter && Number.isFinite(err.retryAfter)) {
      const delayMs = Math.max(POLL_INTERVAL, err.retryAfter * 1000);
      logger.info('firefliesFetch: rate limited — requeueing with server Retry-After', { meetingId, delayMs });
      await _requeue({ meetingId, tenantId, attempt: attempt + 1, startedAt: start, delayMs });
      return;
    }

    // Generic retry path
    logger.warn('firefliesFetch: will retry', { meetingId, attempt });
    await _requeue({ meetingId, tenantId, attempt: attempt + 1, startedAt: start });
    return;
  }

  if (!candidates || candidates.length === 0) {
    logger.info('firefliesFetch: transcript not ready yet, will retry', { meetingId, attempt });
    await _requeue({ meetingId, tenantId, attempt: attempt + 1, startedAt: start });
    return;
  }

  // Exclude transcript IDs already claimed by ANY meeting across ALL tenants.
  // All tenants may share the same Fireflies API key (one NXG360 account), so
  // the same recording is visible to every tenant's job. Cross-tenant exclusivity
  // ensures tenant A's meeting never steals tenant B's transcript even when both
  // meetings have similar titles on the same day.
  const { rows: claimedRows } = await db.query(
    `SELECT fireflies_transcript_id
     FROM   meetings
     WHERE  fireflies_transcript_id IS NOT NULL
       AND  id != $1`,
    [meetingId]
  );
  const claimedIds    = new Set(claimedRows.map((r) => r.fireflies_transcript_id));
  const unclaimed     = candidates.filter((c) => !claimedIds.has(c.id));

  if (unclaimed.length === 0) {
    logger.info('firefliesFetch: all matching transcripts claimed by other meetings (cross-tenant), retrying', {
      meetingId, candidates: candidates.length, claimed: claimedIds.size,
    });
    await _requeue({ meetingId, tenantId, attempt: attempt + 1, startedAt: start });
    return;
  }

  // ── Step 2: Fetch full transcript text — try all candidates in priority order ─
  // Multiple URL-matched transcripts can exist for the same meeting URL when the
  // Fireflies bot joins more than once (e.g. bot rejoins at the originally scheduled
  // time after an early test run). Try each candidate in turn; skip any that are
  // empty or not-yet-processed rather than requeueing and looping on the same one.

  let transcriptResult = null;
  let transcriptId     = null;

  for (const cand of unclaimed) {
    try {
      const result = await getFireflies().fetchTranscriptText(apiKey, cand.id);
      if (!result.text || result.text.trim().length < 10) {
        logger.info('firefliesFetch: candidate text too short, trying next', {
          meetingId, transcriptId: cand.id, length: result.text?.length,
        });
        continue;
      }
      transcriptResult = result;
      transcriptId     = cand.id;
      break;
    } catch (err) {
      if (err.code === 'FIREFLIES_EMPTY' || err.code === 'FIREFLIES_NOT_FOUND') {
        // Transcript exists but sentences not ready, or processing still in progress —
        // try the next candidate instead of giving up.
        logger.info('firefliesFetch: candidate not ready, trying next', {
          meetingId, transcriptId: cand.id, code: err.code,
        });
        continue;
      }
      if (err.status === 401 || err.status === 403) {
        await getFirefliesConnRepo().setStatus(tenantId, 'disconnected').catch(() => {});
        logger.error('firefliesFetch: unauthorized during transcript fetch — marked disconnected', {
          meetingId, tenantId, status: err.status,
        });
        return;
      }
      // Transient network/API error — requeue, don't burn the remaining candidates
      logger.warn('firefliesFetch: transcript fetch error, retrying', { meetingId, error: err.message });
      await _requeue({ meetingId, tenantId, attempt: attempt + 1, startedAt: start });
      return;
    }
  }

  if (!transcriptResult) {
    // All candidates were empty / still processing — requeue to check again later
    logger.info('firefliesFetch: all candidates empty or not ready, will retry', {
      meetingId, tried: unclaimed.length,
    });
    await _requeue({ meetingId, tenantId, attempt: attempt + 1, startedAt: start });
    return;
  }

  const { text: transcriptText, duration, participants = [] } = transcriptResult;

  // ── Step 3a: Enrich participants with isInternal flag ─────────────────────
  // Rule: email ends with @nxgsecure.com → NxGSecure Team, everything else → Customer Side.
  // Name-only participants (no email in Fireflies) land on Customer Side by design.
  // To appear on NxGSecure Team, team members must have a Fireflies account linked
  // to their @nxgsecure.com email so Fireflies records it in participants[].
  const enriched = participants.length > 0
    ? enrichWithInternalFlag(participants)
    : participants;

  // ── Step 3b: Persist transcript + enriched participants ───────────────────
  // Only overwrite attendees when Fireflies returned at least one participant.
  // This preserves any attendees the AM manually entered if Fireflies has none.

  if (enriched.length > 0) {
    await db.query(
      `UPDATE meetings
       SET  transcript_text         = $1,
            transcript_status       = 'captured',
            transcript_fetched_at   = NOW(),
            fireflies_transcript_id = $2,
            attendees               = $3,
            updated_at              = NOW()
       WHERE id = $4`,
      [transcriptText, transcriptId, JSON.stringify(enriched), meetingId]
    );
  } else {
    await db.query(
      `UPDATE meetings
       SET  transcript_text         = $1,
            transcript_status       = 'captured',
            transcript_fetched_at   = NOW(),
            fireflies_transcript_id = $2,
            updated_at              = NOW()
       WHERE id = $3`,
      [transcriptText, transcriptId, meetingId]
    );
  }

  logger.info('firefliesFetch: transcript saved', {
    meetingId,
    transcriptId,
    length:       transcriptText.length,
    participants: participants.length,
    duration,
    attempt,
  });

  await getAuditRepo().create(
    tenantId,
    'system@bmmj.internal',
    'Meeting Transcript Imported',
    { meetingId, source: 'fireflies', transcriptId, length: transcriptText.length }
  ).catch(() => {});

  // ── Step 4: Trigger Ollama notes pipeline ────────────────────────────────
  // fire-and-forget: transcript → preprocessor → Ollama structurer → AI tasks

  setImmediate(async () => {
    try {
      const MeetingNotesService = require('../services/meetingNotes.service');
      await MeetingNotesService.processNotes('fireflies', meetingId, tenantId, {
        transcriptText,
      });
      logger.info('firefliesFetch: notes pipeline triggered', { meetingId });
    } catch (err) {
      logger.warn('firefliesFetch: notes pipeline failed (non-fatal)', {
        meetingId, error: err.message,
      });
    }
  });

  // ── Step 5: Notify AM ──────────────────────────────────────────────────────

  await _sendNotification(meetingId, tenantId).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _requeue(data) {
  try {
    // Allow callers to supply custom delayMs (ms) to honor server Rate-Limit headers
    const delayMs = data.delayMs || POLL_INTERVAL;
    // Remove internal-only field before enqueue
    const enqueueData = Object.assign({}, data);
    delete enqueueData.delayMs;
    await queue.add('fetch', enqueueData, {
      delay:            delayMs,
      removeOnComplete: { count: 20 },
      removeOnFail:     { count: 10 },
    });
  } catch (err) {
    logger.error('firefliesFetch: re-queue failed', { meetingId: data.meetingId, error: err.message });
  }
}

async function _sendNotification(meetingId, tenantId) {
  // S-2: atomic one-shot claim — only the first job chain to win this UPDATE
  // sends the email. Any parallel chain (from multiple restarts) gets rowCount=0
  // and returns silently, preventing duplicate "Meeting Notes Ready" emails.
  const { rowCount } = await db.query(
    `UPDATE meetings
     SET    transcript_notified_at = NOW(), updated_at = NOW()
     WHERE  id = $1 AND transcript_notified_at IS NULL`,
    [meetingId]
  );
  if (rowCount === 0) {
    logger.info('firefliesFetch: notification already claimed, skipping', { meetingId });
    return;
  }

  const meeting = await getMeetingRepo().findById(meetingId, tenantId);
  if (!meeting) return;

  const { rows } = await db.query(
    `SELECT u.email, u.first_name
     FROM   customers c
     JOIN   users u ON u.id = c.account_manager_id
     WHERE  c.id = $1 LIMIT 1`,
    [tenantId]
  );
  if (!rows[0]) return;

  const frontendBase = process.env.CLIENT_URL || 'http://localhost:5173';
  const subject      = `Meeting Notes Ready — ${meeting.title}`;

  await getEmailService().send({
    to:           rows[0].email,
    subject,
    templateName: 'post-meeting-summary',
    vars: {
      recipientName:  rows[0].first_name || 'there',
      meetingTitle:   meeting.title,
      bodyMessage:    'Your meeting transcript has been imported from Fireflies AI (supports Hindi + English). Please review the AI-generated notes and approve any task recommendations.',
      notesStatus:    'Transcript imported from Fireflies AI',
      badgeColor:     '#4f46e5',
      badgeTextColor: '#e0e7ff',
      badgeLabel:     'Notes Ready',
      accentColor:    '#6366f1',
      ctaColor:       '#4338ca',
      ctaLabel:       'Review Meeting &amp; Approve Tasks',
      reviewUrl:      `${frontendBase}/meetings`,
      emailSubject:   subject,
    },
    rawVars: { additionalNote: '' },
  });

  logger.info('firefliesFetch: AM notification sent', { meetingId, amEmail: rows[0].email });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function start() {
  try {
    queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 50 } },
    });

    worker = new Worker(QUEUE_NAME, processFireflies, { connection, concurrency: 3 });

    worker.on('completed', (job) =>
      logger.info('firefliesFetch worker: job completed', { jobId: job.id })
    );
    worker.on('failed', (job, err) =>
      logger.error('firefliesFetch worker: job failed', { jobId: job?.id, error: err.message })
    );
    worker.on('error', onWorkerError('firefliesFetch worker'));

    logger.info('firefliesFetch job started');

    // Recovery scan: re-queue any meetings left stuck in transcript_status='fetching'
    // by a previous server restart. Only re-queues meetings that still have an active
    // Fireflies connection — otherwise re-queuing is pointless and wastes a poll slot.
    setImmediate(async () => {
      try {
        // S-4: drain orphan jobs whose 2-hour window already elapsed so they
        // never fire a duplicate notification.
        const staleDelayed = await queue.getDelayed().catch(() => []);
        for (const job of staleDelayed) {
          if (job.data && Date.now() - (job.data.startedAt || 0) >= MAX_DURATION) {
            await job.remove().catch(() => {});
            logger.info('firefliesFetch: removed expired orphan job', { jobId: job.id });
          }
        }

        const stuck = await getMeetingRepo().findFirefliesFetchingMeetings();
        if (stuck.length === 0) return;
        logger.info('firefliesFetch: recovery scan re-queuing stuck meetings', { count: stuck.length });
        for (const m of stuck) {
          const ffConn = await getFirefliesConnRepo().findByTenant(m.tenantId).catch(() => null);
          if (!ffConn || ffConn.status !== 'connected') continue;
          // S-3: restore authoritative start time; fall back for pre-migration rows
          const startedAt = m.transcriptPollingStartedAt
            ? new Date(m.transcriptPollingStartedAt).getTime()
            : Date.now();
          // S-1: stable jobId — BullMQ silently rejects duplicate while pending
          await queue.add('fetch', {
            meetingId: m.id,
            tenantId:  m.tenantId,
            attempt:   1,
            startedAt,
          }, {
            jobId:            `fireflies-recovery-${m.id}`,
            delay:            POLL_INTERVAL,
            removeOnComplete: { count: 20 },
            removeOnFail:     { count: 10 },
          });
          logger.info('firefliesFetch: recovery scan re-queued', { meetingId: m.id });
        }
      } catch (err) {
        logger.warn('firefliesFetch: recovery scan failed (non-fatal)', { error: err.message });
      }
    });
  } catch (err) {
    logger.error('firefliesFetch: failed to start — Redis may be unavailable', { error: err.message });
  }
}

async function stop() {
  try {
    if (worker) await worker.close();
    if (queue)  await queue.close();
    logger.info('firefliesFetch job stopped');
  } catch (err) {
    logger.warn('firefliesFetch stop error', { error: err.message });
  }
}

/**
 * Called from meeting.routes.js POST /:id/conduct when FIREFLIES_ENABLED=true.
 * Schedules the first fetch attempt with a 5-minute delay (Fireflies needs time
 * to process the recording after the meeting ends).
 *
 * @param {string} meetingId
 * @param {string} tenantId
 */
async function schedule(meetingId, tenantId) {
  if (!queue) {
    logger.warn('firefliesFetch.schedule: queue not initialized — was the job started?');
    return;
  }
  // Always reset the poll-start time so re-conducting a meeting starts a fresh
  // 2-hour window instead of inheriting a stale timestamp from a previous attempt.
  await db.query(
    `UPDATE meetings SET transcript_polling_started_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [meetingId]
  ).catch(() => {});
  // S-1: stable jobId — BullMQ silently rejects a second add() while this job
  // is pending/active, preventing duplicate chains from multiple schedule() calls.
  await queue.add('fetch', {
    meetingId,
    tenantId,
    attempt:   1,
    startedAt: Date.now(),
  }, {
    jobId:            `fireflies-active-${meetingId}`,
    delay:            FIRST_DELAY,
    removeOnComplete: { count: 20 },
    removeOnFail:     { count: 10 },
  });
  // Mark transcript as 'fetching' immediately so the UI shows the polling state
  // and the AM knows not to manually add notes.
  await getMeetingRepo().updateTranscriptStatus(meetingId, 'fetching').catch((err) =>
    logger.warn('firefliesFetch.schedule: updateTranscriptStatus failed (non-fatal)', { meetingId, error: err.message })
  );
  logger.info('firefliesFetch: scheduled (first attempt in 15 min)', { meetingId });
}

module.exports = { start, stop, schedule };
