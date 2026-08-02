"""Command-line interface.

    python -m jobhunter init
    python -m jobhunter seed --list dow30|sp500|nasdaq100|best|curated|all
    python -m jobhunter discover [--all-missing | --company NAME] [--limit N]
    python -m jobhunter scrape   [--all | --company NAME | --list dow30] [--limit N]
    python -m jobhunter enrich   [--missing | --refresh] [--limit N]
    python -m jobhunter set-manual --company NAME [--score N] [--about ..] [--positives "a;b"] [--negatives "a;b"] [--note ..]
    python -m jobhunter import-manual --csv FILE
    python -m jobhunter match
    python -m jobhunter export --format md|csv [--out FILE] [--min-fit N] [--min-score N]
    python -m jobhunter stats
"""
from __future__ import annotations
import argparse
import csv
import json
import sys

from . import db, seeds, discover, ats, enrich, match, config, resolve


# ═════════════════════════════════════════════════════════════════════════════
# SQL DIALECT FRAGMENTS
#
# Each returns the empty string / the SQLite spelling when config.POSTGRES is false, so
# every statement below assembles to the byte-identical text sqlite3 has always executed.
# Physical table names come from db.py (corpus_table / companies_table /
# read_postings_table); these four cover the differences db.q() deliberately will not
# translate. All four were measured against the live cluster (PG 16.14), not assumed.
# ═════════════════════════════════════════════════════════════════════════════

def _yes() -> str:
    """Literal for a TRUE flag. `active` / `remote` are 0/1 INTEGERs in SQLite and real
    BOOLEANs in career_postings, where `active = 1` is not merely wrong but a hard error:
    `operator does not exist: boolean = integer`. Mirrors the same inline in
    db.py::upsert_posting and db.py::deactivate_missing rather than adding a public helper
    to a file already at its decomposition threshold.

    Only needed when reading a BASE table. The `postings` compat view (migration 097)
    already exposes `active::int`, so statements that read the view keep `active=1`."""
    return "TRUE" if config.POSTGRES else "1"


def _nulls_last() -> str:
    """Placed after a DESC sort key that can be NULL. SQLite treats NULL as smaller than
    everything, so DESC puts NULLs LAST; Postgres defaults to NULLS FIRST for DESC.
    Verified both ways: sqlite `ORDER BY x DESC` over (1, NULL, 3) -> [3, 1, None, None];
    postgres -> [None, 3, 1]. Left un-emitted in sqlite mode so the existing statement text
    is untouched (SQLite only learned NULLS LAST in 3.30)."""
    return " NULLS LAST" if config.POSTGRES else ""


def _bin() -> str:
    """Collation for `ORDER BY name`. SQLite sorts TEXT with BINARY; this cluster's default
    is en_US.utf8, which sorts case- and punctuation-insensitively. That is not cosmetic
    here: `discover --limit N` and `scrape --limit N` take the FIRST N rows of that order,
    so the two backends would work on different companies (measured on the live corpus —
    'A. O. Smith' is 4th under BINARY and absent from the first 8 under en_US.utf8).
    COLLATE "C" reproduces BINARY exactly: both give Apple, Ericsson, Zoom, eBay."""
    return ' COLLATE "C"' if config.POSTGRES else ""


def _like() -> str:
    """LIKE operator. SQLite's LIKE is case-INSENSITIVE for ASCII; Postgres' is
    case-SENSITIVE, and ILIKE is its case-insensitive form. Measured: against the live
    `companies` view, `source_lists LIKE '%"dow30"%'` matches 29 rows, `LIKE '%"DOW30"%'`
    matches 0, and `ILIKE '%"DOW30"%'` matches 29 — i.e. without this, `scrape --list
    DOW30` would silently scrape nothing instead of the Dow 30."""
    return "ILIKE" if config.POSTGRES else "LIKE"


def _dropped_since(before: dict) -> dict:
    """What db.dropped_fields() gained since `before` — i.e. what THIS verb lost.

    db.dropped_fields() counts values that have NO column to hold them: an ATS UI label
    ("Posted 30+ Days Ago") where a TIMESTAMPTZ is required, a feed row with no title
    against a NOT NULL column. They are NULLed or skipped, never guessed, and a run that
    reports only its successes is indistinguishable from one that lost nothing.

    The counter is process-global and cumulative. One CLI invocation is one process, so the
    delta and the total are the same there — but the verbs are also importable, and
    reporting the running total from the second call onward would overstate the loss.
    Subtracting a baseline makes the number true either way.

    Always empty in sqlite mode: nothing outside db.py's postgres branches calls
    db._drop()."""
    now_ = db.dropped_fields()
    return {k: v - before.get(k, 0) for k, v in now_.items() if v > before.get(k, 0)}


