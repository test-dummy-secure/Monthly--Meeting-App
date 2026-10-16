'use strict';

const crypto      = require('crypto');
const PDFDocument = require('pdfkit');
const db          = require('../config/db');
const emailService = require('./email.service');
const auditLogRepository = require('../repositories/audit-log.repository');
const logger      = require('../utils/logger');
const { config }  = require('../config');

// ── Constants ─────────────────────────────────────────────────────────────────

const TOKEN_EXPIRY_DAYS = 30;

const SEV_ORDER  = ['critical', 'high', 'medium', 'low'];
const SEV_LABEL  = { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };
const SEV_COLOR  = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#64748b' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(32).toString('hex'); // 256-bit, unguessable
}

function confirmUrl(token) {
  // PUBLIC_API_URL must be set to the externally reachable backend URL.
  // For testing: set to your ngrok URL (e.g. https://abc123.ngrok-free.app)
  // For production: set to your server's public domain (e.g. https://api.bmmj.com)
  const base = (process.env.PUBLIC_API_URL || process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/public/confirm/${token}`;
}

function verifyUrl(token) {
  const base = (process.env.PUBLIC_API_URL || process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/public/verify/${token}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function validateEmails(emails) {
  const RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalid = emails.filter((e) => !RE.test(e));
  if (invalid.length) throw Object.assign(
    new Error(`Invalid email address(es): ${invalid.join(', ')}`), { statusCode: 400 }
  );
}

// ── PDF generation ────────────────────────────────────────────────────────────
// Each recipient gets a personalised PDF where the confirm links
// embed tokens unique to that (task, recipient_email) pair.
//
// NOTE: All Y positions are tracked explicitly via a `y` variable.
// Never use doc.y after drawing a filled rect — PDFKit's post-fill Y is
// unreliable when rects and text intermix. Also, never append alpha to a
// hex colour ('#eab30822') — PDFKit PDF ops don't support 8-char RGBA hex;
// use doc.save()/opacity()/restore() for transparent fills instead.

function buildPDF({ meeting, customer, tasks, tokenMap }) {
  return new Promise((resolve, reject) => {
    // Narrower page (480pt) fills Outlook's preview pane at a larger apparent size
    // than A4 (595pt), making all text comfortably readable without manual zoom.
    const doc     = new PDFDocument({ margin: 36, size: [480, 720], autoFirstPage: true });
    const buffers = [];
    doc.on('data',  (c) => buffers.push(c));
    doc.on('end',   ()  => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const PW = doc.page.width;   // 480 pt
    const PH = doc.page.height;  // 720 pt (more pages added as needed)
    const L  = 36;
    const R  = PW - 36;
    const CW = R - L;            // 408 pt

    // ── Header ────────────────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 80).fill('#0f172a');

    doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold')
       .text('NxgSecure Platform', L, 18, { width: 220, lineBreak: false });
    doc.fillColor('#94a3b8').fontSize(10).font('Helvetica')
       .text('Security Review Management', L, 44, { width: 220, lineBreak: false });

    const bW = 126, bH = 24, bX = R - bW, bY = 28;
    doc.rect(bX, bY, bW, bH).fill('#3b82f6');
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
       .text('POST-MEETING ACTIONS', bX, bY + 8, { width: bW, align: 'center', lineBreak: false });

    // ── Meeting info ──────────────────────────────────────────────────────────
    let y = 96;

    doc.fillColor('#1e293b').fontSize(15).font('Helvetica-Bold')
       .text(`${customer.name} — ${meeting.title}`, L, y, { width: CW });
    y = doc.y + 4;

    const expiryDate = fmtDate(new Date(Date.now() + TOKEN_EXPIRY_DAYS * 86400000));
    doc.fillColor('#64748b').fontSize(10).font('Helvetica')
       .text(
         `Scheduled: ${fmtDate(meeting.scheduled_start)}   ·   Action Points: ${tasks.length}   ·   Expires: ${expiryDate}`,
         L, y, { width: CW }
       );
    y = doc.y + 10;

    doc.moveTo(L, y).lineTo(R, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    doc.lineWidth(1);
    y += 14;

    // ── Tasks grouped by severity ─────────────────────────────────────────────
    const bySev = {};
    for (const sev of SEV_ORDER) {
      bySev[sev] = tasks.filter((t) => (t.priority || 'low') === sev);
    }

    for (const sev of SEV_ORDER) {
      const group = bySev[sev];
      if (!group.length) continue;

      if (y > PH - 120) { doc.addPage(); y = 36; }

      // Severity band
      const pillH = 24;
      doc.save();
      doc.opacity(0.12);
      doc.rect(L, y, CW, pillH).fill(SEV_COLOR[sev]);
      doc.restore();
      doc.fillColor(SEV_COLOR[sev]).fontSize(10).font('Helvetica-Bold')
         .text(
           `${SEV_LABEL[sev]}  (${group.length} task${group.length > 1 ? 's' : ''})`,
           L + 8, y + 7, { width: CW - 16, lineBreak: false }
         );
      y += pillH + 12;

      for (const task of group) {
        const planText = (task.action_plan || task.description || '').trim();

        // Height estimate for page-break decision
        const titleLines = Math.max(1, Math.ceil(((task.title || '').length * 7.5) / CW));
        const planLines  = planText ? Math.max(1, Math.ceil((planText.length * 6) / (CW - 16))) : 0;
        const cardEstH   = titleLines * 18 + 16 + (planText ? 16 + planLines * 14 + 8 : 0) + 36 + 14;

        if (y + cardEstH > PH - 60) { doc.addPage(); y = 36; }

        // Task title
        doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
           .text(task.title || '(Untitled)', L + 8, y, { width: CW - 16 });
        y = doc.y + 5;

        // Meta row
        doc.fillColor('#475569').fontSize(10).font('Helvetica')
           .text(
             `Owner: ${task.owner_name || '—'}   ·   Due: ${fmtDate(task.due_date)}   ·   Priority: ${SEV_LABEL[sev]}`,
             L + 8, y, { width: CW - 16 }
           );
        y = doc.y + 8;

        // Action plan
        if (planText) {
          doc.fillColor('#334155').fontSize(10).font('Helvetica-Bold')
             .text('Action Plan:', L + 8, y, { width: CW - 16 });
          y = doc.y + 3;
          doc.fillColor('#475569').fontSize(10).font('Helvetica')
             .text(planText, L + 18, y, { width: CW - 26, lineGap: 2.5 });
          y = doc.y + 12;
        }

        // Mark as Completed box
        const token = tokenMap[task.id];
        if (token) {
          const url  = confirmUrl(token);
          const boxH = 34;
          const boxY = y;

          doc.save();
          doc.opacity(0.10);
          doc.rect(L + 8, boxY, CW - 16, boxH).fill('#16a34a');
          doc.restore();
          doc.rect(L + 8, boxY, 3, boxH).fill('#16a34a');

          doc.fillColor('#15803d').fontSize(10).font('Helvetica-Bold')
             .text('Mark as Completed', L + 18, boxY + 8, { width: 130, lineBreak: false });

          doc.fillColor('#1d4ed8').fontSize(10).font('Helvetica')
             .text('Click here to confirm →', L + 156, boxY + 8,
                   { width: CW - 166, underline: true, link: url, lineBreak: false });

          y = boxY + boxH + 10;
        }

        // Row separator
        doc.moveTo(L + 8, y).lineTo(R - 8, y).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
        doc.lineWidth(1);
        y += 12;
      }

      y += 8;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    if (y > PH - 70) { doc.addPage(); y = 36; }
    y += 10;
    doc.moveTo(L, y).lineTo(R, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 10;
    doc.fillColor('#94a3b8').fontSize(9).font('Helvetica')
       .text(
         `Each "Mark as Completed" link is unique to this recipient and expires in ${TOKEN_EXPIRY_DAYS} days. ` +
         `Clicking it notifies your Account Manager to review and close the task in NxgSecure.`,
         L, y, { align: 'center', width: CW }
       );
    y = doc.y + 5;
    doc.fillColor('#cbd5e1').fontSize(9)
       .text(
         `© ${new Date().getFullYear()} NxgSecure Platform. All rights reserved.`,
         L, y, { align: 'center', width: CW }
       );

    doc.end();
  });
}

// ── Token persistence ─────────────────────────────────────────────────────────

async function upsertTokens(tasks, recipientEmail, batchId) {
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 86400000);
  const tokenMap  = {};

  for (const task of tasks) {
    const token = generateToken();

    // UPSERT: if a pending token already exists for (task_id, recipient_email),
    // reset it with a fresh token + new expiry. Confirmed tokens are preserved —
    // a new pending token is added alongside the confirmed one (re-send scenario).
    await db.query(
      `INSERT INTO task_confirmation_tokens
         (task_id, meeting_id, tenant_id, token, recipient_email, expires_at, send_batch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [task.id, task.meeting_id, task.tenant_id, token, recipientEmail.toLowerCase(), expiresAt, batchId]
    );

    // Always read back the active pending token for this (task, email) pair
    // so re-sends reuse the existing unexpired token rather than generating a new one.
    const { rows } = await db.query(
      `SELECT token FROM task_confirmation_tokens
       WHERE  task_id         = $1
         AND  recipient_email = $2
         AND  status          = 'pending'
         AND  expires_at      > NOW()
       ORDER  BY created_at DESC
       LIMIT  1`,
      [task.id, recipientEmail.toLowerCase()]
    );

    tokenMap[task.id] = rows[0]?.token || token;
  }

  return tokenMap;
}

