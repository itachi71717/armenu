# ARMenu — Full Handover Brief

> **Purpose:** This document briefs a fresh LLM (or human engineer) coming onto the ARMenu codebase. Read this + `CLAUDE.md` + `NOTES_TODO.md` before making any change.

**Last updated:** 2026-09-30
**Repo root:** `C:\Users\Admin\claude\armenu-work\armenu`
**Live URL:** `https://armenu.co.za`
**Current HEAD:** `2a67b21`
**Test count:** 250 vitest + Playwright e2e specs
**Smoke test:** `33/33` passing against production
**GitHub:** `main` in sync with `origin/main`

---

## 1. What ARMenu is

A South African AR-menu SaaS. Restaurants sign up on the platform, add dishes (with 3D GLB models), print QR codes for their tables. Guests scan the QR code with any smartphone → browse the menu → see any dish rendered life-size in AR on their table via WebXR → order from their phone → the kitchen receives the ticket → waiters serve. Everything runs on `armenu.co.za` with per-restaurant slugs (`/m/<slug>`) — no per-restaurant subdomains yet (blocked on wildcard DNS).

---

## 2. Architecture snapshot

- **Frontend:** plain HTML files, **no build step**. Every page loads `vendor/*.js` and `vendor/*.css` shared scripts.
- **API:** single Vercel serverless function at `api/index.js` dispatches to ~90 handlers under `api/_h/`.
  - Global rate limit: 60 req/min per (IP, prefix)
  - Master-admin cookie check + portal-token scope guard for `/admin/*` routes
- **Database:** Neon Postgres (Frankfurt, EU-Central-1) accessed through a **supabase-js-shaped shim** in `api/_db.js` running raw SQL over Neon's HTTP driver.
  - Schema is fully idempotent (`create if not exists` / `alter add column if not exists`)
  - Array columns MUST be whitelisted in `PG_ARRAY_COLS` in `api/_db.js` or inserts silently JSON-stringify and Postgres rejects
- **Storage:** Cloudflare R2 for dish images/GLB models + nightly database backup + guest photo reviews (compressed <200KB)
- **Auth boundaries (four overlapping):**
  - Master admin — signed httpOnly cookie set by `/api/admin/login`, OR legacy `x-admin-secret` header
  - Manager (portal) — Bearer Clerk session token from `/portal/`
  - Manager portal token — short-lived HMAC token issued by `/api/portal/manager-token` for handoff to `/admin/`, `/staff/`, `/kitchen/` without admin password; bound to ONE restaurant
  - Staff kiosk — 4-6 digit PIN → Bearer token from `/api/staff/login`
- **Real-time:** SSE `/api/events` on 5s cadence for staff + kitchen boards (raw COUNT queries only, never full rows). Web Push via VAPID for guests + staff + kitchen.
- **Auditing:** every state-changing admin action calls `auditLog(req, restaurant_id, action, {target?, metadata?})` from `api/_h/_audit.js`. Actor auto-derived from headers.

---

## 3. Repo conventions (from CLAUDE.md — non-negotiable)

**Do NOT:**
- Add per-route Vercel functions (cold start would balloon). Register new routes in `ROUTES` in `api/index.js` and drop the handler at `api/_h/<same-suffix>.js`.
- Stash secrets in localStorage/sessionStorage. Use admin cookie flow or Clerk.
- Skip `auditLog` for admin mutations.
- JSON-stringify arrays before an insert — the shim handles that for whitelisted array columns.
- Fetch full order rows in `/api/events` — raw COUNT only.
- Build UI that assumes SSE/Web Push exist without checking `/api/features` first.

**When you add a route:** register in `ROUTES` in `api/index.js` + create `api/_h/<suffix>.js` with `default export async function handler(req, res)`.

**When you add an array column to schema.sql:** also add its name to `PG_ARRAY_COLS` in `api/_db.js`.

**When you add columns:** never edit the canonical `create table` in place. Use `alter table … add column if not exists` below it, so existing databases pick up the new column on re-run.

---

## 4. Key files to know

