# skooltool

Headless-browser automation for **your own** [Skool](https://www.skool.com)
community. Skool has no usable public API, so this drives a real (headless)
Chromium session via [Playwright](https://playwright.dev).

It does three things:

1. **Daily new-member webhook → Zapier.** Once a day it scrapes the member
   list, diffs it against yesterday's snapshot, and POSTs every new member —
   **email + package/plan** — to a Zapier catch hook.
2. **Rule-based auto-actions.** A small trigger engine reacts to events
   (`new_member`, `new_subscription`, `level_reached`, `course_completed`) and
   can fire a webhook and/or an auto-DM per rule.
3. **Mass DMs.** Send a templated message to a list of members (or everyone),
   on demand, with built-in rate limiting and human-like pacing.

> ⚠️ **Read this first.** Automating Skool through the browser may be against
> Skool's Terms of Service, and aggressive messaging can get an account
> flagged or banned. Use this only on a community **you own/administer**, keep
> the rate limits conservative, and treat any selector that breaks as Skool
> changing their UI (expected — see *Tuning selectors*). You are responsible
> for how you use it.

---

## How it works

```
                ┌─────────────── daily cron (node-cron) ───────────────┐
                │                                                       │
  Playwright ──▶ scrape members ──▶ diff vs snapshot ──▶ events ──┬──▶ daily digest webhook (Zapier)
  (saved login)                                                   │
                                                                  └──▶ trigger engine ──▶ per-event webhook
                                                                                      └──▶ auto-DM (templated)

  Control API (Express) ──▶ /sync  /massdm  /status         CLI ──▶ login | sync | members | massdm | status
```

State lives in `data/state.json` (member snapshot, DM log, daily quota,
fired-trigger dedupe). The browser login is cached in `data/session.json`.
Both are git-ignored.

## Requirements

- Node.js ≥ 20
- A Skool account that **administers** the target community
- A Zapier (or any) inbound **Catch Hook** URL

## Setup

```bash
npm install
npx playwright install chromium      # one-time: download the browser
cp .env.example .env                 # then fill it in (see below)
```

Key env vars (full list + comments in [`.env.example`](.env.example)):

| Var | What |
| --- | --- |
| `SKOOL_EMAIL` / `SKOOL_PASSWORD` | the admin account login |
| `SKOOL_COMMUNITY` | the slug in `skool.com/<slug>` |
| `ZAPIER_WEBHOOK_URL` | daily new-member digest target |
| `ZAPIER_EVENT_WEBHOOK_URL` | per-event target (defaults to the daily one) |
| `DAILY_SYNC_CRON` / `TZ` | when the daily job runs |
| `AUTO_DM_ENABLED` | master switch for auto-DMs (default `false`) |
| `DM_*` | rate limits (delays + per-run / per-day caps) |
| `API_KEY` | shared secret for the control API |

### First login

Log in once so the session is cached. If your account uses 2FA/SSO, run with a
visible browser and complete the challenge — the session is then reused:

```bash
HEADLESS=false SLOW_MO_MS=150 npm run login
```

## Running

**As a long-running service** (daily cron + control API):

```bash
npm start
```

**One-off via CLI:**

```bash
npm run sync          # run the daily job now
npm run sync:dry      # scrape + diff only — sends nothing, saves nothing
npm run members       # print the scraped member list as JSON
npm run status        # show last sync + counters

# Mass DM
npm run massdm -- --to @alice,@bob --template "Hey {{name}} 👋"
npm run massdm -- --all --template-file welcome.txt --dry-run
npm run massdm -- --all --template "Hi {{name}}" --skip-messaged
```

> The **first sync establishes a baseline only** — it does not fire webhooks or
> DMs for the existing membership (otherwise everyone would look "new").
> New members are detected from the second sync onward.

**Control API** (all mutating routes need `x-api-key: $API_KEY`):

```bash
curl localhost:3000/health
curl -H "x-api-key: $API_KEY" localhost:3000/status
curl -X POST -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
     -d '{"dryRun":true}' localhost:3000/sync
curl -X POST -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
     -d '{"recipients":["@alice"],"template":"Hi {{name}}"}' localhost:3000/massdm
```

## The Zapier payload

The daily digest posts:

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

In Zapier: **Webhooks by Zapier → Catch Hook**, then loop over `members`
(or use a "Looping" step) and map `email` + `package` downstream.

## Rules (auto-actions)

Defaults live in [`src/rules.js`](src/rules.js). Override them without touching
code by creating `data/rules.json` with the same shape:

```json
[
  {
    "id": "vip-welcome",
    "on": "new_subscription",
    "when": { "plan": ["VIP", "Premium"] },
    "webhook": true,
    "dm": { "template": "Welcome to {{plan}}, {{name}}! 🎉" }
  }
]
```

- `on`: `new_member` | `new_subscription` | `level_reached` | `course_completed`
- `when`: optional `{ plan: string|string[], minLevel: number }`
- `webhook`: POST the event to `ZAPIER_EVENT_WEBHOOK_URL`
- `dm.template`: auto-DM the member — **requires `AUTO_DM_ENABLED=true`**
- Templates support `{{name}} {{handle}} {{plan}} {{level}} {{previousPlan}}`

Every `(rule, event)` fires **at most once** (deduped in `state.json`), so
re-running a sync never re-sends.

## Tuning selectors

Everything Skool-DOM-specific is centralized in
[`src/skool/selectors.js`](src/skool/selectors.js). Member scraping prefers
Skool's embedded Next.js data (`__NEXT_DATA__`), which is far more stable than
their hashed CSS classes — but **DM sending and login go through the rendered
UI**, so those selectors are the most likely to need adjusting against the live
site. To debug:

```bash
HEADLESS=false SLOW_MO_MS=200 npm run members   # watch the scrape
```

Open devtools on the failing page, find a stable selector (prefer roles/text/
hrefs over classes), and update `selectors.js`.

### Known gaps / next steps

- **`course_completed`** is wired through the rules/diff/webhook path but the
  scraper does not yet read per-member course progress — Skool exposes this
  inconsistently. The hook is in place; populate `course` data in
  `client.js` once you confirm where it lives in your community's `__NEXT_DATA__`.
- `email` is only available where Skool surfaces it on the admin members view;
  some surfaces omit it.

## Tests

```bash
npm test          # pure-logic tests (diff, rules, normalization) — no browser
```

## Deployment

Built to run as a single long-lived process (`npm start`) on any small
VPS/Render/Railway/Fly box. Persist the `data/` directory so the snapshot and
saved login survive restarts. Keep `.env` out of version control (it already is).
