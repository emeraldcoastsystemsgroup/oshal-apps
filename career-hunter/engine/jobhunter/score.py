"""The matching algorithm: for every relevant posting, fetch the FULL job description,
then have the LLM score it against the user's actual resume — fit 0-100, why it fits, what
he's missing, and a salary estimate. Runs in parallel so it covers the whole relevant
set quickly, not a keyword skim.
"""
from __future__ import annotations
import concurrent.futures as cf

from . import db, detail, enrich, profile, config

SYSTEM = (
    "You are a senior technical recruiter matching ONE candidate to ONE job for a major, "
    "career-defining move. Be rigorous and honest: reward genuine overlap in skills, domain, "
    "seniority, and clearance; penalize missing must-haves; never inflate. Return strict JSON only."
)

PROMPT = """CANDIDATE PROFILE:
{profile}

JOB:
Company: {company}
Title: {title}
Location: {location}
Description:
{description}

Return STRICT JSON only:
{{
  "fit_score": <int 0-100, how well THIS candidate fits THIS specific job>,
  "rationale": "2-3 sentences: why it fits or doesn't, at his level",
  "matched": ["specific candidate strengths that map to this job's needs"],
  "gaps": ["this job's requirements he lacks or under-evidences"],
  "salary_estimate": {{"min": <int>, "max": <int>, "currency": "USD", "period": "year", "confidence": "low|medium|high"}}
}}
salary_estimate is your best market estimate for this role+location+seniority if none is published."""


def _ensure_detail(row, company):
    """Make sure we have a description; fetch it (universally) if missing. Returns
    (description, fetched_dict_or_None)."""
    if row["description"]:
        return row["description"], None
    d = detail.fetch(company["ats_type"], company["ats_token"], row["ats_job_id"], row["url"])
    return (d.get("description") or "(no description available)"), (d or None)


def _score_one(row, prof_summary):
    """Worker: fetch detail + AI-score one job. Returns a dict to commit (or None)."""
    with db.connect() as conn:
        company = conn.execute("SELECT name, ats_type, ats_token FROM companies WHERE id=?",
                               (row["company_id"],)).fetchone()
    desc, fetched = _ensure_detail(row, company)
    prompt = PROMPT.format(profile=prof_summary, company=company["name"], title=row["title"],
                           location=row["location"] or "n/a", description=desc[:6000])
    try:
        data = enrich.parse_json(enrich.complete(SYSTEM, prompt, max_tokens=700,
                                                 model=config.ANTHROPIC_SCORE_MODEL))
    except Exception:
        data = None
    if not data or "fit_score" not in data:
        return {"id": row["id"], "fetched": fetched, "data": None, "company": company["name"], "title": row["title"]}
    return {"id": row["id"], "fetched": fetched, "data": data, "company": company["name"], "title": row["title"]}


def score_batch(limit=None, rescore=False, min_keyword=0, workers=8, title_any=None, company_any=None,
                days=None, recent_first=False, first_seen_days=None) -> tuple[int, int]:
    if not enrich.provider():
        raise RuntimeError("No AI auth found. Log into Claude Code, or set ANTHROPIC_API_KEY.")
    model = enrich.model_name(config.ANTHROPIC_SCORE_MODEL)
    # Scoring is private (never shown to an employer), so it credits the user's full
    # ability — including his independent open-source / agentic R&D (OSHAL). This is
    # what lets applied-research / emerging-tech / agentic roles score on his real
    # depth. Resume/cover generation gates OSHAL separately (opt-in, default off).
    prof_summary = profile.summary(include_oshal=True)
    # Only ever AI-score in-lane roles (technology / senior-professional). Retail/labor/
    # clinical noise (cashier, driver, package handler, nurse) is excluded up front so we
    # never spend AI budget on roles the user would never take.
    where = "active = 1 AND COALESCE(target_role,0) = 1"
    if not rescore:
        where += " AND ai_fit_score IS NULL"
    if min_keyword:
        where += f" AND COALESCE(fit_score,0) >= {int(min_keyword)}"
    if days:  # only the last N days of postings (keeps incremental runs bounded)
        where += f" AND posted_date IS NOT NULL AND posted_date >= date('now','-{int(days)} days')"
    if first_seen_days:  # only jobs NEW TO THE CORPUS in the last N days. Unlike posted_date
        # (absent from most ATS feeds, which makes `days` a silent no-op on those rows),
        # first_seen_at is stamped on every row at scrape/import time — so this is the
        # reliable "index each candidate against the new jobs" gate for incremental runs.
        where += f" AND first_seen_at >= datetime('now','-{int(first_seen_days)} days')"
    params = []
    if title_any:  # prioritize specific role types (e.g. VP/CTO/AI/architect) regardless of keyword
        likes = " OR ".join("LOWER(title) LIKE ?" for _ in title_any)
        where += f" AND ({likes})"
        params += [f"%{t.lower()}%" for t in title_any]
    if company_any:  # prioritize specific employers (e.g. Amazon/Google/AWS) regardless of keyword
        clikes = " OR ".join("c2.name LIKE ?" for _ in company_any)
        where += f" AND company_id IN (SELECT id FROM companies c2 WHERE {clikes})"
        params += [f"{c}%" for c in company_any]
    order_sql = ("posted_date DESC, COALESCE(fit_score,0) DESC, id" if recent_first
                 else "COALESCE(fit_score,0) DESC, id")
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute(
            f"SELECT * FROM postings WHERE {where} ORDER BY {order_sql}", params
        ).fetchall()]
    if limit:
        rows = rows[:limit]
    total = len(rows)
    scored = skipped = 0

    def commit(res):
        nonlocal scored, skipped
        with db.connect() as conn:
            f = res.get("fetched")
            if f and f.get("description"):
                ct = db.corpus_table()   # description/salary/posted are objective -> shared corpus
                conn.execute(f"UPDATE {ct} SET description=? WHERE id=?", (f["description"], res["id"]))
                if f.get("salary_min"):
                    conn.execute(f"""UPDATE {ct} SET salary_min=?, salary_max=?, salary_currency=?,
                                    salary_period=?, salary_source=COALESCE(salary_source,'listed') WHERE id=?""",
                                 (f.get("salary_min"), f.get("salary_max"), f.get("salary_currency", "USD"),
                                  f.get("salary_period", "year"), res["id"]))
                if f.get("posted_at"):
                    from . import dates
                    conn.execute(f"UPDATE {ct} SET posted_at=COALESCE(posted_at,?), posted_date=COALESCE(posted_date,?) WHERE id=?",
                                 (f["posted_at"], dates.normalize(f["posted_at"]), res["id"]))
            data = res.get("data")
            if not data:
                skipped += 1
                return
            db.save_ai_fit(conn, res["id"], int(data["fit_score"]), data.get("rationale"),
                           data.get("matched"), data.get("gaps"), model)
            est = data.get("salary_estimate") or {}
            if est.get("min") and est.get("max"):
                db.save_salary_estimate(conn, res["id"], est["min"], est["max"],
                                        est.get("currency", "USD"), est.get("period", "year"))
        scored += 1

    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for i, res in enumerate(ex.map(lambda r: _score_one(r, prof_summary), rows), 1):
            commit(res)
            if i % 25 == 0 or i == total:
                print(f"   {i}/{total}  ({scored} scored)", flush=True)
    return scored, skipped
