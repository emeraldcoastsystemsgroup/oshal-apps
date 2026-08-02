-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-30 23:20:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Compat views for the three PER-USER tables 097 missed: recruiter_firms, gap_themes, interview_assessments. Without them postgres mode raises UndefinedTable on the recruiter tracker, the gap analysis and the interview surface.
-- -----------------------------------------------------------------------------
--
-- 097 gave the SHARED corpus its compatibility views (postings, companies,
-- company_reputation, company_view) so ~60 existing `FROM postings` readers keep working
-- verbatim. It stopped there. The per-user tables have exactly the same problem: the engine
-- and routes say `FROM recruiter_firms` / `FROM gap_themes` / `FROM interview_assessments`,
-- which are SQLite table names that do not exist in Postgres.
--
-- Caught by an end-to-end probe of postgres mode, not by review:
--   recruiters  FAILED: UndefinedTable: relation "recruiter_firms" does not exist
--
-- security_invoker = true is REQUIRED on every one of these, for the same reason as 097: a
-- normal Postgres view runs as its OWNER, which bypasses the FORCE RLS on the underlying
-- per-user table and hands every caller the whole table. With security_invoker the view runs
-- as the CALLER, so the existing policy filters it to oshal.current_sub and these views need
-- no WHERE clause of their own. Omitting it fails silently and looks like it works — which
-- is the only failure mode that actually matters here.
--
-- The views deliberately do NOT expose user_sub. Callers never filtered by it under SQLite
-- (each user had their own file), so exposing it would invite code that filters manually and
-- quietly diverges from the policy.

DO $$
DECLARE
  t text;
  k char;
BEGIN
  FOREACH t IN ARRAY ARRAY['recruiter_firms', 'gap_themes', 'interview_assessments'] LOOP
    SELECT c.relkind INTO k
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF k IS NOT NULL AND k NOT IN ('v', 'm') THEN
      RAISE EXCEPTION
        'public.% already exists as relkind % (not a view) — refusing to clobber it', t, k;
    END IF;
  END LOOP;
END $$;

DROP VIEW IF EXISTS public.recruiter_firms;
DROP VIEW IF EXISTS public.gap_themes;
DROP VIEW IF EXISTS public.interview_assessments;

-- One row per RECRUITER (not per firm — a firm legitimately has several contacts).
CREATE VIEW public.recruiter_firms WITH (security_invoker = true) AS
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

-- Resume gap themes. `key` is quoted throughout: it is the SQLite column name and callers
-- select it by that name.
CREATE VIEW public.gap_themes WITH (security_invoker = true) AS
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

CREATE VIEW public.interview_assessments WITH (security_invoker = true) AS
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

GRANT SELECT ON public.recruiter_firms, public.gap_themes, public.interview_assessments TO PUBLIC;
