-- ============================================================
-- Migration 005: tasks
-- Core remediation tracking table.
-- Includes weekly-review and escalation-workflow columns added
-- in the current sprint (review_outcome, escalation_status,
-- escalation_history).
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id            UUID        NOT NULL REFERENCES meetings  (id) ON DELETE CASCADE,
  finding_id            UUID                 REFERENCES findings  (id) ON DELETE SET NULL,
  tenant_id             UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

  -- Core fields
  title                 TEXT        NOT NULL,
  action_plan           TEXT,
  risk_reduction_score  INT         NOT NULL DEFAULT 0,

  -- Status workflow
  approval_status       TEXT        NOT NULL DEFAULT 'pending'
    CONSTRAINT tasks_approval_status_check
      CHECK (approval_status IN ('pending', 'approved', 'rejected')),

  remediation_status    TEXT        NOT NULL DEFAULT 'open'
    CONSTRAINT tasks_remediation_status_check
      CHECK (remediation_status IN (
        'open', 'in_progress', 'awaiting_validation',
        'completed', 'closed', 'escalated', 'overdue', 'carry_forward'
      )),

  -- Weekly review outcome (AM records each week)
  review_outcome        TEXT        NOT NULL DEFAULT 'on_track'
    CONSTRAINT tasks_review_outcome_check
      CHECK (review_outcome IN (
        'on_track', 'customer_dependency', 'awaiting_approval', 'escalation_required'
      )),

  -- Escalation workflow
  escalation_status     TEXT        NOT NULL DEFAULT 'eligible'
    CONSTRAINT tasks_escalation_status_check
      CHECK (escalation_status IN ('eligible', 'escalated', 'resolved')),

  escalation_history    JSONB       NOT NULL DEFAULT '[]',

  -- Ownership
  ownership_team        TEXT,
  owner_name            TEXT,
  primary_owner         JSONB,
  secondary_owner       JSONB,

  -- Scheduling
  due_date              TIMESTAMPTZ,
  meeting_timeline      TEXT,

  -- Progress
  progress_percentage   INT         NOT NULL DEFAULT 0
    CONSTRAINT tasks_progress_check CHECK (progress_percentage BETWEEN 0 AND 100),

  carry_forward_count   INT         NOT NULL DEFAULT 0,
  escalation_count      INT         NOT NULL DEFAULT 0,

  -- Misc
  timeline              JSONB       NOT NULL DEFAULT '[]',
  notes                 TEXT,

  last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_id
  ON tasks (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tasks_meeting_id
  ON tasks (meeting_id);

CREATE INDEX IF NOT EXISTS idx_tasks_finding_id
  ON tasks (finding_id)
  WHERE finding_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_remediation_status
  ON tasks (remediation_status);

CREATE INDEX IF NOT EXISTS idx_tasks_approval_status
  ON tasks (approval_status);

CREATE INDEX IF NOT EXISTS idx_tasks_due_date
  ON tasks (due_date)
  WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_review_outcome
  ON tasks (review_outcome);

CREATE INDEX IF NOT EXISTS idx_tasks_escalation_status
  ON tasks (escalation_status);
