'use strict';

const logger = require('./logger');

// Severity-value vocabulary — used for value-based column detection throughout.
// Deliberately excludes single-digit numbers (1-4) and "none" because those appear
// in compliance sheets (Days Since Seen, FDE Status = None) and cause false positives.
const SEVERITY_MATCH_RE = /^(critical|crit|high|medium|med|low|p1|p2|p3|p4|urgent|important|moderate|warning|minor|info|informational|inf|severe|negligible)$/i;

// Columns where "Yes/True/1" means the PROBLEM EXISTS (inverted logic).
// e.g. "Password Expired = Yes" means non-compliant.
const INVERTED_CONTROL_RE = /expired|expiry|overdue|missing|outstanding|flagged|outdated|lapsed/i;

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

function normalizeSeverity(raw) {
  switch (raw) {
    case 'critical': case 'crit': case 'p1': case '1': case 'urgent': case 'emergency': return 'critical';
    case 'high':     case 'p2':   case '2': case 'important':                            return 'high';
    case 'medium':   case 'med':  case 'p3': case '3': case 'moderate': case 'warning':  return 'medium';
    case 'low':      case 'p4':   case '4': case 'minor': case 'info': case 'informational': case 'inf': return 'low';
    default:         return raw;
  }
}

// ── Compliance-matrix KNOWN control definitions ───────────────────────────────
// These are the fast-path matches: if a column header contains one of these
// substrings (after normalisation) we already know its label, severity, and
// category.  Unknown controls are handled dynamically by value-analysis below.
const COMPLIANCE_CONTROLS = {
  // Identity & MFA
  mfa:         { label: 'MFA',                  severity: 'high',     category: 'MFA' },
  '2fa':       { label: 'MFA / 2FA',            severity: 'high',     category: 'MFA' },
  totp:        { label: 'MFA (TOTP)',            severity: 'high',     category: 'MFA' },
  // EDR / Endpoint
  edr:         { label: 'EDR',                  severity: 'critical', category: 'EDR Coverage' },
  endpoint:    { label: 'Endpoint Protection',  severity: 'critical', category: 'EDR Coverage' },
  antivirus:   { label: 'Antivirus',            severity: 'critical', category: 'EDR Coverage' },
  crowdstrike: { label: 'CrowdStrike EDR',      severity: 'critical', category: 'EDR Coverage' },
  falcon:      { label: 'CrowdStrike Falcon',   severity: 'critical', category: 'EDR Coverage' },
  sentinelone: { label: 'SentinelOne EDR',      severity: 'critical', category: 'EDR Coverage' },
  defender:    { label: 'Windows Defender',     severity: 'critical', category: 'EDR Coverage' },
  checkpoint:  { label: 'Check Point EDR',      severity: 'critical', category: 'EDR Coverage' },
  checkpointedr: { label: 'Check Point EDR',   severity: 'critical', category: 'EDR Coverage' },
  harmonyep:   { label: 'Check Point Harmony',  severity: 'critical', category: 'EDR Coverage' },
  cylance:     { label: 'Cylance EDR',          severity: 'critical', category: 'EDR Coverage' },
  carbonblack: { label: 'Carbon Black EDR',     severity: 'critical', category: 'EDR Coverage' },
  trellix:     { label: 'Trellix EDR',          severity: 'critical', category: 'EDR Coverage' },
  sophos:      { label: 'Sophos EDR',           severity: 'critical', category: 'EDR Coverage' },
  bitdefender: { label: 'Bitdefender EDR',      severity: 'critical', category: 'EDR Coverage' },
  // MDM / Device Management
  mdm:         { label: 'MDM Enrollment',       severity: 'high',     category: 'Device Management' },
  jumpcloud:   { label: 'JumpCloud MDM',        severity: 'high',     category: 'Device Management' },
  jamf:        { label: 'Jamf MDM',             severity: 'high',     category: 'Device Management' },
  intune:      { label: 'Microsoft Intune',     severity: 'high',     category: 'Device Management' },
  // Encryption & Configuration
  fde:         { label: 'Full Disk Encryption', severity: 'high',     category: 'Configuration' },
  encrypt:     { label: 'Encryption',           severity: 'high',     category: 'Configuration' },
  // Patching
  patch:       { label: 'Patching',             severity: 'high',     category: 'Patching' },
  update:      { label: 'Updates',              severity: 'high',     category: 'Patching' },
  // Password
  password:    { label: 'Password',             severity: 'high',     category: 'Access Control' },
  passwd:      { label: 'Password',             severity: 'high',     category: 'Access Control' },
  // Network Security
  zscaler:     { label: 'Zscaler',              severity: 'medium',   category: 'Network Security' },
  firewall:    { label: 'Firewall',             severity: 'high',     category: 'Network Security' },
  vpn:         { label: 'VPN',                  severity: 'medium',   category: 'Network Security' },
  proxy:       { label: 'Web Proxy',            severity: 'medium',   category: 'Network Security' },
  // Compliance
  dlp:         { label: 'DLP',                  severity: 'medium',   category: 'Compliance' },
  policy:      { label: 'Policy Compliance',    severity: 'medium',   category: 'Compliance' },
  // Access Control
  iam:         { label: 'IAM',                  severity: 'high',     category: 'Access Control' },
  pam:         { label: 'PAM',                  severity: 'high',     category: 'Access Control' },
  sso:         { label: 'SSO',                  severity: 'medium',   category: 'Access Control' },
  // Other
  siem:        { label: 'SIEM',                 severity: 'high',     category: 'Vulnerability Management' },
  ids:         { label: 'IDS/IPS',              severity: 'medium',   category: 'Network Security' },
  ips:         { label: 'IDS/IPS',              severity: 'medium',   category: 'Network Security' },
  waf:         { label: 'WAF',                  severity: 'medium',   category: 'Network Security' },
  ueba:        { label: 'UEBA',                 severity: 'medium',   category: 'Vulnerability Management' },
  backup:      { label: 'Backup',               severity: 'high',     category: 'Configuration' },
};

