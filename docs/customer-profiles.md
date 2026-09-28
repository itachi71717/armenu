# Customer Profiles — Contract

## 1. Identity

Each browser generates a `customer_token` (random UUID v4) on first visit to
any restaurant's menu, stored in `localStorage['armenu_customer_token']`.
The token is never regenerated once present. The server maps `token` →
`customers` row (`customers.token`, unique) and never trusts a client-sent
`customer.id` — only the token. Tokens work cross-restaurant: one token, one
customer row, favourites spanning every restaurant.

**Phone-merge:** phone is the stronger identity signal. When a `PATCH
/api/customer/me` sets a `phone` that already belongs to a different
customer row, the two profiles merge: the **existing phone-owner row wins**
(kept as canonical), the token-only row's `customer_favourites` are
re-pointed to the winner (skip duplicates on the `(customer_id, dish_id)`
unique constraint), the losing row is marked `merged_into = <winner.id>`
(soft-tombstoned, not deleted), and any `orders.customer_id` pointing at the
loser is repointed to the winner. The browser keeps its original token in
localStorage; the server resolves token → merged-away row → winner
transparently on every subsequent lookup by following `merged_into`.

## 2. Schema (canonical — implemented in `schema.sql` by another agent)

```
customers            id uuid pk, token text unique, name text, phone text,
                      email text, allergies text[], dietary_prefs text[],
                      created_at, last_seen_at, merged_into uuid null (self-fk)
customer_favourites  customer_id uuid, dish_id uuid, restaurant_id uuid,
                      created_at, unique(customer_id, dish_id)
orders               + customer_id uuid null
```
Add `allergies`, `dietary_prefs` to `PG_ARRAY_COLS` in `api/_db.js`.

## 3. API contract

All routes registered in `api/index.js` → `api/_h/customer/*.js`. Guest-facing;
no `auditLog` required (not admin mutations).

**POST `/api/customer/hello`**
Req: `{ token }` — Res: `{ customer: { customer_token, name, phone, email, allergies, dietary_prefs } }`  (never leaks `id` or `merged_into`)
Upserts on `token` (creates row if unseen), bumps `last_seen_at`. If the
token resolves to a merged row, follow `merged_into` and return the winner.

**GET `/api/customer/me?token=...`**
Res: same `customer` shape + `favourites: [{ dish_id, restaurant_id, restaurant_slug, dish_slug, dish_name }]`.
404 if token unknown.

**PATCH `/api/customer/me`**
Req: `{ token, name?, phone?, email?, allergies?, dietary_prefs? }`
Res (normal): `{ customer: <updated> }`.
Res (merge triggered by a new `phone` colliding with another customer):
`{ customer: <other, i.e. winner>, merged: true }`.
400 if token unknown.

**POST `/api/customer/favourite`**
Req: `{ token, restaurant_slug, dish_slug }` — toggles the favourite.
Res: `{ favourited: bool }`. 404 if token/dish/restaurant unresolvable.

**DELETE `/api/customer/me?token=...`**
Hard-deletes the customer row and its `customer_favourites` (POPI
right-to-delete). Res: `{ deleted: true }`. Idempotent — 200 even if already
gone.

## 4. Order integration

`POST /api/order` accepts an optional `customer_token` in the body. When
present and resolvable, the handler looks up `customer_id` (following
`merged_into`) and stores it on the new `orders` row. Omitted or unresolvable
token → `orders.customer_id` stays null, no error, no behavior change.

## 5. UI touchpoints

- **Heart button** on dish cards in `menu.html` and on `view.html` — filled
  (favourited) state driven by `favourites` from `/api/customer/me`; click
  calls `/api/customer/favourite`. Must render (unfilled, functional) even
  on sold-out or filtered-out dishes — visibility of the dish, not its
  orderability, gates the heart.
- **Profile sheet**, opened from the header on `menu.html`: name / phone /
  allergies / dietary-prefs chips (editable, `PATCH /me`) + a favourites
  list, each entry linking to its dish (`restaurant_slug` + `dish_slug`).
- **Guest checkout form auto-prefill**: on opening the cart/guest form,
  prefill name/phone/allergies from the current customer profile if one
  exists (call `/api/customer/hello` on page load to get/create it).
