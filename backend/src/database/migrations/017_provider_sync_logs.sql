-- ============================================================
-- Migration 017: provider_sync_logs
-- Audit trail for every provider sync attempt.
-- Records status, timing, and error details per sync operation.
-- ============================================================

CREATE TABLE IF NOT EXISTS provider_sync_logs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  meeting_id     UUID        REFERENCES meetings(id)           ON DELETE SET NULL,
  provider_type  TEXT        NOT NULL,
  sync_status    TEXT        NOT NULL DEFAULT 'pending' CHECK (
                   sync_status IN ('pending','running','completed','failed')
                 ),
  error_message  TEXT,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_sync_logs_tenant_id
  ON provider_sync_logs (tenant_id);

CREATE INDEX IF NOT EXISTS idx_provider_sync_logs_meeting_id
  ON provider_sync_logs (meeting_id);

CREATE INDEX IF NOT EXISTS idx_provider_sync_logs_created_at
  ON provider_sync_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_sync_logs_status
  ON provider_sync_logs (sync_status);
