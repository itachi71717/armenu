# ARMenu

![CI](https://github.com/itachi71717/armenu/actions/workflows/ci.yml/badge.svg?branch=main)

South Africa's augmented-reality menu platform. Diners scan a QR beside any dish,
the meal appears on their table life-size and photo-real — no app install.

**Production:** [armenu.co.za](https://armenu.co.za) · every push to `main`
auto-deploys via Vercel · every PR gets its own preview URL.

---

## Snapshot

- **60+ API handlers** (88 files in `api/_h/`) behind one dispatcher, `api/index.js`.
- **Customer layer:** customer profiles (cross-restaurant browser token, favourites, allergies, merge-by-phone), loyalty + referrals, waitlist / walk-ins, combos.
- **Kitchen:** stations (Hot/Cold/Dessert/Expo) with station routing, EXPO view, auto-rush, recall, bump-bar shortcuts.
- **Quality:** ~250 vitest tests (`npm test`) plus Playwright e2e (`tests/e2e`, `.github/workflows/e2e.yml`), Lighthouse CI (`lighthouse.yml`), zero-dep lint + syntax checks in `npm run check`.
- **Ops:** nightly R2 backups (`/api/admin/backup-cron`, 03:00 UTC), daily summary cron, `/api/health`, `/status`, `scripts/smoke.mjs`.

## Architecture at a glance

```
                   ┌─────────────────────────────────────────┐
                   │  Vercel (static hosting + serverless)   │
                   │                                         │
  Diner ──QR──▶  /m/:slug (menu.html) ──▶ /api/*             │
                                          (single catch-all  │
                                          dispatcher in      │
                                          api/index.js)      │
                                                             │
  Manager    ──▶  /portal/  (Clerk auth)                     │
  Waiter     ──▶  /staff/   (PIN kiosk + Bearer token)       │
  Kitchen    ──▶  /kitchen/ (PIN kiosk + SSE + Web Push)     │
  Master     ──▶  /admin/   (httpOnly cookie session)        │
                   └─────────────────────────────────────────┘
                                    │
                        ┌───────────┴─────────────┐
                        │                         │
                 Neon Postgres              Cloudflare R2
                 (HTTP driver               (dish images,
                  via @neondatabase          3D models, logos)
                  /serverless)
```

Everything customer-facing runs on Vercel. There is no separate backend
worker — `api/index.js` is the entire API, dispatched to `api/_h/*.js`
handlers on demand (so cold-start stays fast for lightweight routes).

## Directory layout

| Path | What it is |
|---|---|
| `index.html` | Landing page |
| `menu.html`, `view.html`, `dishes.html` | Diner-facing pages |
| `admin/` | Master-admin console (12h httpOnly cookie session) |
| `portal/` | Restaurant-manager portal (Clerk auth) |
| `staff/` | Waiter console (PIN → Bearer token) |
| `kitchen/` | Kitchen board (PIN → Bearer token + SSE + Web Push) |
| `qr-print.html` | Printable QR-code sheets |
| `api/index.js` | Single catch-all dispatcher |
| `api/_h/*.js` | Route handlers, one per URL suffix |
| `api/_db.js` | Neon HTTP client with a supabase-js-shaped shim |
| `api/_auth.js` | Auth helpers (Clerk / admin cookie / staff Bearer) |
| `api/_audit.js` | Audit-log helper |
| `backend/schema.sql` | Full Postgres schema, idempotent |
| `vendor/` | Site-wide client scripts and stylesheets |
| `tests/` | Vitest suites (+ `tests/e2e` Playwright) |
| `scripts/` | lint, syntax-check, html-script-check, smoke, dev-server |
| `.github/workflows/` | ci, e2e, lighthouse |
| `docs/` | Contract docs (e.g. customer-profiles.md) |
| `NOTES_TODO.md` | Living session-to-session task list |
| `POST_LAUNCH_CHECKLIST.md` | What to do to go live with real restaurants |

## Environment variables

Configured in Vercel → Project Settings → Environment Variables.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (`postgres://…`) |
| `ADMIN_SECRET` | Master-admin password (also HMAC-signs the admin cookie) |
| `STAFF_SECRET` | HMAC secret for staff + portal manager tokens |
| `CLERK_SECRET_KEY` | Clerk backend key for `requireManager()` |
| `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_ENDPOINT` + `R2_BUCKET` + `R2_PUBLIC_URL` | Cloudflare R2 uploads |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` | Web Push |
| `CRON_SECRET` *(optional)* | Authorises the daily-summary and backup crons |
| `RESEND_API_KEY` + `RESEND_FROM` *(optional)* | Transactional email (reservation confirmations); silent no-op when unset |
| `PADDLE_API_KEY` + `PADDLE_WEBHOOK_SECRET` + `PADDLE_ENV` + `PADDLE_PRICE_STARTER/PRO/PREMIUM` *(optional)* | Paddle billing |
| `QUOTA_MESHY_PLATFORM_MONTHLY`, `QUOTA_AI_READER_MONTHLY` *(optional)* | Platform-wide usage caps |
| `SENTRY_DSN` *(optional)* | Server + client error reporting; silent no-op when unset |
| `MESHY_API_KEY` *(optional)* | AI 3D-model generation |
| `ANTHROPIC_API_KEY` *(optional)* | AI menu reader / dish description generation |
| `PAYFAST_MERCHANT_ID` + `PAYFAST_MERCHANT_KEY` + `PAYFAST_PASSPHRASE` *(optional)* | Real credit purchases (falls back to WhatsApp otherwise) |

`/api/features` reports which of the optional integrations are configured so
the UI can hide the corresponding admin tabs / CTAs.

## Local dev

```bash
npm install
vercel dev
```

Neon + R2 + Clerk are cloud-only — they run against your dev environment's
values. Nothing pretends to work offline.

Run one-off SQL migrations by pasting `backend/schema.sql` into the Neon
console. The file is idempotent (every `create table` and `create index`
is guarded by `if not exists`).

### Checks and tests

```bash
npm run check          # syntax + html-script + lint + vitest
npm test               # vitest only
node scripts/smoke.mjs # smoke test against a deployed URL
```

After any schema-touching deploy run the admin migration once (admin panel → Run migration).

## Deploy

`git push origin main` triggers a Vercel production deploy. There is no
separate build step.

## Repo conventions

See [`CLAUDE.md`](CLAUDE.md) for the code conventions that hold across
this repo — single-catch-all dispatcher, shim query builder, Postgres
array whitelist, auth boundary, etc.

## License

Private &amp; proprietary. © 2026 ARMenu (Pty) Ltd. All rights reserved.
