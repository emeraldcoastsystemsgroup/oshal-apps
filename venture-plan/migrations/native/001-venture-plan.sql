-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Native final shape of 001-005, which the native kernel skips: every venture table and index, with 004's quote FX columns, FX foreign key and FX binding check and 005's run schedule/cost columns and checks folded into their CREATE TABLE. The owner-or-operator RLS DO blocks, the pg_constraint-guarded ALTERs and the PL/pgSQL validation/immutability triggers of 004-005 (FX owner and currency, quote FX binding, run owner and cost transition, rebaseline policy owner, FX append-only) stay PostgreSQL-only; the native per-person scope and its owner-field check keep each person's ventures their own. On PostgreSQL every statement here is a no-op after 001-005 (each table and index already exists).

-- 001-venture-core.sql
CREATE TABLE IF NOT EXISTS venture_ventures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  idea_text TEXT NOT NULL,
  spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  target_launch_date DATE,
  stage VARCHAR(24) NOT NULL DEFAULT 'scoped',
  horizon_months INTEGER NOT NULL DEFAULT 36,
  open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE INDEX IF NOT EXISTS venture_ventures_owner_idx ON venture_ventures(owner_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS venture_assumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  key VARCHAR(160) NOT NULL,
  domain VARCHAR(24) NOT NULL,
  label TEXT NOT NULL,
  unit VARCHAR(24) NOT NULL,
  value_num NUMERIC(24,6),
  value_text TEXT,
  low_num NUMERIC(24,6),
  high_num NUMERIC(24,6),
  source_kind VARCHAR(24) NOT NULL,
  source_detail TEXT,
  source_url TEXT,
  confidence VARCHAR(12) NOT NULL,
  authored_by VARCHAR(120) NOT NULL,
  run_id UUID,
  superseded_by UUID REFERENCES venture_assumptions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE UNIQUE INDEX IF NOT EXISTS venture_assumptions_live_idx
  ON venture_assumptions(venture_id, key) WHERE superseded_by IS NULL;

CREATE INDEX IF NOT EXISTS venture_assumptions_hist_idx
  ON venture_assumptions(venture_id, key, created_at DESC);

CREATE TABLE IF NOT EXISTS venture_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  volume_units INTEGER,
  retail_price_cents INTEGER,
  retail_price_micros BIGINT,
  channel_mix JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_base BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE INDEX IF NOT EXISTS venture_scenarios_venture_idx ON venture_scenarios(venture_id, created_at);

CREATE TABLE IF NOT EXISTS venture_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  phase VARCHAR(24),
  phases JSONB NOT NULL DEFAULT '[]'::jsonb,
  bots_requested INTEGER NOT NULL DEFAULT 0,
  bots_completed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  trigger_kind VARCHAR(16) NOT NULL DEFAULT 'manual',
  schedule_slot VARCHAR(32),
  cost_cap_micros BIGINT,
  cost_spent_micros BIGINT NOT NULL DEFAULT 0,
  cost_status VARCHAR(24) NOT NULL DEFAULT 'not-capped',
  CONSTRAINT venture_runs_trigger_kind_ck CHECK (trigger_kind IN ('manual', 'scheduled')),
  CONSTRAINT venture_runs_cost_status_ck CHECK (cost_status IN (
    'not-capped', 'within-cap', 'exhausted', 'overshot', 'capture-failed')),
  CONSTRAINT venture_runs_schedule_shape_ck CHECK (
    (trigger_kind = 'manual'
      AND schedule_slot IS NULL
      AND cost_cap_micros IS NULL
      AND cost_spent_micros = 0
      AND cost_status = 'not-capped')
    OR
    (trigger_kind = 'scheduled'
      AND kind = 'rebaseline'
      AND schedule_slot ~ '^(nightly|weekly):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND cost_cap_micros BETWEEN 1 AND 9007199254740000
      AND cost_spent_micros BETWEEN 0 AND 9007199254740000
      AND cost_status <> 'not-capped')));

CREATE INDEX IF NOT EXISTS venture_runs_venture_idx ON venture_runs(venture_id, started_at DESC);

-- 002-venture-supply-chain.sql
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

