const db     = require('../database/index');
const logger = require('../utils/logger');

const mapRow = (row) => ({
  id:            row.id,
  meetingId:     row.meeting_id,
  tenantId:      row.tenant_id,
  fileName:      row.file_name,
  originalName:  row.original_name,
  filePath:      row.file_path,
  fileSizeBytes: row.file_size_bytes,
  mimeType:      row.mime_type,
  sourceType:    row.source_type,
  uploadedBy:    row.uploaded_by,
  createdAt:     row.created_at,
});

const meetingFileRepository = {

  create: async ({ meetingId, tenantId, fileName, originalName, filePath,
                   fileSizeBytes, mimeType, sourceType, uploadedBy }) => {
    const { rows } = await db.query(
      `INSERT INTO meeting_files
         (meeting_id, tenant_id, file_name, original_name, file_path,
          file_size_bytes, mime_type, source_type, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [meetingId, tenantId, fileName, originalName, filePath,
       fileSizeBytes || null, mimeType || null,
       sourceType || 'manual_upload', uploadedBy || null]
    );
    logger.info('Meeting file record created', { id: rows[0].id, meetingId, tenantId });
    return mapRow(rows[0]);
  },

  findByMeeting: async (meetingId, tenantId = null) => {
    const base = `SELECT * FROM meeting_files WHERE meeting_id = $1`;
    const { rows } = tenantId
      ? await db.query(`${base} AND tenant_id = $2 ORDER BY created_at DESC`, [meetingId, tenantId])
      : await db.query(`${base} ORDER BY created_at DESC`, [meetingId]);
    return rows.map(mapRow);
  },

  findById: async (id) => {
    const { rows } = await db.query(`SELECT * FROM meeting_files WHERE id = $1 LIMIT 1`, [id]);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  deleteById: async (id) => {
    const { rows } = await db.query(`DELETE FROM meeting_files WHERE id = $1 RETURNING *`, [id]);
    return rows[0] ? mapRow(rows[0]) : null;
  },
};

module.exports = meetingFileRepository;
