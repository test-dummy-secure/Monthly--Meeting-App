const dotenv = require('dotenv');

dotenv.config();

const isProd = (process.env.NODE_ENV || 'development') === 'production';

// Fail fast in production if critical secrets are missing or still set to defaults.
// Silent startup with weak secrets is more dangerous than a failed deploy.
if (isProd) {
  const WEAK = ['change_me_secret', 'change_me_access_secret', 'change_me_refresh_secret', 'postgres', ''];
  const required = {
    JWT_ACCESS_SECRET:  process.env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    DB_PASSWORD:        process.env.DB_PASSWORD,
  };
  for (const [key, val] of Object.entries(required)) {
    if (!val || WEAK.includes(val)) {
      throw new Error(`[BMMJ] FATAL: ${key} is missing or set to a default/weak value. Set a strong value before deploying to production.`);
    }
  }
}

const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  // Legacy — only kept so old callers that haven't been updated yet don't break
  jwtSecret: process.env.JWT_SECRET || 'change_me_secret',
  // Preferred: separate signing keys for each token type
  jwtAccessSecret:   process.env.JWT_ACCESS_SECRET  || process.env.JWT_SECRET || 'change_me_access_secret',
  jwtRefreshSecret:  process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'change_me_refresh_secret',
  jwtExpiresIn: '15m',
  refreshExpiresIn: '30d',
  bcryptRounds: 12,
  nxg360: {
    apiBaseUrl:     process.env.NXG360_API_BASE_URL     || '',
    encryptionKey:  process.env.NXG360_ENCRYPTION_KEY   || '',
  },
  smtp: {
    host:   process.env.SMTP_HOST   || 'smtp.office365.com',
    port:   parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',   // false = STARTTLS on port 587
    user:   process.env.SMTP_USER   || '',
    pass:   process.env.SMTP_PASS   || '',
    from:   process.env.SMTP_FROM   || '',
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'bmmj_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  },
};

module.exports = { config };
