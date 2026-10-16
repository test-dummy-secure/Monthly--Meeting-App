'use strict';

const FindingsService = require('../services/findingsService');
const logger = require('../utils/logger');

// Resolve which tenantId to scope to.
// super_admin: optional ?tenantId filter; null means all tenants.
// account_manager: tenantId is required (from query param or JWT).
function resolveTenantScope(req) {
  const isSuperAdmin = req.user.role === 'super_admin';
  const tenantId = req.query.tenantId || req.user.tenant_id || null;
  if (!isSuperAdmin && !tenantId) {
    return { tenantId: null, error: 'tenantId query parameter is required' };
  }
  return { tenantId: isSuperAdmin ? (tenantId || null) : tenantId, error: null };
}

async function getAllFindings(req, res, next) {
  const { tenantId, error } = resolveTenantScope(req);
  if (error) return res.status(400).json({ error });
  try {
    const findings = await FindingsService.getAllFindings({ tenantId });
    res.json(findings);
  } catch (err) {
    logger.error('Error listing findings', { error: err.message, stack: err.stack });
    next(err);
  }
}

async function getFindingById(req, res, next) {
  const { tenantId, error } = resolveTenantScope(req);
  if (error) return res.status(400).json({ error });
  try {
    const finding = await FindingsService.getFindingById(req.params.id, { tenantId });
    if (!finding) return res.status(404).json({ error: 'Finding not found' });
    res.json(finding);
  } catch (err) {
    logger.error('Error getting finding', { error: err.message, stack: err.stack });
    next(err);
  }
}

async function getAITasksForFinding(req, res, next) {
  const { tenantId, error } = resolveTenantScope(req);
  if (error) return res.status(400).json({ error });
  try {
    const tasks = await FindingsService.getAITasksForFinding(req.params.id, { tenantId });
    if (tasks === null) return res.status(404).json({ error: 'Finding not found' });
    res.json(tasks);
  } catch (err) {
    logger.error('Error getting AI tasks for finding', { error: err.message, stack: err.stack });
    next(err);
  }
}

module.exports = { getAllFindings, getFindingById, getAITasksForFinding };
