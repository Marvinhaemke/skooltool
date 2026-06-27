import { config } from '../config.js';
import { logger } from '../logger.js';
import { getStore, todayKey } from '../store.js';
import { SkoolSession } from '../skool/session.js';
import { sendDM } from '../skool/client.js';
import { renderTemplate } from '../rules.js';
import { sleepJitter } from '../util/sleep.js';

/**
 * Send a templated message to many members, on demand.
 *
 * @param {object} opts
 * @param {string[]|"all"} opts.recipients  handles to message, or "all" for every
 *                                          known member from the latest snapshot.
 * @param {string} opts.template            message body, supports {{name}} {{handle}} {{plan}} {{level}}
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.skipAlreadyMessaged]  skip handles already in the DM log
 */
export async function massDm({ recipients, template, dryRun = false, skipAlreadyMessaged = false }) {
  if (!template) throw new Error('massDm requires a template');
  const store = await getStore();

  let handles;
  if (recipients === 'all') {
    handles = Object.keys(store.data.members);
  } else if (Array.isArray(recipients)) {
    handles = recipients.map((h) => String(h).replace(/^@/, ''));
  } else {
    throw new Error('recipients must be an array of handles or "all"');
  }

  if (skipAlreadyMessaged) {
    const messaged = new Set(store.data.dmLog.map((d) => d.handle));
    handles = handles.filter((h) => !messaged.has(h));
  }

  // Enforce per-run and remaining-daily caps.
  const usedToday = store.data.dmDailyCount[todayKey()] || 0;
  const remainingDaily = Math.max(0, config.dm.maxPerDay - usedToday);
  const cap = Math.min(config.dm.maxPerRun, remainingDaily);
  if (handles.length > cap) {
    logger.warn({ requested: handles.length, cap }, 'Trimming recipient list to respect rate caps');
    handles = handles.slice(0, cap);
  }

  logger.info({ count: handles.length, dryRun }, 'Starting mass DM');
  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };

  const session = new SkoolSession();
  let page;
  try {
    if (!dryRun) {
      await session.ensureLogin();
      page = await session.page();
    }

    for (const handle of handles) {
      const member = store.data.members[handle] || { handle, name: handle };
      const message = renderTemplate(template, {
        name: member.name,
        handle,
        plan: member.plan,
        level: member.level,
      });

      if (dryRun) {
        logger.info({ handle, message }, '[dry-run] would send');
        results.skipped++;
        continue;
      }

      try {
        await sendDM(page, handle, message);
        store.data.dmDailyCount[todayKey()] = (store.data.dmDailyCount[todayKey()] || 0) + 1;
        store.data.dmLog.push({ handle, trigger: 'massdm', at: new Date().toISOString() });
        results.sent++;
        await store.save(); // persist progress incrementally so a crash doesn't re-send
        await sleepJitter(config.dm.minDelayMs, config.dm.maxDelayMs);
      } catch (err) {
        logger.error({ err, handle }, 'Failed to DM member');
        results.failed++;
        results.errors.push({ handle, error: String(err.message || err) });
      }
    }
  } finally {
    if (page) await page.close().catch(() => {});
    await session.close();
  }

  logger.info(results, 'Mass DM complete');
  return results;
}
