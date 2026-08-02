-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-30 04:20:00 | roger.murphy@emeraldcoastsystemsgroup.com   | The always-on scan's three owned tables: the durable snapshot the surface serves instantly, the config overrides behind the Settings tab, and the per-user first-seen alert ledger.
-- 2026-07-30 05:40:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Self-review: alerts carry a batch_id so the per-day budget counts ANNOUNCEMENTS, not hands.
--
-- Applied idempotently at activation (APP_PACKAGE_MIGRATIONS, tracked per (app, file) in
-- app_package_migrations). kalshi-scan-engine.ts ALSO creates these on first use, because that
-- flag is a flag — the app must work on a deployment where migrations are off.

-- The latest scan payload. ONE row (id = 1). In Postgres and not in memory on purpose: an
-- in-process cache dies on every api recreate, which is exactly when a cold 23-second feed
-- walk hurts most (the whole reason this rework exists).
CREATE TABLE IF NOT EXISTS kalshi_scan_snapshots (
  id           INTEGER PRIMARY KEY,
  payload      JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scan_ms      INTEGER
);

-- Config overrides on top of the manifest's settings.schema defaults.
--   scope_key = '__deployment__' → the cadence knobs (operator-only; one scan serves everyone)
--   scope_key = <user_sub>       → that person's alert knobs
-- A real OIDC sub can never collide with the sentinel: subs do not start with '__'.
CREATE TABLE IF NOT EXISTS kalshi_scan_settings (
  scope_key  TEXT PRIMARY KEY,
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The per-user alert ledger. UNIQUE (user_sub, ticker) is load-bearing twice: it is the
-- first-seen dedup key (an hourly scan re-finds the same hand every hour, and re-announcing it
-- is how an always-on feature teaches its owner to ignore it) AND the rolling-day budget's
-- counting table. Rows are written even when no transport delivered — an un-ledgered alert
-- would re-fire forever.
CREATE TABLE IF NOT EXISTS kalshi_scan_alerts (
  id         BIGSERIAL PRIMARY KEY,
  user_sub   TEXT NOT NULL,
  ticker     TEXT NOT NULL,
  strength   TEXT,
  edge_net   NUMERIC,
  channel    TEXT,
  delivered  BOOLEAN NOT NULL DEFAULT FALSE,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- batch_id groups the hands announced TOGETHER. The daily budget counts BATCHES: counting rows
  -- made `alertMaxPerDay: 6` behave like "6 hands/day" (~one announcement), which is not what the
  -- knob says (self-review 2026-07-30).
  batch_id   UUID,
  CONSTRAINT kalshi_scan_alerts_user_ticker UNIQUE (user_sub, ticker)
);

-- Idempotent for installs that created the table before batch_id existed.
ALTER TABLE kalshi_scan_alerts ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_kalshi_scan_alerts_user ON kalshi_scan_alerts (user_sub, created_at DESC);
