-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-160 S2 — this package's first schema. A VEHICLE is an owned record whose DESIGN VECTOR is the authored part (D1); its column set is the one aero-lab's vehicle carries, shared as a contract and pinned by scripts/check-adr160-contract.mjs, never imported (D3). Its LIMIT rows are the kind's "What is not true" sentences copied onto the vehicle at creation, each open until retired (D4). A RUN is (vehicle, medium, plant) with the vector fingerprint it was computed at and every engine fingerprint that answered (D5) — this lab's own evaluations and a hull drop another lab computed alike — and the stage is never a column: it is computed on read (D2). All three tables carry the store's owner RLS, ENABLEd AND FORCEd: the api owns these tables and is the role that reads them, and PostgreSQL exempts an owner from an unforced policy.

CREATE TABLE IF NOT EXISTS ocean_lab_vehicle (
  vehicle_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub      TEXT        NOT NULL,
  kind           TEXT        NOT NULL,                              -- the kind this lab owns, e.g. wave-explorer
  name           TEXT        NOT NULL,
  design_vector  JSONB       NOT NULL,                              -- the authored part (D1)
  provenance     JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- where the vector came from
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ocean_lab_vehicle_name_nonempty CHECK (length(name) > 0 AND length(name) <= 120),
  CONSTRAINT ocean_lab_vehicle_kind_nonempty CHECK (length(kind) > 0 AND length(kind) <= 64)
);

-- One vehicle of a name per owner and kind: seeding the Explorer twice is the same record, not a twin.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ocean_lab_vehicle_owner_kind_name ON ocean_lab_vehicle (owner_sub, kind, name);
CREATE INDEX IF NOT EXISTS idx_ocean_lab_vehicle_owner ON ocean_lab_vehicle (owner_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS ocean_lab_vehicle_limit (
  vehicle_id        UUID        NOT NULL REFERENCES ocean_lab_vehicle (vehicle_id) ON DELETE CASCADE,
  owner_sub         TEXT        NOT NULL,
  limit_id          TEXT        NOT NULL,                           -- the kind's limit id, e.g. nothing-built
  sentence          TEXT        NOT NULL,                           -- the "What is not true" sentence, verbatim
  retire_when       TEXT        NOT NULL,                           -- what would retire it
  blocking          BOOLEAN     NOT NULL,                           -- whether it blocks `built` while open
  status            TEXT        NOT NULL DEFAULT 'open',
  retired_evidence  JSONB,                                          -- what retired it; null while open
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, limit_id),
  CONSTRAINT ocean_lab_vehicle_limit_status CHECK (status IN ('open', 'retired')),
  CONSTRAINT ocean_lab_vehicle_limit_retired_has_evidence CHECK (status = 'open' OR retired_evidence IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_ocean_lab_vehicle_limit_owner ON ocean_lab_vehicle_limit (owner_sub, vehicle_id);

CREATE TABLE IF NOT EXISTS ocean_lab_vehicle_run (
  run_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id          UUID        NOT NULL REFERENCES ocean_lab_vehicle (vehicle_id) ON DELETE CASCADE,
  owner_sub           TEXT        NOT NULL,
  sequence            INTEGER     NOT NULL,                         -- 1 is the first run ever recorded
  medium_id           TEXT        NOT NULL,                         -- the medium the run was computed in (D5)
  plant               TEXT        NOT NULL,                         -- which engine or plant answered: this lab's evaluation, or another lab's plant
  vector_fingerprint  TEXT        NOT NULL,                         -- sha256 of the canonical design vector current when it was recorded
  engine_fingerprints JSONB       NOT NULL,                         -- package, version, engine build hash (D5)
  result              JSONB       NOT NULL,                         -- figures and table, or the foreign run as posted
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ocean_lab_vehicle_run_sequence UNIQUE (vehicle_id, sequence),
  CONSTRAINT ocean_lab_vehicle_run_sequence_positive CHECK (sequence >= 1),
  CONSTRAINT ocean_lab_vehicle_run_medium_nonempty CHECK (length(medium_id) > 0),
  CONSTRAINT ocean_lab_vehicle_run_plant_nonempty CHECK (length(plant) > 0 AND length(plant) <= 64),
  CONSTRAINT ocean_lab_vehicle_run_fingerprint_shape CHECK (vector_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_ocean_lab_vehicle_run_owner ON ocean_lab_vehicle_run (owner_sub, vehicle_id, sequence);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ocean_lab_vehicle', 'ocean_lab_vehicle_limit', 'ocean_lab_vehicle_run'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy WHERE polname = t || '_owner_or_operator' AND polrelid = t::regclass
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS PERMISSIVE FOR ALL
           USING (owner_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')
           WITH CHECK (owner_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')',
        t || '_owner_or_operator', t);
    END IF;
  END LOOP;
END $$;
