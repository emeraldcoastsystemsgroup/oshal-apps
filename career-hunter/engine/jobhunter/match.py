"""Score each posting against the user's career_db.json.

A lightweight keyword/skill overlap — enough to triage which corporate postings are
worth a tailored application. Not a substitute for reading the JD.
"""
from __future__ import annotations
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


def rescore_all() -> int:
    terms = _career_terms()
    n = 0
    with db.connect() as conn:
        rows = conn.execute("SELECT id, title, description FROM postings WHERE active = 1").fetchall()
        for r in rows:
            s = score_text(r["title"], r["description"], terms)
            db.user_set(conn, r["id"], fit_score=s)   # keyword fit is per-user
            n += 1
    return n


def rescore_recent(days: int = 10) -> int:
    """Keyword-score only postings posted within the last N days — the fresh drop.
    Bounded so the daily scrape can rank new jobs without re-scoring the whole DB
    (rescore_all sweeps 500K+ rows). Without this, freshly scraped jobs sit at
    fit_score 0, stay invisible on the board, and get skipped by the AI scorer's
    keyword gate. Run right after the scrape."""
    terms = _career_terms()
    n = 0
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, title, description FROM postings "
            "WHERE active = 1 AND posted_date >= date('now', ?)",
            (f"-{int(days)} days",),
        ).fetchall()
        for r in rows:
            s = score_text(r["title"], r["description"], terms)
            db.user_set(conn, r["id"], fit_score=s)   # keyword fit is per-user
            n += 1
        conn.commit()
    return n
