const express                      = require('express');
const router                       = express.Router();
const customerRepository           = require('../repositories/customer.repository');
const userRepository               = require('../repositories/user.repository');
const tenantAssignmentRepository   = require('../repositories/tenant-assignment.repository');
const auditLogRepository           = require('../repositories/audit-log.repository');
const auth                         = require('../middleware/auth.middleware');
const tenantAccessService          = require('../services/tenantAccess.service');
const { validate }                 = require('../middleware/validate');
const logger                       = require('../utils/logger');

// All customer routes require authentication (also applied at app.js level)
router.use(auth);

// ─── Tenant CRUD ─────────────────────────────────────────────────────────────

// GET /api/customers — list tenants accessible to the current user
router.get('/', async (req, res, next) => {
  try {
    const list = await tenantAccessService.listAccessibleTenants(req.user);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// POST /api/customers — create tenant (Super Admin only)
router.post('/', auth.requireRole(['super_admin']), validate('customerCreate'), async (req, res, next) => {
  try {
    const newCustomer = await customerRepository.create(req.body);
    await auditLogRepository.create(newCustomer.id, req.user.email, 'Customer Tenant Created', { name: newCustomer.name }, req.ip);
    res.status(201).json(newCustomer);
  } catch (err) {
    next(err);
  }
});

// PUT /api/customers/:id — full update (Super Admin only)
router.put('/:id', auth.requireRole(['super_admin']), validate('customerUpdate'), async (req, res, next) => {
  try {
    const updated = await customerRepository.update(req.params.id, req.body);
    await auditLogRepository.create(req.params.id, req.user.email, 'Customer Tenant Updated', req.body, req.ip);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/customers/:id/account-manager — reassign AM (Super Admin only)
// Body: { accountManagerId: "<uuid>" }  — pass null / empty string to unassign.
router.patch('/:id/account-manager', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const amId = req.body.accountManagerId || null;

    // Validate the UUID points to a real, active account_manager user.
    if (amId) {
      const am = await userRepository.findById(amId);
      if (!am || am.role !== 'account_manager') {
        return res.status(400).json({ error: 'Invalid account manager ID' });
      }
    }

    const updated = await customerRepository.update(req.params.id, { accountManagerId: amId });
    await auditLogRepository.create(
      req.params.id, req.user.email, 'Account Manager Reassigned', { accountManagerId: amId }, req.ip
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/customers/:id — delete tenant (Super Admin only)
router.delete('/:id', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    await customerRepository.delete(req.params.id);
    await auditLogRepository.create(req.params.id, req.user.email, 'Customer Tenant Deleted', { id: req.params.id }, req.ip);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ─── Account Manager management ──────────────────────────────────────────────
// All routes below are Super Admin only.
// Passwords are never returned in any response.

const mapAM = (u) => ({
  id:        u.id,
  email:     u.email,
  firstName: u.first_name,
  lastName:  u.last_name,
  name:      `${u.first_name || ''} ${u.last_name || ''}`.trim(),
  isActive:  u.is_active,
  createdAt: u.created_at,
  updatedAt: u.updated_at,
});

// GET /api/customers/account-managers — list all AMs (active + inactive)
// Must be defined before /:id routes to avoid param collision.
router.get('/account-managers', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const ams = await userRepository.findByRole('account_manager');
    res.json(ams.map(mapAM));
  } catch (err) {
    logger.error('Failed to list account managers', { error: err.message });
    next(err);
  }
});

// POST /api/customers/account-managers — create a new AM (Super Admin only)
router.post('/account-managers', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    if (!firstName || !String(firstName).trim()) return res.status(400).json({ error: 'firstName is required' });
    if (!lastName  || !String(lastName).trim())  return res.status(400).json({ error: 'lastName is required' });
    if (!email     || !String(email).trim())     return res.status(400).json({ error: 'email is required' });
    if (!password  || password.length < 8)       return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const user = await userRepository.createUser({
      email:     email.toLowerCase().trim(),
      password,
      firstName: String(firstName).trim(),
      lastName:  String(lastName).trim(),
      role:      'account_manager',
    });

    await auditLogRepository.create(
      null, req.user.email, 'Account Manager Created',
      { email: user.email, name: `${user.first_name} ${user.last_name}` }, req.ip
    ).catch(() => {});

    logger.info('Account manager created', { email: user.email, by: req.user.email });
    res.status(201).json(mapAM(user));
  } catch (err) {
    // Unique constraint on email
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    logger.error('Failed to create account manager', { error: err.message });
    next(err);
  }
});

// POST /api/customers/account-managers/:id/reset-password — Super Admin resets AM password
// Generates a cryptographically secure temporary password, emails it to the AM,
// and sets must_change_password=true so the AM is forced to change it on next login.
router.post('/account-managers/:id/reset-password', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const am = await userRepository.findById(req.params.id);
    if (!am || am.role !== 'account_manager') {
      return res.status(404).json({ error: 'Account manager not found' });
    }
    if (!am.is_active) {
      return res.status(400).json({ error: 'Cannot reset password for a deactivated account' });
    }

    // Generate a secure 12-char temp password: uppercase + lowercase + digits
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const bytes   = require('crypto').randomBytes(12);
    const tempPassword = Array.from(bytes).map((b) => charset[b % charset.length]).join('');

    const bcrypt = require('bcryptjs');
    const { config } = require('../config/index');
    const emailService = require('../services/email.service');

    const hash = await bcrypt.hash(tempPassword, config.bcryptRounds);

    // Update password — this also revokes all active sessions
    await userRepository.updatePassword(am.id, hash);

    // Force the AM to change on next login
    await userRepository.setMustChangePassword(am.id, true);

    // Email the temp password to the AM
    emailService.send({
      to:           am.email,
      subject:      'Your NxgSecure password has been reset',
      templateName: 'admin-password-reset',
      vars: {
        firstName:    am.first_name || 'there',
        tempPassword,
        resetBy:      `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email,
        loginUrl:     (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim() + '/login',
      },
    }).catch((err) =>
      logger.error('reset-password: email send failed', { userId: am.id, error: err.message })
    );

    await auditLogRepository.create(
      null, req.user.email, 'Account Manager Password Reset',
      { userId: am.id, email: am.email }, req.ip
    ).catch(() => {});

    logger.info('AM password reset by super admin', { amId: am.id, by: req.user.email });
    res.json({ ok: true, message: `Password reset email sent to ${am.email}` });

  } catch (err) {
    logger.error('Failed to reset AM password', { error: err.message, id: req.params.id });
    next(err);
  }
});

// PATCH /api/customers/account-managers/:id/status — activate or deactivate
router.patch('/account-managers/:id/status', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive (boolean) is required' });
    }

    // Prevent self-deactivation
    if (req.params.id === req.user.id && !isActive) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    const updated = await userRepository.setActiveStatus(req.params.id, isActive);
    if (!updated) return res.status(404).json({ error: 'Account manager not found' });

    // Deactivating — revoke all active sessions immediately
    if (!isActive) {
      await userRepository.revokeAllUserTokens(req.params.id);
      logger.info('AM deactivated and sessions revoked', { userId: req.params.id, by: req.user.email });
    }

    await auditLogRepository.create(
      null, req.user.email,
      isActive ? 'Account Manager Activated' : 'Account Manager Deactivated',
      { userId: req.params.id, email: updated.email }, req.ip
    ).catch(() => {});

    res.json(mapAM(updated));
  } catch (err) {
    logger.error('Failed to update AM status', { error: err.message, id: req.params.id });
    next(err);
  }
});

// ─── Multi-AM assignment management ──────────────────────────────────────────
// All routes below are Super Admin only.

// GET /api/customers/:id/assignments — list all AMs assigned to a tenant
router.get('/:id/assignments', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const assignments = await tenantAssignmentRepository.findByTenant(req.params.id);
    res.json(assignments);
  } catch (err) {
    next(err);
  }
});

// POST /api/customers/:id/assignments — add an AM to a tenant
// Body: { userId: "<uuid>", setPrimary?: boolean }
router.post('/:id/assignments', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const tenantId = req.params.id;
    const { userId, setPrimary = false } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const am = await userRepository.findById(userId);
    if (!am || am.role !== 'account_manager' || !am.is_active) {
      return res.status(400).json({ error: 'Invalid or inactive account manager' });
    }

    // Enforce max 3 AMs per tenant before adding.
    const existing = await tenantAssignmentRepository.findByTenant(tenantId);
    if (existing.length >= 3) {
      return res.status(400).json({ error: 'A tenant can have at most 3 account managers assigned.' });
    }

    await tenantAssignmentRepository.add(tenantId, userId, req.user.id);

    // If explicitly requested as primary, or if no primary exists yet, promote.
    const hasPrimary = existing.some((a) => a.isPrimary);
    if (setPrimary || !hasPrimary) {
      await tenantAssignmentRepository.setPrimary(tenantId, userId);
    }

    await auditLogRepository.create(
      tenantId, req.user.email, 'Account Manager Assigned',
      { userId, setPrimary: setPrimary || !hasPrimary }, req.ip
    ).catch(() => {});

    const assignments = await tenantAssignmentRepository.findByTenant(tenantId);
    res.status(201).json(assignments);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/customers/:id/assignments/:userId — remove an AM from a tenant
router.delete('/:id/assignments/:userId', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { id: tenantId, userId } = req.params;

    const assignments = await tenantAssignmentRepository.findByTenant(tenantId);
    const target = assignments.find((a) => a.userId === userId);
    if (!target) return res.status(404).json({ error: 'Assignment not found' });

    if (target.isPrimary && assignments.length > 1) {
      return res.status(400).json({
        error: 'Cannot remove the primary account manager while others are assigned. Set a different primary first.',
      });
    }

    await tenantAssignmentRepository.remove(tenantId, userId);

    // If the removed AM was primary and was the only one, clear the FK.
    if (target.isPrimary) {
      await tenantAssignmentRepository.clearPrimary(tenantId);
    }

    await auditLogRepository.create(
      tenantId, req.user.email, 'Account Manager Unassigned', { userId }, req.ip
    ).catch(() => {});

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// PATCH /api/customers/:id/assignments/:userId/primary — promote an AM to primary
router.patch('/:id/assignments/:userId/primary', auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { id: tenantId, userId } = req.params;

    const assigned = await tenantAssignmentRepository.isAssigned(tenantId, userId);
    if (!assigned) return res.status(404).json({ error: 'Assignment not found' });

    await tenantAssignmentRepository.setPrimary(tenantId, userId);

    await auditLogRepository.create(
      tenantId, req.user.email, 'Primary Account Manager Changed', { userId }, req.ip
    ).catch(() => {});

    const assignments = await tenantAssignmentRepository.findByTenant(tenantId);
    res.json(assignments);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
