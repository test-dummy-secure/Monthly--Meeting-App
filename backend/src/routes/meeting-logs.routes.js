const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const multer    = require('multer');
const router    = express.Router();

const JourneyService        = require('../services/journey.service');
const MeetingNotesService   = require('../services/meetingNotes.service');
const meetingRepository     = require('../repositories/meeting.repository');
const meetingLogRepository  = require('../repositories/meeting-log.repository');
const meetingFileRepository = require('../repositories/meeting-file.repository');
const auth          = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const logger        = require('../utils/logger');

router.use(auth, tenantMiddleware);

// ── Multer configuration ───────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const UPLOAD_BASE = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_BASE, req.tenantId || 'unknown', req.params.meetingId || 'unknown');
    try {
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const uuid = crypto.randomUUID();
    cb(null, `${uuid}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error('Only PDF, DOCX, and TXT files are allowed'), { statusCode: 400 }), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize:      MAX_FILE_SIZE,
    fieldNameSize: 100,   // mitigates deeply-nested field-name DoS (GHSA-72gw-mp4g-v24j)
    fields:        5,
    files:         1,
    parts:         10,
  },
});

// ── GET / — list meeting logs ──────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const logs = await JourneyService.listMeetingLogs({
      user:     req.user,
      tenantId: req.tenantId,
      page:     parseInteger(req.query.page,     1),
      pageSize: Math.min(parseInteger(req.query.pageSize, 20), 100),
    });
    res.json(logs);
  } catch (error) {
    logger.error('Meeting logs list failed', { error: error.message });
    next(error);
  }
});

// ── POST /:meetingId — save / upsert meeting notes ─────────────────────────
router.post('/:meetingId', async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    const tenantId      = req.tenantId;

    const meeting = await meetingRepository.findById(meetingId, tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const { sourceType = 'manual_entry', summary, meetingSummary, actionItems,
            followUpActions, decisionsTaken, risksDiscussed, transcriptText } = req.body;

    const notes = await MeetingNotesService.processNotes(sourceType, meetingId, tenantId, {
      summary, meetingSummary, actionItems, followUpActions,
      decisionsTaken, risksDiscussed, transcriptText,
    });

    res.json(notes);
  } catch (error) {
    logger.error('Save meeting notes failed', { error: error.message });
    next(error);
  }
});

// ── POST /:meetingId/upload — upload MOM file ──────────────────────────────
router.post('/:meetingId/upload', upload.single('file'), async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    const tenantId      = req.tenantId;

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const meeting = await meetingRepository.findById(meetingId, tenantId);
    if (!meeting) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const result = await MeetingNotesService.processUpload(
      meetingId, tenantId, req.file, req.user.email
    );

    res.status(201).json(result);
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    logger.error('MOM upload failed', { error: error.message });
    next(error);
  }
});

// ── GET /:meetingId/files — list uploaded files ────────────────────────────
router.get('/:meetingId/files', async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    const tenantId      = req.tenantId;

    const meeting = await meetingRepository.findById(meetingId, tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const files = await meetingFileRepository.findByMeeting(meetingId, tenantId);
    res.json({ files });
  } catch (error) {
    logger.error('List meeting files failed', { error: error.message });
    next(error);
  }
});

// ── GET /:meetingId/files/:fileId — download file ─────────────────────────
router.get('/:meetingId/files/:fileId', async (req, res, next) => {
  try {
    const { meetingId, fileId } = req.params;
    const tenantId = req.tenantId;

    const file = await meetingFileRepository.findById(fileId);
    if (!file) return res.status(404).json({ error: 'File not found' });

    // Tenant isolation: reject if file belongs to a different tenant
    if (file.tenantId !== tenantId && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (file.meetingId !== meetingId) {
      return res.status(404).json({ error: 'File not found for this meeting' });
    }

    if (!fs.existsSync(file.filePath)) {
      return res.status(404).json({ error: 'File no longer exists on disk' });
    }

    res.setHeader('Content-Type',        file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    if (file.fileSizeBytes) res.setHeader('Content-Length', file.fileSizeBytes);

    fs.createReadStream(file.filePath).pipe(res);
  } catch (error) {
    logger.error('File download failed', { error: error.message });
    next(error);
  }
});

// ── PATCH /:meetingId/notes — direct MoM field update, no AI trigger ─────────
router.patch('/:meetingId/notes', async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    const tenantId = req.tenantId;

    const meeting = await meetingRepository.findById(meetingId, tenantId);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const { meetingSummary, summary, actionItems, followUpActions, decisionsTaken, risksDiscussed } = req.body;

    const toArray = (v, field) => {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v)) throw Object.assign(new Error(`${field} must be an array`), { statusCode: 400 });
      return v.map(String);
    };

    const patchedNotes = await meetingLogRepository.patchNotes(meetingId, {
      meetingSummary: meetingSummary ?? summary ?? null,
      actionItems:     toArray(actionItems,     'actionItems'),
      followUpActions: toArray(followUpActions, 'followUpActions'),
      decisionsTaken:  toArray(decisionsTaken,  'decisionsTaken'),
      risksDiscussed:  toArray(risksDiscussed,  'risksDiscussed'),
    });

    if (!patchedNotes) {
      return res.status(404).json({ error: 'Meeting notes not found — submit notes first before editing.' });
    }

    res.json(patchedNotes);
  } catch (error) {
    logger.error('Patch meeting notes failed', { error: error.message });
    next(error);
  }
});

// ── POST /:meetingId/reanalyze — re-run post-meeting AI with existing notes ─
router.post('/:meetingId/reanalyze', async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    const { model } = req.body;
    const result = await MeetingNotesService.reanalyze(meetingId, req.tenantId, model || undefined);
    res.json(result);
  } catch (error) {
    logger.error('Re-analyze failed', { error: error.message });
    next(error);
  }
});

// ── GET /:meetingId — get meeting log by meeting id ────────────────────────
router.get('/:meetingId', async (req, res, next) => {
  try {
    const log = await JourneyService.getMeetingLogById({
      user:      req.user,
      meetingId: req.params.meetingId,
    });
    if (!log) return res.status(404).json({ error: 'Meeting log not found' });
    res.json(log);
  } catch (error) {
    logger.error('Meeting log detail failed', { error: error.message });
    next(error);
  }
});

module.exports = router;

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
