# CHANGE LOG
# 17 | maintainer@emeraldcoastsystemsgroup.com | Nightly new-only mode excludes stored AI fits and removed jobs, drains a shrinking backlog without offset skips, and leaves explicit refresh unchanged.
# 16 | maintainer@emeraldcoastsystemsgroup.com | One job whose details cannot be read is skipped instead of ending the pass. An employer refusing one page had discarded every score and keyword match of the resume match, every run, since 2026-10-29.
# 14 | maintainer@emeraldcoastsystemsgroup.com | Recheck legacy workplace metadata before remote-only selection without changing saved title, date or scoring budgets.
# 13 | maintainer@emeraldcoastsystemsgroup.com | Fingerprint trusted native routing identity before cache selection and record each guarded completion's actual provider/model without sharing mutable worker metadata.
# 12 | maintainer@emeraldcoastsystemsgroup.com | Revalidate expired or changed owner employer context within the existing pass budget and reuse unchanged exact scoring evidence without another model call.
# 11 | maintainer@emeraldcoastsystemsgroup.com | Refresh changed or legacy private fits within existing model budgets, using exact evidence fingerprints and a bounded owner scan cursor.
# 10 | maintainer@emeraldcoastsystemsgroup.com | Keep valid private fits when optional salary output is malformed, retry invalid core explanations, and disclose short employer source text to the scorer.
# 9 | maintainer@emeraldcoastsystemsgroup.com | Use complete compact profile evidence for every selected and nightly fit call instead of the truncated overview.
# 8 | maintainer@emeraldcoastsystemsgroup.com | Give the structured fit response 1400 output tokens now that the native rail preserves its actual output allowance.
# 7 | maintainer@emeraldcoastsystemsgroup.com | Reuse private employer details and hydrate short listings; preserve requirements beyond the former 6000-character prompt cutoff.
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Career worker rail: a CareerWorkerUnavailable from the model chokepoint ends the scoring run instead of being counted as one more skipped posting, so a lost Career worker fails the run visibly and the nightly scoring cursor does not advance.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Bound title scoring by posted date (first-seen fallback), use the exact in-lane predicate, and push result limits into SQLite as well as Postgres.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Preserve private fit writes when native sandboxes mount shared descriptions and salary data read-only.
# 4 | maintainer@emeraldcoastsystemsgroup.com | Respect explicit target titles outside the shared technology lane and assess advertised work without assuming a promotion-only hunt.
# 5 | maintainer@emeraldcoastsystemsgroup.com | Apply the owner's local-or-remote scope before model selection and include the work arrangement in fit assessment.
# 6 | maintainer@emeraldcoastsystemsgroup.com | Materialize the recent SQLite date ranges before applying role and geography filters, preserving the bounded result while avoiding an active-corpus scan.
# 15 | maintainer@emeraldcoastsystemsgroup.com | Facts learned about a posting go through db.enrich_corpus, so a shared read-only corpus does not fail the pass.

"""The matching algorithm: for every relevant posting, fetch the FULL job description,
then have the LLM score it against the user's actual resume — fit 0-100, why it fits, what
he's missing, and a salary estimate. Runs in parallel so it covers the whole relevant
set quickly, not a keyword skim.

STORAGE (JOBHUNTER_STORE — see config.STORE)

  'sqlite'   (DEFAULT) — `postings` is db.py's per-connection TEMP view, `companies`
             resolves through the ATTACH (or is the inline table), and its date('now',…)
             / datetime('now',…) predicates use the local corpus indexes. The nightly
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
import json
import math

from . import db, detail, enrich, profile, config, search_scope, score_freshness, job_context

SCORING_MAX_TOKENS = 1400
SCORING_CONTRACT_VERSION = 1

SYSTEM = (
    "You are a recruiter matching ONE candidate to ONE advertised job. Be rigorous and honest: "
    "assess evidence that the candidate can perform the work and meets the required skills, "
    "domain knowledge, education, licenses, and clearance. Penalize missing must-haves; never inflate. "
    "Do not assume the candidate wants only promotions, management, or higher pay. Additional "
    "experience is not itself a missing qualification for a junior or hands-on role. Return strict JSON only."
)

PROMPT = """CANDIDATE PROFILE:
{profile}

JOB:
Company: {company}
Title: {title}
Location: {location}
Work arrangement: {work_arrangement}
Description:
{description}
Source basis: {source_basis}

