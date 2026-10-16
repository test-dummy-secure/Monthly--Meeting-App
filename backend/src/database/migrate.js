/**
 * Migration runner.
 *
 * Usage (CLI):  node src/database/migrate.js
 * Usage (code): const { runMigrations } = require('./migrate');
 *               await runMigrations();
 *
 * Strategy:
 *   - Maintains a `schema_migrations` table (created if absent).
 *   - Reads *.sql files from ./migrations/ in ascending lexicographic order.
 *   - Applies only files not yet recorded in schema_migrations.
 *   - Each migration file runs inside its own transaction so a failure is
 *     automatically rolled back and the table is left in a consistent state.
 */

const fs     = require('fs');
const path   = require('path');
const pool   = require('./pool');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL      PRIMARY KEY,
      filename    TEXT        NOT NULL UNIQUE,
      checksum    TEXT,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query(
    'SELECT filename FROM schema_migrations ORDER BY id ASC'
  );
  return new Set(rows.map((r) => r.filename));
}

function simpleChecksum(content) {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16);
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function runMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.warn('Migrations directory not found — skipping', { dir: MIGRATIONS_DIR });
    return { applied: 0, skipped: 0 };
  }

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (migrationFiles.length === 0) {
    logger.info('No migration files found');
    return { applied: 0, skipped: 0 };
  }

  // Bootstrap: ensure the tracking table exists before we start any per-file tx
  const bootstrap = await pool.connect();
  try {
    await ensureMigrationsTable(bootstrap);
  } finally {
    bootstrap.release();
  }

  let applied = 0;
  let skipped = 0;

  for (const file of migrationFiles) {
    const client = await pool.connect();
    try {
      const alreadyApplied = await getAppliedMigrations(client);
      if (alreadyApplied.has(file)) {
        skipped++;
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql      = fs.readFileSync(filePath, 'utf8').trim();
      if (!sql) {
        logger.warn(`Migration file is empty, skipping: ${file}`);
        skipped++;
        continue;
      }

      const checksum = simpleChecksum(sql);

      logger.info(`Applying migration: ${file}`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [file, checksum]
      );
      await client.query('COMMIT');

      logger.info(`Migration applied: ${file}`);
      applied++;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      logger.error(`Migration FAILED: ${file}`, {
        error: err.message,
        code:  err.code,
        stack: err.stack,
      });
      throw new Error(`Migration failed on ${file}: ${err.message}`);
    } finally {
      client.release();
    }
  }

  logger.info('Migration run complete', {
    total:   migrationFiles.length,
    applied,
    skipped,
  });

  return { applied, skipped };
}

// ─── CLI entry-point ─────────────────────────────────────────────────────────

if (require.main === module) {
  runMigrations()
    .then(({ applied, skipped }) => {
      console.log(`Done — ${applied} applied, ${skipped} skipped.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration error:', err.message);
      process.exit(1);
    });
}

module.exports = { runMigrations };
