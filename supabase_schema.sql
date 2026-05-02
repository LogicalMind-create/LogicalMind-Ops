-- ================================================================
-- LogicalMind Ops — Supabase Schema
-- Run this in your Supabase SQL editor (new project, not the PDF store)
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
-- Phase 2 tables (add when ready):
-- ─────────────────────────────────────────────────────────────────

create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  channel       text default 'smartbiz',
  external_id   text unique,
  customer_name text,
  product_name  text,
  sku           text,
  quantity      int default 1,
  amount        numeric(10,2),
  status        text default 'pending',
  awb           text,
  scraped_at    timestamptz default now(),
  shipped_at    timestamptz,
  delivered_at  timestamptz,
  created_at    timestamptz default now()
);

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
-- Phase 3 tables:
-- ─────────────────────────────────────────────────────────────────

-- create table if not exists whatsapp_broadcasts (
--   id           uuid primary key default gen_random_uuid(),
--   message      text not null,
--   group_filter text default 'all',
--   status       text default 'queued' check (status in ('queued','approved','sending','sent','failed')),
--   approved_by  text,
--   queued_at    timestamptz default now(),
--   sent_at      timestamptz
-- );

-- ─────────────────────────────────────────────────────────────────
-- Phase 4 tables:
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
