-- Phase 3: WhatsApp Broadcasts queue
CREATE TABLE IF NOT EXISTS broadcasts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message      TEXT NOT NULL,
  drafted_by   TEXT DEFAULT 'agent',
  status       TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','sending','sent','failed')),
  group_filter TEXT DEFAULT 'all',   -- 'all', 'tet', 'dsc', 'general', 'channel_rings'
  groups_total INT  DEFAULT 0,
  groups_sent  INT  DEFAULT 0,
  media_url    TEXT,                  -- Optional: public URL to image or PDF
  media_type   TEXT CHECK (media_type IN ('image', 'pdf')),  -- Required if media_url set
  approved_at  TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Migration: add media columns to existing table (safe to run multiple times)
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS media_url  TEXT;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS media_type TEXT CHECK (media_type IN ('image', 'pdf'));

-- Migration: ensure scraped_at exists in orders table for stat queries
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_date TIMESTAMPTZ;
