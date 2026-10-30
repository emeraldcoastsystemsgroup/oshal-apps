-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Retain measured daily account observations under their exact owner, connection and account; never reconstruct balances from today's holdings.
CREATE TABLE IF NOT EXISTS trading_account_values (
 user_sub TEXT NOT NULL,
 connection_key TEXT NOT NULL,
 account_id TEXT NOT NULL,
 observed_day TEXT NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,
 equity DOUBLE PRECISION NOT NULL,
 cash DOUBLE PRECISION,
 PRIMARY KEY (user_sub, connection_key, account_id, observed_day)
);
