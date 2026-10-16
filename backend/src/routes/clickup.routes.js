'use strict';

const express                      = require('express');
const router                       = express.Router();
const auth                         = require('../middleware/auth.middleware');
const { encrypt, decrypt }         = require('../utils/encryption');
const clickupConnectionRepository  = require('../repositories/clickup-connection.repository');
const ClickUpClient                = require('../integrations/clickup/ClickUpClient');
const auditLogRepository           = require('../repositories/audit-log.repository');
const logger                       = require('../utils/logger');

router.use(auth);

// ── GET /api/clickup/connection ───────────────────────────────────────────────
// Returns current connection status (no API key returned).
router.get('/connection', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const conn = await clickupConnectionRepository.get();
    if (!conn || conn.status !== 'connected') {
      return res.json({ connected: false, status: 'disconnected' });
    }
    res.json({
      connected:     true,
      status:        conn.status,
      workspaceId:   conn.workspace_id,
      workspaceName: conn.workspace_name,
      spaceId:       conn.space_id,
      spaceName:     conn.space_name,
      keyHint:       conn.sync_metadata?.keyHint || null,
      connectedAt:   conn.created_at,
    });
  } catch (err) {
    logger.error('ClickUp GET connection failed', { error: err.message });
    next(err);
  }
});

// ── POST /api/clickup/validate ────────────────────────────────────────────────
// Validates API key and returns workspaces for the Super Admin to pick from.
// Does NOT save anything — just a lookup step.
router.post('/validate', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey?.trim()) return res.status(400).json({ error: 'apiKey is required' });

    const client     = new ClickUpClient(apiKey.trim());
    const validation = await client.validate();

    if (!validation.valid) {
      return res.status(422).json({ error: `ClickUp API key invalid: ${validation.message}` });
    }

    res.json({ valid: true, workspaces: validation.workspaces });
  } catch (err) {
    logger.error('ClickUp validate failed', { error: err.message });
    next(err);
  }
});

// ── GET /api/clickup/workspaces/:workspaceId/spaces ───────────────────────────
// Returns spaces using the stored connection (post-setup use).
router.get('/workspaces/:workspaceId/spaces', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const conn = await clickupConnectionRepository.get();
    if (!conn) return res.status(400).json({ error: 'ClickUp not connected' });

    const apiKey = decrypt(conn.api_key_enc);
    const client = new ClickUpClient(apiKey);
    const spaces = await client.getSpaces(req.params.workspaceId);
    res.json({ spaces });
  } catch (err) {
    logger.error('ClickUp get spaces failed', { error: err.message });
    next(err);
  }
});

// ── POST /api/clickup/workspaces/:workspaceId/spaces ──────────────────────────
// Wizard variant — accepts apiKey in body so the admin can fetch spaces before
// saving the connection (step 2 of the connect wizard).
router.post('/workspaces/:workspaceId/spaces', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey?.trim()) return res.status(400).json({ error: 'apiKey is required' });
    const client = new ClickUpClient(apiKey.trim());
    const spaces = await client.getSpaces(req.params.workspaceId);
    res.json({ spaces });
  } catch (err) {
    logger.error('ClickUp get spaces (wizard) failed', { error: err.message });
    next(err);
  }
});

// ── POST /api/clickup/connection ──────────────────────────────────────────────
// Saves the API key + selected workspace + selected space.
router.post('/connection', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { apiKey, workspaceId, workspaceName, spaceId, spaceName } = req.body;
    if (!apiKey?.trim())      return res.status(400).json({ error: 'apiKey is required' });
    if (!workspaceId?.trim()) return res.status(400).json({ error: 'workspaceId is required' });
    if (!spaceId?.trim())     return res.status(400).json({ error: 'spaceId is required' });

    // Final validation before saving
    const client     = new ClickUpClient(apiKey.trim());
    const validation = await client.validate();
    if (!validation.valid) {
      return res.status(422).json({ error: `ClickUp API key invalid: ${validation.message}` });
    }

    const apiKeyEnc = encrypt(apiKey.trim());
    const keyHint   = apiKey.trim().slice(-4);

    const conn = await clickupConnectionRepository.save({
      apiKeyEnc,
      workspaceId,
      workspaceName: workspaceName || '',
      spaceId,
      spaceName:     spaceName     || '',
      syncMetadata:  { keyHint },
    });

    auditLogRepository.create(
      null, req.user.email, 'ClickUp Connected',
      { workspaceId, workspaceName, spaceId, spaceName, keyHint }, req.ip
    ).catch(() => {});

    logger.info('ClickUp connection saved', { workspaceId, spaceId, by: req.user.email });

    res.json({
      connected:     true,
      workspaceId:   conn.workspace_id,
      workspaceName: conn.workspace_name,
      spaceId:       conn.space_id,
      spaceName:     conn.space_name,
    });
  } catch (err) {
    logger.error('ClickUp save connection failed', { error: err.message });
    next(err);
  }
});

