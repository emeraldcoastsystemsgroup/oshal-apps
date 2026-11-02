-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                     | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com    | The person's saved day summary, declared. It was made lazily by the route, and the native kernel provisions only declared tables.

CREATE TABLE IF NOT EXISTS oshal_email_digests (
  user_sub   TEXT PRIMARY KEY,
  summary    TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Owner row security in the one DO shape the native kernel's migration interpreter accepts (animatronics 001).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['oshal_email_digests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy WHERE polname = t || '_owner_or_operator' AND polrelid = t::regclass
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS PERMISSIVE FOR ALL
           USING (user_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')
           WITH CHECK (user_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')',
        t || '_owner_or_operator', t);
    END IF;
  END LOOP;
END $$;
