-- ============================================================
-- Migration 041: task confirmation tokens
-- Allows customers to confirm task completion via a unique
-- magic link emailed with the action-points PDF.
-- Each token is per (task, recipient_email) pair — one token
-- per task per customer contact, valid for 30 days.
-- ============================================================

CREATE TABLE IF NOT EXISTS task_confirmation_tokens (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Task being confirmed
  task_id         UUID        NOT NULL REFERENCES tasks     (id) ON DELETE CASCADE,
  meeting_id      UUID        NOT NULL REFERENCES meetings  (id) ON DELETE CASCADE,
  tenant_id       UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

  -- The opaque 256-bit token embedded in the confirmation URL
  token           TEXT        NOT NULL,

  -- Who this token was sent to
  recipient_email TEXT        NOT NULL,

  -- Lifecycle
  status          TEXT        NOT NULL DEFAULT 'pending'
    CONSTRAINT tct_status_check
      CHECK (status IN ('pending', 'confirmed', 'expired')),

  confirmed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL,

  -- Groups all tokens generated in a single "send" action
  -- for audit: which tasks were sent together, to whom, when
  send_batch_id   UUID        NOT NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- token lookup is the hot path (customer clicks confirmation link)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tct_token
  ON task_confirmation_tokens (token);

-- used to find all tokens for a task (re-send, status check)
CREATE INDEX IF NOT EXISTS idx_tct_task_id
  ON task_confirmation_tokens (task_id);

-- used for meeting-level audit: which tasks were sent for this meeting
CREATE INDEX IF NOT EXISTS idx_tct_meeting_id
  ON task_confirmation_tokens (meeting_id);

CREATE INDEX IF NOT EXISTS idx_tct_tenant_id
  ON task_confirmation_tokens (tenant_id);

-- used to expire pending tokens via a background job (future)
CREATE INDEX IF NOT EXISTS idx_tct_status_expires
  ON task_confirmation_tokens (status, expires_at)
  WHERE status = 'pending';
