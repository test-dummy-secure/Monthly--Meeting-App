'use strict';

/**
 * Internal system identity for background jobs that call services which
 * require a user context (e.g. tenantAccessService.ensureTenantAccess).
 *
 * Role 'system' is intentionally not a valid user-facing role — it cannot be
 * issued via any authentication flow.  tenantAccessService.getAccessibleTenantIds
 * returns an empty array for this role, so resolveTenantId passes through any
 * explicitly-supplied tenantId without cross-checking against a user's allowed
 * list.  Cross-tenant isolation is therefore enforced by the caller passing the
 * correct tenantId, not by the access-check layer.
 *
 * Use ONLY for background jobs (T-48, post-meeting AI, overdue scanner) that
 * run with a known, system-supplied tenantId.
 */
const SYSTEM_ACTOR = Object.freeze({
  id:         null,
  email:      'system@bmmj.internal',
  role:       'system',
  first_name: 'System',
  last_name:  'Automation',
  tenant_id:  null,
});

module.exports = { SYSTEM_ACTOR };
