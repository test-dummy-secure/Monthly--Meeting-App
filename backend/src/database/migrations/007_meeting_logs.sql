-- ============================================================
-- Migration 007: meeting_notes (meeting logs)
-- Stores post-meeting structured intelligence: transcript,
-- summary, action items, decisions, risk observations.
-- Named meeting_notes to match the existing journey.service.js
-- SQL queries that already reference this table name.
-- ============================================================

CREATE TABLE IF NOT EXISTS meeting_notes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id        UUID        NOT NULL REFERENCES meetings  (id) ON DELETE CASCADE,
  tenant_id         UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

  -- Source metadata
  provider          TEXT,                         -- 'google', 'microsoft', 'manual'
  transcript_source TEXT        NOT NULL DEFAULT 'manual',
  transcript_url    TEXT,
  transcript_text   TEXT,

  -- Structured content
  summary           TEXT,
  action_items      JSONB       NOT NULL DEFAULT '[]',
  follow_up_actions JSONB       NOT NULL DEFAULT '[]',
  meeting_summary   TEXT,
  decisions_taken   JSONB       NOT NULL DEFAULT '[]',
  risks_discussed   JSONB       NOT NULL DEFAULT '[]',

  -- AI processing
  ai_status         TEXT        NOT NULL DEFAULT 'completed',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,

  -- One log record per meeting; upsert pattern in meeting-log.repository.js
  -- relies on this constraint.
  CONSTRAINT meeting_notes_meeting_id_unique UNIQUE (meeting_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting_id
  ON meeting_notes (meeting_id);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_tenant_id
  ON meeting_notes (tenant_id);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_created_at
  ON meeting_notes (created_at DESC);
