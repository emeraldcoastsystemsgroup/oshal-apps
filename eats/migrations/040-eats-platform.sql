-- =============================================================================
-- Migration 040: Eats (Uber Eats concierge) platform tables
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-19   | roger.murphy@emeraldcoastsystemsgroup.com | Per-shopper food cart,
--              | profile, order-handoff history, and chat memory for the Eats app.
-- -----------------------------------------------------------------------------
-- Order model: Uber Eats checks out ONE restaurant per order, so a cart is scoped to a
-- store. Ordering is a DEEP-LINK HANDOFF — we record the handoff URL, never a payment.
-- Idempotent; the route's ensureEatsSchema mirrors this as a fallback.
-- =============================================================================

CREATE TABLE IF NOT EXISTS eats_profile (
  user_sub          VARCHAR(255) PRIMARY KEY,
  tenant_id         UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
  display_name      TEXT,
  dietary           TEXT[] NOT NULL DEFAULT '{}',
  favorite_cuisines TEXT[] NOT NULL DEFAULT '{}',
  default_address   TEXT,
  budget_per_order  NUMERIC(10,2),
  notes             TEXT,
  onboarded         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eats_carts (
  cart_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub    VARCHAR(255) NOT NULL,
  store_id    VARCHAR(64),
  store_name  TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eats_cart_items (
  row_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id     UUID NOT NULL REFERENCES eats_carts(cart_id) ON DELETE CASCADE,
  user_sub    VARCHAR(255) NOT NULL,
  store_id    VARCHAR(64),
  store_name  TEXT,
  item_id     VARCHAR(64),
  title       TEXT,
  price       NUMERIC(10,2),
  quantity    INT NOT NULL DEFAULT 1,
  emoji       TEXT,
  image_url   TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eats_orders (
  order_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub    VARCHAR(255) NOT NULL,
  store_id    VARCHAR(64),
  store_name  TEXT,
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  total       NUMERIC(10,2),
  handoff_url TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eats_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub        VARCHAR(255) NOT NULL,
  title           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eats_messages (
  message_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES eats_conversations(conversation_id) ON DELETE CASCADE,
  user_sub        VARCHAR(255) NOT NULL,
  role            VARCHAR(16) NOT NULL,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eats_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub    VARCHAR(255) NOT NULL,
  note        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_eats_feedback_user_note ON eats_feedback (user_sub, lower(note));
