-- Migration 032: Track when an Outlook calendar event was deleted/cancelled externally
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS calendar_cancelled_at TIMESTAMPTZ;
