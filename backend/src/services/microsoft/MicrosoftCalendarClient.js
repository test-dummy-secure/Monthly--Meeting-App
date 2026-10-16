'use strict';

const logger = require('../../utils/logger');
const { TokenExpiredError, PermissionDeniedError, GraphApiUnavailableError } = require('./MicrosoftTokenStore');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Retry delays in ms: attempt 1 → 2s, attempt 2 → 5s, attempt 3 → 15s
const RETRY_DELAYS = [2000, 5000, 15000];

// ── Core fetch with retry + typed errors ─────────────────────────────────────

async function graphFetch(accessToken, path, opts = {}) {
  const url     = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...opts.headers };
  const fetchOpts = { method: opts.method || 'GET', headers };
  if (opts.body) {
    fetchOpts.body = opts.body;
    fetchOpts.headers['Content-Type'] = 'application/json';
  }

  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      await _sleep(RETRY_DELAYS[attempt - 1]);
      logger.warn('MicrosoftCalendarClient: retrying Graph call', { path, attempt });
    }

    let res;
    try {
      res = await fetch(url, fetchOpts);
    } catch (networkErr) {
      lastErr = new GraphApiUnavailableError(`Network error calling Graph API: ${networkErr.message}`);
      continue;
    }

    if (res.ok) {
      if (res.status === 204) return null;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) return res.json();
      return res.text();
    }

    // Non-retryable auth errors
    if (res.status === 401) {
      throw new TokenExpiredError('Microsoft access token rejected by Graph API — token may be revoked');
    }
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      throw new PermissionDeniedError(
        `Graph API permission denied: ${body?.error?.message || 'insufficient scopes'}`
      );
    }
    if (res.status === 404) {
      return null;
    }

    // Retryable: 429, 500, 502, 503, 504
    const body = await res.json().catch(() => ({}));
    lastErr = new GraphApiUnavailableError(
      `Graph API error ${res.status}: ${body?.error?.message || res.statusText}`
    );
  }

  throw lastErr || new GraphApiUnavailableError('Graph API call failed after all retries');
}

// ── Calendar events ───────────────────────────────────────────────────────────

/**
 * Fetch calendar events created after a given datetime.
 * Used by bookingWatcher to detect new Calendly bookings.
 */
async function getCalendarEvents(accessToken, sinceDateTime) {
  const since  = new Date(sinceDateTime).toISOString();
  const select = 'id,subject,start,end,createdDateTime,onlineMeeting,attendees,bodyPreview';
  const filter = `createdDateTime ge ${since}`;
  const path   = `/me/events?$filter=${encodeURIComponent(filter)}&$select=${select}&$orderby=createdDateTime desc&$top=20`;
  const data   = await graphFetch(accessToken, path);
  return data?.value || [];
}

/**
 * Fetch calendar events whose start time falls within a time window.
 * Uses /me/calendarView which filters by event start/end time, not creation time.
 * Used by _resolveCalendlyTeamsUrl to find the real Teams join URL for a meeting
 * regardless of when the calendar event was created.
 *
 * @param {string} accessToken
 * @param {string} windowStart - ISO datetime (start of search window)
 * @param {string} windowEnd   - ISO datetime (end of search window)
 */
async function getCalendarView(accessToken, windowStart, windowEnd) {
  const select = 'id,subject,start,end,onlineMeeting,attendees';
  const path   = `/me/calendarView?startDateTime=${encodeURIComponent(windowStart)}&endDateTime=${encodeURIComponent(windowEnd)}&$select=${select}&$top=20`;
  const data   = await graphFetch(accessToken, path);
  return data?.value || [];
}

// ── Online Meetings ───────────────────────────────────────────────────────────

/**
 * Look up a Teams meeting object by its join URL.
 * Returns the meeting object or null if not found.
 */
async function getOnlineMeetingByJoinUrl(accessToken, joinUrl) {
  const filter = `JoinWebUrl eq '${joinUrl}'`;
  const path   = `/me/onlineMeetings?$filter=${encodeURIComponent(filter)}&$select=id,joinWebUrl,startDateTime,endDateTime`;
  const data   = await graphFetch(accessToken, path);
  return data?.value?.[0] || null;
}

