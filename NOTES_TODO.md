# ARMenu — Live TODO tracker

Maintained by Claude across sessions. What's done, what's next, what's blocked.
Update after every completed item.

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
