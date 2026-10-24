-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep optional connector results and refusals within the original caller scope.
ALTER TABLE operations_external_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_external_evidence FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_external_evidence' AND policyname='operations_external_evidence_owner') THEN
  CREATE POLICY operations_external_evidence_owner ON operations_external_evidence FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
