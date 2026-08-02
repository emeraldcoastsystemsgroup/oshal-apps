-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-30 08:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Move the jobs corpus into the swarm. ONE shared career_postings table for every user, with each user's match scores and application progression in separate FORCE-RLS tables keyed by user_sub. Replaces the per-user SQLite files on the api-output volume.
-- -----------------------------------------------------------------------------
--
-- WHY THIS EXISTS
--
-- The manifest has described this shape since the ADR-085 carve -- "the shared jobs CORPUS
-- is ingested once from employers' public ATS feeds and shared by all users; every
-- per-user signal is isolated per user_sub" -- but the implementation never got here. The
-- corpus lived in per-user SQLite files under JOBHUNTER_STORE_ROOT: 1.36M postings in a
-- 1.9 GB file per user, re-scraped per user, with no shared ingest. On 2026-07-16 a
-- `scrape --all` died with `attempt to write a readonly database` because the file sat in
-- a OneDrive folder and the sync client held it. A swarm database does not have that
-- failure mode, and 1.36M rows should be ingested ONCE, not once per person.
--
-- THE SPLIT (this is the whole design)
--
--   SHARED, no RLS  -- what the employer published. Objective, identical for everyone.
--     career_companies      the employer registry
--     career_postings       ONE central jobs table. Every job, every user reads it.
--
--   PRIVATE, FORCE RLS -- what WE concluded about it. Different for every person.
--     career_user_job_scores    each user's own keyword + AI fit for a posting
--     career_user_applications  each user's status, timeline and progression metrics
--
-- The line between them is "did the employer say it, or did we infer it for one person".
-- Salary and description are the employer's -> shared. A fit score is a judgement about a
-- specific person's career profile -> private. `target_role` (is this in MY lane?) is
-- private for the same reason, even though it looks like a property of the posting: a
-- Principal Platform Engineer role is in-lane for one user and noise for another.
--
-- Resumes and cover letters are NOT stored here. They are files, they are personal, and
-- they belong on the user's own storage under `intelligent-career/` -- these tables keep
-- only the storage-relative path. See career_user_applications.resume_path.

