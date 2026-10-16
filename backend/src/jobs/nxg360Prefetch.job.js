'use strict';

const { Queue, Worker } = require('bullmq');
const { connection, onWorkerError } = require('../config/bullmq');
const logger            = require('../utils/logger');

// Lazy-load to avoid circular deps at module load time
const getSyncJob     = () => require('./nxg360Sync.job');
const getMeetingRepo = () => require('../repositories/meeting.repository');
const getRedis       = () => require('../config/redisClient');
const getDb          = () => require('../config/db');
const getPreMeeting  = () => require('../services/preMeeting.service');

const QUEUE_NAME   = 'nxg360-prefetch';
const MAX_ATTEMPTS = 3;
const RETRY_DELAY  = 2.5 * 60 * 60 * 1000; // 2.5 h — covers T-24 → T-21.5 → T-19

const JOB_ID = (meetingId) => `nxg360-prefetch-${meetingId}`;

let queue  = null;
let worker = null;

// ── Process ───────────────────────────────────────────────────────────────────

async function processPrefetch(job) {
  const { meetingId, tenantId, attempt = 1 } = job.data;

  // Guard — skip silently if the meeting is no longer awaiting a brief
  const meeting = await getMeetingRepo().findById(meetingId, tenantId);
  if (!meeting) {
    logger.info('nxg360Prefetch: meeting not found, stopping', { meetingId });
    return { done: true, reason: 'meeting_deleted' };
  }
  if (!['scheduled', 'approval_pending'].includes(meeting.status)) {
    logger.info('nxg360Prefetch: meeting past schedulable state, stopping', {
      meetingId, status: meeting.status,
    });
    return { done: true, reason: 'meeting_not_schedulable' };
  }

  logger.info('nxg360Prefetch: pulling NXG360 data', { meetingId, tenantId, attempt });

  const result = await getSyncJob().syncTenant(tenantId);

  if (!result.success) {
    logger.warn('nxg360Prefetch: sync returned error', { meetingId, tenantId, attempt, error: result.error });
    if (attempt < MAX_ATTEMPTS) {
      await _requeue({ meetingId, tenantId, attempt: attempt + 1 });
      return { done: false, reason: 'sync_error_will_retry' };
    }
    return { done: true, reason: 'sync_error_max_retries' };
  }

  // Check whether the Redis cache now has findings
  let findingsEmpty = true;
  try {
    const raw = await getRedis().get(`nxg360:findings:${tenantId}`);
    if (raw) {
      const arr  = JSON.parse(raw);
      findingsEmpty = !Array.isArray(arr) || arr.length === 0;
    }
  } catch (cacheErr) {
    // Cache unreadable — treat as non-empty to avoid wasting retries
    logger.warn('nxg360Prefetch: cache read failed, treating as non-empty', {
      tenantId, error: cacheErr.message,
    });
    findingsEmpty = false;
  }

  if (findingsEmpty && attempt < MAX_ATTEMPTS) {
    const retryHours = (RETRY_DELAY / 3_600_000).toFixed(1);
    logger.info('nxg360Prefetch: NXG360 returned empty findings, will retry', {
      meetingId, tenantId, attempt, nextAttempt: attempt + 1, retryIn: `${retryHours}h`,
    });
    await _requeue({ meetingId, tenantId, attempt: attempt + 1 });
    return { done: false, reason: 'empty_findings_will_retry' };
  }

  if (findingsEmpty) {
    logger.warn('nxg360Prefetch: NXG360 still empty after all attempts — brief will show placeholder', {
      meetingId, tenantId, attempts: attempt,
    });
    return { done: true, reason: 'max_retries_still_empty' };
  }

  // Fresh NXG360 data is now in Redis — run AI recommendations
  logger.info('nxg360Prefetch: data found, running AI analysis', { meetingId, tenantId, attempt });
  await getPreMeeting().autoAnalyze(meetingId, tenantId);

  logger.info('nxg360Prefetch: complete', { meetingId, tenantId, attempt });
  return { done: true, reason: 'data_found' };
}

