-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep background configuration under the original caller's forced SQL policy.
ALTER TABLE operations_processing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_processing_config FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_processing_config' AND policyname='operations_processing_config_owner') THEN
  CREATE POLICY operations_processing_config_owner ON operations_processing_config FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
