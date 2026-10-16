-- ============================================================
-- Migration 027: add is_primary to tenant_assignments
--
-- Enables multiple AMs per tenant.  One AM is designated as
-- "primary" — that AM's id is kept in customers.account_manager_id
-- (which the trigger in 026 uses to derive account_manager TEXT).
--
-- The partial unique index enforces at most one primary per tenant
-- at the database level without preventing multiple non-primary rows.
-- ============================================================

-- Step 1: add column (idempotent)
ALTER TABLE tenant_assignments
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

-- Step 2: one-primary-per-tenant enforcement at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_assignments_one_primary
  ON tenant_assignments (tenant_id)
  WHERE is_primary = TRUE;

-- Step 3: backfill — the current FK value is the primary
UPDATE tenant_assignments ta
SET    is_primary = TRUE
FROM   customers c
WHERE  ta.tenant_id = c.id
  AND  ta.user_id   = c.account_manager_id
  AND  ta.is_primary = FALSE;
