"""Description program: fetch clean job descriptions (and any employer-listed salary)
for postings that are missing them. Prioritizes the jobs that matter (best fit first),
since fetching all 100k+ one-by-one isn't practical.
"""
from __future__ import annotations

from . import db, detail


def backfill(limit: int = 500, min_keyword: int = 0, company: str | None = None) -> tuple[int, int]:
    """Returns (filled, attempted). Fetches description+salary for top jobs lacking a description."""
    where = "p.active=1 AND (p.description IS NULL OR p.description='')"
    args: list = []
    if min_keyword:
        where += " AND COALESCE(p.fit_score,0) >= ?"; args.append(min_keyword)
    if company:
        where += " AND c.name LIKE ?"; args.append(f"%{company}%")
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute(
            f"""SELECT p.id, p.ats_job_id, p.url, p.salary_source, c.ats_type, c.ats_token
                FROM postings p JOIN companies c ON c.id=p.company_id
                WHERE {where} ORDER BY COALESCE(p.ai_fit_score, p.fit_score, 0) DESC
                LIMIT ?""", (*args, limit)).fetchall()]

    filled = 0
    for i, r in enumerate(rows, 1):
        d = detail.fetch(r["ats_type"], r["ats_token"], r["ats_job_id"], r["url"])
        if not d.get("description"):
            continue
        with db.connect() as conn:
            ct = db.corpus_table()   # description/posted/salary are objective -> shared corpus
            conn.execute(f"UPDATE {ct} SET description=? WHERE id=?", (d["description"], r["id"]))
            if d.get("posted_at"):
                from . import dates
                nd = dates.normalize(d["posted_at"])
                conn.execute(f"UPDATE {ct} SET posted_at=COALESCE(posted_at,?), posted_date=COALESCE(posted_date,?) WHERE id=?",
                             (d["posted_at"], nd, r["id"]))
            if d.get("salary_min") and r["salary_source"] is None:
                conn.execute(
                    f"""UPDATE {ct} SET salary_min=?, salary_max=?, salary_currency=?, salary_period=?,
                       salary_raw=?, salary_source='listed' WHERE id=?""",
                    (d.get("salary_min"), d.get("salary_max"), d.get("salary_currency", "USD"),
                     d.get("salary_period", "year"), d.get("salary_raw"), r["id"]))
        filled += 1
        if i % 20 == 0 or i == len(rows):
            print(f"   {i}/{len(rows)} processed, {filled} descriptions fetched", flush=True)
    return filled, len(rows)
