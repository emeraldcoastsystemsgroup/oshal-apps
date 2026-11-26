-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.5: add owner-scoped finance projects, budget allocation lines, and multi-source actuals (manual, plaid, ads, sms, email, invoice) with exact-owner ENABLE and FORCE ROW LEVEL SECURITY (oshal.current_sub, no operator bypass).

-- Owner-scoped finance projects with top-level integer-cent budget and optional external reference (e.g. marketing:campaign:<id>).
CREATE TABLE IF NOT EXISTS oshal_finance_projects (
  project_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub    TEXT NOT NULL,
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  budget_cents BIGINT NOT NULL DEFAULT 0 CHECK (budget_cents >= 0),
  external_ref TEXT,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_sub, slug)
);

CREATE INDEX IF NOT EXISTS idx_oshal_finance_projects_owner
  ON oshal_finance_projects (owner_sub, updated_at DESC);

-- Budget allocation lines belonging to a finance project (integer cents for budget and committed amounts).
CREATE TABLE IF NOT EXISTS oshal_finance_project_lines (
  line_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub       TEXT NOT NULL,
  project_id      UUID NOT NULL REFERENCES oshal_finance_projects (project_id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'general',
  budget_cents    BIGINT NOT NULL DEFAULT 0 CHECK (budget_cents >= 0),
  committed_cents BIGINT NOT NULL DEFAULT 0 CHECK (committed_cents >= 0),
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oshal_finance_project_lines_project
  ON oshal_finance_project_lines (owner_sub, project_id, created_at ASC);

-- Recorded project actuals from manual entry, Plaid transactions, paid ads, SMS, email, or invoices.
CREATE TABLE IF NOT EXISTS oshal_finance_project_actuals (
  actual_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub    TEXT NOT NULL,
  project_id   UUID NOT NULL REFERENCES oshal_finance_projects (project_id) ON DELETE CASCADE,
  line_id      UUID REFERENCES oshal_finance_project_lines (line_id) ON DELETE SET NULL,
  source       TEXT NOT NULL CHECK (source IN ('manual', 'plaid', 'ads', 'sms', 'email', 'invoice')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  occurred_on  DATE NOT NULL,
  reference_id TEXT,
  evidence     JSONB NOT NULL DEFAULT '{}',
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oshal_finance_project_actuals_project
  ON oshal_finance_project_actuals (owner_sub, project_id, occurred_on DESC);

-- Exact-owner FORCE-RLS on all three finance project tables (no operator bypass).
ALTER TABLE oshal_finance_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_finance_projects FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_finance_projects_exact_owner'
      AND polrelid = 'oshal_finance_projects'::regclass
  ) THEN
    CREATE POLICY oshal_finance_projects_exact_owner ON oshal_finance_projects
      AS PERMISSIVE FOR ALL
      USING (
        owner_sub = current_setting('oshal.current_sub', true)
        AND current_setting('oshal.current_sub', true) <> ''
      )
      WITH CHECK (
        owner_sub = current_setting('oshal.current_sub', true)
        AND current_setting('oshal.current_sub', true) <> ''
      );
  END IF;
END $$;

ALTER TABLE oshal_finance_project_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_finance_project_lines FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_finance_project_lines_exact_owner'
      AND polrelid = 'oshal_finance_project_lines'::regclass
  ) THEN
    CREATE POLICY oshal_finance_project_lines_exact_owner ON oshal_finance_project_lines
      AS PERMISSIVE FOR ALL
      USING (
        owner_sub = current_setting('oshal.current_sub', true)
        AND current_setting('oshal.current_sub', true) <> ''
      )
      WITH CHECK (
        owner_sub = current_setting('oshal.current_sub', true)
        AND current_setting('oshal.current_sub', true) <> ''
      );
  END IF;
END $$;

ALTER TABLE oshal_finance_project_actuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_finance_project_actuals FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_finance_project_actuals_exact_owner'
      AND polrelid = 'oshal_finance_project_actuals'::regclass
  ) THEN
    CREATE POLICY oshal_finance_project_actuals_exact_owner ON oshal_finance_project_actuals
      AS PERMISSIVE FOR ALL
      USING (
        owner_sub = current_setting('oshal.current_sub', true)
        AND current_setting('oshal.current_sub', true) <> ''
      )
      WITH CHECK (
        owner_sub = current_setting('oshal.current_sub', true)
        AND current_setting('oshal.current_sub', true) <> ''
      );
  END IF;
END $$;
