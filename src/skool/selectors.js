/**
 * ============================================================================
 *  CENTRALIZED SKOOL DOM SELECTORS
 * ============================================================================
 *
 * Skool has no public API, so everything here is screen-scraping. Skool ships
 * a Next.js front end whose CSS class names are hashed and change between
 * deploys, so DO NOT rely on class names. The selectors below prefer stable
 * signals (URLs, hrefs, accessible names, data-testid if present, text).
 *
 * THIS IS THE ONE FILE YOU WILL ALMOST CERTAINLY NEED TO TUNE against your
 * live community. To do it safely:
 *
 *   1. Run `HEADLESS=false SLOW_MO_MS=200 npm run login` and log in once so the
 *      session is saved to data/session.json.
 *   2. Run `HEADLESS=false npm run members` and watch which steps fail.
 *   3. Open devtools on the relevant Skool page, find a stable selector, and
 *      update it here. Keep selectors resilient (roles/text over classes).
 *
 * A good chunk of the heavy lifting in client.js is done by reading Skool's
 * embedded Next.js data (window.__NEXT_DATA__ / the __NEXT_DATA__ script tag),
 * which is far more stable than the rendered DOM. Selectors are the fallback.
 */

export const selectors = {
  login: {
    // Skool login lives at /login
    path: '/login',
    emailInput: 'input[type="email"], input[name="email"]',
    passwordInput: 'input[type="password"], input[name="password"]',
    submitButton: 'button[type="submit"]',
    // Something only present once logged in (avatar / account menu).
    loggedInMarker: '[href="/settings"], [aria-label*="profile" i], img[alt*="avatar" i]',
  },

  members: {
    // Members admin list: https://www.skool.com/<slug>/-/members  (membership area)
    pathSuffix: '/-/members',
    // Each member row links to the member's profile: /<slug>/@<handle> or /@<handle>
    rowLink: 'a[href*="/@"]',
    // Pagination "next" control on the members list, if rendered.
    nextPage: 'button[aria-label*="next" i], a[aria-label*="next" i]',
    // Search box on the members page (used to locate a specific member).
    search: 'input[placeholder*="search" i]',
  },

  profile: {
    // On a member profile, the admin "level" badge / progress.
    levelText: '[class*="level" i], [data-testid*="level" i]',
  },

  dm: {
    // Button that opens a chat/DM composer from a profile or hovercard.
    chatButton:
      'button:has-text("Chat"), a:has-text("Chat"), button:has-text("Message"), a:has-text("Message")',
    // The message text area in the DM composer.
    messageInput:
      'textarea, [contenteditable="true"][role="textbox"], div[role="textbox"]',
    sendButton: 'button:has-text("Send"), button[aria-label*="send" i]',
    // Confirmation that the message landed (the message bubble shows up).
    sentMarker: '[class*="message" i]',
  },
};
