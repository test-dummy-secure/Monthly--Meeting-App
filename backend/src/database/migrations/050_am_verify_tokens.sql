-- ============================================================
-- Migration 050: AM one-click verify-and-close tokens
-- Reuses task_confirmation_tokens (already proven for the
-- customer-facing magic link) rather than a new table — the
-- shape is identical (task_id, recipient, token, status,
-- expiry). token_type distinguishes which flow a row belongs to.
-- ============================================================

ALTER TABLE task_confirmation_tokens
  ADD COLUMN IF NOT EXISTS token_type TEXT NOT NULL DEFAULT 'customer_confirm'
    CONSTRAINT tct_token_type_check
      CHECK (token_type IN ('customer_confirm', 'am_verify'));

-- Existing token lookup index is on (token) alone and already covers both
-- types since tokens are globally unique regardless of type.
