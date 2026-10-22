-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep investigation associations inside the original caller scope.
ALTER TABLE operations_investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_investigations FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_investigations' AND policyname='operations_investigations_owner') THEN
  CREATE POLICY operations_investigations_owner ON operations_investigations FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
