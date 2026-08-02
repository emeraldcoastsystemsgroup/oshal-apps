"""Local web dashboard: browse/filter scored jobs, promote, and generate applications.

    python -m jobhunter dashboard        # opens http://127.0.0.1:5000
"""
from __future__ import annotations
import json
import os
import re
import datetime
import webbrowser
from pathlib import Path

from flask import Flask, render_template, request, redirect, url_for, abort, send_file, flash, jsonify

from . import db, generate, config, profile, gaps as gapmod, interview_bank

# ── Recruiter tracker config ─────────────────────────────────────────────────
# Resume variants the tracker can link to. Paths are resolved relative to the
# Jobs-2026 folder (config.ROOT is .../job-hunter, so .parent is Jobs 2026).
_OUTREACH_DIR = config.ROOT.parent / "_Recruiter Outreach"
# Resume filenames are user-specific: JOBHUNTER_RESUME_PREFIX names YOUR files
# (e.g. "Jane_Doe" → Jane_Doe_Resume_Headhunter.pdf). Default is a neutral prefix.
_RESUME_PREFIX = os.environ.get("JOBHUNTER_RESUME_PREFIX", "My")
RESUMES = [
    ("Headhunter (broad) — PDF",  _OUTREACH_DIR / f"{_RESUME_PREFIX}_Resume_Headhunter.pdf"),
    ("Headhunter (broad) — DOCX", _OUTREACH_DIR / f"{_RESUME_PREFIX}_Resume_Headhunter.docx"),
    ("TQM / Triage",              config.ROOT.parent / "_archive" / "reference-docs" / f"{_RESUME_PREFIX}_Resume_TQM_Triage.docx"),
    ("General SAP",               config.ROOT.parent / "_archive" / "reference-docs" / f"{_RESUME_PREFIX}_Resume.docx"),
]
RESUME_PATHS = {label: path for label, path in RESUMES}
RESUME_LABELS = [label for label, _ in RESUMES]
RECRUITER_STATUSES = ["To contact", "Contacted", "Replied", "Call scheduled",
                      "Submitted me", "On radar", "Dead"]
RECRUITER_CHANNELS = ["", "LinkedIn", "Email", "Profile", "Referral", "Phone"]
RECRUITER_BUCKETS = ["Cleared / GovTech", "Exec Search", "SAP / ERP", "Staffing", "Other"]
# Editable columns accepted from the row form (whitelist → safe UPDATE).
_RECRUITER_FIELDS = ["firm", "bucket", "website", "contact_name", "contact_role",
                     "contact_link", "resume_label", "channel", "status",
                     "date_contacted", "followup_date", "next_action", "notes"]


# ── SQL dialect (JOBHUNTER_STORE=sqlite | postgres) ──────────────────────────
# Every query on this page was written against SQLite. Under Postgres a handful of them
# are not merely non-portable — they are SILENTLY WRONG, which is worse than a syntax
# error because the page still renders and the numbers are just different. The helpers
# below are the only place that knows the difference, and each one names the trap it
# closes so nobody "simplifies" it back out.
#
# Everything structural comes from the storage layer, not from here: physical table names
# (db.corpus_table() / db.companies_table() / db.read_postings_table()), the RLS-scoped
# `postings` and `companies` compatibility views (migration 097), the acting identity
# (db.require_sub()) and every per-user write (db.user_set()). Nothing in this file
# re-implements any of that, and nothing in this file filters by user_sub: on the per-user
# tables FORCE ROW LEVEL SECURITY is the boundary, and a hand-written WHERE would read as
# if it were.


def _ilike() -> str:
    """The operator meaning "contains, ignoring case" in the active backend.

    SQLite's LIKE folds ASCII case, so the board's search box has always matched "DevOps"
    for `devops`. Postgres' LIKE does NOT fold case, so the identical filter would quietly
    return a fraction of the rows — a search that looks like it works. ILIKE is the
    equivalent. (SECTOR_CASE and the High-Win expression wrap their column in LOWER()
    already, so those legitimately stay LIKE in both backends.)"""
    return "ILIKE" if config.POSTGRES else "LIKE"


def _int(expr: str) -> str:
    """Truncating cast to integer — what SQLite's `CAST(x AS INT)` does.

    Postgres' CAST(numeric AS int) ROUNDS: verified on the live cluster,
    `CAST(99.7 AS INT)` is 100 there and 99 in SQLite. Every grade on this board is capped
    at 100, so rounding would invent a perfect P(land) out of a 99.7 and disagree with
    land_prob_py() / high_win_py(), which use Python's truncating int()."""
    return f"trunc({expr})::int" if config.POSTGRES else f"CAST({expr} AS INT)"


def _least(*args: str) -> str:
    """SQLite's two-argument scalar MIN(). In Postgres MIN is ONLY an aggregate — the
    literal SQL fails with `function min(integer, integer) does not exist`."""
    return ("LEAST" if config.POSTGRES else "MIN") + "(" + ", ".join(args) + ")"


def _greatest(*args: str) -> str:
    """SQLite's two-argument scalar MAX(); see _least()."""
    return ("GREATEST" if config.POSTGRES else "MAX") + "(" + ", ".join(args) + ")"


def _age_days(col: str) -> str:
    """Fractional days between now and an ISO date/timestamp column, in UTC.

    SQLite: JULIANDAY('now') - JULIANDAY(col). Postgres has no julianday(). The compat
    view hands these columns back as ISO TEXT, so they are parsed back to a timestamp and
    pinned to UTC: `::timestamptz` alone would read a bare 'YYYY-MM-DD' as midnight in the
    SESSION time zone, which is not what JULIANDAY('2026-07-01') meant. Cast to float8
    (not numeric) so the decay below is float arithmetic, as it was in SQLite."""
    if config.POSTGRES:
        return (f"(EXTRACT(EPOCH FROM (now() - ({col}::timestamp AT TIME ZONE 'UTC')))"
                "::double precision / 86400.0)")
    return f"(JULIANDAY('now') - JULIANDAY({col}))"


def _pow(base: str, exp: str) -> str:
    """x ** y. Postgres spells it power(); SQLite's math extension spells it POW()."""
    return f"{'power' if config.POSTGRES else 'POW'}({base}, {exp})"


def _posted_within(days: int, col: str = "p.posted_date") -> str:
    """Predicate: `col` is set and no older than `days` days, on a UTC midnight boundary.

    `days` is interpolated rather than bound, and that is deliberate: it is an int at every
    call site (an isdigit()-guarded request arg, or the literal 7 on /insights), and the
    two dialects need genuinely different values — SQLite's date() modifier is the STRING
    '-7 days', Postgres needs a number to subtract from a date. One bound parameter cannot
    serve both without lying about one of them. int() is the injection guard.

    The bound is rendered as 'YYYY-MM-DD' TEXT because that is the shape the compat view
    exposes posted_date in, and for that shape lexicographic order IS chronological order —
    so this compares text to text instead of casting 1.4M rows back to a date."""
    n = int(days)
    if config.POSTGRES:
        return (f"{col} IS NOT NULL AND {col} >= "
                f"to_char((now() AT TIME ZONE 'UTC')::date - {n}, 'YYYY-MM-DD')")
    return f"{col} IS NOT NULL AND {col} >= date('now', '-{n} days')"


def _nocase(col: str) -> str:
    """A case-insensitive A-Z ordering key. SQLite has the NOCASE collation; Postgres does
    not have it at all (`collation "nocase" ... does not exist`) and its default collation
    is case-sensitive, so the by-company lists would order differently between backends."""
    return f"LOWER({col})" if config.POSTGRES else f"{col} COLLATE NOCASE"


def _desc(col: str) -> str:
    """`col DESC` with SQLite's NULL placement. SQLite sorts NULLs LAST in DESC; Postgres
    sorts them FIRST, which would float every not-yet-AI-scored role to the top of the
    list instead of the bottom. Only needed for a raw nullable column — the COALESCE'd
    and explicitly-NULLS-LAST sort keys below already agree in both backends."""
    return f"{col} DESC NULLS LAST" if config.POSTGRES else f"{col} DESC"


def _asc(col: str, text: bool = False) -> str:
    """An ASC ordering key that produces the same row order in both backends.

    Two differences, both visible in a rendered list: SQLite sorts NULLs FIRST in ASC and
    Postgres sorts them LAST; and SQLite compares TEXT byte-by-byte (BINARY) while Postgres
    uses the database's linguistic collation, which folds case and ignores punctuation on
    the first pass. COLLATE "C" is Postgres' byte-order collation and is always available.

    text=True MUST NOT be used in a `SELECT DISTINCT ... ORDER BY` — Postgres requires every
    ORDER BY expression there to appear in the select list, and `col COLLATE "C"` is a
    different expression from `col` (verified: InvalidColumnReference). Use the plain form
    there and accept the database's collation for the label order."""
    if not config.POSTGRES:
        return col
    return f'{col} COLLATE "C" NULLS FIRST' if text else f"{col} NULLS FIRST"