def _report_dropped(before: dict) -> None:
    """Print this verb's unrepresentable values, if there were any. Silent otherwise, so
    sqlite-mode output is unchanged."""
    dropped = _dropped_since(before)
    if not dropped:
        return
    print("\nNot representable in the store (NULLed or skipped — never guessed):")
    for field, n in sorted(dropped.items()):
        print(f"   {field}: {n}")


def _companies(conn, *, company=None, source_list=None, only_unscraped=False, need_ats=False):
    sql = "SELECT * FROM companies WHERE 1=1"
    args = []
    if company:
        sql += " AND name = ?"; args.append(company)
    if source_list:
        sql += f" AND source_lists {_like()} ?"; args.append(f'%"{source_list}"%')
    if need_ats:
        sql += " AND ats_type IS NOT NULL AND ats_token IS NOT NULL"
    sql += " ORDER BY name" + _bin()
    return conn.execute(sql, args).fetchall()


def cmd_init(_):
    db.init_db()
    if config.POSTGRES:
        # DB_PATH is a SQLite file path and names nothing in this mode. The schema belongs
        # to migrations/095-097 and is applied by the package migration runner, so all
        # init_db() does here is seed this user's recruiter tracker. Print what is true.
        print(f"Postgres store ready (schema: migrations/095-097, acting sub {config.USER_SUB})")
    else:
        print(f"DB ready at {config.DB_PATH}")


def cmd_seed(a):
    valid = seeds.available_lists() + list(seeds.LIST_ALIASES)
    if a.list not in valid:
        print(f"!! unknown list {a.list!r}. Available: {', '.join(seeds.available_lists() + list(seeds.LIST_ALIASES))}",
              file=sys.stderr)
        sys.exit(1)
    n = seeds.seed_list(a.list)
    print(f"Seeded/updated {n} companies from '{a.list}'.")


def cmd_discover(a):
    import concurrent.futures as cf
    db.init_db()
    with db.connect() as conn:
        if a.company:
            rows = _companies(conn, company=a.company)
        else:
            # `!= 'found'` also drops NULLs. career_companies.discover_status has NO
            # DEFAULT (096) where the SQLite column defaults to 'pending', so a company
            # registered by upsert_company starts NULL — and with `!=` in postgres mode
            # `discover` would silently skip every newly added company, which is precisely
            # the set it exists to process. IS DISTINCT FROM is what the SQLite clause
            # MEANS ("not discovered yet") and is what SQLite's non-null default makes it
            # do. Both spellings return the same 206 rows on the live corpus today, so this
            # changes no current result — it keeps the intent true once NULLs appear.
            ne = "IS DISTINCT FROM" if config.POSTGRES else "!="
            rows = conn.execute(
                f"SELECT * FROM companies WHERE discover_status {ne} 'found' ORDER BY name{_bin()}"
            ).fetchall()
        if a.limit:
            rows = rows[:a.limit]
    total = len(rows)
    rows = [dict(r) for r in rows]  # detach from the connection for thread use
    workers = a.workers or 16

    def work(r):
        return r, discover.discover_company(r["name"], r["homepage"], r["careers_url"])

    found = careers = done = 0
    # Discover companies concurrently (each hits a different host). Commit each result
    # as it lands so the run is resumable and progress is visible.
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for r, res in ex.map(work, rows):
            with db.connect() as conn:
                # WRITE -> the base table. `companies` is a read-only VIEW in postgres mode
                # (its columns are expressions, so it is not even auto-updatable);
                # db.companies_table() returns the same literal 'companies' under sqlite.
                conn.execute(
                    f"UPDATE {db.companies_table()} SET ats_type=?, ats_token=?, careers_url=?, "
                    "discover_status=? WHERE id=?",
                    (res["ats_type"], res["ats_token"], res["careers_url"], res["status"], r["id"]),
                )
            done += 1
            if res["status"] == "found":
                found += 1
                print(f"[{done}/{total}] SCRAPE {r['name']}: {res['ats_type']} {res['ats_token'] or ''}", flush=True)
            elif res["status"] == "careers_only":
                careers += 1
                if done % 10 == 0 or careers <= 20:
                    print(f"[{done}/{total}] link   {r['name']}: {res['careers_url']}", flush=True)
            elif done % 25 == 0:
                print(f"[{done}/{total}] ... {found} scrapable, {careers} careers-links so far", flush=True)
    print(f"\n{found} scrapable ATS + {careers} careers-only links = {found + careers}/{total} companies with a jobs URL.")


