# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Carry application provenance, task correlation, and claim-lease timestamps through every Career storage backend with monotonic evidence updates.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve non-null evidence on equal-rank replays so a repeated worker or verified update cannot erase its existing task or confirmation reference.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Carry the durable Apply run id and one-time claim token through SQLite, legacy, and PostgreSQL application stores.
# 4 | maintainer@emeraldcoastsystemsgroup.com | Seed PostgreSQL recruiter rows with stable source ids matching their declared composite key.
# 5 | maintainer@emeraldcoastsystemsgroup.com | Make fresh SQLite schemas include every indexed corpus and lifecycle column before indexes and writes use them.
# 6 | maintainer@emeraldcoastsystemsgroup.com | Index the corpus for the pre-resume title browse so its keyword search is covered rather than scanning descriptions.

"""Storage layer. Two backends, selected by JOBHUNTER_STORE (see config.STORE).

  'sqlite'   (DEFAULT) — the legacy single-file `jobs.db`, or the MULTIUSER pair
             (per-user `user-<sub>.db` with the shared `corpus.db` ATTACHed and a
             per-connection TEMP `postings` view joining them). Unchanged.
  'postgres' — the swarm database: shared `career_postings` / `career_companies`, and
             the per-user `career_user_*` tables under FORCE ROW LEVEL SECURITY. The
             `postings` compatibility VIEW (migration 097) replaces the TEMP view, and
             the policy on the per-user tables — not a WHERE clause — is what scopes it
             to the acting user.

Reputation is stored in two layers on `company_reputation`:
  ai_*      -> filled by the AI enricher (flagged, directional)
  manual_*  -> filled by you; ALWAYS wins.
The `company_view` view COALESCEs manual over ai so readers get the effective value.

Application provenance is monotonic at the storage chokepoint: a later manual status assertion
cannot replace a worker report or a confirmation-backed record on any supported backend.
"""
from __future__ import annotations
import json
import sqlite3
from datetime import datetime, timezone
from contextlib import contextmanager

from . import config


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ═════════════════════════════════════════════════════════════════════════════
# POSTGRES BACKEND
#
# Everything below is reached ONLY when config.POSTGRES is true. The sqlite paths are
# untouched by design: the nightly scrape is running against them right now.
# ═════════════════════════════════════════════════════════════════════════════

# Values that are NOT a real identity. 'local' is config.USER_SUB's default when
# OSHAL_USER_SUB is absent, i.e. exactly the "nobody told us who is asking" case.
_NON_IDENTITIES = {"", "local", "default", "none", "null", "undefined", "anonymous", "unknown"}

# Counters for values that HAVE no column in the Postgres schema and are therefore
# dropped rather than guessed into some neighbouring column. Read with dropped_fields();
# nothing here is silently discarded, it is discarded and counted.
_DROPPED: dict[str, int] = {}


def dropped_fields() -> dict[str, int]:
    """Fields the Postgres schema cannot represent, and how many times each was dropped.
    A non-empty result is a schema gap to fix with a migration, never with a guess."""
    return dict(_DROPPED)


def _drop(field: str) -> None:
    _DROPPED[field] = _DROPPED.get(field, 0) + 1


import re as _re  # noqa: E402  (kept local to the postgres section)

_ISO_PREFIX = _re.compile(r"^\d{4}-\d{2}-\d{2}([ T]|$)")


def _pg_ts(v, field: str):
    """Coerce a raw ATS date string to something TIMESTAMPTZ accepts, or NULL + count it.

    SQLite is untyped and happily stored whatever the scraper found; ~20% of the corpus'
    posted_at values are the ATS's UI label ("Posted 30+ Days Ago", "Posted Today"), which
    Postgres rejects outright — one of them aborts the whole scrape transaction.

    They are NULLED, not parsed. Deriving "8 days before we first saw it" would invent a
    precision the source never had, and it costs nothing real: freshness keys off
    first_seen_at, which is populated for 100% of rows (095). The count is exposed by
    dropped_fields() so the loss is visible rather than assumed to be zero."""
    if v is None or v == "":
        return None
    s = str(v).strip()
    if not _ISO_PREFIX.match(s):
        _drop(field)
        return None
    return s


def require_sub() -> str:
    """The acting user's sub, or RAISE. This is the fail-closed gate.

    A Postgres connection with no `oshal.current_sub` is not merely unhelpful — it is a
    connection whose per-user reads return zero rows and whose per-user writes violate the
    RLS WITH CHECK. Refusing to open it at all turns a silent "the board is empty today"
    into an immediate, obvious error at the point of the mistake."""
    # OIDC subjects are opaque and case/whitespace-sensitive; validate without normalizing.
    sub = config.USER_SUB or ""
    if sub in _NON_IDENTITIES:
        raise RuntimeError(
            "JOBHUNTER_STORE=postgres requires a real OSHAL_USER_SUB; got "
            f"{config.USER_SUB!r}. Every per-user table is under FORCE ROW LEVEL SECURITY "
            "and is scoped by the oshal.current_sub GUC — running without a sub would read "
            "zero rows and write nothing. Set OSHAL_USER_SUB to the acting user."
        )
    return sub


def q(sql: str) -> str:
    """Rewrite SQLite-flavoured SQL text so psycopg2 can execute it.

    Does exactly two things, both outside string literals and comments:
      `?`  ->  `%s`   (sqlite3 qmark placeholders -> psycopg2 format placeholders)
      `%`  ->  `%%`   (psycopg2 interpolates the whole SQL string, so a literal percent —
                       `LIKE 'sr%'`, `to_char(..,'%')` — must be doubled or it is read as
                       the start of a placeholder)

    WHAT IT IS NOT. This is a placeholder translator, not a SQL translator. It does not
    and will not convert:
      - INSERT OR IGNORE / OR REPLACE      -> write ON CONFLICT yourself
      - date('now','-7 days') / julianday  -> write interval / epoch arithmetic yourself
      - GLOB, LIKE's SQLite case-insensitivity (Postgres LIKE is case-SENSITIVE; use ILIKE)
      - integer division, 0/1 booleans, || semantics
    Callers stay responsible for dialect. Adding "just one more" rewrite rule here is how a
    helper like this becomes an unreviewable half-parser that is wrong in the interesting
    cases; if a statement needs more than placeholders, branch on config.POSTGRES instead.

    LIMITS OF THE SCANNER. It tracks single-quoted literals, double-quoted identifiers,
    `--` line comments and `/* */` block comments. It does NOT understand dollar-quoted
    bodies ($$ ... $$) or E'' escape strings — do not route DO blocks or function bodies
    through it (they are Postgres-only anyway, so they never need `?` conversion).
    Only apply it to SQL that WILL be executed with parameters: doubling `%` in a
    statement psycopg2 executes with no parameters would leave the `%%` in the SQL."""
    out: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if ch == "-" and nxt == "-":                      # -- line comment
            j = sql.find("\n", i)
            j = n if j < 0 else j
            out.append(sql[i:j].replace("%", "%%"))
            i = j
        elif ch == "/" and nxt == "*":                    # /* block comment */
            j = sql.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(sql[i:j].replace("%", "%%"))
            i = j
        elif ch in ("'", '"'):                            # literal / quoted identifier
            j, quote = i + 1, ch
            while j < n:
                if sql[j] == quote:
                    if j + 1 < n and sql[j + 1] == quote:  # '' is an escaped quote
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            out.append(sql[i:j].replace("%", "%%"))
            i = j
        elif ch == "?":
            out.append("%s")
            i += 1
        elif ch == "%":
            out.append("%%")
            i += 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _pg_cursor_class():
    """psycopg2's DictCursor, with lastrowid made to fail loudly.

    sqlite3 sets cur.lastrowid after an INSERT; psycopg2's cursor also HAS the attribute
    but it is the row OID, which is 0 for every ordinary table. Returning 0 would hand the
    caller a plausible-looking wrong id. Raising points at the fix: RETURNING id."""
    from psycopg2.extras import DictCursor

    class _JobhunterCursor(DictCursor):
        @property
        def lastrowid(self):
            raise NotImplementedError(
                "lastrowid is meaningless in Postgres — use `INSERT ... RETURNING id` "
                "and read the value with fetchone()."
            )

    return _JobhunterCursor


