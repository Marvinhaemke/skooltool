import { logger } from '../logger.js';
import { loadRules, matches, renderTemplate } from '../rules.js';
import { sendEvent } from './webhook.js';
import { sendDM } from '../skool/client.js';
import { hasFired, markFired, getDailyCount, incDailyCount, appendDmLog } from '../state.js';
import { sleepJitter } from '../util/sleep.js';

/**
 * Evaluate every rule against every event and run the resulting actions
 * (webhook posts and/or auto-DMs).
 *
 * Guarantees at-most-once per (rule, event) via firedTriggers, respects the
 * auto-DM master switch and the daily DM quota.
 *
 * @param {object[]} events
 * @param {import('../skool/session.js').SkoolSession} session
 * @param {object} settings  resolved runtime settings
 * @param {{ dryRun?: boolean }} opts
 */
export async function runTriggers(events, session, settings, { dryRun = false } = {}) {
  const rules = await loadRules();
  const results = { webhooksSent: 0, dmsSent: 0, skipped: 0, errors: [] };
  const baseUrl = settings.skool.baseUrl;
  let page;

  for (const event of events) {
    for (const rule of rules) {
      if (!matches(rule, event)) continue;

      const variant =
        event.type === 'level_reached' ? `lvl${event.level}`
        : event.type === 'new_subscription' ? `plan${event.plan ?? 'paid'}`
        : 'once';
      const firedKey = `${rule.id}:${event.type}:${event.handle}:${variant}`;

      if (await hasFired(firedKey)) {
        results.skipped++;
        continue;
      }

      const ctx = {
        name: event.member?.name,
        handle: event.handle,
        plan: event.plan ?? event.member?.plan,
        previousPlan: event.previousPlan,
        level: event.level ?? event.member?.level,
      };

      try {
        if (rule.webhook) {
          if (dryRun) {
            logger.info({ rule: rule.id, event: event.type, handle: event.handle }, '[dry-run] would post webhook');
          } else {
            await sendEvent(settings, {
              event: event.type,
              rule: rule.id,
              handle: event.handle,
              name: ctx.name,
              email: event.member?.email ?? null,
              package: ctx.plan ?? null,
              level: ctx.level ?? null,
              previousPlan: event.previousPlan ?? null,
              profileUrl: event.member?.profileUrl,
            });
            results.webhooksSent++;
          }
        }

        if (rule.dm?.template) {
          if (!settings.autoDm.enabled) {
            logger.info({ rule: rule.id, handle: event.handle }, 'AUTO_DM disabled; skipping DM');
          } else if ((await getDailyCount()) >= settings.dm.maxPerDay) {
            logger.warn({ handle: event.handle }, 'Daily DM quota reached; skipping DM');
            results.skipped++;
          } else {
            const message = renderTemplate(rule.dm.template, ctx);
            if (dryRun) {
              logger.info({ rule: rule.id, handle: event.handle, message }, '[dry-run] would send DM');
            } else {
              if (!page) page = await session.page();
              await sendDM(page, event.handle, message, { baseUrl });
              await incDailyCount();
              await appendDmLog({ handle: event.handle, rule: rule.id, trigger: event.type });
              results.dmsSent++;
              await sleepJitter(settings.dm.minDelayMs, settings.dm.maxDelayMs);
            }
          }
        }

        if (!dryRun) await markFired(firedKey);
      } catch (err) {
        logger.error({ err, rule: rule.id, handle: event.handle }, 'Trigger action failed');
        results.errors.push({ rule: rule.id, handle: event.handle, error: String(err.message || err) });
      }
    }
  }

  if (page) await page.close().catch(() => {});
  return results;
}
