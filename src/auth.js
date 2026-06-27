import { config } from './config.js';
import { getSettings } from './settings.js';
import { verifyPassword } from './crypto.js';

/**
 * Read a header from either an Express request or a Vercel/Node request object
 * (both expose lowercased headers on `req.headers`).
 */
function header(req, name) {
  const h = req.headers || {};
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Admin auth for settings/control endpoints. Pass the admin password in the
 * `x-admin-password` header (or Authorization: Bearer <password>). Verified
 * against the scrypt hash stored in settings.
 *
 * Returns { ok, bootstrap } — `bootstrap` is true when no admin password has
 * been configured yet, so the very first settings save can establish one.
 */
export async function checkAdmin(req) {
  const settings = await getSettings();
  const stored = settings.admin.passwordHash;
  if (!stored) return { ok: false, bootstrap: true };

  let pw = header(req, 'x-admin-password');
  if (!pw) {
    const auth = header(req, 'authorization');
    if (auth && auth.startsWith('Bearer ')) pw = auth.slice(7);
  }
  return { ok: Boolean(pw) && verifyPassword(pw, stored), bootstrap: false };
}

/** Cron auth: Vercel sends `Authorization: Bearer <CRON_SECRET>`. */
export function checkCron(req) {
  if (!config.cronSecret) return false;
  const auth = header(req, 'authorization');
  return auth === `Bearer ${config.cronSecret}`;
}