class _PgConnection:
    """sqlite3.Connection-shaped wrapper so ~150 existing `conn.execute(sql, params)`
    call sites keep working. psycopg2 connections have no .execute(); this supplies it,
    converts placeholders through q(), and hands back a DictCursor whose rows support both
    `row["col"]` (sqlite3.Row style) and `row[0]` (tuple style)."""

    def __init__(self, raw, sub: str):
        self._raw = raw
        self._sub = sub
        self._cursor_class = _pg_cursor_class()

    # ── the GUC that IS the isolation boundary ──────────────────────────────
    def apply_sub_guc(self) -> None:
        """Bind this session to the acting user, then prove it took.

        `SET LOCAL` is TRANSACTION-scoped: psycopg2 opens a transaction on first execute
        and conn.commit() ends it, so a SET LOCAL applied at connect time is silently gone
        after the first commit — and backfill_geo() commits every 2000 rows mid-connection.
        Every read after that point would return zero rows: fail-closed, but broken. So the
        GUC is set at SESSION scope (set_config(..., is_local => false)) and re-asserted
        after every commit/rollback, which gives the same guarantee — no statement ever
        runs without a sub — without the mid-connection cliff.

        oshal.is_operator is explicitly forced OFF. We never want the operator bypass here;
        pinning it to 'off' means an inherited or pre-set session value cannot widen this
        connection's visibility. It is only ever turned down, never up."""
        cur = self._raw.cursor()
        cur.execute(
            "SELECT set_config('oshal.current_sub', %s, false), "
            "       set_config('oshal.is_operator', 'off', false)",
            (self._sub,),
        )
        cur.execute("SELECT current_setting('oshal.current_sub', true)")
        got = cur.fetchone()[0]
        cur.close()
        if got != self._sub:
            raise RuntimeError(
                f"oshal.current_sub did not stick (wanted {self._sub!r}, got {got!r}) — "
                "refusing to run queries against RLS tables with an unknown identity."
            )

    # ── sqlite3.Connection surface ──────────────────────────────────────────
    def execute(self, sql: str, params=None):
        cur = self._raw.cursor(cursor_factory=self._cursor_class)
        if params:
            cur.execute(q(sql), tuple(params))
        else:
            # No parameters -> psycopg2 does no interpolation -> the SQL must NOT be
            # percent-escaped, so it goes verbatim. A stray `?` here is a caller bug and
            # earns a syntax error from Postgres, exactly as sqlite3 would raise
            # ProgrammingError for a placeholder with nothing to bind.
            cur.execute(sql)
        return cur

    def executescript(self, script: str):
        cur = self._raw.cursor()
        cur.execute(script)
        cur.close()

    def commit(self) -> None:
        self._raw.commit()
        self.apply_sub_guc()

    def rollback(self) -> None:
        self._raw.rollback()
        self.apply_sub_guc()

    def close(self) -> None:
        self._raw.close()

    def cursor(self, *a, **kw):
        kw.setdefault("cursor_factory", self._cursor_class)
        return self._raw.cursor(*a, **kw)

    def __getattr__(self, name):
        return getattr(self._raw, name)


def _pg_open() -> _PgConnection:
    """Open an RLS-scoped Postgres connection, or raise. Never returns a usable
    connection without an identity bound to it."""
    sub = require_sub()
    if not config.DATABASE_URL:
        raise RuntimeError(
            "JOBHUNTER_STORE=postgres requires DATABASE_URL (the api container sets it)."
        )
    import psycopg2  # imported lazily so sqlite mode never needs the driver installed

    raw = psycopg2.connect(config.DATABASE_URL)
    conn = _PgConnection(raw, sub)
    try:
        conn.apply_sub_guc()
    except Exception:
        raw.close()
        raise
    return conn


@contextmanager
def connect():
    if config.POSTGRES:
        conn = _pg_open()
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()
        return
    if config.MULTIUSER:
        # Per-user DB holds the user's signals + the `postings` VIEW; the shared jobs
        # corpus is ATTACHed read/write as `corpus`. Reads of `postings` resolve to the
        # view (main shadows the attached corpus table `postings_corpus`).
        config.USER_DB.parent.mkdir(parents=True, exist_ok=True)
        config.CORPUS_DB.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(config.USER_DB, timeout=120)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 120000")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = OFF")  # FKs aren't enforced across an ATTACH boundary
        conn.execute("ATTACH DATABASE ? AS corpus", (str(config.CORPUS_DB),))
        _ensure_multiuser(conn)
    else:
        conn = sqlite3.connect(config.DB_PATH, timeout=120)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 120000")  # wait up to 2min on locks (concurrent scrape+score) instead of erroring
        conn.execute("PRAGMA journal_mode = WAL")     # readers don't block writers (dashboard + bot + jobs)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def corpus_table() -> str:
    """Physical table holding the shared/objective posting columns. In POSTGRES mode that
    is the swarm-wide `career_postings`; in MULTIUSER mode the ATTACHed
    `corpus.postings_corpus`; in legacy mode the inline `postings` table.
    Use this for any write of OBJECTIVE job data (title, salary, description, geo, active)."""
    if config.POSTGRES:
        return "career_postings"
    return "corpus.postings_corpus" if config.MULTIUSER else "postings"


def companies_table() -> str:
    """Physical employer registry. `companies` resolves through the ATTACH in sqlite mode
    and through the compat VIEW in postgres mode, so WRITES must name the base table."""
    return "career_companies" if config.POSTGRES else "companies"


def reputation_table() -> str:
    """Physical company-reputation table (shared in both backends)."""
    return "career_company_reputation" if config.POSTGRES else "company_reputation"


def read_postings_table() -> str:
    """What a read of objective posting columns should say FROM.

    sqlite: `postings` — the TEMP view, exactly as before (do not change this; the legacy
    single-file mode has no other table). postgres: the base `career_postings`, because
    the compat view drags two RLS-filtered joins along for reads that need none of them."""
    return "career_postings" if config.POSTGRES else "postings"


# Per-user signal columns — the only fields that differ user-to-user for the same job.
_USER_SIGNAL_COLS = (
    "fit_score", "ai_fit_score", "ai_fit_rationale", "ai_fit_matched", "ai_fit_gaps",
    "ai_scored_at", "ai_model", "status", "resume_path", "cover_path", "generated_at",
    "promoted_at", "applied_at", "interview_at", "offer_at", "closed_at", "outcome",
    "outreach_sent_at", "notes", "apply_active", "confirmation_path",
    "application_source", "application_task_id", "apply_claimed_at",
    "apply_run_id", "apply_claim_token",
)

# ── Postgres routing for user_set(): which per-user table owns which column ──
# SQLite kept all of these in ONE `user_signals` row; migration 095 split them by meaning
# — what we concluded about the job (scores) vs. what the user has DONE about it
# (applications). The split is the reason user_set() exists as a chokepoint at all: it is
# the only place that has to know.
_PG_SCORE_COLS = frozenset({
    "fit_score", "target_role", "ai_fit_score", "ai_fit_rationale",
    "ai_fit_matched", "ai_fit_gaps", "ai_model", "ai_scored_at",
})
_PG_APP_COLS = frozenset({
    "status", "resume_path", "cover_path", "promoted_at", "generated_at",
    "outreach_sent_at", "applied_at", "interview_at", "offer_at", "closed_at",
    "outcome", "notes", "apply_active", "confirmation_path", "application_source",
    "application_task_id", "apply_claimed_at", "apply_run_id", "apply_claim_token",
})
# Columns that are 0/1 integers in SQLite and real booleans in Postgres.
_PG_BOOL_COLS = frozenset({"target_role"})
_PROVENANCE_FIELDS = frozenset({
    "application_source", "application_task_id", "confirmation_path",
})


