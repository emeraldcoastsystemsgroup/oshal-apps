"""Classify each posting as FTE vs contract vs intern.

Direct-from-employer corporate postings are overwhelmingly FTE (contract gigs usually
come through staffing agencies, which we don't scrape). So: trust an explicit employment-type
hint from the ATS when present; otherwise read the title; default to 'fte'.
"""
from __future__ import annotations
import re

from . import db

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
    with db.connect() as conn:
        sql = "SELECT id, title FROM postings WHERE active=1 AND job_type IS NULL"
        if limit:
            sql += f" LIMIT {int(limit)}"
        rows = conn.execute(sql).fetchall()
        n = 0
        for r in rows:
            conn.execute(f"UPDATE {db.corpus_table()} SET job_type=? WHERE id=?", (classify(r["title"]), r["id"]))
            n += 1
    return n
