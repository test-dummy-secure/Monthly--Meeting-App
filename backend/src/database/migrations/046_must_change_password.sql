-- ============================================================
-- Migration 046: must_change_password flag on users
-- Set to true when Super Admin resets an AM password so the
-- AM is forced to choose a new password on next login.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
