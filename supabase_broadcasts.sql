-- Phase 3: WhatsApp Broadcasts queue
CREATE TABLE IF NOT EXISTS broadcasts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message     TEXT NOT NULL,
  drafted_by  TEXT DEFAULT 'agent',
  status      TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','sending','sent','failed')),
  group_filter TEXT DEFAULT 'all',  -- 'all' or comma-separated group names
  groups_total   INT DEFAULT 0,
  groups_sent    INT DEFAULT 0,
  approved_at TIMESTAMPTZ,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);
