# ARMenu — Continuing Build Notes

Read this at the start of every session. Update it as you ship. Commit changes.

## Recently shipped (2026-09-26)

- Fixed PG array serialisation in `api/_db.js` shim (dish tags, category_ids, days_of_week, enabled_languages)
- Fixed Query.then not returning promise chain; upsert with no onConflict now emits ON CONFLICT DO NOTHING
- Dropped `restaurants.email` unique constraint → multi-location works
- Order-items insert now rollbacks parent order + logs on failure
- Menu language switcher exposed based on translations; cart 24h expiry `{ ts, items }`
- Lazy-load dish thumbnails via IntersectionObserver
- Combined portal dashboard endpoint (`/api/portal/dashboard`)
- Reserved-slug list expanded
- Admin 401 → portal redirect (no more admin-password prompt for managers)
- Kitchen ticket ages tick every second between polls (no more stale age)
- Push send: unexpected failures forwarded to Sentry with context
- A11y layer: `vendor/armenu-a11y.css` on every page (focus-visible rings + reduced-motion)
- Sentry client honours cookie-consent "essential only"
- Email normalisation on `restaurants.email` insert and reservation `guest_email`

## Not-Done — priority order

Pick the top item, do it, commit, push, tick it off here.

### Real bugs / functional gaps
1. **#25 Manager team member invites** — no way for a manager to add a second staff account to their restaurant. Needs `manager_users` join table + invite email + portal UI.
2. **#27 ADMIN_SECRET in sessionStorage** — vulnerable to XSS. Refactor: server issues httpOnly cookie session token from a new `/api/admin/login`, admin pages send that cookie instead of a header. Deprecate the header path over one release.
3. **#29 Rate limit needs Redis** — current in-memory limiter is per-instance; on Vercel each cold start resets it. Blocked on Upstash Redis credentials from user.
4. **#46 Currency toggle for non-ZAR restaurants** — settings currently hard-code ZAR display. Add `restaurants.currency_code` + format helpers on client (menu.html, admin, staff, kitchen).
5. **#9-related: cart resume prompt** — if a customer has a saved cart on table A and scans table B, quietly discard A (already isolated by key) but consider a "You had 3 items at Table 5 earlier. Move them here?" prompt.

### UX / polish
6. **#40 Empty-state helper** — canonical `<div class="empty-state">` component used across admin dishes/orders/reviews/reservations. Currently each page rolls its own.
7. **#42 Button emoji vs text rule** — some admin buttons mix `🍳 Kitchen` and plain `Kitchen`. Standardise: icon before text, spacing, sr-only when icon-only.
8. **#44 Marketing pages nav+footer partial** — `contact.html faq.html how.html plans.html why.html` each copy the top nav and footer. Extract to `/vendor/marketing-chrome.js` (or SSI include if we go server-render).
9. **Loading state consistency (#41)** — spinner vs skeleton vs "Loading…" text is inconsistent. Pick one per surface (skeleton for cards, spinner for buttons).

### Docs / hygiene
10. **#52 CHANGELOG.md** — write one from `git log --oneline` since first commit; keep it updated per release.
11. **#53 README.md upgrade** — currently minimal. Add: architecture diagram, env vars table, local dev instructions, deploy notes.
12. **#54 CLAUDE.md** — capture repo-specific conventions (single-catch-all API dispatcher, shim query builder, PG array whitelist, Clerk auth boundary).
13. **#55 Basic test suite** — at minimum, vitest tests for `_db.js` (array serialisation, encodeVal), `_auth.js` (token verify), `admin/scope-guard` (403 out-of-scope).
14. **#56 CI** — GitHub Actions: lint + tests on PR; auto-deploy preview on push to non-main.

### Blocked on user
- Sentry DSN env var → SENTRY_DSN
- PayFast merchant credentials → for real credit purchases
- Meshy API key → 3D model generation
- Anthropic API key → AI menu reader / ai-generate
- Upstash Redis creds → distributed rate limit
- Wildcard DNS for `*.armenu.co.za` subdomain restaurants

## Working style

- Commit every few edits with a clear message. Never leave the tree dirty at end of session.
- Always `git push` after commit — no local-only work.
- If a fix is bigger than expected, note it here and move to the next item.
- Test what you can locally with node + a quick harness; UI changes need at least a mental walkthrough.
- Don't ask the user questions — pick the reasonable choice and ship.
