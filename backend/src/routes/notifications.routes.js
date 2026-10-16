'use strict';

const express      = require('express');
const router       = express.Router();
const auth         = require('../middleware/auth.middleware');
const db           = require('../config/db');
const emailJob     = require('../jobs/email.job');
const logger       = require('../utils/logger');

router.use(auth);

// GET /api/notifications/me
// Returns the last 20 notifications addressed to the current user.
//   AM         → recipient_email = user.email
//   super_admin → recipient_email = user.email  OR  recipient_role = 'SUPER_ADMIN'
//
// Silently returns an empty list if the notifications table doesn't exist yet
// (i.e. migration 024 has not run), so callers don't need to guard.
router.get('/me', async (req, res, next) => {
  try {
    const { email, role } = req.user;

    // Guard: skip gracefully if migration 024 hasn't run yet
    const { rows: tableCheck } = await db.query(`
      SELECT 1 FROM information_schema.tables
      WHERE  table_schema = 'public' AND table_name = 'notifications'
      LIMIT  1
    `);
    if (tableCheck.length === 0) {
      return res.json({ notifications: [], total: 0 });
    }

    let query, params;

    if (role === 'super_admin') {
      // Super-admin sees all management-tier notifications + their own email
      query = `
        SELECT
          n.id,
          n.tenant_id         AS "tenantId",
          n.task_id           AS "taskId",
          n.meeting_id        AS "meetingId",
          n.type,
          n.recipient_role    AS "recipientRole",
          n.recipient_email   AS "recipientEmail",
          n.title,
          n.body,
          n.payload,
          n.status,
          n.delivered_at      AS "deliveredAt",
          n.created_at        AS "createdAt",
          c.name              AS "tenantName"
        FROM   notifications n
        LEFT   JOIN customers c ON c.id = n.tenant_id
        WHERE  n.recipient_email = $1
           OR  n.recipient_role  = 'SUPER_ADMIN'
        ORDER  BY n.created_at DESC
        LIMIT  20
      `;
      params = [email];
    } else {
      // AM sees only notifications addressed to their email
      query = `
        SELECT
          n.id,
          n.tenant_id         AS "tenantId",
          n.task_id           AS "taskId",
          n.meeting_id        AS "meetingId",
          n.type,
          n.recipient_role    AS "recipientRole",
          n.recipient_email   AS "recipientEmail",
          n.title,
          n.body,
          n.payload,
          n.status,
          n.delivered_at      AS "deliveredAt",
          n.created_at        AS "createdAt",
          c.name              AS "tenantName"
        FROM   notifications n
        LEFT   JOIN customers c ON c.id = n.tenant_id
        WHERE  n.recipient_email = $1
        ORDER  BY n.created_at DESC
        LIMIT  20
      `;
      params = [email];
    }

    const { rows } = await db.query(query, params);
    res.json({ notifications: rows, total: rows.length });
  } catch (err) {
    logger.error('notifications.routes: GET /me failed', { error: err.message, user: req.user?.email });
    next(err);
  }
});

// PATCH /api/notifications/:id/read — mark a single notification as read
router.patch('/:id/read', async (req, res, next) => {
  try {
    const { email, role } = req.user;

    // Scope update to notifications the current user can actually see
    const { rows } = await db.query(
      `UPDATE notifications
       SET    read_at = NOW()
       WHERE  id = $1
         AND  read_at IS NULL
         AND  (
               recipient_email = $2
               OR (recipient_role = 'SUPER_ADMIN' AND $3 = 'super_admin')
             )
       RETURNING id, read_at AS "readAt"`,
      [req.params.id, email, role]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found or already read' });
    }

    res.json({ id: rows[0].id, readAt: rows[0].readAt });
  } catch (err) {
    logger.error('notifications: PATCH /:id/read failed', { error: err.message });
    next(err);
  }
});

// POST /api/notifications/mark-all-read — mark all current user's unread notifications as read
router.post('/mark-all-read', async (req, res, next) => {
  try {
    const { email, role } = req.user;

    const { rowCount } = await db.query(
      `UPDATE notifications
       SET    read_at = NOW()
       WHERE  read_at IS NULL
         AND  (
               recipient_email = $1
               OR (recipient_role = 'SUPER_ADMIN' AND $2 = 'super_admin')
             )`,
      [email, role]
    );

    res.json({ marked: rowCount });
  } catch (err) {
    logger.error('notifications: POST /mark-all-read failed', { error: err.message });
    next(err);
  }
});

// POST /api/notifications/:id/retry — re-send a failed notification email
router.post('/:id/retry', async (req, res, next) => {
  try {
    const { email, role } = req.user;

    // Load notification — scoped to current user
    const { rows } = await db.query(
      `SELECT id, recipient_email AS "recipientEmail", status
       FROM   notifications
       WHERE  id = $1
         AND  (
               recipient_email = $2
               OR (recipient_role = 'SUPER_ADMIN' AND $3 = 'super_admin')
             )
       LIMIT  1`,
      [req.params.id, email, role]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const notif = rows[0];

    if (notif.status !== 'failed') {
      return res.status(409).json({
        error: `Cannot retry a notification with status '${notif.status}'. Only 'failed' notifications can be retried.`,
      });
    }

    if (!notif.recipientEmail) {
      return res.status(422).json({ error: 'Notification has no recipient email address stored' });
    }

    // Re-send through the same path the original delivery used — the real
    // per-type template (weekly-report, carry-forward, escalation, etc.) with
    // its real variables, not a generic bare-title-and-body stand-in. Marks
    // the notification 'delivered' itself on success.
    await emailJob.processNotificationEmail({ notificationId: notif.id });

    logger.info('notifications: retry succeeded', { id: req.params.id, to: notif.recipientEmail, by: email });
    res.json({ retried: true, deliveredAt: new Date().toISOString() });
  } catch (err) {
    // Mark the record as failed again so the AM can see it still needs attention
    db.query(
      `UPDATE notifications SET status = 'failed' WHERE id = $1`,
      [req.params.id]
    ).catch(() => {});

    logger.error('notifications: POST /:id/retry failed', { error: err.message, id: req.params.id });
    next(err);
  }
});

module.exports = router;