def cmd_scrape(a):
    db.init_db()
    dropped0 = db.dropped_fields()
    with db.connect() as conn:
        rows = [dict(r) for r in _companies(conn, company=a.company, source_list=a.list, need_ats=True)]
    if a.limit:
        rows = rows[:a.limit]
    total_new = total_seen = total_closed = total_skipped = 0
    # One short transaction per company so long runs don't lock the DB against the bot/dashboard.
    for r in rows:
        try:
            postings = ats.fetch(r["ats_type"], r["ats_token"])
        except Exception as e:
            print(f"!! {r['name']} ({r['ats_type']}): {e}", flush=True)
            continue
        if not postings:
            # An empty fetch is almost always a transient error / rate-limit, NOT "all jobs
            # closed". Never wipe a company's existing jobs on an empty result.
            print(f"   {r['name']:<28}    0 live  (skipped — empty fetch, kept existing)", flush=True)
            continue
        seen_ids, new, seen, skipped = set(), 0, 0, 0
        with db.connect() as conn:
            for p in postings:
                if p.get("ats_job_id") is None:
                    continue
                status = db.upsert_posting(conn, r["id"], p)
                seen_ids.add(str(p["ats_job_id"]))
                new += status == "new"; seen += status == "seen"
                # postgres only: career_postings.title is NOT NULL, so db.upsert_posting
                # drops a feed row with no title rather than inventing '(untitled)'. It
                # returns neither 'new' nor 'seen', so without this counter the per-company
                # line would claim an intake larger than what actually landed. Always 0 in
                # sqlite mode (upsert_posting cannot return 'skipped' there).
                skipped += status == "skipped"
            closed = db.deactivate_missing(conn, r["id"], seen_ids)
            conn.execute(f"UPDATE {db.companies_table()} SET last_scraped_at=? WHERE id=?",
                         (db.now(), r["id"]))
        total_new += new; total_seen += seen; total_closed += closed; total_skipped += skipped
        skip_note = f", {skipped} skipped" if skipped else ""
        print(f"   {r['name']:<28} {len(postings):>4} live  (+{new} new, {closed} closed{skip_note})", flush=True)
    tail = f" {total_skipped} skipped (no title)." if total_skipped else ""
    print(f"\nScrape done: {total_new} new, {total_seen} refreshed, {total_closed} closed.{tail}")
    _report_dropped(dropped0)


import re as _re
_SUFFIX = _re.compile(r"\b(inc|incorporated|corp|corporation|co|company|companies|ltd|limited|"
                      r"plc|llc|lp|group|holdings?|the|class\s*[abc]|\&\s*co)\b", _re.I)
# acronym / nickname -> the full name it should fold into (so 'AEP' matches 'American Electric Power')
_ALIASES = {"amd": "advanced micro devices", "aig": "american international group",
            "aep": "american electric power", "adp": "automatic data processing",
            "amwater": "american water works", "bd": "becton dickinson"}


def _norm_name(n: str) -> str:
    s = (n or "").lower().replace("&", " and ").replace(".", " ").replace(",", " ")
    s = s.replace("(", " ").replace(")", " ")
    s = _SUFFIX.sub(" ", s)
    s = _re.sub(r"[^a-z0-9 ]", " ", s)
    s = _re.sub(r"\s+", " ", s).strip()
    return _ALIASES.get(s, s)


def _match_existing(conn, name: str):
    """Find an already-registered company that means the same employer (suffix/acronym aware)."""
    key = _norm_name(name)
    for r in conn.execute("SELECT id, name FROM companies").fetchall():
        if _norm_name(r["name"]) == key:
            return r
    return None


def _name_from_url(url: str) -> str:
    """Best-effort company name from a careers host: jobs.ametek.com -> 'Ametek'."""
    from urllib.parse import urlparse
    host = urlparse(url if "://" in url else "https://" + url).netloc.lower()
    parts = host.split(".")
    junk = {"careers", "jobs", "job", "apply", "www", "search", "recruiting",
            "com", "net", "org", "io", "co", "us", "wd1", "wd2", "wd3", "wd5",
            "myworkdayjobs", "icims", "avature", "jibeapply", "taleo", "tbe",
            "phe", "oraclecloud", "sapsf", "greenhouse", "lever", "ashbyhq"}
    cand = [p for p in parts if p not in junk and not p.startswith("wd")]
    word = cand[0] if cand else (parts[0] if parts else "company")
    return word.replace("-", " ").title()