// Values that indicate a control is non-compliant
const NON_COMPLIANT_RE = /^(n|no|disabled?|not\s+(installed|configured|enabled|deployed|protected|compliant|active|managed|found)|missing|false|0|none|fail(ed)?|inactive|unmanaged|pending|expired|unknown|absent|not\s+ok|n\/a|na)$/i;

// Values that are clearly compliant — skip these silently
const COMPLIANT_RE = /^(y|yes|enabled?|installed|true|1|ok|pass|compliant|active|managed|configured|protected|deployed|running|normal|good|done|complete)$/i;

function isNonCompliant(value, controlKey) {
  if (!value || value.trim() === '') return true; // blank = missing = non-compliant
  const v = value.trim();

  // Inverted columns: "Password Expired = Yes" means the problem EXISTS.
  if (INVERTED_CONTROL_RE.test(controlKey)) {
    if (/^(yes|true|1|expired|lapsed|overdue)$/i.test(v)) return true;
    if (/^(no|false|0|ok|current|valid|not\s+expired)$/i.test(v)) return false;
    // Past date (ISO or MM/DD/YYYY) in an expiry column → expired
    const d = new Date(v);
    if (!isNaN(d.getTime()) && d.getTime() < Date.now()) return true;
    return false;
  }

  if (NON_COMPLIANT_RE.test(v)) return true;
  if (COMPLIANT_RE.test(v))    return false;
  // Patching/Update columns: "45 days", "30 days overdue" → non-compliant
  if (/patch|update/i.test(controlKey) && /\d+\s*days?/i.test(v)) return true;
  // Pure number > 0 in days context
  if (/patch|update/i.test(controlKey) && /^\d+$/.test(v) && parseInt(v, 10) > 0) return true;
  return false;
}

// ── Identifier columns (user/device rows in compliance matrix) ────────────────
const IDENTIFIER_PATTERNS = /user|email|name|host|device|machine|employee|login|account|id|display|dept|location|department|username|computer|workstation|asset|endpoint/i;

// Values that are placeholder text in report exports, not real user/device identifiers.
// NXG360 and similar MSSP platforms use these when a device has no assigned user,
// or when a contact/support column gets mistaken for a user identifier.
const SUBJECT_BLOCKLIST = new Set([
  'unknown user', 'unknown', 'n/a', 'na', 'not available', 'not applicable',
  'not assigned', 'unassigned', 'none', 'null', 'undefined', 'reach us',
  'contact us', 'contact', 'support', 'no user', 'no name', 'n.a', '-', '--', '—',
  'not configured', 'not enrolled', 'not found', 'missing',
]);

// Stricter than isUsableId — also rejects known placeholder strings.
// Used for subject/user resolution so "Unknown User" and "Reach Us" never appear
// in finding titles; those rows aggregate into the anonymous-device bucket instead.
function isValidSubject(v) {
  if (!v || !v.trim()) return false;
  if (/^\d+$/.test(v.trim())) return false;
  if (SUBJECT_BLOCKLIST.has(v.trim().toLowerCase())) return false;
  return true;
}

// ── Normalise a column header for matching ────────────────────────────────────
function normHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[\s\-_.]/g, '');
}

// ── Header-row locator ────────────────────────────────────────────────────────
// Some report exports (e.g. NXG360) prefix the data with one or more summary /
// metadata rows before the actual column-header row.  This scans the first
// `maxScan` rows and returns the index of the row most likely to be the real
// header row, so the parser can slice off leading summary rows.
//
// Scoring heuristics:
//   +4  cell text contains a known compliance-control keyword
//   +3  cell text matches identifier patterns (email, hostname, user…)
//   +2  cell text is a generic column-name word (status, state, enabled…)
//   +0.5 per non-empty cell (denser rows = more likely to be a header)
//   -6  cell contains an actual email address (@domain.tld)
//   -4  cell contains a date string (metadata rows, not column names)
//   -3  single cell longer than 60 chars with spaces (report title / paragraph)
function findHeaderRow(rows, maxScan = 6) {
  if (rows.length < 2) return 0;

  let bestScore = -Infinity;
  let bestIdx   = 0;

  const limit = Math.min(maxScan, rows.length - 1); // keep at least 1 data row after

  for (let i = 0; i < limit; i++) {
    const cells    = rows[i].map((c) => String(c ?? '').trim());
    const nonEmpty = cells.filter(Boolean);
    if (nonEmpty.length < 2) continue; // too sparse to be a header row

    let score = 0;
    for (const cell of nonEmpty) {
      const n = normHeader(cell);

      // Known control keyword in cell text → strong signal this is a header
      for (const key of Object.keys(COMPLIANCE_CONTROLS)) {
        if (n.includes(key)) { score += 4; break; }
      }
      // Identifier-type words (email, hostname, user, device…)
      if (IDENTIFIER_PATTERNS.test(cell))                                      score += 3;
      // Generic column-name vocabulary
      if (/status|state|enabled|configured|installed|compliant|last\s*seen|days\s*since|serial|manufacturer|policy/i.test(cell)) score += 2;
      // Actual email address → this is data, not a column name
      if (/@[a-z0-9\-]+\.[a-z]{2,}/i.test(cell))                              score -= 6;
      // Date strings → report metadata rows, not column names
      if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/i.test(cell)) score -= 4;
      // Long sentence-like text → likely a report title or summary paragraph
      if (cell.length > 60 && cell.includes(' '))                              score -= 3;
    }
    // More populated cells = higher confidence it is the real header row
    score += nonEmpty.length * 0.5;

    // Merged-title rows have all cells set to the same value (Excel merged cell behaviour).
    // A real header row always has distinct column names — penalise heavily so title rows
    // can never beat the actual header row even when they contain control keywords.
    const uniqueVals = new Set(nonEmpty.map((c) => c.toLowerCase().slice(0, 30)));
    if (uniqueVals.size === 1 && nonEmpty.length > 2) score -= 50;

    if (score > bestScore) {
      bestScore = score;
      bestIdx   = i;
    }
  }
  return bestIdx;
}

