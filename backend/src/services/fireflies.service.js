'use strict';

const logger              = require('../utils/logger');
const { buildAttendeeList } = require('../utils/attendees');

const FIREFLIES_API_URL = 'https://api.fireflies.ai/graphql';

// ── GraphQL client ────────────────────────────────────────────────────────────

const GQL_TIMEOUT_MS = 30_000; // 30 s — Fireflies free tier is generally fast

async function gql(apiKey, query, variables = {}) {
  if (!apiKey) throw new Error('Fireflies API key not configured for this tenant');

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), GQL_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(FIREFLIES_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body:   JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (networkErr) {
    const isTimeout = networkErr.name === 'AbortError';
    throw Object.assign(
      new Error(isTimeout
        ? `Fireflies API timed out after ${GQL_TIMEOUT_MS / 1000}s`
        : `Fireflies API network error: ${networkErr.message}`),
      { code: 'FIREFLIES_NETWORK_ERROR' }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Parse Retry-After header if present (seconds or HTTP-date)
    const retryAfterHdr = res.headers && typeof res.headers.get === 'function'
      ? res.headers.get('retry-after')
      : null;
    let retryAfter = null;
    if (retryAfterHdr) {
      const asInt = parseInt(retryAfterHdr, 10);
      if (!Number.isNaN(asInt)) retryAfter = asInt; // seconds
      else {
        const date = new Date(retryAfterHdr);
        if (!Number.isNaN(date.getTime())) retryAfter = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
      }
    }
    const err = new Error(`Fireflies API HTTP ${res.status}: ${body.slice(0, 200)}`);
    Object.assign(err, { code: 'FIREFLIES_HTTP_ERROR', status: res.status, retryAfter });
    throw err;
  }

  const json = await res.json();
  if (json.errors?.length) {
    const messages = json.errors.map((e) => e.message).join('; ');
    const err      = new Error(`Fireflies GraphQL: ${messages}`);
    // Fireflies returns rate-limit errors inside the GraphQL errors array (HTTP 200)
    // rather than as HTTP 429, so we must detect and surface it explicitly.
    const isRateLimit = /too many requests|rate.?limit/i.test(messages);
    if (isRateLimit) {
      const match = messages.match(/retry after\s+(.+?)(?:\s*\(|$)/i);
      let retryAfter = null;
      if (match) {
        const date = new Date(match[1].trim());
        if (!isNaN(date.getTime())) {
          retryAfter = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
        }
      }
      Object.assign(err, { code: 'FIREFLIES_GQL_ERROR', status: 429, retryAfter, details: json.errors });
    } else {
      Object.assign(err, { code: 'FIREFLIES_GQL_ERROR', details: json.errors });
    }
    throw err;
  }

  return json.data;
}

// ── Queries ───────────────────────────────────────────────────────────────────

const LIST_TRANSCRIPTS_QUERY = `
  query ListTranscripts($limit: Int) {
    transcripts(limit: $limit) {
      id
      title
      date
      duration
      meeting_link
    }
  }
`;

const GET_TRANSCRIPT_QUERY = `
  query GetTranscript($id: String!) {
    transcript(id: $id) {
      id
      title
      date
      duration
      participants
      sentences {
        speaker_name
        text
        start_time
      }
    }
  }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeTitle(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Calendly meetings: Fireflies stores the transcript with the Teams invitee display name
// (e.g. "Nikhil and Nikhil Madichetti") while BMMJ uses the AM-set title
// (e.g. "Security Review — Nikhil"). Full substring never matches, so fall back to
// word overlap: any significant word (≥5 chars) from the BMMJ title found in the
// Fireflies title counts as a match. The time-window filter prevents false positives.
function titleOverlap(normMeeting, normFirefly) {
  if (!normMeeting || !normFirefly) return false;
  if (normMeeting.includes(normFirefly) || normFirefly.includes(normMeeting)) return true;
  const words = normMeeting.split(' ').filter(w => w.length >= 5);
  return words.some(w => normFirefly.includes(w));
}

// Extracts the unique Teams meeting thread ID from a join URL so transcripts can be
// matched by URL rather than title. Works for both URL-encoded and plain URLs.
// Example input:  https://teams.microsoft.com/l/meetup-join/19%3ameeting_XXXX%40thread.v2/0?...
// Example output: 19:meeting_xxxx@thread.v2  (lowercased for case-insensitive compare)
function extractTeamsMeetingId(url) {
  if (!url) return null;
  try {
    const decoded = decodeURIComponent(String(url));
    const match   = decoded.match(/meetup-join\/([^/?#\s]+)/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Search recent Fireflies transcripts and return ALL scored candidates that
 * match the given meeting, sorted best-first.
 *
 * Matching strategy (priority order):
 *   1. URL match  — Teams thread ID from teamsJoinUrl matches transcript.meeting_link.
 *                   Title-independent; works for Calendly meetings where Fireflies stores
 *                   the invitee display name ("Nikhil and Nikhil Madichetti") instead of
 *                   the BMMJ title ("Security Review — Acme"). Score = 0 (best).
 *   2. Title match — time-window filter + title overlap (exact > substring > word overlap).
 *                   Used as fallback when no Teams URL is stored for the meeting.
 *   - Window: transcript date falls within (scheduledStart − 30 min) →
 *             (scheduledEnd + 2 hrs). Applies to both strategies.
 *
 * Returns an empty array when no candidates match — caller should retry later.
 * The caller (firefliesFetch.job) is responsible for the final exclusivity
 * check against transcript IDs already claimed by other meetings.
 *
 * @param {string}      apiKey         - decrypted per-tenant Fireflies API key
 * @param {string}      meetingTitle   - BMMJ meeting.title
 * @param {string}      scheduledStart - ISO timestamp (meetings.scheduled_start)
 * @param {string|null} scheduledEnd   - ISO timestamp (meetings.scheduled_end)
 * @param {string|null} teamsJoinUrl   - real Teams join URL stored on the meeting
 * @returns {Array<{id, title, date, titleScore, timeDeltaMs}>} sorted candidates
 */
async function findTranscriptId(apiKey, meetingTitle, scheduledStart, scheduledEnd, teamsJoinUrl = null) {
  const data        = await gql(apiKey, LIST_TRANSCRIPTS_QUERY, { limit: 50 });
  const transcripts = data?.transcripts || [];
  if (transcripts.length === 0) return [];

  const startMs = new Date(scheduledStart).getTime();
  const endMs   = scheduledEnd
    ? new Date(scheduledEnd).getTime()
    : startMs + 4 * 60 * 60 * 1000; // safe fallback when scheduledEnd is absent

  const windowFrom  = startMs - 30 * 60 * 1000;      // 30 min before meeting start
  const windowTo    = endMs   + 2  * 60 * 60 * 1000; // 2 hours after meeting end
  const normMeeting = normalizeTitle(meetingTitle);
  const bmmjThreadId = extractTeamsMeetingId(teamsJoinUrl); // null when not a Teams URL

  const candidates = transcripts
    .map((t) => {
      const dateMs = new Date(t.date).getTime();

      // ── Strategy 1: URL match — no time window needed ─────────────────────
      // The Teams thread ID is a unique identifier for the meeting regardless of
      // when it was held. A meeting conducted early (e.g. a July 8 meeting tested
      // on July 7) has a transcript date far outside the scheduled window but the
      // join URL is unique — applying a time gate here would silently drop it.
      if (bmmjThreadId) {
        const ffThreadId = extractTeamsMeetingId(t.meeting_link);
        if (ffThreadId && ffThreadId === bmmjThreadId) {
          return {
            id:          t.id,
            title:       t.title,
            date:        t.date,
            titleScore:  0,
            timeDeltaMs: Math.abs(dateMs - startMs),
            matchedBy:   'url',
          };
        }
      }

      // ── Strategy 2: Title overlap + time window (fallback) ────────────────
      // Title matching is fuzzy — enforce the time window to prevent false
      // positives from similarly-titled meetings on different days.
      if (dateMs < windowFrom || dateMs > windowTo) return null;
      const normFirefly = normalizeTitle(t.title);
      const exactMatch  = normMeeting === normFirefly;
      if (!titleOverlap(normMeeting, normFirefly)) return null;

      return {
        id:          t.id,
        title:       t.title,
        date:        t.date,
        titleScore:  exactMatch ? 0 : 1,
        timeDeltaMs: Math.abs(dateMs - startMs),
        matchedBy:   'title',
      };
    })
    .filter(Boolean);

  // Best first: exact title match wins, then closest to scheduledStart
  candidates.sort((a, b) =>
    a.titleScore - b.titleScore || a.timeDeltaMs - b.timeDeltaMs
  );

  if (candidates.length > 0) {
    logger.info('fireflies.service: transcript candidates found', {
      meetingTitle,
      window: {
        from: new Date(windowFrom).toISOString(),
        to:   new Date(windowTo).toISOString(),
      },
      count: candidates.length,
      best:  { title: candidates[0].title, id: candidates[0].id, date: candidates[0].date },
    });
  }

  return candidates;
}

/**
 * Fetch all sentences for a Fireflies transcript and return formatted plain text.
 *
 * Output format (one line per sentence):
 *   "Speaker Name: sentence text"
 *
 * This matches the format the Ollama note-structurer expects.
 *
 * @param  {string} transcriptId  - Fireflies transcript ID
 * @returns {{ text: string, transcriptId: string, duration: number }}
 */
async function fetchTranscriptText(apiKey, transcriptId) {
  const data       = await gql(apiKey, GET_TRANSCRIPT_QUERY, { id: transcriptId });
  const transcript = data?.transcript;

  if (!transcript) {
    throw Object.assign(
      new Error(`Fireflies transcript ${transcriptId} not found`),
      { code: 'FIREFLIES_NOT_FOUND' }
    );
  }

  const sentences = transcript.sentences || [];
  if (sentences.length === 0) {
    throw Object.assign(
      new Error(`Fireflies transcript ${transcriptId} has no sentences yet`),
      { code: 'FIREFLIES_EMPTY' }
    );
  }

  const text = sentences
    .map((s) => `${(s.speaker_name || 'Speaker').trim()}: ${(s.text || '').trim()}`)
    .filter((line) => line.includes(': ') && line.length > 3)
    .join('\n');

  // Build complete attendee list by merging:
  //   - sentences speakers   (ground truth — every person who spoke, including guests)
  //   - participants[] API   (Fireflies-authenticated users with emails)
  // The utility handles bot filtering, name normalisation, and deduplication.
  const participants = buildAttendeeList(transcript.participants || [], sentences);

  logger.info('fireflies.service: transcript fetched', {
    transcriptId,
    sentences:    sentences.length,
    participants: participants.length,
    duration:     transcript.duration,
    textLength:   text.length,
  });

  return {
    text,
    transcriptId: transcript.id,
    duration:     transcript.duration || 0,
    title:        transcript.title,
    participants,   // complete attendee list → saved to meetings.attendees
  };
}

/**
 * Validates a Fireflies API key by making a minimal live API call.
 * Called before storing a new key from the Integrations UI.
 *
 * @param  {string} apiKey
 * @returns {{ valid: boolean, message?: string }}
 */
async function validateApiKey(apiKey) {
  try {
    await gql(apiKey, LIST_TRANSCRIPTS_QUERY, { limit: 1 });
    return { valid: true };
  } catch (err) {
    const isRateLimit = err.status === 429 || /too many requests|rate.?limit/i.test(err.message || '');
    return { valid: false, isRateLimit, message: err.message };
  }
}

// ── Bot injection ─────────────────────────────────────────────────────────────

const ADD_TO_LIVE_MEETING_MUTATION = `
  mutation AddToLiveMeeting($meeting_link: String!, $title: String) {
    addToLiveMeeting(meeting_link: $meeting_link, title: $title) {
      success
      message
    }
  }
`;

/**
 * Schedules the Fireflies bot to join a live meeting by its URL.
 * Call this 5–10 minutes before scheduledStart so the bot is ready when the
 * meeting opens.  Fireflies queues the bot and joins as soon as the room is live.
 *
 * @param {string} apiKey        - decrypted per-tenant Fireflies API key
 * @param {string} meetingUrl    - Teams / Zoom / Meet join URL
 * @param {string} meetingTitle  - BMMJ meeting title (shown in Fireflies dashboard)
 * @returns {{ success: boolean, message: string }}
 */
async function scheduleBotForMeeting(apiKey, meetingUrl, meetingTitle) {
  const data = await gql(apiKey, ADD_TO_LIVE_MEETING_MUTATION, {
    meeting_link: meetingUrl,
    title:        meetingTitle || 'NxgSecure Security Meeting',
  });

  const result = data?.addToLiveMeeting;
  logger.info('fireflies.service: bot scheduled', {
    success: result?.success,
    message: result?.message,
    meetingUrl,
  });

  return {
    success: result?.success === true,
    message: result?.message || '',
  };
}

module.exports = { findTranscriptId, fetchTranscriptText, validateApiKey, scheduleBotForMeeting };
