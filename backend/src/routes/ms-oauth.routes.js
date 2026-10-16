'use strict';

const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const MicrosoftOAuthClient = require('../services/microsoft/MicrosoftOAuthClient');
const { MicrosoftTokenStore } = require('../services/microsoft/MicrosoftTokenStore');
const calendarRepository     = require('../repositories/calendar.repository');
const auditLogRepository     = require('../repositories/audit-log.repository');
const logger                 = require('../utils/logger');

// ms-oauth routes are mounted before tenantMiddleware in app.js so req.tenantId
// is never set by that middleware. Read the raw header as the authoritative source.
const getTenantId = (req) =>
  req.tenantId || req.body?.tenantId || req.headers['x-tenant-id'];

// ── POST /api/integrations/microsoft/authorize ────────────────────────────────
// Protected — initiates the OAuth flow for the logged-in AM.
// Returns the Microsoft authorization URL to redirect the browser to.
router.post('/authorize', authMiddleware, async (req, res, next) => {
  try {
    const userId   = req.user.id   || req.user.userId;
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required — select a tenant first' });
    }

    const state   = MicrosoftOAuthClient.generateState(userId, tenantId);
    const authUrl = MicrosoftOAuthClient.buildAuthUrl(state);

    logger.info('Microsoft OAuth: authorization URL generated', { userId, tenantId });
    res.json({ authUrl });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/integrations/microsoft/callback ──────────────────────────────────
// PUBLIC — Microsoft redirects here after user consent.
// Verifies state, exchanges code, stores tokens, redirects to frontend.
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Build redirect base — always redirect to frontend, never leave user on raw API.
  // CLIENT_URL is a comma-separated CORS allowlist (may hold several origins —
  // e.g. localhost for local dev plus a public tunnel URL for remote testers),
  // not a single address. Using the raw value here produced an invalid,
  // multi-origin Location header whenever more than one was configured
  // (ERR_INVALID_REDIRECT) — take the first configured origin instead.
  const frontendBase = (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')[0].trim();
  const redirectFail = (msg) =>
    res.redirect(`${frontendBase}/integrations?ms_error=${encodeURIComponent(msg)}`);

  // Microsoft error (e.g. user cancelled consent)
  if (error) {
    logger.warn('Microsoft OAuth callback: provider error', { error, error_description });
    return redirectFail(error_description || error);
  }

  if (!code || !state) {
    return redirectFail('Missing authorization code or state');
  }

  // Verify HMAC-signed state to get userId + tenantId
  let userId, tenantId;
  try {
    ({ userId, tenantId } = MicrosoftOAuthClient.verifyState(state));
  } catch (err) {
    logger.warn('Microsoft OAuth callback: state verification failed', { error: err.message });
    return redirectFail('Invalid state parameter — please try connecting again');
  }

  // Exchange authorization code for tokens
  let tokens;
  try {
    tokens = await MicrosoftOAuthClient.exchangeCode(code);
  } catch (err) {
    logger.error('Microsoft OAuth callback: code exchange failed', { error: err.message });
    return redirectFail('Failed to exchange authorization code — please try again');
  }

  // Fetch the user's Microsoft profile to get their email + MS user ID
  let profile;
  try {
    profile = await MicrosoftOAuthClient.getUserProfile(tokens.access_token);
  } catch (err) {
    logger.warn('Microsoft OAuth callback: profile fetch failed', { error: err.message });
    profile = { id: userId, mail: null, userPrincipalName: null };
  }

  const email    = profile.mail || profile.userPrincipalName || null;
  const msUserId = profile.id   || userId;

  // Encrypt and persist tokens — keyed to the AM's userId (migration 036).
  // One row per (userId, provider) covers ALL tenants this AM manages now and
  // in the future — no re-connection needed when a new tenant is assigned.
  try {
    await MicrosoftTokenStore.save(userId, {
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn:    tokens.expires_in || 3600,
      email,
      msUserId,
    });

    await auditLogRepository.create(
      tenantId, email || userId, 'Microsoft 365 Connected',
      { userId, msUserId, scopes: tokens.scope }
    );

    logger.info('Microsoft OAuth: connection stored successfully (user-scoped)', { userId, tenantId, email, msUserId });
  } catch (err) {
    logger.error('Microsoft OAuth callback: token storage failed', { userId, tenantId, error: err.message });
    return redirectFail('Failed to save Microsoft connection — please try again');
  }

  // Redirect to frontend with success flag
  res.redirect(`${frontendBase}/integrations?ms_connected=1`);
});

// ── POST /api/integrations/microsoft/verify ───────────────────────────────────
// Protected — verifies the current user's own stored token by calling Graph /me
router.post('/verify', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { MicrosoftTokenStore: store } = require('../services/microsoft/MicrosoftTokenStore');
    const { graphFetch } = require('../services/microsoft/MicrosoftCalendarClient');

    // Use the user's own token — not the tenant's primary AM token.
    const accessToken = await store.loadByUserId(userId);
    const profile     = await graphFetch(accessToken, '/me?$select=id,displayName,mail');

    await store.markVerifiedByUserId(userId);

    res.json({
      verified: true,
      email:    profile?.mail || profile?.userPrincipalName,
      name:     profile?.displayName,
    });
  } catch (err) {
    const { TokenExpiredError, PermissionDeniedError } = require('../services/microsoft/MicrosoftTokenStore');
    if (err instanceof TokenExpiredError) {
      return res.status(401).json({ verified: false, status: 'expired', error: err.message });
    }
    if (err instanceof PermissionDeniedError) {
      return res.status(403).json({ verified: false, status: 'permission_denied', error: err.message });
    }
    next(err);
  }
});

