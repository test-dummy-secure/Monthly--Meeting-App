'use strict';

/**
 * backfill-fireflies-participants.js
 *
 * Rebuilds meetings.attendees for every conducted meeting so the
 * NxGSecure Team | Customer Side split works correctly in the app.
 *
 * Rule (user-defined, immutable):
 *   email ends with @nxgsecure.com  →  isInternal: true  (NxGSecure Team)
 *   everything else                 →  isInternal: false (Customer Side)
 *
 * Source strategy per meeting:
 *   A. Has transcript_text + fireflies_transcript_id
 *      → extract speakers from stored transcript  (captures every attendee)
 *      → call Fireflies API for participants[]    (provides emails for org members)
 *      → merge: speakers get emails from API where names match
 *      → apply domain rule
 *
 *   B. Has transcript_text only (no Fireflies ID)
 *      → extract speakers from stored transcript
 *      → apply domain rule  (name-only speakers → Customer Side)
 *
 *   C. Has Fireflies ID only (no stored transcript)
 *      → call Fireflies API for both participants[] + sentences[]
 *      → build attendee list via buildAttendeeList utility
 *      → apply domain rule
 *
 * Run once:  node scripts/backfill-fireflies-participants.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db                = require('../src/config/db');
const { decrypt }       = require('../src/utils/encryption');
const FirefliesConnRepo = require('../src/repositories/fireflies-connection.repository');
const { buildAttendeeList, normalizeName } = require('../src/utils/attendees');

const FIREFLIES_API_URL = 'https://api.fireflies.ai/graphql';

// ── Fireflies API helpers ──────────────────────────────────────────────────────

const GET_PARTICIPANTS_QUERY = `
  query GetParticipants($id: String!) {
    transcript(id: $id) {
      id
      participants
    }
  }
`;

const GET_FULL_QUERY = `
  query GetTranscript($id: String!) {
    transcript(id: $id) {
      id
      participants
      sentences { speaker_name text }
    }
  }
`;

async function gqlFetch(apiKey, query, variables = {}) {
  const res = await fetch(FIREFLIES_API_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body:    JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join('; '));
  return json.data;
}

// Cache API key per tenant so we don't re-decrypt on every meeting
const apiKeyCache = new Map();
async function getApiKey(tenantId) {
  if (apiKeyCache.has(tenantId)) return apiKeyCache.get(tenantId);
  const ffConn = await FirefliesConnRepo.findByTenant(tenantId).catch(() => null);
  if (!ffConn || ffConn.status !== 'connected') return null;
  try {
    const key = decrypt(ffConn.apiKeyEnc);
    apiKeyCache.set(tenantId, key);
    return key;
  } catch {
    return null;
  }
}

// ── Core logic ─────────────────────────────────────────────────────────────────

/**
 * Extract unique normalised speaker names from stored transcript text.
 * Format: "Speaker Name: sentence text\n..."
 * Filters out generic Fireflies placeholder names.
 */
const GENERIC_SPEAKERS = new Set(['speaker', 'speaker a', 'speaker b', 'speaker c', 'unknown']);

function extractSpeakers(transcriptText) {
  if (!transcriptText) return [];
  const names = new Set();
  for (const line of transcriptText.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const raw = normalizeName(line.slice(0, colonIdx));
      if (raw.length > 1 && !GENERIC_SPEAKERS.has(raw.toLowerCase())) {
        names.add(raw);
      }
    }
  }
  return [...names];
}

/**
 * Parse a Fireflies participants[] string entry into { name, email }.
 * Handles: plain email, display name, "Name <email>" format.
 * Returns null for bot entries.
 */
const BOT_DOMAINS = ['fireflies.ai', 'otter.ai', 'grain.com'];
function parseParticipant(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (BOT_DOMAINS.some(d => s.toLowerCase().includes(d))) return null;

  const angleMatch = s.match(/^(.+?)\s*<([^>]+)>$/);
  if (angleMatch) return { name: normalizeName(angleMatch[1]) || null, email: angleMatch[2].trim().toLowerCase() };
  if (s.includes('@'))  return { name: null,                    email: s.toLowerCase() };
  return                       { name: normalizeName(s) || null, email: null };
}

/**
 * Build a name→email map from Fireflies participants[] strings.
 * Used to enrich speaker-name-only entries with emails where names match.
 */
