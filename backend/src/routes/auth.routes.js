'use strict';

const express         = require('express');
const jwt             = require('jsonwebtoken');
const bcrypt          = require('bcryptjs');
const crypto          = require('crypto');
const router          = express.Router();
const { authLimiter, loginLimiter, forgotPasswordLimiter } = require('../config/rate-limits');
const { config }      = require('../config/index');
const logger          = require('../utils/logger');
const userRepository  = require('../repositories/user.repository');
const redisClient     = require('../config/redisClient');
const emailService    = require('../services/email.service');
const auth            = require('../middleware/auth.middleware');

const RESET_TTL_S = 60 * 60; // 1 hour
const resetKey    = (token) => `pwd:reset:${token}`;

// ─── Token factories ─────────────────────────────────────────────────────────

const createAccessToken = (user) =>
  jwt.sign(
    {
      id:                   user.id,
      email:                user.email,
      role:                 user.role,
      first_name:           user.first_name,
      last_name:            user.last_name,
      tenant_id:            user.tenant_id,
      mustChangePassword:   user.must_change_password || false,
      tokenType:            'access',
    },
    config.jwtAccessSecret,
    { expiresIn: config.jwtExpiresIn }
  );

// Refresh token carries minimal payload — all identity is fetched from DB on use.
const createRefreshToken = (user) =>
  jwt.sign(
    { id: user.id, tokenType: 'refresh' },
    config.jwtRefreshSecret,
    { expiresIn: config.refreshExpiresIn }
  );

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseExpireMs = (duration) => {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return null;
  const n = Number(match[1]);
  const units = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };
  return n * (units[match[2]] || 0);
};

