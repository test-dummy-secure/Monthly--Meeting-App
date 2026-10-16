const pool = require('./pool');
const { classifyDatabaseError } = require('./errors');
const { withTransaction, withClient } = require('./transaction');
const logger = require('../utils/logger');

/**
 * Execute a parameterised query against the pool.
 * Logs slow queries (> DB_SLOW_QUERY_MS, default 500 ms).
 *
 * @param {string}  text   - SQL statement
 * @param {Array}   [params] - Bound parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    const slowMs = parseInt(process.env.DB_SLOW_QUERY_MS || '500', 10);
    if (duration > slowMs) {
      logger.warn('Slow database query detected', {
        duration,
        query: text.substring(0, 120),
        rows: result.rowCount,
      });
    }
    return result;
  } catch (err) {
    logger.error('Database query error', {
      query: text.substring(0, 120),
      params: params ? '[redacted]' : undefined,
      code:   err.code,
      error:  err.message,
    });
    throw classifyDatabaseError(err);
  }
}

/**
 * Lightweight connectivity probe.
 * Returns { healthy: true, latencyMs } or { healthy: false, error }.
 */
async function healthCheck() {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { healthy: false, error: err.message, code: err.code };
  }
}

/**
 * Drain all pool connections.  Call on server shutdown.
 */
async function end() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  healthCheck,
  end,
  withTransaction,
  withClient,
};
