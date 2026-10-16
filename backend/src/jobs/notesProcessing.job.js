'use strict';

const { Worker } = require('bullmq');
const { connection, onWorkerError } = require('../config/bullmq');
const logger = require('../utils/logger');

let worker = null;

// concurrency:1 is the actual fix — every meeting's AI processing (transcript
// → structured notes → post-meeting task recommendations) now runs strictly
// one at a time, queued through BullMQ/Redis, instead of firing independently
// via setImmediate the moment each request came in. Two meetings' pipelines
// running concurrently against the same local Ollama instance risked
// exhausting RAM (a single run has already been observed pushing usage
// significantly on its own) and could have taken down email, ClickUp sync,
// and everything else sharing this Node process along with it.
async function start() {
  try {
    worker = new Worker(
      'notes-processing',
      async (job) => {
        // Lazy-required to avoid a require-cycle: meetingNotes.service needs
        // the queue (to .add() jobs) and the queue's worker needs the service
        // (to run them) — requiring here, inside the handler, breaks the cycle.
        const meetingNotesService        = require('../services/meetingNotes.service');
        const postMeetingAnalysisService = require('../services/notes/postMeetingAnalysis.service');

        logger.info('notesProcessing.job: processing', { jobId: job.id, jobType: job.name });

        switch (job.name) {
          case 'manual-entry':
            return meetingNotesService.runManualEntryPipelineJob(job.data);

          case 'upload':
            return meetingNotesService.runUploadPipelineJob(job.data);

          case 'stored-notes-reanalyze': {
            const { tenantId, meetingId, storedNotes } = job.data;
            return postMeetingAnalysisService.autoAnalyzeFromStoredNotes({ tenantId, meetingId, storedNotes });
          }

          case 'stored-fields-analyze': {
            const {
              tenantId, meetingId, modelOverride,
              summary, actionItems, decisionsTaken, risksDiscussed, followUpActions, _highNonAscii,
            } = job.data;
            return postMeetingAnalysisService.autoAnalyze(tenantId, meetingId, {
              summary, actionItems, decisionsTaken, risksDiscussed, followUpActions, _highNonAscii,
            }, modelOverride);
          }

          default:
            logger.warn('notesProcessing.job: unknown jobType', { jobType: job.name, jobId: job.id });
        }
      },
      {
        connection,
        concurrency: 1, // the fix — see comment above
      }
    );

    worker.on('completed', (job) => {
      logger.info('notesProcessing.job: completed', { jobId: job.id, jobType: job.name });
    });

    worker.on('failed', async (job, err) => {
      logger.error('notesProcessing.job: job failed', {
        jobId:   job?.id,
        jobType: job?.name,
        error:   err.message,
      });

      // A pipeline function's OWN try/catch (see meetingNotes.service.js
      // resetOnFailure, and the equivalent inside postMeetingAnalysis.service.js)
      // handles cleanup for errors that occur during a live run — Ollama
      // failures, parse errors, etc. But that assumption breaks for exactly
      // one case: the worker process itself dying mid-job (e.g. a server
      // restart while a meeting is processing). Then there's no live code
      // left to catch anything — BullMQ's own stalled-job detector is what
      // eventually marks the job failed, from a *different* worker instance,
      // long after the original execution context is gone. Without this,
      // the meeting is left stuck at ai_status:'pending' forever with no
      // indication anything went wrong. Only manual-entry/upload carry a
      // meetingId directly (the two long-running, restart-spanning jobs);
      // the stored-notes/stored-fields paths already reset their own state
      // internally and finish fast enough that this scenario is unlikely
      // to apply to them.
      if ((job?.name === 'manual-entry' || job?.name === 'upload') && job?.data?.meetingId) {
        try {
          const meetingNotesService = require('../services/meetingNotes.service');
          await meetingNotesService.resetOnFailureJob(job.data.meetingId);
          logger.info('notesProcessing.job: reset meeting status after job failure', {
            meetingId: job.data.meetingId, jobType: job.name,
          });
        } catch (resetErr) {
          logger.error('notesProcessing.job: failed to reset meeting status after job failure', {
            meetingId: job?.data?.meetingId, error: resetErr.message,
          });
        }
      }
    });

    worker.on('error', onWorkerError('Notes processing worker'));

    logger.info('notesProcessing.job: worker started', { concurrency: 1 });
  } catch (err) {
    logger.error('notesProcessing.job: failed to start worker', { error: err.message });
  }
}

module.exports = { start };
