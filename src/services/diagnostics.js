import { getSettings } from '../settings.js';
import { SkoolSession } from '../skool/session.js';
import { probeMembers, sendDM } from '../skool/client.js';
import { logger } from '../logger.js';

/**
 * Connection & selector self-test. Runs the real flow end-to-end against the
 * live community and reports, step by step, what worked and what didn't — so
 * you can confirm "does this even work on my Skool?" from the UI and see
 * exactly which selector needs tuning when something breaks.
 */
export async function runSelfTest() {
  const started = Date.now();
  const steps = [];
  const add = (step, ok, detail, extra) => {
    steps.push({ step, ok, detail, ...(extra || {}) });
    return ok;
  };
  const finalize = (ok) => ({ ok, durationMs: Date.now() - started, steps });

  const settings = await getSettings();
  if (!settings.configured) {
    add('config', false, 'Skool is not configured yet — set the community link, email and password first.');
    return finalize(false);
  }
  add('config', true, `community "${settings.skool.community}", login email + password set`);

  const session = new SkoolSession();
  let page;
  let ok = true;
  try {
    try {
      await session.start();
      add('launch_browser', true, 'Chromium launched');
    } catch (e) {
      add('launch_browser', false, String(e?.message || e));
      return finalize(false);
    }

    page = await session.page();

    // Login (reuse saved session if possible).
    let loginOk = false;
    let reused = false;
    try {
      reused = await session.isLoggedIn(page);
    } catch { /* fall through to explicit login */ }
    if (reused) {
      loginOk = add('login', true, 'Reused the saved Skool session');
    } else {
      try {
        await session.login(page);
        loginOk = add('login', true, 'Logged in with the saved credentials');
      } catch (e) {
        add('login', false, String(e?.message || e));
        ok = false;
      }
    }

    // Members probe (only worth attempting if login worked).
    if (loginOk) {
      try {
        const p = await probeMembers(page, {
          community: settings.skool.community,
          baseUrl: settings.skool.baseUrl,
        });
        const found = p.totalUnique > 0;
        ok = ok && found;
        add(
          'members_page',
          found,
          found
            ? `Parsed ${p.totalUnique} members on first load (no scrolling yet)`
            : 'Reached the members page but matched 0 members — the selectors in src/skool/selectors.js likely need tuning for your community.',
          {
            url: p.url,
            redirectedTo: p.currentUrl !== p.url ? p.currentUrl : undefined,
            signals: {
              embeddedData: p.hasNextData,
              membersFromEmbeddedData: p.nextDataMemberCount,
              profileLinksOnPage: p.profileLinkCount,
            },
            sample: p.sample,
          }
        );
      } catch (e) {
        add('members_page', false, String(e?.message || e));
        ok = false;
      }
    } else {
      add('members_page', false, 'Skipped — login did not succeed.');
    }
  } finally {
    if (page) await page.close().catch(() => {});
    await session.close();
  }

  logger.info({ ok }, 'Self-test complete');
  return finalize(ok);
}

/**
 * Send a single test DM (e.g. to your own handle) to verify the DM flow and
 * selectors. Does not touch the daily quota or job queue.
 */
export async function sendTestDm({ handle, message }) {
  if (!handle || !message) throw new Error('handle and message are required');
  const settings = await getSettings();
  if (!settings.configured) throw new Error('Skool is not configured');
  const clean = String(handle).replace(/^@/, '').trim();

  const session = new SkoolSession();
  let page;
  try {
    await session.ensureLogin();
    page = await session.page();
    await sendDM(page, clean, message, { baseUrl: settings.skool.baseUrl });
    return { ok: true, handle: clean, message };
  } finally {
    if (page) await page.close().catch(() => {});
    await session.close();
  }
}
