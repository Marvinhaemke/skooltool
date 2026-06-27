import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Launch a Chromium browser that works both locally and inside a Vercel
 * serverless function.
 *
 *  - On Vercel (or when USE_SERVERLESS_CHROMIUM=true) we use `playwright-core`
 *    driving the tiny, Lambda-compatible `@sparticuz/chromium` build. The full
 *    `playwright` Chromium download is far too large for a serverless bundle.
 *  - Locally we use the normal `playwright` package and its bundled browser.
 *
 * Both are optional dependencies that are imported lazily, so you only need the
 * one your environment actually uses installed.
 */
const useServerless =
  config.onVercel ||
  ['1', 'true', 'yes'].includes(String(process.env.USE_SERVERLESS_CHROMIUM).toLowerCase());

export async function launchBrowser() {
  if (useServerless) {
    const [{ default: chromium }, { chromium: pwChromium }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('playwright-core'),
    ]);
    logger.info('Launching serverless Chromium (@sparticuz/chromium)');
    return pwChromium.launch({
      args: [...chromium.args, '--disable-blink-features=AutomationControlled'],
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const { chromium } = await import('playwright');
  // Optional override: point at an already-present Chrome/Chromium binary
  // (handy for CI, sandboxes, or a system Chrome) instead of Playwright's
  // managed download.
  const executablePath =
    process.env.CHROMIUM_EXECUTABLE_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
  logger.info({ headless: config.browser.headless, executablePath }, 'Launching local Chromium (playwright)');
  return chromium.launch({
    headless: config.browser.headless,
    slowMo: config.browser.slowMo,
    executablePath,
    args: ['--disable-blink-features=AutomationControlled'],
  });
}
