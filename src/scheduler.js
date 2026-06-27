import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './logger.js';
import { runSync } from './services/sync.js';

let running = false;

/** Run a sync, guarding against overlapping invocations. */
export async function runSyncGuarded(opts = {}) {
  if (running) {
    logger.warn('Sync already in progress; skipping this invocation');
    return { ok: false, reason: 'already_running' };
  }
  running = true;
  try {
    return await runSync(opts);
  } catch (err) {
    logger.error({ err }, 'Sync failed');
    return { ok: false, reason: 'error', error: String(err.message || err) };
  } finally {
    running = false;
  }
}

export function startScheduler() {
  if (!cron.validate(config.schedule.dailyCron)) {
    throw new Error(`Invalid DAILY_SYNC_CRON: "${config.schedule.dailyCron}"`);
  }
  logger.info(
    { cron: config.schedule.dailyCron, tz: config.schedule.timezone },
    'Scheduling daily sync'
  );
  cron.schedule(
    config.schedule.dailyCron,
    () => {
      logger.info('Daily cron fired');
      runSyncGuarded();
    },
    { timezone: config.schedule.timezone }
  );

  if (config.schedule.syncOnStartup) {
    logger.info('SYNC_ON_STARTUP=true — running an initial sync');
    runSyncGuarded();
  }
}

export const isSyncRunning = () => running;
