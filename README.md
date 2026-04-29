# AR Menu

South Africa's first augmented-reality menu platform.
Diners scan a QR code beside any dish — the meal appears on their table, life-size, photo-real, no app.

> **Production domain:** [armenu.co.za](https://armenu.co.za) *(once deployed)*

---

## What's in this repository

| Path | What it is |
|---|---|
| `index.html` | Public landing page — sells AR Menu to restaurants |
| `view.html` | The page diners hit after scanning a QR code · the AR launcher |
| `admin/` | **Boss panel** (owner-only) — clients, dishes, stats, monthly reports |
| `portal/` | **Restaurant portal** — your clients log in to download QRs &amp; request changes |
| `backend/` | Cloudflare Workers API + D1 schema + QR &amp; report generators |
| `SETUP.md` | Step-by-step deploy guide (~60 minutes end-to-end) |
| `BUSINESS_PLAN.md` | Strategy, market analysis, milestones, 5-year vision |
| `PRICING.md` | Internal pricing structure &amp; objection handling |
| `SALES_PLAYBOOK.md` | Cold-pitch script, scanning SOP, leave-behind one-pager |
| `LAUNCH_CHECKLIST.md` | What to do, in order, from week 1 to month 12 |

---

## Quick start

1. Read `SETUP.md` and follow it end-to-end (~60 min)
2. Read `BUSINESS_PLAN.md` and `PRICING.md` once
3. Print `SALES_PLAYBOOK.md` and start walking into restaurants
4. Use `LAUNCH_CHECKLIST.md` as your daily compass

---

## Tech stack

| Layer | Service | Cost |
|---|---|---|
| Domain registration | Host Africa | ~R100/year |
| DNS &amp; CDN | Cloudflare | Free |
| Static hosting | Cloudflare Pages | Free |
| API runtime | Cloudflare Workers | Free under 100k req/day |
| Database | Cloudflare D1 | Free under 5GB |
| File storage | Cloudflare R2 | Free under 10GB |
| Auth | Clerk | Free under 10k users |
| AR rendering | Google `<model-viewer>` (open source) | Free |
| 3D scanning | Polycam Pro | ~R200/month while scanning |
| Source control | GitHub | Free for private repos |

**Year 1 infrastructure cost: ~R3,500. All else is your time.**

---

## License

Private &amp; proprietary. © 2026 AR Menu (Pty) Ltd. All rights reserved.

---

## Maintainer

Founder · [hello@armenu.co.za](mailto:hello@armenu.co.za)
