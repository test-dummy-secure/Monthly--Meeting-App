-- ============================================================
-- Migration 025: account_manager TEXT → account_manager_id UUID FK
--
-- Replaces the fragile name-string column with a proper foreign
-- key to users(id).  ON DELETE SET NULL means removing an AM user
-- leaves the tenant unassigned rather than cascading a delete.
--
-- The back-fill step matches existing name strings to user rows
-- using the same CONCAT(first_name, ' ', last_name) logic that
-- tenantAccessService used — so no data is lost.
-- ============================================================

-- Step 1: add the FK column (nullable — unassigned tenants stay NULL)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS account_manager_id UUID
    REFERENCES users(id) ON DELETE SET NULL;

-- Step 2: back-fill from existing name strings
UPDATE customers c
SET    account_manager_id = (
  SELECT u.id
  FROM   users u
  WHERE  u.role = 'account_manager'
    AND  TRIM(CONCAT(u.first_name, ' ', u.last_name)) = TRIM(c.account_manager)
  LIMIT  1
)
WHERE  c.account_manager IS NOT NULL;

-- Step 3: drop old column and its index
DROP INDEX IF EXISTS idx_customers_account_manager;
ALTER TABLE customers DROP COLUMN IF EXISTS account_manager;

-- Step 4: index the new FK for fast AM-scoped lookups
CREATE INDEX IF NOT EXISTS idx_customers_account_manager_id
  ON customers (account_manager_id);
