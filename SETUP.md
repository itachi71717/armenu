# AR Menu — Setup &amp; Deploy Guide

This is your step-by-step. Every command, every account, every URL. Follow top-to-bottom and the system goes live on `armenu.co.za`.

---

## What you have right now

```
platear/
├── index.html               ← landing page (public)
├── view.html                ← AR viewer (what diners see after scanning QR)
├── admin/index.html         ← boss panel (you only)
├── portal/index.html        ← restaurant portal (your clients)
├── backend/
│   ├── src/
│   │   ├── index.js         ← Cloudflare Workers API (all routes)
│   │   ├── auth.js          ← Clerk JWT verification
│   │   ├── qr.js            ← QR code + PDF generator
│   │   └── report.js        ← Monthly report PDF generator
│   ├── schema.sql           ← D1 database schema (all tables)
│   ├── wrangler.toml        ← Cloudflare deploy config
│   └── package.json         ← dependencies
├── SETUP.md                 ← this file
├── BUSINESS_PLAN.md         ← business strategy doc
└── PRICING.md               ← pricing structure doc
```

---

## Step 1 — Install local tools (10 min)

You need:

1. **Node.js** (LTS): https://nodejs.org → install
2. **Git**: https://git-scm.com → install
3. **GitHub Desktop**: https://desktop.github.com → install + sign in to your GitHub account

Verify Node works:
```bash
node -v   # should print v20.x or higher
npm -v
```

---

## Step 2 — Get the code on GitHub (5 min)

1. Open **GitHub Desktop**
2. **File → Add local repository** → choose `C:\Users\Admin\claudetradingtest\platear`
3. It'll say "this folder doesn't have a git repo — create one"? → **Yes**
4. Top-right: **Publish repository**
5. Name: `armenu` · Private: **yes** (until launch) · Click Publish
6. Done — your code is on GitHub.

---

## Step 3 — Cloudflare account (5 min)

1. Sign up at https://dash.cloudflare.com/sign-up (free, no card needed for Workers free tier)
2. Verify email
3. Done — you'll come back to this dashboard in step 6

---

## Step 4 — Add your domain to Cloudflare (5 min)

You bought `armenu.co.za` at Host Africa. We're going to keep it there but point it at Cloudflare.

1. In Cloudflare dashboard → **Add a site** → enter `armenu.co.za`
2. Choose the **Free** plan
3. Cloudflare scans your DNS → click **Continue**
4. Cloudflare gives you **two nameservers** that look like `xyz.ns.cloudflare.com`. **Copy them.**
5. Open Host Africa control panel → manage `armenu.co.za` → **Nameservers** → paste both Cloudflare nameservers, save
6. Wait ~30 minutes (sometimes 2 hours). Cloudflare emails you when active.

---

## Step 5 — Clerk account for auth (5 min)

1. Sign up at https://clerk.com → free tier (10k users free)
2. **Create application** → name: `AR Menu`
3. Authentication → enable **Email** sign-in (you can add Google/SMS later)
4. From the dashboard, copy:
   - **Publishable key** (starts with `pk_`)
   - **Secret key** (starts with `sk_`)
5. Keep the tab open — you'll paste these in step 7

---

## Step 6 — Install Wrangler &amp; create resources (10 min)

Open a terminal in `C:\Users\Admin\claudetradingtest\platear\backend\`:

```bash
npm install
npx wrangler login          # opens browser → sign in with the Cloudflare account from step 3
npx wrangler d1 create armenu-db
```

The last command prints something like:
```
[[d1_databases]]
binding = "DB"
database_name = "armenu-db"
database_id = "abc123..."
```
→ **Copy the `database_id`** and paste it into `wrangler.toml` (replace `REPLACE_AFTER_d1_create`).

Now create the R2 bucket and run the schema:

```bash
npx wrangler r2 bucket create armenu-assets
npx wrangler d1 execute armenu-db --remote --file=./schema.sql
```

---

## Step 7 — Add secrets (3 min)

Still in `backend/`:

```bash
npx wrangler secret put CLERK_SECRET_KEY      # paste sk_... from Clerk
npx wrangler secret put CLERK_PUBLIC_KEY      # paste pk_... from Clerk
npx wrangler secret put OWNER_WHATSAPP        # paste your number, e.g. 27821234567
npx wrangler secret put IP_SALT               # paste any random 32-char string
```

---

## Step 8 — Deploy the API (2 min)

```bash
npx wrangler deploy
```

You'll get a URL like `https://armenu-api.<your-subdomain>.workers.dev`. That's your live API.

Test it:
```bash
curl https://armenu-api.<your-subdomain>.workers.dev/api/health
# → {"ok":true,"ts":...}
```

---

## Step 9 — Deploy the website (5 min)

In the project root (`platear/`):

```bash
npx wrangler pages deploy . --project-name=armenu --branch=main
```

You get a URL like `https://armenu.pages.dev`. **Live website.** Open it on your phone.

---

## Step 10 — Wire the custom domain (5 min)

In Cloudflare dashboard:

1. **Pages → armenu → Custom domains → Set up a custom domain**
2. Enter `armenu.co.za` → Cloudflare auto-creates DNS records
3. **Workers → armenu-api → Triggers → Add custom domain → `armenu.co.za/api/*`**

Wait 1–2 minutes. Now `https://armenu.co.za` serves the site, and `https://armenu.co.za/api/*` is the API.

---

## Step 11 — Create your owner account (3 min)

1. Open `https://armenu.co.za/admin/` → sign up with your email via Clerk
2. From the Cloudflare D1 console (or via wrangler), run:
   ```sql
   INSERT INTO owners (clerk_user_id, email, name, role)
   VALUES ('<your-clerk-user-id>', 'you@armenu.co.za', 'Your Name', 'owner');
   ```
3. Refresh the boss panel → you're in.

---

## Step 12 — First restaurant (5 min)

Create your first client through the boss panel (or via SQL for now):

```sql
INSERT INTO restaurants (slug, name, plan, status)
VALUES ('first-restaurant', 'First Restaurant', 'starter', 'live');
```

Upload a `.glb`, system generates QR PDF, you print it, stick it on the menu. **Done.**

---

## Total time end-to-end: ~60 minutes of clicking. R0 in costs (other than the domain you already bought).

---

## Things to do after launch

- [ ] Replace WhatsApp placeholder `27000000000` in `index.html` with your real number
- [ ] Add `hello@armenu.co.za` email forwarding via Cloudflare Email Routing (free)
- [ ] Reserve social handles: `@armenuza` on Instagram, TikTok, X, LinkedIn
- [ ] File trademark via [CIPC](https://cipc.co.za) (~R600)
- [ ] Buy `.com` and `armenus.co.za` for protection
- [ ] First pilot restaurant pitch (see `BUSINESS_PLAN.md`)

---

## What to do when something breaks

1. **API errors** → `wrangler tail` (live logs from your Worker)
2. **Page not loading** → Cloudflare Pages dashboard → Deployments → check build log
3. **Database issues** → `wrangler d1 execute armenu-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`
4. **Stuck** → DM the developer (you have the full code, any developer on Earth can pick this up)
