'use strict';

/**
 * calendlySync.job.js
 *
 * Automatic background sync of Calendly scheduled events into BMMJ.
 * Runs every 6 hours for every AM who has a Calendly Personal Access Token
 * stored (encrypted) in calendar_connections.calendly_token_enc.
 *
 * This is the safety-net for the webhook — any bookings the webhook missed
 * (server restart, webhook misconfigured, booking made before setup) are
 * caught here automatically. AMs never need to click anything after the
 * one-time PAT entry in the Integrations page.
 *
 * Tenant assignment:
 *   - If the invitee's utm_campaign is a valid tenant UUID → assign to that tenant.
 *   - Otherwise → assign to the AM's primary active tenant (most recently active).
 *   - Unknown utm_campaign values are skipped so cross-tenant pollution never occurs.
 */

const db     = require('../config/db');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/encryption');

const INTERVAL_MS = 15 * 60 * 1000;  // every 15 minutes
const UUID_RE     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let _timer = null;

// ── Main sync pass ────────────────────────────────────────────────────────────

async function runOnce() {
  // Find all AMs who have a Calendly PAT stored
  const { rows: amRows } = await db.query(
    `SELECT DISTINCT cc.user_id, cc.calendly_token_enc, cc.calendly_url
     FROM   calendar_connections cc
     WHERE  cc.user_id           IS NOT NULL
       AND  cc.calendly_token_enc IS NOT NULL
       AND  cc.status IN ('connected', 'active')
     ORDER  BY cc.user_id`
  );

  if (amRows.length === 0) {
    logger.info('calendlySync: no AMs with stored Calendly token — nothing to sync');
    return;
  }

  logger.info('calendlySync: starting sync pass', { amCount: amRows.length });

  for (const amRow of amRows) {
    try {
      await syncForAM(amRow);
    } catch (err) {
      logger.error('calendlySync: error syncing AM', { userId: amRow.user_id, error: err.message });
    }
  }

  logger.info('calendlySync: sync pass complete');
}

