'use strict';

const Redis      = require('ioredis');
const { config } = require('./index');
const logger     = require('../utils/logger');

// Shared ioredis options used by every BullMQ Queue and Worker.
// maxRetriesPerRequest + enableReadyCheck are required by BullMQ.
// retryStrategy keeps workers alive through Redis restarts without crashing.
const connection = {
  host:     config.redis.host,
  port:     config.redis.port,
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
  maxRetriesPerRequest: null,          // BullMQ requirement — do not change
  enableReadyCheck:     false,         // allow connection before Redis READY signal
  retryStrategy:        (times) => Math.min(times * 2000, 30000), // 2s, 4s … max 30s
  connectTimeout:       10_000,
};

// Polls Redis until it is reachable, then returns.
// Called once at server startup before any BullMQ workers are registered so
// the burst of simultaneous "connection error" logs never appears.
// Non-throwing: if Redis is still down after maxAttempts, workers start anyway
// and rely on retryStrategy to reconnect automatically once Redis comes up.
async function waitForRedis(maxAttempts = 15, delayMs = 2000) {
  for (let i = 1; i <= maxAttempts; i++) {
    const probe = new Redis({
      host:             config.redis.host,
      port:             config.redis.port,
      ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
      connectTimeout:   3000,
      lazyConnect:      true,
      retryStrategy:    () => null,  // fail fast inside the probe — outer loop retries
      enableReadyCheck: false,
    });
    // Suppress the unhandled 'error' event ioredis emits when retryStrategy returns null
    probe.on('error', () => {});
    try {
      await probe.connect();
      await probe.ping();
      await probe.quit();
      logger.info('Redis: ready', { host: config.redis.host, port: config.redis.port });
      return;
    } catch {
      logger.warn(`Redis: not reachable (attempt ${i}/${maxAttempts}) — retrying in ${delayMs / 1000}s`, {
        host: config.redis.host, port: config.redis.port,
      });
      // ioredis disconnect() is synchronous (returns void) — never call .catch() on it
      try { probe.disconnect(); } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  logger.warn('Redis: unreachable after max attempts — BullMQ workers will reconnect automatically once Redis starts', {
    host: config.redis.host, port: config.redis.port,
  });
}

// Shared BullMQ worker error handler.
// ECONNREFUSED = Redis temporarily down → warn (expected, retryStrategy handles reconnect).
// Any other error = unexpected → error (needs investigation).
// Usage: worker.on('error', onWorkerError('T-48 worker'));
function onWorkerError(workerName) {
  return (err) => {
    if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      logger.warn(`${workerName}: Redis not reachable — will retry automatically`);
    } else {
      logger.error(`${workerName}: worker error`, { error: err.message });
    }
  };
}

module.exports = { connection, waitForRedis, onWorkerError };
