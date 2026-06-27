import { logger } from '../logger.js';
import { getStore } from '../store.js';
import { SkoolSession } from '../skool/session.js';
import { getMembers } from '../skool/client.js';
import { diffMembers } from './diff.js';
import { sendDailyNewMembers } from './webhook.js';
import { runTriggers } from './triggers.js';

/**
 * The daily job, end to end:
 *   1. Log in (reusing a saved session if possible)
 *   2. Scrape the current member list
 *   3. Diff against the stored snapshot -> events
 *   4. POST the daily "new members" digest to Zapier (email + package)
 *   5. Run the trigger engine over every event (webhooks + auto-DMs)
 *   6. Persist the new snapshot
 *
 * @param {{ dryRun?: boolean, session?: SkoolSession }} opts
 */
export async function runSync({ dryRun = false, session: providedSession } = {}) {
  const store = await getStore();
  const session = providedSession || new SkoolSession();
  const ownsSession = !providedSession;

  try {
    await session.ensureLogin();
    const page = await session.page();
    let current;
    try {
      current = await getMembers(page);
    } finally {
      await page.close().catch(() => {});
    }

    if (current.length === 0) {
      logger.warn('Scraped 0 members — aborting to avoid wiping the snapshot. Check selectors/login.');
      return { ok: false, reason: 'no_members_scraped' };
    }

    const prev = store.data.members;
    const isFirstRun = Object.keys(prev).length === 0;
    const { events, byHandle } = diffMembers(prev, current);

    // On the very first run there is no baseline, so EVERYTHING would look
    // "new". Don't spam webhooks/DMs — just establish the baseline.
    let newMembers = events.filter((e) => e.type === 'new_member').map((e) => e.member);
    let triggerResults = { webhooksSent: 0, dmsSent: 0, skipped: events.length };

    if (isFirstRun) {
      logger.info({ count: current.length }, 'First run: establishing baseline snapshot, no notifications sent');
      newMembers = [];
    } else {
      // 4. Daily digest of new members -> Zapier
      if (newMembers.length > 0) {
        if (dryRun) {
          logger.info({ count: newMembers.length }, '[dry-run] would post daily new-members webhook');
        } else {
          await sendDailyNewMembers(newMembers);
        }
      } else {
        logger.info('No new members today');
      }

      // 5. Per-event triggers (subscriptions, level ups, etc.)
      triggerResults = await runTriggers(store, events, session, { dryRun });
    }

    // 6. Persist new snapshot (unless dry-run)
    if (!dryRun) {
      store.data.members = byHandle;
      store.data.lastSyncAt = new Date().toISOString();
      await store.save();
    }

    const summary = {
      ok: true,
      dryRun,
      firstRun: isFirstRun,
      totalMembers: current.length,
      events: events.length,
      newMembers: newMembers.length,
      triggers: triggerResults,
    };
    logger.info(summary, 'Sync complete');
    return summary;
  } finally {
    if (ownsSession) await session.close();
  }
}
