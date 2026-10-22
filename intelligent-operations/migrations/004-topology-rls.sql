-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Force owner isolation on topology generations and correlation decisions.
ALTER TABLE operations_topology_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_topology_scans FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_topology_scans' AND policyname='operations_topology_scans_owner') THEN
  CREATE POLICY operations_topology_scans_owner ON operations_topology_scans FOR ALL
  USING (user_sub = nullif(current_setting('oshal.current_sub',true),''))
  WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
ALTER TABLE operations_topology_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_topology_decisions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_topology_decisions' AND policyname='operations_topology_decisions_owner') THEN
  CREATE POLICY operations_topology_decisions_owner ON operations_topology_decisions FOR ALL
  USING (user_sub = nullif(current_setting('oshal.current_sub',true),''))
  WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
