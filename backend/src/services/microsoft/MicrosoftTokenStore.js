'use strict';

const crypto = require('crypto');
const logger = require('../../utils/logger');

// Lazy-load to avoid circular dependency at module load time
const getCalRepo  = () => require('../../repositories/calendar.repository');
const getMSOAuth  = () => require('./MicrosoftOAuthClient');

// ── Typed errors ──────────────────────────────────────────────────────────────

class TokenExpiredError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'TokenExpiredError';
    this.statusCode = 401;
  }
}

class PermissionDeniedError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'PermissionDeniedError';
    this.statusCode = 403;
  }
}

class GraphApiUnavailableError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'GraphApiUnavailableError';
    this.statusCode = 503;
  }
}

// ── AES-256-GCM encryption ────────────────────────────────────────────────────

const ALGO = 'aes-256-gcm';

function _keyBuf() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY || '';
  if (hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext) {
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv(ALGO, _keyBuf(), iv);
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(ciphertext) {
  const [ivHex, tagHex, encHex] = ciphertext.split(':');
  if (!ivHex || !tagHex || !encHex) throw new Error('Malformed ciphertext');
  const iv      = Buffer.from(ivHex,  'hex');
  const tag     = Buffer.from(tagHex, 'hex');
  const enc     = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, _keyBuf(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString('utf8') + decipher.final('utf8');
}

// ── Token store ───────────────────────────────────────────────────────────────

const MicrosoftTokenStore = {

  /**
   * Encrypt and persist OAuth tokens keyed to the AM's BMMJ user ID.
   * One row per (user_id, provider) — covers all tenants that AM manages.
   * Called after initial OAuth exchange and after each token refresh.
   *
   * Migration 036: switched from tenantId to userId so a single OAuth
   * connection works across every tenant assigned to the same AM.
   */
  async save(userId, { accessToken, refreshToken, expiresIn, email, msUserId }) {
    const accessEnc  = encrypt(accessToken);
    const refreshEnc = encrypt(refreshToken);
    // Subtract 60s from expiry as a safety buffer against clock skew
    const expiresAt  = new Date(Date.now() + (Number(expiresIn || 3600) - 60) * 1000);

    await getCalRepo().storeOAuthTokensByUser(userId, {
      accessTokenEnc:  accessEnc,
      refreshTokenEnc: refreshEnc,
      tokenExpiresAt:  expiresAt,
      email:           email    || null,
      msUserId:        msUserId || null,
    });

    logger.info('MicrosoftTokenStore: tokens saved', { userId, email });
  },

  /**
   * Load a valid access token for the given tenant.
   *
   * Migration 036: resolves the AM assigned to this tenant and loads their
   * user-scoped token — so every tenant that AM manages works automatically
   * without a separate OAuth flow per tenant.
   *
   * Falls back to the legacy tenant-keyed row for pre-migration data.
   * Transparently refreshes if the token is expired or within 5 min of expiry.
   */
  async load(tenantId) {
    const conn = await getCalRepo().findConnectionForTenant(tenantId, 'microsoft');

    if (!conn || !conn.accessTokenEnc) {
      throw new TokenExpiredError(
        'No Microsoft 365 connection found. Please connect Microsoft 365 in Integrations.'
      );
    }

    if (conn.status === 'disconnected') {
      throw new PermissionDeniedError(
        'Microsoft 365 connection has been disconnected. Please reconnect in Integrations.'
      );
    }

    // Auto-refresh: token expired or expires within 5 minutes
    const expiresAt    = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt) : null;
    const needsRefresh = !expiresAt || expiresAt <= new Date(Date.now() + 5 * 60 * 1000);

    if (needsRefresh) {
      logger.info('MicrosoftTokenStore: auto-refreshing token', { tenantId, connId: conn.id });
      let refreshToken;
      try {
        refreshToken = decrypt(conn.refreshTokenEnc);
      } catch (decryptErr) {
        await getCalRepo().updateConnectionErrorById(conn.id, 'error', 'Token decryption failed');
        throw new TokenExpiredError('Microsoft token decryption failed — please reconnect');
      }

      try {
        const tokens = await getMSOAuth().refreshTokens(refreshToken);
        // Save refreshed token back — keyed by userId if available, otherwise tenantId (legacy)
        const saveKey = conn.userId || tenantId;
        const saveByUser = !!conn.userId;
        if (saveByUser) {
          await MicrosoftTokenStore.save(conn.userId, {
            accessToken:  tokens.access_token,
            refreshToken: tokens.refresh_token || refreshToken,
            expiresIn:    tokens.expires_in    || 3600,
            email:        conn.connectedEmail,
            msUserId:     conn.msUserId,
          });
        } else {
          // Legacy tenant-keyed row — update in place using the old storeOAuthTokens path
          await getCalRepo().storeOAuthTokens(tenantId, {
            accessTokenEnc:  encrypt(tokens.access_token),
            refreshTokenEnc: encrypt(tokens.refresh_token || refreshToken),
            tokenExpiresAt:  new Date(Date.now() + ((tokens.expires_in || 3600) - 60) * 1000),
            email:           conn.connectedEmail,
            msUserId:        conn.msUserId,
          });
        }
        logger.info('MicrosoftTokenStore: token refreshed successfully', { tenantId, saveByUser, key: saveKey });
        return tokens.access_token;
      } catch (refreshErr) {
        if (refreshErr.msError === 'invalid_grant') {
          await getCalRepo().updateConnectionErrorById(
            conn.id, 'expired',
            'Refresh token revoked — user must reconnect Microsoft 365'
          );
          throw new TokenExpiredError(
            'Microsoft 365 session expired. Please reconnect in Integrations.'
          );
        }
        throw new GraphApiUnavailableError(
          `Microsoft token refresh failed: ${refreshErr.message}`
        );
      }
    }

    try {
      return decrypt(conn.accessTokenEnc);
    } catch (err) {
      throw new TokenExpiredError('Microsoft token decryption failed — please reconnect');
    }
  },

  /**
   * Mark connection as verified (called after a successful Graph API call).
   * Uses the connection's primary key so it works for both user-scoped and
   * legacy tenant-keyed rows.
   */
  async markVerified(tenantId) {
    try {
      const conn = await getCalRepo().findConnectionForTenant(tenantId, 'microsoft');
      if (conn) await getCalRepo().updateConnectionVerifiedById(conn.id);
    } catch (err) {
      logger.warn('MicrosoftTokenStore.markVerified failed (non-fatal)', { tenantId, error: err.message });
    }
  },

  /**
   * Load a valid access token for the given BMMJ user (not the tenant's primary AM).
   * Used by the /verify endpoint so each AM's Verify button checks their own token.
   * Applies the same auto-refresh logic as load(tenantId).
   */
  async loadByUserId(userId) {
    const conn = await getCalRepo().findConnectionByUserId(userId, 'microsoft');

    if (!conn || !conn.accessTokenEnc) {
      throw new TokenExpiredError(
        'No Microsoft 365 connection found. Please connect Microsoft 365 in Integrations.'
      );
    }

    if (conn.status === 'disconnected') {
      throw new PermissionDeniedError(
        'Microsoft 365 connection has been disconnected. Please reconnect in Integrations.'
      );
    }

    const expiresAt    = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt) : null;
    const needsRefresh = !expiresAt || expiresAt <= new Date(Date.now() + 5 * 60 * 1000);

    if (needsRefresh) {
      logger.info('MicrosoftTokenStore: auto-refreshing token (user-scoped)', { userId, connId: conn.id });
      let refreshToken;
      try {
        refreshToken = decrypt(conn.refreshTokenEnc);
      } catch {
        await getCalRepo().updateConnectionErrorById(conn.id, 'error', 'Token decryption failed');
        throw new TokenExpiredError('Microsoft token decryption failed — please reconnect');
      }

      try {
        const tokens = await getMSOAuth().refreshTokens(refreshToken);
        await MicrosoftTokenStore.save(userId, {
          accessToken:  tokens.access_token,
          refreshToken: tokens.refresh_token || refreshToken,
          expiresIn:    tokens.expires_in    || 3600,
          email:        conn.connectedEmail,
          msUserId:     conn.msUserId,
        });
        return tokens.access_token;
      } catch (refreshErr) {
        if (refreshErr.msError === 'invalid_grant') {
          await getCalRepo().updateConnectionErrorById(
            conn.id, 'expired',
            'Refresh token revoked — user must reconnect Microsoft 365'
          );
          throw new TokenExpiredError('Microsoft 365 session expired. Please reconnect in Integrations.');
        }
        throw new GraphApiUnavailableError(`Microsoft token refresh failed: ${refreshErr.message}`);
      }
    }

    try {
      return decrypt(conn.accessTokenEnc);
    } catch {
      throw new TokenExpiredError('Microsoft token decryption failed — please reconnect');
    }
  },

  /**
   * Mark the given user's own connection as verified.
   * Called after a successful Graph API call in the /verify endpoint.
   */
  async markVerifiedByUserId(userId) {
    try {
      const conn = await getCalRepo().findConnectionByUserId(userId, 'microsoft');
      if (conn) await getCalRepo().updateConnectionVerifiedById(conn.id);
    } catch (err) {
      logger.warn('MicrosoftTokenStore.markVerifiedByUserId failed (non-fatal)', { userId, error: err.message });
    }
  },
};

module.exports = { MicrosoftTokenStore, TokenExpiredError, PermissionDeniedError, GraphApiUnavailableError };
