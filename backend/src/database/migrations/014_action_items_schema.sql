-- ============================================================
-- Migration 014: Joint Action Tracker
-- Extends tasks table, adds escalations + weekly_reports tables,
-- and adds recommended_owner_type to ai_task_recommendations.
-- ============================================================

-- 1. Extend tasks with action-item fields
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'ACCOUNT_MANAGER'
    CONSTRAINT tasks_owner_type_check
      CHECK (owner_type IN ('CUSTOMER', 'ACCOUNT_MANAGER', 'SHARED')),
  ADD COLUMN IF NOT EXISTS owner_email TEXT,
  ADD COLUMN IF NOT EXISTS owner_department TEXT,
  ADD COLUMN IF NOT EXISTS blocker_reason TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium'
    CONSTRAINT tasks_priority_check
      CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS original_meeting_id UUID REFERENCES meetings (id) ON DELETE SET NULL;

-- 2. Widen remediation_status CHECK to include blocked + cancelled
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_remediation_status_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_remediation_status_check
    CHECK (remediation_status IN (
      'open', 'in_progress', 'awaiting_validation',
      'completed', 'closed', 'escalated', 'overdue', 'carry_forward',
      'blocked', 'cancelled'
    ));

-- 3. Add recommended_owner_type to AI recommendations
ALTER TABLE ai_task_recommendations
  ADD COLUMN IF NOT EXISTS recommended_owner_type TEXT
    CONSTRAINT ai_rec_owner_type_check
      CHECK (recommended_owner_type IN ('CUSTOMER', 'ACCOUNT_MANAGER', 'SHARED'));

-- 4. Escalations table
CREATE TABLE IF NOT EXISTS escalations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID        NOT NULL REFERENCES tasks     (id) ON DELETE CASCADE,
  tenant_id       UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  escalated_by    TEXT        NOT NULL,
  escalated_to    TEXT,
  reason          TEXT        NOT NULL,
  blocker_type    TEXT,
  status          TEXT        NOT NULL DEFAULT 'open'
    CONSTRAINT escalations_status_check
      CHECK (status IN ('open', 'acknowledged', 'resolved', 'closed')),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,
  resolution_note TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalations_task_id   ON escalations (task_id);
CREATE INDEX IF NOT EXISTS idx_escalations_tenant_id ON escalations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_escalations_status    ON escalations (status);

-- 5. Weekly reports table
CREATE TABLE IF NOT EXISTS weekly_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  meeting_id      UUID        REFERENCES meetings (id) ON DELETE SET NULL,
  week_start      DATE        NOT NULL,
  week_end        DATE        NOT NULL,
  generated_by    TEXT        NOT NULL,
  summary         JSONB       NOT NULL DEFAULT '{}',
  tasks_snapshot  JSONB       NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_tenant_id  ON weekly_reports (tenant_id);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_week_start ON weekly_reports (week_start);

-- 6. Indexes for new tasks columns
CREATE INDEX IF NOT EXISTS idx_tasks_owner_type   ON tasks (owner_type);
CREATE INDEX IF NOT EXISTS idx_tasks_priority     ON tasks (priority);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks (completed_at) WHERE completed_at IS NOT NULL;
