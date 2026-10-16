'use strict';

const crypto = require('crypto');
const logger = require('../../utils/logger');

// Use tenant-specific endpoint — single-tenant app registrations (post Oct-2018)
// are rejected by /common. MS_TENANT_ID is the Azure AD Directory ID (GUID),
// found in Azure Portal → Azure Active Directory → Overview.
const _msTenant  = () => process.env.MS_TENANT_ID || 'organizations';
const MS_AUTH_BASE = () => `https://login.microsoftonline.com/${_msTenant()}/oauth2/v2.0`;

// Scopes required for calendar write + Teams meetings + transcripts + offline refresh
const SCOPES = [
  'Calendars.ReadWrite',
  'OnlineMeetings.ReadWrite',
  'OnlineMeetingTranscript.Read.All',
  'offline_access',
  'User.Read',
].join(' ');

function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id:     process.env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  process.env.MS_REDIRECT_URI,
    scope:         SCOPES,
    response_mode: 'query',
    state,
    prompt:        'select_account',
  });
  return `${MS_AUTH_BASE()}/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
  return _tokenRequest({
    grant_type:   'authorization_code',
    code,
    redirect_uri: process.env.MS_REDIRECT_URI,
  });
}

async function refreshTokens(refreshToken) {
  return _tokenRequest({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  });
}

async function getUserProfile(accessToken) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph /me failed (${res.status}): ${body}`);
  }
  return res.json();
}

// HMAC-SHA256 signed state — encodes userId:tenantId:nonce so the public
// OAuth callback can verify identity without a Redis session.
function generateState(userId, tenantId) {
  const nonce   = crypto.randomBytes(16).toString('hex');
  const payload = `${userId}:${tenantId}:${nonce}`;
  const sig     = crypto
    .createHmac('sha256', _signingKey())
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifyState(state) {
  let decoded;
  try {
    decoded = Buffer.from(state, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid state encoding');
  }
  // Format: userId:tenantId:nonce:sig
  const lastColon = decoded.lastIndexOf(':');
  const payload   = decoded.slice(0, lastColon);
  const sig       = decoded.slice(lastColon + 1);
  const parts     = payload.split(':');
  if (parts.length !== 3) throw new Error('Invalid state format');
  const [userId, tenantId] = parts;

  const expected = crypto
    .createHmac('sha256', _signingKey())
    .update(payload)
    .digest('hex');

  const sigBuf      = Buffer.from(sig,      'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('State signature mismatch — possible CSRF');
  }
  return { userId, tenantId };
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _tokenRequest(body) {
  const params = new URLSearchParams({
    client_id:     process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope:         SCOPES,
    ...body,
  });

  const res  = await fetch(`${MS_AUTH_BASE()}/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || 'Microsoft token request failed');
    err.statusCode = res.status;
    err.msError    = data.error;
    logger.warn('MicrosoftOAuthClient: token request failed', {
      error: data.error, description: data.error_description,
    });
    throw err;
  }
  return data;
}

function _signingKey() {
  return process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'fallback_dev_key';
}

module.exports = { buildAuthUrl, exchangeCode, refreshTokens, getUserProfile, generateState, verifyState };
