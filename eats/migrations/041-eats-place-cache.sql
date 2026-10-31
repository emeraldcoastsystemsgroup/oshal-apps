-- =============================================================================
-- Migration 041: Eats place cache (what Google answered, kept up to 30 days)
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                                    | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-10-30   | maintainer@emeraldcoastsystemsgroup.com   | Address lookups, restaurant
--              | searches and restaurant cards as Google Places / Geocoding answered them,
--              | so the app serves what it already holds and still answers at Google's quota.
-- -----------------------------------------------------------------------------
-- Google's terms: place ids may be kept indefinitely; other Places and Geocoding content
-- for at most 30 consecutive days, so every row carries expires_ms and is never served
-- past it. Keys carry the person (tables are per person on the native kernel; the key keeps
-- a shared database correct too). Epoch milliseconds, read the same by every engine.
-- One-column text keys, plain INSERT after DELETE by key: no ON CONFLICT (the native
-- kernel materializes it), nothing ordered or grouped on these tables.
-- =============================================================================

CREATE TABLE IF NOT EXISTS eats_place_lookups (
  lookup_key  TEXT PRIMARY KEY,
  user_sub    VARCHAR(255) NOT NULL,
  address     TEXT NOT NULL,
  place_id    TEXT NOT NULL,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  source      TEXT NOT NULL,
  fetched_ms  BIGINT NOT NULL,
  expires_ms  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS eats_search_cache (
  search_key  TEXT PRIMARY KEY,
  user_sub    VARCHAR(255) NOT NULL,
  query       TEXT NOT NULL,
  place_id    TEXT NOT NULL,
  restaurants TEXT NOT NULL,
  fetched_ms  BIGINT NOT NULL,
  expires_ms  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS eats_places (
  place_key   TEXT PRIMARY KEY,
  user_sub    VARCHAR(255) NOT NULL,
  place_id    TEXT NOT NULL,
  card        TEXT NOT NULL,
  fetched_ms  BIGINT NOT NULL,
  expires_ms  BIGINT NOT NULL
);
