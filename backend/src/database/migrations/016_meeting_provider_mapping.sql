-- ============================================================
-- Migration 016: meeting_provider_mapping
-- Records which notes provider is selected for each meeting.
-- One row per meeting; upsert pattern (same as meeting_notes).
-- ============================================================

CREATE TABLE IF NOT EXISTS meeting_provider_mapping (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id             UUID        NOT NULL REFERENCES meetings(id)            ON DELETE CASCADE,
  tenant_id              UUID        NOT NULL REFERENCES customers(id)           ON DELETE CASCADE,
  provider_type          TEXT        NOT NULL DEFAULT 'MANUAL',
  provider_connection_id UUID        REFERENCES provider_connections(id)        ON DELETE SET NULL,
  source_type            TEXT        NOT NULL DEFAULT 'manual',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One mapping per meeting
  CONSTRAINT meeting_provider_mapping_meeting_id_unique UNIQUE (meeting_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_provider_mapping_meeting_id
  ON meeting_provider_mapping (meeting_id);

CREATE INDEX IF NOT EXISTS idx_meeting_provider_mapping_tenant_id
  ON meeting_provider_mapping (tenant_id);
