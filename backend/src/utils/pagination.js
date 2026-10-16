'use strict';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 100;

// Parses and sanitises ?limit= and ?offset= query params.
// Caps limit at MAX_LIMIT to prevent runaway full-table scans.
// Returns safe integers with sensible defaults.
const parsePagination = (query = {}, opts = {}) => {
  const maxLimit     = opts.maxLimit     ?? MAX_LIMIT;
  const defaultLimit = opts.defaultLimit ?? DEFAULT_LIMIT;

  let limit  = parseInt(query.limit,  10);
  let offset = parseInt(query.offset, 10);

  if (!Number.isFinite(limit)  || limit  < 1) limit  = defaultLimit;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  limit = Math.min(limit, maxLimit);

  return { limit, offset };
};

module.exports = { parsePagination, DEFAULT_LIMIT, MAX_LIMIT };
