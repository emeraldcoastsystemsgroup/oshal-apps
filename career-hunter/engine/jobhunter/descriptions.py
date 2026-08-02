"""Description program: fetch clean job descriptions (and any employer-listed salary)
for postings that are missing them. Prioritizes the jobs that matter (best fit first),
since fetching all 100k+ one-by-one isn't practical.
"""
from __future__ import annotations

from . import config, db, detail


def backfill(limit: int = 500, min_keyword: int = 0, company: str | None = None) -> tuple[int, int]:
    """Returns (filled, attempted). Fetches description+salary for top jobs lacking a description."""
    # The SELECT reads `postings`/`companies` — the TEMP view in sqlite mode, the 097 compat
    # views in postgres mode. It MUST stay on the compat view rather than career_postings:
    # `p.fit_score` and `p.ai_fit_score` are per-user columns that only exist through the
    # RLS-filtered join, and they are what "best fit first" means.
    #
    # `p.active=1` is correct against both: the view casts the BOOLEAN back to 0/1.
    where = "p.active=1 AND (p.description IS NULL OR p.description='')"
    args: list = []
    if min_keyword:
        where += " AND COALESCE(p.fit_score,0) >= ?"; args.append(min_keyword)
    if company:
        # SQLite's LIKE folds case for ASCII; Postgres's LIKE does not, so the same
        # `--company lockheed` that matched "Lockheed Martin" in SQLite silently matches
        # NOTHING in Postgres and the backfill reports "0 processed" as if the company had
        # no gaps. ILIKE is the Postgres spelling of SQLite's LIKE. (Measured on the live
        # corpus: name LIKE '%lockheed%' -> 0 rows, name ILIKE '%lockheed%' -> 1.)
        # The `%` wildcards live in the PARAMETER, not in the SQL text, so db.q()'s
        # percent-doubling never sees them and psycopg2 binds them as data.
        where += f" AND c.name {'ILIKE' if config.POSTGRES else 'LIKE'} ?"; args.append(f"%{company}%")
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
                # d["posted_at"] is whatever the ATS detail page said. In SQLite that went
                # into an untyped TEXT column; career_postings.posted_at is TIMESTAMPTZ and
                # rejects the UI labels ~20% of feeds emit ("Posted 30+ Days Ago"), aborting
                # the whole transaction on one bad row. db._pg_ts NULLs those and COUNTS
                # them (db.dropped_fields()) rather than inventing a date from a label —
                # `nd` still lands in posted_date, because dates.normalize() derives that
                # from an explicit anchor and is honest about what it is doing.
                # A NULL param leaves COALESCE(posted_at, NULL) = posted_at, i.e. a no-op.
                raw = db._pg_ts(d["posted_at"], "postings.posted_at") if config.POSTGRES \
                    else d["posted_at"]
                conn.execute(f"UPDATE {ct} SET posted_at=COALESCE(posted_at,?), posted_date=COALESCE(posted_date,?) WHERE id=?",
                             (raw, nd, r["id"]))
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
