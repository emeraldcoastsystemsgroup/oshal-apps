"use strict";
/**
 * Venture Plan — the owner-scoped Postgres schema.
 *
 * THIRTEEN TABLES, ONE FROZEN LIST. `VENTURE_TABLES` is the single source of truth
 * for what this package owns: the RLS bootstrap iterates it, the schema-readiness
 * requirement list is derived from it, and a guard asserts every `CREATE TABLE` in
 * `SCHEMA_SQL` appears in it. Adding a table without adding RLS is therefore a red
 * test rather than an unprotected table nobody notices for a year.
 *
 * WHY APPEND-ONLY ASSUMPTIONS. This app's entire product is knowing which numbers
 * are guesses. If a vendor quote UPDATEd the estimate it replaces, the evidence
 * that yesterday's plan rested on a guess would be destroyed by the very act of
 * improving it. So `venture_assumptions` never updates a value: a replacement is a
 * new row, and the prior row's `superseded_by` is stamped with the new row's id.
 * The partial unique index `WHERE superseded_by IS NULL` is what makes "the live
 * value for this key" a database-level guarantee rather than a convention.
 *
 * WHY MODELS AND DOCUMENTS ARE IMMUTABLE. A computed model carries `inputs_hash`
 * and `engine_version`; a document carries the `model_id` it was rendered from and
 * a monotonically increasing `version`. That is what lets the surface say "this
 * funding memo was rendered from a model whose inputs have since changed" instead
 * of quietly serving a stale number under a fresh timestamp.
 *
 * MONEY UNITS. BOM lines and quotes are `BIGINT` micro-currency units (1e-6) because a
 * $0.0034 fastener at qty 20 rounds to $0.00 in cents and the roll-up is silently
 * understated. Every downstream money value is integer micros too; legacy
 * scenario cents are migrated exactly and never used by new writes. The engine
 * owns that arithmetic; this module only has to store it without losing precision.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the eleven owner-scoped tables, the append-only assumption ledger with its live-row partial unique index, immutable model snapshots and versioned documents, and the frozen VENTURE_TABLES list the RLS bootstrap and the schema guard both read.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add the owner-bound immutable FX table, foreign-quote integrity triggers, and constrained scenario micro-price migration to runtime bootstrap.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Add owner-bound default-deny rebaseline policies, immutable scheduled authorization, slot idempotency, and monotonic integer micro-USD run-cost evidence.
 *
 * @module venture-schema
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEMA_SQL = exports.VENTURE_TABLES = void 0;
exports.ensureVentureSchema = ensureVentureSchema;
exports.tablesInSchemaSql = tablesInSchemaSql;
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const log = (0, logger_1.createChildLogger)({ module: 'venture-schema' });
/**
 * Every table this package owns, in dependency order (children after parents).
 *
 * FROZEN ON PURPOSE. `ensureVentureSchema` derives both the RLS policy statements
 * and the hosted-mode readiness requirements from this list, so a table that is
 * created but not listed gets neither — and `venture-store.test.js` asserts the
 * list and the DDL agree.
 */
