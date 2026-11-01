-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | The Quant desk's wider pool: one-column keys so a record is read and written by id. The old table's composite key sent every save through a read of the whole table, which at thousands of price digests would pass the kernel's scan limit. Prices sit apart so listing small records never reads through them.
CREATE TABLE IF NOT EXISTS trading_quant_store (
 id TEXT PRIMARY KEY,
 user_sub TEXT NOT NULL,
 kind TEXT NOT NULL,
 payload TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS trading_quant_prices (
 id TEXT PRIMARY KEY,
 user_sub TEXT NOT NULL,
 shard TEXT NOT NULL,
 payload TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL
);
