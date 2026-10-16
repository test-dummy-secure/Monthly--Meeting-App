ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS week_number         INT,
  ADD COLUMN IF NOT EXISTS report_period_start DATE,
  ADD COLUMN IF NOT EXISTS report_period_end   DATE,
  ADD COLUMN IF NOT EXISTS blocked_tasks_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS report_status       TEXT NOT NULL DEFAULT 'published'
    CONSTRAINT reports_status_check
      CHECK (report_status IN ('draft', 'published', 'archived'));

CREATE INDEX IF NOT EXISTS idx_reports_report_type
  ON reports (report_type);

CREATE INDEX IF NOT EXISTS idx_reports_week_number
  ON reports (week_number) WHERE week_number IS NOT NULL;
