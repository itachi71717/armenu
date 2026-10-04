# ARMenu — Live TODO tracker

Maintained by Claude across sessions. Update after every completed item.
Sections 1-4 are the current state; everything older is preserved under "Older history" at the bottom.

## 🟢 Active
- Nothing in flight.
- **All unblocked candidates resolved** (2026-10-04 session):
  - ✅ `.sk-line/.empty-state` sweep — discover.html empty/error states now `.empty-state`; admin/restaurant.html branding tab disables inputs while loading; portal modal list containers already had skeletons from prior session.
  - ✅ Audit-log server-side pagination — already fully implemented (cursor `before`/`has_more`/`next_before` in audit.js + admin UI).
  - ✅ `manager_users` owner backfill guard — already guarded in schema.sql.
  - ✅ Perf: menu-slots GET 3 sequential queries → `Promise.all`; duplicate-restaurant 2 slug lookups → `Promise.all`.
  - ⚠️ Drop legacy `x-admin-secret` header — still deferred: NOTES_TODO migration curl commands reference it; only safe to drop once Ian confirms no aliases use it.
- Requires a one-off DB migration after each schema-touching deploy: admin panel → ⚙ Run migration (or `POST /api/admin/migrate` with `x-admin-secret`).

## ✅ Shipped this cycle (2026-09-28/29)
_Hashes only where recorded; Big/Growth/Zero-bug/Feature-mega summaries are inferred from repo tests, workflows and crons, so correct them if wrong._
- **Customer profiles v1** (78eb527) — `customers` + `customer_favourites`, cross-restaurant browser token, favourites/allergies/dietary prefs, phone-match merge, delete-my-data. Contract: docs/customer-profiles.md.
- **Kitchen multi-screen** (80923ee) — `kitchen_stations`, station-scoped staff tokens + EXPO, auto-rush, bump-bar shortcuts, recall with reason, portal stations modal.
- **UX batch 3** (27623db) — guest reorder/trending/wait estimate/dish ratings, waiter Floor tab + Bring-bill, manager live dashboard, kitchen course grouping + modifier chips, service-worker caching.
- **Ops batch** (2473499) — kitchen offline banner/notification fallbacks, menu perf (preconnect, lazy .glb), last-order banner + save-to-phone, portal onboarding wizard, POPI wording + delete-my-data.
- **Big batch** (hash n/a) — batch 2 follow-through: skeleton loaders, server-side plated ticks, manager roles, split-bill v2, lint in CI (see Batch 2 in history: 2faa68b + 5829f86) and UI overhaul (f5ce8de) with ArmenuFX + Ctrl+K palette.
- **Growth batch** (hash n/a) — loyalty and referral on orders, waitlist and opening hours, shifts (covered by order-loyalty-referral, waitlist-and-hours, shifts tests).
- **Zero-bug batch** (hash n/a) — cross-tenant scope guards, XSS escape sweep in admin renders, DB error-shape fixes, waiter-call and plated scope tests.
- **Feature mega batch** (hash n/a) — combos, station routing polish, order idempotency, customer token validation, rate limiter, migrate split, Lighthouse CI + Playwright e2e workflows, nightly R2 backup cron and daily-summary cron.
- **Followup batch** (this one, uncommitted) — NOTES_TODO restructure, README architecture refresh, POST_LAUNCH_CHECKLIST.md.

## 🟡 Blocked on Ian
- **Sentry DSN** → `SENTRY_DSN` (wired, silent no-op until set)
- **Meshy** → `MESHY_API_KEY` (unlocks AI 3D generation; pick a plan)
- **Anthropic** → `ANTHROPIC_API_KEY` (AI menu reader + translate)
- **PayFast / Paddle** → merchant sign-up + `PAYFAST_*` or `PADDLE_*` (credit purchases currently fall back to WhatsApp)
- **Upstash** → `UPSTASH_REDIS_URL` (replace per-instance in-memory rate limiter)
- **Wildcard DNS** `*.armenu.co.za` (needs registrar; unlocks per-restaurant custom domains — middleware already supports it)

## 🔁 Deferred / Revisit later
- **Reservations capacity preview UI** — foundation shipped but off. Show "3 tables available" / near-capacity per slot; wait to see whether reservations get any use first.
- **Pricing page rework** — /plans has placeholder R499/R1499/Custom tiers Ian is not going with. Revisit once the pricing model is settled.
- **Group ordering** — several diners adding to one shared table cart.
- **Multi-location for chains** — proper chain HQ view (today: one manager can own several restaurants; HQ default token picks alphabetically first).
- **Digital tip splitter** — split pooled tips across staff.
- Also parked: credit-pack pricing review, Sentry vs alternative, Paddle vs Peach vs Stripe, real business email.

---

## Older history
_Everything below is the previous file content, kept verbatim (its original title and top sections are demoted here)._


## ✅ Just shipped
Latest batches (details in the dated sections below where recorded):
- Customer profiles v1
- Kitchen multi-screen
- UX batch 3
- Ops batch
- Big batch
- Growth batch
- Zero-bug batch

## 🔁 Revisit later (added 2026-09-29; older items remain in the "Revisit later" section further down)
- **Reservations + capacity preview** — Ian wants the reservation modal to show "3 tables available" / "🔴 near capacity" per slot before booking. Concept is clear, but he wants to see whether the existing reservation flow gets any use first before building on top. Data source: reservations table + restaurant_tables count + 90-min window overlap math. No QR-code dependency.
- **Pricing page rework** — /plans currently has R499/R1499/Custom placeholder tiers. Ian is not going with this pricing. Revisit when he settles on the actual pricing model.

