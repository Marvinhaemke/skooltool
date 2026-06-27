import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './logger.js';
import { runSyncGuarded } from './runner.js';
import { processQueue } from './services/dmqueue.js';

/**
 * Self-hosted (long-running) scheduling. On Vercel this file is unused — Vercel
 * Cron hits the /api/cron/* endpoints instead (see vercel.json).
 *
 * Two jobs:
 *   - daily sync (DAILY_SYNC_CRON)
 *   - mass-DM queue worker (every few minutes) so big DM jobs drip out safely
 */
export function startScheduler() {
  if (!cron.validate(config.schedule.dailyCron)) {
    throw new Error(`Invalid DAILY_SYNC_CRON: "${config.schedule.dailyCron}"`);
  }
  logger.info({ cron: config.schedule.dailyCron, tz: config.schedule.timezone }, 'Scheduling daily sync');
  cron.schedule(
    config.schedule.dailyCron,
    () => {
      logger.info('Daily cron fired');
      runSyncGuarded();
    },
    { timezone: config.schedule.timezone }
  );

  // Drain the mass-DM queue every 5 minutes (no-op when there's no active job).
  cron.schedule('*/5 * * * *', () => {
    processQueue({ budgetMs: config.browser.workerBudgetMs }).catch((err) =>
      logger.error({ err }, 'DM queue worker failed')
    );
  });

  if (config.schedule.syncOnStartup) {
    logger.info('SYNC_ON_STARTUP=true — running an initial sync');
    runSyncGuarded();
  }
}
