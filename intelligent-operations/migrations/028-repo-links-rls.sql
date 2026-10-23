-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep repository links inside the original caller scope.
ALTER TABLE operations_repo_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_repo_links FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_repo_links' AND policyname='operations_repo_links_owner') THEN
  CREATE POLICY operations_repo_links_owner ON operations_repo_links FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
