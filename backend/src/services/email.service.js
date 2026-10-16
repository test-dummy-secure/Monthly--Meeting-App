'use strict';

const path   = require('path');
const fs     = require('fs');
const logger = require('../utils/logger');

const TEMPLATE_DIR  = path.join(__dirname, '../templates/emails');
const templateCache = new Map();

// ── Template engine ────────────────────────────────────────────────────────

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Rejects any non-http(s) scheme (javascript:, data:, etc.) — HTML-escaping
// alone does not neutralize a javascript: URI inside href="{{var}}", since
// none of its characters require escaping. Mirrors the same allow-list
// already used by buildMeetingLinkButton below. Returns '' for anything
// unparseable or non-http(s), same fail-closed behavior.
function sanitizeUrlValue(value) {
  if (value == null || value === '') return '';
  try {
    const u = new URL(String(value));
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    return u.href;
  } catch {
    return '';
  }
}

function loadTemplate(name) {
  if (templateCache.has(name)) return templateCache.get(name);
  const filePath = path.join(TEMPLATE_DIR, `${name}.html`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Email template not found: ${name}.html`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  templateCache.set(name, content);
  return content;
}

// Renders a template with two variable passes:
//   {{var}}  → HTML-escaped  (safe for text values)
//   {{{var}}} → raw / unescaped  (use ONLY for pre-validated HTML fragments)
function renderTemplate(templateName, vars = {}, rawVars = {}) {
  let html = loadTemplate(templateName);

  // Pass 1 — raw (triple-brace) substitutions first so escaping pass cannot interfere
  for (const [key, value] of Object.entries(rawVars)) {
    html = html.replace(new RegExp(`\\{\\{\\{${key}\\}\\}\\}`, 'g'), value ?? '');
  }

  // Pass 2 — HTML-escaped substitutions. Variables named *Url get scheme-
  // validated first (see sanitizeUrlValue) so a malicious value can never
  // land inside an href="{{...}}" attribute in any template.
  for (const [key, value] of Object.entries(vars)) {
    const safeValue = /url$/i.test(key) ? sanitizeUrlValue(value) : value;
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), escapeHtml(safeValue));
  }

  return html;
}

// ── Sender ─────────────────────────────────────────────────────────────────

async function send({ to, subject, templateName, vars = {}, rawVars = {}, attachments = [] }) {
  const html = renderTemplate(templateName, vars, rawVars);

  // Primary path: Microsoft Graph, app-only token — not affected by Microsoft
  // disabling basic-auth SMTP (which happens tenant-by-tenant regardless of
  // any per-account setting and has already broken delivery once). Falls
  // through to SMTP below if Graph isn't configured yet (Azure AD admin
  // consent pending — see MicrosoftAppAuthClient.js) or a send attempt fails,
  // so this never becomes a second single point of failure on its own.
  const { sendMailViaGraph, isConfigured: graphConfigured } = require('./microsoft/graphMailer');
  if (graphConfigured()) {
    try {
      await sendMailViaGraph({ to, subject, html, attachments });
      logger.info('Email sent via Graph', { to, subject });
      return { messageId: null, via: 'graph' };
    } catch (graphErr) {
      logger.warn('Email: Graph send failed — falling back to SMTP', {
        to, subject, error: graphErr.message,
      });
    }
  }

  const { getTransporter } = require('../config/email');
  const { config }         = require('../config');

  const transporter = getTransporter();
  const mailOptions  = { from: config.smtp.from, to, subject, html };
  if (attachments.length) mailOptions.attachments = attachments;

  const info = await transporter.sendMail(mailOptions);

  logger.info('Email sent via SMTP', { to, subject, messageId: info.messageId });
  return info;
}

// ── Meeting link HTML builder ───────────────────────────────────────────────
// Returns a safe anchor-button fragment for use as a {{{rawVar}}} in templates.

function buildMeetingLinkButton(meetingLink) {
  if (!meetingLink) return '';

  // Validate URL — only allow https links
  let safeUrl;
  try {
    const u = new URL(meetingLink);
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    safeUrl = u.href;
  } catch {
    return '';
  }

  // Escape the URL for use inside an attribute (no template-engine escaping on rawVars)
  const escaped = safeUrl
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');

  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  <tr>
    <td align="center">
      <a href="${escaped}" target="_blank" rel="noopener noreferrer"
         style="display:inline-block;background-color:#3b82f6;color:#ffffff;font-size:15px;font-weight:700;
                padding:14px 36px;border-radius:6px;text-decoration:none;letter-spacing:0.2px;">
        &#128279;&nbsp; Join Meeting
      </a>
    </td>
  </tr>
</table>`;
}

// ── Reminder helper (called from t48.job) ──────────────────────────────────
// Fetches all AMs + meeting attendees for a meeting and queues one reminder
// email job per unique recipient.

async function queueMeetingReminderEmails(meetingId, tenantId) {
  const db         = require('../config/db');
  const emailQueue = require('../queues/email.queue');

  const [meetingRes, amsRes] = await Promise.all([
    db.query(
      `SELECT id, title, scheduled_start, meeting_link, attendees
       FROM   meetings
       WHERE  id = $1`,
      [meetingId]
    ),
    db.query(
      `SELECT u.email,
              TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS name
       FROM   tenant_assignments ta
       JOIN   users u ON u.id = ta.user_id
       WHERE  ta.tenant_id = $1
         AND  u.is_active = TRUE`,
      [tenantId]
    ),
  ]);

  if (!meetingRes.rows[0]) {
    logger.warn('queueMeetingReminderEmails: meeting not found', { meetingId });
    return;
  }

  const meeting   = meetingRes.rows[0];
  const ams       = amsRes.rows;
  const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];

  const recipients = [
    ...ams.map((a) => ({ email: a.email,     name: a.name })),
    ...attendees
      .filter((a) => a && a.email)
      .map((a)   => ({ email: a.email,     name: a.name || '' })),
  ];

  // Deduplicate by lowercase email
  const seen    = new Set();
  const unique  = recipients.filter(({ email }) => {
    const key = email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const recipient of unique) {
    await emailQueue.add(
      'meeting-reminder',
      { jobType: 'reminder', meetingId, to: recipient.email, recipientName: recipient.name },
      { jobId: `reminder-${meetingId}-${recipient.email.toLowerCase()}` }
    );
  }

  logger.info('Meeting reminder emails queued', { meetingId, count: unique.length });
}

module.exports = { send, renderTemplate, buildMeetingLinkButton, queueMeetingReminderEmails };
