-- ============================================================
-- Migration 036: User-scoped Microsoft OAuth token storage
--
-- PROBLEM: calendar_connections is keyed by (tenant_id, provider).
-- Every new tenant assigned to an AM requires a fresh OAuth flow
-- even though the AM's Microsoft credentials are identical.
--
-- FIX: Add user_id so one OAuth connection covers all tenants
-- managed by that AM.  load(tenantId) now resolves the AM for
-- the tenant and looks up their user-scoped token — new tenants
-- "inherit" the connection automatically.
-- ============================================================

-- Step 1: Add user_id column (nullable for backward compat with existing rows)
ALTER TABLE calendar_connections
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users (id) ON DELETE CASCADE;

-- Step 2: Populate user_id for existing rows.
-- For each AM, only the most-recently-used connection per provider
-- gets user_id set (to satisfy the unique index we create in Step 3).
-- Older/duplicate rows retain NULL and continue working as legacy
-- tenant-keyed fallbacks.
WITH ranked AS (
  SELECT
    cc.id,
    c.account_manager_id                                          AS am_id,
    ROW_NUMBER() OVER (
      PARTITION BY c.account_manager_id, cc.provider
      ORDER BY cc.last_used_at DESC NULLS LAST,
               cc.connected_at DESC
    )                                                             AS rn
  FROM calendar_connections cc
  JOIN customers             c ON c.id = cc.tenant_id
  WHERE cc.user_id IS NULL
)
UPDATE calendar_connections cc
SET    user_id = r.am_id
FROM   ranked r
WHERE  cc.id = r.id
  AND  r.rn  = 1;

-- Step 3: Partial unique index — one active connection per (AM user, provider).
-- Partial (WHERE user_id IS NOT NULL) so legacy tenant-keyed rows
-- (user_id IS NULL) are unaffected and keep their own UNIQUE(tenant_id, provider).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cal_conn_user_provider
  ON calendar_connections (user_id, provider)
  WHERE user_id IS NOT NULL;

-- Step 4: Fast lookup index for the AM-join query in load()
CREATE INDEX IF NOT EXISTS idx_cal_conn_user_id
  ON calendar_connections (user_id)
  WHERE user_id IS NOT NULL;
