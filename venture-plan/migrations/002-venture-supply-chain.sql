-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Supply chain: vendors, the hierarchical BOM (unit costs in BIGINT MICRO-dollars, because a $0.0034 fastener rounds to zero in cents and silently understates the roll-up), quotes, schedule tasks and headcount. Owner-or-operator RLS on every table. src-routes/venture-schema.ts applies the SAME statements at route-factory time, so this file is the migration path, not the only path.
--
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS venture_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  kind VARCHAR(24) NOT NULL DEFAULT 'component',
  country VARCHAR(64),
  url TEXT,
  contact TEXT,
  moq INTEGER,
  lead_time_days INTEGER,
  qualification_days INTEGER,
  deposit_bps INTEGER NOT NULL DEFAULT 0,
  balance_net_days INTEGER NOT NULL DEFAULT 0,
  qualified BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'candidate',
  source_kind VARCHAR(24) NOT NULL DEFAULT 'model-estimate',
  confidence VARCHAR(12) NOT NULL DEFAULT 'low',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_vendors_venture_idx ON venture_vendors(venture_id, name);

CREATE TABLE IF NOT EXISTS venture_bom_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  parent_line_id UUID REFERENCES venture_bom_lines(id) ON DELETE CASCADE,
  ref VARCHAR(32) NOT NULL,
  part_name TEXT NOT NULL,
  spec_text TEXT,
  qty_per_unit NUMERIC(14,6) NOT NULL DEFAULT 1,
  uom VARCHAR(16) NOT NULL DEFAULT 'ea',
  discrete BOOLEAN NOT NULL DEFAULT TRUE,
  material TEXT,
  process TEXT,
  make_or_buy VARCHAR(8) NOT NULL DEFAULT 'buy',
  unit_cost_micros BIGINT,
  low_micros BIGINT,
  high_micros BIGINT,
  scrap_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  moq INTEGER,
  lead_time_days INTEGER,
  tooling_cost_micros BIGINT NOT NULL DEFAULT 0,
  tooling_life_units INTEGER,
  vendor_id UUID REFERENCES venture_vendors(id) ON DELETE SET NULL,
  assumption_key VARCHAR(160),
  hts_code VARCHAR(16),
  duty_pct NUMERIC(6,3),
  source_kind VARCHAR(24) NOT NULL DEFAULT 'model-estimate',
  confidence VARCHAR(12) NOT NULL DEFAULT 'low',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_bom_venture_idx ON venture_bom_lines(venture_id, parent_line_id, sort_order);

CREATE TABLE IF NOT EXISTS venture_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  vendor_id UUID NOT NULL REFERENCES venture_vendors(id) ON DELETE CASCADE,
  bom_line_id UUID REFERENCES venture_bom_lines(id) ON DELETE CASCADE,
  qty_break INTEGER NOT NULL DEFAULT 1,
  unit_cost_micros BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  tooling_cost_micros BIGINT NOT NULL DEFAULT 0,
  incoterm VARCHAR(12),
  lead_time_days INTEGER,
  valid_until DATE,
  document_ref TEXT,
  notes TEXT,
  assumption_id UUID REFERENCES venture_assumptions(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_quotes_venture_idx ON venture_quotes(venture_id, received_at DESC);

CREATE TABLE IF NOT EXISTS venture_schedule_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  phase VARCHAR(32) NOT NULL,
  name TEXT NOT NULL,
  owner_role TEXT,
  duration_days INTEGER NOT NULL DEFAULT 1,
  depends_on JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumption_key VARCHAR(160),
  source_kind VARCHAR(24) NOT NULL DEFAULT 'model-estimate',
  confidence VARCHAR(12) NOT NULL DEFAULT 'low',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_schedule_venture_idx ON venture_schedule_tasks(venture_id, sort_order);

CREATE TABLE IF NOT EXISTS venture_headcount (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  role TEXT NOT NULL,
  kind VARCHAR(12) NOT NULL DEFAULT 'employee',
  fte NUMERIC(6,3) NOT NULL DEFAULT 1,
  start_month INTEGER NOT NULL DEFAULT 0,
  end_month INTEGER,
  base_salary_micros BIGINT NOT NULL DEFAULT 0,
  burden_bps INTEGER NOT NULL DEFAULT 3000,
  recruit_cost_micros BIGINT NOT NULL DEFAULT 0,
  assumption_key VARCHAR(160),
  source_kind VARCHAR(24) NOT NULL DEFAULT 'model-estimate',
  confidence VARCHAR(12) NOT NULL DEFAULT 'low',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_headcount_venture_idx ON venture_headcount(venture_id, sort_order);

ALTER TABLE venture_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_vendors FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'venture_vendors_owner_or_operator' AND polrelid = 'venture_vendors'::regclass) THEN
    CREATE POLICY venture_vendors_owner_or_operator ON venture_vendors
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;

ALTER TABLE venture_bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_bom_lines FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'venture_bom_lines_owner_or_operator' AND polrelid = 'venture_bom_lines'::regclass) THEN
    CREATE POLICY venture_bom_lines_owner_or_operator ON venture_bom_lines
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;

ALTER TABLE venture_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_quotes FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'venture_quotes_owner_or_operator' AND polrelid = 'venture_quotes'::regclass) THEN
    CREATE POLICY venture_quotes_owner_or_operator ON venture_quotes
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;

ALTER TABLE venture_schedule_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_schedule_tasks FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'venture_schedule_tasks_owner_or_operator' AND polrelid = 'venture_schedule_tasks'::regclass) THEN
    CREATE POLICY venture_schedule_tasks_owner_or_operator ON venture_schedule_tasks
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;

ALTER TABLE venture_headcount ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_headcount FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'venture_headcount_owner_or_operator' AND polrelid = 'venture_headcount'::regclass) THEN
    CREATE POLICY venture_headcount_owner_or_operator ON venture_headcount
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;
