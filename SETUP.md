# AR Menu — Setup checklist

## Database migration
Run `backend/schema.sql` in your Supabase SQL Editor. Safe to re-run (uses `IF NOT EXISTS` everywhere).

## Environment variables (Vercel → Project → Settings → Environment Variables)

### Required (already in use)
| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key |
| `CLERK_SECRET_KEY` | Clerk backend (portal auth) |
| `ADMIN_SECRET` | The boss password for `/admin/` |

### New in v2
| Name | Purpose |
|---|---|
| `STAFF_SECRET` | HMAC secret for staff PIN tokens (falls back to `ADMIN_SECRET` if unset) |

### AI features (optional)
| Name | Purpose |
|---|---|
| `MESHY_API_KEY` | Meshy image-to-3D — `meshy.ai` → API Keys |
| `ANTHROPIC_API_KEY` | Claude Vision for AI Menu Reader |

### Paddle billing (optional)
| Name | Purpose |
|---|---|
| `PADDLE_ENV` | `sandbox` or `production` |
| `PADDLE_API_KEY` | From Paddle dashboard → Developer tools → Authentication |
| `PADDLE_WEBHOOK_SECRET` | Set when adding the destination in Paddle → Notifications |
| `PADDLE_PRICE_STARTER` | Price id for Starter plan |
| `PADDLE_PRICE_PRO` | Price id for Pro plan |
| `PADDLE_PRICE_PREMIUM` | Price id for Premium plan |

### Paddle webhook endpoint
Add in Paddle → Notifications → Destinations:
```
https://armenu.co.za/api/paddle/webhook
```
Events to subscribe: `subscription.created`, `subscription.activated`, `subscription.canceled`, `subscription.past_due`, `subscription.paused`, `transaction.completed`.

## Wildcard subdomain (optional but recommended)
1. Vercel dashboard → Project → Domains → Add `*.armenu.co.za`.
2. In your DNS (Host Africa) add:
   ```
   CNAME  *   cname.vercel-dns.com
   ```
3. Deploy. `middleware.js` at the repo root handles the rewrite. `<slug>.armenu.co.za` → the menu; `<slug>.armenu.co.za/t/<label>` → the table-pinned menu.

Reserved subs bypass the rewrite: `www`, `api`, `admin`, `portal`, `staff`, `app`, `preview`, `staging`.

## Post-deploy smoke test
1. `/admin/` → sign in with `ADMIN_SECRET`.
2. Pick a restaurant → **⚙ Manage modules & settings**.
3. Toggle **Order cart** on → open the restaurant menu in another tab → the "Order" button should appear.
4. Add a table (e.g. `T-1`) → open `/t/<slug>/T-1` → the menu should show a "Table · T-1" tag.
5. Add a staff PIN → open `/staff/` in a new browser → sign in → place a test order from the menu tab → it should appear on the staff console within ~3 seconds (SSE).