def _pg_bool(v):
    """0/1 (or None) -> True/False (or None). Postgres rejects `boolean = integer`."""
    return None if v is None else bool(v)


def _provenance_rank_sql(source: str) -> str:
    """SQL rank shared by SQLite/Postgres upserts; higher evidence never loses to lower."""
    return (
        f"CASE {source} WHEN 'verified-submission' THEN 4 "
        "WHEN 'worker-reported' THEN 3 WHEN 'manual-mark' THEN 2 "
        "WHEN 'unverified' THEN 1 ELSE 0 END"
    )


def _upsert_updates(current: str, incoming: str, keys: list[str]) -> str:
    """Build atomic assignments that retain stronger application provenance."""
    current_rank = _provenance_rank_sql(f"{current}.application_source")
    incoming_rank = _provenance_rank_sql(f"{incoming}.application_source")
    assignments = []
    for key in keys:
        if "application_source" in keys and key in _PROVENANCE_FIELDS:
            assignments.append(
                f"{key}=CASE WHEN {current_rank} > {incoming_rank} THEN {current}.{key} "
                f"WHEN {current_rank} < {incoming_rank} THEN {incoming}.{key} "
                f"ELSE COALESCE({incoming}.{key}, {current}.{key}) END"
            )
        elif key == "applied_at":
            assignments.append(f"{key}=COALESCE({current}.{key}, {incoming}.{key})")
        else:
            assignments.append(f"{key}={incoming}.{key}")
    return ", ".join(assignments)


def _legacy_update(conn, posting_id, cols: dict) -> None:
    """Apply the same monotonic evidence rule to the legacy inline-postings backend."""
    incoming_rank = {
        "verified-submission": 4, "worker-reported": 3,
        "manual-mark": 2, "unverified": 1,
    }.get(cols.get("application_source"), 0)
    current_rank = _provenance_rank_sql("application_source")
    sets, values = [], []
    for key, value in cols.items():
        if "application_source" in cols and key in _PROVENANCE_FIELDS:
            sets.append(
                f"{key}=CASE WHEN {current_rank} > ? THEN {key} "
                f"WHEN {current_rank} < ? THEN ? ELSE COALESCE(?, {key}) END"
            )
            values.extend((incoming_rank, incoming_rank, value, value))
        elif key == "applied_at":
            sets.append("applied_at=COALESCE(applied_at, ?)")
            values.append(value)
        else:
            sets.append(f"{key}=?")
            values.append(value)
    conn.execute(f"UPDATE postings SET {', '.join(sets)} WHERE id=?", (*values, posting_id))


def _pg_user_upsert(conn, table: str, posting_id, cols: dict, touch_updated: bool) -> None:
    """One upsert into one per-user table, keyed (user_sub, posting_id).

    user_sub is written explicitly from the connection's identity rather than left to a
    default: the RLS WITH CHECK clause compares it to oshal.current_sub, so a wrong or
    missing value is rejected by the database instead of landing in someone else's rows."""
    keys = list(cols)
    vals = [_pg_bool(cols[k]) if k in _PG_BOOL_COLS else cols[k] for k in keys]
    placeholders = ", ".join(["?"] * len(keys))
    updates = _upsert_updates(table, "EXCLUDED", keys)
    if touch_updated:
        updates += ", updated_at=NOW()"
    conn.execute(
        f"INSERT INTO {table} (user_sub, posting_id, {', '.join(keys)}) "
        f"VALUES (?, ?, {placeholders}) "
        f"ON CONFLICT (user_sub, posting_id) DO UPDATE SET {updates}",
        (require_sub(), posting_id, *vals),
    )


def user_set(conn, posting_id, **cols) -> None:
    """Write per-user signal columns for a posting. POSTGRES -> route each column to
    career_user_job_scores or career_user_applications and upsert (RLS scopes the row to
    the acting user); MULTIUSER -> upsert into the per-user `user_signals` table keyed by
    posting_id; legacy -> UPDATE the inline `postings` row.
    This is the single chokepoint for every per-user write (fit, AI fit, status, paths)."""
    if not cols:
        return
    if config.POSTGRES:
        unknown = set(cols) - _PG_SCORE_COLS - _PG_APP_COLS
        if unknown:
            # Loud, not lenient: silently dropping a per-user write is how a "saved"
            # status never reaches the board and nobody finds out for a fortnight.
            raise KeyError(
                f"user_set: no Postgres home for {sorted(unknown)} — add the column to a "
                "migration and to _PG_SCORE_COLS/_PG_APP_COLS, do not stuff it elsewhere."
            )
        scores = {k: v for k, v in cols.items() if k in _PG_SCORE_COLS}
        apps = {k: v for k, v in cols.items() if k in _PG_APP_COLS}
        if scores:
            _pg_user_upsert(conn, "career_user_job_scores", posting_id, scores, False)
        if apps:
            _pg_user_upsert(conn, "career_user_applications", posting_id, apps, True)
        return
    if config.MULTIUSER:
        keys = list(cols.keys())
        placeholders = ", ".join(["?"] * len(keys))
        updates = _upsert_updates("user_signals", "excluded", keys)
        conn.execute(
            f"INSERT INTO user_signals (posting_id, {', '.join(keys)}) "
            f"VALUES (?, {placeholders}) "
            f"ON CONFLICT(posting_id) DO UPDATE SET {updates}",
            (posting_id, *cols.values()),
        )
    else:
        _legacy_update(conn, posting_id, cols)


SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    ticker        TEXT,
    domain        TEXT,
    homepage      TEXT,
    careers_url   TEXT,
    ats_type      TEXT,            -- greenhouse | lever | ashby | smartrecruiters | workable | workday
    ats_token     TEXT,            -- board token, or 'tenant:dc:site' for workday
    industry      TEXT,
    hq            TEXT,
    source_lists  TEXT,            -- json array: which seed list(s) it came from
    discover_status TEXT DEFAULT 'pending',  -- pending | found | not_found | manual
    last_scraped_at TEXT,
    created_at    TEXT
);

