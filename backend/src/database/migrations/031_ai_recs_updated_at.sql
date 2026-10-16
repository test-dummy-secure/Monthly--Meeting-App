-- Migration 031: add updated_at to ai_task_recommendations
-- Required by the PATCH /api/ai/recommendations/:id (edit-before-approve) endpoint.

ALTER TABLE ai_task_recommendations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
