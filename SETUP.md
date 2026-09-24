# AR Menu — Setup & Operations

## 1. Supabase migration
Run `backend/schema.sql` in Supabase → SQL Editor. Safe to re-run (uses `IF NOT EXISTS` everywhere).

## 2. Supabase Storage bucket
In Supabase → Storage → create a bucket called **`dishes`** and mark it **public**. This is where AR Studio drops the generated `.glb`, `.usdz` and thumbnails.

## 3. Environment variables (Vercel → Project → Settings → Environment Variables)

### Required
| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key |
| `CLERK_SECRET_KEY` | Clerk backend (portal auth) |
| `ADMIN_SECRET` | Boss password for `/admin/` |
| `STAFF_SECRET` | HMAC secret for staff PIN tokens (falls back to ADMIN_SECRET if unset) |

### AR Studio (dish generation)
| Name | Purpose |
|---|---|
| `MESHY_API_KEY` | Upstream 3D generation provider — never exposed to the client |

Without this, AR Studio returns "AR generation not configured" — the rest of the app keeps working.

### AI Menu Reader (PDF → dishes)
| Name | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Vision for menu extraction |

### Paddle billing (optional)
| Name | Purpose |
|---|---|
| `PADDLE_ENV` | `sandbox` or `production` |
| `PADDLE_API_KEY` | Paddle → Developer tools → Authentication |
| `PADDLE_WEBHOOK_SECRET` | Set when adding the webhook destination |
| `PADDLE_PRICE_STARTER`, `PADDLE_PRICE_PRO`, `PADDLE_PRICE_PREMIUM` | Paddle price ids |

Paddle webhook URL: `https://armenu.co.za/api/paddle/webhook` — subscribe to `subscription.created/activated/canceled/past_due/paused`, `transaction.completed`.