| Path | Purpose |
|---|---|
| `CLAUDE.md` | Repo conventions — read FIRST |
| `NOTES_TODO.md` | Living TODO tracker: 🟢 Active / ✅ Shipped / 🟡 Blocked / 🔁 Deferred / Older history |
| `POST_LAUNCH_CHECKLIST.md` | Pre-launch checklist for the owner (env vars, migration, per-restaurant onboarding, monitoring) |
| `README.md` | Architecture snapshot + env-vars table + local-dev + deploy |
| `backend/schema.sql` | Full canonical schema, idempotent, applied via ⚙ Run migration button in admin panel |
| `docs/customer-profiles.md` | Canonical contract for the customer-profile API |
| `api/index.js` | Route dispatcher — every route registered here |
| `api/_db.js` | Postgres shim + `PG_ARRAY_COLS` whitelist |
| `api/_h/_audit.js` | `auditLog()` helper |
| `api/_h/_auth.js` | `requireAdmin`, `requireManager`, `assertScope`, `getScopedRestaurantId` helpers |
| `scripts/smoke.mjs` | 33-check end-to-end smoke test (`node scripts/smoke.mjs`) |
| `scripts/lint.js` | Zero-dep lint (debugger / console.log / FIXME / .only in tests) |
| `scripts/dev-server.js` | Zero-dep local preview server (port 5173, mirrors Vercel rewrites) |
| `scripts/syntax-check.js` | JS syntax check across api/ + scripts/ + tests/ |
| `scripts/html-script-check.js` | Parses every inline `<script>` block in every HTML file |
| `.github/workflows/ci.yml` | CI: syntax + html-script + lint + vitest on push+PR |
| `.github/workflows/e2e.yml` | Playwright e2e on PRs |
| `.github/workflows/lighthouse.yml` | Lighthouse CI on push to main |

---

## 5. Full feature set live now

### 5.1 Guest surface (`menu.html` + `view.html`)

- Cross-restaurant customer profile via localStorage browser token (no login required)
- Profile bottom-sheet (👤): name, phone, email, allergies, dietary prefs, favourites, order history across all restaurants, "🥡 My usual" saved combos, referral share code, delete-my-data
- Phone-collision profile merge across devices
- ♥ heart button per dish → cross-restaurant favourites list
- 🌱 One-tap Vegan mode with 6 dietary filter chips (Vegan / Vegetarian / Halal / GF / Dairy-free / Nut-free)
- 🔄 Order-again pill (shows 20-90min after "served")
- 🔥 Popular / Trending chips (gated ≥20 orders in 7d)
- ⏱ Live wait estimate on cart
- 👥 Live viewer count (only shown when ≥3, privacy-safe)
- 👍/👎 rate dishes 20 min after order + optional photo upload
- 📸 AR scene save-to-camera-roll (from view.html)
- 💬 Live chat with the restaurant (500-char cap, 10/min rate limit, floating button, unread red dot)
- 👥 Group ordering — one guest starts, others join via QR invite, shared cart with "Added by [name]", host places
- 💳 Bring bill button, 🖐 Call waiter button
- Live order status pill: Order received → Kitchen preparing → Ready → Enjoy!
- Cross-restaurant recommendations ("You might like…" strip)
- Advanced fuzzy search with Damerau-Levenshtein typo tolerance (2 edits or 1 for 3-4 char terms)
- 3-dish compare tray, collapsible categories
- Persistent last-order banner + saveable PNG receipt
- Confetti + happy chime on order confirmation
- Auto-detect browser language, apply matching translation from dishes.translations
- PWA install prompt (chip appears after first scroll)
- Service worker offline cache (menu.html network-first, /api/dish + /api/settings SWR, vendor cache-first)
- Skip-to-menu keyboard link
- Barely-there 3-dot first-visit tour (heart → cart → profile)
- Beautiful welcome-back hero with name + visit count + last favourite
- Menu combos strip (🍽) with savings badges

### 5.2 Waiter kiosk (`staff/index.html`)

- Orders view with status transitions (new → prep → ready → served, cancel)
- 🗺 Floor tab — table color heatmap:
  - Green: idle
  - Blue: orders in kitchen
  - Amber: waiter called
  - Red: bill requested
  - Purple: >20min stale
- Tap table → sheet with open calls + orders + Mark bill delivered
- Split-bill v2 (per-item assignment + partial payment)
- ↶ Recall order to kitchen with reason
- 💬 Chats tab with unread badge + chime on new guest message
- RUSH pill in header (scroll-to-oldest-new on tap)
- 44px tap targets, aria-live announcements
- Offline banner when SSE stalls (>15s no tick)
- Audio-context recovery on every chime attempt
- Browser notification fallback
- Tab title unread count + red-dot favicon pulse
- PWA install button

### 5.3 Kitchen board (`kitchen/index.html`)

