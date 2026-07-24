"""Salary program: make sure EVERY posting has a pay range to filter on.

- Employer-listed salary (from the ATS / JSON-LD) is kept as-is (most accurate).
- The AI fit-scorer fills a market estimate for jobs it scores.
- This module fills a fast title/seniority HEURISTIC range for everything else, so the
  salary filter works across the whole board. Heuristic rows are flagged 'heuristic'.
"""
from __future__ import annotations
import re

from . import db

# (regex on title, (min, max)) — first match wins. US tech/eng/leadership, rough annual USD.
_BANDS = [
    (r"\b(chief|cto|cio|ciso|svp|evp)\b", (260000, 420000)),
    (r"\b(vp|vice president)\b", (220000, 360000)),
    (r"\b(senior director|sr\.? director)\b", (215000, 320000)),
    (r"\b(director|head of)\b", (190000, 290000)),
    (r"\b(distinguished|fellow)\b", (210000, 330000)),
    (r"\b(principal|staff)\b.*(architect|engineer|scientist)", (190000, 290000)),
    (r"\b(senior|sr\.?|lead)\b.*(architect|principal)", (170000, 250000)),
    (r"\b(architect)\b", (155000, 225000)),
    (r"\b(senior|sr\.?|lead|staff)\b.*(manager|engineer|scientist|developer)", (150000, 215000)),
    (r"\b(manager|management)\b", (140000, 210000)),
    (r"\b(senior|sr\.?|lead)\b", (140000, 200000)),
    (r"\b(consultant|specialist|analyst|administrator)\b", (105000, 165000)),
    (r"\b(engineer|developer|scientist|sre|devops)\b", (115000, 175000)),
    (r"\b(junior|jr\.?|associate|entry|intern|apprentice)\b", (70000, 110000)),
]
_DEFAULT = (100000, 160000)


def estimate(title: str):
    t = (title or "").lower()
    for pat, band in _BANDS:
        if re.search(pat, t):
            return band
    return _DEFAULT


def backfill_heuristic(limit=None) -> int:
    """Give every salary-less active posting a heuristic range (flagged 'heuristic')."""
    with db.connect() as conn:
        sql = ("SELECT id, title FROM postings WHERE active=1 AND salary_min IS NULL "
               "AND (salary_source IS NULL OR salary_source='')")
        if limit:
            sql += f" LIMIT {int(limit)}"
        rows = conn.execute(sql).fetchall()
        n = 0
        for r in rows:
            lo, hi = estimate(r["title"])
            conn.execute(
                f"UPDATE {db.corpus_table()} SET salary_min=?, salary_max=?, salary_currency='USD', "
                "salary_period='year', salary_source='heuristic' WHERE id=?", (lo, hi, r["id"]))
            n += 1
    return n
