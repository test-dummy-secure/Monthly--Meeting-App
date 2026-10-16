'use strict';

const { randomUUID } = require('crypto');
const AIProvider = require('./AIProvider');
const logger = require('../../utils/logger');

const MAX_RETRIES   = 2;
const RETRY_BASE_MS = 1_000;

const baseUrl    = () => (process.env.OLLAMA_BASE_URL || '').replace(/\/+$/, '');
const envModel   = () => process.env.OLLAMA_MODEL || 'llama3.1';
const timeoutMs  = () => parseInt(process.env.OLLAMA_TIMEOUT  || '600000', 10);
// Smaller context window = less KV-cache overhead = significantly faster generation.
// 4096 is enough for any post-meeting prompt + full JSON output.
const numCtx     = () => parseInt(process.env.OLLAMA_NUM_CTX  || '4096',   10);

class OllamaProvider extends AIProvider {
  /**
   * @param {object} [opts]
   * @param {string} [opts.model] - Override model; falls back to OLLAMA_MODEL env var.
   */
  constructor(opts = {}) {
    super();
    this._model = opts.model || null;
  }

  get name() { return `ollama:${this._model || envModel()}`; }

  _modelName() { return this._model || envModel(); }

  async generate(prompt, options = {}) {
    if (!baseUrl()) {
      throw Object.assign(
        new Error('OLLAMA_BASE_URL is not configured. Set OLLAMA_BASE_URL in backend/.env'),
        { code: 'OLLAMA_UNCONFIGURED', statusCode: 503 }
      );
    }
    return this._request(prompt, options, 1, randomUUID());
  }

  async _request(prompt, options, attempt, requestId) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs());

    logger.info('Ollama →', { requestId, model: this._modelName(), attempt });

    try {
      const res = await fetch(`${baseUrl()}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
        body: JSON.stringify({
          model:  this._modelName(),
          prompt,
          stream: false,
          // Reasoning-capable models (Nemotron, DeepSeek-R1, Qwen3, GLM-4, ...) emit
          // their full chain-of-thought as visible output by default — silently eating
          // the maxTokens budget before ever reaching the actual answer, which is why
          // a tightly-budgeted call (e.g. the ~350-token meeting-context extraction)
          // can come back with no usable JSON at all even though the model "responded".
          // think:false is a documented Ollama request field that suppresses the
          // reasoning trace for models that support it, and is safely ignored by
          // models that don't (llama3.1 and friends) — safe to send unconditionally.
          think: options.think ?? false,
          // format:'json' forces llama3.2 to produce a single object rather than an array.
          // Only use it for single-item (generateOne) calls. Batch calls pass jsonFormat:false.
          ...(options.jsonFormat !== false ? { format: 'json' } : {}),
          options: {
            temperature: options.temperature  ?? 0.3,
            num_predict: options.maxTokens    ?? 3072,
            // Use a larger context window for batch generation (prompt + output may exceed 8192).
            num_ctx:     options.numCtx       ?? numCtx(),
          },
        }),
        signal: ctrl.signal,
      });

      const text = await res.text();
      logger.info('Ollama ←', { requestId, status: res.status, attempt });

      if (!res.ok) {
        let msg;
        try   { msg = JSON.parse(text)?.error || `Ollama HTTP ${res.status}`; }
        catch { msg = `Ollama HTTP ${res.status}`; }
        throw Object.assign(new Error(msg), { statusCode: res.status, code: 'OLLAMA_HTTP_ERROR' });
      }

      let outer;
      try   { outer = JSON.parse(text); }
      catch { throw Object.assign(new Error('Ollama returned non-JSON outer body'), { code: 'OLLAMA_PARSE_ERROR' }); }

      // Non-streaming Ollama wraps the model output in outer.response (string).
      const responseText = outer.response
        || (outer.message && outer.message.content)
        || text;

      return responseText;

    } catch (err) {
      if (err.name === 'AbortError') {
        throw Object.assign(
          new Error(`Ollama request timed out after ${Math.round(timeoutMs() / 1000)}s`),
          { code: 'OLLAMA_TIMEOUT', statusCode: 504 }
        );
      }

      const is5xx     = err.statusCode >= 500;
      const isNetwork = !err.statusCode;
      if ((is5xx || isNetwork) && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn('Ollama retry', { requestId, attempt, delay, error: err.message });
        await new Promise((r) => setTimeout(r, delay));
        return this._request(prompt, options, attempt + 1, requestId);
      }

      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = OllamaProvider;
