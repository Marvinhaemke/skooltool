import { config } from '../config.js';
import { logger } from '../logger.js';
import { loadRules, matches, renderTemplate } from '../rules.js';
import { sendEvent } from './webhook.js';
import { sendDM } from '../skool/client.js';
import { todayKey } from '../store.js';
import { sleepJitter } from '../util/sleep.js';

/**
 * The trigger engine: given a list of detected events and an authenticated
 * Skool session, evaluate every rule against every event and execute the
 * resulting actions (webhook posts and/or auto-DMs).
 *
 * Guarantees:
 *  - At-most-once per (rule, event) using store.firedTriggers, so re-running a
 *    sync never re-sends. Each fired key is "<ruleId>:<type>:<handle>:<key>".
 *  - Respects AUTO_DM_ENABLED and the daily DM quota.
 *
 * @param {object} store   loaded JSON store (mutated; caller saves)
 * @param {object[]} events
 * @param {import('../skool/session.js').SkoolSession} session
 * @param {{ dryRun?: boolean }} opts
 */
export async function runTriggers(store, events, session, { dryRun = false } = {}) {
  const rules = await loadRules();
  const results = { webhooksSent: 0, dmsSent: 0, skipped: 0, errors: [] };
  let page;

  for (const event of events) {
    for (const rule of rules) {
      if (!matches(rule, event)) continue;

      // dedupe key: distinguish e.g. each level milestone or plan change
      const variant =
        event.type === 'level_reached'
          ? `lvl${event.level}`
          : event.type === 'new_subscription'
            ? `plan${event.plan ?? 'paid'}`
            : 'once';
      const firedKey = `${rule.id}:${event.type}:${event.handle}:${variant}`;

      if (store.data.firedTriggers[firedKey]) {
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
        // --- Webhook action ---
        if (rule.webhook) {
          if (dryRun) {
            logger.info({ rule: rule.id, event: event.type, handle: event.handle }, '[dry-run] would post webhook');
          } else {
            await sendEvent({
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

        // --- Auto-DM action ---
        if (rule.dm?.template) {
          if (!config.autoDm.enabled) {
            logger.info({ rule: rule.id, handle: event.handle }, 'AUTO_DM disabled; skipping DM');
          } else if (!withinDailyQuota(store)) {
            logger.warn({ handle: event.handle }, 'Daily DM quota reached; skipping DM');
            results.skipped++;
          } else {
            const message = renderTemplate(rule.dm.template, ctx);
            if (dryRun) {
              logger.info({ rule: rule.id, handle: event.handle, message }, '[dry-run] would send DM');
            } else {
              if (!page) page = await session.page();
              await sendDM(page, event.handle, message);
              recordDm(store, event.handle, rule.id, event.type);
              results.dmsSent++;
              await sleepJitter(config.dm.minDelayMs, config.dm.maxDelayMs);
            }
          }
        }

        if (!dryRun) {
          store.data.firedTriggers[firedKey] = new Date().toISOString();
        }
      } catch (err) {
        logger.error({ err, rule: rule.id, handle: event.handle }, 'Trigger action failed');
        results.errors.push({ rule: rule.id, handle: event.handle, error: String(err.message || err) });
      }
    }
  }

  if (page) await page.close().catch(() => {});
  return results;
}

function withinDailyQuota(store) {
  const key = todayKey();
  const used = store.data.dmDailyCount[key] || 0;
  return used < config.dm.maxPerDay;
}

function recordDm(store, handle, ruleId, trigger) {
  const key = todayKey();
  store.data.dmDailyCount[key] = (store.data.dmDailyCount[key] || 0) + 1;
  store.data.dmLog.push({ handle, rule: ruleId, trigger, at: new Date().toISOString() });
}
