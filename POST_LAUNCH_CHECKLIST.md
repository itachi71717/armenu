# ARMenu — Post-launch checklist

What to do to go live with real restaurants, after the code is deployed. Work top to bottom.

## 1. Deploy and migrate

- [ ] Deploy to Vercel production (`git push` to the production branch).
- [ ] Admin panel, then **Run migration** (or `POST /api/admin/migrate`). Required after every schema-touching deploy.
- [ ] Confirm `GET /api/features` returns the expected flags (`db`, `sentry`, `push`, `email`, plus `loyalty`, `combos`, `waitlist`, `analytics_deep`, `reviews_push`).
- [ ] Confirm `GET /api/health` (or the `/status` page) is green.
- [ ] Check the response headers on `/` (CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`).
- [ ] Load `/menu.html?r=<slug>`, `/portal/`, `/admin/` and confirm there are no CSP errors in the browser console. Check the 3D viewer, Clerk sign-in and Sentry.

## 2. Environment variables

- [ ] `ADMIN_SECRET` set to a strong value.
- [ ] `DATABASE_URL` set (Neon).
- [ ] Clerk publishable and secret keys set.
- [ ] `SENTRY_DSN` set (optional, silent no-op until set).
- [ ] `RESEND_API_KEY` set (email).
- [ ] `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` set (push).
- [ ] `MESHY_API_KEY` and `ANTHROPIC_API_KEY` set if AI features are wanted.
- [ ] Payment provider keys set (`PAYFAST_*` or `PADDLE_*`), or the WhatsApp fallback is accepted.

## 3. First restaurant smoke test

- [ ] Create the restaurant in the admin panel.
- [ ] Sign in to the portal as the manager.
- [ ] Add a dish with a `.glb` and check that AR opens on a real phone.
- [ ] Turn on **Track stock** for one dish and place a test order. Confirm the count goes down by the quantity ordered.
- [ ] Place a test order from the guest menu and check that it shows on the kitchen and staff screens.
- [ ] Book a test reservation. Live slot availability stays off unless the manager turns it on in settings.
- [ ] Print a table QR and scan it.

## 4. Monitoring

- [ ] Sentry receives a test error.
- [ ] Portal and admin nav badges update (they poll every 30 seconds).
- [ ] The audit log records admin actions.

## 5. Day-one support

- [ ] WhatsApp support number is live.
- [ ] `hello@armenu.co.za` reaches a person.
- [ ] Rollback plan noted: redeploy the previous Vercel build. Schema changes are additive, so no DB rollback is needed.
