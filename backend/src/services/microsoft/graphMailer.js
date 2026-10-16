'use strict';

const logger = require('../../utils/logger');
const { getAppOnlyToken, isConfigured } = require('./MicrosoftAppAuthClient');
const { graphFetch } = require('./MicrosoftCalendarClient');

// Sends mail via Microsoft Graph (POST /users/{mailbox}/sendMail) using an
// app-only token — no SMTP, no basic auth, so it isn't affected by Microsoft
// disabling legacy authentication protocols. Primary send path; email.service.js
// falls back to SMTP automatically if this isn't configured or a send fails,
// so nothing breaks while the one-time Azure AD admin-consent step (see
// MicrosoftAppAuthClient.js) is pending.

function mailboxUpn() {
  return process.env.MS_MAIL_SENDER || process.env.SMTP_USER;
}

async function sendMailViaGraph({ to, subject, html, attachments = [] }) {
  const from = mailboxUpn();
  if (!from) {
    throw new Error('graphMailer: no mailbox configured — set MS_MAIL_SENDER or SMTP_USER');
  }

  const token = await getAppOnlyToken();

  const message = {
    subject,
    body:         { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: to } }],
  };

  if (attachments.length) {
    message.attachments = attachments.map((att) => ({
      '@odata.type':  '#microsoft.graph.fileAttachment',
      name:           att.filename,
      contentType:    att.contentType || 'application/octet-stream',
      contentBytes:   Buffer.isBuffer(att.content)
        ? att.content.toString('base64')
        : Buffer.from(att.content).toString('base64'),
    }));
  }

  await graphFetch(token, `/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    body:   JSON.stringify({ message, saveToSentItems: true }),
  });

  logger.info('graphMailer: email sent via Graph', { from, to, subject });
}

module.exports = { sendMailViaGraph, isConfigured, mailboxUpn };