def cmd_seturl(a):
    """Set an EXISTING company's careers/jobs URL: auto-detect the ATS, save it, scrape now.
    The CLI form of the dashboard's per-company 'Resolve' button. Deliberately does NOT call
    db.init_db() (the shared multi-user corpus already exists and its single-user SCHEMA re-init
    fails there) — it only connects, so it is safe in the shared-corpus deployment. Prints JSON."""
    import json
    from . import resolve, ats
    dropped0 = db.dropped_fields()
    cid = int(a.company_id)
    url = (a.url or "").strip()
    if not url:
        print(json.dumps({"ok": False, "company_id": cid, "error": "no url"})); return
    try:
        hit = resolve.classify_url_deep(url)
    except Exception:
        hit = None
    atype = token = None
    postings = []
    if hit and hit[0] != "workday_host":
        atype, token = hit
        try:
            postings = ats.fetch(atype, token)
        except Exception:
            postings = []
    if len(postings) < 3 and atype != "web":
        try:
            from . import webscrape
            rj = webscrape.scrape_careers(url)
        except Exception:
            rj = []
        if len(rj) >= 3:
            atype, token, postings = "web", url, rj
    # Every write below names db.companies_table(): `companies` is a read-only compat VIEW
    # in postgres mode, and the same literal 'companies' under sqlite.
    ct = db.companies_table()
    if not postings:
        with db.connect() as conn:
            conn.execute(f"UPDATE {ct} SET careers_url=? WHERE id=?", (url, cid))
        print(json.dumps({"ok": True, "company_id": cid, "jobs": 0,
              "message": "Saved the link, but couldn't extract jobs (iframed or bot-blocked)."}))
        return
    with db.connect() as conn:
        conn.execute(f"UPDATE {ct} SET ats_type=?, ats_token=?, careers_url=?, "
                     "discover_status='found' WHERE id=?", (atype, token, url, cid))
    new = skipped = 0
    with db.connect() as conn:
        ids = set()
        for p in postings:
            if p.get("ats_job_id") is None:
                continue
            st = db.upsert_posting(conn, cid, p)
            ids.add(str(p["ats_job_id"])); new += st == "new"; skipped += st == "skipped"
        db.deactivate_missing(conn, cid, ids)
        conn.execute(f"UPDATE {ct} SET last_scraped_at=? WHERE id=?", (db.now(), cid))
    # This verb's stdout is parsed as JSON by the dashboard's per-company Resolve button,
    # so the loss report goes IN the object, never printed beside it. Both keys are omitted
    # when there is nothing to report, which is always the case in sqlite mode — the
    # emitted JSON there is byte-identical to before.
    out = {"ok": True, "company_id": cid, "atype": atype, "token": token,
           "jobs": len(postings), "new": new,
           "message": "detected %s -> scraped %d jobs (%d new)" % (atype, len(postings), new)}
    if skipped:
        out["skipped"] = skipped
    dropped = _dropped_since(dropped0)
    if dropped:
        out["dropped"] = dropped
    print(json.dumps(out))


def cmd_add_url(a):
    """Paste any careers URL(s): auto-detect the ATS, register the company, scrape it now."""
    db.init_db()
    dropped0 = db.dropped_fields()
    urls = list(a.url or [])
    if a.file:
        with open(a.file, encoding="utf-8") as f:
            urls += [ln.strip() for ln in f if ln.strip() and not ln.startswith("#")]
    if not urls:
        print("!! give at least one --url or a --file", file=sys.stderr); sys.exit(1)

    ok = unmatched = 0
    for url in urls:
        try:
            hit = resolve.classify_url_deep(url)
        except Exception as e:
            hit = None
            print(f"   ?? {url[:60]} -> probe error: {str(e)[:50]}", flush=True)
        if not hit or hit[0] == "workday_host":
            # Universal fallback: render the page in a real browser and scrape DOM + JSON.
            if not a.no_render:
                print(f"   .. {url[:60]}  no ATS detected — trying headless render…", flush=True)
                try:
                    from . import webscrape
                    rj = webscrape.scrape_careers(url)
                except Exception:
                    rj = []
                if len(rj) >= 3:
                    hit = ("web", url)
                else:
                    unmatched += 1
                    print(f"   -- {url[:64]}  (couldn't extract jobs even with render)", flush=True)
                    continue
            else:
                unmatched += 1
                print(f"   -- {url[:64]}  (platform not recognized)", flush=True)
                continue
        atype, token = hit
        # For path-based ATSes the company is the token slug, not the host (jobs.lever.co/bhhc).
        if a.name:
            name = a.name
        elif atype in ("lever", "greenhouse", "ashby", "smartrecruiters", "workable"):
            name = token.split("/")[0].replace("-", " ").title()
        else:
            name = _name_from_url(url)
        with db.connect() as conn:
            existing = _match_existing(conn, name)  # avoid duplicate rows for already-seeded companies
            if existing:
                cid = existing["id"]
                # WRITE -> base table (`companies` is a read-only view in postgres mode).
                conn.execute(f"UPDATE {db.companies_table()} SET ats_type=?, ats_token=?, careers_url=?, "
                             "discover_status='found' WHERE id=?", (atype, token, url, cid))
                name = existing["name"]
            else:
                cid = db.upsert_company(conn, name, ats_type=atype, ats_token=token,
                                        careers_url=url, discover_status="found",
                                        source_list="pasted")
        # scrape immediately
        try:
            postings = ats.fetch(atype, token)
        except Exception as e:
            print(f"   !! {name} [{atype}] fetch failed: {str(e)[:50]}", flush=True)
            postings = []
        # Detected a platform but it yielded nothing (false match / JS-only tenant) → render.
        if len(postings) == 0 and atype != "web" and not a.no_render:
            print(f"   .. {name} [{atype}] returned 0 — falling back to headless render…", flush=True)
            try:
                from . import webscrape
                rj = webscrape.scrape_careers(url)
            except Exception:
                rj = []
            if len(rj) >= 3:
                atype, token, postings = "web", url, rj
                with db.connect() as conn:
                    conn.execute(f"UPDATE {db.companies_table()} SET ats_type='web', ats_token=? WHERE id=?",
                                 (url, cid))
        new = seen = skipped = 0
        with db.connect() as conn:
            ids = set()
            for p in postings:
                if p.get("ats_job_id") is None:
                    continue
                st = db.upsert_posting(conn, cid, p)
                ids.add(str(p["ats_job_id"])); new += st == "new"; seen += st == "seen"
                skipped += st == "skipped"   # postgres: title is NOT NULL — see cmd_scrape
            db.deactivate_missing(conn, cid, ids)
            conn.execute(f"UPDATE {db.companies_table()} SET last_scraped_at=? WHERE id=?",
                         (db.now(), cid))
        ok += 1
        skip_note = f", {skipped} skipped" if skipped else ""
        print(f"   OK {name:<22} [{atype}] {len(postings):>4} jobs (+{new} new{skip_note})", flush=True)
    print(f"\nadd-url done: {ok} scraped, {unmatched} unrecognized.")
    _report_dropped(dropped0)


