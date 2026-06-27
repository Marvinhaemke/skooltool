import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { logger } from './logger.js';
import {
  handleStatus,
  handleGetConfig,
  handleSaveConfig,
  handleSync,
  handleMassDm,
  handleCancelMassDm,
  handleCronWorker,
} from './handlers.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Wrap a transport-agnostic handler as an Express route. */
const route = (handler) => async (req, res) => {
  try {
    const { status, body } = await handler({ headers: req.headers, body: req.body });
    res.status(status).json(body);
  } catch (err) {
    logger.error({ err, path: req.path }, 'Request handler failed');
    res.status(500).json({ error: String(err.message || err) });
  }
};

export function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(publicDir));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/status', route(handleStatus));
  app.get('/api/config', route(handleGetConfig));
  app.post('/api/config', route(handleSaveConfig));
  app.post('/api/sync', route(handleSync));
  app.post('/api/massdm', route(handleMassDm));
  app.post('/api/massdm/cancel', route(handleCancelMassDm));
  // Lets you run the DM-queue worker manually when self-hosting.
  app.post('/api/worker', route(handleCronWorker));

  return app;
}

export function startServer() {
  const app = createServer();
  app.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'Control server + settings UI listening');
  });
}
