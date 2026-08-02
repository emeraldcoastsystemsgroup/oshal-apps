"""The matching algorithm: for every relevant posting, fetch the FULL job description,
then have the LLM score it against the user's actual resume — fit 0-100, why it fits, what
he's missing, and a salary estimate. Runs in parallel so it covers the whole relevant
set quickly, not a keyword skim.

STORAGE (JOBHUNTER_STORE — see config.STORE)

  'sqlite'   (DEFAULT) — every statement below is the one that was always here, character
             for character. `postings` is db.py's per-connection TEMP view, `companies`
             resolves through the ATTACH (or is the inline table), and both freshness
             windows keep their date('now',…) / datetime('now',…) forms. The nightly
             scorer runs on this path; nothing inside a `config.POSTGRES` branch is
             reachable unless JOBHUNTER_STORE=postgres is set explicitly.
  'postgres' — `postings` is the compatibility VIEW from migration 097 over
             career_postings LEFT JOIN the two FORCE-RLS per-user tables. "The unscored
             in-lane backlog" is therefore already THIS user's backlog: the row policy is
             what scopes it, which is why no query in this module mentions user_sub and
             why none should ever be added. Writes go through db.corpus_table() /
             db.save_ai_fit() / db.save_salary_estimate(), so this module never needs to
             know a physical table name.

FOUR THINGS THAT WOULD HAVE BEEN SILENTLY WRONG UNDER POSTGRES. Each was measured against
the live corpus (1,427,675 postings) rather than reasoned about:

  1. `company_any` filtered with `c2.name LIKE 'Amazon%'`. SQLite's LIKE is
     case-INsensitive for ASCII; Postgres' is not. Measured: LIKE 'amazon%' matched 0
     companies, ILIKE matched 1. The filter would have quietly scored nothing at all.
  2. `recent_first` ordered by `posted_date DESC`. SQLite sorts NULLs LAST under DESC;
     Postgres sorts them FIRST — and posted_date is NULL for ~26% of the corpus, so the
     head of "most recent first" was three NULL rows. Fixed with NULLS LAST.
  3. date('now','-N days') / datetime('now','-N days') do not exist in Postgres, and the
     097 view hands posted_date / first_seen_at back as TEXT (the SQLite readers slice and
     string-compare them), so `text >= date` has no operator either. Both windows are
     rendered into the view's own text shape instead — see _pg_days_ago().
  4. The AI's salary estimate went straight into a NUMERIC column. SQLite is untyped and
     would store a stray '150k'; Postgres rejects it AND aborts the whole transaction,
     which would take the fit score down with it and end the run — see _pg_money().

And `days` is a trap that is bolted shut in postgres mode: see score_batch().
"""
from __future__ import annotations
import concurrent.futures as cf
import math

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


# ═════════════════════════════════════════════════════════════════════════════
# Dialect helpers. Each returns SQL TEXT for the active backend; in sqlite mode the
# text is identical to what was hard-coded here before.
# ═════════════════════════════════════════════════════════════════════════════

def _pg_days_ago(days: int) -> str:
    """Postgres SQL for 'the UTC calendar date N days ago', rendered as 'YYYY-MM-DD' TEXT.

    Text, not a date, because migration 097 exposes posted_date as
    `to_char(p.posted_date,'YYYY-MM-DD')` and first_seen_at as ISO-8601 text — the SQLite
    readers slice and string-compare those columns, so the view keeps them strings. There
    is no `text >= date` operator in Postgres, so the cutoff is rendered into the same
    fixed-width shape and compared as text. For zero-padded YYYY-MM-DD that is the same
    total order as comparing dates, and it is collation-independent; verified on the live
    corpus, where `posted_date >= '2026-07-20'` and `posted_date::date >= '2026-07-20'`
    both returned 114,017 rows.

    `AT TIME ZONE 'UTC'` is load-bearing: SQLite's date('now') is UTC by definition, while
    Postgres' now()::date follows the session TimeZone. Pinning it to UTC is what makes the
    two dialects pick the same calendar day. `days` is int()-coerced (it is interpolated,
    not bound) exactly as the SQLite branch has always done."""
    return f"to_char((now() AT TIME ZONE 'UTC')::date - {int(days)}, 'YYYY-MM-DD')"


