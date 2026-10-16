const { randomUUID } = require('crypto');
const logger = require('../../utils/logger');

const TIMEOUT_MS       = 10_000; // 10 s per request
const MAX_RETRIES      = 3;
const RETRY_BASE_MS    = 1_000;  // 1 s, doubles each attempt

// ─── NXG360Client ─────────────────────────────────────────────────────────────
// Production HTTP client for the NXG360 MSSP REST API.
// Responsibilities:
//   - Bearer token authentication
//   - Per-request timeout via AbortController
//   - Exponential-backoff retry on 5xx / network failures
//   - Structured request/response logging (never logs the API key value)
//   - Classifies errors: unconfigured / timeout / 4xx / 5xx

class NXG360Client {
  constructor(apiKey) {
    if (!apiKey) throw new Error('NXG360Client: apiKey is required');
    this._apiKey  = apiKey;
    this._baseUrl = (process.env.NXG360_API_BASE_URL || '').replace(/\/+$/, '');
  }

  // ── Core request ─────────────────────────────────────────────────────────

  async request(method, path, body = null, attempt = 1, maxRetries = MAX_RETRIES) {
    if (!this._baseUrl) {
      throw Object.assign(
        new Error('NXG360 API base URL (NXG360_API_BASE_URL) is not configured'),
        { code: 'NXG360_UNCONFIGURED', statusCode: 503 }
      );
    }

    const url       = `${this._baseUrl}${path}`;
    const requestId = randomUUID();
    const ctrl      = new AbortController();
    const timer     = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    logger.info('NXG360 →', { requestId, method, path, attempt });

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type':  'application/json',
          'Accept':        'application/json',
          'Authorization': `Bearer ${this._apiKey}`,
          'X-Request-ID':  requestId,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: ctrl.signal,
      });

      const text = await res.text();
      let data;
      try   { data = JSON.parse(text); }
      catch { data = { message: text || `HTTP ${res.status}` }; }

      logger.info('NXG360 ←', { requestId, status: res.status, attempt });

      if (!res.ok) {
        const err = Object.assign(
          new Error(data?.message || `NXG360 HTTP ${res.status}`),
          { statusCode: res.status, code: 'NXG360_HTTP_ERROR', requestId }
        );
        throw err;
      }

      return data;

    } catch (err) {
      if (err.name === 'AbortError') {
        throw Object.assign(
          new Error('NXG360 request timed out after 10 s'),
          { code: 'NXG360_TIMEOUT', statusCode: 504 }
        );
      }

      // Retry only on network-level or 5xx errors — never on 4xx
      const is5xx       = err.statusCode >= 500;
      const isNetwork   = !err.statusCode;
      const shouldRetry = (is5xx || isNetwork) && attempt < maxRetries;

      if (shouldRetry) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn('NXG360 retry', { requestId, attempt, delay, error: err.message });
        await new Promise((r) => setTimeout(r, delay));
        return this.request(method, path, body, attempt + 1, maxRetries);
      }

      throw err;

    } finally {
      clearTimeout(timer);
    }
  }

  // ── Named API operations ──────────────────────────────────────────────────

  // Validates that the apiKey + nxg360TenantId combination is authentic.
  // Expected NXG360 response: { valid: true, tenantId: '...', status: 'active' }
  // Single attempt — user waits synchronously for this response.
  // No retries: fail fast (10 s max) rather than hanging for 30 s.
  async validateTenant(nxg360TenantId) {
    return this.request('POST', '/api/auth/validate', { tenantId: nxg360TenantId }, 1, 1);
  }

  // Fetches all current findings for a tenant from NXG360.
  // Expected NXG360 response: { findings: [...] } or an array directly.
  async getFindings(nxg360TenantId) {
    return this.request('GET', `/api/tenants/${encodeURIComponent(nxg360TenantId)}/findings`);
  }
}

module.exports = NXG360Client;
