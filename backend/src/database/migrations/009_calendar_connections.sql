-- ============================================================
-- Migration 009: calendar_connections
-- OAuth2 calendar integration credentials per (tenant, provider).
-- Access/refresh tokens are stored AES-256-GCM encrypted.
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_connections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

  provider          TEXT        NOT NULL
    CONSTRAINT calendar_conn_provider_check
      CHECK (provider IN ('google', 'microsoft')),

  -- OAuth2 tokens (encrypted at application layer before INSERT)
  access_token_enc  TEXT,
  refresh_token_enc TEXT,
  token_expires_at  TIMESTAMPTZ,

  connected_email   TEXT,

  status            TEXT        NOT NULL DEFAULT 'connected'
    CONSTRAINT calendar_conn_status_check
      CHECK (status IN ('connected', 'disconnected', 'error', 'expired')),

  scopes            JSONB       NOT NULL DEFAULT '[]',

  connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at      TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,

  CONSTRAINT calendar_connections_tenant_provider_unique UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_tenant_id
  ON calendar_connections (tenant_id);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_provider
  ON calendar_connections (provider);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_status
  ON calendar_connections (status);
