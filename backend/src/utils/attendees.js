'use strict';

/**
 * attendees.js
 *
 * Production-grade utility for building a clean, deduplicated attendee list
 * from Fireflies transcript data.
 *
 * Fireflies has two separate data sources that must be merged:
 *
 *   1. transcript.participants[]  — String[] of Fireflies-authenticated users.
 *      Contains emails for org members but MISSES external guests who joined
 *      via a Teams link without a Fireflies account.
 *
 *   2. transcript.sentences[].speaker_name — The display name of every person
 *      who spoke. This is the ground truth for "who was really in the meeting"
 *      because it comes from the meeting recording, not account authentication.
 *      Downside: names only, no emails.
 *
 * Strategy:
 *   - Use sentences speakers as the base (captures every attendee including guests)
 *   - Enrich with email data from participants[] where names match
 *   - Append any participants[] entries whose names didn't match a speaker
 *   - Normalize names throughout (strip Teams-added trailing digits, trim whitespace)
 *   - Deduplicate by email (primary) then by normalized name (fallback)
 *   - Filter out known bots (Fireflies bot, etc.)
 */

// ── Constants ──────────────────────────────────────────────────────────────────

/** Emails / display-name substrings that belong to meeting bots, not humans. */
const BOT_IDENTIFIERS = [
  'fireflies.ai',
  'notetaker',
  'otter.ai',
  'grain.com',
  'fathom.video',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Normalise a raw Fireflies participant string into { name, email }.
 * Handles three formats:
 *   "name@domain.com"                     → { name: null, email }
 *   "Display Name"                        → { name, email: null }
 *   "Display Name <name@domain.com>"      → { name, email }
 */
function parseParticipantString(raw) {
  const s = (raw || '').trim();
  if (!s) return null;

  const angleMatch = s.match(/^(.+?)\s*<([^>]+)>$/);
  if (angleMatch) {
    return {
      name:  normalizeName(angleMatch[1]) || null,
      email: angleMatch[2].trim().toLowerCase() || null,
    };
  }
  if (s.includes('@')) {
    return { name: null, email: s.toLowerCase() };
  }
  return { name: normalizeName(s) || null, email: null };
}

/**
 * Normalize a display name:
 *   - Trim whitespace
 *   - Strip trailing digits that Teams appends when someone joins multiple times
 *     e.g. "Ashish Kushwaha2" → "Ashish Kushwaha"
 *   - Collapse internal whitespace
 */
function normalizeName(raw) {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/\s*\d+$/, '')   // strip trailing digits (Teams duplicate-join suffix)
    .replace(/\s+/g, ' ')     // collapse spaces
    .trim();
}

/**
 * Returns true if the given name or email belongs to a known bot.
 */
function isBot(name, email) {
  const haystack = `${name || ''} ${email || ''}`.toLowerCase();
  return BOT_IDENTIFIERS.some((id) => haystack.includes(id));
}

/**
 * Loose name match: both normalized strings must be non-empty and equal.
 * Also accepts partial first-name match (single token ≥ 3 chars).
 */
function namesMatch(a, b) {
  if (!a || !b) return false;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return true;
  // First-name-only fallback: "Sachin" matches "Sachin Kumar"
  const tokenA = na.split(' ')[0];
  const tokenB = nb.split(' ')[0];
  return tokenA.length >= 3 && tokenA === tokenB;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Build a clean, deduplicated attendee list from Fireflies transcript data.
 *
 * @param {string[]}  apiParticipants  - transcript.participants[] from Fireflies API
 * @param {{ speaker_name: string }[]} sentences - transcript.sentences[] from Fireflies API
 * @returns {{ name: string|null, email: string|null, role: string }[]}
 */
function buildAttendeeList(apiParticipants = [], sentences = []) {
  // Step 1 — Parse API participants into structured objects
  const parsedApiParticipants = (apiParticipants || [])
    .map(parseParticipantString)
    .filter((p) => p && !isBot(p.name, p.email));

  // Step 2 — Extract unique normalised speaker names from sentences
  const speakerNames = [...new Set(
    (sentences || [])
      .map((s) => normalizeName(s.speaker_name || ''))
      .filter((n) => n.length > 1),     // ignore empty or single-char noise
  )].filter((name) => !isBot(name, null));

  // Step 3 — Build attendee map keyed by normalised name.
  //           Start from speakers (ground truth), enrich with API data.
  const byNormName = new Map(); // normName → attendee object

  for (const name of speakerNames) {
    // Try to find an API participant with a matching name to get their email
    const match = parsedApiParticipants.find((p) => namesMatch(p.name, name));
    byNormName.set(name.toLowerCase(), {
      name:  name,
      email: match?.email || null,
      role:  'participant',
    });
  }

  // Step 4 — Append any API participants who didn't appear as speakers
  //           (e.g. joined but never spoke, or camera-only)
  for (const p of parsedApiParticipants) {
    const normName = (p.name || '').toLowerCase();
    // Check if already present by email
    const alreadyByEmail = p.email &&
      [...byNormName.values()].some((a) => a.email === p.email);
    // Check if already present by name
    const alreadyByName  = normName &&
      [...byNormName.keys()].some((k) => namesMatch(k, normName));

    if (!alreadyByEmail && !alreadyByName) {
      byNormName.set(normName || p.email || Math.random().toString(), {
        name:  p.name  || null,
        email: p.email || null,
        role:  'participant',
      });
    }
  }

  // Step 5 — Deduplicate by email (keep first occurrence, which has the best name)
  const seenEmails = new Set();
  const result = [];
  for (const attendee of byNormName.values()) {
    if (attendee.email) {
      if (seenEmails.has(attendee.email)) continue;
      seenEmails.add(attendee.email);
    }
    result.push(attendee);
  }

  return result;
}

/**
 * Enrich an attendee list with isInternal flags.
 *
 * Priority order:
 *   1. email domain @nxgsecure.com  → always internal
 *   2. name match against knownInternalUsers (from users table, passed by caller)
 *      → internal; also backfills email from users table if attendee has none
 *   3. anything else → customer side
 *
 * Name-only attendees with no email who are NOT in knownInternalUsers land on
 * Customer Side — we have no verified way to confirm their org.
 *
 * @param {{ name, email, role }[]} attendees
 * @param {{ full_name: string, email: string }[]} knownInternalUsers  optional, from DB
 * @returns same array with isInternal boolean (and possibly backfilled email) added
 */
function enrichWithInternalFlag(attendees, knownInternalUsers = []) {
  return attendees.map((a) => {
    const email = (a.email || '').toLowerCase();

    // Rule 1 — direct domain check
    if (email.includes('nxgsecure.com')) return { ...a, isInternal: true };

    // Rule 2 — name-based lookup against known NxgSecure users from the users table
    if (knownInternalUsers.length > 0) {
      const aName = (a.name || '').toLowerCase().trim();
      if (aName) {
        const match = knownInternalUsers.find((u) => {
          const uName = (u.full_name || '').toLowerCase().trim();
          // Full-name exact match OR first-name match (≥3 chars)
          if (uName === aName) return true;
          const uFirst = uName.split(' ')[0];
          const aFirst = aName.split(' ')[0];
          return uFirst.length >= 3 && uFirst === aFirst;
        });
        if (match) {
          // Backfill email so the frontend domain fallback also works next time
          return { ...a, email: a.email || match.email, isInternal: true };
        }
      }
    }

    return { ...a, isInternal: false };
  });
}

module.exports = { buildAttendeeList, enrichWithInternalFlag, normalizeName };
