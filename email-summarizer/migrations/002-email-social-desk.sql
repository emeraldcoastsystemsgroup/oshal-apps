-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                     | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com    | The Social desk (Roger, 2026-10-30: the Social tab was one profile card; he wants a publisher's tools a person can use to post or stream to two or three services). oshal_email_social_posts holds each post the person wrote (the text, its per-channel variants, the channels, when it goes out, and the per-channel outcome once sent); oshal_email_social_settings holds the posting plan and the chosen Slack channel; oshal_email_social_events holds Go Live events whose announcements are posts. One-column text keys, plain INSERTs and reads by id (the native kernel copies a table for ON CONFLICT or ORDER BY). Owner-or-operator FORCE row security in animatronics 001's shape, the one the native migration interpreter accepts. Idempotent.

CREATE TABLE IF NOT EXISTS oshal_email_social_posts (
  post_id      TEXT PRIMARY KEY,
  user_sub     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  body         TEXT NOT NULL DEFAULT '',
  variants     TEXT NOT NULL DEFAULT '{}',
  channels     TEXT NOT NULL DEFAULT '[]',
  media_url    TEXT NOT NULL DEFAULT '',
  event_id     TEXT NOT NULL DEFAULT '',
  scheduled_at TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ,
  outcomes     TEXT NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oshal_email_social_posts_owner ON oshal_email_social_posts (user_sub, status);

CREATE TABLE IF NOT EXISTS oshal_email_social_settings (
  settings_key  TEXT PRIMARY KEY,
  user_sub      TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT '{}',
  slack_channel TEXT NOT NULL DEFAULT '',
  slack_label   TEXT NOT NULL DEFAULT '',
  timezone      TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oshal_email_social_events (
  event_id     TEXT PRIMARY KEY,
  user_sub     TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  start_at     TIMESTAMPTZ NOT NULL,
  destinations TEXT NOT NULL DEFAULT '[]',
  watch_url    TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'planned',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Owner row security in the one DO shape the native kernel's migration interpreter accepts (animatronics 001).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['oshal_email_social_posts', 'oshal_email_social_settings', 'oshal_email_social_events'] LOOP
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
