# The full ARMenu journey. Mapped.

This is every touchpoint, from the moment a restaurant discovers us to the moment a diner leaves a review. Read straight through to see how it flows. Every step is either live now, or noted as coming.

## PART A. Prospect → paying restaurant

1. **Discovery.** Restaurant owner sees ARMenu on WhatsApp / referral / marketing / cold outreach.
2. **Landing.** Visits `armenu.co.za` — sees the cinematic hero, story sections, features, pricing.
3. **Enquire.** Clicks WhatsApp float button OR presses Enquire → lands on `/contact`.
4. **Contact form** posts to `/api/portal/pending-signup`. You get the lead in `/admin/` → Pending sign-ups tab.
5. **You call/WhatsApp them** with pricing + short live demo.
6. **They agree.** You add them in `/admin/` → Add restaurant. This creates the restaurant record + their manager email.
7. **Payment (optional).** Set `PADDLE_*` env vars once billing is wired. `/api/admin/billing` generates a Paddle checkout URL for the plan they picked. Paddle webhook auto-updates their `subscription_status`.

## PART B. Manager onboarding

8. **Manager signs in** at `/portal/` with the email you set. Clerk sends a magic link or verifies via Google.
9. **First-time flow.** Manager sees the portal home. They can:
   - Set restaurant branding (logo, cover, colour, tagline)
   - Set locale (currency, languages)
   - Add categories (Starters, Mains, Desserts, Drinks…)
   - Add dishes. THREE PATHS:
     - **AI Menu Reader.** Paste the URL of their existing PDF menu. Claude Vision extracts every dish + category + price + description. Bulk-import as hidden placeholders. Then attach a 3D per dish (see next).
     - **AR Studio → Generate from photo.** Upload a photo per dish. Meshy generates a 3D `.glb` in 1-3 min. Preview → adjust scale → publish. Retry if unhappy.
     - **AR Studio → Upload your own 3D model.** Bring your own `.glb` (and optionally `.usdz` + thumbnail). Skip the AI entirely. This is for restaurants who already have professional 3D scans or model files.
   - Add tables (each gets its own printable QR)
   - Add staff (name + 4-6 digit PIN)
   - Toggle optional modules (ordering, waiter call, kitchen display, reviews, tables)
   - Set menu schedules (breakfast → lunch → dinner switches on the clock)
   - Set happy-hour offers
   - Set Google Reviews URL
10. **Print QRs.** `/qr-print.html?r=<slug>&type=tables|dishes|menu` → A4-ready sheets (4/6/9 per page).
11. **Place QRs on tables** and doors. Restaurant is live.

## PART C. The dinner service (guest side)

12. **Guest sits down.**
13. **Guest scans QR** with native camera on their phone.
14. **Menu opens instantly** at `<slug>.armenu.co.za` or `/m/<slug>` (branded, categorised, in their language).
15. **Guest taps a dish.** iOS Quick Look (`.usdz`) or Android Scene Viewer (`.glb`) opens through the native camera. **Dish appears life-size on the table in AR.**
16. **Guest is impressed.** Decides.
17. **IF orders enabled:** guest builds a cart. Sends to kitchen.
18. **IF waiter call enabled:** guest taps the bell button. Alert appears on staff console.
19. **IF neither enabled:** guest just uses the menu as reference and orders via your staff normally.
20. **Guest eats.**
21. **Post-meal review.** 1-tap star rating. 4-5★ → guest is invited to leave a Google review (routed to the restaurant's `google_review_url`). 1-3★ → stays private for the owner.

## PART D. The kitchen & floor (staff side)

22. **New order lands.** Instant push via SSE to `/staff/` and `/kitchen/` PIN-locked consoles.
23. **Kitchen display** (`/kitchen/`) shows a big-ticket board. Colour goes from green → amber → red based on how long the ticket's been open. Audio ping on every new order.
24. **Staff console** (`/staff/`) shows the order, waiter marks: new → prep → ready → served.
25. **Waiter call queue.** Any bell request appears here. Waiter acknowledges → closes.
26. **Table board.** Waiter taps a table to set: available / occupied / reserved / VIP / cleaning. All in real time across every staff device.

## PART E. Ongoing (owner)

27. **Owner watches analytics.** `/admin/restaurant.html?slug=<r>` → Analytics tab. Sees scans, orders, revenue, peak hours, top dishes, avg rating over 7/30/90 days.
28. **Owner adjusts menu live.** Edit price → live in seconds on every guest's phone. Mark sold-out → hidden immediately.
29. **Owner reads reviews.** Reviews tab shows every rating, comment, Google-routed flag.
30. **Owner regenerates dishes** if photos become outdated.

## PART F. Growth loops

31. **Every scan builds analytics.** Data shows the owner what's working, so they double down.
32. **Every 4-5★ review** goes to Google — which drives new bookings.
33. **Every AR view is Instagrammable.** Guests film the AR meal and post it — free acquisition for the restaurant AND for ARMenu.
34. **Every restaurant reference-sells.** They tell peers. New leads come in via WhatsApp.

## Gaps that are still on the roadmap

These are the pieces we've mapped but haven't shipped yet. Priority-ordered.

1. **Manager self-serve dish editor.** Right now managers submit requests. They can VIEW their dishes but can't edit them without you. Building a manager-facing menu editor in `/portal/` so they don't need to ping you for every change.
2. **First-time onboarding wizard** for new managers in `/portal/`. Right now they land on the portal home cold; a step-by-step wizard walks them through branding → first category → first dish → first table → first staff PIN → first print.
3. **Push notifications** to owner + staff phones (order placed, waiter called, low rating). Currently in-console only.
4. **Multi-location dashboard** for chains — one owner, multiple restaurants, roll-up analytics.
5. **Live preview** of menu while editing (see the change before diners do).
6. **Inventory counter** (auto-hide dish when count hits zero).
7. **Table QR reservation flow** (guest scans → makes booking).
8. **Staff assignment** (which waiter serves which tables tonight).
9. **Customer profiles** (returning diners, favourite dishes, allergies).
10. **Enterprise multi-tenant billing** (chains).

## Every tech piece behind it, at a glance

- **Frontend**: static HTML/CSS/JS hosted on Vercel
- **API**: single catch-all serverless function at `api/index.js` dispatching to `api/_h/*` handlers (30+ endpoints, dynamic imports so cold-start is fast)
- **Database**: Supabase Postgres (planned migration to Neon for no-pause)
- **File storage**: Supabase Storage `dishes/` bucket (planned migration to Cloudflare R2 for cheap egress)
- **Guest auth**: none needed
- **Owner auth**: password against `ADMIN_SECRET` env var
- **Manager auth**: Clerk (email/Google sign-in)
- **Staff/kitchen auth**: PIN → HMAC-signed token (`STAFF_SECRET`)
- **AR viewer**: Google `<model-viewer>` — iOS Quick Look + Android Scene Viewer
- **AR generation**: Meshy image-to-3D (via `MESHY_API_KEY`) OR direct file upload
- **Menu OCR**: Claude Vision (via `ANTHROPIC_API_KEY`)
- **Billing**: Paddle (via `PADDLE_*`)
- **Realtime**: Server-Sent Events at `/api/events`
