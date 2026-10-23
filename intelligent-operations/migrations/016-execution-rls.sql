-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Apply forced original-person isolation to action plans, artifacts, approvals and executions.
ALTER TABLE operations_action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_action_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_action_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_action_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_action_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_action_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_action_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_action_executions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_action_plans' AND policyname='operations_action_plans_owner') THEN
  CREATE POLICY operations_action_plans_owner ON operations_action_plans FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_action_artifacts' AND policyname='operations_action_artifacts_owner') THEN
  CREATE POLICY operations_action_artifacts_owner ON operations_action_artifacts FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_action_approvals' AND policyname='operations_action_approvals_owner') THEN
  CREATE POLICY operations_action_approvals_owner ON operations_action_approvals FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_action_executions' AND policyname='operations_action_executions_owner') THEN
  CREATE POLICY operations_action_executions_owner ON operations_action_executions FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
