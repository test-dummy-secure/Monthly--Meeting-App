'use strict';

const { randomUUID } = require('crypto');
const AIProvider = require('./AIProvider');
const logger = require('../../utils/logger');

const MAX_RETRIES   = 2;
const RETRY_BASE_MS = 1_000;

const baseUrl        = () => (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
const apiKey          = () => process.env.ANTHROPIC_API_KEY || '';
const envModel        = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';
// Cloud API — no local model-load stalls, so a much shorter timeout than Ollama's is safe.
const timeoutMs       = () => parseInt(process.env.ANTHROPIC_TIMEOUT || '120000', 10);

class ClaudeProvider extends AIProvider {
  /**
   * @param {object} [opts]
   * @param {string} [opts.model] - Override model; falls back to ANTHROPIC_MODEL env var.
   */
  constructor(opts = {}) {
    super();
    this._model = opts.model || null;
  }

  get name() { return `claude:${this._model || envModel()}`; }

  _modelName() { return this._model || envModel(); }

  async generate(prompt, options = {}) {
    if (!apiKey()) {
      throw Object.assign(
        new Error('ANTHROPIC_API_KEY is not configured. Set ANTHROPIC_API_KEY in backend/.env'),
        { code: 'ANTHROPIC_UNCONFIGURED', statusCode: 503 }
      );
    }
    return this._request(prompt, options, 1, randomUUID());
  }

  async _request(prompt, options, attempt, requestId) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs());

    logger.info('Claude →', { requestId, model: this._modelName(), attempt });

    try {
      // The Messages API has no forced-JSON response_format like OpenAI — the app's
      // own extractJson() (backward brace-matching) already handles free-form text
      // with JSON embedded in it, so this is fine as-is for both single-item and
      // batch calls; jsonFormat is accepted for interface parity but unused here.
      const body = {
        model:       this._modelName(),
        max_tokens:  options.maxTokens   ?? 3072,
        temperature: options.temperature ?? 0.3,
        messages:    [{ role: 'user', content: prompt }],
      };

      const res = await fetch(`${baseUrl()}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey(),
          'anthropic-version': ANTHROPIC_VERSION,
          'X-Request-ID':      requestId,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      const text = await res.text();
      logger.info('Claude ←', { requestId, status: res.status, attempt });

      if (!res.ok) {
        let msg;
        try   { msg = JSON.parse(text)?.error?.message || `Claude HTTP ${res.status}`; }
        catch { msg = `Claude HTTP ${res.status}`; }
        throw Object.assign(new Error(msg), { statusCode: res.status, code: 'ANTHROPIC_HTTP_ERROR' });
      }

      let outer;
      try   { outer = JSON.parse(text); }
      catch { throw Object.assign(new Error('Claude returned non-JSON body'), { code: 'ANTHROPIC_PARSE_ERROR' }); }

      // Messages API returns content as an array of blocks — text blocks carry .text.
      const responseText = Array.isArray(outer?.content)
        ? outer.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
        : '';
      if (!responseText) {
        throw Object.assign(new Error('Claude response had no text content'), { code: 'ANTHROPIC_EMPTY_RESPONSE', statusCode: 502 });
      }
      return responseText;

    } catch (err) {
      if (err.name === 'AbortError') {
        throw Object.assign(
          new Error(`Claude request timed out after ${Math.round(timeoutMs() / 1000)}s`),
          { code: 'ANTHROPIC_TIMEOUT', statusCode: 504 }
        );
      }

      // Retry on server errors, rate-limits (429), and raw network failures.
      const isRetryable = err.statusCode >= 500 || err.statusCode === 429 || !err.statusCode;
      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn('Claude retry', { requestId, attempt, delay, error: err.message });
        await new Promise((r) => setTimeout(r, delay));
        return this._request(prompt, options, attempt + 1, requestId);
      }

      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = ClaudeProvider;
