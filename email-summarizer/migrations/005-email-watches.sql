-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                     | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com    | Deterministic mailbox watch rules and deduplicated security/priority alert hits (including the TotalConnect Gmail monitor preset). oshal_email_watches holds each person's watch rules keyed by watch_key (user_sub|watch_id); oshal_email_watch_hits records each matched message once by hit_key (user_sub|watch_id|message_id) so a 5-minute check notifies Jarvis only on unseen arrivals. Native-kernel safe DDL with owner-or-operator FORCE row security. Idempotent.

CREATE TABLE IF NOT EXISTS oshal_email_watches (
  watch_key        TEXT PRIMARY KEY,
  user_sub         TEXT NOT NULL,
  watch_id         TEXT NOT NULL,
  label            TEXT NOT NULL DEFAULT '',
  account_hint     TEXT NOT NULL DEFAULT '',
  provider         TEXT NOT NULL DEFAULT 'google',
  query            TEXT NOT NULL DEFAULT '',
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at  TIMESTAMPTZ,
  last_hit_at      TIMESTAMPTZ,
  last_hit_summary TEXT NOT NULL DEFAULT '',
  hit_count        INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oshal_email_watches_owner ON oshal_email_watches (user_sub, watch_id);

CREATE TABLE IF NOT EXISTS oshal_email_watch_hits (
  hit_key      TEXT PRIMARY KEY,
  user_sub     TEXT NOT NULL,
  watch_id     TEXT NOT NULL,
  message_id   TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'activity',
  sender       TEXT NOT NULL DEFAULT '',
  subject      TEXT NOT NULL DEFAULT '',
  snippet      TEXT NOT NULL DEFAULT '',
  received_at  TIMESTAMPTZ NOT NULL,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oshal_email_watch_hits_owner ON oshal_email_watch_hits (user_sub, watch_id);

-- Owner row security in the one DO shape the native kernel's migration interpreter accepts (animatronics 001).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['oshal_email_watches', 'oshal_email_watch_hits'] LOOP
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