// ── Dynamic control-column detection by cell values ───────────────────────────
// Determines if a column is a security control even when the header is an
// unknown vendor or product name.  A column qualifies as a control when:
//   1. Its header doesn't look like a person/device identifier.
//   2. It has low cardinality (≤8 distinct values) — categorical, not free-text.
//   3. At least one of those values sounds like a compliance answer.
// This means "CrowdStrike: Yes/No", "Jamf: Enrolled/Not Enrolled",
// "Okta: Active/Inactive", etc. are all detected without any hardcoding.
const COMPLIANCE_VALUE_RE = /^(yes|no|enabled?|disabled?|installed|not[\s_]installed|not[\s_]enrolled|enrolled|compliant|non[\s_-]?compliant|active|inactive|managed|unmanaged|configured|not[\s_]configured|protected|not[\s_]protected|deployed|not[\s_]deployed|connected|not[\s_]connected|licens\w*|true|false|pass|fail(ed)?|ok|missing|none|absent|pending|expired|unknown|na|n\/a|0|1|found|not[\s_]found|flagged|remediat\w*)$/i;

function isControlColumnByValues(header, colValues) {
  if (IDENTIFIER_PATTERNS.test(header)) return false;

  const nonEmpty = colValues.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (nonEmpty.length === 0) return false;

  // More than 8 distinct values → free-text field, not a categorical flag
  const unique = new Set(nonEmpty.map((v) => v.toLowerCase()));
  if (unique.size > 8) return false;

  // At least one value must sound like a compliance answer
  return [...unique].some((v) => COMPLIANCE_VALUE_RE.test(v));
}

// ── Detect file format ────────────────────────────────────────────────────────
// Accepts the full rows array so it can sample data for value-based detection.
// Returns 'findings' | 'compliance_matrix'
function detectFormat(rows) {
  const headers  = rows[0].map(String);
  const dataRows = rows.slice(1, Math.min(11, rows.length)); // sample up to 10 rows

  let hasSeverityCol = false;
  let controlCount   = 0;

  for (let idx = 0; idx < headers.length; idx++) {
    const h         = headers[idx];
    const n         = normHeader(h);
    const colValues = dataRows.map((row) => String(row[idx] ?? '').trim()).filter(Boolean);

    // Value-based severity detection: column whose values are mostly severity keywords
    if (colValues.length > 0) {
      const sevHits = colValues.filter((v) => SEVERITY_MATCH_RE.test(v)).length;
      if (sevHits / colValues.length >= 0.4) hasSeverityCol = true;
    }

    // Fast path: known compliance-control keyword in header
    let isKnown = false;
    for (const key of Object.keys(COMPLIANCE_CONTROLS)) {
      if (n.includes(key)) { isKnown = true; break; }
    }
    if (isKnown) { controlCount++; continue; }

    // Dynamic path: check actual cell values for compliance-answer patterns
    if (isControlColumnByValues(h, colValues)) controlCount++;
  }

  // 3+ compliance control columns is a near-certain compliance matrix —
  // takes priority over any single false-positive severity column (e.g. a
  // "Days Since Seen" column whose numeric values look like P1/P2/P3/P4).
  if (controlCount >= 3) return 'compliance_matrix';
  // Clear severity vocabulary → findings list
  if (hasSeverityCol) return 'findings';
  // 2 control columns with no severity column → compliance matrix
  if (controlCount >= 2) return 'compliance_matrix';
  // Safe default
  return 'findings';
}

