CREATE TABLE IF NOT EXISTS calling_settings (
  owner_sub text NOT NULL, owner_issuer text NOT NULL, config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_sub,owner_issuer)
);
CREATE TABLE IF NOT EXISTS calling_runs (
  id uuid PRIMARY KEY, owner_sub text NOT NULL, owner_issuer text NOT NULL,
  request_key uuid NOT NULL, request_hash text NOT NULL, task jsonb NOT NULL, config jsonb NOT NULL,
  status text NOT NULL DEFAULT 'dialing', call_sid text, outcome text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_sub,owner_issuer,request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS calling_one_active_owner ON calling_runs(owner_sub,owner_issuer)
  WHERE status IN ('dialing','active','transferring');
CREATE TABLE IF NOT EXISTS calling_turns (
  run_id uuid NOT NULL REFERENCES calling_runs(id), turn integer NOT NULL,
  recording_sid text, status text NOT NULL DEFAULT 'waiting', transcript text,
  decision jsonb, audio_sha256 text, audio_bytes integer, provider text, error text,
  started_at timestamptz, completed_at timestamptz,
  PRIMARY KEY(run_id,turn), UNIQUE(recording_sid)
);
CREATE TABLE IF NOT EXISTS calling_events (
  id bigserial PRIMARY KEY, run_id uuid NOT NULL REFERENCES calling_runs(id),
  kind text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE calling_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE calling_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE calling_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE calling_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calling_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE calling_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE calling_turns FORCE ROW LEVEL SECURITY;
ALTER TABLE calling_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calling_settings_owner ON calling_settings;
CREATE POLICY calling_settings_owner ON calling_settings USING (
  (owner_sub = current_setting('oshal.current_sub',true) AND owner_issuer = current_setting('oshal.current_issuer',true))
  OR current_setting('oshal.is_operator',true) = 'on'
);
DROP POLICY IF EXISTS calling_runs_owner ON calling_runs;
CREATE POLICY calling_runs_owner ON calling_runs USING (
  (owner_sub = current_setting('oshal.current_sub',true) AND owner_issuer = current_setting('oshal.current_issuer',true))
  OR current_setting('oshal.is_operator',true) = 'on'
);
DROP POLICY IF EXISTS calling_turns_owner ON calling_turns;
CREATE POLICY calling_turns_owner ON calling_turns USING (EXISTS(SELECT 1 FROM calling_runs r WHERE r.id=run_id));
DROP POLICY IF EXISTS calling_events_owner ON calling_events;
CREATE POLICY calling_events_owner ON calling_events USING (EXISTS(SELECT 1 FROM calling_runs r WHERE r.id=run_id));
