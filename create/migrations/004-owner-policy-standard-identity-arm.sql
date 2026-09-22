-- CHANGE LOG
-- SEQ | AUTHOR | DESCRIPTION
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Satisfy the exact-owner policy from the PLATFORM identity as well as this package's own stamp. Forcing row security (003) makes the policy run for the role that owns these tables, and that role is also how core reaches them: /api/me export and delete discover every owner_sub-keyed public table from information_schema and query it as SELECT * FROM "<table>" WHERE "owner_sub"=$1 / DELETE FROM "<table>" WHERE "owner_sub"=$1 (src/features/data-lifecycle/services/discovered-exporters.ts:176,182), on a connection the GUC pool stamps with oshal.current_sub / oshal.current_issuer and never with create.owner_*. With only the package arm, that export returns zero rows and that delete removes nothing, both reporting success - a silent data-lifecycle regression. The second arm below is the same person by construction: the package actor and the platform stamp are both built from getCaller(req).sub and getAuthenticatedPrincipalIssuer(req) (src/app/middleware/application-authorization-identity.ts:64-66, src/app/server.ts:792-793). It is NOT an operator bypass - oshal.is_operator is never consulted here, and system/background work stamps both settings empty, which the <> '' guard rejects.

DO $$
DECLARE
  targets CONSTANT TEXT[] := ARRAY['create_projects', 'create_project_revisions', 'create_project_assets',
                                   'create_project_revision_assets', 'create_brand_kits'];
  -- Every one of these five tables carries its own owner_issuer/owner_sub pair - the derived
  -- revision and asset tables denormalise the owner rather than reaching it through the parent key
  -- (001 declares them NOT NULL and FOREIGN KEYs them to the parent's (id, owner_issuer, owner_sub)
  -- unique key), so both arms key on columns that are physically present on each table and neither
  -- arm needs a join or a security-definer helper.
  predicate CONSTANT TEXT := $pred$
       (owner_issuer = current_setting('create.owner_issuer', true)
        AND owner_sub = current_setting('create.owner_sub', true))
    OR (current_setting('oshal.current_sub', true) <> ''
        AND owner_issuer = current_setting('oshal.current_issuer', true)
        AND owner_sub    = current_setting('oshal.current_sub', true))
  $pred$;
  target TEXT;
  policy TEXT;
  present INTEGER;
  broken TEXT;
BEGIN
  FOREACH target IN ARRAY targets LOOP
    IF to_regclass('public.' || target) IS NULL THEN
      RAISE EXCEPTION 'create: % does not exist; migrations 001/002 have not been applied here', target;
    END IF;
    -- Refuse to rewrite a policy onto columns that are not there. A silent rename would otherwise
    -- produce a rule that denies every row forever, which is the failure this file exists to avoid.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = target AND column_name = 'owner_issuer')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = target AND column_name = 'owner_sub')
    THEN
      RAISE EXCEPTION 'create: %.owner_issuer/owner_sub is missing - refusing to write an owner policy with no owner columns', target;
    END IF;

    policy := target || '_exact_owner';
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = ('public.' || target)::regclass AND polname = policy) THEN
      -- ALTER, never DROP + CREATE: dropping leaves a window in which row security is on with no
      -- policy at all, which denies the application its own rows mid-migration.
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', policy, target, predicate, predicate);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL USING (%s) WITH CHECK (%s)',
                     policy, target, predicate, predicate);
    END IF;
  END LOOP;

  -- Read the catalog back rather than trusting the statements above. Both arms must be present in
  -- both expressions: losing the create.* arm would break this package's own reads, and losing the
  -- oshal.* arm would silently re-open the export/delete regression this file closes.
  SELECT count(*) INTO present FROM pg_policies
   WHERE schemaname = 'public' AND tablename = ANY(targets) AND policyname = tablename || '_exact_owner';
  IF present <> array_length(targets, 1) THEN
    RAISE EXCEPTION 'create: expected % exact-owner policies, found %', array_length(targets, 1), present;
  END IF;

  SELECT string_agg(tablename, ', ' ORDER BY tablename) INTO broken FROM pg_policies
   WHERE schemaname = 'public' AND tablename = ANY(targets) AND policyname = tablename || '_exact_owner'
     AND (qual IS NULL OR with_check IS NULL
          OR qual NOT LIKE '%create.owner_sub%' OR with_check NOT LIKE '%create.owner_sub%'
          OR qual NOT LIKE '%oshal.current_sub%' OR with_check NOT LIKE '%oshal.current_sub%');
  IF broken IS NOT NULL THEN
    RAISE EXCEPTION 'create: the exact-owner policy is missing an identity arm on: %', broken;
  END IF;
END $$;