- Station routing (Hot / Cold / Dessert / Expo) with EXPO gold pill
- Login: restaurant slug + PIN + optional station slug
- Course-grouped tickets (Starters / Mains / Desserts based on dish categories)
- Modifier chips — amber pills, **RED PULSE for "no <x>" and allergies**
- Age color pulses (green <5min → default 5-10 → amber 10-20 → red pulse >20)
- Live MM:SS timer per order (single 1s interval)
- Bump-bar keyboard shortcuts:
  - 1-9: mark item plated
  - Enter: mark order ready
  - Esc: move focus to next order
  - ?: help
- Server-shared plated ticks across tablets (via `order_items.plated_at`)
- Voice announcements toggle ("New order table 5" via speechSynthesis)
- 🔊 Rush banner + faster chime when `orders.rush=true` (auto-set when ≥5 orders in 5min)
- Auto review-request push scheduled 2h after "served"
- Recall highlight + chime + notification
- Offline banner, audio-context recovery, tab title unread count
- PWA install button

### 5.4 Manager portal (`portal/index.html`)

- **Dashboard tiles:** Orders today · Revenue today · Avg prep time (color-coded) · Top dish today
- **🏆 vs South African average:** avg order value + repeat rate percentile ranking
- **📈 Deeper analytics:** 7d/30d/90d revenue SVG chart, day×hour heatmap, dish leaderboard, category performance, cohort retention (weeks 1-3)
- **🗓 Menu heatmap:** GitHub-style calendar of daily orders + dish-launch markers
- **🍳 Kitchen stations** CRUD + Print login-card QR
- **🗓 Staff shifts** — weekly grid Mon-Sun 08-23, add/edit/delete, print white-label (no ARMenu branding)
- **🍲 Prep sheet** — auto-generated from historical order patterns (last 4 weeks same weekday), print white-label
- **🏅 Staff performance** — orders handled, avg time to ready, tips
- **🕐 Menu slots** — time-of-day rotation (breakfast/lunch/dinner auto-flip based on `restaurant_settings.timezone`)
- **🍽 Menu combos** — bundle N dishes at set price with savings badge
- **🎨 4 view-optimized menu templates** — Steakhouse / Italian / Cafe / Pub, each engineered for AOV (sharing starters → mains with tagline → sides → sauces → dessert)
- **👥 Bulk staff CSV** import with BOM strip + PIN conflict handling + role validation
- **Bulk dish CSV** import + bulk price update + duplicate dish
- **🖼 Photo review moderation** — Approve / Reject queue for guest-uploaded dish photos
- **🎁 Loyalty program** — opt-in per restaurant (default OFF), free-dish reward (restaurant picks which dish, not cash)
- **🚦 Waitlist toggle** + "Restaurant is full" mode
- **🔍 Menu preview** before publish (portal token + `?preview=1`)
- **📧 Daily takings email** — 10pm SAST cron, opt-in per restaurant via `restaurant_settings.daily_summary_enabled`
- **Command palette (Ctrl+K)** with 20+ commands
- **Onboarding wizard** for new restaurants (3 steps, first-visit only, only fires when restaurant has 0 dishes)
- **PWA install button**
- **Notification badges** on nav (new orders, unresponded calls, waitlist, reviews) — polls `/api/portal/badges` every 30s

### 5.5 Master admin (`admin/index.html`)

- Clients / Pending sign-ups / Add restaurant / Add dish / Audit log
- **⚙ Run migration** — one-click DB schema apply from browser (uses admin cookie, no secret to paste)
- **🔁 Duplicate restaurant** per row — clones structure only (categories, dishes, tables, stations, slots, combos, offers), does NOT copy orders/customers/staff/audit/reviews
- **Notification badges** — pending signups, activity spikes (>10 audit events/hour), health dot (green/amber based on audit_log %error%/%fail% in last hour)
- **PWA install button**
- Full audit log with actor/action/target/metadata/IP filters + cursor pagination

### 5.6 Public / SEO

- `/discover` — every active restaurant browseable with search + city + cuisine filters + 🆕 badge + price range + ratings
- `/status` — public system health page (API / DB / R2 / SSE / Push components + 24h uptime)
- Dynamic `/sitemap.xml`
- Per-restaurant OG images (SVG-generated per slug via `/api/og?r=<slug>`)
- JSON-LD Restaurant schema on menus
- Prefetch-on-hover for menu links (index.html + discover.html)

### 5.7 Reliability + security

