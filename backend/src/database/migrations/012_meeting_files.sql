-- Migration 012: Meeting Files (MOM uploads)
CREATE TABLE IF NOT EXISTS meeting_files (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      UUID        NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  tenant_id       UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  file_name       TEXT        NOT NULL,
  original_name   TEXT        NOT NULL,
  file_path       TEXT        NOT NULL,
  file_size_bytes BIGINT,
  mime_type       TEXT,
  source_type     TEXT        NOT NULL DEFAULT 'manual_upload',
  uploaded_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_files_meeting ON meeting_files(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_files_tenant  ON meeting_files(tenant_id);
