'use strict';

const VALID_SEVERITIES  = new Set(['critical', 'high', 'medium', 'low']);
const VALID_STRATEGIES  = new Set(['immediate_fix', 'workaround', 'long_term_fix', 'escalation']);
const VALID_OWNER_TYPES = new Set(['CUSTOMER', 'ACCOUNT_MANAGER', 'SHARED']);
const DATE_RE           = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Scans the full text for every top-level JSON object { ... } regardless of
 * whether they appear inside an array or as separate blocks.
 * Handles nested braces correctly by tracking depth.
 */
function extractAllObjects(text) {
  const objects = [];
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('{', pos);
    if (start === -1) break;
    let depth = 0;
    let end   = -1;
    for (let i = start; i < text.length; i++) {
      if      (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) break;
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) objects.push(obj);
    } catch { /* skip malformed fragments */ }
    pos = end + 1;
  }
  return objects;
}

/**
 * Validates a single raw recommendation object and returns a clean, typed object.
 * Returns null if the object fails any required field check — never throws.
 * Used by both validate() (batch) and validateOne() (single-item).
 */
function validateItem(item) {
  if (!item || typeof item !== 'object') return null;

  // Resolve camelCase OR snake_case for every field — local models (llama3.2) often
  // return snake_case despite the prompt schema showing camelCase.
  // coerceString() also handles array-valued fields (another common llama3.2 artefact).
  const title      = coerceString(item.title);
  const actionPlan = coerceString(
    item.actionPlan || item.action_plan ||
    item.steps      || item.actions     || item.plan
  );
  // Extract the first valid severity keyword even when llama3.2 embeds it in a phrase
  // like "high severity risk" or returns "CRITICAL" (already lowercased below).
  const rawSev  = coerceString(item.severity);
  const sevLower = rawSev.toLowerCase().replace(/[\s_\-.]/g, '');
  const sevMatch = /\b(critical|crit|high|medium|med|low)\b/i.exec(rawSev);
  const severity = VALID_SEVERITIES.has(sevLower)
    ? sevLower
    : sevMatch
      ? { crit: 'critical', critical: 'critical', high: 'high', medium: 'medium', med: 'medium', low: 'low' }[sevMatch[1].toLowerCase()]
      : 'medium'; // default when absent — AIRecommendationService always overrides from finding.severity
  const riskRaw    = item.riskReductionScore  ?? item.risk_reduction_score  ?? item.riskScore ?? 50;
  const confidence = item.aiConfidence        ?? item.ai_confidence         ?? null;
  const ownerType  = coerceString(item.recommendedOwnerType || item.recommended_owner_type);
  const owner      = coerceString(item.recommendedOwner     || item.recommended_owner) || null;
  const dueDate    = coerceString(item.dueDateSuggestion    || item.due_date_suggestion) || null;
  const strategy   = coerceString(item.remediationStrategy  || item.remediation_strategy) || null;
  const category   = coerceString(item.category) || null;
  const impact     = coerceString(item.businessImpact || item.business_impact) || null;

  if (!title) return null;
  if (!actionPlan) return null;
  if (!VALID_SEVERITIES.has(severity)) return null;

  const riskScore  = Number(riskRaw);
  if (Number.isNaN(riskScore) || riskScore < 0 || riskScore > 100) return null;

  const conf = confidence != null ? Number(confidence) : null;
  if (conf !== null && (Number.isNaN(conf) || conf < 0 || conf > 1)) return null;

  const ownerTypeNorm = ownerType.toUpperCase();

  return {
    title:                title.slice(0, 255),
    actionPlan:           actionPlan,
    businessImpact:       impact   || null,
    remediationStrategy:  VALID_STRATEGIES.has(strategy) ? strategy : 'long_term_fix',
    severity:             severity,
    category:             category ? category.slice(0, 100) : null,
    riskReductionScore:   Math.round(riskScore),
    recommendedOwner:     owner    ? owner.slice(0, 200)   : null,
    recommendedOwnerType: VALID_OWNER_TYPES.has(ownerType.toUpperCase()) ? ownerType.toUpperCase() : 'ACCOUNT_MANAGER',
    dueDateSuggestion:    DATE_RE.test(dueDate || '') ? dueDate : null,
    aiConfidence:         conf,
  };
}

