-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Owner-scoped portfolio classifications, declared outside snapshots, immutable strategy/backtest/review receipts. No broker orders or borrowing authority.
CREATE TABLE IF NOT EXISTS oshal_trading_portfolio_records (record_id TEXT NOT NULL, user_sub TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (user_sub, record_id));
CREATE INDEX IF NOT EXISTS idx_trading_portfolio_owner_kind ON oshal_trading_portfolio_records (user_sub, kind, created_at DESC);
