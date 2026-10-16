'use strict';

const logger = require('../utils/logger');

const TIMEOUT_MS = 30_000; // 30 seconds

// Sends a 503 if a route handler does not respond within TIMEOUT_MS.
// Guards against hung DB queries or stalled external HTTP calls holding
// the connection open indefinitely.
// Skips already-sent responses to avoid "headers already sent" errors.
const requestTimeout = (req, res, next) => {
  const timer = setTimeout(() => {
    if (res.headersSent) return;
    logger.warn('Request timed out', {
      method:    req.method,
      path:      req.path,
      requestId: req.id,
    });
    res.status(503).json({ error: 'Request timeout — please try again.' });
  }, TIMEOUT_MS);

  res.on('finish', () => clearTimeout(timer));
  res.on('close',  () => clearTimeout(timer));

  next();
};

module.exports = requestTimeout;
