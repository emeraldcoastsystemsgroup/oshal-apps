-- 090-career-rls.sql — ADR-085 Wave 3 carve (2026-07-18)
-- Closes the RLS gap found at the carve inventory: career_digest_settings (077) and
-- career_score_settings (082) post-date migration 060 and shipped WITHOUT owner RLS —
-- any authenticated app-role query could read every user's digest phone number and
-- title terms. Same owner-or-operator policy shape as 060 Tier 1. Idempotent.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['career_digest_settings', 'career_score_settings'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.relname = t AND p.polname = t || '_owner_or_operator'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (
           user_sub = current_setting(''oshal.current_sub'', true)
           OR current_setting(''oshal.is_operator'', true) = ''on''
         ) WITH CHECK (
           user_sub = current_setting(''oshal.current_sub'', true)
           OR current_setting(''oshal.is_operator'', true) = ''on''
         )', t || '_owner_or_operator', t);
    END IF;
  END LOOP;
END $$;
