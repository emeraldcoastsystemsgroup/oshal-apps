-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Declare the three owner-scoped finance stores the routes create lazily, so a native kernel provisions them in a person's scope before the first read (finance status answered 500 on an unprovisioned scope).
CREATE TABLE IF NOT EXISTS oshal_finance_items (
  item_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  institution TEXT,
  access_token TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oshal_finance_items_user ON oshal_finance_items (user_sub);
CREATE TABLE IF NOT EXISTS oshal_finance_data (
  user_sub TEXT PRIMARY KEY,
  aggregate JSONB,
  brief TEXT,
  synced_at TIMESTAMPTZ,
  brief_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS oshal_finance_payments (
  transfer_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  provider TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL,
  payee TEXT,
  description TEXT,
  status TEXT NOT NULL,
  raw_status TEXT,
  test_mode BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oshal_finance_payments_user ON oshal_finance_payments (user_sub);
