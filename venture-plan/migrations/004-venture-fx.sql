-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Add an owner-bound immutable FX evidence ledger, bind foreign quotes and their references to exact rate snapshots, and migrate scenario retail prices from cents to constrained micros.
--
-- Idempotent: safe to re-apply. Legacy same-currency quote/scenario rows are
-- backfilled exactly; legacy foreign quotes remain visibly unconverted instead
-- of being assigned a fabricated historical rate.

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
  -- A parent venture deletion owns the lifecycle and may cascade its evidence.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
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

-- Same-currency legacy rows need no assumption and can be migrated exactly.
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
          OR
          (currency <> reporting_currency AND fx_assumption_id IS NOT NULL)
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
    RAISE EXCEPTION 'new quotes require reporting-currency amounts'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.unit_cost_micros < 0 OR NEW.tooling_cost_micros < 0
      OR NEW.reporting_unit_cost_micros < 0
      OR NEW.reporting_tooling_cost_micros < 0 THEN
    RAISE EXCEPTION 'quote currency amounts cannot be negative'
      USING ERRCODE = '23514';
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
      RAISE EXCEPTION 'same-currency quote has an invalid FX binding'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT rate_nanos INTO bound_rate
    FROM venture_fx_assumptions
   WHERE id = NEW.fx_assumption_id AND venture_id = NEW.venture_id
     AND owner_sub = NEW.owner_sub AND source_currency = NEW.currency
     AND reporting_currency = NEW.reporting_currency;
  IF bound_rate IS NULL THEN
    RAISE EXCEPTION 'foreign quote has no matching immutable FX assumption'
      USING ERRCODE = '23514';
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

ALTER TABLE venture_fx_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_fx_assumptions FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polname = 'venture_fx_assumptions_owner_or_operator'
       AND polrelid = 'venture_fx_assumptions'::regclass
  ) THEN
    CREATE POLICY venture_fx_assumptions_owner_or_operator ON venture_fx_assumptions
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;
