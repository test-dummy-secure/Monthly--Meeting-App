'use strict';

const express                        = require('express');
const router                         = express.Router();
const auth                           = require('../middleware/auth.middleware');
const tenantAccessService            = require('../services/tenantAccess.service');
const firefliesConnectionRepository  = require('../repositories/fireflies-connection.repository');
const { encrypt, decrypt }           = require('../utils/encryption');
const auditLogRepository             = require('../repositories/audit-log.repository');
const logger                         = require('../utils/logger');

router.use(auth);

// ── GET /api/fireflies/connections/:tenantId ──────────────────────────────────
// Returns connection status for the currently logged-in AM.
// API key is NEVER returned — only a key hint.
// Uses the AM's user_id (migration 043) so a new AM sees "not connected"
// until they enter their own Fireflies API key.
router.get('/connections/:tenantId', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const userId = req.user?.id || req.user?.userId;
    await tenantAccessService.ensureTenantAccess(req.user, tenantId);

    const conn = await firefliesConnectionRepository.findForTenant(tenantId, userId);
    if (!conn || conn.status === 'disconnected') {
      return res.json({ connected: false, status: 'disconnected' });
    }

    res.json({
      connected:    conn.status === 'connected',
      status:       conn.status,
      lastSyncedAt: conn.lastSyncedAt,
      keyHint:      conn.syncMetadata?.keyHint || null,
      connectedAt:  conn.createdAt,
    });
  } catch (err) {
    logger.error('Fireflies connection GET failed', { error: err.message, tenantId: req.params.tenantId });
    next(err);
  }
});

// ── POST /api/fireflies/connections/:tenantId ─────────────────────────────────
// Validates the API key against the live Fireflies GraphQL API, then stores it
// encrypted. Replaces any existing connection (upsert).
// Allowed for account_manager (their own tenant) or super_admin.
router.post('/connections/:tenantId', auth.requireRole(['super_admin', 'account_manager']), async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { apiKey }   = req.body;
    const userId       = req.user?.id || req.user?.userId;

    if (!apiKey?.trim()) {
      return res.status(400).json({ error: 'apiKey is required' });
    }

    await tenantAccessService.ensureTenantAccess(req.user, tenantId);

    logger.info('Fireflies connection: validating API key', { tenantId, userId });
    const firefliesService = require('../services/fireflies.service');
    const validation = await firefliesService.validateApiKey(apiKey.trim());
    if (!validation.valid && !validation.isRateLimit) {
      return res.status(422).json({
        error: `Fireflies API key validation failed: ${validation.message || 'invalid key'}`,
      });
    }

    const apiKeyEnc = encrypt(apiKey.trim());
    const keyHint   = apiKey.trim().slice(-4);

    const conn = await firefliesConnectionRepository.upsert({
      userId,
      tenantId,
      apiKeyEnc,
      status:       'connected',
      syncMetadata: { keyHint },
    });

    auditLogRepository.create(
      tenantId, req.user.email, 'Fireflies AI Connected', { keyHint, userId }, req.ip
    ).catch(() => {});

    logger.info('Fireflies connection saved', { tenantId, userId, by: req.user.email, rateLimited: !!validation.isRateLimit });

    // Inject bot into all upcoming meetings that were scheduled before Fireflies was connected.
    // Non-blocking — failures are logged but don't affect the connect response.
    setImmediate(async () => {
      try {
        const db = require('../config/db');
        // Find upcoming meetings across ALL tenants assigned to this AM —
        // primary or secondary/shared (tenant_assignments), not just tenants
        // where they're the primary AM on customers.account_manager_id.
        const { rows: upcoming } = await db.query(
          `SELECT m.id, m.ms_event_id
           FROM   meetings m
           JOIN   tenant_assignments ta ON ta.tenant_id = m.tenant_id
           WHERE  ta.user_id          = $1
             AND  m.ms_event_id        IS NOT NULL
             AND  m.status             IN ('scheduled', 'approval_pending')
             AND  m.scheduled_start    > NOW()`,
          [userId]
        );
        if (upcoming.length === 0) return;

        const { MicrosoftTokenStore } = require('../services/microsoft/MicrosoftTokenStore');
        const accessToken = await MicrosoftTokenStore.load(tenantId);
        if (!accessToken) return;

        const calClient = require('../services/microsoft/MicrosoftCalendarClient');
        const FIREFLIES_BOT_EMAIL = 'fred@fireflies.ai';
        let injected = 0;
        for (const m of upcoming) {
          await calClient.addAttendeesToEvent(accessToken, m.ms_event_id, [
            { email: FIREFLIES_BOT_EMAIL, name: 'Fireflies AI Notetaker' },
          ]).catch((e) => logger.warn('Fireflies connect: bot injection failed for meeting', {
            meetingId: m.id, error: e.message,
          }));
          injected++;
        }
        logger.info('Fireflies connect: bot injected into upcoming meetings', { tenantId, injected });
      } catch (err) {
        logger.warn('Fireflies connect: bot auto-inject failed (non-fatal)', { tenantId, error: err.message });
      }
    });

    res.json({
      connected:    true,
      status:       conn.status,
      lastSyncedAt: conn.lastSyncedAt,
      keyHint:      conn.syncMetadata?.keyHint || null,
      connectedAt:  conn.createdAt,
      warning:      validation.isRateLimit
        ? 'API key saved. Fireflies is rate-limited right now — connection will work once the quota resets (daily).'
        : undefined,
    });
  } catch (err) {
    logger.error('Fireflies connection save failed', { error: err.message, tenantId: req.params.tenantId });
    next(err);
  }
});

