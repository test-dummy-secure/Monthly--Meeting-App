-- ============================================================
-- Migration 015: provider_connections
-- Stores tenant-level connections to external meeting notes
-- providers (Fathom, Fireflies, Google Meet, Microsoft Teams).
-- Extension point: real OAuth tokens / API keys are added here
-- when provider integrations are fully implemented.
-- ============================================================

CREATE TABLE IF NOT EXISTS provider_connections (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Provider identity
  provider_type         TEXT        NOT NULL CHECK (
                          provider_type IN ('MANUAL','UPLOAD','FATHOM','FIREFLIES','GOOGLE_MEET','MICROSOFT_TEAMS')
                        ),
  provider_name         TEXT        NOT NULL,

  -- Connection state
  connection_status     TEXT        NOT NULL DEFAULT 'pending' CHECK (
                          connection_status IN ('connected','disconnected','pending','error')
                        ),

  -- Credential / identity metadata (no raw secrets stored here)
  oauth_account_email   TEXT,
  provider_workspace_id TEXT,

  last_sync_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ,

  -- One connection record per provider type per tenant
  CONSTRAINT provider_connections_tenant_provider_unique UNIQUE (tenant_id, provider_type)
);

CREATE INDEX IF NOT EXISTS idx_provider_connections_tenant_id
  ON provider_connections (tenant_id);

CREATE INDEX IF NOT EXISTS idx_provider_connections_status
  ON provider_connections (connection_status);

CREATE INDEX IF NOT EXISTS idx_provider_connections_provider_type
  ON provider_connections (provider_type);