## 4. Realistic burger on the landing hero (optional but recommended)
The landing's 3D dish showcase looks for a burger file at `vendor/models/burger.glb`. If it's missing, it falls back to the Khronos photoreal Avocado (which is fine — that's the same PBR quality Apple uses in their AR demos, just an avocado).

There is no publicly hotlinkable photoreal burger .glb online (Sketchfab, CGTrader and TurboSquid all lock downloads behind login). Three concrete ways to get a real one on this landing:

**Option A — Sketchfab CC0 hamburger (free, 5 minutes):**
1. Create a free Sketchfab account
2. Go to https://sketchfab.com/3d-models/cc0-hamburger-a6888a07938b4af4986cd05794961250
3. Download the model, format: `Auto-converted format (glTF)` (this gives you a .glb)
4. Rename the file to `burger.glb`
5. Save to `vendor/models/burger.glb`, commit, push
Licence: CC0 (no attribution required)

**Option B — Generate your own via AR Studio (once you add MESHY_API_KEY):**
Take a burger photo from your kitchen, run it through admin → AR Studio, download the resulting `.glb` from Supabase Storage, save as `vendor/models/burger.glb`.

**Option C — Photogrammetry scan (best quality):**
Use Polycam or KIRI Engine on your phone to scan a real burger, export as .glb, save to `vendor/models/burger.glb`.

Prefer a file under 8 MB. The landing auto-swaps the moment the file exists and the plate label becomes `The Signature Burger · R 189`. Until then, the fallback is the Khronos Avocado (photoreal PBR, just not a burger — plate reads `The Signature Avocado · R 89`).

## 5. Wildcard subdomain (optional)
1. Vercel → Project → Domains → add `*.armenu.co.za`
2. Host Africa DNS → add: `CNAME  *  cname.vercel-dns.com`
3. `middleware.js` at the repo root handles the rewrite. `<slug>.armenu.co.za` → the menu; `<slug>.armenu.co.za/t/<label>` → the table-pinned menu.

Reserved subs bypass the rewrite: `www`, `api`, `admin`, `portal`, `staff`, `kitchen`, `app`, `preview`, `staging`.

## 6. Deploy
```
vercel deploy --prod --yes
```
Vercel's auto-deploy from GitHub is not currently hooked up — reconnect in Vercel → Project → Settings → Git if you want pushes to auto-deploy.

## 7. If Supabase pauses
Supabase free tier auto-pauses projects after ~1 week of inactivity. Symptom: every API endpoint returns `Backend temporarily unavailable`. Fix: Supabase dashboard → your project → **Restore**.

## 8. Post-deploy smoke test
1. `/admin/` → sign in with `ADMIN_SECRET`.
2. Pick a restaurant → **⚙ Manage modules & settings**.
3. Toggle **Order cart** on → open the restaurant's `/m/<slug>` in another tab → the "Order" button should appear.
4. Tables tab → add a table `T-1` → open `/t/<slug>/T-1` → the menu shows a "Table · T-1" tag.
5. Tables tab → **Print all table QRs** → prints A4-ready sheets.
6. Staff tab → add a staff PIN → open `/staff/` in a new browser → sign in → place a test order from the menu tab → appears on the staff console within ~3s (SSE).
7. `/kitchen/` → sign in with same PIN → same order appears with a ping.
8. AR Studio tab → upload a food photo → wait for preview → slide the size → publish. A QR appears — scan on your phone to see life-size AR.

## 9. Routes at a glance
| Path | Who | What |
|---|---|---|
| `/` | Public | Landing page |
| `/plans` | Public | Pricing |
| `/how`, `/dishes`, `/faq`, `/contact`, `/legal` | Public | Marketing / legal |
| `/m/<slug>` | Public | Guest menu |
| `/t/<slug>/<label>` | Public | Table-pinned guest menu |
| `/<slug>.armenu.co.za` | Public | Wildcard subdomain → menu |
| `/view.html?r=&d=` | Public | Single-dish AR viewer |
| `/portal/` | Restaurant | Manager sign-in (Clerk) |
| `/admin/` | Owner | Boss panel — restaurants, dishes, uploads |
| `/admin/restaurant.html?slug=` | Owner | Per-restaurant modules & settings (13 tabs) |
| `/staff/` | Waiters | Live orders, calls, table board (PIN + SSE) |
| `/kitchen/` | Kitchen | Big-ticket order display (PIN + SSE + ping) |
| `/qr-print.html?r=&type=tables\|dishes\|menu` | Owner | Printable A4 QR sheets |
| `/api/*` | Everyone | Single catch-all dispatcher in `api/index.js` |

## 10. Architecture notes
- Every `/api/*` request goes through `api/index.js` (dynamic-imports handlers under `api/_h/`) — 1 serverless function total to stay under Vercel Hobby's 12-function cap.
- Guest AR is `<model-viewer>` — iOS Quick Look (`.usdz`) + Android Scene Viewer (`.glb`) = 1-tap native camera AR, no app.
- AR Studio downloads BOTH `.glb` and `.usdz` from the generation provider and rehosts them on Supabase Storage before attaching to the dish, so the upstream URL is never exposed and the assets survive if the provider expires them.
- Real-time updates: `api/_h/events.js` streams SSE with 3s DB probes + 25s heartbeat. Staff + Kitchen consoles both subscribe.
- Scale is per-dish (`dishes.scale`, real, defaults 1.0). Adjustable via slider in the AR Studio at generation time OR later from the Dishes tab.

## 11. What's ALWAYS-ON vs OPTIONAL
Always on for every restaurant:
- The AR menu, categories, translations, currency, real-time menu edits, analytics, reviews (unless explicitly disabled)

Optional per-restaurant (toggle in **Manage → Settings & Features**):
- Order cart (guest self-ordering)
- Waiter-call button
- Kitchen display
- Table management

This is deliberate — restaurants that already have a POS just get the AR menu; they don't pay for or use modules they don't want.
