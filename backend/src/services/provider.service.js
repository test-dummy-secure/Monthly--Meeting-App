'use strict';

const providerRepository         = require('../repositories/provider.repository');
const providerSyncLogRepository  = require('../repositories/providerSyncLog.repository');
const meetingProviderMappingRepo = require('../repositories/meetingProviderMapping.repository');
const auditLogRepository         = require('../repositories/audit-log.repository');
const logger                     = require('../utils/logger');

// ── Provider registry ─────────────────────────────────────────────────────────
// MANUAL and UPLOAD are always available; no connection record is needed.
// External providers require a provider_connections record with status=connected.

const PROVIDER_META = {
  MANUAL: {
    label:          'Manual Entry',
    supportsSync:   false,
    requiresConfig: false,
    comingSoon:     false,
    description:    'Enter notes directly in the meeting log editor.',
  },
  UPLOAD: {
    label:          'Manual Upload',
    supportsSync:   false,
    requiresConfig: false,
    comingSoon:     false,
    description:    'Upload a PDF, DOCX, or TXT minutes document.',
  },
  MICROSOFT_TEAMS: {
    label:          'Microsoft Teams',
    supportsSync:   true,
    requiresConfig: true,
    comingSoon:     false,
    description:    'Import transcripts from Microsoft Teams meetings.',
  },
};

const VALID_PROVIDER_TYPES = new Set(Object.keys(PROVIDER_META));
const BUILTIN_TYPES        = new Set(['MANUAL', 'UPLOAD']);

const validateProviderType = (providerType) => {
  if (!VALID_PROVIDER_TYPES.has(providerType)) {
    throw Object.assign(
      new Error(`Invalid providerType "${providerType}". Must be one of: ${[...VALID_PROVIDER_TYPES].join(', ')}`),
      { statusCode: 400 }
    );
  }
};

// ── Service ───────────────────────────────────────────────────────────────────