// ── Build header→index map for findings list (fully data-driven) ──────────────
// Detects columns by analysing actual cell values — no header name patterns.
function buildFindingsHeaderMap(headers, dataRows) {
  const IP_RE   = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
  const HOST_RE = /^[a-z0-9][a-z0-9\-_.]{2,30}$/i;

  // Profile every column by its data
  const cols = headers.map((_, idx) => {
    const vals     = dataRows.map((r) => String(r[idx] ?? '').trim()).filter(Boolean);
    const uniq     = new Set(vals.map((v) => v.toLowerCase()));
    const avgLen   = vals.reduce((s, v) => s + v.length, 0) / Math.max(vals.length, 1);
    const sevHits  = vals.filter((v) => SEVERITY_MATCH_RE.test(v)).length;
    const hostHits = vals.filter((v) => IP_RE.test(v) || (HOST_RE.test(v) && !/^\d+$/.test(v))).length;
    return {
      idx, vals, uniq, avgLen,
      sevRatio:  sevHits  / Math.max(vals.length, 1),
      hostRatio: hostHits / Math.max(vals.length, 1),
      uniqRatio: uniq.size / Math.max(vals.length, 1),
    };
  });

  const map  = {};
  const used = new Set();

  // 1. Severity: column with the highest ratio of severity-keyword values, low cardinality
  const sevCol = [...cols]
    .filter((c) => c.sevRatio >= 0.4 && c.uniq.size <= 10)
    .sort((a, b) => b.sevRatio - a.sevRatio)[0];
  if (sevCol) { map.severity = sevCol.idx; used.add(sevCol.idx); }
  else          map.severity = -1; // rowToFinding defaults to 'medium'

  // 2. System/host: column where most values look like IPs or short hostnames
  const hostCol = [...cols]
    .filter((c) => !used.has(c.idx) && c.hostRatio >= 0.3)
    .sort((a, b) => b.hostRatio - a.hostRatio)[0];
  if (hostCol) { map.systemAffected = hostCol.idx; used.add(hostCol.idx); }

  // 3. Title: moderate average length (≤200 chars) + high uniqueness
  //    The 200-char cap keeps verbose description/notes columns from winning.
  const titleCol = [...cols]
    .filter((c) => !used.has(c.idx) && c.avgLen >= 5 && c.avgLen <= 200 && c.uniqRatio >= 0.3)
    .sort((a, b) => b.avgLen - a.avgLen)[0]
    // Fallback: just the longest remaining column when no ideal candidate exists
    || [...cols].filter((c) => !used.has(c.idx)).sort((a, b) => b.avgLen - a.avgLen)[0];
  if (titleCol) { map.title = titleCol.idx; used.add(titleCol.idx); }

  // 4. Category: few distinct values (2–15), short text — likely an enum/label column
  const catCol = [...cols]
    .filter((c) => !used.has(c.idx) && c.uniq.size >= 2 && c.uniq.size <= 15 && c.avgLen < 40)
    .sort((a, b) => a.uniq.size - b.uniq.size)[0];
  if (catCol) { map.category = catCol.idx; used.add(catCol.idx); }

  // 5. Description: longest remaining text column
  const descCol = [...cols]
    .filter((c) => !used.has(c.idx) && c.avgLen >= 10)
    .sort((a, b) => b.avgLen - a.avgLen)[0];
  if (descCol) { map.description = descCol.idx; }

  return map;
}

function assertRequiredColumns(_map) {
  // title and severity are always resolved above — nothing to throw.
}

// ── Row → finding (findings list mode) ───────────────────────────────────────
function rowToFinding(cells, map, rowIndex) {
  const get = (field) => {
    const idx = map[field];
    return idx !== undefined ? String(cells[idx] ?? '').trim() : '';
  };

  const title  = get('title');
  const rawSev = get('severity').toLowerCase().replace(/[\s_\-\.]/g, '');
  const severity = normalizeSeverity(rawSev);

  if (!title) return null;
  const finalSeverity = VALID_SEVERITIES.has(severity) ? severity : 'medium';

  const rawScore = parseFloat(get('riskScore'));
  return {
    id:              `import-${Date.now()}-${rowIndex}`,
    sourceFindingId: `IMP-${String(rowIndex + 1).padStart(3, '0')}`,
    title,
    severity:        finalSeverity,
    category:        get('category')       || 'Vulnerability Management',
    systemAffected:  get('systemAffected') || null,
    description:     get('description')    || '',
    affectedCount:   0,
    riskScore:       isNaN(rawScore) ? 50 : Math.min(100, Math.max(0, rawScore)),
  };
}


// ── Context-column classifier for compliance matrix ───────────────────────────
// Identifies which non-control columns carry device/user metadata so we can
// include them in finding titles and descriptions.
function classifyContextCols(headers) {
  const ctx = {};
  headers.forEach((h, idx) => {
    const n = normHeader(h);
    // Use `n` (spaces/dashes stripped) for multi-word patterns like "Device Name" → "devicename"
    if (ctx.hostname     === undefined && /hostname|computername|devicename|machinename|systemname|assetname|endpointname|\bendpoint\b/i.test(n))  ctx.hostname     = idx;
    // OS: plain "OS" column keeps \bos\b on raw header; "Operating System" detected via normalized
    if (ctx.os           === undefined && (/\bos\b|\bplatform\b/i.test(h) || /operatingsystem|ostype/i.test(n))) ctx.os         = idx;
    if (ctx.manufacturer === undefined && /manufactur|vendor|make\b/i.test(h))                                 ctx.manufacturer = idx;
    if (ctx.serial       === undefined && /serialno|serialnumber|s\/n\b|assettag/i.test(n))                    ctx.serial       = idx;
    // Email: any column containing "email" — NXG360 uses "Email", "User Email", "Employee Email"
    if (ctx.userEmail    === undefined && /email/i.test(h))                                                    ctx.userEmail    = idx;
    // User name: expanded to match "User Name", "Full Name", "Display Name", "Employee Name",
    // "Primary User" — all common column titles across NXG360 and other MSSP platforms.
    if (ctx.userName     === undefined && /\b(user\s*name|full\s*name|display\s*name|employee\s*name|primary\s*user)\b/i.test(h)) ctx.userName = idx;
    if (ctx.username     === undefined && /primaryusername/i.test(n))                                          ctx.username     = idx;
    if (ctx.lastSeen     === undefined && /lastseen|lastcheckin|lastcontact|lastcheck/i.test(n))                ctx.lastSeen     = idx;
    if (ctx.daysSince    === undefined && /dayssince|daysago/i.test(n))                                        ctx.daysSince    = idx;
    if (ctx.userState    === undefined && /userstate|accountstate|accountstatus/i.test(n))                     ctx.userState    = idx;
  });
  return ctx;
}

