-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-160 S4 — this package's first schema. A VEHICLE is an owned record whose DESIGN VECTOR is the authored part (D1): everything else — figures, meshes, the bill of materials, the build sheet — is derived by a named engine at a named version and stored as an EVALUATION against the vector fingerprint it was computed at. The stage is never a column: it is computed on read from the record and its evaluations (D2), so a changed vector drops the vehicle back by construction. Every evaluation carries the medium it ran in and the engine fingerprints that answered (D5) or it cannot be displayed. Both tables carry the store's owner RLS, ENABLEd AND FORCEd: the api owns these tables and is the role that reads them, and PostgreSQL exempts an owner from an unforced policy.

CREATE TABLE IF NOT EXISTS aero_lab_vehicle (
  vehicle_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub      TEXT        NOT NULL,
  kind           TEXT        NOT NULL,                              -- the kind this lab owns, e.g. solar-dynastat
  name           TEXT        NOT NULL,
  design_vector  JSONB       NOT NULL,                              -- the authored part (D1)
  provenance     JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- where the vector came from
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT aero_lab_vehicle_name_nonempty CHECK (length(name) > 0 AND length(name) <= 120),
  CONSTRAINT aero_lab_vehicle_kind_nonempty CHECK (length(kind) > 0 AND length(kind) <= 64)
);

-- One vehicle of a name per owner and kind: seeding the Floater twice is the same record, not a twin.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aero_lab_vehicle_owner_kind_name ON aero_lab_vehicle (owner_sub, kind, name);
CREATE INDEX IF NOT EXISTS idx_aero_lab_vehicle_owner ON aero_lab_vehicle (owner_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS aero_lab_vehicle_evaluation (
  evaluation_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id          UUID        NOT NULL REFERENCES aero_lab_vehicle (vehicle_id) ON DELETE CASCADE,
  owner_sub           TEXT        NOT NULL,
  sequence            INTEGER     NOT NULL,                         -- 1 is the first evaluation ever recorded
  medium_id           TEXT        NOT NULL,                         -- the medium the run was computed in (D5)
  vector_fingerprint  TEXT        NOT NULL,                         -- sha256 of the canonical design vector it was computed at
  engine_fingerprints JSONB       NOT NULL,                         -- package, version, engine build hash, generator (D5)
  result              JSONB       NOT NULL,                         -- figures, budget check, artifacts, validators
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT aero_lab_vehicle_evaluation_sequence UNIQUE (vehicle_id, sequence),
  CONSTRAINT aero_lab_vehicle_evaluation_sequence_positive CHECK (sequence >= 1),
  CONSTRAINT aero_lab_vehicle_evaluation_medium_nonempty CHECK (length(medium_id) > 0),
  CONSTRAINT aero_lab_vehicle_evaluation_fingerprint_shape CHECK (vector_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_aero_lab_vehicle_evaluation_owner ON aero_lab_vehicle_evaluation (owner_sub, vehicle_id, sequence);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['aero_lab_vehicle', 'aero_lab_vehicle_evaluation'] LOOP
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