def _active(alias: str = "") -> str:
    """The `active` truth test against the PHYSICAL postings table.

    career_postings.active is a real BOOLEAN and `active = 1` is a hard type error against
    it. Reads that go through the compat view keep saying `active=1` (the view casts it
    back to 0/1); this helper is for the objective-only counts that read
    db.read_postings_table() directly so they do not drag two RLS-filtered joins across
    1.4M rows for columns they never look at."""
    p = f"{alias}." if alias else ""
    # Spelled `active=1` (no spaces) so the SQLite text this emits is byte-identical to
    # what these queries carried before the port — the parity harness diffs SQL strings.
    return f"{p}active" if config.POSTGRES else f"{p}active=1"


def _grp(cols: str, pg_extra: str) -> str:
    """A GROUP BY list, plus the columns Postgres additionally demands.

    SQLite lets you SELECT a bare column that is not in the GROUP BY. Postgres allows it
    only when the grouping key is a real TABLE's primary key — never through a view, and
    `companies` / `postings` are views here. So `GROUP BY c.id` + `SELECT c.name` raises
    `column "c.name" must appear in the GROUP BY clause`. The extra columns are all
    functionally dependent on a key already in the list, so the groups are identical."""
    return f"{cols}, {pg_extra}" if config.POSTGRES else cols


def _recruiters_table() -> str:
    """The recruiter tracker. In postgres mode career_user_recruiter_firms is per-user and
    under FORCE RLS, which is why no statement in this file adds `WHERE user_sub = ...`:
    the policy already scopes SELECT/UPDATE/DELETE to the acting user, and a redundant
    WHERE would read like the isolation boundary it is not."""
    return "career_user_recruiter_firms" if config.POSTGRES else "recruiter_firms"


def _assessments_table() -> str:
    """Interview -> skill reassessments. Per-user and FORCE-RLS'd in postgres mode; see
    _recruiters_table() for why nothing here filters on user_sub."""
    return "career_user_interview_assessments" if config.POSTGRES else "interview_assessments"


def _ts_text(col: str, alias: str) -> str:
    """Project a timestamp column as the ISO-8601 TEXT db.now() writes.

    The templates slice these — `{{ (a.at or '')[:16] }}` — and psycopg2 hands back a
    datetime, which raises TypeError on a slice. The format matches
    `datetime.now(timezone.utc).isoformat(timespec="seconds")` exactly, which is the same
    shape migration 097 uses for every timestamp on the postings/companies views."""
    if not config.POSTGRES:
        return f"{col} AS {alias}"
    return (f"to_char({col} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS') || '+00:00' "
            f"AS {alias}")


def _assessment_cols() -> str:
    """The interview-assessment projection the /skills templates read.

    Spelled out instead of `SELECT *` for two reasons: the Postgres table carries
    user_sub / tenant_id columns the SQLite one does not, and `at` has to be projected as
    TEXT (see _ts_text) because skill_one.html slices it. In SQLite mode this is exactly
    the eight columns the table has, so `SELECT *` and this list are the same query."""
    return f"id, {_ts_text('at', 'at')}, company, role, transcript, answers, result, finalized"


def fmt_salary(row) -> str:
    smin, smax, cur, per = row["salary_min"], row["salary_max"], row["salary_currency"] or "USD", row["salary_period"] or "year"
    if not smin and not smax:
        return "—"
    sym = {"USD": "$", "EUR": "€", "GBP": "£"}.get(cur, "")
    def k(v):
        return f"{sym}{v/1000:.0f}K" if v and v >= 1000 else f"{sym}{v:.0f}"
    rng = f"{k(smin)}–{k(smax)}" if smin and smax else k(smin or smax)
    suffix = "/hr" if per == "hour" else ""
    flag = {"ai_estimated": " *", "heuristic": " ~"}.get(row["salary_source"], "")
    return f"{rng}{suffix}{flag}"


def fmt_date(v) -> str:
    if not v:
        return "—"
    s = str(v)
    import re
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)   # ISO -> YYYY-MM-DD
    if m:
        return m.group(0)
    return s[:18]  # "June 2, 2026" / "Posted 5 Days Ago" as-is


def field_pack() -> str:
    """The fields almost every application form asks for, as paste-ready
    'Label: value' lines. the user's own contact details from the career DB — the
    one-click 'copy my details' button drops these on the clipboard so he can fill
    an ATS form fast. Constant across jobs, so pages embed it once."""
    p = profile.load().get("profile", {})
    rows = [("Name", p.get("name")), ("Email", p.get("email")),
            ("Phone", p.get("phone")), ("Location", p.get("location")),
            ("LinkedIn", p.get("linkedin")),
            ("Work authorization", p.get("citizenship")),
            ("Security clearance", p.get("clearance")),
            ("Education", p.get("credential"))]
    return "\n".join(f"{k}: {v}" for k, v in rows if v)


# Shared sector bucket (free-text company.industry -> clean sector). Order matters (top wins).
SECTOR_CASE = """CASE
    WHEN LOWER(c.industry) LIKE '%gov%' OR LOWER(c.industry) LIKE '%defense%'
      OR LOWER(c.industry) LIKE '%national security%' OR LOWER(c.industry) LIKE '%autonomy%'
      OR LOWER(c.industry) LIKE '%aerospace%' OR LOWER(c.industry) LIKE '%intelligence%'
      OR LOWER(c.industry) LIKE '%maritime%' THEN 'Government / Defense'
    WHEN LOWER(c.industry) LIKE '%fintech%' OR LOWER(c.industry) LIKE '%financial%'
      OR LOWER(c.industry) LIKE '%bank%' OR LOWER(c.industry) LIKE '%payment%'
      OR LOWER(c.industry) LIKE '%insurance%' THEN 'Fintech / Financial'
    WHEN LOWER(c.industry) LIKE '%semiconductor%' THEN 'Semiconductors'
    WHEN LOWER(c.industry) LIKE '%sap%' OR LOWER(c.industry) LIKE '%erp%' THEN 'SAP / Enterprise'
    WHEN LOWER(c.industry) LIKE '%security%' OR LOWER(c.industry) LIKE '%protection%'
      OR LOWER(c.industry) LIKE '%cyber%' THEN 'Cybersecurity'
    WHEN LOWER(c.industry) LIKE '%ai%' OR LOWER(c.industry) LIKE '% ml%'
      OR LOWER(c.industry) LIKE '%agent%' THEN 'AI / ML'
    WHEN LOWER(c.industry) LIKE '%data%' OR LOWER(c.industry) LIKE '%cloud%'
      OR LOWER(c.industry) LIKE '%database%' OR LOWER(c.industry) LIKE '%observ%'
      OR LOWER(c.industry) LIKE '%infra%' OR LOWER(c.industry) LIKE '%storage%'
      OR LOWER(c.industry) LIKE '%platform%' THEN 'Data / Cloud Infra'
    WHEN LOWER(c.industry) LIKE '%big tech%' OR LOWER(c.industry) LIKE '%social%'
      OR LOWER(c.industry) LIKE '%search%' THEN 'Big Tech'
    WHEN LOWER(c.industry) LIKE '%health%' OR LOWER(c.industry) LIKE '%medical%'
      OR LOWER(c.industry) LIKE '%bio%' OR LOWER(c.industry) LIKE '%pharma%' THEN 'Healthcare / Biotech'
    WHEN LOWER(c.industry) LIKE '%retail%' OR LOWER(c.industry) LIKE '%consumer%'
      OR LOWER(c.industry) LIKE '%marketplace%' OR LOWER(c.industry) LIKE '%commerce%'
      OR LOWER(c.industry) LIKE '%cannabis%' OR LOWER(c.industry) LIKE '%beverage%'
      OR LOWER(c.industry) LIKE '%food%' THEN 'Consumer / Retail'
    WHEN LOWER(c.industry) LIKE '%saas%' OR LOWER(c.industry) LIKE '%productivity%'
      OR LOWER(c.industry) LIKE '%work mgmt%' THEN 'SaaS / Productivity'
    WHEN c.industry IS NULL THEN 'Untagged'
    ELSE 'Other' END"""