// Rejects device identifiers that are pure integers (row numbers, S.No counts, numeric indexes).
// A bare number is not an actionable device name — "JumpCloud MDM missing — 3" tells no one
// which device to fix.  Non-numeric strings (hostnames, emails, usernames) pass through.
function isUsableId(v) {
  return !!(v && v.trim() && !/^\d+$/.test(v.trim()));
}

// ── Compliance matrix → findings ──────────────────────────────────────────────
function parseComplianceMatrixRows(rows) {
  if (rows.length < 2) throw new Error('Compliance sheet has no data rows.');

  const headers  = rows[0].map(String);
  const dataRows = rows.slice(1);

  // Map each column index to its control definition (known or dynamically-built)
  const controlCols   = {};  // idx → { key, def }
  const identifierCols = []; // idx (user/device identifier)

  headers.forEach((h, idx) => {
    const n = normHeader(h);

    // Fast path: column matches a known control keyword
    for (const [key, def] of Object.entries(COMPLIANCE_CONTROLS)) {
      if (n.includes(key)) {
        controlCols[idx] = { key, def };
        return;
      }
    }

    // Identifier column: skip as control
    if (IDENTIFIER_PATTERNS.test(h)) {
      identifierCols.push(idx);
      return;
    }

    // Dynamic path: unknown column — check values in this column
    const colValues = dataRows.map((row) => row[idx]);
    if (isControlColumnByValues(h, colValues)) {
      // Use the raw header as the label and default to 'high' severity.
      // Unknown controls are conservatively treated as high-severity gaps.
      controlCols[idx] = {
        key: n,
        def: {
          label:    h.trim(),
          severity: 'high',
          category: 'Security Compliance',
        },
      };
    }
  });

  if (Object.keys(controlCols).length === 0) {
    throw new Error('No security control columns detected. Please verify the file contains compliance status columns (e.g. Yes/No, Enabled/Disabled, Installed/Not Installed).');
  }

  // Classify context columns once (Hostname, OS, Manufacturer, Serial, etc.)
  const ctxCols = classifyContextCols(headers);

  logger.info('findingsFileParser: compliance matrix columns', {
    dataRows:        dataRows.length,
    controlCols:     Object.keys(controlCols).length,
    identifierCols:  identifierCols.length,
    hostname:        ctxCols.hostname  !== undefined ? `col[${ctxCols.hostname}]="${headers[ctxCols.hostname]}"` : 'NOT FOUND',
    userEmail:       ctxCols.userEmail !== undefined ? `col[${ctxCols.userEmail}]="${headers[ctxCols.userEmail]}"` : 'NOT FOUND',
    userName:        ctxCols.userName  !== undefined ? `col[${ctxCols.userName}]="${headers[ctxCols.userName]}"` : 'NOT FOUND',
    serial:          ctxCols.serial    !== undefined ? `col[${ctxCols.serial}]="${headers[ctxCols.serial]}"` : 'NOT FOUND',
    firstIdCols:     identifierCols.slice(0, 5).map(i => `[${i}]"${headers[i]}"`).join(', ') || 'none',
    firstControls:   Object.entries(controlCols).slice(0, 5).map(([i, { def }]) => `[${i}]"${headers[i]}"→${def.label}`).join(', '),
  });

  const findings = [];
  let rowIndex   = 0;
  // Rows with no usable device identifier are aggregated here (key → { def, count })
  // rather than emitted as individual findings with meaningless numeric suffixes.
  const anonByControl  = {};
  // Pre-built set of control column indexes — used by the last-resort identifier scan.
  const controlIdxSet  = new Set(Object.keys(controlCols).map(Number));

  for (let r = 0; r < dataRows.length; r++) {
    const cells = dataRows[r].map((c) => String(c ?? '').trim());
    if (cells.every((c) => !c)) continue; // skip blank rows

    // Skip repeated sub-header rows (the column label appears inside a control cell)
    // and skip report-summary rows (pipe-delimited descriptions, "All N devices…", etc.).
    // Both are artefacts of multi-section report exports and contain no device data.
    const isSubHeader = Object.entries(controlCols).some(([idxStr, { def }]) => {
      const cellVal = cells[parseInt(idxStr, 10)].toLowerCase();
      return def.label.toLowerCase().split(' ').some((w) => w.length > 3 && cellVal.includes(w));
    });
    if (isSubHeader) continue;
    const firstNonEmpty = cells.find(Boolean) || '';
    if (
      firstNonEmpty.includes('|') ||
      /^(total|count|report\s+date|all\s+\d|summary|active\s+user|inactive\s+user)/i.test(firstNonEmpty)
    ) continue;

    // Extract per-row context values
    const ctx = {
      hostname:     ctxCols.hostname     !== undefined ? cells[ctxCols.hostname]     : '',
      os:           ctxCols.os           !== undefined ? cells[ctxCols.os]           : '',
      manufacturer: ctxCols.manufacturer !== undefined ? cells[ctxCols.manufacturer] : '',
      serial:       ctxCols.serial       !== undefined ? cells[ctxCols.serial]       : '',
      userEmail:    ctxCols.userEmail    !== undefined ? cells[ctxCols.userEmail]    : '',
      userName:     ctxCols.userName     !== undefined ? cells[ctxCols.userName]     : '',
      username:     ctxCols.username     !== undefined ? cells[ctxCols.username]     : '',
      lastSeen:     ctxCols.lastSeen     !== undefined ? cells[ctxCols.lastSeen]     : '',
      daysSince:    ctxCols.daysSince    !== undefined ? cells[ctxCols.daysSince]    : '',
      userState:    ctxCols.userState    !== undefined ? cells[ctxCols.userState]    : '',
    };

    // Primary subject label: prefer hostname → email → name → first valid identifier.
    // isValidSubject rejects pure integers AND known placeholders like "Unknown User",
    // "Reach Us", "N/A" — those rows fall through to the anonymous aggregation path.
    let subject = (isValidSubject(ctx.hostname)  ? ctx.hostname  : null)
      || (isValidSubject(ctx.userEmail)           ? ctx.userEmail : null)
      || (isValidSubject(ctx.userName)            ? ctx.userName  : null)
      || (isValidSubject(ctx.username)            ? ctx.username  : null)
      || (identifierCols.length > 0
          ? identifierCols.map((i) => cells[i]).find((v) => isValidSubject(v)) ?? null
          : null);
    // Last-resort: scan every non-control column left-to-right for any usable value.
    // Handles files whose device/user column name doesn't match any known pattern.
    if (!subject) {
      subject = cells.reduce((found, v, i) => {
        if (found) return found;
        if (controlIdxSet.has(i)) return null;
        return isValidSubject(String(v ?? '').trim()) ? String(v).trim() : null;
      }, null);
    }

    // systemAffected: hostname is best; fall back to serial, then first valid identifier
    const systemAffected = (isValidSubject(ctx.hostname) ? ctx.hostname : null)
      || (isUsableId(ctx.serial) ? ctx.serial : null)
      || (identifierCols.length > 0 ? identifierCols.map((i) => cells[i]).find((v) => isValidSubject(v)) ?? null : null)
      || null;

    for (const [idxStr, { key, def }] of Object.entries(controlCols)) {
      const idx   = parseInt(idxStr, 10);
      const value = cells[idx] || '';

      if (!isNonCompliant(value, key)) continue;

      // ── Title ──────────────────────────────────────────────────────────────
      // Format: "<Control> not configured — <Hostname> (<OS short>)"
      const osBrief  = ctx.os ? ctx.os.replace(/windows\s*/i, 'Windows ').split(/\s+/).slice(0, 3).join(' ') : '';
      const deviceId = (isValidSubject(ctx.hostname) ? ctx.hostname : null)
        || (isUsableId(ctx.serial) ? ctx.serial : null)
        || subject; // subject is already filtered through isValidSubject

      // No valid device identifier (numeric IDs, "Unknown User", "N/A", etc.) →
      // aggregate into one finding per control rather than creating unactionable per-row noise.
      if (!deviceId) {
        if (!anonByControl[key]) anonByControl[key] = { def, count: 0 };
        anonByControl[key].count++;
        continue;
      }

      const titleSuffix = osBrief ? `${deviceId} (${osBrief})` : deviceId;
      const title = value && !/^(no|false|0|missing|none|n\/a|na)$/i.test(value)
        ? `${def.label} non-compliant [${value}] — ${titleSuffix}`
        : `${def.label} missing / not configured — ${titleSuffix}`;

      // ── Description ────────────────────────────────────────────────────────
      const descParts = [];

      // What the issue is
      if (/patch|update/i.test(key) && /\d/.test(value)) {
        descParts.push(`Device is ${value} behind on patching.`);
      } else {
        descParts.push(`${def.label} is ${value || 'not configured / missing'} on this device.`);
      }

      // Device context
      const deviceLine = [ctx.hostname, ctx.os, ctx.manufacturer].filter(Boolean).join(' | ');
      if (deviceLine) descParts.push(`Device: ${deviceLine}.`);
      if (ctx.serial)  descParts.push(`Serial: ${ctx.serial}.`);

      // User context
      const userLine = [ctx.userName, ctx.userEmail].filter(Boolean).join(' / ');
      if (userLine)    descParts.push(`Assigned user: ${userLine}.`);
      if (ctx.username && ctx.username !== ctx.userName) descParts.push(`Username: ${ctx.username}.`);

      // Recency
      if (ctx.daysSince && /^\d+$/.test(ctx.daysSince)) {
        const days = parseInt(ctx.daysSince, 10);
        if (days > 7) descParts.push(`Device last seen ${days} days ago — confirm device is reachable and still managed.`);
      } else if (ctx.lastSeen) {
        descParts.push(`Last check-in: ${ctx.lastSeen}.`);
      }

      // User account state warning (prefix-match so "ACTIVATED · 2026-06-30" is treated as active)
      if (ctx.userState && !/^(active|activated|enabled|ok)/i.test(ctx.userState)) {
        descParts.push(`User account state: ${ctx.userState} — verify account is still valid.`);
      }

      findings.push({
        id:              `cm-${Date.now()}-${rowIndex}`,
        sourceFindingId: `CM-${String(rowIndex + 1).padStart(3, '0')}`,
        title,
        severity:        def.severity,
        category:        def.category,
        systemAffected,
        description:     descParts.join(' '),
        affectedCount:   0,
        riskScore:       { critical: 90, high: 75, medium: 55, low: 30 }[def.severity] || 50,
      });
      rowIndex++;
    }
  }

  // Emit one aggregated finding per control for rows that had no usable device identifier.
  // "JumpCloud MDM missing — 4 devices" is actionable; "— 3", "— 4", "— 5", "— 6" are not.
  for (const [key, { def, count }] of Object.entries(anonByControl)) {
    const n     = count;
    const label = def.label;
    findings.push({
      id:              `agg-${Date.now()}-${rowIndex}`,
      sourceFindingId: `AGG-${String(rowIndex + 1).padStart(3, '0')}`,
      title:           `${label} missing / not configured — ${n} device${n !== 1 ? 's' : ''}`,
      severity:        def.severity,
      category:        def.category,
      systemAffected:  `${n} device${n !== 1 ? 's' : ''}`,
      description:     `${label} is not configured on ${n} device${n !== 1 ? 's' : ''} in this report.`,
      affectedCount:   n,
      riskScore:       { critical: 90, high: 75, medium: 55, low: 30 }[def.severity] || 50,
    });
    rowIndex++;
  }

  logger.info('findingsFileParser: compliance matrix loop complete', {
    perDeviceFindings:   findings.length,
    anonymousControls:   Object.keys(anonByControl).length,
    anonKeys:            Object.keys(anonByControl).join(', ') || 'none',
  });

  // Warn when ALL devices went to anonymous aggregation — means identifier columns weren't detected.
  // This log shows every column header so the pattern can be widened in the next release.
  if (findings.length === 0 && Object.keys(anonByControl).length > 0) {
    logger.warn('findingsFileParser: all devices anonymous — no identifier column detected', {
      hostnameCol:    ctxCols.hostname  !== undefined ? `col[${ctxCols.hostname}]="${headers[ctxCols.hostname]}"` : 'NOT FOUND',
      userEmailCol:   ctxCols.userEmail !== undefined ? `col[${ctxCols.userEmail}]="${headers[ctxCols.userEmail]}"` : 'NOT FOUND',
      userNameCol:    ctxCols.userName  !== undefined ? `col[${ctxCols.userName}]="${headers[ctxCols.userName]}"` : 'NOT FOUND',
      serialCol:      ctxCols.serial    !== undefined ? `col[${ctxCols.serial}]="${headers[ctxCols.serial]}"` : 'NOT FOUND',
      identifierCols: identifierCols.slice(0, 5).map(i => `[${i}]"${headers[i]}"`).join(', ') || 'none',
      allHeaders:     headers.slice(0, 20).join(' | '),
    });
  }

  if (findings.length === 0) {
    throw new Error('Compliance sheet parsed but all controls appear compliant — no findings to import.');
  }

  // Deduplicate: when the same user has the same control failure on multiple device rows
  // (e.g. Sumit Mandola has 2 devices both missing MFA) and no hostname differentiates the
  // titles, collapse them into one finding and increment affectedCount.
  // The AM needs to fix MFA for "Sumit Mandola" once — not chase two identical entries.
  const titleIndex = new Map(); // title → index in deduped array
  const deduped    = [];
  for (const f of findings) {
    const existing = titleIndex.get(f.title);
    if (existing !== undefined) {
      deduped[existing].affectedCount = (deduped[existing].affectedCount || 0) + 1;
    } else {
      titleIndex.set(f.title, deduped.length);
      deduped.push({ ...f });
    }
  }

  return deduped;
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const cells = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === ',' && !inQuote) {
      cells.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

function getCSVRows(buffer) {
  // Strip UTF-8 BOM that Excel adds when saving CSV (﻿ at start)
  const text  = buffer.toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV file has no data rows.');
  return lines.map(parseCSVLine);
}

// ── Sheet selector ────────────────────────────────────────────────────────────
// Select sheets whose names START WITH "master", "all devices", or "all" —
// these are the standard sheet naming conventions for compliance/findings exports.
// Falls back to ALL sheets when none match so no data is silently dropped.
const REPORT_SHEET_START_PATTERNS = [
  /^master/i,
  /^all[\s\-_]?devices?/i,
  /^all/i,
];

function pickReportSheets(sheets) {
  const matched = sheets.filter((s) =>
    REPORT_SHEET_START_PATTERNS.some((p) => p.test(s.name.trim()))
  );
  return matched.length > 0 ? matched : sheets;
}

// ── XLSX parser (multi-sheet) ─────────────────���───────────────────────────────
// Returns an array of { name, rows } for every sheet that has at least a header
// row plus one data row. Empty or header-only sheets are silently skipped.
async function getXLSXSheets(buffer) {
  const ExcelJS = require('exceljs');
  const wb      = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  if (!wb.worksheets.length) throw new Error('Excel file has no worksheets.');

  const sheets = [];

  for (const sheet of wb.worksheets) {
    const rows = [];

    // Iterate by explicit row number rather than eachRow() — this reads ALL rows
    // regardless of Excel AutoFilter state (filtered/hidden rows are still included).
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row   = sheet.getRow(r);
      const cells = [];

      for (let c = 1; c <= sheet.columnCount; c++) {
        const v = row.getCell(c).value;
        if (v === null || v === undefined) {
          cells.push('');
        } else if (typeof v === 'object') {
          if (Array.isArray(v.richText))    cells.push(v.richText.map((rt) => rt.text).join(''));
          else if (v.formula !== undefined) cells.push(v.result != null ? String(v.result) : '');
          else if (v.text    !== undefined) cells.push(String(v.text));
          else if (v instanceof Date)       cells.push(v.toISOString());
          else                              cells.push('');
        } else {
          cells.push(String(v));
        }
      }

      rows.push(cells);
    }

    // Keep only rows that have at least one non-empty cell
    const nonEmpty = rows.filter((row) => row.some((c) => String(c).trim() !== ''));
    // Need header + at least one data row
    if (nonEmpty.length >= 2) sheets.push({ name: sheet.name, rows: nonEmpty });
  }

  if (sheets.length === 0) throw new Error('Excel file has no sheets with data rows.');
  return sheets;
}

