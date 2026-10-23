-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep provisioning requests inside the original caller scope.
ALTER TABLE operations_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_provisioning FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_provisioning' AND policyname='operations_provisioning_owner') THEN
  CREATE POLICY operations_provisioning_owner ON operations_provisioning FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
