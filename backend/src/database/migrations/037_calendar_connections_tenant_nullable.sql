-- Migration 037: Allow NULL tenant_id on calendar_connections for user-scoped rows.
--
-- Before migration 036, every calendar_connections row was keyed by tenant_id (NOT NULL).
-- Migration 036 introduced user-scoped rows keyed by user_id instead of tenant_id.
-- storeOAuthTokensByUser inserts without a tenant_id, which fails the NOT NULL constraint
-- whenever the ON CONFLICT UPDATE path is not taken (first-time insert for a user).
--
-- Fix: make tenant_id nullable so user-scoped rows (user_id IS NOT NULL) can have
-- tenant_id = NULL. Legacy tenant-keyed rows (user_id IS NULL) still carry tenant_id.

ALTER TABLE calendar_connections
  ALTER COLUMN tenant_id DROP NOT NULL;
