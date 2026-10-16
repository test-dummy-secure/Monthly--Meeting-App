-- Migration 034: Fireflies AI connection storage
-- Per-tenant encrypted API key for the Fireflies free-tier transcription service.
-- Designed after the nxg360_connections table pattern (migration 008).

CREATE TABLE IF NOT EXISTS fireflies_connections (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- AES-256-GCM encrypted API key (see utils/encryption.js)
  api_key_enc    TEXT        NOT NULL,

  status         TEXT        NOT NULL DEFAULT 'connected'
                   CHECK (status IN ('connected', 'disconnected', 'error')),

  last_synced_at TIMESTAMPTZ,
  sync_metadata  JSONB       NOT NULL DEFAULT '{}',

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ,

  CONSTRAINT fireflies_connections_tenant_unique UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_fireflies_connections_tenant_id
  ON fireflies_connections (tenant_id);

CREATE INDEX IF NOT EXISTS idx_fireflies_connections_status
  ON fireflies_connections (status);
