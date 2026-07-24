-- =============================================================================
-- Migration 035: Purchasing Platform schema
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                          | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-18   | roger.murphy@agenticfederal.us  | Shopping concierge: per-shopper
--              | lists, list items, learned preferences, and checkout-handoff
--              | history. Public tenant + per-user (OIDC sub) isolation.
-- =============================================================================

-- Public tenant every shopper belongs to until an operator carves out more
-- (mirrors the lm_tenants pattern from migration 030).
CREATE TABLE IF NOT EXISTS shop_tenants (
  tenant_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       VARCHAR(64) UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO shop_tenants (tenant_id, slug, name)
  VALUES ('00000000-0000-4000-8000-00000000c001', 'public', 'Public Shoppers')
  ON CONFLICT (tenant_id) DO NOTHING;

-- ─── Lists ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shop_lists (
  list_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
  user_sub   VARCHAR(255) NOT NULL,               -- OIDC subject = the shopper
  name       TEXT NOT NULL DEFAULT 'My List',
  status     VARCHAR(20) NOT NULL DEFAULT 'active', -- active | archived
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_lists_user ON shop_lists (user_sub);

-- ─── List items ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shop_list_items (
  item_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     UUID NOT NULL REFERENCES shop_lists(list_id) ON DELETE CASCADE,
  user_sub    VARCHAR(255) NOT NULL,              -- denormalized for per-user scoping
  retailer    VARCHAR(40) NOT NULL DEFAULT 'walmart',
  product_id  VARCHAR(128),                       -- retailer SKU / ASIN / itemId
  title       TEXT,
  brand       TEXT,
  image_url   TEXT,
  product_url TEXT,                               -- tracked affiliate/product link
  quantity    INT NOT NULL DEFAULT 1,
  unit_price  NUMERIC(10,2),
  reason      TEXT,                               -- the explainable "why I added this"
  status      VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | purchased | removed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_items_list ON shop_list_items (list_id);
CREATE INDEX IF NOT EXISTS idx_shop_items_user ON shop_list_items (user_sub);

-- ─── Learned preferences (the brain) ─────────────────────────────────────────
-- One row per (shopper, normalized item intent). "add milk" -> the usual SKU.
CREATE TABLE IF NOT EXISTS shop_preferences (
  pref_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
  user_sub       VARCHAR(255) NOT NULL,
  item_key       VARCHAR(160) NOT NULL,           -- normalized intent, e.g. 'milk'
  retailer       VARCHAR(40),
  product_id     VARCHAR(128),
  title          TEXT,
  brand          TEXT,
  last_quantity  INT DEFAULT 1,
  last_unit_price NUMERIC(10,2),
  buy_count      INT NOT NULL DEFAULT 1,          -- how many times chosen (confidence)
  reason         TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_sub, item_key)
);
CREATE INDEX IF NOT EXISTS idx_shop_prefs_user ON shop_preferences (user_sub);

-- ─── Checkout-handoff history ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shop_purchase_history (
  purchase_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub    VARCHAR(255) NOT NULL,
  retailer    VARCHAR(40),
  order_ref   VARCHAR(255),                       -- retailer prepared-order id, if any
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  total       NUMERIC(10,2),
  handoff_url TEXT,                               -- the tracked checkout link handed off
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_history_user ON shop_purchase_history (user_sub);
