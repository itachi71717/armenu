# AR Menu — Project Handover Brief

**Read this first. This is the complete, up-to-date context of the project as of 2026-08-14.**

This file replaces the previous version of this brief, which described an earlier
Cloudflare-based architecture that was designed but **never deployed**. The system
actually running in production today is different — Vercel + Supabase — and this
document describes that real system.

---

## What this is

**AR Menu** — South Africa's first augmented-reality menu platform. Restaurants get
small QR codes printed next to dishes on their menu. Diners scan with their phone
camera, a page opens, they tap once, and a photo-real, life-size 3D model of the
meal appears on their table. No app, no download, ~2 seconds end to end.

**Live domain:** `armenu.co.za` (registered at Host Africa, DNS/hosting now pointed
at Vercel)

**Owner / GitHub:** itachi71717

---

## Current status (2026-08-14)

- ✅ **Live and working end-to-end.** Verified today: created a real restaurant +
  dish record, uploaded a real `.glb` 3D model, and confirmed the diner-facing
  `/view.html` page correctly loads and displays it.
- ✅ Production source code is now backed up on GitHub for the first time (see
  below) — before today it only existed as uncommitted local files.
- ⚠️ Supabase project had been **paused** (free-tier auto-pause after inactivity)
  and was not resolving on the public internet at all. Owner resumed it manually
  during this session. **This will recur** if the project sits idle — see "Known
  risks" below.
- ⚠️ Only one demo restaurant/dish exists in the database (seeded during this
  session for testing — see "Demo data" below). No real clients onboarded yet.

---

## Architecture — what's actually running

```
platear/
├── index.html, how.html, dishes.html, why.html, faq.html   ← public marketing pages
├── view.html               ← AR viewer diners hit after scanning a QR
├── admin/index.html        ← boss panel (owner only, password-gated)
├── portal/index.html       ← restaurant client portal (Clerk-gated)
├── api/                    ← Vercel serverless functions (the real backend)
│   ├── _db.js              ← Supabase client init (anon + service-role clients)
│   ├── _auth.js            ← requireAdmin() (secret header) + requireManager() (Clerk JWT)
│   ├── dish.js             ← GET dish/menu data for the AR viewer (public)
│   ├── scan.js             ← POST scan-tracking beacon (public)
│   ├── admin/
│   │   ├── overview.js     ← dashboard stats (admin-only)
│   │   ├── clients.js      ← GET/POST restaurants (admin-only)
│   │   ├── client.js       ← GET/DELETE a single restaurant + its dishes (admin-only)
│   │   ├── dishes.js       ← POST new dish (admin-only)
│   │   ├── upload-url.js   ← signed Supabase Storage upload URL (admin-only)
│   │   ├── compress.js     ← re-hosts/optimises uploaded .glb (admin-only)
│   │   └── pending.js      ← pending portal sign-ups not yet linked to a restaurant
│   └── portal/
│       ├── me.js           ← manager's own restaurant data (Clerk-authed)
│       ├── request.js      ← manager submits a change request (Clerk-authed)
│       └── pending-signup.js ← manager signs up before a restaurant exists for them
├── backend/schema.sql      ← Supabase (Postgres) schema — see below
├── vercel.json             ← routes /how, /dishes, /why, /faq to their .html files; CORS on /api/*
└── package.json            ← deps: @supabase/supabase-js, @clerk/backend
```

**Not used anymore** (present in git history from the original design, safe to
ignore/delete later): `backend/wrangler.toml`, `backend/src/*.js` — this was the
original Cloudflare Workers + D1 plan that was replaced before ever going live.

---

## Third-party services — where everything lives

