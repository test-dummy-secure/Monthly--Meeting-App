'use strict';

const providerFactory = require('../ai/providerFactory');
const logger          = require('../../utils/logger');

const CHUNK_SIZE            = 6000;   // chars per Mode-C chunk (sections-detected path)
const SEGMENT_SIZE          = 7000;   // chars per Mode-D segment
const OVERLAP               = 500;    // overlap between segments — prevents items at cut points being missed
const MAX_SEGMENTS          = 8;      // caps coverage at ~52 500 chars (~8+ hour meeting)
// Mode E: transcripts ≤ 30 000 chars — safe for single-pass within numCtx=16384
const SINGLE_PASS_THRESHOLD  = 30000;
// Mode F: hierarchical pass-1 segment sizes — large enough to capture cross-paragraph
// context but small enough to fit input + 900 output tokens inside numCtx=8192
const HIERARCHICAL_SEG_HINDI = 6000;  // Hinglish/Devanagari: more tokens per char
const HIERARCHICAL_SEG_EN    = 8000;  // Latin/English: ~2000 tokens/segment, reliably within CPU timeout
// WHY 8000 not 20000: on CPU-only Ollama, 20000-char segments (≈5000 tokens) take ~8-10 min
// to prefill, exceeding the 10-min OLLAMA_TIMEOUT. 8000 chars ≈ 2000 tokens ≈ 3 min/segment —
// safe margin. For 69KB English transcript: 9 segments × 3 min = 27 min pass-1 vs 0% success
// rate at 20KB segments on this machine.

// ── Product name normalization ────────────────────────────────────────────────
// Speech-to-text (Fireflies ASR) commonly garbles vendor product names.
// These corrections are applied to all extracted action items and follow-up actions
// before they are stored in meeting_notes, so downstream task generation always
// sees the correct product name and can produce technically accurate action plans.
const PRODUCT_NAME_CORRECTIONS = [
  [/\bjunk[\s-]cloud\b/gi, 'JumpCloud'],   // most common: "Junk Cloud" for JumpCloud
  [/\bjump[\s-]cloud\b/gi, 'JumpCloud'],   // space-separated form
  [/\bcrowd[\s-]strike\b/gi, 'CrowdStrike'],
  [/\bsentinel[\s-]one\b/gi, 'SentinelOne'],
  [/\bcheck[\s-]point\b/gi, 'Check Point'], // normalise both hyphenated and space forms
  [/\bbit[\s-]locker\b/gi, 'BitLocker'],
  [/\bjump\s+cloud\b/gi, 'JumpCloud'],      // extra whitespace variant
];

function normalizeProductNames(text) {
  if (!text || typeof text !== 'string') return text;
  return PRODUCT_NAME_CORRECTIONS.reduce((s, [re, name]) => s.replace(re, name), text);
}

