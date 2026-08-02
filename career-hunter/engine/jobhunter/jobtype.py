"""Classify each posting as FTE vs contract vs intern.

Direct-from-employer corporate postings are overwhelmingly FTE (contract gigs usually
come through staffing agencies, which we don't scrape). So: trust an explicit employment-type
hint from the ATS when present; otherwise read the title; default to 'fte'.
"""
from __future__ import annotations
import re

from . import config, db

_CONTRACT = re.compile(r"\b(contract(or)?|c2c|1099|temp(orary)?|fixed[- ]term|seasonal|consultant\b.*contract)\b", re.I)
_INTERN = re.compile(r"\b(intern(ship)?|co[- ]?op|apprentice|trainee|new ?grad|early career)\b", re.I)
_PARTTIME = re.compile(r"\bpart[- ]time\b", re.I)


def classify(title: str, hint: str | None = None) -> str:
    h = (hint or "").lower()
    if "contract" in h or "temporary" in h or "fixed" in h:
        return "contract"
    if "intern" in h:
        return "intern"
    if "part" in h and "time" in h:
        return "parttime"
    if "full" in h:  # explicit FULL_TIME / Full-time
        return "fte"
    t = title or ""
    if _INTERN.search(t):
        return "intern"
    if _CONTRACT.search(t):
        return "contract"
    if _PARTTIME.search(t):
        return "parttime"
    return "fte"


def backfill(limit=None) -> int:
    """Classify every active posting that has no job_type yet. Objective -> shared corpus.

    Reads db.read_postings_table() rather than the literal `postings`: title/job_type/active
    are all corpus columns, so in postgres mode this goes straight to career_postings instead
    of the compat view, whose two RLS-filtered per-user joins contribute nothing to this
    query. In sqlite mode the helper returns `postings` and the SQL text is byte-identical to
    what it was. `active` is 0/1 in SQLite and a real BOOLEAN on career_postings, and
    Postgres rejects `boolean = integer` outright.
    """
    with db.connect() as conn:
        on = "TRUE" if config.POSTGRES else "1"
        sql = (f"SELECT id, title FROM {db.read_postings_table()} "
               f"WHERE active={on} AND job_type IS NULL")
        if limit:
            sql += f" LIMIT {int(limit)}"
        rows = conn.execute(sql).fetchall()
        n = 0
        for r in rows:
            conn.execute(f"UPDATE {db.corpus_table()} SET job_type=? WHERE id=?", (classify(r["title"]), r["id"]))
            n += 1
    return n
