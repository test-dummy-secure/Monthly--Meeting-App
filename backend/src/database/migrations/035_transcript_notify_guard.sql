-- 035_transcript_notify_guard.sql
--
-- Adds two columns used to permanently prevent duplicate post-meeting emails:
--
--   transcript_notified_at        (S-2)
--     Atomic one-shot claim guard. _handleNoTranscript / _sendNotification
--     do: UPDATE … WHERE transcript_notified_at IS NULL. The first chain wins;
--     all others get rowCount=0 and skip silently. Covers both "Meeting Complete"
--     and "Meeting Notes Ready" notifications.
--
--   transcript_polling_started_at (S-3)
--     Authoritative start time stamped once at conduct. Recovery scans restore
--     this value instead of using Date.now(), so the 2-hour polling window is
--     shared across all server restarts rather than reset on each one.

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS transcript_notified_at        TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS transcript_polling_started_at TIMESTAMPTZ DEFAULT NULL;

-- Back-fill: any meeting already in a terminal transcript state should be
-- considered notified so the new guard never triggers a surprise re-send.
UPDATE meetings
SET    transcript_notified_at = COALESCE(transcript_fetched_at, updated_at)
WHERE  transcript_notified_at IS NULL
  AND  transcript_status IN ('captured', 'unavailable');
