-- =============================================================================
-- Migration 045: Feeds index and per-person settings (package-owned on the native kernel)
-- -----------------------------------------------------------------------------
-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | The native kernel has no boot bootstrap and no
--   framework-resident feeds engine, so feed_settings never existed and Save reported success
--   while nothing was stored. The package now declares the two tables its routes read and write
--   (the platform's 045 schema, without the platform's bot seed); the kernel applies this on
--   install and reload. Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS feed_messages (
  user_sub        VARCHAR(255) NOT NULL,
  source          VARCHAR(32)  NOT NULL DEFAULT 'slack',
  channel_id      VARCHAR(64)  NOT NULL,
  channel_name    TEXT,
  channel_type    VARCHAR(16),
  author_id       VARCHAR(64),
  author_name     TEXT,
  text            TEXT,
  ts              VARCHAR(64)  NOT NULL,
  posted_at       TIMESTAMPTZ  NOT NULL,
  sentiment       NUMERIC(4,3),
  sentiment_label VARCHAR(16),
  sentiment_at    TIMESTAMPTZ,
  indexed_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_sub, source, channel_id, ts)
);
CREATE INDEX IF NOT EXISTS idx_feed_msgs_user_posted ON feed_messages (user_sub, posted_at DESC);

CREATE TABLE IF NOT EXISTS feed_settings (
  user_sub              VARCHAR(255) PRIMARY KEY,
  poll_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  poll_interval_minutes INT     NOT NULL DEFAULT 30,
  max_channels          INT     NOT NULL DEFAULT 25,
  per_channel           INT     NOT NULL DEFAULT 15,
  sentiment_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
