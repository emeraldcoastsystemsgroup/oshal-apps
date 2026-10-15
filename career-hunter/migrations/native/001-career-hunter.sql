-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Native statements of 090-107, which the native kernel skips (031, 077 and 082 still apply natively before this file): every table, column, index and compatibility view they declare, and the four pg_constraint-guarded CHECKs of 100-103 as DROP IF EXISTS + ADD. company_view reads career_companies directly (the same columns the companies view formats), because a native view cannot select from another view; views carry no public. prefix and are CREATE OR REPLACE (keeping PostgreSQL's grants), and postings is declared once, in 100's final shape. The owner-or-operator RLS DO loops, the relkind and app-role DO guards, the GRANT/REVOKE statements, the column comments and 106's change-capture PL/pgSQL trigger stay PostgreSQL-only; the native per-person scope and its owner-field check keep each person's rows their own. On PostgreSQL this file leaves the schema as 090-107 left it, except that company_view's definition reads career_companies directly, returning the same columns and values (checked with pg_dump before and after).

-- 091-career-automation.sql
CREATE TABLE IF NOT EXISTS career_automation_settings (
  user_sub      TEXT PRIMARY KEY,
  auto_generate BOOLEAN NOT NULL DEFAULT FALSE,
  auto_submit   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 100-career-user-targets.sql
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

-- 104-career-remote-only.sql
ALTER TABLE career_score_settings
  ADD COLUMN IF NOT EXISTS remote_only BOOLEAN NOT NULL DEFAULT FALSE;

-- 095-career-corpus.sql
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
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active          BOOLEAN NOT NULL DEFAULT TRUE,   -- closed roles flip inactive, never deleted
    CONSTRAINT career_postings_ats_uniq UNIQUE (company_id, ats_job_id)
);

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

CREATE TABLE IF NOT EXISTS career_user_applications (
    user_sub        VARCHAR(255) NOT NULL,
    posting_id      BIGINT NOT NULL REFERENCES career_postings(id) ON DELETE CASCADE,
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    status          TEXT NOT NULL DEFAULT 'new',
    resume_path     TEXT,
    cover_path      TEXT,
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

CREATE INDEX IF NOT EXISTS idx_career_postings_company  ON career_postings(company_id);

CREATE INDEX IF NOT EXISTS idx_career_postings_seen     ON career_postings(first_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_career_postings_active_co ON career_postings(active, company_id);

CREATE INDEX IF NOT EXISTS idx_career_postings_fresh    ON career_postings(first_seen_at DESC)
    WHERE active;

CREATE INDEX IF NOT EXISTS idx_career_scores_board ON career_user_job_scores
    (user_sub, ai_fit_score DESC NULLS LAST) WHERE target_role;

CREATE INDEX IF NOT EXISTS idx_career_scores_queue ON career_user_job_scores
    (user_sub, fit_score DESC) WHERE ai_fit_score IS NULL AND target_role;

CREATE INDEX IF NOT EXISTS idx_career_scores_digest ON career_user_job_scores
    (user_sub, ai_scored_at DESC) WHERE ai_fit_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_career_scores_posting ON career_user_job_scores(posting_id);

CREATE INDEX IF NOT EXISTS idx_career_user_apps_status  ON career_user_applications(user_sub, status);

CREATE INDEX IF NOT EXISTS idx_career_user_apps_applied ON career_user_applications
    (user_sub, applied_at DESC) WHERE applied_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_career_user_apps_posting ON career_user_applications(posting_id);

-- 096-career-corpus-complete.sql
ALTER TABLE career_companies ADD COLUMN IF NOT EXISTS hq              TEXT;

ALTER TABLE career_companies ADD COLUMN IF NOT EXISTS discover_status TEXT;

ALTER TABLE career_companies ADD COLUMN IF NOT EXISTS gsearched       BOOLEAN;

ALTER TABLE career_companies ADD COLUMN IF NOT EXISTS referral        INTEGER NOT NULL DEFAULT 0;

ALTER TABLE career_user_applications ADD COLUMN IF NOT EXISTS apply_active      INTEGER NOT NULL DEFAULT 1;

ALTER TABLE career_user_applications ADD COLUMN IF NOT EXISTS confirmation_path TEXT;

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

CREATE INDEX IF NOT EXISTS idx_career_user_recruiters_sub ON career_user_recruiter_firms(user_sub, status);

CREATE INDEX IF NOT EXISTS idx_career_user_gaps_sub       ON career_user_gap_themes(user_sub, n_jobs DESC);

CREATE INDEX IF NOT EXISTS idx_career_user_interviews_sub ON career_user_interview_assessments(user_sub, at DESC);

CREATE INDEX IF NOT EXISTS idx_career_companies_discover  ON career_companies(discover_status) WHERE discover_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_career_user_apps_active    ON career_user_applications(user_sub, apply_active)
    WHERE applied_at IS NULL;

-- 097-career-postings-view.sql
CREATE OR REPLACE VIEW companies WITH (security_invoker = true) AS
SELECT
    c.id,
    c.name,
    c.ticker,
    c.domain,
    c.homepage,
    c.careers_url,
    c.ats_type,
    c.ats_token,
    c.industry,
    c.hq,
    c.source_lists #>> '{}'                                           AS source_lists,
    c.discover_status,
    c.gsearched::int                                                  AS gsearched,
    c.referral,
    to_char(c.last_scraped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS last_scraped_at,
    to_char(c.created_at      AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS created_at
FROM career_companies c;

CREATE OR REPLACE VIEW company_reputation WITH (security_invoker = true) AS
SELECT
    r.company_id,
    r.ai_about,
    r.ai_positives,
    r.ai_negatives,
    r.ai_score,
    NULL::text                                                        AS ai_model,
    to_char(r.ai_rated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS ai_at,
    r.manual_about,
    r.manual_positives,
    r.manual_negatives,
    r.manual_score,
    r.manual_note,
    to_char(r.updated_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS manual_at
FROM career_company_reputation r;

CREATE OR REPLACE VIEW company_view WITH (security_invoker = true) AS
SELECT
    c.id, c.name, c.ticker, c.industry, c.hq, c.ats_type, c.ats_token,
    c.careers_url, c.discover_status,
    to_char(c.last_scraped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                 AS last_scraped_at,
    c.source_lists #>> '{}'                      AS source_lists,
    COALESCE(r.manual_about,     r.ai_about)     AS about,
    COALESCE(r.manual_positives, r.ai_positives) AS positives,
    COALESCE(r.manual_negatives, r.ai_negatives) AS negatives,
    COALESCE(r.manual_score,     r.ai_score)     AS score,
    CASE
        WHEN r.manual_score IS NOT NULL OR r.manual_about IS NOT NULL THEN 'manual'
        WHEN r.ai_score IS NOT NULL THEN 'ai'
        ELSE 'none'
    END AS reputation_source,
    (SELECT COUNT(*) FROM career_postings pc WHERE pc.company_id = c.id AND pc.active) AS open_roles
-- Reads career_companies directly with the companies view's two formatted columns: a native view
-- cannot select from another view.
FROM career_companies c
LEFT JOIN career_company_reputation r ON r.company_id = c.id;

-- 098-career-peruser-views.sql
CREATE OR REPLACE VIEW recruiter_firms WITH (security_invoker = true) AS
SELECT
    r.id,
    r.firm,
    r.bucket,
    r.website,
    r.contact_name,
    r.contact_role,
    r.contact_link,
    r.resume_label,
    r.channel,
    r.status,
    r.date_contacted,
    r.followup_date,
    r.next_action,
    r.notes,
    r.sort_order,
    r.updated_at
  FROM career_user_recruiter_firms r;

CREATE OR REPLACE VIEW gap_themes WITH (security_invoker = true) AS
SELECT
    g."key",
    g.n_jobs,
    g.avg_fit,
    g.sample_gaps,
    g.status,
    g.response,
    g.answered_at,
    g.updated_at
  FROM career_user_gap_themes g;

CREATE OR REPLACE VIEW interview_assessments WITH (security_invoker = true) AS
SELECT
    a.id,
    a.at,
    a.company,
    a.role,
    a.transcript,
    a.answers,
    a.result,
    a.finalized
  FROM career_user_interview_assessments a;

-- 099-career-interview-bank.sql
CREATE TABLE IF NOT EXISTS career_interview_bank (
    id          BIGSERIAL PRIMARY KEY,
    category    TEXT,                 -- domain_mustknow | domain_knowledge | technical | ...
    question    TEXT NOT NULL,
    good        TEXT,                 -- what a strong answer contains
    red_flag    TEXT,                 -- what a weak answer reveals
    source_dim  TEXT,                 -- which dimension agent emitted it
    qhash       TEXT UNIQUE,          -- sha1 of the normalized question text (dedup key)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS career_interview_bank_tags (
    entry_id    BIGINT NOT NULL REFERENCES career_interview_bank(id) ON DELETE CASCADE,
    dim         TEXT NOT NULL,        -- industry | technology | position
    tag         TEXT NOT NULL,        -- canonical vocabulary, or '*' for universal
    UNIQUE (entry_id, dim, tag)
);

CREATE TABLE IF NOT EXISTS career_posting_tags (
    posting_id  BIGINT NOT NULL REFERENCES career_postings(id) ON DELETE CASCADE,
    dim         TEXT NOT NULL,
    tag         TEXT NOT NULL,
    UNIQUE (posting_id, dim, tag)
);

CREATE INDEX IF NOT EXISTS idx_career_ibank_tags_dimtag ON career_interview_bank_tags(dim, tag);

CREATE INDEX IF NOT EXISTS idx_career_ibank_tags_entry  ON career_interview_bank_tags(entry_id);

CREATE INDEX IF NOT EXISTS idx_career_ptags_dimtag      ON career_posting_tags(dim, tag);

CREATE INDEX IF NOT EXISTS idx_career_ptags_posting     ON career_posting_tags(posting_id);

CREATE OR REPLACE VIEW interview_bank WITH (security_invoker = true) AS
  SELECT * FROM career_interview_bank;

CREATE OR REPLACE VIEW interview_bank_tags WITH (security_invoker = true) AS
  SELECT * FROM career_interview_bank_tags;

CREATE OR REPLACE VIEW posting_tags WITH (security_invoker = true) AS
  SELECT * FROM career_posting_tags;

-- 100-career-application-provenance.sql
ALTER TABLE career_user_applications
  ADD COLUMN IF NOT EXISTS application_source TEXT;

ALTER TABLE career_user_applications
  ADD COLUMN IF NOT EXISTS application_task_id TEXT;

ALTER TABLE career_hunter_applications
  ADD COLUMN IF NOT EXISTS application_source TEXT;

ALTER TABLE career_hunter_applications
  ADD COLUMN IF NOT EXISTS application_task_id TEXT;

UPDATE career_user_applications
   SET application_source = 'unverified'
 WHERE status = 'applied' AND application_source IS NULL;

UPDATE career_hunter_applications
   SET application_source = 'unverified'
 WHERE status = 'applied' AND application_source IS NULL;

ALTER TABLE career_user_applications DROP CONSTRAINT IF EXISTS career_user_application_source_check;

ALTER TABLE career_user_applications ADD CONSTRAINT career_user_application_source_check
  CHECK (application_source IS NULL OR application_source IN (
    'manual-mark', 'worker-reported', 'verified-submission', 'unverified'));

ALTER TABLE career_hunter_applications DROP CONSTRAINT IF EXISTS career_hunter_application_source_check;

ALTER TABLE career_hunter_applications ADD CONSTRAINT career_hunter_application_source_check
  CHECK (application_source IS NULL OR application_source IN (
    'manual-mark', 'worker-reported', 'verified-submission', 'unverified'));

CREATE OR REPLACE VIEW postings WITH (security_invoker = true) AS
SELECT
    p.id,
    p.company_id,
    p.ats_job_id,
    p.title,
    p.location,
    p.remote::int                                                     AS remote,
    p.department,
    p.url,
    p.description,
    to_char(p.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS posted_at,
    to_char(p.posted_date, 'YYYY-MM-DD')                              AS posted_date,
    p.state,
    p.city,
    p.lat,
    p.lon,
    p.job_type,
    s.target_role::int                                                AS target_role,
    p.salary_min::double precision                                    AS salary_min,
    p.salary_max::double precision                                    AS salary_max,
    p.salary_currency,
    p.salary_period,
    p.salary_raw,
    p.salary_source,
    to_char(p.first_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS first_seen_at,
    to_char(p.last_seen_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS last_seen_at,
    p.active::int                                                     AS active,
    s.fit_score,
    s.ai_fit_score,
    s.ai_fit_rationale,
    s.ai_fit_matched #>> '{}'                                         AS ai_fit_matched,
    s.ai_fit_gaps    #>> '{}'                                         AS ai_fit_gaps,
    to_char(s.ai_scored_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS ai_scored_at,
    s.ai_model,
    COALESCE(a.status, 'new')                                         AS status,
    a.resume_path,
    a.cover_path,
    to_char(a.generated_at     AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS generated_at,
    to_char(a.promoted_at      AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS promoted_at,
    to_char(a.applied_at       AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS applied_at,
    to_char(a.outreach_sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS outreach_sent_at,
    a.notes,
    COALESCE(a.apply_active, 1)                                       AS apply_active,
    a.confirmation_path,
    a.application_source,
    a.application_task_id
FROM career_postings p
LEFT JOIN career_user_job_scores   s ON s.posting_id = p.id
LEFT JOIN career_user_applications a ON a.posting_id = p.id;

-- 101-career-apply-claim-lease.sql
ALTER TABLE career_user_applications
  ADD COLUMN IF NOT EXISTS apply_claimed_at BIGINT;

ALTER TABLE career_user_applications DROP CONSTRAINT IF EXISTS career_user_apply_claimed_at_nonnegative;

ALTER TABLE career_user_applications ADD CONSTRAINT career_user_apply_claimed_at_nonnegative
  CHECK (apply_claimed_at IS NULL OR apply_claimed_at >= 0);

CREATE INDEX IF NOT EXISTS idx_career_user_apps_claim_lease
  ON career_user_applications(user_sub, apply_active, apply_claimed_at)
  WHERE apply_active = 0 AND applied_at IS NULL;

-- 102-career-apply-run-binding.sql
ALTER TABLE career_user_applications
  ADD COLUMN IF NOT EXISTS apply_run_id UUID;

ALTER TABLE career_user_applications
  ADD COLUMN IF NOT EXISTS apply_claim_token UUID;

ALTER TABLE career_user_applications DROP CONSTRAINT IF EXISTS career_user_apply_claim_token_requires_run;

ALTER TABLE career_user_applications ADD CONSTRAINT career_user_apply_claim_token_requires_run
  CHECK (apply_claim_token IS NULL OR apply_run_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_career_user_apps_apply_run
  ON career_user_applications(apply_run_id)
  WHERE apply_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_career_user_apps_claim_token
  ON career_user_applications(apply_claim_token)
  WHERE apply_claim_token IS NOT NULL;

-- 103-career-interview-source-identity.sql
ALTER TABLE career_user_interview_assessments
  ADD COLUMN IF NOT EXISTS source_id BIGINT;

ALTER TABLE career_user_interview_assessments DROP CONSTRAINT IF EXISTS career_user_interview_source_id_positive;

ALTER TABLE career_user_interview_assessments ADD CONSTRAINT career_user_interview_source_id_positive
  CHECK (source_id IS NULL OR source_id > 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_career_user_interview_source
  ON career_user_interview_assessments(user_sub, source_id)
  WHERE source_id IS NOT NULL;

-- 105-career-home-evidence-indexes.sql
CREATE INDEX IF NOT EXISTS idx_career_scores_home_period
 ON career_user_job_scores(user_sub, scored_at DESC);

CREATE INDEX IF NOT EXISTS idx_career_scores_home_latest
 ON career_user_job_scores(user_sub, scored_at DESC, posting_id) WHERE target_role;

-- 107-career-automation-owner-issuer.sql
ALTER TABLE career_automation_settings
  ADD COLUMN IF NOT EXISTS owner_issuer TEXT
  CHECK (owner_issuer IS NULL OR length(owner_issuer) BETWEEN 1 AND 2048);

-- 106-career-store-change-log.sql
CREATE TABLE IF NOT EXISTS career_store_change_log (
    change_id      BIGSERIAL PRIMARY KEY,
    txid           BIGINT NOT NULL DEFAULT txid_current(),
    schema_version SMALLINT NOT NULL DEFAULT 1,
    table_name     TEXT NOT NULL,
    owner_sub      TEXT,                 -- NULL for the shared corpus tables
    row_key        JSONB NOT NULL,       -- the source row's identity columns
    operation      TEXT NOT NULL,
    row_after      JSONB,                -- NULL for DELETE
    committed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT career_store_change_log_operation_check
      CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE'))
);

CREATE INDEX IF NOT EXISTS idx_career_change_log_txid
  ON career_store_change_log(txid, change_id);

CREATE TABLE IF NOT EXISTS career_reverse_sync_checkpoint (
    worker            TEXT PRIMARY KEY,
    horizon_txid      BIGINT NOT NULL DEFAULT 0,  -- every transaction below this id is projected
    last_change_id    BIGINT NOT NULL DEFAULT 0,  -- highest change_id applied so far
    applied_rows      BIGINT NOT NULL DEFAULT 0,
    row_failures      BIGINT NOT NULL DEFAULT 0,
    last_committed_at TIMESTAMPTZ,                -- committed_at of the newest applied row
    last_error        TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT career_reverse_sync_checkpoint_horizon_check CHECK (horizon_txid >= 0)
);
