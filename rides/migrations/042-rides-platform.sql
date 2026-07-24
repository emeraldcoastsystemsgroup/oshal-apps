-- =============================================================================
-- Migration 042: Rides (Uber Rides concierge) platform tables
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-19   | roger.murphy@emeraldcoastsystemsgroup.com | Per-rider profile, ride
--              | request handoff history, and chat memory for the Rides app.
-- -----------------------------------------------------------------------------
-- Ordering is a DEEP-LINK HANDOFF (m.uber.com/ul/) — we record the link, never a payment.
-- Idempotent; the route's ensureRidesSchema mirrors this as a fallback.
-- =============================================================================

CREATE TABLE IF NOT EXISTS rides_profile (
  user_sub          VARCHAR(255) PRIMARY KEY,
  tenant_id         UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
  display_name      TEXT,
  home_address      TEXT,
  work_address      TEXT,
  default_ride_type VARCHAR(20),
  notes             TEXT,
  onboarded         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rides_requests (
  request_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub      VARCHAR(255) NOT NULL,
  pickup        TEXT,
  dropoff       TEXT,
  ride_type     VARCHAR(20),
  est_fare_low  NUMERIC(10,2),
  est_fare_high NUMERIC(10,2),
  deep_link     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rides_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub        VARCHAR(255) NOT NULL,
  title           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rides_messages (
  message_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES rides_conversations(conversation_id) ON DELETE CASCADE,
  user_sub        VARCHAR(255) NOT NULL,
  role            VARCHAR(16) NOT NULL,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
