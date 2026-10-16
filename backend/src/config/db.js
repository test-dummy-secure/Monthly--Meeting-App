/**
 * Thin re-export so that all existing `require('../config/db')` call-sites
 * continue to work without modification.
 *
 * The real implementation lives in `src/database/index.js`.
 */
module.exports = require('../database/index');
