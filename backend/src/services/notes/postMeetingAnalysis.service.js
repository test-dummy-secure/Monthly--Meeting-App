'use strict';

const { randomUUID }          = require('crypto');
const { withTransaction }     = require('../../database/transaction');
const db                      = require('../../config/db');
const customerRepository      = require('../../repositories/customer.repository');
const tenantAssignmentRepository = require('../../repositories/tenant-assignment.repository');
const FindingsProvider        = require('../ai/FindingsProvider');
const PromptBuilder           = require('../ai/PromptBuilder');
const RecommendationGenerator = require('../ai/RecommendationGenerator');
const providerFactory         = require('../ai/providerFactory');
const RecommendationValidator = require('../ai/RecommendationValidator');
const auditLogRepository      = require('../../repositories/audit-log.repository');
const { SYSTEM_ACTOR }        = require('../../config/systemActor');
const logger                  = require('../../utils/logger');

// ── Product name normalization ────────────────────────────────────────────────
// Fixes common Fireflies ASR garbles so task titles and action plans contain
// the correct vendor name. Applied to stored action items during re-analysis,
// so existing meeting notes benefit even if they were saved with garbled names.
const _PRODUCT_RE = [
  [/\bjunk[\s-]cloud\b/gi, 'JumpCloud'],
  [/\bjump[\s-]cloud\b/gi, 'JumpCloud'],
  [/\bcrowd[\s-]strike\b/gi, 'CrowdStrike'],
  [/\bsentinel[\s-]one\b/gi, 'SentinelOne'],
  [/\bcheck[\s-]point\b/gi, 'Check Point'],
  [/\bbit[\s-]locker\b/gi, 'BitLocker'],
];
function _normalizeProductNames(text) {
  if (!text || typeof text !== 'string') return text;
  return _PRODUCT_RE.reduce((s, [re, name]) => s.replace(re, name), text);
}

// ── Provider helpers ──────────────────────────────────────────────────────────

function makePrimaryProvider(modelOverride) {
  return providerFactory.getPrimaryProvider(modelOverride);
}

async function generateWithFallback({ provider, prompt, correlationId }) {
  try {
    return await RecommendationGenerator.generate({ provider, prompt, correlationId });
  } catch (primaryErr) {
    if (!providerFactory.isTransientAIError(primaryErr)) throw primaryErr;

    const fallback = providerFactory.getFallbackProvider(provider);
    if (!fallback) throw primaryErr;

    logger.warn('PostMeetingAnalysis: primary failed, retrying with fallback', {
      correlationId,
      primary:  provider.name,
      fallback: fallback.name,
      error:    primaryErr.message,
    });
    return await RecommendationGenerator.generate({ provider: fallback, prompt, correlationId });
  }
}

// ── Per-item generation helpers ───────────────────────────────────────────────

// AI_CONCURRENCY=1: CPU-only Ollama cannot handle concurrent requests — the second
// call gets a 503 and falls back to individual items which also fail, silently
// dropping tasks. Sequential batches are slower wall-clock but produce zero failures.
const AI_CONCURRENCY = parseInt(process.env.AI_CONCURRENCY       || '1',  10);
// AI_MAX_ITEMS=25: after semantic dedup (below) source items are distinct topics;
// 10 was too low and caused early segments' MFA items to dominate, missing EDR/VAPT/licensing.
const AI_MAX_ITEMS   = parseInt(process.env.AI_MAX_ITEMS_PER_RUN  || '25', 10);
// BATCH_SIZE=5: 5 items per Ollama call — halves the number of calls vs BATCH_SIZE=3
// without making the prompt so large that Ollama truncates or times out.
const BATCH_SIZE     = 5;

/**
 * Normalises a task title for duplicate detection:
 * lowercased, punctuation stripped, whitespace collapsed.
 */
function normalizeTitle(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Common sentence-starting words that look capitalised but are not person names.
const OWNER_STOPWORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'all', 'each', 'every', 'both',
  'some', 'any', 'no', 'our', 'their', 'its', 'his', 'her', 'we', 'they',
  'team', 'everyone', 'nobody', 'someone',
]);

/**
 * Extracts the committed person's name from an action item string.
 * Handles "Sachin will...", "Dimple will check...", "Rakesh Patel will correct..."
 * Case-sensitive — requires a capital letter so only proper nouns are matched.
 * Returns null if no clear assignee is found or if the word is a common article/pronoun.
 */
function extractOwnerFromText(text) {
  // No /i flag — [A-Z] must be a real capital letter (proper noun, not sentence filler).
  const match = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:will|should|to |has to|needs to|is going to)/);
  if (!match) return null;
  const name = match[1].trim();
  if (OWNER_STOPWORDS.has(name.toLowerCase())) return null;
  return name;
}

/**
 * Minimum quality check on a generated task.
 * Rejects truncated titles and single-step action plans that llama3.2 occasionally produces.
 */
function isQualityOk(rec) {
  const title = (rec.title || '').trim();
  const plan  = (rec.actionPlan || '').trim();
  if (title.length < 15) return false;
  return plan.length >= 20;
}

/**
 * Returns true if generatedTitle is a near-match for any open task title.
 * Uses normalised exact-match and substring containment (min 10 chars) to
 * catch variants like "Deploy EDR" vs "Deploy EDR to remaining endpoints".
 */
function isDuplicate(generatedTitle, openTasks) {
  const a = normalizeTitle(generatedTitle);
  if (a.length < 5) return false;
  return openTasks.some((t) => {
    const b = normalizeTitle(t.title || '');
    if (b.length < 5) return false;
    if (a === b) return true;
    const shorter = a.length <= b.length ? a : b;
    const longer  = a.length <= b.length ? b : a;
    return shorter.length >= 10 && longer.includes(shorter);
  });
}

/**
 * Expands a partial name ("Rakesh") to a full speaker name ("Rakesh Patel")
 * by matching the first name against the known speaker list from the transcript.
 */
function normalizeOwnerName(name, speakerNames) {
  if (!name || !speakerNames || speakerNames.length === 0) return name;
  const lower = name.toLowerCase();
  if (speakerNames.some((s) => s.toLowerCase() === lower)) return name;
  const match = speakerNames.find((s) => s.split(' ')[0].toLowerCase() === lower);
  return match || name;
}

/**
 * Returns false when the only proper nouns in the item are the assigned person's
 * own name parts. Catches vague items like "Rakesh Patel to check last seen status
 * of devices" where "Patel" is the person, not a system — no non-person reference
 * means the AI cannot produce a specific task title.
 * Also passes items with explicit device/user counts (e.g. "5 devices", "8 users").
 */
function hasNonPersonReference(text, speakerNames) {
  const words = text.split(/\s+/);
  const personParts = new Set();
  for (const name of (speakerNames || [])) {
    name.split(' ').forEach((p) => personParts.add(p.toLowerCase()));
  }
  if (words[0]) personParts.add(words[0].toLowerCase().replace(/[^a-z]/g, ''));
  const nonPersonCaps = words.slice(1).filter((w) => {
    const isDevanagari = /[ऀ-ॿ]{2,}/.test(w);
    if (isDevanagari) return true;
    const clean = w.replace(/[^a-zA-Z]/g, '');
    return clean.length >= 3 && /^[A-Z]/.test(clean) && !personParts.has(clean.toLowerCase());
  });
  const hasCount = /\b\d+\s*(users?|devices?|endpoints?|accounts?|files?|sheets?)\b/i.test(text);
  return nonPersonCaps.length > 0 || hasCount;
}

/**
 * Removes near-duplicate source items BEFORE they reach the Ollama task generator.
 * Uses word-overlap to cluster items that describe the same commitment — keeps the
 * most specific one per cluster (prefers items that contain exact digit counts).
 *
 * Threshold 0.65: 65 % of the shorter item's content words appear in the longer.
 * This catches "Investigate 31 users without MFA in JumpCloud" and "Investigate
 * 31 users without MFA and 522 inactive devices" as the same topic (both share
 * investigate/users/without/mfa/jumpcloud) while keeping truly distinct items
 * like "Remove inactive apps from JumpCloud" (EDR, licensing, phishing, etc.).
 *
 * Only applied to explicit sourceItems (action_items + follow_ups).
 * Deliverables and implied items are already limited in number and kept as-is.
 */
function semanticDeduplicateSourceItems(items) {
  const wordSet = (text) => new Set(
    (text || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['will','should','that','this','with','from','have','been','they','their','which','also','after','before','then','when'].includes(w))
  );

  const overlapRatio = (a, b) => {
    const wa = wordSet(a), wb = wordSet(b);
    if (!wa.size || !wb.size) return 0;
    return [...wa].filter(w => wb.has(w)).length / Math.min(wa.size, wb.size);
  };

  const kept = [];
  for (const item of items) {
    const dupIdx = kept.findIndex(k => overlapRatio(item.text, k.text) >= 0.65);
    if (dupIdx === -1) {
      kept.push(item);
    } else {
      // Among near-duplicates, prefer the item with an explicit digit count; on tie, prefer longer text
      const hasCount = /\b\d+\b/.test(item.text);
      const existingHasCount = /\b\d+\b/.test(kept[dupIdx].text);
      if (hasCount && !existingHasCount) {
        kept[dupIdx] = item;
      } else if (item.text.length > kept[dupIdx].text.length && (!existingHasCount || hasCount)) {
        kept[dupIdx] = item;
      }
    }
  }
  return kept;
}

