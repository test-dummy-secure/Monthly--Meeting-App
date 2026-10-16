'use strict';

const { Queue }    = require('bullmq');
const { connection } = require('../config/bullmq');
const logger         = require('../utils/logger');

// Shared email delivery queue.
// Imported by: notification.service (to enqueue), invitation.service (to enqueue),
//              email.service (to enqueue reminders), email.job (worker).
// Keeping the queue definition in its own module breaks any circular-dependency risk.
const emailQueue = new Queue('email-delivery', {
  connection,
  defaultJobOptions: {
    attempts:          3,
    backoff:           { type: 'exponential', delay: 5_000 },
    removeOnComplete:  { count: 1_000 },
    removeOnFail:      { count: 500  },
  },
});

emailQueue.on('error', (err) => {
  logger.error('Email queue error', { error: err.message });
});

module.exports = emailQueue;