CREATE TABLE IF NOT EXISTS postings (
    id            INTEGER PRIMARY KEY,
    company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    ats_job_id    TEXT NOT NULL,
    title         TEXT,
    location      TEXT,
    remote        INTEGER DEFAULT 0,
    department    TEXT,
    url           TEXT,            -- direct apply link on the corporate/ATS site
    description   TEXT,
    posted_at     TEXT,
    posted_date   TEXT,
    state         TEXT,
    city          TEXT,
    lat           REAL,
    lon           REAL,
    job_type      TEXT,
    target_role   INTEGER,
    fit_score     INTEGER,         -- cheap keyword match vs career_db (filled by `match`)
    -- salary (listed from the ATS, or AI-estimated)
    salary_min    REAL,
    salary_max    REAL,
    salary_currency TEXT,
    salary_period TEXT,            -- year | hour | month
    salary_raw    TEXT,            -- original text if unparsed
    salary_source TEXT,            -- 'listed' | 'ai_estimated'
    -- AI deep fit (filled by `score`)
    ai_fit_score    INTEGER,       -- 0-100
    ai_fit_rationale TEXT,
    ai_fit_matched  TEXT,          -- json array of matched qualifications
    ai_fit_gaps     TEXT,          -- json array of gaps/risks
    ai_scored_at    TEXT,
    ai_model        TEXT,
    -- application lifecycle
    status        TEXT DEFAULT 'new',  -- new | promoted | generated | applied | dismissed
    resume_path   TEXT,
    cover_path    TEXT,
    generated_at  TEXT,
    promoted_at   TEXT,
    applied_at    TEXT,
    interview_at  TEXT,
    offer_at      TEXT,
    closed_at     TEXT,
    outcome       TEXT,
    outreach_sent_at TEXT,
    apply_active  INTEGER DEFAULT 1,
    apply_claimed_at INTEGER,
    confirmation_path TEXT,
    application_source TEXT,
    application_task_id TEXT,
    apply_run_id TEXT,
    apply_claim_token TEXT,
    notes         TEXT,
    first_seen_at TEXT,
    last_seen_at  TEXT,
    active        INTEGER DEFAULT 1,
    UNIQUE(company_id, ats_job_id)
);
CREATE INDEX IF NOT EXISTS idx_postings_company ON postings(company_id);
CREATE INDEX IF NOT EXISTS idx_postings_active ON postings(active);
CREATE INDEX IF NOT EXISTS idx_postings_aifit ON postings(ai_fit_score);
CREATE INDEX IF NOT EXISTS idx_postings_status ON postings(status);
CREATE INDEX IF NOT EXISTS idx_postings_posted ON postings(posted_date);
-- Composite for the by-company report (target lane + AI fit), so it seeks the ~4k
-- qualifying rows instead of scanning every active posting.
CREATE INDEX IF NOT EXISTS idx_postings_report ON postings(target_role, ai_fit_score);

CREATE TABLE IF NOT EXISTS company_reputation (
    company_id     INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    ai_about       TEXT,
    ai_positives   TEXT,           -- json array
    ai_negatives   TEXT,           -- json array
    ai_score       INTEGER,        -- 0-100
    ai_model       TEXT,
    ai_at          TEXT,
    manual_about     TEXT,
    manual_positives TEXT,         -- json array
    manual_negatives TEXT,         -- json array
    manual_score     INTEGER,      -- 0-100
    manual_note      TEXT,
    manual_at        TEXT
);

-- Recruiter / headhunter outreach tracker (the "Recruiters" dashboard tab).
-- Standalone from the per-company live LinkedIn lookup in recruiters.py — this is the
-- persistent list of search firms + individual recruiters the user is working.
CREATE TABLE IF NOT EXISTS recruiter_firms (
    id            INTEGER PRIMARY KEY,
    firm          TEXT NOT NULL,
    bucket        TEXT,             -- Cleared / GovTech | Exec Search | SAP / ERP | Staffing
    website       TEXT,            -- best 'land here & submit' URL
    contact_name  TEXT,
    contact_role  TEXT,
    contact_link  TEXT,            -- email or LinkedIn URL for the named recruiter
    resume_label  TEXT,            -- which resume variant was sent (see RESUMES in dashboard)
    channel       TEXT,            -- LinkedIn | Email | Profile | Referral | Phone
    status        TEXT DEFAULT 'To contact',  -- To contact | Contacted | Replied | Call scheduled | Submitted me | On radar | Dead
    date_contacted TEXT,
    followup_date  TEXT,
    next_action    TEXT,
    notes          TEXT,
    sort_order     INTEGER DEFAULT 100,
    updated_at     TEXT
);

-- Interview -> realistic skill reassessment (transcript assessed vs. resume/claimed skills)
CREATE TABLE IF NOT EXISTS interview_assessments (
    id          INTEGER PRIMARY KEY,
    at          TEXT,
    company     TEXT,
    role        TEXT,
    transcript  TEXT,
    answers     TEXT,            -- answers to the calibration questions (round 2)
    result      TEXT,            -- JSON: demonstrated / overclaimed / underclaimed / assessed_skills / questions / summary
    finalized   INTEGER DEFAULT 0
);

CREATE VIEW IF NOT EXISTS company_view AS
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
    (SELECT COUNT(*) FROM postings p WHERE p.company_id = c.id AND p.active = 1) AS open_roles
FROM companies c
LEFT JOIN company_reputation r ON r.company_id = c.id;
"""


# ── Multi-user schemas ───────────────────────────────────────────────────────
# CORPUS = the shared jobs corpus (one row per job, objective columns only), used by
# every user. Lives in corpus.db (ATTACHed as `corpus`). companies + reputation are
# shared too.
CORPUS_SCHEMA = """
CREATE TABLE IF NOT EXISTS corpus.companies (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    ticker        TEXT, domain TEXT, homepage TEXT, careers_url TEXT,
    ats_type      TEXT, ats_token TEXT, industry TEXT, hq TEXT,
    source_lists  TEXT, discover_status TEXT DEFAULT 'pending',
    last_scraped_at TEXT, created_at TEXT, gsearched INTEGER DEFAULT 0,
    referral      INTEGER DEFAULT 0    -- warm-contact strength (0-3); boosts P(land) in the board
);

CREATE TABLE IF NOT EXISTS corpus.postings_corpus (
    id            INTEGER PRIMARY KEY,
    company_id    INTEGER NOT NULL,
    ats_job_id    TEXT NOT NULL,
    title         TEXT, location TEXT, remote INTEGER DEFAULT 0, department TEXT,
    url           TEXT, description TEXT, posted_at TEXT, posted_date TEXT,
    state         TEXT, city TEXT, lat REAL, lon REAL, job_type TEXT,
    target_role   INTEGER,
    salary_min    REAL, salary_max REAL, salary_currency TEXT, salary_period TEXT,
    salary_raw    TEXT, salary_source TEXT,
    first_seen_at TEXT, last_seen_at TEXT, active INTEGER DEFAULT 1,
    UNIQUE(company_id, ats_job_id)
);
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_company ON postings_corpus(company_id);
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_active  ON postings_corpus(active);
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_posted  ON postings_corpus(posted_date);
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_target  ON postings_corpus(target_role);
-- Board-feed composites. `active` and `target_role` are each ~50%/11% selective on their own, so
-- the single-column indexes above cannot serve the board's lane predicate; these can. Previously
-- these lived only in engine/_optimize_swarm_db.py, which nothing in the tree ever called — so a
-- fresh install ran the board without them and every deployment's performance depended on whether
-- a human had happened to run that script by hand.
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_lane ON postings_corpus(active, target_role);
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_company_active ON postings_corpus(company_id, active);
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_seen ON postings_corpus(first_seen_at DESC);
-- The pre-resume BROWSE search. A user with no indexed resume has no signal rows, so their board
-- is planned straight off the corpus and its keyword term matches titles only. `SELECT id ... WHERE
-- active=1 AND title LIKE ?` is COVERED by this index, which is the difference between scanning
-- ~65MB of title keys and dragging every row's inline 2.6KB description through the page cache.
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_browse ON postings_corpus(active, title);

CREATE TABLE IF NOT EXISTS corpus.company_reputation (
    company_id     INTEGER PRIMARY KEY,
    ai_about TEXT, ai_positives TEXT, ai_negatives TEXT, ai_score INTEGER, ai_model TEXT, ai_at TEXT,
    manual_about TEXT, manual_positives TEXT, manual_negatives TEXT, manual_score INTEGER,
    manual_note TEXT, manual_at TEXT
);

