-- ============================================================
-- Migration 022: Remove FIREFLIES and GOOGLE_MEET provider types
-- Narrows the supported notes providers to:
--   MANUAL, UPLOAD, FATHOM, MICROSOFT_TEAMS
-- ============================================================

-- 1. Clean up any meeting mappings that used the removed providers
DELETE FROM meeting_provider_mapping
WHERE provider_type IN ('FIREFLIES', 'GOOGLE_MEET');

-- 2. Clean up any provider connections for the removed providers
DELETE FROM provider_connections
WHERE provider_type IN ('FIREFLIES', 'GOOGLE_MEET');

-- 3. Drop the old CHECK constraint and replace with the narrowed set
ALTER TABLE provider_connections
  DROP CONSTRAINT IF EXISTS provider_connections_provider_type_check;

ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_provider_type_check
  CHECK (provider_type IN ('MANUAL', 'UPLOAD', 'FATHOM', 'MICROSOFT_TEAMS'));
