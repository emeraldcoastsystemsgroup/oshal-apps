-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Apply forced original-person isolation to external links and synchronization attempts.
ALTER TABLE operations_ticket_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_ticket_links FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_sync_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_sync_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_sync_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_sync_owners FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_ticket_links' AND policyname='operations_ticket_links_owner') THEN
  CREATE POLICY operations_ticket_links_owner ON operations_ticket_links FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_sync_attempts' AND policyname='operations_sync_attempts_owner') THEN
  CREATE POLICY operations_sync_attempts_owner ON operations_sync_attempts FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_sync_owners' AND policyname='operations_sync_owners_owner') THEN
  CREATE POLICY operations_sync_owners_owner ON operations_sync_owners FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
