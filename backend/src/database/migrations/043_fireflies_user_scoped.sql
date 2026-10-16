-- Migration 043: Scope Fireflies connections to the AM user, not the tenant.
--
-- Problem: fireflies_connections was keyed on tenant_id (one key per customer).
-- When a tenant is reassigned to a new AM, the new AM inherited the old AM's
-- Fireflies API key silently, showing "connected" even though the key belongs
-- to someone else. Microsoft OAuth (migration 036) already solved this by keying
-- on user_id; this migration applies the same pattern to Fireflies.
--
-- After this migration:
--   - New connections are stored per AM user_id (one key covers all that AM's tenants).
--   - Lookup resolves via the AM who currently manages the tenant, so a new AM
--     sees "not connected" until they enter their own API key.
--   - Legacy per-tenant rows (user_id IS NULL) remain readable as a fallback so
--     existing connections keep working until the AM reconnects with their own key.

ALTER TABLE fireflies_connections
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Partial unique index: one Fireflies connection per AM user.
-- NULL user_id rows (legacy per-tenant data) are excluded from this constraint
-- and keep their existing uniqueness via fireflies_connections_tenant_unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fireflies_connections_user_unique
  ON fireflies_connections (user_id)
  WHERE user_id IS NOT NULL;

-- Supporting index for fast lookup by user_id.
CREATE INDEX IF NOT EXISTS idx_fireflies_connections_user_id
  ON fireflies_connections (user_id)
  WHERE user_id IS NOT NULL;
