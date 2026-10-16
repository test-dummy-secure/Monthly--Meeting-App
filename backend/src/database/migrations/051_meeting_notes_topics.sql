-- ============================================================
-- Migration 051: topic-grouped view of meeting notes
-- Additive only — action_items/decisions_taken/risks_discussed/
-- follow_up_actions stay exactly as they are (every existing
-- consumer: email templates, weekly reports, PDF export, manual
-- edit — keeps working unchanged). `topics` is a NEW, optional
-- column: the same items re-organized by theme for display, with
-- an empty array meaning "not grouped" (older meetings, or if the
-- grouping step itself fails) — the frontend falls back to the
-- existing flat list in that case, never a hard requirement.
-- ============================================================

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS topics JSONB NOT NULL DEFAULT '[]';