// ── POST /api/fireflies/connections/:tenantId/test ────────────────────────────
// Tests the stored connection by making a live Fireflies API call.
router.post('/connections/:tenantId/test', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const userId       = req.user?.id || req.user?.userId;
    await tenantAccessService.ensureTenantAccess(req.user, tenantId);

    const conn = await firefliesConnectionRepository.findForTenant(tenantId, userId);
    if (!conn || conn.status !== 'connected') {
      return res.status(404).json({ success: false, error: 'No active Fireflies connection for this account' });
    }

    const apiKey           = decrypt(conn.apiKeyEnc);
    const firefliesService = require('../services/fireflies.service');
    const validation       = await firefliesService.validateApiKey(apiKey);

    if (!validation.valid) {
      const isRateLimit = /too many requests|rate.?limit|429/i.test(validation.message || '');
      if (!isRateLimit) {
        await firefliesConnectionRepository.setStatus(tenantId, 'error', userId);
      }
      return res.json({ success: false, error: validation.message || 'Fireflies API key rejected' });
    }

    logger.info('Fireflies connection test passed', { tenantId, userId });
    res.json({ success: true, testedAt: new Date().toISOString() });
  } catch (err) {
    logger.warn('Fireflies connection test failed', { error: err.message, tenantId: req.params.tenantId });
    res.json({ success: false, error: err.message });
  }
});

// ── DELETE /api/fireflies/connections/:tenantId ───────────────────────────────
// Removes the current AM's Fireflies connection (user-scoped after migration 043).
router.delete('/connections/:tenantId', auth.requireRole(['super_admin', 'account_manager']), async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const userId       = req.user?.id || req.user?.userId;
    await tenantAccessService.ensureTenantAccess(req.user, tenantId);

    await firefliesConnectionRepository.delete(tenantId, userId);

    auditLogRepository.create(
      tenantId, req.user.email, 'Fireflies AI Disconnected', { userId }, req.ip
    ).catch(() => {});

    logger.info('Fireflies connection removed', { tenantId, userId, by: req.user.email });
    res.status(204).end();
  } catch (err) {
    logger.error('Fireflies connection delete failed', { error: err.message, tenantId: req.params.tenantId });
    next(err);
  }
});

module.exports = router;