def _freshness_where(days, first_seen_days, allow_posted_date_window: bool) -> str:
    """The two time windows, in the active dialect. Returns SQL to append to a WHERE.

    Neither window binds a parameter in either backend — the day count is interpolated
    after int() — so db.q() is never involved and the params list keeps its original
    ordering (title_any, then company_any)."""
    sql = ""
    if days:  # only the last N days of postings (keeps incremental runs bounded)
        if config.POSTGRES and not allow_posted_date_window:
            # Refused rather than run. This filter is not merely weak in postgres, it is
            # a silent no-op that LOOKS like it worked: the batch reports "0 scored" and
            # the nightly job appears healthy. Making it raise turns a fortnight of
            # invisible nothing into an immediate, readable failure at the call site.
            raise RuntimeError(
                "score_batch(days=…) filters on posted_date, which is NULL for ~26% of "
                "career_postings because ATS feeds routinely omit it. A ten-day window "
                "matched 32 rows out of 1.21M on 2026-07-29 and silently no-op'd the "
                "nightly scorer for a fortnight (migration 095 says so on the column "
                "itself). Use first_seen_days=N instead — first_seen_at is NOT NULL on "
                "every row and is stamped at ingest, so it is the reliable 'what is new' "
                "gate. If you deliberately want the posted_date window anyway, pass "
                "allow_posted_date_window=True."
            )
        if config.POSTGRES:
            sql += f" AND posted_date IS NOT NULL AND posted_date >= {_pg_days_ago(days)}"
        else:
            sql += (" AND posted_date IS NOT NULL AND posted_date >= "
                    f"date('now','-{int(days)} days')")
    if first_seen_days:  # only jobs NEW TO THE CORPUS in the last N days. Unlike posted_date
        # (absent from most ATS feeds, which makes `days` a silent no-op on those rows),
        # first_seen_at is stamped on every row at scrape/import time — so this is the
        # reliable "index each candidate against the new jobs" gate for incremental runs.
        if config.POSTGRES:
            # WHY MIDNIGHT AND NOT THE CURRENT CLOCK TIME. The SQLite form compares the
            # stored text ('2026-07-27T05:00:00+00:00', T-separated, written by db.now())
            # against datetime('now','-N days') ('2026-07-27 22:39:13', SPACE-separated).
            # On the boundary day the two strings agree through 'YYYY-MM-DD' and then meet
            # 'T' (0x54) vs ' ' (0x20), so EVERY row from that day compares greater and is
            # selected regardless of its time. The window is therefore whole-UTC-day
            # inclusive, not to-the-second — verified in sqlite3 with a row 7 hours before
            # the cutoff clock time, which SQLite still returns. Anchoring the Postgres
            # cutoff at that day's midnight reproduces the SQLite result set exactly rather
            # than quietly tightening the window by up to 24 hours.
            #
            # Comparing as TEXT (not ::timestamptz) is deliberate for the same reason as
            # _pg_days_ago: the view column IS text. Verified equal to both
            # `COLLATE "C"` and `::timestamptz` on the live corpus at N = 1/3/10/30 days
            # (94,209 / 94,209 / 157,438 / 436,699 rows — identical all three ways).
            # `||` binds tighter than `>=`, so the concatenation is the right-hand side.
            sql += (f" AND first_seen_at >= {_pg_days_ago(first_seen_days)}"
                    " || 'T00:00:00+00:00'")
        else:
            sql += f" AND first_seen_at >= datetime('now','-{int(first_seen_days)} days')"
    return sql


def _selector_where(title_any, company_any) -> tuple[str, list]:
    """The optional title / employer prioritisation filters. Returns (SQL, params)."""
    sql, params = "", []
    if title_any:  # prioritize specific role types (e.g. VP/CTO/AI/architect) regardless of keyword
        # Stays LIKE in both dialects: the column is already folded with LOWER() and the
        # pattern is lowercased in Python, so the comparison is case-insensitive by
        # construction and ILIKE would be redundant. (SQLite's LOWER folds ASCII only
        # while Postgres folds the full Unicode range, so a non-ASCII capital in a title
        # can match in postgres where it did not in sqlite. The call sites pass ASCII
        # role words — vp, cto, ai, architect — so no live query is affected.)
        likes = " OR ".join("LOWER(title) LIKE ?" for _ in title_any)
        sql += f" AND ({likes})"
        params += [f"%{t.lower()}%" for t in title_any]
    if company_any:  # prioritize specific employers (e.g. Amazon/Google/AWS) regardless of keyword
        # ILIKE in postgres. There is no LOWER() on this side, and callers pass display
        # casing ('Amazon'), which SQLite's ASCII-case-insensitive LIKE matched and
        # Postgres' case-SENSITIVE LIKE does not: measured 0 vs 1 company for 'amazon%'.
        # db.companies_table() names the base table in postgres and is the string
        # "companies" in sqlite, so this line is unchanged there.
        op = "ILIKE" if config.POSTGRES else "LIKE"
        clikes = " OR ".join(f"c2.name {op} ?" for _ in company_any)
        sql += f" AND company_id IN (SELECT id FROM {db.companies_table()} c2 WHERE {clikes})"
        params += [f"{c}%" for c in company_any]
    return sql, params