/**
 * Coerces a value to a flat string — handles the common case where llama3.2
 * returns actionPlan / businessImpact as a string array instead of a string.
 */
function coerceString(val) {
  if (!val) return '';
  if (Array.isArray(val)) return val.map(String).join(' ').trim();
  return String(val).trim();
}

/**
 * Strips markdown fences, trailing commas before } or ], and normalises whitespace.
 * Trailing commas are a frequent llama3.2 artefact that break JSON.parse().
 */
function cleanRaw(rawText) {
  return rawText.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/,      '')
    .replace(/\s*```$/,      '')
    .replace(/,(\s*[}\]])/g, '$1')   // strip trailing commas
    .trim();
}

const RecommendationValidator = {
  /**
   * Batch validation — used by pre-meeting analysis.
   * Parses a JSON array (or falls back to object scan) from rawText.
   * Drops items that fail field validation; throws if zero valid items remain.
   *
   * @param   {string}         rawText
   * @returns {Array<object>}  validated recommendations
   */
  validate(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      throw Object.assign(new Error('AI returned empty response'), { code: 'AI_EMPTY_RESPONSE' });
    }

    const cleaned = cleanRaw(rawText);

    // Primary parse: try array first
    let primary = [];
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd   = cleaned.lastIndexOf(']');

    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      try {
        const arr = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
        if (Array.isArray(arr)) primary = arr;
      } catch { /* fall through to object scan */ }
    }

    // No array found — try single bare object
    if (primary.length === 0) {
      const objStart = cleaned.indexOf('{');
      const objEnd   = cleaned.lastIndexOf('}');
      if (objStart === -1 || objEnd === -1 || objEnd <= objStart) {
        throw Object.assign(
          new Error(`AI response contains no JSON. Preview: ${cleaned.slice(0, 200)}`),
          { code: 'AI_NO_ARRAY' }
        );
      }
      try {
        const obj = JSON.parse(cleaned.slice(objStart, objEnd + 1));
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) primary = [obj];
      } catch (err) {
        throw Object.assign(
          new Error(`AI JSON parse failed: ${err.message}. Preview: ${cleaned.slice(objStart, objStart + 300)}`),
          { code: 'AI_JSON_PARSE_ERROR' }
        );
      }
    }

    // Secondary pass: merge any additional separate objects not already in the array
    const secondaryObjects = extractAllObjects(cleaned);
    const seenTitles = new Set(
      primary.map((o) => (o && typeof o.title === 'string' ? o.title.trim().toLowerCase() : null)).filter(Boolean)
    );
    for (const obj of secondaryObjects) {
      if (!obj.title || typeof obj.title !== 'string') continue;
      const key = obj.title.trim().toLowerCase();
      if (!seenTitles.has(key)) { primary.push(obj); seenTitles.add(key); }
    }

    const valid = primary.map(validateItem).filter(Boolean);

    if (valid.length === 0) {
      throw Object.assign(
        new Error('AI response contained no valid recommendations after field validation'),
        { code: 'AI_NO_VALID_ITEMS' }
      );
    }

    return valid;
  },

  /**
   * Single-item validation — used by per-item post-meeting analysis.
   * Finds the first valid JSON object in rawText and validates it.
   * Throws if no valid object can be extracted.
   *
   * @param   {string} rawText
   * @returns {object} one validated recommendation
   */
  validateOne(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      throw Object.assign(new Error('AI returned empty response'), { code: 'AI_EMPTY_RESPONSE' });
    }

    const cleaned = cleanRaw(rawText);
    const objects = extractAllObjects(cleaned);

    if (objects.length === 0) {
      throw Object.assign(
        new Error(`AI response contains no JSON object. Preview: ${cleaned.slice(0, 200)}`),
        { code: 'AI_NO_OBJECT' }
      );
    }

    for (const obj of objects) {
      const validated = validateItem(obj);
      if (validated) return validated;
    }

    throw Object.assign(
      new Error('AI response contained no valid recommendation after field validation'),
      { code: 'AI_NO_VALID_ITEMS' }
    );
  },
};

module.exports = RecommendationValidator;
