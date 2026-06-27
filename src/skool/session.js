import { logger } from '../logger.js';
import { selectors } from './selectors.js';
import { sleep } from '../util/sleep.js';
import { launchBrowser } from '../browser.js';
import { getSettings } from '../settings.js';
import { getStorage } from '../storage.js';

const SESSION_KEY = 'skoolSession'; // storageState JSON, persisted via the store

/**
 * Owns a Chromium browser + an authenticated Skool context. The login
 * (cookies/localStorage) is persisted through the storage backend rather than
 * the filesystem, so it survives across stateless serverless invocations.
 *
 * Credentials and the community come from runtime settings (editable in-app).
 */
export class SkoolSession {
  constructor() {
    this.browser = null;
    this.context = null;
    this.settings = null;
  }

  async start() {
    if (this.browser) return this;
    this.settings = await getSettings();
    if (!this.settings.configured) {
      throw new Error('Skool is not configured yet — set the community URL, email and password in the settings page.');
    }
    this.browser = await launchBrowser();

    const store = await getStorage();
    const savedState = await store.getJSON(SESSION_KEY);

    this.context = await this.browser.newContext({
      storageState: savedState || undefined,
      viewport: { width: 1366, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    this.context.setDefaultTimeout(30_000);
    return this;
  }

  baseUrl() {
    return this.settings.skool.baseUrl;
  }

  async page() {
    await this.start();
    return this.context.newPage();
  }

  async isLoggedIn(page) {
    try {
      await page.goto(`${this.baseUrl()}/`, { waitUntil: 'domcontentloaded' });
      if (page.url().includes('/login')) return false;
      const marker = page.locator(selectors.login.loggedInMarker).first();
      return (await marker.count()) > 0;
    } catch {
      return false;
    }
  }

  async ensureLogin() {
    const page = await this.page();
    try {
      if (await this.isLoggedIn(page)) {
        logger.info('Reusing saved Skool session');
        return;
      }
      await this.login(page);
    } finally {
      await page.close();
    }
  }

  async login(page) {
    logger.info('Logging in to Skool');
    await page.goto(`${this.baseUrl()}${selectors.login.path}`, {
      waitUntil: 'domcontentloaded',
    });

    await page.fill(selectors.login.emailInput, this.settings.skool.email);
    await page.fill(selectors.login.passwordInput, this.settings.skool.password);
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.click(selectors.login.submitButton),
    ]);
    await sleep(3000);

    if (page.url().includes('/login')) {
      const errText = await page
        .locator('text=/incorrect|invalid|wrong/i')
        .first()
        .textContent()
        .catch(() => null);
      throw new Error(
        `Skool login failed (still on /login).${errText ? ` Page says: "${errText.trim()}"` : ''} ` +
          'If the account uses 2FA/SSO, log in once on a machine with a visible browser (HEADLESS=false) and import that session.'
      );
    }

    await this.persist();
    logger.info('Login succeeded; session saved');
  }

  /** Persist current cookies/localStorage to the store. */
  async persist() {
    if (!this.context) return;
    const state = await this.context.storageState();
    const store = await getStorage();
    await store.setJSON(SESSION_KEY, state);
  }

  async close() {
    try {
      await this.persist();
    } catch (err) {
      logger.warn({ err }, 'Failed to persist session on close');
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
  }
}
