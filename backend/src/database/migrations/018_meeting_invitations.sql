-- ============================================================
-- Migration 018: meeting_invitations
-- One row per recipient per meeting. Status tracks delivery
-- through the Phase-2 calendar / email pipeline.
-- ============================================================

CREATE TABLE IF NOT EXISTS meeting_invitations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id       UUID        NOT NULL REFERENCES meetings  (id) ON DELETE CASCADE,
  tenant_id        UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

  recipient_email  TEXT        NOT NULL,
  recipient_name   TEXT,

  recipient_type   TEXT        NOT NULL DEFAULT 'attendee'
    CONSTRAINT mi_recipient_type_check
      CHECK (recipient_type IN ('attendee', 'organizer', 'observer')),

  status           TEXT        NOT NULL DEFAULT 'pending'
    CONSTRAINT mi_status_check
      CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),

  sent_at          TIMESTAMPTZ,
  error_message    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meeting_invitations_meeting_id
  ON meeting_invitations (meeting_id);

CREATE INDEX IF NOT EXISTS idx_meeting_invitations_tenant_id
  ON meeting_invitations (tenant_id);

CREATE INDEX IF NOT EXISTS idx_meeting_invitations_status
  ON meeting_invitations (status);
