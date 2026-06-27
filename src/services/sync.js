import { logger } from '../logger.js';
import { config } from '../config.js';
import { getSettings } from '../settings.js';
import { SkoolSession } from '../skool/session.js';
import { getMembers } from '../skool/client.js';
import { diffMembers } from './diff.js';
import { sendDailyNewMembers } from './webhook.js';
import { runTriggers } from './triggers.js';
import {
  getMembers as getStoredMembers,
  setMembers,
  setLastSyncAt,
} from '../state.js';

/**
 * The daily job, end to end:
 *   1. Log in (reusing a saved session if possible)
 *   2. Scrape the current member list (time-budgeted for serverless)
 *   3. Diff against the stored snapshot -> events
 *   4. POST the daily "new members" digest to Zapier (email + package)
 *   5. Run the trigger engine over every event (webhooks + auto-DMs)
 *   6. Persist the new snapshot
 *
 * @param {{ dryRun?: boolean, session?: SkoolSession }} opts
 */
export async function runSync({ dryRun = false, session: providedSession } = {}) {
  const settings = await getSettings();
  if (!settings.configured) {
    return { ok: false, reason: 'not_configured' };
  }

  const session = providedSession || new SkoolSession();
  const ownsSession = !providedSession;

  try {
    await session.ensureLogin();
    const page = await session.page();
    let scrape;
    try {
      scrape = await getMembers(page, {
        community: settings.skool.community,
        baseUrl: settings.skool.baseUrl,
        budgetMs: config.browser.scrapeBudgetMs,
      });
    } finally {
      await page.close().catch(() => {});
    }

    const current = scrape.members;
    if (current.length === 0) {
      logger.warn('Scraped 0 members — aborting to avoid wiping the snapshot. Check selectors/login.');
      return { ok: false, reason: 'no_members_scraped' };
    }

    const prev = await getStoredMembers();
    const isFirstRun = Object.keys(prev).length === 0;
    const { events, byHandle } = diffMembers(prev, current);

    let newMembers = events.filter((e) => e.type === 'new_member').map((e) => e.member);
    let triggerResults = { webhooksSent: 0, dmsSent: 0, skipped: events.length };

    if (isFirstRun) {
      logger.info({ count: current.length }, 'First run: establishing baseline snapshot, no notifications sent');
      newMembers = [];
    } else {
      if (newMembers.length > 0) {
        if (dryRun) logger.info({ count: newMembers.length }, '[dry-run] would post daily new-members webhook');
        else await sendDailyNewMembers(settings, newMembers);
      } else {
        logger.info('No new members today');
      }
      triggerResults = await runTriggers(events, session, settings, { dryRun });
    }

    if (!dryRun) {
      // If the scrape was only partial (hit the time budget), merge into the
      // previous snapshot instead of replacing it, so we don't "lose" members
      // we simply didn't reach this run and then re-detect them as new later.
      const snapshot = scrape.complete ? byHandle : { ...prev, ...byHandle };
      await setMembers(snapshot);
      await setLastSyncAt(new Date().toISOString());
    }

    const summary = {
      ok: true,
      dryRun,
      firstRun: isFirstRun,
      scrapeComplete: scrape.complete,
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
