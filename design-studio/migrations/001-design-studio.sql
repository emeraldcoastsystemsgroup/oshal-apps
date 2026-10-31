-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-203 D1 (lane @ds-app). Initial schema. A PROJECT is one product the person is building: its name, its BRIEF (what it is, what it must do one requirement per line, its targets) and its PHASE CHAIN (the ordered subset of the fixed vocabulary with the engine each phase binds to). A BINDING is one bind of an engine's artifact to a phase, by reference and with the engine-reply excerpt the body contract publishes; `revision` counts the binds of that phase, the newest counts. A CLOSURE is a row a person or the AI writes when a phase's bar is met: the engine's evidence line and the artifact revision it was read from (a closure whose artifact moved on reads as stale), or one ticked step of the build checklist (`step`). No engine artifact is stored here. Text ids minted by the package, plain inserts, no ON CONFLICT: the native kernel's rules for growing tables. Every table carries the store's owner RLS.

CREATE TABLE IF NOT EXISTS design_project (
  id              TEXT        PRIMARY KEY,
  owner_sub       TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  brief           JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- {what, requirements[], targets{massG,sizeMm,costUsd,runtimeMin}}
  phases          JSONB       NOT NULL DEFAULT '[]'::jsonb,          -- ordered [{kind, engine, why?, brain?, printerId?}]
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_design_project_owner ON design_project (owner_sub);

CREATE TABLE IF NOT EXISTS design_binding (
  id              TEXT        PRIMARY KEY,
  project_id      TEXT        NOT NULL REFERENCES design_project (id) ON DELETE CASCADE,
  owner_sub       TEXT        NOT NULL,
  phase           TEXT        NOT NULL,                              -- a kind from the vocabulary
  artifact        JSONB       NOT NULL,                              -- {engine, kind, ...reference, read?: the engine reply excerpt}
  revision        INTEGER     NOT NULL,                              -- the n-th bind of this phase
  bound_at        TIMESTAMPTZ NOT NULL,
  CONSTRAINT design_binding_revision_valid CHECK (revision >= 1)
);

CREATE INDEX IF NOT EXISTS idx_design_binding_owner ON design_binding (owner_sub, project_id);

CREATE TABLE IF NOT EXISTS design_closure (
  id              TEXT        PRIMARY KEY,
  project_id      TEXT        NOT NULL REFERENCES design_project (id) ON DELETE CASCADE,
  owner_sub       TEXT        NOT NULL,
  phase           TEXT        NOT NULL,                              -- a kind from the vocabulary
  step            TEXT,                                              -- the build checklist step this row ticks; NULL for a phase closure
  evidence        TEXT        NOT NULL,                              -- the engine's evidence line
  revision        TEXT        NOT NULL,                              -- the artifact revision the evidence was read at
  closed_by       TEXT        NOT NULL,                              -- person | the bot's name
  closed_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_design_closure_owner ON design_closure (owner_sub, project_id);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['design_project', 'design_binding', 'design_closure'] LOOP
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
