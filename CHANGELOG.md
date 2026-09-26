# Changelog

All notable changes to ARMenu. Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
in spirit but timestamped per work-session rather than by release.

## 2026-09-26 — Reservation confirmations + polish

### Added
- Transactional email via Resend (`api/_lib/mailer.js`) — no-op unless
  `RESEND_API_KEY` is set. Reservation flow sends a booking-received
  email to the guest and a booking-request email to the restaurant.
- `.ics` calendar attachment (RFC 5545) returned with every successful
  booking so the guest can add it even without email.
- Menu booking modal now shows a proper confirmation card with an
  "Add to calendar" download button.
- `/api/features` reports `email: true|false` so UI can adapt.
- `why.html` migrated to the shared marketing-chrome partial.
- Staff + kitchen login: `restaurant-slug` input now centre-aligned to
  match the PIN input.
- Vitest coverage: buildIcs + sendMail (7 new tests → 29 total, all green).

## 2026-09-26 — Post-audit hardening

### Added
- Manager team invites — owners can add co-managers by email who see the
  same portal + admin + kitchen + staff for that restaurant
  (`api/_h/portal/team.js`, `manager_users` table).
- Master-admin cookie session — `/api/admin/login` sets an httpOnly,
  HMAC-signed cookie so the password never lives in `sessionStorage`.
- `.empty-state`, `.sk-line`, `.sk-card`, `.btn-spinner` in
  `vendor/armenu-a11y.css`.
- `vendor/marketing-chrome.js` — shared marketing nav + footer partial;
  `contact/faq/how/plans` use it via `<div id="mkNav">` / `<div id="mkFooter">`.
- Split-bill even-split calculator on staff order cards.
- `vendor/armenu-a11y.css` on every page: `:focus-visible` outlines,
  reduced-motion, skip-link style.
- Sentry client now respects `armenu_cookie_consent_v1: 'essential'`.
- Push send failures other than 404/410 forwarded to Sentry with
  restaurant_id + status_code.
- Kitchen ticket ages tick every second between polls.
- `/api/portal/dashboard` combined endpoint for the portal 4-tile row.
- `/api/events` uses raw COUNT queries instead of pulling rows.
- Email normalisation on `restaurants.email` and reservation
  `guest_email` (trim + lowercase + syntax check).

### Fixed
- Postgres array serialisation in the `api/_db.js` shim: `text[]`,
  `int[]`, `uuid[]` columns get proper `{a,b,c}` literals via a
  `PG_ARRAY_COLS` whitelist instead of being JSON-stringified.
- Shim `Query.then` didn't return the exec promise, breaking `.catch()`
  chains. Also added `.finally()`.
- Upsert with no `onConflict` clause now emits `ON CONFLICT DO NOTHING`.
- `restaurants.email` unique constraint dropped so multi-location works.
- Order-items insert failure now rolls back the parent order (was
  leaving empty orders in the kitchen board).
- Reserved-slug list expanded — signup, login, robots, sitemap, etc.
- Admin 401 → portal redirect (managers no longer land on the
  admin-password prompt they can't get past).
- Language switcher on menu shown based on translation availability.
- Lazy-load dish thumbnails via IntersectionObserver.
- Cart wrapper `{ ts, items }` with 24h expiry (was stale-forever).

## Earlier sessions

See `NOTES_TODO.md` for a session-by-session log going back to the
Session A/B/C build batches (cart persistence, tips, modifiers, offer
edit, PWA install, kiosk idle timeout, audit log, per-restaurant
favicon, waiter→table assignment, walk-in queue, multi-currency toggle,
etc.) and the initial credits/Sentry/cookie work.
