'use strict';

const meetingRepository = require('../repositories/meeting.repository');
const logger            = require('../utils/logger');

// Lazy-load to avoid circular deps at startup
const getPrefetchJob = () => require('./nxg360Prefetch.job');

// Run once per day. Catches any configs whose latest meeting was closed but
// whose next occurrence was never generated (e.g. the on-close generator
// failed, or the server was down at close time).
const INTERVAL_MS = 24 * 60 * 60 * 1000;

let _timer = null;

async function runOnce() {
  try {
    const configs = await meetingRepository.getAllConfigs();
    if (configs.length === 0) return;

    let generated = 0;
    let skipped   = 0;
    let errors    = 0;

    for (const config of configs) {
      try {
        const result = await meetingRepository.ensureUpcomingMeeting(config);
        if (result.generated) {
          logger.info('Recurrence job: generated next meeting', {
            configId:       config.id,
            tenantId:       config.tenantId,
            pattern:        config.recurrencePattern,
            scheduledStart: result.meeting.scheduledStart,
          });

          // Schedule T-24 NXG360 prefetch for the newly created meeting
          getPrefetchJob().schedule(
            result.meeting.id,
            config.tenantId,
            result.meeting.scheduledStart,
          ).catch((err) =>
            logger.warn('Recurrence job: failed to schedule T-24 prefetch (non-fatal)', {
              meetingId: result.meeting.id, error: err.message,
            })
          );

          generated++;
        } else {
          skipped++;
        }
      } catch (err) {
        errors++;
        logger.error('Recurrence job: failed for config', {
          configId: config.id,
          tenantId: config.tenantId,
          error:    err.message,
        });
      }
    }

    if (generated > 0 || errors > 0) {
      logger.info('Recurrence job complete', {
        total: configs.length, generated, skipped, errors,
      });
    }
  } catch (err) {
    logger.error('Recurrence job error', { error: err.message, stack: err.stack });
  }
}

function start() {
  if (_timer) return;
  runOnce();
  _timer = setInterval(runOnce, INTERVAL_MS);
  _timer.unref();
  logger.info('Recurrence generation job started', { intervalMs: INTERVAL_MS });
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info('Recurrence generation job stopped');
  }
}

module.exports = { start, stop, runOnce };