exports.VENTURE_TABLES = Object.freeze([
    'venture_ventures',
    'venture_assumptions',
    'venture_scenarios',
    'venture_runs',
    'venture_rebaseline_policies',
    'venture_fx_assumptions',
    'venture_bom_lines',
    'venture_vendors',
    'venture_quotes',
    'venture_schedule_tasks',
    'venture_headcount',
    'venture_models',
    'venture_documents',
]);
/** Ventures, the append-only ledger, scenarios and runs. Mirrors migrations/001. */
const SCHEMA_CORE = `
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
  channel_mix JSONB NOT NULL DEFAULT '{}'::jsonb,
  retail_price_micros BIGINT,
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
  finished_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS venture_runs_venture_idx ON venture_runs(venture_id, started_at DESC);
`;
/** BOM, vendors, quotes, schedule and headcount. Mirrors migrations/002. */
const SCHEMA_SUPPLY = `
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
`;
/** Immutable FX evidence and foreign-quote/reporting-currency bindings. Mirrors migration 004. */
const SCHEMA_FX = `
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

CREATE OR REPLACE FUNCTION venture_validate_fx_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  venture_currency CHAR(3);
BEGIN
  SELECT currency INTO venture_currency
    FROM venture_ventures
   WHERE id = NEW.venture_id AND owner_sub = NEW.owner_sub;
  IF venture_currency IS NULL THEN
    RAISE EXCEPTION 'FX assumption venture is missing or owned by another account'
      USING ERRCODE = '23503';
  END IF;
  IF NEW.reporting_currency <> venture_currency THEN
    RAISE EXCEPTION 'FX reporting currency does not match its owned venture'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS venture_fx_assumptions_validate_owner ON venture_fx_assumptions;
CREATE TRIGGER venture_fx_assumptions_validate_owner
  BEFORE INSERT ON venture_fx_assumptions
  FOR EACH ROW EXECUTE FUNCTION venture_validate_fx_owner();

CREATE OR REPLACE FUNCTION venture_reject_fx_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'venture FX assumptions are immutable; append a new assumption'
    USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS venture_fx_assumptions_immutable ON venture_fx_assumptions;
CREATE TRIGGER venture_fx_assumptions_immutable
  BEFORE UPDATE OR DELETE ON venture_fx_assumptions
  FOR EACH ROW EXECUTE FUNCTION venture_reject_fx_mutation();

ALTER TABLE venture_quotes
  ADD COLUMN IF NOT EXISTS reporting_currency CHAR(3),
  ADD COLUMN IF NOT EXISTS reporting_unit_cost_micros BIGINT,
  ADD COLUMN IF NOT EXISTS reporting_tooling_cost_micros BIGINT,
  ADD COLUMN IF NOT EXISTS fx_assumption_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'venture_quotes_fx_assumption_fk'
       AND conrelid = 'venture_quotes'::regclass
  ) THEN
    ALTER TABLE venture_quotes ADD CONSTRAINT venture_quotes_fx_assumption_fk
      FOREIGN KEY (fx_assumption_id) REFERENCES venture_fx_assumptions(id) ON DELETE RESTRICT;
  END IF;
END $$;
UPDATE venture_quotes q
   SET reporting_currency = q.currency,
       reporting_unit_cost_micros = q.unit_cost_micros,
       reporting_tooling_cost_micros = q.tooling_cost_micros
 WHERE q.reporting_currency IS NULL
   AND q.currency = (
     SELECT v.currency FROM venture_ventures v
      WHERE v.id = q.venture_id AND v.owner_sub = q.owner_sub);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'venture_quotes_fx_binding_ck'
       AND conrelid = 'venture_quotes'::regclass
  ) THEN
    ALTER TABLE venture_quotes ADD CONSTRAINT venture_quotes_fx_binding_ck CHECK (
      reporting_currency IS NULL OR (
        reporting_unit_cost_micros IS NOT NULL
        AND reporting_tooling_cost_micros IS NOT NULL
        AND (
          (currency = reporting_currency AND fx_assumption_id IS NULL
            AND reporting_unit_cost_micros = unit_cost_micros
            AND reporting_tooling_cost_micros = tooling_cost_micros)
          OR (currency <> reporting_currency AND fx_assumption_id IS NOT NULL)
        )
      )
    ) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION venture_validate_quote_fx_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  bound_rate BIGINT;
  venture_currency CHAR(3);
BEGIN
  IF NEW.reporting_currency IS NULL
      OR NEW.reporting_unit_cost_micros IS NULL
      OR NEW.reporting_tooling_cost_micros IS NULL THEN
    RAISE EXCEPTION 'new quotes require reporting-currency amounts' USING ERRCODE = '23514';
  END IF;
  IF NEW.unit_cost_micros < 0 OR NEW.tooling_cost_micros < 0
      OR NEW.reporting_unit_cost_micros < 0
      OR NEW.reporting_tooling_cost_micros < 0 THEN
    RAISE EXCEPTION 'quote currency amounts cannot be negative' USING ERRCODE = '23514';
  END IF;
  SELECT currency INTO venture_currency
    FROM venture_ventures
   WHERE id = NEW.venture_id AND owner_sub = NEW.owner_sub;
  IF venture_currency IS NULL OR NEW.reporting_currency <> venture_currency THEN
    RAISE EXCEPTION 'quote reporting currency does not match its owned venture'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM venture_vendors
     WHERE id = NEW.vendor_id AND venture_id = NEW.venture_id
       AND owner_sub = NEW.owner_sub
  ) THEN
    RAISE EXCEPTION 'quote vendor is missing or owned by another account'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.bom_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM venture_bom_lines
     WHERE id = NEW.bom_line_id AND venture_id = NEW.venture_id
       AND owner_sub = NEW.owner_sub
  ) THEN
    RAISE EXCEPTION 'quote BOM line is missing or owned by another account'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.currency = NEW.reporting_currency THEN
    IF NEW.fx_assumption_id IS NOT NULL
        OR NEW.reporting_unit_cost_micros <> NEW.unit_cost_micros
        OR NEW.reporting_tooling_cost_micros <> NEW.tooling_cost_micros THEN
      RAISE EXCEPTION 'same-currency quote has an invalid FX binding' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT rate_nanos INTO bound_rate
    FROM venture_fx_assumptions
   WHERE id = NEW.fx_assumption_id AND venture_id = NEW.venture_id
     AND owner_sub = NEW.owner_sub AND source_currency = NEW.currency
     AND reporting_currency = NEW.reporting_currency;
  IF bound_rate IS NULL THEN
    RAISE EXCEPTION 'foreign quote has no matching immutable FX assumption' USING ERRCODE = '23514';
  END IF;
  IF NEW.reporting_unit_cost_micros
       <> ROUND(NEW.unit_cost_micros::NUMERIC * bound_rate / 1000000000)::BIGINT
      OR NEW.reporting_tooling_cost_micros
       <> ROUND(NEW.tooling_cost_micros::NUMERIC * bound_rate / 1000000000)::BIGINT THEN
    RAISE EXCEPTION 'foreign quote reporting amounts do not match its FX assumption'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS venture_quotes_validate_fx ON venture_quotes;
CREATE TRIGGER venture_quotes_validate_fx
  BEFORE INSERT OR UPDATE OF unit_cost_micros, currency, tooling_cost_micros,
    reporting_unit_cost_micros, reporting_currency, reporting_tooling_cost_micros,
    fx_assumption_id, venture_id, owner_sub, vendor_id, bom_line_id
  ON venture_quotes
  FOR EACH ROW EXECUTE FUNCTION venture_validate_quote_fx_binding();

ALTER TABLE venture_scenarios ADD COLUMN IF NOT EXISTS retail_price_micros BIGINT;
UPDATE venture_scenarios
   SET retail_price_micros = retail_price_cents * 10000::BIGINT
 WHERE retail_price_micros IS NULL AND retail_price_cents IS NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'venture_scenarios_retail_price_micros_ck'
       AND conrelid = 'venture_scenarios'::regclass
  ) THEN
    ALTER TABLE venture_scenarios
      ADD CONSTRAINT venture_scenarios_retail_price_micros_ck CHECK (
        retail_price_micros IS NULL
        OR retail_price_micros BETWEEN 0 AND 9007199254740000
      ) NOT VALID;
  END IF;
END $$;
`;
/** Opt-in scheduling policy and measured-cost run evidence. Mirrors migration 005. */
const SCHEMA_REBASELINE = `
CREATE TABLE IF NOT EXISTS venture_rebaseline_policies (
  venture_id UUID PRIMARY KEY REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  cadence VARCHAR(12) NOT NULL DEFAULT 'weekly',
  weekly_day SMALLINT NOT NULL DEFAULT 1,
  max_cost_micros BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT venture_rebaseline_policy_cadence_ck CHECK (cadence IN ('nightly', 'weekly')),
  CONSTRAINT venture_rebaseline_policy_weekday_ck CHECK (weekly_day BETWEEN 0 AND 6),
  CONSTRAINT venture_rebaseline_policy_cap_ck
    CHECK (max_cost_micros BETWEEN 0 AND 9007199254740000),
  CONSTRAINT venture_rebaseline_policy_paid_ck
    CHECK (NOT enabled OR dry_run OR max_cost_micros > 0));
CREATE INDEX IF NOT EXISTS venture_rebaseline_policy_due_idx
  ON venture_rebaseline_policies(enabled, cadence, weekly_day) WHERE enabled;

CREATE OR REPLACE FUNCTION venture_validate_rebaseline_policy_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM venture_ventures
     WHERE id = NEW.venture_id AND owner_sub = NEW.owner_sub
  ) THEN
    RAISE EXCEPTION 'rebaseline policy venture is missing or owned by another account'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS venture_rebaseline_policy_validate_owner
  ON venture_rebaseline_policies;
CREATE TRIGGER venture_rebaseline_policy_validate_owner
  BEFORE INSERT OR UPDATE OF venture_id, owner_sub
  ON venture_rebaseline_policies
  FOR EACH ROW EXECUTE FUNCTION venture_validate_rebaseline_policy_owner();

ALTER TABLE venture_runs
  ADD COLUMN IF NOT EXISTS trigger_kind VARCHAR(16) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS schedule_slot VARCHAR(32),
  ADD COLUMN IF NOT EXISTS cost_cap_micros BIGINT,
  ADD COLUMN IF NOT EXISTS cost_spent_micros BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_status VARCHAR(24) NOT NULL DEFAULT 'not-capped';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'venture_runs_trigger_kind_ck'
       AND conrelid = 'venture_runs'::regclass
  ) THEN
    ALTER TABLE venture_runs ADD CONSTRAINT venture_runs_trigger_kind_ck
      CHECK (trigger_kind IN ('manual', 'scheduled')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'venture_runs_cost_status_ck'
       AND conrelid = 'venture_runs'::regclass
  ) THEN
    ALTER TABLE venture_runs ADD CONSTRAINT venture_runs_cost_status_ck
      CHECK (cost_status IN (
        'not-capped', 'within-cap', 'exhausted', 'overshot', 'capture-failed'
      )) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'venture_runs_schedule_shape_ck'
       AND conrelid = 'venture_runs'::regclass
  ) THEN
    ALTER TABLE venture_runs ADD CONSTRAINT venture_runs_schedule_shape_ck CHECK (
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
        AND cost_status <> 'not-capped')
    ) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS venture_runs_schedule_slot_uq
  ON venture_runs(venture_id, schedule_slot) WHERE schedule_slot IS NOT NULL;

CREATE OR REPLACE FUNCTION venture_validate_run_cost_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.trigger_kind <> OLD.trigger_kind
      OR NEW.schedule_slot IS DISTINCT FROM OLD.schedule_slot
      OR NEW.cost_cap_micros IS DISTINCT FROM OLD.cost_cap_micros THEN
    RAISE EXCEPTION 'run trigger, schedule slot, and cost authorization are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.cost_spent_micros < OLD.cost_spent_micros THEN
    RAISE EXCEPTION 'run measured cost cannot decrease' USING ERRCODE = '55000';
  END IF;
  IF OLD.cost_status = 'capture-failed' AND NEW.cost_status <> OLD.cost_status THEN
    RAISE EXCEPTION 'run capture failure is terminal' USING ERRCODE = '55000';
  END IF;
  IF OLD.cost_status IN ('exhausted', 'overshot')
      AND NEW.cost_status NOT IN (OLD.cost_status, 'capture-failed') THEN
    RAISE EXCEPTION 'run terminal cost status cannot regress' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS venture_runs_validate_cost_transition ON venture_runs;
CREATE TRIGGER venture_runs_validate_cost_transition
  BEFORE UPDATE OF trigger_kind, schedule_slot, cost_cap_micros,
    cost_spent_micros, cost_status
  ON venture_runs
  FOR EACH ROW EXECUTE FUNCTION venture_validate_run_cost_transition();

CREATE OR REPLACE FUNCTION venture_validate_run_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM venture_ventures
     WHERE id = NEW.venture_id AND owner_sub = NEW.owner_sub
  ) THEN
    RAISE EXCEPTION 'run venture is missing or owned by another account'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS venture_runs_validate_owner ON venture_runs;
CREATE TRIGGER venture_runs_validate_owner
  BEFORE INSERT OR UPDATE OF venture_id, owner_sub
  ON venture_runs
  FOR EACH ROW EXECUTE FUNCTION venture_validate_run_owner();
`;
/** Immutable model snapshots and versioned documents. Mirrors migrations/003. */
const SCHEMA_OUTPUTS = `
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
`;
/**
 * The whole schema, in application order.
 *
 * Split into five constants purely so the file reads, and so each block matches
 * one migration file byte-for-byte in intent. `runRuntimeSchemaBootstrap` applies
 * them in order, and every statement is idempotent.
 */
