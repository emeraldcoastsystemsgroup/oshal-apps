-- 100-career-user-targets.sql — each user's own scrape-target list (2026-09-05)
-- Operator direction: the shared `companies` corpus is the PORTAL ADMIN table (the Companies
-- surface, gated by CAREER_HUNTER_ADMIN_SUBS). Every user also gets their OWN extended list: a
-- careers URL they paste is accepted only when the engine's URL classifier recognizes a supported
-- job-board pattern — otherwise it is rejected and never stored. Accepted rows are resolved into
-- the shared corpus (company row + first scrape) so the nightly chain carries them from then on;
-- this table is the user's view of what they added and how it resolved. Same owner-or-operator
-- FORCE-RLS shape as 091. Idempotent.

CREATE TABLE IF NOT EXISTS career_user_targets (
  id           BIGSERIAL PRIMARY KEY,
  user_sub     TEXT NOT NULL,
  url          TEXT NOT NULL,
  ats_type     TEXT NOT NULL,                       -- the classifier's verdict at accept time
  ats_token    TEXT,
  status       TEXT NOT NULL DEFAULT 'accepted'
               CHECK (status IN ('accepted', 'resolved', 'unresolved')),
  company_id   BIGINT,                              -- shared-corpus company once resolved
  company_name TEXT,
  postings     INTEGER,                             -- postings seen on the first scrape
  reason       TEXT,                                -- why an accepted URL could not be resolved
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_sub, url)
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['career_user_targets'] LOOP
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
