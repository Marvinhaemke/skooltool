import { logger } from '../logger.js';

/**
 * POST a JSON payload to a webhook (Zapier catch hook by default).
 * Retries a couple of times on transient network/5xx errors.
 */
export async function postWebhook(url, payload, { retries = 3 } = {}) {
  if (!url) {
    logger.warn('No webhook URL configured; skipping webhook post');
    return { skipped: true };
  }
  let attempt = 0;
  let lastErr;
  while (attempt < retries) {
    attempt++;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok && res.status >= 500) throw new Error(`Webhook returned ${res.status}`);
      logger.info({ status: res.status, attempt }, 'Webhook posted');
      return { ok: res.ok, status: res.status };
    } catch (err) {
      lastErr = err;
      const backoff = 1000 * 2 ** (attempt - 1);
      logger.warn({ err, attempt, backoff }, 'Webhook post failed; retrying');
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  logger.error({ err: lastErr }, 'Webhook post failed after retries');
  throw lastErr;
}

/** Send the daily digest of new members (email + package) to the daily webhook. */
export async function sendDailyNewMembers(settings, newMembers) {
  const payload = {
    event: 'daily_new_members',
    date: new Date().toISOString(),
    community: settings.skool.community,
    count: newMembers.length,
    members: newMembers.map((m) => ({
      handle: m.handle,
      name: m.name,
      email: m.email,
      package: m.plan,
      level: m.level,
      isPaid: m.isPaid,
      joinedAt: m.joinedAt,
      profileUrl: m.profileUrl,
    })),
  };
  return postWebhook(settings.webhook.daily, payload);
}

/** Send a single trigger event (new_subscription, level_reached, etc.). */
export async function sendEvent(settings, event) {
  return postWebhook(settings.webhook.event, {
    ...event,
    community: settings.skool.community,
    sentAt: new Date().toISOString(),
  });
}