def _order_by(recent_first: bool) -> str:
    """Row ordering. Both forms end in the unique `id`, so the sort is a total order —
    which is what lets the postgres path push the caller's LIMIT into SQL below."""
    if not recent_first:
        return "COALESCE(fit_score,0) DESC, id"
    # SQLite sorts NULLs last under DESC; Postgres sorts them FIRST. posted_date is NULL
    # for ~26% of the corpus, so without NULLS LAST the head of "most recent first" is
    # rows with no date at all (measured: the top three were NULL).
    posted = "posted_date DESC NULLS LAST" if config.POSTGRES else "posted_date DESC"
    return f"{posted}, COALESCE(fit_score,0) DESC, id"


def _pg_money(v, field: str):
    """Coerce an AI-supplied salary bound to a number a NUMERIC column will accept, or
    drop it and count it (db.dropped_fields()).

    The model is asked for `<int>` and almost always obliges. SQLite is untyped, so the
    rare '150k' landed in the REAL column and only surfaced later as broken arithmetic in
    the dashboard. Postgres rejects it at the UPDATE — and psycopg2 marks the whole
    transaction aborted, so that single bad estimate would also discard the fit score this
    call just paid an LLM for, and every statement after it in the run. Hence: coerce what
    is genuinely a number (including a numeric string, with thousands separators removed),
    and DROP anything else. Nothing is parsed out of prose and no value is invented — an
    unusable estimate becomes no estimate, which is what save_salary_estimate() already
    does for a posting whose salary is published.

    Postgres-only: sqlite mode never calls this and keeps storing exactly what it stored."""
    if isinstance(v, bool):   # bool is an int subclass; True is not a salary
        db._drop(field)
        return None
    try:
        n = float(v) if isinstance(v, (int, float)) else float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        db._drop(field)
        return None
    if not math.isfinite(n):  # float('nan') parses, and NUMERIC even accepts 'NaN'
        db._drop(field)
        return None
    return n


