-- ============================================================
-- Migration 006: task_history
-- Immutable audit trail — one row per state-change event on a task.
-- old_value / new_value are JSON snapshots of the changed fields.
-- ============================================================

CREATE TABLE IF NOT EXISTS task_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID        NOT NULL REFERENCES tasks     (id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

  action_type TEXT        NOT NULL,   -- e.g. 'status_change', 'review_outcome', 'escalation'
  actor       TEXT        NOT NULL,   -- email or display name of the user who triggered the change
  actor_role  TEXT,                   -- 'super_admin' | 'account_manager'

  old_value   JSONB,                  -- snapshot of changed fields before the event
  new_value   JSONB,                  -- snapshot of changed fields after the event
  notes       TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_history_task_id
  ON task_history (task_id);

CREATE INDEX IF NOT EXISTS idx_task_history_tenant_id
  ON task_history (tenant_id);

CREATE INDEX IF NOT EXISTS idx_task_history_created_at
  ON task_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_history_action_type
  ON task_history (action_type);
