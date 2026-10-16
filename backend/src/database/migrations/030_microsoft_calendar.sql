-- Migration 030: Microsoft Calendar + Calendly hybrid integration (Phase 11)
-- Removes Google as a provider, adds full Microsoft booking/transcript support.

-- ── meetings: booking-pending + customer contact ──────────────────────────────
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS booking_pending          BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS booking_link_sent_at     TIMESTAMPTZ;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS customer_contact_email   TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS customer_contact_name    TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS ms_event_id              TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS teams_join_url           TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS teams_meeting_id         TEXT;

-- ── meetings: post-meeting transcript ─────────────────────────────────────────
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_status     TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_text       TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_fetched_at TIMESTAMPTZ;

-- Migrate existing meetings from google to microsoft provider
UPDATE meetings SET provider = 'microsoft' WHERE provider = 'google';

-- Change default provider to microsoft
ALTER TABLE meetings ALTER COLUMN provider SET DEFAULT 'microsoft';

-- ── calendar_connections: OAuth tokens + Calendly URL + health tracking ───────
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS calendly_url       TEXT;
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS ms_user_id         TEXT;
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS access_token_enc   TEXT;
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS refresh_token_enc  TEXT;
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS token_expires_at   TIMESTAMPTZ;
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS last_error         TEXT;
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS last_error_at      TIMESTAMPTZ;
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS last_verified_at   TIMESTAMPTZ;

-- Remove Google calendar connections, migrate to microsoft
DELETE FROM calendar_connections WHERE provider = 'google';

-- Drop old provider CHECK constraint and replace without google
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM   pg_constraint con
  JOIN   pg_class      rel ON rel.oid = con.conrelid
  WHERE  rel.relname = 'calendar_connections'
    AND  con.contype = 'c'
    AND  pg_get_constraintdef(con.oid) ILIKE '%provider%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE calendar_connections DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE calendar_connections
  ADD CONSTRAINT calendar_connections_provider_check
  CHECK (provider IN ('microsoft', 'manual'));

-- Also update meetings provider check if it exists
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM   pg_constraint con
  JOIN   pg_class      rel ON rel.oid = con.conrelid
  WHERE  rel.relname = 'meetings'
    AND  con.contype = 'c'
    AND  pg_get_constraintdef(con.oid) ILIKE '%provider%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE meetings DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

-- ── transcript_status constraint ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meetings_transcript_status_check'
  ) THEN
    ALTER TABLE meetings ADD CONSTRAINT meetings_transcript_status_check
      CHECK (transcript_status IN ('not_started','fetching','captured','unavailable','skipped'));
  END IF;
END $$;

-- ── performance indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_meetings_booking_pending
  ON meetings (tenant_id, booking_link_sent_at)
  WHERE booking_pending = TRUE;

CREATE INDEX IF NOT EXISTS idx_meetings_transcript_fetching
  ON meetings (transcript_status)
  WHERE transcript_status = 'fetching';

CREATE INDEX IF NOT EXISTS idx_cal_conn_ms_user
  ON calendar_connections (ms_user_id)
  WHERE ms_user_id IS NOT NULL;
