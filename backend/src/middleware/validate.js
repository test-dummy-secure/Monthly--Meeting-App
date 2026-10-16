'use strict';

// Lightweight inline schema validator — no external dependency.
// Returns 400 with a clear error message if validation fails.

const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEZONES   = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [];

const CUSTOMER_STATUSES    = ['active', 'inactive', 'suspended'];
const MEETING_PLATFORMS    = ['microsoft_teams', 'google_meet', 'zoom', 'webex', 'other'];
const TASK_APPROVAL_VALUES = ['pending', 'approved', 'rejected', 'not_required'];

function optStr(val, field, max) {
  if (val === undefined || val === null) return null;
  if (typeof val !== 'string') return `${field} must be a string`;
  if (val.length > max) return `${field} must be ≤ ${max} characters`;
  return null;
}

// ── Schema definitions ────────────────────────────────────────────────────────

const schemas = {

  customerCreate(b) {
    const errs = [];
    if (!b.name || typeof b.name !== 'string' || !b.name.trim())
      errs.push('name is required and must be a non-empty string');
    else if (b.name.length > 200)
      errs.push('name must be ≤ 200 characters');

    const e = [
      optStr(b.domain,   'domain',   253),
      optStr(b.industry, 'industry', 100),
    ];
    e.forEach((msg) => msg && errs.push(msg));

    if (b.timezone && TIMEZONES.length && !TIMEZONES.includes(b.timezone))
      errs.push(`timezone "${b.timezone}" is not a valid IANA timezone`);

    if (b.meetingPlatform && !MEETING_PLATFORMS.includes(b.meetingPlatform))
      errs.push(`meetingPlatform must be one of: ${MEETING_PLATFORMS.join(', ')}`);

    if (b.status && !CUSTOMER_STATUSES.includes(b.status))
      errs.push(`status must be one of: ${CUSTOMER_STATUSES.join(', ')}`);

    if (b.accountManagerId && !UUID_RE.test(b.accountManagerId))
      errs.push('accountManagerId must be a valid UUID');

    if (b.connectedCalendars !== undefined && !Array.isArray(b.connectedCalendars))
      errs.push('connectedCalendars must be an array');

    return errs;
  },

  customerUpdate(b) {
    const errs = [];
    if (b.name !== undefined) {
      if (typeof b.name !== 'string' || !b.name.trim())
        errs.push('name must be a non-empty string');
      else if (b.name.length > 200)
        errs.push('name must be ≤ 200 characters');
    }

    const e = [
      optStr(b.domain,   'domain',   253),
      optStr(b.industry, 'industry', 100),
    ];
    e.forEach((msg) => msg && errs.push(msg));

    if (b.timezone && TIMEZONES.length && !TIMEZONES.includes(b.timezone))
      errs.push(`timezone "${b.timezone}" is not a valid IANA timezone`);

    if (b.meetingPlatform && !MEETING_PLATFORMS.includes(b.meetingPlatform))
      errs.push(`meetingPlatform must be one of: ${MEETING_PLATFORMS.join(', ')}`);

    if (b.status && !CUSTOMER_STATUSES.includes(b.status))
      errs.push(`status must be one of: ${CUSTOMER_STATUSES.join(', ')}`);

    if (b.accountManagerId && !UUID_RE.test(b.accountManagerId))
      errs.push('accountManagerId must be a valid UUID');

    if (b.connectedCalendars !== undefined && !Array.isArray(b.connectedCalendars))
      errs.push('connectedCalendars must be an array');

    return errs;
  },

  taskStatus(b) {
    const errs = [];
    if (!b.approvalStatus)
      errs.push('approvalStatus is required');
    else if (!TASK_APPROVAL_VALUES.includes(b.approvalStatus))
      errs.push(`approvalStatus must be one of: ${TASK_APPROVAL_VALUES.join(', ')}`);

    const noteErr = optStr(b.notes, 'notes', 2000);
    if (noteErr) errs.push(noteErr);

    return errs;
  },
};

// ── Middleware factory ────────────────────────────────────────────────────────

function validate(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) return next();
    const errs = schema(req.body || {});
    if (errs.length) return res.status(400).json({ error: errs.join('; ') });
    next();
  };
}

module.exports = { validate };
