"""The slow-roll bot: finds each company's careers URL via Google, a few per hour,
staying under the free-tier quota, and keeps a status report. Designed to be run on
a schedule (e.g. hourly) and left alone until the whole list is done.

    python -m jobhunter run            # process this hour's small batch + report
    python -m jobhunter status         # print the current report
"""
from __future__ import annotations
import json
import math
from datetime import date, datetime, timezone

from . import db, discover, ats, config

STATE_PATH = config.DATA_DIR / "runner_state.json"
REPORT_PATH = config.DATA_DIR / "discovery_report.md"
DEFAULT_DAILY = 100  # Google Custom Search free tier


def _today() -> str:
    return date.today().isoformat()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"google_used": {}, "started": _now()}


def _save_state(s: dict) -> None:
    STATE_PATH.write_text(json.dumps(s, indent=2), encoding="utf-8")


def _counts(conn) -> dict:
    """Discovery + corpus counters for the status report.

    The `companies` reads stay on that name in BOTH backends: in postgres mode it is the
    compatibility VIEW from migration 097, which exposes `gsearched` cast back to 0/1 so
    `gsearched=1` keeps meaning what it meant (the base column is a real BOOLEAN, and
    `boolean = integer` is a hard error in Postgres).

    The two posting counts read db.read_postings_table() instead: they touch only objective
    columns, and in postgres mode that is the base career_postings rather than the compat
    view, which would drag both RLS-filtered per-user joins across 1.4M rows to count a
    column that is on the corpus row anyway. In sqlite mode the helper returns `postings`,
    so the SQL text is unchanged. `active` is the same 0/1-vs-BOOLEAN split as gsearched.
    """
    pt = db.read_postings_table()
    on = "TRUE" if config.POSTGRES else "1"
    q = lambda sql: conn.execute(sql).fetchone()["n"]
    return {
        "total": q("SELECT COUNT(*) n FROM companies"),
        "scrapable": q("SELECT COUNT(*) n FROM companies WHERE ats_type IS NOT NULL"),
        "careers_only": q("SELECT COUNT(*) n FROM companies WHERE ats_type IS NULL AND careers_url IS NOT NULL"),
        "searched_empty": q("SELECT COUNT(*) n FROM companies WHERE gsearched=1 AND careers_url IS NULL AND ats_type IS NULL"),
        "remaining": q("SELECT COUNT(*) n FROM companies WHERE gsearched=0 AND ats_type IS NULL AND careers_url IS NULL"),
        "jobs": q(f"SELECT COUNT(*) n FROM {pt} WHERE active={on}"),
        "companies_with_jobs": q(f"SELECT COUNT(DISTINCT company_id) n FROM {pt} WHERE active={on}"),
    }


def write_report(daily_budget: int = DEFAULT_DAILY) -> str:
    db.init_db()  # ensure schema/migration (gsearched column) is applied
    state = _load_state()
    with db.connect() as conn:
        c = _counts(conn)
    used_today = state.get("google_used", {}).get(_today(), 0)
    days_left = math.ceil(c["remaining"] / daily_budget) if c["remaining"] else 0
    with_url = c["scrapable"] + c["careers_only"]
    lines = [
        f"# Job-Hunter discovery status — {_now()}",
        "",
        f"**{with_url} / {c['total']} companies now have a jobs URL.**",
        "",
        f"- Scrapable ATS (jobs pulled automatically): **{c['scrapable']}**",
        f"- Careers URL only (clickable link, manual apply): **{c['careers_only']}**",
        f"- Searched, no careers page found: {c['searched_empty']}",
        f"- Remaining to search: **{c['remaining']}**",
        "",
        f"- Active job postings scraped: **{c['jobs']:,}** across {c['companies_with_jobs']} companies",
        "",
        "## Slow-roll progress",
        f"- Google searches used today: {used_today} / {daily_budget}",
        f"- Estimated days to finish remaining: **~{days_left}**"
        + (f" (≈ {date.fromordinal(date.today().toordinal() + days_left).isoformat()})" if days_left else ""),
        f"- Started: {state.get('started', '?')}  ·  Last run: {state.get('last_run', '?')}",
        "",
        "_Run `python -m jobhunter dashboard` to browse. This report regenerates every run._",
    ]
    report = "\n".join(lines)
    REPORT_PATH.write_text(report, encoding="utf-8")
    return report


