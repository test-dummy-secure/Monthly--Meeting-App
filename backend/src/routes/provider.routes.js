'use strict';

const express         = require('express');
const router          = express.Router();
const providerService = require('../services/provider.service');
const auth            = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const logger          = require('../utils/logger');

router.use(auth, tenantMiddleware);

// ── Static routes (must be registered BEFORE /:id to avoid param conflicts) ──

// GET /api/providers/status — full provider type grid with connection status
router.get('/status', async (req, res, next) => {
  try {
    const status = await providerService.getStatus(req.tenantId);
    res.json(status);
  } catch (err) {
    logger.error('Provider status fetch failed', { error: err.message });
    next(err);
  }
});

// GET /api/providers/sync-logs — tenant-level sync log history
router.get('/sync-logs', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const logs  = await providerService.getSyncLogs(req.tenantId, limit);
    res.json({ logs });
  } catch (err) {
    logger.error('Sync logs fetch failed', { error: err.message });
    next(err);
  }
});

// GET /api/providers/mapping/:meetingId — provider mapping for a specific meeting
router.get('/mapping/:meetingId', async (req, res, next) => {
  try {
    const mapping = await providerService.getMeetingMapping(req.params.meetingId);
    res.json(mapping || null);
  } catch (err) {
    logger.error('Meeting mapping fetch failed', { error: err.message });
    next(err);
  }
});

// POST /api/providers/mapping/:meetingId — set provider source for a meeting
router.post('/mapping/:meetingId', async (req, res, next) => {
  try {
    const { providerType, sourceType } = req.body;
    if (!providerType) return res.status(400).json({ error: 'providerType is required' });
    const mapping = await providerService.setMeetingMapping(
      req.params.meetingId, req.tenantId, { providerType, sourceType }, req.user
    );
    res.json(mapping);
  } catch (err) {
    logger.error('Meeting mapping save failed', { error: err.message });
    next(err);
  }
});

// GET /api/providers — list all provider connections for tenant
router.get('/', async (req, res, next) => {
  try {
    const list = await providerService.list(req.tenantId);
    res.json({ providers: list });
  } catch (err) {
    logger.error('Provider list failed', { error: err.message });
    next(err);
  }
});

// POST /api/providers — connect / configure a provider
router.post('/', async (req, res, next) => {
  try {
    const { providerType, oauthAccountEmail, providerWorkspaceId } = req.body;
    if (!providerType) return res.status(400).json({ error: 'providerType is required' });
    const conn = await providerService.connect(
      req.tenantId, { providerType, oauthAccountEmail, providerWorkspaceId }, req.user
    );
    res.status(201).json(conn);
  } catch (err) {
    logger.error('Provider connect failed', { error: err.message });
    next(err);
  }
});

// PUT /api/providers/:id — update a provider connection
router.put('/:id', async (req, res, next) => {
  try {
    const conn = await providerService.update(req.params.id, req.tenantId, req.body, req.user);
    if (!conn) return res.status(404).json({ error: 'Provider connection not found' });
    res.json(conn);
  } catch (err) {
    logger.error('Provider update failed', { error: err.message });
    next(err);
  }
});

// POST /api/providers/:id/disable — disable a provider connection
router.post('/:id/disable', async (req, res, next) => {
  try {
    const conn = await providerService.disable(req.params.id, req.tenantId, req.user);
    res.json(conn);
  } catch (err) {
    logger.error('Provider disable failed', { error: err.message });
    next(err);
  }
});

// POST /api/providers/:id/sync — trigger a provider sync for a meeting
router.post('/:id/sync', async (req, res, next) => {
  try {
    const { meetingId } = req.body;
    const result = await providerService.triggerSync(
      req.params.id, req.tenantId, meetingId || null, req.user
    );
    res.json(result);
  } catch (err) {
    logger.error('Provider sync trigger failed', { error: err.message });
    next(err);
  }
});

// DELETE /api/providers/:id — remove a provider connection
router.delete('/:id', async (req, res, next) => {
  try {
    await providerService.delete(req.params.id, req.tenantId, req.user);
    res.status(204).end();
  } catch (err) {
    logger.error('Provider delete failed', { error: err.message });
    next(err);
  }
});

module.exports = router;
