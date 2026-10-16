'use strict';

const { Queue, Worker } = require('bullmq');
const { connection, onWorkerError } = require('../config/bullmq');
const meetingRepository  = require('../repositories/meeting.repository');
const calendarRepository = require('../repositories/calendar.repository');
const reminderService    = require('../services/reminder.service');
const logger             = require('../utils/logger');

const QUEUE_NAME       = 'meeting-reminders';
const SCAN_INTERVAL_MS = 5 * 60 * 1000; // poll every 5 minutes

// Mirror of reminderService.REMINDER_WINDOWS as ms offsets so the job can
// calculate due-ness without calling the service for each check.
const WINDOWS = [
  { key: '7d', offsetMs: 7 * 24 * 60 * 60 * 1000 },
  { key: '3d', offsetMs: 3 * 24 * 60 * 60 * 1000 },
  { key: '1d', offsetMs:     24 * 60 * 60 * 1000 },
  { key: '1h', offsetMs:          60 * 60 * 1000 },
];

let queue  = null;
let worker = null;

async function processReminders() {
  const meetings = await meetingRepository.findMeetingsNeedingReminders();
  if (meetings.length === 0) return;

  // One query for all meetings — avoids N+1 per meeting lookup.
  const meetingIds = meetings.map((m) => m.id);
  const fired      = await calendarRepository.findFiredReminders(meetingIds);

  // O(1) lookup: "<meetingId>:<reminderType>" → already dispatched (any status)
  const firedSet = new Set(fired.map((r) => `${r.meetingId}:${r.reminderType}`));

  const now = Date.now();
  let triggered = 0;

  for (const meeting of meetings) {
    const meetingMs = new Date(meeting.scheduledStart).getTime();

    for (const win of WINDOWS) {
      if (now < meetingMs - win.offsetMs) continue; // window not yet due

      const key = `${meeting.id}:${win.key}`;
      if (firedSet.has(key)) continue; // already dispatched — skip

      try {
        await reminderService.triggerForMeeting(
          meeting.id,
          meeting.tenantId,
          { scheduledStart: meeting.scheduledStart, reminderType: win.key },
          { email: 'system@bmmj.internal' }
        );
        firedSet.add(key); // prevent re-check of same window later in this run
        triggered++;
        logger.info('Reminder window fired', {
          meetingId: meeting.id,
          tenantId:  meeting.tenantId,
          window:    win.key,
          title:     meeting.title,
        });
      } catch (err) {
        // Log and continue — one failure must not block other meetings or windows.
        logger.error('Reminder window failed to fire', {
          meetingId: meeting.id,
          window:    win.key,
          error:     err.message,
        });
      }
    }
  }

  if (triggered > 0) {
    logger.info('Reminder windows scan complete', { triggered });
  }
}

async function start() {
  try {
    queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail:     { count: 50  },
      },
    });

    worker = new Worker(
      QUEUE_NAME,
      async () => { await processReminders(); },
      { connection, concurrency: 1 }
    );

    worker.on('completed', (job) => {
      logger.info('Reminder worker: scan completed', { jobId: job.id });
    });

    worker.on('failed', (job, err) => {
      logger.error('Reminder worker: scan failed', { jobId: job?.id, error: err.message });
    });

    // Must be attached — unhandled Redis drops throw UnhandledRejection.
    worker.on('error', onWorkerError('Reminder worker'));

    // upsertJobScheduler is idempotent — safe on every server restart.
    await queue.upsertJobScheduler(
      'reminder-windows-scheduler',
      { every: SCAN_INTERVAL_MS },
      { name: 'scan', data: {} }
    );

    logger.info('Reminder windows scheduler started', { intervalMs: SCAN_INTERVAL_MS });
  } catch (err) {
    // Redis being unavailable must not crash the server.
    logger.error('Reminder windows scheduler failed to start — Redis may be unavailable', {
      error: err.message,
    });
  }
}

async function stop() {
  try {
    if (worker) await worker.close();
    if (queue)  await queue.close();
    logger.info('Reminder windows scheduler stopped');
  } catch (err) {
    logger.warn('Reminder windows scheduler stop error', { error: err.message });
  }
}

module.exports = { start, stop };
