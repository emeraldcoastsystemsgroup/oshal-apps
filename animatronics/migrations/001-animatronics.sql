-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Initial schema. A RIG is one animatronic: its servo CHANNELS with calibration and software limits, its MECHANISMS, supply and controller (the `rig` document), its POSE and SCENARIO libraries, whether it is ARMED (frames may reach the controller) and since when, the pose the server believes the prop is in, the last report. A RUN is one line of the command log — every rehearsal, arm, play, look-at, jog and disarm with its report — so a frame that reached a servo can always be traced to the command that produced it. Every table carries the store's owner RLS.

CREATE TABLE IF NOT EXISTS animatronic_rig (
  rig_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub       TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  rig             JSONB       NOT NULL,                              -- validated RigSpec: channels, mechanisms, supply, controller
  poses           JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- POSE_ID → {axisKey: degrees}
  scenarios       JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- SCENARIO_ID → {steps, description}
  armed           BOOLEAN     NOT NULL DEFAULT false,                -- frames may be generated for the controller
  armed_at        TIMESTAMPTZ,
  current_pose    JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- the pose the server believes the prop holds
  run_count       INTEGER     NOT NULL DEFAULT 0,                    -- number of the last logged command
  last_report     JSONB,                                             -- the last rehearsal / play report
  source          JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- {kind:'template', template} provenance, or {}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT animatronic_rig_run_count_valid CHECK (run_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_animatronic_rig_owner ON animatronic_rig (owner_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS animatronic_run (
  rig_id          UUID        NOT NULL REFERENCES animatronic_rig (rig_id) ON DELETE CASCADE,
  run             INTEGER     NOT NULL,
  owner_sub       TEXT        NOT NULL,
  kind            TEXT        NOT NULL,                              -- rehearse | arm | disarm | play | look-at | jog
  scenario        TEXT,                                              -- the scenario played, when one was
  report          JSONB       NOT NULL,                              -- the rehearsal report (verdict, channels, power, end)
  frames          INTEGER     NOT NULL DEFAULT 0,                    -- frames generated (0 for arm / disarm / a refusal)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rig_id, run),
  CONSTRAINT animatronic_run_kind_valid CHECK (kind IN ('rehearse', 'arm', 'disarm', 'play', 'look-at', 'jog'))
);

CREATE INDEX IF NOT EXISTS idx_animatronic_run_owner ON animatronic_run (owner_sub, rig_id, run DESC);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['animatronic_rig', 'animatronic_run'] LOOP
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