CREATE VIEW IF NOT EXISTS corpus.company_view AS
SELECT c.id, c.name, c.ticker, c.industry, c.hq, c.ats_type, c.ats_token,
       c.careers_url, c.discover_status, c.last_scraped_at, c.source_lists,
       COALESCE(r.manual_about, r.ai_about) AS about,
       COALESCE(r.manual_positives, r.ai_positives) AS positives,
       COALESCE(r.manual_negatives, r.ai_negatives) AS negatives,
       COALESCE(r.manual_score, r.ai_score) AS score,
       CASE WHEN r.manual_score IS NOT NULL OR r.manual_about IS NOT NULL THEN 'manual'
            WHEN r.ai_score IS NOT NULL THEN 'ai' ELSE 'none' END AS reputation_source,
       (SELECT COUNT(*) FROM corpus.postings_corpus p WHERE p.company_id = c.id AND p.active = 1) AS open_roles
FROM corpus.companies c
LEFT JOIN corpus.company_reputation r ON r.company_id = c.id;
"""

# USER = the per-user signals + the `postings` VIEW that joins the shared corpus row to this
# user's signals, so every existing `FROM postings` read works unchanged. Lives in user-{sub}.db.
USER_SCHEMA = """
CREATE TABLE IF NOT EXISTS user_signals (
    posting_id    INTEGER PRIMARY KEY,
    fit_score     INTEGER,
    ai_fit_score  INTEGER, ai_fit_rationale TEXT, ai_fit_matched TEXT, ai_fit_gaps TEXT,
    ai_scored_at  TEXT, ai_model TEXT,
    status        TEXT DEFAULT 'new',
    resume_path   TEXT, cover_path TEXT,
    generated_at  TEXT, promoted_at TEXT, applied_at TEXT, interview_at TEXT,
    offer_at TEXT, closed_at TEXT, outcome TEXT, outreach_sent_at TEXT, notes TEXT,
    apply_active  INTEGER DEFAULT 1,   -- apply-operator claim lock: 1=available, 0=claimed/in-flight
    apply_claimed_at INTEGER,          -- epoch-ms lease start; NULL identifies a legacy claim
    apply_run_id TEXT,                 -- durable core apply_runs correlation, retained after settle
    apply_claim_token TEXT,            -- one-time exact release/settlement token
    confirmation_path TEXT,            -- saved submission-confirmation screenshot (set on 'applied')
    application_source TEXT,           -- manual-mark | worker-reported | verified-submission | unverified
    application_task_id TEXT           -- exact remote task id when a worker reported the outcome
);
CREATE INDEX IF NOT EXISTS idx_user_aifit  ON user_signals(ai_fit_score);
CREATE INDEX IF NOT EXISTS idx_user_status ON user_signals(status);
CREATE INDEX IF NOT EXISTS idx_user_fit    ON user_signals(fit_score);
-- The board feed drives from these: it walks the user's signal rows in sort-key order and stops
-- once the page is full, instead of joining the whole corpus and sorting. idx_user_scored is what
-- makes the default "best fit" feed an index seek; the partial WHERE keeps it to the ~7% of rows
-- that carry an AI score. idx_user_applied covers the Submitted/Ready pipeline tabs, whose sort
-- key (applied_at / generated_at) otherwise forced a scan of every signal row.
CREATE INDEX IF NOT EXISTS idx_user_scored ON user_signals(ai_fit_score DESC, posting_id)
    WHERE ai_fit_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_status_posting ON user_signals(status, posting_id);