## ✅ 2026-09-28 — UX batch 3 (commit 27623db — deployed, smoke 33/33)
**Guest (menu.html):**
- 🔄 Reorder past order — one-tap re-add from profile order-history
- 🔥 Popular / Trending chips (score>=70 / 90) on dishes, gated on 20+ orders in 7d
- ⏱ Live wait estimate chip on cart (median served-at minus placed-at, queue depth)
- 👍/👎 Rate dishes 20+ minutes after order, remembered per-order in localStorage
- New table customer_dish_ratings + /api/customer/rate-dish
**Waiter (staff/index.html):**
- 🗺 Floor tab — table grid color-coded (green idle / blue orders / amber called / red bill / purple >20m stale)
- Tap table → sheet with open calls + orders + Mark bill delivered
- Guest 💳 Bring bill button on menu.html (disabled until order placed)
- waiter_calls.type column (backward compat: reason='bill' still works)
**Manager (portal/index.html):**
- Live "today" dashboard — orders/revenue/avg prep time/top dish (color-coded)
- 🔥 Trending ticker
- Red slow-kitchen banner when avg prep >= 30min
- Timezone-aware via restaurant_settings.timezone (default Africa/Johannesburg)
- Polls /api/admin/live every 45s, skips while tab hidden
**Kitchen (kitchen/index.html + staff/orders.js):**
- Course grouping — Starters / Mains / Desserts on each ticket (staff/orders.js attaches category since staff token can't hit admin)
- Modifier chips — amber pills, RED PULSE for "no <x>" and allergies
**Reliability (sw.js):**
- Service worker: menu.html network-first, /api/dish + /api/settings SWR, vendor/* cache-first, R2 images network-first with fallback

## ✅ 2026-09-28 — Kitchen multi-screen (commit 80923ee — deployed, smoke 33/33)
- kitchen_stations table + dishes.station_id + orders.rush + order_items.recalled_at/recall_reason
- /api/admin/kitchen-stations CRUD (scope-guarded + audit-logged)
- Staff login accepts station_slug, encodes station_id + is_expo in token
- Station filter on GET /staff/orders (non-expo tokens see mine:true items only)
- Auto-rush flag when 5+ orders in 5min
- Kitchen: station chip + EXPO pill in header, age colors (green→amber→red pulse), MM:SS live timer, bump-bar shortcuts (1-9/Enter/Esc/?), RUSH banner + faster chime, recall highlight
- Portal: 🍳 Kitchen stations modal (Hot/Cold/Dessert/Expo seed), Station dropdown in dish editor, Print login card → QR
- Staff: recall action on served/ready orders with reason
- 89 tests total

## ✅ 2026-09-28 — Ops batch (commit 2473499 — deployed to prod, smoke 33/33)
**Kitchen/staff resilience:**
- Offline banner when SSE/poll stalls >15s (heartbeat every 5s)
- audioContext.state=='suspended' recovery on every chime attempt
- Browser Notification fallback (permission asked on PIN entry)
- Tab title unread count + red-dot favicon pulse when tab unfocused
**Menu perf:**
- <link rel=preconnect> to R2 CDN in menu+view heads
- First 4 dish thumbs eager+high fetchpriority; rest lazy+low
- view.html model-viewer reveal=manual — .glb only fetched when AR tapped (huge 3G win)
**Guest flow:**
- Persistent last-order banner on menu (2h expiry) → full order sheet
- Post-order confirmation panel: order number + Save-to-phone canvas PNG
- Order history in profile sheet (recent_orders added to GET /customer/me)
**Portal:**
- Onboarding wizard (#onboardWiz, distinct from #wizOverlay) — 3 steps: add first dish → print QR → test — only fires when restaurant has 0 dishes and 'armenu_portal_onboarded' flag missing
**POPI:**
- legal.html §2 clarified: ARMenu is controller of manager/staff/billing; restaurants are controllers of diner data per §5 DPA
- 'Delete my data' link at bottom of profile sheet → DELETE /customer/me + regen token

## ✅ 2026-09-28 — Customer profiles v1 (commit 78eb527 — deployed to prod, smoke 33/33)
- New tables: `customers` (token, name, phone, email, allergies[], dietary_prefs[], merged_into), `customer_favourites` (unique customer_id+dish_id)
- `orders.customer_id` FK — silently attached when guest sends `customer_token` in /api/order body (backward compat, no token = null)
- 4 new API routes: POST /customer/hello (upsert by token), GET+PATCH+DELETE /customer/me (with phone-collision merge), POST /customer/favourite (toggle)
- Cross-restaurant: the browser token works at every ARMenu restaurant — favourites, allergies, dietary prefs follow the guest
- Merge on phone match: favourites re-pointed, orders re-pointed, old row tombstoned via merged_into (bounded 5-hop resolver so no infinite loops)
- menu.html: ♥ heart button on every dish (top-left, avoids AR tag), 👤 profile button in header → bottom sheet (name/phone/email/allergy chip input/dietary toggles/favourites list). Allergy nudge on add-to-cart via ArmenuFX.toast.
- view.html: heart button next to AR/add-to-cart, same optimistic toggle
- Contract doc: docs/customer-profiles.md
- 19 new tests (customer-hello, customer-favourite, customer-merge) → 82 total
- ⚠️ Requires DB migration: `curl -X POST -H "x-admin-secret: <yours>" https://armenu.co.za/api/admin/migrate` — until then /customer/hello returns "Could not create customer"

## ✅ 2026-09-28 — Batch 2 (commits 2faa68b + 5829f86 — deployed to prod, smoke 33/33)
- Skeleton loaders (.sk-line/.sk-card/.btn-spinner) on portal/admin/staff/kitchen
- .empty-state adopted on kitchen board (matches other surfaces)
- Kitchen 'plated' ticks now server-side (order_items.plated_at) — synced across tablets, localStorage fallback for mid-deploy
- manager_users.role (owner|manager|viewer) + partial unique index; transfer.js keeps manager_users in sync
- Staff split-bill v2: per-item assignment + partial paid_cents tracking (keeps even-split MVP)
- Staff+kitchen kiosks: ArmenuFX toasts + minimal Ctrl+K palette (skipped on touch-only)
- XSS fix: paid_by label escapeHTML'd in split renderer
- Audit log `has_more` bug when q-filter used → over-fetches now
- Zero-dep lint (`scripts/lint.js`) added to `npm run check` + CI
- 63 tests total (was 47)
- ⚠️ Requires DB migration: `curl -X POST -H "x-admin-secret: <yours>" https://armenu.co.za/api/admin/migrate` to add order_items.plated_at/paid_by/paid_at + orders.paid_cents + manager_users.role
- Follow-up risks flagged by verifier: (1) manager_users owner backfill re-scans on every deploy — worth a guard once restaurants table gets large; (2) kitchen plated fallback only triggers on 404/501, not on 500; (3) no server-side check that split-bill paid_cents ≤ total_cents (cosmetic only)

## ✅ 2026-09-28 — UI overhaul (commit f5ce8de — deployed to prod, smoke 33/33)
- New `vendor/armenu-fx.{js,css}` (data-fx="spotlight|shiny|reveal|countup|magnetic|tilt", ArmenuFX.scan/toast) and `vendor/armenu-cmdk.js` (Ctrl+K palette, wired on portal + admin).
- Guest menu/view: brand accent vars end to end, 44px tap targets, skeletons, retry on error. Marketing: lazy images + effects. Operator: Esc closes modals, typed-confirm delete.
- Backend: admin cookie accepted by admin/clients, audit actor from cookie, waiter-calls PATCH scope guard, staff order insert error handling. 47 tests pass.
- Open follow-ups: staff + kitchen have no FX/cmdk (fine for kiosks); kitchen "plated" ticks are per-device only; portal wizard doesn't close on backdrop click; admin/audit `has_more` under-reports when `q` filter used.

## ✅ Just completed
- **[1] R2 bucket CORS** — Policy set via Cloudflare dashboard. Origins: armenu.co.za, *.armenu.co.za, localhost:3000. Methods: GET/PUT/POST/HEAD/DELETE. Manager uploads from browser now work end-to-end.
- **[2] Sentry error monitoring** — Server + client SDKs wired. Loader injected into 16 HTML pages. Silent no-op until Ian pastes SENTRY_DSN into Vercel env. Client filters to first-party errors only.
- **[3] Usage cost caps — REBUILT as credit system per Ian's ask** — mirrors Meshy's 10-credits-per-generation model 1:1. `dishes.meshy_credits` column + `credit_transactions` audit log. New helpers: `enforceCredits`, `consumeCredits`, `grantCredits`. Every new restaurant starts with 100 free credits (10 dishes). Retries are FREE (matching Meshy's retry policy). When balance runs out, ai-generate returns HTTP 402 with balance/needed info so the client shows a "buy credits" CTA. Platform safety cap kept as backstop (2000 generations/month org-wide, tunable). NEW endpoint /api/portal/credits (GET balance + packs + recent, POST creates checkout). Portal has a live credit pill in nav that opens a modal with three retail packs (R149/50, R499/200, R1999/1000) and recent activity. Paddle checkout is stubbed until PADDLE_API_KEY is set — falls back to a WhatsApp "buy" link so managers can top up manually today.
- **[4] Cookie consent banner** — `/vendor/cookie-consent.js` injected on all 16 pages. POPI + GDPR-compliant, remembers choice in localStorage, dispatches `armenu:consent` event for future analytics scripts. Two options: Essential only / Accept all. Zero third-party dependencies.

## 🟡 Deferred
- **[5] Real business email** — deferred by Ian (do last)

## 🔁 Revisit later
- **Costing structure / credit-pack pricing** — Ian to revisit once first paying restaurants land. Current retail: R149/50, R499/200, R1999/1000 (5-9x markup over ~R3.20 Meshy Pro cost/generation). Also revisit: monthly-subscription bundle vs pay-as-you-go, volume discount ladder, gifted onboarding credits (currently 100), free-retry-count (currently 4/task matching Meshy Pro).
- **Sentry vs alternative** — Ian may pick Datadog, LogRocket, or nothing. Wired to auto-activate when SENTRY_DSN is set.
- **Paddle vs Peach Payments vs Stripe** — currently Paddle-shaped stubs. Swap in whichever Ian picks. Peach is often better for SA-only businesses.

## ✅ Session A complete (checkpoint)
- **[A1] Cart persistence** — menu.html saves cart to localStorage per (restaurant + table) so page refresh / rotate / phone-yank doesn't wipe it. Loads on init. Cleared on successful order.
- **[A2] Tip button** — Cart sheet has No tip / 10% / 15% / 20% pills (default 10%). Tip flows through /api/order as tip_cents; total = subtotal + tip. Cap R500. New orders.tip_cents column.
- **[A3] Item modifiers** — dishes.modifiers jsonb column. Portal dish editor has a plain-text modifier editor (Cook * → Rare +0 / Medium +0 syntax with * = required, [multi] = checkboxes). Guest sees a modifier picker sheet before adding a dish that has modifiers. Order snapshots picked modifiers + adjusts price. Sanitised server-side (cap 12 mods, cap delta ±R500).
- **[A4] Offer edit + active toggle** — Offer rows now have Edit / Tag dishes / ▶Resume-⏸Pause / Delete buttons. Edit modal patches name/times/pct/days. Toggle patches active bool. Paused offers show as dimmed with "paused" chip and don't apply discount on /api/dish.
- **[A5] Drag-reorder** — Categories modal rows are draggable with a ≡ handle. New /api/admin/categories/reorder and /api/admin/dishes/reorder endpoints rewrite sort_order sequentially. /api/dish list orders by sort_order then name.

## ✅ Session B — what I could do without your keys (checkpoint)
- **[B1] Health check /api/health** — public endpoint returns {ok, db_ok, db_ms, region, timestamp}. 200 when DB reachable, 503 when not. Perfect for UptimeRobot / BetterUptime — sign up at uptimerobot.com, add a monitor for https://armenu.co.za/api/health, done.
- **[B2] Terms + Privacy full rewrite** — /legal now has a proper POPI Act + GDPR-compliant Terms of Service, Privacy Policy (with 8 named sub-sections covering what/why/where/how-long/rights/security/children/officer), Cookies, Refunds, and Restaurant Data-Processing Agreement. Ready to point paying restaurants at.

## Still blocked on Ian (can't be done from my side)
- **[B-blocked] PayFast** — needs merchant sign-up + PAYFAST_MERCHANT_ID / KEY / PASSPHRASE
- **[B-blocked] Sentry** — needs SENTRY_DSN

## ✅ Session C — what I could do without your keys (checkpoint)
- **[C1] PWA install** — /manifest.json + rel=manifest linked on 8 core pages. Diners get "Add to home screen" prompts; kitchen/staff can install as standalone apps. Includes shortcut list for Portal / Kitchen / Staff.
- **[C2] Kiosk idle timeout** — staff + kitchen auto-signout after 12h idle (any pointer/keyboard/touch resets). Prevents an unattended tablet from leaking data.
- **[C3] Audit log** — new audit_log table + auditLog(req, rid, action, {target, metadata}) helper. Wired into dish create/update/delete. Actor auto-derived from token headers (admin / manager:<rid> / staff:<id>). New /api/admin/audit endpoint returns last 100 events, scoped or platform-wide.
- **[C4] Favicon per restaurant** — menu.html now swaps the ARMenu favicon for the restaurant's logo on branded menu pages. Also generates a dynamic PWA manifest so "Add to home screen" uses the restaurant's name + logo (not ARMenu's). Page title updates to "<Restaurant> · Menu".

## Still blocked (Session C bits needing external accounts)
- **Redis rate limiter** — needs Upstash sign-up + UPSTASH_REDIS_URL. Current in-memory limiter still works, just per-instance.
- **Custom domain per restaurant** (e.g. menu.oceanbasket.co.za) — needs wildcard DNS first, then per-restaurant DNS record + Vercel domain add. Middleware code already supports subdomain routing.

## ✅ Batch 4 — cleaning up all remaining unblocked work (checkpoint)
- **Audit log fully wired** — added to settings, offers, categories, tables, staff, schedules, reservations (was only dishes before). Every mutation now leaves an actor-attributed trail in audit_log.
- **Push opt-in on kitchen + staff kiosks** — shared vendor/push-optin.js injected into both, appears 6s after page load if the tablet is signed in and hasn't been prompted.
- **Push test-send button** — new /api/admin/push-test endpoint + "🔔 Send test" button in the portal Credits modal ("Notifications working?" section). Fires a test push to every subscription for that restaurant, reports how many devices received it.
- **Reservation slot capacity** — /api/reservation now rejects bookings when a 90-min window around the requested time already has ≥ restaurant table count of pending/confirmed reservations. Falls back to a generous 20-slot default when no tables are configured. Returns 409 slot_full with a friendly message.
- **Multi-currency toggle for tourists** — guest menu header shows a currency pill (ZAR default) that cycles ZAR → USD → EUR → GBP → AUD. Prices convert on the fly using quarterly-refreshed FX rates. Charging stays in ZAR — a toast reminds the guest they'll be billed in ZAR. Choice remembered in localStorage per device.

## Explained "customer profiles" business model to Ian (deferred by him)
- Recognition via WhatsApp identity (best UX for SA), phone OTP, or passive browser token
- Profile stores favourites, allergies, party size, spend history
- Network effect: profile works across every ARMenu restaurant → defensive moat
- Revenue: promoted dishes, cross-restaurant benchmarks, WhatsApp campaigns
- Recommendation: build as v2 once 10 paying restaurants land, not launch feature

## ✅ Batch 5 — remaining unblocked items (checkpoint)
- **Waiter → table assignment** — restaurant_tables.assigned_staff_id column + PATCH accepts assigned_staff_id. Portal Tables modal now has an inline dropdown per row to assign any active waiter/manager. Assignment shows in the table label ("T7 · 👤 Sipho").
- **Walk-in / waitlist queue** — new /api/admin/walkins endpoint (piggybacks on reservations.is_walkin). Portal action card "🚶 Walk-in queue" opens a modal to add guests with party size + notes, mark them Seat / Left. Live wait-time counter per entry.
- **Master admin audit log viewer** — new "◈ Audit log" tab in /admin/. Fetches /api/admin/audit, renders time/actor/action/target/metadata/IP grid. Filters by restaurant + action. Refresh button.
- **Split-bill: intentionally deferred** — genuinely complex for a shipping session; needs per-item assignment UI + partial-payment orchestration. Flag it for a dedicated build.

## ✅ Batches 1-16 (this session — audit-driven full sweep)
- Shared sound library site-wide (8 named cues, mute in localStorage)
- Brand spelling normalized: "AR Menu" → "ARMenu" everywhere
- **Portal redesign**: 4-tile dashboard + 4 collapsible tool groups (down from 14 loose buttons) + dish search + help pill for onboarding replay
- **Guest menu**: search + dietary chips (V/Vegan/GF/Dairy-free/Halal), hide Book-Table when at table, primary Order button, higher-contrast stock badges
- **View page**: better AR button copy, + Add to cart from view, prev/next dish + swipe navigation
- **Staff console**: sound on new orders + calls (diff-based), assigned waiter shown on table board
- **Kitchen**: seconds display for <60s tickets, undo button on ready+served, modifiers rendered as bulleted sub-list
- **/api/features**: booleans for meshy/anthropic/paddle/sentry/push → admin tabs auto-hide when not configured
- **Admin/restaurant tabs regrouped**: 15 tabs by function (Setup/Menu/Floor/Live/Offers/Analytics/Billing) with hide-on-missing-integration
- **Master admin**: sortable clients table, inline 🗑 delete-restaurant with confirm
- **Plans page**: real R499/R1499/Custom tiers instead of "contact us"
- **FAQ**: 4 new answers (existing menu import, no order commission, offline resilience, in-app payments)
- **Unsaved-changes guard** (vendor/armenu-dirty.js): watches modal inputs, prompts before nav-away
- Guest cart sounds: pop on add, chime on order sent
- **Batch 11**: Categories dish-count · Tables per-row 🖨 QR + 🗑 · Reservations upcoming-only + past toggle · Menu-scheduler 7×24 weekly visual grid with per-schedule colour legend
- **Batch 12**: Branding modal → live iframe preview on the right, auto-refreshes on save + chime
- **Batch 13**: Global error boundary bar site-wide (armenu-errorbar.js)
- **Batch 15**: Automated 5-hourly cloud routine (`trig_0178Tk4Z5oazSa3miPNEQpVM`) — pivoted from GitHub-based build to a **silent uptime monitor** that curls 7 critical endpoints, pushes a phone notification only if something breaks
- **Batch 16**: Cart 24h expiry (stale carts auto-purge) · Master admin Add-Restaurant validation with per-field focus + reserved-slug guard + duplicate detection

## Cloud routine setup
- Routine ID: trig_0178Tk4Z5oazSa3miPNEQpVM
- Fires: every 5 hours (originally aimed for 4h30 but cron minimum + server-picked minute offset = every 5h)
- Currently doing: silent uptime probe of armenu.co.za (7 endpoints). Only pushes a notification if a check fails.
- Original build-loop plan blocked by two things: (a) GitHub not connected to Claude account, (b) cloud env's network policy blocks github.com. Both require Ian's action to unblock.

## Awaiting from Ian
- Sentry DSN (sign up at sentry.io — Google OAuth — copy DSN)
- Meshy Pro subscription → MESHY_API_KEY
- PayFast merchant sign-up (Ian to pick over Paddle for easier SA-native setup)
- ANTHROPIC_API_KEY (for translate + AI menu reader)

## ✅ Just completed (batch 2)
- **Menu scheduler backend** — /api/dish now filters dishes whose category_id is targeted by a schedule not currently active (SA time). Categories with no schedule stay always-visible.
- **Menu scheduler UI** — portal action card + modal with time pickers, day toggles, and per-schedule category checkboxes.
- **/api/admin/schedules** endpoint — GET/POST/PATCH/DELETE.
- **Menu translations UI** — dish editor gets Afrikaans / isiZulu / isiXhosa fields collapsed under a details toggle, plus "🌐 Auto-translate" button that calls Claude Haiku.
- **/api/portal/translate** — Claude-powered translator scoped to the caller's restaurant, rate-limited via the ai_menu_reader quota.
- **Categories → dish assignment** — dish editor now has a Category dropdown pre-populated from /api/admin/categories.
- **Reservations viewer in portal** — new action card + modal with per-row Confirm / Decline / WhatsApp / Delete buttons.
- **Kitchen audio ping** — replaced single tone with two-note E5→A5 chirp using a persistent AudioContext.
- **Kitchen ticket age colours** — whole ticket border turns amber ≥8min and pulsing red ≥15min, on top of status colour.

## Ian's answers on cost caps
- Claude only runs in AI Menu Reader (one-shot per restaurant onboard, ~$0.02–$0.10 each). Zero ongoing spend.
- Neon free tier fits ~50 active restaurants comfortably. Paid ($19/mo) needed around 30-40 paying clients.
- Meshy: Ian will pick a plan and share.

## Waiting on Ian (external)
- MESHY_API_KEY (once he picks plan)
- ANTHROPIC_API_KEY (for AI Menu Reader)
- Wildcard DNS `*.armenu.co.za` — needs registrar name to walk through
- Paddle account + PADDLE_* env vars
- Business bank account
- Google review URLs per client
- Real business email `hello@armenu.co.za`

## Deferred by Ian
- Customer profiles
- Enterprise multi-tenant billing
- Analytics in portal (kept master-admin only)

## Next up (from full 109-item list — priority order)
### HIGH — features listed on landing page but currently non-functional
- Menu scheduler enforcement (breakfast/lunch/dinner auto-switching)
- Menu translations UI + auto-translate button
- Categories → dish assignment in portal
- Reservations management UI in portal
- Reservation reminders to guest
- Timezone per restaurant

### MEDIUM — polish
- Push opt-in on kitchen + staff pages
- Push unsubscribe UI
- Push test-send button
- Kitchen audio ping
- Kitchen ticket age color transitions
- Kitchen station split (hot/cold/bar)
- Waiter → table assignment per shift
- Offer active toggle in portal
- Offer edit (currently only add + delete)
- Time-slot capacity on reservations
- Walk-in / waitlist queue

### LOW — nice to have
- Guest cart persistence (localStorage)
- Tip button
- Split-bill
- Item modifiers / add-ons
- Multi-currency toggle for tourists
- Menu PDF export
- Upsell suggestions
- Loyalty stamps
- Restaurant events calendar
- Category / dish drag-reorder

### Ops / production readiness
- Uptime monitoring
- Status page for restaurants
- Rate limiter → Redis / Upstash (currently in-memory)
- DB backups runbook
- Deploy rollback runbook
- Feature flags per restaurant
- Platform health dashboard for master admin
- Session timeout on kiosks
- Audit log

### Auth / security
- 2FA on master admin
- Password reset for master admin
- Manager can invite team members
- Role-based access (chef, accountant, viewer)

### Legal
- POPI audit
- GDPR (right to deletion, data export)
- Data retention policy
- Restaurant contract / SLA
- Terms of service (proper legal review)
- Privacy policy (proper legal review)

### Testing (currently zero)
- Unit tests
- Integration tests
- Playwright E2E
- CI test gate
- Lighthouse audits
- WCAG audit
- Browser matrix
- Load testing

### Documentation
- Developer README
- API reference
- Manager onboarding videos / GIFs
- Support playbook
- Incident response runbook

### Known bugs / tech debt
- portal_token leaks to referer in staff/kitchen (fixed for admin)
- Chain HQ default token picks alphabetically first restaurant
- Dispatcher body-stream double-consume risk
- .single() vs .maybeSingle() inconsistency
- Live preview iframe reload depends on wrapped toast()
- loadMe reassignment brittle
- Duplicate .brand .mark CSS orphan blocks
- Offers computed per-request (cache candidate)
- Favicon path from subdomain not visually tested
- SSE connection cap unknown

### Meshy / AR Studio
- Wire up MESHY_API_KEY once plan chosen
- Test end-to-end generate → download → upload to R2 → publish flow

### White-labelling / domain
- Wildcard DNS setup
- R2 custom domain (cdn.armenu.co.za)
- Custom domain per restaurant (e.g. menu.oceanbasket.co.za)
- Favicon per restaurant (currently every restaurant uses ARMenu favicon)
- PWA install (manifest.json)

---

## ✅ Session 2026-09-26 (audit-driven fixes, batches 17-19)

- **[Critical] PG array serialization** — shim was JSON-stringifying arrays destined for `text[]/int[]/uuid[]` columns. `api/_db.js` now has a `PG_ARRAY_COLS` whitelist emitting `{a,b,c}` literals. Verified with real DB.
- **[Critical] Query.then broken** — shim's thenable didn't return the exec promise, breaking `.catch()` chains silently. Fixed + added `.finally()`.
- **[Critical] Upsert with no onConflict** — was blowing up on duplicate key insert. Now emits `ON CONFLICT DO NOTHING`.
- **[Critical] restaurants.email unique** — dropped constraint; a single manager can now own multiple restaurants (the multi-location feature was previously a lie).
- **[Critical] Order-items atomicity** — insert failure now rolls back the parent order and logs, instead of leaving an empty order.
- **Menu**: language switcher exposed on languages count, cart wrapper `{ ts, items }` with 24h expiry, lazy-load dish thumbnails via IntersectionObserver, guest reservation email field.
- **SSE efficiency**: `/api/events` uses raw COUNT queries instead of pulling rows.
- **Portal dashboard**: single combined `/api/portal/dashboard` endpoint (orders_today, revenue_today_cents, bookings_tonight, walkins_active, low_stock) in one query.
- **Reserved slugs expanded**: robots, sitemap, preview, index, view, test, health, mail, support, help, docs, blog, signup/signin/login/logout, account, settings, pricing, features, about, terms, privacy.
- **Admin 401 → portal redirect** instead of admin-password prompt (managers can't fluke into master-admin login).
- **Walk-in**: seated_table_id/seated_at columns properly handled.
- **AR Studio**: preview URLs cached on the requests row so re-open doesn't regenerate.
- **Push flag**: `/api/features` correctly reports push as true only when both VAPID keys are set.
- **Staff console**: modifiers rendered as `↳` bullets on order cards.
- **Kitchen board**: ticket ages tick every second between polls via data-created attribute (no more 12-second age lag).
- **Push send**: unexpected failures forwarded to Sentry with restaurant_id + status_code (dead 404/410 endpoints still silently deactivated).
- **A11y layer** (`vendor/armenu-a11y.css` on every page): `:focus-visible` outlines for keyboard nav, global `prefers-reduced-motion` support, skip-link style.
- **Sentry client** respects cookie-consent — if user chose "essential only", it doesn't load at all.
- **Email normalisation** on `restaurants.email` insert (trim + lowercase + syntax check) and reservation `guest_email`.
- **Cloud routine scheduled** every 4h30 to auto-resume this checklist.

## Not-Done — priority for the next session

Pick the top item, do it, commit, push, tick it off here.

### Real bugs / functional gaps
1. ~~Manager team member invites~~ **DONE** — `manager_users` table + `/api/portal/team` + portal modal.
2. ~~ADMIN_SECRET in sessionStorage~~ **DONE** — cookie-based session via `/api/admin/login`. Legacy header still accepted; drop it in a future session once you're confident nothing on the wild internet still sends it.
3. **Rate limit needs Redis** — still blocked on Upstash creds.
4. ~~Empty-state helper~~ **DONE** — `.empty-state` CSS in `vendor/armenu-a11y.css`; used in portal modals. Adopt gradually elsewhere.
5. ~~Marketing pages nav+footer partial~~ **DONE** — `vendor/marketing-chrome.js`; migrated contact/faq/how/plans. `why.html` uses a different nav; leave alone.
6. **Loading state consistency** — utilities exist (.sk-line/.sk-card/.btn-spinner) — adopt gradually replacing "Loading…" text.
7. ~~Split-bill UI~~ **DONE (MVP)** — even-split calculator on staff order card. Per-item assignment + partial payment tracking still a future feature.

### Docs / hygiene (all DONE this session)
- ~~CHANGELOG.md~~ **DONE**.
- ~~README.md~~ **DONE** — arch diagram, env-vars table, local dev, deploy.
- ~~CLAUDE.md~~ **DONE** — repo conventions.
- ~~Basic test suite (vitest)~~ **DONE** — 22 tests pass (_db.js encoding, admin cookie signing, manager token round-trip).
- ~~CI~~ **DONE** — `.github/workflows/ci.yml` runs `npm test` on push + PR to main.

### Also shipped 2026-09-26 (features+polish batch)
- Guest allergy warnings on menu dishes ("Contains 🥜 nuts · 🥛 dairy" / "🌱 Vegan · 🕌 Halal")
- Kitchen line-items are tappable to strike-through (localStorage-persisted)
- Order cancellation now captures a reason + audit-logs total_cents lost
- Ownership transfer via POST /api/portal/transfer (owner → new email, old owner kept as manager)
- Empty-state adoption in staff/kitchen views
- Zero-dep syntax-check script (`scripts/syntax-check.js`) runs in CI
- **Bug fix caught by syntax check: `api/_h/order.js` had `let body` + `const body` in same scope**
- Vercel + CI badges added to README

### Also shipped 2026-09-26 (later batch)
- Reservation confirmation email + .ics calendar attachment (Resend, silent no-op unless RESEND_API_KEY set)
- Menu booking modal → success card with Add-to-calendar button
- `/api/features` reports `email: true|false`
- `why.html` migrated to shared marketing chrome
- Staff + kitchen login: restaurant-slug input centred like PIN
- Tests: buildIcs + sendMail (29 total, all green)

### Also shipped 2026-09-26 (SECOND deep sweep — 20 MORE verified bugs fixed)
**Critical (6)** — cross-tenant scope bypasses on 5 admin PATCH/DELETE endpoints (categories, tables, offers, schedules, staff — the staff one enabled silent PIN reset on another restaurant's staff). settings.js free-plan bypass fixed by splitting whitelist into MANAGER_ALLOWED and MASTER_ONLY.
**High (5)** — modifier `price_cents_delta` now server-re-derived from `dishes.modifiers` (was client-trusted → negative totals possible); `settings?.default_currency` (was null-deref); ai-generate reservation-style debit + refund-on-failure (was: race allowed two concurrent generates to burn one credit for two Meshy jobs); kitchen+staff SSE reconnect no longer stacks 1Hz timers; Paddle webhook adds hex-length guard + ±5min timestamp freshness.
**Medium (5)** — upload-url MIME whitelist (blocks .html/.svg/.js in `dishes` bucket); every `.ilike('email', X)` swapped for `.eq('email', X.toLowerCase())` in 10 files (LIKE metachars `_ %` broke matching); reservation replyTo scrubs CR/LF; clientIp() prefers `x-vercel-forwarded-for` (fallback: LAST hop of x-forwarded-for, not first-spoofable); events.js single teardown() replaces racing close+timeout handlers.
**Low (4)** — admin master XSS via unescaped restaurant name (breadcrumb + filename drop + header) → all migrated to createElement+textContent; ai-generate body defaults to {} on empty POST.

### Also shipped 2026-09-26 (deep audit sweep — 20 verified bugs fixed)
**Critical (4)** — `x-admin-secret` undefined===undefined bypass; shim `_shape` returning `data:null` breaking `const { data = [] }`; `.select('*, order_items(*)')` embedded-relation syntax the shim doesn't parse (staff/admin orders + analytics); PATCH/DELETE by `?id=` bypassed scope guard.
**High (5)** — ownership-transfer trim; SSE first-tick emit; reservation email portal URL from request host; stock-decrement race (`UPDATE ... WHERE stock_count >= qty`); push-subscribe DELETE scoped by restaurant + atomic upsert.
**Medium (5)** — missing `restaurant_settings` treated as orders-enabled; team-invite duplicate detection by Postgres error code; past-booking window tightened; portal/me dead `.some(t=>true)` fixed; teammate roles limited to manager/viewer (owner lives on restaurants.email).
**Low (2)** — mailer subject strips CR/LF; rate-limit sliding window replaces useless setInterval.

**Site-wide UI polish layer** — buttons auto-lift on hover, brand-tinted selection, refined scrollbars, focus glow ring, toast animation, card hover, modal entrance, .chip utility, print styles. Admin restaurant: 10 empty states migrated to `.empty-state`.

### Remaining next-session ideas
- Adopt `.sk-line/.sk-card/.btn-spinner` in more places (portal, admin, staff, kitchen loading states).
- Adopt `.empty-state` in more places.
- Split-bill v2: per-item assignment + partial payment tracking.
- Drop the legacy `x-admin-secret` header path once every deploy has moved to cookie sessions.
- Add lint step to CI (eslint config).
- Preview deploys per PR (Vercel already does this — just link the badge in README).
- Consider migrating the `restaurants.email` primary-manager concept into `manager_users` with a `role='owner'` flag so ownership is transferable.

### Blocked on Ian
- Sentry DSN → `SENTRY_DSN`
- PayFast merchant credentials
- Meshy API key
- Anthropic API key
- Upstash Redis creds
- Wildcard DNS for `*.armenu.co.za`

## Working style (read before every session)

- Commit every few edits with a clear message. Never leave the tree dirty at end of session.
- Always `git push` after commit — no local-only work.
- If a fix is bigger than expected, note it here and move to the next item.
- Don't ask Ian questions — pick the reasonable choice and ship.
- Update the checklist above as you go so the next session picks up cleanly.

### Also shipped 2026-09-26 (Round-3 focused sweep — 12 verified bugs)
**Critical (3, regression I introduced)** — faq.html, how.html, why.html had `getElementById('nav')` crash after marketing-chrome migration (helper hydrates `#mkNav` → `<nav class="ar-nav">`, no `id="nav"` any more). TypeError halted the inline script → IntersectionObserver never fired → all `.reveal` elements stuck at opacity:0. Fixed with `querySelector('header.ar-hdr, .ar-nav')` + null guard.
**High (8)** — portal/index.html dish tile innerHTML + edit-modal inputs + 6 translation inputs unescaped (stored XSS reaching every teammate now that team invites are live); index.html wordmark div → h1 (no h1 broke SEO); contact.html + legal.html missing meta description; contact.html form submitting empty name because `window.name` shadowed the id-based binding.
**Medium (1)** — admin/restaurant.html dish thumb URL injected straight into inline style="background:url()" — now goes through escaped data-bg + JS hydration.

### Also shipped (polish)
- portal dashboard tiles: shimmer skeleton while loading, `.dash-tile.loading` cleared after fetch (or shown as em-dash on failure)

### Also shipped 2026-09-26 (Round-4 tight sweep — 15 verified bugs)
**Critical (2)** — regression I introduced in the earlier modifier server-re-derive (iterated flat shape but stored shape is nested groups → all paid modifiers silently charged R0 on every order); SSRF in admin/compress.js (fetch(glb_url) → exfiltrate via public bucket). 5 new vitest cases lock the modifier shape.
**High (5)** — staff PIN brute-force lockout (per-ip + per-restaurant); waiter-call dedup by (restaurant,table) + 5/min cap; view.html add-to-cart failed after menu.html wrapped cart in {ts, items}; portal delegated click listener stacked on every loadMe (one tap → N handlers); credits + print-QR modals stacked click listeners → N checkout POSTs per Buy tap.
**Medium (4)** — reservation status whitelist; restaurant DELETE audit before cascade; email-lowercase data migration; menu.html sendCall + revSend double-submit guards; org-overview siblings pruned on re-render.
**Low (1)** — push subscribe role derived from authoritative staff.role (client body ignored) + refuse cross-restaurant endpoint hijack.

### 2026-09-27 Round-5 regression check
- Manual self-audit on my round-4 fixes (Workflow died at session limit).
- Found + fixed 1 regression: push/subscribe treated the synthetic `manager-<rid>` staff id (from staff/login.js portal hand-off) as a real DB row → lookup returned null → role fell back to 'waiter', so manager kiosks would never receive manager-scoped push. Fixed by trusting the 'manager-' prefix.
- Verified rest of round-4: compress SSRF allowlist matches Supabase URLs; staff PIN lockout gracefully handles missing table (shim returns `{data:[], error}` not a throw); menu.html `_callInFlight` flag resets on timer + button flags don't stick if sheet closes; modifier walker doesn't need flat-shape legacy compat (only ever nested).

### 2026-09-27 Continuation batch (post-audit polish)
- Ownership transfer UI: portal Team modal → new "Transfer ownership" section (owner-only, inside <details>). Wires the existing /api/portal/transfer endpoint.
- `.btn-spinner` adopted on 4 login flows (admin, admin/restaurant, staff, kitchen) — button disabled + spinner glyph while awaiting, restored on error.
- SEO: JSON-LD SoftwareApplication (index), Product+3-tier Offer (plans), FAQPage with 15 Q&A (faq) — Google rich-result eligible. Twitter Card meta on all 7 marketing pages.
- sitemap: added changefreq per URL. robots: disallow /staff/, /kitchen/, /qr-print, /view, /m/, /t/ — no crawl budget wasted on empty auth-gated / templated URLs.

### 2026-09-27 Round-6 full workflow test — 25 of 27 verified fixes shipped
**HIGH (13)** — sold-out gate + required-mod gate on view.html; single-dish response now includes stock/modifiers; menu error toast surfaces data.message; cart re-render preserves note+table draft (`_cartDraft`); reservation email_sent is honest (awaited); 4 XSS in admin master console; kitchen Undo bumped to 44px min; menu clear-search aria-label + 44×44; portal --ink-faint contrast fix (2.3:1 → 4.6:1).
**MEDIUM (10)** — client-side idempotency key + server 15-min short-circuit; rvSubmit try/catch for network drops; reservation uses own duration (not fixed 90m); server-side email regex; dismiss button error toast; audit action <select> rebuilt per load; --accent-hi → --accent-2 fix; portal req-row overflow on small phones; close-button tap targets.
**UX (2)** — reservation timezone (restaurant_settings.timezone, IANA); "confirm on WhatsApp or phone" copy adapts to which channel guest actually provided; requires guest email OR phone.
**LOW (1)** — dead _origCreate capture removed.

**Deferred** — audit-log server-side pagination (needs cursor API — bigger change); "+ Add new dish" sidebar empty-state (cosmetic).
