'use strict';

const nodemailer  = require('nodemailer');
const { config }  = require('./index');
const logger      = require('../utils/logger');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  if (!config.smtp.user || !config.smtp.pass) {
    throw new Error('SMTP credentials are not configured. Set SMTP_USER and SMTP_PASS in .env');
  }

  _transporter = nodemailer.createTransport({
    host:   config.smtp.host,
    port:   config.smtp.port,
    secure: config.smtp.secure,   // false → STARTTLS on port 587
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
    tls: {
      rejectUnauthorized: true,  // enforce valid server certificate
    },
    pool:             true,  // reuse connections across sends
    maxConnections:   5,
    rateDelta:        1000,  // throttle to 5 sends / second
    rateLimit:        5,
  });

  logger.info('SMTP transporter initialised', {
    host: config.smtp.host,
    port: config.smtp.port,
    user: config.smtp.user,
  });

  return _transporter;
}

// Call once at startup to surface SMTP misconfiguration early.
async function verifyTransporter() {
  try {
    const t = getTransporter();
    await t.verify();
    logger.info('SMTP connection verified successfully');
  } catch (err) {
    logger.error('SMTP connection verification failed', { error: err.message });
    throw err;
  }
}

module.exports = { getTransporter, verifyTransporter };
