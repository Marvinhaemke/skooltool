import { config } from '../config.js';
import { logger } from '../logger.js';
import { selectors } from './selectors.js';
import { sleep, sleepJitter, jitter } from '../util/sleep.js';

const communityUrl = () => `${config.skool.baseUrl}/${config.skool.community}`;

/**
 * Pull Skool's embedded Next.js payload from a page. Skool renders with
 * Next.js, so the fully-structured data we want (members, plans, levels) is
 * usually present in window.__NEXT_DATA__ — vastly more stable than scraping
 * hashed CSS classes. Returns the parsed object or null.
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

/**
 * Walk an arbitrary object tree and collect anything that looks like a Skool
 * member/user record. Skool's internal shape changes, so we match defensively
 * on the presence of a handle/name and pull out the fields we care about.
 */
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
    handle &&
    (node.name || node.firstName || node.metadata?.bio !== undefined || node.email);

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
export function normalizeMember(raw) {
  const handle = raw.handle || raw.username || raw.slug;
  if (!handle) return null;
  const meta = raw.metadata || raw.meta || {};
  const member = raw.member || raw.membership || {};

  // The "package"/plan the member is on. Skool exposes this under several
  // names depending on the surface; check the likely ones.
  const plan =
    raw.planName ||
    raw.plan ||
    member.planName ||
    member.plan ||
    raw.subscriptionPlan ||
    meta.planName ||
    null;

  return {
    handle,
    name: raw.name || [raw.firstName, raw.lastName].filter(Boolean).join(' ') || handle,
    email: raw.email || meta.email || null,
    plan: plan ? String(plan) : null,
    // Skool member "level" (gamification) if present.
    level:
      raw.level ?? member.level ?? meta.level ?? raw.points?.level ?? null,
    // Whether this is a paid member (best-effort).
    isPaid:
      raw.isPaid ??
      member.isPaid ??
      (plan ? true : null),
    joinedAt:
      raw.approvedAt || raw.createdAt || member.approvedAt || member.createdAt || null,
    profileUrl: `${config.skool.baseUrl}/@${handle}`,
    raw: undefined, // don't persist the raw blob
  };
}

/**
 * Scrape the full member list for the configured community.
 * Strategy: open the admin members page, read __NEXT_DATA__, and harvest. If
 * the list is paginated/virtualized we also scroll and re-harvest to pick up
 * lazily loaded rows.
 */
export async function getMembers(page) {
  const url = `${communityUrl()}${selectors.members.pathSuffix}`;
  logger.info({ url }, 'Loading members page');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(2500);

  const collected = new Map();

  const harvestNow = async () => {
    const data = await readNextData(page);
    if (data) {
      const found = harvestMembers(data, []);
      for (const m of found) collected.set(m.handle, { ...collected.get(m.handle), ...m });
    }
    // DOM fallback: pick up handles from profile links even if NEXT_DATA missed them.
    const hrefs = await page
      .locator(selectors.members.rowLink)
      .evaluateAll((els) => els.map((e) => e.getAttribute('href')))
      .catch(() => []);
    for (const href of hrefs) {
      const match = href && href.match(/@([\w.-]+)/);
      if (match) {
        const handle = match[1];
        if (!collected.has(handle)) {
          collected.set(handle, { handle, name: handle, profileUrl: `${config.skool.baseUrl}/@${handle}` });
        }
      }
    }
  };

  await harvestNow();

  // Scroll to trigger lazy loading, harvesting as we go. Bounded to avoid loops.
  let lastSize = -1;
  for (let i = 0; i < 50 && collected.size !== lastSize; i++) {
    lastSize = collected.size;
    await page.mouse.wheel(0, 4000).catch(() => {});
    await sleep(jitter(700, 1400));
    await harvestNow();
    // Try a "next page" button if pagination is used instead of infinite scroll.
    const next = page.locator(selectors.members.nextPage).first();
    if ((await next.count()) > 0 && (await next.isEnabled().catch(() => false))) {
      await next.click().catch(() => {});
      await sleep(1500);
      await harvestNow();
    }
  }

  const members = [...collected.values()];
  logger.info({ count: members.length }, 'Scraped members');
  return members;
}

/**
 * Send a direct message to a member by handle.
 * Opens the member's profile, clicks the chat/message button, types, and sends.
 * Returns true on apparent success.
 */
export async function sendDM(page, handle, message) {
  const url = `${config.skool.baseUrl}/@${handle}`;
  logger.info({ handle }, 'Opening profile to DM');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleepJitter(1200, 2600);

  const chatBtn = page.locator(selectors.dm.chatButton).first();
  if ((await chatBtn.count()) === 0) {
    throw new Error(`No chat/message button found on @${handle}'s profile (selector may need tuning, or DMs are disabled for this member)`);
  }
  await chatBtn.click();
  await sleepJitter(1000, 2200);

  const input = page.locator(selectors.dm.messageInput).first();
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.click();

  // Type with small per-character delay to look human.
  await input.type(message, { delay: jitter(20, 60) });
  await sleepJitter(400, 1200);

  const sendBtn = page.locator(selectors.dm.sendButton).first();
  if ((await sendBtn.count()) > 0 && (await sendBtn.isEnabled().catch(() => false))) {
    await sendBtn.click();
  } else {
    // Many chat composers send on Enter.
    await input.press('Enter');
  }
  await sleepJitter(800, 1600);
  logger.info({ handle }, 'DM sent');
  return true;
}