-- 004-venture-fx.sql (the quotes below reference it)
CREATE TABLE IF NOT EXISTS venture_fx_assumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  source_currency CHAR(3) NOT NULL,
  reporting_currency CHAR(3) NOT NULL,
  rate_nanos BIGINT NOT NULL,
  source_kind VARCHAR(24) NOT NULL,
  source_ref TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  authored_by VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT venture_fx_currency_shape_ck CHECK (
    source_currency ~ '^[A-Z]{3}$' AND reporting_currency ~ '^[A-Z]{3}$'
      AND source_currency <> reporting_currency),
  CONSTRAINT venture_fx_rate_ck CHECK (rate_nanos > 0 AND rate_nanos <= 1000000000000000),
  CONSTRAINT venture_fx_source_kind_ck CHECK (
    source_kind IN ('user-entered', 'published-source', 'vendor-quote')),
  CONSTRAINT venture_fx_source_ref_ck CHECK (
    char_length(source_ref) BETWEEN 1 AND 500 AND btrim(source_ref) <> ''),
  CONSTRAINT venture_fx_idempotency_key_ck CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  CONSTRAINT venture_fx_venture_idempotency_uq UNIQUE (venture_id, idempotency_key));

CREATE INDEX IF NOT EXISTS venture_fx_assumptions_venture_idx
  ON venture_fx_assumptions(venture_id, observed_at DESC, created_at DESC);

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
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reporting_currency CHAR(3),
  reporting_unit_cost_micros BIGINT,
  reporting_tooling_cost_micros BIGINT,
  fx_assumption_id UUID,
  CONSTRAINT venture_quotes_fx_assumption_fk
    FOREIGN KEY (fx_assumption_id) REFERENCES venture_fx_assumptions(id) ON DELETE RESTRICT,
  CONSTRAINT venture_quotes_fx_binding_ck CHECK (
    reporting_currency IS NULL OR (
      reporting_unit_cost_micros IS NOT NULL
      AND reporting_tooling_cost_micros IS NOT NULL
      AND (
        (currency = reporting_currency AND fx_assumption_id IS NULL
          AND reporting_unit_cost_micros = unit_cost_micros
          AND reporting_tooling_cost_micros = tooling_cost_micros)
        OR
        (currency <> reporting_currency AND fx_assumption_id IS NOT NULL)))));

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

-- 003-venture-outputs.sql
CREATE TABLE IF NOT EXISTS venture_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  scenario_id UUID REFERENCES venture_scenarios(id) ON DELETE CASCADE,
  run_id UUID,
  engine_version VARCHAR(16) NOT NULL,
  inputs_hash CHAR(64) NOT NULL,
  figures JSONB NOT NULL,
  tables JSONB NOT NULL,
  coverage JSONB NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  posture VARCHAR(16) NOT NULL DEFAULT 'estimate',
  can_publish BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE INDEX IF NOT EXISTS venture_models_venture_idx
  ON venture_models(venture_id, scenario_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS venture_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  doc_key VARCHAR(48) NOT NULL,
  version INTEGER NOT NULL,
  model_id UUID NOT NULL REFERENCES venture_models(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  prose_run_id UUID,
  prose_status VARCHAR(12) NOT NULL DEFAULT 'none',
  unverified_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumptions_cited JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimate_pct NUMERIC(6,3) NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE UNIQUE INDEX IF NOT EXISTS venture_documents_ver_idx
  ON venture_documents(venture_id, doc_key, version);

-- 005-venture-rebaseline.sql
CREATE TABLE IF NOT EXISTS venture_rebaseline_policies (
  venture_id UUID PRIMARY KEY REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  cadence VARCHAR(12) NOT NULL DEFAULT 'weekly',
  weekly_day SMALLINT NOT NULL DEFAULT 1,
  max_cost_micros BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT venture_rebaseline_policy_cadence_ck
    CHECK (cadence IN ('nightly', 'weekly')),
  CONSTRAINT venture_rebaseline_policy_weekday_ck
    CHECK (weekly_day BETWEEN 0 AND 6),
  CONSTRAINT venture_rebaseline_policy_cap_ck
    CHECK (max_cost_micros BETWEEN 0 AND 9007199254740000),
  CONSTRAINT venture_rebaseline_policy_paid_ck
    CHECK (NOT enabled OR dry_run OR max_cost_micros > 0));

CREATE INDEX IF NOT EXISTS venture_rebaseline_policy_due_idx
  ON venture_rebaseline_policies(enabled, cadence, weekly_day)
  WHERE enabled;

CREATE UNIQUE INDEX IF NOT EXISTS venture_runs_schedule_slot_uq
  ON venture_runs(venture_id, schedule_slot)
  WHERE schedule_slot IS NOT NULL;
