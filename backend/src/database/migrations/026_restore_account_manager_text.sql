-- ============================================================
-- Migration 026: restore account_manager TEXT as a DB-maintained
--               derived column, synced via trigger from the FK.
--
-- Migration 025 dropped this column, breaking all raw SQL in
-- journey.service.js, meeting.repository.js, and
-- notification.service.js.  We restore it here and keep it in
-- sync automatically at the database level — the application only
-- ever writes account_manager_id; the trigger derives the name.
-- ============================================================

-- Step 1: restore the TEXT column (nullable)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS account_manager TEXT;

-- Step 2: back-fill from the existing FK data
UPDATE customers c
SET    account_manager = TRIM(CONCAT(u.first_name, ' ', u.last_name))
FROM   users u
WHERE  u.id = c.account_manager_id;

-- Step 3: trigger function — runs on every INSERT or UPDATE that
--         touches account_manager_id, and auto-derives the name.
CREATE OR REPLACE FUNCTION sync_account_manager_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_manager_id IS NULL THEN
    NEW.account_manager := NULL;
  ELSE
    SELECT TRIM(CONCAT(first_name, ' ', last_name))
    INTO   NEW.account_manager
    FROM   users
    WHERE  id = NEW.account_manager_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: attach the trigger (fires before row is written)
DROP TRIGGER IF EXISTS trg_sync_account_manager_name ON customers;
CREATE TRIGGER trg_sync_account_manager_name
  BEFORE INSERT OR UPDATE OF account_manager_id ON customers
  FOR EACH ROW
  EXECUTE FUNCTION sync_account_manager_name();

-- Step 5: restore the original index
CREATE INDEX IF NOT EXISTS idx_customers_account_manager
  ON customers (account_manager);
