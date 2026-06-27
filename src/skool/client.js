import { logger } from '../logger.js';
import { selectors } from './selectors.js';
import { sleep, sleepJitter, jitter } from '../util/sleep.js';

const BASE_URL = 'https://www.skool.com';

/**
 * Pull Skool's embedded Next.js payload. Skool renders with Next.js, so the
 * structured data we want (members, plans, levels) is usually in
 * window.__NEXT_DATA__ — far more stable than scraping hashed CSS classes.
 */
async function readNextData(page) {
  try {
    return await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      if (window.__NEXT_DATA__) return window.__NEXT_DATA__;
      // eslint-disable-next-line no-undef
      const el = document.getElementById('__NEXT_DATA__');
      return el ? JSON.parse(el.textContent) : null;
    });
  } catch {
    return null;
  }
}

function harvestMembers(node, out, seen = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (seen.has(node)) return out;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) harvestMembers(item, out, seen);
    return out;
  }

  const handle = node.handle || node.username || node.slug;
  const looksLikeMember =
    handle && (node.name || node.firstName || node.metadata?.bio !== undefined || node.email);

  if (looksLikeMember) {
    const m = normalizeMember(node);
    if (m && !out.some((x) => x.handle === m.handle)) out.push(m);
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') harvestMembers(value, out, seen);
  }
  return out;
}

/** Normalize a raw Skool user-ish object into our canonical member record. */
export function normalizeMember(raw, baseUrl = BASE_URL) {
  const handle = raw.handle || raw.username || raw.slug;
  if (!handle) return null;
  const meta = raw.metadata || raw.meta || {};
  const member = raw.member || raw.membership || {};

  const plan =
    raw.planName || raw.plan || member.planName || member.plan ||
    raw.subscriptionPlan || meta.planName || null;

  return {
    handle,
    name: raw.name || [raw.firstName, raw.lastName].filter(Boolean).join(' ') || handle,
    email: raw.email || meta.email || null,
    plan: plan ? String(plan) : null,
    level: raw.level ?? member.level ?? meta.level ?? raw.points?.level ?? null,
    isPaid: raw.isPaid ?? member.isPaid ?? (plan ? true : null),
    joinedAt:
      raw.approvedAt || raw.createdAt || member.approvedAt || member.createdAt || null,
    profileUrl: `${baseUrl}/@${handle}`,
  };
}

/**
 * Scrape the member list for a community.
 *
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {string} opts.community  community slug
 * @param {string} [opts.baseUrl]
 * @param {number} [opts.budgetMs]  soft time budget; stops scrolling when exceeded
 *                                   (so a serverless function doesn't time out).
 * @returns {Promise<{ members: object[], complete: boolean }>}
 *   `complete` is false if we hit the time budget before the list stopped growing.
 */
export async function getMembers(page, { community, baseUrl = BASE_URL, budgetMs = 600000 } = {}) {
  const url = `${baseUrl}/${community}${selectors.members.pathSuffix}`;
  const deadline = Date.now() + budgetMs;
  logger.info({ url, budgetMs }, 'Loading members page');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(2500);

  const collected = new Map();

  const harvestNow = async () => {
    const data = await readNextData(page);
    if (data) {
      for (const m of harvestMembers(data, [])) {
        collected.set(m.handle, { ...collected.get(m.handle), ...m });
      }
    }
    const hrefs = await page
      .locator(selectors.members.rowLink)
      .evaluateAll((els) => els.map((e) => e.getAttribute('href')))
      .catch(() => []);
    for (const href of hrefs) {
      const match = href && href.match(/@([\w.-]+)/);
      if (match && !collected.has(match[1])) {
        collected.set(match[1], { handle: match[1], name: match[1], profileUrl: `${baseUrl}/@${match[1]}` });
      }
    }
  };

  await harvestNow();

  let complete = true;
  let lastSize = -1;
  for (let i = 0; i < 1000 && collected.size !== lastSize; i++) {
    if (Date.now() > deadline) {
      complete = false;
      logger.warn({ scraped: collected.size }, 'Scrape hit time budget; returning partial list');
      break;
    }
    lastSize = collected.size;
    await page.mouse.wheel(0, 4000).catch(() => {});
    await sleep(jitter(600, 1200));
    await harvestNow();

    const next = page.locator(selectors.members.nextPage).first();
    if ((await next.count()) > 0 && (await next.isEnabled().catch(() => false))) {
      await next.click().catch(() => {});
      await sleep(1500);
      await harvestNow();
    }
  }

  const members = [...collected.values()];
  logger.info({ count: members.length, complete }, 'Scraped members');
  return { members, complete };
}

/**
 * Send a direct message to a member by handle. Returns true on apparent success.
 */
export async function sendDM(page, handle, message, { baseUrl = BASE_URL } = {}) {
  const url = `${baseUrl}/@${handle}`;
  logger.info({ handle }, 'Opening profile to DM');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleepJitter(1200, 2600);

  const chatBtn = page.locator(selectors.dm.chatButton).first();
  if ((await chatBtn.count()) === 0) {
    throw new Error(`No chat/message button on @${handle}'s profile (selector may need tuning, or DMs are disabled for this member)`);
  }
  await chatBtn.click();
  await sleepJitter(1000, 2200);

  const input = page.locator(selectors.dm.messageInput).first();
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.click();
  await input.type(message, { delay: jitter(20, 60) });
  await sleepJitter(400, 1200);

  const sendBtn = page.locator(selectors.dm.sendButton).first();
  if ((await sendBtn.count()) > 0 && (await sendBtn.isEnabled().catch(() => false))) {
    await sendBtn.click();
  } else {
    await input.press('Enter');
  }
  await sleepJitter(800, 1600);
  logger.info({ handle }, 'DM sent');
  return true;
}