async function syncForAM(amRow) {
  const { user_id: userId } = amRow;

  // Decrypt PAT
  let pat;
  try {
    pat = decrypt(amRow.calendly_token_enc);
  } catch (err) {
    logger.warn('calendlySync: could not decrypt token for AM — skipping', { userId, error: err.message });
    return;
  }

  // Find all tenants this AM manages (for untagged booking assignment)
  const { rows: tenants } = await db.query(
    `SELECT id FROM customers WHERE account_manager_id = $1 ORDER BY created_at ASC`,
    [userId]
  );
  const primaryTenantId = tenants[0]?.id || null;

  if (!primaryTenantId) {
    logger.info('calendlySync: AM has no tenants, skipping', { userId });
    return;
  }

  // Get AM's Calendly user URI
  let userUri;
  try {
    const meData = await calendlyGet(pat, '/users/me');
    userUri = meData.resource?.uri;
    if (!userUri) throw new Error('empty user URI');
  } catch (err) {
    logger.warn('calendlySync: could not fetch Calendly user profile', { userId, error: err.message });
    return;
  }

  // Fetch upcoming scheduled events
  let events;
  try {
    const data = await calendlyGet(pat, '/scheduled_events', {
      user:   userUri,
      status: 'active',
      count:  '100',
      sort:   'start_time:asc',
    });
    events = data.collection || [];
  } catch (err) {
    logger.warn('calendlySync: could not fetch scheduled events', { userId, error: err.message });
    return;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const tenantSet = new Set(tenants.map(t => t.id));

  for (const event of events) {
    const eventUuid = event.uri?.split('/').pop();
    if (!eventUuid) { skipped++; continue; }

    // Skip if this exact new event UUID is already imported (idempotency)
    const { rows: dup } = await db.query(
      'SELECT id FROM meetings WHERE calendly_event_uuid = $1 LIMIT 1', [eventUuid]
    );
    if (dup.length) { skipped++; continue; }

    // Fetch invitee details
    let inviteeName    = '';
    let inviteeEmail   = '';
    let joinUrl        = event.location?.join_url || null;
    let targetTenantId = primaryTenantId;
    let bmmjMeetingId  = null; // set when booking was sent from BMMJ via utm_content
    let isReschedule   = false;
    let oldEventUuid   = null;

    try {
      const invData = await calendlyGet(pat, `/scheduled_events/${eventUuid}/invitees`, { count: '10' });
      const invitee = invData.collection?.[0];
      if (invitee) {
        inviteeName  = invitee.name  || '';
        inviteeEmail = invitee.email || '';

        const utmCampaign = invitee.tracking?.utm_campaign;
        const utmContent  = invitee.tracking?.utm_content;

        // utm_content carries the BMMJ meeting UUID when the booking link was sent from BMMJ
        if (utmContent && UUID_RE.test(utmContent)) {
          bmmjMeetingId = utmContent;
        }

        if (utmCampaign && UUID_RE.test(utmCampaign) && tenantSet.has(utmCampaign)) {
          targetTenantId = utmCampaign;
        } else if (utmCampaign && UUID_RE.test(utmCampaign) && !tenantSet.has(utmCampaign)) {
          // Valid UUID but not one of this AM's tenants — skip (cross-tenant safety)
          logger.info('calendlySync: skipping event — utm_campaign tenant not in AM portfolio', {
            userId, eventUuid, utmCampaign,
          });
          skipped++;
          continue;
        }

        // Reschedule detection: Calendly sets rescheduled=true and provides the
        // old event URI so we can update the existing BMMJ meeting in-place
        // instead of creating a duplicate.
        if (invitee.rescheduled === true) {
          isReschedule = true;
          oldEventUuid = extractEventUuidFromUri(invitee.old_scheduled_event?.uri);
        }
      }
    } catch (invErr) {
      // Non-fatal — still create the meeting without invitee detail
      logger.warn('calendlySync: invitee fetch failed (non-fatal)', { eventUuid, error: invErr.message });
    }

    const startTime   = event.start_time;
    const endTime     = event.end_time;
    const durationMin = calcDuration(startTime, endTime) || 60;
    const attendees   = inviteeEmail
      ? [{ email: inviteeEmail, name: inviteeName, role: 'primary' }]
      : [];
    const computedEnd = endTime
      || new Date(new Date(startTime).getTime() + durationMin * 60000).toISOString();

    // ── Case 1: booking came from a BMMJ "Send Booking Link" ─────────────────
    // Update the existing meeting (preserving its AM-chosen title) instead of
    // creating a duplicate with the Calendly event-type name.
    // Condition: allow update when UUID is NULL (first booking) OR when UUID
    // differs from the new one (reschedule — old UUID → new UUID).
    if (bmmjMeetingId) {
      try {
        const { rowCount } = await db.query(
          `UPDATE meetings
           SET    calendly_event_uuid    = $1,
                  scheduled_start        = $2,
                  scheduled_end          = $3,
                  teams_join_url         = COALESCE($4, teams_join_url),
                  customer_contact_email = COALESCE($5, customer_contact_email),
                  customer_contact_name  = COALESCE($6, customer_contact_name),
                  attendees              = COALESCE($7::jsonb, attendees),
                  booking_pending        = false,
                  status                 = CASE
                                             WHEN status = 'cancelled' THEN 'scheduled'
                                             ELSE status
                                           END,
                  updated_at             = NOW()
           WHERE  id                    = $8
             AND  tenant_id             = $9
             AND  (calendly_event_uuid IS NULL OR calendly_event_uuid != $1)`,
          [
            eventUuid, startTime, computedEnd,
            joinUrl || null,
            inviteeEmail || null, inviteeName || null,
            attendees.length ? JSON.stringify(attendees) : null,
            bmmjMeetingId, targetTenantId,
          ]
        );
        if (rowCount > 0) {
          updated++;
          logger.info('calendlySync: existing BMMJ meeting updated via utm_content', {
            meetingId: bmmjMeetingId, tenantId: targetTenantId, eventUuid, isReschedule,
          });
        } else {
          // Meeting already confirmed with the same UUID — idempotent, skip
          skipped++;
          logger.info('calendlySync: utm_content meeting already confirmed or not found — skipped', {
            meetingId: bmmjMeetingId, eventUuid,
          });
        }
      } catch (updateErr) {
        logger.warn('calendlySync: update via utm_content failed', { eventUuid, error: updateErr.message });
      }
      continue;
    }

    // ── Case 1b: reschedule without utm_content ───────────────────────────────
    // Direct Calendly booking (not via BMMJ booking link) that was rescheduled.
    // Find the old meeting by its previous event UUID and update it in-place.
    if (isReschedule && oldEventUuid) {
      try {
        const { rowCount } = await db.query(
          `UPDATE meetings
           SET  calendly_event_uuid = $1,
                scheduled_start     = $2,
                scheduled_end       = $3,
                teams_join_url      = COALESCE($4, teams_join_url),
                status              = CASE
                                        WHEN status = 'cancelled' THEN 'scheduled'
                                        ELSE status
                                      END,
                updated_at          = NOW()
           WHERE calendly_event_uuid = $5
             AND status NOT IN ('conducted', 'closed')`,
          [eventUuid, startTime, computedEnd, joinUrl, oldEventUuid]
        );
        if (rowCount > 0) {
          updated++;
          logger.info('calendlySync: direct Calendly meeting rescheduled (updated in-place)', {
            oldEventUuid, newEventUuid: eventUuid,
          });
          continue; // do not create a new meeting
        }
      } catch (rescheduleErr) {
        logger.warn('calendlySync: reschedule update failed (non-fatal)', {
          eventUuid, oldEventUuid, error: rescheduleErr.message,
        });
      }
      // Fall through to create new if old meeting not found in BMMJ
    }

    // ── Case 2: direct Calendly booking (no BMMJ meeting ID in UTM) ──────────
    // Create a new meeting. Use the invitee's name for a meaningful title rather
    // than the Calendly event-type name (which is often generic like "Monthly Meeting").
    const title = inviteeName
      ? `Security Review — ${inviteeName}`
      : (event.name || 'Security Review Meeting').trim();

    try {
      await db.query(
        `INSERT INTO meetings (
           tenant_id, scheduled_start, scheduled_end,
           meeting_type, meeting_duration_minutes,
           status, title, provider,
           attendees, booking_pending,
           customer_contact_email, customer_contact_name,
           calendly_event_uuid, teams_join_url
         )
         VALUES ($1,$2,$3,'calendly_booking',$4,'scheduled',$5,'microsoft',
                 $6::jsonb, false, $7,$8,$9,$10)`,
        [
          targetTenantId, startTime, computedEnd, durationMin, title,
          JSON.stringify(attendees), inviteeEmail || null, inviteeName || null,
          eventUuid, joinUrl,
        ]
      );
      created++;
      logger.info('calendlySync: meeting auto-created', {
        tenantId: targetTenantId, eventUuid, title,
      });
    } catch (insertErr) {
      // Could be a race with the webhook inserting the same event simultaneously
      if (insertErr.code === '23505') {
        skipped++;
      } else {
        logger.warn('calendlySync: insert error', { eventUuid, error: insertErr.message });
      }
    }
  }

  logger.info('calendlySync: AM sync complete', {
    userId, total: events.length, created, updated, skipped,
  });
}

// ── Calendly REST API helper (uses native fetch — Node 18+) ─────────────────

async function calendlyGet(pat, path, params = {}) {
  const url = new URL(`https://api.calendly.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${pat}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    const err  = new Error(`Calendly API ${path} → ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function calcDuration(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms > 0 ? Math.round(ms / 60000) : null;
}

// Extracts the scheduled_event UUID from any Calendly URI that contains one.
// Works for event URIs (.../scheduled_events/{uuid}) and invitee URIs
// (.../scheduled_events/{uuid}/invitees/{...}).
function extractEventUuidFromUri(uri) {
  if (!uri) return null;
  const match = String(uri).match(
    /scheduled_events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function start() {
  if (_timer) return;
  // Run once at startup (catches anything missed while server was down), then every 6 hours
  runOnce().catch((err) =>
    logger.error('calendlySync: startup run failed', { error: err.message })
  );
  _timer = setInterval(
    () => runOnce().catch((err) =>
      logger.error('calendlySync: interval run failed', { error: err.message })
    ),
    INTERVAL_MS
  );
  _timer.unref();
  logger.info('Calendly auto-sync job started', { intervalMinutes: 15 });
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info('Calendly auto-sync job stopped');
  }
}

module.exports = { start, stop };
