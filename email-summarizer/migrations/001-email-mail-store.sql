-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                     | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com    | The person's searchable copy of their mail (Roger, 2026-10-29: the concierge should search a stored copy, not ask Gmail on every request). oshal_email_messages holds each message's sender, subject, provider preview, labels and time, never a body; msg_key (owner|provider|id) is the one-column key so an existence check is a read by id on the native kernel. oshal_email_sync holds each person's sync progress. Owner-or-operator FORCE row security in animatronics 001's shape, the one the native migration interpreter accepts. Idempotent.

CREATE TABLE IF NOT EXISTS oshal_email_messages (
  msg_key      TEXT PRIMARY KEY,
  user_sub     TEXT NOT NULL,
  provider     TEXT NOT NULL,
  message_id   TEXT NOT NULL,
  sender       TEXT NOT NULL DEFAULT '',
  subject      TEXT NOT NULL DEFAULT '',
  snippet      TEXT NOT NULL DEFAULT '',
  labels       TEXT NOT NULL DEFAULT '',
  search_text  TEXT NOT NULL DEFAULT '',
  received_at  TIMESTAMPTZ NOT NULL,
  stored_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oshal_email_messages_owner_time ON oshal_email_messages (user_sub, received_at);

CREATE TABLE IF NOT EXISTS oshal_email_sync (
  sync_key      TEXT PRIMARY KEY,
  user_sub      TEXT NOT NULL,
  provider      TEXT NOT NULL,
  newest_at     TIMESTAMPTZ,
  oldest_at     TIMESTAMPTZ,
  backfill_done BOOLEAN NOT NULL DEFAULT FALSE,
  stored        INTEGER NOT NULL DEFAULT 0,
  pruned_at     TIMESTAMPTZ,
  last_run_at   TIMESTAMPTZ,
  last_error    TEXT
);

-- Owner row security in the one DO shape the native kernel's migration interpreter accepts (animatronics 001).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['oshal_email_messages', 'oshal_email_sync'] LOOP
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
