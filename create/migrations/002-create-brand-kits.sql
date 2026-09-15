-- CHANGE LOG
-- SEQ | AUTHOR | DESCRIPTION
-- 1 | maintainer@emeraldcoastsystemsgroup.com | One private issuer-qualified brand kit per person with optimistic revisions; the logo references an image the same owner uploaded; no role or grant changes.

CREATE TABLE IF NOT EXISTS create_brand_kits (
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 100000),
  kit JSONB NOT NULL CHECK (jsonb_typeof(kit) = 'object' AND octet_length(kit::text) <= 16384),
  logo_asset_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_issuer, owner_sub),
  FOREIGN KEY (logo_asset_id, owner_issuer, owner_sub) REFERENCES create_project_assets (asset_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS create_brand_kits_logo ON create_brand_kits (owner_issuer, owner_sub, logo_asset_id);

-- Identity is installed transaction-locally by the package from the verified framework actor, as
-- for projects. Empty/unset context denies every row. Operator status does not bypass ownership.
ALTER TABLE create_brand_kits ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'create_brand_kits'::regclass AND polname = 'create_brand_kits_exact_owner') THEN
    CREATE POLICY create_brand_kits_exact_owner ON create_brand_kits FOR ALL
      USING (owner_issuer = current_setting('create.owner_issuer', true) AND owner_sub = current_setting('create.owner_sub', true))
      WITH CHECK (owner_issuer = current_setting('create.owner_issuer', true) AND owner_sub = current_setting('create.owner_sub', true));
  END IF;
END $$;
