-- ============================================================
-- Migration 001: tenants (customers)
-- Every business table references this via tenant_id (UUID FK).
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  domain              TEXT,
  industry            TEXT,
  timezone            TEXT        NOT NULL DEFAULT 'UTC',
  meeting_platform    TEXT        NOT NULL DEFAULT 'google_meet',
  status              TEXT        NOT NULL DEFAULT 'active'
    CONSTRAINT customers_status_check CHECK (status IN ('active', 'inactive', 'suspended')),
  connected_calendars JSONB       NOT NULL DEFAULT '[]',
  account_manager     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customers_status
  ON customers (status);

CREATE INDEX IF NOT EXISTS idx_customers_account_manager
  ON customers (account_manager);