// ── DOCX parser ───────────────────────────────────────────────────────────────
async function getDOCXRows(buffer) {
  const mammoth = require('mammoth');
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) throw new Error('DOCX must contain a table with column headers. No table found.');

  const rowMatches = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  const rows = rowMatches.map((r) =>
    [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      cell[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
    )
  );
  if (rows.length < 2) throw new Error('DOCX table needs a header row and at least one data row.');
  return rows;
}

// ── Detect whether a buffer is plain-text CSV vs a real XLSX binary ───────────
// Excel saves .csv files with MIME type application/vnd.ms-excel on Windows.
// We sniff the first 4 bytes: real XLSX is a ZIP archive starting with PK\x03\x04.
// If that magic is absent and there are no null bytes, treat it as CSV.
function looksLikeCSV(buffer) {
  const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
  if (buffer.slice(0, 4).equals(XLSX_MAGIC)) return false;   // real XLSX binary
  const sample = buffer.slice(0, 512);
  return !sample.includes(0x00); // null bytes → binary, not CSV
}

// ── Unified row parser (auto-detects format) ──────────────────────────────────
function parseRows(rows) {
  // Locate the real header row — report exports often have one or more summary /
  // metadata rows before the column-header row (e.g. "All 140 devices | Report Date: …").
  // Slicing those off is essential: without it the wrong row becomes the "header",
  // detectFormat sees no control keywords, and the findings parser runs instead of
  // the compliance-matrix parser.
  const headerIdx    = findHeaderRow(rows);
  const effectiveRows = headerIdx > 0 ? rows.slice(headerIdx) : rows;

  const headers = effectiveRows[0].map(String);
  const format  = detectFormat(effectiveRows);

  logger.info('findingsFileParser: format detected', {
    format,
    headerRowIndex: headerIdx,
    columns:        headers.length,
    dataRows:       effectiveRows.length - 1,
    firstHeaders:   headers.slice(0, 8),
  });

  if (format === 'compliance_matrix') {
    return parseComplianceMatrixRows(effectiveRows);
  }

  // Findings list mode
  const dataRows = effectiveRows.slice(1);
  const map = buildFindingsHeaderMap(headers, dataRows);
  assertRequiredColumns(map);

  return effectiveRows.slice(1)
    .map((row, i) => rowToFinding(row.map(String), map, i))
    .filter(Boolean);
}

