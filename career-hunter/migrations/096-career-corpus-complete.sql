-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-30 16:40:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Close the gaps in 095 before the SQLite->Postgres cutover: columns 095 omitted, and the three PER-USER tables it had no home for at all (recruiter_firms, gap_themes, interview_assessments). Without this the cutover silently strands 192 recruiter rows, 30 gap themes and every apply confirmation.
-- -----------------------------------------------------------------------------
--
-- WHY THIS EXISTS
--
-- 095 was written from the board's query shapes, not from the actual SQLite schema. Dumping
-- the live stores on 2026-07-30 found real columns and whole tables with nowhere to land:
--
--   user_signals.apply_active        the apply-queue claim flag; the durable auto-apply rail
--                                    reads it (queue requeue hard-refuses when applied_at is
--                                    set), so losing it breaks submission bookkeeping
--   user_signals.confirmation_path   56 rows populated — proof an application was submitted
--   companies.hq / discover_status / gsearched / referral
--                                    referral feeds the board's P(land) ranking; discover_status
--                                    and gsearched drive ATS re-discovery
--   recruiter_firms   192 rows       PER-USER recruiter tracker (a cockpit surface)
--   gap_themes         30 rows       PER-USER resume gap analysis
--   interview_assessments            PER-USER interview -> skill reassessment
--
-- The three tables are per-user data and therefore get the same FORCE RLS treatment as
-- career_user_job_scores / career_user_applications. company_reputation stays SHARED,
-- matching its position in corpus.db (its manual_* layer is an operator override, not a
-- per-user opinion).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS throughout.

-- ── shared corpus: columns 095 missed ────────────────────────────────────────
ALTER TABLE career_companies ADD COLUMN IF NOT EXISTS hq              TEXT;
ALTER TABLE career_companies ADD COLUMN IF NOT EXISTS discover_status TEXT;
ALTER TABLE career_companies ADD COLUMN IF NOT EXISTS gsearched       BOOLEAN;
-- referral is a 0/1 boost factor in the board's P(land) expression, not a flag.
ALTER TABLE career_companies ADD COLUMN IF NOT EXISTS referral        INTEGER NOT NULL DEFAULT 0;

