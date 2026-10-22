-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Force original-caller isolation on every telemetry bank, configuration and durable packet.
ALTER TABLE operations_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_streams FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_telemetry_0 ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_telemetry_0 FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_telemetry_1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_telemetry_1 FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_telemetry_2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_telemetry_2 FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_telemetry_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_telemetry_packets FORCE ROW LEVEL SECURITY;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['operations_streams','operations_telemetry_0','operations_telemetry_1','operations_telemetry_2','operations_telemetry_packets'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=tab AND policyname=tab||'_owner') THEN
   EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (user_sub = nullif(current_setting(''oshal.current_sub'',true),'''')) WITH CHECK (user_sub = nullif(current_setting(''oshal.current_sub'',true),''''))',tab||'_owner',tab);
  END IF;
 END LOOP;
END $$;
