// PostgreSQL error code reference:
// https://www.postgresql.org/docs/current/errcodes-appendix.html

const PG_CODES = {
  UNIQUE_VIOLATION:        '23505',
  FOREIGN_KEY_VIOLATION:   '23503',
  NOT_NULL_VIOLATION:      '23502',
  CHECK_VIOLATION:         '23514',
  SERIALIZATION_FAILURE:   '40001',
  DEADLOCK_DETECTED:       '40P01',
  QUERY_CANCELED:          '57014',
  UNDEFINED_TABLE:         '42P01',
  UNDEFINED_COLUMN:        '42703',
  CONNECTION_FAILURE:      '08006',
  CONNECTION_DOES_NOT_EXIST: '08003',
};

class DatabaseError extends Error {
  constructor(message, code, original) {
    super(message);
    this.name       = 'DatabaseError';
    this.code       = code;
    this.statusCode = 500;
    this.original   = original;
  }
}

class UniqueViolationError extends DatabaseError {
  constructor(detail, original) {
    super(detail || 'A record with the same unique value already exists.', 'UNIQUE_VIOLATION', original);
    this.name       = 'UniqueViolationError';
    this.statusCode = 409;
  }
}

class ForeignKeyViolationError extends DatabaseError {
  constructor(detail, original) {
    super(detail || 'Referenced record does not exist.', 'FOREIGN_KEY_VIOLATION', original);
    this.name       = 'ForeignKeyViolationError';
    this.statusCode = 400;
  }
}

class NotNullViolationError extends DatabaseError {
  constructor(column, original) {
    super(`Required field is missing: ${column}`, 'NOT_NULL_VIOLATION', original);
    this.name       = 'NotNullViolationError';
    this.statusCode = 400;
  }
}

class CheckViolationError extends DatabaseError {
  constructor(constraint, original) {
    super(`Value failed validation constraint: ${constraint}`, 'CHECK_VIOLATION', original);
    this.name       = 'CheckViolationError';
    this.statusCode = 400;
  }
}

class ConnectionError extends DatabaseError {
  constructor(message, original) {
    super(message || 'Database connection unavailable.', 'CONNECTION_ERROR', original);
    this.name       = 'ConnectionError';
    this.statusCode = 503;
  }
}

/**
 * Translate a raw pg error into a typed application error.
 * Re-throws the original error unchanged if it does not map to a known code.
 */
function classifyDatabaseError(err) {
  if (!err || !err.code) return err;

  switch (err.code) {
    case PG_CODES.UNIQUE_VIOLATION:
      return new UniqueViolationError(err.detail, err);

    case PG_CODES.FOREIGN_KEY_VIOLATION:
      return new ForeignKeyViolationError(err.detail, err);

    case PG_CODES.NOT_NULL_VIOLATION:
      return new NotNullViolationError(err.column, err);

    case PG_CODES.CHECK_VIOLATION:
      return new CheckViolationError(err.constraint, err);

    case PG_CODES.CONNECTION_FAILURE:
    case PG_CODES.CONNECTION_DOES_NOT_EXIST:
      return new ConnectionError(err.message, err);

    case PG_CODES.SERIALIZATION_FAILURE:
    case PG_CODES.DEADLOCK_DETECTED: {
      const e = new DatabaseError('Transaction conflict — please retry.', 'TRANSACTION_CONFLICT', err);
      e.statusCode = 409;
      e.retryable  = true;
      return e;
    }

    default:
      return err;
  }
}

module.exports = {
  PG_CODES,
  DatabaseError,
  UniqueViolationError,
  ForeignKeyViolationError,
  NotNullViolationError,
  CheckViolationError,
  ConnectionError,
  classifyDatabaseError,
};
