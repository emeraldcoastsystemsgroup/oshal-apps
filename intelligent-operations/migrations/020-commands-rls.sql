-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep command records inside the original caller scope.
ALTER TABLE operations_command_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_command_runs FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_command_runs' AND policyname='operations_command_runs_owner') THEN
  CREATE POLICY operations_command_runs_owner ON operations_command_runs FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
