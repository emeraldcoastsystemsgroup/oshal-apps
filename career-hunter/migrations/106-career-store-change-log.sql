-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                    | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Add the reverse-synchronization outbox: an operator-only change log written by transaction-local AFTER ROW triggers on every mutable Career table that has a SQLite counterpart, plus the single projector's durable checkpoint. A PostgreSQL write and its outbox row commit or roll back together, so a rollback to SQLite can replay exactly what PostgreSQL accepted.

-- WHY. Once JOBHUNTER_STORE=postgres takes user and cron writes, SQLite stops receiving them. A
-- rollback that simply switched the selector back would serve the pre-promotion snapshot and
-- silently lose every application, score and scrape made since. The outbox is the ordered record
-- engine/sync/reverse_sync.py projects back into corpus.db and each user-<sub>.db.
--
-- ORDER. change_id is allocated when a row is written, not when its transaction commits, so two
-- concurrent transactions can commit out of change_id order. The projector therefore never treats
-- "highest change_id seen" as its checkpoint. It advances a transaction-id HORIZON instead: every
-- row whose txid is below txid_snapshot_xmin(txid_current_snapshot()) belongs to a transaction
-- that has finished, so a window [previous horizon, current xmin) is complete and final when it is
-- read. Rows are applied in change_id order and each SQLite row remembers the change_id that last
-- wrote it, so a later window can never overwrite a newer value with an older one.
--
-- WHAT IS NOT CAPTURED. The SQLite->PostgreSQL loader marks its session
-- `oshal.career_change_origin = 'sqlite-replay'` while running as operator: those rows came FROM
-- SQLite, projecting them back is a no-op, and a 1.4M-posting replay would otherwise copy the corpus
-- into the outbox. The skip requires BOTH settings, so an owner session (the engine pins
-- oshal.is_operator to 'off') cannot suppress capture by setting the origin alone. PostgreSQL-only
-- tables (settings, targets, the approval queue, the interview bank) have no SQLite counterpart and
-- are outside the loader and the convergence report as well; they are not captured.

CREATE TABLE IF NOT EXISTS career_store_change_log (
    change_id      BIGSERIAL PRIMARY KEY,
    txid           BIGINT NOT NULL DEFAULT txid_current(),
    schema_version SMALLINT NOT NULL DEFAULT 1,
    table_name     TEXT NOT NULL,
    owner_sub      TEXT,                 -- NULL for the shared corpus tables
    row_key        JSONB NOT NULL,       -- the source row's identity columns
    operation      TEXT NOT NULL,
    row_after      JSONB,                -- NULL for DELETE
    committed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT career_store_change_log_operation_check
      CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE'))
);

COMMENT ON COLUMN career_store_change_log.txid IS
  'Writing transaction id (txid_current); the projector only reads rows below the snapshot xmin.';
COMMENT ON COLUMN career_store_change_log.committed_at IS
  'Transaction timestamp (NOW()) of the writing transaction; used for projector lag.';

CREATE INDEX IF NOT EXISTS idx_career_change_log_txid
  ON career_store_change_log(txid, change_id);

CREATE TABLE IF NOT EXISTS career_reverse_sync_checkpoint (
    worker            TEXT PRIMARY KEY,
    horizon_txid      BIGINT NOT NULL DEFAULT 0,  -- every transaction below this id is projected
    last_change_id    BIGINT NOT NULL DEFAULT 0,  -- highest change_id applied so far
    applied_rows      BIGINT NOT NULL DEFAULT 0,
    row_failures      BIGINT NOT NULL DEFAULT 0,
    last_committed_at TIMESTAMPTZ,                -- committed_at of the newest applied row
    last_error        TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT career_reverse_sync_checkpoint_horizon_check CHECK (horizon_txid >= 0)
);

-- Operator-only under FORCE row security. Owner sessions may only APPEND capture rows for
-- themselves or for the shared corpus; nobody but the operator (the projector, the reporter,
-- the observer) can read, change or delete the log or the checkpoint.
ALTER TABLE career_store_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE career_store_change_log FORCE ROW LEVEL SECURITY;
ALTER TABLE career_reverse_sync_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE career_reverse_sync_checkpoint FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS career_store_change_log_capture ON career_store_change_log;
CREATE POLICY career_store_change_log_capture ON career_store_change_log
  FOR INSERT
  WITH CHECK (
    owner_sub IS NULL
    OR owner_sub = current_setting('oshal.current_sub', true)
    OR current_setting('oshal.is_operator', true) = 'on'
  );