CREATE INDEX IF NOT EXISTS idx_user_applied ON user_signals(status, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_generated ON user_signals(generated_at DESC)
    WHERE generated_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS recruiter_firms (
    id INTEGER PRIMARY KEY, firm TEXT NOT NULL, bucket TEXT, website TEXT,
    contact_name TEXT, contact_role TEXT, contact_link TEXT, resume_label TEXT,
    channel TEXT, status TEXT DEFAULT 'To contact', date_contacted TEXT, followup_date TEXT,
    next_action TEXT, notes TEXT, sort_order INTEGER DEFAULT 100, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS interview_assessments (
    id INTEGER PRIMARY KEY, at TEXT, company TEXT, role TEXT,
    transcript TEXT, answers TEXT, result TEXT, finalized INTEGER DEFAULT 0
);
"""

# The compatibility `postings` VIEW joins the shared corpus row to this user's signals
# (status defaults to 'new'). SQLite forbids a PERSISTENT view from referencing an ATTACHed
# database, so it must be a TEMP view, recreated on every connection. `temp` shadows main +
# attached in name resolution, so existing `FROM postings` reads transparently hit this.
_POSTINGS_VIEW_SQL = """
CREATE TEMP VIEW IF NOT EXISTS postings AS
SELECT pc.id, pc.company_id, pc.ats_job_id, pc.title, pc.location, pc.remote, pc.department,
       pc.url, pc.description, pc.posted_at, pc.posted_date, pc.state, pc.city, pc.lat, pc.lon,
       pc.job_type, pc.target_role, pc.salary_min, pc.salary_max, pc.salary_currency,
       pc.salary_period, pc.salary_raw, pc.salary_source, pc.first_seen_at, pc.last_seen_at, pc.active,
       us.fit_score, us.ai_fit_score, us.ai_fit_rationale, us.ai_fit_matched, us.ai_fit_gaps,
       us.ai_scored_at, us.ai_model,
       COALESCE(us.status, 'new') AS status,
       us.resume_path, us.cover_path, us.generated_at, us.promoted_at, us.applied_at,
       us.interview_at, us.offer_at, us.closed_at, us.outcome, us.outreach_sent_at,
       us.notes, us.apply_active, us.apply_claimed_at, us.confirmation_path,
       us.application_source, us.application_task_id, us.apply_run_id, us.apply_claim_token
FROM corpus.postings_corpus pc
LEFT JOIN user_signals us ON us.posting_id = pc.id;
"""

# Schema is ensured once per (corpus,user) DB pair per process; the temp view is per-connection.
_multiuser_inited: set = set()

# user_signals columns added after v1; ALTERed onto an existing per-user DB (CREATE IF NOT EXISTS
# skips a table that already exists, so new columns need an explicit ADD COLUMN).
_USER_ADDED_COLUMNS = {
    "apply_active": "INTEGER DEFAULT 1",
    "apply_claimed_at": "INTEGER",
    "apply_run_id": "TEXT",
    "apply_claim_token": "TEXT",
    "interview_at": "TEXT",
    "offer_at": "TEXT",
    "closed_at": "TEXT",
    "outcome": "TEXT",
    "confirmation_path": "TEXT",
    "application_source": "TEXT",
    "application_task_id": "TEXT",
}


def _ensure_user_columns(conn) -> None:
    """Idempotently add post-v1 columns to an existing user_signals table."""
    have = {r[1] for r in conn.execute("PRAGMA table_info(user_signals)").fetchall()}
    for col, decl in _USER_ADDED_COLUMNS.items():
        if col not in have:
            try:
                conn.execute(f"ALTER TABLE user_signals ADD COLUMN {col} {decl}")
            except Exception:
                pass  # concurrent add / already present — safe to ignore


def _ensure_multiuser(conn) -> None:
    """Create the shared corpus + per-user base tables once per process, then (re)create the
    per-connection TEMP `postings` view that joins them. Called from connect() in MULTIUSER mode."""
    key = (str(config.CORPUS_DB), str(config.USER_DB))
    if key not in _multiuser_inited:
        conn.executescript(CORPUS_SCHEMA)
        conn.executescript(USER_SCHEMA)
        _ensure_user_columns(conn)   # backfill new columns onto pre-existing user DBs
        _ensure_planner_stats(conn)
        _multiuser_inited.add(key)
    conn.executescript(_POSTINGS_VIEW_SQL)


def _ensure_planner_stats(conn) -> None:
    """Make sure the query planner has table statistics.

    Without a populated `sqlite_stat1`, SQLite picks an index by rule-of-thumb, and on this data
    it picks badly: both databases shipped with no stats at all, so the board's planner chose
    ~50%-selective single-column indexes over the composites and built a temp b-tree over the
    whole result. ANALYZE is a full pass, so it runs only when stats are genuinely absent —
    refreshing them after bulk ingest is the ingest path's job, not something to pay on connect.
    """
    for schema in ("main", "corpus"):
        try:
            row = conn.execute(
                f"SELECT COUNT(*) FROM {schema}.sqlite_master WHERE name='sqlite_stat1'"
            ).fetchone()
            if row and row[0]:
                continue
            conn.execute(f"ANALYZE {schema}")
        except Exception:
            pass  # read-only handle or a concurrent writer — the board still works, just slower


# Columns added after v1; migrate() adds any missing from an existing DB.
_POSTING_ADDED_COLUMNS = {
    "salary_min": "REAL", "salary_max": "REAL", "salary_currency": "TEXT",
    "salary_period": "TEXT", "salary_raw": "TEXT", "salary_source": "TEXT",
    "ai_fit_score": "INTEGER", "ai_fit_rationale": "TEXT", "ai_fit_matched": "TEXT",
    "ai_fit_gaps": "TEXT", "ai_scored_at": "TEXT", "ai_model": "TEXT",
    "status": "TEXT", "resume_path": "TEXT", "cover_path": "TEXT",
    "generated_at": "TEXT", "promoted_at": "TEXT", "applied_at": "TEXT",
    "interview_at": "TEXT", "offer_at": "TEXT", "closed_at": "TEXT", "outcome": "TEXT",
    "notes": "TEXT", "apply_active": "INTEGER DEFAULT 1",
    "confirmation_path": "TEXT", "application_source": "TEXT", "application_task_id": "TEXT",
    "apply_claimed_at": "INTEGER", "apply_run_id": "TEXT", "apply_claim_token": "TEXT",
    "outreach_sent_at": "TEXT",  # recruiter intro sent for THIS role (separate from apply status)
    "posted_date": "TEXT",  # normalized YYYY-MM-DD
    "state": "TEXT",         # parsed 2-letter US state (for the geo map / filtering)
    "city": "TEXT",          # geocoded city key (normalized lowercase) for the map / filtering
    "lat": "REAL", "lon": "REAL",  # city centroid for the geo map (None -> falls back to state)
    "job_type": "TEXT",      # fte | contract | intern | parttime  (employment type)
    "target_role": "INTEGER",  # 1 = in the user's target lane, 0 = out-of-lane (retail/labor/clinical)
}


def migrate(conn) -> None:
    if config.POSTGRES:
        # DDL in postgres mode belongs to migrations/095..097, applied by the swarm's
        # package-migration runner and tracked in app_package_migrations. The engine must
        # not ALTER the shared corpus behind that runner's back: it is one table for every
        # user, and PRAGMA table_info does not exist here anyway.
        return
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(postings)").fetchall()}
    for name, typ in _POSTING_ADDED_COLUMNS.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE postings ADD COLUMN {name} {typ}")
    conn.execute("UPDATE postings SET status = 'new' WHERE status IS NULL")
    # companies: gsearched flag tracks the slow-roll Google careers-URL pass
    ccols = {r["name"] for r in conn.execute("PRAGMA table_info(companies)").fetchall()}
    if "gsearched" not in ccols:
        conn.execute("ALTER TABLE companies ADD COLUMN gsearched INTEGER DEFAULT 0")


# Seed list for the recruiter tracker (verified URLs, June 2026). Buckets match the
# Headhunter_Target_List.md the user already has. (firm, bucket, website, sort_order)
_RECRUITER_SEED = [
    ("ClearanceJobs (build profile)", "Cleared / GovTech", "https://www.clearancejobs.com/", 10),
    ("iQuasar", "Cleared / GovTech", "https://iquasar.com/service-offerings/cleared-recruitment/", 11),
    ("Sparks Group", "Cleared / GovTech", "https://sparksgroupinc.com/security-clearance-recruiting/", 12),
    ("ClearanceRecruiter", "Cleared / GovTech", "https://clearancerecruiter.com/", 13),
    ("Next Step Systems", "Cleared / GovTech", "https://www.nextstepsystems.com/security-clearance-cleared-it-jobs/", 14),
    ("Parallel Partners", "Cleared / GovTech", "https://www.parallelpartners.com/security-clearance-cleared-it-jobs/", 15),
    ("True (True Search)", "Exec Search", "https://trueplatform.com/true-search/", 20),
    ("Riviera Partners", "Exec Search", "https://www.rivierapartners.com/", 21),
    ("Heidrick & Struggles", "Exec Search", "https://www.heidrick.com/", 22),
    ("Korn Ferry", "Exec Search", "https://www.kornferry.com/", 23),
    ("Russell Reynolds", "Exec Search", "https://www.russellreynolds.com/", 24),
    ("Bespoke Partners", "Exec Search", "https://bespokepartners.com/", 25),
    ("Next Ventures", "SAP / ERP", "https://next-ventures.us/practices/sap-recruitment-agency/", 30),
    ("JRG Partners", "SAP / ERP", "https://www.jrgpartners.com/sap-executive-recruiters/", 31),
    ("Vortex Consulting", "SAP / ERP", "https://vortexconsulting.net/sap-solutions/sap-staffing/", 32),
    ("Procom", "SAP / ERP", "https://procomservices.com/en-us/sap-recruitment-experts/", 33),
    ("Alpha Apex Group", "SAP / ERP", "https://www.alphaapexgroup.com/", 34),
    ("Panorama Consulting", "SAP / ERP", "https://www.panorama-consulting.com/", 35),
]


def seed_recruiters(conn) -> int:
    """Populate the recruiter tracker the first time only (never clobbers edits)."""
    if config.POSTGRES:
        # career_user_recruiter_firms is per-user and FORCE-RLS'd, so the count below
        # already sees only this user's rows — the seed is per-person, as it should be.
        n = conn.execute(
            "SELECT COUNT(*) AS c FROM career_user_recruiter_firms").fetchone()["c"]
        if n:
            return 0
        for source_id, (firm, bucket, site, order) in enumerate(_RECRUITER_SEED, start=1):
            conn.execute(
                "INSERT INTO career_user_recruiter_firms "
                "(user_sub, id, firm, bucket, website, resume_label, status, sort_order, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (user_sub, id) DO NOTHING",
                (require_sub(), source_id, firm, bucket, site, "Headhunter (broad) — PDF",
                 "To contact", order, now()))
        return len(_RECRUITER_SEED)
    n = conn.execute("SELECT COUNT(*) c FROM recruiter_firms").fetchone()["c"]
    if n:
        return 0
    for firm, bucket, site, order in _RECRUITER_SEED:
        conn.execute(
            "INSERT INTO recruiter_firms (firm, bucket, website, resume_label, sort_order, updated_at) "
            "VALUES (?,?,?,?,?,?)",
            (firm, bucket, site, "Headhunter (broad) — PDF", order, now()))
    return len(_RECRUITER_SEED)


def init_db() -> None:
    with connect() as conn:
        if config.POSTGRES:
            # Schema is owned by migrations/; connect() already proved the identity binds.
            seed_recruiters(conn)
            return
        if not config.MULTIUSER:
            conn.executescript(SCHEMA)
            migrate(conn)
        # MULTIUSER: schema is ensured in connect() via _ensure_multiuser().
        seed_recruiters(conn)


def _as_list(v) -> list:
    """source_lists is TEXT holding JSON in SQLite and JSONB in Postgres (psycopg2 decodes
    it to a Python list). Accept either without pretending one is the other."""
    if not v:
        return []
    if isinstance(v, (list, tuple)):
        return list(v)
    return json.loads(v)


# ── companies ────────────────────────────────────────────────────────────────
def upsert_company(conn, name: str, **fields) -> int:
    """Insert or update a company by unique name. Returns company id."""
    ct = companies_table()
    row = conn.execute(f"SELECT id, source_lists FROM {ct} WHERE name = ?", (name,)).fetchone()
    src = fields.pop("source_list", None)
    if config.POSTGRES and "gsearched" in fields:
        # 0/1 in SQLite, BOOLEAN in career_companies.
        fields["gsearched"] = _pg_bool(fields["gsearched"])
    if config.POSTGRES and "last_scraped_at" in fields:
        fields["last_scraped_at"] = _pg_ts(fields["last_scraped_at"], "companies.last_scraped_at")
    if row:
        cid = row["id"]
        if src:
            existing = set(_as_list(row["source_lists"]))
            existing.add(src)
            fields["source_lists"] = json.dumps(sorted(existing))
        if fields:
            cols = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE {ct} SET {cols} WHERE id = ?", (*fields.values(), cid))
        return cid
    fields["source_lists"] = json.dumps([src] if src else [])
    fields["created_at"] = now()
    keys = ["name", *fields.keys()]
    vals = [name, *fields.values()]
    ph = ", ".join("?" * len(keys))
    if config.POSTGRES:
        # No lastrowid in Postgres — ask for the id back. RETURNING is also atomic with
        # the insert, so a concurrent scraper cannot hand us a different company's id.
        cur = conn.execute(
            f"INSERT INTO {ct} ({', '.join(keys)}) VALUES ({ph}) RETURNING id", vals)
        return cur.fetchone()[0]
    cur = conn.execute(f"INSERT INTO {ct} ({', '.join(keys)}) VALUES ({ph})", vals)
    return cur.lastrowid


# ── postings ─────────────────────────────────────────────────────────────────
def upsert_posting(conn, company_id: int, p: dict) -> str:
    """Insert/refresh a normalized posting dict. Returns 'new' | 'seen'.

    Listed salary (from the ATS) is stored with salary_source='listed' and never
    overwrites an existing salary unless the feed provides one.
    """
    ts = now()
    has_salary = p.get("salary_min") is not None or p.get("salary_max") is not None or p.get("salary_raw")
    sal = (p.get("salary_min"), p.get("salary_max"), p.get("salary_currency"),
           p.get("salary_period"), p.get("salary_raw"), "listed" if has_salary else None)
    existing = conn.execute(
        f"SELECT id FROM {read_postings_table()} WHERE company_id = ? AND ats_job_id = ?",
        (company_id, str(p["ats_job_id"])),
    ).fetchone()
    ct = corpus_table()
    # `remote` and `active` are 0/1 INTEGERs in SQLite and real BOOLEANs in Postgres.
    remote = bool(p.get("remote", 0)) if config.POSTGRES else int(p.get("remote", 0))
    yes = "TRUE" if config.POSTGRES else "1"
    # SQLite took the raw feed value; a TIMESTAMPTZ column will not.
    posted_at_val = _pg_ts(p.get("posted_at"), "postings.posted_at") if config.POSTGRES \
        else p.get("posted_at")
    if existing:
        conn.execute(
            f"""UPDATE {ct} SET title=?, location=?, remote=?, department=?, url=?,
               description=?, posted_at=?, last_seen_at=?, active={yes} WHERE id=?""",
            (p.get("title"), p.get("location"), remote, p.get("department"),
             p.get("url"), p.get("description"), posted_at_val, ts, existing["id"]),
        )
        if has_salary:
            conn.execute(
                f"""UPDATE {ct} SET salary_min=?, salary_max=?, salary_currency=?,
                   salary_period=?, salary_raw=?, salary_source=? WHERE id=?""",
                (*sal, existing["id"]),
            )
        return "seen"
    from . import dates, geo, jobtype, lane
    posted_date = dates.normalize(p.get("posted_at"), ts)
    state = geo.state_of(p.get("location"))
    place = geo.place_of(p.get("location"), state)
    city, lat, lon = place if place else (None, None, None)
    jtype = jobtype.classify(p.get("title"), p.get("job_type_hint"))
    target = 1 if lane.is_target_role(p.get("title")) else 0
    if config.POSTGRES:
        if not p.get("title"):
            # career_postings.title is NOT NULL and there is nothing truthful to put there.
            # Skipping and counting beats inventing '(untitled)' (which is what the one-off
            # SQLite loader did) and beats aborting the whole scrape transaction over one
            # malformed feed row. Callers only test for 'new'/'seen', so a third value is
            # counted by neither.
            _drop("postings.title(row skipped: NOT NULL)")
            return "skipped"
        # Two columns leave the shared row here. `status` is per-user for the same reason
        # it is in MULTIUSER mode. `target_role` ("is this in MY lane?") became per-user in
        # 095: the same Principal Platform Engineer posting is the whole point for one user
        # and noise for another, so it is a judgement about a person, not about the job.
        # It is written immediately below through user_set() so `WHERE target_role=1`
        # readers see it, scoped to whoever ran the scrape.
        cur = conn.execute(
            f"""INSERT INTO {ct} (company_id, ats_job_id, title, location, remote, department,
               url, description, posted_at, posted_date, state, city, lat, lon, job_type,
               salary_min, salary_max, salary_currency,
               salary_period, salary_raw, salary_source, first_seen_at, last_seen_at, active)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,TRUE)
               RETURNING id""",
            (company_id, str(p["ats_job_id"]), p.get("title"), p.get("location"),
             remote, p.get("department"), p.get("url"), p.get("description"),
             posted_at_val, posted_date, state, city, lat, lon, jtype, *sal, ts, ts),
        )
        user_set(conn, cur.fetchone()[0], target_role=target)
        return "new"
    # In MULTIUSER mode `status` lives per-user (user_signals), not on the shared corpus row.
    status_col = "" if config.MULTIUSER else "status, "
    status_val = "" if config.MULTIUSER else "'new', "
    conn.execute(
        f"""INSERT INTO {ct} (company_id, ats_job_id, title, location, remote, department,
           url, description, posted_at, posted_date, state, city, lat, lon, job_type, target_role,
           salary_min, salary_max, salary_currency,
           salary_period, salary_raw, salary_source, {status_col}first_seen_at, last_seen_at, active)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, {status_val}?,?,1)""",
        (company_id, str(p["ats_job_id"]), p.get("title"), p.get("location"),
         int(p.get("remote", 0)), p.get("department"), p.get("url"), p.get("description"),
         p.get("posted_at"), posted_date, state, city, lat, lon, jtype, target, *sal, ts, ts),
    )
    return "new"


def backfill_dates(conn, limit=None) -> int:
    """Populate posted_date (normalized YYYY-MM-DD) for rows that don't have it yet."""
    from . import dates
    sql = (f"SELECT id, posted_at, first_seen_at FROM {read_postings_table()} "
           "WHERE posted_date IS NULL AND posted_at IS NOT NULL")
    if limit:
        sql += f" LIMIT {int(limit)}"
    n = 0
    for r in conn.execute(sql).fetchall():
        nd = dates.normalize(r["posted_at"], r["first_seen_at"])
        if nd:
            conn.execute(f"UPDATE {corpus_table()} SET posted_date=? WHERE id=?", (nd, r["id"]))
            n += 1
    return n


