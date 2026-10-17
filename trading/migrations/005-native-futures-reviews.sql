-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | The native Futures study's research reviews (FUT-01 slice 3): one review per run, owner-scoped, with its attempt id fencing a late reply. A separate table because 004 is already applied.
CREATE TABLE IF NOT EXISTS oshal_trading_futures_native_reviews (run_id TEXT PRIMARY KEY, user_sub TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('reviewing','completed','failed')), attempt_id TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ, result TEXT, error TEXT);
CREATE INDEX IF NOT EXISTS idx_trd_fut_native_reviews_owner ON oshal_trading_futures_native_reviews (user_sub, requested_at DESC);
