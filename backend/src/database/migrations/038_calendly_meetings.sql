-- Migration 038: Calendly webhook auto-booking support
-- Adds calendly_event_uuid for idempotent webhook processing and expands
-- the meetings status check to include 'cancelled' for Calendly cancellations.

-- Index-backed unique constraint is safer than a column constraint for nullable columns
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS calendly_event_uuid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_calendly_event_uuid
  ON meetings (calendly_event_uuid)
  WHERE calendly_event_uuid IS NOT NULL;

-- Expand status check to include 'cancelled'
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM   pg_constraint con
  JOIN   pg_class      rel ON rel.oid = con.conrelid
  WHERE  rel.relname = 'meetings'
    AND  con.contype = 'c'
    AND  pg_get_constraintdef(con.oid) ILIKE '%status%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE meetings DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE meetings
  ADD CONSTRAINT meetings_status_check
  CHECK (status IN (
    'scheduled', 'approval_pending', 'approved',
    'reschedule_requested', 'conducted', 'closed', 'cancelled'
  ));

-- Index for fast tenant-scoped lookups after webhook creates a meeting
CREATE INDEX IF NOT EXISTS idx_meetings_calendly_tenant
  ON meetings (tenant_id, created_at DESC)
  WHERE calendly_event_uuid IS NOT NULL;
