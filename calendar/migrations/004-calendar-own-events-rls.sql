-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Row security for calendar_own_events (migration 003 created the table without it, unlike 001 and 002): ENABLE and FORCE, so the role that owns the table obeys its own policy, and an exact-owner policy in both directions. USING hides another person's events from every read, update and delete; WITH CHECK refuses a row written in another person's name. No operator arm: these are a person's own calendar entries. The routes still pin every statement to user_sub; this is the database's own wall behind them. PostgreSQL only: the native kernel skips this file (oshal-app.yaml nativeMigrations) and keeps each person's rows in their own per-person scope.

ALTER TABLE calendar_own_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_own_events FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='calendar_own_events' AND policyname='calendar_own_events_owner') THEN
 CREATE POLICY calendar_own_events_owner ON calendar_own_events AS PERMISSIVE FOR ALL
 USING(user_sub=nullif(current_setting('oshal.current_sub',true),''))
 WITH CHECK(user_sub=nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;

-- Read the catalog back: a table with row security on and no owner policy would deny the owner their own rows, and
-- one with the policy but not forced would let the owning role read every row.
DO $$ BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname='calendar_own_events' AND c.relkind='r'
      AND c.relrowsecurity AND c.relforcerowsecurity
      AND EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='calendar_own_events_owner')) THEN
   RAISE EXCEPTION 'calendar: row security is not forced with an owner policy on calendar_own_events';
 END IF;
END $$;