/**
 * Patch a Teams online meeting to allow recording and transcription by all participants.
 * Calendly-created meetings default to organizer-only recording, which blocks the
 * Fireflies bot. This sets both flags so external bots can record.
 *
 * Non-fatal: caller should catch errors (e.g. missing OnlineMeetings.ReadWrite scope).
 *
 * @param {string} accessToken
 * @param {string} meetingId  - onlineMeetings resource ID (not the join URL)
 * @returns {Promise<object|null>}
 */
async function updateOnlineMeetingRecording(accessToken, meetingId) {
  return graphFetch(accessToken, `/me/onlineMeetings/${encodeURIComponent(meetingId)}`, {
    method: 'PATCH',
    body:   JSON.stringify({ allowRecording: true, allowTranscription: true }),
  });
}

// ── Transcripts ───────────────────────────────────────────────────────────────

/**
 * List available transcripts for a Teams meeting.
 * Returns an array of transcript metadata objects.
 */
async function getTranscripts(accessToken, teamsMeetingId) {
  const path = `/me/onlineMeetings/${encodeURIComponent(teamsMeetingId)}/transcripts`;
  const data = await graphFetch(accessToken, path);
  return data?.value || [];
}

/**
 * Download the text content of a specific transcript.
 * Tries three endpoints in order until one returns content:
 *   1. transcriptContentUrl from metadata (direct CDN URL when available)
 *   2. /content?$format=text/vtt  (correct Graph API endpoint per docs)
 *   3. /$value with Accept: text/vtt  (legacy fallback)
 * Returns the transcript as a plain text string (converted from VTT).
 */
async function downloadTranscript(accessToken, teamsMeetingId, transcriptId, transcriptContentUrl) {
  const base = `/me/onlineMeetings/${encodeURIComponent(teamsMeetingId)}/transcripts/${encodeURIComponent(transcriptId)}`;

  const attempts = [
    // Attempt 1: use direct content URL from transcript metadata if provided
    ...(transcriptContentUrl
      ? [{ url: transcriptContentUrl, headers: { Accept: 'text/vtt' } }]
      : []),
    // Attempt 2: correct Graph endpoint with $format query param
    { url: `${base}/content?$format=text/vtt`, headers: {} },
    // Attempt 3: legacy $value endpoint with Accept header
    { url: `${base}/$value`, headers: { Accept: 'text/vtt' } },
  ];

  for (const { url, headers } of attempts) {
    let raw;
    try {
      raw = await graphFetch(accessToken, url, { headers });
    } catch (err) {
      logger.warn(`MicrosoftCalendarClient: transcript download attempt failed url=${url} err=${err.message}`);
      continue;
    }

    const len     = raw ? raw.length : 0;
    const preview = raw ? raw.slice(0, 200).replace(/\r?\n/g, '\\n') : '(empty)';
    logger.info(`MicrosoftCalendarClient: transcript attempt url=${url} len=${len} preview="${preview}"`);

    if (raw && raw.trim().length > 0) {
      return _parseVttToText(raw);
    }
  }

  return '';
}

/**
 * Create a Teams online meeting on behalf of the signed-in AM.
 * Returns the full meeting object including id and joinWebUrl.
 * Requires OnlineMeetings.ReadWrite delegated permission.
 */
async function createOnlineMeeting(accessToken, { subject, startDateTime, endDateTime }) {
  const data = await graphFetch(accessToken, '/me/onlineMeetings', {
    method: 'POST',
    body: JSON.stringify({ subject, startDateTime, endDateTime }),
  });
  return data; // { id, joinWebUrl, startDateTime, endDateTime, ... }
}

// ── Attendance Reports (best-effort, requires E3/E5 or Teams Premium) ─────────

/**
 * Attempt to fetch attendance reports for a meeting.
 * Returns null instead of throwing if the API is unavailable (licensing).
 */
async function getAttendanceReport(accessToken, teamsMeetingId) {
  try {
    const path = `/me/onlineMeetings/${encodeURIComponent(teamsMeetingId)}/attendanceReports`;
    const data = await graphFetch(accessToken, path);
    return data?.value || [];
  } catch (err) {
    // 403 = licensing, not a hard failure
    logger.warn('MicrosoftCalendarClient: attendance report unavailable (licensing or permissions)', {
      teamsMeetingId, error: err.message,
    });
    return null;
  }
}

