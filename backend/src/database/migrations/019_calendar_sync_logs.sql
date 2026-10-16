-- ============================================================
-- Migration 019: calendar_sync_logs
-- Records every calendar / invitation / reminder operation.
-- Provides the audit trail shown in the Integrations UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_sync_logs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES customers           (id) ON DELETE CASCADE,
  meeting_id     UUID                 REFERENCES meetings            (id) ON DELETE SET NULL,
  connection_id  UUID                 REFERENCES calendar_connections (id) ON DELETE SET NULL,

  provider       TEXT        NOT NULL DEFAULT 'manual',

  sync_type      TEXT        NOT NULL DEFAULT 'sync'
    CONSTRAINT csl_sync_type_check
      CHECK (sync_type IN ('invitation', 'reminder', 'sync')),

  sync_status    TEXT        NOT NULL DEFAULT 'pending'
    CONSTRAINT csl_sync_status_check
      CHECK (sync_status IN ('pending', 'running', 'completed', 'failed')),

  payload        JSONB       NOT NULL DEFAULT '{}',
  error_message  TEXT,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_tenant_id
  ON calendar_sync_logs (tenant_id);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_meeting_id
  ON calendar_sync_logs (meeting_id);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_sync_status
  ON calendar_sync_logs (sync_status);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_created_at
  ON calendar_sync_logs (created_at DESC);
