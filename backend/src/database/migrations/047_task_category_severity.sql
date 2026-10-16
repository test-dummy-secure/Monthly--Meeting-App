-- ============================================================
-- Migration 047: Add category and severity to tasks table
-- These fields are carried over from ai_task_recommendations
-- when a task is approved, and sent to ClickUp on push.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT
    CONSTRAINT tasks_severity_check
      CHECK (severity IN ('critical', 'high', 'medium', 'low'));
