'use strict';

const logger = require('../../utils/logger');

const BASE      = 'https://api.clickup.com/api/v2';
const LIST_NAME = 'Action Items';

const PRIORITY_MAP = { critical: 1, high: 2, medium: 3, low: 4 };

class ClickUpClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async _req(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { err: text }; }
    if (!res.ok) {
      throw Object.assign(
        new Error(`ClickUp ${method} ${path} → ${res.status}: ${json?.err || text}`),
        { statusCode: res.status, clickupErr: json }
      );
    }
    return json;
  }

  // ── Workspace ─────────────────────────────────────────────────────────────

  async getWorkspaces() {
    const data = await this._req('GET', '/team');
    return (data.teams || []).map((t) => ({ id: t.id, name: t.name }));
  }

  // ── Spaces ────────────────────────────────────────────────────────────────

  async getSpaces(workspaceId) {
    // Try with archived=false first, fall back to all spaces if empty
    let data = await this._req('GET', `/team/${workspaceId}/space?archived=false`);
    logger.info('ClickUp getSpaces raw', { workspaceId, count: (data.spaces || []).length, raw: JSON.stringify(data) });
    if (!data.spaces || data.spaces.length === 0) {
      data = await this._req('GET', `/team/${workspaceId}/space`);
      logger.info('ClickUp getSpaces fallback (no filter)', { workspaceId, count: (data.spaces || []).length, raw: JSON.stringify(data) });
    }
    return (data.spaces || []).map((s) => ({ id: s.id, name: s.name }));
  }

  // ── Folders ───────────────────────────────────────────────────────────────

  async getFolders(spaceId) {
    const data = await this._req('GET', `/space/${spaceId}/folder?archived=false`);
    return (data.folders || []).map((f) => ({ id: f.id, name: f.name }));
  }

  async createFolder(spaceId, tenantName) {
    const name = `${tenantName} - Monthly Meeting`;
    const data = await this._req('POST', `/space/${spaceId}/folder`, { name });
    logger.info('ClickUp: folder created', { spaceId, name });
    return { id: data.id, name: data.name };
  }

  // ── Lists ─────────────────────────────────────────────────────────────────

  async getLists(folderId) {
    const data = await this._req('GET', `/folder/${folderId}/list?archived=false`);
    return (data.lists || []).map((l) => ({ id: l.id, name: l.name }));
  }

  async createList(folderId) {
    const data = await this._req('POST', `/folder/${folderId}/list`, { name: LIST_NAME });
    logger.info('ClickUp: list created', { folderId, name: LIST_NAME });
    return { id: data.id, name: data.name };
  }

  // ── Create tenant folder + list in one call ───────────────────────────────

  async createTenantResources(spaceId, tenantName) {
    const folder = await this.createFolder(spaceId, tenantName);
    const list   = await this.createList(folder.id);
    return { folder, list };
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  async createTask(listId, { title, actionPlan, dueDate, owner, category, severity }) {
    const description = [
      actionPlan ? `Action Plan:\n${actionPlan}`   : null,
      owner      ? `Owner: ${owner}`               : null,
      category   ? `Category: ${category}`         : null,
    ].filter(Boolean).join('\n\n');

    const body = {
      name:        title,
      description,
      priority:    PRIORITY_MAP[severity] || 3,
      due_date:    dueDate ? new Date(dueDate).getTime() : undefined,
      notify_all:  false,
    };

    const data = await this._req('POST', `/list/${listId}/task`, body);
    return { id: data.id, url: data.url };
  }

  async getTask(taskId) {
    const data = await this._req('GET', `/task/${taskId}`);
    return { id: data.id, status: data.status?.status || null, url: data.url };
  }

  // ── Validate API key ──────────────────────────────────────────────────────

  async validate() {
    try {
      const workspaces = await this.getWorkspaces();
      return { valid: true, workspaces };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }
}

module.exports = ClickUpClient;
