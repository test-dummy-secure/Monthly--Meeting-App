-- ============================================================
-- Migration 010: ai_task_recommendations
-- Stores AI-generated remediation task drafts.
-- AM must explicitly approve before a draft becomes a live task.
-- (NXG360 AI gate — never auto-publish.)
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_task_recommendations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  meeting_id            UUID        NOT NULL REFERENCES meetings  (id) ON DELETE CASCADE,
  finding_id            UUID                 REFERENCES findings  (id) ON DELETE SET NULL,

  -- Recommendation payload
  title                 TEXT        NOT NULL,
  action_plan           TEXT,
  risk_reduction_score  INT         NOT NULL DEFAULT 0,
  severity              TEXT
    CONSTRAINT ai_rec_severity_check
      CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  category              TEXT,
  recommended_owner     TEXT,
  due_date_suggestion   TIMESTAMPTZ,

  -- AM approval gate (never auto-publish)
  approval_status       TEXT        NOT NULL DEFAULT 'pending'
    CONSTRAINT ai_rec_approval_status_check
      CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by           TEXT,
  approved_at           TIMESTAMPTZ,
  rejected_reason       TEXT,

  -- Provenance
  ai_model              TEXT        NOT NULL DEFAULT 'claude-sonnet-4-6',
  ai_confidence         NUMERIC(5, 4)
    CONSTRAINT ai_rec_confidence_check
      CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  raw_ai_response       JSONB,

  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_recs_tenant_id
  ON ai_task_recommendations (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ai_recs_meeting_id
  ON ai_task_recommendations (meeting_id);

CREATE INDEX IF NOT EXISTS idx_ai_recs_finding_id
  ON ai_task_recommendations (finding_id)
  WHERE finding_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_recs_approval_status
  ON ai_task_recommendations (approval_status);

CREATE INDEX IF NOT EXISTS idx_ai_recs_generated_at
  ON ai_task_recommendations (generated_at DESC);
