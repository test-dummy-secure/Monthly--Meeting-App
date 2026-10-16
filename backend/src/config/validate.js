// Startup configuration validator.
// Called once before the HTTP server binds.
// In production: throws on any misconfiguration — process cannot start.
// In development: logs warnings and continues.

const logger = require('../utils/logger');

const RULES = [
  {
    check: () => {
      const KNOWN_WEAK = [
        'change_me_secret', 'change_me_access_secret',
        'bmmj_legacy_fallback_secret_do_not_use_in_new_code',
        'bmmj_access_token_signing_secret_change_in_production',
      ];
      const v = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || '';
      return v.length >= 32 && !KNOWN_WEAK.includes(v);
    },
    message: 'JWT_ACCESS_SECRET must be a random secret of at least 32 characters — generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
  },
  {
    check: () => {
      const KNOWN_WEAK = [
        'change_me_secret', 'change_me_refresh_secret',
        'bmmj_legacy_fallback_secret_do_not_use_in_new_code',
        'bmmj_refresh_token_signing_secret_different_key_production',
      ];
      const v = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || '';
      return v.length >= 32 && !KNOWN_WEAK.includes(v);
    },
    message: 'JWT_REFRESH_SECRET must be a random secret of at least 32 characters — generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
  },
  {
    check: () => {
      const KNOWN_WEAK = [
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ];
      const v = process.env.NXG360_ENCRYPTION_KEY || '';
      return v.length === 64 && /^[0-9a-fA-F]+$/.test(v) && !KNOWN_WEAK.includes(v);
    },
    message: 'NXG360_ENCRYPTION_KEY must be a random 64-character hex string (not the default repeating pattern) — generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
  },
  {
    check: () => {
      const v = process.env.DB_PASSWORD || '';
      return v && v !== 'postgres';
    },
    message: 'DB_PASSWORD must be set and must not be the default "postgres"',
  },
  {
    check: () => !!process.env.CLIENT_URL,
    message: 'CLIENT_URL must be set to the frontend origin (e.g. https://app.example.com) — without it CORS will block all browser requests',
  },
  {
    check: () => !!process.env.SMTP_USER && !!process.env.SMTP_PASS,
    message: 'SMTP_USER and SMTP_PASS must be set — email delivery (invitations, reminders, escalations) will not work without them',
  },
  {
    check: () => !!process.env.SMTP_FROM,
    message: 'SMTP_FROM must be set (e.g. "NxgSecure <notifications@yourdomain.com>")',
  },
  {
    check: () => {
      const v = process.env.TOKEN_ENCRYPTION_KEY || '';
      return v.length === 64 && /^[0-9a-fA-F]+$/.test(v);
    },
    message: 'TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256-GCM) — generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
  },
  {
    check: () => {
      const v = process.env.MS_CLIENT_ID || '';
      return v && v !== 'your-azure-app-client-id' && v !== 'REPLACE_ME';
    },
    message: 'MS_CLIENT_ID must be set to your Azure AD app registration Client ID (register at portal.azure.com)',
  },
  {
    check: () => {
      const email = process.env.SUPER_ADMIN_EMAIL || '';
      const pass  = process.env.SUPER_ADMIN_PASSWORD || '';
      const KNOWN_WEAK = ['admin123', 'password', 'changeme'];
      return !!email && !!pass && pass.length >= 8 && !KNOWN_WEAK.includes(pass.toLowerCase());
    },
    message: 'SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must both be set, with a real password (8+ chars, not a known default) — this is the only production admin login and is never auto-generated',
  },
];

function validateConfig() {
  const isProd = process.env.NODE_ENV === 'production';
  const failures = RULES.filter(r => !r.check()).map(r => r.message);

  if (failures.length === 0) return;

  if (isProd) {
    const msg = `Server cannot start — production config is invalid:\n${failures.map(m => `  • ${m}`).join('\n')}`;
    throw new Error(msg);
  }

  failures.forEach(m => logger.warn(`[config] ${m}`));
}

module.exports = { validateConfig };