def cmd_enrich(a):
    db.init_db()
    try:
        done, skipped = enrich.enrich_missing(limit=a.limit, refresh=a.refresh)
        print(f"Enriched {done} companies ({skipped} skipped).")
    except RuntimeError as e:
        print(f"!! {e}", file=sys.stderr)
        sys.exit(1)


def cmd_set_manual(a):
    db.init_db()
    with db.connect() as conn:
        row = conn.execute("SELECT id FROM companies WHERE name = ?", (a.company,)).fetchone()
        if not row:
            print(f"!! no company named {a.company!r}", file=sys.stderr); sys.exit(1)
        pos = a.positives.split(";") if a.positives else None
        neg = a.negatives.split(";") if a.negatives else None
        db.save_manual_reputation(conn, row["id"], about=a.about, positives=pos,
                                  negatives=neg, score=a.score, note=a.note)
        # A self-assignment: it changes no value, it only touches the row. Kept because it
        # is existing behaviour (and in postgres it bumps career_companies.updated_at via
        # any row-touch trigger), but it must name the base table — an UPDATE against the
        # read-only compat view would abort the whole set-manual transaction.
        conn.execute(f"UPDATE {db.companies_table()} SET discover_status = discover_status WHERE id=?",
                     (row["id"],))
    print(f"Manual reputation saved for {a.company} (overrides AI).")


