-- ============================================================
-- Migration 004: meeting_configs, meetings, findings, reports
-- These four tables are tightly coupled by the meeting workflow.
-- All carry tenant_id for row-level tenant isolation.
-- ============================================================

-- ─── Meeting configurations ──────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting_configs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  first_meeting_date DATE        NOT NULL,
  meeting_time       TIME        NOT NULL,
  timezone           TEXT        NOT NULL DEFAULT 'UTC',
  recurrence_pattern TEXT        NOT NULL DEFAULT 'monthly',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meeting_configs_tenant_id
  ON meeting_configs (tenant_id);

-- ─── Meetings ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meetings (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID        NOT NULL REFERENCES customers      (id) ON DELETE CASCADE,
  meeting_config_id        UUID                 REFERENCES meeting_configs (id) ON DELETE SET NULL,
  scheduled_start          TIMESTAMPTZ NOT NULL,
  scheduled_end            TIMESTAMPTZ NOT NULL,
  meeting_type             TEXT        NOT NULL DEFAULT 'monthly_review',
  meeting_duration_minutes INT         NOT NULL DEFAULT 60,
  calendar_event_id        TEXT,
  status                   TEXT        NOT NULL DEFAULT 'scheduled'
    CONSTRAINT meetings_status_check
      CHECK (status IN (
        'scheduled', 'approval_pending', 'approved',
        'reschedule_requested', 'conducted', 'closed'
      )),
  trigger_date             TIMESTAMPTZ,
  title                    TEXT        NOT NULL,
  provider                 TEXT        NOT NULL DEFAULT 'google',
  meeting_notes            TEXT,
  attendees                JSONB       NOT NULL DEFAULT '[]',
  reschedule_request       JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meetings_tenant_id
  ON meetings (tenant_id);

CREATE INDEX IF NOT EXISTS idx_meetings_status
  ON meetings (status);

CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_start
  ON meetings (scheduled_start DESC);

CREATE INDEX IF NOT EXISTS idx_meetings_tenant_status
  ON meetings (tenant_id, status);

-- ─── Security findings ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS findings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id        UUID        NOT NULL REFERENCES meetings  (id) ON DELETE CASCADE,
  tenant_id         UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  source_finding_id TEXT,
  severity          TEXT        NOT NULL
    CONSTRAINT findings_severity_check
      CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  category          TEXT,
  title             TEXT        NOT NULL,
  description       TEXT,
  system_affected   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_findings_meeting_id
  ON findings (meeting_id);

CREATE INDEX IF NOT EXISTS idx_findings_tenant_id
  ON findings (tenant_id);

CREATE INDEX IF NOT EXISTS idx_findings_severity
  ON findings (severity);

-- ─── Reports ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reports (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  meeting_id                UUID        NOT NULL REFERENCES meetings  (id) ON DELETE CASCADE,
  report_type               TEXT        NOT NULL
    CONSTRAINT reports_type_check
      CHECK (report_type IN ('weekly_progress', 'monthly_summary')),
  title                     TEXT        NOT NULL,
  summary                   TEXT,
  open_tasks_count          INT         NOT NULL DEFAULT 0,
  closed_tasks_count        INT         NOT NULL DEFAULT 0,
  overdue_tasks_count       INT         NOT NULL DEFAULT 0,
  escalated_tasks_count     INT         NOT NULL DEFAULT 0,
  carry_forward_tasks_count INT         NOT NULL DEFAULT 0,
  progress_percentage       INT         NOT NULL DEFAULT 0,
  generated_by              TEXT,
  export_payload            JSONB       NOT NULL DEFAULT '{}',
  generated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_tenant_id
  ON reports (tenant_id);

CREATE INDEX IF NOT EXISTS idx_reports_meeting_id
  ON reports (meeting_id);

CREATE INDEX IF NOT EXISTS idx_reports_generated_at
  ON reports (generated_at DESC);