- **250 vitest tests** + Playwright e2e specs + Lighthouse CI
- **CSP + security headers** site-wide (X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy, Permissions-Policy)
- **Robots.txt** — allow marketing/discover/m/, disallow admin/portal/staff/kitchen/api/vendor
- **Nightly R2 database backup** (03:00 UTC cron, JSONL.gz per table)
- **Server-side image compression** on manager uploads via sharp
- **Zero-dep lint script** in CI
- **Better error boundary** with retry button (`vendor/armenu-errorbar.js`)
- **Rate-limited** 60/min per (IP, prefix) — in-memory per-instance
- **Sentry-ready** (silent no-op until `SENTRY_DSN` set)
- **XSS-safe** — `escapeHTML` called on every user-controlled render path (audited)
- **SQL injection safe** — all parameterized via shim
- **Tenant isolation audited** — every admin/staff handler scope-guarded via `assertScope`
- **QR audit** — all slug interpolations `encodeURIComponent`-safe

---

## 6. Environment variables

### Required (already set)
- `DATABASE_URL` — Neon Postgres connection string
- `ADMIN_SECRET` — master admin cookie signing key
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`, `R2_ENDPOINT`, `R2_BUCKET`

### Optional (silent no-op until set)
- `SENTRY_DSN` — error monitoring **(owner declined)**
- `MESHY_API_KEY` — AI 3D model generation **(owner adding next week)**
- `ANTHROPIC_API_KEY` — AI menu reader + translate **(owner declined)**
- `PADDLE_API_KEY` / PayFast credentials — real payment integration **(owner sorting)**
- `UPSTASH_REDIS_URL` — distributed rate limiter (free tier exists)
- `RESEND_API_KEY` — transactional email (reservation confirmations)
- `CRON_SECRET` — for daily-summary + nightly-backup crons
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — Web Push
- `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` — portal auth

---

## 7. Pending DB migration

**One click:** open `https://armenu.co.za/admin/` → sidebar **⚙ Run migration** → **Apply schema.sql →**

Adds every column from every batch. Idempotent, safe to run any time. Currently missing on live DB (as of 2026-09-30):
- `chat_threads`, `chat_messages` (round 9)
- `group_orders`, `group_order_participants`, `orders.group_order_id`, `order_items.added_by_customer_id` (round 9)
- `menu_slots`, `dishes.menu_slot_id` (round 9)
- `customer_dish_ratings.photo_url`, `photo_approved` (round 9)
- Plus everything from prior batches if never run: `customers`, `customer_favourites`, `customer_saved_combos`, `customer_dish_ratings`, `customer_views`, `customer_cart_abandonments`, `menu_presence`, `loyalty_stamps`, `combos`, `waitlist_entries`, `kitchen_stations`, `shifts`, `restaurant_settings.*` new columns, `orders.*` new columns, etc.

---

## 8. Batch history (chronological, all shipped + live)

| Commit | Batch | What |
|---|---|---|
| earlier | Customer profiles v1 | Cross-restaurant token identity + favourites + profile sheet |
| earlier | Kitchen multi-screen | Stations, station routing, rush mode, recall, age colors, bump-bar |
| earlier | UX batch 3 | Reorder, popularity, wait estimate, dish ratings, table heatmap, live dashboard, course grouping, offline cache |
| earlier | Ops batch | Kitchen resilience, menu perf, guest confirmation, onboarding wizard, delete-my-data |
| earlier | Big batch | Recs + shifts + prep sheet + analytics + guest polish + status/SEO + kitchen PWA/voice |
| earlier | Growth batch | PWA installs + discover + loyalty + combos + waitlist + test coverage |
| `d514e0b` | Zero-bug | Marketing chrome consistency, loyalty→dish+opt-in, "My usual", 11+ e2e bugs fixed |
| `e642640` | Feature mega | Peer benchmarks, auto review push, live viewers, bulk CSV, menu templates, staff perf, live status, welcome-back, AR save, vegan mode, order-again, onboarding, Playwright, R2 backup |
| `bf67410` | Followup | Inventory countdown, reservation capacity foundation, CSP, guest PWA, badges, i18n, a11y sweep, docs |
| `cbcfb68` | Round 9 partial | Chat + landing hero rebuild + backend handlers for group-order, menu-slots, bulk-staff, duplicate-restaurant, menu-heatmap, dish-photo |
| `2a67b21` | Round 9 finish | Group ordering UI, menu-slots UI, bulk staff UI, duplicate restaurant UI, fuzzy search, photo review moderation, QR + tenant isolation audit |

---

## 9. Deferred / skipped features

