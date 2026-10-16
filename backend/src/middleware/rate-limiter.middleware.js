'use strict';

// Replaced by src/config/rate-limits.js which uses express-rate-limit.
// Kept as an empty re-export so any stale import doesn't crash the process.
module.exports = require('../config/rate-limits').generalLimiter;
