import { checkAdmin, checkCron } from './auth.js';
import { getPublicSettings, saveSettings } from './settings.js';
import { getStatus } from './state.js';
import { runSyncGuarded } from './runner.js';
import { runSync } from './services/sync.js';
import { enqueueMassDm, processQueue, jobStatus, clearJob } from './services/dmqueue.js';
import { loadRules, saveRules } from './rules.js';
import { config } from './config.js';

/**
 * Transport-agnostic request handlers. Each takes a normalized request
 * ({ headers, body }) and returns { status, body }. The Express server and the
 * Vercel serverless functions are both thin adapters over these.
 */

async function requireAdmin(req) {
  const { ok, bootstrap } = await checkAdmin(req);
  // Allow the first call through only if it is establishing the admin password.
  if (!ok && bootstrap && req.body?.adminPassword) return { allowed: true, bootstrap: true };
  if (!ok) return { allowed: false, bootstrap };
  return { allowed: true, bootstrap: false };
}

const unauthorized = (bootstrap) => ({
  status: 401,
  body: { error: bootstrap ? 'No admin password set. Send adminPassword to establish one.' : 'unauthorized' },
});

export async function handleStatus() {
  const [status, settings, job] = await Promise.all([
    getStatus(),
    getPublicSettings(),
    jobStatus(),
  ]);
  return { status: 200, body: { ...status, configured: settings.configured, massDmJob: job } };
}

export async function handleGetConfig(req) {
  // Public settings are safe (no secrets); still require admin to view them.
  const { ok, bootstrap } = await checkAdmin(req);
  if (!ok && !bootstrap) return unauthorized(false);
  const [settings, rules, job] = await Promise.all([getPublicSettings(), loadRules(), jobStatus()]);
  return { status: 200, body: { settings, rules, massDmJob: job, needsAdminSetup: bootstrap } };
}

export async function handleSaveConfig(req) {
  const gate = await requireAdmin(req);
  if (!gate.allowed) return unauthorized(gate.bootstrap);
  const body = req.body || {};
  const settings = await saveSettings(body);
  if (Array.isArray(body.rules)) await saveRules(body.rules);
  return { status: 200, body: { ok: true, settings: await getPublicSettings(), configured: settings.configured } };
}

export async function handleSync(req) {
  const gate = await requireAdmin(req);
  if (!gate.allowed) return unauthorized(gate.bootstrap);
  const dryRun = Boolean(req.body?.dryRun);
  // Fire and forget; the daily job can be long.
  runSyncGuarded({ dryRun });
  return { status: 202, body: { accepted: true, dryRun } };
}

export async function handleMassDm(req) {
  const gate = await requireAdmin(req);
  if (!gate.allowed) return unauthorized(gate.bootstrap);
  const { recipients, template, skipAlreadyMessaged } = req.body || {};
  if (!recipients || !template) {
    return { status: 400, body: { error: 'recipients and template are required' } };
  }
  const summary = await enqueueMassDm(recipients, template, {
    skipAlreadyMessaged: Boolean(skipAlreadyMessaged),
  });
  return { status: 202, body: { accepted: true, job: summary } };
}

export async function handleCancelMassDm(req) {
  const gate = await requireAdmin(req);
  if (!gate.allowed) return unauthorized(gate.bootstrap);
  await clearJob();
  return { status: 200, body: { ok: true } };
}

// --- Cron-triggered (Vercel Cron sends Authorization: Bearer CRON_SECRET) ---

export async function handleCronSync(req) {
  if (config.cronSecret && !checkCron(req)) return { status: 401, body: { error: 'unauthorized' } };
  const result = await runSync({});
  return { status: 200, body: result };
}

export async function handleCronWorker(req) {
  if (config.cronSecret && !checkCron(req)) return { status: 401, body: { error: 'unauthorized' } };
  const result = await processQueue({ budgetMs: config.browser.workerBudgetMs });
  return { status: 200, body: result };
}
