-- AR Menu — Supabase (PostgreSQL) schema
-- HOW TO RUN: go to supabase.com → your project → SQL Editor → paste this → Run

create table if not exists restaurants (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  email       text unique not null,
  created_at  timestamptz default now()
);

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

create index if not exists scans_restaurant_date on scans(restaurant_id, scanned_at);
create index if not exists scans_dish on scans(dish_id);

-- Pending sign-ups: people who signed up at /portal/ before a restaurant exists for their email.
-- Owner sees these in admin and either creates a restaurant for them or rejects.
create table if not exists pending_signups (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  restaurant_name text,
  phone           text,
  message         text,
  status          text default 'pending',
  created_at      timestamptz default now()
);
create unique index if not exists pending_signups_email on pending_signups(lower(email));