// ── POST /api/integrations/microsoft/save-calendly-url ───────────────────────
// Protected — stores the current AM's own Calendly booking URL
router.post('/save-calendly-url', authMiddleware, async (req, res, next) => {
  try {
    const userId     = req.user?.id;
    const tenantId   = getTenantId(req);
    const { calendlyUrl } = req.body;
    if (!userId)      return res.status(401).json({ error: 'Authentication required' });
    if (!calendlyUrl) return res.status(400).json({ error: 'calendlyUrl is required' });

    // Basic URL validation
    try {
      const u = new URL(calendlyUrl);
      if (!u.hostname.includes('calendly.com')) {
        return res.status(400).json({ error: 'calendlyUrl must be a calendly.com URL' });
      }
    } catch {
      return res.status(400).json({ error: 'calendlyUrl must be a valid URL' });
    }

    // Save to THIS user's own connection row (not the tenant primary AM row)
    const conn = await calendarRepository.saveCalendlyUrl(userId, 'microsoft', calendlyUrl);
    await auditLogRepository.create(tenantId || userId, req.user.email, 'Calendly URL Saved', { calendlyUrl });
    res.json({ success: true, calendlyUrl: conn?.calendlyUrl });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/integrations/microsoft/save-calendly-token ─────────────────────
// Protected — stores the AM's Calendly Personal Access Token (encrypted).
// This is entered ONCE in the Integrations page; the auto-sync job uses it.
router.post('/save-calendly-token', authMiddleware, async (req, res, next) => {
  try {
    const { calendlyToken } = req.body;
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });
    if (!calendlyToken || !calendlyToken.trim()) {
      return res.status(400).json({ error: 'calendlyToken is required' });
    }
    const { encrypt } = require('../utils/encryption');
    const enc = encrypt(calendlyToken.trim());
    await calendarRepository.saveCalendlyToken(req.user.id, 'microsoft', enc);
    await auditLogRepository.create(
      getTenantId(req), req.user.email, 'Calendly PAT Saved', { tokenLength: calendlyToken.length }
    ).catch(() => {});
    res.json({ success: true, tokenStored: true });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/integrations/microsoft/calendly-token ─────────────────────────
// Clears the stored PAT (keeps the URL). Used when rotating the token.
router.delete('/calendly-token', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });
    await calendarRepository.saveCalendlyToken(req.user.id, 'microsoft', null);
    res.json({ success: true, tokenStored: false });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/integrations/microsoft/disconnect ───────────────────────────────
// Protected — soft-disconnects the current user's own Microsoft connection
router.post('/disconnect', authMiddleware, async (req, res, next) => {
  try {
    const userId   = req.user?.id;
    const tenantId = getTenantId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    // Disconnect THIS user's own row only — not the tenant primary AM's row.
    const conn = await calendarRepository.findConnectionByUserId(userId, 'microsoft');
    if (!conn) return res.status(404).json({ error: 'No Microsoft connection found' });

    await calendarRepository.updateConnectionErrorById(conn.id, 'disconnected', null);
    await auditLogRepository.create(tenantId || userId, req.user.email, 'Microsoft 365 Disconnected', {
      connId: conn.id, userId: conn.userId,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/integrations/microsoft/status ────────────────────────────────────
// Protected — returns the CURRENT USER's own Microsoft connection status.
// Each AM sees only their own credentials, not the tenant's primary AM credentials.
router.get('/status', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.json({ status: 'not_connected' });

    // Look up THIS user's own OAuth row — not the tenant's primary AM row.
    // findConnectionForTenant was deliberately NOT used here because it resolves
    // via customers.account_manager_id, which caused secondary AMs to see the
    // primary AM's connected email (credential sharing bug).
    const conn = await calendarRepository.findConnectionByUserId(userId, 'microsoft');
    if (!conn || !conn.accessTokenEnc) {
      return res.json({ status: 'not_connected' });
    }

    const tokenEnc = await calendarRepository.getCalendlyTokenEnc(userId, 'microsoft').catch(() => null);

    res.json({
      status:               conn.status || 'connected',
      connectedEmail:       conn.connectedEmail,
      calendlyUrl:          conn.calendlyUrl,
      calendlyTokenStored:  !!tokenEnc,
      lastVerifiedAt:       conn.lastVerifiedAt,
      lastError:            conn.lastError,
      lastErrorAt:          conn.lastErrorAt,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/integrations/microsoft/booking-link/send ─────────────────────
// Send a Calendly booking link email to a tenant contact.
// Migrated here from calendar.routes.js — the booking link is a Calendly/MS feature.
router.post('/booking-link/send', authMiddleware, async (req, res, next) => {
  try {
    const { recipientEmail, recipientName, participants = [], meetingTitle, durationMinutes, calendlyUrl, calendlyToken } = req.body;
    if (!recipientEmail) return res.status(400).json({ error: 'recipientEmail is required' });

    const emailSvc  = require('../services/email.service');
    const db        = require('../config/db');
    const { encrypt } = require('../utils/encryption');

    // Save PAT if provided alongside the booking link (one-shot setup)
    if (calendlyToken && calendlyToken.trim()) {
      try {
        const enc = encrypt(calendlyToken.trim());
        await calendarRepository.saveCalendlyToken(req.user.id, 'microsoft', enc);
      } catch {}
    }

    // Resolve the AM's Calendly URL: use request value if provided, else fall back to stored.
    let bookingUrl = (calendlyUrl || '').trim();
    if (bookingUrl) {
      await calendarRepository.saveCalendlyUrl(req.user.id, 'microsoft', bookingUrl).catch(() => {});
    } else {
      const conn = await calendarRepository.findConnectionByUserId(req.user.id, 'microsoft');
      bookingUrl = conn?.calendlyUrl || '';
    }

    if (!bookingUrl) {
      return res.status(400).json({
        error: 'No Calendly URL found. Please enter your Calendly link to continue.',
        code:  'CALENDLY_URL_MISSING',
      });
    }

    const tenantId = getTenantId(req);
    const sep         = bookingUrl.includes('?') ? '&' : '?';
    const trackingUrl = `${bookingUrl}${sep}utm_campaign=${encodeURIComponent(tenantId || '')}`;

    const { rows: tenantRows } = await db.query(
      `SELECT name FROM customers WHERE id = $1 LIMIT 1`, [tenantId]
    );
    const tenantName = tenantRows[0]?.name || 'your company';
    const amName     = [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || req.user.email;

    await emailSvc.send({
      to:           recipientEmail,
      subject:      `Schedule Your Security Review — ${tenantName}`,
      templateName: 'booking-link',
      vars: {
        recipientName:      recipientName || recipientEmail,
        meetingTitle:       meetingTitle  || 'Security Review Meeting',
        tenantName,
        durationMinutes:    String(durationMinutes || 60),
        accountManagerName: amName,
        bookingUrl:         trackingUrl,
      },
    });

    logger.info('Booking link sent', { tenantId, recipientEmail, sentBy: req.user.email });
    res.json({ sent: true, recipientEmail, participants });
  } catch (err) {
    logger.error('Booking link send failed', { error: err.message });
    next(err);
  }
});

module.exports = router;
