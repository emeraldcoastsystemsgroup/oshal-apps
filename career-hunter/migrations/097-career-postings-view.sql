-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-30 22:20:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Postgres replacement for the SQLite per-connection TEMP `postings` view. Adds the read-compat views (postings, companies, company_reputation, company_view) the ~60 existing `FROM postings` / `FROM companies` readers resolve against, shaped to SQLite's types so those readers need no edit. RLS on the per-user tables does the filtering; security_invoker makes that true regardless of who owns the view.
-- -----------------------------------------------------------------------------
--
-- WHY THIS EXISTS
--
-- engine/jobhunter/db.py::connect() builds a per-connection TEMP VIEW named `postings`
-- that joins corpus.postings_corpus to the user's user_signals table. SQLite's `temp`
-- namespace SHADOWS main and every ATTACHed schema, so ~53 `FROM postings` reads and ~68
-- `FROM companies` reads across the engine silently resolve to that join without ever
-- naming it. Postgres has no ATTACH and no per-connection temp-view shadowing, so the
-- shadow has to become a real, permanent object.
--
-- WHY NO `WHERE user_sub = ...` ANYWHERE IN THIS FILE  (read this before "fixing" it)
--
-- career_user_job_scores and career_user_applications carry FORCE ROW LEVEL SECURITY with
-- an owner-or-operator policy (migration 095). Every row the view can see through those
-- two tables is already restricted to `user_sub = current_setting('oshal.current_sub')`.
-- Adding a WHERE clause here would be redundant AND actively harmful: it would read as if
-- the WHERE is the isolation boundary, and the day someone deletes it for a "performance
-- fix" nothing would visibly break in a single-user dev box. The boundary is the policy.
--
-- Two consequences worth stating out loud:
--
--   1. WITHOUT the GUC the per-user tables return ZERO rows, so the LEFT JOINs contribute
--      only NULLs — fit_score/status/etc. come back empty. That is fail-closed: no other
--      user's judgement about a job is ever visible, in any GUC state. The shared corpus
--      itself stays readable, which is correct; a job posting is public information
--      republished from an employer's own ATS feed (095's rationale).
--
--   2. RLS is ALSO what keeps the join 1:1. Without it, joining 1.4M postings to a table
--      holding every user's scores would fan out one row per user per posting, and every
--      COUNT(*) in the dashboard would silently multiply. The policy is load-bearing for
--      correctness, not only for privacy.
--
-- WHY `security_invoker = true` IS NOT OPTIONAL
--
-- By default a Postgres view runs the underlying permission and RLS checks as the view's
-- OWNER, not as the caller. `oshal` (the database owner, and the role that applied 096 —
-- career_company_reputation is owned by it) is SUPERUSER with BYPASSRLS. A plain view
-- created by that role would evaluate the policies as a superuser, RLS would be bypassed
-- entirely, and `SELECT * FROM postings` would return EVERY user's scores joined to every
-- posting — a total isolation failure produced by nothing more than which role happened to
-- run the migration. security_invoker = true (Postgres 15+; this cluster is 16.14) pins the
-- checks to the calling role, which is the non-superuser, non-BYPASSRLS `oshal_app`.
-- Do not remove it, and do not create these views without it.
--
-- WHY THE COLUMNS ARE CAST BACK TO SQLITE SHAPES
--
-- The readers were written against SQLite and are not being rewritten by this migration.
-- Four type families would silently produce wrong answers or exceptions if passed through:
--
--   boolean  -> integer   `active`, `remote`, `target_role`. Readers say `active=1` /
--                         `COALESCE(p.target_role,0)=1` ~40 times; `boolean = integer` is
--                         a hard error in Postgres. `::int` also PRESERVES NULL (verified:
--                         `null::boolean::int` IS NULL), so "no score row yet" stays
--                         distinguishable from "scored, not in lane" — COALESCE(...,0) in
--                         the callers then does what it always did.
--   numeric  -> float8    salary_min/max. psycopg2 maps NUMERIC to decimal.Decimal, which
--                         raises TypeError the moment it meets a float in the salary
--                         arithmetic. SQLite stored REAL; double precision restores that.
--   timestamptz -> text   psycopg2 maps TIMESTAMPTZ to datetime; SQLite handed back the
--                         ISO-8601 strings db.py::now() writes. Readers slice them
--                         (`r["ai_scored_at"][:10]`) and compare them as strings. The
--                         format below is byte-identical to
--                         `datetime.now(timezone.utc).isoformat(timespec="seconds")`
--                         (e.g. 2026-07-30T22:14:39+00:00), which is what now() emits, so
--                         string comparison stays correct AND chronological.
--   jsonb    -> text      ai_fit_matched / ai_fit_gaps / source_lists. psycopg2 decodes
--                         JSONB into Python lists; every reader calls json.loads() on
--                         them, and cli.py/dashboard.py additionally run
--                         `source_lists LIKE ?`, for which no jsonb operator exists.
--
-- On that last one, note `#>> '{}'` rather than `::text`. Measured on the live corpus:
-- all 84,963 populated ai_fit_gaps / ai_fit_matched values are jsonb of type STRING, not
-- ARRAY — the SQLite->Postgres loader stored the JSON text as a JSON string, so `::text`
-- returns `"[\"gap one\", ...]"` and json.loads() hands the caller back a str instead of a
-- list. `#>> '{}'` extracts a scalar string's CONTENT and renders any other jsonb as its
-- normal text, so it is correct for the double-encoded rows already in the table AND for
-- the properly-encoded arrays db.py writes from here on. Verified against both shapes.
-- This unwraps an encoding mistake; it does not change or invent any value.
--
-- These views are READ-ONLY by construction (a view column that is an expression is not
-- auto-updatable). That is deliberate: every write goes through the dialect-aware helpers
-- in engine/jobhunter/db.py (corpus_table(), companies_table(), user_set()), so there is
-- exactly one place that knows the physical layout.
--
-- NAME COLLISION
--
-- `postings` and `companies` are generic names in a database shared by the whole platform.
-- oshal_app cannot CREATE SCHEMA (verified: `permission denied for database oshal`), so a
-- dedicated compat schema is not available to the package migration runner and these must
-- live in public. The guard below REFUSES to run if either name is already a real table,
-- rather than dropping somebody else's object.
--
-- Idempotent: DROP VIEW IF EXISTS + CREATE, so a shape change re-applies cleanly.