- **Chain billing model** — business decision, owner will charge per branch; duplicate-restaurant makes chain onboarding trivial
- **Gift vouchers** — owner declined
- **Newsletter signup on landing** — owner declined
- **Case study pages** — owner declined
- **Menu bookmarking** — owner unsure
- **Reservation capacity UI** — foundation shipped and gated OFF via `restaurant_settings.capacity_preview_enabled`; flip to true when ready
- **Dish variants (Small/Large on same card)** — owner was torn on AR compatibility; skipped
- **Auto-close menu at closing time** — removed at owner's request (restaurants may want after-hours specials)
- **Custom logo QR endpoint** (`api/_h/qr.js`) — deferred; `qr-print.html` still generates client-side QR via `qrcode.min.js`
- **Guest photo social wall** — owner mentioned as idea, not yet built (photos currently surface on dish cards after moderation)
- **Group ordering combos** — combos refused in group cart with toast (server endpoint only accepts `dish_slug`)

---

## 10. Cloud routine

- **`trig_0178Tk4Z5oazSa3miPNEQpVM`** — silent uptime probe every 5h, curls 7 critical endpoints, only pushes a phone notification if something breaks. This runs in Anthropic's cloud infrastructure, not on the user's machine.

---

## 11. How to work on this codebase

### First session steps
1. Read `CLAUDE.md` (repo conventions — hard rules)
2. Read `NOTES_TODO.md` (current state)
3. Read this `HANDOVER.md` (feature snapshot)
4. Run `npm run check` to confirm 250 tests pass
5. Run `node scripts/smoke.mjs` to confirm 33/33 against production
6. Check `git status` and `git log --oneline -5`

### When adding a feature
1. Register route in `api/index.js` `ROUTES` map
2. Create handler at `api/_h/<suffix>.js` with `default export async function handler(req, res)`
3. Add scope guard (`requireAdmin` / `assertScope`) if it's an admin route
4. Call `auditLog` if it mutates state
5. If adding a column: append idempotent `alter table … add column if not exists` at BOTTOM of `backend/schema.sql`. Never edit the canonical `create table` in place.
6. If adding an array column: also add to `PG_ARRAY_COLS` in `api/_db.js`
7. Add vitest tests in `tests/`
8. Run `npm run check` — must pass
9. Commit + push
10. `vercel --prod --yes` from repo root
11. `node scripts/smoke.mjs` to confirm production is healthy
12. Update `NOTES_TODO.md` "Shipped this cycle" section
13. If schema changed: remind owner to run migration via admin panel

### When editing an HTML page
- `escapeHTML()` every user-controlled string before `innerHTML`
- Preserve every existing element id/function name JS depends on
- Test locally with `preview_start` and the built-in browser tools
- Run `node --experimental-vm-modules scripts/html-script-check.js` — must pass

### When adding an animation or motion effect
- Guard with `@media (prefers-reduced-motion: reduce)` OR check `matchMedia('(prefers-reduced-motion: reduce)').matches` in JS
- Use GPU-composited properties only (`transform`, `opacity`)
- Never use scroll handlers that mutate CSS transforms — causes jerk (see the hero rebuild in round 9)

### When deploying
- Vercel auto-deploys from GitHub `main` push
- OR run `vercel --prod --yes` manually from repo root
- Always run `node scripts/smoke.mjs` after deploy
- Check `vercel ls --prod` to confirm status Ready

---

## 12. Owner context

- **Name:** Ian
- **Location:** South Africa (Johannesburg / Cape Town / Durban)
- **Domain:** armenu.co.za
- **Goal:** ship ARMenu commercially to SA restaurants, monetize with tiered pricing (still TBD — current /plans tiers are placeholders)
- **Cost sensitivity:** high — declined Sentry, Anthropic, will only add Meshy after being paid; not willing to pay for anything unnecessary
- **Preference:** "smooth experience" — every guest-facing interaction should feel weightless
- **Data monetization interest:** wants to capture as much data as possible for later resale (guest behavior, popular dishes, cross-restaurant patterns). Analytics endpoints exist, benchmarks endpoint exists, customer profile with cross-restaurant tracking is live.
- **Compliance:** POPI (South Africa) compliant. Cookie banner exists, delete-my-data endpoint exists (`/api/customer/me` DELETE), privacy policy at `/legal` names ARMenu as data controller for platform data and restaurants as processors for diner data.

---

## 13. Current state summary

- **GitHub `main`:** in sync with `origin/main`, HEAD `2a67b21`
- **Vercel prod:** Ready
- **Smoke test:** 33/33 pass against `https://armenu.co.za`
- **Test suite:** 250 vitest tests pass + Playwright e2e specs
- **Lint:** clean
- **Working tree:** clean (or contains this HANDOVER.md as a new file, depending on when you read it)

---

**End of brief.** For anything unclear, read the referenced file directly. When in doubt, `CLAUDE.md` is authoritative on conventions and `NOTES_TODO.md` is authoritative on state.
