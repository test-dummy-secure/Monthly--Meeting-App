/* src/middleware/auditLogger.js */

/**
 * Audit‑logging middleware.
 * Logs every incoming request with method, URL, IP, and timestamp.
 */
function auditLogger(req, _res, next) {
  const entry = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.user?.id ?? 'anonymous',
  };

  console.log('[AUDIT]', JSON.stringify(entry));
  next();
}

module.exports = { auditLogger };