const providerService = {

  // List all configured provider connections for a tenant
  list: async (tenantId) => {
    return providerRepository.findByTenant(tenantId);
  },

  // Return full status grid: all provider types + their connection (or null)
  getStatus: async (tenantId) => {
    const connections = await providerRepository.findByTenant(tenantId);
    const connMap = {};
    for (const c of connections) connMap[c.providerType] = c;

    return Object.entries(PROVIDER_META).map(([type, meta]) => ({
      providerType:     type,
      providerName:     meta.label,
      description:      meta.description,
      supportsSync:     meta.supportsSync,
      requiresConfig:   meta.requiresConfig,
      comingSoon:       meta.comingSoon,
      connection:       connMap[type] || null,
      connectionStatus: connMap[type]?.connectionStatus || (BUILTIN_TYPES.has(type) ? 'built_in' : 'not_configured'),
    }));
  },

  // Create or update a provider connection for a tenant
  connect: async (tenantId, { providerType, oauthAccountEmail, providerWorkspaceId }, user) => {
    validateProviderType(providerType);

    if (BUILTIN_TYPES.has(providerType)) {
      throw Object.assign(
        new Error(`${providerType} is a built-in provider and does not require configuration.`),
        { statusCode: 400 }
      );
    }

    const conn = await providerRepository.upsert({
      tenantId,
      providerType,
      providerName:        PROVIDER_META[providerType].label,
      connectionStatus:    'connected',
      oauthAccountEmail:   oauthAccountEmail   || null,
      providerWorkspaceId: providerWorkspaceId || null,
    });

    await auditLogRepository.create(tenantId, user.email, 'Provider Connected', {
      providerType,
      oauthAccountEmail: oauthAccountEmail || null,
    });

    logger.info('Provider connected', { tenantId, providerType });
    return conn;
  },

  // Update metadata on an existing connection
  update: async (id, tenantId, updates, user) => {
    const existing = await providerRepository.findById(id, tenantId);
    if (!existing) {
      throw Object.assign(new Error('Provider connection not found'), { statusCode: 404 });
    }

    const conn = await providerRepository.update(id, tenantId, updates);
    await auditLogRepository.create(tenantId, user.email, 'Provider Updated', { id });
    return conn;
  },

  // Disable (soft-disconnect) a provider connection
  disable: async (id, tenantId, user) => {
    const existing = await providerRepository.findById(id, tenantId);
    if (!existing) {
      throw Object.assign(new Error('Provider connection not found'), { statusCode: 404 });
    }

    const conn = await providerRepository.update(id, tenantId, { connectionStatus: 'disconnected' });
    await auditLogRepository.create(tenantId, user.email, 'Provider Disabled', {
      id, providerType: existing.providerType,
    });
    return conn;
  },

  // Hard-delete a provider connection
  delete: async (id, tenantId, user) => {
    const existing = await providerRepository.findById(id, tenantId);
    if (!existing) {
      throw Object.assign(new Error('Provider connection not found'), { statusCode: 404 });
    }

    await providerRepository.delete(id, tenantId);
    await auditLogRepository.create(tenantId, user.email, 'Provider Deleted', {
      id, providerType: existing.providerType,
    });
  },

  // ── Meeting provider mapping ─────────────────────────────────────────────────

  getMeetingMapping: async (meetingId) => {
    return meetingProviderMappingRepo.findByMeeting(meetingId);
  },

  setMeetingMapping: async (meetingId, tenantId, { providerType, sourceType }, user) => {
    validateProviderType(providerType);

    // For external providers, resolve the connection ID if one exists
    let providerConnectionId = null;
    if (!BUILTIN_TYPES.has(providerType)) {
      const conn = await providerRepository.findByType(tenantId, providerType);
      providerConnectionId = conn?.id || null;
    }

    const mapping = await meetingProviderMappingRepo.upsert({
      meetingId,
      tenantId,
      providerType,
      providerConnectionId,
      sourceType: sourceType || providerType.toLowerCase().replace('_', '_'),
    });

    await auditLogRepository.create(tenantId, user.email, 'Meeting Provider Set', {
      meetingId, providerType,
    });

    return mapping;
  },

  // ── Sync log management ──────────────────────────────────────────────────────

  getSyncLogs: async (tenantId, limit = 50) => {
    return providerSyncLogRepository.findByTenant(tenantId, limit);
  },

  getMeetingSyncLogs: async (meetingId) => {
    return providerSyncLogRepository.findByMeeting(meetingId);
  },

  // Trigger a sync for a provider connection + meeting.
  // Currently an extension point: creates a sync log record and runs the
  // provider-specific fetch in a non-blocking setImmediate callback.
  // Replace the setImmediate body with real provider client calls when available.
  triggerSync: async (connectionId, tenantId, meetingId, user) => {
    const conn = await providerRepository.findById(connectionId, tenantId);
    if (!conn) {
      throw Object.assign(new Error('Provider connection not found'), { statusCode: 404 });
    }
    if (conn.connectionStatus !== 'connected') {
      throw Object.assign(
        new Error(`Provider "${conn.providerName}" is not connected. Enable it first.`),
        { statusCode: 422 }
      );
    }
    if (!PROVIDER_META[conn.providerType]?.supportsSync) {
      throw Object.assign(
        new Error(`Provider "${conn.providerName}" does not support automatic sync.`),
        { statusCode: 400 }
      );
    }

    const log = await providerSyncLogRepository.create({
      tenantId,
      meetingId: meetingId || null,
      providerType: conn.providerType,
    });

    // Extension point: inject provider-specific fetch logic here when Fathom is implemented.
    // Microsoft Teams transcripts are fetched by transcriptFetch.job.js — not this path.
    setImmediate(async () => {
      try {
        // if (conn.providerType === 'FATHOM') await FathomClient.fetchTranscript(conn, meetingId);
        await providerSyncLogRepository.updateStatus(log.id, 'completed');
        await providerRepository.update(conn.id, tenantId, { lastSyncAt: new Date().toISOString() });
        logger.info('Provider sync completed (extension point)', {
          tenantId, providerType: conn.providerType, meetingId,
        });
      } catch (err) {
        await providerSyncLogRepository.updateStatus(log.id, 'failed', err.message);
        logger.error('Provider sync failed', {
          tenantId, providerType: conn.providerType, meetingId, error: err.message,
        });
      }
    });

    await auditLogRepository.create(tenantId, user.email, 'Provider Sync Triggered', {
      connectionId, providerType: conn.providerType, meetingId, syncLogId: log.id,
    });

    logger.info('Provider sync triggered', { tenantId, providerType: conn.providerType, meetingId });

    return {
      syncLogId:    log.id,
      status:       'running',
      providerType: conn.providerType,
      message:      'Sync initiated. Check sync logs for status updates.',
    };
  },
};

module.exports = providerService;
