-- AR Menu — Supabase (PostgreSQL) schema (v2, 4D-parity expansion)
-- Safe to re-run: every statement uses `IF NOT EXISTS` or `ADD COLUMN IF NOT EXISTS`.
-- HOW TO RUN: Supabase → SQL Editor → paste → Run.

-- ============ CORE (existing) ============
create table if not exists restaurants (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  email       text not null,     -- NOT unique — one manager email can own multiple restaurants
  created_at  timestamptz default now()
);
create index if not exists restaurants_email_idx on restaurants (lower(email));
-- Drop the legacy unique constraint if it exists from an older migration
alter table restaurants drop constraint if exists restaurants_email_key;

create table if not exists dishes (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  slug          text not null,
  name          text not null,
  price         text,
  glb_url       text not null,
  usdz_url      text,
  thumb_url     text,
  camera_orbit  text,
  active        boolean default true,
  created_at    timestamptz default now(),
  unique(restaurant_id, slug)
);

create table if not exists scans (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  dish_id       uuid references dishes(id) on delete set null,
  user_agent    text,
  scanned_at    timestamptz default now()
);

create table if not exists requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  message       text not null,
  status        text default 'pending',
  created_at    timestamptz default now()
);

create table if not exists pending_signups (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  restaurant_name text,
  phone           text,
  message         text,
  status          text default 'pending',
  created_at      timestamptz default now()
);

create index if not exists scans_restaurant_date on scans(restaurant_id, scanned_at);
create index if not exists scans_dish on scans(dish_id);
create unique index if not exists pending_signups_email on pending_signups(lower(email));

-- ============ V2 EXPANSION ============

-- Categories (Starters / Mains / Desserts / Drinks / etc.)
create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  name          text not null,
  slug          text not null,
  sort_order    int  default 0,
  active        boolean default true,
  created_at    timestamptz default now(),
  unique(restaurant_id, slug)
);

-- Attach dishes to categories + support ordering/description/i18n/allergens
alter table dishes add column if not exists category_id  uuid references categories(id) on delete set null;
alter table dishes add column if not exists description  text;
alter table dishes add column if not exists sort_order   int default 0;
alter table dishes add column if not exists allergens    text;                    -- comma-sep e.g. "gluten,dairy"
alter table dishes add column if not exists translations jsonb default '{}'::jsonb; -- { "de": {"name": "...", "description": "..."}, "af": {...} }
alter table dishes add column if not exists price_cents  int;                     -- normalised (currency held on restaurant_settings)
alter table dishes add column if not exists scale        real default 1.0;         -- real-world scale multiplier for AR (1.0 = as-generated; owner adjusts in AR Studio)
alter table dishes add column if not exists ar_source    text;                     -- 'upload' | 'ai' | 'manual' — used to enable "regenerate" only for AI dishes

create index if not exists dishes_category on dishes(category_id);

-- Per-restaurant settings — feature flags, branding, currency, langs, google reviews
create table if not exists restaurant_settings (
  restaurant_id       uuid primary key references restaurants(id) on delete cascade,
  -- Feature flags — optional modules (owner can turn off if they have their own POS)
  orders_enabled      boolean default false,
  waiter_call_enabled boolean default false,
  kitchen_display     boolean default false,
  reviews_enabled     boolean default true,
  tables_enabled      boolean default false,
  -- Branding
  logo_url            text,
  cover_url           text,
  theme_primary       text default '#ff5722',
  theme_bg            text default '#0a0806',
  tagline             text,
  -- Locale
  default_currency    text default 'ZAR',
  currency_symbol     text default 'R',
  default_language    text default 'en',
  enabled_languages   text[] default array['en'],   -- e.g. {'en','de','af','zu'}
  -- Integrations
  google_review_url   text,
  -- Plan / billing
  plan                text default 'starter',       -- starter | pro | premium | enterprise
  subscription_status text default 'inactive',      -- inactive | active | past_due | cancelled
  paddle_subscription_id text,
  -- Meta
  updated_at          timestamptz default now()
);

-- Menu schedules (breakfast/lunch/dinner auto-switching). A dish or category
-- is visible only when the current time-of-day falls inside an active window.
create table if not exists menu_schedules (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  name          text not null,                     -- 'Breakfast', 'Lunch', 'Dinner'
  starts_at     time not null,                     -- 07:00
  ends_at       time not null,                     -- 11:00
  days_of_week  int[] default array[0,1,2,3,4,5,6], -- 0=Sun..6=Sat
  category_ids  uuid[] default array[]::uuid[],
  active        boolean default true,
  created_at    timestamptz default now()
);

-- Time-boxed offers (happy hour / weekend specials)
create table if not exists offers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  name          text not null,
  discount_pct  int not null,                      -- 15 = 15% off
  starts_at     time not null,
  ends_at       time not null,
  days_of_week  int[] default array[0,1,2,3,4,5,6],
  dish_ids      uuid[] default array[]::uuid[],    -- empty = whole menu
  active        boolean default true,
  created_at    timestamptz default now()
);

-- Tables (each has its own QR that pins order/waiter-call to that seat)
create table if not exists restaurant_tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  label         text not null,                     -- 'T-12', 'Bar-3', 'Patio-A'
  seats         int default 2,
  status        text default 'available',          -- available | occupied | reserved | vip | cleaning
  updated_at    timestamptz default now(),
  unique(restaurant_id, label)
);

-- Staff (floor waiters). PIN log-in on staff/index.html.
create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  name          text not null,
  pin_hash      text not null,                     -- sha256 of PIN + restaurant_id salt
  role          text default 'waiter',             -- waiter | manager
  active        boolean default true,
  last_login_at timestamptz,
  created_at    timestamptz default now(),
  unique(restaurant_id, name)
);