def cmd_import_manual(a):
    """CSV columns: company, score, about, positives, negatives, note  (positives/negatives ';'-joined)."""
    db.init_db()
    n = 0
    with db.connect() as conn, open(a.csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            c = conn.execute("SELECT id FROM companies WHERE name = ?", (row["company"],)).fetchone()
            if not c:
                print(f"   skip (unknown): {row['company']}"); continue
            db.save_manual_reputation(
                conn, c["id"],
                about=row.get("about") or None,
                positives=(row["positives"].split(";") if row.get("positives") else None),
                negatives=(row["negatives"].split(";") if row.get("negatives") else None),
                score=int(row["score"]) if row.get("score") else None,
                note=row.get("note") or None,
            )
            n += 1
    print(f"Imported manual reputation for {n} companies.")


def cmd_match(_):
    db.init_db()
    n = match.rescore_all()
    print(f"Scored {n} active postings against career_db (keyword).")


def cmd_score(a):
    db.init_db()
    from . import score
    try:
        done, skipped = score.score_batch(limit=a.limit, rescore=a.rescore,
                                          min_keyword=a.min_keyword or 0, workers=a.workers,
                                          days=getattr(a, "days", None),
                                          first_seen_days=getattr(a, "first_seen_days", None))
        print(f"AI-scored {done} postings ({skipped} skipped).")
    except RuntimeError as e:
        print(f"!! {e}", file=sys.stderr); sys.exit(1)


def cmd_apply(a):
    db.init_db()
    from . import generate
    try:
        res = generate.generate_for(a.job, include_oshal=bool(getattr(a, "oshal", False)))
        print(f"Generated in {res['dir']}:\n  {res['resume_ats']}\n  {res['resume_premium']}\n  {res['cover']}")
    except Exception as e:
        print(f"!! {e}", file=sys.stderr); sys.exit(1)


def _top_distinct_hits(conn, limit, us_only=True):
    """Top jobs by AI fit (fallback keyword), deduped by company+title, US-preferred."""
    import re
    # Reads the `postings` compat VIEW, not the base table: ai_fit_score / fit_score /
    # status are per-user columns and RLS is what scopes them to the caller. `p.active=1`
    # is correct against the view (097 exposes active::int).
    # The tiebreak needs NULLS LAST — SQLite ranks NULL fit_score last under DESC, Postgres
    # ranks it first, which would float unscored jobs above scored ones inside every
    # ai_fit_score tie.
    rows = conn.execute(
        f"""SELECT p.id, c.name comp, p.title, p.location, p.ai_fit_score, p.fit_score, p.status
           FROM postings p JOIN companies c ON c.id=p.company_id
           WHERE p.active=1 AND COALESCE(p.ai_fit_score, p.fit_score, 0) > 0
           ORDER BY COALESCE(p.ai_fit_score,-1) DESC, p.fit_score DESC{_nulls_last()}""").fetchall()
    US = re.compile(r"United States|USA|US-|, [A-Z]{2}\b|Remote|Atlanta|Virginia|Texas|Colorado|"
                    r"California|New York|Austin|Denver|Dallas|Houston|Washington|Florida|Georgia", re.I)
    seen, per, picks = set(), {}, []
    for r in rows:
        if us_only and r["location"] and not US.search(r["location"]):
            continue
        key = (r["comp"], re.sub(r"[^a-z]", "", (r["title"] or "").lower())[:24])
        if key in seen or per.get(r["comp"], 0) >= 2:
            continue
        seen.add(key); per[r["comp"]] = per.get(r["comp"], 0) + 1
        picks.append(dict(r))
        if len(picks) >= limit:
            break
    return picks


def cmd_auto(a):
    """One command: rank everything vs your resume, then auto-generate the top hits."""
    from . import match, score, generate
    db.init_db()
    print("1/3  keyword-ranking all jobs vs your profile...", flush=True)
    match.rescore_all()
    print(f"2/3  AI-scoring the top {a.score} in-lane jobs against your resume...", flush=True)
    try:
        done, _ = score.score_batch(limit=a.score, min_keyword=a.min_keyword)
        print(f"     scored {done}.", flush=True)
    except RuntimeError as e:
        print(f"     !! scoring skipped: {e}", flush=True)
    print(f"3/3  generating resume + cover for the top {a.generate} distinct hits...", flush=True)
    with db.connect() as conn:
        picks = _top_distinct_hits(conn, a.generate, us_only=not a.global_ok)
    for p in picks:
        if p["status"] == "generated":
            print(f"     (have) {p['comp']} — {p['title'][:44]}", flush=True); continue
        try:
            generate.generate_for(p["id"])
            print(f"     OK   {p['comp']} — {p['title'][:44]}", flush=True)
        except Exception as e:
            print(f"     !!   {p['comp']} — {p['title'][:40]}: {str(e)[:60]}", flush=True)
    print("\nDone. Open the dashboard — downloads are in the list (sort by AI fit).")


def cmd_descriptions(a):
    db.init_db()
    from . import descriptions
    filled, attempted = descriptions.backfill(limit=a.limit, min_keyword=a.min_keyword or 0, company=a.company)
    print(f"Fetched {filled} clean descriptions (of {attempted} attempted).")


def cmd_dashboard(a):
    from . import dashboard
    print(f"Dashboard at http://{a.host}:{a.port}  (Ctrl+C to stop)")
    dashboard.run(host=a.host, port=a.port, open_browser=not a.no_browser)


def cmd_run(a):
    from . import runner
    runner.run_batch(daily_budget=a.daily_budget, per_run=a.per_run, do_scrape=not a.no_scrape)


def cmd_status(a):
    from . import runner
    print(runner.write_report(a.daily_budget))


def cmd_export(a):
    with db.connect() as conn:
        sql = """SELECT cv.name, cv.score AS company_score, cv.reputation_source, p.title, p.location,
                        p.remote, p.fit_score, p.url, p.posted_at
                 FROM postings p JOIN company_view cv ON cv.id = p.company_id
                 WHERE p.active = 1"""
        args = []
        if a.min_fit:
            sql += " AND COALESCE(p.fit_score,0) >= ?"; args.append(a.min_fit)
        if a.min_score:
            sql += " AND COALESCE(cv.score,0) >= ?"; args.append(a.min_score)
        # NULLS LAST was already explicit here and is valid in both engines. Only the final
        # name tiebreak needed the collation pin (SQLite BINARY vs the cluster's en_US.utf8).
        sql += f" ORDER BY p.fit_score DESC NULLS LAST, cv.score DESC NULLS LAST, cv.name{_bin()}"
        rows = conn.execute(sql, args).fetchall()

    out = open(a.out, "w", encoding="utf-8", newline="") if a.out else sys.stdout
    if a.format == "csv":
        w = csv.writer(out)
        w.writerow(["company", "company_score", "rep_source", "title", "location", "remote", "fit", "url", "posted"])
        for r in rows:
            w.writerow([r["name"], r["company_score"], r["reputation_source"], r["title"],
                        r["location"], r["remote"], r["fit_score"], r["url"], r["posted_at"]])
    else:
        print(f"# Open roles ({len(rows)})\n", file=out)
        cur = None
        for r in rows:
            if r["name"] != cur:
                cur = r["name"]
                cs = f" — company score {r['company_score']}" if r["company_score"] is not None else ""
                print(f"\n## {cur}{cs} ({r['reputation_source']})", file=out)
            fit = f"[fit {r['fit_score']}] " if r["fit_score"] is not None else ""
            loc = f" · {r['location']}" if r["location"] else ""
            print(f"- {fit}**{r['title']}**{loc} — {r['url']}", file=out)
    if a.out:
        out.close()
        print(f"Wrote {len(rows)} rows to {a.out}")


def cmd_geocode(a):
    db.init_db()
    # state / lat / lon are OBJECTIVE columns on the shared corpus row, so these counts read
    # the base table via db.read_postings_table() — the `postings` compat view would drag
    # two RLS-filtered joins across 1.4M rows to answer a question that has nothing to do
    # with the user. `active` is a real BOOLEAN there, hence _yes().
    pt, yes = db.read_postings_table(), _yes()
    with db.connect() as conn:
        n = db.backfill_geo(conn, limit=a.limit)
        conn.commit()
        cities = conn.execute(f"SELECT COUNT(*) c FROM {pt} WHERE active={yes} AND lat IS NOT NULL").fetchone()["c"]
        total = conn.execute(f"SELECT COUNT(*) c FROM {pt} WHERE active={yes} AND state IS NOT NULL").fetchone()["c"]
    print(f"Geocoded {n} rows. {cities:,}/{total:,} state-tagged active postings now have a city point.")


def cmd_stats(_):
    # Every figure here is about the SHARED corpus, so the posting counts read the base
    # table rather than the per-user compat view (same numbers — RLS makes the view's joins
    # at most 1:1 — without the two joins).
    pt, ct, yes = db.read_postings_table(), db.companies_table(), _yes()
    # Postgres accepts a bare `name` beside COUNT(*) only when the GROUP BY key is the
    # PRIMARY KEY of a base table; `companies` is a VIEW there and carries no key, so
    # `GROUP BY c.id` alone raises `column "c.name" must appear in the GROUP BY clause`.
    # id is unique in both engines, so adding name to the key merges no groups and splits
    # none — the result is identical, it is only the proof of functional dependence that
    # Postgres needs spelled out.
    grp = "c.id, c.name" if config.POSTGRES else "c.id"
    with db.connect() as conn:
        comp = conn.execute("SELECT COUNT(*) n FROM companies").fetchone()["n"]
        withats = conn.execute("SELECT COUNT(*) n FROM companies WHERE ats_type IS NOT NULL").fetchone()["n"]
        active = conn.execute(f"SELECT COUNT(*) n FROM {pt} WHERE active={yes}").fetchone()["n"]
        enriched = conn.execute("SELECT COUNT(*) n FROM company_reputation WHERE ai_score IS NOT NULL OR manual_score IS NOT NULL").fetchone()["n"]
        by_ats = conn.execute(
            "SELECT ats_type, COUNT(*) n FROM companies WHERE ats_type IS NOT NULL GROUP BY ats_type ORDER BY n DESC"
        ).fetchall()
        top = conn.execute(
            f"""SELECT name, COUNT(*) n FROM {pt} p JOIN {ct} c ON c.id=p.company_id
               WHERE active={yes} GROUP BY {grp} ORDER BY n DESC LIMIT 8"""
        ).fetchall()
    print(f"Companies:        {comp}  (ATS resolved: {withats})")
    print(f"Active postings:  {active}")
    print(f"Reputation rows:  {enriched}")
    print("By ATS:           " + ", ".join(f"{r['ats_type']}={r['n']}" for r in by_ats))
    if top:
        print("Most openings:    " + ", ".join(f"{r['name']}({r['n']})" for r in top))


def build_parser():
    p = argparse.ArgumentParser(prog="jobhunter", description="Scrape corporate ATS feeds into a job database.")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init").set_defaults(func=cmd_init)

    s = sub.add_parser("seed"); s.add_argument("--list", required=True,
        help="dow30|sp500|nasdaq100|fortune_best|govcon|midsize|bigtech|curated|all (any key in seeds/lists.json)")
    s.set_defaults(func=cmd_seed)

    s = sub.add_parser("discover"); s.add_argument("--company"); s.add_argument("--all-missing", action="store_true")
    s.add_argument("--limit", type=int); s.add_argument("--workers", type=int, default=16)
    s.set_defaults(func=cmd_discover)

    s = sub.add_parser("scrape"); s.add_argument("--company"); s.add_argument("--list"); s.add_argument("--all", action="store_true")
    s.add_argument("--limit", type=int); s.set_defaults(func=cmd_scrape)

    s = sub.add_parser("add-url", help="paste any careers URL(s): auto-detect ATS, register, scrape now")
    s.add_argument("--url", action="append", help="careers URL (repeatable)")
    s.add_argument("--file", help="text file of careers URLs, one per line")
    s.add_argument("--name", help="force a company name (else inferred from the host)")
    s.add_argument("--no-render", action="store_true", help="skip the headless-render fallback")
    s.set_defaults(func=cmd_add_url)

    s = sub.add_parser("seturl", help="set an existing company's careers URL: detect ATS + scrape now (JSON)")
    s.add_argument("--company-id", required=True)
    s.add_argument("--url", required=True)
    s.set_defaults(func=cmd_seturl)

    s = sub.add_parser("enrich"); s.add_argument("--missing", action="store_true"); s.add_argument("--refresh", action="store_true")
    s.add_argument("--limit", type=int); s.set_defaults(func=cmd_enrich)

    s = sub.add_parser("set-manual"); s.add_argument("--company", required=True); s.add_argument("--score", type=int)
    s.add_argument("--about"); s.add_argument("--positives"); s.add_argument("--negatives"); s.add_argument("--note")
    s.set_defaults(func=cmd_set_manual)

    s = sub.add_parser("import-manual"); s.add_argument("--csv", required=True); s.set_defaults(func=cmd_import_manual)

    sub.add_parser("match").set_defaults(func=cmd_match)

    s = sub.add_parser("score", help="AI fit-score + salary estimate over the DB")
    s.add_argument("--limit", type=int); s.add_argument("--rescore", action="store_true")
    s.add_argument("--min-keyword", type=int, help="only score jobs with keyword fit >= N")
    s.add_argument("--days", type=int, help="only score postings from the last N days (posted_date; often null — see --first-seen-days)")
    s.add_argument("--first-seen-days", type=int,
                   help="only score jobs FIRST SEEN in the last N days — the reliable new-jobs gate for incremental runs (first_seen_at is always stamped; posted_date is not)")
    s.add_argument("--workers", type=int, default=8, help="parallel scoring workers")
    s.set_defaults(func=cmd_score)

    s = sub.add_parser("apply", help="generate tailored resume+cover PDF for a job id")
    s.add_argument("--job", type=int, required=True)
    s.add_argument("--oshal", action="store_true", help="include the OSHAL / open-source section (opt-in)")
    s.set_defaults(func=cmd_apply)

    s = sub.add_parser("auto", help="rank all jobs vs your resume, then auto-generate the top hits")
    s.add_argument("--score", type=int, default=250, help="how many top in-lane jobs to AI-score")
    s.add_argument("--generate", type=int, default=12, help="how many top distinct hits to build resumes for")
    s.add_argument("--min-keyword", type=int, default=45, help="only score jobs with keyword fit >= N")
    s.add_argument("--global-ok", action="store_true", help="include non-US locations")
    s.set_defaults(func=cmd_auto)

    s = sub.add_parser("descriptions", help="fetch clean job descriptions (+listed salary) for top jobs")
    s.add_argument("--limit", type=int, default=500); s.add_argument("--min-keyword", type=int, default=40)
    s.add_argument("--company"); s.set_defaults(func=cmd_descriptions)

    s = sub.add_parser("dashboard", help="launch the local web dashboard")
    s.add_argument("--host", default="127.0.0.1"); s.add_argument("--port", type=int, default=5000)
    s.add_argument("--no-browser", action="store_true"); s.set_defaults(func=cmd_dashboard)

    s = sub.add_parser("run", help="slow-roll bot: Google a batch of careers URLs within quota, scrape, report")
    s.add_argument("--daily-budget", type=int, default=100)
    s.add_argument("--per-run", type=int, help="companies per invocation (default: daily_budget/24)")
    s.add_argument("--no-scrape", action="store_true")
    s.set_defaults(func=cmd_run)

    s = sub.add_parser("status", help="print the discovery status report")
    s.add_argument("--daily-budget", type=int, default=100); s.set_defaults(func=cmd_status)

    s = sub.add_parser("export"); s.add_argument("--format", choices=["md", "csv"], default="md")
    s.add_argument("--out"); s.add_argument("--min-fit", type=int); s.add_argument("--min-score", type=int)
    s.set_defaults(func=cmd_export)

    s = sub.add_parser("geocode", help="backfill parsed state + city lat/lon for the map")
    s.add_argument("--limit", type=int); s.set_defaults(func=cmd_geocode)

    sub.add_parser("stats").set_defaults(func=cmd_stats)
    return p


def main(argv=None):
    try:  # keep nice typography on Windows consoles
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
