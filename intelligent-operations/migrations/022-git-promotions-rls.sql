-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep Git promotions inside the original caller scope.
ALTER TABLE operations_git_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_git_promotions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operations_git_promotions' AND policyname='operations_git_promotions_owner') THEN
  CREATE POLICY operations_git_promotions_owner ON operations_git_promotions FOR ALL USING (user_sub = nullif(current_setting('oshal.current_sub',true),'')) WITH CHECK (user_sub = nullif(current_setting('oshal.current_sub',true),''));
 END IF;
END $$;