Return STRICT JSON only:
{{
  "fit_score": <int 0-100, how well THIS candidate fits THIS specific job>,
  "rationale": "2-3 sentences: fit based on the candidate's evidence and this job's requirements",
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


def _freshness_where(days, first_seen_days, fresh_days, allow_posted_date_window: bool) -> str:
    """Freshness windows, in the active dialect. Returns SQL to append to a WHERE.

    These windows do not bind parameters in either backend — the day count is interpolated
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
    if fresh_days:  # posted within N days; when ATS omits posted_date, fall back to when we saw it.
        if config.POSTGRES:
            cutoff = _pg_days_ago(fresh_days)
            sql += (
                f" AND (posted_date >= {cutoff} OR (posted_date IS NULL AND first_seen_at >= "
                f"({cutoff} || 'T00:00:00+00:00')))"
            )
        else:
            sql += (
                f" AND (posted_date >= date('now','-{int(fresh_days)} days')"
                f" OR (posted_date IS NULL AND first_seen_at >= datetime('now','-{int(fresh_days)} days')))"
            )
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
    """Row ordering. Both forms end in the unique `id`, making the order total so SQL
    LIMIT returns the same rows as the former Python slice in either backend."""
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

def _scoring_inputs(row, prof_summary, company, *, fetch_detail=False, model_identity=None):
    """Use the same exact evidence for freshness checks and actual inference.

    Checking a saved score uses only the listing and owner cache, never an employer request.
    Retrieval timestamps are deliberately excluded; source basis and omitted-text warnings are
    evidence. A stale candidate may fetch fuller details before its final fingerprint is saved.
    """
    resolved, fetched = (job_context.hydrate(row, company) if fetch_detail else
                         (job_context.apply(row), None))
    desc = resolved.get('description') or '(no description available)'
    desc = desc.strip() or '(no description available)'
    basis = ('employer-detail' if fetched else
             (resolved.get('description_context') or {}).get('basis'))
    if len(desc) < 1000 or basis == 'listing-summary':
        basis = 'employer-detail-short' if basis == 'employer-detail' else 'listing-summary'
    elif basis in (None, 'listing', 'corpus-description', 'employer-detail'):
        # These names describe where the same full text was stored or retrieved. Keeping
        # them equivalent avoids a second inference after fetched text enters the corpus.
        basis = 'job-description'
    prompt = PROMPT.format(profile=prof_summary, company=company['name'], title=row['title'],
                           location=row.get('location') or 'n/a', description=desc[:16000]
                               + ('\n[Remaining employer text omitted; do not infer its requirements.]' if len(desc)>16000 else ''),
                           source_basis=basis,
                           work_arrangement='Feed marks remote (unverified; check attendance and location eligibility)' if row.get('remote') else 'On-site or hybrid')
    if len(desc) < 1000 or basis == 'listing-summary':
        prompt += '\nSOURCE LIMITATION: The employer text is short or a listing summary. Assess only its explicit requirements and state where job details are insufficient; do not invent missing requirements.\n'
    model = (model_identity or enrich.resolve_scoring_identity(config.ANTHROPIC_SCORE_MODEL)).cache_key
    fingerprint = score_freshness.fingerprint({
        'contract': SCORING_CONTRACT_VERSION, 'model': model, 'system': SYSTEM, 'prompt': prompt,
    })
    return prompt, fingerprint, fetched, model


def _score_one(row, prof_summary, *, prior_fingerprint=None, model_identity=None):
    """Worker: fetch detail + AI-score one job. Returns a dict to commit (or None)."""
    model_identity = model_identity or enrich.resolve_scoring_identity(config.ANTHROPIC_SCORE_MODEL)
    with db.connect() as conn:
        # db.companies_table() is the string "companies" in sqlite (unchanged) and the base
        # career_companies in postgres. These three columns are objective employer data, so
        # reading the base table skips the 097 compat view's per-column expressions.
        company = conn.execute(
            f"SELECT name, ats_type, ats_token FROM {db.companies_table()} WHERE id=?",
            (row["company_id"],)).fetchone()
    try:
        prompt, fingerprint, fetched, model = _scoring_inputs(row, prof_summary, company, fetch_detail=True,
                                                            model_identity=model_identity)
    except ValueError as error:
        # An employer refusing a page, or one unreadable saved copy, costs this job this pass.
        # Raising here would end ex.map, and with it every other job's score. Any prior score stays.
        return {"id": row["id"], "fetched": None, "data": None, "refused": str(error),
                "company": company["name"], "title": row["title"], "model": model_identity.cache_key}
    if prior_fingerprint and fingerprint == prior_fingerprint:
        # Revalidation updates the cache's retrieval time, not the semantic score input.
        # A successful unchanged GET consumes no model call and is not a failed score.
        return {"id": row["id"], "fetched": fetched, "data": None, "unchanged": True,
                "context_cached": bool(fetched),
                "company": company["name"], "title": row["title"],
                "fingerprint": fingerprint, "model": model}
    data = None
    for attempt, allowance in enumerate((SCORING_MAX_TOKENS, 2048)):
        try:
            answer = enrich.complete_scoring(SYSTEM, prompt + (
                '\nReturn one complete compact JSON object in the exact requested shape. No prose or tool calls.' if attempt else ''),
                max_tokens=allowance, model=config.ANTHROPIC_SCORE_MODEL, identity=model_identity)
            candidate = enrich.parse_json(answer.text)
        except enrich.CareerWorkerUnavailable:
            # A lost worker ends the run; retries never leave the accounted rail.
            raise
        except Exception:
            break
        fit = candidate.get('fit_score') if isinstance(candidate, dict) else None
        explanation_ok = isinstance(candidate, dict) and (candidate.get('rationale') is None or isinstance(candidate['rationale'], str)) and all(
            candidate.get(key) is None or isinstance(candidate[key], list) and all(isinstance(item, str) for item in candidate[key])
            for key in ('matched', 'gaps'))
        if isinstance(fit, (int, float)) and not isinstance(fit, bool) and 0 <= fit <= 100 and explanation_ok:
            data = candidate
            # The fingerprint names the configured policy. Attribution names the route
            # that actually answered, including an allowed fallback, without a schema change.
            model = (json.dumps({'provider': answer.provider, 'model': answer.model, 'fallback': answer.fallback},
                                ensure_ascii=False, separators=(',', ':')) if answer.provider else answer.model)
            break
    return {"id": row["id"], "fetched": fetched, "context_cached": bool(fetched), "data": data, "company": company["name"],
            "title": row["title"], "fingerprint": fingerprint, "model": model}


def _commit_one(res, model) -> bool:
    """Persist one worker result. Returns True if an AI fit was saved, False if the model
    returned nothing usable — in which case the fetched description / salary / date are
    still committed, exactly as before.

    Lifted out of score_batch() (where it was a closure over the two counters) so the
    dialect branches fit in a readable function. It issues the same statements, with the
    same values, in the same order as the closure did."""
    with db.connect() as conn:
        f = res.get("fetched")
        if f and f.get("description") and db.corpus_writable():
            ct = db.corpus_table()   # description/salary/posted are objective -> shared corpus
            db.enrich_corpus(conn, f"UPDATE {ct} SET description=? WHERE id=?", (f["description"], res["id"]))
            if f.get("salary_min"):
                # detail.fetch() already float()s these, so they suit REAL and NUMERIC alike.
                db.enrich_corpus(conn, f"""UPDATE {ct} SET salary_min=?, salary_max=?, salary_currency=?,
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
                db.enrich_corpus(conn, f"UPDATE {ct} SET posted_at=COALESCE(posted_at,?), posted_date=COALESCE(posted_date,?) WHERE id=?",
                             (posted_at_val, dates.normalize(f["posted_at"]), res["id"]))
            # A writable legacy corpus now contains this same evidence. Bind the private
            # cache to the updated objective listing so the next pass does not refetch it.
            if res.get('context_cached'):
                current = conn.execute('SELECT * FROM postings WHERE id=?', (res['id'],)).fetchone()
                job_context.remember(dict(current), f)
        data = res.get("data")
        if not data:
            return False
        db.save_ai_fit(conn, res["id"], int(data["fit_score"]), data.get("rationale"),
                       data.get("matched"), data.get("gaps"), res.get('model') or model,
                       res.get('fingerprint'))
        est = data.get("salary_estimate")
        if not isinstance(est, dict):
            est = {}
        smin, smax = est.get("min"), est.get("max")
        if not all(isinstance(value, (int,float)) and not isinstance(value,bool) and math.isfinite(value) and value>0 for value in (smin,smax)) or smin>smax:
            smin = smax = None
        if not isinstance(est.get('currency','USD'),str) or not isinstance(est.get('period','year'),str):
            smin = smax = None
        if config.POSTGRES:
            smin = _pg_money(smin, "salary_estimate.min") if smin else smin
            smax = _pg_money(smax, "salary_estimate.max") if smax else smax
        if smin and smax:
            db.save_salary_estimate(conn, res["id"], smin, smax,
                                    est.get("currency", "USD"), est.get("period", "year"))
    return True


def _batch_sql(title_any, company_any, scope, remote_only, min_keyword, new_only,
               days, first_seen_days, fresh_days, allow_posted_date_window, recent_first):
    """Build the same explicit refresh selection or a pending-only nightly backlog."""
    # Generic passes use the shared technology/professional lane. Explicit user titles
    # are their own selection: adjunct/instructor roles must not be rejected just because
    # the shared classifier does not label them technology work. Empty terms cannot
    # remove the generic lane gate.
    title_any = [str(term).strip() for term in (title_any or []) if str(term).strip()]
    #
    # `active = 1` and `target_role = 1` are valid in BOTH dialects: the 097 view casts
    # those BOOLEANs back to int (`boolean = integer` is a hard error in Postgres). Exact
    # equality also lets SQLite use idx_corpus_lane_seen; NULL target_role remains excluded.
    # Existing scores remain candidates: their exact private evidence may have changed.
    # Freshness is checked below after the same title/area/date gates and before inference.
    where = "active = 1 AND target_role = 1"
    if title_any:
        where = "active = 1"
    if scope:
        where += ' AND ' + search_scope.predicate(scope, config.POSTGRES)
    if remote_only:
        # The user's standing preference (career_score_settings.remote_only). Gating HERE and not
        # only at display is deliberate: an on-site role a remote-only candidate would never take
        # should not cost a scoring inference in the first place. `remote` is 0/1 in both
        # compatibility views. Contradictory legacy flags are not evidence.
        where += " AND " + search_scope.fully_remote_predicate()
    if min_keyword:
        where += f" AND COALESCE(fit_score,0) >= {int(min_keyword)}"
    if new_only:
        where += " AND ai_fit_score IS NULL AND COALESCE(status,'new') <> 'dismissed'"
    else:
        where += _freshness_where(days, first_seen_days, fresh_days, allow_posted_date_window)
    selector_sql, params = _selector_where(title_any, company_any)
    where += selector_sql
    prefix, source = '', 'postings'
    if fresh_days and not config.POSTGRES and not new_only:
        # The OR between remote and local geometry otherwise makes SQLite choose the
        # active/geo index and read millions of rows before the date gate. Materialize
        # the disjoint posted/undated ranges first, using the existing date indexes.
        n = int(fresh_days)
        prefix = ("WITH seen_candidates AS MATERIALIZED ("
                  "SELECT id AS fresh_id, posted_date FROM postings "
                  f"WHERE first_seen_at >= datetime('now','-{n} days')), "
                  "fresh_candidates AS MATERIALIZED ("
                  f"SELECT id AS fresh_id FROM postings WHERE posted_date >= date('now','-{n} days') "
                  "UNION ALL SELECT fresh_id FROM seen_candidates WHERE posted_date IS NULL) ")
        source = 'fresh_candidates CROSS JOIN postings ON postings.id = fresh_candidates.fresh_id'
    sql = f"{prefix}SELECT postings.* FROM {source} WHERE {where} ORDER BY {_order_by(recent_first)}"
    return sql, params


def _batch_rows(sql, params, rescore):
    """Read saved evidence for a bounded selection before any scoring work."""
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
        fingerprints = db.score_fingerprints(conn, [r['id'] for r in rows if r.get('ai_fit_score') is not None]) if not rescore else {}
        companies = {}
        company_ids = sorted({r['company_id'] for r in rows if fingerprints.get(r['id'])})
        for start in range(0, len(company_ids), 500):
            ids = company_ids[start:start + 500]
            found = conn.execute(f"SELECT id,name FROM {db.companies_table()} WHERE id IN ({','.join('?' for _ in ids)})", ids)
            companies.update((r['id'], r) for r in found.fetchall())
    return rows, fingerprints, companies


def _select_stale(rows, fingerprints, companies, prof_summary, model_identity, rescore, budget):
    """Count inspected candidates separately from actual stale inputs."""
    selected = []
    inspected = 0
    for row in rows:
        inspected += 1
        stale = rescore or row.get('ai_fit_score') is None or not fingerprints.get(row['id'])
        if not stale:
            try:
                _, fingerprint, _, _ = _scoring_inputs(row, prof_summary, companies[row['company_id']],
                                                      model_identity=model_identity)
                stale = job_context.needs_refresh(row) or fingerprint != fingerprints[row['id']]
            except ValueError:
                stale = True  # An unreadable saved copy: _score_one reports it against this job alone.
        if stale:
            selected.append(row)
            if budget and len(selected) >= budget:
                break
    return selected, inspected


def _score_selected(selected, fingerprints, prof_summary, model_identity, rescore, workers):
    """Save model results and preserve explicit unavailable-worker failures."""
    model = model_identity.cache_key
    total = len(selected)
    scored = skipped = refused = 0

    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for i, res in enumerate(ex.map(lambda r: _score_one(r, prof_summary,
                prior_fingerprint=None if rescore else fingerprints.get(r['id']),
                model_identity=model_identity), selected), 1):
            committed = _commit_one(res, model)
            if res.get('unchanged'):
                pass
            elif committed:
                scored += 1
            else:
                skipped += 1
                refused += bool(res.get('refused'))
            if i % 25 == 0 or i == total:
                print(f"   {i}/{total}  ({scored} scored)", flush=True)
    if refused:
        print(f"   {refused} skipped: employer details unavailable", flush=True)
    return scored, skipped, refused


def score_batch(limit=None, rescore=False, min_keyword=0, workers=8, title_any=None, company_any=None,
                days=None, recent_first=False, first_seen_days=None, *, fresh_days=None,
                allow_posted_date_window=False, remote_only=False, new_only=False) -> tuple[int, int]:
    """AI-score the in-lane backlog. Returns (scored, skipped).

    Two freshness windows, and they are NOT interchangeable:
      first_seen_days — when WE first saw the job. NOT NULL on every row, stamped at
                        ingest. This is the incremental gate to use.
      fresh_days      — the posting date, falling back to first_seen_at only when the
                        feed omits it. Use for a candidate-facing "posted recently" window.
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
    model_identity = enrich.resolve_scoring_identity(config.ANTHROPIC_SCORE_MODEL)
    model = model_identity.cache_key
    # Scoring is private (never shown to an employer), so it credits the user's full
    # ability — including his independent open-source / agentic R&D (OSHAL). This is
    # what lets applied-research / emerging-tech / agentic roles score on his real
    # depth. Resume/cover generation gates OSHAL separately (opt-in, default off).
    prof_summary = profile.scoring_context(include_oshal=True)
    scope = search_scope.load(config.CAREER_DB.parent)
    if scope:
        prof_summary += search_scope.summary(scope)
    sql, params = _batch_sql(title_any, company_any, scope, remote_only, min_keyword, new_only,
                             days, first_seen_days, fresh_days, allow_posted_date_window, recent_first)
    budget = int(limit) if limit is not None and int(limit) > 0 else None
    # No more than ten candidate inspections per allowed model call. The cursor rotates
    # through unchanged candidates, so they cannot permanently hide later stale inputs.
    inspection_limit = budget * 10 if budget and not new_only else None
    cursor_key = score_freshness.fingerprint({
        'owner': config.USER_SUB, 'store': config.STORE,
        'sql': sql, 'params': params, 'profile': prof_summary,
        'model': model, 'contract': SCORING_CONTRACT_VERSION, 'system': SYSTEM,
        'prompt': PROMPT, 'rescore': rescore,
    })
    positions, offset = score_freshness.read_cursor(cursor_key) if budget and not new_only else ({}, 0)
    if inspection_limit:
        sql += f" LIMIT {inspection_limit + 1} OFFSET {offset}"
    if new_only and budget:
        sql += f" LIMIT {budget}"
    rows, fingerprints, companies = _batch_rows(sql, params, rescore)
    more = inspection_limit is not None and len(rows) > inspection_limit
    if inspection_limit:
        rows = rows[:inspection_limit]
    selected, inspected = _select_stale(rows, fingerprints, companies, prof_summary, model_identity, rescore, budget)
    scored, skipped, refused = _score_selected(selected, fingerprints, prof_summary, model_identity, rescore, workers)
    if budget and not new_only and skipped == refused:
        # Invalid/retryable outputs must remain reachable on the next attempt. Successful
        # earlier rows are already fingerprinted, so retaining this position costs no
        # repeat inference for them. A refusing employer can last for weeks, so it does not
        # hold the position: its job comes round again when the cursor wraps.
        next_offset = offset + inspected if more or inspected < len(rows) else 0
        score_freshness.write_cursor(positions, cursor_key, next_offset)
    return scored, skipped
