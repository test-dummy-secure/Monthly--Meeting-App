const app            = require('./app');
const { config }     = require('./config');
const { validateConfig } = require('./config/validate');
const logger         = require('./utils/logger');
const db             = require('./database/index');
const { runMigrations } = require('./database/migrate');
const userRepository = require('./repositories/user.repository');
const redisClient        = require('./config/redisClient');
const { waitForRedis }   = require('./config/bullmq');
const overdueJob         = require('./jobs/overdue.job');
const recurrenceJob      = require('./jobs/recurrence.job');
const t48Job             = require('./jobs/t48.job');
const reminderWindowsJob = require('./jobs/reminder-windows.job');
const nxg360SyncJob      = require('./jobs/nxg360Sync.job');
const weeklyReportJob    = require('./jobs/weekly-report.job');
const emailJob           = require('./jobs/email.job');
const bookingWatcherJob  = require('./jobs/bookingWatcher.job');
const transcriptFetchJob = require('./jobs/transcriptFetch.job');
const nxg360PrefetchJob  = require('./jobs/nxg360Prefetch.job');
const firefliesFetchJob   = require('./jobs/firefliesFetch.job');
const calendlySyncJob     = require('./jobs/calendlySync.job');
const taskDueReminderJob  = require('./jobs/taskDueReminder.job');
const clickupPushJob      = require('./jobs/clickup-push.job');
const clickupSyncJob      = require('./jobs/clickup-sync.job');
const notesProcessingJob  = require('./jobs/notesProcessing.job');

async function startServer() {
  // ── 0. Validate required environment configuration ───────────────────────
  validateConfig();

  // ── 1. Run pending database migrations ──────────────────────────────────
  try {
    const { applied, skipped } = await runMigrations();
    logger.info('Database migrations complete', { applied, skipped });
  } catch (err) {
    logger.error('Migration failure — aborting startup', { error: err.message, stack: err.stack });
    process.exit(1);
  }

  // ── 2. Start HTTP server ────────────────────────────────────────────────
  const server = app.listen(config.port, async () => {
    logger.info('==================================================');
    logger.info('  NxgSecure Platform Server started successfully  ');
    logger.info(`  Environment : ${config.nodeEnv}                `);
    logger.info(`  Port        : ${config.port}                   `);
    logger.info('==================================================');

    try {
      await userRepository.ensureDefaultUsers();
    } catch (err) {
      logger.error('Default user bootstrap failed', { error: err.message, stack: err.stack });
    }

    // ── 3. Connect Redis cache client (non-fatal — cache misses fall back to live NXG360) ──
    try {
      await redisClient.connect();
    } catch (err) {
      logger.warn('Redis cache client failed to connect — NXG360 cache unavailable', {
        error: err.message,
      });
    }

    // ── 4. Wait for Redis, then start background jobs ────────────────────
    // Single controlled wait → one log line per retry instead of 13 simultaneous
    // "connection error" bursts when Redis starts after the Node process.
    await waitForRedis();

    overdueJob.start();
    recurrenceJob.start();
    t48Job.start();             // async — errors handled internally; Redis down won't crash startup
    reminderWindowsJob.start(); // async — same pattern
    nxg360SyncJob.start();        // no-op — interval removed; syncTenant() utility kept for on-demand routes
    nxg360PrefetchJob.start();    // async — T-24 per-meeting NXG360 pull + AI; Redis down won't crash startup
    weeklyReportJob.start();      // async — every Monday 08:00; Redis down won't crash startup
    emailJob.start();             // async — email delivery worker; Redis down won't crash startup
    bookingWatcherJob.start();    // async — polls MS Calendar for Calendly bookings (2 min)
    transcriptFetchJob.start();   // async — fetches Teams transcripts post-meeting (5 min)
    firefliesFetchJob.start();    // async — fetches Fireflies AI transcripts post-meeting (5 min); no-op if FIREFLIES_ENABLED != true
    calendlySyncJob.start();      // async — syncs Calendly bookings every 6 h for AMs with stored PAT
    taskDueReminderJob.start();   // async — T-2 and T-1 day due-date reminder emails to AMs
    clickupPushJob.start();       // async — pushes approved tasks to ClickUp via BullMQ
    clickupSyncJob.start();       // async — pulls ClickUp task status every 6 hours
    notesProcessingJob.start();   // async — serializes AI notes processing (concurrency:1), Redis down won't crash startup
  });

  // ── 4. Graceful shutdown ────────────────────────────────────────────────
  const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    overdueJob.stop();
    recurrenceJob.stop();
    nxg360SyncJob.stop();
    server.close(async () => {
      try {
        await t48Job.stop();
        await reminderWindowsJob.stop();
        await weeklyReportJob.stop();
        await emailJob.stop();
        await bookingWatcherJob.stop();
        await transcriptFetchJob.stop();
        await firefliesFetchJob.stop();
        await nxg360PrefetchJob.stop();
        calendlySyncJob.stop();
        taskDueReminderJob.stop();
        await clickupPushJob.stop();
        await clickupSyncJob.stop();
        await db.end();
        logger.info('PostgreSQL connection pool drained');
      } catch (err) {
        logger.warn('Shutdown error', { error: err.message });
      }
      try {
        await redisClient.quit();
        logger.info('Redis cache client disconnected');
      } catch (err) {
        logger.warn('Redis cache client shutdown error', { error: err.message });
      }
      logger.info('Server process terminated');
      process.exit(0);
    });

    // Force-exit if graceful close takes more than 10 s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  return server;
}

startServer().catch((err) => {
  logger.error('Unhandled startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