# Shared scoring SQL (same formulas the list view uses) so other pages stay consistent.
# Functions, not constants, because the spelling depends on the backend selected at run
# time — and because /  (the list) used to carry a hand-copied second edition of both
# formulas. Two copies of a scoring rule is one copy too many; the list now calls these.


def land_prob_sql() -> str:
    """P(land) = fit × recency-decay (4-week half-life, 25% floor) × referral boost.
    A stale 100%-match scores below a fresh good-match-with-a-contact.
    Keep in sync with land_prob_py(), which the /report page uses for the same number."""
    decay = _pow("0.5", f"{_age_days('COALESCE(p.posted_date, p.first_seen_at)')}/28.0")
    return _int(_least(
        "100.0",
        "COALESCE(p.ai_fit_score, p.fit_score, 0) "
        f"* {_greatest('0.25', decay)} "
        "* (1.0 + 0.35 * COALESCE(c.referral, 0))"))


def high_win_sql() -> str:
    """High-Win cross-over = fit + clearance + AI/DevOps + gov/defense sector (where the
    job hunt, your skills, clearance, and the small-business set-aside leverage all stack).
    Keep in sync with high_win_py(). Every LIKE here is fed by LOWER(), so it is
    case-correct in both backends without ILIKE."""
    return _int(_least(
        "100",
        "COALESCE(p.ai_fit_score, p.fit_score, 0) "
        "+ CASE WHEN LOWER(p.title) LIKE '%clear%' OR LOWER(p.title) LIKE '%secret%' "
        "OR LOWER(p.title) LIKE '%ts/sci%' OR LOWER(p.title) LIKE '%polygraph%' THEN 12 ELSE 0 END "
        "+ CASE WHEN LOWER(p.title) LIKE '%ai%' OR LOWER(p.title) LIKE '%devops%' OR LOWER(p.title) LIKE '%sre%' "
        "OR LOWER(p.title) LIKE '%site reliab%' OR LOWER(p.title) LIKE '%platform%' OR LOWER(p.title) LIKE '%automation%' "
        "OR LOWER(p.title) LIKE '%machine learning%' THEN 8 ELSE 0 END "
        "+ CASE WHEN LOWER(COALESCE(c.industry,'')) LIKE '%gov%' OR LOWER(COALESCE(c.industry,'')) LIKE '%defense%' "
        "OR LOWER(COALESCE(c.industry,'')) LIKE '%national security%' OR LOWER(COALESCE(c.industry,'')) LIKE '%aerospace%' "
        "OR LOWER(COALESCE(c.industry,'')) LIKE '%autonomy%' OR LOWER(COALESCE(c.industry,'')) LIKE '%intelligence%' THEN 12 ELSE 0 END"))

# Python equivalents of LAND_PROB_SQL / HIGH_WIN_SQL — used by the report so the two
# grades are computed only for the ~5/company rows actually shown, not every matching
# row in SQL (which made the report query ~20x slower). Keep these in sync with the SQL.
_HW_CLEAR = ("clear", "secret", "ts/sci", "polygraph")
_HW_TECH = ("ai", "devops", "sre", "site reliab", "platform", "automation", "machine learning")
_HW_SECTOR = ("gov", "defense", "national security", "aerospace", "autonomy", "intelligence")


def _days_since(*vals) -> int:
    for v in vals:
        if not v:
            continue
        try:
            return max(0, (datetime.date.today() - datetime.date.fromisoformat(str(v)[:10])).days)
        except Exception:
            continue
    return 9999


def land_prob_py(fit, posted_date, first_seen, referral) -> int:
    fit = fit or 0
    days = _days_since(posted_date, first_seen)
    return int(min(100.0, fit * max(0.25, 0.5 ** (days / 28.0)) * (1.0 + 0.35 * (referral or 0))))


def high_win_py(fit, title, industry) -> int:
    t, ind, b = (title or "").lower(), (industry or "").lower(), (fit or 0)
    if any(k in t for k in _HW_CLEAR):
        b += 12
    if any(k in t for k in _HW_TECH):
        b += 8
    if any(k in ind for k in _HW_SECTOR):
        b += 12
    return int(min(100, b))


