'use strict';

const { Queue }       = require('bullmq');
const { connection }  = require('../config/bullmq');
const logger          = require('../utils/logger');

// Serializes AI/Ollama-dependent meeting-notes processing (transcript →
// structured notes → post-meeting task recommendations) so multiple meetings
// never run their multi-hour, RAM-heavy pipelines concurrently against the
// same local Ollama instance. A single meeting's processing has been observed
// to push RAM usage significantly on its own — two running at once risked
// exhausting memory and taking down the whole backend process, not just
// delaying the second meeting.
//
// concurrency:1 is enforced on the worker side (jobs/notesProcessing.job.js);
// this module only defines where jobs land. Imported by meetingNotes.service
// (to enqueue) and jobs/notesProcessing.job (the worker).
const notesProcessingQueue = new Queue('notes-processing', {
  connection,
  defaultJobOptions: {
    // The pipeline already retries individual Ollama calls internally
    // (see OllamaProvider and the topic-grouping retry loop) — auto-retrying
    // an entire multi-hour job at the queue level on failure would silently
    // double resource usage. A failure should surface, not quietly re-run.
    attempts:         1,
    removeOnComplete: { count: 200 },
    removeOnFail:     { count: 200 },
  },
});

notesProcessingQueue.on('error', (err) => {
  logger.error('Notes processing queue error', { error: err.message });
});

module.exports = notesProcessingQueue;
