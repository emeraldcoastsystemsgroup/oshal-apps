-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-30 23:40:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Postgres home for the three tables engine/jobhunter/interview_bank.py creates for itself in SQLite (interview_bank, interview_bank_tags, posting_tags). Without this, `python -m jobhunter.interview_bank` is the one engine module that cannot run at all under JOBHUNTER_STORE=postgres — its SQLite CREATE TABLE script is not valid Postgres and there was nothing for it to read or write.
-- -----------------------------------------------------------------------------
--
-- WHY THIS EXISTS
--
-- 095/096 moved the jobs corpus and every per-user signal into the swarm database, but they
-- were derived from the two SQLite stores db.py knows about (corpus.db + user-<sub>.db).
-- interview_bank.py does NOT go through db.py's schema: it carries its own SCHEMA constant
-- and calls conn.executescript() on first use, so its three tables never appeared in either
-- dump and were missed. This migration is that omission, corrected — the schema below is
-- transcribed column-for-column from interview_bank.py's SCHEMA, not re-imagined.
--
-- WHY THESE ARE SHARED, NOT PER-USER (the decision, stated so it can be argued with)
--
-- Neither table holds a judgement about a person:
--
--   career_interview_bank / _tags  A tagged corpus of interview questions per industry /
--                                  technology / seniority, loaded from a JSON file that
--                                  ships with the package. "What does an oil & gas SRE
--                                  interview ask?" has the same answer for every user.
--   career_posting_tags            A write-through CACHE derived, deterministically, from
--                                  a posting's own title + description + employer industry
--                                  (interview_bank.py::derive_tags). Same inputs, same
--                                  output, for anybody. Making it per-user would duplicate
--                                  it 1.4M times per person to store identical rows.
--
-- So they follow career_postings / career_companies: shared, no RLS, no user_sub column.
-- Nothing here can leak between users because nothing here is about a user.
--
-- ONE CONSEQUENCE, DELIBERATE AND WORTH KNOWING. In SQLite MULTIUSER mode these tables were
-- created in the PER-USER database (executescript runs against `main`, which is user-<sub>.db),
-- so each user had a private copy by accident of plumbing rather than by design. Here there
-- is one copy. The visible difference is `interview_bank.py --load`, which calls
-- load_entries(replace=True) -> DELETE FROM the bank before reloading: in Postgres that
-- reload replaces the bank for EVERYONE. That is correct for a shared corpus and matches
-- how the file it loads from is shipped (one JSON per install), but it makes --load an
-- operator action rather than a per-user one. It is not gated here; gating a data load
-- behind a role check belongs in the CLI, not in a CREATE TABLE.
--
-- NAMING
--
-- `career_` prefix, matching 095/096. The SQLite names (`interview_bank`, `posting_tags`)
-- are far too generic for a schema shared by the whole platform — 097 had to add a
-- refuse-to-clobber guard precisely because `postings` and `companies` are. The engine maps
-- old name -> new name at one chokepoint (interview_bank.py::bank_table / bank_tags_table /
-- posting_tags_table), the same shape as db.py::corpus_table().
--
-- No compatibility VIEW is created for these three. 097's views exist because ~120 reads
-- name `postings`/`companies` without ever naming db.py; these three tables are read from
-- exactly one module, which already routes through the helpers above.
--
-- Index names are prefixed per table: Postgres index names are unique per SCHEMA, and
-- CREATE INDEX IF NOT EXISTS on a name another migration already took does nothing,
-- silently (see tests/migration-index-names.test.mjs and the 031/095 collision it pins).
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS throughout; safe to re-apply.

