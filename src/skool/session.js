import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { selectors } from './selectors.js';
import { sleep } from '../util/sleep.js';

const SESSION_FILE = path.join(config.dataDir, 'session.json');

/**
 * Owns a single Playwright browser + an authenticated Skool context.
 * Persists storage state (cookies/localStorage) to data/session.json so we
 * don't have to log in on every run, and transparently re-logs-in when the
 * saved session has expired.
 */
export class SkoolSession {
  constructor() {
    this.browser = null;
    this.context = null;
  }

  async start() {
    if (this.browser) return this;
    await mkdir(config.dataDir, { recursive: true });
    logger.info({ headless: config.browser.headless }, 'Launching browser');
    this.browser = await chromium.launch({
      headless: config.browser.headless,
      slowMo: config.browser.slowMo,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    this.context = await this.browser.newContext({
      storageState: existsSync(SESSION_FILE) ? SESSION_FILE : undefined,
      viewport: { width: 1366, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    this.context.setDefaultTimeout(30_000);
    return this;
  }

  async page() {
    await this.start();
    return this.context.newPage();
  }

  /** Returns true if the given page is currently authenticated. */
  async isLoggedIn(page) {
    try {
      await page.goto(`${config.skool.baseUrl}/`, { waitUntil: 'domcontentloaded' });
      // If we get redirected to /login or see a login form, we're out.
      if (page.url().includes('/login')) return false;
      const marker = page.locator(selectors.login.loggedInMarker).first();
      return (await marker.count()) > 0;
    } catch {
      return false;
    }
  }

  /** Ensures we have a valid session, logging in with credentials if needed. */
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
    await page.goto(`${config.skool.baseUrl}${selectors.login.path}`, {
      waitUntil: 'domcontentloaded',
    });

    await page.fill(selectors.login.emailInput, config.skool.email);
    await page.fill(selectors.login.passwordInput, config.skool.password);
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.click(selectors.login.submitButton),
    ]);

    // Give SPA navigation / any 2FA challenge a moment.
    await sleep(3000);

    if (page.url().includes('/login')) {
      const errText = await page.locator('text=/incorrect|invalid|wrong/i').first().textContent().catch(() => null);
      throw new Error(
        `Skool login appears to have failed (still on /login).${
          errText ? ` Page says: "${errText.trim()}"` : ''
        } If your account uses 2FA/SSO, run with HEADLESS=false to complete it once; the session will be saved.`
      );
    }

    await this.context.storageState({ path: SESSION_FILE });
    logger.info('Login succeeded; session saved');
  }

  /** Persist current cookies/localStorage to disk. */
  async persist() {
    if (this.context) await this.context.storageState({ path: SESSION_FILE });
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
