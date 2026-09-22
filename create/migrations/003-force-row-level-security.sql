-- CHANGE LOG
-- SEQ | AUTHOR | DESCRIPTION
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Force row level security on every table this package owns, for installs where 001 and 002 have already been recorded as applied. The package migration runner tracks per (app, file) and never re-runs a file it has applied, so editing 001/002 repairs a FRESH install only; this file is what reaches an existing one. It ends by reading pg_class back and raising when any table is still enabled-but-not-forced, so a partial application cannot report success.

DO $$
DECLARE
  target TEXT;
  unforced TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['create_projects', 'create_project_revisions', 'create_project_assets',
                                'create_project_revision_assets', 'create_brand_kits'] LOOP
    -- A table this package declares but has not created means 001/002 did not run here. Fail
    -- loudly: the migration runner aborts the rest of this app's set and logs it, which is the
    -- honest outcome. Skipping quietly would leave the table unforced and report success.
    IF to_regclass('public.' || target) IS NULL THEN
      RAISE EXCEPTION 'create: % does not exist; migrations 001/002 have not been applied here', target;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
  END LOOP;

  -- Read the catalog back rather than trusting the statements above. relforcerowsecurity is the
  -- only thing that decides whether the exact-owner policy runs for the role that owns the table.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO unforced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN ('create_projects', 'create_project_revisions', 'create_project_assets',
                       'create_project_revision_assets', 'create_brand_kits')
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
  IF unforced IS NOT NULL THEN
    RAISE EXCEPTION 'create: row security is not enabled and forced on: %', unforced;
  END IF;
END $$;