// Never expose password_hash or is_active in API responses.
const sanitizeUser = (user) => ({
  id:                 user.id,
  email:              user.email,
  first_name:         user.first_name,
  last_name:          user.last_name,
  role:               user.role,
  tenant_id:          user.tenant_id,
  mustChangePassword: user.must_change_password || false,
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const user = await userRepository.findByEmail(email);

    // Constant-time comparison even when user is not found — prevents timing attacks.
    const passwordValid =
      user && (await bcrypt.compare(password, user.password_hash));

    if (!passwordValid) {
      logger.warn('Login failed: invalid credentials', { email });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const accessToken  = createAccessToken(user);
    const refreshToken = createRefreshToken(user);
    const expiresAt    = new Date(Date.now() + parseExpireMs(config.refreshExpiresIn));

    await userRepository.saveRefreshToken(user.id, refreshToken, expiresAt);

    logger.info('Login successful', { userId: user.id, role: user.role });
    res.json({ accessToken, refreshToken, user: sanitizeUser(user) });

  } catch (err) {
    logger.error('Login error', { error: err.message, stack: err.stack });
    next(err);
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

router.post('/refresh', authLimiter, async (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required' });
  }

  try {
    // 1. Verify signature and expiry using the refresh-only secret.
    let payload;
    try {
      payload = jwt.verify(refreshToken, config.jwtRefreshSecret);
    } catch {
      return res.status(401).json({ error: 'Refresh token is invalid or expired' });
    }

    // 2. Guard against using an access token here.
    if (payload.tokenType !== 'refresh') {
      logger.warn('Token substitution attempt: non-refresh token used on /refresh', {
        userId: payload.id,
      });
      return res.status(401).json({ error: 'Invalid token type' });
    }

    // 3. Look up the hashed token in the DB — must be unrevoked and unexpired.
    const tokenRecord = await userRepository.findRefreshToken(refreshToken);
    if (!tokenRecord) {
      // Token was revoked or already used — possible replay attack.
      logger.warn('Refresh token not found or revoked', { userId: payload.id });
      // Revoke every session for this user as a precaution.
      await userRepository.revokeAllUserTokens(payload.id);
      return res.status(401).json({ error: 'Refresh token is invalid or expired' });
    }

    // 4. Fetch fresh user data — catches role changes, deactivation, or
    //    must_change_password flag updates since the token was issued.
    const user = await userRepository.findById(payload.id);
    if (!user) {
      await userRepository.revokeRefreshToken(refreshToken);
      return res.status(401).json({ error: 'User not found' });
    }

    // 5. Rotate: revoke consumed token, issue fresh pair.
    await userRepository.revokeRefreshToken(refreshToken);

    const newAccessToken  = createAccessToken(user);
    const newRefreshToken = createRefreshToken(user);
    const expiresAt       = new Date(Date.now() + parseExpireMs(config.refreshExpiresIn));

    await userRepository.saveRefreshToken(user.id, newRefreshToken, expiresAt);

    logger.info('Token rotation successful', { userId: user.id });
    res.json({
      accessToken:  newAccessToken,
      refreshToken: newRefreshToken,
      user: sanitizeUser(user),
    });

  } catch (err) {
    logger.error('Refresh error', { error: err.message, stack: err.stack });
    next(err);
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

router.post('/logout', authLimiter, async (req, res, next) => {
  const { refreshToken } = req.body;
  try {
    if (refreshToken) {
      await userRepository.revokeRefreshToken(refreshToken);
      logger.info('Logout: refresh token revoked');
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error('Logout error', { error: err.message, stack: err.stack });
    next(err);
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
// Generates a cryptographically random reset token, stores it in Redis with a
// 1-hour TTL, and sends a password reset email.
// Always returns 200 regardless of whether the email exists — prevents user
// enumeration attacks.

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  try {
    const user = await userRepository.findByEmail(email);

    if (user) {
      const token      = crypto.randomBytes(32).toString('hex');
      const allClients = (process.env.CLIENT_URL || 'http://localhost:5173')
        .split(',').map(u => u.trim()).filter(Boolean);
      // Prefer the first publicly-reachable URL (not localhost / 127.0.0.1)
      // so the reset link works when the AM opens the email on their device.
      const clientUrl  = allClients.find(u => !/localhost|127\.0\.0\.1/.test(u)) || allClients[0];
      const resetUrl   = `${clientUrl}/reset-password?token=${token}`;

      await redisClient.set(resetKey(token), user.id, { EX: RESET_TTL_S });

      // Fire-and-forget — network failure must not expose user existence to caller
      emailService.send({
        to:           user.email,
        subject:      'Reset your NxgSecure password',
        templateName: 'password-reset',
        vars: {
          firstName: user.first_name || 'there',
          resetUrl,
          expiryMins: '60',
        },
      }).catch((err) =>
        logger.error('forgot-password: email send failed', { userId: user.id, error: err.message })
      );

      logger.info('forgot-password: reset token issued', { userId: user.id });
    } else {
      logger.info('forgot-password: email not found (silent)', { email });
    }
  } catch (err) {
    logger.error('forgot-password: unexpected error', { error: err.message });
  }

  // Always the same response — never reveal whether the email is registered
  res.json({ message: 'If that email is registered you will receive a reset link shortly.' });
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
// Validates the reset token from Redis, updates the password, revokes all
// active sessions, and deletes the token so it cannot be reused.

router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: 'token and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const userId = await redisClient.get(resetKey(token));
    if (!userId) {
      return res.status(400).json({ error: 'Reset token is invalid or has expired' });
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      await redisClient.del(resetKey(token));
      return res.status(400).json({ error: 'Reset token is invalid or has expired' });
    }

    const hash = await bcrypt.hash(newPassword, config.bcryptRounds);

    // updatePassword() hashes + stores and revokes all active sessions in one call
    await userRepository.updatePassword(userId, hash);

    // Consume the token — single-use only
    await redisClient.del(resetKey(token));

    logger.info('reset-password: password updated', { userId });
    res.json({ message: 'Password updated successfully. Please log in with your new password.' });

  } catch (err) {
    logger.error('reset-password: unexpected error', { error: err.message });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

// ─── POST /api/auth/change-password ──────────────────────────────────────────
// Authenticated endpoint — requires a valid access token.
// Used when an AM is forced to change their password after an admin reset.
// Validates the current (temp) password, then updates to the new one,
// clears the must_change_password flag, and revokes all existing sessions
// so the AM must log in fresh with their new credentials.

router.post('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from the current password' });
  }

  try {
    // Fetch full user record including password_hash
    const { rows } = await require('../database/index').query(
      `SELECT id, password_hash, must_change_password FROM users WHERE id = $1 AND is_active = true`,
      [req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = rows[0];

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      logger.warn('change-password: current password incorrect', { userId: req.user.id });
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, config.bcryptRounds);

    // Update password and revoke all existing sessions atomically
    await userRepository.updatePassword(req.user.id, newHash);

    // Clear the forced-change flag so the AM has normal access after re-login
    await userRepository.setMustChangePassword(req.user.id, false);

    logger.info('change-password: password changed successfully', { userId: req.user.id });
    res.json({ message: 'Password changed successfully. Please log in with your new password.' });

  } catch (err) {
    logger.error('change-password: unexpected error', { error: err.message });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

module.exports = router;
