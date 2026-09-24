# ARMenu. Full system catalog.

Every module that ships in the platform today. Each is toggleable per restaurant.

## 1. Guest-facing (always on)

**AR Menu**
The core. Every dish has a QR that opens the phone's native camera AR (iOS Quick Look via `.usdz`, Android Scene Viewer via `.glb`). Dish appears life-size on the guest's table, 1 tap, no app.

**Full menu browsing** (`/m/<slug>` or `<slug>.armenu.co.za`)
Category chips, cover image, branded colours, per-dish translations, price in the restaurant's currency, allergens.

**Table-pinned menu** (`/t/<slug>/<label>`)
Each table's QR pins its label so every order and every waiter-call knows which seat sent it.

**Multi-language** (up to 8 per menu)
Guest toggles language, per-dish translations swap in. Currency also swaps if configured.

**Post-meal review**
1-tap star rating. 4-5★ automatically prompts the guest to leave a Google review too (using the restaurant's `google_review_url`); 1-3★ stays private for the owner.

## 2. Optional guest modules (each toggleable per restaurant)

**Order cart** — guest adds dishes, sends to kitchen. Set `orders_enabled=true`.

**Waiter call button** — 1 tap → staff console alert. Set `waiter_call_enabled=true`.

**Table management** — every table has its own QR + status. Set `tables_enabled=true`.

## 3. Owner console (`/admin/`)

**Boss panel** — list every restaurant, add restaurants, quick stats. Sign in with `ADMIN_SECRET`.

**Per-restaurant management** (`/admin/restaurant.html?slug=<r>`) with 13 tabs:
1. Settings & feature toggles (per-restaurant feature flags)
2. Branding (logo, cover, theme colours, tagline)
3. Categories (CRUD)
4. Tables (CRUD + per-table QR)
5. Staff (add/remove staff, set PINs)
6. Live orders (stream, mark prep → ready → served)
7. Waiter calls (acknowledge, close)
8. Reviews (list with star + comment + Google-routed flag)
9. Happy hour / offers (time-boxed discounts)
10. Analytics (7/30/90 day totals, daily chart, hourly heatmap, top scanned, top ordered, revenue, avg rating, Google-routed count)
11. AR Studio (photo → 3D dish with resize slider + retry)
12. Dishes (edit price, scale, active/inactive, delete)
13. Billing (Paddle checkout — inactive until keys added)

## 4. Staff console (`/staff/`)

PIN sign-in with restaurant slug + 4-6 digit PIN.
- Live orders board (new → prep → ready → served)
- Take staff-side orders with per-item notes + complimentary items
- Waiter-call queue (acknowledge / close)
- Table board (available / occupied / reserved / VIP / cleaning)
- Real-time via server-sent events (3s DB probe + 25s heartbeat, no polling lag)

## 5. Kitchen display (`/kitchen/`)

Same PIN sign-in. Big-ticket cards. Age-warning colours (green → amber → red at 8 min / 15 min). Audio ping on every new order. Wake-lock to keep screen on.

## 6. QR printing (`/qr-print.html`)

Printable A4 QR sheets. 4/6/9 per page. Three modes:
- One per table (each pinned to its label)
- One per dish (deep-links to the dish's AR viewer)
- Master menu QR (opens the full menu)

## 7. Restaurant manager portal (`/portal/`)

Clerk email sign-in. Restaurant managers you onboard get a view of only their own restaurant, can submit change requests, view their dish QRs.

## 8. AR Studio (dish generation)

Owner uploads a food photo → the platform generates a 3D .glb via Meshy → owner previews with model-viewer → adjusts scale via slider → retries if unhappy → publishes. On publish the platform downloads both .glb + .usdz + thumbnail from the generator, uploads all three to your own storage bucket, attaches to the dish record. Upstream generator brand is never exposed to owners.

## 9. AI Menu Reader

Owner pastes a link to their current menu PDF or JPG. Claude Vision extracts every dish name + price + category + description. Preview → bulk-import as hidden dishes (they get a placeholder glb, owner attaches real 3D via AR Studio one by one). Cuts onboarding time from hours to minutes.

## 10. Multi-menu scheduler

Breakfast auto-switches to lunch to dinner at times you set. Categories can belong to one or more time windows. Guest only sees dishes valid at the current time-of-day.

## 11. Auto happy-hour / offers

Set a discount percentage on selected dishes on specific weekdays between two times. Guests see the discounted price during those windows automatically.

## 12. Analytics

Every scan, dish view, order, review is logged. Owner sees:
- Total scans / orders / reviews / revenue over 7/30/90 days
- Daily line chart of scans
- Hourly heat-map (identifies peak times)
- Top 10 scanned dishes
- Top 10 ordered dishes
- Avg rating + how many routed to Google

## 13. Wildcard subdomains

`<restaurant-slug>.armenu.co.za` routes to that restaurant's menu automatically. Set up: add wildcard domain in Vercel + `CNAME * cname.vercel-dns.com` in DNS.

## 14. Real-time push

`/api/events` streams SSE. Staff console + kitchen display both subscribe. New orders and calls appear instantly, no polling.

## 15. Paddle billing (inactive by default)

`api/paddle/webhook` receives subscription events. `api/admin/billing` creates checkout URLs. Wire up by adding Paddle env vars.

---

## What sits behind it all

- Frontend + API: Vercel Hobby (single-function catch-all API dispatcher: `api/index.js` → `api/_h/<route>.js`)
- Database: Supabase Postgres (schema in `backend/schema.sql`) — migration to **Neon** planned once you sign up
- File storage: Supabase Storage bucket `dishes` — migration to **Cloudflare R2** planned once you sign up
- Auth (guest): none needed
- Auth (owner): password (`ADMIN_SECRET`) checked server-side
- Auth (restaurant manager): Clerk
- Auth (staff/kitchen): PIN → signed HMAC token (in `STAFF_SECRET`)
- AR generation: Meshy (via `MESHY_API_KEY`)
- Menu OCR: Claude Vision (via `ANTHROPIC_API_KEY`)
- Billing: Paddle (via `PADDLE_*`)