-- ─────────────────────────────────────────────────────────────────────────────
-- career_interview_bank — the question corpus
--
-- `id` MUST stay a real PRIMARY KEY. interview_bank.py::match() aggregates with
-- `GROUP BY e.id` while selecting e.category/e.question/e.good/e.red_flag/e.source_dim.
-- Postgres allows those un-grouped columns ONLY through functional dependency on a grouped
-- primary key; degrade this to a plain unique index and the matcher fails with
-- "column e.category must appear in the GROUP BY clause". (Verified live, both ways.)
--
-- `qhash` is UNIQUE and NULLABLE, exactly as in SQLite: it is the dedup key that collapses
-- the same question emitted by several dimension agents into one row, and it is the
-- conflict target for the ON CONFLICT DO NOTHING that replaces `INSERT OR IGNORE`.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- career_interview_bank_tags — (dim, tag) labels on a bank entry
--
-- The UNIQUE(entry_id, dim, tag) is load-bearing twice over: it is what makes re-running
-- --load idempotent, and it is the conflict target ON CONFLICT DO NOTHING needs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_interview_bank_tags (
    entry_id    BIGINT NOT NULL REFERENCES career_interview_bank(id) ON DELETE CASCADE,
    dim         TEXT NOT NULL,        -- industry | technology | position
    tag         TEXT NOT NULL,        -- canonical vocabulary, or '*' for universal
    UNIQUE (entry_id, dim, tag)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- career_posting_tags — the same (dim, tag) labels derived from a posting
--
-- The join key is (dim, tag) on BOTH tag tables, so matching one job is a single indexed
-- set-intersection whose cost tracks the matching rows, not the size of the bank. That is
-- the whole design; idx_career_ptags_dimtag / idx_career_ibank_tags_dimtag are what make
-- it true.
--
-- FK to career_postings, ON DELETE CASCADE — the SQLite table declared the same FK against
-- `postings`. A stale tag row for a deleted posting is a cache that lies.
-- ─────────────────────────────────────────────────────────────────────────────
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
-- backfill_posting_tags() asks "which in-lane postings have no tags yet" as a
-- NOT EXISTS on posting_id; idx_career_ptags_posting answers it as an index-only probe.

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS — so it does not matter which role applied this file
--
-- The package migration runner connects as the app role (career_postings and
-- career_companies are owned by oshal_app), but 096 and 097 were applied by hand as the
-- database owner `oshal`, and a table created by `oshal` gives the app role NO privileges
-- at all — the engine would fail with "permission denied for table career_interview_bank"
-- at the first read, long after the migration was recorded as applied.
--
-- Rather than hardcode a role name, grant to whoever owns career_postings: that is by
-- definition the role the engine's DATABASE_URL connects as, since it reads and writes that
-- table on every scrape. If this file is applied by that same role the block is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  app_role name;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO app_role
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'career_postings';

  IF app_role IS NOT NULL AND app_role <> current_user THEN
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON '
      'career_interview_bank, career_interview_bank_tags, career_posting_tags TO %I', app_role);
    -- BIGSERIAL: inserting a bank entry needs nextval() on the owning sequence too.
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE career_interview_bank_id_seq TO %I', app_role);
  END IF;
END $$;

-- ── compatibility views ──────────────────────────────────────────────────────
-- The tables above are career_-prefixed, but interview_bank.py says `FROM interview_bank`,
-- `FROM interview_bank_tags` and `FROM posting_tags` — the bare SQLite names. Creating the
-- tables without these views leaves the module exactly as broken as before, just with
-- storage behind it: `relation "interview_bank" does not exist`. Found by probing the
-- module in postgres mode, not by reading the migration.
--
-- Same pattern as 097/098. These three are SHARED (no RLS on the underlying tables), so
-- security_invoker is not load-bearing for isolation here the way it is on the per-user
-- views — but it is set anyway so every compat view in this package behaves identically
-- and nobody has to remember which kind they are looking at.

DO $$
DECLARE
  t text;
  k char;
BEGIN
  FOREACH t IN ARRAY ARRAY['interview_bank', 'interview_bank_tags', 'posting_tags'] LOOP
    SELECT c.relkind INTO k
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF k IS NOT NULL AND k NOT IN ('v', 'm') THEN
      RAISE EXCEPTION
        'public.% already exists as relkind % (not a view) — refusing to clobber it', t, k;
    END IF;
  END LOOP;
END $$;

DROP VIEW IF EXISTS public.interview_bank_tags;
DROP VIEW IF EXISTS public.posting_tags;
DROP VIEW IF EXISTS public.interview_bank;

CREATE VIEW public.interview_bank WITH (security_invoker = true) AS
  SELECT * FROM career_interview_bank;

CREATE VIEW public.interview_bank_tags WITH (security_invoker = true) AS
  SELECT * FROM career_interview_bank_tags;

CREATE VIEW public.posting_tags WITH (security_invoker = true) AS
  SELECT * FROM career_posting_tags;

GRANT SELECT ON public.interview_bank, public.interview_bank_tags, public.posting_tags TO PUBLIC;
