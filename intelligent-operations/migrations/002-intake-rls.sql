-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Force exact-owner PostgreSQL isolation for intake records and processing reservations.
ALTER TABLE operations_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_deliveries FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_deliveries' AND policyname='operations_deliveries_owner') THEN
  CREATE POLICY operations_deliveries_owner ON operations_deliveries FOR ALL
  USING (user_sub = nullif(current_setting('oshal.current_sub',true),''))
  WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
ALTER TABLE operations_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_delivery_attempts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_delivery_attempts' AND policyname='operations_delivery_attempts_owner') THEN
  CREATE POLICY operations_delivery_attempts_owner ON operations_delivery_attempts FOR ALL
  USING (user_sub = nullif(current_setting('oshal.current_sub',true),''))
  WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
ALTER TABLE operations_processing ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_processing FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_processing' AND policyname='operations_processing_owner') THEN
  CREATE POLICY operations_processing_owner ON operations_processing FOR ALL
  USING (user_sub = nullif(current_setting('oshal.current_sub',true),''))
  WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
