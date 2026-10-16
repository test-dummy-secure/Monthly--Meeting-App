'use strict';

const RecommendationValidator = require('./RecommendationValidator');
const logger = require('../../utils/logger');

// ── Token budget guard ────────────────────────────────────────────────────────
// Rough heuristic: 1 token ≈ 4 chars for English text.
// Default budget: 6 000 tokens → 24 000 chars. Override via AI_MAX_PROMPT_CHARS.
const MAX_PROMPT_CHARS = parseInt(process.env.AI_MAX_PROMPT_CHARS || '24000', 10);

function applyTokenBudget(prompt, correlationId) {
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;

  // Split just before the JSON schema example so the output instructions are always preserved.
  // Markers ordered by preference — first match wins.
  const CUT_MARKERS = ['OUTPUT RULE:', 'REQUIRED OUTPUT:', 'OUTPUT —'];
  const markerIdx   = CUT_MARKERS.reduce((best, m) => {
    const idx = prompt.lastIndexOf(m);
    return (idx > best) ? idx : best;
  }, -1);
  const tailLength = markerIdx >= 0 ? prompt.length - markerIdx : 800;

  // How many chars we can keep in the body section
  const bodyBudget = MAX_PROMPT_CHARS - tailLength - 200; // 200-char safety buffer
  const truncBody  = prompt.slice(0, Math.max(0, bodyBudget));

  const truncated = truncBody + '\n\n[...findings/tasks trimmed to fit token budget...]\n\n' + prompt.slice(markerIdx);

  logger.warn('RecommendationGenerator: prompt truncated for token budget', {
    correlationId,
    originalChars: prompt.length,
    truncatedChars: truncated.length,
    maxChars: MAX_PROMPT_CHARS,
  });

  return truncated;
}

// ─────────────────────────────────────────────────────────────────────────────

const RecommendationGenerator = {
  /**
   * Batch generation — used by pre-meeting analysis and unstructured-notes fallback.
   * Calls the provider once with a full prompt and expects a JSON array back.
   *
   * @param {object}     opts
   * @param {AIProvider} opts.provider      - Concrete provider instance
   * @param {string}     opts.prompt        - Built prompt string
   * @param {string}     opts.correlationId - For logging
   * @returns {Array<object>} validated recommendations
   */
  async generate({ provider, prompt, correlationId }) {
    const budgetedPrompt = applyTokenBudget(prompt, correlationId);

    logger.info('RecommendationGenerator: calling provider', {
      correlationId,
      provider: provider.name,
      promptLength: budgetedPrompt.length,
    });

    let rawText;
    try {
      rawText = await provider.generate(budgetedPrompt, {
        temperature: 0.3,
        maxTokens:   2500,   // 10 tasks × ~250 tokens — keeps output within context
        numCtx:      16384,  // large enough for prompt (≈4k tokens) + output (≈2.5k tokens)
        jsonFormat:  false,  // do NOT use format:'json' — llama3.2 treats it as single-object
      });
    } catch (err) {
      logger.error('RecommendationGenerator: provider error', {
        correlationId,
        provider: provider.name,
        code: err.code,
        error: err.message,
      });
      throw err;
    }

    logger.info('RecommendationGenerator: provider responded', {
      correlationId,
      responseLength: rawText ? rawText.length : 0,
    });

    try {
      const validated = RecommendationValidator.validate(rawText);
      logger.info('RecommendationGenerator: validated', { correlationId, count: validated.length });
      return validated;
    } catch (err) {
      logger.error('RecommendationGenerator: validation failed', {
        correlationId,
        code: err.code,
        error: err.message,
        rawPreview: rawText ? rawText.slice(0, 300) : '(empty)',
      });
      throw Object.assign(
        new Error(`AI response validation failed: ${err.message}`),
        { code: err.code || 'AI_VALIDATION_ERROR', statusCode: 502 }
      );
    }
  },

  /**
   * Single-item generation — used by per-item post-meeting analysis.
   * Calls the provider once with a focused single-task prompt and expects
   * exactly one JSON object back. maxTokens is intentionally small (600)
   * since a single task object needs ~400 tokens — keeps each call fast.
   *
   * @param {object}     opts
   * @param {AIProvider} opts.provider      - Concrete provider instance
   * @param {string}     opts.prompt        - Single-task prompt from PromptBuilder.buildSingleTask
   * @param {string}     opts.correlationId - For logging
   * @returns {object} one validated recommendation
   */
  async generateOne({ provider, prompt, correlationId, maxTokens, numCtx }) {
    const budgetedPrompt = applyTokenBudget(prompt, correlationId);

    logger.info('RecommendationGenerator: calling provider (single-item)', {
      correlationId,
      provider:     provider.name,
      promptLength: budgetedPrompt.length,
    });

    let rawText;
    try {
      rawText = await provider.generate(budgetedPrompt, {
        temperature: 0.3,
        maxTokens:   maxTokens ?? 1500,
        numCtx:      numCtx    ?? undefined,
      });
    } catch (err) {
      logger.error('RecommendationGenerator: provider error (single-item)', {
        correlationId,
        provider: provider.name,
        code:     err.code,
        error:    err.message,
      });
      throw err;
    }

    logger.info('RecommendationGenerator: provider responded (single-item)', {
      correlationId,
      responseLength: rawText ? rawText.length : 0,
    });

    try {
      const validated = RecommendationValidator.validateOne(rawText);
      logger.info('RecommendationGenerator: validated (single-item)', { correlationId });
      return validated;
    } catch (err) {
      // Log the raw AI response prominently so it's visible in the terminal even
      // when the structured JSON fields are collapsed by the log formatter.
      logger.warn(`RecommendationGenerator: AI raw output → "${(rawText || '').slice(0, 400)}"`, { correlationId });
      logger.error('RecommendationGenerator: validation failed (single-item)', {
        correlationId,
        code:       err.code,
        error:      err.message,
        rawPreview: rawText ? rawText.slice(0, 300) : '(empty)',
      });
      // Attach rawPreview to the error so the caller can log it without re-reading rawText.
      throw Object.assign(
        new Error(`AI single-item validation failed: ${err.message}`),
        { code: err.code || 'AI_VALIDATION_ERROR', statusCode: 502, rawPreview: rawText?.slice(0, 300) ?? '(empty)' }
      );
    }
  },
};

module.exports = RecommendationGenerator;
