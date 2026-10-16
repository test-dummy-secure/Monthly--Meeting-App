-- ============================================================
-- Migration 044: task due-date reminder sent flags
-- Tracks whether T-2 and T-1 day reminder emails have been
-- sent for each task so the job is idempotent on re-runs.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS due_2d_reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS due_1d_reminder_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index covering only rows the reminder job will ever scan.
-- Excludes completed/closed tasks and tasks with no due date.
CREATE INDEX IF NOT EXISTS idx_tasks_due_reminder
  ON tasks (due_date, tenant_id)
  WHERE due_date IS NOT NULL
    AND remediation_status NOT IN ('completed', 'closed');