function buildEmailMap(apiParticipants = []) {
  const map = new Map(); // normalisedName (lowercase) → email
  for (const raw of apiParticipants) {
    const p = parseParticipant(raw);
    if (!p) continue;
    if (p.name && p.email) map.set(p.name.toLowerCase(), p.email);
  }
  return map;
}

/**
 * Infer a display name from an email local part.
 * "nikhil.madichetti@nxg..." → "Nikhil Madichetti"
 * "kirti@nxg..."             → "Kirti"
 * "sachin_kumar@..."         → "Sachin Kumar"
 */
function inferNameFromEmail(email) {
  const local = (email || '').split('@')[0];
  return local
    .replace(/[._\-+]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

/**
 * Loose name match: exact full match OR equal first token (≥3 chars).
 * Used to link a plain-email participant to a transcript speaker name.
 */
function namesLooseMatch(a, b) {
  if (!a || !b) return false;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return true;
  const ta = na.split(' ')[0];
  const tb = nb.split(' ')[0];
  return ta.length >= 3 && ta === tb;
}

/**
 * Deduplicate attendees (by email then by name) and apply the isInternal rule.
 *
 * Single rule: email ends with @nxgsecure.com → isInternal: true, else false.
 * Name-only attendees (no email) always land on Customer Side — Fireflies did not
 * capture their email, meaning they joined without a linked Fireflies account.
 */
function classifyAndDedup(attendees) {
  const seenEmails = new Set();
  const seenNames  = new Set();
  const result = [];
  for (const a of attendees) {
    const email    = (a.email || '').toLowerCase();
    const normName = (a.name  || '').toLowerCase().trim();
    if (email && seenEmails.has(email)) continue;
    if (!email && normName && seenNames.has(normName)) continue;
    if (email)    seenEmails.add(email);
    if (normName) seenNames.add(normName);
    result.push({
      name:       a.name  || null,
      email:      email   || null,
      role:       a.role  || 'participant',
      isInternal: email.includes('nxgsecure.com'),
    });
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  // Fetch all conducted meetings
  const { rows: meetings } = await db.query(`
    SELECT m.id, m.tenant_id, m.transcript_text,
           m.fireflies_transcript_id,
           c.name AS customer
    FROM   meetings m
    JOIN   customers c ON c.id = m.tenant_id
    WHERE  m.status = 'conducted'
    ORDER  BY c.name, m.scheduled_start DESC
  `);

  console.log(`Processing ${meetings.length} conducted meeting(s)...\n`);

  let updated = 0;
  let skipped = 0;

  for (const mtg of meetings) {
    const hasTranscript = mtg.transcript_text && mtg.transcript_text.trim().length > 10;
    const hasFirefliesId = !!mtg.fireflies_transcript_id;

    // ── Strategy A & B: use stored transcript speakers ────────────────────
    if (hasTranscript) {
      const speakerNames = extractSpeakers(mtg.transcript_text);

      if (speakerNames.length === 0) {
        console.log(`  ⚠️  ${mtg.customer} (${mtg.id.slice(0,8)}…) — no speakers found, skipping`);
        skipped++;
        continue;
      }

      // Strategy A: call Fireflies API for participants[] to get emails.
      // Fireflies returns participants as one of three formats:
      //   "nikhil.madichetti@nxgsecure.com"        → plain email, no name
      //   "Kirish Patel"                            → plain name, no email
      //   "Nikhil Madichetti <nikhil@nxg...>"       → name + email
      //
      // buildEmailMap only handles the third format (name→email).
      // Plain emails (first format) are parsed as {name: null, email} — we must
      // collect them separately and add them directly to the attendees list so
      // the @nxgsecure.com domain check can fire on them.
      let emailMap        = new Map();   // normName → email  (for speaker enrichment)
      let plainEmailParts = [];          // {name:null, email} from plain-email entries
      if (hasFirefliesId) {
        const apiKey = await getApiKey(mtg.tenant_id);
        if (apiKey) {
          try {
            const data = await gqlFetch(apiKey, GET_PARTICIPANTS_QUERY, { id: mtg.fireflies_transcript_id });
            const raw  = data?.transcript?.participants || [];
            for (const entry of raw) {
              const p = parseParticipant(entry);
              if (!p) continue;
              if (p.name && p.email) {
                // "Name <email>" or name-matched → add to emailMap
                emailMap.set(p.name.toLowerCase(), p.email);
              } else if (!p.name && p.email) {
                // Plain email → collect separately
                plainEmailParts.push({ name: null, email: p.email, role: 'participant' });
              }
            }
          } catch {
            // Non-fatal — proceed with name-only speakers
          }
        }
      }

      // Build attendees: speakers enriched with emails where a name match exists.
      // Matching priority per speaker:
      //   1. emailMap exact lookup (from "Name <email>" formatted participant)
      //   2. inferNameFromEmail on each plain-email participant — if the inferred
      //      display name matches the speaker name, attach that email.
      //      e.g. "nikhil.madichetti@nxg..." infers "Nikhil Madichetti" → matches speaker
      //           "kirti@nxg..."             infers "Kirti"             → matches "Kirti Upadhaya"
      const matchedPlainEmails = new Set();
      const attendees = speakerNames.map(name => {
        // 1. emailMap
        let email = emailMap.get(name.toLowerCase()) || null;

        // 2. plain-email inference
        if (!email) {
          for (const p of plainEmailParts) {
            const inferred = inferNameFromEmail(p.email);
            if (namesLooseMatch(name, inferred)) {
              email = p.email;
              matchedPlainEmails.add(p.email);
              break;
            }
          }
        }

        return { name, email, role: 'participant' };
      });

      // Add any plain-email participants that were NOT matched to a speaker
      // (e.g. someone who joined but never spoke — rare but possible)
      for (const p of plainEmailParts) {
        if (!matchedPlainEmails.has(p.email) && !attendees.some(a => a.email === p.email)) {
          attendees.push(p);
        }
      }

      // Add any named-email participants (emailMap) who didn't appear as speakers
      for (const [, email] of emailMap) {
        if (!attendees.some(a => a.email === email)) {
          attendees.push({ name: null, email, role: 'participant' });
        }
      }

      const classified = classifyAndDedup(attendees);
      await db.query(
        `UPDATE meetings SET attendees = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(classified), mtg.id]
      );
      updated++;

      const nxg  = classified.filter(a => a.isInternal);
      const cust = classified.filter(a => !a.isInternal);
      const label = `${mtg.customer} (${mtg.id.slice(0,8)}…)`;
      if (nxg.length || cust.length) {
        console.log(`  ✅ ${label}`);
        if (nxg.length)  console.log(`     🛡 NxGSecure (${nxg.length}): ${nxg.map(a => a.name || a.email).join(', ')}`);
        if (cust.length) console.log(`     👥 Customer  (${cust.length}): ${cust.map(a => a.name || a.email).join(', ')}`);
        console.log();
      }
      continue;
    }

    // ── Strategy C: no local transcript, Fireflies ID only ────────────────
    if (hasFirefliesId) {
      const apiKey = await getApiKey(mtg.tenant_id);
      if (!apiKey) {
        console.log(`  ⚠️  ${mtg.customer} (${mtg.id.slice(0,8)}…) — no Fireflies connection, skipping`);
        skipped++;
        continue;
      }
      try {
        const data     = await gqlFetch(apiKey, GET_FULL_QUERY, { id: mtg.fireflies_transcript_id });
        const merged   = buildAttendeeList(data?.transcript?.participants || [], data?.transcript?.sentences || []);
        const classified = classifyAndDedup(merged);
        await db.query(
          `UPDATE meetings SET attendees = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(classified), mtg.id]
        );
        updated++;

        const nxg  = classified.filter(a => a.isInternal);
        const cust = classified.filter(a => !a.isInternal);
        console.log(`  ✅ ${mtg.customer} (${mtg.id.slice(0,8)}…) [API]`);
        if (nxg.length)  console.log(`     🛡 NxGSecure (${nxg.length}): ${nxg.map(a => a.name || a.email).join(', ')}`);
        if (cust.length) console.log(`     👥 Customer  (${cust.length}): ${cust.map(a => a.name || a.email).join(', ')}`);
        console.log();
      } catch (err) {
        console.log(`  ❌ ${mtg.customer} (${mtg.id.slice(0,8)}…) — API error: ${err.message}`);
        skipped++;
      }
      continue;
    }

    // No transcript, no Fireflies ID
    console.log(`  –  ${mtg.customer} (${mtg.id.slice(0,8)}…) — no transcript or Fireflies ID, skipping`);
    skipped++;
  }

  console.log(`\nDone. Updated: ${updated}  Skipped: ${skipped}`);
  await db.end();
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
