-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | The native Futures study's forward research calls (FUT-01 slice 4): one frozen receipt per root per issuing run, owner-scoped, with its replay inputs and its later outcome. Research only; never an order.
CREATE TABLE IF NOT EXISTS oshal_trading_futures_native_predictions (prediction_id TEXT PRIMARY KEY, user_sub TEXT NOT NULL, run_id TEXT NOT NULL, root TEXT NOT NULL, contract TEXT, status TEXT NOT NULL CHECK (status IN ('pending','abstained','withheld','graded','unavailable')), reason TEXT, issued_at TIMESTAMPTZ NOT NULL, checked_at TIMESTAMPTZ, snapshot TEXT, outcome TEXT);
CREATE INDEX IF NOT EXISTS idx_trd_fut_native_pred_owner ON oshal_trading_futures_native_predictions (user_sub, issued_at DESC);
