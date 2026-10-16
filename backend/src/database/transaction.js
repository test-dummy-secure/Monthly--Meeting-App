const pool = require('./pool');
const { classifyDatabaseError } = require('./errors');
const logger = require('../utils/logger');

/**
 * Execute `fn(client)` inside a single serializable transaction.
 * Automatically commits on success and rolls back on any thrown error.
 * Classifies raw pg errors before re-throwing.
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('Transaction rollback failed', {
        rollbackError: rollbackErr.message,
        originalError: err.message,
      });
    }
    throw classifyDatabaseError(err);
  } finally {
    client.release();
  }
}

/**
 * Execute `fn(client)` with a dedicated client but WITHOUT wrapping in a
 * transaction.  Useful when the caller manages its own BEGIN/COMMIT.
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } catch (err) {
    throw classifyDatabaseError(err);
  } finally {
    client.release();
  }
}

module.exports = { withTransaction, withClient };