function makeProvider(modelOverride) {
  return providerFactory.getPrimaryProvider(modelOverride);
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function structurePrompt(text, sections = {}) {
  const hasSections = sections && Object.values(sections).some(Boolean);

  if (hasSections) {
    const labeled = [
      sections.summary     && `=== MEETING SUMMARY ===\n${sections.summary}`,
      sections.actionItems && `=== ACTION ITEMS ===\n${sections.actionItems}`,
      sections.decisions   && `=== DECISIONS TAKEN ===\n${sections.decisions}`,
      sections.risks       && `=== RISKS DISCUSSED ===\n${sections.risks}`,
      sections.followUp    && `=== FOLLOW-UP ACTIONS ===\n${sections.followUp}`,
    ].filter(Boolean).join('\n\n');

    return `You are converting pre-labelled meeting sections into a JSON object.
Each section is clearly marked with === HEADING ===.
Return ONLY a valid JSON object — no markdown, no explanation.

${labeled}

Map each section to its matching JSON field:
- "MEETING SUMMARY"   → summary
- "ACTION ITEMS"      → actionItems
- "DECISIONS TAKEN"   → decisionsTaken
- "RISKS DISCUSSED"   → risksDiscussed (security risks/threats/vulnerabilities only)
- "FOLLOW-UP ACTIONS" → followUpActions (scheduled tasks/reviews, NOT risks)

CRITICAL RULE — every array entry must be a complete, self-contained sentence that preserves ALL specific details from the source text:
- Named people or teams — use the exact names and teams mentioned
- Specific systems, servers, domains, or tools — use the exact names from the text
- Dates or deadlines: ONLY include a date if it is EXPLICITLY stated in the source text. Do NOT invent, assume, or estimate any date.
- Quantities or scope — use the exact numbers and scope from the text
Do NOT compress to headlines. Do NOT drop names or systems. Do NOT add any date that is not in the source.

Required JSON format:
{
  "summary": "2-3 sentences describing WHAT THIS SPECIFIC MEETING COVERED — name the actual topics, key people, and outcomes from the sections above. BAD: 'Review of meeting notes to track action items.' Write a specific summary naming the real systems, tools, and people from the sections provided — do NOT copy this instruction text.",
  "actionItems": ["Complete sentence: who will do exactly what, on which system, by when"],
  "decisionsTaken": ["Complete sentence describing the decision, what was approved, and any conditions"],
  "risksDiscussed": ["Complete sentence: what the risk is, which system is affected, and the business impact"],
  "followUpActions": ["Complete sentence: what will be done next, by whom, and when"]
}

Use empty arrays [] for any field whose section is absent or empty.`;
  }

  return `You are extracting structured data from meeting notes.
Return ONLY a valid JSON object with exactly these fields — no markdown, no explanation.
IMPORTANT: The notes may be in English, Hindi, Hinglish (mixed Hindi-English), or any combination. Extract ALL relevant items regardless of language. Preserve specific details (names, counts, systems, deadlines) exactly as stated.

MEETING NOTES:
${text}

Field definitions:
- actionItems: tasks assigned to specific people — include the person's name, the exact system or process, and any deadline stated
- decisionsTaken: formal approvals or agreements — include what was approved, by whom, and any conditions
- risksDiscussed: security risks, threats, or vulnerabilities raised — include the affected system, the nature of the risk, and business impact
- followUpActions: scheduled items to revisit — include who will do it, what specifically, and when
- Use empty arrays [] when nothing found for a field

CRITICAL RULE — every array entry must be a COMPLETE SENTENCE that preserves ALL specific details from the notes:
- Named people or teams — use the exact names mentioned
- Specific systems, servers, domains, tools — use the exact names from the notes
- Dates or deadlines: ONLY include a date if it is EXPLICITLY stated in the source text. Do NOT invent, assume, or add any date not present in the notes.
- Quantities or scope — use the exact numbers from the notes
Do NOT write one-word or headline-style entries. Every entry must read as a full, standalone sentence. Do NOT add any date that is not in the source.

Required JSON format:
{
  "summary": "2-3 sentences describing WHAT THIS SPECIFIC MEETING COVERED — name the actual topics, people, and outcomes from the notes above. BAD: 'Review of meeting notes to track action items.' Write a specific summary naming the real systems, tools, and people mentioned in this specific meeting — do NOT copy this instruction text.",
  "actionItems": ["Complete sentence preserving all context from the notes"],
  "decisionsTaken": ["Complete sentence preserving all context from the notes"],
  "risksDiscussed": ["Complete sentence preserving all context from the notes"],
  "followUpActions": ["Complete sentence preserving all context from the notes"]
}`;
}

// Extracts typed items from one segment of a meeting document.
// Works for transcripts (speaker dialogue), MoM prose, or any unstructured format.
// Each item carries a type prefix (ACTION/RISK/DECISION/FOLLOWUP) so the final
// categorisation pass can bucket them without re-reading the raw document.
function documentSegmentPrompt(chunk, idx, total, speakerNames = [], meetingContext = null) {
  const nameConstraint = speakerNames.length > 0
    ? `\n7. VERIFIED PARTICIPANTS: ${speakerNames.slice(0, 12).join(', ')}. ONLY attribute actions to these names — do NOT use any other person names not in this list.`
    : '';

  // Meeting context block: tells the model what this meeting is about BEFORE extraction.
  // This prevents the model from using its own MSSP knowledge to hallucinate topics
  // that were never discussed (e.g. extracting VAPT tasks from a Teams-only meeting).
  const contextBlock = meetingContext
    ? `\nMEETING CONTEXT (established from full transcript — use this to stay on-topic):
Primary Topic: ${meetingContext.primaryTopic}
Purpose: ${meetingContext.meetingPurpose || 'Security review meeting'}
Topics discussed in this meeting: ${(meetingContext.keyTopics || []).join(', ') || 'See transcript'}

SCOPE RULE: Extract ONLY items related to the topics listed above.
If you find a reference to a topic NOT in this meeting's scope, DO NOT extract it.
You are NOT allowed to extract items about security domains that were not discussed in this meeting.\n`
    : '';

  return `You are extracting action items, risks, decisions, and follow-ups from part ${idx + 1} of ${total} of a meeting document.
The document may be a Fireflies meeting transcript, minutes of meeting (MoM), or any other meeting notes format.
The text may be in English, Hindi, Hinglish (mixed Hindi-English), or any combination — extract ALL relevant items regardless of language.
Return ONLY a valid JSON object — no markdown, no explanation.
${contextBlock}

TRANSCRIPT QUALITY NOTE — read carefully before extracting:
- Speech-to-text transcripts often contain garbled words, cut-off sentences, or filler words ("um", "uh", "like"). Focus on the INTENT and meaning of what was said, not the exact literal text.
- An action item may span TWO speaker turns: if speaker A says "can you fix the JumpCloud settings?" and speaker B responds "yes, I'll do that by Friday" — record it as one ACTION item attributed to speaker B.
- Incomplete sentences or half-words are common in transcripts. Use surrounding context to reconstruct the full meaning before extracting.
- For Hinglish commitments: translate the commitment to English using the actual speaker's name from the VERIFIED PARTICIPANTS list and the actual system or tool they mentioned in the transcript. NEVER copy any name or action from these instructions into your output — only use real names and real systems from the transcript segment above.
- PURE HINDI (Devanagari script) TRANSCRIPTS: Recognize future commitments by Hindi verb patterns — करेंगे / कर देंगे (will do/complete), भेजेंगे (will send), देखेंगे (will check/review), configure कर देंगे (will configure), setup कर देंगे (will set up), बात करेंगे (will coordinate), share करेंगे / भेज देंगे (will share/send). Example: if Rahul says "मैं इसे configure कर दूँगा" extract as "ACTION: Rahul will configure [the system being discussed]." SKIP past/completed: कर दिया (done), हो गया (it is done), हो चुका है (already done), किया था (had done). Agreements like "ठीक है", "हाँ करेंगे", "बिल्कुल" following a request also signal a commitment — extract as ACTION attributed to whoever agreed. ALL output items must be written in English regardless of transcript language.
- SKIP meta-statements about the meeting process itself: do NOT extract items where someone says they will "send the action points", "share the generated tasks", "send this AI-generated list", "send the MOM after it is generated by the tool", or any statement that refers to sharing items produced BY THIS RECORDING TOOL. These are housekeeping statements, not real business tasks. Only extract real business commitments that involve systems, customers, or work outside this meeting.
- Ignore transcript artifacts like "[inaudible]", timestamps, and filler words. Extract the substance.

For each item you find, start with its type prefix:
- "ACTION: "   — a task someone committed to do
- "RISK: "     — a security risk, threat, or vulnerability mentioned
- "DECISION: " — a formal agreement or commitment to a specific course of action. Must include WHAT was decided AND a forward-looking verb: "agreed to remove", "decided to enforce", "will proceed with", "approved to disable", "committed to implement". Do NOT extract status observations like "X is okay", "X is fine", "no issues with X", "X is acceptable", "X has no issues now" — those are status updates, not decisions. HINDI/HINGLISH DECISION SIGNALS: "ठीक है" / "हाँ ठीक है" following a specific proposal to DO something = DECISION. Write the specific action that was agreed upon.
- "FOLLOWUP: " — a scheduled review or follow-on task
- "DELIVERABLE: " — a report, document, credentials, or artifact the SECURITY SERVICE PROVIDER (NxgSecure/MSSP) will produce and share with the customer. Use for: "will share the [X] report", "will send [Y] credentials", "will provide [Z] list to customer", "will deliver [W] document". Only for things the security team produces FOR the customer — not for customer-side action items.
- "CONTEXT: "  — ALWAYS include exactly one: a 15-25 word plain-English sentence describing what THIS segment is about. Do NOT wrap in quotes or JSON. Do NOT start with "The discussion", "The meeting", or "This segment". Start with the actual system or topic name from the segment, then state the key fact or count you found. Use only real content from the segment — do NOT copy any example text into your output.

CRITICAL RULES:
1. Every ACTION or FOLLOWUP item must include:
   - WHO: the named person or team responsible (REQUIRED)
   - WHAT: the specific committed action using an action verb (investigate/verify/share/enable/schedule/resolve/finalize/review/assign/re-push/validate/audit)
   - WHICH SYSTEM and exact counts: include the tool or platform name AND any specific numbers stated in the transcript (e.g. "36 devices missing Check Point EDR", "434 users in Harmony Email", "9 users without MFA", "47 users with expired passwords"). NEVER write "certain users", "some devices", or "a few" — use the exact count from the transcript. NUMBER ACCURACY: write every digit exactly as stated — never split "13" into "1", never drop digits, never approximate. If multiple counts appear ("522 in May, 2 in June, 13 in July"), include ALL of them in the item.
2. MANDATORY MULTI-TOPIC SCAN — this segment may cover several different topics. For EACH distinct topic area in THIS meeting's scope where you find a commitment, extract a SEPARATE ACTION item. If THREE distinct topics have commitments → extract THREE separate ACTION items. NEVER merge different topics into one item.
   MANDATORY DECISION SCAN — after extracting ACTIONs, re-read the segment for formal agreements. Extract a DECISION item for each topic where participants formally agreed to a course of action. Common Hindi/English signals: "we agreed to Y", "it is confirmed that Z", "ठीक है [specific action agreed]". Only extract DECISIONS about topics that are in THIS meeting's scope.
3. If you cannot identify WHO and WHAT — return {"items": []} for this segment. NEVER write vague entries like "will handle this" or "will do this".
4. If someone agrees to do something in response to a request, record it as an ACTION attributed to the person who agreed.
   HINDI COMMITMENT SIGNALS — the speaker who says any of these is the ACTION owner, not the speaker who described the problem: "हाँ करेंगे" / "मैं करूँगा" / "हम कर देंगे" / "ठीक है मैं देखता हूँ" / "बिल्कुल" / "हाँ मैं देख लेता हूँ" / "मैं check करूँगा" / "share करेंगे" / "send कर देंगे". RULE: The person who described the problem ≠ the owner. Only the person who said they will DO it is the owner.
5. Only include items actually stated or clearly implied — do not invent details not present.
6. If nothing qualifies, return {"items": []}.${nameConstraint}

MEETING DOCUMENT SEGMENT:
${chunk}

COMPREHENSION-FIRST FORMAT — Three mandatory steps:

STEP 1 — READ the segment above.
STEP 2 — Write what you understood in the "understood" field (10-20 words, based ONLY on what you just read above — not from memory or training data).
STEP 3 — Extract items that are DIRECTLY EVIDENCED by the text above. If you cannot point to a specific sentence in the segment where something was said or agreed, do NOT include it.

SELF-CHECK before finalising: Does each item in "items" match a real statement in the segment? If not, remove it.

{
  "understood": "[What this specific segment is actually about — start with the main topic or system name you read]",
  "items": [
    "ACTION: [person name] will [action verb] [specific system/tool + exact count from segment].",
    "ACTION: [different person or different system] will [action verb] [different task].",
    "RISK: [system from this segment] has [specific gap] affecting [exact count].",
    "DECISION: [formal agreement with forward-looking verb — agreed to / decided to / approved to].",
    "FOLLOWUP: [person] will [scheduled action] [by date ONLY if explicitly stated]."
  ]
}

Rules: (1) "understood" is mandatory — fill it with what you READ, not what you know. (2) Items must be consistent with your "understood" description — if an item references a topic not in "understood", skip it. (3) Include MULTIPLE ACTION items when the segment has multiple distinct commitments. (4) Omit any item type with no real match in the segment text.`;
}

// Categorises the merged, deduplicated list of prefixed items into the canonical
// 5-field JSON structure and generates an overall summary.
function documentCategorizationPrompt(items, contextSentences = []) {
  const itemList     = items.map((item, i) => `${i + 1}. ${item}`).join('\n');
  const contextBlock = contextSentences.length > 0
    ? `\nMEETING TOPICS DISCUSSED (one line per meeting segment — use these to write the summary):\n${contextSentences.map((s, i) => `- ${s}`).join('\n')}\n`
    : '';

  return `You are categorizing extracted meeting items into a structured JSON object.
Return ONLY a valid JSON object — no markdown, no explanation.
${contextBlock}
EXTRACTED ITEMS:
${itemList}

STEP 1 — Map each item to the correct field by its prefix. Strip the prefix, keep the full sentence exactly as written. Do NOT merge, shorten, or reword any item.
  ACTION:   → actionItems
  RISK:     → risksDiscussed
  DECISION: → decisionsTaken
  FOLLOWUP: → followUpActions

STEP 2 — Write a summary of 3-4 sentences using the MEETING TOPICS and EXTRACTED ITEMS above.
  Sentence 1: Who attended and what the main security topics of the meeting were (name actual systems, issues, or processes).
  Sentence 2: What specific concerns or issues were raised and discussed.
  Sentence 3: What key decisions or commitments were made.
  Sentence 4 (only if needed): What outstanding risks or follow-up actions remain.
  Use real names and real systems from the items above. Do NOT write generic phrases like "meeting was conducted" or "various topics were discussed."

Required JSON:
{
  "summary": "...",
  "actionItems": [],
  "decisionsTaken": [],
  "risksDiscussed": [],
  "followUpActions": []
}`;
}

// ── Topic grouping ─────────────────────────────────────────────────────────
//
// A separate, additional step run AFTER the categorization above, not a
// replacement for it. Deliberately kept as its own small, constrained call
// rather than folded into documentCategorizationPrompt: that prompt already
// does real extraction work (comprehension, categorizing by type) on a local
// model that's at its complexity ceiling — asking it to ALSO invent topic
// names and cluster in the same pass risks degrading the extraction itself.
// This step only re-organizes items that already exist; it never sees the
// raw transcript and is told explicitly not to reword anything, which makes
// it a much easier, lower-risk task to add on top.
//
// Purely a display improvement — action_items/decisionsTaken/etc. (the flat
// arrays every other consumer already reads: email templates, weekly
// reports, PDF export) are completely unaffected by this. If this step
// fails or produces something unusable, the caller falls back to an empty
// topics array and the UI shows the existing flat list — never a hard
// failure, never lost data.
// Builds the same numbered {type, text} list documentTopicGroupingPrompt shows
// the model and validateAndCleanTopics resolves numbers back against — kept as
// one function so the two can never drift out of sync with each other.
function buildTaggedItemList(structured) {
  return [
    ...structured.actionItems.map((t) => ({ type: 'action',   text: t })),
    ...structured.decisionsTaken.map((t) => ({ type: 'decision', text: t })),
    ...structured.risksDiscussed.map((t) => ({ type: 'risk',     text: t })),
    ...structured.followUpActions.map((t) => ({ type: 'followup', text: t })),
  ];
}

// Items are referenced by NUMBER in the prompt, not reproduced by text — the
// model returns which numbers belong to which group, never the item text
// itself. This keeps the response short regardless of how many items a
// meeting has (a 50+ item meeting was timing out when the model had to
// reproduce every item's full text in its JSON output — reproducing small
// integers instead is dramatically less to generate). Item text in the
// prompt itself is also capped, since grouping only needs enough of each
// line to judge its subject, not the full sentence.
const PROMPT_ITEM_MAX_CHARS = 100;

function documentTopicGroupingPrompt(structured) {
  const tagged   = buildTaggedItemList(structured);
  const itemList = tagged
    .map((it, i) => `${i + 1}. [${it.type}] ${it.text.slice(0, PROMPT_ITEM_MAX_CHARS)}`)
    .join('\n');

  return `You are organizing an already-extracted list of meeting items into topic groups.
Return ONLY a valid JSON object — no markdown, no explanation.

ITEMS (numbered):
${itemList}

TASK: Group these item NUMBERS by the real subject they're about (e.g. a specific system, ticket type, customer, or process) — not by their type (action/decision/risk/followup), since each group should mix types where relevant.

RULES:
1. Every item number above must appear in exactly one group. Do not drop any, do not invent numbers that aren't listed.
2. Return ONLY the number for each item — never its text. Keep your response short.
3. Give each group a short, specific name (3-6 words) naming the real system/topic — not generic labels like "General" or "Other Items".
4. Assign each group a priority: "high" if it involves a security risk, a blocker, or something time-sensitive; "medium" for routine follow-up work; "low" for minor/administrative items.
5. Aim for 3-8 groups. Do not create a separate group for every single item — combine related ones.

Required JSON:
{
  "topics": [
    { "name": "...", "priority": "high" | "medium" | "low", "items": [1, 4, 7] }
  ]
}`;
}

const TYPE_TO_GROUP_KEY = { action: 'actionItems', decision: 'decisions', risk: 'risks', followup: 'followUps' };

// Validates the model's grouping output against the real source items — the
// one thing this step must never do is introduce text that wasn't in the
// original flat lists. Because the model returns item NUMBERS rather than
// text, this is no longer fuzzy matching against a similarity threshold —
// it's an exact lookup: a number either resolves to a real, unclaimed item
// or it doesn't. The output is always the original verbatim source line for
// that index, so no invented or reworded text can ever reach the UI through
// this path. Each item is used in at most one group (first claim wins).
function validateAndCleanTopics(rawTopics, structured) {
  if (!Array.isArray(rawTopics)) return [];

  const tagged = buildTaggedItemList(structured); // same order as the prompt — indices must match
  const used   = new Set(); // 0-based indices into `tagged` already claimed by an earlier group

  const cleaned = rawTopics
    .filter((t) => t && typeof t.name === 'string' && t.name.trim())
    .map((t) => {
      const group = { actionItems: [], decisions: [], risks: [], followUps: [] };

      for (const raw of (Array.isArray(t.items) ? t.items : [])) {
        const n = Number(raw);
        if (!Number.isInteger(n)) continue;
        const idx = n - 1; // items are listed 1-indexed in the prompt
        if (idx < 0 || idx >= tagged.length) continue; // out of range — model invented a number
        if (used.has(idx)) continue;                    // already claimed by an earlier group
        used.add(idx);
        const item = tagged[idx];
        group[TYPE_TO_GROUP_KEY[item.type]].push(item.text); // always the real source text
      }

      return {
        name:     t.name.trim().slice(0, 80),
        priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
        ...group,
      };
    })
    // Drop empty groups — can happen if every number in a group failed validation.
    .filter((t) => t.actionItems.length || t.decisions.length || t.risks.length || t.followUps.length);

  return cleaned;
}

async function synthesizeTopicGroups(structured, provider, correlationId) {
  const totalItems = structured.actionItems.length + structured.decisionsTaken.length
    + structured.risksDiscussed.length + structured.followUpActions.length;

  // Not worth grouping a handful of items — the flat list is already easy
  // to scan at that size, and a group-of-1 or group-of-2 adds noise instead
  // of clarity.
  if (totalItems < 4) return [];

  const prompt = documentTopicGroupingPrompt(structured);

  // This call has observed a real failure mode: Ollama's own idle-connection
  // drop lands around the ~5 min mark, and OllamaProvider's built-in retry
  // (2 attempts total) can be exhausted by two unlucky drops in a row on a
  // large-item meeting (this prompt scales with totalItems, so a 40+ item
  // meeting is a bigger, slower call than a typical segment extraction).
  // Retrying here — on top of OllamaProvider's own retry — gives this
  // bonus step more chances to land instead of one shared budget with
  // every other call in the pipeline.
  const TOPIC_GROUPING_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= TOPIC_GROUPING_ATTEMPTS; attempt++) {
    try {
      const raw    = await provider.generate(prompt, { maxTokens: 1200, temperature: 0.1 });
      const parsed = extractJson(raw);
      const topics = validateAndCleanTopics(parsed?.topics, structured);

      logger.info('NoteStructurer: topic grouping complete', {
        correlationId, totalItems, groupCount: topics.length, attempt,
      });
      return topics;
    } catch (err) {
      logger.warn('NoteStructurer: topic grouping attempt failed', {
        correlationId, attempt, of: TOPIC_GROUPING_ATTEMPTS, error: err.message,
      });
      if (attempt === TOPIC_GROUPING_ATTEMPTS) {
        // Never let a grouping failure take down the whole pipeline — the flat
        // lists were already generated and saved successfully; this is a bonus
        // view on top of them, not a dependency.
        logger.warn('NoteStructurer: topic grouping failed after all attempts — falling back to flat list', {
          correlationId, totalItems,
        });
        return [];
      }
    }
  }
  return []; // unreachable, satisfies linters expecting an explicit return
}

// Synthesises per-segment CONTEXT sentences into one coherent meeting summary paragraph.
// This replaces the naive contextSentences.join(' ') approach which produced a wall of
// "The discussion revolves around..." repeated 15+ times.
// ── Summary generation ────────────────────────────────────────────────────────
//
// PRODUCTION DESIGN (3 layers, outer → inner):
//
//   Layer 1 — buildDeterministicSummary()
//     Pure function. Zero LLM calls. Builds a professional paragraph from the
//     structured data we already extracted (meetingContext + split items).
//     Always produces a readable output. Never times out. Used as the guaranteed
//     baseline regardless of Ollama state.
//
//   Layer 2 — LLM polish pass inside synthesizeSummary()
//     Optional enhancement: a TINY prompt (~100 tokens in, 150 tokens out) that
//     asks the model to write a polished paragraph from our compact structured
//     data. Fast even on CPU (~60-90 sec). Falls back to Layer 1 on any failure.
//     Output is validated against scope keywords before use — if the model hallu-
//     cinates off-topic content, Layer 1 is used instead.
//
//   Layer 3 — synthesizeSummary() orchestration
//     Called from Mode D, E, and F. Receives contextSentences + meetingContext +
//     split (already-categorised items). Runs Layer 1 first, attempts Layer 2,
//     returns whichever is better.
//
// Result: The summary is ALWAYS a proper paragraph — the topic-join fragmented
// text ("Email Security: 25 domains previously allowed...") is gone.

/**
 * Builds a compact structured hint (~200-300 chars) for the LLM polish call.
 * Small enough to prefill in < 80 tokens — fast even on CPU-only Ollama.
 */
