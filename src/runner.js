import { logger } from './logger.js';
import { runSync } from './services/sync.js';

let running = false;

/** Run a sync, guarding against overlapping invocations within this process. */
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

export const isSyncRunning = () => running;