def run_batch(daily_budget: int = DEFAULT_DAILY, per_run: int | None = None, do_scrape: bool = True) -> str:
    db.init_db()
    state = _load_state()
    state.setdefault("google_used", {})
    used_today = state["google_used"].get(_today(), 0)
    processed = newly_scrapable = 0
    new_ats_ids = []

    google_ok = bool(config.GOOGLE_API_KEY and config.GOOGLE_CX)
    remaining_budget = daily_budget - used_today
    if not google_ok:
        print("Google not configured (no GOOGLE_API_KEY/GOOGLE_CX) — skipping careers search; "
              "still scraping any backlog. Add .google.json to enable careers discovery.")
    elif remaining_budget <= 0:
        print(f"Daily Google budget reached ({used_today}/{daily_budget}). Idling careers search until tomorrow.")
    else:
        # Spread the daily budget across ~24 hourly runs by default.
        batch = min(per_run or max(1, math.ceil(daily_budget / 24)), remaining_budget)
        with db.connect() as conn:
            rows = [dict(r) for r in conn.execute(
                """SELECT id, name, homepage FROM companies
                   WHERE gsearched=0 AND ats_type IS NULL AND careers_url IS NULL
                   ORDER BY id LIMIT ?""", (batch,)).fetchall()]
        # WRITES must name the base table. `companies` is a real table in sqlite mode but a
        # read-only VIEW in postgres mode (its columns are expressions, so Postgres refuses
        # the UPDATE outright: "cannot update column ... of view companies"). gsearched is
        # 0/1 in SQLite and BOOLEAN in career_companies.
        ct = db.companies_table()
        yes = "TRUE" if config.POSTGRES else "1"
        for r in rows:
            url, atype, tok = discover.google_careers_url(r["name"])
            used_today += 1
            processed += 1
            status = "found" if atype else ("careers_only" if url else "not_found")
            with db.connect() as conn:
                conn.execute(
                    f"""UPDATE {ct} SET careers_url=?, ats_type=?, ats_token=?, gsearched={yes}, discover_status=?
                       WHERE id=?""", (url, atype, tok, status, r["id"]))
            if atype:
                newly_scrapable += 1
                new_ats_ids.append(r["id"])
            print(f"  {r['name']}: {('SCRAPE ' + atype) if atype else ('link ' + url if url else 'none')}", flush=True)
        state["google_used"][_today()] = used_today

    state["last_run"] = _now()
    _save_state(state)

    # Scrape: newly-found scrapable companies, plus a few not-yet-scraped ones each run,
    # so the bot gradually pulls jobs from every supported platform (no quota cost).
    if do_scrape:
        with db.connect() as conn:
            backlog = [r["id"] for r in conn.execute(
                """SELECT id FROM companies WHERE ats_type IS NOT NULL AND last_scraped_at IS NULL
                   ORDER BY id LIMIT 6""").fetchall()]
        for cid in dict.fromkeys(new_ats_ids + backlog):
            with db.connect() as conn:
                co = conn.execute("SELECT name, ats_type, ats_token FROM companies WHERE id=?", (cid,)).fetchone()
            try:
                postings = ats.fetch(co["ats_type"], co["ats_token"])
                with db.connect() as conn:
                    seen = set()
                    for p in postings:
                        if p.get("ats_job_id") is None:
                            continue
                        db.upsert_posting(conn, cid, p); seen.add(str(p["ats_job_id"]))
                    db.deactivate_missing(conn, cid, seen)
                    # Base table again (see above). db.now() emits the ISO-8601 string
                    # career_companies.last_scraped_at (TIMESTAMPTZ) parses without help.
                    conn.execute(f"UPDATE {db.companies_table()} SET last_scraped_at=? WHERE id=?",
                                 (db.now(), cid))
                print(f"    -> scraped {co['name']}: {len(postings)} jobs", flush=True)
            except Exception as e:
                print(f"    -> scrape failed {co['name']}: {e}", flush=True)

    # Keep the ranking fresh: deep-AI-score a batch of unscored in-lane jobs each run
    # (full description + fit vs resume). Spreads the work across hourly runs.
    from . import enrich, score
    if enrich.provider():
        try:
            sdone, _ = score.score_batch(limit=150, min_keyword=45, workers=8)
            if sdone:
                print(f"  AI-scored {sdone} in-lane jobs", flush=True)
        except Exception as e:
            print(f"  scoring skipped: {str(e)[:80]}", flush=True)

    report = write_report(daily_budget)
    print(f"\nProcessed {processed} ({newly_scrapable} scrapable). "
          f"Google today: {used_today}/{daily_budget}.")
    return report
