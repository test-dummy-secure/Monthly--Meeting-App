-- Migration 024: notifications log table
-- Stores all system-generated notifications with delivery status.
-- recipient_role: ACCOUNT_MANAGER | CUSTOMER | SUPER_ADMIN
-- type: carry_forward_warning | carry_forward_alert | auto_escalation_assigned |
--       auto_escalation_notice | weekly_report_generated | monthly_report_generated

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  task_id         UUID        REFERENCES tasks    (id) ON DELETE SET NULL,
  meeting_id      UUID        REFERENCES meetings (id) ON DELETE SET NULL,
  type            TEXT        NOT NULL,
  recipient_role  TEXT        NOT NULL,
  recipient_email TEXT,
  title           TEXT        NOT NULL,
  body            TEXT,
  payload         JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'pending'
    CONSTRAINT notifications_status_check
      CHECK (status IN ('pending', 'delivered', 'failed')),
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index: efficient for AM dashboard "show my recent notifications"
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created
  ON notifications (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_type
  ON notifications (type);

-- Partial index: fast scan for undelivered notifications only
CREATE INDEX IF NOT EXISTS idx_notifications_pending
  ON notifications (status)
  WHERE status = 'pending';
