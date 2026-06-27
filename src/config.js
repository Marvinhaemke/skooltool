import 'dotenv/config';

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return v;
}

export const config = {
  skool: {
    get email() {
      return required('SKOOL_EMAIL');
    },
    get password() {
      return required('SKOOL_PASSWORD');
    },
    get community() {
      return required('SKOOL_COMMUNITY');
    },
    baseUrl: 'https://www.skool.com',
  },
  webhook: {
    daily: process.env.ZAPIER_WEBHOOK_URL || '',
    event: process.env.ZAPIER_EVENT_WEBHOOK_URL || process.env.ZAPIER_WEBHOOK_URL || '',
  },
  schedule: {
    dailyCron: process.env.DAILY_SYNC_CRON || '0 9 * * *',
    timezone: process.env.TZ || 'UTC',
    syncOnStartup: bool(process.env.SYNC_ON_STARTUP, false),
  },
  browser: {
    headless: bool(process.env.HEADLESS, true),
    slowMo: int(process.env.SLOW_MO_MS, 0),
  },
  dm: {
    minDelayMs: int(process.env.DM_MIN_DELAY_MS, 8000),
    maxDelayMs: int(process.env.DM_MAX_DELAY_MS, 20000),
    maxPerRun: int(process.env.DM_MAX_PER_RUN, 40),
    maxPerDay: int(process.env.DM_MAX_PER_DAY, 150),
  },
  autoDm: {
    enabled: bool(process.env.AUTO_DM_ENABLED, false),
  },
  server: {
    port: int(process.env.PORT, 3000),
    apiKey: process.env.API_KEY || '',
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  dataDir: new URL('../data/', import.meta.url).pathname,
};
