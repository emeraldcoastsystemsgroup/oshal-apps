-- CHANGE LOG
-- SEQ | AUTHOR | DESCRIPTION
-- 1 | maintainer@emeraldcoastsystemsgroup.com | One private issuer-qualified brand kit per person with optimistic revisions; the logo references an image the same owner uploaded; no role or grant changes.
-- 2 | maintainer@emeraldcoastsystemsgroup.com | FORCE row level security alongside ENABLE, for the same reason as the project tables: the owner of this table is the role the api connects as, and PostgreSQL exempts a table owner from its own row security unless the table is forced. This table does not exist on the installed database yet (only 001 has been applied there), so this is the fresh-install half of the repair - 003 carries the half that reaches an install where these statements have already run.
-- 3 | maintainer@emeraldcoastsystemsgroup.com | Give this table's exact-owner policy the same second arm on the platform identity that 001 and 004 carry. create_brand_kits has an owner_sub column, so core's catalog-driven /api/me export and delete discover it exactly as they discover the project tables, and once it is FORCEd the package-only arm would make that export return nothing and that delete remove nothing, both reporting success.

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

-- Identity is installed transaction-locally by the package from the verified framework actor, or
-- session-scoped by the platform GUC pool under the same person, as for projects. Empty/unset
-- context denies every row. Operator status does not bypass ownership.
ALTER TABLE create_brand_kits ENABLE ROW LEVEL SECURITY;
-- ENABLE alone exempts the table OWNER, which is the role the api connects as.
ALTER TABLE create_brand_kits FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'create_brand_kits'::regclass AND polname = 'create_brand_kits_exact_owner') THEN
    -- The second arm is the platform-wide stamp core's catalog-driven /api/me export and delete
    -- arrive with; this table carries owner_sub, so it is discovered by that path exactly as the
    -- project tables are. No operator bypass: oshal.is_operator is never consulted, and system
    -- work stamps both platform settings empty, which the <> '' guard rejects.
    CREATE POLICY create_brand_kits_exact_owner ON create_brand_kits FOR ALL
      USING (
           (owner_issuer = current_setting('create.owner_issuer', true)
            AND owner_sub = current_setting('create.owner_sub', true))
        OR (current_setting('oshal.current_sub', true) <> ''
            AND owner_issuer = current_setting('oshal.current_issuer', true)
            AND owner_sub    = current_setting('oshal.current_sub', true)))
      WITH CHECK (
           (owner_issuer = current_setting('create.owner_issuer', true)
            AND owner_sub = current_setting('create.owner_sub', true))
        OR (current_setting('oshal.current_sub', true) <> ''
            AND owner_issuer = current_setting('oshal.current_issuer', true)
            AND owner_sub    = current_setting('oshal.current_sub', true)));
  END IF;
END $$;
