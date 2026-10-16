-- Migration 033: Fireflies AI transcript integration
-- Adds column to store the Fireflies transcript ID matched to a BMMJ meeting,
-- enabling idempotent re-fetch and audit trail for Fireflies-sourced transcripts.

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS fireflies_transcript_id TEXT;

-- Index for quick lookup when webhook/polling matches by Fireflies transcript ID
CREATE INDEX IF NOT EXISTS idx_meetings_fireflies_transcript_id
  ON meetings (fireflies_transcript_id)
  WHERE fireflies_transcript_id IS NOT NULL;
