-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep delegations inside the original caller scope.
ALTER TABLE operations_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_delegations FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_delegations' AND policyname='operations_delegations_owner') THEN
  CREATE POLICY operations_delegations_owner ON operations_delegations FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