// ── Calendar Events (Outlook) ─────────────────────────────────────────────────

/**
 * Create an Outlook Calendar event with an auto-generated Teams join link.
 *
 * This is the correct call for making a meeting appear in a user's Outlook
 * calendar at a specific time.  The legacy createOnlineMeeting() targets
 * /me/onlineMeetings which creates a Teams room only — it never writes to
 * the calendar.
 *
 * Graph responds with the full event object including:
 *   id                     → store as ms_event_id for future PATCH/DELETE
 *   onlineMeeting.joinUrl  → store as teams_join_url
 *
 * Requires delegated scopes: Calendars.ReadWrite + OnlineMeetings.ReadWrite
 *
 * @param {string} accessToken
 * @param {object} opts
 * @param {string}   opts.subject
 * @param {string}   opts.startDateTime  ISO-8601 UTC string
 * @param {string}   opts.endDateTime    ISO-8601 UTC string
 * @param {string}   [opts.timeZone]     IANA timezone name (default: 'UTC')
 * @param {Array}    [opts.attendees]    [{ email, name }]
 * @param {string}   [opts.body]         Plain-text agenda / body
 * @returns {Promise<object>} Graph event object
 */
async function createCalendarEvent(accessToken, {
  subject,
  startDateTime,
  endDateTime,
  timeZone   = 'UTC',
  attendees  = [],
  body: bodyText = '',
}) {
  const payload = {
    subject,
    start: { dateTime: startDateTime, timeZone },
    end:   { dateTime: endDateTime,   timeZone },
    isOnlineMeeting:       true,
    onlineMeetingProvider: 'teamsForBusiness',
    allowNewTimeProposals: false,
  };

  if (bodyText) {
    payload.body = { contentType: 'text', content: bodyText };
  }

  if (attendees.length > 0) {
    payload.attendees = attendees.map((a) => ({
      emailAddress: { address: a.email, name: a.name || a.email },
      type: 'required',
    }));
  }

  return graphFetch(accessToken, '/me/events', {
    method: 'POST',
    body:   JSON.stringify(payload),
  });
}

/**
 * Patch an existing Outlook Calendar event (subject and/or time range).
 * Used when a meeting is rescheduled so the calendar entry stays in sync.
 *
 * @param {string} accessToken
 * @param {string} eventId        ms_event_id stored at creation time
 * @param {object} updates        Any subset of { subject, startDateTime, endDateTime, timeZone }
 * @returns {Promise<object|null>} Updated event or null if nothing to patch
 */
async function updateCalendarEvent(accessToken, eventId, {
  subject,
  startDateTime,
  endDateTime,
  timeZone = 'UTC',
} = {}) {
  const patch = {};
  if (subject !== undefined)       patch.subject = subject;
  if (startDateTime !== undefined) patch.start   = { dateTime: startDateTime, timeZone };
  if (endDateTime   !== undefined) patch.end     = { dateTime: endDateTime,   timeZone };

  if (Object.keys(patch).length === 0) return null;

  return graphFetch(accessToken, `/me/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body:   JSON.stringify(patch),
  });
}

/**
 * Adds attendees to an existing Outlook Calendar event without removing anyone.
 *
 * Microsoft Graph replaces the attendees list on PATCH, so we must GET the
 * current attendees first, merge, then PATCH with the full combined list.
 * Returns null (no-op) if all requested attendees are already present.
 *
 * @param {string} accessToken
 * @param {string} eventId         ms_event_id stored at creation time
 * @param {Array}  newAttendees    [{ email, name }] — attendees to add
 * @returns {Promise<object|null>} Updated event or null if no change needed
 */
async function addAttendeesToEvent(accessToken, eventId, newAttendees = []) {
  if (newAttendees.length === 0) return null;

  const event = await graphFetch(
    accessToken,
    `/me/events/${encodeURIComponent(eventId)}?$select=attendees`
  );

  const existing      = event?.attendees || [];
  const existingEmails = new Set(existing.map((a) => (a.emailAddress?.address || '').toLowerCase()));

  const toAdd = newAttendees.filter((a) => !existingEmails.has(a.email.toLowerCase()));
  if (toAdd.length === 0) return null; // already present — nothing to do

  const merged = [
    ...existing,
    ...toAdd.map((a) => ({
      emailAddress: { address: a.email, name: a.name || a.email },
      type: 'required',
    })),
  ];

  return graphFetch(accessToken, `/me/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body:   JSON.stringify({ attendees: merged }),
  });
}

