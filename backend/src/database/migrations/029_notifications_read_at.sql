-- Migration 029: add read_at to notifications
-- NULL = unread; timestamp = when the user dismissed/read the notification.
-- Kept separate from status (pending/delivered/failed) which tracks delivery,
-- not user interaction.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (recipient_email, read_at)
  WHERE read_at IS NULL;