// ── Public API ────────────────────────────────────────────────────────────────
// filename is optional but helps resolve ambiguous MIME types (e.g. ms-excel
// MIME on a .csv file saved from Excel).
async function parse(buffer, mimetype, filename) {
  const type = (mimetype || '').toLowerCase();
  const ext  = (filename  || '').toLowerCase().split('.').pop();
  let rows;

  const isCsvMime = type === 'text/csv' || type === 'application/csv' || type === 'text/plain';
  const isCsvExt  = ext === 'csv';
  // application/vnd.ms-excel can mean a real .xls OR a .csv saved from Excel —
  // use the byte-sniff to tell them apart.
  const isMsExcel = type.includes('ms-excel');

  if (isCsvMime || isCsvExt || (isMsExcel && looksLikeCSV(buffer))) {
    rows = getCSVRows(buffer);
  } else if (type.includes('spreadsheetml') || type.includes('excel') || type.includes('xlsx') || ext === 'xlsx' || ext === 'xls') {
    // Multi-sheet: select report/findings sheets first, fall back to all sheets.
    const allSheets    = await getXLSXSheets(buffer);
    const sheets       = pickReportSheets(allSheets);

    logger.info('findingsFileParser: sheets selected', {
      allSheets: allSheets.map(s => s.name),
      selected:  sheets.map(s => s.name),
    });

    const allFindings  = [];
    const sheetErrors  = [];

    for (const { name, rows: sheetRows } of sheets) {
      try {
        const found = parseRows(sheetRows);
        logger.info('findingsFileParser: sheet parsed', { sheet: name, findings: found.length });
        allFindings.push(...found);
      } catch (err) {
        logger.warn('findingsFileParser: sheet failed', { sheet: name, error: err.message });
        sheetErrors.push(`Sheet "${name}": ${err.message}`);
      }
    }

    if (allFindings.length === 0) {
      const detail = sheetErrors.length ? ` Details — ${sheetErrors.join('; ')}` : '';
      throw new Error(`No findings found across ${sheets.length} sheet(s).${detail}`);
    }
    return allFindings;
  } else if (type.includes('wordprocessingml') || type.includes('msword') || ext === 'docx') {
    rows = await getDOCXRows(buffer);
  } else {
    throw new Error(`Unsupported file type: ${mimetype}. Accepted: CSV, XLSX, DOCX`);
  }

  return parseRows(rows);
}

module.exports = { parse };
