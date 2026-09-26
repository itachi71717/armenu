# CLAUDE.md — Working on ARMenu

Repo-specific conventions. Read this before making changes so you don't
fight the existing design.

## The API is one file with 60+ handlers

Every request goes through `api/index.js` — a single catch-all serverless
function. It reads `req.query.path` (or the URL suffix) against a `ROUTES`
map and dynamically imports the matching handler from `api/_h/…`. The
dispatcher also runs:

- Global rate limit (60 req/min per IP × top-level prefix)
- Master-admin cookie/header check for anything under `admin/`
- Portal-token scope guard: a manager's `portal_token` is bound to ONE
  restaurant, so any admin route that names a `slug` (or POST body
  `restaurant_slug`) is refused when it doesn't match

**When you add a route:** register it in `ROUTES` in `api/index.js` and drop
the handler at `api/_h/<same-suffix>.js` with a `default export` of
`async function handler(req, res)`. Do NOT create per-route Vercel
functions — cold-start would balloon.

## The DB client is a shim, not real supabase-js

`api/_db.js` exports `supabase` / `supabaseAdmin` with a supabase-js-shaped
surface (`.from(t).select().eq().maybeSingle()`) but under the hood it
compiles to raw SQL and runs through Neon's HTTP driver. Not everything
real supabase-js does is implemented. Key rules:

- **Postgres arrays are whitelisted.** `PG_ARRAY_COLS` in `api/_db.js`
  lists every column typed `text[]` / `int[]` / `uuid[]`. If you add a
  new array column, add it here or inserts will silently JSON-stringify
  the array and Postgres will reject the row.
- **Raw SQL escape hatch.** For anything the shim can't express (COUNT,
  window functions, UPDATE ... FROM), use `supabase.raw('select …', [args])`.
- **Upsert with no onConflict** now emits `ON CONFLICT DO NOTHING`.
- **Thenable chains** return the promise (`.then().catch()` works),
  `.finally()` is supported.

## Auth has three overlapping boundaries

- **Master admin** — signed httpOnly cookie set by `/api/admin/login`,
  or the legacy `x-admin-secret` header (kept for backward compat).
  Full org-wide access.
- **Manager (portal)** — Bearer Clerk session token from `/portal/`.
  `requireManager(req)` returns `{ email, userId }`.
  A manager owns any restaurant whose `restaurants.email` matches theirs
  AND any restaurant they've been invited to via `manager_users`.
- **Manager portal token** — short-lived HMAC token issued by
  `/api/portal/manager-token` so the manager can hand off into
  `/admin/`, `/staff/`, `/kitchen/` without an admin password.
  Bound to one restaurant.
- **Staff kiosk** — 4–6 digit PIN → Bearer token from `/api/staff/login`.

**The scope guard in `api/index.js` is authoritative.** If you skip it in a
new admin handler, a manager could touch a restaurant that isn't theirs.

## SSE / Web Push

- `/api/events` is the SSE endpoint for the staff + kitchen boards. It
  runs raw COUNT queries against `orders` and `waiter_calls` on a 5s
  cadence — do not pull full rows.
- `sendPush(restaurant_id, payload, {role_filter?})` in
  `api/_h/push/_send.js` is a no-op when VAPID is unconfigured. Dead
  endpoints (404/410) are silently deactivated; other failures are
  reported to Sentry.

## Frontend conventions

- **No build step.** Every page is a plain `.html` file. Shared scripts
  live in `vendor/` and are loaded with `<script defer>` /
  `<link rel="stylesheet">`.
- **`vendor/armenu-a11y.css`** loads on every page and provides
  `:focus-visible` outlines, reduced-motion honouring, `.empty-state`,
  `.sk-line/.sk-card` skeleton helpers, `.btn-spinner`.
- **Marketing chrome** (`vendor/marketing-chrome.js`) hydrates
  `<div id="mkNav">` and `<div id="mkFooter">` placeholders so nav
  changes are single-source.
- **Sentry** loads only when the user hasn't chosen "essential only" in
  the cookie banner (`localStorage.armenu_cookie_consent_v1`).
- **Cart** in `menu.html` is keyed per `(restaurant slug + table)` and
  wrapped in `{ ts, items }` with a 24h expiry.

## Auditing

Every state-changing admin action calls
`auditLog(req, restaurant_id, action, { target?, metadata? })` from
`api/_h/_audit.js`. Actor is auto-derived from headers (admin cookie /
portal token / staff token). Viewable at `/admin/ → Audit log`.

## Schema

`backend/schema.sql` is idempotent. Adding a table? Guard with
`create table if not exists`. Adding a column to an existing table?
Use an `alter table … add column if not exists` block below the
canonical `create table` — don't edit the create in-place, or existing
databases won't pick up the new column on re-run.

## Do not

- Do not add per-route Vercel functions.
- Do not stash secrets in `localStorage` / `sessionStorage` — use the
  admin cookie flow or Clerk.
- Do not skip `auditLog` for admin mutations.
- Do not JSON-stringify arrays before an insert — the shim handles that
  for whitelisted array columns.
- Do not fetch full order rows in `/api/events` — raw COUNT only.
- Do not build UI that assumes SSE/Web Push exist without checking
  `/api/features` first.

## Where the living TODO lives

`NOTES_TODO.md`. Update it at the end of every session so the next one
(or the every-4h30 cloud routine) knows where to pick up.