/**
 * Runs one focused AI call per source item with bounded concurrency.
 * Each call targets exactly one meeting item → one task object.
 * Uses Promise.allSettled so individual failures never abort the batch.
 * Attaches _meta (itemType, itemPreview) to each result for audit storage.
 */
async function generatePerItem({ sourceItems, provider, tenant, openTasks, findings, correlationId, speakerNames = [], meetingSummary = '' }) {
  const capped = sourceItems.slice(0, AI_MAX_ITEMS);

  // Split into batches of BATCH_SIZE — one AI call generates multiple tasks at once.
  const batches = [];
  for (let i = 0; i < capped.length; i += BATCH_SIZE) {
    batches.push(capped.slice(i, i + BATCH_SIZE));
  }

  const results = [];

  // Process AI_CONCURRENCY batches in parallel — keeps Ollama's queue full so
  // it starts the next call the moment the previous one finishes.
  for (let i = 0; i < batches.length; i += AI_CONCURRENCY) {
    const concurrentBatches = batches.slice(i, i + AI_CONCURRENCY);
    const settled = await Promise.allSettled(
      concurrentBatches.map(async (batch) => {
        // ── Attempt batch generation (3 tasks in one call) ────────────────
        try {
          const batchPrompt = PromptBuilder.buildBatchTasks({ tenant, items: batch, openTasks, findings, meetingSummary });
          const rawBatch    = await provider.generate(batchPrompt, {
            temperature: 0.3,
            maxTokens:   900 * batch.length,
            // numCtx intentionally not set — uses OLLAMA_NUM_CTX=4096 from env
            // RecommendationGenerator.generate() forces numCtx:16384 which causes
            // provider errors when called concurrently on CPU-only Ollama
          });
          const batchRecs = RecommendationValidator.validate(rawBatch);
          return batchRecs.slice(0, batch.length).map((rec, idx) => {
            const { text, type } = batch[idx] || {};
            const extractedOwner = normalizeOwnerName(extractOwnerFromText(text || ''), speakerNames);
            return { ...rec, _meta: { itemType: type, itemPreview: (text || '').slice(0, 100), extractedOwner } };
          });
        } catch (batchErr) {
          logger.warn('PostMeetingAnalysis: batch generation failed — falling back to individual', {
            correlationId,
            batchSize: batch.length,
            error:     batchErr.message,
            code:      batchErr.code,
          });

          // ── Individual fallback — one call per item in this batch ─────────
          const fallbackSettled = await Promise.allSettled(
            batch.map(({ text, type }) => {
              const extractedOwner = normalizeOwnerName(extractOwnerFromText(text), speakerNames);
              return RecommendationGenerator.generateOne({
                provider,
                prompt: PromptBuilder.buildSingleTask({ tenant, item: text, itemType: type, openTasks, findings, meetingSummary }),
                correlationId,
                maxTokens: 800,
              }).then((rec) => ({ ...rec, _meta: { itemType: type, itemPreview: text.slice(0, 100), extractedOwner } }));
            })
          );

          const fallbackResults = [];
          for (const outcome of fallbackSettled) {
            if (outcome.status === 'fulfilled') {
              fallbackResults.push(outcome.value);
            } else {
              logger.warn('PostMeetingAnalysis: individual fallback item failed', {
                correlationId,
                error: outcome.reason?.message,
                code:  outcome.reason?.code,
              });
            }
          }
          return fallbackResults;
        }
      })
    );

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        results.push(...outcome.value);
      } else {
        logger.warn('PostMeetingAnalysis: batch processing failed entirely', {
          correlationId,
          error: outcome.reason?.message,
        });
      }
    }
  }

  return results;
}

/**
 * Maps every valid source item directly to a task recommendation — no Ollama call.
 * Owner / severity / category are derived by keyword rules (same as fromStoredNotes).
 * Returns an array shaped identically to generatePerItem output so the downstream
 * dedup + quality gate + INSERT logic in analyze() is completely unchanged.
 *
 * Replaces the Ollama batch generation which asked Ollama to "pick the most critical"
 * from each batch of 5, causing it to return only 1-2 per batch (6 tasks from 38 items).
 * This approach converts ALL items: ~35-40 recommendations for the AM to approve/reject.
 * Works identically for every tenant — no tenant-specific logic.
 */
async function directMapItems({ sourceItems, tenant, openTasks, speakerNames = [] }) {
  const allReference = [...openTasks];
  const keptTitles   = [];
  const results      = [];

  function localWordOverlap(a, b) {
    const words = (s) => new Set(
      s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2)
    );
    const wa = words(a), wb = words(b);
    if (!wa.size || !wb.size) return 0;
    return [...wa].filter(w => wb.has(w)).length / Math.min(wa.size, wb.size);
  }

  for (const { text, type, isDeliverable, _severityHint, _categoryHint } of sourceItems) {
    if (!text || typeof text !== 'string' || text.trim().length < 10) continue;

    // Skip historical status reports that reference past months (≥2 months ago).
    // Applies to action_item, follow_up, and decision_action types — their text
    // is raw transcript content and may contain "in May / in June" references.
    // gap_observation and deliverable types already have clean generated titles.
    if (type !== 'deliverable' && type !== 'gap_observation' && isStaleHistoricalItem(text)) continue;

    if (isDeliverable) {
      const rawText = text.replace(/^\[DELIVERABLE\]\s*/i, '').trim();
      if (!rawText || rawText.length < 20) continue;
      if (isDuplicate(rawText, allReference)) continue;
      const amOwner = tenant.accountManagerName || null;
      results.push({
        title:               rawText,
        actionPlan:          buildStoredItemActionPlan(rawText, amOwner),
        businessImpact:      null,
        remediationStrategy: 'long_term_fix',
        riskReductionScore:  55,
        severity:            'medium',
        category:            'Deliverable',
        recommendedOwner:    amOwner,
        recommendedOwnerType: 'ACCOUNT_MANAGER',
        dueDateSuggestion:   addDaysFromSeverity('medium'),
        aiConfidence:        null,
        _meta: { itemType: 'deliverable', itemPreview: rawText.slice(0, 100), extractedOwner: amOwner },
      });
      continue;
    }

    // decision_action: passive form ("Global admin will be removed") — full text is already the title.
    // gap_observation: pre-built title from extractSecurityGapItems — use as-is, same as decision_action.
    // All other types: strip the "Person will " prefix to get the task title.
    const title = (type === 'decision_action' || type === 'gap_observation')
      ? (text.trim().slice(0, 120) || null)
      : buildTaskTitleFromStoredItem(text);

    if (!title || title.length < 20) continue;
    if (isDuplicate(title, allReference)) continue;
    if (keptTitles.some(kt => localWordOverlap(title, kt) >= 0.75)) continue;
    keptTitles.push(title);

    const extractedOwner = normalizeOwnerName(
      extractOwnerFromText(text) || extractOwnerFromStoredItem(text),
      speakerNames
    );
    // gap_observation items carry explicit severity/category hints derived from the
    // matched pattern; fall back to keyword classification for all other types.
    const severity = _severityHint || classifySeverityFromText(text);
    const category = _categoryHint || classifyCategoryFromText(text);

    results.push({
      title,
      actionPlan:          buildStoredItemActionPlan(text, extractedOwner),
      businessImpact:      null,
      remediationStrategy: severity === 'critical' || severity === 'high' ? 'immediate_fix' : 'long_term_fix',
      riskReductionScore:  { critical: 92, high: 78, medium: 55, low: 35 }[severity] || 55,
      severity,
      category,
      recommendedOwner:    extractedOwner,
      recommendedOwnerType: null,
      dueDateSuggestion:   addDaysFromSeverity(severity),
      aiConfidence:        null,
      _meta: { itemType: type, itemPreview: text.slice(0, 100), extractedOwner },
    });
  }

  return results;
}

// ── Direct-mapping helpers (fromStoredNotes fast path — zero Ollama) ─────────

/**
 * Extracts the committing person's name from a stored action-item string.
 * Handles names with digits (e.g. "Ashish Kushwaha2 will...") and up to 4
 * name parts (e.g. "Shanker Rao Madichetti will...").
 */
function extractOwnerFromStoredItem(text) {
  const match = (text || '').match(/^((?:[A-Z][a-zA-Z0-9]*\s+){1,4})will\s/);
  if (!match) return null;
  return match[1].trim() || null;
}

// A tenant can have several AMs assigned (tenant_assignments), only one marked
// primary — but `tenant.accountManagerName` (from the customers row) only ever
// names the primary. Classifying owner-type by checking a task's owner name
// against just that one name meant any OTHER internal team member on the
// account (a non-primary AM) got misclassified as CUSTOMER, on every task,
// every meeting, for that tenant — the same primary-vs-team-vs-customer gap
// already fixed for escalation routing. This checks the full roster instead.
function isKnownAccountManagerName(ownerName, amRoster) {
  if (!ownerName || !Array.isArray(amRoster) || amRoster.length === 0) return false;
  const owner = ownerName.toLowerCase();
  return amRoster.some((am) => {
    const first = (am.firstName || (am.name || '').split(' ')[0] || '').toLowerCase();
    return first.length > 0 && owner.includes(first);
  });
}

function classifySeverityFromText(text) {
  const t = (text || '').toLowerCase();
  if (/\b(immediately|critical|breach|urgent|block now|disable now|delete immediately)\b/.test(t)) return 'critical';
  if (/\b(mfa|inactive|expired|vulnerabilit|disable|remove|delete|block|unauthorized|suspend)\b/.test(t)) return 'high';
  if (/\b(review|check|verify|update|configure|enforce|monitor|policy|schedule|audit)\b/.test(t)) return 'medium';
  return 'low';
}

