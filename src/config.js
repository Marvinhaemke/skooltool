import 'dotenv/config';

/**
 * Infrastructure-level config from the environment. Things that are tied to the
 * deployment itself (where data lives, how the browser launches, the HTTP port,
 * the encryption secret) stay here.
 *
 * Operational config that you want to change without redeploying — the Skool
 * link/login, Zapier URL, rate limits, auto-DM switch — lives in src/settings.js
 * and is editable from the in-app settings page.
 */

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

// On Vercel only /tmp is writable; elsewhere use the repo's data/ dir.
const onVercel = Boolean(process.env.VERCEL);
const dataDir = onVercel ? '/tmp/skooltool/' : new URL('../data/', import.meta.url).pathname;

export const config = {
  onVercel,
  dataDir,
  schedule: {
    dailyCron: process.env.DAILY_SYNC_CRON || '0 9 * * *',
    timezone: process.env.TZ || 'UTC',
    syncOnStartup: bool(process.env.SYNC_ON_STARTUP, false),
  },
  browser: {
    headless: bool(process.env.HEADLESS, true),
    slowMo: int(process.env.SLOW_MO_MS, 0),
    // Soft time budget (ms) for a single scrape inside a serverless function.
    scrapeBudgetMs: int(process.env.SCRAPE_BUDGET_MS, onVercel ? 45000 : 600000),
    // Soft time budget for one DM-queue worker invocation.
    workerBudgetMs: int(process.env.WORKER_BUDGET_MS, onVercel ? 45000 : 600000),
  },
  server: {
    port: int(process.env.PORT, 3000),
  },
  // Shared secret for cron endpoints (Vercel sends it as a Bearer token).
  cronSecret: process.env.CRON_SECRET || '',
  logLevel: process.env.LOG_LEVEL || 'info',
};
