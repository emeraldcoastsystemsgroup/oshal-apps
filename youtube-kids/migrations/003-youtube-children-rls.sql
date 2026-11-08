-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | RP-KL-01: forced exact-owner row-level security on oshal_youtube_children and oshal_youtube_activity so neither table relies solely on route predicates on PostgreSQL. Skipped on the native kernel via nativeMigrations where each person's rows live in their own physical per-person scope.
-- -----------------------------------------------------------------------------

ALTER TABLE oshal_youtube_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_youtube_children FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'oshal_youtube_children'
       AND policyname = 'oshal_youtube_children_owner'
  ) THEN
    CREATE POLICY oshal_youtube_children_owner ON oshal_youtube_children AS PERMISSIVE FOR ALL
      USING (user_sub = nullif(current_setting('oshal.current_sub', true), ''))
      WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub', true), ''));
  END IF;
END $$;

ALTER TABLE oshal_youtube_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_youtube_activity FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'oshal_youtube_activity'
       AND policyname = 'oshal_youtube_activity_owner'
  ) THEN
    CREATE POLICY oshal_youtube_activity_owner ON oshal_youtube_activity AS PERMISSIVE FOR ALL
      USING (user_sub = nullif(current_setting('oshal.current_sub', true), ''))
      WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub', true), ''));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema() AND c.relname = 'oshal_youtube_children' AND c.relkind = 'r'
       AND c.relrowsecurity AND c.relforcerowsecurity
       AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'oshal_youtube_children_owner')
  ) THEN
    RAISE EXCEPTION 'youtube-kids: row security is not forced with an owner policy on oshal_youtube_children';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema() AND c.relname = 'oshal_youtube_activity' AND c.relkind = 'r'
       AND c.relrowsecurity AND c.relforcerowsecurity
       AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'oshal_youtube_activity_owner')
  ) THEN
    RAISE EXCEPTION 'youtube-kids: row security is not forced with an owner policy on oshal_youtube_activity';
  END IF;
END $$;
