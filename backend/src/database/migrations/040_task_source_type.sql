-- ============================================================
-- Migration 040: task source tracking
-- Adds source_type to distinguish pre_meeting / post_meeting /
-- manual tasks so the action-points email can filter correctly.
-- Adds source_recommendation_id FK for audit traceability.
-- Backfills existing approved tasks from ai_task_recommendations
-- by matching on title + meeting_id + tenant_id.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual'
    CONSTRAINT tasks_source_type_check
      CHECK (source_type IN ('pre_meeting', 'post_meeting', 'manual')),
  ADD COLUMN IF NOT EXISTS source_recommendation_id UUID
    REFERENCES ai_task_recommendations (id) ON DELETE SET NULL;

-- Backfill: restore source_type for tasks created from AI recommendations
-- before this migration. Matches on title + meeting_id + tenant_id.
-- Safe to re-run (WHERE source_type = 'manual' prevents double-updates).
UPDATE tasks t
SET    source_type              = r.analysis_type,
       source_recommendation_id = r.id
FROM   ai_task_recommendations r
WHERE  r.approval_status        = 'approved'
  AND  r.meeting_id             = t.meeting_id
  AND  r.tenant_id              = t.tenant_id
  AND  LOWER(TRIM(r.title))     = LOWER(TRIM(t.title))
  AND  t.source_type            = 'manual';

CREATE INDEX IF NOT EXISTS idx_tasks_source_type
  ON tasks (source_type);

CREATE INDEX IF NOT EXISTS idx_tasks_source_recommendation_id
  ON tasks (source_recommendation_id)
  WHERE source_recommendation_id IS NOT NULL;
