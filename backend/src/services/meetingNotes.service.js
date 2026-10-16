'use strict';

const { randomUUID }             = require('crypto');
const db                         = require('../config/db');
const meetingLogRepository       = require('../repositories/meeting-log.repository');
const meetingFileRepository      = require('../repositories/meeting-file.repository');
const noteExtractorService       = require('./notes/noteExtractor.service');
const notePreprocessorService    = require('./notes/notePreprocessor.service');
const noteStructurerService      = require('./notes/noteStructurer.service');
const postMeetingAnalysisService = require('./notes/postMeetingAnalysis.service');
const notesProcessingQueue       = require('../queues/notesProcessing.queue');
const logger                     = require('../utils/logger');

const VALID_STATUSES = new Set(['conducted', 'closed']);

// Mirrors isHighNonAsciiRatio in noteStructurer so fallback paths that call
// autoAnalyze() with stored fields can still pass the flag without re-running
// the full structurer pipeline.
function transcriptIsHighNonAscii(text) {
  if (!text) return false;
  const sample = text.slice(0, 6000).replace(/\s/g, '');
  return sample.length > 0 && (sample.match(/[^\x00-\x7F]/g) || []).length / sample.length > 0.40;
}

// ── Validation ─────────────────────────────────────────────────────────────────

async function validateMeetingForNotes(meetingId, tenantId) {
  const { rows } = await db.query(
    `SELECT id, status, notes_status FROM meetings WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [meetingId, tenantId]
  );
  if (!rows[0]) {
    throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });
  }
  if (!VALID_STATUSES.has(rows[0].status)) {
    throw Object.assign(
      new Error(
        `Meeting notes can only be added after the meeting is conducted ` +
        `(current status: ${rows[0].status})`
      ),
      { statusCode: 409 }
    );
  }
  return rows[0];
}

// Atomically transitions notes_status to 'notes_added'.
// Allowed from: NULL (first submission), 'notes_added' (retry after failure),
// or 'completed' (AM updating/replacing notes after a previous run).
// Blocked only when 'processing' — never interrupt an in-progress analysis.
async function setNotesReady(meetingId) {
  const { rowCount } = await db.query(
    `UPDATE meetings
     SET    notes_status = 'notes_added',
            updated_at   = NOW()
     WHERE  id           = $1
       AND  (notes_status IS NULL OR notes_status IN ('notes_added', 'completed'))`,
    [meetingId]
  );
  return rowCount > 0;
}

// ── Error recovery ─────────────────────────────────────────────────────────────

// Called when preprocessing/extraction fails before autoAnalyze is triggered.
// Resets notes_status to NULL so the AM can re-submit from scratch.
async function resetOnFailure(meetingId) {
  await Promise.allSettled([
    db.query(
      `UPDATE meetings SET notes_status = NULL, updated_at = NOW() WHERE id = $1`,
      [meetingId]
    ),
    db.query(
      `UPDATE meeting_notes
       SET    ai_status           = 'failed',
              processing_metadata = jsonb_set(
                COALESCE(processing_metadata, '{}'),
                '{pipelineError}',
                '"preprocessing_failed"'
              ),
              updated_at = NOW()
       WHERE  meeting_id = $1`,
      [meetingId]
    ),
  ]);
}

// ── Background pipeline — manual text entry ───────────────────────────────────

async function runManualEntryPipeline({ meetingId, tenantId, transcriptText, structuredFields, correlationId, modelOverride }) {
  try {
    let structured;

    if (transcriptText && transcriptText.length >= 200) {
      // Long text: run through Ollama to extract structure
      const preprocessed = notePreprocessorService.process(transcriptText);
      structured = await noteStructurerService.structure(preprocessed, correlationId, modelOverride);
    } else {
      // Short or pre-structured: use provided fields directly
      structured = {
        summary:         structuredFields.summary          || structuredFields.meetingSummary || '',
        actionItems:     Array.isArray(structuredFields.actionItems)     ? structuredFields.actionItems     : [],
        decisionsTaken:  Array.isArray(structuredFields.decisionsTaken)  ? structuredFields.decisionsTaken  : [],
        risksDiscussed:  Array.isArray(structuredFields.risksDiscussed)  ? structuredFields.risksDiscussed  : [],
        followUpActions: Array.isArray(structuredFields.followUpActions) ? structuredFields.followUpActions : [],
      };
    }

    // Guard: if the AI extracted nothing and the DB already has non-empty content
    // from a previous successful run, skip the destructive upsert. This prevents
    // 'Re-run AI' from wiping good notes when the model returns empty (e.g. due
    // to a non-deterministic response or an overly strict guard-rail pass).
    const isEmpty = !structured.summary &&
                    !structured.actionItems.length &&
                    !structured.decisionsTaken.length &&
                    !structured.risksDiscussed.length;
    if (isEmpty) {
      const { rows: existing } = await db.query(
        `SELECT summary, meeting_summary, action_items, decisions_taken,
                risks_discussed, follow_up_actions
         FROM   meeting_notes WHERE meeting_id = $1`,
        [meetingId]
      );
      const ex = existing[0];
      const hasExisting = ex && (
        (ex.summary          && ex.summary.trim())          ||
        (ex.action_items     && ex.action_items.length)     ||
        (ex.decisions_taken  && ex.decisions_taken.length)
      );
      if (hasExisting) {
        logger.warn('MeetingNotes: noteStructurer returned empty — preserving existing content', {
          correlationId, meetingId,
        });
        await db.query(
          `UPDATE meeting_notes SET ai_status = 'pending', updated_at = NOW() WHERE meeting_id = $1`,
          [meetingId]
        );
        postMeetingAnalysisService.autoAnalyze(tenantId, meetingId, {
          summary:         ex.meeting_summary || ex.summary     || '',
          actionItems:     ex.action_items    || [],
          decisionsTaken:  ex.decisions_taken || [],
          risksDiscussed:  ex.risks_discussed || [],
          followUpActions: ex.follow_up_actions || [],
          _highNonAscii:   transcriptIsHighNonAscii(transcriptText),
        }, modelOverride);
        return;
      }
    }

    // Persist structured content (ai_status stays 'pending'; autoAnalyze will flip it)
    await meetingLogRepository.upsert({
      meetingId,
      tenantId,
      provider:         'manual_entry',
      transcriptSource: 'manual',
      transcriptText:   transcriptText || null,
      summary:          structured.summary,
      actionItems:      structured.actionItems,
      followUpActions:  structured.followUpActions,
      meetingSummary:   structured.summary,
      decisionsTaken:   structured.decisionsTaken,
      risksDiscussed:   structured.risksDiscussed,
      topics:           structured.topics,
      aiStatus:         'pending',
    });

    logger.info('MeetingNotes: manual entry structured', {
      correlationId,
      meetingId,
      actionItems: structured.actionItems.length,
    });

    // Hand off to post-meeting AI (acquires lock: notes_added → processing)
    postMeetingAnalysisService.autoAnalyze(tenantId, meetingId, structured, modelOverride);
  } catch (err) {
    logger.error('MeetingNotes: manual entry pipeline failed', {
      correlationId, meetingId, tenantId, error: err.message, stack: err.stack,
    });
    await resetOnFailure(meetingId);
  }
}

// ── Background pipeline — file upload ─────────────────────────────────────────

async function runUploadPipeline({ meetingId, tenantId, filePath, mimeType, originalName, correlationId, modelOverride }) {
  try {
    logger.info('MeetingNotes: upload extraction started', { correlationId, meetingId, mimeType });

    const { text, pageCount, wordCount } = await noteExtractorService.extract(filePath, mimeType);

    if (!text || text.trim().length < 10) {
      throw Object.assign(
        new Error(
          `Could not extract readable text from "${originalName}". ` +
          'The file may be empty or image-only.'
        ),
        { statusCode: 422 }
      );
    }

    const preprocessed = notePreprocessorService.process(text);
    const structured   = await noteStructurerService.structure(preprocessed, correlationId, modelOverride);

    // Persist extracted + structured content (ai_status stays 'pending')
    await meetingLogRepository.upsert({
      meetingId,
      tenantId,
      provider:         'manual_upload',
      transcriptSource: 'file_upload',
      transcriptText:   text,
      summary:          structured.summary,
      actionItems:      structured.actionItems,
      followUpActions:  structured.followUpActions,
      meetingSummary:   structured.summary,
      decisionsTaken:   structured.decisionsTaken,
      risksDiscussed:   structured.risksDiscussed,
      topics:           structured.topics,
      aiStatus:         'pending',
    });

    logger.info('MeetingNotes: upload extraction complete', {
      correlationId, meetingId, pageCount, wordCount,
      actionItems: structured.actionItems.length,
    });

    postMeetingAnalysisService.autoAnalyze(tenantId, meetingId, structured, modelOverride);
  } catch (err) {
    logger.error('MeetingNotes: upload pipeline failed', {
      correlationId, meetingId, tenantId, error: err.message, stack: err.stack,
    });
    await resetOnFailure(meetingId);
  }
}

// ── Service ────────────────────────────────────────────────────────────────────

const MeetingNotesService = {

  // Thin exported wrappers around the private pipeline functions above, so
  // the notes-processing queue worker (jobs/notesProcessing.job.js) can
  // invoke them from a different module without changing their behavior or
  // exposing them as public API — only the queue worker calls these.
  runManualEntryPipelineJob(params) { return runManualEntryPipeline(params); },
  runUploadPipelineJob(params)      { return runUploadPipeline(params); },
  resetOnFailureJob(meetingId)      { return resetOnFailure(meetingId); },

  /**
   * Process manually entered meeting notes.
   * Validates meeting state (conducted or closed only), creates an initial record
   * synchronously, then fires the background extraction + AI pipeline.
   * Returns the initial meeting_notes record with ai_status = 'pending'.
   */
  async processNotes(sourceType, meetingId, tenantId, payload) {
    await validateMeetingForNotes(meetingId, tenantId);

    const acquired = await setNotesReady(meetingId);
    if (!acquired) {
      throw Object.assign(
        new Error('Notes are already being processed or have been completed for this meeting.'),
        { statusCode: 409 }
      );
    }

    // Create initial record immediately so the frontend can start polling
    const meetingNote = await meetingLogRepository.upsert({
      meetingId,
      tenantId,
      provider:         sourceType || 'manual_entry',
      transcriptSource: sourceType === 'fireflies' ? 'fireflies' : 'manual',
      transcriptText:   payload.transcriptText   || null,
      summary:          payload.summary          || null,
      actionItems:      Array.isArray(payload.actionItems)     ? payload.actionItems     : [],
      followUpActions:  Array.isArray(payload.followUpActions) ? payload.followUpActions : [],
      meetingSummary:   payload.meetingSummary   || payload.summary || null,
      decisionsTaken:   Array.isArray(payload.decisionsTaken)  ? payload.decisionsTaken  : [],
      risksDiscussed:   Array.isArray(payload.risksDiscussed)  ? payload.risksDiscussed  : [],
      aiStatus:         'pending',
    });

    const correlationId = randomUUID();
    logger.info('MeetingNotes: manual entry accepted', { correlationId, meetingId, tenantId });

    await notesProcessingQueue.add('manual-entry', {
      meetingId,
      tenantId,
      transcriptText:   payload.transcriptText || null,
      structuredFields: payload,
      correlationId,
    });

    return meetingNote;
  },

  /**
   * Process an uploaded notes file (PDF, DOCX, or TXT).
   * Saves the file record, creates an initial meeting_notes record, then fires the
   * background extraction + structuring + AI analysis pipeline.
   * Returns immediately with { file, meetingNote }.
   */
  async processUpload(meetingId, tenantId, fileInfo, uploadedBy) {
    await validateMeetingForNotes(meetingId, tenantId);

    const acquired = await setNotesReady(meetingId);
    if (!acquired) {
      throw Object.assign(
        new Error('Notes are already being processed or have been completed for this meeting.'),
        { statusCode: 409 }
      );
    }

    const fileRecord = await meetingFileRepository.create({
      meetingId,
      tenantId,
      fileName:      fileInfo.filename,
      originalName:  fileInfo.originalname,
      filePath:      fileInfo.path,
      fileSizeBytes: fileInfo.size,
      mimeType:      fileInfo.mimetype,
      sourceType:    'manual_upload',
      uploadedBy:    uploadedBy || null,
    });

    // Create initial record for frontend polling
    const meetingNote = await meetingLogRepository.upsert({
      meetingId,
      tenantId,
      provider:         'manual_upload',
      transcriptSource: 'file_upload',
      transcriptUrl:    fileInfo.path,
      summary:          `Processing: ${fileInfo.originalname}`,
      actionItems:      [],
      followUpActions:  [],
      meetingSummary:   null,
      decisionsTaken:   [],
      risksDiscussed:   [],
      aiStatus:         'pending',
    });

    const correlationId = randomUUID();
    logger.info('MeetingNotes: upload accepted', {
      correlationId,
      meetingId,
      tenantId,
      fileName: fileInfo.originalname,
      mimeType: fileInfo.mimetype,
      size:     fileInfo.size,
    });

    await notesProcessingQueue.add('upload', {
      meetingId,
      tenantId,
      filePath:     fileInfo.path,
      mimeType:     fileInfo.mimetype,
      originalName: fileInfo.originalname,
      correlationId,
    });

    return { file: fileRecord, meetingNote };
  },

  /**
   * Re-runs the full extraction + AI analysis pipeline from the original source.
   * For Fireflies/transcript meetings: re-runs NoteStructurer from transcript_text
   * so prompt improvements take effect on every re-run.
   * For file uploads: re-extracts from the stored file.
   * Fallback for short manual entries: uses stored structured fields.
   * Clears stale pending post-meeting recommendations before starting so the AM
   * never sees duplicates. Approved/rejected recs are preserved for dedup.
   */
  async reanalyze(meetingId, tenantId, modelOverride) {
    await validateMeetingForNotes(meetingId, tenantId);

    const { rows } = await db.query(
      `SELECT transcript_text, transcript_source,
              summary, meeting_summary, action_items, follow_up_actions,
              decisions_taken, risks_discussed
       FROM   meeting_notes
       WHERE  meeting_id = $1`,
      [meetingId]
    );

    if (!rows[0]) {
      throw Object.assign(
        new Error('No meeting notes found. Submit notes first before re-running analysis.'),
        { statusCode: 404 }
      );
    }

    // Atomically reset — refuse if actively processing (recent update).
    // Allow reset if notes_status = 'processing' but updated_at is > 15 minutes old:
    // that means the processing job died (e.g. server restart) and the meeting is stuck.
    // Normal Fireflies transcript processing takes at most 12 minutes, so 15 min is safe.
    const { rowCount } = await db.query(
      `UPDATE meetings
       SET    notes_status = 'notes_added',
              updated_at   = NOW()
       WHERE  id           = $1
         AND  (
           COALESCE(notes_status, '') != 'processing'
           OR updated_at < NOW() - INTERVAL '15 minutes'
         )`,
      [meetingId]
    );

    if (!rowCount) {
      throw Object.assign(
        new Error('Notes are currently being processed. Wait for the current run to finish, or try again in a few minutes.'),
        { statusCode: 409 }
      );
    }

    // Delete stale pending post-meeting recs so the fresh run produces a clean set.
    // Approved/rejected recs are preserved — they drive dedup so already-actioned
    // tasks are never re-recommended to the AM.
    await db.query(
      `DELETE FROM ai_task_recommendations
       WHERE  meeting_id      = $1
         AND  analysis_type   = 'post_meeting'
         AND  approval_status = 'pending'`,
      [meetingId]
    );

    await db.query(
      `UPDATE meeting_notes
       SET    ai_status  = 'pending',
              updated_at = NOW()
       WHERE  meeting_id = $1`,
      [meetingId]
    );

    const note = rows[0];
    const correlationId = randomUUID();
    logger.info('MeetingNotes: re-analysis requested', { correlationId, meetingId, tenantId });

    // Re-run routing: prefer the source that gives the most accurate extraction.
    // Transcript → full Ollama pipeline so every prompt improvement takes effect on re-run.
    // Stored action_items → fast path only when no transcript is available (manual short entry).
    if (note.transcript_text && note.transcript_text.trim().length >= 200) {
      await notesProcessingQueue.add('manual-entry', {
        meetingId,
        tenantId,
        transcriptText:   note.transcript_text,
        structuredFields: {},
        correlationId,
        modelOverride,
      });
    } else if (Array.isArray(note.action_items) && note.action_items.length >= 5) {
      await notesProcessingQueue.add('stored-notes-reanalyze', {
        tenantId,
        meetingId,
        storedNotes: {
          action_items:      note.action_items,
          follow_up_actions: note.follow_up_actions || [],
        },
      });
    } else if (note.transcript_source === 'file_upload') {
      db.query(
        `SELECT file_path, mime_type, original_name
         FROM   meeting_files
         WHERE  meeting_id  = $1
           AND  tenant_id   = $2
           AND  source_type = 'manual_upload'
         ORDER  BY created_at DESC
         LIMIT  1`,
        [meetingId, tenantId]
      ).then(({ rows: fileRows }) => {
        if (fileRows[0]) {
          notesProcessingQueue.add('upload', {
            meetingId,
            tenantId,
            filePath:     fileRows[0].file_path,
            mimeType:     fileRows[0].mime_type,
            originalName: fileRows[0].original_name,
            correlationId,
            modelOverride,
          });
        } else {
          // File record missing — fall back to stored structured fields
          notesProcessingQueue.add('stored-fields-analyze', {
            tenantId,
            meetingId,
            summary:         note.meeting_summary  || note.summary     || '',
            actionItems:     note.action_items     || [],
            decisionsTaken:  note.decisions_taken  || [],
            risksDiscussed:  note.risks_discussed  || [],
            followUpActions: note.follow_up_actions || [],
            _highNonAscii:   transcriptIsHighNonAscii(note.transcript_text),
            modelOverride,
          });
        }
      }).catch((err) => {
        logger.error('MeetingNotes: reanalyze file lookup failed', {
          correlationId, meetingId, tenantId, error: err.message,
        });
      });
    } else {
      // Short manual entry with no raw transcript — use stored structured fields
      await notesProcessingQueue.add('stored-fields-analyze', {
        tenantId,
        meetingId,
        summary:         note.meeting_summary  || note.summary     || '',
        actionItems:     note.action_items     || [],
        decisionsTaken:  note.decisions_taken  || [],
        risksDiscussed:  note.risks_discussed  || [],
        followUpActions: note.follow_up_actions || [],
        _highNonAscii:   transcriptIsHighNonAscii(note.transcript_text),
        modelOverride,
      });
    }

    return { meetingId, aiStatus: 'pending' };
  },

  getProviderNames: () => ['manual_entry', 'manual_upload', 'fireflies', 'google', 'microsoft'],
};

module.exports = MeetingNotesService;
