'use strict';

const { createClient } = require('redis');
const { config }       = require('./index');
const logger           = require('../utils/logger');

// Shared Redis client singleton — used for application-level caching (e.g. NXG360 findings).
// BullMQ manages its own internal Redis connection separately via bullmq.js.
// This client must be connected explicitly via client.connect() in server.js startup.
const redisPassword = process.env.REDIS_PASSWORD || null;

const client = createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port,
    // Back off exponentially up to 3 s; give up after 10 retries so we don't
    // spin forever if Redis is genuinely unavailable.
    reconnectStrategy: (retries) => {
      if (retries > 10) return new Error('Redis cache: max reconnect attempts exceeded');
      return Math.min(retries * 100, 3000);
    },
  },
  // REDIS_PASSWORD must be set in production when Redis is started with --requirepass
  ...(redisPassword ? { password: redisPassword } : {}),
});

client.on('error',       (err) => logger.error('Redis cache client error',       { error: err.message }));
client.on('connect',     ()    => logger.info('Redis cache client connected',    { host: config.redis.host, port: config.redis.port }));
client.on('reconnecting',()    => logger.warn('Redis cache client reconnecting'));
client.on('ready',       ()    => logger.info('Redis cache client ready'));

module.exports = client;
