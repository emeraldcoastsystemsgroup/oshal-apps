-- 091-career-automation.sql — explicit opt-in gate for career automation (2026-07-24)
-- Operator directive 2026-07-24: the nightly scrape→score→auto-draft-enqueue chain (and any
-- future auto-submission rail) must be EXPLICIT OPT-IN, per user, DEFAULT OFF. An absent row
-- means automation is disabled — the server-side gates treat "no row" exactly like FALSE.
-- auto_generate gates the cron's per-user score/title/enqueue steps (draft-ticket generation);
-- auto_submit is the flag the bulk auto-submit rail (core /api/apply/enqueue-queue + batch)
-- must consult before minting job-apply tickets without a per-job human action.
-- Same owner-or-operator RLS shape as 090. Idempotent.

CREATE TABLE IF NOT EXISTS career_automation_settings (
  user_sub      TEXT PRIMARY KEY,
  auto_generate BOOLEAN NOT NULL DEFAULT FALSE,
  auto_submit   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['career_automation_settings'] LOOP
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
