-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Declare the owner-scoped watchlist the research routes create lazily, so a native kernel provisions it in a person's scope before the first read (the watchlist answered 502 "SQL schema is not provisioned" until something had been added).
CREATE TABLE IF NOT EXISTS oshal_trading_watchlist (user_sub TEXT NOT NULL, symbol TEXT NOT NULL, note TEXT, added_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_sub, symbol));
