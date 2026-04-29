-- AR Menu — Cloudflare D1 schema
-- Run with: wrangler d1 execute armenu-db --file=./schema.sql

PRAGMA foreign_keys = ON;

-- Owners (you + any staff). Auth provided by Clerk; clerk_user_id is the link.
CREATE TABLE IF NOT EXISTS owners (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_user_id TEXT UNIQUE NOT NULL,
  email        TEXT NOT NULL,
  name         TEXT,
  role         TEXT NOT NULL DEFAULT 'owner',  -- owner | staff
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Restaurants (your clients)
CREATE TABLE IF NOT EXISTS restaurants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT UNIQUE NOT NULL,        -- url path: armenu.co.za/r/<slug>
  name         TEXT NOT NULL,
  logo_url     TEXT,
  plan         TEXT NOT NULL DEFAULT 'starter',  -- starter | restaurant | chain
  mrr_cents    INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | live | paused
  contact_email TEXT,
  contact_phone TEXT,
  notes        TEXT,
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_restaurants_slug ON restaurants(slug);
CREATE INDEX IF NOT EXISTS idx_restaurants_status ON restaurants(status);

-- Restaurant managers (your clients' staff who log in to the portal)
CREATE TABLE IF NOT EXISTS managers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_user_id TEXT UNIQUE NOT NULL,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT,
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_managers_restaurant ON managers(restaurant_id);

-- Dishes
CREATE TABLE IF NOT EXISTS dishes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,                -- url path: armenu.co.za/v?r=<r>&d=<slug>
  name          TEXT NOT NULL,
  price_text    TEXT,                         -- e.g. "R 89"
  glb_key       TEXT NOT NULL,                -- R2 object key for the .glb
  usdz_key      TEXT,                         -- R2 object key for the .usdz (auto-converted)
  thumb_key     TEXT,                         -- R2 object key for thumbnail
  camera_orbit  TEXT DEFAULT '0deg 70deg 1m',
  qr_pdf_key    TEXT,                         -- R2 object key for the printable QR PDF
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | live | archived
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(restaurant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_dishes_restaurant ON dishes(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_dishes_status ON dishes(status);

-- Scan log (every QR scan)
CREATE TABLE IF NOT EXISTS scans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dish_id       INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  ts            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  ua            TEXT,                         -- truncated user-agent
  ip_hash       TEXT,                         -- hashed (privacy)
  country       TEXT,                         -- from CF-IPCountry
  is_ar_capable INTEGER DEFAULT 0,            -- bool 0/1 (best-effort)
  ar_activated  INTEGER DEFAULT 0             -- bool: did they tap "See my meal"
);
CREATE INDEX IF NOT EXISTS idx_scans_dish_ts ON scans(dish_id, ts);
CREATE INDEX IF NOT EXISTS idx_scans_restaurant_ts ON scans(restaurant_id, ts);

-- Change requests from the portal (managers asking for new dishes / edits)
CREATE TABLE IF NOT EXISTS requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  manager_id    INTEGER REFERENCES managers(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL,                -- new_dish | edit_dish | remove_dish | other
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open', -- open | quoted | done | declined
  notes         TEXT,
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_restaurant ON requests(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

-- Invoices (lightweight; full billing through Yoco/Stripe later)
CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,                -- 'YYYY-MM'
  amount_cents  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | paid | overdue
  paid_at       INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(restaurant_id, period)
);
CREATE INDEX IF NOT EXISTS idx_invoices_restaurant ON invoices(restaurant_id);

-- Helpful aggregate view: dish leaderboard for a restaurant
-- (D1 supports views; create-or-replace pattern)
DROP VIEW IF EXISTS v_dish_stats_30d;
CREATE VIEW v_dish_stats_30d AS
SELECT
  d.id            AS dish_id,
  d.restaurant_id AS restaurant_id,
  d.name          AS dish_name,
  d.slug          AS dish_slug,
  COUNT(s.id)     AS scans_30d,
  SUM(CASE WHEN s.ar_activated=1 THEN 1 ELSE 0 END) AS ar_activations_30d
FROM dishes d
LEFT JOIN scans s
  ON s.dish_id = d.id
 AND s.ts >= strftime('%s','now','-30 days')
GROUP BY d.id;
