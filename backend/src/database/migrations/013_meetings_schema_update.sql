-- Migration 013: Extend meetings table for full lifecycle tracking
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS created_by         TEXT,
  ADD COLUMN IF NOT EXISTS reschedule_count   INT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reschedule_history JSONB NOT NULL DEFAULT '[]';
