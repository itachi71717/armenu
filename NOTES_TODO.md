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

## Awaiting from Ian
- Sentry DSN (sign up at sentry.io — Google OAuth — copy DSN)
- Meshy plan choice → API key

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
