# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Give SQLite and PostgreSQL the same first-seen fallback so deterministic nightly indexing cannot omit undated ATS rows.

"""Score each posting against the user's career_db.json.

A lightweight keyword/skill overlap — enough to triage which corporate postings are
worth a tailored application. Not a substitute for reading the JD.

DUAL BACKEND (JOBHUNTER_STORE, see config.STORE). The scoring itself is pure Python and
identical in both modes; only the two SELECTs that feed it are dialect-aware (see
_recent_where()). Writes go through db.user_set() in both modes — it is the single
chokepoint that knows which physical table owns a per-user column, and in Postgres it is
what stamps user_sub so the RLS WITH CHECK can vet the row.
"""
from __future__ import annotations
import itertools
import json
import re

from . import config, db

# Title-level signal: roles the user targets (see career_db target role families).
TITLE_BOOST = [
    "devops", "platform", "architect", "sap", "delivery manager", "technical quality",
    "service manager", "escalation", "cloud", "site reliability", "sre", "automation",
    "engineering manager", "presales", "solution", "program manager", "ai", "enterprise architect",
    # leadership lane (VP / Director / Lead / C-level he's targeting)
    "director", "vice president", " vp", "head of", "principal", "chief", "lead",
    # AI / ML specialization
    "machine learning", "applied scientist", "generative", "agent", "ml ",
    # cleared / defense signal
    "defense", "national security", "clearance", "secret",
]


def _career_terms() -> set[str]:
    terms: set[str] = set()
    if config.CAREER_DB.exists():
        data = json.loads(config.CAREER_DB.read_text(encoding="utf-8"))
        for group in data.get("skills", {}).values():
            for item in group.get("items", []):
                # split into word tokens, keep meaningful ones
                for w in re.split(r"[^a-z0-9+/]+", item.lower()):
                    if len(w) > 2:
                        terms.add(w)
    terms.update(["sap", "devops", "abap", "hana", "s/4hana", "cloud", "automation"])
    return terms


def score_text(title: str, description: str, terms: set[str]) -> int:
    blob = f"{title or ''} {description or ''}".lower()
    hits = sum(1 for t in terms if t in blob)
    base = min(70, hits * 4)  # skill overlap
    boost = sum(8 for kw in TITLE_BOOST if kw in (title or "").lower())
    return min(100, base + boost)


# ═════════════════════════════════════════════════════════════════════════════
# DIALECT — the only part of this module that differs between the two backends.
# Both helpers preserve one storage contract while spelling booleans and date arithmetic
# in the native dialect.
# ═════════════════════════════════════════════════════════════════════════════

def _active_true() -> str:
    """The `active` predicate for whichever backend is live.

    SQLite stores 0/1 INTEGERs, so `active = 1` is right there and must not change.
    career_postings.active is a real BOOLEAN, and Postgres rejects `boolean = integer`
    as a hard error rather than coercing it — the query would not run at all. Same
    shape as the on/off pair in db.deactivate_missing()."""
    return "active = TRUE" if config.POSTGRES else "active = 1"


def _recent_where(days: int) -> tuple[str, tuple]:
    """"Posted in the last N days" predicate + its bind parameters, per backend.

    SQLITE: use the employer date when present, otherwise the first-seen date. SQLite's
    `now` is UTC. This mirrors PostgreSQL and keeps undated ATS rows in the nightly index.

    POSTGRES: `date('now', ?)` has no equivalent, and neither does passing '-14 days' as
    a string — the translation is a date literal computed by the server:
    `(now() AT TIME ZONE 'UTC')::date - N`, which anchors on UTC exactly as SQLite does
    (this cluster's TimeZone is UTC anyway, but pinning it means a session that sets
    another zone cannot shift the window by a day).

    WHY COALESCE(posted_date, first_seen_at) IN BOTH BACKENDS
    --------------------------------------------------------
    posted_date is derived from whatever the employer's ATS published, and a quarter of
    the corpus has none: 367,727 of 1,427,675 rows are NULL, and among ACTIVE rows it is
    177,327 of 629,417 (28%). `posted_date >= cutoff` is NULL for every one of them, so
    they are skipped — which is precisely the failure this function exists to prevent
    (unscored postings sit at fit_score 0, stay off the board, and are skipped by the AI
    scorer's keyword gate). db.py's _pg_ts() already states the rule this follows:
    freshness keys off first_seen_at, which is populated for 100% of rows (095).

    Measured on the live corpus at a 14-day window, ACTIVE rows:
        posted_date only ................ 113,348
        COALESCE(posted_date, seen) ..... 157,207   (+43,859)
        first_seen_at only .............. 155,935   (drops 2,755 that posted_date catches)
    The COALESCE form is a strict superset of a posted-date-only predicate: where posted_date is
    present it behaves identically, and it only ever adds rows we first saw inside the
    window. It cannot skip a posting SQLite would have scored, and re-scoring is
    idempotent (score_text is a pure function of title+description), so the widening
    cannot corrupt an existing score. Keying on first_seen_at ALONE was rejected for the
    opposite reason — it silently drops the 2,755 rows above.

    Applying that rule in both modes is load-bearing: changing JOBHUNTER_STORE must not
    change which fresh postings enter the nightly keyword index.

    SARGABILITY. Wrapping the column in COALESCE defeats an index, but there is no index
    on career_postings.posted_date to defeat: the only freshness index is
    idx_career_postings_fresh (first_seen_at DESC) WHERE active. Both forms therefore scan
    (measured: 0.43s for the bare posted_date form, 0.25s for this one, over 1.4M rows) —
    noise beside the per-row Python scoring that follows."""
    if config.POSTGRES:
        return (
            "COALESCE(posted_date, (first_seen_at AT TIME ZONE 'UTC')::date) "
            ">= ((now() AT TIME ZONE 'UTC')::date - ?::int)",
            (int(days),),
        )
    return (
        "COALESCE(posted_date, date(first_seen_at)) >= date('now', ?)",
        (f"-{int(days)} days",),
    )