// ── Public API ────────────────────────────────────────────────────────────────

const actionPointsEmailService = {

  /**
   * Fetches approved post-meeting tasks for meetingId, generates a PDF per
   * recipient with unique confirmation links, and sends emails.
   * Returns { sent, taskCount, batchId }.
   */
  async sendActionPoints({ tenantId, meetingId, emails, user }) {
    // 1. Deduplicate + normalise email list
    const uniqueEmails = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
    if (!uniqueEmails.length) throw Object.assign(new Error('At least one email is required'), { statusCode: 400 });
    if (uniqueEmails.length > 10) throw Object.assign(new Error('Maximum 10 recipients per send'), { statusCode: 400 });
    validateEmails(uniqueEmails);

    // 2. Load meeting + customer
    const { rows: mtgRows } = await db.query(
      `SELECT m.id, m.title, m.scheduled_start,
              c.name AS customer_name, c.id AS customer_id
       FROM   meetings  m
       JOIN   customers c ON c.id = m.tenant_id
       WHERE  m.id = $1 AND m.tenant_id = $2
       LIMIT  1`,
      [meetingId, tenantId]
    );
    if (!mtgRows[0]) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });
    const meeting  = mtgRows[0];
    const customer = { name: meeting.customer_name, id: meeting.customer_id };

    // 3. Load approved post-meeting tasks only
    const { rows: tasks } = await db.query(
      `SELECT id, meeting_id, tenant_id, title, action_plan, description,
              owner_name, owner_type, due_date, priority
       FROM   tasks
       WHERE  meeting_id   = $1
         AND  tenant_id    = $2
         AND  source_type  = 'post_meeting'
         AND  approval_status = 'approved'
       ORDER  BY CASE priority
                   WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                   WHEN 'medium'   THEN 2 ELSE 3
                 END`,
      [meetingId, tenantId]
    );

    if (!tasks.length) throw Object.assign(
      new Error('No approved post-meeting action points found for this meeting'), { statusCode: 422 }
    );

    const batchId = crypto.randomUUID();
    let sent = 0;

    // 4. Per-recipient: generate tokens → build PDF → build email task links → send
    for (const email of uniqueEmails) {
      try {
        const tokenMap = await upsertTokens(tasks, email, batchId);
        const pdfBuffer = await buildPDF({ meeting, customer, tasks, tokenMap });


        await emailService.send({
          to:           email,
          subject:      `Action Points — ${customer.name}: ${meeting.title}`,
          templateName: 'action-points-email',
          vars: {
            customerName:  customer.name,
            meetingTitle:  meeting.title,
            meetingDate:   fmtDate(meeting.scheduled_start),
            taskCount:     String(tasks.length),
            criticalCount: String(tasks.filter((t) => t.priority === 'critical').length),
            highCount:     String(tasks.filter((t) => t.priority === 'high').length),
            mediumCount:   String(tasks.filter((t) => t.priority === 'medium').length),
            lowCount:      String(tasks.filter((t) => t.priority === 'low').length),
            expiryDays:    String(TOKEN_EXPIRY_DAYS),
          },
          attachments: [{
            filename:    `Action-Points-${customer.name.replace(/\s+/g, '-')}-${meetingId.slice(0, 8)}.pdf`,
            content:     pdfBuffer,
            contentType: 'application/pdf',
          }],
        });

        sent++;
        logger.info('Action points email sent', { meetingId, tenantId, to: email, taskCount: tasks.length, batchId });
      } catch (err) {
        logger.error('Action points email failed for recipient', { meetingId, to: email, error: err.message });
      }
    }

    if (sent === 0) throw Object.assign(new Error('All emails failed to send. Check SMTP configuration.'), { statusCode: 500 });

    auditLogRepository.create(tenantId, user.email, 'action_points_emailed', {
      meetingId, recipients: uniqueEmails, taskCount: tasks.length, sent, batchId,
    }).catch(() => {});

    return { sent, taskCount: tasks.length, batchId };
  },

  /**
   * Called by the public confirmation endpoint when a customer clicks their link.
   * Validates the token, marks the task awaiting_validation, notifies the AM.
   * Returns { taskTitle, customerName, alreadyConfirmed }.
   */
  async confirmToken(token) {
    if (!token || typeof token !== 'string' || token.length !== 64) {
      throw Object.assign(new Error('Invalid confirmation link'), { statusCode: 400 });
    }

    // Load token row
    const { rows: tRows } = await db.query(
      `SELECT tct.id, tct.task_id, tct.tenant_id, tct.meeting_id,
              tct.recipient_email, tct.status, tct.expires_at,
              tct.confirmed_at
       FROM   task_confirmation_tokens tct
       WHERE  tct.token = $1
       LIMIT  1`,
      [token]
    );

    if (!tRows[0]) throw Object.assign(new Error('Invalid confirmation link'), { statusCode: 404 });
    const tok = tRows[0];

    // Already confirmed — idempotent, return gracefully
    if (tok.status === 'confirmed') {
      const { rows: tskRows } = await db.query(
        `SELECT t.title, c.name AS customer_name
         FROM   tasks     t
         JOIN   customers c ON c.id = t.tenant_id
         WHERE  t.id = $1 LIMIT 1`, [tok.task_id]
      );
      return { taskTitle: tskRows[0]?.title, customerName: tskRows[0]?.customer_name, alreadyConfirmed: true };
    }

    // Expired
    if (new Date(tok.expires_at) < new Date()) {
      await db.query(`UPDATE task_confirmation_tokens SET status = 'expired' WHERE id = $1`, [tok.id]);
      throw Object.assign(new Error('This confirmation link has expired. Please contact your Account Manager.'), { statusCode: 410 });
    }

    // Load task + customer details
    const { rows: taskRows } = await db.query(
      `SELECT t.title, t.action_plan, t.owner_name, t.due_date,
              c.name AS customer_name,
              m.title AS meeting_title
       FROM   tasks     t
       JOIN   customers c ON c.id = t.tenant_id
       JOIN   meetings  m ON m.id = t.meeting_id
       WHERE  t.id = $1 LIMIT 1`,
      [tok.task_id]
    );
    if (!taskRows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    const task = taskRows[0];

    // Mark task awaiting validation (AM must verify before closing)
    await db.query(
      `UPDATE tasks
       SET    remediation_status = 'awaiting_validation',
              last_updated_at    = NOW()
       WHERE  id = $1
         AND  remediation_status NOT IN ('completed', 'closed')`,
      [tok.task_id]
    );

    // Mark token confirmed
    await db.query(
      `UPDATE task_confirmation_tokens
       SET    status = 'confirmed', confirmed_at = NOW()
       WHERE  id = $1`,
      [tok.id]
    );

    // One shared am_verify token for this confirmation event — embedded in
    // every notified AM's email. Whichever AM clicks it first closes the
    // task for everyone (same first-click-wins idempotency as the customer
    // token above); no per-AM tokens needed since only one person needs to act.
    const amToken   = generateToken();
    const amExpires = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 86400000);
    await db.query(
      `INSERT INTO task_confirmation_tokens
         (task_id, meeting_id, tenant_id, token, recipient_email, expires_at, send_batch_id, token_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'am_verify')`,
      [tok.task_id, tok.meeting_id, tok.tenant_id, amToken, tok.recipient_email, amExpires, tok.id]
    );
    const amVerifyLink = verifyUrl(amToken);

    // Notify all AMs assigned to this tenant
    const { rows: amRows } = await db.query(
      `SELECT u.email,
              TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS name
       FROM   tenant_assignments ta
       JOIN   users u ON u.id = ta.user_id
       WHERE  ta.tenant_id = $1 AND u.is_active = TRUE`,
      [tok.tenant_id]
    );

    for (const am of amRows) {
      emailService.send({
        to:           am.email,
        subject:      `Customer confirmed task: ${task.title}`,
        templateName: 'am-task-confirmed',
        vars: {
          amName:        am.name || 'Account Manager',
          customerEmail: tok.recipient_email,
          taskTitle:     task.title,
          meetingTitle:  task.meeting_title,
          customerName:  task.customer_name,
          confirmedAt:   new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
          ownerName:     task.owner_name || '—',
          dueDate:       fmtDate(task.due_date),
          trackerUrl:    (config.clientUrl || process.env.CLIENT_URL || '').replace(/\/$/, '') + '/tracker/tasks/' + tok.task_id + '?tenantId=' + tok.tenant_id,
          verifyUrl:     amVerifyLink,
        },
      }).catch((err) => logger.error('AM notification email failed', { error: err.message, amEmail: am.email }));
    }

    // Audit log
    auditLogRepository.create(tok.tenant_id, tok.recipient_email, 'task_confirmed_by_customer', {
      taskId: tok.task_id, taskTitle: task.title, meetingId: tok.meeting_id,
    }).catch(() => {});

    logger.info('Task confirmed by customer', {
      taskId: tok.task_id, taskTitle: task.title, recipientEmail: tok.recipient_email,
    });

    return { taskTitle: task.title, customerName: task.customer_name, alreadyConfirmed: false };
  },

  /**
   * AM one-click verify-and-close — the counterpart to confirmToken() above.
   * No login required, same as the customer flow: an AM clicks the link in
   * their "customer confirmed" email and the task closes immediately.
   * Sets the exact same fields the in-app "Mark as Complete" button does
   * (progress_percentage + remediation_status together) so the two paths
   * are indistinguishable afterward.
   */
  async verifyAndClose(token) {
    if (!token || typeof token !== 'string' || token.length !== 64) {
      throw Object.assign(new Error('Invalid verification link'), { statusCode: 400 });
    }

    const { rows: tRows } = await db.query(
      `SELECT id, task_id, tenant_id, recipient_email, status, expires_at
       FROM   task_confirmation_tokens
       WHERE  token = $1 AND token_type = 'am_verify'
       LIMIT  1`,
      [token]
    );
    if (!tRows[0]) throw Object.assign(new Error('Invalid verification link'), { statusCode: 404 });
    const tok = tRows[0];

    const { rows: taskRows } = await db.query(
      `SELECT title FROM tasks WHERE id = $1 LIMIT 1`, [tok.task_id]
    );
    if (!taskRows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    const taskTitle = taskRows[0].title;

    // Already confirmed — idempotent, return gracefully (first-click-wins;
    // any AM after the first just sees the same success page).
    if (tok.status === 'confirmed') {
      return { taskTitle, alreadyConfirmed: true };
    }

    if (new Date(tok.expires_at) < new Date()) {
      await db.query(`UPDATE task_confirmation_tokens SET status = 'expired' WHERE id = $1`, [tok.id]);
      throw Object.assign(new Error('This verification link has expired. Please close the task from the tracker instead.'), { statusCode: 410 });
    }

    // Close the task — same two fields the in-app Mark Complete flow sets.
    await db.query(
      `UPDATE tasks
       SET    progress_percentage = 100,
              remediation_status  = 'completed',
              last_updated_at     = NOW()
       WHERE  id = $1
         AND  remediation_status NOT IN ('completed', 'closed')`,
      [tok.task_id]
    );

    await db.query(
      `UPDATE task_confirmation_tokens
       SET    status = 'confirmed', confirmed_at = NOW()
       WHERE  id = $1`,
      [tok.id]
    );

    auditLogRepository.create(tok.tenant_id, 'am_verify_link', 'task_verified_and_closed_by_am', {
      taskId: tok.task_id, taskTitle,
    }).catch(() => {});

    logger.info('Task verified and closed by AM via email link', { taskId: tok.task_id, taskTitle });

    return { taskTitle, alreadyConfirmed: false };
  },

  // ── Due-date reminder emails ───────────────────────────────────────────────
  // Called by taskDueReminder.job for each batch of tasks due in N days.
  // `tasks` is an array of rows already fetched and marked in the DB.
  // `daysLeft` is 2 or 1.
  async sendTaskDueReminderBatch(tasks, daysLeft) {
    if (!tasks || tasks.length === 0) return;

    const accentColor  = daysLeft === 1 ? '#ef4444' : '#f59e0b';
    const badgeColor   = accentColor;
    const bannerBg     = daysLeft === 1 ? '#fef2f2' : '#fffbeb';
    const bannerBorder = daysLeft === 1 ? '#fecaca' : '#fde68a';
    const bannerText   = daysLeft === 1 ? '#991b1b' : '#92400e';
    const urgencyLabel    = daysLeft === 1 ? 'Due Tomorrow'  : 'Due in 2 Days';
    const dueLabelSentence = daysLeft === 1 ? 'tomorrow'      : 'in 2 days';
    const lastDayNote  = daysLeft === 1
      ? 'No further reminders will be sent after today.'
      : '';

    const clientBase = (process.env.CLIENT_URL || '').replace(/\/$/, '');

    for (const task of tasks) {
      try {
        const { rows: amRows } = await db.query(
          `SELECT u.email,
                  TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS name
           FROM   tenant_assignments ta
           JOIN   users u ON u.id = ta.user_id
           WHERE  ta.tenant_id = $1 AND u.is_active = TRUE`,
          [task.tenant_id]
        );

        if (amRows.length === 0) continue;

        const taskUrl = `${clientBase}/tracker/tasks/${task.id}?tenantId=${task.tenant_id}`;

        const actionPlanSection = task.action_plan
          ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" ` +
            `style="margin-top:16px;border-top:1px solid #e2e8f0;">` +
            `<tr><td style="padding-top:14px;">` +
            `<p style="margin:0 0 6px;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Action Plan</p>` +
            `<p style="margin:0;color:#334155;font-size:13px;line-height:1.7;">${task.action_plan.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` +
            `</td></tr></table>`
          : '';

        for (const am of amRows) {
          emailService.send({
            to:           am.email,
            subject:      `Reminder: Task due ${dueLabelSentence} — ${task.title}`,
            templateName: 'task-due-reminder',
            vars: {
              amName:            am.name ? am.name.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Account Manager',
              urgencyLabel,
              dueLabelSentence,
              dueDate:           fmtDate(task.due_date),
              taskTitle:         task.title,
              customerName:      task.customer_name || '—',
              meetingTitle:      task.meeting_title  || '—',
              ownerName:         task.owner_name     || '—',
              currentStatus:     task.remediation_status || '—',
              accentColor,
              badgeColor,
              bannerBg,
              bannerBorder,
              bannerText,
              taskUrl,
            },
            rawVars: {
              lastDayNote,
              actionPlanSection,
            },
          }).catch((err) =>
            logger.error('Task due reminder email failed', {
              error: err.message, amEmail: am.email, taskId: task.id,
            })
          );
        }
      } catch (err) {
        logger.error('sendTaskDueReminderBatch: per-task error', { taskId: task.id, error: err.message });
      }
    }
  },
};

module.exports = actionPointsEmailService;