-- ─────────────────────────────────────────────────────────────────────────────
-- SHARED CORPUS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS career_companies (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    ticker          TEXT,
    domain          TEXT,
    homepage        TEXT,
    careers_url     TEXT,
    ats_type        TEXT,          -- greenhouse | lever | ashby | smartrecruiters | workable | workday
    ats_token       TEXT,          -- board token, or 'tenant:dc:site' for workday
    industry        TEXT,
    source_lists    JSONB,
    last_scraped_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- THE central jobs table. Shared by every user; ingested once by the scrape job.
-- Deliberately NOT RLS-protected: these are public job postings republished from
-- employers' own ATS feeds. There is nothing here to isolate, and isolating it would mean
-- re-ingesting 1.36M rows per user, which is exactly the problem this replaces.
CREATE TABLE IF NOT EXISTS career_postings (
    id              BIGSERIAL PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES career_companies(id) ON DELETE CASCADE,
    ats_job_id      TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    url             TEXT,
    location        TEXT,
    city            TEXT,
    state           TEXT,
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    remote          BOOLEAN,
    department      TEXT,
    job_type        TEXT,
    salary_min      NUMERIC,
    salary_max      NUMERIC,
    salary_currency TEXT,
    salary_period   TEXT,
    salary_raw      TEXT,
    salary_source   TEXT,          -- 'listed' | 'ai_estimated'
    posted_at       TIMESTAMPTZ,
    posted_date     DATE,          -- NULL for ~26% of rows: ATS feeds routinely omit it
    -- Discovery time. Populated for 100% of rows, and therefore the ONLY safe freshness
    -- key -- a ten-day window on posted_date matched 32 rows out of 1.21M on 2026-07-29
    -- and silently no-op'd the nightly scorer for a fortnight. Filter on this column.
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active          BOOLEAN NOT NULL DEFAULT TRUE,   -- closed roles flip inactive, never deleted
    CONSTRAINT career_postings_ats_uniq UNIQUE (company_id, ats_job_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PER-USER PRIVATE
-- ─────────────────────────────────────────────────────────────────────────────

-- Every user gets their own score set for the shared corpus. Two users looking at the
-- same posting see their own fit, their own rationale, their own lane classification.
CREATE TABLE IF NOT EXISTS career_user_job_scores (
    user_sub        VARCHAR(255) NOT NULL,
    posting_id      BIGINT NOT NULL REFERENCES career_postings(id) ON DELETE CASCADE,
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    fit_score       INTEGER,       -- cheap keyword match vs this user's career profile
    target_role     BOOLEAN NOT NULL DEFAULT FALSE,  -- in THIS user's lane
    ai_fit_score    INTEGER,
    ai_fit_rationale TEXT,
    ai_fit_matched  JSONB,
    ai_fit_gaps     JSONB,
    ai_model        TEXT,
    ai_scored_at    TIMESTAMPTZ,
    scored_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_sub, posting_id)
);

-- Each user's application lifecycle and progression metrics. Private: what someone has
-- applied to, been interviewed for, or been rejected from is nobody else's business.
CREATE TABLE IF NOT EXISTS career_user_applications (
    user_sub        VARCHAR(255) NOT NULL,
    posting_id      BIGINT NOT NULL REFERENCES career_postings(id) ON DELETE CASCADE,
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    status          TEXT NOT NULL DEFAULT 'new',
        -- new -> promoted -> generated -> applied -> interview -> offer | dismissed | rejected
    -- Storage-RELATIVE paths under the user's own private storage, rooted at
    -- `intelligent-career/`. Never an absolute host path, and never the file itself:
    -- resumes are personal documents and live on the user's storage, not in the database.
    -- e.g. intelligent-career/applications/<Company>__<posting_id>/Resume.pdf
    resume_path     TEXT,
    cover_path      TEXT,
    -- Progression timestamps. These ARE the metrics: the funnel
    -- (sourced -> qualified -> resume -> applied -> interview -> offer) and every
    -- conversion rate on /progress derives from which of these are non-NULL.
    promoted_at     TIMESTAMPTZ,
    generated_at    TIMESTAMPTZ,
    outreach_sent_at TIMESTAMPTZ,
    applied_at      TIMESTAMPTZ,
    interview_at    TIMESTAMPTZ,
    offer_at        TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    outcome         TEXT,          -- 'offer' | 'rejected' | 'withdrawn' | 'ghosted'
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_sub, posting_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
--
-- Shaped by the 2026-07-29 SQLite pass, where the equivalent queries were doing
-- half-table scans. The lesson that transfers: index the ACTUAL query shape, and
-- verify with EXPLAIN rather than assuming the planner will find it.
-- ─────────────────────────────────────────────────────────────────────────────

-- Corpus: the scrape's per-company diff, and freshness windows.
CREATE INDEX IF NOT EXISTS idx_career_postings_company  ON career_postings(company_id);
CREATE INDEX IF NOT EXISTS idx_career_postings_seen     ON career_postings(first_seen_at DESC);
-- `active` alone is ~49% of the table and useless as a lead column; pair it with the
-- roll-up key so the per-company counts are index-only.
CREATE INDEX IF NOT EXISTS idx_career_postings_active_co ON career_postings(active, company_id);
CREATE INDEX IF NOT EXISTS idx_career_postings_fresh    ON career_postings(first_seen_at DESC)
    WHERE active;

-- The board: one user's ranked in-lane roles. Partial on the flags that are always in the
-- predicate, so the index holds only rows that can ever appear on a board.
CREATE INDEX IF NOT EXISTS idx_career_scores_board ON career_user_job_scores
    (user_sub, ai_fit_score DESC NULLS LAST) WHERE target_role;
-- The scorer's work queue: this user's unscored in-lane backlog, best keyword match first.
CREATE INDEX IF NOT EXISTS idx_career_scores_queue ON career_user_job_scores
    (user_sub, fit_score DESC) WHERE ai_fit_score IS NULL AND target_role;
-- The digest cursor is ai_scored_at (never posted_date -- ATS feeds omit it).
CREATE INDEX IF NOT EXISTS idx_career_scores_digest ON career_user_job_scores
    (user_sub, ai_scored_at DESC) WHERE ai_fit_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_career_scores_posting ON career_user_job_scores(posting_id);

-- The pipeline / funnel views.
--
-- NOTE the idx_career_USER_apps_ prefix. Postgres index names are unique per SCHEMA, not
-- per table, and migration 031 already owns `idx_career_apps_status` on the unrelated
-- career_hunter_applications table. Naming this one the same made
-- `CREATE INDEX IF NOT EXISTS` a silent no-op: no error, no warning, index simply absent,
-- while the two siblings below created fine. Caught 2026-07-30 by an adversarial audit,
-- not by anything failing. Prefix per-table, and see the duplicate-name guard in
-- tests/migration-index-names.test.mjs.
CREATE INDEX IF NOT EXISTS idx_career_user_apps_status  ON career_user_applications(user_sub, status);
CREATE INDEX IF NOT EXISTS idx_career_user_apps_applied ON career_user_applications
    (user_sub, applied_at DESC) WHERE applied_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_career_user_apps_posting ON career_user_applications(posting_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY on the two private tables only.
-- Same owner-or-operator shape as 060 Tier 1 / 090. FORCE so the table owner is not
-- exempt: without FORCE, a query on the app role's own tables bypasses the policy
-- entirely and every user's data is readable. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['career_user_job_scores', 'career_user_applications'] LOOP
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

-- The shared corpus is readable by everyone, but writable only by the ingest path. Reads
-- are intentionally unrestricted; a posting is public information. Writes go through the
-- scrape job running as the app role.
REVOKE INSERT, UPDATE, DELETE ON career_postings  FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON career_companies FROM PUBLIC;
