'use strict';

const { randomUUID } = require('crypto');
const AIProvider = require('./AIProvider');
const logger = require('../../utils/logger');

const MAX_RETRIES   = 2;
const RETRY_BASE_MS = 1_000;

const baseUrl   = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const apiKey    = () => process.env.OPENAI_API_KEY || '';
const envModel  = () => process.env.OPENAI_MODEL || 'gpt-5';
// Cloud API — no local model-load stalls, so a much shorter timeout than Ollama's is safe.
const timeoutMs = () => parseInt(process.env.OPENAI_TIMEOUT || '120000', 10);

class OpenAIProvider extends AIProvider {
  /**
   * @param {object} [opts]
   * @param {string} [opts.model] - Override model; falls back to OPENAI_MODEL env var.
   */
  constructor(opts = {}) {
    super();
    this._model = opts.model || null;
  }

  get name() { return `openai:${this._model || envModel()}`; }

  _modelName() { return this._model || envModel(); }

  async generate(prompt, options = {}) {
    if (!apiKey()) {
      throw Object.assign(
        new Error('OPENAI_API_KEY is not configured. Set OPENAI_API_KEY in backend/.env'),
        { code: 'OPENAI_UNCONFIGURED', statusCode: 503 }
      );
    }
    return this._request(prompt, options, 1, randomUUID());
  }

  async _request(prompt, options, attempt, requestId) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs());

    logger.info('OpenAI →', { requestId, model: this._modelName(), attempt });

    try {
      const body = {
        model:       this._modelName(),
        messages:    [{ role: 'user', content: prompt }],
        temperature: options.temperature ?? 0.3,
        max_tokens:  options.maxTokens   ?? 3072,
      };
      // Mirrors Ollama's format:'json' contract used for single-item calls — batch
      // calls pass jsonFormat:false and get free-form text back, same as Ollama's path.
      if (options.jsonFormat !== false) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch(`${baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey()}`,
          'X-Request-ID':  requestId,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      const text = await res.text();
      logger.info('OpenAI ←', { requestId, status: res.status, attempt });

      if (!res.ok) {
        let msg;
        try   { msg = JSON.parse(text)?.error?.message || `OpenAI HTTP ${res.status}`; }
        catch { msg = `OpenAI HTTP ${res.status}`; }
        throw Object.assign(new Error(msg), { statusCode: res.status, code: 'OPENAI_HTTP_ERROR' });
      }

      let outer;
      try   { outer = JSON.parse(text); }
      catch { throw Object.assign(new Error('OpenAI returned non-JSON body'), { code: 'OPENAI_PARSE_ERROR' }); }

      const responseText = outer?.choices?.[0]?.message?.content;
      if (!responseText) {
        throw Object.assign(new Error('OpenAI response had no message content'), { code: 'OPENAI_EMPTY_RESPONSE', statusCode: 502 });
      }
      return responseText;

    } catch (err) {
      if (err.name === 'AbortError') {
        throw Object.assign(
          new Error(`OpenAI request timed out after ${Math.round(timeoutMs() / 1000)}s`),
          { code: 'OPENAI_TIMEOUT', statusCode: 504 }
        );
      }

      // Retry on server errors, rate-limits (429), and raw network failures.
      const isRetryable = err.statusCode >= 500 || err.statusCode === 429 || !err.statusCode;
      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn('OpenAI retry', { requestId, attempt, delay, error: err.message });
        await new Promise((r) => setTimeout(r, delay));
        return this._request(prompt, options, attempt + 1, requestId);
      }

      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = OpenAIProvider;