exports.SCHEMA_SQL = Object.freeze([
    SCHEMA_CORE,
    SCHEMA_SUPPLY,
    SCHEMA_FX,
    SCHEMA_REBASELINE,
    SCHEMA_OUTPUTS,
]);
/**
 * @description Create (or, in hosted validate-only mode, verify) this package's
 *   schema together with the owner-or-operator RLS policy on every table.
 *
 * Called once at route-factory time rather than per request. RLS is derived from
 * `VENTURE_TABLES` rather than hand-listed, so the protected set can never drift
 * from the owned set — the failure mode that leaves one table world-readable is
 * structurally unavailable.
 *
 * @param pool - The framework's shared Postgres pool.
 * @returns Nothing. Throws only when hosted-mode validation finds the schema
 *   missing, which is the correct time to fail: an app whose tables do not exist
 *   should refuse loudly rather than serve empty state as if it were the truth.
 */
async function ensureVentureSchema(pool) {
    const statements = [
        ...exports.SCHEMA_SQL,
        ...exports.VENTURE_TABLES.flatMap((t) => (0, database_1.buildOwnerRlsPolicyStatements)(t, 'owner_sub')),
    ];
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'venture-plan routes',
        statements,
        requirements: exports.VENTURE_TABLES.map((table) => ({ table, columns: ['owner_sub'] })),
    });
    log.info({ tables: exports.VENTURE_TABLES.length }, 'venture schema ready');
}
/**
 * @description Every table name the schema DDL actually creates.
 *
 * Exists so a guard can compare the DDL against `VENTURE_TABLES` instead of
 * trusting that whoever added a table also remembered the list. Parsing the SQL
 * is deliberate: it is the only check that cannot be satisfied by editing the
 * list alone.
 *
 * @returns The created table names, in DDL order.
 */
function tablesInSchemaSql() {
    const found = [];
    const re = /CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gi;
    for (const block of exports.SCHEMA_SQL) {
        let m = re.exec(block);
        while (m) {
            found.push(m[1]);
            m = re.exec(block);
        }
    }
    return found;
}
//# sourceMappingURL=venture-schema.js.map