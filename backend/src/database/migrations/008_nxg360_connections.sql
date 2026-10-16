-- ============================================================
-- Migration 008: nxg360_connections
-- One row per tenant — stores NXG360 MSSP platform integration
-- credentials (encrypted at the application layer before INSERT).
-- ============================================================

CREATE TABLE IF NOT EXISTS nxg360_connections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

  -- Credentials (always stored AES-256-GCM encrypted by app layer)
  api_key_enc     TEXT,
  api_endpoint    TEXT,
  workspace_id    TEXT,

  connection_type TEXT        NOT NULL DEFAULT 'api_key'
    CONSTRAINT nxg360_conn_type_check
      CHECK (connection_type IN ('api_key', 'oauth2', 'service_account')),

  status          TEXT        NOT NULL DEFAULT 'connected'
    CONSTRAINT nxg360_status_check
      CHECK (status IN ('connected', 'disconnected', 'error')),

  last_synced_at  TIMESTAMPTZ,
  sync_metadata   JSONB       NOT NULL DEFAULT '{}',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,

  CONSTRAINT nxg360_connections_tenant_unique UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_nxg360_connections_tenant_id
  ON nxg360_connections (tenant_id);

CREATE INDEX IF NOT EXISTS idx_nxg360_connections_status
  ON nxg360_connections (status);
