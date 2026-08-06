-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Enforce one case-normalized email domain per school tenant so identity provisioning cannot select an arbitrary tenant.

-- Domain mapping is an identity boundary. Refuse activation with an actionable
-- error if historical operator data is ambiguous; choosing one row would attach
-- a first-login student to whichever school the query planner returned first.
DO $$
DECLARE
  duplicate_domain TEXT;
BEGIN
  SELECT lower(domain)
    INTO duplicate_domain
    FROM lm_tenants
   WHERE domain IS NOT NULL
   GROUP BY lower(domain)
  HAVING COUNT(*) > 1
   LIMIT 1;

  IF duplicate_domain IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate Little Monsters tenant domain: %', duplicate_domain
      USING HINT = 'Set all but one matching lm_tenants.domain to NULL or a distinct verified domain, then reactivate the app.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_tenants_domain_unique
  ON lm_tenants (lower(domain))
  WHERE domain IS NOT NULL;

-- The unique index covers the same lookup, so retaining the earlier non-unique
-- index wastes write I/O without adding a query path.
DROP INDEX IF EXISTS idx_lm_tenants_domain;
