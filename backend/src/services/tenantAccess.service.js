const customerRepository          = require('../repositories/customer.repository');
const tenantAssignmentRepository  = require('../repositories/tenant-assignment.repository');
const logger = require('../utils/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// Phase-1: roles are super_admin and account_manager only.
// super_admin     → access all tenants
// account_manager → access any tenant they appear in via tenant_assignments
//                   (not just the primary / account_manager_id FK)

const tenantAccessService = {
  getAccessibleTenantIds: async (user) => {
    if (!user) return [];

    if (user.role === 'super_admin') {
      const all = await customerRepository.findAll();
      return all.map((c) => c.id);
    }

    if (user.role === 'account_manager') {
      const tenantIds = await tenantAssignmentRepository.findTenantIdsByUser(user.id);
      // Suspended / inactive tenants must not be accessible to AMs — load full records
      // so we can filter by status rather than returning every assigned tenant ID blindly.
      const tenants = await customerRepository.findByIds(tenantIds);
      return tenants.filter((t) => t.status === 'active').map((t) => t.id);
    }

    return [];
  },

  listAccessibleTenants: async (user) => {
    if (!user) return [];

    if (user.role === 'super_admin') {
      // Super admins see ALL tenants (including suspended) so they can manage them.
      return customerRepository.findAll();
    }

    if (user.role === 'account_manager') {
      const tenantIds = await tenantAssignmentRepository.findTenantIdsByUser(user.id);
      const tenants = await customerRepository.findByIds(tenantIds);
      // AMs only see active tenants — suspended/inactive tenants are hidden from their UI
      // and from the tenant selector dropdown.
      return tenants.filter((t) => t.status === 'active');
    }

    return [];
  },

  resolveTenantId: async (user, requestedTenantId) => {
    const accessible = await tenantAccessService.getAccessibleTenantIds(user);

    // Ignore tenant IDs that are not valid UUIDs (e.g. stale mock IDs in localStorage)
    const sanitized = requestedTenantId && isValidUuid(String(requestedTenantId))
      ? String(requestedTenantId)
      : null;

    if (!sanitized) {
      return accessible.length > 0 ? accessible[0] : null;
    }

    if (accessible.length > 0 && !accessible.includes(sanitized)) {
      logger.warn('Cross-tenant access blocked', { userEmail: user?.email, requestedTenantId });
      const err = new Error('Access denied to selected tenant');
      err.statusCode = 403;
      throw err;
    }

    return sanitized;
  },

  ensureTenantAccess: async (user, tenantId) => {
    if (!tenantId) {
      const err = new Error('tenantId is required');
      err.statusCode = 400;
      throw err;
    }
    const resolved = await tenantAccessService.resolveTenantId(user, tenantId);
    if (String(resolved) !== String(tenantId)) {
      const err = new Error('Access denied to selected tenant');
      err.statusCode = 403;
      throw err;
    }
    return resolved;
  },
};

module.exports = tenantAccessService;
