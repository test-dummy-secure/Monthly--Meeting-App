const { Pool } = require('pg');
const { config } = require('../config/index');

const SSL_ENABLED = process.env.DB_SSL === 'true';

const pool = new Pool({
  host:               config.db.host,
  port:               config.db.port,
  database:           config.db.database,
  user:               config.db.user,
  password:           config.db.password,
  max:                parseInt(process.env.DB_POOL_MAX  || '20', 10),
  idleTimeoutMillis:  parseInt(process.env.DB_IDLE_MS   || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT || '5000', 10),
  // rejectUnauthorized: true validates the server certificate — prevents MITM attacks.
  // Set DB_SSL_REJECT_UNAUTHORIZED=false only for self-signed certs in dev/staging.
  ...(SSL_ENABLED && {
    ssl: {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    },
  }),
});

pool.on('error', (err) => {
  const logger = require('../utils/logger');
  logger.error('Unexpected error on idle PostgreSQL client', {
    error: err.message,
    code:  err.code,
    stack: err.stack,
  });
});

pool.on('connect', () => {
  const logger = require('../utils/logger');
  logger.debug('PostgreSQL client acquired from pool');
});

module.exports = pool;