-- ── refuse to clobber a real table that happens to own one of these names ────
DO $$
DECLARE
  t text;
  k char;
BEGIN
  FOREACH t IN ARRAY ARRAY['postings', 'companies', 'company_reputation', 'company_view'] LOOP
    SELECT c.relkind INTO k
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF k IS NOT NULL AND k NOT IN ('v', 'm') THEN
      RAISE EXCEPTION
        'public.% already exists as relkind % (not a view) — career-hunter will not clobber it', t, k;
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- companies  — shared employer registry (career_companies), SQLite column shapes
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.company_view;
DROP VIEW IF EXISTS public.postings;
DROP VIEW IF EXISTS public.companies;
DROP VIEW IF EXISTS public.company_reputation;

CREATE VIEW public.companies WITH (security_invoker = true) AS
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
    -- json array as TEXT: cli.py:29 and dashboard.py:244 filter it with `LIKE ?`, and
    -- db.py::upsert_company json.loads() it. jsonb supports neither.
    c.source_lists #>> '{}'                                           AS source_lists,
    c.discover_status,
    c.gsearched::int                                                  AS gsearched,
    c.referral,
    to_char(c.last_scraped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS last_scraped_at,
    to_char(c.created_at      AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS created_at
FROM career_companies c;

-- ─────────────────────────────────────────────────────────────────────────────
-- company_reputation — shared. ai_* is the enricher layer, manual_* the operator
-- override. Column names follow the SQLite table: 096 named the timestamps
-- ai_rated_at / updated_at, the readers know them as ai_at / manual_at.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW public.company_reputation WITH (security_invoker = true) AS
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
-- NOTE ai_model: 096's career_company_reputation has no such column and this migration
-- does not invent one. It is surfaced as NULL so `SELECT ai_model FROM company_reputation`
-- keeps parsing; the value is genuinely absent, not fabricated. If the enricher needs it
-- persisted, that is an ALTER TABLE in a later migration, not a guess here.

-- ─────────────────────────────────────────────────────────────────────────────
-- postings — THE compatibility view. Replaces the SQLite TEMP view 1:1, same column
-- names in the same order, so `SELECT p.* FROM postings p` returns what it always did.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW public.postings WITH (security_invoker = true) AS
SELECT
    -- ── shared corpus: what the employer published ──────────────────────────
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
    -- target_role moved corpus -> per-user between the two schemas: "is this in MY lane"
    -- is a judgement about one person's career, not a property of the posting (095).
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
    -- ── this user's scores (RLS-filtered) ───────────────────────────────────
    s.fit_score,
    s.ai_fit_score,
    s.ai_fit_rationale,
    s.ai_fit_matched #>> '{}'                                         AS ai_fit_matched,
    s.ai_fit_gaps    #>> '{}'                                         AS ai_fit_gaps,
    to_char(s.ai_scored_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00'
                                                                      AS ai_scored_at,
    s.ai_model,
    -- ── this user's application lifecycle (RLS-filtered) ────────────────────
    -- 'new' mirrors the SQLite view's COALESCE: no application row == not started.
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
    -- apply_active defaults to 1 = claimable, matching the SQLite column default. A
    -- posting the user has never touched has no application row and must be claimable.
    COALESCE(a.apply_active, 1)                                       AS apply_active,
    a.confirmation_path
FROM career_postings p
-- LEFT on BOTH: the SQLite view LEFT JOINed user_signals onto the corpus, so an unscored
-- posting still appears with NULL signals. 144,814 of 1,427,675 postings have no score row
-- for the primary user; an inner join would hide them from every backlog query that exists
-- to FIND them.
LEFT JOIN career_user_job_scores   s ON s.posting_id = p.id
LEFT JOIN career_user_applications a ON a.posting_id = p.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- company_view — COALESCE manual over ai, plus the open-roles roll-up.
-- open_roles counts the SHARED corpus (every active posting at that employer), exactly as
-- the SQLite view did: it is a fact about the company, not about this user.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW public.company_view WITH (security_invoker = true) AS
SELECT
    c.id, c.name, c.ticker, c.industry, c.hq, c.ats_type, c.ats_token,
    c.careers_url, c.discover_status, c.last_scraped_at, c.source_lists,
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
FROM public.companies c
LEFT JOIN career_company_reputation r ON r.company_id = c.id;

-- Reads only. Writes go through db.py's dialect-aware helpers straight to the base tables;
-- these views are not auto-updatable anyway (their columns are expressions).
GRANT SELECT ON public.postings, public.companies, public.company_reputation, public.company_view TO PUBLIC;
