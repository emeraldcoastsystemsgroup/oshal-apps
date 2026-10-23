-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep detector state inside the original caller scope.
ALTER TABLE operations_anomaly_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_anomaly_state FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_anomaly_state' AND policyname='operations_anomaly_state_owner') THEN
  CREATE POLICY operations_anomaly_state_owner ON operations_anomaly_state FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
