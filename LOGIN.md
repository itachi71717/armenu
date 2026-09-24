# Backend access (for you, Ian)

## Owner console (that's you)
- URL: **https://armenu.co.za/admin/**
- Password: whatever you set as `ADMIN_SECRET` in Vercel → Project → Settings → Environment Variables. If you don't remember, open Vercel dashboard → project `armenu` → Settings → Environment Variables → the value under `ADMIN_SECRET`.
- From there: list all restaurants, add restaurants, add dishes, drill into any restaurant → **⚙ Manage modules & settings** (13 tabs — Settings/Features, Branding, Categories, Tables, Staff, Live Orders, Waiter Calls, Reviews, Happy Hour, Analytics, AR Studio, Dishes, Billing).

## Per-restaurant management (any restaurant you've added)
- URL: `https://armenu.co.za/admin/restaurant.html?slug=<restaurant-slug>`
- Same `ADMIN_SECRET` password.

## Restaurant manager portal (for restaurant owners you onboard)
- URL: **https://armenu.co.za/portal/**
- Auth: Clerk sign-up/sign-in with the email you registered for that restaurant.
- They can see their own restaurant, submit change requests, view their dish QRs. They cannot see other restaurants or master admin.

## Staff console
- URL: **https://armenu.co.za/staff/**
- Auth: restaurant slug + 4–6 digit staff PIN (added in Admin → Manage → Staff tab)
- What they see: live orders, waiter-call queue, table board (all in real time via server-sent events).

## Kitchen display
- URL: **https://armenu.co.za/kitchen/**
- Auth: same restaurant slug + staff PIN as staff console
- What they see: big-ticket order board with age-warning colours + audio ping on every new order.

## QR print sheets
- URL: `https://armenu.co.za/qr-print.html?r=<slug>&type=tables|dishes|menu`
- Auth: same `ADMIN_SECRET`
- Prints A4-ready QR sheets at 4, 6, or 9 per page.

## Env vars in Vercel (Settings → Environment Variables)
| Var | Status |
|---|---|
| `ADMIN_SECRET` | You set this; use it to log into `/admin/` |
| `NEXT_PUBLIC_SUPABASE_URL` | You set this |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | You set this |
| `SUPABASE_SERVICE_ROLE_KEY` | You set this |
| `CLERK_SECRET_KEY` | You set this |
| `STAFF_SECRET` | If not set, falls back to `ADMIN_SECRET`. Set to a long random string for production. |
| `MESHY_API_KEY` | Not set yet. Needed only for AR Studio dish generation. |
| `ANTHROPIC_API_KEY` | Not set yet. Needed only for AI Menu Reader. |
| `PADDLE_*` | Not set yet. Needed only when you turn on billing. |

To check or update any of these: Vercel → your project → Settings → Environment Variables → edit or add → then Redeploy.
