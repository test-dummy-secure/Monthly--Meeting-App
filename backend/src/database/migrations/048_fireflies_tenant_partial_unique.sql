-- Migration 048: Fix the tenant_id unique constraint on fireflies_connections.
--
-- Problem: Migration 043 added a per-user partial index (user_id WHERE NOT NULL)
-- but kept the old UNIQUE (tenant_id) constraint unchanged. That constraint applies
-- to ALL rows — including new user-scoped ones — so if a second AM assigned to the
-- same tenant tries to connect Fireflies, their INSERT hits:
--   "Key (tenant_id)=(…) already exists"
-- even though the new row has a different user_id.
--
-- Fix: Drop the blanket UNIQUE (tenant_id) constraint and replace it with a
-- partial unique index scoped to legacy rows only (WHERE user_id IS NULL).
-- User-scoped rows are already covered by idx_fireflies_connections_user_unique.

-- Drop the old blanket constraint
ALTER TABLE fireflies_connections
  DROP CONSTRAINT IF EXISTS fireflies_connections_tenant_unique;

-- Re-add it as a partial constraint — legacy rows only (user_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_fireflies_connections_tenant_legacy_unique
  ON fireflies_connections (tenant_id)
  WHERE user_id IS NULL;