function buildCompactInput(meetingContext, split) {
  const lines = [];

  if (meetingContext) {
    if (meetingContext.primaryTopic)
      lines.push(`TOPIC: ${meetingContext.primaryTopic}`);
    if (meetingContext.meetingPurpose)
      lines.push(`PURPOSE: ${meetingContext.meetingPurpose}`);
    if (Array.isArray(meetingContext.keyTopics) && meetingContext.keyTopics.length)
      lines.push(`AREAS: ${meetingContext.keyTopics.slice(0, 4).join(', ')}`);
  }

  if (split) {
    if (split.decisionsTaken && split.decisionsTaken.length)
      lines.push(`KEY DECISION: ${split.decisionsTaken[0].slice(0, 80)}`);
    if (split.actionItems && split.actionItems.length)
      lines.push(`TOP ACTION: ${split.actionItems[0].slice(0, 80)}`);

    const counts = [];
    if (split.actionItems    && split.actionItems.length)    counts.push(`${split.actionItems.length} actions`);
    if (split.decisionsTaken && split.decisionsTaken.length) counts.push(`${split.decisionsTaken.length} decisions`);
    if (split.risksDiscussed && split.risksDiscussed.length) counts.push(`${split.risksDiscussed.length} risks`);
    if (counts.length) lines.push(`COUNTS: ${counts.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Builds a professional meeting summary paragraph deterministically from already-
 * extracted structured data. No Ollama call — zero timeout risk.
 *
 * Paragraph structure:
 *   S1: Primary topic + purpose
 *   S2: Key areas discussed
 *   S3: Quantified outcomes (N actions, M decisions, K risks)
 *   S4: Most notable highlight — top decision or action item
 */
function buildDeterministicSummary(meetingContext, split, contextSentences) {
  const parts = [];

  // ── S1: What the meeting covered ─────────────────────────────────────────
  if (meetingContext && meetingContext.primaryTopic) {
    const topic = meetingContext.primaryTopic.trim();
    const rawPurpose = (meetingContext.meetingPurpose || '').trim();
    // Strip leading "to" / "the purpose was" boilerplate so it reads naturally
    const purpose = rawPurpose
      .replace(/^(the purpose (of this meeting )?was (to )?|to )/i, '')
      .trim();

    parts.push(
      purpose.length > 10
        ? `The meeting addressed ${topic}, with the objective of ${purpose}.`
        : `The meeting focused on ${topic}.`
    );
  }

  // ── S2: Areas discussed ───────────────────────────────────────────────────
  if (meetingContext && Array.isArray(meetingContext.keyTopics) && meetingContext.keyTopics.length > 0) {
    const topics = meetingContext.keyTopics.slice(0, 5).map(t => t.trim());
    const topicStr =
      topics.length === 1
        ? topics[0]
        : `${topics.slice(0, -1).join(', ')} and ${topics[topics.length - 1]}`;
    parts.push(`Discussion covered ${topicStr}.`);
  } else if (Array.isArray(contextSentences) && contextSentences.length > 0) {
    // Fallback: first clean context sentence if keyTopics unavailable
    const first = contextSentences
      .filter(s => s && s.length > 30)
      .map(s => s.replace(/^CONTEXT:\s*/i, '').replace(/[{}"']+/g, '').trim())
      [0];
    if (first) parts.push(first.endsWith('.') ? first : `${first}.`);
  }

  // ── S3: Quantified outcomes ───────────────────────────────────────────────
  const ai   = (split && split.actionItems    && split.actionItems.length)    || 0;
  const dec  = (split && split.decisionsTaken && split.decisionsTaken.length) || 0;
  const risk = (split && split.risksDiscussed && split.risksDiscussed.length) || 0;
  const fu   = (split && split.followUpActions && split.followUpActions.length) || 0;

  const outcome = [];
  if (ai   > 0) outcome.push(`${ai} action item${ai   !== 1 ? 's' : ''}`);
  if (dec  > 0) outcome.push(`${dec} decision${dec  !== 1 ? 's' : ''}`);
  if (risk > 0) outcome.push(`${risk} security risk${risk !== 1 ? 's' : ''}`);
  if (fu   > 0 && outcome.length < 2) outcome.push(`${fu} follow-up${fu !== 1 ? 's' : ''}`);

  if (outcome.length > 0) {
    const outcomeStr =
      outcome.length === 1
        ? outcome[0]
        : `${outcome.slice(0, -1).join(', ')} and ${outcome[outcome.length - 1]}`;
    parts.push(`The session resulted in ${outcomeStr} being recorded.`);
  }

  // ── S4: Most notable highlight ────────────────────────────────────────────
  // Prefer a decision (carries more weight); fall back to first action item.
  const topDecision = split && split.decisionsTaken && split.decisionsTaken[0];
  const topAction   = split && split.actionItems    && split.actionItems[0];
  const highlight   = topDecision || topAction;

  if (highlight && highlight.length > 20) {
    // Take only the first sentence to avoid run-ons
    const firstSentence = highlight.split(/(?<=[.!?])\s+/)[0].trim();
    if (firstSentence.length > 20) {
      // Skip if this text is already substantially covered in an earlier part
      const hlKey = firstSentence.slice(0, 40).toLowerCase();
      const alreadyCovered = parts.some(p => p.toLowerCase().includes(hlKey.slice(0, 20)));
      if (!alreadyCovered) {
        const noteStr = firstSentence.endsWith('.') ? firstSentence : `${firstSentence}.`;
        parts.push(`A key outcome was: ${noteStr}`);
      }
    }
  }

  return parts.join(' ').trim();
}

/**
 * Orchestrates summary generation for Mode D, E, and F.
 *
 * @param {string[]} contextSentences - CONTEXT: bullets from each extracted segment
 * @param {object}   provider         - Ollama provider instance
 * @param {string}   correlationId
 * @param {object}   meetingContext   - result of buildMeetingContext() — may be null
 * @param {object}   split            - result of splitPrefixedItems() — already-categorised items
 *
 * Flow:
 *   1. Build deterministic summary immediately (Layer 1 — always works)
 *   2. Attempt tiny LLM polish call (Layer 2 — optional, ~60-90 sec on CPU)
 *   3. Validate LLM output against scope keywords (hallucination guard)
 *   4. Return LLM output if valid, deterministic summary otherwise
 */
async function synthesizeSummary(contextSentences, provider, correlationId, meetingContext = null, split = null) {

  // ── Layer 1: Deterministic summary (guaranteed, instant) ─────────────────
  const deterministicSummary = buildDeterministicSummary(meetingContext, split, contextSentences);

  if (!deterministicSummary && (!contextSentences || contextSentences.length === 0)) {
    return '';
  }

  // ── Layer 2: Optional LLM polish (tiny prompt, fast, optional) ───────────
  const compactInput = buildCompactInput(meetingContext, split);

  // Only attempt LLM polish if we have structured data to feed it
  if (!compactInput || compactInput.length < 40) {
    return deterministicSummary;
  }

  const polishPrompt = `Write a 3-sentence professional meeting summary paragraph in plain prose. Return ONLY the paragraph — no bullets, no headings, no JSON, no preamble.

${compactInput}

Summary:`;

  try {
    const raw = await provider.generate(polishPrompt, { maxTokens: 150 });

    if (raw && typeof raw === 'string') {
      const trimmed = raw.trim().replace(/^[\s"']+|[\s"']+$/g, '').trim();

      // Reject if model returned structured/JSON output
      if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('**')) {
        logger.warn('NoteStructurer: LLM polish returned structured output — using deterministic', { correlationId });
        return deterministicSummary;
      }

      // Reject if output is too short (model returned a fragment or nothing useful)
      if (trimmed.length < 60) {
        return deterministicSummary;
      }

      // Scope validation — reject if no scope keyword appears in the LLM output.
      // Prevents the model from hallucinating off-topic topics (e.g. writing about
      // VAPT or JumpCloud in a summary for a Teams-security meeting).
      if (meetingContext && Array.isArray(meetingContext.scopeKeywords) && meetingContext.scopeKeywords.length > 0) {
        const summaryLower = trimmed.toLowerCase();
        const hasScope = meetingContext.scopeKeywords.some(kw =>
          summaryLower.includes(kw.toLowerCase())
        );
        if (!hasScope) {
          logger.warn('NoteStructurer: LLM summary failed scope check — using deterministic', {
            correlationId,
            scopeKeywords: meetingContext.scopeKeywords.slice(0, 5),
          });
          return deterministicSummary;
        }
      }

      logger.info('NoteStructurer: LLM summary polish accepted', { correlationId, length: trimmed.length });
      return trimmed;
    }
  } catch (err) {
    logger.warn('NoteStructurer: summary LLM polish failed — using deterministic summary', {
      correlationId, error: err.message,
    });
  }

  return deterministicSummary;
}

function chunkSummaryPrompt(chunk, idx, total) {
  return `Summarize part ${idx + 1} of ${total} of meeting notes.
Focus on actions decided, decisions made, and risks raised.
Return ONLY a JSON object: {"summary": "your 2-3 sentence summary here"}

NOTES SECTION:
${chunk}`;
}

// ── Meeting Understanding Engine ──────────────────────────────────────────────
// Runs BEFORE any extraction. Reads a distributed sample from the start, middle,
// and end of the transcript to establish what THIS meeting is actually about.
//
// WHY THIS IS NEEDED:
//   Without this step, segment prompts contain a hardcoded MSSP topic list
//   (MFA, VAPT, JumpCloud, DMARC, EDR, etc.) that the model uses as a template.
//   When a meeting is ONLY about "Teams external user display", the model still
//   finds those hardcoded topics in the prompt and fabricates items for them from
//   its training data — producing JumpCloud tasks in a Teams-only meeting.
//
//   With this engine: the model first reads the actual transcript and identifies
//   what was REALLY discussed. That context is then injected into every extraction
//   prompt so the model knows what to look for — and what to EXCLUDE.
//
// Cost: ONE Ollama call on a ~4000-char sample before any segmentation.
//       ~25-35 seconds on CPU. Falls back gracefully to null if it fails.

async function buildMeetingContext(cleanText, provider, correlationId) {
  const len = cleanText.length;

  // Distributed sample: opening (agenda/intro), middle (main discussion), closing (decisions)
  let sample;
  // Keep sample small — ~3000 chars total ≈ 750 tokens prefill ≈ ~1 min on CPU.
  // Larger samples (4000+) take 5+ minutes just for context building — too expensive.
  // 3000 chars is enough to establish primary topic, purpose, and key scope keywords.
  if (len <= 3000) {
    sample = cleanText;
  } else {
    const opening = cleanText.slice(0, 1200);
    const midStart = Math.floor(len / 2) - 400;
    const middle   = cleanText.slice(midStart, midStart + 800);
    const closing  = cleanText.slice(-600);
    sample = `[OPENING]\n${opening}\n\n[MIDDLE]\n${middle}\n\n[CLOSING]\n${closing}`;
  }

  const prompt = `Read this meeting transcript sample carefully.
Return ONLY a valid JSON object — no markdown, no explanation.
Base your answer ONLY on what you actually read — do NOT use prior knowledge.

TRANSCRIPT SAMPLE:
${sample}

Return this JSON:
{
  "primaryTopic": "One specific sentence naming the ACTUAL main subject of this meeting",
  "meetingPurpose": "One sentence: what problem or goal brought people to this meeting",
  "keyTopics": ["topic you actually read", "another real topic from this transcript"],
  "scopeKeywords": ["word1", "word2", "word3", "word4", "word5", "word6", "word7", "word8"]
}

RULES (critical):
- primaryTopic: name the ACTUAL technology or issue you read — not a generic phrase like "security review"
- keyTopics: ONLY list topics you directly read in this transcript. If you see only Teams and domain policy — list only those. Do NOT list MFA, VAPT, JumpCloud, EDR unless you actually read them here.
- scopeKeywords: 6-10 specific words from THIS meeting that define what was discussed (tool names, system names, process terms you actually read)
- If a topic is mentioned only in passing (one sentence), do NOT include it as a key topic

Bad example (inventing topics): {"primaryTopic": "Monthly security review", "keyTopics": ["MFA", "VAPT", "JumpCloud", "EDR"]}
Good example (specific to what was read): {"primaryTopic": "Microsoft Teams showing internal users as External contacts", "keyTopics": ["Teams external user display", "domain whitelist policy", "messaging restrictions"], "scopeKeywords": ["teams", "external", "domain", "whitelist", "messaging", "policy", "contacts", "guest"]}`;

  try {
    const raw = await provider.generate(prompt, { maxTokens: 350, numCtx: 8192 });
    const obj = extractJson(raw);

    if (obj && typeof obj.primaryTopic === 'string' && obj.primaryTopic.length > 10) {
      const context = {
        primaryTopic:   obj.primaryTopic,
        meetingPurpose: typeof obj.meetingPurpose === 'string' ? obj.meetingPurpose : '',
        keyTopics:      Array.isArray(obj.keyTopics) ? obj.keyTopics.filter(t => typeof t === 'string') : [],
        scopeKeywords:  Array.isArray(obj.scopeKeywords)
          ? obj.scopeKeywords.filter(k => typeof k === 'string').map(k => k.toLowerCase())
          : [],
      };
      logger.info('NoteStructurer: meeting context established', {
        correlationId,
        primaryTopic:  context.primaryTopic.slice(0, 100),
        keyTopics:     context.keyTopics.length,
        scopeKeywords: context.scopeKeywords.length,
      });
      return context;
    }

    logger.warn('NoteStructurer: meeting context response missing primaryTopic — proceeding without context filter', { correlationId });
  } catch (err) {
    logger.warn('NoteStructurer: meeting context build failed — proceeding without context filter', {
      correlationId, error: err.message,
    });
  }

  return null;
}

// ── Meeting Context Validation ────────────────────────────────────────────────
// Post-extraction filter: rejects items that have ZERO overlap with the meeting's
// established scope keywords AND whose key proper nouns are absent from the
// transcript vocabulary.
//
// Design is intentionally LENIENT — an item is only rejected if BOTH conditions hold:
//   (a) zero overlap with meeting scope keywords, AND
//   (b) no known speaker name in first 4 words (not a real assignment)
//
// This preserves edge cases where legitimate items use paraphrased language, while
// reliably rejecting hallucinated security topics from a different meeting domain
// (e.g. "USB Policy" in a meeting that only discussed Teams configuration).
//
// Only runs when meetingContext was successfully built. If buildMeetingContext
// returned null (failure/timeout), this function returns items unchanged.

function filterByMeetingContext(items, meetingContext, transcriptVocab) {
  if (!meetingContext || !meetingContext.scopeKeywords || meetingContext.scopeKeywords.length === 0) {
    return items;
  }

  // Build a set of all scope words: keywords + individual words from key topics
  const scopeSet = new Set(meetingContext.scopeKeywords);
  for (const topic of (meetingContext.keyTopics || [])) {
    for (const word of topic.toLowerCase().split(/[\s\-_/]+/)) {
      if (word.length >= 4) scopeSet.add(word);
    }
  }
  // Add primary topic words
  if (meetingContext.primaryTopic) {
    for (const word of meetingContext.primaryTopic.toLowerCase().split(/\s+/)) {
      if (word.length >= 4) scopeSet.add(word);
    }
  }

  const filtered = [];
  const rejected = [];

  for (const item of items) {
    if (!item || typeof item !== 'string') continue;
    const lower = item.toLowerCase();

    // Pass: item contains at least one scope keyword from this meeting
    let inScope = false;
    for (const kw of scopeSet) {
      if (lower.includes(kw)) { inScope = true; break; }
    }
    if (inScope) { filtered.push(item); continue; }

    // Pass: item has a known proper noun (speaker name) in the first 4 words —
    // it's a real assignment from this meeting, keep even if topic words mismatch.
    const words = item.split(/\s+/);
    const hasKnownName = words.slice(0, 5).some(w => {
      const clean = w.replace(/[^a-zA-Z]/g, '');
      return clean.length >= 3 && /^[A-Z]/.test(clean) && transcriptVocab && transcriptVocab.has(clean.toLowerCase());
    });
    if (hasKnownName) { filtered.push(item); continue; }

    // Reject: zero scope overlap AND no recognizable speaker → off-topic or hallucinated
    rejected.push(item.slice(0, 80));
  }

  if (rejected.length > 0) {
    logger.info('NoteStructurer: context filter rejected off-topic items', {
      correlationId: 'context-filter',
      rejected: rejected.length,
      examples: rejected.slice(0, 3),
    });
  }

  return filtered;
}

// ── JSON parsing ──────────────────────────────────────────────────────────────

function extractJson(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Reasoning-capable models can leave stray braces in their visible output
  // even with thinking suppressed (a speculative example JSON mentioned
  // while reasoning, a stray fragment, etc.) — a naive greedy match from the
  // first '{' to the last '}' would span all of that as one invalid blob.
  // The real answer is reliably the LAST complete, balanced JSON object in
  // the response, so scan backward from the end and brace-match to find it.
  const lastBrace = raw.lastIndexOf('}');
  if (lastBrace !== -1) {
    let depth = 0;
    for (let i = lastBrace; i >= 0; i--) {
      if (raw[i] === '}') depth++;
      else if (raw[i] === '{') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(raw.slice(i, lastBrace + 1));
          } catch {
            break; // fall through to the legacy match below
          }
        }
      }
    }
  }

  // Legacy fallback — original behavior, kept so any response shape the
  // backward scan doesn't handle still gets a chance.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function parseStructured(raw) {
  const obj = extractJson(raw);
  if (!obj || typeof obj.summary !== 'string') return null;
  const toArray = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()) : []);
  return {
    summary:         obj.summary.trim(),
    actionItems:     toArray(obj.actionItems),
    decisionsTaken:  toArray(obj.decisionsTaken),
    risksDiscussed:  toArray(obj.risksDiscussed),
    followUpActions: toArray(obj.followUpActions),
  };
}

function parseSegmentItems(raw) {
  const obj = extractJson(raw);
  if (!obj) return [];

  const result = [];

  // ── Comprehension-first: extract "understood" field ───────────────────────
  // The comprehension-first format adds an "understood" field that the model fills
  // BEFORE listing items. This tells us what the model read in the segment.
  // We prepend it as a CONTEXT sentence so synthesizeSummary can use it, and so
  // filterByMeetingContext can validate it against meeting scope.
  if (obj.understood && typeof obj.understood === 'string') {
    const understood = obj.understood.trim().replace(/^["']+|["']+$/g, '').trim();
    if (understood.length > 15) {
      result.push(`CONTEXT: ${understood}`);
    }
  }

  if (Array.isArray(obj.items)) {
    obj.items
      .map((s) => {
        if (typeof s === 'string') return s.trim();
        // Mistral 7B produces object-format items instead of plain strings:
        // {type:"ACTION", text:"..."} or {prefix:"ACTION:", content:"..."}
        if (s && typeof s === 'object') {
          const type = ((s.type || s.prefix || s.category || '')).toString()
            .toUpperCase().replace(/[:\s]/g, '');
          const text = (s.text || s.content || s.description || s.item || s.action || '')
            .toString().trim();
          if (type && text) return `${type}: ${text}`;
          if (text) return text;
        }
        return '';
      })
      .filter((s) => s.length > 10)
      .forEach((item) => {
        // If we already have an understood-based CONTEXT item, skip any redundant
        // CONTEXT items the model might also include in the items array.
        const isCtx = /^CONTEXT:\s*/i.test(item.trimStart());
        const alreadyHasCtx = result.some(r => /^CONTEXT:\s*/i.test(r.trimStart()));
        if (isCtx && alreadyHasCtx) return;
        result.push(item);
      });
  }

  return result;
}

function parseChunkSummary(raw) {
  const obj = extractJson(raw);
  if (obj?.summary && typeof obj.summary === 'string') return obj.summary.trim();
  if (typeof raw === 'string' && raw.length > 10 && !raw.startsWith('{')) return raw.slice(0, 400);
  return '';
}

// ── Section-based fallback (no Ollama needed) ─────────────────────────────────

function splitLines(text = '') {
  return text
    .split('\n')
    .map((l) => l.replace(/^[-•*\d.)]+\s*/, '').trim())
    .filter(Boolean);
}

function fallbackFromSections(sections) {
  return {
    summary:         sections.summary    || '',
    actionItems:     splitLines(sections.actionItems),
    decisionsTaken:  splitLines(sections.decisions),
    risksDiscussed:  splitLines(sections.risks),
    followUpActions: splitLines(sections.followUp),
  };
}

// ── Prefix-split fallback (no second AI call) ─────────────────────────────────
// Used when the categorisation Ollama call fails. All item text is preserved —
// just no AI-generated summary.

function splitPrefixedItems(items) {
  const result = {
    actionItems:     [],
    decisionsTaken:  [],
    risksDiscussed:  [],
    followUpActions: [],
  };

  for (const item of items) {
    const upper = item.trimStart().toUpperCase();
    if (upper.startsWith('DELIVERABLE')) {
      const text = item.replace(/^DELIVERABLE:\s*/i, '').trim();
      if (text) result.followUpActions.push(`[DELIVERABLE] ${text}`);
      continue;
    }
    const text = item.replace(/^(ACTION|RISK|DECISION|FOLLOWUP):\s*/i, '').trim();
    if (!text) continue;
    if      (upper.startsWith('ACTION'))   result.actionItems.push(text);
    else if (upper.startsWith('RISK'))     result.risksDiscussed.push(text);
    else if (upper.startsWith('DECISION')) result.decisionsTaken.push(text);
    else if (upper.startsWith('FOLLOWUP')) result.followUpActions.push(text);
  }

  return result;
}

// Removes DECISION items that are status observations, not real decisions.
// llama3.1/llama3.2 classifies "X is okay" / "no issues with X" / "Y is acceptable"
// as decisions because the transcript contains those exact phrases near agreements.
// Real decisions have a forward-looking action verb. Status phrases without one are
// observational updates — showing them as "decisions" misleads managers.
function filterDecisions(items) {
  const STATUS_ONLY = [
    /\bis\s+(okay|fine|acceptable|good|sorted)\b/i,
    /\bare\s+(okay|fine|acceptable|good|sorted)\b/i,
    /\bhas\s+no\s+issues?\b/i,
    /\bhave\s+no\s+issues?\b/i,
    /\bno\s+issues?\s+(now|with)\b/i,
    /\bmix\s+of\s+risk\b/i,
    /\bscore\s+of\s+[\d,]+\b/i,
    /\boverall\s+security\s+posture\s+is\b/i,
    /\bis\s+acknowledged\b/i,
    /\bis\s+accepted\s+as\b/i,
  ];
  // If one of these action verbs is also present the item is a real decision, keep it.
  const ACTION_VERB = /\b(will\s+be|will\s+proceed|agreed\s+to|decided\s+to|to\s+be\s+(removed?|disabled?|enforced?|enabled?|implemented?|integrated?|resolved?|fixed|completed?)|will\s+(enforce|remove|disabl|enabl|integrat|implement|resolv|add|delet|send|share|creat|configur|upgrad|maintain|focus))/i;

  return (items || []).filter((item) => {
    if (!item || typeof item !== 'string') return false;
    const hasStatus = STATUS_ONLY.some((p) => p.test(item));
    if (!hasStatus) return true;
    return ACTION_VERB.test(item);
  });
}

// ── Transcript vocabulary helpers ─────────────────────────────────────────────

// Returns true when >40% of non-whitespace characters in a transcript sample
// are non-ASCII (Devanagari, Arabic, CJK, etc.). For such transcripts the
// ASCII-only vocab check is relaxed because product names that appear as
// phonetic Devanagari ("जंपक्लाउड" for "JumpCloud") will never match the
// ASCII vocabulary — rejecting them as hallucinations is a false positive.
function isHighNonAsciiRatio(text) {
  const sample  = text.slice(0, 6000).replace(/\s/g, '');
  if (sample.length === 0) return false;
  const nonAscii = (sample.match(/[^\x00-\x7F]/g) || []).length;
  return nonAscii / sample.length > 0.40;
}

// Builds a lowercase word set from the full transcript.
// Used to verify that extracted items don't reference names or systems the
// model invented — if a word never appeared in the meeting it can't be real.
function buildTranscriptVocab(text) {
  const words = text.match(/\b[a-zA-Z]{3,}\b/g) || [];
  return new Set(words.map(w => w.toLowerCase()));
}

// Returns false when an item contains 2+ capitalized mid-sentence words that
// do not appear in the transcript vocabulary — a reliable signal of hallucinated
// content (names and systems the model invented rather than heard in the meeting).
//
// ONE absent word is intentionally tolerated:
//   • Fireflies transcription uses display names ("Speaker 1", "Nikhil M.") that
//     may differ from how the model spells a participant's full name.
//   • Compound product names ("JumpCloud") may appear as two words ("Jump Cloud")
//     in speech, giving one form in vocab but not the other.
//   • Possessives and hyphenated modifiers are split before the check so
//     "Agrawal's" → "Agrawal" and "Windows-based" → "Windows" — but edge cases
//     may still produce one unmatched word that is not actually hallucinated.
//
// TWO or more absent words → clearly hallucinated (e.g. "Rohan will grant Rohini
// admin access in Nexus" has 2 absent: "Rohini" and "Nexus" → rejected).
//
// Position 0 (the action subject) is skipped — hallucinated subjects are caught
// upstream by the speaker-names constraint injected into every segment prompt.
// maxAbsent controls how many absent capitalized words trigger rejection.
// Default (2) tolerates transcription spelling variation.
// Pass maxAbsent=1 for DECISION/RISK items — those skip the structural quality
// gate so they need a stricter check to catch template-copied sentences where
// only one fictional system name (e.g. "Omega") is substituted.
function passesTranscriptCheck(itemText, vocab, maxAbsent = 2) {
  const words = itemText.split(/\s+/);
  let absentCount = 0;
  for (let i = 1; i < words.length; i++) {
    // Strip possessive/hyphen stem so "Agrawal's" → "Agrawal", "Windows-based" → "Windows"
    const w = words[i].split(/[-']/)[0].replace(/[^a-zA-Z]/g, '');
    if (!w || w.length < 3) continue;
    if (!/^[A-Z]/.test(w)) continue;          // only capitalized mid-sentence words (proper nouns)
    if (vocab.has(w.toLowerCase())) continue;  // present in transcript → ok
    absentCount++;
    if (absentCount >= maxAbsent) {
      logger.debug('NoteStructurer: transcript check rejected item', {
        absentCount, maxAbsent, preview: itemText.slice(0, 80),
      });
      return false;
    }
  }
  return true;
}

// Extracts probable speaker/participant names from a Fireflies-format transcript.
// Fireflies uses "Name:" prefix for speaker labels; we scan all such prefixes and
// deduplicate. The resulting list is injected into each segment prompt so the
// model is constrained to only use actual participants — not training-data names.
function extractSpeakerNames(text) {
  const names = new Set();
  const matches = text.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*:/gm) || [];
  for (const m of matches) {
    const name = m.replace(/\s*:$/, '').trim();
    if (name.length >= 2 && name.length <= 40) names.add(name);
  }
  const NON_NAMES = new Set([
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December',
    'Action', 'Risk', 'Decision', 'Followup', 'Note', 'Summary', 'Meeting',
    'Today', 'Tomorrow', 'Yesterday', 'Important', 'Critical', 'Update',
  ]);
  return [...names].filter(n => !NON_NAMES.has(n));
}

// ── Number reconciliation helpers ────────────────────────────────────────────
// Mode D processes segments independently — early segments capture preliminary
// counts ("44 users without MFA") while later segments have the corrected final
// count ("49 users"). Both survive the extraction pipeline because they're in
// different segments, producing inconsistent numbers in the final output.
//
// Pure-code numeric conflict resolution — no Ollama call.
// Scans CONTEXT sentences (ordered earliest→latest segment) for recurring
// numeric metrics. When the same metric appears with different counts across
// segments, the LAST occurrence wins (later in the meeting = corrected/final value).
// Replaces the previous Ollama-based getNumberCorrections() which returned {} ~60%
// of the time because llama3.1 missed the conflict in JSON output.
//
// Each tracked metric has ONE regex that matches the count in capture group 1.
// The function builds a corrections map like {"44 users": "49 users"} that
// applyNumberCorrections() then applies to all extracted action items.
function codeBasedNumberCorrections(contextSentences) {
  if (!contextSentences || contextSentences.length < 2) return {};

  // Patterns for security metrics that commonly have early-vs-final count conflicts.
  // Group 1 must always capture the numeric count.
  const TRACKED_METRICS = [
    { key: 'mfa_without',   re: /\b(\d+)\s+users?\b[^.]{0,80}(?:without|do not have|don'?t have)\b[^.]{0,50}(?:mfa|multi.factor|2fa)\b/i },
    { key: 'failed_policy', re: /\b(\d+)\s+devices?\b[^.]{0,80}(?:failed|failing|partially)\b[^.]{0,50}polic/i },
    { key: 'pending_edr',   re: /\b(\d+)\s+devices?\b[^.]{0,50}pending\b[^.]{0,50}(?:edr|check.?point|install)/i },
    { key: 'no_device',     re: /\b(\d+)\s+users?\b[^.]{0,80}without\b[^.]{0,50}(?:jumpcloud|managed.device|device)/i },
    { key: 'password_age',  re: /\b(\d+)\s+users?\b[^.]{0,50}passwords?\b[^.]{0,80}older\s+than/i },
    { key: 'inactive',      re: /\b(\d+)\s+(?:inactive|dormant)\s+(?:accounts?|users?)\b/i },
  ];

  const corrections = {};

  for (const { re } of TRACKED_METRICS) {
    const seen = [];
    for (const sentence of contextSentences) {
      const m = sentence.match(re);
      if (m) seen.push(parseInt(m[1], 10));
    }
    if (seen.length < 2) continue;
    const first = seen[0];
    const last  = seen[seen.length - 1];
    if (first === last || isNaN(first) || isNaN(last)) continue;
    // Build corrections for the three common noun forms this count can appear in
    corrections[`${first} users`]    = `${last} users`;
    corrections[`${first} devices`]  = `${last} devices`;
    corrections[`${first} accounts`] = `${last} accounts`;
  }

  if (Object.keys(corrections).length > 0) {
    logger.info('NoteStructurer: number reconciliation (code-based)', { corrections });
  }
  return corrections;
}

function applyNumberCorrections(items, corrections) {
  if (!corrections || Object.keys(corrections).length === 0) return items;
  return items.map((item) => {
    let out = item;
    for (const [wrong, right] of Object.entries(corrections)) {
      const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(escaped, 'gi'), right);
    }
    return out;
  });
}

// ── Mode D: segmented extraction ──────────────────────────────────────────────
// Used when no section headers are detected and charCount > 8 000.
// Handles both meeting transcripts and unstructured MoM files.
//
// Segments overlap by OVERLAP chars so items near a segment cut point appear in
// both adjacent segments — deduplication removes the copy so no item is missed.

// Built once per run: a smaller/faster model to retry a segment on when the
// primary model times out or errors mid-run (e.g. an oversized production
// model that's too slow for a given segment). Mirrors the same fallback
// pattern already used in postMeetingAnalysis.service.js and
// AIRecommendationService.js — this was the one AI pipeline missing it,
// which meant a single slow/timed-out primary model had no safety net and
// could silently zero out an entire meeting's extraction.
function makeFallbackProvider(primary) {
  return providerFactory.getFallbackProvider(primary);
}

async function generateSegmentWithFallback(provider, fallbackProvider, prompt, opts, correlationId, segIdx) {
  try {
    return await provider.generate(prompt, opts);
  } catch (primaryErr) {
    if (!providerFactory.isTransientAIError(primaryErr) || !fallbackProvider) throw primaryErr;

    logger.warn('NoteStructurer: segment primary model failed — retrying with fallback', {
      correlationId, segment: segIdx + 1,
      primary: provider.name, fallback: fallbackProvider.name,
      error: primaryErr.message,
    });
    return await fallbackProvider.generate(prompt, opts);
  }
}

async function structureBySegmentation(cleanText, provider, correlationId) {
  const fallbackProvider = makeFallbackProvider(provider);

  // ── Step 0: Establish meeting context BEFORE any extraction ──────────────────
  // buildMeetingContext reads a distributed sample (beginning + middle + end) to
  // determine what this specific meeting is actually about. The resulting context
  // object is then injected into every segment prompt so the model only looks for
  // topics that were genuinely discussed — not topics from its MSSP training data.
  const meetingContext  = await buildMeetingContext(cleanText, provider, correlationId);

  // Build vocabulary and extract speaker names from the full transcript once.
  // Both are used to constrain and then post-validate extracted items.
  const transcriptVocab = buildTranscriptVocab(cleanText);
  const speakerNames    = extractSpeakerNames(cleanText);
  const highNonAscii    = isHighNonAsciiRatio(cleanText);

  // Devanagari/Hindi chars are multi-byte and expand to more tokens per char than
  // English. Use a smaller segment size for high non-ASCII transcripts so each
  // Ollama call stays within the timeout even on a 3B model.
  // Hinglish/Devanagari transcripts use 3000-char segments instead of 5000.
  // Smaller segments mean each call covers 1-3 topics rather than 5-8, so the
  // model extracts items from ALL topics it sees rather than stopping after one.
  // A 40 000-char meeting creates ~17 segments at this size vs 9 at 5000 —
  // giving 17+ tasks at 1 item/segment instead of 9.
  const effectiveSegSize = highNonAscii ? 2000 : SEGMENT_SIZE;
  const step = effectiveSegSize - OVERLAP;

  // Calculate how many sequential segments cover the full transcript.
  const segmentsNeeded = Math.ceil(Math.max(1, cleanText.length - OVERLAP) / step);
  const maxSegs = Math.min(segmentsNeeded, 20);

  // DISTRIBUTED SAMPLING: when the transcript is too large to process sequentially
  // (segmentsNeeded > maxSegs), spread the 20 slots evenly across the full transcript
  // instead of taking only the first 20 segments. This ensures coverage of the beginning,
  // middle, AND end of the meeting rather than just the first ~12% of a large Hinglish
  // transcript. For transcripts that fit in maxSegs slots, behaviour is identical to
  // sequential — every segment from start to finish.
  const segments = [];
  if (segmentsNeeded <= maxSegs) {
    // Full sequential coverage — transcript fits within the slot budget
    for (let i = 0; i < cleanText.length && segments.length < segmentsNeeded; i += step) {
      segments.push(cleanText.slice(i, i + effectiveSegSize));
    }
  } else {
    // Distributed: pick maxSegs evenly-spaced start positions across the full transcript
    const span = cleanText.length - effectiveSegSize;
    for (let slot = 0; slot < maxSegs; slot++) {
      const startPos = Math.round((slot / (maxSegs - 1)) * span);
      segments.push(cleanText.slice(startPos, startPos + effectiveSegSize));
    }
  }

  logger.info('NoteStructurer: Mode D — segmented extraction', {
    correlationId,
    totalChars:    cleanText.length,
    segments:      segments.length,
    coveredChars:  Math.min(segments.length * step + OVERLAP, cleanText.length),
    overlap:       OVERLAP,
    speakerNames:  speakerNames.length,
    highNonAscii,
  });

  // Sequential extraction — CPU-only Ollama processes one request at a time; concurrent
  // requests get rejected (503 busy) causing every second segment to fail silently.
  const SEG_CONCURRENCY = 1;
  const allItems = [];
  for (let i = 0; i < segments.length; i += SEG_CONCURRENCY) {
    const batch   = segments.slice(i, i + SEG_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((seg, batchIdx) => {
        const segIdx = i + batchIdx;
        return generateSegmentWithFallback(
          provider, fallbackProvider,
          documentSegmentPrompt(seg, segIdx, segments.length, speakerNames, meetingContext),
          // maxTokens 300: reduced from 900 to stay under the 5-min Ollama server
          // connection drop on both llama3.1 8B (dev) and llama3.3 70B (VM).
          // llama3.1 8B @ ~10 tok/s → 300 tokens = ~30s generation + ~60s prefill ≈ 1.5 min total.
          // 300 tokens is enough for 2–4 typed items per 2000-char Hindi segment.
          // temperature 0.1: lower than default (0.3) for strict factual extraction —
          // reduces hallucination risk for smaller models (llama3.1 8B) on Hindi transcripts.
          { maxTokens: 300, numCtx: 4096, temperature: 0.1 },
          correlationId, segIdx
        ).then((raw) => {
          const items = parseSegmentItems(raw);
          logger.info('NoteStructurer: segment extracted', {
            correlationId, segment: segIdx + 1, of: segments.length, itemCount: items.length,
          });
          return items;
        });
      })
    );
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        allItems.push(...outcome.value);
      } else {
        logger.warn('NoteStructurer: segment extraction failed — continuing', {
          correlationId, error: outcome.reason?.message,
        });
      }
    }
  }

  if (allItems.length === 0) {
    logger.warn('NoteStructurer: no items extracted from any segment', { correlationId });
    return null;
  }

  // Separate CONTEXT items (summary sentences per segment) from typed action items.
  // CONTEXT items describe what was discussed in each segment — they feed the meeting
  // summary but never go into action/decision/risk/followup arrays.
  const contextSentences = allItems
    .filter(item => /^CONTEXT:\s*/i.test(item))
    .map(item => item.replace(/^CONTEXT:\s*/i, '').trim())
    .filter(s => s.length > 10);
  const prefixedItems = allItems.filter(item => !/^CONTEXT:\s*/i.test(item));

  logger.info('NoteStructurer: context sentences collected', {
    correlationId, count: contextSentences.length,
  });

  // Deduplicate: items from the overlapping boundary region appear in two
  // adjacent segments. Normalise the first 60 chars to detect near-identical
  // entries and keep only the first occurrence.
  const seen   = new Set();
  const unique = prefixedItems.filter((item) => {
    const key = item.slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Structural quality gate — applied before categorisation so garbage never
  // reaches the DB action_items column or the Meeting Logs display.
  // Only ACTION and FOLLOWUP items are gated (they require WHO + specific WHAT).
  // RISK and DECISION items pass through — they describe system states and
  // agreements which have different structural characteristics.
  const GENERIC_TAILS_NXG = new Set([
    'this','it','that','these','those','task','tasks','thing','things',
    'work','settings','done','so',
  ]);
  const qualityFiltered = unique.filter((item) => {
    const upper = item.toUpperCase();
    if (!upper.startsWith('ACTION') && !upper.startsWith('FOLLOWUP')) return true;
    const text  = item.replace(/^(ACTION|FOLLOWUP):\s*/i, '').trim();
    if (text.length < 40) return false;
    const words = text.split(/\s+/);
    if (words.length < 7) return false;
    const tail  = words[words.length - 1].toLowerCase().replace(/[.,!?;:]+$/, '');
    if (GENERIC_TAILS_NXG.has(tail)) return false;
    // For pure Hindi/Devanagari transcripts the model outputs English tasks that
    // may not contain a mid-sentence English proper noun (system names appear in
    // Devanagari). Skip this check — length + word count + vocab gate are enough.
    if (!highNonAscii) {
      const hasPropNoun = words.slice(1).some((w) => w.length >= 3 && /^[A-Z][a-zA-Z]/.test(w));
      if (!hasPropNoun) return false;
    }
    return true;
  });

  logger.info('NoteStructurer: deduplication complete', {
    correlationId, before: allItems.length, after: unique.length,
  });

  logger.info('NoteStructurer: quality gate applied', {
    correlationId, before: unique.length, after: qualityFiltered.length,
    removed: unique.length - qualityFiltered.length,
  });

  // Transcript vocabulary check — removes items containing capitalized mid-sentence
  // words (names, systems) that do not appear anywhere in the source transcript.
  // This catches model hallucinations like "Rohan will grant Rohini admin access in Nexus"
  // when none of those people or systems were ever mentioned in the actual meeting.
  const transcriptValidated = qualityFiltered.filter((item) => {
    const text  = item.replace(/^(ACTION|RISK|DECISION|FOLLOWUP):\s*/i, '').trim();
    const upper = item.toUpperCase();
    // For Hindi/Devanagari transcripts the ASCII vocab contains only speaker names;
    // product names spelled in Devanagari (जंपक्लाउड → JumpCloud) will never match
    // the ASCII vocab and are falsely rejected. Relax to 4 absent words for such
    // transcripts — the speaker-names constraint still prevents hallucinated subjects.
    // For English transcripts: DECISION/RISK use maxAbsent=1 (stricter), others 2.
    let maxAbsent;
    if (highNonAscii) {
      // Hinglish/Hindi transcripts: the model extracts in English using words that
      // may not appear literally in the Devanagari/Hinglish vocab (e.g. "Investigate",
      // "mismatch", "reconciliation" translated from Hindi speech). Raise the threshold
      // so translated business deliverables are not falsely rejected.
      maxAbsent = 7;
    } else {
      maxAbsent = (upper.startsWith('DECISION') || upper.startsWith('RISK')) ? 1 : 2;
    }
    return passesTranscriptCheck(text, transcriptVocab, maxAbsent);
  });

  logger.info('NoteStructurer: transcript vocab check applied', {
    correlationId,
    before:  qualityFiltered.length,
    after:   transcriptValidated.length,
    removed: qualityFiltered.length - transcriptValidated.length,
  });

  // Guard: if the vocab check removed everything, skip the categorization call.
  if (transcriptValidated.length === 0) {
    logger.warn('NoteStructurer: transcript vocab check removed all items — returning empty to avoid example contamination', { correlationId });
    return { summary: '', actionItems: [], decisionsTaken: [], risksDiscussed: [], followUpActions: [] };
  }

  // ── Meeting context filter ────────────────────────────────────────────────────
  // Rejects items that have zero overlap with the meeting's established scope
  // AND whose subject is not a known participant name. This removes hallucinated
  // security topics that were never discussed in this meeting (e.g. VAPT tasks
  // extracted from a Teams-only meeting because the prompt listed VAPT as an example).
  const contextFiltered = filterByMeetingContext(transcriptValidated, meetingContext, transcriptVocab);
  logger.info('NoteStructurer: Mode D meeting context filter applied', {
    correlationId,
    before:  transcriptValidated.length,
    after:   contextFiltered.length,
    removed: transcriptValidated.length - contextFiltered.length,
    hasContext: !!meetingContext,
  });

  const finalValidated = contextFiltered.length > 0 ? contextFiltered : transcriptValidated;

  // Skip AI categorisation — items are already labeled ACTION/RISK/DECISION/FOLLOWUP
  // from Phase 1 extraction so prefix-split achieves identical bucketing without a
  // second Ollama call. The single-call categorisation approach (20-40 items in one
  // 4096-token prompt) consistently exceeds the context window and times out, dropping
  // all items. Summary is synthesised from CONTEXT sentences via a dedicated small call.
  const split   = splitPrefixedItems(finalValidated);

  // Cross-field dedup — remove follow-ups that duplicate action items.
  // Overlapping segments can label the same commitment ACTION in one call
  // and FOLLOWUP in another; both survive prefix-level dedup above.
  const actionKeys = new Set(
    split.actionItems.map(t => t.slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim())
  );
  const dedupedFollowUp = split.followUpActions.filter(
    t => !actionKeys.has(t.slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim())
  );

  // ── Post-extraction quality filter ───────────────────────────────────────────
  // Removes items that would create useless or misleading tasks downstream.
  // Applied here (source of truth) so every pipeline path — first run AND re-run —
  // always starts with clean data. Rules:
  //   F1: in-meeting screen-share notes ("share screen", "share his screen")
  //   F2: "within 0 minutes/seconds" — NoteStructurer parsing artifact
  //   F3: title < 20 chars after stripping owner name + date artifacts (too vague)
  //   F4: >= 70% word overlap with an already-kept item (semantic near-duplicate)
  //   F7: unresolved template placeholder, e.g. "[the system being discussed]" —
  //       the model occasionally leaves a bracketed placeholder unfilled instead
  //       of naming the real thing; that's worse than dropping the item, since a
  //       client reading it sees literal "[the system being discussed]" text.
  function filterExtractedItems(items) {
    const SCREEN_SHARE   = /\bshare\b.{0,30}\bscreen\b|\b(his|my|the)\s+screen\b/i;
    const ZERO_TIME      = /\bwithin\s+\d+\s+(minutes?|seconds?)\b/i;
    const NONE_MENTIONED = /^none\s+mentioned|^no\s+\w{1,20}\s+mentioned|^not\s+mentioned|^nothing\s+(to\s+note|mentioned)/i;
    const UNRESOLVED_PLACEHOLDER = /\[[a-z][^\]]{2,60}\]/i;

    function cleanedTitle(text) {
      let t = (text || '').trim();
      t = t.replace(/^(?:[A-Z][a-zA-Z0-9]*\s+){1,4}will\s+/i, '');
      t = t.replace(/^(?:[A-Z][a-zA-Z0-9]*\s+){1,4}(?:should|has to|needs to|is going to)\s+/i, '');
      t = t.replace(/\s*(?:by\s*)?\[no date mentioned\]/gi, '');
      t = t.replace(/\s*by\s+\[.*?\]/gi, '');
      return t.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '').trim();
    }

    function wordOverlapRatio(a, b) {
      const words = (s) => new Set(
        s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2)
      );
      const wa = words(a), wb = words(b);
      if (!wa.size || !wb.size) return 0;
      return [...wa].filter(w => wb.has(w)).length / Math.min(wa.size, wb.size);
    }

    // F6: Suggestion/conversation fragment filter.
    // Fireflies ASR sometimes produces items like "Kirish will try using Yahoo domain for
    // login" — a suggestion phrased as a commitment. After stripping the person name +
    // "will", the remainder starts with "try using / suggest / consider / explore if".
    // These are discussion fragments, not real assigned tasks.
    const SUGGESTION_AFTER_WILL = /^(try\s+(using|to|with|the)\s|suggest\s+\w|consider\s+\w|explore\s+(if\s|whether\s|\w+\s+if)|you\s+can\s+)/i;

    const kept       = [];
    const keptTitles = [];

    for (const text of (items || [])) {
      if (!text || typeof text !== 'string') continue;
      if (SCREEN_SHARE.test(text)) continue;                              // F1
      if (ZERO_TIME.test(text))             continue;                     // F2
      if (NONE_MENTIONED.test(text.trim())) continue;                     // F5: extraction artifact
      // F6: suggestion/fragment — strip leading "Person will " and test remainder
      const afterWill = text.replace(/^(?:[A-Z][a-zA-Z0-9]*\s+){1,4}will\s+/i, '');
      if (SUGGESTION_AFTER_WILL.test(afterWill)) continue;               // F6
      // F7: known-safe bracket patterns are stripped first (date/owner artifacts),
      // then anything still bracketed is an unresolved placeholder — reject.
      const withoutKnownBrackets = text
        .replace(/\s*(?:by\s*)?\[no date mentioned\]/gi, '')
        .replace(/\s*by\s+\[.*?\]/gi, '');
      if (UNRESOLVED_PLACEHOLDER.test(withoutKnownBrackets)) continue;     // F7
      const title = cleanedTitle(text);
      if (title.length < 20) continue;                                    // F3
      if (keptTitles.some(kt => wordOverlapRatio(title, kt) >= 0.70)) continue; // F4
      kept.push(text);
      keptTitles.push(title);
    }
    return kept;
  }

  function filterSupportingSections(items) {
    const NONE_MENTIONED = /^none\s+mentioned|^no\s+\w{1,20}\s+mentioned|^not\s+mentioned|^nothing\s+(to\s+note|mentioned)|^not\s+applicable|^n\/a/i;
    const UNRESOLVED_PLACEHOLDER = /\[[a-z][^\]]{2,60}\]/i; // F7 — see filterExtractedItems
    return (items || []).filter(item =>
      item &&
      typeof item === 'string' &&
      item.trim().length > 15 &&
      !NONE_MENTIONED.test(item.trim()) &&
      !UNRESOLVED_PLACEHOLDER.test(item)
    );
  }

  const filteredActionItems = filterExtractedItems(split.actionItems);
  const filteredFollowUp    = filterExtractedItems(dedupedFollowUp);

  logger.info('NoteStructurer: post-extraction filter applied', {
    correlationId,
    actionItems:    { before: split.actionItems.length, after: filteredActionItems.length },
    followUpActions: { before: dedupedFollowUp.length, after: filteredFollowUp.length },
  });

  logger.info('NoteStructurer: Mode D categorised (prefix-split)', {
    correlationId,
    actionItems:     split.actionItems.length,
    risksDiscussed:  split.risksDiscussed.length,
    decisionsTaken:  split.decisionsTaken.length,
    followUpActions: dedupedFollowUp.length,
  });

  function fixHindiMistranslations(text) {
    return (text || '')
      .replace(/\breward\b/gi, 'resolution')
      .replace(/\brewards\b/gi, 'resolutions')
      .replace(/\bbye\s+(next|the)\b/gi, 'by $1');
  }
  const vocabFix = highNonAscii ? (arr) => arr.map(fixHindiMistranslations) : (arr) => arr;

  // Number reconciliation: pure code — detects early-vs-final count conflicts
  // (e.g. "44 users" in Part 3 vs "49 users" in Part 14) by scanning CONTEXT
  // sentences in order and applying last-occurrence-wins for each tracked metric.
  const numberCorrections     = codeBasedNumberCorrections(contextSentences);
  const reconciledActionItems = applyNumberCorrections(filteredActionItems, numberCorrections);
  const reconciledFollowUp    = applyNumberCorrections(filteredFollowUp,    numberCorrections);

  // Final, post-filter arrays — the actual content that will be saved.
  const finalActionItems = vocabFix(reconciledActionItems).map(normalizeProductNames);
  const finalDecisions   = vocabFix(filterDecisions(filterSupportingSections(split.decisionsTaken)));
  const finalRisks       = vocabFix(filterSupportingSections(split.risksDiscussed));
  const finalFollowUp    = vocabFix(reconciledFollowUp).map(normalizeProductNames);

  // Summary is synthesised from the FINAL arrays, not the raw pre-filter split —
  // otherwise its "N action items, M decisions" sentence quotes counts that no
  // longer match what's actually saved once F1-F6 quality filtering removes items.
  const finalSplit = {
    actionItems: finalActionItems, decisionsTaken: finalDecisions,
    risksDiscussed: finalRisks, followUpActions: finalFollowUp,
  };
  const summary = await synthesizeSummary(contextSentences.filter(Boolean), provider, correlationId, meetingContext, finalSplit);

  return {
    summary,
    actionItems:     finalActionItems,
    decisionsTaken:  finalDecisions,
    risksDiscussed:  finalRisks,
    followUpActions: finalFollowUp,
    _highNonAscii:   highNonAscii,
    _speakerNames:   speakerNames,
  };
}

// ── Mode E: single-pass full-transcript extraction ────────────────────────────
// Used when charCount is between 8 001 and SINGLE_PASS_THRESHOLD (60 000 chars).
// Sends the ENTIRE transcript to Ollama in ONE call so the model sees the complete
// meeting context — preventing number inconsistencies and duplicate extractions that
// segment-by-segment processing causes (e.g. "31 users" in segment 1 vs the correct
// "49 users" stated after the full count was checked in segment 7).
//
// Why one call is faster: llama3.1 prefills 60 KB in ~30 s; output is ~2 000 tokens
// at ~10 tok/s → ~3-4 min total. Mode D at 3 000-char Hinglish segments needs
// 15-20 segments × 4-6 min each = 60-90 min. Speedup: 15-20×.
//
// Falls back to Mode D (segmentation) if Ollama returns nothing or times out.

async function structureBySinglePass(cleanText, provider, correlationId) {
  // Establish meeting context BEFORE extraction — same pattern as Mode D
  const meetingContext  = await buildMeetingContext(cleanText, provider, correlationId);

  const speakerNames    = extractSpeakerNames(cleanText);
  const transcriptVocab = buildTranscriptVocab(cleanText);
  const highNonAscii    = isHighNonAsciiRatio(cleanText);

  const nameConstraint = speakerNames.length > 0
    ? `\nVERIFIED PARTICIPANTS (ONLY attribute actions to these exact names — never invent a name): ${speakerNames.slice(0, 15).join(', ')}.`
    : '';

  const meetingContextBlock = meetingContext
    ? `\nMEETING CONTEXT (established before extraction):
Primary Topic: ${meetingContext.primaryTopic}
Purpose: ${meetingContext.meetingPurpose || 'Security review meeting'}
Topics discussed in this meeting: ${(meetingContext.keyTopics || []).join(', ') || 'See transcript'}
SCOPE: Extract ONLY items related to the topics listed above. Do NOT extract items about security domains not discussed in this meeting.\n`
    : '';

  const prompt = `You are extracting ALL action items, risks, decisions, follow-ups, and deliverables from a COMPLETE meeting transcript.
${meetingContextBlock}
The transcript may be in English, Hindi, Hinglish (mixed Hindi-English), or any combination — extract ALL items regardless of language.
Return ONLY a valid JSON object — no markdown, no explanation.${nameConstraint}

TRANSCRIPT QUALITY RULES:
- Speech-to-text transcripts have garbled words and filler sounds. Focus on INTENT, not literal words.
- An action item may span two speaker turns: if A asks "can you fix X?" and B replies "yes, I'll do that" — record as ONE ACTION attributed to B.
- For Hinglish: translate commitments to English using exact names from VERIFIED PARTICIPANTS.
- SKIP meta-statements about the meeting tool itself: "will send action points", "will share AI-generated MOM", "will share the generated tasks". These are housekeeping, not real business tasks.
- NUMBERS ARE CRITICAL: when the same metric appears with different values at different points in the meeting, use the FINAL/MOST SPECIFIC figure stated. Example: if "31 users" is mentioned early but corrected to "49 users" later — use 49. Write ALL digits EXACTLY as stated — never approximate.
- Hindi commitment signals (करेंगे/करूँगा/देखेंगे/भेजेंगे/share करेंगे) = future commitment → ACTION. हो गया/कर दिया = already done → SKIP.

For EACH item found, output one line starting with its type prefix:
- "ACTION: [person name] will [action verb] [specific system/tool + exact count if stated]."
- "RISK: [specific system] has [specific gap] affecting [exact count of users/devices]."
- "DECISION: a formal agreement or commitment to a specific course of action. Must include WHAT was decided AND a forward-looking verb: 'agreed to', 'decided to', 'will proceed with', 'approved to'. Do NOT extract status observations like 'X is okay', 'X has no issues', 'licenses are fine', 'sorted' — those are status updates, not decisions."
- "FOLLOWUP: [person] will [scheduled review or follow-on task] [by date ONLY if explicitly stated]."
- "DELIVERABLE: [report/document/credentials that the security provider NxgSecure/MSSP will produce and share WITH the customer — e.g. 'Share X report', 'Provide Y credentials']."
- "CONTEXT: [ONE sentence, 15-25 words, starting with the security system/topic name — summarises the key theme and the most important count from the FULL meeting. Do NOT start with 'The discussion' or 'The meeting'.]"

CRITICAL EXTRACTION RULES:
1. COVER EVERY DISTINCT TOPIC that was actually discussed in THIS meeting. Extract a SEPARATE ACTION for each distinct commitment you find in the transcript. Do NOT invent topics — only extract from what you read.
2. WHO + WHAT + SYSTEM: every ACTION/FOLLOWUP must name (a) the responsible person, (b) the specific action verb, AND (c) the exact tool/platform/system plus any count stated.
3. Include exactly ONE CONTEXT item that names the main topic and most important outcome of the full meeting.
4. Do NOT merge different topics into one item. If multiple topics have commitments — extract a separate ACTION for each.
5. MANDATORY DECISION SCAN: after extracting ACTIONs, re-read for formal agreements and commitments. A DECISION must name a specific course of action with a forward-looking verb — "agreed to enforce", "decided to remove", "approved to add". Do NOT extract "X is okay", "no issues with X", "sorted" — those are status observations, not decisions.
6. Skip any item where you cannot identify WHO and WHAT — never write vague entries.
7. SCOPE: Only extract items about topics you actually read in this transcript. Do NOT extract items about security domains that were not discussed here.

MEETING TRANSCRIPT:
${cleanText}

Return ALL items as a JSON array — replace every placeholder with real content from the transcript:
{"items": ["CONTEXT: [security area]: [key issue and most important count from full meeting].", "ACTION: [person name] will [action verb] [system + count].", "ACTION: [another person] will [action verb] [different system + count].", "RISK: [system] has [gap] affecting [count].", "DECISION: [what was agreed].", "FOLLOWUP: [person] will [scheduled item].", "DELIVERABLE: [report NxgSecure will provide to customer]."]}`;

  try {
    logger.info('NoteStructurer: Mode E — single-pass full-transcript extraction', {
      correlationId,
      totalChars:   cleanText.length,
      speakerCount: speakerNames.length,
      highNonAscii,
    });

    // numCtx=16384: for ≤30 000 char transcripts, estimated input+prompt ≈ 9 000 tokens.
    // 9 000 input + 4 000 output = 13 000 — must exceed OLLAMA_NUM_CTX=4096 default or
    // the transcript is silently truncated and the model only sees the first ~16 KB.
    const raw   = await provider.generate(prompt, { maxTokens: 4000, numCtx: 16384 });
    const items = parseSegmentItems(raw);

    if (items.length === 0) {
      logger.warn('NoteStructurer: Mode E returned no items — falling back to Mode D', { correlationId });
      return null;
    }

    logger.info('NoteStructurer: Mode E raw extraction', { correlationId, count: items.length });

    // Separate CONTEXT sentences from typed action items (same as Mode D)
    const contextSentences = items
      .filter(item => /^CONTEXT:\s*/i.test(item))
      .map(item => item.replace(/^CONTEXT:\s*/i, '').trim())
      .filter(s => s.length > 10);
    const prefixedItems = items.filter(item => !/^CONTEXT:\s*/i.test(item));

    // Dedup guard — single-pass shouldn't produce duplicates but model sometimes repeats itself
    const seenE = new Set();
    const uniqueE = prefixedItems.filter((item) => {
      const key = item.slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenE.has(key)) return false;
      seenE.add(key);
      return true;
    });

    // Quality gate — same rules as Mode D
    const GENERIC_TAILS = new Set(['this','it','that','these','those','task','tasks','thing','things','work','settings','done','so']);
    const qualityFiltered = uniqueE.filter((item) => {
      const upper = item.toUpperCase();
      if (!upper.startsWith('ACTION') && !upper.startsWith('FOLLOWUP')) return true;
      const text  = item.replace(/^(ACTION|FOLLOWUP):\s*/i, '').trim();
      if (text.length < 40) return false;
      const words = text.split(/\s+/);
      if (words.length < 7) return false;
      const tail  = words[words.length - 1].toLowerCase().replace(/[.,!?;:]+$/, '');
      if (GENERIC_TAILS.has(tail)) return false;
      if (!highNonAscii) {
        const hasPropNoun = words.slice(1).some((w) => w.length >= 3 && /^[A-Z][a-zA-Z]/.test(w));
        if (!hasPropNoun) return false;
      }
      return true;
    });

    // Transcript vocabulary check — same thresholds as Mode D
    const transcriptValidated = qualityFiltered.filter((item) => {
      const text  = item.replace(/^(ACTION|RISK|DECISION|FOLLOWUP):\s*/i, '').trim();
      const upper = item.toUpperCase();
      let maxAbsent;
      if (highNonAscii) {
        maxAbsent = 7;
      } else {
        maxAbsent = (upper.startsWith('DECISION') || upper.startsWith('RISK')) ? 1 : 2;
      }
      return passesTranscriptCheck(text, transcriptVocab, maxAbsent);
    });

    logger.info('NoteStructurer: Mode E post-processing', {
      correlationId,
      raw:         items.length,
      deduped:     uniqueE.length,
      quality:     qualityFiltered.length,
      vocabPassed: transcriptValidated.length,
    });

    if (transcriptValidated.length === 0) {
      logger.warn('NoteStructurer: Mode E vocab check removed all items — falling back to Mode D', { correlationId });
      return null;
    }

    // Meeting context filter — same as Mode D: rejects items with zero scope overlap
    const contextFilteredE = filterByMeetingContext(transcriptValidated, meetingContext, transcriptVocab);
    logger.info('NoteStructurer: Mode E meeting context filter applied', {
      correlationId,
      before:  transcriptValidated.length,
      after:   contextFilteredE.length,
      removed: transcriptValidated.length - contextFilteredE.length,
      hasContext: !!meetingContext,
    });
    const finalValidatedE = contextFilteredE.length > 0 ? contextFilteredE : transcriptValidated;

    const split   = splitPrefixedItems(finalValidatedE);

    // Cross-field dedup — remove follow-ups that duplicate action items
    const actionKeysE = new Set(split.actionItems.map(t => t.slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim()));
    const dedupedFollowUp = split.followUpActions.filter(
      t => !actionKeysE.has(t.slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim())
    );

    // Post-extraction content quality filter (F1–F5) — mirrors Mode D's filterExtractedItems
    const SCREEN_SHARE_E   = /\bshare\b.{0,30}\bscreen\b|\b(his|my|the)\s+screen\b/i;
    const ZERO_TIME_E      = /\bwithin\s+\d+\s+(minutes?|seconds?)\b/i;
    const NONE_MENTIONED_E = /^none\s+mentioned|^no\s+\w{1,20}\s+mentioned|^not\s+mentioned|^nothing\s+(to\s+note|mentioned)/i;
    const UNRESOLVED_PLACEHOLDER_E = /\[[a-z][^\]]{2,60}\]/i; // F7 — see Mode D's filterExtractedItems

    function cleanedTitleE(text) {
      let t = (text || '').trim();
      t = t.replace(/^(?:[A-Z][a-zA-Z0-9]*\s+){1,4}will\s+/i, '');
      t = t.replace(/^(?:[A-Z][a-zA-Z0-9]*\s+){1,4}(?:should|has to|needs to|is going to)\s+/i, '');
      t = t.replace(/\s*(?:by\s*)?\[no date mentioned\]/gi, '');
      t = t.replace(/\s*by\s+\[.*?\]/gi, '');
      return t.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '').trim();
    }
    function wordOverlapE(a, b) {
      const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
      const wa = words(a), wb = words(b);
      if (!wa.size || !wb.size) return 0;
      return [...wa].filter(w => wb.has(w)).length / Math.min(wa.size, wb.size);
    }
    function filterItemsE(arr) {
      const kept = [], keptTitles = [];
      for (const text of (arr || [])) {
        if (!text || typeof text !== 'string')  continue;
        if (SCREEN_SHARE_E.test(text))          continue;
        if (ZERO_TIME_E.test(text))             continue;
        if (NONE_MENTIONED_E.test(text.trim())) continue;
        const withoutKnownBrackets = text
          .replace(/\s*(?:by\s*)?\[no date mentioned\]/gi, '')
          .replace(/\s*by\s+\[.*?\]/gi, '');
        if (UNRESOLVED_PLACEHOLDER_E.test(withoutKnownBrackets)) continue; // F7
        const title = cleanedTitleE(text);
        if (title.length < 20)                  continue;
        if (keptTitles.some(kt => wordOverlapE(title, kt) >= 0.70)) continue;
        kept.push(text);
        keptTitles.push(title);
      }
      return kept;
    }
    function filterSupportE(arr) {
      return (arr || []).filter(item =>
        item && typeof item === 'string' && item.trim().length > 15 &&
        !NONE_MENTIONED_E.test(item.trim()) && !UNRESOLVED_PLACEHOLDER_E.test(item)
      );
    }

    const fixHindi = (text) => (text || '')
      .replace(/\breward\b/gi, 'resolution').replace(/\brewards\b/gi, 'resolutions')
      .replace(/\bbye\s+(next|the)\b/gi, 'by $1');
    const vocabFix = highNonAscii ? (arr) => arr.map(fixHindi) : (arr) => arr;

    const finalActionItemsE = vocabFix(filterItemsE(split.actionItems)).map(normalizeProductNames);
    const finalDecisionsE   = vocabFix(filterDecisions(filterSupportE(split.decisionsTaken)));
    const finalRisksE       = vocabFix(filterSupportE(split.risksDiscussed));
    const finalFollowUpE    = vocabFix(filterItemsE(dedupedFollowUp)).map(normalizeProductNames);

    logger.info('NoteStructurer: Mode E complete', {
      correlationId,
      actionItems:    finalActionItemsE.length,
      decisionsTaken: finalDecisionsE.length,
      risksDiscussed: finalRisksE.length,
      followUpActions: finalFollowUpE.length,
    });

    // Summary synthesised from the FINAL arrays — see Mode D for why.
    const finalSplitE = {
      actionItems: finalActionItemsE, decisionsTaken: finalDecisionsE,
      risksDiscussed: finalRisksE, followUpActions: finalFollowUpE,
    };
    const summary = await synthesizeSummary(contextSentences.filter(Boolean), provider, correlationId, meetingContext, finalSplitE);

    return {
      summary,
      actionItems:     finalActionItemsE,
      decisionsTaken:  finalDecisionsE,
      risksDiscussed:  finalRisksE,
      followUpActions: finalFollowUpE,
      _highNonAscii:   highNonAscii,
      _speakerNames:   speakerNames,
    };

  } catch (err) {
    logger.warn('NoteStructurer: Mode E failed — falling back to Mode D', {
      correlationId,
      error: err.message,
    });
    return null;
  }
}

// ── Mode F: hierarchical extraction (pass-2 eliminated) ───────────────────────
// Used for transcripts 30 001 – 100 000 chars (e.g. a 2-hour English meeting).
//
// REDESIGN (2026-08-11): The original 2-pass design had a critical failure mode:
// Pass-2 (holistic LLM synthesis from combined segment bullets) consistently
// timed out on CPU-only Ollama — the combined input (8 segments × bullet lists)
// plus the extraction prompt exceeded the 10-min OLLAMA_TIMEOUT. This caused
// 100% fallback to Mode D, wasting all pass-1 work.
//
// New design — single-pass per segment using documentSegmentPrompt:
//   Each segment uses the SAME proven prompt as Mode D (comprehension-first,
//   meeting-context-injected, ACTION/RISK/DECISION prefixed JSON output).
//   Items are collected across all segments and run through the SAME
//   post-processing pipeline (dedup → quality gate → vocab check → context
//   filter → split → deterministic summary) — no pass-2 LLM call needed.
//
// Why this is better:
//   • No pass-2 timeout — zero additional LLM calls after per-segment extraction
//   • Same quality as Mode D but with 8 000-char segments (vs 7 000) — better
//     cross-paragraph context per call, fewer segment boundaries to lose items at
//   • 50% success-rate fallback to Mode D still applies if too many segments fail
//   • Meeting context is injected into EVERY segment prompt — no topic drift

async function structureByHierarchical(cleanText, provider, correlationId) {
  // Establish meeting context BEFORE extraction — same pattern as Mode D and E
  const meetingContext  = await buildMeetingContext(cleanText, provider, correlationId);

  const speakerNames    = extractSpeakerNames(cleanText);
  const transcriptVocab = buildTranscriptVocab(cleanText);
  const highNonAscii    = isHighNonAsciiRatio(cleanText);

  const segSize  = highNonAscii ? HIERARCHICAL_SEG_HINDI : HIERARCHICAL_SEG_EN;
  const segments = [];
  for (let i = 0; i < cleanText.length; i += segSize) {
    segments.push(cleanText.slice(i, i + segSize));
  }

  logger.info('NoteStructurer: Mode F — hierarchical extraction', {
    correlationId,
    totalChars:  cleanText.length,
    segments:    segments.length,
    segSize,
    highNonAscii,
  });

  // ── Single-pass: extract from each segment using documentSegmentPrompt ────────
  // Each segment uses the comprehension-first, meeting-context-injected prompt —
  // same as Mode D. Items come out prefixed (ACTION/RISK/DECISION/FOLLOWUP) with
  // an "understood" comprehension check. No pass-2 LLM call.
  const allItems         = [];
  const contextSentences = [];
  let   successCount     = 0;

  for (let i = 0; i < segments.length; i++) {
    const prompt = documentSegmentPrompt(
      segments[i], i, segments.length, speakerNames, meetingContext
    );

    try {
      const raw   = await provider.generate(prompt, { maxTokens: 900, numCtx: 4096, temperature: 0.1 });
      const items = parseSegmentItems(raw);

      if (items.length > 0) {
        items.forEach(item => {
          if (/^CONTEXT:\s*/i.test(item.trimStart())) {
            contextSentences.push(item.replace(/^CONTEXT:\s*/i, '').trim());
          } else {
            allItems.push(item);
          }
        });
        successCount++;
        logger.info('NoteStructurer: Mode F segment done', {
          correlationId, segment: i + 1, of: segments.length,
          extracted: items.filter(it => !/^CONTEXT:\s*/i.test(it.trimStart())).length,
        });
      } else {
        logger.warn('NoteStructurer: Mode F segment empty', { correlationId, segment: i + 1 });
      }
    } catch (err) {
      logger.warn('NoteStructurer: Mode F segment failed', {
        correlationId, segment: i + 1, error: err.message,
      });
    }
  }

  // Coverage guard — fall back to Mode D if too many segments failed
  if (successCount === 0) {
    logger.warn('NoteStructurer: Mode F — no segments succeeded, falling back to Mode D', { correlationId });
    return null;
  }
  if (successCount / segments.length < 0.5) {
    logger.warn('NoteStructurer: Mode F — success rate too low, falling back to Mode D', {
      correlationId, succeeded: successCount, total: segments.length,
    });
    return null;
  }

  logger.info('NoteStructurer: Mode F pass-1 complete — running post-processing pipeline', {
    correlationId, totalItems: allItems.length, segments: successCount, of: segments.length,
  });

  // ── Post-processing: same pipeline as Mode D (no pass-2 LLM call) ────────────

  const seenF = new Set();
  const uniqueF = allItems.filter((item) => {
    const key = item.slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenF.has(key)) return false;
    seenF.add(key);
    return true;
  });

  const GENERIC_TAILS_F = new Set(['this','it','that','these','those','task','tasks','thing','things','work','settings','done','so']);
  const qualityFilteredF = uniqueF.filter((item) => {
    const upper = item.toUpperCase();
    if (!upper.startsWith('ACTION') && !upper.startsWith('FOLLOWUP')) return true;
    const text  = item.replace(/^(ACTION|FOLLOWUP):\s*/i, '').trim();
    if (text.length < 40) return false;
    const words = text.split(/\s+/);
    if (words.length < 7) return false;
    const tail  = words[words.length - 1].toLowerCase().replace(/[.,!?;:]+$/, '');
    if (GENERIC_TAILS_F.has(tail)) return false;
    if (!highNonAscii) {
      const hasPropNoun = words.slice(1).some((w) => w.length >= 3 && /^[A-Z][a-zA-Z]/.test(w));
      if (!hasPropNoun) return false;
    }
    return true;
  });

  const transcriptValidatedF = qualityFilteredF.filter((item) => {
    const text      = item.replace(/^(ACTION|RISK|DECISION|FOLLOWUP):\s*/i, '').trim();
    const upper     = item.toUpperCase();
    const maxAbsent = highNonAscii ? 9 : (upper.startsWith('DECISION') || upper.startsWith('RISK')) ? 1 : 3;
    return passesTranscriptCheck(text, transcriptVocab, maxAbsent);
  });

  logger.info('NoteStructurer: Mode F post-processing', {
    correlationId,
    raw: allItems.length, deduped: uniqueF.length,
    quality: qualityFilteredF.length, vocabPassed: transcriptValidatedF.length,
  });

  if (transcriptValidatedF.length === 0) {
    logger.warn('NoteStructurer: Mode F vocab check removed all items — falling back to Mode D', { correlationId });
    return null;
  }

  const contextFilteredF = filterByMeetingContext(transcriptValidatedF, meetingContext, transcriptVocab);
  logger.info('NoteStructurer: Mode F meeting context filter applied', {
    correlationId,
    before: transcriptValidatedF.length, after: contextFilteredF.length,
    removed: transcriptValidatedF.length - contextFilteredF.length,
    hasContext: !!meetingContext,
  });
  const finalValidatedF = contextFilteredF.length > 0 ? contextFilteredF : transcriptValidatedF;

  const split   = splitPrefixedItems(finalValidatedF);

  const actionKeysF = new Set(split.actionItems.map(t => t.slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim()));
  const dedupedFollowUpF = split.followUpActions.filter(
    t => !actionKeysF.has(t.slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim())
  );

  const SCREEN_SHARE_F   = /\bshare\b.{0,30}\bscreen\b|\b(his|my|the)\s+screen\b/i;
  const ZERO_TIME_F      = /\bwithin\s+\d+\s+(minutes?|seconds?)\b/i;
  const NONE_MENTIONED_F = /^none\s+mentioned|^no\s+\w{1,20}\s+mentioned|^not\s+mentioned|^nothing\s+(to\s+note|mentioned)/i;
  const UNRESOLVED_PLACEHOLDER_F = /\[[a-z][^\]]{2,60}\]/i; // F7 — see Mode D's filterExtractedItems

  function cleanedTitleF(text) {
    let t = (text || '').trim();
    t = t.replace(/^(?:[A-Z][a-zA-Z0-9]*\s+){1,4}will\s+/i, '');
    t = t.replace(/^(?:[A-Z][a-zA-Z0-9]*\s+){1,4}(?:should|has to|needs to|is going to)\s+/i, '');
    t = t.replace(/\s*(?:by\s*)?\[no date mentioned\]/gi, '');
    t = t.replace(/\s*by\s+\[.*?\]/gi, '');
    return t.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '').trim();
  }
  function wordOverlapF(a, b) {
    const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
    const wa = words(a), wb = words(b);
    if (!wa.size || !wb.size) return 0;
    return [...wa].filter(w => wb.has(w)).length / Math.min(wa.size, wb.size);
  }
  function filterItemsF(arr) {
    const kept = [], keptTitles = [];
    for (const text of (arr || [])) {
      if (!text || typeof text !== 'string')  continue;
      if (SCREEN_SHARE_F.test(text))          continue;
      if (ZERO_TIME_F.test(text))             continue;
      if (NONE_MENTIONED_F.test(text.trim())) continue;
      const withoutKnownBrackets = text
        .replace(/\s*(?:by\s*)?\[no date mentioned\]/gi, '')
        .replace(/\s*by\s+\[.*?\]/gi, '');
      if (UNRESOLVED_PLACEHOLDER_F.test(withoutKnownBrackets)) continue; // F7
      const title = cleanedTitleF(text);
      if (title.length < 20)                  continue;
      if (keptTitles.some(kt => wordOverlapF(title, kt) >= 0.70)) continue;
      kept.push(text);
      keptTitles.push(title);
    }
    return kept;
  }
  function filterSupportF(arr) {
    return (arr || []).filter(item =>
      item && typeof item === 'string' && item.trim().length > 15 &&
      !NONE_MENTIONED_F.test(item.trim()) && !UNRESOLVED_PLACEHOLDER_F.test(item)
    );
  }

  const fixHindiF = (text) => (text || '')
    .replace(/\breward\b/gi, 'resolution').replace(/\brewards\b/gi, 'resolutions')
    .replace(/\bbye\s+(next|the)\b/gi, 'by $1');
  const vocabFixF = highNonAscii ? (arr) => arr.map(fixHindiF) : (arr) => arr;

  const finalActionItemsF = vocabFixF(filterItemsF(split.actionItems)).map(normalizeProductNames);
  const finalDecisionsF   = vocabFixF(filterDecisions(filterSupportF(split.decisionsTaken)));
  const finalRisksF       = vocabFixF(filterSupportF(split.risksDiscussed));
  const finalFollowUpF    = vocabFixF(filterItemsF(dedupedFollowUpF)).map(normalizeProductNames);

  logger.info('NoteStructurer: Mode F complete', {
    correlationId,
    actionItems:     finalActionItemsF.length,
    decisionsTaken:  finalDecisionsF.length,
    risksDiscussed:  finalRisksF.length,
    followUpActions: finalFollowUpF.length,
  });

  // Summary synthesised from the FINAL arrays — see Mode D for why.
  const finalSplitF = {
    actionItems: finalActionItemsF, decisionsTaken: finalDecisionsF,
    risksDiscussed: finalRisksF, followUpActions: finalFollowUpF,
  };
  const summary = await synthesizeSummary(contextSentences.filter(Boolean), provider, correlationId, meetingContext, finalSplitF);

  return {
    summary,
    actionItems:     finalActionItemsF,
    decisionsTaken:  finalDecisionsF,
    risksDiscussed:  finalRisksF,
    followUpActions: finalFollowUpF,
    _highNonAscii:   highNonAscii,
    _speakerNames:   speakerNames,
  };
}

// ── Mode C: sequential chunk summarisation ────────────────────────────────────
// Used only when section headers WERE detected and document is > 30 000 chars.
// Summarises each chunk to prose then structures the combined result.

async function summariseChunks(chunks, provider, correlationId) {
  const limited   = chunks.slice(0, 5);
  const summaries = [];

  for (let i = 0; i < limited.length; i++) {
    try {
      const raw     = await provider.generate(chunkSummaryPrompt(limited[i], i, limited.length));
      const summary = parseChunkSummary(raw);
      if (summary) summaries.push(summary);
    } catch (err) {
      logger.warn('NoteStructurer: chunk summary failed', {
        correlationId, chunk: i, error: err.message,
      });
    }
  }

  return summaries.join('\n\n').slice(0, 8000);
}

// ── Main entry point ──────────────────────────────────────────────────────────

const noteStructurerService = {
  /**
   * Converts preprocessed meeting text into structured fields, then adds a
   * topic-grouped view on top for display. Thin wrapper around
   * structureInternal() so every mode (A-F, and every fallback path) gets
   * the same treatment from one place, instead of repeating the grouping
   * call at each of that function's several return points.
   */
  async structure(input, correlationId = 'unknown', modelOverride) {
    const provider = makeProvider(modelOverride);
    const structured = await noteStructurerService.structureInternal(input, correlationId, provider);
    structured.topics = await synthesizeTopicGroups(structured, provider, correlationId);
    return structured;
  },

  /**
   * The actual mode-selection logic — unchanged from before this file's
   * topic-grouping addition. See module docstring below for mode meanings.
   *
   * Mode selection:
   *   D — no section headers detected AND charCount > 8 000.
   *       Overlapping segment extraction. Handles transcripts AND unstructured MoMs.
   *       Checked FIRST so these files never fall into truncating Mode B.
   *   A — charCount ≤ 8 000: full text sent directly to Ollama.
   *   B — charCount ≤ 30 000: stitched section text (or first 8 000 chars).
   *   C — charCount > 30 000: sequential chunk summarisation then structure.
   *
   * Falls back to regex-detected sections at every stage if Ollama is unavailable.
   */
  async structureInternal({ cleanText, sections, charCount }, correlationId, provider) {
    const hasSections = sections && Object.values(sections).some(Boolean);

    // Modes E / F / D — unstructured / transcript path.
    // Must be checked before Mode B so long transcripts are never silently truncated to 8 000 chars.
    if (!hasSections && charCount > 8000) {

      // Mode E — single-pass (≤ 30 000 chars, English-dominant only).
      // Sends the full transcript in ONE call with numCtx=16384 so the model sees
      // the complete meeting context: consistent numbers, no duplicate extraction.
      // SKIPPED for high-non-ASCII (Hinglish/Devanagari): the 16K+ token context window
      // causes prefill + 4000-token generation to exceed the 5-min Ollama server connection
      // drop limit on CPU-only inference. Mode D with 2000-char segments is faster and more
      // reliable for Hindi transcripts.
      if (charCount <= SINGLE_PASS_THRESHOLD && !isHighNonAsciiRatio(cleanText)) {
        const singlePassResult = await structureBySinglePass(cleanText, provider, correlationId);
        if (singlePassResult) return singlePassResult;
        logger.warn('NoteStructurer: Mode E produced no result — falling back to Mode F/D', { correlationId });
      }

      // Mode F — hierarchical 2-pass (> 30 000 chars, English-dominant transcripts only).
      // Pass-1: summarise each large segment into bullet points (numCtx=8192, ~1.5 min each).
      // Pass-2: extract all items from combined summaries in ONE call (numCtx=16384, ~3 min).
      // Reconciles numbers across segments: later-stated values override earlier ones.
      // ~10-12 min total vs 70-90 min for Mode D on the same transcript.
      //
      // SKIPPED for high-non-ASCII (Hinglish/Devanagari) transcripts: Devanagari chars
      // tokenize at ~1.5 tokens/char, so a 12 000-char segment expands to ~9 000 tokens —
      // filling numCtx=8192 with just the input and leaving no room for output. The model
      // stalls until OLLAMA_TIMEOUT fires (10 min per segment × 6 segments = 60 min wasted
      // before Mode D even starts). For these transcripts Mode D is more reliable.
      if (charCount > SINGLE_PASS_THRESHOLD && !isHighNonAsciiRatio(cleanText)) {
        const hierarchicalResult = await structureByHierarchical(cleanText, provider, correlationId);
        if (hierarchicalResult) return hierarchicalResult;
        logger.warn('NoteStructurer: Mode F produced no result — falling back to Mode D', { correlationId });
      }

      // Mode D — original segmented extraction (fallback only).
      const result = await structureBySegmentation(cleanText, provider, correlationId);
      if (result) return result;
      logger.warn('NoteStructurer: Mode D produced no result — falling back to Mode B', { correlationId });
    }

    let textToSend;

    if (charCount <= 8000) {
      // Mode A — full text
      textToSend = cleanText;
    } else if (charCount <= 30000) {
      // Mode B — stitch detected sections; fall back to first 8 000 chars
      const sectionText = [
        sections.summary,
        sections.actionItems,
        sections.decisions,
        sections.risks,
        sections.followUp,
      ]
        .filter(Boolean)
        .join('\n\n');

      textToSend = sectionText.length > 500 ? sectionText.slice(0, 8000) : cleanText.slice(0, 8000);
    } else {
      // Mode C — chunk and summarise sequentially, then structure
      const chunks = [];
      for (let i = 0; i < cleanText.length; i += CHUNK_SIZE) {
        chunks.push(cleanText.slice(i, i + CHUNK_SIZE));
      }
      logger.info('NoteStructurer: Mode C — chunking text', {
        correlationId,
        totalChars: charCount,
        chunkCount: chunks.length,
      });
      textToSend = await summariseChunks(chunks, provider, correlationId);
      if (!textToSend) {
        logger.warn('NoteStructurer: all chunk summaries failed — using section fallback', { correlationId });
        return fallbackFromSections(sections);
      }
    }

    try {
      const raw    = await provider.generate(structurePrompt(textToSend, sections));
      const parsed = parseStructured(raw);

      if (parsed) {
        logger.info('NoteStructurer: structured via Ollama', {
          correlationId,
          mode:            charCount <= 8000 ? 'A' : charCount <= 30000 ? 'B' : 'C',
          actionItemCount: parsed.actionItems.length,
        });
        return parsed;
      }

      logger.warn('NoteStructurer: Ollama response unparseable — using section fallback', {
        correlationId,
        rawPreview: raw ? raw.slice(0, 150) : '(empty)',
      });
    } catch (err) {
      logger.warn('NoteStructurer: Ollama call failed — using section fallback', {
        correlationId,
        error: err.message,
        code:  err.code,
      });
    }

    return fallbackFromSections(sections);
  },
};

module.exports = noteStructurerService;
