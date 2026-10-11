-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Declare the owner-scoped merchant-payments audit table the routes create lazily, so a native kernel provisions it in a person's scope before the first read (the history route answered 500 on an unprovisioned scope).
CREATE TABLE IF NOT EXISTS oshal_merchant_payments (
  charge_id TEXT NOT NULL,
  user_sub TEXT NOT NULL,
  provider TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL,
  raw_status TEXT,
  payer_url TEXT,
  test_mode BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, charge_id)
);
CREATE INDEX IF NOT EXISTS oshal_merchant_payments_user ON oshal_merchant_payments (user_sub);