-- Orders (created by diner OR staff-taken). Kitchen sees NEW/PREP.
create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  table_id      uuid references restaurant_tables(id) on delete set null,
  table_label   text,                              -- denormalised (survives table deletion)
  taken_by      uuid references staff(id) on delete set null, -- null = guest self-ordered
  source        text default 'guest',              -- guest | staff
  status        text default 'new',                -- new | prep | ready | served | cancelled
  subtotal_cents int default 0,
  discount_cents int default 0,
  total_cents   int default 0,
  currency      text default 'ZAR',
  guest_note    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid references orders(id) on delete cascade,
  dish_id      uuid references dishes(id) on delete set null,
  dish_name    text not null,                      -- snapshot
  qty          int  not null default 1,
  price_cents  int  not null default 0,
  note         text,                               -- 'no onion', 'extra cheese'
  complimentary boolean default false
);

create index if not exists orders_restaurant_ts on orders(restaurant_id, created_at desc);
create index if not exists orders_status on orders(restaurant_id, status);
create index if not exists order_items_order on order_items(order_id);

-- Waiter call events (independent of orders — 'call waiter' button)
create table if not exists waiter_calls (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  table_id      uuid references restaurant_tables(id) on delete set null,
  table_label   text,
  reason        text,                              -- 'help' | 'bill' | 'water' | custom
  status        text default 'open',               -- open | acknowledged | closed
  created_at    timestamptz default now(),
  closed_at     timestamptz
);
create index if not exists waiter_calls_open on waiter_calls(restaurant_id, status, created_at);

-- Reviews (post-meal, 1-5 stars). 4-5★ can be routed to Google — the app
-- captures the click event but does not fake anything.
create table if not exists reviews (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  table_id      uuid references restaurant_tables(id) on delete set null,
  stars         int not null check (stars between 1 and 5),
  comment       text,
  routed_to_google boolean default false,
  created_at    timestamptz default now()
);
create index if not exists reviews_restaurant on reviews(restaurant_id, created_at desc);

-- Add settings row automatically for every existing restaurant
insert into restaurant_settings (restaurant_id)
  select id from restaurants
  where id not in (select restaurant_id from restaurant_settings)
on conflict do nothing;

-- =====================================================================
-- Manager team members (multi-user access to one restaurant)
-- A restaurant's primary email lives in restaurants.email — that person
-- is the "owner". Additional teammates are added here; portal/me.js
-- returns any restaurant whose id matches EITHER the owner email OR a
-- row in this table for the signed-in Clerk user's email.
-- =====================================================================
create table if not exists manager_users (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  email         text not null,
  role          text default 'manager',       -- 'manager' | 'viewer'
  invited_by    text,                          -- email of the inviter
  invited_at    timestamptz default now(),
  accepted_at   timestamptz,
  unique (restaurant_id, email)
);
create index if not exists manager_users_email on manager_users (lower(email));
create index if not exists manager_users_rest on manager_users (restaurant_id);

-- Cancellation tracking on orders (refund/return audit)
alter table orders add column if not exists cancelled_at  timestamptz;
alter table orders add column if not exists cancel_reason text;
create index if not exists orders_cancelled on orders(restaurant_id, cancelled_at) where cancelled_at is not null;

-- Web Push subscriptions (unique per endpoint for race-safe upsert)
create table if not exists push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  endpoint      text not null unique,
  keys          jsonb not null,
  role          text default 'manager',        -- 'kitchen' | 'waiter' | 'manager'
  user_label    text,
  active        boolean default true,
  created_at    timestamptz default now()
);
create index if not exists push_subs_restaurant on push_subscriptions(restaurant_id, active);
-- Older deploys without the unique constraint (idempotent):
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'push_subscriptions_endpoint_key'
  ) then
    alter table push_subscriptions add constraint push_subscriptions_endpoint_key unique (endpoint);
  end if;
end $$;

-- Staff PIN brute-force lockout tracking. A pruning job could delete rows
-- older than 24h; audit history for that period is small and cheap.
create table if not exists staff_login_attempts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid references restaurants(id) on delete cascade,
  ip             text,
  created_at     timestamptz default now()
);
create index if not exists staff_login_attempts_rest_ts on staff_login_attempts(restaurant_id, created_at desc);
create index if not exists staff_login_attempts_rest_ip on staff_login_attempts(restaurant_id, ip, created_at desc);

-- One-time data migration for legacy mixed-case email rows. Ensures every
-- .eq('email', lower(x)) query hits the row it should. Idempotent — running
-- again after new inserts (which are already lowercased) is a no-op.
update restaurants     set email = lower(email) where email is not null and email <> lower(email);
update manager_users   set email = lower(email) where email is not null and email <> lower(email);
update pending_signups set email = lower(email) where email is not null and email <> lower(email);

-- Restaurant local timezone (IANA name) — used for reservation emails,
-- push notifications, and any user-visible time formatting. Falls back
-- to Africa/Johannesburg when null. Managers can set this from settings.
alter table restaurant_settings add column if not exists timezone text;

-- Client-supplied idempotency key on orders. When a guest's checkout
-- request times out on the response leg (spotty mobile) the same key is
-- retried and the server short-circuits to return the existing order id
-- instead of creating a duplicate.
alter table orders add column if not exists client_order_id text;
create index if not exists orders_client_key on orders(restaurant_id, client_order_id, created_at desc) where client_order_id is not null;

-- Repoint dishes created with the old placeholder model URL (an R2 key that
-- never existed → 404 in model-viewer) at the statically served copy.
update dishes set glb_url = 'https://armenu.co.za/vendor/models/dish.glb'
 where glb_url = 'https://pub-6aeed51a836145e5be4673a4c349f0a9.r2.dev/vendor/models/dish.glb';
