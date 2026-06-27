import express from 'express';
import { config } from './config.js';
import { logger } from './logger.js';
import { getStore } from './store.js';
import { runSyncGuarded, isSyncRunning } from './scheduler.js';
import { massDm } from './services/massdm.js';

/**
 * Minimal control surface. Every mutating endpoint requires the shared
 * secret in the `x-api-key` header (set API_KEY in .env).
 */
export function createServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const requireKey = (req, res, next) => {
    if (!config.server.apiKey) {
      return res.status(503).json({ error: 'API_KEY is not configured on the server' });
    }
    if (req.get('x-api-key') !== config.server.apiKey) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };

  app.get('/health', (_req, res) => res.json({ ok: true, syncRunning: isSyncRunning() }));

  app.get('/status', requireKey, async (_req, res) => {
    const store = await getStore();
    res.json({
      lastSyncAt: store.data.lastSyncAt,
      totalMembers: Object.keys(store.data.members).length,
      dmsToday: store.data.dmDailyCount[new Date().toISOString().slice(0, 10)] || 0,
      dmLogSize: store.data.dmLog.length,
      syncRunning: isSyncRunning(),
    });
  });

  // Trigger the daily sync on demand. Runs in the background; returns immediately.
  app.post('/sync', requireKey, (req, res) => {
    const dryRun = Boolean(req.body?.dryRun);
    runSyncGuarded({ dryRun }); // fire and forget
    res.status(202).json({ accepted: true, dryRun });
  });

  // Send a mass DM. Runs in the background.
  app.post('/massdm', requireKey, async (req, res) => {
    const { recipients, template, dryRun, skipAlreadyMessaged } = req.body || {};
    if (!template || !recipients) {
      return res.status(400).json({ error: 'recipients and template are required' });
    }
    res.status(202).json({ accepted: true });
    massDm({ recipients, template, dryRun: Boolean(dryRun), skipAlreadyMessaged: Boolean(skipAlreadyMessaged) })
      .catch((err) => logger.error({ err }, 'massDm (via API) failed'));
  });

  return app;
}

export function startServer() {
  const app = createServer();
  app.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'Control server listening');
  });
}