async function _requeue(data) {
  try {
    await queue.add('prefetch', data, {
      delay:            RETRY_DELAY,
      removeOnComplete: { count: 20 },
      removeOnFail:     { count: 10 },
    });
  } catch (err) {
    logger.error('nxg360Prefetch: re-queue failed', { meetingId: data.meetingId, error: err.message });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Schedule a T-24 NXG360 prefetch for a specific meeting.
 * If the T-24 window has already passed (meeting < 24h away), fires immediately.
 */
async function schedule(meetingId, tenantId, scheduledStart) {
  if (!queue) {
    logger.error('nxg360Prefetch.schedule: queue not initialized');
    return;
  }

  const prefetchAt = new Date(scheduledStart).getTime() - 24 * 60 * 60 * 1000;
  const delay      = Math.max(prefetchAt - Date.now(), 0);

  await queue.add('prefetch', { meetingId, tenantId, attempt: 1 }, {
    jobId:            JOB_ID(meetingId),
    delay,
    removeOnComplete: { count: 20 },
    removeOnFail:     { count: 10 },
  });

  logger.info('nxg360Prefetch: scheduled', {
    meetingId,
    tenantId,
    delayHours:    (delay / 3_600_000).toFixed(1),
    scheduledStart,
  });
}

/**
 * Cancel the existing prefetch for a meeting and create a new one for the updated date.
 * Called when scheduledStart changes (meeting update or reschedule approval).
 */
async function reschedule(meetingId, tenantId, newScheduledStart) {
  if (!queue) {
    logger.error('nxg360Prefetch.reschedule: queue not initialized');
    return;
  }

  try {
    const existing = await queue.getJob(JOB_ID(meetingId));
    if (existing) {
      await existing.remove();
      logger.info('nxg360Prefetch: cancelled old prefetch job for rescheduled meeting', { meetingId });
    }
  } catch (err) {
    // Non-fatal — the job may have already run or been cleaned up
    logger.warn('nxg360Prefetch: could not remove old job (non-fatal)', {
      meetingId, error: err.message,
    });
  }

  await schedule(meetingId, tenantId, newScheduledStart);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function start() {
  try {
    queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: { removeOnComplete: { count: 50 }, removeOnFail: { count: 20 } },
    });

    worker = new Worker(QUEUE_NAME, processPrefetch, { connection, concurrency: 3 });

    worker.on('completed', (job) => {
      logger.info('nxg360Prefetch: job completed', { jobId: job.id, result: job.returnvalue });
    });
    worker.on('failed', (job, err) => {
      logger.error('nxg360Prefetch: job failed', { jobId: job?.id, error: err.message });
    });
    worker.on('error', onWorkerError('nxg360Prefetch worker'));

    // Recovery: on restart, re-queue T-24 jobs for any scheduled/pending meetings
    // that no longer have an active prefetch job in BullMQ.
    setImmediate(async () => {
      try {
        const { rows } = await getDb().query(
          `SELECT id,
                  tenant_id       AS "tenantId",
                  scheduled_start AS "scheduledStart"
           FROM   meetings
           WHERE  status IN ('scheduled', 'approval_pending')
             AND  scheduled_start > NOW()`
        );
        if (rows.length === 0) return;

        logger.info('nxg360Prefetch: recovery scan found upcoming meetings', { count: rows.length });

        for (const m of rows) {
          const existing = await queue.getJob(JOB_ID(m.id));
          if (!existing) {
            await schedule(m.id, m.tenantId, m.scheduledStart);
          }
        }
      } catch (err) {
        logger.warn('nxg360Prefetch: recovery scan failed (non-fatal)', { error: err.message });
      }
    });

    logger.info('nxg360Prefetch job started');
  } catch (err) {
    logger.error('nxg360Prefetch: failed to start — Redis may be unavailable', { error: err.message });
  }
}

async function stop() {
  try {
    if (worker) await worker.close();
    if (queue)  await queue.close();
    logger.info('nxg360Prefetch job stopped');
  } catch (err) {
    logger.warn('nxg360Prefetch stop error', { error: err.message });
  }
}

module.exports = { start, stop, schedule, reschedule };
