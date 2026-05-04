-- ================================================================
-- LogicalMind Ops — Supabase Schema (Consolidated)
-- Run this ONCE in your Supabase SQL editor. It is idempotent
-- (uses IF NOT EXISTS) so it's safe to re-run.
-- ================================================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ── Tasks ────────────────────────────────────────────────────────
create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  person       text not null,
  title        text not null,
  due_date     date not null,
  notes        text default '',
  status       text not null default 'pending' check (status in ('pending','done')),
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists tasks_status_idx  on tasks(status);
create index if not exists tasks_person_idx  on tasks(person);
create index if not exists tasks_due_idx     on tasks(due_date);

-- ── Chat messages (agent history log) ───────────────────────────
create table if not exists chat_messages (
  id         uuid primary key default gen_random_uuid(),
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  run_id     uuid,
  created_at timestamptz not null default now()
);

create index if not exists chat_run_idx on chat_messages(run_id);

-- ── Agent runs (audit log) ───────────────────────────────────────
create table if not exists agent_runs (
  id         uuid primary key default gen_random_uuid(),
  tools_used text[],
  status     text default 'ok',
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────
-- Phase 2: Orders & Products
-- ─────────────────────────────────────────────────────────────────

create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  channel         text default 'smartbiz',
  external_id     text unique,
  customer_name   text,
  product_name    text,
  sku             text,
  quantity        int default 1,
  amount          numeric(10,2),
  status          text default 'pending',
  awb             text,
  order_date      timestamptz,
  scraped_at      timestamptz default now(),
  shipped_at      timestamptz,
  delivered_at    timestamptz,
  -- Customer address fields (populated by scraper from order detail page)
  customer_phone  text,
  customer_email  text,
  address_line1   text,
  address_line2   text,
  city            text,
  state           text,
  pincode         text,
  created_at      timestamptz default now()
);

create index if not exists orders_external_id_idx on orders(external_id);
create index if not exists orders_awb_idx         on orders(awb);
create index if not exists orders_status_idx      on orders(status);

create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  sku           text unique not null,
  name          text not null,
  weight_g      int,
  length_cm     numeric(6,2),
  breadth_cm    numeric(6,2),
  height_cm     numeric(6,2),
  shiprocket_id text
);

-- ─────────────────────────────────────────────────────────────────
-- Phase 3: WhatsApp Broadcasts
-- ─────────────────────────────────────────────────────────────────

create table if not exists broadcasts (
  id           uuid primary key default gen_random_uuid(),
  message      text not null,
  drafted_by   text default 'agent',
  status       text default 'draft' check (status in ('draft','approved','sending','sent','failed')),
  group_filter text default 'all',   -- 'all', 'tet', 'dsc', 'general', 'channel_rings'
  groups_total int  default 0,
  groups_sent  int  default 0,
  media_url    text,                  -- Optional: public URL to image or PDF
  media_type   text check (media_type in ('image', 'pdf')),
  error_reason text,                  -- Set when status=failed (helper / progress)
  approved_at  timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────
-- Migrations (safe to re-run — uses IF NOT EXISTS / IF EXISTS)
-- ─────────────────────────────────────────────────────────────────

-- Add media columns to broadcasts (for existing installs)
alter table broadcasts add column if not exists media_url  text;
alter table broadcasts add column if not exists media_type text check (media_type in ('image', 'pdf'));
alter table broadcasts add column if not exists error_reason text;

-- Add customer address columns to orders (for existing installs)
alter table orders add column if not exists customer_phone  text;
alter table orders add column if not exists customer_email  text;
alter table orders add column if not exists address_line1   text;
alter table orders add column if not exists address_line2   text;
alter table orders add column if not exists city            text;
alter table orders add column if not exists state           text;
alter table orders add column if not exists pincode         text;
alter table orders add column if not exists scraped_at      timestamptz default now();
alter table orders add column if not exists order_date      timestamptz;

-- ─────────────────────────────────────────────────────────────────
-- Phase 4 tables (uncomment when ready):
-- ─────────────────────────────────────────────────────────────────

-- create table if not exists payments (
--   id         uuid primary key default gen_random_uuid(),
--   amount     numeric(10,2) not null,
--   source     text,
--   note       text,
--   month      text,  -- 'YYYY-MM'
--   created_at timestamptz default now()
-- );

-- create table if not exists expenses (
--   id         uuid primary key default gen_random_uuid(),
--   amount     numeric(10,2) not null,
--   category   text,
--   note       text,
--   month      text,
--   created_at timestamptz default now()
-- );
