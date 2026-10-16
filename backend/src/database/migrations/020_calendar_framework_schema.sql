-- ============================================================
-- Migration 020: Calendar Framework Schema Extensions
-- 1. Extend calendar_connections CHECK to allow 'manual'
-- 2. Extend meeting_configs with calendar settings
-- ============================================================

-- ── calendar_connections: add 'manual' provider support ──────────────────────

ALTER TABLE calendar_connections
  DROP CONSTRAINT IF EXISTS calendar_conn_provider_check;

ALTER TABLE calendar_connections
  ADD CONSTRAINT calendar_conn_provider_check
    CHECK (provider IN ('google', 'microsoft', 'manual'));

-- ── meeting_configs: tenant calendar preferences ─────────────────────────────

ALTER TABLE meeting_configs
  ADD COLUMN IF NOT EXISTS default_calendar_provider  TEXT    NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS meeting_duration_minutes   INT     NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS reminder_schedule          JSONB   NOT NULL DEFAULT '[7, 3, 1]',
  ADD COLUMN IF NOT EXISTS calendar_account           TEXT;
