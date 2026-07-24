-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                          | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-13   | roger.murphy@agenticfederal.us  | Multi-tenant foundation: a school = a tenant. Additive — existing data belongs to the seeded default school; operators carve out a new school via an lm_tenants row with a matching email domain. Mirrors the bootstrap in ensureEducationSchema.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lm_tenants (
  tenant_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       VARCHAR(64) UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  domain     VARCHAR(255),                 -- email domain → auto-assign students to this school
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The built-in default school every pre-existing row belongs to.
INSERT INTO lm_tenants (tenant_id, slug, name)
  VALUES ('00000000-0000-4000-8000-00000000d001', 'default', 'Default School')
  ON CONFLICT (tenant_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_lm_tenants_domain ON lm_tenants (lower(domain)) WHERE domain IS NOT NULL;

ALTER TABLE lm_students ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000d001';
ALTER TABLE lm_classes  ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000d001';

-- To carve out a school, e.g.:
--   INSERT INTO lm_tenants (slug, name, domain) VALUES ('benton', 'Benton High', 'benton.k12.us');
-- Students signing in with @benton.k12.us emails are then provisioned into that
-- tenant and see only Benton's class bank.