def create_app() -> Flask:
    app = Flask(__name__, template_folder=str(Path(__file__).parent / "templates"),
                static_folder=str(Path(__file__).parent / "static"))
    app.secret_key = "jobhunter-local"
    app.jinja_env.globals["fmt_salary"] = fmt_salary
    app.jinja_env.globals["fmt_date"] = fmt_date
    app.jinja_env.globals["field_pack"] = field_pack

    @app.route("/")
    def index():
        q = request.args.get("q", "").strip()
        min_score = int(request.args.get("min_score") or 0)
        company = request.args.get("company", "").strip()
        remote = request.args.get("remote", "")
        status = request.args.get("status", "")
        source = request.args.get("source", "").strip()
        sort = request.args.get("sort", "ai")
        LAND_PROB = land_prob_sql()
        HIGH_WIN = high_win_sql()
        order = {"ai": "COALESCE(p.ai_fit_score,-1) DESC, COALESCE(p.fit_score,0) DESC",
                 "prob": f"{LAND_PROB} DESC, COALESCE(p.ai_fit_score,0) DESC",
                 "highwin": f"{HIGH_WIN} DESC, {LAND_PROB} DESC",
                 "keyword": "COALESCE(p.fit_score,0) DESC",
                 "salary": "COALESCE(p.salary_max,0) DESC",
                 # ai_fit_score is nullable here (unlike every other key, which is either
                 # COALESCE'd or already carries an explicit NULLS LAST), so it needs
                 # SQLite's NULL placement spelled out for Postgres.
                 "company": f"c.name ASC, {_desc('p.ai_fit_score')}",
                 "posted": "p.posted_date DESC NULLS LAST",
                 "recent": "p.first_seen_at DESC",
                 "generated": "p.generated_at DESC NULLS LAST",
                 "applied": "p.applied_at DESC NULLS LAST"}.get(sort, "COALESCE(p.ai_fit_score,-1) DESC")

        where, args = ["p.active = 1"], []
        # Default to the user's target lane; ?lane=all shows everything.
        lane = request.args.get("lane", "target")
        if lane != "all":
            where.append("COALESCE(p.target_role,0) = 1")
        if q:
            where.append(f"(p.title {_ilike()} ? OR p.description {_ilike()} ?)")
            args += [f"%{q}%", f"%{q}%"]
        if min_score:
            where.append("COALESCE(p.ai_fit_score, p.fit_score, 0) >= ?"); args.append(min_score)
        if company:
            where.append(f"c.name {_ilike()} ?"); args.append(f"%{company}%")
        if remote in ("0", "1"):
            where.append("p.remote = ?"); args.append(int(remote))
        state = request.args.get("state", "").strip().upper()
        if state:
            where.append("p.state = ?"); args.append(state)
        city = request.args.get("city", "").strip().lower()
        if city:
            where.append("p.city = ?"); args.append(city)
        # loc=none → the "Location not listed" island: rows with neither a city nor a state.
        if request.args.get("loc", "") == "none":
            where.append("p.lat IS NULL AND p.state IS NULL")
        days = request.args.get("days", "")
        if days.isdigit():
            where.append(_posted_within(int(days)))
        min_pay = request.args.get("min_pay", "")
        if min_pay.isdigit():
            where.append("COALESCE(p.salary_max, p.salary_min, 0) >= ?"); args.append(int(min_pay))
        jtype = request.args.get("type", "").strip()
        if jtype:
            where.append("p.job_type = ?"); args.append(jtype)
        if status:
            where.append("p.status = ?"); args.append(status)
        if source:
            where.append(f"c.source_lists {_ilike()} ?"); args.append(f'%\"{source}\"%')
        sector = request.args.get("sector", "").strip()
        if sector:
            where.append(f"{SECTOR_CASE} = ?"); args.append(sector)

        where_sql = " AND ".join(where)
        page = max(1, int(request.args.get("page") or 1))
        per = 200
        # Join company_reputation directly (cheap) — NOT company_view, whose per-company
        # open_roles subquery makes this query crawl on 100k+ rows.
        sql = f"""SELECT p.*, c.name AS company, COALESCE(c.referral,0) AS referral,
                         {LAND_PROB} AS land_prob, {HIGH_WIN} AS high_win,
                         COALESCE(r.manual_score, r.ai_score) AS company_score,
                         CASE WHEN r.manual_score IS NOT NULL THEN 'manual'
                              WHEN r.ai_score IS NOT NULL THEN 'ai' ELSE 'none' END AS reputation_source
                  FROM postings p JOIN companies c ON c.id = p.company_id
                  LEFT JOIN company_reputation r ON r.company_id = c.id
                  WHERE {where_sql} ORDER BY {order} LIMIT {per} OFFSET {(page - 1) * per}"""
        with db.connect() as conn:
            rows = conn.execute(sql, args).fetchall()
            needs_join = "c." in where_sql
            mfrom = ("postings p JOIN companies c ON c.id = p.company_id" if needs_join else "postings p")
            matching = conn.execute(
                f"SELECT COUNT(*) n FROM {mfrom} WHERE {where_sql}", args).fetchone()["n"]
            # `total` and `companies` ask only about the SHARED corpus, so they read the
            # physical table: in postgres mode the compat view would drag two RLS-filtered
            # joins across 1.4M rows to answer a question about none of their columns.
            # `scored` and `promoted` are this user's judgement and this user's pipeline —
            # they stay on the view, which is where RLS scopes them to the acting user.
            phys, ctab = db.read_postings_table(), db.companies_table()
            stats = {
                "total": conn.execute(f"SELECT COUNT(*) n FROM {phys} WHERE {_active()}").fetchone()["n"],
                "scored": conn.execute("SELECT COUNT(*) n FROM postings WHERE active=1 AND ai_fit_score IS NOT NULL").fetchone()["n"],
                "promoted": conn.execute("SELECT COUNT(*) n FROM postings WHERE status IN ('promoted','generated')").fetchone()["n"],
                "companies": conn.execute(f"SELECT COUNT(DISTINCT company_id) n FROM {phys} WHERE {_active()}").fetchone()["n"],
            }
            companies = conn.execute(
                f"""SELECT c.name, COUNT(*) n FROM {phys} p JOIN {ctab} c ON c.id=p.company_id
                   WHERE {_active('p')} GROUP BY {_grp('c.id', 'c.name')} ORDER BY c.name""").fetchall()
        pages = max(1, (matching + per - 1) // per)
        return render_template("dashboard.html", rows=rows, stats=stats, args=request.args,
                               matching=matching, page=page, pages=pages, per=per, companies=companies)

    @app.route("/sources")
    def sources():
        with db.connect() as conn:
            # Connector health is a fact about the corpus, not about one user's pipeline —
            # physical table, no per-user join. (`companies` is read through the compat
            # view so last_scraped_at arrives as the ISO text the template prints.)
            counts = dict(conn.execute(
                f"SELECT company_id, COUNT(*) n FROM {db.read_postings_table()} "
                f"WHERE {_active()} GROUP BY company_id").fetchall())
            comps = conn.execute(
                """SELECT id, name, ats_type, ats_token, careers_url, discover_status, last_scraped_at
                   FROM companies""").fetchall()
        # per-platform rollup
        plat = {}
        broken, unresolved = [], 0
        for c in comps:
            jobs = counts.get(c["id"], 0)
            if c["ats_type"]:
                p = plat.setdefault(c["ats_type"], {"companies": 0, "jobs": 0, "broken": 0})
                p["companies"] += 1; p["jobs"] += jobs
                if jobs == 0:
                    p["broken"] += 1
                    broken.append(dict(c))  # connector assigned but pulled nothing
            else:
                unresolved += 1
        platforms = sorted(([k, v] for k, v in plat.items()), key=lambda kv: -kv[1]["jobs"])
        total_jobs = sum(v["jobs"] for _, v in platforms)
        return render_template("sources.html", platforms=platforms, total_jobs=total_jobs,
                               broken=sorted(broken, key=lambda x: x["name"]),
                               unresolved=unresolved, n_companies=len(comps))

    @app.route("/companies")
    def companies_dir():
        show = request.args.get("show", "all")   # all | data | nodata
        q = request.args.get("q", "").strip()
        conds, args = [], []
        if q:
            conds.append(f"c.name {_ilike()} ?"); args.append(f"%{q}%")
        if show == "data":
            conds.append("COALESCE(j.n,0) > 0")
        elif show == "nodata":
            conds.append("COALESCE(j.n,0) = 0")
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        with db.connect() as conn:
            # counts computed once (indexed) then joined — fast on 700+ companies
            rows = conn.execute(
                f"""SELECT c.id, c.name, c.careers_url, c.homepage, c.ats_type, c.discover_status,
                          COALESCE(j.n,0) AS jobs
                   FROM companies c
                   LEFT JOIN (SELECT company_id, COUNT(*) n FROM {db.read_postings_table()}
                              WHERE {_active()} GROUP BY company_id) j
                     ON j.company_id = c.id
                   {where} ORDER BY jobs DESC, c.name""", args).fetchall()
        return render_template("companies.html", rows=rows, show=show, q=q,
                               n_total=len(rows), n_data=sum(1 for r in rows if r["jobs"]))

    @app.route("/insights")
    def insights():
        SECTOR = SECTOR_CASE
        with db.connect() as conn:
            hero = conn.execute(f"""
                SELECT COUNT(*) inlane,
                       SUM(CASE WHEN p.ai_fit_score>=70 THEN 1 ELSE 0 END) fit70,
                       SUM(CASE WHEN p.ai_fit_score>=80 THEN 1 ELSE 0 END) fit80,
                       SUM(CASE WHEN {_posted_within(7)} THEN 1 ELSE 0 END) fresh,
                       {_int("AVG(CASE WHEN p.ai_fit_score>=70 AND p.salary_max>0 THEN p.salary_max END)")} avg_pay
                FROM postings p WHERE p.active=1 AND p.target_role=1""").fetchone()
            companies = conn.execute(
                f"SELECT COUNT(DISTINCT company_id) n FROM {db.read_postings_table()} "
                f"WHERE {_active()}").fetchone()["n"]
            # HAVING names COUNT(*) rather than the `roles` alias: SQLite resolves an
            # output alias in HAVING, Postgres does not (`column "roles" does not exist`).
            # Spelled this way it is the same predicate in both, with no branch.
            sectors = conn.execute(f"""
                SELECT {SECTOR} sector, COUNT(*) roles,
                       COUNT(DISTINCT c.id) cos,
                       SUM(CASE WHEN p.ai_fit_score>=70 THEN 1 ELSE 0 END) fit70,
                       {_int("AVG(CASE WHEN p.ai_fit_score IS NOT NULL THEN p.ai_fit_score END)")} avg_fit,
                       {_int("AVG(CASE WHEN p.salary_max>0 THEN p.salary_max END)")} avg_pay
                FROM postings p JOIN companies c ON c.id=p.company_id
                WHERE p.active=1 AND p.target_role=1 AND c.industry IS NOT NULL
                GROUP BY sector HAVING COUNT(*)>0 ORDER BY fit70 DESC, avg_fit DESC""").fetchall()
            # top company per sector (by your 70%+ count)
            topco = {}
            for r in conn.execute(f"""
                SELECT {SECTOR} sector, c.name, COUNT(*) n FROM postings p JOIN companies c ON c.id=p.company_id
                WHERE p.active=1 AND p.target_role=1 AND p.ai_fit_score>=70 AND c.industry IS NOT NULL
                GROUP BY {_grp('sector, c.id', 'c.name')} ORDER BY n DESC"""):
                topco.setdefault(r["sector"], r["name"])
            # /insights runs a NARROWER High-Win than the board's high_win_sql(): AI fit
            # only (no keyword-fit fallback) and a shorter keyword set. That is a real
            # difference, not drift, so it is not folded into the shared helper.
            HW = _int(_least(
                "100",
                "COALESCE(p.ai_fit_score,0) "
                "+ CASE WHEN LOWER(p.title) LIKE '%clear%' OR LOWER(p.title) LIKE '%secret%' OR LOWER(p.title) LIKE '%ts/sci%' THEN 12 ELSE 0 END "
                "+ CASE WHEN LOWER(p.title) LIKE '%ai%' OR LOWER(p.title) LIKE '%devops%' OR LOWER(p.title) LIKE '%sre%' OR LOWER(p.title) LIKE '%platform%' OR LOWER(p.title) LIKE '%automation%' THEN 8 ELSE 0 END "
                "+ CASE WHEN LOWER(COALESCE(c.industry,'')) LIKE '%gov%' OR LOWER(COALESCE(c.industry,'')) LIKE '%defense%' OR LOWER(COALESCE(c.industry,'')) LIKE '%national security%' OR LOWER(COALESCE(c.industry,'')) LIKE '%aerospace%' OR LOWER(COALESCE(c.industry,'')) LIKE '%autonomy%' OR LOWER(COALESCE(c.industry,'')) LIKE '%intelligence%' THEN 12 ELSE 0 END"))
            highwins = conn.execute(f"""
                SELECT {HW} hw, p.id, p.ai_fit_score fit, c.name comp, p.title, p.salary_max sm
                FROM postings p JOIN companies c ON c.id=p.company_id
                WHERE p.active=1 AND p.target_role=1 AND p.ai_fit_score>=72
                  AND (LOWER(COALESCE(c.industry,'')) LIKE '%gov%' OR LOWER(COALESCE(c.industry,'')) LIKE '%defense%'
                       OR LOWER(COALESCE(c.industry,'')) LIKE '%national security%' OR LOWER(COALESCE(c.industry,'')) LIKE '%aerospace%'
                       OR LOWER(COALESCE(c.industry,'')) LIKE '%autonomy%' OR LOWER(COALESCE(c.industry,'')) LIKE '%intelligence%')
                ORDER BY hw DESC, p.ai_fit_score DESC LIMIT 12""").fetchall()
        return render_template("insights.html", hero=hero, companies=companies,
                               sectors=sectors, topco=topco, highwins=highwins)

    @app.route("/report")
    def report():
        """By-company opportunity report (a by-company export, served as a page).

        Rules: in-lane roles only (target_role=1), real AI fit > min (default 50),
        grouped by company A–Z, deduped by title, top N per company (default 5).
        A company appears only if it has at least one qualifying role.
        The score shown is `ai_fit_score` — the LLM fit judgment, the number to MAX
        when tailoring; each row lists the AI-flagged gaps to close to raise it.
        """
        min_score = int(request.args.get("min") or 50)
        per_co = max(1, int(request.args.get("n") or 5))
        with db.connect() as conn:
            # Cheap fetch (no per-row P(land)/High-Win in SQL — those are computed in
            # Python below only for the rows actually displayed).
            rows = conn.execute(
                f"""SELECT p.id, p.title, p.location, p.remote, p.job_type, p.url, p.status,
                          p.ai_fit_score AS score, p.fit_score AS kw, p.ai_fit_gaps,
                          p.resume_path, p.cover_path, p.generated_at,
                          p.salary_min, p.salary_max, p.salary_currency,
                          p.salary_period, p.salary_source, p.posted_date, p.posted_at, p.first_seen_at,
                          COALESCE(r.manual_score, r.ai_score) AS company_score,
                          c.name AS company, COALESCE(c.referral,0) AS referral, c.industry
                   FROM postings p JOIN companies c ON c.id = p.company_id
                   LEFT JOIN company_reputation r ON r.company_id = c.id
                   WHERE p.target_role = 1 AND p.ai_fit_score > ? AND p.active = 1
                   ORDER BY {_nocase('c.name')}, p.ai_fit_score DESC, p.id""",
                (min_score,)).fetchall()
        # Group by company, dedupe by normalized title, cap at per_co per company.
        groups, cur_name, cur_jobs, seen = [], None, [], set()
        def flush():
            if cur_name and cur_jobs:
                groups.append({"company": cur_name, "jobs": cur_jobs,
                               "top": cur_jobs[0]["row"]["score"]})
        for r in rows:
            if r["company"] != cur_name:
                flush(); cur_name, cur_jobs, seen = r["company"], [], set()
            key = (r["title"] or "").strip().lower()
            if key in seen or len(cur_jobs) >= per_co:
                continue
            seen.add(key)
            try:
                gaps = json.loads(r["ai_fit_gaps"]) if r["ai_fit_gaps"] else []
            except Exception:
                gaps = []
            cur_jobs.append({"row": r, "salary": fmt_salary(r),
                             "posted": fmt_date(r["posted_date"]), "gaps": gaps[:3],
                             "land_prob": land_prob_py(r["score"], r["posted_date"], r["first_seen_at"], r["referral"]),
                             "high_win": high_win_py(r["score"], r["title"], r["industry"])})
        flush()
        total_jobs = sum(len(g["jobs"]) for g in groups)
        return render_template("report.html", groups=groups, n_companies=len(groups),
                               total_jobs=total_jobs, min_score=min_score, per_co=per_co)

    @app.route("/ready")
    def ready():
        """Ready-to-apply worklist: only roles that already have a generated résumé,
        at >= min pay, grouped by company, each with downloads + apply link + the
        company's in-house recruiter and drafted intro. This is the 'go apply' view
        of what the prime run produced."""
        a = request.args
        min_pay = int(a.get("min_pay") or 200000)
        min_fit = int(a.get("min_fit") or 70)
        only_rec = a.get("rec") == "1"
        ANN = ("CASE WHEN p.salary_period='hour' THEN COALESCE(p.salary_max,p.salary_min,0)*2080 "
               "ELSE COALESCE(p.salary_max,p.salary_min,0) END")
        where = ["p.resume_path IS NOT NULL", "p.active = 1", "p.ai_fit_score >= ?", f"{ANN} >= ?"]
        args = [min_fit, min_pay]
        if a.get("company", "").strip():
            where.append(f"c.name {_ilike()} ?"); args.append(f"%{a.get('company').strip()}%")
        if a.get("q", "").strip():
            where.append(f"(p.title {_ilike()} ? OR p.description {_ilike()} ?)")
            args += [f"%{a.get('q').strip()}%", f"%{a.get('q').strip()}%"]
        if a.get("days", "").isdigit():
            where.append(_posted_within(int(a.get("days"))))
        if a.get("remote", "") in ("0", "1"):
            where.append("p.remote = ?"); args.append(int(a.get("remote")))
        if a.get("type", "").strip():
            where.append("p.job_type = ?"); args.append(a.get("type").strip())
        if a.get("state", "").strip():
            where.append("p.state = ?"); args.append(a.get("state").strip().upper())
        if a.get("status", "").strip():
            where.append("p.status = ?"); args.append(a.get("status").strip())
        else:
            where.append("p.status != 'applied'")          # hide applied unless asked
        where_sql = " AND ".join(where)
        with db.connect() as conn:
            rows = conn.execute(
                f"""SELECT p.id, p.title, p.url, p.ai_fit_score AS fit, p.status, p.outreach_sent_at,
                          p.resume_path, p.cover_path, p.generated_at, p.posted_date, p.posted_at,
                          p.salary_min, p.salary_max, p.salary_currency, p.salary_period, p.salary_source,
                          {ANN} AS annual, c.name AS company
                   FROM postings p JOIN companies c ON c.id = p.company_id
                   WHERE {where_sql}
                   ORDER BY {_nocase('c.name')}, p.ai_fit_score DESC, p.id""",
                args).fetchall()
            recs = conn.execute(
                f"""SELECT firm, contact_name, contact_role, contact_link, status, notes, sort_order
                   FROM {_recruiters_table()}""").fetchall()
        norm = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())
        recmap = {}
        for r in recs:
            k = norm(r["firm"])
            if not k:
                continue
            rank = (r["status"] == "Dead", r["sort_order"] or 100)
            if k not in recmap or rank < recmap[k][0]:
                recmap[k] = (rank, r)
        groups, cur, cj = [], None, []
        def flush():
            if cur and cj:
                rec = recmap.get(norm(cur))
                groups.append({"company": cur, "jobs": cj, "rec": rec[1] if rec else None})
        for row in rows:
            if row["company"] != cur:
                flush(); cur, cj = row["company"], []
            rp = row["resume_path"] or ""
            prem, one = rp.replace("Resume_ATS", "Resume_Premium"), rp.replace("Resume_ATS", "Resume_1page")
            ex = lambda p: bool(p) and Path(p).exists()
            cj.append({"row": row, "salary": fmt_salary(row), "pay": int(row["annual"] or 0),
                       "prem": prem, "one": one,
                       "has_ats": ex(rp), "has_prem": ex(prem), "has_1pg": ex(one),
                       "has_cover": ex(row["cover_path"])})
        flush()
        if only_rec:
            groups = [g for g in groups if g["rec"]]
        total = sum(len(g["jobs"]) for g in groups)
        return render_template("ready.html", groups=groups, n_companies=len(groups),
                               total=total, min_pay=min_pay, min_fit=min_fit,
                               only_rec=only_rec, args=request.args)

    @app.route("/progress")
    def progress():
        """My Progress: the funnel from sourced -> qualified -> résumé -> applied ->
        interview -> offer (and dead), over the in-lane ≥$200K board, plus the live
        pipeline (everything you've applied to / interviewing) with stage controls."""
        ANN = ("CASE WHEN p.salary_period='hour' THEN COALESCE(p.salary_max,p.salary_min,0)*2080 "
               "ELSE COALESCE(p.salary_max,p.salary_min,0) END")
        board = f"p.active=1 AND p.target_role=1 AND p.ai_fit_score>=70 AND {ANN}>=200000"
        with db.connect() as conn:
            def cnt(extra=""):
                return conn.execute(f"SELECT COUNT(*) FROM postings p WHERE {board} {extra}").fetchone()[0]
            sourced = conn.execute("SELECT COUNT(*) FROM postings WHERE active=1 AND target_role=1").fetchone()[0]
            stages = [
                ("Sourced (in-lane)", sourced, "#9aa6b6"),
                ("Qualified ≥70 / ≥$200K", cnt(), "#5b9bd5"),
                ("Résumé ready", cnt("AND p.resume_path IS NOT NULL"), "#2f8f4e"),
                ("Applied", cnt("AND p.status='applied'"), "#e0a44b"),
                ("Interview", cnt("AND p.status='interview'"), "#1f7a3d"),
                ("Offer", cnt("AND p.status='offer'"), "#16304F"),
            ]
            dead = cnt("AND p.status='dismissed'")
            rows = conn.execute(
                f"""SELECT p.id, c.name AS company, p.title, p.status, p.url, p.ai_fit_score AS fit
                    FROM postings p JOIN companies c ON c.id=p.company_id
                    WHERE {board} AND p.status IN ('applied','interview','offer')
                    ORDER BY CASE p.status WHEN 'offer' THEN 0 WHEN 'interview' THEN 1 ELSE 2 END,
                             {_nocase('c.name')}""").fetchall()
        applied = next(c for n, c, _ in stages if n == "Applied")
        interview = next(c for n, c, _ in stages if n == "Interview")
        offer = next(c for n, c, _ in stages if n == "Offer")
        conv = {
            "apply_rate": round(100 * applied / (stages[2][1] or 1)),     # résumé -> applied
            "intv_rate": round(100 * interview / (applied or 1)),         # applied -> interview
            "offer_rate": round(100 * offer / (interview or 1)),          # interview -> offer
        }
        return render_template("progress.html", stages=stages, dead=dead, rows=rows, conv=conv)

    @app.route("/skills")
    def skills():
        with db.connect() as conn:
            rows = conn.execute(
                f"SELECT id, {_ts_text('at', 'at')}, company, role, finalized "
                f"FROM {_assessments_table()} ORDER BY id DESC").fetchall()
        return render_template("skills.html", rows=rows)

    @app.route("/skills/assess", methods=["POST"])
    def skills_assess():
        from . import interview
        t = (request.form.get("transcript") or "").strip()
        if not t:
            flash("Record or paste an interview transcript first."); return redirect(url_for("skills"))
        company = request.form.get("company", "").strip()
        role = request.form.get("role", "").strip()
        try:
            res = interview.assess(t, company, role)
            aid = interview.save(t, company, role, res)
        except Exception as e:
            flash(f"Assessment failed: {e}"); return redirect(url_for("skills"))
        return redirect(url_for("skills_one", aid=aid))

    @app.route("/skills/<int:aid>")
    def skills_one(aid):
        with db.connect() as conn:
            row = conn.execute(
                f"SELECT {_assessment_cols()} FROM {_assessments_table()} WHERE id=?",
                (aid,)).fetchone()
        if not row:
            abort(404)
        try:
            res = json.loads(row["result"] or "{}")
        except Exception:
            res = {}
        return render_template("skill_one.html", a=row, r=res)

    @app.route("/skills/<int:aid>/finalize", methods=["POST"])
    def skills_finalize(aid):
        from . import interview
        with db.connect() as conn:
            row = conn.execute(
                f"SELECT {_assessment_cols()} FROM {_assessments_table()} WHERE id=?",
                (aid,)).fetchone()
        if not row:
            abort(404)
        answers = (request.form.get("answers") or "").strip()
        try:
            res = interview.assess(row["transcript"], row["company"], row["role"], answers=answers)
            interview.update(aid, res, answers)
        except Exception as e:
            flash(f"Finalize failed: {e}")
        return redirect(url_for("skills_one", aid=aid))

    @app.route("/companies/<int:cid>/seturl", methods=["POST"])
    def company_seturl(cid):
        """Paste the real careers/jobs URL for a company: auto-detect its ATS, save it,
        and scrape immediately. This is the in-UI version of `add-url`."""
        from . import resolve, ats, webscrape
        url = (request.form.get("url") or "").strip()
        back = redirect(request.form.get("back") or url_for("companies_dir", show="nodata"))
        if not url:
            flash("Enter a URL first."); return back
        with db.connect() as conn:
            row = conn.execute("SELECT name FROM companies WHERE id=?", (cid,)).fetchone()
        name = row["name"] if row else f"company {cid}"
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
        # No ATS, or a detected one that yielded nothing → render the page in a real browser.
        if len(postings) < 3 and atype != "web":
            try:
                rj = webscrape.scrape_careers(url)
            except Exception:
                rj = []
            if len(rj) >= 3:
                atype, token, postings = "web", url, rj
        # WRITES name the PHYSICAL table, never `companies`: in postgres mode that name is
        # the migration-097 compat VIEW, whose columns are expressions, so it is not
        # auto-updatable and an UPDATE against it fails outright.
        ctab = db.companies_table()
        if not postings:
            with db.connect() as conn:
                conn.execute(f"UPDATE {ctab} SET careers_url=? WHERE id=?", (url, cid))
            flash(f"{name}: saved the link, but I couldn't extract jobs even with a render "
                  f"(iframed or actively bot-blocked). Open it to browse directly.")
            return back
        with db.connect() as conn:
            conn.execute(f"UPDATE {ctab} SET ats_type=?, ats_token=?, careers_url=?, "
                         "discover_status='found' WHERE id=?", (atype, token, url, cid))
        new = 0
        with db.connect() as conn:
            ids = set()
            for p in postings:
                if p.get("ats_job_id") is None:
                    continue
                st = db.upsert_posting(conn, cid, p)
                ids.add(str(p["ats_job_id"])); new += st == "new"
            db.deactivate_missing(conn, cid, ids)
            conn.execute(f"UPDATE {ctab} SET last_scraped_at=? WHERE id=?", (db.now(), cid))
        flash(f"{name}: detected {atype} → scraped {len(postings)} jobs ({new} new). "
              f"They'll AI-score on the next pass.")
        return back

    @app.route("/map")
    def jobmap():
        from . import geo
        q = request.args.get("q", "").strip()
        company = request.args.get("company", "").strip()
        min_score = int(request.args.get("min_score") or 0)
        remote = request.args.get("remote", "")
        where, args = ["p.active = 1"], []
        # Mirror the list view's filters so they carry over from List → Map.
        # Default to the user's target lane (the list's default) and to the last 30 days of
        # postings — without a recency bound the map groups every active row and
        # renders thousands of markers, which stalls the browser and buries fresh jobs.
        lane = request.args.get("lane", "target")
        if lane != "all":
            where.append("COALESCE(p.target_role,0) = 1")
        days = request.args.get("days", "30")
        if days.isdigit() and int(days) > 0:
            where.append(_posted_within(int(days)))
        if q:
            where.append(f"(p.title {_ilike()} ? OR p.description {_ilike()} ?)")
            args += [f"%{q}%", f"%{q}%"]
        if company:
            where.append(f"c.name {_ilike()} ?"); args.append(f"%{company}%")
        if min_score:
            where.append("COALESCE(p.ai_fit_score,p.fit_score,0) >= ?"); args.append(min_score)
        if remote in ("0", "1"):
            where.append("p.remote = ?"); args.append(int(remote))
        state = request.args.get("state", "").strip().upper()
        if state:
            where.append("p.state = ?"); args.append(state)
        jtype = request.args.get("type", "").strip()
        if jtype:
            where.append("p.job_type = ?"); args.append(jtype)
        min_pay = request.args.get("min_pay", "")
        if min_pay.isdigit():
            where.append("COALESCE(p.salary_max, p.salary_min, 0) >= ?"); args.append(int(min_pay))
        where_sql = " AND ".join(where)
        with db.connect() as conn:
            # City-level points (rows we geocoded to a city centroid).
            # lat/lon join the GROUP BY under Postgres, which — unlike SQLite — refuses a
            # bare column in an aggregate query (`column "p.lat" must appear in the GROUP
            # BY clause`). They are the geocoded centroid OF (state, city), so they are
            # functionally dependent on the existing key and the groups do not change.
            cityrows = conn.execute(
                f"""SELECT p.city, p.state st, p.lat, p.lon, COUNT(*) n
                    FROM postings p JOIN companies c ON c.id=p.company_id
                    WHERE {where_sql} AND p.lat IS NOT NULL
                    GROUP BY {_grp('p.state, p.city', 'p.lat, p.lon')} ORDER BY n DESC""",
                args).fetchall()
            # State-level fallback for rows that have a state but no city centroid.
            staterows = conn.execute(
                f"""SELECT p.state st, COUNT(*) n
                    FROM postings p JOIN companies c ON c.id=p.company_id
                    WHERE {where_sql} AND p.state IS NOT NULL AND p.lat IS NULL
                    GROUP BY p.state""", args).fetchall()
            remote_n = conn.execute(
                f"""SELECT COUNT(*) n FROM postings p JOIN companies c ON c.id=p.company_id
                    WHERE {where_sql} AND p.remote=1""", args).fetchone()["n"]
            # Jobs with no city centroid AND no state can't be pinned anywhere — they'd
            # silently fall off the map. Surface them as "islands" in open water instead,
            # split by whether they're flagged remote (work-from-anywhere) or just unknown.
            fall = conn.execute(
                f"""SELECT SUM(CASE WHEN p.remote=1 THEN 1 ELSE 0 END) remote_n,
                           SUM(CASE WHEN COALESCE(p.remote,0)=0 THEN 1 ELSE 0 END) unknown_n
                    FROM postings p JOIN companies c ON c.id=p.company_id
                    WHERE {where_sql} AND p.lat IS NULL AND p.state IS NULL""", args).fetchone()
        points = [{"kind": "city", "st": r["st"], "city": r["city"],
                   "name": f"{r['city'].title()}, {r['st']}", "lat": r["lat"], "lon": r["lon"], "n": r["n"]}
                  for r in cityrows if r["lat"] is not None]
        for r in staterows:
            if r["st"] in geo.STATES:
                nm, lat, lon = geo.STATES[r["st"]]
                points.append({"kind": "state", "st": r["st"], "city": None,
                               "name": f"{nm} (no city)", "lat": lat, "lon": lon, "n": r["n"]})
        points.sort(key=lambda x: -x["n"])
        total = sum(p["n"] for p in points)
        n_cities = sum(1 for p in points if p["kind"] == "city")
        # Off-map islands in the Atlantic (open water, visible at the US zoom level).
        # kind="island" → styled distinctly client-side; "loc" carries the list-view filter.
        remote_island = (fall["remote_n"] or 0)
        unknown_island = (fall["unknown_n"] or 0)
        islands = []
        if remote_island:
            islands.append({"kind": "island", "loc": "remote", "st": None, "city": None,
                            "name": "🌐 Remote / work-from-anywhere", "lat": 28.5, "lon": -62.0,
                            "n": remote_island})
        if unknown_island:
            islands.append({"kind": "island", "loc": "none", "st": None, "city": None,
                            "name": "📍 Location not listed", "lat": 24.5, "lon": -62.0,
                            "n": unknown_island})
        return render_template("map.html", points=points, islands=islands, total=total,
                               n_cities=n_cities, remote_n=remote_n,
                               island_n=remote_island + unknown_island,
                               args=request.args, days=days)

    @app.route("/job/<int:pid>")
    def job(pid):
        with db.connect() as conn:
            row = conn.execute(
                """SELECT p.*, c.name AS company, c.industry, COALESCE(c.referral,0) AS referral, cv.score AS company_score,
                          cv.about, cv.positives, cv.negatives, cv.reputation_source
                   FROM postings p JOIN companies c ON c.id = p.company_id
                   LEFT JOIN company_view cv ON cv.id = c.id WHERE p.id = ?""", (pid,)).fetchone()
            # Interview prep: what this job/industry will actually ask (read-only — no write on a GET).
            #
            # The tagged question bank (interview_bank / interview_bank_tags / posting_tags)
            # is SQLite-only — migrations 095-097 gave it no Postgres home — so in postgres
            # mode there is nothing to match against. Calling it there raises UndefinedTable
            # and, because one failed statement aborts the entire Postgres transaction, it
            # would take the rest of this request down with it. The panel is already
            # optional in the template ({% if interview and interview.questions %}), so it
            # is omitted rather than faked. Restore it by giving the bank a migration and
            # porting interview_bank.py; nothing here invents a question list.
            interview = None if config.POSTGRES else (
                interview_bank.match(conn, pid, persist=False) if row else None)
        if not row:
            abort(404)
        def jl(s):
            try:
                return json.loads(s) if s else []
            except Exception:
                return []
        ctx = dict(matched=jl(row["ai_fit_matched"]), gaps=jl(row["ai_fit_gaps"]),
                   positives=jl(row["positives"]), negatives=jl(row["negatives"]),
                   recruiters=None, outreach=None, rec_source=None, rec_links=None,
                   interview=interview)
        # On-demand recruiter lookup (?recruiters=1) so we don't search on every page load.
        if request.args.get("recruiters"):
            from . import recruiters as rec
            res = rec.find_recruiters(row["company"], limit=8)
            ctx["recruiters"] = res["recruiters"]
            ctx["rec_source"] = res["source"]
            ctx["rec_links"] = res["links"]
            ctx["outreach"] = rec.draft_outreach(
                row["company"], row["title"],
                res["recruiters"][0]["name"] if res["recruiters"] else None)
        if request.args.get("frag"):
            return render_template("job_frag.html", j=row, frag=True, **ctx)
        return render_template("job.html", j=row, **ctx)

    @app.route("/company/<int:cid>/referral", methods=["POST"])
    def set_referral(cid):
        """Flag a warm contact at a company (0=none,1=weak,2=solid,3=strong) → boosts P(land)."""
        level = max(0, min(3, int(request.form.get("level") or 0)))
        with db.connect() as conn:
            # Physical table for the write; see company_seturl() — `companies` is a
            # non-updatable view in postgres mode.
            conn.execute(f"UPDATE {db.companies_table()} SET referral=? WHERE id=?", (level, cid))
            row = conn.execute("SELECT name FROM companies WHERE id=?", (cid,)).fetchone()
        flash(f"{row['name'] if row else 'Company'}: contact strength set to {level} — "
              f"P(land) boosted for all its roles.")
        return redirect(request.form.get("back") or url_for("index", sort="prob"))

    @app.route("/job/<int:pid>/<action>", methods=["POST"])
    def act(pid, action):
        if action in ("promote", "dismiss", "apply", "interview", "offer"):
            new = {"promote": "promoted", "dismiss": "dismissed", "apply": "applied",
                   "interview": "interview", "offer": "offer"}[action]
            with db.connect() as conn:
                db.set_status(conn, pid, new)
            flash(f"Marked {new}.")
        elif action in ("outreach", "outreach_undo"):
            with db.connect() as conn:
                db.set_outreach(conn, pid, action == "outreach")
            flash("Marked recruiter intro sent." if action == "outreach"
                  else "Cleared the intro-sent flag.")
        elif action == "generate":
            # Free-text first ENRICHES the career DB (durable), then the generator tailors
            # to THIS posting pulling from the enriched data — the posting drives tailoring,
            # not the free-text (which would otherwise hijack the headline).
            guidance = (request.form.get("guidance") or "").strip()
            is_frag = request.form.get("frag")
            include_oshal = bool(request.form.get("oshal"))   # opt-in: surface OSHAL / open-source work
            try:
                added = profile.augment(guidance) if guidance else None
                res = generate.generate_for(pid, include_oshal=include_oshal)
                try:                       # keep applications/INDEX.html (req# → file map) current
                    from . import appindex
                    appindex.build()
                except Exception:
                    pass
                changelog = (added or {}).get("changelog", [])
                if is_frag:
                    return jsonify(ok=True, dir=res["dir"], changelog=changelog)
                msg = f"Generated resume + cover letter{' (with OSHAL / open-source)' if include_oshal else ''} → {res['dir']}"
                if changelog:
                    msg += " · added to your profile: " + "; ".join(changelog[:6])
                flash(msg)
            except Exception as e:
                if is_frag:
                    return jsonify(ok=False, error=str(e))
                flash(f"Generation failed: {e}")
        back = request.form.get("back")
        return redirect(back or url_for("job", pid=pid))

    @app.route("/file")
    def file():
        path = Path(request.args.get("path", ""))
        appdir = (config.ROOT / "applications").resolve()
        if not str(path.resolve()).startswith(str(appdir)) or not path.exists():
            abort(404)
        return send_file(str(path))

    # ── Recruiter tracker tab ────────────────────────────────────────────────
    @app.route("/recruiters")
    def recruiters_page():
        bucket = request.args.get("bucket", "").strip()
        status = request.args.get("status", "").strip()
        where, args = [], []
        if bucket:
            where.append("bucket = ?"); args.append(bucket)
        if status:
            where.append("status = ?"); args.append(status)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        rf = _recruiters_table()
        with db.connect() as conn:
            # No `user_sub` predicate anywhere in this tab: in postgres mode
            # career_user_recruiter_firms is under FORCE ROW LEVEL SECURITY and the policy
            # scopes every SELECT/UPDATE/DELETE to the acting user. A hand-written WHERE
            # would be redundant and would read like the isolation boundary it is not.
            rows = conn.execute(
                f"SELECT * FROM {rf} {where_sql} "
                f"ORDER BY {_asc('sort_order')}, {_asc('firm', text=True)}", args).fetchall()
            counts = dict(conn.execute(
                f"SELECT status, COUNT(*) n FROM {rf} GROUP BY status").fetchall())
            # Plain _asc(): a SELECT DISTINCT cannot ORDER BY a collated form of a selected
            # column in Postgres (see _asc). NULL placement is matched; the residual is
            # that the label order follows the database collation rather than byte order,
            # which for this short controlled vocabulary is the same order.
            buckets = [r["bucket"] for r in conn.execute(
                f"SELECT DISTINCT bucket FROM {rf} ORDER BY {_asc('bucket')}").fetchall()]
        # which linked resume files actually exist on disk (for the open-link)
        resume_exists = {label: path.exists() for label, path in RESUMES}
        return render_template(
            "recruiters.html", rows=rows, counts=counts, buckets=buckets,
            total=sum(counts.values()), statuses=RECRUITER_STATUSES,
            channels=RECRUITER_CHANNELS, all_buckets=RECRUITER_BUCKETS,
            resume_labels=RESUME_LABELS, resume_exists=resume_exists,
            sel_bucket=bucket, sel_status=status)

    @app.route("/recruiters/add", methods=["POST"])
    def recruiters_add():
        firm = (request.form.get("firm") or "").strip()
        if not firm:
            flash("Enter a firm or recruiter name first.")
            return redirect(url_for("recruiters_page"))
        vals = (firm, (request.form.get("bucket") or "Other").strip(),
                (request.form.get("website") or "").strip(),
                (request.form.get("contact_name") or "").strip(),
                (request.form.get("contact_link") or "").strip(),
                "To contact", 200, db.now())
        cols = ("firm, bucket, website, contact_name, contact_link, status, "
                "sort_order, updated_at")
        with db.connect() as conn:
            if config.POSTGRES:
                # career_user_recruiter_firms.id is a plain BIGINT, not a sequence: 096
                # PRESERVED the SQLite ids on load rather than minting new ones, so the
                # next id has to be chosen here. MAX+1 is computed INSIDE the insert, so
                # it is one statement; RLS scopes that MAX to this user's own rows, so two
                # users never contend for the same number. If the same user double-submits,
                # the (user_sub, id) primary key rejects the loser — an error, not a
                # silently overwritten firm. user_sub is written explicitly because the RLS
                # WITH CHECK compares it to oshal.current_sub.
                conn.execute(
                    f"INSERT INTO {_recruiters_table()} (user_sub, id, {cols}) "
                    "SELECT ?, COALESCE(MAX(id), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ? "
                    f"FROM {_recruiters_table()}", (db.require_sub(), *vals))
            else:
                conn.execute(
                    f"INSERT INTO recruiter_firms ({cols}) VALUES (?,?,?,?,?,?,?,?)", vals)
        flash(f"Added {firm}.")
        return redirect(url_for("recruiters_page"))

    @app.route("/recruiters/<int:rid>", methods=["POST"])
    def recruiters_update(rid):
        sets, vals = [], []
        for f in _RECRUITER_FIELDS:
            if f in request.form:
                sets.append(f"{f}=?"); vals.append((request.form.get(f) or "").strip())
        if not sets:
            return redirect(url_for("recruiters_page"))
        sets.append("updated_at=?"); vals.append(db.now())
        vals.append(rid)
        with db.connect() as conn:
            conn.execute(
                f"UPDATE {_recruiters_table()} SET {', '.join(sets)} WHERE id=?", vals)
        flash("Saved.")
        return redirect(url_for("recruiters_page", bucket=request.args.get("bucket", ""),
                                status=request.args.get("status", "")))

    @app.route("/recruiters/<int:rid>/delete", methods=["POST"])
    def recruiters_delete(rid):
        with db.connect() as conn:
            conn.execute(f"DELETE FROM {_recruiters_table()} WHERE id=?", (rid,))
        flash("Removed.")
        return redirect(url_for("recruiters_page"))

    # ── Strengthen Your Background tab ───────────────────────────────────────
    @app.route("/strengthen")
    def strengthen():
        """Gap intelligence + a guided 'answer once' flow. Clusters every in-lane
        job's AI-flagged gaps into themes (how many jobs each costs you), then walks
        the highest-impact addressable themes one at a time. Each answer enriches the
        career DB (profile.augment), which the resume writer pulls from per job."""
        if not gapmod.is_scanned():
            gapmod.scan()
        themes, total = gapmod.themes_with_stats()
        addressable = [t for t in themes if t["addressable"]]
        structural = [t for t in themes if not t["addressable"] and t["n_jobs"] > 0]
        focus_key = request.args.get("focus", "").strip()
        focus = next((t for t in addressable if t["key"] == focus_key), None) if focus_key else None
        if not focus:
            nk = gapmod.next_open_key(themes)
            focus = next((t for t in addressable if t["key"] == nk), None) if nk else None
        answered = sum(1 for t in addressable if t["status"] == "answered")
        open_n = sum(1 for t in addressable if t["status"] == "open" and t["n_jobs"] > 0)
        return render_template("strengthen.html", addressable=addressable, structural=structural,
                               focus=focus, total=total, answered=answered, open_n=open_n,
                               n_addr=sum(1 for t in addressable if t["n_jobs"] > 0))

    @app.route("/strengthen/scan", methods=["POST"])
    def strengthen_scan():
        n = gapmod.scan()
        flash(f"Rescanned {n:,} in-lane jobs and regrouped their gaps.")
        return redirect(url_for("strengthen"))

    @app.route("/strengthen/answer", methods=["POST"])
    def strengthen_answer():
        key = request.form.get("key", "").strip()
        response = (request.form.get("response") or "").strip()
        if not key or not response:
            flash("Type your example before saving.")
            return redirect(url_for("strengthen", focus=key))
        gapmod.save_answer(key, response)
        msg = f"Saved your example for “{gapmod.title_of(key)}.”"
        # Merge the story into the career DB so future tailored resumes can pull it.
        # Prefix with the theme so the merger files it under the right skill area.
        try:
            added = profile.augment(f"{gapmod.title_of(key)}: {response}")
            cl = (added or {}).get("changelog", [])
            if cl:
                msg += " Added to your profile: " + "; ".join(cl[:6])
        except Exception as e:
            msg += f" (profile enrich skipped: {e})"
        flash(msg)
        nxt = gapmod.next_open_key()
        return redirect(url_for("strengthen", focus=nxt) if nxt else url_for("strengthen"))

    @app.route("/strengthen/skip", methods=["POST"])
    def strengthen_skip():
        key = request.form.get("key", "").strip()
        if key:
            gapmod.set_status(key, "skipped")
        nxt = gapmod.next_open_key()
        return redirect(url_for("strengthen", focus=nxt) if nxt else url_for("strengthen"))

    @app.route("/strengthen/reopen", methods=["POST"])
    def strengthen_reopen():
        key = request.form.get("key", "").strip()
        if key:
            gapmod.set_status(key, "open")
        return redirect(url_for("strengthen", focus=key))

    @app.route("/resume-file")
    def resume_file():
        """Serve a whitelisted resume variant by its label (safe: fixed dict only)."""
        path = RESUME_PATHS.get(request.args.get("name", ""))
        if not path or not path.exists():
            abort(404)
        return send_file(str(path))

    return app


def run(host="127.0.0.1", port=5000, open_browser=True):
    db.init_db()
    app = create_app()
    if open_browser:
        webbrowser.open(f"http://{host}:{port}")
    # threaded=True is required: browsers hold keep-alive connections open, and a
    # single-threaded dev server hangs behind them. SQLite reads are concurrent-safe.
    app.run(host=host, port=port, threaded=True, debug=False)
