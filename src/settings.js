import { getStorage } from './storage.js';
import { encrypt, decrypt, hashPassword } from './crypto.js';
import { logger } from './logger.js';

const SETTINGS_KEY = 'settings';

/**
 * Runtime-editable settings. These live in the store so the Skool link, login,
 * Zapier URL, rate limits and auto-DM switch can all be configured from the
 * app's settings page instead of redeploying with new env vars.
 *
 * Environment variables act as bootstrap defaults: if the store is empty (a
 * fresh deploy), we fall back to SKOOL_*, ZAPIER_*, DM_* and AUTO_DM_ENABLED.
 * Once you save settings in the UI, the stored values win.
 *
 * The Skool password is encrypted at rest (AES-256-GCM via APP_SECRET); the
 * admin password is stored only as a scrypt hash.
 */

function bool(v, fallback = false) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}
function int(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Accept either a full Skool URL or a bare slug and return the slug. */
export function parseCommunitySlug(input) {
  if (!input) return '';
  const s = String(input).trim();
  const m = s.match(/skool\.com\/([^/?#]+)/i);
  if (m) return m[1];
  // Strip a leading @ or slashes if they pasted just the handle.
  return s.replace(/^@/, '').replace(/^\/+|\/+$/g, '');
}

function envDefaults() {
  return {
    skool: {
      email: process.env.SKOOL_EMAIL || '',
      // env password is plaintext; we encrypt on first save.
      password: process.env.SKOOL_PASSWORD || '',
      community: parseCommunitySlug(process.env.SKOOL_COMMUNITY || ''),
    },
    webhook: {
      daily: process.env.ZAPIER_WEBHOOK_URL || '',
      event: process.env.ZAPIER_EVENT_WEBHOOK_URL || process.env.ZAPIER_WEBHOOK_URL || '',
    },
    dm: {
      minDelayMs: int(process.env.DM_MIN_DELAY_MS, 8000),
      maxDelayMs: int(process.env.DM_MAX_DELAY_MS, 20000),
      maxPerRun: int(process.env.DM_MAX_PER_RUN, 40),
      maxPerDay: int(process.env.DM_MAX_PER_DAY, 150),
    },
    autoDm: { enabled: bool(process.env.AUTO_DM_ENABLED, false) },
    admin: { passwordHash: '' },
  };
}

/** Read raw stored settings (password still encrypted). */
async function readRaw() {
  const store = await getStorage();
  return (await store.getJSON(SETTINGS_KEY)) || {};
}

/**
 * Resolve effective settings: stored values layered over env defaults, with the
 * Skool password decrypted and ready to use.
 */
export async function getSettings() {
  const defaults = envDefaults();
  const stored = await readRaw();

  const skoolPassword = stored.skool?.passwordEnc
    ? decrypt(stored.skool.passwordEnc)
    : defaults.skool.password;

  const settings = {
    skool: {
      email: stored.skool?.email ?? defaults.skool.email,
      password: skoolPassword,
      community: stored.skool?.community ?? defaults.skool.community,
      baseUrl: 'https://www.skool.com',
    },
    webhook: { ...defaults.webhook, ...(stored.webhook || {}) },
    dm: { ...defaults.dm, ...(stored.dm || {}) },
    autoDm: { ...defaults.autoDm, ...(stored.autoDm || {}) },
    admin: { passwordHash: stored.admin?.passwordHash ?? defaults.admin.passwordHash },
  };
  settings.configured = Boolean(
    settings.skool.email && settings.skool.password && settings.skool.community
  );
  return settings;
}

/**
 * Persist a partial settings update from the settings UI/API.
 * - `skoolPassword` (plaintext) is encrypted before storage.
 * - `adminPassword` (plaintext) is hashed before storage.
 * - A Skool URL or slug both work for `community`.
 */
export async function saveSettings(patch) {
  const store = await getStorage();
  const current = await readRaw();
  const next = {
    skool: { ...(current.skool || {}) },
    webhook: { ...(current.webhook || {}) },
    dm: { ...(current.dm || {}) },
    autoDm: { ...(current.autoDm || {}) },
    admin: { ...(current.admin || {}) },
  };

  if (patch.skool) {
    if (patch.skool.email !== undefined) next.skool.email = patch.skool.email.trim();
    if (patch.skool.community !== undefined) {
      next.skool.community = parseCommunitySlug(patch.skool.community);
    }
    if (patch.skoolPassword) next.skool.passwordEnc = encrypt(patch.skoolPassword);
  }
  if (patch.webhook) {
    if (patch.webhook.daily !== undefined) next.webhook.daily = patch.webhook.daily.trim();
    if (patch.webhook.event !== undefined) next.webhook.event = patch.webhook.event.trim();
  }
  if (patch.dm) {
    for (const k of ['minDelayMs', 'maxDelayMs', 'maxPerRun', 'maxPerDay']) {
      if (patch.dm[k] !== undefined) next.dm[k] = int(patch.dm[k], next.dm[k]);
    }
  }
  if (patch.autoDm && patch.autoDm.enabled !== undefined) {
    next.autoDm.enabled = bool(patch.autoDm.enabled);
  }
  if (patch.adminPassword) {
    next.admin.passwordHash = hashPassword(patch.adminPassword);
  }

  await store.setJSON(SETTINGS_KEY, next);
  logger.info('Settings saved');
  return getSettings();
}

/** Settings safe to send to the browser (no secrets). */
export async function getPublicSettings() {
  const s = await getSettings();
  return {
    skool: { email: s.skool.email, community: s.skool.community, hasPassword: Boolean(s.skool.password) },
    webhook: { daily: s.webhook.daily, event: s.webhook.event },
    dm: s.dm,
    autoDm: s.autoDm,
    adminConfigured: Boolean(s.admin.passwordHash),
    configured: s.configured,
  };
}