# ═════════════════════════════════════════════════════════════════════════════
# Scoring
# ═════════════════════════════════════════════════════════════════════════════

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
        # db.companies_table() is the string "companies" in sqlite (unchanged) and the base
        # career_companies in postgres. These three columns are objective employer data, so
        # reading the base table skips the 097 compat view's per-column expressions.
        company = conn.execute(
            f"SELECT name, ats_type, ats_token FROM {db.companies_table()} WHERE id=?",
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


def _commit_one(res, model) -> bool:
    """Persist one worker result. Returns True if an AI fit was saved, False if the model
    returned nothing usable — in which case the fetched description / salary / date are
    still committed, exactly as before.

    Lifted out of score_batch() (where it was a closure over the two counters) so the
    dialect branches fit in a readable function. It issues the same statements, with the
    same values, in the same order as the closure did."""
    with db.connect() as conn:
        f = res.get("fetched")
        if f and f.get("description"):
            ct = db.corpus_table()   # description/salary/posted are objective -> shared corpus
            conn.execute(f"UPDATE {ct} SET description=? WHERE id=?", (f["description"], res["id"]))
            if f.get("salary_min"):
                # detail.fetch() already float()s these, so they suit REAL and NUMERIC alike.
                conn.execute(f"""UPDATE {ct} SET salary_min=?, salary_max=?, salary_currency=?,
                                salary_period=?, salary_source=COALESCE(salary_source,'listed') WHERE id=?""",
                             (f.get("salary_min"), f.get("salary_max"), f.get("salary_currency", "USD"),
                              f.get("salary_period", "year"), res["id"]))
            if f.get("posted_at"):
                from . import dates
                # career_postings.posted_at is TIMESTAMPTZ. ~20% of ATS feeds return a UI
                # label ("Posted 30+ Days Ago") where SQLite happily stored the string;
                # Postgres rejects it and aborts the transaction, losing this row's fit
                # score too. db._pg_ts is the store layer's own rule for that (NULL it and
                # count it in db.dropped_fields()) — called rather than re-implemented so
                # there is ONE definition of what an unusable timestamp is, and one count.
                # posted_date is unaffected: dates.normalize() turns the same label into a
                # real 'YYYY-MM-DD' relative to today, which is what db.upsert_posting()
                # writes on the ingest path.
                posted_at_val = (db._pg_ts(f["posted_at"], "postings.posted_at")
                                 if config.POSTGRES else f["posted_at"])
                conn.execute(f"UPDATE {ct} SET posted_at=COALESCE(posted_at,?), posted_date=COALESCE(posted_date,?) WHERE id=?",
                             (posted_at_val, dates.normalize(f["posted_at"]), res["id"]))
        data = res.get("data")
        if not data:
            return False
        db.save_ai_fit(conn, res["id"], int(data["fit_score"]), data.get("rationale"),
                       data.get("matched"), data.get("gaps"), model)
        est = data.get("salary_estimate") or {}
        smin, smax = est.get("min"), est.get("max")
        if config.POSTGRES:
            smin = _pg_money(smin, "salary_estimate.min") if smin else smin
            smax = _pg_money(smax, "salary_estimate.max") if smax else smax
        if smin and smax:
            db.save_salary_estimate(conn, res["id"], smin, smax,
                                    est.get("currency", "USD"), est.get("period", "year"))
    return True


def score_batch(limit=None, rescore=False, min_keyword=0, workers=8, title_any=None, company_any=None,
                days=None, recent_first=False, first_seen_days=None, *,
                allow_posted_date_window=False) -> tuple[int, int]:
    """AI-score the in-lane backlog. Returns (scored, skipped).

    Two freshness windows, and they are NOT interchangeable:
      first_seen_days — when WE first saw the job. NOT NULL on every row, stamped at
                        ingest. This is the incremental gate to use.
      days            — the employer's posted_date. NULL for ~26% of the corpus; a ten-day
                        window matched 32 rows out of 1.21M. Both parameters are preserved
                        because the SQLite CLI still exposes `--days` and behaves as it
                        always has, but in POSTGRES mode passing `days` RAISES unless the
                        caller also passes allow_posted_date_window=True. That keyword is
                        the whole point: the window remains available to someone who has
                        read why it is nearly empty, and unreachable by anyone who has
                        not. It is ignored in sqlite mode."""
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
    #
    # `active = 1` and `COALESCE(target_role,0) = 1` are valid in BOTH dialects: the 097
    # view casts those BOOLEANs back to int (`boolean = integer` is a hard error in
    # Postgres, and ::int preserves NULL, so "no score row yet" still COALESCEs to 0).
    # `ai_fit_score IS NULL` means "no signal row OR an unscored one" in both backends,
    # because both `postings` shapes LEFT JOIN the per-user side.
    where = "active = 1 AND COALESCE(target_role,0) = 1"
    if not rescore:
        where += " AND ai_fit_score IS NULL"
    if min_keyword:
        where += f" AND COALESCE(fit_score,0) >= {int(min_keyword)}"
    where += _freshness_where(days, first_seen_days, allow_posted_date_window)
    selector_sql, params = _selector_where(title_any, company_any)
    where += selector_sql
    sql = f"SELECT * FROM postings WHERE {where} ORDER BY {_order_by(recent_first)}"
    if config.POSTGRES and limit:
        # Push the caller's cap into SQL. `rows[:limit]` below already produced exactly
        # this set — the ORDER BY ends in the unique `id`, so the sort is a total order
        # and the first N rows are the same N rows either way — but in sqlite that slice
        # discards rows already read from a local file, while here it would drag every
        # matching row (107,004 for the unscored in-lane backlog, `description` and all)
        # across a socket to throw nearly all of it away. The Python slice stays exactly
        # as it was so the sqlite path is untouched and this is belt-and-braces.
        sql += f" LIMIT {int(limit)}"
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    if limit:
        rows = rows[:limit]
    total = len(rows)
    scored = skipped = 0

    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for i, res in enumerate(ex.map(lambda r: _score_one(r, prof_summary), rows), 1):
            if _commit_one(res, model):
                scored += 1
            else:
                skipped += 1
            if i % 25 == 0 or i == total:
                print(f"   {i}/{total}  ({scored} scored)", flush=True)
    return scored, skipped
