'use strict';

const db = require('../config/db');

const clickupConnectionRepository = {

  async get() {
    const { rows } = await db.query(
      `SELECT id, api_key_enc, workspace_id, workspace_name,
              space_id, space_name, status, sync_metadata,
              created_at, updated_at
       FROM   clickup_connections
       LIMIT  1`
    );
    return rows[0] || null;
  },

  async upsert({ apiKeyEnc, workspaceId, workspaceName, spaceId, spaceName, syncMetadata = {} }) {
    const { rows } = await db.query(
      `INSERT INTO clickup_connections
         (api_key_enc, workspace_id, workspace_name, space_id, space_name, status, sync_metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'connected', $6, NOW())
       ON CONFLICT (id) DO UPDATE
         SET api_key_enc    = EXCLUDED.api_key_enc,
             workspace_id   = EXCLUDED.workspace_id,
             workspace_name = EXCLUDED.workspace_name,
             space_id       = EXCLUDED.space_id,
             space_name     = EXCLUDED.space_name,
             status         = 'connected',
             sync_metadata  = EXCLUDED.sync_metadata,
             updated_at     = NOW()
       RETURNING *`,
      [apiKeyEnc, workspaceId, workspaceName, spaceId, spaceName, JSON.stringify(syncMetadata)]
    );

    if (rows.length > 0) return rows[0];

    // No existing row — plain INSERT
    const ins = await db.query(
      `INSERT INTO clickup_connections
         (api_key_enc, workspace_id, workspace_name, space_id, space_name, status, sync_metadata)
       VALUES ($1, $2, $3, $4, $5, 'connected', $6)
       RETURNING *`,
      [apiKeyEnc, workspaceId, workspaceName, spaceId, spaceName, JSON.stringify(syncMetadata)]
    );
    return ins.rows[0];
  },

  async save({ apiKeyEnc, workspaceId, workspaceName, spaceId, spaceName, syncMetadata = {} }) {
    await db.query(`DELETE FROM clickup_connections`);
    const { rows } = await db.query(
      `INSERT INTO clickup_connections
         (api_key_enc, workspace_id, workspace_name, space_id, space_name, status, sync_metadata)
       VALUES ($1, $2, $3, $4, $5, 'connected', $6)
       RETURNING *`,
      [apiKeyEnc, workspaceId, workspaceName, spaceId, spaceName, JSON.stringify(syncMetadata)]
    );
    return rows[0];
  },

  async delete() {
    await db.query(`DELETE FROM clickup_connections`);
  },

  async getFolderMapping(tenantId) {
    const { rows } = await db.query(
      `SELECT id, tenant_id, folder_id, folder_name, list_id, list_name, created_at
       FROM   clickup_folder_mappings
       WHERE  tenant_id = $1`,
      [tenantId]
    );
    return rows[0] || null;
  },

  async upsertFolderMapping({ tenantId, folderId, folderName, listId, listName }) {
    const { rows } = await db.query(
      `INSERT INTO clickup_folder_mappings
         (tenant_id, folder_id, folder_name, list_id, list_name, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (tenant_id) DO UPDATE
         SET folder_id   = EXCLUDED.folder_id,
             folder_name = EXCLUDED.folder_name,
             list_id     = EXCLUDED.list_id,
             list_name   = EXCLUDED.list_name,
             updated_at  = NOW()
       RETURNING *`,
      [tenantId, folderId, folderName, listId, listName]
    );
    return rows[0];
  },

  async deleteFolderMapping(tenantId) {
    await db.query(
      `DELETE FROM clickup_folder_mappings WHERE tenant_id = $1`,
      [tenantId]
    );
  },

  async getAllFolderMappings() {
    const { rows } = await db.query(
      `SELECT cfm.*, c.name AS tenant_name
       FROM   clickup_folder_mappings cfm
       JOIN   customers c ON c.id = cfm.tenant_id
       ORDER  BY c.name`
    );
    return rows;
  },
};

module.exports = clickupConnectionRepository;