| Service | What it's for | Reference |
|---|---|---|
| **Vercel** | Hosting (static pages + serverless `api/`) | Project name `armenu`, project ID `prj_HhuweT1LKCG0kAEQgwAdKUKekd2D`, org/team ID `team_Cdot3ogNFKIGEeusXVolNckC`. Custom domain `armenu.co.za` attached directly in Vercel. |
| **Supabase** | Postgres database + file storage for `.glb`/`.usdz` models | Project ref `oqgmejzrpwngxulmphjy` (URL: `https://oqgmejzrpwngxulmphjy.supabase.co`). Free tier — **auto-pauses after inactivity**, must be manually resumed from the Supabase dashboard when this happens. Storage bucket: `dishes` (public), files under `originals/<timestamp>-<random>-<filename>`. |
| **Clerk** | Authentication for the restaurant portal (`/portal/`) | Instance `strong-foal-30` (`strong-foal-30.accounts.dev`), app name "Ar Menu". **Currently running on development keys, not production** — has usage limits and shows a dev-mode badge. Needs to be switched to a production instance before real restaurants sign up. |
| **GitHub** | Source code backup | Private repo **[itachi71717/armenu](https://github.com/itachi71717/armenu)** — created 2026-08-14, holds the real production code (the version described in this document, not the old Cloudflare version from earlier commits elsewhere in git history). |
| **Host Africa** | Domain registrar for `armenu.co.za` | Domain purchased here; DNS/hosting now points at Vercel. |

**Environment variables** the app depends on (names only — values live in Vercel's
project environment variables and in a local `.env.local`, which is
git-ignored and never committed):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
ADMIN_SECRET          ← the boss panel password
OWNER_WHATSAPP
```

---

## Database schema (Supabase / Postgres)

Tables (see `backend/schema.sql` for the authoritative source):
- `restaurants` — id, slug, name, email, created_at
- `dishes` — id, restaurant_id, slug, name, price, glb_url, usdz_url, thumb_url, camera_orbit, active, created_at
- `scans` — id, restaurant_id, dish_id, user_agent, scanned_at (one row per QR scan)
- `requests` — id, restaurant_id, message, status (change requests submitted via the portal)
- `pending_signups` — people who signed up at `/portal/` before a restaurant existed for their email; owner links or dismisses them from the boss panel

---

## Demo data currently in production

Seeded during this session to verify the end-to-end flow actually works:
- Restaurant: `Demo Restaurant` (slug `demo-restaurant`)
- Dish: `Korean BBQ Wings` (slug `korean-bbq-wings`), using a real `.glb` scan
  from `Downloads/Korean BBQ Wings - Food - Chicken.glb`

Live test URL: `https://armenu.co.za/view.html?r=demo-restaurant&d=korean-bbq-wings`

**Decide whether to keep this as a working example or delete it** before
onboarding real restaurants (delete via the boss panel's client drill-down page).

A second local file, `Downloads/2026_05_01.glb`, exists but has not been uploaded
anywhere yet.

---

## Known risks / unfinished business, by priority

**High**
1. **Silent error-swallowing bug** in `api/dish.js` (and likely the sibling admin
   endpoints): Supabase call results are destructured without checking the
   `error` field, so a total backend outage gets reported to the user as a plain
   "not found" instead of a real error. This is why the Supabase pause went
   unnoticed for a while — fix before relying on this for real customers.
2. Zero real restaurants onboarded — only the demo data above exists.

**Medium**
3. Clerk is on **development keys** — switch to a production instance before
   real restaurant managers use `/portal/`.
4. **Supabase free-tier auto-pause** will happen again if the project sits idle.
   Either upgrade to a paid tier before launch, or accept that it needs manual
   resuming from the Supabase dashboard periodically.
5. Placeholder WhatsApp number `27000000000` is still present in `index.html` —
   needs to be swapped for the real number.

**Low**
6. The other top-level docs (`SETUP.md`, `BUSINESS_PLAN.md`, `README.md`,
   `PRICING.md`, `SALES_PLAYBOOK.md`, `LAUNCH_CHECKLIST.md`) still describe or
   assume the old Cloudflare Workers/D1 stack. They're fine for business
   strategy content but technically inaccurate — rewrite if a future session
   needs to rely on them for setup steps.
7. Boss panel dish tiles now show a QR code (added this session) linking to
   each dish's live AR page, with a "Download QR" button for printing — confirm
   this is deployed to production (see "Deployment" below).

---

## Deployment

The Vercel project has **no confirmed Git integration** as of this session —
earlier deploys appear to have been pushed via `vercel --prod` directly from a
local working copy, not via GitHub auto-deploy. The `armenu` GitHub repo created
today is new and may not be connected to Vercel yet.

To deploy future changes, either:
1. Run `vercel login` (device-code browser flow) then `vercel --prod` from the
   project root, or
2. Connect the `itachi71717/armenu` GitHub repo to the Vercel project in the
   Vercel dashboard (Project → Settings → Git) so pushes to `main` auto-deploy.

---

## Brand details

- **Name:** AR Menu
- **Wordmark:** "AR" bold + "Menu" lighter, all caps in nav
- **Palette:** Background `#0a0806` · Ink `#f5efe6` · Accent `#ff5722` · Accent-2 `#ffb066` · Deep `#c93d00`
- **Type:** Inter (UI) + Instrument Serif italic (display accents) + JetBrains Mono (labels)
- **Voice:** Confident, premium, photographic.

---

## What's blocking real launch

1. ✅ Domain live, pointed at Vercel
2. ✅ Production code backed up to GitHub
3. ✅ Supabase resumed and confirmed working
4. ⏳ Fix the silent-error-handling bug in the API
5. ⏳ Switch Clerk to a production instance
6. ⏳ Decide on Supabase pause-prevention (paid tier or manual monitoring)
7. ⏳ Replace placeholder WhatsApp number
8. ⏳ Onboard first real restaurant through the boss panel
9. ⏳ Confirm/set up Vercel deployment method (CLI login or GitHub auto-deploy)
