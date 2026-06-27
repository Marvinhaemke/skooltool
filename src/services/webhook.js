import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * POST a JSON payload to a webhook (Zapier catch hook by default).
 * Uses Node's built-in fetch (Node >= 18). Retries a couple of times on
 * transient network/5xx errors.
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
      if (!res.ok && res.status >= 500) {
        throw new Error(`Webhook returned ${res.status}`);
      }
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

/**
 * Send the daily digest of new members to the configured daily webhook.
 * Zapier "Catch Hook" handles both a summary object and a per-item line item
 * array, so we send both shapes for flexibility in the Zap.
 */
export async function sendDailyNewMembers(newMembers) {
  const payload = {
    event: 'daily_new_members',
    date: new Date().toISOString(),
    community: config.skool.community,
    count: newMembers.length,
    // Flat line items — easiest to fan out in Zapier.
    members: newMembers.map((m) => ({
      handle: m.handle,
      name: m.name,
      email: m.email,
      package: m.plan, // <- the "package" the user asked for
      level: m.level,
      isPaid: m.isPaid,
      joinedAt: m.joinedAt,
      profileUrl: m.profileUrl,
    })),
  };
  return postWebhook(config.webhook.daily, payload);
}

/** Send a single trigger event (new_subscription, level_reached, etc.). */
export async function sendEvent(event) {
  return postWebhook(config.webhook.event, {
    ...event,
    community: config.skool.community,
    sentAt: new Date().toISOString(),
  });
}
