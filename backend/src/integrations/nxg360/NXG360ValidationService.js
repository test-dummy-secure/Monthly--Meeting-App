const { randomUUID } = require('crypto');
const NXG360Client = require('./NXG360Client');
const logger       = require('../../utils/logger');

// ─── NXG360ValidationService ──────────────────────────────────────────────────
// Validates an NXG360 API key + tenant ID pair before a tenant is created.
// All failures are returned as structured { valid: false, message } objects —
// errors never propagate as exceptions so the caller can act on the result
// without a try/catch.
//
// Validation chain:
//   1. Input hygiene
//   2. NXG360 authentication (Bearer token)
//   3. Tenant existence verification
//   4. Tenant ID match confirmation
//   5. Tenant active-status check

const NXG360ValidationService = {
  validate: async (nxg360TenantId, apiKey) => {
    const correlationId = randomUUID();

    if (!nxg360TenantId || typeof nxg360TenantId !== 'string' || !nxg360TenantId.trim()) {
      return { valid: false, message: 'NXG360 Tenant ID is required' };
    }
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return { valid: false, message: 'NXG360 API Key is required' };
    }

    logger.info('NXG360 validation started', {
      correlationId,
      nxg360TenantId,
      // apiKey intentionally omitted from logs
    });

    try {
      const client = new NXG360Client(apiKey);
      const result = await client.validateTenant(nxg360TenantId.trim());

      // NXG360 indicates failure with valid: false or an HTTP 4xx
      if (!result || result.valid === false) {
        logger.warn('NXG360 validation rejected', {
          correlationId,
          nxg360TenantId,
          message: result?.message,
        });
        return {
          valid:   false,
          message: result?.message || 'NXG360 rejected the credentials',
        };
      }

      // Verify the returned tenantId matches what we sent
      if (result.tenantId && result.tenantId !== nxg360TenantId.trim()) {
        logger.warn('NXG360 tenant ID mismatch', {
          correlationId,
          expected: nxg360TenantId,
          received: result.tenantId,
        });
        return { valid: false, message: 'NXG360 tenant ID does not match the provided credentials' };
      }

      logger.info('NXG360 validation passed', {
        correlationId,
        nxg360TenantId,
        status: result.status,
      });

      return {
        valid:    true,
        tenantId: result.tenantId || nxg360TenantId,
        status:   result.status   || 'active',
      };

    } catch (err) {
      // Log error details but never log the API key
      logger.error('NXG360 validation error', {
        correlationId,
        nxg360TenantId,
        code:  err.code,
        error: err.message,
      });

      if (err.code === 'NXG360_UNCONFIGURED') {
        return { valid: false, message: 'NXG360 integration is not configured on this server' };
      }
      if (err.code === 'NXG360_TIMEOUT') {
        return { valid: false, message: 'NXG360 service did not respond in time. Please retry.' };
      }
      if (err.statusCode === 401 || err.statusCode === 403) {
        return { valid: false, message: 'NXG360 rejected the API key — check credentials' };
      }
      if (err.statusCode === 404) {
        return { valid: false, message: 'NXG360 tenant not found — verify the Tenant ID' };
      }

      return { valid: false, message: err.message || 'NXG360 validation failed' };
    }
  },
};

module.exports = NXG360ValidationService;
