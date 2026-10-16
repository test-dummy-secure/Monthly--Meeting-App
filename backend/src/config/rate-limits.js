'use strict';

const rateLimit = require('express-rate-limit');

const isDev = (process.env.NODE_ENV || 'development') === 'development';

// ── General limiter ────────────────────────────────────────────────────────
// Applied globally to every API route via app.js.
// Override via RATE_LIMIT_GENERAL_MAX (default: 200 prod / 1000 dev).
const generalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             parseInt(process.env.RATE_LIMIT_GENERAL_MAX || (isDev ? '1000' : '200'), 10),
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests — please try again in 15 minutes.' },
});

// ── Login limiter ──────────────────────────────────────────────────────────
// Applied only to POST /api/auth/login.
// 5 failures per 15 min per IP — tight enough to kill credential-stuffing
// without blocking a real user who mistyped their password a couple of times.
// skipSuccessfulRequests: true so a successful login doesn't consume quota
// (prevents lockout on shared NAT/office IPs after a batch of correct logins).
const loginLimiter = rateLimit({
  windowMs:               15 * 60 * 1000,
  max:                    parseInt(process.env.RATE_LIMIT_LOGIN_MAX || (isDev ? '50' : '5'), 10),
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: true,
  message:                { error: 'Too many login attempts — please try again in 15 minutes.' },
});

// ── Auth limiter ───────────────────────────────────────────────────────────
// Applied to refresh / logout / reset-password.
// Looser than login — these are less sensitive to brute force.
// Override via RATE_LIMIT_AUTH_MAX (default: 60 prod / 200 dev).
// skipSuccessfulRequests: true — only count FAILED attempts (bad tokens,
// unauthorized). Successful token refreshes must not consume quota or an
// active user with the app open in multiple tabs will hit the limit and get
// locked out mid-session.
const authLimiter = rateLimit({
  windowMs:               15 * 60 * 1000,
  max:                    parseInt(process.env.RATE_LIMIT_AUTH_MAX || (isDev ? '200' : '60'), 10),
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: true,
  message:                { error: 'Too many authentication attempts — please try again in 15 minutes.' },
});

// ── Forgot-password limiter ────────────────────────────────────────────────
// Applied only to POST /api/auth/forgot-password.
// 3 requests per 60 min per IP — prevents email flooding / enumeration abuse.
// The endpoint already returns the same response regardless of whether the
// email exists, so rate limiting is the only protection against bulk probing.
const forgotPasswordLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             parseInt(process.env.RATE_LIMIT_FORGOT_MAX || (isDev ? '20' : '3'), 10),
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many password reset requests — please try again in 1 hour.' },
});

module.exports = { generalLimiter, authLimiter, loginLimiter, forgotPasswordLimiter };
