-- ============================================================
-- Migration 045: ClickUp integration
-- Stores workspace API key, per-tenant folder/list mappings,
-- and ClickUp task tracking columns on the tasks table.
-- ============================================================

-- One row globally — super admin connects a single ClickUp workspace
CREATE TABLE IF NOT EXISTS clickup_connections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_enc     TEXT        NOT NULL,
  workspace_id    TEXT        NOT NULL,
  workspace_name  TEXT,
  space_id        TEXT,
  space_name      TEXT,
  status          TEXT        NOT NULL DEFAULT 'connected'
                  CHECK (status IN ('connected','disconnected','error')),
  sync_metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per tenant — maps tenant → ClickUp folder + list
CREATE TABLE IF NOT EXISTS clickup_folder_mappings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  folder_id     TEXT        NOT NULL,
  folder_name   TEXT,
  list_id       TEXT        NOT NULL,
  list_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_clickup_folder_mappings_tenant
  ON clickup_folder_mappings (tenant_id);

-- ClickUp task tracking columns on tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS clickup_task_id   TEXT,
  ADD COLUMN IF NOT EXISTS clickup_status    TEXT,
  ADD COLUMN IF NOT EXISTS clickup_url       TEXT,
  ADD COLUMN IF NOT EXISTS clickup_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_clickup_task_id
  ON tasks (clickup_task_id)
  WHERE clickup_task_id IS NOT NULL;