# Distinct portal name per scan; two nested scans on one connection would otherwise
# collide on the cursor name.
_pg_scan_seq = itertools.count(1)

# Rows a server-side cursor pulls per round trip. 2000 postings' descriptions is a few MB
# in flight — small enough to bound memory, large enough that the FETCHes are not the cost.
_PG_ITERSIZE = 2000


def _iter_postings(conn, sql: str, params: tuple = ()):
    """Yield the result rows of a postings scan, one at a time.

    SQLITE (unchanged): the same `conn.execute(...).fetchall()` these two functions have
    always run, in the same two call shapes (with and without parameters).

    POSTGRES: a NAMED cursor, i.e. a server-side portal that streams. psycopg2's ordinary
    cursor is client-side — libpq materialises the WHOLE result before execute() returns,
    so fetchall() is not what makes it big. rescore_all()'s scan is 629,417 active rows
    whose descriptions are 472 MB COMPRESSED on disk; decoded into Python strings that is
    multiple GB in a container with 6.7 GB for the entire api tier. The named cursor
    holds _PG_ITERSIZE rows at a time instead.

    The portal lives inside the connection's current transaction, and the per-row
    db.user_set() writes run on separate client cursors of that same transaction — which
    is allowed and leaves the portal valid. It is closed when the generator is exhausted,
    which happens before any conn.commit() in the callers (a commit would end the
    transaction and with it the portal).

    SQL text goes through db.q() only when there are parameters, mirroring
    db._PgConnection.execute(): q() doubles literal `%`, which is correct exactly when
    psycopg2 will interpolate and wrong when it will not."""
    if not config.POSTGRES:
        cur = conn.execute(sql, params) if params else conn.execute(sql)
        yield from cur.fetchall()
        return
    cur = conn.cursor(name=f"jh_match_scan_{next(_pg_scan_seq)}")
    cur.itersize = _PG_ITERSIZE
    try:
        if params:
            cur.execute(db.q(sql), tuple(params))
        else:
            cur.execute(sql)
        yield from cur
    finally:
        cur.close()


def rescore_all() -> int:
    terms = _career_terms()
    n = 0
    with db.connect() as conn:
        # read_postings_table() is `postings` in sqlite (the TEMP view, as before) and the
        # base `career_postings` in postgres — every column read here is objective, so the
        # compat view's two RLS-filtered joins would be dead weight over 1.4M rows.
        sql = (f"SELECT id, title, description FROM {db.read_postings_table()} "
               f"WHERE {_active_true()}")
        for r in _iter_postings(conn, sql):
            s = score_text(r["title"], r["description"], terms)
            db.user_set(conn, r["id"], fit_score=s)   # keyword fit is per-user
            n += 1
    return n


def rescore_recent(days: int = 10) -> int:
    """Keyword-score only postings posted within the last N days — the fresh drop.
    Bounded so the daily scrape can rank new jobs without re-scoring the whole DB
    (rescore_all sweeps 500K+ rows). Without this, freshly scraped jobs sit at
    fit_score 0, stay invisible on the board, and get skipped by the AI scorer's
    keyword gate. Run right after the scrape.

    In postgres mode "within the last N days" falls back to first_seen_at for the 28% of
    active postings whose employer published no parseable date — see _recent_where()."""
    terms = _career_terms()
    n = 0
    with db.connect() as conn:
        where, params = _recent_where(days)
        sql = (f"SELECT id, title, description FROM {db.read_postings_table()} "
               f"WHERE {_active_true()} AND {where}")
        for r in _iter_postings(conn, sql, params):
            s = score_text(r["title"], r["description"], terms)
            db.user_set(conn, r["id"], fit_score=s)   # keyword fit is per-user
            n += 1
        conn.commit()
    return n
