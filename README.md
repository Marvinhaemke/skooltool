# skooltool

Headless-browser automation for **your own** [Skool](https://www.skool.com)
community. Skool has no usable public API, so this drives a real (headless)
Chromium session via Playwright. Runs **on Vercel** (serverless) or
**self-hosted** (long-running process) from the same codebase.

It does three things:

1. **Daily new-member webhook → Zapier.** Once a day it scrapes the member
   list, diffs it against yesterday's snapshot, and POSTs every new member —
   **email + package/plan** — to a Zapier catch hook.
2. **Rule-based auto-actions.** A trigger engine reacts to events
   (`new_member`, `new_subscription`, `level_reached`, `course_completed`) and
   fires a webhook and/or a templated auto-DM per rule.
3. **Mass DMs.** Queue a templated message to a list of members (or everyone).
   Sending is a **resumable job** that drips out over time, respecting daily
   caps — so even thousands of recipients work.

The Skool link, login, Zapier URLs, rate limits and auto-DM switch are all
**configured at runtime from the built-in settings page** (`/`) — no redeploy
needed to change them.

> ⚠️ **Read this first.** Automating Skool through the browser may breach
> Skool's Terms of Service, and aggressive messaging can get an account flagged
> or banned. Use this only on a community **you own/administer**, keep rate
> limits conservative, and treat any selector that breaks as Skool changing
> their UI. You are responsible for how you use it.

---

## ⏱️ What's actually possible (please read)

Headless automation has hard limits — some from Vercel, some from physics:

- **You cannot DM 6000 people in one run, anywhere.** Safe human-like pacing is
  ~100–150 DMs/day; 6000 recipients is inherently a **multi-week drip**. The
  mass-DM **job queue** handles this: enqueue everyone once, a worker sends a
  small batch each tick and resumes exactly where it left off across days.
- **Scraping thousands of members** can exceed a single serverless function's
  timeout. The scrape is **time-budgeted and incremental** (partial scrapes
  merge into the snapshot rather than replacing it). Very large communities may
  need **Vercel Pro + Fluid Compute** (longer functions) or the self-hosted mode.
- **Vercel cron frequency**: Hobby allows **daily** crons only. The daily
  webhook works great on Hobby. The mass-DM worker wants to run **every few
  minutes**, which needs **Vercel Pro** — or trigger the worker from a free
  external scheduler (see below). Self-hosted has no such limit.

If your priority is the **daily new-member → Zapier webhook**, Hobby is fine.
If you need **mass DMs at scale**, use Vercel Pro or self-host.

---

## Architecture

```
  Vercel Cron ─▶ /api/cron/sync   ─▶ runSync: login ▸ scrape ▸ diff ▸ daily webhook ▸ triggers
  Vercel Cron ─▶ /api/cron/worker ─▶ drain mass-DM queue (a batch per tick, resumable)
  Settings UI (/) ─▶ /api/config  ─▶ Skool link/login (encrypted), Zapier, limits, rules
                     /api/sync /api/massdm /api/status   (admin-gated)

  State + saved login + config  ──▶  Upstash Redis ("Vercel KV")   [prod]
                                ──▶  data/state.json               [local]
  Browser  ──▶ @sparticuz/chromium + playwright-core [serverless] | playwright [local]
```

Key modules: `src/handlers.js` (transport-agnostic logic), `src/settings.js`
(runtime config), `src/storage.js` (Redis/file), `src/services/*`
(sync, diff, triggers, webhook, dmqueue), `src/skool/*` (session, client,
selectors). The Express server (`src/server.js`) and the Vercel functions
(`api/*`) are both thin adapters over `handlers.js`.

---

## Deploy on Vercel

1. **Push this repo to GitHub and import it into Vercel.**
2. **Add storage:** in the project's *Storage* tab, add the **Upstash Redis**
   integration (Marketplace → Redis). It sets `KV_REST_API_URL` /
   `KV_REST_API_TOKEN` automatically.
3. **Set environment variables** (Project → Settings → Environment Variables):
   | Var | Value |
   | --- | --- |
   | `APP_SECRET` | long random string — encrypts the stored Skool password (`openssl rand -hex 32`) |
   | `CRON_SECRET` | long random string — authenticates Vercel Cron calls |
   | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1` (skip the dev browser download at build) |
4. **Deploy.** `vercel.json` registers two crons: daily `/api/cron/sync` and
   hourly `/api/cron/worker`.
5. **Open your deployment URL** → the settings page. Set an **admin password**,
   paste your **Skool community link + login**, your **Zapier webhook**, adjust
   limits, and Save.
6. Click **Run sync now** once to establish the baseline snapshot.

**Plan notes**
- The hourly worker cron requires **Vercel Pro**. On **Hobby**, remove the
  `/api/cron/worker` entry from `vercel.json` and instead hit
  `https://<your-app>/api/cron/worker` from a free scheduler like
  [cron-job.org](https://cron-job.org) with header
  `Authorization: Bearer <CRON_SECRET>` every 5–15 min.
- For big communities, raise `maxDuration` in `vercel.json` (Pro) and
  `SCRAPE_BUDGET_MS` accordingly.

> **2FA/SSO accounts:** a Vercel function can't pause for a login challenge.
> Log in once locally (`HEADLESS=false npm run login`), then copy the resulting
> session into Redis (the `skoolSession` key) — or use a Skool account with
> plain email/password auth.

---

## Run self-hosted (VPS / Render / Railway / your machine)

```bash
npm install
npx playwright install chromium     # local browser
cp .env.example .env                # set APP_SECRET (+ optional bootstrap vars)
npm start                           # daily cron + DM worker + settings UI on :3000
```

Open `http://localhost:3000`, set your admin password + Skool login + Zapier
URL, and you're running. State persists in `data/state.json` (mount/persist
the `data/` dir).

### CLI (self-hosted)

```bash
npm run login        # log in once, save the session
npm run sync         # run the daily job now
npm run sync:dry     # scrape + diff only — sends nothing, saves nothing
npm run members      # print the scraped member list as JSON
npm run worker       # drain the mass-DM queue once
npm run status       # show counters + active job
npm run massdm -- --all --template "Hi {{name}} 👋"
npm run massdm -- --to @alice,@bob --template-file welcome.txt --skip-messaged
```

> The **first sync establishes a baseline only** — no webhooks/DMs for the
> existing membership (otherwise everyone looks "new"). New members are detected
> from the second sync onward.

---

## The Zapier payload (daily digest)

```json
{
  "event": "daily_new_members",
  "date": "2026-06-27T09:00:00.000Z",
  "community": "your-slug",
  "count": 2,
  "members": [
    { "handle": "alice", "name": "Alice", "email": "alice@example.com",
      "package": "Pro", "level": 1, "isPaid": true, "joinedAt": "...",
      "profileUrl": "https://www.skool.com/@alice" }
  ]
}
```

In Zapier: **Webhooks by Zapier → Catch Hook**, then loop over `members` and
map `email` + `package` downstream.

## Rules (auto-actions)

Defaults live in `src/rules.js`; override them from the store (saved via
`/api/config` with a `rules` array, same shape):

```json
[
  { "id": "vip-welcome", "on": "new_subscription",
    "when": { "plan": ["VIP", "Premium"] },
    "webhook": true,
    "dm": { "template": "Welcome to {{plan}}, {{name}}! 🎉" } }
]
```

- `on`: `new_member` | `new_subscription` | `level_reached` | `course_completed`
- `when`: optional `{ plan: string|string[], minLevel: number }`
- `webhook`: POST the event to the per-event Zapier URL
- `dm.template`: auto-DM the member — **requires auto-DM enabled** in settings
- Templates support `{{name}} {{handle}} {{plan}} {{level}} {{previousPlan}}`
- Every `(rule, event)` fires **at most once** (deduped in the store).

## Security model

- The **Skool password is encrypted at rest** (AES-256-GCM via `APP_SECRET`);
  only a scrypt **hash** of the admin password is stored.
- Settings/control endpoints require the admin password (`x-admin-password`
  header; the UI stores it only in your browser session).
- Cron endpoints require `Authorization: Bearer <CRON_SECRET>`.

## Tuning selectors

All Skool-DOM-specific selectors live in `src/skool/selectors.js`. Member
scraping prefers Skool's embedded `__NEXT_DATA__` (stable); login and DM-send
go through the rendered UI, so those are the most likely to need adjusting:

```bash
HEADLESS=false SLOW_MO_MS=200 npm run members
```

### Known gaps

- **`course_completed`** is wired through rules/diff/webhook, but the scraper
  does not yet read per-member course progress (Skool exposes it
  inconsistently). The hook is in place — populate `course` data in
  `src/skool/client.js` once you confirm where it lives in your `__NEXT_DATA__`.
- `email` is only available where Skool surfaces it on the admin members view.

## Tests

```bash
npm test     # pure-logic tests (diff, rules, normalization) — no browser
```
