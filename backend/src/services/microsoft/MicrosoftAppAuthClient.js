'use strict';

const logger = require('../../utils/logger');

// App-only (client credentials) OAuth — separate from MicrosoftOAuthClient.js,
// which does the DELEGATED flow (a specific AM signs in and consents). This
// flow needs no human sign-in at all: the app authenticates as itself, using
// MS_CLIENT_ID/MS_CLIENT_SECRET, to call Graph APIs that don't depend on any
// particular user's session being alive. Used for sending system notification
// emails (see graphMailer.js) as a durable replacement for basic-auth SMTP,
// which Microsoft has been disabling tenant-by-tenant regardless of any
// per-account setting.
//
// Requires an Azure AD admin to grant this app registration the Mail.Send
// APPLICATION permission (not delegated) with admin consent — Azure Portal →
// App registrations → this app → API permissions → Add a permission →
// Microsoft Graph → Application permissions → Mail.Send → Grant admin
// consent. Without that one-time step, token acquisition below still
// succeeds (it's a separate step from Graph authorizing the actual call),
// but sendMail itself will fail with 403 until consent is granted.

const _msTenant = () => process.env.MS_TENANT_ID;
const TOKEN_URL = () => `https://login.microsoftonline.com/${_msTenant()}/oauth2/v2.0/token`;

// Cached in-process — app-only tokens are valid ~60-90 min, no need to fetch
// one per email. Refreshed proactively 2 min before actual expiry.
let _cachedToken   = null;
let _cachedExpiry  = 0; // epoch ms

function isConfigured() {
  return !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_TENANT_ID);
}

async function getAppOnlyToken() {
  if (!isConfigured()) {
    throw new Error('Microsoft app-only auth not configured — MS_CLIENT_ID/MS_CLIENT_SECRET/MS_TENANT_ID required');
  }

  const now = Date.now();
  if (_cachedToken && now < _cachedExpiry - 120_000) {
    return _cachedToken;
  }

  const params = new URLSearchParams({
    client_id:     process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  });

  const res  = await fetch(TOKEN_URL(), {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });
  const data = await res.json();

  if (!res.ok) {
    logger.warn('MicrosoftAppAuthClient: app-only token request failed', {
      error: data.error, description: data.error_description,
    });
    const err = new Error(data.error_description || data.error || 'Microsoft app-only token request failed');
    err.statusCode = res.status;
    throw err;
  }

  _cachedToken  = data.access_token;
  _cachedExpiry = now + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}

module.exports = { getAppOnlyToken, isConfigured };
