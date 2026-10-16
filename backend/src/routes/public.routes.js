'use strict';

const express                  = require('express');
const router                   = express.Router();
const rateLimit                = require('express-rate-limit');
const actionPointsEmailService = require('../services/actionPointsEmail.service');
const logger                   = require('../utils/logger');

// Dedicated limiter for public confirm endpoint — mounted before generalLimiter in app.js
// so it must self-apply. 20 req/15 min per IP is generous for a real user but blocks DoS.
const confirmLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests — please try again later.' },
});

// ── HTML response helpers ─────────────────────────────────────────────────────

function successPage(taskTitle, customerName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Task Confirmed — NxgSecure</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:480px;width:100%;padding:40px 36px;text-align:center}
    .icon{width:64px;height:64px;background:#d1fae5;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px}
    h1{color:#0f172a;font-size:22px;font-weight:700;margin-bottom:12px}
    .task{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 18px;margin:16px 0;color:#15803d;font-size:14px;font-weight:600;text-align:left}
    p{color:#475569;font-size:14px;line-height:1.6;margin-bottom:12px}
    .footer{margin-top:28px;padding-top:16px;border-top:1px solid #f1f5f9;color:#94a3b8;font-size:12px}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h1>Task Confirmed!</h1>
    <p>Thank you for confirming the completion of:</p>
    <div class="task">&#128203;&nbsp; ${escHtml(taskTitle)}</div>
    <p>Your Account Manager at <strong>${escHtml(customerName)}</strong> has been notified and will review and close this task in NxgSecure.</p>
    <p>No further action is required from your end.</p>
    <div class="footer">NxgSecure Platform &mdash; NXG Secure &copy; 2026</div>
  </div>
</body>
</html>`;
}

function alreadyConfirmedPage(taskTitle) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Already Confirmed — NxgSecure</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:480px;width:100%;padding:40px 36px;text-align:center}
    .icon{width:64px;height:64px;background:#dbeafe;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px}
    h1{color:#0f172a;font-size:22px;font-weight:700;margin-bottom:12px}
    p{color:#475569;font-size:14px;line-height:1.6;margin-bottom:12px}
    .footer{margin-top:28px;padding-top:16px;border-top:1px solid #f1f5f9;color:#94a3b8;font-size:12px}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#8505;</div>
    <h1>Already Confirmed</h1>
    <p>This task was already confirmed previously:</p>
    <p><strong>${escHtml(taskTitle)}</strong></p>
    <p>Your Account Manager has already been notified. No further action is needed.</p>
    <div class="footer">NxgSecure Platform &mdash; NXG Secure &copy; 2026</div>
  </div>
</body>
</html>`;
}

function verifiedPage(taskTitle) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Task Closed — NxgSecure</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:480px;width:100%;padding:40px 36px;text-align:center}
    .icon{width:64px;height:64px;background:#d1fae5;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px}
    h1{color:#0f172a;font-size:22px;font-weight:700;margin-bottom:12px}
    .task{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 18px;margin:16px 0;color:#15803d;font-size:14px;font-weight:600;text-align:left}
    p{color:#475569;font-size:14px;line-height:1.6;margin-bottom:12px}
    .footer{margin-top:28px;padding-top:16px;border-top:1px solid #f1f5f9;color:#94a3b8;font-size:12px}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h1>Task Closed</h1>
    <p>You've verified and closed:</p>
    <div class="task">&#128203;&nbsp; ${escHtml(taskTitle)}</div>
    <p>The task is now marked <strong>Completed</strong> in NxgSecure — no further action needed.</p>
    <div class="footer">NxgSecure Platform &mdash; NXG Secure &copy; 2026</div>
  </div>
</body>
</html>`;
}

function alreadyVerifiedPage(taskTitle) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Already Closed — NxgSecure</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:480px;width:100%;padding:40px 36px;text-align:center}
    .icon{width:64px;height:64px;background:#dbeafe;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px}
    h1{color:#0f172a;font-size:22px;font-weight:700;margin-bottom:12px}
    p{color:#475569;font-size:14px;line-height:1.6;margin-bottom:12px}
    .footer{margin-top:28px;padding-top:16px;border-top:1px solid #f1f5f9;color:#94a3b8;font-size:12px}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#8505;</div>
    <h1>Already Closed</h1>
    <p>This task was already verified and closed:</p>
    <p><strong>${escHtml(taskTitle)}</strong></p>
    <div class="footer">NxgSecure Platform &mdash; NXG Secure &copy; 2026</div>
  </div>
</body>
</html>`;
}

function errorPage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Link Error — NxgSecure</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:480px;width:100%;padding:40px 36px;text-align:center}
    .icon{width:64px;height:64px;background:#fee2e2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px}
    h1{color:#0f172a;font-size:22px;font-weight:700;margin-bottom:12px}
    p{color:#475569;font-size:14px;line-height:1.6;margin-bottom:12px}
    .footer{margin-top:28px;padding-top:16px;border-top:1px solid #f1f5f9;color:#94a3b8;font-size:12px}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#33;</div>
    <h1>Link Error</h1>
    <p>${escHtml(message)}</p>
    <p>Please contact your Account Manager for assistance.</p>
    <div class="footer">NxgSecure Platform &mdash; NXG Secure &copy; 2026</div>
  </div>
</body>
</html>`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/public/confirm/:token
// No authentication — customer-facing endpoint.
// Validates the 256-bit token, marks task awaiting_validation,
// notifies AM, and returns a plain HTML response page.
router.get('/confirm/:token', confirmLimiter, async (req, res) => {
  const { token } = req.params;
  try {
    const result = await actionPointsEmailService.confirmToken(token);

    if (result.alreadyConfirmed) {
      return res.status(200).type('html').send(alreadyConfirmedPage(result.taskTitle || 'Task'));
    }

    logger.info('Customer task confirmation successful', { taskTitle: result.taskTitle });
    return res.status(200).type('html').send(successPage(result.taskTitle, result.customerName));

  } catch (err) {
    const status = err.statusCode || 500;
    const msg    = status === 410
      ? 'This confirmation link has expired. Please contact your Account Manager.'
      : status === 404 || status === 400
      ? 'This confirmation link is invalid or has already been used.'
      : 'Something went wrong. Please contact your Account Manager.';

    logger.warn('Task confirmation failed', { token: token?.slice(0, 8) + '...', error: err.message });
    return res.status(status).type('html').send(errorPage(msg));
  }
});

// GET /api/public/verify/:token
// No authentication — reached from the "Yes, Verified & Closed" button in
// the AM's "customer confirmed" email. Closes the task directly (same
// fields the in-app Mark Complete button sets) without requiring the AM to
// log in and navigate to the tracker first.
router.get('/verify/:token', confirmLimiter, async (req, res) => {
  const { token } = req.params;
  try {
    const result = await actionPointsEmailService.verifyAndClose(token);

    if (result.alreadyConfirmed) {
      return res.status(200).type('html').send(alreadyVerifiedPage(result.taskTitle || 'Task'));
    }

    logger.info('AM task verify-and-close successful', { taskTitle: result.taskTitle });
    return res.status(200).type('html').send(verifiedPage(result.taskTitle));

  } catch (err) {
    const status = err.statusCode || 500;
    const msg    = status === 410
      ? 'This verification link has expired. Please close the task from the tracker instead.'
      : status === 404 || status === 400
      ? 'This verification link is invalid or has already been used.'
      : 'Something went wrong. Please close the task from the tracker instead.';

    logger.warn('AM task verify-and-close failed', { token: token?.slice(0, 8) + '...', error: err.message });
    return res.status(status).type('html').send(errorPage(msg));
  }
});

module.exports = router;
