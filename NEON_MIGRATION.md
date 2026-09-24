# Moving off Supabase (which auto-pauses)

Supabase's free tier pauses your project after ~7 days of inactivity. For a live restaurant product this is a non-starter. Options ranked:

## Option 1 (recommended): **Neon**
- Postgres, same dialect as Supabase, so `backend/schema.sql` runs unchanged.
- **Free tier does not pause** — it scales to zero compute but resumes in <1 second on the first request. No week-long outages, no manual restore.
- 0.5 GB storage on free.
- Serverless-friendly HTTP driver (great for Vercel).

### Migration steps (about 15 minutes)

1. Sign up at https://neon.tech, create a project.
2. Neon dashboard → SQL Editor → paste `backend/schema.sql` → Run.
3. Neon dashboard → Connection Details → copy the pooled connection string. It looks like:
   `postgres://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`
4. Replace two env vars in Vercel → Project → Settings → Environment Variables:
   - Remove `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - Add `DATABASE_URL` = the Neon pooled connection string
5. Swap the DB client in `api/_db.js`:
   ```js
   // Before (Supabase):
   import { createClient } from '@supabase/supabase-js';
   export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

   // After (Neon serverless HTTP driver):
   import { neon } from '@neondatabase/serverless';
   export const sql = neon(process.env.DATABASE_URL);
   ```
6. Run `npm install @neondatabase/serverless` and remove `@supabase/supabase-js` from `package.json`.
7. Rewrite the query pattern in each handler (about 30 handlers under `api/_h/`) from `supabase.from(...).select(...).eq(...)` to `sql\`SELECT ... FROM ... WHERE ...\``.

Trade-off: Neon has no built-in Storage bucket (Supabase does). For AR Studio to keep hosting generated `.glb` files, we need one of:
- Cloudflare R2 (free 10 GB, S3-compatible) — recommended
- Backblaze B2 (free 10 GB)
- Vercel Blob Storage (free 500 MB per project)

## Option 2: **Supabase Pro** ($25/month)
Zero code changes. `NEVER_PAUSE` is default. Same product, same auth, same storage. Fastest fix if you don't want to migrate. https://supabase.com/pricing

## Option 3: **Vercel Postgres + Vercel Blob**
- Vercel Postgres is Neon under the hood. Free tier 256 MB.
- Vercel Blob for storage (free 500 MB, 500 GB egress).
- Zero external services. All configured in one dashboard.
- Same code migration as Neon (Postgres HTTP driver).

## Option 4: **Turso** (SQLite)
- Free 500 databases, 9 GB, no pausing.
- HTTP driver, super fast at the edge.
- Would need schema rewritten from Postgres to SQLite (JSONB → TEXT, arrays → JSON, some syntax changes). Bigger job.

## My recommendation
**Supabase Pro for the next 30 days** while you validate the product with real restaurants — no downtime risk, zero code changes, $25 well spent. If growth justifies, migrate to **Neon + R2** afterwards for lower long-term cost and no pause-risk on the free tier.

If you want to migrate now, say the word and I'll write the Neon-flavoured `_db.js`, port the 30 handlers, and cut over.