// ── DELETE /api/clickup/connection ────────────────────────────────────────────
router.delete('/connection', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    await clickupConnectionRepository.delete();
    auditLogRepository.create(null, req.user.email, 'ClickUp Disconnected', {}, req.ip).catch(() => {});
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── GET /api/clickup/space/folders ───────────────────────────────────────────
// Lists all folders that exist in the connected ClickUp space.
// Used by the tenant form so super admin can pick an existing folder to link.
router.get('/space/folders', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const conn = await clickupConnectionRepository.get();
    if (!conn || conn.status !== 'connected') {
      return res.status(400).json({ error: 'ClickUp not connected. Configure in Settings → Integrations first.' });
    }
    const apiKey  = decrypt(conn.api_key_enc);
    const client  = new ClickUpClient(apiKey);
    const folders = await client.getFolders(conn.space_id);
    res.json({ folders, spaceId: conn.space_id, spaceName: conn.space_name });
  } catch (err) {
    logger.error('ClickUp get space folders failed', { error: err.message });
    next(err);
  }
});

// ── PUT /api/clickup/folders/:tenantId ───────────────────────────────────────
// Links an EXISTING ClickUp folder to a tenant (folder already in ClickUp).
// Finds or creates the "Action Items" list inside that folder, then saves mapping.
router.put('/folders/:tenantId', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { folderId, folderName } = req.body;
    if (!folderId?.trim())  return res.status(400).json({ error: 'folderId is required' });
    if (!folderName?.trim()) return res.status(400).json({ error: 'folderName is required' });

    const conn = await clickupConnectionRepository.get();
    if (!conn || conn.status !== 'connected') {
      return res.status(400).json({ error: 'ClickUp not connected. Configure in Settings → Integrations first.' });
    }

    const apiKey = decrypt(conn.api_key_enc);
    const client = new ClickUpClient(apiKey);

    // Find existing "Action Items" list in the folder, or create one if absent
    const lists = await client.getLists(folderId.trim());
    const ACTION_LIST_NAME = 'Action Items';
    let list = lists.find((l) => l.name.toLowerCase() === ACTION_LIST_NAME.toLowerCase());
    if (!list) {
      list = await client.createList(folderId.trim());
      logger.info('ClickUp: created Action Items list in existing folder', { folderId, listId: list.id });
    } else {
      logger.info('ClickUp: found existing Action Items list', { folderId, listId: list.id });
    }

    const mapping = await clickupConnectionRepository.upsertFolderMapping({
      tenantId,
      folderId:   folderId.trim(),
      folderName: folderName.trim(),
      listId:     list.id,
      listName:   list.name,
    });

    auditLogRepository.create(tenantId, req.user.email, 'ClickUp Folder Linked',
      { folderId: folderId.trim(), folderName: folderName.trim(), listId: list.id }, req.ip).catch(() => {});

    logger.info('ClickUp existing folder linked to tenant', { tenantId, folderId, listId: list.id });

    res.json({
      connected:  true,
      folderId:   mapping.folder_id,
      folderName: mapping.folder_name,
      listId:     mapping.list_id,
      listName:   mapping.list_name,
    });
  } catch (err) {
    logger.error('ClickUp folder link failed', { error: err.message, tenantId: req.params.tenantId });
    next(err);
  }
});

// ── GET /api/clickup/folders ──────────────────────────────────────────────────
// Returns all tenant folder mappings (for super admin overview).
router.get('/folders', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const mappings = await clickupConnectionRepository.getAllFolderMappings();
    res.json({ mappings });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/clickup/folders/:tenantId ───────────────────────────────────────
router.get('/folders/:tenantId', async (req, res, next) => {
  try {
    const mapping = await clickupConnectionRepository.getFolderMapping(req.params.tenantId);
    if (!mapping) return res.json({ connected: false });
    res.json({
      connected:  true,
      folderId:   mapping.folder_id,
      folderName: mapping.folder_name,
      listId:     mapping.list_id,
      listName:   mapping.list_name,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/clickup/folders/:tenantId ──────────────────────────────────────
// Creates a ClickUp folder+list for an existing tenant and saves the mapping.
// Used for existing tenants that predate the ClickUp integration.
router.post('/folders/:tenantId', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { tenantName } = req.body;
    if (!tenantName?.trim()) return res.status(400).json({ error: 'tenantName is required' });

    const conn = await clickupConnectionRepository.get();
    if (!conn || conn.status !== 'connected') {
      return res.status(400).json({ error: 'ClickUp not connected. Configure in Settings → Integrations first.' });
    }

    const apiKey = decrypt(conn.api_key_enc);
    const client = new ClickUpClient(apiKey);
    const { folder, list } = await client.createTenantResources(conn.space_id, tenantName.trim());

    const mapping = await clickupConnectionRepository.upsertFolderMapping({
      tenantId,
      folderId:   folder.id,
      folderName: folder.name,
      listId:     list.id,
      listName:   list.name,
    });

    auditLogRepository.create(tenantId, req.user.email, 'ClickUp Folder Created',
      { folderId: folder.id, folderName: folder.name }, req.ip).catch(() => {});

    logger.info('ClickUp folder mapping created', { tenantId, folderId: folder.id });

    res.json({
      connected:  true,
      folderId:   mapping.folder_id,
      folderName: mapping.folder_name,
      listId:     mapping.list_id,
      listName:   mapping.list_name,
    });
  } catch (err) {
    logger.error('ClickUp folder create failed', { error: err.message, tenantId: req.params.tenantId });
    next(err);
  }
});

module.exports = router;