function classifyCategoryFromText(text) {
  const t = (text || '').toLowerCase();
  if (/\b(jumpcloud|device|endpoint|mdm|usb|laptop|desktop|machine)\b/.test(t)) return 'Device Management';
  if (/\b(mfa|multi.factor|password|identity|account|login|user|access|admin|credential)\b/.test(t)) return 'Identity Management';
  if (/\b(license|billing|renewal|subscription|pro.rata|meridian)\b/.test(t)) return 'License Management';
  if (/\b(phishing|training|awareness|simulation|campaign)\b/.test(t)) return 'Security Awareness';
  if (/\b(firewall|checkpoint|edr|malware|threat|antivirus|crowdstrike|harmony)\b/.test(t)) return 'Endpoint Security';
  if (/\b(email|mailbox|outlook|smtp|forwarding|dkim|dmarc|shared mailbox)\b/.test(t)) return 'Email Security';
  if (/\b(m365|sharepoint|teams|azure|microsoft|office 365|cloud)\b/.test(t)) return 'Cloud Security';
  if (/\b(scan|vulnerability|pentest|vapt|cve|patch|update)\b/.test(t)) return 'Vulnerability Management';
  if (/\b(ueba|siem|alert|log|monitor|detection)\b/.test(t)) return 'Security Monitoring';
  return null;
}

/**
 * Returns true when a source item explicitly references a calendar month
 * that is 2+ months before today. These are historical status statements
 * ("disabled 522 devices in May, 2 in June") from the meeting transcript —
 * the action already happened and should not become a new task recommendation.
 * Dynamic: uses today's date so it works for any tenant at any time.
 */
function isStaleHistoricalItem(text) {
  if (!text) return false;
  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const curM   = new Date().getMonth(); // 0-indexed
  const hits   = (text.toLowerCase().match(/\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi) || []);
  for (const fragment of hits) {
    const name = fragment.replace(/\bin\s+/i, '').toLowerCase();
    const mIdx = MONTHS.indexOf(name);
    if (mIdx === -1) continue;
    const monthsAgo = ((curM - mIdx) + 12) % 12; // handles year-boundary wrap
    if (monthsAgo >= 2) return true;
  }
  return false;
}

function buildTaskTitleFromStoredItem(text) {
  let title = (text || '').trim();
  title = title.replace(/^(?:[A-Z][a-zA-Z0-9]*\s+){1,4}will\s+/i, '');
  title = title.replace(/^(?:[A-Z][a-zA-Z0-9]*\s+){1,4}(?:should|has to|needs to|is going to)\s+/i, '');
  title = title.replace(/\s*(?:by\s*)?\[no date mentioned\]/gi, '');
  title = title.replace(/\s*by\s+\[.*?\]/gi, '');
  title = title.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '').trim();
  if (title.length > 0) title = title.charAt(0).toUpperCase() + title.slice(1);
  return title.slice(0, 120) || null;
}

function buildStoredItemActionPlan(text, owner) {
  const assignee = owner || 'The responsible team member';
  const cleaned  = (text || '').replace(/^(?:[A-Z][a-zA-Z0-9]*\s+){1,4}will\s+/i, '').trim();
  const task     = cleaned.charAt(0).toUpperCase() + cleaned.slice(1, 200);
  return [
    `1. ${assignee} to complete: ${task}.`,
    `2. Provide confirmation (screenshot, status update, or signed-off ticket) by the agreed due date.`,
    `3. Account Manager to verify closure before the next monthly review meeting.`,
  ].join('\n');
}

function addDaysFromSeverity(severity) {
  const d = new Date();
  d.setDate(d.getDate() + ({ critical: 7, high: 14, medium: 30, low: 60 }[severity] || 30));
  return d.toISOString().slice(0, 10);
}

// ── Domain detection + deliverable inference helpers ──────────────────────────

const DOMAIN_KEYWORDS = {
  identity_mfa:    ['mfa', 'multi-factor', 'conditional access', 'breach', 'credential', 'password', 'inactive account', 'dormant', 'global admin', 'service account', 'shared mailbox', 'active directory'],
  device_endpoint: ['jumpcloud', 'check point', 'checkpoint', 'edr', 'usb block', 'mobile device', 'mdm', 'device management'],
  email_dmarc:     ['dkim', 'dmarc', 'spf', 'mail forwarding', 'email security'],
  phishing:        ['phishing', 'simulation', 'awareness training', 'security awareness', 'failed users', 'phishing campaign'],
  vapt:            ['vapt', 'penetration test', 'vulnerability assessment', 'pen test', 'server vapt', 'endpoint vapt', 'remediat'],
  zscaler:         ['zscaler', 'sanctioned application', 'cloud proxy', 'ztna', 'internet access policy'],
  nxg360_ueba:     ['nxg360', 'nxg 360', 'ueba', 'user behavior analytics', 'risk score', 'portal credentials'],
  licensing:       ['license', 'billing', 'renewal', 'subscription', 'pro rata', 'meridian', 'm365 license'],
};

function detectDomains(allText) {
  const lower = (allText || '').toLowerCase();
  return Object.keys(DOMAIN_KEYWORDS).filter(domain =>
    DOMAIN_KEYWORDS[domain].some(kw => lower.includes(kw))
  );
}

// Standard deliverables NxgSecure must produce for each domain that was discussed.
// signal = substring checked against existing text to skip if already covered.
const STANDARD_DELIVERABLES = {
  identity_mfa: [
    { text: 'Share MFA Exception Report listing users excluded from MFA enforcement with approved justification', signal: 'mfa exception report' },
    { text: 'Share Dormant Account Report listing user accounts inactive for 90+ days for customer review and cleanup', signal: 'dormant account report' },
  ],
  device_endpoint: [
    { text: 'Share Device Exception Report covering devices missing full endpoint security agent coverage', signal: 'device exception report' },
  ],
  phishing: [
    { text: 'Share Phishing Simulation Report with complete list of failed users and their current training assignment status', signal: 'phishing simulation report' },
  ],
  vapt: [
    { text: 'Share VAPT Status Update covering progress on endpoint, server, and web application assessments with list of open findings', signal: 'vapt status update' },
  ],
  nxg360_ueba: [
    { text: 'Share NXG360 Portal credentials and onboarding instructions with customer team', signal: 'nxg360' },
    { text: 'Share UEBA security posture report highlighting risk users and behavioral anomalies detected in the past month', signal: 'ueba report' },
  ],
};

function getStandardDeliverables(domains, existingText) {
  const existing = (existingText || '').toLowerCase();
  const result = [];
  for (const domain of domains) {
    for (const { text, signal } of (STANDARD_DELIVERABLES[domain] || [])) {
      if (!existing.includes(signal)) result.push(text);
    }
  }
  return [...new Set(result)];
}

