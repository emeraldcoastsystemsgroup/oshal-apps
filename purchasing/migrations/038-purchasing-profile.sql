-- =============================================================================
-- Migration 038: Purchasing user profile
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                          | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-19   | roger.murphy@agenticfederal.us  | Per-shopper profile the concierge
--              | fills out once (household size, dietary prefs, preferred store,
--              | budget) and uses to personalize every cart. Onboarded flag drives
--              | the first-run intro.
-- =============================================================================

CREATE TABLE IF NOT EXISTS shop_profile (
  user_sub        VARCHAR(255) PRIMARY KEY,
  tenant_id       UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
  display_name    TEXT,
  household_size  INT,
  dietary         TEXT[] NOT NULL DEFAULT '{}',   -- e.g. {organic, gluten-free, no-pork}
  brands_love     TEXT[] NOT NULL DEFAULT '{}',
  brands_avoid    TEXT[] NOT NULL DEFAULT '{}',
  preferred_retailer VARCHAR(40) NOT NULL DEFAULT 'walmart',
  preferred_store TEXT,                            -- store name / zip for pickup
  budget_monthly  NUMERIC(10,2),
  notes           TEXT,                            -- freeform remembered context
  onboarded       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
