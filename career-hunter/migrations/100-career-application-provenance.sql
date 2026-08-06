-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Add explicit application provenance and remote task correlation without promoting historical evidence-free rows to verified submissions.
-- 2 | maintainer@emeraldcoastsystemsgroup.com | Recreate the Postgres postings compatibility view with its legacy projection unchanged and append both provenance columns under security-invoker RLS.

ALTER TABLE career_user_applications
  ADD COLUMN IF NOT EXISTS application_source TEXT;
ALTER TABLE career_user_applications
  ADD COLUMN IF NOT EXISTS application_task_id TEXT;

ALTER TABLE career_hunter_applications
  ADD COLUMN IF NOT EXISTS application_source TEXT;
ALTER TABLE career_hunter_applications
  ADD COLUMN IF NOT EXISTS application_task_id TEXT;

-- A database migration cannot prove that an old host path still resolves to a contained regular
-- file on this node. Historical applied rows therefore start unverified; the SQLite compatibility
-- migration performs the stronger local-file classification when that user store is next opened.
UPDATE career_user_applications
   SET application_source = 'unverified'
 WHERE status = 'applied' AND application_source IS NULL;

UPDATE career_hunter_applications
   SET application_source = 'unverified'
 WHERE status = 'applied' AND application_source IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'career_user_application_source_check'
  ) THEN
    ALTER TABLE career_user_applications ADD CONSTRAINT career_user_application_source_check
      CHECK (application_source IS NULL OR application_source IN (
        'manual-mark', 'worker-reported', 'verified-submission', 'unverified'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'career_hunter_application_source_check'
  ) THEN
    ALTER TABLE career_hunter_applications ADD CONSTRAINT career_hunter_application_source_check
      CHECK (application_source IS NULL OR application_source IN (
        'manual-mark', 'worker-reported', 'verified-submission', 'unverified'
      ));
  END IF;
END $$;

-- PostgreSQL fixes a view's target list when CREATE VIEW runs; ALTER TABLE does not make later
-- base-table columns appear through `public.postings`. CREATE OR REPLACE preserves the view OID,
-- grants, and dependent objects while retaining security_invoker, so FORCE RLS on both per-user
-- joins remains the isolation boundary. Keep the migration 097 projection in the same order and
-- append new compatibility columns only at the end, as PostgreSQL requires for a replacement.
CREATE OR REPLACE VIEW public.postings WITH (security_invoker = true) AS
SELECT
    -- shared corpus: what the employer published
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
    -- this user's scores (FORCE-RLS filtered)
    s.fit_score,
    s.ai_fit_score,
    s.ai_fit_rationale,
    s.ai_fit_matched #>> '{}'                                         AS ai_fit_matched,
    s.ai_fit_gaps    #>> '{}'                                         AS ai_fit_gaps,
    to_char(s.ai_scored_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS ai_scored_at,
    s.ai_model,
    -- this user's application lifecycle (FORCE-RLS filtered)
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
