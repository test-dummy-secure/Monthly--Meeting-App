'use strict';

const { randomUUID } = require('crypto');

// Attaches a correlation ID to every request for cross-log tracing.
// Reads X-Request-ID from the client if present; generates a UUID otherwise.
// The ID is echoed in the response header so clients can correlate their
// request to backend log entries.
const correlationId = (req, res, next) => {
  // Cap client-supplied ID at 64 chars to prevent log injection / memory abuse.
  const supplied = (req.headers['x-request-id'] || '').trim().slice(0, 64);
  const id = supplied || randomUUID();
  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
};

module.exports = correlationId;
