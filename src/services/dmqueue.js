import { randomUUID } from 'node:crypto';
import { logger } from '../logger.js';
import { getStorage } from '../storage.js';
import { getSettings } from '../settings.js';
import { SkoolSession } from '../skool/session.js';
import { sendDM } from '../skool/client.js';
import { renderTemplate } from '../rules.js';
import {
  getMembers,
  getDailyCount,
  incDailyCount,
  appendDmLog,
} from '../state.js';
import { sleepJitter } from '../util/sleep.js';

const JOB_KEY = 'dmJob';

/**
 * A persistent, resumable mass-DM queue.
 *
 * Sending to thousands of members can't happen in one run — both because a
 * serverless function would time out and because safe pacing caps you at a
 * conservative number of DMs per day. So we model it as a job: enqueue all the
 * recipients once, then a worker (invoked repeatedly by cron) drains a small
 * batch each tick, respecting the per-day quota and a per-invocation time
 * budget, and persists progress so the next tick resumes exactly where it left
 * off. A run of 6000 recipients at 150/day simply spans ~40 days automatically.
 */

export async function getJob() {
  const store = await getStorage();
  return (await store.getJSON(JOB_KEY)) || null;
}

async function saveJob(job) {
  const store = await getStorage();
  await store.setJSON(JOB_KEY, job);
}

export async function clearJob() {
  const store = await getStorage();
  await store.del(JOB_KEY);
}

/**
 * Create (or replace, if none active) a mass-DM job.
 * @param {string[]|"all"} recipients
 * @param {string} template
 * @param {{ skipAlreadyMessaged?: boolean }} opts
 */
export async function enqueueMassDm(recipients, template, { skipAlreadyMessaged = false } = {}) {
  if (!template) throw new Error('template is required');

  const existing = await getJob();
  if (existing && existing.status === 'active' && existing.pending.length > 0) {
    throw new Error(`A mass-DM job (${existing.id}) is still active with ${existing.pending.length} pending. Cancel it first.`);
  }

  const members = await getMembers();
  let handles;
  if (recipients === 'all') {
    handles = Object.keys(members);
  } else if (Array.isArray(recipients)) {
    handles = recipients.map((h) => String(h).replace(/^@/, '').trim()).filter(Boolean);
  } else {
    throw new Error('recipients must be an array of handles or "all"');
  }

  if (skipAlreadyMessaged) {
    const { getDmLog } = await import('../state.js');
    const messaged = new Set((await getDmLog()).map((d) => d.handle));
    handles = handles.filter((h) => !messaged.has(h));
  }
  // De-dupe.
  handles = [...new Set(handles)];

  const job = {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    template,
    total: handles.length,
    pending: handles,
    sentCount: 0,
    failed: [],
    status: handles.length ? 'active' : 'done',
  };
  await saveJob(job);
  logger.info({ id: job.id, total: job.total }, 'Mass-DM job enqueued');
  return jobSummary(job);
}

/**
 * Process the active job for up to `budgetMs`, sending at most the remaining
 * daily quota. Safe to call repeatedly (idempotent across crashes — progress is
 * persisted after every message).
 */
export async function processQueue({ budgetMs = 45000 } = {}) {
  const job = await getJob();
  if (!job || job.status !== 'active' || job.pending.length === 0) {
    return { ran: false, reason: 'no_active_job' };
  }

  const settings = await getSettings();
  if (!settings.configured) return { ran: false, reason: 'not_configured' };

  const deadline = Date.now() + budgetMs;
  const baseUrl = settings.skool.baseUrl;
  const result = { ran: true, jobId: job.id, sent: 0, failed: 0, remaining: job.pending.length };

  const session = new SkoolSession();
  let page;
  try {
    await session.ensureLogin();
    page = await session.page();

    while (job.pending.length > 0) {
      if (Date.now() > deadline) {
        logger.info({ jobId: job.id, remaining: job.pending.length }, 'Worker hit time budget; will resume next tick');
        break;
      }
      if ((await getDailyCount()) >= settings.dm.maxPerDay) {
        logger.info({ jobId: job.id }, 'Daily DM quota reached; pausing until tomorrow');
        break;
      }

      const handle = job.pending[0];
      const members = await getMembers();
      const member = members[handle] || { handle, name: handle };
      const message = renderTemplate(job.template, {
        name: member.name,
        handle,
        plan: member.plan,
        level: member.level,
      });

      try {
        await sendDM(page, handle, message, { baseUrl });
        await incDailyCount();
        await appendDmLog({ handle, trigger: 'massdm', job: job.id });
        job.sentCount++;
        result.sent++;
      } catch (err) {
        logger.error({ err, handle }, 'Failed to DM member');
        job.failed.push({ handle, error: String(err.message || err) });
        result.failed++;
      }

      // Pop AFTER attempting; persist progress so a crash never re-sends.
      job.pending.shift();
      await saveJob(job);

      if (job.pending.length > 0) {
        await sleepJitter(settings.dm.minDelayMs, settings.dm.maxDelayMs);
      }
    }

    if (job.pending.length === 0) {
      job.status = 'done';
      job.completedAt = new Date().toISOString();
      await saveJob(job);
      logger.info({ jobId: job.id, sent: job.sentCount, failed: job.failed.length }, 'Mass-DM job complete');
    }
  } finally {
    if (page) await page.close().catch(() => {});
    await session.close();
  }

  result.remaining = job.pending.length;
  result.status = job.status;
  return result;
}

/**
 * Convenience for local/CLI use: enqueue and drain to completion in-process
 * (with a generous budget). On serverless you instead let the cron worker drain.
 */
export async function massDmNow(recipients, template, opts = {}) {
  await enqueueMassDm(recipients, template, opts);
  let total = { sent: 0, failed: 0 };
  // Drain in large slices until the job is no longer active.
  // (Daily quota may still stop it short — that's expected for big lists.)
  for (;;) {
    const r = await processQueue({ budgetMs: 6 * 60 * 60 * 1000 });
    if (!r.ran) break;
    total.sent += r.sent || 0;
    total.failed += r.failed || 0;
    if (r.status !== 'active' || r.remaining === 0) break;
    if (r.sent === 0 && r.failed === 0) break; // quota/time stop with no progress
  }
  return { ...total, ...(await jobStatus()) };
}

function jobSummary(job) {
  return {
    id: job.id,
    total: job.total,
    pending: job.pending.length,
    sent: job.sentCount,
    failed: job.failed.length,
    status: job.status,
  };
}

export async function jobStatus() {
  const job = await getJob();
  return job ? jobSummary(job) : { status: 'none' };
}
