-- =============================================================================
-- Migration 050: Travel concierge tables (package-owned on the native kernel)
-- -----------------------------------------------------------------------------
-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | The native kernel has no boot bootstrap and its
--   price engine's ensureTravelSchema creates nothing, so travel's tables were never created and
--   every concierge message answered HTTP 500 from SQL. The package now declares the tables the
--   travel routes and the price engine use (the platform's ensureTravelSchema set); the kernel
--   applies this on install and reload. Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS travel_observations (
  obs_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         VARCHAR(8)  NOT NULL DEFAULT 'flight',
  route_key    VARCHAR(160) NOT NULL,
  origin       VARCHAR(8),
  destination  VARCHAR(64),
  depart_date  DATE,
  return_date  DATE,
  cabin        VARCHAR(16),
  carrier      VARCHAR(64),
  price        NUMERIC(10,2) NOT NULL,
  currency     VARCHAR(8)  NOT NULL DEFAULT 'USD',
  source       VARCHAR(16) NOT NULL DEFAULT 'duffel',
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_travel_obs_route ON travel_observations (route_key, observed_at DESC);

CREATE TABLE IF NOT EXISTS travel_profile (
  user_sub           VARCHAR(255) PRIMARY KEY,
  tenant_id          UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c002',
  display_name       TEXT,
  home_airport       VARCHAR(8),
  preferred_airlines TEXT[] NOT NULL DEFAULT '{}',
  preferred_cabin    VARCHAR(16) NOT NULL DEFAULT 'economy',
  seat_pref          VARCHAR(16),
  hotel_brands       TEXT[] NOT NULL DEFAULT '{}',
  avoid              TEXT[] NOT NULL DEFAULT '{}',
  budget_band        VARCHAR(16),
  loyalty            JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes              TEXT,
  onboarded          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travel_searches (
  search_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub    VARCHAR(255) NOT NULL,
  kind        VARCHAR(8)  NOT NULL DEFAULT 'flight',
  route_key   VARCHAR(160) NOT NULL,
  query       JSONB NOT NULL DEFAULT '{}'::jsonb,
  best_price  NUMERIC(10,2),
  currency    VARCHAR(8) DEFAULT 'USD',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_travel_searches_user ON travel_searches (user_sub, created_at DESC);

CREATE TABLE IF NOT EXISTS travel_watches (
  watch_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub        VARCHAR(255) NOT NULL,
  kind            VARCHAR(8)  NOT NULL DEFAULT 'flight',
  route_key       VARCHAR(160) NOT NULL,
  query           JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_price    NUMERIC(10,2),
  last_price      NUMERIC(10,2),
  currency        VARCHAR(8) DEFAULT 'USD',
  status          VARCHAR(16) NOT NULL DEFAULT 'active',
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_travel_watches_user ON travel_watches (user_sub, status);

CREATE TABLE IF NOT EXISTS travel_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub        VARCHAR(255) NOT NULL,
  title           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travel_messages (
  message_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES travel_conversations(conversation_id) ON DELETE CASCADE,
  user_sub        VARCHAR(255) NOT NULL,
  role            VARCHAR(16) NOT NULL,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travel_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub    VARCHAR(255) NOT NULL,
  note        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_travel_feedback_user_note ON travel_feedback (user_sub, lower(note));
