const express                  = require('express');
const router                   = express.Router();
const actionItemService        = require('../services/actionItem.service');
const actionPointsEmailService = require('../services/actionPointsEmail.service');
const taskRepository           = require('../repositories/task.repository');
const tenantMiddleware         = require('../middleware/tenant.middleware');
const db                       = require('../database/index');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use(tenantMiddleware);

// GET /api/action-items/stats — aggregate counts by status and owner type
router.get('/stats', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
    const stats = await actionItemService.getStats(tenantId, req.user);
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /api/action-items/weekly-report — generate (and persist) a weekly monitoring snapshot
router.get('/weekly-report', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
    const { meetingId } = req.query;
    const actorName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email;
    const result = await actionItemService.generateWeeklyReport(tenantId, meetingId || null, actorName, req.user);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/action-items — list with optional filters
// query: status, ownerType, meetingId, search, page, pageSize
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
    const { status, ownerType, meetingId, search, page, pageSize } = req.query;
    const result = await actionItemService.list(tenantId, req.user, {
      status:    status    || undefined,
      ownerType: ownerType || undefined,
      meetingId: meetingId || undefined,
      search:    search    || undefined,
      page:      page      ? parseInt(page,     10) : 1,
      pageSize:  pageSize  ? parseInt(pageSize, 10) : 50,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/action-items/send-email
// Sends approved post-meeting action points as a PDF attachment to one or more
// customer email addresses. Each task in the PDF has a unique "Mark as Completed"
// confirmation link (30-day expiry) that notifies the AM when clicked.
router.post('/send-email', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });

    const { meetingId, emails } = req.body;

    if (!meetingId)
      return res.status(400).json({ error: 'meetingId is required' });
    if (!Array.isArray(emails) || emails.length === 0)
      return res.status(400).json({ error: 'emails must be a non-empty array' });
    if (emails.length > 10)
      return res.status(400).json({ error: 'Maximum 10 recipients per send' });

    const invalid = emails.filter((e) => typeof e !== 'string' || !EMAIL_RE.test(e.trim()));
    if (invalid.length)
      return res.status(400).json({ error: `Invalid email address(es): ${invalid.join(', ')}` });

    const result = await actionPointsEmailService.sendActionPoints({
      tenantId,
      meetingId,
      emails,
      user: req.user,
    });

    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/action-items — create a new action item (always AM-approved on creation)
router.post('/', async (req, res, next) => {
  try {
    const tenantId = req.tenantId || req.body.tenantId;
    if (!tenantId)        return res.status(400).json({ error: 'tenantId is required' });
    if (!req.body.meetingId) return res.status(400).json({ error: 'meetingId is required' });
    if (!req.body.title)     return res.status(400).json({ error: 'title is required' });

    const task = await actionItemService.create({ ...req.body, tenantId }, req.user);
    res.status(201).json(task);
  } catch (err) { next(err); }
});

// GET /api/action-items/:id — get single action item
router.get('/:id', async (req, res, next) => {
  try {
    const task = await actionItemService.getById(req.params.id, req.user);
    res.json(task);
  } catch (err) { next(err); }
});

// PUT /api/action-items/:id — update fields (status, priority, owner, due date, notes…)
router.put('/:id', async (req, res, next) => {
  try {
    const task = await actionItemService.update(req.params.id, req.body, req.user);
    res.json(task);
  } catch (err) { next(err); }
});

// POST /api/action-items/:id/escalate — escalate with AM-provided reason (mandatory)
router.post('/:id/escalate', async (req, res, next) => {
  try {
    const { reason, blockerType, escalatedTo } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const result = await actionItemService.escalate(
      req.params.id, { reason, blockerType, escalatedTo }, req.user
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/action-items/:id/resolve-escalation — close an escalation and return task to in_progress
router.post('/:id/resolve-escalation', async (req, res, next) => {
  try {
    const { resolutionNote } = req.body;
    const result = await actionItemService.resolveEscalation(
      req.params.id, { resolutionNote }, req.user
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/action-items/:id/carry-forward — manually carry forward a single task
router.post('/:id/carry-forward', async (req, res, next) => {
  try {
    const task = await taskRepository.findById(req.params.id, req.tenantId);
    if (!task) return res.status(404).json({ error: 'Action item not found' });

    const actorName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email;

    // Guard: only CF tasks that are still open / active
    if (['completed', 'closed', 'cancelled', 'escalated'].includes(task.remediationStatus)) {
      return res.status(409).json({
        error: `Cannot carry forward a task with status '${task.remediationStatus}'.`,
      });
    }

    // Increment counter, auto-escalate if carry_forward_count reaches 3
    const { rows: cfRows } = await db.query(
      `UPDATE tasks
       SET    carry_forward_count = carry_forward_count + 1,
              remediation_status  = CASE
                WHEN (carry_forward_count + 1) >= 3 THEN 'escalated'
                ELSE 'carry_forward'
              END,
              escalation_status   = CASE
                WHEN (carry_forward_count + 1) >= 3 AND escalation_status != 'escalated'
                THEN 'escalated'
                ELSE escalation_status
              END,
              review_outcome      = CASE
                WHEN (carry_forward_count + 1) >= 3 THEN 'escalation_required'
                ELSE review_outcome
              END,
              escalation_count    = CASE
                WHEN (carry_forward_count + 1) >= 3 THEN escalation_count + 1
                ELSE escalation_count
              END,
              last_updated_at     = NOW()
       WHERE  id = $1
         AND  remediation_status NOT IN ('completed','closed','cancelled','escalated')
       RETURNING carry_forward_count, remediation_status`,
      [req.params.id]
    );
    if (!cfRows.length) {
      return res.status(409).json({ error: 'Task is not eligible for carry-forward.' });
    }
    const isAutoEscalated = cfRows[0]?.remediation_status === 'escalated';
    await taskRepository.appendTimelineEvent(req.params.id, {
      id:    `evt-${Date.now()}`,
      date:  new Date().toISOString(),
      event: isAutoEscalated
        ? `Carried forward and auto-escalated (3× limit reached) by ${actorName}`
        : `Manually carried forward by ${actorName}`,
      actor: actorName,
      type:  isAutoEscalated ? 'escalation' : 'carry_forward',
    });

    const updated = await taskRepository.findById(req.params.id);
    res.json(updated);
  } catch (err) { next(err); }
});

module.exports = router;
