/* src/app.js */
const express        = require('express');
const path           = require('path');
const helmet         = require('helmet');
const compression    = require('compression');
const cors           = require('cors');
const morgan         = require('morgan');
const swaggerUi      = require('swagger-ui-express');
const swaggerSpec    = require('./config/swagger');
const correlationId  = require('./middleware/correlation-id.middleware');
const requestTimeout = require('./middleware/timeout.middleware');
const { generalLimiter, authLimiter } = require('./config/rate-limits');
const { errorHandler }   = require('./middleware/errorHandler');
const authMiddleware     = require('./middleware/auth.middleware');
const logger             = require('./utils/logger');

// Route modules
const authRoutes = require('./routes/auth.routes');
const nxg360Routes = require('./routes/nxg360.routes');
const customerRoutes = require('./routes/customer.routes');
const meetingRoutes = require('./routes/meeting.routes');
const taskRoutes = require('./routes/task.routes');
const meetingLogRoutes = require('./routes/meeting-logs.routes');
const integrationRoutes = require('./routes/integration.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const findingsRoutes = require('./routes/findings');
const tenantsRoutes = require('./routes/tenants.routes');
const trackerRoutes = require('./routes/tracker.routes');
const reportsRoutes = require('./routes/reports.routes');
const auditLogRoutes = require('./routes/audit-log.routes');
const aiRoutes           = require('./routes/ai.routes');
const actionItemRoutes   = require('./routes/action-items.routes');
const providerRoutes     = require('./routes/provider.routes');
const monitoringRoutes     = require('./routes/monitoring.routes');
const notificationsRoutes  = require('./routes/notifications.routes');
const msOAuthRoutes        = require('./routes/ms-oauth.routes');
const firefliesRoutes      = require('./routes/fireflies.routes');
const clickupRoutes        = require('./routes/clickup.routes');
const calendlyWebhookRoutes = require('./routes/calendly.webhook');
const publicRoutes           = require('./routes/public.routes');

const app = express();

// Trust the first proxy hop so express-rate-limit reads the real client IP
// from X-Forwarded-For instead of the proxy's IP in production deployments
// (nginx, Azure App Service, Kubernetes ingress, etc.).
app.set('trust proxy', 1);

// Redirect HTTP → HTTPS in production. Must run before every other middleware
// so unencrypted requests never reach route handlers.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.get('host')}${req.url}`);
    }
    next();
  });
}

// Build CORS allowlist from CLIENT_URL env var (comma-separated).
// Never fall back to wildcard — credentials + wildcard origin is rejected by browsers.
const _corsOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// ── Middleware stack (order is significant) ───────────────────────────────────
app.use(correlationId);   // 1. Attach X-Request-ID to every request + response
app.use(helmet({          // 2. Secure response headers
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],  // swagger UI requires inline scripts
      styleSrc:    ["'self'", "'unsafe-inline'"],  // swagger UI requires inline styles
      imgSrc:      ["'self'", "data:"],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
}));
// Prevent any response from being cached by browsers or intermediate proxies —
// this is an API backend with no public cacheable assets; every response can
// carry dynamic or authenticated data. Fixes ZAP's "Storable and Cacheable
// Content" [10049] finding, seen on unauthenticated routes like /health and
// /api/docs that a DAST spider can reach without a session.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(compression());   // 3. Gzip
app.use(cors({            // 4. CORS allowlist
  origin: (origin, cb) => {
    if (!origin || _corsOrigins.includes(origin)) return cb(null, true);
    cb(Object.assign(new Error(`CORS: origin not allowed — ${origin}`), { statusCode: 403 }));
  },
  credentials: true,
}));
// Calendly webhook — MUST be mounted before express.json() so express.raw()
// inside the route handler can read the raw body for HMAC-SHA256 verification.
app.use('/api/webhooks/calendly', calendlyWebhookRoutes);

// Public routes — no authMiddleware. Customer-facing endpoints (task confirmation).
// Mounted before auth routes so they never require a JWT.
app.use('/api/public', publicRoutes);

app.use(express.json({ limit: '1mb' }));               // 5. Body parsing
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } })); // 6. HTTP logging
app.use(generalLimiter);  // 7. Global rate limit (200 req / 15 min)
app.use(requestTimeout);  // 8. 30-second hard timeout before routes

// Health check (no auth) — includes live DB connectivity probe + build identity.
// APP_VERSION, BUILD_VERSION, BUILD_TIME are injected by CI at deploy time.
// Locally they fall back to package.json version / 'local' / null.
const pkg = require('../package.json');
app.get('/health', async (_req, res) => {
  const db = require('./database/index');
  const dbHealth = await db.healthCheck();
  const status = dbHealth.healthy ? 'ok' : 'degraded';
  res.status(dbHealth.healthy ? 200 : 503).json({
    status,
    version:   process.env.APP_VERSION   || pkg.version || '0.0.0',
    commit:    process.env.BUILD_VERSION || 'local',
    buildTime: process.env.BUILD_TIME    || null,
    uptime:    Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      connected: dbHealth.healthy,
      latencyMs: dbHealth.latencyMs,
      ...(dbHealth.error && { error: dbHealth.error }),
    },
  });
});

// Uploads directory — protected by JWT auth; direct URL guessing is blocked
app.use('/uploads', authMiddleware, express.static(path.join(__dirname, '../uploads')));

// API documentation — mounted before auth routes, no JWT required
// Available at /api/docs in all environments
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'NxgSecure API Docs',
  swaggerOptions:  { persistAuthorization: true },
}));

// Expose raw OpenAPI JSON for tooling (Postman import, code generators, etc.)
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

// Public routes
app.use('/api/auth', authLimiter, authRoutes);

// Microsoft OAuth — MUST be registered before the authMiddleware blanket below.
// The GET /callback endpoint is public (no JWT): Microsoft redirects here after user consent.
// All other routes in this module ARE protected (they self-apply authMiddleware internally).
app.use('/api/integrations/microsoft', msOAuthRoutes);

// Protected routes (all require valid JWT)
app.use('/api/tenants',       authMiddleware, tenantsRoutes);
app.use('/api/customers',     authMiddleware, customerRoutes);
app.use('/api/meetings',      authMiddleware, meetingRoutes);
app.use('/api/tasks',         authMiddleware, taskRoutes);
app.use('/api/meeting-logs',  authMiddleware, meetingLogRoutes);
app.use('/api/integrations',  authMiddleware, integrationRoutes);
app.use('/api/analytics',     authMiddleware, analyticsRoutes);
app.use('/api/findings',      authMiddleware, findingsRoutes);
app.use('/api/tracker',       authMiddleware, trackerRoutes);
app.use('/api/reports',       authMiddleware, reportsRoutes);
app.use('/api/audit-logs',    authMiddleware, auditLogRoutes);
app.use('/api/nxg360',        authMiddleware, nxg360Routes);
app.use('/api/ai',            authMiddleware, aiRoutes);
app.use('/api/action-items',  authMiddleware, actionItemRoutes);
app.use('/api/providers',     authMiddleware, providerRoutes);
app.use('/api/fireflies',     authMiddleware, firefliesRoutes);
app.use('/api/clickup',       authMiddleware, clickupRoutes);
app.use('/api/monitoring',     authMiddleware, monitoringRoutes);
app.use('/api/notifications', authMiddleware, notificationsRoutes);

// Developer-only routes (email test etc.) — never mounted in production
if (process.env.NODE_ENV !== 'production') {
  const devRoutes = require('./routes/dev.routes');
  app.use('/api/dev', devRoutes);
}

// 404
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => errorHandler(err, req, res, next));

module.exports = app;
