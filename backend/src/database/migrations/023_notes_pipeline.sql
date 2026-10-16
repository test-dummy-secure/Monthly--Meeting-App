-- ============================================================
-- Migration 023: Notes pipeline additions
-- Adds analysis_type to ai_task_recommendations,
-- notes_status to meetings, and processing_metadata to meeting_notes.
-- ============================================================

ALTER TABLE ai_task_recommendations
  ADD COLUMN IF NOT EXISTS analysis_type TEXT NOT NULL DEFAULT 'pre_meeting'
    CONSTRAINT ai_rec_analysis_type_check
      CHECK (analysis_type IN ('pre_meeting', 'post_meeting'));

CREATE INDEX IF NOT EXISTS idx_ai_recs_analysis_type
  ON ai_task_recommendations (analysis_type);

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS notes_status TEXT
    CONSTRAINT meetings_notes_status_check
      CHECK (notes_status IN ('notes_pending', 'notes_added', 'processing', 'completed'));

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS processing_metadata JSONB;
