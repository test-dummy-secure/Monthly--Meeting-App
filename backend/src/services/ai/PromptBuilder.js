'use strict';

const SEV_ORDER = { critical: 1, high: 2, medium: 3, low: 4 };

const fmtDate = (d) => {
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return String(d); }
};

const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const PromptBuilder = {
  /**
   * Builds a structured prompt for AI recommendation generation.
   *
   * @param {object} tenant        - { name, industry, accountManager }
   * @param {Array}  findings      - Normalised findings from FindingsProvider
   * @param {Array}  openTasks     - Currently open tasks from DB
   * @param {Array}  carryForwardTasks - Tasks carried forward from previous meetings
   * @param {object} meetingContext - { meetingType }
   * @returns {string} prompt
   */
  build({ tenant, findings, openTasks = [], carryForwardTasks = [], meetingContext = {}, previousNotes = null }) {
    const today = new Date().toISOString().slice(0, 10);

    // Severity breakdown for summary and task scaling
    const sevCount = { critical: 0, high: 0, medium: 0, low: 0 };
    findings.forEach((f) => { if (sevCount[f.severity] !== undefined) sevCount[f.severity]++; });
    const totalFindings  = findings.length;
    const critHighCount  = sevCount.critical + sevCount.high;
    const minTasks       = Math.max(3, Math.min(critHighCount, 6));
    const maxTasks       = Math.min(15, Math.max(8, critHighCount));

    const findingSummary =
      `Total: ${totalFindings} | Critical: ${sevCount.critical} | High: ${sevCount.high} | Medium: ${sevCount.medium} | Low: ${sevCount.low}`;

    const findingLines = findings
      .sort((a, b) => (SEV_ORDER[a.severity] || 9) - (SEV_ORDER[b.severity] || 9))
      .slice(0, 30)
      .map((f, i) => {
        const parts = [
          `${i + 1}. [${(f.severity || 'unknown').toUpperCase()}] ${f.title}`,
          f.description    ? `   Description: ${f.description}`          : null,
          f.category       ? `   Category: ${f.category}`                : null,
          f.systemAffected ? `   System: ${f.systemAffected}`            : null,
          f.affectedCount > 0 ? `   Affected count: ${f.affectedCount}` : null,
        ].filter(Boolean);
        return parts.join('\n');
      })
      .join('\n\n') || '  No active findings from NXG360.';

    const openTaskLines = openTasks.slice(0, 10)
      .map((t, i) => `  ${i + 1}. "${t.title}" — status: ${t.remediationStatus || 'open'}, due: ${t.dueDate ? fmtDate(t.dueDate) : 'n/a'}, owner: ${t.ownerName || 'unassigned'}`)
      .join('\n') || '  None.';

    const cfLines = carryForwardTasks.slice(0, 10)
      .map((t, i) => `  ${i + 1}. "${t.title}" — carried forward ${t.carryForwardCount}× (originally due: ${t.dueDate ? fmtDate(t.dueDate) : 'n/a'})`)
      .join('\n') || '  None.';

    const prevNotesSection = previousNotes
      ? `\nPREVIOUS MEETING CONTEXT (for continuity — do not duplicate these as new tasks):\n` +
        `  Summary: ${previousNotes.summary || 'Not available'}\n` +
        `  Prior actions: ${(previousNotes.actionItems || []).slice(0, 5).map((a, i) => `\n    ${i + 1}. ${a}`).join('') || '\n    None.'}\n` +
        `  Prior decisions: ${(previousNotes.decisionsTaken || []).slice(0, 3).map((d, i) => `\n    ${i + 1}. ${d}`).join('') || '\n    None.'}`
      : '';

    return `You are a senior cybersecurity remediation advisor for an MSSP. Your task is to generate specific, actionable remediation task recommendations based on security findings.

TENANT CONTEXT:
  Name: ${tenant.name}
  Industry: ${tenant.industry || 'Technology'}
  Account Manager: ${tenant.accountManager || 'Not assigned'}
  Meeting Type: ${meetingContext.meetingType || 'Monthly Security Review'}
  Date: ${today}

FINDINGS SUMMARY: ${findingSummary}

CRITICAL RULE — NUMBERS AND COUNTS IN FINDINGS:
When a finding's description or title contains specific numbers, counts, or percentages
(e.g. "47 accounts", "3 servers", "80% of systems", "12 endpoints", "across 5 sites"),
you MUST:
  a) Include those exact numbers in your task title — never replace with vague terms like
     "multiple", "some", "various", or "several"
  b) Reference the specific count in your actionPlan steps
     (e.g. "Audit all 47 affected accounts and enforce MFA on each")
  c) Use the exact count in businessImpact to show the real scope of exposure
  d) If two findings share the same system, combine their counts when relevant

CURRENT NXG360 SECURITY FINDINGS (sorted by severity):
${findingLines}

CURRENTLY OPEN TASKS (do NOT duplicate these):
${openTaskLines}

CARRY-FORWARD TASKS (unresolved across multiple meetings — consider escalation):
${cfLines}
${prevNotesSection}
YOUR TASK:
Generate between ${minTasks} and ${maxTasks} specific, actionable remediation recommendations. Follow these rules:
1. Prioritise critical and high severity findings first — cover ALL critical findings.
2. Do NOT create duplicate tasks for findings already covered by open tasks.
3. For carry-forward tasks, suggest an updated approach or escalation path.
4. Each recommendation must be directly tied to a specific finding or security gap.
5. Due dates: critical → ${addDays(14)}, high → ${addDays(30)}, medium/low → ${addDays(90)}.
6. Be specific: name the system, technology, team, and exact counts from the finding.
7. Keep actionPlan concise (3–5 steps maximum) but reference exact numbers where present.
8. For recommendedOwnerType: CUSTOMER = requires customer-side access or sign-off; ACCOUNT_MANAGER = security team can resolve without customer action; SHARED = both parties must collaborate.

CRITICAL FIELD SEPARATION RULE — strictly enforced, no exceptions:
- "actionPlan"     = HOW to fix it. Numbered executable steps ONLY. Every step must begin with an action verb (Enable, Patch, Deploy, Enforce, etc.). NEVER write risk, consequences, or "if not done" language here.
- "businessImpact" = WHAT HAPPENS IF NOT FIXED. Describe the exposure, risk, or compliance consequence ONLY. NEVER include action steps, numbered lists, or "do X, do Y" instructions here.
  BAD businessImpact: "1. Enable MFA on all accounts. 2. Review access logs." (these are steps — wrong field)
  GOOD businessImpact: "503 user accounts lack MFA, leaving credentials exposed to phishing and account takeover. Continued non-compliance risks audit failure and potential regulatory penalties."

REQUIRED OUTPUT:
Respond with ONLY a valid JSON array. No markdown. No explanation. No preamble. Just the JSON array.

[
  {
    "title": "Concise action-oriented title (max 80 chars) — include exact counts from finding",
    "actionPlan": "1. [Executable step with specific system/count]. 2. [Next specific step]. 3. [Verification step to confirm fix].",
    "businessImpact": "Risk exposure or compliance consequence if not resolved — no steps, no numbered lists.",
    "remediationStrategy": "immediate_fix | workaround | long_term_fix | escalation",
    "severity": "critical|high|medium|low",
    "category": "Vulnerability Management|Access Control|Configuration|Patching|MFA|EDR Coverage|Other",
    "riskReductionScore": 75,
    "recommendedOwner": "Specific role or team name",
    "recommendedOwnerType": "CUSTOMER|ACCOUNT_MANAGER|SHARED",
    "dueDateSuggestion": "YYYY-MM-DD",
    "aiConfidence": 0.85
  }
]

STRICT FORMAT RULES — violating these causes the entire response to be rejected:
- Every value MUST be a JSON string or number — NEVER an array or object
- "actionPlan" MUST be a single string like "1. Step one. 2. Step two." — NOT ["step1","step2"]
- "severity" MUST be exactly one of: critical, high, medium, low — lowercase, no other values
- "riskReductionScore" MUST be a number 0-100 — NOT a string
- Do NOT add trailing commas after the last field in any object
- Do NOT add comments inside the JSON`;
  },

  /**
   * Builds a prompt for the post-meeting second AI pass.
   * Generates a FINAL confirmed task set based on what was explicitly discussed.
   *
   * @param {object} tenant          - { name, industry, accountManager }
   * @param {object} structuredNotes - { summary, actionItems, decisionsTaken, risksDiscussed, followUpActions }
   * @param {Array}  findings        - Normalised findings from FindingsProvider
   * @param {Array}  openTasks       - Currently open tasks from DB
   * @returns {string} prompt
   */
  buildPostMeeting({ tenant, structuredNotes, findings, openTasks = [] }) {
    const today = new Date().toISOString().slice(0, 10);
    const {
      summary         = '',
      actionItems     = [],
      decisionsTaken  = [],
      risksDiscussed  = [],
      followUpActions = [],
    } = structuredNotes || {};

    const fmtList = (arr) =>
      (Array.isArray(arr) && arr.length)
        ? arr.map((item, i) => `  ${i + 1}. ${item}`).join('\n')
        : '  None recorded.';

    const openTaskLines = openTasks.slice(0, 10)
      .map((t, i) => `  ${i + 1}. "${t.title}" — status: ${t.remediationStatus || 'open'}, owner: ${t.ownerName || 'unassigned'}`)
      .join('\n') || '  None.';

    const topFindings = findings
      .sort((a, b) => (SEV_ORDER[a.severity] || 9) - (SEV_ORDER[b.severity] || 9))
      .slice(0, 10)
      .map((f, i) => `  ${i + 1}. [${(f.severity || 'unknown').toUpperCase()}] ${f.title}`)
      .join('\n') || '  No active findings.';

    const actionCount   = Array.isArray(actionItems)     ? actionItems.length     : 0;
    const riskCount     = Array.isArray(risksDiscussed)  ? risksDiscussed.length  : 0;
    const followUpCount = Array.isArray(followUpActions) ? followUpActions.length : 0;
    const minTasks      = Math.max(3, Math.min(actionCount + riskCount + followUpCount, 8));

    return `OUTPUT RULE: respond with ONLY a JSON array [ {...}, {...}, ... ]. No text outside the array. No markdown. Start with [ end with ].
REQUIRED: at least ${minTasks} separate task objects — one per action item, one per risk, one per follow-up.

Tenant: ${tenant.name} | Date: ${today}

SUMMARY: ${summary || 'N/A'}

ACTION ITEMS (${actionCount}):
${fmtList(actionItems)}

DECISIONS:
${fmtList(decisionsTaken)}

RISKS (${riskCount}):
${fmtList(risksDiscussed)}

FOLLOW-UP ACTIONS (${followUpCount}):
${fmtList(followUpActions)}

OPEN TASKS — do not duplicate:
${openTaskLines}

FINDINGS (context):
${topFindings}

SEVERITY GUIDANCE — assign the level that matches the actual cybersecurity risk, not the tone of the item:
- critical : active breach or exploit in progress; ransomware/malware active; credentials already compromised; data exfiltration confirmed; a core security control (EDR, firewall, SIEM) completely down or bypassed
- high     : MFA missing or not enforced on any users; known unpatched CVEs on reachable systems; EDR/antivirus disabled or not deployed; full-disk encryption absent; admin credentials exposed; privilege escalation risk; key production systems unprotected
- medium   : policy gap or not yet enforced; overdue access review; patching delayed with no active CVE; monitoring or alerting gap; audit finding without immediate exploitation risk; misconfiguration with limited exposure
- low      : documentation or process update; awareness or training task; low-impact configuration tweak; informational follow-up with no direct security exposure

Rules: each source item above = its own task object; no merging; severity = use SEVERITY GUIDANCE above, do not default to medium; due dates: critical=${addDays(14)}, high=${addDays(30)}, medium/low=${addDays(90)}; ownerType: CUSTOMER|ACCOUNT_MANAGER|SHARED.

FIELD SEPARATION — strictly enforced:
- "actionPlan" = HOW to fix it: numbered executable steps ONLY (action verbs: Enable, Patch, Deploy, Enforce, Review, Notify). NEVER include risk statements or consequences here.
- "businessImpact" = WHAT HAPPENS IF NOT FIXED: risk, exposure, or consequence only. NEVER include steps or numbered lists here.

[
  {
    "title": "...",
    "actionPlan": "1. [Executable step]. 2. [Next step]. 3. [Verification step].",
    "businessImpact": "Risk or consequence if not resolved — no steps, no numbered lists.",
    "remediationStrategy": "immediate_fix|workaround|long_term_fix|escalation",
    "severity": "critical|high|medium|low",
    "category": "Vulnerability Management|Access Control|Configuration|Patching|MFA|EDR Coverage|Other",
    "riskReductionScore": 75,
    "recommendedOwner": "...",
    "recommendedOwnerType": "CUSTOMER|ACCOUNT_MANAGER|SHARED",
    "dueDateSuggestion": "YYYY-MM-DD",
    "aiConfidence": 0.85
  }
]`;
  },

  /**
   * Builds a short, focused prompt for per-item post-meeting generation.
   * Each call produces exactly ONE JSON object for a single source item
   * (an action item, risk, or follow-up action from the meeting notes).
   *
   * Keeping the prompt small (~300 tokens input) ensures each Ollama call
   * completes in 15–40s, well within the configured timeout.
   *
   * @param {object} opts
   * @param {object} opts.tenant     - { name, industry, accountManager }
   * @param {string} opts.item       - The source text (action item / risk / follow-up)
   * @param {string} opts.itemType   - 'action_item' | 'risk' | 'follow_up'
   * @param {Array}  opts.openTasks  - Currently open tasks (dedup hint to AI)
   * @param {Array}  opts.findings   - Normalised findings (context only)
   * @returns {string} prompt
   */
  buildSingleTask({ tenant, item, itemType, openTasks = [], findings = [], meetingSummary = '' }) {
    const today = new Date().toISOString().slice(0, 10);

    const TYPE_LABEL = {
      action_item: 'ACTION ITEM — an assigned task committed to during the meeting',
      risk:        'RISK — a security threat or vulnerability raised during the meeting',
      follow_up:   'FOLLOW-UP — a scheduled review or follow-on task from the meeting',
    };

    const openTaskLines = openTasks.slice(0, 8)
      .map((t, i) => `  ${i + 1}. "${t.title}" — ${t.remediationStatus || 'open'}`)
      .join('\n') || '  None.';

    // Omit NXG360 findings for all item types — the model consistently latches onto
    // finding text (exact counts, device numbers) even when told not to, producing
    // NXG360-sourced titles instead of tasks from the meeting discussion.
    const findingsSection = '';

    // Sanitize: replace any double-quotes inside the item so embedding it in
    // the quoted prompt line doesn't produce malformed text like "Sachin "Gmail" check".
    const safeItem = item.replace(/"/g, "'");

    const meetingContextBlock = meetingSummary
      ? `\nMEETING CONTEXT (use this to clarify vague references like "devices" or "users" in the source item — do NOT generate tasks from this context, only use it to add specificity to the SOURCE ITEM):\n"${meetingSummary.slice(0, 250)}"\n`
      : '';

    return `Return ONLY a single JSON object. No array. No text outside the object. No markdown.

TENANT: ${tenant.name} | Date: ${today}
ITEM TYPE: ${TYPE_LABEL[itemType] || itemType}
${meetingContextBlock}
SOURCE ITEM (your ONLY input — do not invent details not present here):
"${safeItem}"

OPEN TASKS (do not duplicate):
${openTaskLines}

SEVERITY GUIDANCE:
- critical : active breach; credentials compromised; core security control completely down
- high     : MFA missing; known unpatched CVEs; EDR disabled; admin credentials exposed
- medium   : policy gap; overdue access review; monitoring gap; limited exposure
- low      : documentation update; awareness task; low-impact tweak

FORMAT EXAMPLE — fictional names used deliberately so you cannot copy them into a real task:

SOURCE A: "Alice will audit the Omega portal and disable any inactive admin accounts."
BAD title:  "Portal Access Management" (too vague — drops the person and the specific action)
BAD plan:   "1. Review portal. 2. Remove accounts." (only 2 steps, no specifics)
GOOD title: "Alice to audit Omega portal and disable inactive admin accounts"
GOOD plan:  "1. Alice will pull the full admin account list from the Omega portal console. 2. Alice will flag accounts with no activity in the last 90 days. 3. Alice will disable those accounts and verify no active sessions remain."
GOOD businessImpact: "Inactive admin accounts on the Omega portal are potential entry points for credential attacks, increasing privilege escalation risk."

SOURCE B: "Carlos will reconfigure the Delta directory access settings by month-end."
GOOD title: "Carlos to reconfigure Delta directory access settings by month-end"
GOOD plan:  "1. Carlos will open the Delta directory admin panel and review current access policies. 2. Carlos will apply the required changes described in the commitment. 3. Carlos will confirm with the security team that reconfiguration is complete by the stated deadline."
GOOD businessImpact: "Misconfigured Delta directory settings leave access controls incorrect, exposing sensitive resources to unauthorised access."

CRITICAL: Alice, Carlos, Omega portal, Delta directory are FICTIONAL — used only to show format. Do NOT use these names or steps in your output. Your actionPlan and businessImpact MUST be derived entirely from YOUR SOURCE ITEM above.

RULES — every rule is mandatory:
1. "title" — transform the SOURCE ITEM into a task title using this rule: strip the person's name from the start, then begin with an action verb (Investigate/Verify/Share/Enable/Schedule/Resolve/Finalize/Deploy/Review/Pilot/Document/Evaluate/Assign/Re-push/Validate/Audit). Also strip any trailing " — Owner: [name]" suffix. Include specific numbers and system names (e.g. "Investigate 36 devices missing Check Point EDR", "Enable MFA for 9 users", "Verify 47 users with expired passwords", "Share Security Posture Excel with customer"). Max 80 chars. Do not add detail not in the SOURCE ITEM. EXAMPLE: SOURCE "Rakesh will investigate 36 devices missing from Check Point EDR" → title "Investigate 36 devices missing from Check Point EDR".
2. "actionPlan" — MINIMUM 3 numbered steps. Each step starts with an action verb. Steps must reference the specific person, system, or tool from the SOURCE ITEM. If the item mentions a specific security tool or control (e.g. CrowdStrike, MFA, FDE, JumpCloud, Intune), use your security knowledge to write technically specific steps — include the management console path, exact configuration action, and how to verify the change; do not just say "configure it". Final step must confirm or verify completion. Format: "1. Step. 2. Step. 3. Step."
3. "businessImpact" — one or two sentences: what goes wrong if this commitment is not delivered. No steps, no numbered lists.
4. "severity" — use SEVERITY GUIDANCE; do not default to high unless justified.
5. "recommendedOwner" — extract the person name from the SOURCE ITEM: the name at the start before "will" or after "Owner:". Write a role name only if no person is named.
6. "dueDateSuggestion" — use any date mentioned in the SOURCE ITEM; otherwise critical=${addDays(14)}, high=${addDays(30)}, medium/low=${addDays(90)}.
7. ownerType: CUSTOMER=requires customer-side access, ACCOUNT_MANAGER=security team resolves, SHARED=both parties.

{
  "title": "Person name + specific action from the meeting item (max 80 chars)",
  "actionPlan": "1. [step referencing person/system from SOURCE ITEM]. 2. [next step]. 3. [step]. 4. [verify completion].",
  "businessImpact": "<What security or business risk results if this specific commitment is not delivered — 1-2 sentences, no steps>",
  "remediationStrategy": "immediate_fix|workaround|long_term_fix|escalation",
  "severity": "critical|high|medium|low",
  "category": "Vulnerability Management|Access Control|Configuration|Patching|MFA|EDR Coverage|Other",
  "riskReductionScore": 75,
  "recommendedOwner": "Exact person name or team from the item",
  "recommendedOwnerType": "CUSTOMER|ACCOUNT_MANAGER|SHARED",
  "dueDateSuggestion": "YYYY-MM-DD",
  "aiConfidence": 0.85
}`;
  },

  /**
   * Builds a batch prompt for post-meeting task generation.
   * Asks for a JSON array of exactly items.length task objects in the same order
   * as the input items. Used by generatePerItem for 3-at-a-time batch calls.
   *
   * @param {object}   opts.tenant        - { name }
   * @param {Array}    opts.items         - Array of { text, type } — 1 to BATCH_SIZE items
   * @param {Array}    opts.openTasks     - Open tasks for dedup hint
   * @param {string}   opts.meetingSummary - Meeting summary for context
   * @returns {string} prompt
   */
  buildBatchTasks({ tenant, items, openTasks = [], findings = [], meetingSummary = '' }) {
    const today = new Date().toISOString().slice(0, 10);

    const TYPE_LABEL = {
      action_item: 'ACTION ITEM',
      risk:        'RISK',
      follow_up:   'FOLLOW-UP',
    };

    const openTaskLines = openTasks.slice(0, 8)
      .map((t, i) => `  ${i + 1}. "${t.title}" — ${t.remediationStatus || 'open'}`)
      .join('\n') || '  None.';

    const meetingContextBlock = meetingSummary
      ? `\nMEETING CONTEXT (use to clarify vague references in items — do NOT generate tasks from this context):\n"${meetingSummary.slice(0, 250)}"\n`
      : '';

    const itemLines = items.map((item, idx) => {
      const safeText  = (item.text || '').replace(/"/g, "'");
      const typeLabel = TYPE_LABEL[item.type] || item.type;
      return `${idx + 1}. [${typeLabel}] "${safeText}"`;
    }).join('\n');

    return `Return ONLY a JSON array of exactly ${items.length} objects — one per source item, in the same order. No text outside the array. No markdown.

TENANT: ${tenant.name} | Date: ${today}
${meetingContextBlock}
SOURCE ITEMS (generate ONE task object per item, in order):
${itemLines}

OPEN TASKS (do not duplicate):
${openTaskLines}

SEVERITY GUIDANCE:
- critical: active breach; credentials compromised; core security control completely down
- high: MFA missing; unpatched CVEs; EDR disabled; admin credentials exposed
- medium: policy gap; overdue review; monitoring gap; limited exposure
- low: documentation update; awareness task; low-impact tweak

RULES (apply to every object — same order as source items):
1. "title" — begin with an action verb: Investigate / Verify / Share / Enable / Schedule / Resolve / Finalize / Deploy / Review / Pilot / Document / Evaluate / Assign / Re-push / Escalate / Validate / Audit. Include specific numbers and system names from the source item (e.g. "Investigate 36 devices missing Check Point EDR", "Enable MFA for 9 users", "Share OS patching compliance report"). Do NOT start with a person's name — person goes in recommendedOwner only. Max 80 chars.
2. "actionPlan" — MINIMUM 3 numbered steps. Each step references the specific person, system, or tool from that item. Final step verifies completion.
3. "businessImpact" — 1-2 sentences: what goes wrong if this commitment is not delivered.
4. "severity" — use SEVERITY GUIDANCE above; do not default to high unless justified.
5. "recommendedOwner" — extract the person name from the source item (look for "Owner: [name]" at the end, or the person mentioned as responsible). Write a role name if no person is named.
6. "dueDateSuggestion" — date mentioned in the source item, or: critical=${addDays(14)}, high=${addDays(30)}, medium/low=${addDays(90)}.
7. "recommendedOwnerType" — CUSTOMER|ACCOUNT_MANAGER|SHARED.

[
  {"title": "Person name + specific action (max 80 chars)", "actionPlan": "1. [step]. 2. [step]. 3. [step]. 4. [verify].", "businessImpact": "What risk results if not delivered.", "remediationStrategy": "immediate_fix|workaround|long_term_fix|escalation", "severity": "critical|high|medium|low", "category": "Vulnerability Management|Access Control|Configuration|Patching|MFA|EDR Coverage|Other", "riskReductionScore": 75, "recommendedOwner": "Exact person name or team", "recommendedOwnerType": "CUSTOMER|ACCOUNT_MANAGER|SHARED", "dueDateSuggestion": "YYYY-MM-DD", "aiConfidence": 0.85}
]`;
  },

  /**
   * Builds a focused single-finding prompt for pre-meeting per-finding generation.
   * Asks for exactly ONE task object for the specific finding provided.
   * Used by AIRecommendationService when looping through critical/high findings.
   */
  buildPreMeetingFinding({ tenant, finding, openTasks = [], taskTitle = null }) {
    const today    = new Date().toISOString().slice(0, 10);
    const sevLower = (finding.severity || 'medium').toLowerCase();
    const dueDate  = { critical: addDays(14), high: addDays(30), medium: addDays(90), low: addDays(90) }[sevLower] || addDays(90);
    const strategy = { critical: 'immediate_fix', high: 'immediate_fix', medium: 'long_term_fix', low: 'long_term_fix' }[sevLower] || 'long_term_fix';
    const riskScore = { critical: 92, high: 78, medium: 55, low: 35 }[sevLower] || 55;

    // Deterministic owner — derived from finding category, never left to the model.
    const OWNER_MAP = {
      Devices:    { name: `${tenant.name} IT Operations Team`,         type: 'CUSTOMER' },
      Identity:   { name: 'Identity & Access Management Team',          type: 'SHARED' },
      Response:   { name: 'Security Operations Center (SOC)',            type: 'ACCOUNT_MANAGER' },
      Compliance: { name: 'Security & Compliance Team',                  type: 'SHARED' },
      Code:       { name: `${tenant.name} DevSecOps Team`,              type: 'CUSTOMER' },
      Network:    { name: 'Network Security Team',                       type: 'ACCOUNT_MANAGER' },
    };
    const ownerInfo = OWNER_MAP[finding.category] || { name: 'Security Operations Team', type: 'ACCOUNT_MANAGER' };

    const openTaskLines = openTasks.slice(0, 4)
      .map((t, i) => `  ${i + 1}. ${t.title}`)
      .join('\n') || '  None.';

    // ── Title is pre-computed (compliance matrix findings) ────────────────────
    // When taskTitle is provided the AI only needs to generate actionPlan and
    // businessImpact. The locked title is shown in the example JSON so the model
    // copies it exactly without rephrasing.
    if (taskTitle) {
      return `Return ONLY a single JSON object. No arrays. No text outside the JSON. No markdown.

TENANT: ${tenant.name} | Date: ${today}

SECURITY FINDING (${sevLower.toUpperCase()}):
Title       : ${finding.title}
Description : ${finding.description || 'No description provided.'}${finding.category ? `\nCategory    : ${finding.category}` : ''}${finding.systemAffected ? `\nSystem      : ${finding.systemAffected}` : ''}

TASK TITLE (already decided — copy this into "title" exactly, do not rephrase):
"${taskTitle}"

OPEN TASKS (do NOT generate a duplicate of these):
${openTaskLines}

YOUR JOB — generate exactly 2 fields using your cybersecurity expertise:

1. "actionPlan"
   - A SINGLE string. NEVER an array.
   - 3 to 4 numbered steps, each starting with an action verb.
   - Use your trained knowledge of the specific security control named in the finding to write steps an IT admin can follow TODAY:
     • EDR tools: read the EXACT product name from the finding title and description (e.g. "CrowdStrike Falcon", "SentinelOne", "Microsoft Defender", "CheckPoint Harmony Endpoint"). Use deployment steps for THAT specific product only. If no product name is mentioned, write generic vendor-agnostic EDR deployment steps — do NOT invent a product name.
     • MDM/device management (JumpCloud, Intune, Jamf): enrollment method, agent installation, policy group assignment.
     • MFA/authentication: which MFA method to enable, how to enforce it via the IdP, how to confirm the user has registered.
     • Disk encryption (BitLocker/FileVault): exact OS settings path to enable, how to escrow the recovery key.
     • Patching: how to check pending updates, apply them, and verify the system is current.
     • Password: reset procedure, policy enforcement, and expiry notification setup.
   - Reference the EXACT hostname and assigned user from the finding Description above in at least one step.
   - Final step: verify the fix is visible in the relevant security management console.
   - Format: "1. <step>. 2. <step>. 3. <step>. 4. <verification step>."

2. "businessImpact"
   - 1-2 sentences: what is the security risk if this finding is NOT fixed?
   - Name the specific device or user from the finding above.
   - No action steps. Only: what goes wrong if left unresolved?

NXG360 EXAMPLE (fictional device — do not copy these names into your output):
Finding title: "Deploy CrowdStrike EDR on DEMO-PC-01 (Win11 25H2)"
Description:   "CrowdStrike EDR is No on this device. Device: DEMO-PC-01 | Win11 25H2. Assigned user: Jane Doe / jane@example.com."

GOOD actionPlan — CrowdStrike steps used here ONLY because "CrowdStrike" appears in the finding title and description above. If the finding named a different tool (e.g. CheckPoint, SentinelOne), use that tool's steps instead. If no tool is named, use generic steps:
"1. In the CrowdStrike Falcon console go to Host Setup and Management → Sensor Downloads and download the Windows sensor package. 2. Run the installer as Administrator on DEMO-PC-01 using the Customer ID and installation token from the console. 3. Notify Jane Doe (jane@example.com) that installation is complete. 4. Confirm DEMO-PC-01 appears in the CrowdStrike Falcon Hosts list within 30 minutes with sensor health showing Active."
GOOD businessImpact: "DEMO-PC-01 has no endpoint detection coverage — any malware, ransomware, or breach activity on this device will be invisible to the security team until after damage occurs, eliminating the ability to contain or investigate the incident in time."

ALL OTHER FIELDS are pre-determined — output them EXACTLY as shown, do not change them:

{
  "title": "${taskTitle}",
  "actionPlan": "1. <specific step using security tool knowledge + exact device/user from finding>. 2. <step>. 3. <step>. 4. <verification step confirming fix in management console>.",
  "businessImpact": "<1-2 sentences on the specific risk if not fixed — name the device/user, no steps>",
  "remediationStrategy": "${strategy}",
  "severity": "${sevLower}",
  "category": "${finding.category || 'Vulnerability Management'}",
  "riskReductionScore": ${riskScore},
  "recommendedOwner": "${ownerInfo.name}",
  "recommendedOwnerType": "${ownerInfo.type}",
  "dueDateSuggestion": "${dueDate}",
  "aiConfidence": 0.9
}`;
    }

    // ── Fallback: non-compliance-matrix finding — AI generates the title too ──
    const numbers = finding.description
      ? (finding.description.match(/\d+[\d,]*(?:\.\d+)?(?:\s*(?:%|devices?|users?|accounts?|alerts?|hours?|days?|repositories?))?/gi) || [])
          .slice(0, 4).join(', ')
      : '';

    return `Return ONLY a single JSON object. No arrays. No text outside the JSON. No markdown.

TENANT: ${tenant.name} | Date: ${today}

SECURITY FINDING (${sevLower.toUpperCase()}):
Title       : ${finding.title}
Description : ${finding.description || 'No description provided.'}${finding.category ? `\nCategory    : ${finding.category}` : ''}${finding.systemAffected ? `\nSystem      : ${finding.systemAffected}` : ''}${numbers ? `\nKey metrics : ${numbers}` : ''}

OPEN TASKS (do NOT generate a duplicate of these):
${openTaskLines}

YOUR JOB — generate exactly 3 fields for this finding:

1. "title"
   - Start with an action verb: Deploy / Enforce / Enable / Patch / Configure / Restrict / Rotate
   - Name the SECURITY CONTROL first, then the device or user — e.g. "Deploy EDR on HOSTNAME" or "Enable BitLocker on HOSTNAME"
   - Do NOT start with the device name — the control name must come first
   - Max 80 characters

2. "actionPlan"
   - A SINGLE string. NEVER an array.
   - 3 to 4 numbered steps, each starting with an action verb.
   - Use your trained knowledge of the security control named in the finding:
     • EDR tools: read the EXACT product name from the finding title and description. Use steps for THAT specific product only. If no product name is mentioned, write generic vendor-agnostic EDR steps — do NOT invent a product name.
     • MDM (JumpCloud, Intune, Jamf): enrollment method, agent install, policy assignment.
     • MFA: which method to enable, how to enforce via IdP, how to confirm registration.
     • Disk encryption (BitLocker/FileVault): OS settings path, recovery key escrow.
     • Patching: check pending updates, apply, verify system is current.
     • Password: reset procedure, policy enforcement, expiry notification.
   - Reference the exact hostname and assigned user from the finding in at least one step.
   - Final step must verify the fix in the relevant security management console.
   - Format: "1. <step>. 2. <step>. 3. <step>. 4. <verification step>."

3. "businessImpact"
   - 1-2 sentences: what is the security risk if this finding is NOT fixed?
   - Name the specific device or user from the finding above.
   - No action steps. Only: what goes wrong if left unresolved?

ALL OTHER FIELDS are pre-determined — output them EXACTLY as shown below, do not change them:

{
  "title": "<action verb + security control name + device/user — max 80 chars>",
  "actionPlan": "1. <specific step>. 2. <specific step>. 3. <verification step>.",
  "businessImpact": "<risk if not fixed — name specific device/user, no steps>",
  "remediationStrategy": "${strategy}",
  "severity": "${sevLower}",
  "category": "${finding.category || 'Vulnerability Management'}",
  "riskReductionScore": ${riskScore},
  "recommendedOwner": "${ownerInfo.name}",
  "recommendedOwnerType": "${ownerInfo.type}",
  "dueDateSuggestion": "${dueDate}",
  "aiConfidence": 0.9
}`;
  },
};

module.exports = PromptBuilder;
