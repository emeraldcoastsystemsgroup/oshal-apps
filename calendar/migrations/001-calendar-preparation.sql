-- Explicitly synchronized, minimized snapshots. No attendee identities or descriptions.
CREATE TABLE IF NOT EXISTS calendar_preparation_snapshots (
 user_sub text PRIMARY KEY,
 events jsonb NOT NULL DEFAULT '[]',
 synced_at timestamptz NOT NULL
);
ALTER TABLE calendar_preparation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_preparation_snapshots FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='calendar_preparation_snapshots' AND policyname='calendar_preparation_owner') THEN
 CREATE POLICY calendar_preparation_owner ON calendar_preparation_snapshots
 USING(user_sub=nullif(current_setting('oshal.current_sub',true),'') OR current_setting('oshal.is_operator',true)='true')
 WITH CHECK(user_sub=nullif(current_setting('oshal.current_sub',true),'') OR current_setting('oshal.is_operator',true)='true');
 END IF;
END $$;