def backfill_states(conn, limit=None) -> int:
    """Populate the parsed US state for rows that don't have it yet."""
    from . import geo
    sql = (f"SELECT id, location FROM {read_postings_table()} "
           "WHERE state IS NULL AND location IS NOT NULL")
    if limit:
        sql += f" LIMIT {int(limit)}"
    n = 0
    for r in conn.execute(sql).fetchall():
        st = geo.state_of(r["location"])
        if st:
            conn.execute(f"UPDATE {corpus_table()} SET state=? WHERE id=?", (st, r["id"]))
            n += 1
    return n


def backfill_geo(conn, limit=None, batch=2000) -> int:
    """Populate parsed state + geocoded city/lat/lon for rows missing them.
    Covers rows that predate the geo columns. Returns rows updated."""
    from . import geo
    sql = (f"SELECT id, location, state FROM {read_postings_table()} "
           "WHERE location IS NOT NULL AND (lat IS NULL OR state IS NULL)")
    if limit:
        sql += f" LIMIT {int(limit)}"
    n = 0
    rows = conn.execute(sql).fetchall()
    for i, r in enumerate(rows):
        state = r["state"] or geo.state_of(r["location"])
        place = geo.place_of(r["location"], state)
        city, lat, lon = place if place else (None, None, None)
        conn.execute(f"UPDATE {corpus_table()} SET state=?, city=?, lat=?, lon=? WHERE id=?",
                     (state, city, lat, lon, r["id"]))
        n += 1
        if i % batch == 0:
            conn.commit()
    return n


