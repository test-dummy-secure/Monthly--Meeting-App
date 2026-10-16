-- ============================================================
-- Migration 003: tenant_assignments
-- Explicit many-to-many: one user can manage multiple tenants.
-- The users.tenant_id FK is kept for the primary/default tenant;
-- this table captures all supplementary assignments.
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant_assignments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users     (id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'account_manager',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID        REFERENCES users (id) ON DELETE SET NULL,

  CONSTRAINT tenant_assignments_unique UNIQUE (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_assignments_user_id
  ON tenant_assignments (user_id);

CREATE INDEX IF NOT EXISTS idx_tenant_assignments_tenant_id
  ON tenant_assignments (tenant_id);
