-- Migration 039: Per-AM Calendly Personal Access Token storage
-- Stores each AM's Calendly PAT encrypted in calendar_connections so
-- the sync endpoint can pull their existing bookings without a shared .env key.

ALTER TABLE calendar_connections
  ADD COLUMN IF NOT EXISTS calendly_token_enc TEXT;