def save_ai_fit(conn, posting_id, score, rationale, matched, gaps, model):
    # Per-user signal -> user_signals (MULTIUSER) or inline postings (legacy).
    user_set(conn, posting_id, ai_fit_score=score, ai_fit_rationale=rationale,
             ai_fit_matched=json.dumps(matched or []), ai_fit_gaps=json.dumps(gaps or []),
             ai_model=model, ai_scored_at=now())


def save_salary_estimate(conn, posting_id, smin, smax, currency="USD", period="year"):
    """Only fills AI estimate when there's no listed salary already. Salary is OBJECTIVE
    (about the job, same for all users) so it lives on the shared corpus row."""
    row = conn.execute(
        f"SELECT salary_source FROM {read_postings_table()} WHERE id=?", (posting_id,)).fetchone()
    if row and row["salary_source"] == "listed":
        return False
    conn.execute(
        f"""UPDATE {corpus_table()} SET salary_min=?, salary_max=?, salary_currency=?,
           salary_period=?, salary_source='ai_estimated' WHERE id=?""",
        (smin, smax, currency, period, posting_id),
    )
    return True


def set_status(conn, posting_id, status, **fields):
    """Application lifecycle is per-user -> user_signals (MULTIUSER) or inline (legacy)."""
    cols = {"status": status}
    if status == "promoted":
        cols["promoted_at"] = now()
    if status == "generated":
        cols["generated_at"] = now()
    if status == "applied":
        cols["applied_at"] = now()
        # Every interactive/dashboard/confirmed-guide status change is a human assertion. The
        # remote apply callback supplies its own narrower source through the queue recorder.
        cols["application_source"] = fields.pop("application_source", "manual-mark")
    cols.update(fields)   # e.g. resume_path, cover_path
    user_set(conn, posting_id, **cols)


def set_outreach(conn, posting_id, sent: bool = True):
    """Track that the recruiter intro was sent for this role. Per-user. Kept separate from
    the apply-lifecycle `status` because outreach can happen before or after applying."""
    user_set(conn, posting_id, outreach_sent_at=now() if sent else None)


def deactivate_missing(conn, company_id: int, seen_ids: set[str]) -> int:
    """Mark postings no longer present in the feed as inactive (closed). Objective -> corpus."""
    on, off = ("TRUE", "FALSE") if config.POSTGRES else ("1", "0")
    rows = conn.execute(
        f"SELECT id, ats_job_id FROM {read_postings_table()} "
        f"WHERE company_id = ? AND active = {on}", (company_id,)
    ).fetchall()
    ct = corpus_table()
    closed = 0
    for r in rows:
        if r["ats_job_id"] not in seen_ids:
            conn.execute(f"UPDATE {ct} SET active = {off} WHERE id = ?", (r["id"],))
            closed += 1
    return closed


# ── reputation ───────────────────────────────────────────────────────────────
def save_ai_reputation(conn, company_id, about, positives, negatives, score, model):
    if config.POSTGRES:
        # 096's career_company_reputation names the enricher timestamp ai_rated_at and has
        # NO ai_model column. The model name is therefore DROPPED and counted rather than
        # smuggled into ai_about or a look-alike column — if it turns out to matter, that
        # is an ALTER TABLE, not a guess at read time.
        if model:
            _drop("company_reputation.ai_model(no column)")
        conn.execute(
            f"""INSERT INTO {reputation_table()}
                  (company_id, ai_about, ai_positives, ai_negatives, ai_score, ai_rated_at)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT (company_id) DO UPDATE SET
                 ai_about=EXCLUDED.ai_about, ai_positives=EXCLUDED.ai_positives,
                 ai_negatives=EXCLUDED.ai_negatives, ai_score=EXCLUDED.ai_score,
                 ai_rated_at=EXCLUDED.ai_rated_at, updated_at=NOW()""",
            (company_id, about, json.dumps(positives), json.dumps(negatives), score, now()),
        )
        return
    conn.execute(
        """INSERT INTO company_reputation (company_id, ai_about, ai_positives, ai_negatives, ai_score, ai_model, ai_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(company_id) DO UPDATE SET
             ai_about=excluded.ai_about, ai_positives=excluded.ai_positives,
             ai_negatives=excluded.ai_negatives, ai_score=excluded.ai_score,
             ai_model=excluded.ai_model, ai_at=excluded.ai_at""",
        (company_id, about, json.dumps(positives), json.dumps(negatives), score, model, now()),
    )


def save_manual_reputation(conn, company_id, *, about=None, positives=None, negatives=None, score=None, note=None):
    if config.POSTGRES:
        # Same COALESCE-keeps-the-old-value semantics; the SQLite `manual_at` column is
        # 096's `updated_at`. Table name is qualified in the conflict target because
        # `EXCLUDED` vs the target row is the whole point of the COALESCE.
        rt = reputation_table()
        conn.execute(
            f"""INSERT INTO {rt}
                  (company_id, manual_about, manual_positives, manual_negatives,
                   manual_score, manual_note, updated_at)
               VALUES (?,?,?,?,?,?,?)
               ON CONFLICT (company_id) DO UPDATE SET
                 manual_about=COALESCE(EXCLUDED.manual_about, {rt}.manual_about),
                 manual_positives=COALESCE(EXCLUDED.manual_positives, {rt}.manual_positives),
                 manual_negatives=COALESCE(EXCLUDED.manual_negatives, {rt}.manual_negatives),
                 manual_score=COALESCE(EXCLUDED.manual_score, {rt}.manual_score),
                 manual_note=COALESCE(EXCLUDED.manual_note, {rt}.manual_note),
                 updated_at=EXCLUDED.updated_at""",
            (company_id, about,
             json.dumps(positives) if positives is not None else None,
             json.dumps(negatives) if negatives is not None else None,
             score, note, now()),
        )
        return
    conn.execute(
        """INSERT INTO company_reputation (company_id, manual_about, manual_positives, manual_negatives, manual_score, manual_note, manual_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(company_id) DO UPDATE SET
             manual_about=COALESCE(excluded.manual_about, company_reputation.manual_about),
             manual_positives=COALESCE(excluded.manual_positives, company_reputation.manual_positives),
             manual_negatives=COALESCE(excluded.manual_negatives, company_reputation.manual_negatives),
             manual_score=COALESCE(excluded.manual_score, company_reputation.manual_score),
             manual_note=COALESCE(excluded.manual_note, company_reputation.manual_note),
             manual_at=excluded.manual_at""",
        (company_id,
         about,
         json.dumps(positives) if positives is not None else None,
         json.dumps(negatives) if negatives is not None else None,
         score, note, now()),
    )
