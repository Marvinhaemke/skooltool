import { logger } from './logger.js';
import { startScheduler } from './scheduler.js';
import { startServer } from './server.js';

/**
 * Long-running service entry point: starts the daily cron and the control API.
 * Keep credentials in .env; nothing secret is logged.
 */
async function main() {
  logger.info('Starting skooltool service');
  startScheduler();
  startServer();
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logger.info({ sig }, 'Shutting down');
    process.exit(0);
  });
}