// ── Observational security-gap extractor ──────────────────────────────────────
// Patterns for converting observational status statements into actionable task
// titles. Each meeting transcript contains sentences like "27 devices have failed
// JumpCloud policies" or "20 devices pending EDR installation" — these are facts
// stated in the discussion that imply a required follow-up action, but no speaker
// explicitly said "we will fix this", so they land in decisionsTaken/risksDiscussed
// rather than actionItems. This extractor surfaces them as gap_observation tasks.
//
// Pattern fields:
//   re          — regex that matches the observational statement
//   buildTitle  — fn(matchArray, fullText) → task title string
//   severity    — base severity for this class of gap
//   getCategory — fn(fullText) → category string or null
//
// Add new entries here to extend coverage for additional security domains.
// All patterns are generic — no tenant-specific logic.
// Each metric has two entries — one for English word order and one for Hinglish
// word order (where the tech term comes BEFORE the negation "nahi").
// Numbers and technical terms (MFA, EDR, JumpCloud, device, password) are always
// in English digits/words even in Hindi speech, so the regex always matches.
// Pure Hindi number words ("ek sau saat users") are not covered — in security
// review meetings this virtually never happens; speakers always say "107 users".
const SECURITY_GAP_PATTERNS = [
  // "27 devices have failed JumpCloud policies"
  // Hinglish: "27 devices JumpCloud policies fail ho rahi hain"
  {
    re: /\b(\d+)\s+(devices?|endpoints?|machines?)\b[^.\n]{0,80}(?:have?\s+)?(?:failed|failing|partially applied|fail\s+ho|fail\s+kar)\b[^.\n]{0,60}(?:polic|compliance)/i,
    buildTitle: (m, s) => {
      const sys = /jumpcloud/i.test(s) ? 'JumpCloud ' : /intune/i.test(s) ? 'Intune ' : '';
      return `Investigate and resolve ${m[1]} ${m[2]} with failed ${sys}policies`;
    },
    severity: 'high',
    getCategory: (s) => /jumpcloud/i.test(s) ? 'Device Management' : null,
  },
  // Hinglish reverse: "27 devices ki policies fail / policies nahi chal rahi"
  {
    re: /\b(\d+)\s+(devices?|endpoints?)\b[^.\n]{0,80}polic[a-z]*\b[^.\n]{0,60}(?:fail|nahi|not\s+applied)/i,
    buildTitle: (m, s) => {
      const sys = /jumpcloud/i.test(s) ? 'JumpCloud ' : '';
      return `Investigate and resolve ${m[1]} ${m[2]} with failed ${sys}policies`;
    },
    severity: 'high',
    getCategory: () => 'Device Management',
  },
  // "20 devices are still pending EDR / Check Point installation"
  // Hinglish: "20 devices pe EDR pending hai / install nahi hua"
  {
    re: /\b(\d+)\s+(devices?|endpoints?|machines?)\b[^.\n]{0,50}(?:still\s+)?pending\b[^.\n]{0,60}(?:edr|check.?point|crowdstrike|defender|sentinel\s*one|install|deploy)/i,
    buildTitle: (m, s) => {
      const tool = /check.?point/i.test(s) ? 'Check Point EDR'
        : /crowdstrike/i.test(s) ? 'CrowdStrike'
        : /defender/i.test(s) ? 'Microsoft Defender'
        : /sentinel.?one/i.test(s) ? 'SentinelOne'
        : 'EDR agent';
      return `Install ${tool} on the remaining ${m[1]} ${m[2]}`;
    },
    severity: 'high',
    getCategory: () => 'Endpoint Security',
  },
  // Hinglish: "20 devices EDR/Check Point install nahi hua / pending hai"
  {
    re: /\b(\d+)\s+(devices?|endpoints?)\b[^.\n]{0,80}(?:edr|check.?point|crowdstrike|install)\b[^.\n]{0,60}(?:nahi|pending\s+(?:hai|hain)|install\s+nahi)/i,
    buildTitle: (m, s) => {
      const tool = /check.?point/i.test(s) ? 'Check Point EDR' : /crowdstrike/i.test(s) ? 'CrowdStrike' : 'EDR agent';
      return `Install ${tool} on the remaining ${m[1]} ${m[2]}`;
    },
    severity: 'high',
    getCategory: () => 'Endpoint Security',
  },
  // "95 users without JumpCloud managed device / admin assigned"
  // Hinglish negation-first: "95 users nahi ... JumpCloud / ke paas nahi"
  {
    re: /\b(\d+)\s+(users?|accounts?)\b[^.\n]{0,80}(?:without|do not have|don['']t have|have no|not\s+(?:been\s+)?assigned|nahi|ke\s+paas\s+nahi)\b[^.\n]{0,60}(?:jumpcloud|managed.device|device.assigned|admin.assigned)/i,
    buildTitle: (m, s) => {
      const what = /managed.device/i.test(s) ? 'JumpCloud-managed device'
        : /admin.assigned/i.test(s) ? 'JumpCloud admin assignment'
        : 'JumpCloud device assignment';
      return `Validate ${m[1]} ${m[2]} without ${what} and assign accordingly`;
    },
    severity: 'high',
    getCategory: () => 'Device Management',
  },
  // Hinglish reverse: "95 users JumpCloud device nahi hai / assign nahi kiya"
  {
    re: /\b(\d+)\s+(users?|accounts?)\b[^.\n]{0,80}(?:jumpcloud|managed\s+device)\b[^.\n]{0,60}(?:nahi|not\s+(?:assigned|available))/i,
    buildTitle: (m) => `Validate ${m[1]} ${m[2]} without JumpCloud-managed device and assign accordingly`,
    severity: 'high',
    getCategory: () => 'Device Management',
  },
  // "107 users have passwords older than 90 days" / "not changed in 90 days"
  // Hinglish: "107 users ke passwords 90 days se purane hain / change nahi kiye"
  {
    re: /\b(\d+)\s+(users?|accounts?)\b[^.\n]{0,60}passwords?\b[^.\n]{0,80}(?:older\s+than|not\s+(?:been\s+)?(?:changed|reset|rotated)|unused\s+for|expired|purane|change\s+nahi|se\s+zyada)/i,
    buildTitle: (m, s) => {
      const ageMatch = s.match(/older\s+than\s+(\d+)\s+days?/i)
        || s.match(/(\d+)\s+days?\s+(?:old|ago|unused|se\s+purane|se\s+zyada)/i);
      const days = ageMatch ? ageMatch[1] : '90';
      return `Reset passwords for ${m[1]} ${m[2]} with passwords older than ${days} days`;
    },
    severity: 'high',
    getCategory: () => 'Identity Management',
  },
  // "49 users do not have MFA enabled"
  // Hinglish negation-first: "49 users nahi ... MFA / ke paas MFA nahi"
  {
    re: /\b(\d+)\s+(users?|accounts?)\b[^.\n]{0,60}(?:without|do not have|don'?t have|have no|not\s+(?:enabled|configured|setup)|nahi|ke\s+paas\s+nahi)\b[^.\n]{0,60}(?:mfa|multi.factor|two.factor|2fa)\b/i,
    buildTitle: (m) => `Enable MFA for the ${m[1]} ${m[2]} without multi-factor authentication configured`,
    severity: 'high',
    getCategory: () => 'Identity Management',
  },
  // Hinglish reverse: "49 users MFA nahi hai / MFA enable nahi kiya / MFA abhi tak nahi"
  {
    re: /\b(\d+)\s+(users?|accounts?)\b[^.\n]{0,60}(?:mfa|multi.factor|2fa)\b[^.\n]{0,60}(?:nahi|not\s+(?:enabled|configured|active)|disable)/i,
    buildTitle: (m) => `Enable MFA for the ${m[1]} ${m[2]} without multi-factor authentication configured`,
    severity: 'high',
    getCategory: () => 'Identity Management',
  },
  // "Rakesh is preparing the Patch Management SOP"
  // Hinglish: "Rakesh SOP bana raha hai / patch management SOP kar rahe hain"
  {
    re: /\b(\w+(?:\s+\w+)?)\s+(?:is\s+(?:preparing|drafting|writing|creating|finaliz\w*)|(?:sop|patch)\s+bana\s+(?:raha|rahe|rahi)|prepare\s+kar\s+(?:raha|rahe))\b[^.\n]{0,100}(?:sop|standard\s+operating\s+procedure|procedure\s+document|guideline)/i,
    buildTitle: (m, s) => {
      const docMatch = s.match(/(?:the\s+)?([\w\s-]{5,60}(?:sop|standard operating|procedure|guideline))/i);
      const doc = docMatch ? docMatch[1].trim() : 'SOP document';
      return `Complete and share the ${doc} (${m[1].trim()})`;
    },
    severity: 'medium',
    getCategory: () => 'Vulnerability Management',
  },
  // Hinglish SOP variant where person name comes before the doc name:
  // "Rakesh patch management SOP ready karega / bana rahe hain"
  {
    re: /\b(\w+(?:\s+\w+)?)\b[^.\n]{0,50}(?:sop|patch\s+management)\b[^.\n]{0,80}(?:bana\s+(?:raha|rahe)|kar\s+(?:raha|rahe)|ready\s+kar|finalize\s+kar)/i,
    buildTitle: (m, s) => {
      const docMatch = s.match(/(patch\s+management\s+sop|[\w\s]{5,50}sop)/i);
      const doc = docMatch ? docMatch[1].trim() : 'Patch Management SOP';
      return `Complete and share the ${doc} (${m[1].trim()})`;
    },
    severity: 'medium',
    getCategory: () => 'Vulnerability Management',
  },
];

/**
 * Scans all structured note sections for observational security-gap statements
 * and converts each match into a gap_observation source item with a clean task title.
 * Covers items stated as facts rather than explicit commitments — these typically
 * appear in decisionsTaken or risksDiscussed rather than actionItems.
 * Works for all tenants: no tenant-specific logic, pattern-driven only.
 */
function extractSecurityGapItems(structuredNotes) {
  const results   = [];
  const seenKeys  = new Set();

  const sections = [
    ...(structuredNotes?.decisionsTaken  || []),
    ...(structuredNotes?.risksDiscussed  || []),
    ...(structuredNotes?.actionItems     || []),
    ...(structuredNotes?.followUpActions || []),
  ];

  for (const text of sections) {
    if (!text || typeof text !== 'string' || text.length < 20) continue;
    for (const { re, buildTitle, severity, getCategory } of SECURITY_GAP_PATTERNS) {
      const m = text.match(re);
      if (!m) continue;
      let title;
      try { title = buildTitle(m, text); } catch (_) { continue; }
      if (!title || title.length < 25) continue;
      const key = title.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      results.push({
        text:          title,
        type:          'gap_observation',
        _severityHint: severity,
        _categoryHint: getCategory(text) || null,
      });
    }
  }

  return results;
}

/**
 * Scans the RAW TRANSCRIPT TEXT for numeric security metrics using the same
 * SECURITY_GAP_PATTERNS, but takes the LAST occurrence of each pattern match.
 * This is more reliable than scanning structured-note sections because:
 *   1. The raw transcript always contains the discussion even if noteStructurer
 *      didn't extract it into a specific section.
 *   2. The last mention of a count (e.g. "49 users") overrides earlier estimates
 *      because speakers correct themselves as the meeting progresses.
 * Results are combined with gapObservationItems (from structured notes) and
 * the semanticDedup step handles any overlap between the two sources.
 */
function extractNumericGapsFromTranscript(transcriptText) {
  if (!transcriptText || transcriptText.length < 200) return [];
  const results  = [];
  const seenKeys = new Set();

  for (const { re, buildTitle, severity, getCategory } of SECURITY_GAP_PATTERNS) {
    // Run a global scan through the full transcript and keep the LAST match.
    const globalRe = new RegExp(re.source, 'gi');
    let match;
    let lastMatch = null;
    while ((match = globalRe.exec(transcriptText)) !== null) {
      lastMatch = match;
    }
    if (!lastMatch) continue;
    let title;
    try { title = buildTitle(lastMatch, lastMatch[0]); } catch (_) { continue; }
    if (!title || title.length < 25) continue;
    const key = title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    results.push({
      text:           title,
      type:           'gap_observation',
      _severityHint:  severity,
      _categoryHint:  getCategory(lastMatch[0]) || null,
      _fromTranscript: true,
    });
  }
  return results;
}

// One focused Ollama call to derive operational tasks implied by the meeting that
// are not already captured in explicit commitments or standard deliverables.
// Catches product-specific rollout tasks (Zscaler), breach credential remediation,
// DMARC monitoring, and VAPT remediation follow-ups.
// Failures degrade gracefully — the explicit tasks and deliverables are still written.
async function deriveImpliedTasks({ summary, risks, decisions, domains, explicitTexts, provider, correlationId }) {
  if (!summary && domains.length === 0) return [];

  const domainList   = domains.map(d => d.replace(/_/g, '/')).join(', ');
  const risksList    = risks.slice(0, 6).map(r => `• ${r}`).join('\n') || '(none captured)';
  const decisionList = decisions.slice(0, 4).map(d => `• ${d}`).join('\n') || '(none captured)';
  const explicitList = explicitTexts.slice(0, 15).map(t => `• ${t}`).join('\n') || '(none)';

  const prompt = `You are a security operations manager reviewing a customer security review meeting.

MEETING SUMMARY: ${summary}

SECURITY DOMAINS DISCUSSED: ${domainList}

KEY RISKS RAISED:
${risksList}

DECISIONS MADE:
${decisionList}

EXPLICIT OPERATIONAL TASKS ALREADY CAPTURED:
${explicitList}

TASK: Identify up to 6 additional operational tasks CLEARLY IMPLIED by the discussion above but NOT already in the explicit task list.

Rules:
- Each task must be directly supported by the summary, risks, decisions, or domains listed
- Do NOT restate tasks already in the explicit list
- Include Zscaler-related tasks if zscaler domains were discussed
- Include DMARC/email security monitoring tasks if dkim/dmarc domains were discussed
- Include VAPT remediation follow-up if vapt domain was discussed
- Include breach credential remediation if credential breach was mentioned
- Name the specific system, tool, or security area in each task
- Write from an operational perspective: what must be DONE

Respond with ONLY valid JSON — no text before or after:
{"implied": ["task description 1", "task description 2"]}`;

  try {
    const raw   = await provider.generate(prompt, { maxTokens: 500, temperature: 0.15 });
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return [];
    const obj = JSON.parse(match[0]);
    if (!Array.isArray(obj?.implied)) return [];
    return obj.implied
      .filter(t => typeof t === 'string' && t.trim().length > 25)
      .map(t => t.trim())
      .slice(0, 6);
  } catch (err) {
    logger.warn('PostMeetingAnalysis: implied task derivation skipped', { correlationId, error: err.message });
    return [];
  }
}

// ── DB status helpers ─────────────────────────────────────────────────────────

/**
 * Atomically claims the processing lock on a meeting.
 * Transitions notes_status from 'notes_added' → 'processing'.
 * Returns true if the lock was acquired, false if already held.
 */
async function claimProcessingLock(meetingId) {
  const { rowCount } = await db.query(
    `UPDATE meetings
     SET    notes_status = 'processing',
            updated_at   = NOW()
     WHERE  id           = $1
       AND  notes_status = 'notes_added'`,
    [meetingId]
  );
  return rowCount > 0;
}

async function setMeetingNotesStatus(meetingId, status) {
  await db.query(
    `UPDATE meetings
     SET    notes_status = $1,
            updated_at   = NOW()
     WHERE  id = $2`,
    [status, meetingId]
  );
}

// ── Core service ──────────────────────────────────────────────────────────────

const postMeetingAnalysisService = {

  /**
   * Second AI pass — runs immediately after meeting notes are processed.
   * Generates a confirmed task set based on what was discussed and decided.
   *
   * All recommendation INSERTs and the meeting_notes status stamp are wrapped
   * in a single transaction so the write is atomic: either all tasks are created
   * and notes marked completed, or nothing is written.
   *
   * @param {{ tenantId: string, meetingId: string, structuredNotes: object }} opts
   * @returns {Promise<Array>} persisted recommendation rows
   */
  async analyze({ tenantId, meetingId, structuredNotes, modelOverride = null }) {
    const correlationId = randomUUID();
    const startMs       = Date.now();

    logger.info('PostMeetingAnalysis: started', { correlationId, tenantId, meetingId });

    // Load all context in parallel — includes existing recs from both phases for dedup
    const [tenant, amRoster, findings, openTasksResult, existingPostRecsResult, existingPreRecsResult] = await Promise.all([
      customerRepository.findById(tenantId),
      tenantAssignmentRepository.findByTenant(tenantId),
      FindingsProvider.getNormalized(tenantId),
      db.query(
        `SELECT title, remediation_status, owner_name, due_date, carry_forward_count
         FROM   tasks
         WHERE  tenant_id = $1
           AND  remediation_status NOT IN ('closed', 'completed', 'escalated')
         ORDER  BY COALESCE(due_date, created_at) ASC
         LIMIT  20`,
        [tenantId]
      ),
      db.query(
        `SELECT title, approval_status
         FROM   ai_task_recommendations
         WHERE  meeting_id    = $1
           AND  analysis_type = 'post_meeting'
           AND  approval_status IN ('approved', 'rejected')`,
        [meetingId]
      ),
      // Pre-meeting recs for this meeting — included regardless of approval_status so
      // we never regenerate the same task in the post-meeting phase even if still pending.
      db.query(
        `SELECT title
         FROM   ai_task_recommendations
         WHERE  meeting_id    = $1
           AND  analysis_type = 'pre_meeting'`,
        [meetingId]
      ),
    ]);

    if (!tenant) {
      throw Object.assign(new Error(`Tenant ${tenantId} not found`), { statusCode: 404 });
    }

    const openTasks = openTasksResult.rows.map((r) => ({
      title:             r.title,
      remediationStatus: r.remediation_status,
      ownerName:         r.owner_name,
      dueDate:           r.due_date,
      carryForwardCount: r.carry_forward_count,
    }));

    // Post-meeting: approved/rejected recs already handled by AM — don't regenerate.
    // Pre-meeting: all recs regardless of approval — prevents same task in both phases.
    const existingPostRecs = existingPostRecsResult.rows.map((r) => ({ title: r.title }));
    const existingPreRecs  = existingPreRecsResult.rows.map((r) => ({ title: r.title }));
    const allExistingRecs  = [...existingPostRecs, ...existingPreRecs];

    const provider = makePrimaryProvider(modelOverride);

    // Use action items AND follow-up actions as source for post-meeting tasks.
    // risksDiscussed is excluded — llama3.2 still generates generic security topics
    // (MFA, monitoring) as risks even when not explicitly discussed.
    // followUpActions were previously excluded for the same reason, but NoteStructurer
    // now applies a structural quality gate + transcript vocab check before storing them,
    // so only specific, meeting-grounded follow-ups reach this point.
    const { actionItems: _rawActionItems = [], followUpActions: _rawFollowUps = [], _highNonAscii = false, _speakerNames = [] } = structuredNotes || {};
    // Normalize vendor product names (fixes ASR garbles like "Junk Cloud" → "JumpCloud")
    // Applied here so re-analysis of already-stored meeting notes also benefits.
    const actionItems    = _rawActionItems.map(_normalizeProductNames);
    const followUpActions = _rawFollowUps.map(_normalizeProductNames);
    // Structural quality gate — rejects vague action items before they reach Ollama.
    // Checks sentence shape, not specific phrases, so it catches any generic output
    // the model produces regardless of exact wording.
    //
    // A usable action item must have all three:
    //   (1) Enough words to express WHO + WHAT + WHICH SYSTEM (≥7 words, ≥40 chars)
    //   (2) At least one named entity mid-sentence — a capitalized proper noun like
    //       a person's name or a system/platform name (JumpCloud, Azure AD, Harmony…)
    //   (3) Does NOT end on a generic tail word that signals the model ran out of
    //       specific content (e.g. "…this", "…task", "…settings", "…it", "…done")
    const GENERIC_TAILS = new Set([
      'this', 'it', 'that', 'these', 'those',
      'task', 'tasks', 'thing', 'things',
      'work', 'done', 'so',
    ]);

    // Security domain keywords that a valid action item must reference.
    // Filters hallucinated tasks like "Create new Mail ID" or "Verify Lenora"
    // that pass the structural checks but have no security-domain relevance.
    // The regex covers all security systems/areas discussed in MSSP meetings.
    const SECURITY_DOMAIN_RE = /\b(mfa|multi.factor|2fa|password|credential|identity|account|login|admin|privilege|jumpcloud|device|endpoint|mdm|usb|edr|firewall|check.?point|harmony|malware|threat|antivirus|crowdstrike|email|mailbox|forwarding|dkim|dmarc|spf|m365|sharepoint|azure|microsoft|vapt|pentest|vulnerability|patch|cve|ueba|siem|alert|monitor|phishing|training|awareness|nxg360|global.admin|policy|policies|compliance|dormant|inactive|license|billing|certificate|encryption|vpn|zscaler|server|cloud|backup|recovery|access.control|rbac|sso|saml|ldap)\b/i;
    const HAS_SECURITY_COUNT_RE = /\b\d+\s*(users?|devices?|endpoints?|accounts?|licenses?)\b/i;

    // F6 — suggestion/fragment pattern: after stripping "Person will ", if the remainder
    // starts with "try using / suggest / consider / explore if", it's a discussion fragment,
    // not a real commitment.
    const SUGGESTION_AFTER_WILL_RE = /^(try\s+(using|to|with|the)\s|suggest\s+\w|consider\s+\w|explore\s+(if\s|whether\s|\w+\s+if)|you\s+can\s+)/i;

    function isSpecificActionItem(text) {
      if (!text || typeof text !== 'string') return false;
      const trimmed = text.trim();
      if (trimmed.length < 40) return false;
      const words = trimmed.split(/\s+/);
      if (words.length < 7) return false;
      const tail = words[words.length - 1].toLowerCase().replace(/[.,!?;:]+$/, '');
      if (GENERIC_TAILS.has(tail)) return false;
      // F6: reject conversation suggestions masquerading as commitments
      const afterWill = trimmed.replace(/^(?:[A-Z][a-zA-Z0-9]*\s+){1,4}will\s+/i, '');
      if (SUGGESTION_AFTER_WILL_RE.test(afterWill)) return false;
      // For high non-ASCII (Hindi/Devanagari) transcripts the proper-noun gate is
      // skipped — Devanagari names/systems wouldn't pass it. Instead require that
      // the item references a known security area OR a numeric user/device count.
      // This filters hallucinated tasks ("Create new Mail ID", "Verify Lenora")
      // that pass the structural checks but have no security-domain relevance.
      if (_highNonAscii) {
        return SECURITY_DOMAIN_RE.test(trimmed) || HAS_SECURITY_COUNT_RE.test(trimmed);
      }
      // For normal transcripts: proper-noun gate + domain relevance check.
      const hasPropNoun = words.slice(1).some((w) => w.length >= 3 && /^[A-Z][a-zA-Z]/.test(w));
      if (!hasPropNoun) return false;
      if (!SECURITY_DOMAIN_RE.test(trimmed) && !HAS_SECURITY_COUNT_RE.test(trimmed)) return false;
      return true;
    }

    // Decision-implied action items: decisions containing "will be removed/installed/
    // completed/configured" are real follow-up commitments the AM must track, but
    // noteStructurer correctly categorises them as DECISIONS (passive form, no speaker).
    // Include them here so they become task recommendations alongside explicit action items.
    // Guards: must mention a specific security system/count AND be 40+ chars (avoids
    // generic agreements like "licenses will auto-renew yearly" becoming tasks).
    const decisionActionItems = (structuredNotes?.decisionsTaken || [])
      .filter((t) =>
        t &&
        typeof t === 'string' &&
        t.length > 40 &&
        /\bwill\s+be\s+(removed?|deleted?|install|configur|complet|shar|disabl|enabl|reset|clean)/i.test(t) &&
        /\b(admin|global.admin|mfa|edr|jumpcloud|check.?point|sop|patch|policy|policies|device|account|license|privilege)/i.test(t)
      )
      .map((t) => ({ text: t, type: 'decision_action' }));

    // Observational gap items: scan all note sections for numeric security-gap
    // statements ("27 devices have failed policies", "20 devices pending EDR") that
    // imply a required action but were not stated as explicit commitments.
    // These are typically placed in decisionsTaken/risksDiscussed by noteStructurer.
    const gapObservationItems = extractSecurityGapItems(structuredNotes);

    // Raw-transcript gap scan: applies the same SECURITY_GAP_PATTERNS directly on the
    // full transcript text and takes the LAST occurrence of each metric — the final
    // corrected count the speakers agreed on (e.g. "49 users" not the earlier "44").
    // Runs even when noteStructurer sections are sparse or empty.
    let transcriptGapItems = [];
    try {
      const txRow   = await db.query('SELECT transcript_text FROM meetings WHERE id = $1', [meetingId]);
      const rawText = txRow.rows[0]?.transcript_text || '';
      if (rawText.length > 500) {
        transcriptGapItems = extractNumericGapsFromTranscript(rawText);
        if (transcriptGapItems.length > 0) {
          logger.info('PostMeetingAnalysis: transcript gap scan', {
            correlationId, found: transcriptGapItems.length,
          });
        }
      }
    } catch (txErr) {
      logger.warn('PostMeetingAnalysis: transcript scan skipped', { correlationId, error: txErr.message });
    }

    // Explicit source items — [DELIVERABLE]-tagged follow-ups are handled separately below
    const sourceItems = [
      ...actionItems
        .filter((t) => t && !t.startsWith('[DELIVERABLE]') && isSpecificActionItem(t) && hasNonPersonReference(t, _speakerNames))
        .map((t) => ({ text: t, type: 'action_item' })),
      ...followUpActions
        .filter((t) => t && !t.startsWith('[DELIVERABLE]') && isSpecificActionItem(t) && hasNonPersonReference(t, _speakerNames))
        .map((t) => ({ text: t, type: 'follow_up' })),
      ...decisionActionItems,
      ...gapObservationItems,
      ...transcriptGapItems,
    ];

    // Domain-based enrichment — runs after explicit items are locked in
    const allMeetingText = [
      ...(actionItems || []), ...(followUpActions || []),
      ...(structuredNotes?.risksDiscussed || []), ...(structuredNotes?.decisionsTaken || []),
    ].join(' ');
    const detectedDomains = detectDomains(allMeetingText);

    // Deliverables: extracted by noteStructurer (DELIVERABLE: prefix) + rule-based standard set
    const deliverableItems = [
      ...followUpActions
        .filter(t => t && t.startsWith('[DELIVERABLE]'))
        .map(t => ({ text: t.replace(/^\[DELIVERABLE\]\s*/i, '').trim(), type: 'deliverable', isDeliverable: true }))
        .filter(({ text }) => text.length > 20),
      ...getStandardDeliverables(detectedDomains, allMeetingText)
        .map(t => ({ text: t, type: 'deliverable', isDeliverable: true })),
    ].filter(({ text }, idx, arr) =>
      arr.findIndex(a => normalizeTitle(a.text) === normalizeTitle(text)) === idx
    );

    // Single Ollama call for non-deliverable implied tasks (Zscaler rollout, VAPT remediation, etc.)
    const impliedTexts = await deriveImpliedTasks({
      summary:       structuredNotes?.summary || '',
      risks:         structuredNotes?.risksDiscussed || [],
      decisions:     structuredNotes?.decisionsTaken || [],
      domains:       detectedDomains,
      explicitTexts: sourceItems.map(s => s.text),
      provider,
      correlationId,
    });
    const impliedItems = impliedTexts
      .filter(t => !isDuplicate(t, allExistingRecs))
      .map(t => ({ text: t, type: 'implied', isImplied: true }));

    // Semantic dedup of explicit source items: collapse near-duplicate action items
    // that describe the same commitment but with slight wording differences (common
    // when a single topic is mentioned multiple times across a long meeting).
    // Deliverables and implied items are kept as-is — they are already limited in count.
    const deduplicatedSourceItems = semanticDeduplicateSourceItems(sourceItems);

    // Full source set: deduplicated explicit + deliverables + implied
    const allSourceItems = [...deduplicatedSourceItems, ...deliverableItems, ...impliedItems];

    // Skip items already covered by any existing rec (pre or post phase)
    const filteredItems = allSourceItems.filter(
      (s) => !isDuplicate(s.text, allExistingRecs)
    );

    logger.info('PostMeetingAnalysis: source items', {
      correlationId,
      explicitRaw:         sourceItems.length,
      explicitAfterDedup:  deduplicatedSourceItems.length,
      gapObservations:     gapObservationItems.length,
      transcriptGaps:      transcriptGapItems.length,
      deliverables:        deliverableItems.length,
      implied:             impliedItems.length,
      total:               allSourceItems.length,
      filtered:            filteredItems.length,
      domains:             detectedDomains,
    });

    let validated;

    if (filteredItems.length > 0) {
      // Direct-mapping path: every valid source item becomes a task recommendation.
      // Owner/severity/category derived by keyword rules — no Ollama call, no selectivity.
      // Replaces generatePerItem() which called Ollama in batches of 5 and asked it to
      // pick the "most critical" items — producing only 6 tasks from 38 action items.
      const rawResults = await directMapItems({
        sourceItems: filteredItems, tenant, openTasks,
        speakerNames: _speakerNames,
      });

      // Combined dedup: drop results matching open tasks OR any existing rec (pre or post).
      const allReference = [...openTasks, ...allExistingRecs];
      const deduped = rawResults.filter((r) => !isDuplicate(r.title, allReference));

      // Intra-batch dedup: drop results where the normalised title is identical
      // to one already seen. Plan-prefix dedup was removed — security tasks for
      // different issues share boilerplate action plan openings (e.g. "access the
      // jumpcloud admin portal...") but are genuinely distinct tasks.
      const seenInBatch = new Set();
      const batchDeduped = deduped.filter((r) => {
        const titleKey = normalizeTitle(r.title);
        if (seenInBatch.has(titleKey)) return false;
        seenInBatch.add(titleKey);
        return true;
      });

      // Edge case: if every result matched an existing entry, keep them for review
      // rather than returning an empty set to the AM — but still dedup within the batch.
      if (batchDeduped.length > 0) {
        validated = batchDeduped;
      } else {
        const seenFallback = new Set();
        validated = rawResults.filter((r) => {
          const titleKey = normalizeTitle(r.title);
          if (seenFallback.has(titleKey)) return false;
          seenFallback.add(titleKey);
          return true;
        });
      }
    } else if (allSourceItems.length === 0) {
      // Notes had no extractable content (empty input, "nothing discussed", very short text, etc.).
      // Complete immediately with zero tasks — do NOT fall back to NXG360 findings.
      // Generating tasks from security findings when the AM explicitly noted nothing
      // was discussed is misleading and produces tasks the AM didn't ask for.
      logger.info('PostMeetingAnalysis: no content in meeting notes — completing with zero tasks', { correlationId });
      validated = [];
    } else {
      // All source items were already covered by existing approved/rejected recs
      // (allSourceItems.length > 0 but filteredItems.length === 0 after dedup).
      // Batch fallback so the AM still sees recommendations when re-running analysis.
      logger.info('PostMeetingAnalysis: all items already covered — using batch fallback', { correlationId });
      const allReference = [...openTasks, ...existingPostRecs];
      const batchPrompt  = PromptBuilder.buildPostMeeting({ tenant, structuredNotes, findings, openTasks });
      const batchResults = await generateWithFallback({ provider, prompt: batchPrompt, correlationId });
      const batchDeduped = batchResults.filter((r) => !isDuplicate(r.title, allReference));
      validated = (batchDeduped.length > 0 ? batchDeduped : batchResults)
        .map((r) => ({ ...r, _meta: { itemType: 'batch', itemPreview: null } }));
    }

    // Quality gate: drop tasks with truncated titles or single-step action plans.
    // llama3.2 occasionally produces these when the input is ambiguous or too short.
    // Fall back to unfiltered set only if every result fails — avoids empty output.
    const qualityPassed = validated.filter(isQualityOk);
    const toInsert = qualityPassed.length > 0 ? qualityPassed : validated;

    logger.info('PostMeetingAnalysis: AI responded', {
      correlationId,
      recommendationCount: validated.length,
      qualityPassed:       toInsert.length,
      qualityDropped:      validated.length - toInsert.length,
      durationMs: Date.now() - startMs,
    });

    // Atomic write: all recommendations + meeting_notes status in one transaction
    const savedRecs = await withTransaction(async (client) => {
      // Clear any pending recommendations from previous runs before inserting the new set.
      // Approved/rejected recommendations are intentionally preserved — only pending ones
      // are replaced so the AM always sees a fresh, non-duplicated list after re-analysis.
      await client.query(
        `DELETE FROM ai_task_recommendations
         WHERE  meeting_id    = $1
           AND  analysis_type = 'post_meeting'
           AND  approval_status = 'pending'`,
        [meetingId]
      );

      const recs = [];

      for (const rec of toInsert) {
        // Deliverables are always NxgSecure-produced — enforce AM ownership regardless of what Ollama returned.
        const isDeliverable = rec._meta?.itemType === 'deliverable';

        // Non-deliverable items with no owner in their text (mainly LLM-synthesized
        // "implied" tasks — e.g. "Verify NSG support ID..." names no one) previously
        // reached the AM with recommended_owner left blank, even though every
        // deliverable already had a safe default. Falling back to the tenant's AM
        // here mirrors that same pattern: an unattributed task defaults to the
        // person who owns triaging it, rather than shipping with no owner at all.
        const enforcedOwner = isDeliverable
          ? (tenant.accountManagerName || rec._meta?.extractedOwner || rec.recommendedOwner || null)
          : (rec._meta?.extractedOwner || rec.recommendedOwner || tenant.accountManagerName || null);

        // Deterministic owner-type classification — never trust the AI's guess.
        // Deliverables always belong to the ACCOUNT_MANAGER (NxgSecure produces and shares them).
        // MSSP/security-team keywords → ACCOUNT_MANAGER.
        // Any name matching ANY AM assigned to this tenant (not just the primary) → ACCOUNT_MANAGER.
        // Any other named individual → CUSTOMER (they're committing on the customer side).
        const enforcedOwnerType = (() => {
          if (isDeliverable) return 'ACCOUNT_MANAGER';
          if (!enforcedOwner) return rec.recommendedOwnerType || null;
          if (/nxgsecure|mssp|security ops|soc team|account manager/i.test(enforcedOwner)) return 'ACCOUNT_MANAGER';
          if (isKnownAccountManagerName(enforcedOwner, amRoster)) return 'ACCOUNT_MANAGER';
          return 'CUSTOMER';
        })();

        const { rows } = await client.query(
          `INSERT INTO ai_task_recommendations (
             tenant_id, meeting_id, title, action_plan, business_impact,
             remediation_strategy, risk_reduction_score, severity, category,
             recommended_owner, recommended_owner_type, due_date_suggestion,
             ai_model, ai_confidence, raw_ai_response, correlation_id, analysis_type
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'post_meeting')
           RETURNING id, title, severity, category, approval_status, analysis_type`,
          [
            tenantId,
            meetingId,
            rec.title,
            rec.actionPlan           || null,
            rec.businessImpact       || null,
            rec.remediationStrategy  || null,
            rec.riskReductionScore   || 0,
            rec.severity,
            rec.category             || null,
            enforcedOwner,
            enforcedOwnerType,
            rec.dueDateSuggestion ? rec.dueDateSuggestion.slice(0, 10) : null,
            provider.name,
            rec.aiConfidence != null ? rec.aiConfidence : null,
            JSON.stringify({
              correlationId,
              source:      rec._meta?.itemType === 'batch' ? 'post_meeting_batch' : 'post_meeting_direct_map',
              itemType:    rec._meta?.itemType    || null,
              itemPreview: rec._meta?.itemPreview || null,
            }),
            correlationId,
          ]
        );
        recs.push(rows[0]);
      }

      // Mark meeting_notes as completed inside the same transaction
      await client.query(
        `UPDATE meeting_notes
         SET    ai_status           = 'completed',
                processing_metadata = $1::jsonb,
                updated_at          = NOW()
         WHERE  meeting_id = $2`,
        [
          JSON.stringify({
            correlationId,
            recommendationCount: recs.length,
            durationMs:          Date.now() - startMs,
            completedAt:         new Date().toISOString(),
          }),
          meetingId,
        ]
      );

      return recs;
    });

    // Signal to the meeting row outside the transaction (non-critical flag)
    await setMeetingNotesStatus(meetingId, 'completed');

    auditLogRepository.create(tenantId, SYSTEM_ACTOR.email, 'post_meeting_ai_completed', {
      correlationId,
      meetingId,
      count:      savedRecs.length,
      durationMs: Date.now() - startMs,
      provider:   provider.name,
    }).catch(() => {});

    logger.info('PostMeetingAnalysis: complete', {
      correlationId,
      tenantId,
      meetingId,
      count:      savedRecs.length,
      durationMs: Date.now() - startMs,
    });

    return savedRecs;
  },

  /**
   * Fire-and-forget wrapper.
   * Acquires a DB-level processing lock before starting to prevent duplicate runs.
   * Resets the meeting to 'notes_added' on failure so the AM can retry by
   * re-submitting or re-uploading notes.
   *
   * @param {string} tenantId
   * @param {string} meetingId
   * @param {object} structuredNotes
   */
  /**
   * Fast re-run path: directly maps stored meeting_notes.action_items →
   * ai_task_recommendations with zero Ollama calls (< 5 seconds).
   * Used by reanalyze() when the meeting already has a good action_items set.
   * Each action item becomes one recommendation; owner/severity/category are
   * derived from the text using keyword rules, not LLM.
   */
  async fromStoredNotes({ tenantId, meetingId, storedNotes }) {
    const correlationId = randomUUID();
    const startMs       = Date.now();

    logger.info('PostMeetingAnalysis: fromStoredNotes started', { correlationId, tenantId, meetingId });

    const [tenant, amRoster, openTasksResult, existingPreRecsResult] = await Promise.all([
      customerRepository.findById(tenantId),
      tenantAssignmentRepository.findByTenant(tenantId),
      db.query(
        `SELECT title FROM tasks
         WHERE  tenant_id = $1
           AND  remediation_status NOT IN ('closed','completed','escalated')
         LIMIT  30`,
        [tenantId]
      ),
      db.query(
        `SELECT title FROM ai_task_recommendations
         WHERE  meeting_id = $1 AND analysis_type = 'pre_meeting'`,
        [meetingId]
      ),
    ]);

    if (!tenant) throw Object.assign(new Error(`Tenant ${tenantId} not found`), { statusCode: 404 });

    const { action_items = [], follow_up_actions = [] } = storedNotes;

    // Domain-based standard deliverable inference (no Ollama — rule-based only)
    const storedAllText = [...action_items, ...follow_up_actions].join(' ');
    const storedDomains = detectDomains(storedAllText);
    const stdDelivTexts = getStandardDeliverables(storedDomains, storedAllText);

    const allItems = [
      ...action_items.map((t) => ({ text: t, type: 'action_item', isDeliverable: false })),
      ...follow_up_actions.map((t) => ({
        text:          t,
        type:          'follow_up',
        isDeliverable: typeof t === 'string' && t.startsWith('[DELIVERABLE]'),
      })),
      // Standard deliverables inferred from which security domains were discussed
      ...stdDelivTexts.map((t) => ({ text: t, type: 'deliverable', isDeliverable: true })),
    ];

    const existingOpenTasks = openTasksResult.rows.map((r) => ({ title: r.title }));
    const existingPreRecs   = existingPreRecsResult.rows.map((r) => ({ title: r.title }));
    // Filters applied before task generation (mirrors noteStructurer post-extraction filter):
    //   F1: in-meeting screen-share notes — never real tasks
    //   F2: "within 0 minutes/seconds" — NoteStructurer parsing artifact
    //   F3: title < 20 chars after stripping owner name + date artifacts — too vague
    //   F4: >= 70% word-overlap with an already-kept title — semantic near-duplicate
    const SCREEN_SHARE_RE   = /\bshare\b.{0,30}\bscreen\b|\b(his|my|the)\s+screen\b/i;
    const ZERO_TIME_RE      = /\bwithin\s+\d+\s+(minutes?|seconds?)\b/i;
    const NONE_MENTIONED_RE = /^none\s+mentioned|^no\s+\w{1,20}\s+mentioned|^not\s+mentioned|^nothing\s+(to\s+note|mentioned)/i;

    function wordOverlapRatio(a, b) {
      const words = (s) => new Set(
        s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2)
      );
      const wa = words(a), wb = words(b);
      if (!wa.size || !wb.size) return 0;
      return [...wa].filter(w => wb.has(w)).length / Math.min(wa.size, wb.size);
    }

    const seenTitleKeys = new Set();
    const keptTitles    = [];   // for semantic dedup (F4)
    const toInsert      = [];

    for (const { text, type, isDeliverable } of allItems) {
      if (!text || typeof text !== 'string' || text.trim().length < 10) continue;

      if (isDeliverable) {
        // Deliverables bypass content filters — they are NxgSecure-produced reports/docs
        const rawText = text.replace(/^\[DELIVERABLE\]\s*/i, '').trim();
        if (!rawText || rawText.length < 20) continue;
        const titleKey = normalizeTitle(rawText);
        if (seenTitleKeys.has(titleKey)) continue;
        seenTitleKeys.add(titleKey);
        keptTitles.push(rawText);
        const amOwner    = tenant.accountManagerName || null;
        const actionPlan = buildStoredItemActionPlan(rawText, amOwner);
        toInsert.push({
          title:      rawText,
          actionPlan,
          severity:   'medium',
          category:   'Deliverable',
          owner:      amOwner,
          ownerType:  'ACCOUNT_MANAGER',
          dueDateStr: addDaysFromSeverity('medium'),
          riskScore:  55,
          strategy:   'long_term_fix',
          type,
        });
        continue;
      }

      // Normal item processing
      if (text.trim().length < 20) continue;
      if (SCREEN_SHARE_RE.test(text))          continue;  // F1
      if (ZERO_TIME_RE.test(text))             continue;  // F2
      if (NONE_MENTIONED_RE.test(text.trim())) continue;  // F5: extraction artifact

      const title = buildTaskTitleFromStoredItem(text);

      if (!title || title.length < 20) continue; // F3

      const titleKey = normalizeTitle(title);
      if (seenTitleKeys.has(titleKey)) continue;
      if (isDuplicate(title, [...existingOpenTasks, ...existingPreRecs])) continue;
      if (keptTitles.some(kt => wordOverlapRatio(title, kt) >= 0.75)) continue; // F4

      seenTitleKeys.add(titleKey);
      keptTitles.push(title);

      // Fall back to the primary AM when the text names no one — same reasoning
      // as the deliverable branch above: an unattributed task should default to
      // its triage owner, not ship with no owner at all.
      const owner    = extractOwnerFromStoredItem(text) || tenant.accountManagerName || null;
      const severity = classifySeverityFromText(text);
      const category = classifyCategoryFromText(text);

      const actionPlan  = buildStoredItemActionPlan(text, owner);
      const dueDateStr  = addDaysFromSeverity(severity);
      const riskScore   = { critical: 92, high: 78, medium: 55, low: 35 }[severity] || 55;
      const strategy    = severity === 'critical' || severity === 'high' ? 'immediate_fix' : 'long_term_fix';

      const ownerType = (() => {
        if (!owner) return null;
        if (/nxgsecure|mssp|security ops|soc team|account manager/i.test(owner)) return 'ACCOUNT_MANAGER';
        if (isKnownAccountManagerName(owner, amRoster)) return 'ACCOUNT_MANAGER';
        return 'CUSTOMER';
      })();

      toInsert.push({ title, actionPlan, severity, category, owner, ownerType, dueDateStr, riskScore, strategy, type });
    }

    logger.info('PostMeetingAnalysis: fromStoredNotes items prepared', {
      correlationId,
      total:    allItems.length,
      toInsert: toInsert.length,
    });

    const savedRecs = await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM ai_task_recommendations
         WHERE  meeting_id    = $1
           AND  analysis_type = 'post_meeting'
           AND  approval_status = 'pending'`,
        [meetingId]
      );

      const recs = [];
      for (const item of toInsert) {
        const { rows } = await client.query(
          `INSERT INTO ai_task_recommendations (
             tenant_id, meeting_id, title, action_plan, business_impact,
             remediation_strategy, risk_reduction_score, severity, category,
             recommended_owner, recommended_owner_type, due_date_suggestion,
             ai_model, ai_confidence, raw_ai_response, correlation_id, analysis_type
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'post_meeting')
           RETURNING id, title, severity, category, approval_status, analysis_type`,
          [
            tenantId, meetingId,
            item.title, item.actionPlan,
            null,          // businessImpact — not generated in fast path
            item.strategy,
            item.riskScore,
            item.severity,
            item.category  || null,
            item.owner     || null,
            item.ownerType || null,
            item.dueDateStr || null,
            'direct-mapping', null,
            JSON.stringify({ correlationId, source: 'stored_action_items', type: item.type }),
            correlationId,
          ]
        );
        recs.push(rows[0]);
      }

      await client.query(
        `UPDATE meeting_notes
         SET    ai_status           = 'completed',
                processing_metadata = $1::jsonb,
                updated_at          = NOW()
         WHERE  meeting_id = $2`,
        [
          JSON.stringify({
            correlationId,
            recommendationCount: recs.length,
            durationMs:          Date.now() - startMs,
            completedAt:         new Date().toISOString(),
            source:              'stored_action_items',
          }),
          meetingId,
        ]
      );

      return recs;
    });

    await setMeetingNotesStatus(meetingId, 'completed');

    auditLogRepository.create(tenantId, SYSTEM_ACTOR.email, 'post_meeting_ai_completed', {
      correlationId, meetingId, count: savedRecs.length,
      durationMs: Date.now() - startMs, provider: 'direct-mapping',
    }).catch(() => {});

    logger.info('PostMeetingAnalysis: fromStoredNotes complete', {
      correlationId, tenantId, meetingId,
      count: savedRecs.length, durationMs: Date.now() - startMs,
    });

    return savedRecs;
  },

  /**
   * Fire-and-forget wrapper for fromStoredNotes.
   * Acquires the same DB-level processing lock as autoAnalyze so both paths
   * are mutually exclusive — only one can run at a time per meeting.
   */
  autoAnalyzeFromStoredNotes({ tenantId, meetingId, storedNotes }) {
    setImmediate(async () => {
      let locked = false;
      try {
        locked = await claimProcessingLock(meetingId);
      } catch (lockErr) {
        logger.error('PostMeetingAnalysis: fromStoredNotes failed to acquire lock', {
          tenantId, meetingId, error: lockErr.message,
        });
        return;
      }

      if (!locked) {
        logger.info('PostMeetingAnalysis: fromStoredNotes skipped — notes_status not "notes_added"', {
          tenantId, meetingId,
        });
        return;
      }

      try {
        await postMeetingAnalysisService.fromStoredNotes({ tenantId, meetingId, storedNotes });
      } catch (err) {
        logger.error('PostMeetingAnalysis: fromStoredNotes analysis failed', {
          tenantId, meetingId, error: err.message, stack: err.stack,
        });
        await Promise.allSettled([
          setMeetingNotesStatus(meetingId, 'notes_added'),
          db.query(
            `UPDATE meeting_notes SET ai_status = 'failed', updated_at = NOW() WHERE meeting_id = $1`,
            [meetingId]
          ),
        ]);
      }
    });
  },

  autoAnalyze(tenantId, meetingId, structuredNotes, modelOverride) {
    setImmediate(async () => {
      // Atomically claim the lock; bail out if already processing or completed
      let locked = false;
      try {
        locked = await claimProcessingLock(meetingId);
      } catch (lockErr) {
        logger.error('PostMeetingAnalysis: failed to acquire lock', {
          tenantId, meetingId, error: lockErr.message,
        });
        return;
      }

      if (!locked) {
        logger.info('PostMeetingAnalysis: skipped — notes_status not "notes_added"', {
          tenantId, meetingId,
        });
        return;
      }

      try {
        await postMeetingAnalysisService.analyze({ tenantId, meetingId, structuredNotes });
      } catch (err) {
        logger.error('PostMeetingAnalysis: analysis failed', {
          tenantId,
          meetingId,
          error: err.message,
          stack: err.stack,
        });

        // Reset so the AM can retry
        await Promise.allSettled([
          setMeetingNotesStatus(meetingId, 'notes_added'),
          db.query(
            `UPDATE meeting_notes
             SET    ai_status           = 'failed',
                    processing_metadata = jsonb_set(
                      COALESCE(processing_metadata, '{}'),
                      '{lastError}',
                      $1::jsonb
                    ),
                    updated_at = NOW()
             WHERE  meeting_id = $2`,
            [JSON.stringify(err.message), meetingId]
          ),
        ]);
      }
    });
  },
};

module.exports = postMeetingAnalysisService;
