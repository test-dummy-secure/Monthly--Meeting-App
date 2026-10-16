-- ============================================================
-- Migration 011: Extend ai_task_recommendations
-- Adds spec-required output fields: business_impact,
-- remediation_strategy, correlation_id.
-- ============================================================

ALTER TABLE ai_task_recommendations
  ADD COLUMN IF NOT EXISTS business_impact      TEXT,
  ADD COLUMN IF NOT EXISTS remediation_strategy TEXT,
  ADD COLUMN IF NOT EXISTS correlation_id       TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_recs_correlation_id
  ON ai_task_recommendations (correlation_id)
  WHERE correlation_id IS NOT NULL;