-- ── per-user application: columns 095 missed ─────────────────────────────────
-- The apply rail's claim flag. dispatchApply CLAIMS by setting this to 0 and
-- `queue requeue` restores it to 1; without it a dispatch cannot un-poison its own posting.
ALTER TABLE career_user_applications ADD COLUMN IF NOT EXISTS apply_active      INTEGER NOT NULL DEFAULT 1;
-- Storage-relative path (under the user's own `intelligent-career/`) to the submission
-- confirmation artefact. Never the file itself.
ALTER TABLE career_user_applications ADD COLUMN IF NOT EXISTS confirmation_path TEXT;

-- ── shared: company reputation (ai_* enricher layer, manual_* operator override) ──
CREATE TABLE IF NOT EXISTS career_company_reputation (
    company_id      BIGINT PRIMARY KEY REFERENCES career_companies(id) ON DELETE CASCADE,
    ai_score        INTEGER,
    ai_about        TEXT,
    ai_positives    TEXT,
    ai_negatives    TEXT,
    ai_rated_at     TIMESTAMPTZ,
    manual_score    INTEGER,
    manual_about    TEXT,
    manual_positives TEXT,
    manual_negatives TEXT,
    manual_note     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── PER-USER tables 095 had no home for ──────────────────────────────────────

-- These three mirror the SQLite tables COLUMN FOR COLUMN. An earlier draft invented
-- plausible names (name/theme/jobs_affected/assessment) and the load failed on a NOT NULL
-- violation, which was the good outcome — a looser schema would have silently written
-- NULLs into every renamed column. Derive from `PRAGMA table_info`, never from intuition.

-- Recruiter / staffing-firm tracker. Who a person is talking to about a job search is
-- exactly the kind of thing that must not leak between users.
-- The key is (user_sub, id) with the SOURCE id preserved, NOT (user_sub, firm). A firm
-- legitimately appears more than once: the tracker holds one row per RECRUITER, and this
-- store has two separate contacts at L3Harris, Noblis and Peraton. Keying on firm silently
-- dropped three real people via ON CONFLICT DO NOTHING before this was caught by a
-- 192-sent / 188-landed count mismatch. Preserving the source id also makes the load
-- idempotent without inventing a natural key the source never had.
CREATE TABLE IF NOT EXISTS career_user_recruiter_firms (
    user_sub        VARCHAR(255) NOT NULL,
    id              BIGINT NOT NULL,        -- SQLite recruiter_firms.id, preserved
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    firm            TEXT NOT NULL,          -- SQLite: firm (NOT `name`)
    bucket          TEXT,                   -- e.g. "Cleared / GovTech"
    website         TEXT,
    contact_name    TEXT,
    contact_role    TEXT,
    contact_link    TEXT,
    resume_label    TEXT,                   -- which resume variant to send
    channel         TEXT,
    status          TEXT,                   -- "To contact" -> "Contacted" -> "Replied" ...
    date_contacted  TEXT,
    followup_date   TEXT,
    next_action     TEXT,
    notes           TEXT,
    sort_order      INTEGER,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_sub, id)
);

-- Resume gap themes: which weaknesses cost this person how many roles.
CREATE TABLE IF NOT EXISTS career_user_gap_themes (
    user_sub        VARCHAR(255) NOT NULL,
    key             TEXT NOT NULL,          -- SQLite: key (e.g. "k8s")
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    n_jobs          INTEGER,                -- SQLite: n_jobs (NOT jobs_affected)
    avg_fit         INTEGER,
    sample_gaps     TEXT,                   -- JSON array, stored as text in the source
    status          TEXT,
    response        TEXT,                   -- SQLite: response (NOT answer)
    answered_at     TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_sub, key)
);

-- Interview transcript -> demonstrated-skill reassessment. Contains a person's own
-- interview performance; the most sensitive table in the app.
CREATE TABLE IF NOT EXISTS career_user_interview_assessments (
    id              BIGSERIAL PRIMARY KEY,
    user_sub        VARCHAR(255) NOT NULL,
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    at              TIMESTAMPTZ,            -- SQLite: at
    company         TEXT,
    role            TEXT,
    transcript      TEXT,
    answers         TEXT,
    result          TEXT,
    finalized       INTEGER NOT NULL DEFAULT 0
);

-- ── indexes (per-table prefixes; see tests/migration-index-names.test.mjs) ────
CREATE INDEX IF NOT EXISTS idx_career_user_recruiters_sub ON career_user_recruiter_firms(user_sub, status);
CREATE INDEX IF NOT EXISTS idx_career_user_gaps_sub       ON career_user_gap_themes(user_sub, n_jobs DESC);
CREATE INDEX IF NOT EXISTS idx_career_user_interviews_sub ON career_user_interview_assessments(user_sub, at DESC);
CREATE INDEX IF NOT EXISTS idx_career_companies_discover  ON career_companies(discover_status) WHERE discover_status IS NOT NULL;
-- The apply rail scans for claimable rows.
CREATE INDEX IF NOT EXISTS idx_career_user_apps_active    ON career_user_applications(user_sub, apply_active)
    WHERE applied_at IS NULL;

-- ── RLS on every new PER-USER table ──────────────────────────────────────────
-- Same owner-or-operator shape as 060 Tier 1 / 090 / 095. FORCE so the table owner is not
-- exempt: without it, the app role querying its own tables bypasses the policy entirely and
-- every user's data is readable. That is the difference between "RLS is enabled" and
-- "RLS actually isolates", and only the second one is worth anything.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'career_user_recruiter_firms',
    'career_user_gap_themes',
    'career_user_interview_assessments'
  ] LOOP
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

REVOKE INSERT, UPDATE, DELETE ON career_company_reputation FROM PUBLIC;