DROP POLICY IF EXISTS career_store_change_log_operator ON career_store_change_log;
CREATE POLICY career_store_change_log_operator ON career_store_change_log
  USING (current_setting('oshal.is_operator', true) = 'on')
  WITH CHECK (current_setting('oshal.is_operator', true) = 'on');

DROP POLICY IF EXISTS career_reverse_sync_checkpoint_operator ON career_reverse_sync_checkpoint;
CREATE POLICY career_reverse_sync_checkpoint_operator ON career_reverse_sync_checkpoint
  USING (current_setting('oshal.is_operator', true) = 'on')
  WITH CHECK (current_setting('oshal.is_operator', true) = 'on');

-- Same owner handling as 099: when the package migration runner is not the role that owns the
-- corpus (the api role the engine connects as), that role still has to append capture rows and
-- the projector has to advance its checkpoint.
DO $$
DECLARE
  app_role name;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO app_role
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'career_postings';
  IF app_role IS NOT NULL AND app_role <> current_user THEN
    EXECUTE format('GRANT SELECT, INSERT ON career_store_change_log TO %I', app_role);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE career_store_change_log_change_id_seq TO %I', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON career_reverse_sync_checkpoint TO %I', app_role);
  END IF;
END $$;

-- One capture function for every table; the trigger arguments name the row's identity columns.
-- An UPDATE that changes an identity column is recorded as DELETE(old key) + INSERT(new key), so
-- the projector never has to infer a rename.
CREATE OR REPLACE FUNCTION career_store_capture_change() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  new_row jsonb;
  old_row jsonb;
  new_key jsonb := '{}'::jsonb;
  old_key jsonb := '{}'::jsonb;
  col     text;
BEGIN
  IF current_setting('oshal.career_change_origin', true) = 'sqlite-replay'
     AND current_setting('oshal.is_operator', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF old_row IS NOT NULL THEN old_key := old_key || jsonb_build_object(col, old_row -> col); END IF;
    IF new_row IS NOT NULL THEN new_key := new_key || jsonb_build_object(col, new_row -> col); END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND old_key IS DISTINCT FROM new_key THEN
    INSERT INTO career_store_change_log (table_name, owner_sub, row_key, operation, row_after)
    VALUES (TG_TABLE_NAME, old_row ->> 'user_sub', old_key, 'DELETE', NULL);
    INSERT INTO career_store_change_log (table_name, owner_sub, row_key, operation, row_after)
    VALUES (TG_TABLE_NAME, new_row ->> 'user_sub', new_key, 'INSERT', new_row);
    RETURN NULL;
  END IF;
  INSERT INTO career_store_change_log (table_name, owner_sub, row_key, operation, row_after)
  VALUES (TG_TABLE_NAME, COALESCE(new_row, old_row) ->> 'user_sub',
          CASE WHEN TG_OP = 'DELETE' THEN old_key ELSE new_key END, TG_OP, new_row);
  RETURN NULL;
END $fn$;

-- Every mutable Career table with a SQLite counterpart, with its identity columns. An UPDATE
-- that changes nothing (`SET x = x`, a row touch) is not a change and records nothing.
DO $$
DECLARE
  spec text[];
  specs text[][] := ARRAY[
    ARRAY['career_companies',                  'id'],
    ARRAY['career_postings',                   'id'],
    ARRAY['career_company_reputation',         'company_id'],
    ARRAY['career_user_job_scores',            'user_sub, posting_id'],
    ARRAY['career_user_applications',          'user_sub, posting_id'],
    ARRAY['career_user_recruiter_firms',       'user_sub, id'],
    ARRAY['career_user_gap_themes',            'user_sub, key'],
    ARRAY['career_user_interview_assessments', 'user_sub, id, source_id']
  ];
  args text;
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    SELECT string_agg(quote_literal(trim(part)), ', ')
      INTO args FROM unnest(string_to_array(spec[2], ',')) AS part;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', spec[1] || '_capture_write', spec[1]);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', spec[1] || '_capture_update', spec[1]);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR DELETE ON %I FOR EACH ROW '
      'EXECUTE FUNCTION career_store_capture_change(%s)',
      spec[1] || '_capture_write', spec[1], args);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER UPDATE ON %I FOR EACH ROW '
      'WHEN (OLD.* IS DISTINCT FROM NEW.*) '
      'EXECUTE FUNCTION career_store_capture_change(%s)',
      spec[1] || '_capture_update', spec[1], args);
  END LOOP;
END $$;
