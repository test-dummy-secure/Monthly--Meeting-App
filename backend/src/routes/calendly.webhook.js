'use strict';

const crypto  = require('crypto');
const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const logger  = require('../utils/logger');

// ── Signature verification ────────────────────────────────────────────────────
// Calendly uses HMAC-SHA256. Header format: "t=<unix_ms>,v1=<hex_digest>"
// Signed content: "<t>.<raw_body>"

function verifySignature(rawBody, signatureHeader, signingKey) {
  if (!signingKey) return true; // dev/staging: skip when key not configured
  const parts = {};
  for (const part of (signatureHeader || '').split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) parts[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  if (!parts.t || !parts.v1) return false;
  const expectedHex = crypto
    .createHmac('sha256', signingKey)
    .update(`${parts.t}.${rawBody}`)
    .digest('hex');
  const actualBuf   = Buffer.from(parts.v1, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

// ── Main handler ─────────────────────────────────────────────────────────────
// express.raw() is applied per-route here; this route must be mounted in app.js
// BEFORE the global express.json() so the raw body is still available.

router.post('/', express.raw({ type: '*/*' }), async (req, res) => {
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  const sigHeader  = req.headers['calendly-webhook-signature'];
  const rawBody    = req.body ? req.body.toString('utf8') : '';

  try {
    if (!verifySignature(rawBody, sigHeader, signingKey)) {
      logger.warn('Calendly webhook: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    logger.warn('Calendly webhook: signature verification error', { error: err.message });
    return res.status(401).json({ error: 'Signature verification error' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const event = payload.event;
  logger.info('Calendly webhook received', { event });

  try {
    if (event === 'invitee.created') {
      return await handleInviteeCreated(payload.payload, res);
    }
    if (event === 'invitee.canceled') {
      return await handleInviteeCanceled(payload.payload, res);
    }
    // Unknown event types acknowledged but not acted on
    return res.json({ received: true, event, handled: false });
  } catch (err) {
    logger.error('Calendly webhook: unhandled error', { event, error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ── invitee.created ───────────────────────────────────────────────────────────

async function handleInviteeCreated(data, res) {
  const tenantId     = data.tracking?.utm_campaign;
  const eventUuid    = extractLastSegment(data.scheduled_event?.uri);
  const inviteeName  = (data.name  || '').trim();
  const inviteeEmail = (data.email || '').trim();
  const startTime    = data.scheduled_event?.start_time;
  const endTime      = data.scheduled_event?.end_time;
  const meetingTitle = (data.scheduled_event?.name || 'Security Review Meeting').trim();
  const location     = data.scheduled_event?.location || {};
  const joinUrl      = location.join_url || null;
  const durationMin  = calcDurationMinutes(startTime, endTime) || 60;

  // Reschedule detection — Calendly sets rescheduled=true and populates old_invitee
  // with a URI that contains the old event UUID.
  const isReschedule  = data.rescheduled === true;
  const oldEventUuid  = isReschedule
    ? extractEventUuidFromUri(data.old_invitee)
    : null;

  if (!startTime) {
    logger.warn('Calendly webhook: missing scheduled_event.start_time');
    return res.json({ received: true, skipped: 'no_start_time' });
  }

  const computedEnd = endTime
    || new Date(new Date(startTime).getTime() + durationMin * 60000).toISOString();

  // ── Idempotency: already processed this new event UUID ────────────────────
  if (eventUuid) {
    const { rows: dupeRows } = await db.query(
      `SELECT id FROM meetings WHERE calendly_event_uuid = $1 LIMIT 1`, [eventUuid]
    );
    if (dupeRows.length) {
      logger.info('Calendly webhook: meeting already exists (idempotent)', {
        eventUuid, meetingId: dupeRows[0].id,
      });
      return res.json({ received: true, skipped: 'already_exists', meetingId: dupeRows[0].id });
    }
  }

  // ── Reschedule path: update the existing meeting ──────────────────────────
  // When the invitee reschedules on Calendly, the cancel event fires first
  // (marking the old meeting 'cancelled'), then this created event fires.
  // We UPDATE the old meeting back to 'scheduled' with the new time so the
  // AM sees their existing meeting moved rather than a new duplicate appearing.
  if (isReschedule && oldEventUuid) {
    const { rows: rescheduled } = await db.query(
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
         AND status NOT IN ('conducted', 'closed')
       RETURNING id, title, tenant_id AS "tenantId",
                 scheduled_start AS "scheduledStart"`,
      [eventUuid, startTime, computedEnd, joinUrl, oldEventUuid]
    );

    if (rescheduled.length) {
      logger.info('Calendly webhook: meeting rescheduled (updated in-place)', {
        meetingId:  rescheduled[0].id,
        tenantId:   rescheduled[0].tenantId,
        oldEventUuid,
        newEventUuid: eventUuid,
        newStart:   rescheduled[0].scheduledStart,
      });
      return res.json({
        received:   true,
        rescheduled: true,
        meetingId:  rescheduled[0].id,
        start:      rescheduled[0].scheduledStart,
      });
    }

    // Old meeting not found in BMMJ (e.g. cancel already handled and meeting deleted,
    // or this was a direct Calendly booking not yet imported). Fall through to create.
    logger.info('Calendly webhook: reschedule — old meeting not found, will create new', {
      oldEventUuid, newEventUuid: eventUuid,
    });
  }

  // ── New booking path ──────────────────────────────────────────────────────
  // utm_campaign must be a valid UUID — it's how we tie the booking to a tenant.
  if (!tenantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    logger.warn('Calendly webhook: missing or invalid utm_campaign (tenantId)', { tenantId });
    return res.json({ received: true, skipped: 'no_tenant_id' });
  }

  // Verify tenant exists in DB
  const { rows: tenantRows } = await db.query(
    `SELECT id FROM customers WHERE id = $1 LIMIT 1`, [tenantId]
  );
  if (!tenantRows.length) {
    logger.warn('Calendly webhook: tenant not found in DB', { tenantId });
    return res.json({ received: true, skipped: 'tenant_not_found' });
  }

  // Attendees: invitee is the primary contact
  const attendees = [{ email: inviteeEmail, name: inviteeName, role: 'primary' }];

  const { rows } = await db.query(
    `INSERT INTO meetings (
       tenant_id, scheduled_start, scheduled_end,
       meeting_type, meeting_duration_minutes,
       status, title, provider,
       attendees, booking_pending,
       customer_contact_email, customer_contact_name,
       calendly_event_uuid, teams_join_url
     )
     VALUES ($1,$2,$3,'calendly_booking',$4,'scheduled',$5,'microsoft',
             $6::jsonb, false, $7,$8,$9,$10)
     RETURNING id, title, status,
               scheduled_start AS "scheduledStart",
               tenant_id       AS "tenantId"`,
    [
      tenantId,
      startTime,
      computedEnd,
      durationMin,
      meetingTitle,
      JSON.stringify(attendees),
      inviteeEmail || null,
      inviteeName  || null,
      eventUuid    || null,
      joinUrl      || null,
    ]
  );

  const meeting = rows[0];
  logger.info('Calendly webhook: meeting auto-created', {
    meetingId: meeting.id,
    tenantId,
    title:     meeting.title,
    start:     meeting.scheduledStart,
    inviteeEmail,
  });

  return res.status(201).json({
    received:  true,
    created:   true,
    meetingId: meeting.id,
    title:     meeting.title,
    start:     meeting.scheduledStart,
  });
}

// ── invitee.canceled ──────────────────────────────────────────────────────────

async function handleInviteeCanceled(data, res) {
  const eventUuid = extractLastSegment(data.scheduled_event?.uri);
  if (!eventUuid) {
    return res.json({ received: true, skipped: 'no_event_uuid' });
  }

  const { rows } = await db.query(
    `UPDATE meetings
     SET    status     = 'cancelled',
            updated_at = NOW()
     WHERE  calendly_event_uuid = $1
       AND  status NOT IN ('conducted', 'closed')
     RETURNING id, title, tenant_id AS "tenantId"`,
    [eventUuid]
  );

  if (rows.length) {
    logger.info('Calendly webhook: meeting cancelled', {
      meetingId: rows[0].id,
      tenantId:  rows[0].tenantId,
      eventUuid,
    });
  }

  return res.json({
    received:  true,
    cancelled: rows.length > 0,
    meetingId: rows[0]?.id || null,
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function extractLastSegment(uri) {
  if (!uri) return null;
  const segs = uri.split('/');
  return segs[segs.length - 1] || null;
}

// Extracts the scheduled_event UUID from any Calendly URI that contains one.
// Works for both event URIs (.../scheduled_events/{uuid})
// and invitee URIs (.../scheduled_events/{uuid}/invitees/{...}).
function extractEventUuidFromUri(uri) {
  if (!uri) return null;
  const match = String(uri).match(
    /scheduled_events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}

function calcDurationMinutes(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms > 0 ? Math.round(ms / 60000) : null;
}

module.exports = router;
