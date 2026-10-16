-- ============================================================
-- Migration 049: ClickUp-aware carry-forward tracking
--
-- The weekly carry-forward job previously penalized every open task on a
-- blind weekly timer, regardless of real progress in ClickUp. This column
-- stores each task's clickup_status as of its last weekly carry-forward
-- check, so the job can compare "then vs now" and only penalize a task
-- whose ClickUp status genuinely hasn't moved — real stagnation, not just
-- "a week passed."
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS clickup_status_at_last_cf_check TEXT;