/**
 * Delete an Outlook Calendar event.
 * Fires non-blocking on meeting cancellation — a 404 (already deleted) is silent.
 *
 * @param {string} accessToken
 * @param {string} eventId  ms_event_id stored at creation time
 * @returns {Promise<null>}
 */
async function deleteCalendarEvent(accessToken, eventId) {
  return graphFetch(accessToken, `/me/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
}

/**
 * Check whether an Outlook Calendar event still exists and is not cancelled.
 * Used by calendarSync.job to detect events deleted or cancelled outside BMMJ.
 *
 * Returns:
 *   'active'    — event exists and is not cancelled
 *   'cancelled' — event exists but isCancelled = true (soft-cancelled in Outlook)
 *   'deleted'   — Graph returned 404 (event was hard-deleted)
 *
 * @param {string} accessToken
 * @param {string} eventId  ms_event_id stored at creation time
 * @returns {Promise<'active'|'cancelled'|'deleted'>}
 */
async function getCalendarEventStatus(accessToken, eventId) {
  const result = await graphFetch(
    accessToken,
    `/me/events/${encodeURIComponent(eventId)}?$select=id,isCancelled`,
  );
  if (!result) return 'deleted';
  if (result.isCancelled) return 'cancelled';
  return 'active';
}

// ── VTT parser ────────────────────────────────────────────────────────────────
// Handles all Teams VTT format variations:
//   • Single-line:  <v Speaker>text</v>
//   • Multi-line:   <v Speaker>\ntext line 1\ntext line 2\n</v>
//   • Lang tags:    <v Speaker><lang en-US>text</lang></v>
//   • No speaker:   plain text after timestamp line
//   • Windows CRLF line endings

function _parseVttToText(vtt) {
  // Normalise line endings (Teams can return CRLF on Windows-hosted tenants)
  const normalised = vtt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into cue blocks — VTT spec uses blank lines as block separators
  const blocks = normalised.split(/\n{2,}/);
  const output = [];
  let currentSpeaker = '';

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // Drop header tokens, cue index numbers, timestamp lines, NOTE blocks
    const bodyLines = lines.filter(
      (l) =>
        l !== 'WEBVTT' &&
        !/^\d+$/.test(l) &&
        !l.includes('-->') &&
        !l.startsWith('NOTE')
    );
    if (!bodyLines.length) continue;

    // Join all body lines of this cue — handles multi-line cues correctly
    const cueText = bodyLines.join(' ');

    // Extract speaker from opening <v SpeakerName> tag if present
    const speakerOpen = cueText.match(/^<v\s+([^>]+)>/);
    if (speakerOpen) {
      const speaker = speakerOpen[1].trim();
      // Strip ALL VTT/HTML inline tags in one pass (<v>, </v>, <lang>, </lang>, etc.)
      const clean = cueText.replace(/<[^>]+>/g, '').trim();
      if (!clean) continue;
      if (speaker !== currentSpeaker) {
        currentSpeaker = speaker;
        output.push(`\n${speaker}:`);
      }
      output.push(`  ${clean}`);
    } else {
      // No speaker tag — strip inline tags and emit as unlabelled continuation
      const clean = cueText.replace(/<[^>]+>/g, '').trim();
      if (clean) output.push(`  ${clean}`);
    }
  }

  return output.join('\n').trim();
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  graphFetch,
  getCalendarEvents,
  getCalendarView,
  getOnlineMeetingByJoinUrl,
  updateOnlineMeetingRecording,
  createOnlineMeeting,
  createCalendarEvent,
  updateCalendarEvent,
  addAttendeesToEvent,
  deleteCalendarEvent,
  getCalendarEventStatus,
  getTranscripts,
  downloadTranscript,
  getAttendanceReport,
};
