-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Quant desk research records in their own table, so nightly price digests never slow the reads the every-minute watcher makes of the portfolio records. Research only: nothing here authorizes an order.
CREATE TABLE IF NOT EXISTS trading_quant_records (
 user_sub TEXT NOT NULL,
 kind TEXT NOT NULL,
 record_key TEXT NOT NULL,
 payload TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY (user_sub, kind, record_key)
);
