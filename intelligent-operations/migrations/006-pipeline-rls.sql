-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Enforce original caller isolation across every processing table.
ALTER TABLE operations_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_policies FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_policies' AND policyname='operations_policies_owner') THEN
  CREATE POLICY operations_policies_owner ON operations_policies FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
ALTER TABLE operations_policy_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_policy_bindings FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_policy_bindings' AND policyname='operations_policy_bindings_owner') THEN
  CREATE POLICY operations_policy_bindings_owner ON operations_policy_bindings FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
ALTER TABLE operations_filter_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_filter_decisions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_filter_decisions' AND policyname='operations_filter_decisions_owner') THEN
  CREATE POLICY operations_filter_decisions_owner ON operations_filter_decisions FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
ALTER TABLE operations_processing_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_processing_attempts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_processing_attempts' AND policyname='operations_processing_attempts_owner') THEN
  CREATE POLICY operations_processing_attempts_owner ON operations_processing_attempts FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
ALTER TABLE operations_symptoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_symptoms FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_symptoms' AND policyname='operations_symptoms_owner') THEN
  CREATE POLICY operations_symptoms_owner ON operations_symptoms FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
ALTER TABLE operations_evidence_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_evidence_work FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_evidence_work' AND policyname='operations_evidence_work_owner') THEN
  CREATE POLICY operations_evidence_work_owner ON operations_evidence_work FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
ALTER TABLE operations_symptom_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_symptom_occurrences FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_symptom_occurrences' AND policyname='operations_symptom_occurrences_owner') THEN
 CREATE POLICY operations_symptom_occurrences_owner ON operations_symptom_occurrences FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
