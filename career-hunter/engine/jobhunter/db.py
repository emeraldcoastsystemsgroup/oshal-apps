"""SQLite storage. One file, three core tables, one convenience view.

Reputation is stored in two layers on `company_reputation`:
  ai_*      -> filled by the AI enricher (flagged, directional)
  manual_*  -> filled by you; ALWAYS wins.
The `company_view` view COALESCEs manual over ai so readers get the effective value.
"""
from __future__ import annotations
import json
import sqlite3
from datetime import datetime, timezone
from contextlib import contextmanager

from . import config


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect():
    if config.MULTIUSER:
        # Per-user DB holds the user's signals + the `postings` VIEW; the shared jobs
        # corpus is ATTACHed read/write as `corpus`. Reads of `postings` resolve to the
        # view (main shadows the attached corpus table `postings_corpus`).
        config.USER_DB.parent.mkdir(parents=True, exist_ok=True)
        config.CORPUS_DB.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(config.USER_DB, timeout=120)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 120000")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = OFF")  # FKs aren't enforced across an ATTACH boundary
        conn.execute("ATTACH DATABASE ? AS corpus", (str(config.CORPUS_DB),))
        _ensure_multiuser(conn)
    else:
        conn = sqlite3.connect(config.DB_PATH, timeout=120)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 120000")  # wait up to 2min on locks (concurrent scrape+score) instead of erroring
        conn.execute("PRAGMA journal_mode = WAL")     # readers don't block writers (dashboard + bot + jobs)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def corpus_table() -> str:
    """Physical table holding the shared/objective posting columns. In MULTIUSER mode that
    is the ATTACHed `corpus.postings_corpus`; in legacy mode the inline `postings` table.
    Use this for any write of OBJECTIVE job data (title, salary, description, geo, active)."""
    return "corpus.postings_corpus" if config.MULTIUSER else "postings"


# Per-user signal columns — the only fields that differ user-to-user for the same job.
_USER_SIGNAL_COLS = (
    "fit_score", "ai_fit_score", "ai_fit_rationale", "ai_fit_matched", "ai_fit_gaps",
    "ai_scored_at", "ai_model", "status", "resume_path", "cover_path", "generated_at",
    "promoted_at", "applied_at", "outreach_sent_at", "notes",
)


def user_set(conn, posting_id, **cols) -> None:
    """Write per-user signal columns for a posting. MULTIUSER -> upsert into the per-user
    `user_signals` table keyed by posting_id; legacy -> UPDATE the inline `postings` row.
    This is the single chokepoint for every per-user write (fit, AI fit, status, paths)."""
    if not cols:
        return
    if config.MULTIUSER:
        keys = list(cols.keys())
        placeholders = ", ".join(["?"] * len(keys))
        updates = ", ".join(f"{k}=excluded.{k}" for k in keys)
        conn.execute(
            f"INSERT INTO user_signals (posting_id, {', '.join(keys)}) "
            f"VALUES (?, {placeholders}) "
            f"ON CONFLICT(posting_id) DO UPDATE SET {updates}",
            (posting_id, *cols.values()),
        )
    else:
        sets = ", ".join(f"{k}=?" for k in cols)
        conn.execute(f"UPDATE postings SET {sets} WHERE id=?", (*cols.values(), posting_id))


SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    ticker        TEXT,
    domain        TEXT,
    homepage      TEXT,
    careers_url   TEXT,
    ats_type      TEXT,            -- greenhouse | lever | ashby | smartrecruiters | workable | workday
    ats_token     TEXT,            -- board token, or 'tenant:dc:site' for workday
    industry      TEXT,
    hq            TEXT,
    source_lists  TEXT,            -- json array: which seed list(s) it came from
    discover_status TEXT DEFAULT 'pending',  -- pending | found | not_found | manual
    last_scraped_at TEXT,
    created_at    TEXT
);

CREATE TABLE IF NOT EXISTS postings (
    id            INTEGER PRIMARY KEY,
    company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    ats_job_id    TEXT NOT NULL,
    title         TEXT,
    location      TEXT,
    remote        INTEGER DEFAULT 0,
    department    TEXT,
    url           TEXT,            -- direct apply link on the corporate/ATS site
    description   TEXT,
    posted_at     TEXT,
    fit_score     INTEGER,         -- cheap keyword match vs career_db (filled by `match`)
    -- salary (listed from the ATS, or AI-estimated)
    salary_min    REAL,
    salary_max    REAL,
    salary_currency TEXT,
    salary_period TEXT,            -- year | hour | month
    salary_raw    TEXT,            -- original text if unparsed
    salary_source TEXT,            -- 'listed' | 'ai_estimated'
    -- AI deep fit (filled by `score`)
    ai_fit_score    INTEGER,       -- 0-100
    ai_fit_rationale TEXT,
    ai_fit_matched  TEXT,          -- json array of matched qualifications
    ai_fit_gaps     TEXT,          -- json array of gaps/risks
    ai_scored_at    TEXT,
    ai_model        TEXT,
    -- application lifecycle
    status        TEXT DEFAULT 'new',  -- new | promoted | generated | applied | dismissed
    resume_path   TEXT,
    cover_path    TEXT,
    generated_at  TEXT,
    promoted_at   TEXT,
    notes         TEXT,
    first_seen_at TEXT,
    last_seen_at  TEXT,
    active        INTEGER DEFAULT 1,
    UNIQUE(company_id, ats_job_id)
);
CREATE INDEX IF NOT EXISTS idx_postings_company ON postings(company_id);
CREATE INDEX IF NOT EXISTS idx_postings_active ON postings(active);
CREATE INDEX IF NOT EXISTS idx_postings_aifit ON postings(ai_fit_score);
CREATE INDEX IF NOT EXISTS idx_postings_status ON postings(status);
CREATE INDEX IF NOT EXISTS idx_postings_posted ON postings(posted_date);
-- Composite for the by-company report (target lane + AI fit), so it seeks the ~4k
-- qualifying rows instead of scanning every active posting.
CREATE INDEX IF NOT EXISTS idx_postings_report ON postings(target_role, ai_fit_score);

CREATE TABLE IF NOT EXISTS company_reputation (
    company_id     INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    ai_about       TEXT,
    ai_positives   TEXT,           -- json array
    ai_negatives   TEXT,           -- json array
    ai_score       INTEGER,        -- 0-100
    ai_model       TEXT,
    ai_at          TEXT,
    manual_about     TEXT,
    manual_positives TEXT,         -- json array
    manual_negatives TEXT,         -- json array
    manual_score     INTEGER,      -- 0-100
    manual_note      TEXT,
    manual_at        TEXT
);

-- Recruiter / headhunter outreach tracker (the "Recruiters" dashboard tab).
-- Standalone from the per-company live LinkedIn lookup in recruiters.py — this is the
-- persistent list of search firms + individual recruiters the user is working.
CREATE TABLE IF NOT EXISTS recruiter_firms (
    id            INTEGER PRIMARY KEY,
    firm          TEXT NOT NULL,
    bucket        TEXT,             -- Cleared / GovTech | Exec Search | SAP / ERP | Staffing
    website       TEXT,            -- best 'land here & submit' URL
    contact_name  TEXT,
    contact_role  TEXT,
    contact_link  TEXT,            -- email or LinkedIn URL for the named recruiter
    resume_label  TEXT,            -- which resume variant was sent (see RESUMES in dashboard)
    channel       TEXT,            -- LinkedIn | Email | Profile | Referral | Phone
    status        TEXT DEFAULT 'To contact',  -- To contact | Contacted | Replied | Call scheduled | Submitted me | On radar | Dead
    date_contacted TEXT,
    followup_date  TEXT,
    next_action    TEXT,
    notes          TEXT,
    sort_order     INTEGER DEFAULT 100,
    updated_at     TEXT
);

-- Interview -> realistic skill reassessment (transcript assessed vs. resume/claimed skills)
CREATE TABLE IF NOT EXISTS interview_assessments (
    id          INTEGER PRIMARY KEY,
    at          TEXT,
    company     TEXT,
    role        TEXT,
    transcript  TEXT,
    answers     TEXT,            -- answers to the calibration questions (round 2)
    result      TEXT,            -- JSON: demonstrated / overclaimed / underclaimed / assessed_skills / questions / summary
    finalized   INTEGER DEFAULT 0
);

CREATE VIEW IF NOT EXISTS company_view AS
SELECT
    c.id, c.name, c.ticker, c.industry, c.hq, c.ats_type, c.ats_token,
    c.careers_url, c.discover_status, c.last_scraped_at, c.source_lists,
    COALESCE(r.manual_about,     r.ai_about)     AS about,
    COALESCE(r.manual_positives, r.ai_positives) AS positives,
    COALESCE(r.manual_negatives, r.ai_negatives) AS negatives,
    COALESCE(r.manual_score,     r.ai_score)     AS score,
    CASE
        WHEN r.manual_score IS NOT NULL OR r.manual_about IS NOT NULL THEN 'manual'
        WHEN r.ai_score IS NOT NULL THEN 'ai'
        ELSE 'none'
    END AS reputation_source,
    (SELECT COUNT(*) FROM postings p WHERE p.company_id = c.id AND p.active = 1) AS open_roles
FROM companies c
LEFT JOIN company_reputation r ON r.company_id = c.id;
"""


# ── Multi-user schemas ───────────────────────────────────────────────────────
# CORPUS = the shared jobs corpus (one row per job, objective columns only), used by
# every user. Lives in corpus.db (ATTACHed as `corpus`). companies + reputation are
# shared too.
CORPUS_SCHEMA = """
CREATE TABLE IF NOT EXISTS corpus.companies (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    ticker        TEXT, domain TEXT, homepage TEXT, careers_url TEXT,
    ats_type      TEXT, ats_token TEXT, industry TEXT, hq TEXT,
    source_lists  TEXT, discover_status TEXT DEFAULT 'pending',
    last_scraped_at TEXT, created_at TEXT, gsearched INTEGER DEFAULT 0,
    referral      INTEGER DEFAULT 0    -- warm-contact strength (0-3); boosts P(land) in the board
);

CREATE TABLE IF NOT EXISTS corpus.postings_corpus (
    id            INTEGER PRIMARY KEY,
    company_id    INTEGER NOT NULL,
    ats_job_id    TEXT NOT NULL,
    title         TEXT, location TEXT, remote INTEGER DEFAULT 0, department TEXT,
    url           TEXT, description TEXT, posted_at TEXT, posted_date TEXT,
    state         TEXT, city TEXT, lat REAL, lon REAL, job_type TEXT,
    target_role   INTEGER,
    salary_min    REAL, salary_max REAL, salary_currency TEXT, salary_period TEXT,
    salary_raw    TEXT, salary_source TEXT,
    first_seen_at TEXT, last_seen_at TEXT, active INTEGER DEFAULT 1,
    UNIQUE(company_id, ats_job_id)
);
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_company ON postings_corpus(company_id);
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_active  ON postings_corpus(active);
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_posted  ON postings_corpus(posted_date);
CREATE INDEX IF NOT EXISTS corpus.idx_corpus_target  ON postings_corpus(target_role);

CREATE TABLE IF NOT EXISTS corpus.company_reputation (
    company_id     INTEGER PRIMARY KEY,
    ai_about TEXT, ai_positives TEXT, ai_negatives TEXT, ai_score INTEGER, ai_model TEXT, ai_at TEXT,
    manual_about TEXT, manual_positives TEXT, manual_negatives TEXT, manual_score INTEGER,
    manual_note TEXT, manual_at TEXT
);

CREATE VIEW IF NOT EXISTS corpus.company_view AS
SELECT c.id, c.name, c.ticker, c.industry, c.hq, c.ats_type, c.ats_token,
       c.careers_url, c.discover_status, c.last_scraped_at, c.source_lists,
       COALESCE(r.manual_about, r.ai_about) AS about,
       COALESCE(r.manual_positives, r.ai_positives) AS positives,
       COALESCE(r.manual_negatives, r.ai_negatives) AS negatives,
       COALESCE(r.manual_score, r.ai_score) AS score,
       CASE WHEN r.manual_score IS NOT NULL OR r.manual_about IS NOT NULL THEN 'manual'
            WHEN r.ai_score IS NOT NULL THEN 'ai' ELSE 'none' END AS reputation_source,
       (SELECT COUNT(*) FROM corpus.postings_corpus p WHERE p.company_id = c.id AND p.active = 1) AS open_roles
FROM corpus.companies c
LEFT JOIN corpus.company_reputation r ON r.company_id = c.id;
"""

# USER = the per-user signals + the `postings` VIEW that joins the shared corpus row to this
# user's signals, so every existing `FROM postings` read works unchanged. Lives in user-{sub}.db.
USER_SCHEMA = """
CREATE TABLE IF NOT EXISTS user_signals (
    posting_id    INTEGER PRIMARY KEY,
    fit_score     INTEGER,
    ai_fit_score  INTEGER, ai_fit_rationale TEXT, ai_fit_matched TEXT, ai_fit_gaps TEXT,
    ai_scored_at  TEXT, ai_model TEXT,
    status        TEXT DEFAULT 'new',
    resume_path   TEXT, cover_path TEXT,
    generated_at  TEXT, promoted_at TEXT, applied_at TEXT, outreach_sent_at TEXT, notes TEXT,
    apply_active  INTEGER DEFAULT 1,   -- apply-operator claim lock: 1=available, 0=claimed/in-flight
    confirmation_path TEXT             -- saved submission-confirmation screenshot (set on 'applied')
);
CREATE INDEX IF NOT EXISTS idx_user_aifit  ON user_signals(ai_fit_score);
CREATE INDEX IF NOT EXISTS idx_user_status ON user_signals(status);
CREATE INDEX IF NOT EXISTS idx_user_fit    ON user_signals(fit_score);

CREATE TABLE IF NOT EXISTS recruiter_firms (
    id INTEGER PRIMARY KEY, firm TEXT NOT NULL, bucket TEXT, website TEXT,
    contact_name TEXT, contact_role TEXT, contact_link TEXT, resume_label TEXT,
    channel TEXT, status TEXT DEFAULT 'To contact', date_contacted TEXT, followup_date TEXT,
    next_action TEXT, notes TEXT, sort_order INTEGER DEFAULT 100, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS interview_assessments (
    id INTEGER PRIMARY KEY, at TEXT, company TEXT, role TEXT,
    transcript TEXT, answers TEXT, result TEXT, finalized INTEGER DEFAULT 0
);
"""

# The compatibility `postings` VIEW joins the shared corpus row to this user's signals
# (status defaults to 'new'). SQLite forbids a PERSISTENT view from referencing an ATTACHed
# database, so it must be a TEMP view, recreated on every connection. `temp` shadows main +
# attached in name resolution, so existing `FROM postings` reads transparently hit this.
_POSTINGS_VIEW_SQL = """
CREATE TEMP VIEW IF NOT EXISTS postings AS
SELECT pc.id, pc.company_id, pc.ats_job_id, pc.title, pc.location, pc.remote, pc.department,
       pc.url, pc.description, pc.posted_at, pc.posted_date, pc.state, pc.city, pc.lat, pc.lon,
       pc.job_type, pc.target_role, pc.salary_min, pc.salary_max, pc.salary_currency,
       pc.salary_period, pc.salary_raw, pc.salary_source, pc.first_seen_at, pc.last_seen_at, pc.active,
       us.fit_score, us.ai_fit_score, us.ai_fit_rationale, us.ai_fit_matched, us.ai_fit_gaps,
       us.ai_scored_at, us.ai_model,
       COALESCE(us.status, 'new') AS status,
       us.resume_path, us.cover_path, us.generated_at, us.promoted_at, us.applied_at,
       us.outreach_sent_at, us.notes, us.apply_active, us.confirmation_path
FROM corpus.postings_corpus pc
LEFT JOIN user_signals us ON us.posting_id = pc.id;
"""

# Schema is ensured once per (corpus,user) DB pair per process; the temp view is per-connection.
_multiuser_inited: set = set()

# user_signals columns added after v1; ALTERed onto an existing per-user DB (CREATE IF NOT EXISTS
# skips a table that already exists, so new columns need an explicit ADD COLUMN).
_USER_ADDED_COLUMNS = {
    "apply_active": "INTEGER DEFAULT 1",
    "confirmation_path": "TEXT",
}


def _ensure_user_columns(conn) -> None:
    """Idempotently add post-v1 columns to an existing user_signals table."""
    have = {r[1] for r in conn.execute("PRAGMA table_info(user_signals)").fetchall()}
    for col, decl in _USER_ADDED_COLUMNS.items():
        if col not in have:
            try:
                conn.execute(f"ALTER TABLE user_signals ADD COLUMN {col} {decl}")
            except Exception:
                pass  # concurrent add / already present — safe to ignore


def _ensure_multiuser(conn) -> None:
    """Create the shared corpus + per-user base tables once per process, then (re)create the
    per-connection TEMP `postings` view that joins them. Called from connect() in MULTIUSER mode."""
    key = (str(config.CORPUS_DB), str(config.USER_DB))
    if key not in _multiuser_inited:
        conn.executescript(CORPUS_SCHEMA)
        conn.executescript(USER_SCHEMA)
        _ensure_user_columns(conn)   # backfill new columns onto pre-existing user DBs
        _multiuser_inited.add(key)
    conn.executescript(_POSTINGS_VIEW_SQL)


# Columns added after v1; migrate() adds any missing from an existing DB.
_POSTING_ADDED_COLUMNS = {
    "salary_min": "REAL", "salary_max": "REAL", "salary_currency": "TEXT",
    "salary_period": "TEXT", "salary_raw": "TEXT", "salary_source": "TEXT",
    "ai_fit_score": "INTEGER", "ai_fit_rationale": "TEXT", "ai_fit_matched": "TEXT",
    "ai_fit_gaps": "TEXT", "ai_scored_at": "TEXT", "ai_model": "TEXT",
    "status": "TEXT", "resume_path": "TEXT", "cover_path": "TEXT",
    "generated_at": "TEXT", "promoted_at": "TEXT", "applied_at": "TEXT", "notes": "TEXT",
    "outreach_sent_at": "TEXT",  # recruiter intro sent for THIS role (separate from apply status)
    "posted_date": "TEXT",  # normalized YYYY-MM-DD
    "state": "TEXT",         # parsed 2-letter US state (for the geo map / filtering)
    "city": "TEXT",          # geocoded city key (normalized lowercase) for the map / filtering
    "lat": "REAL", "lon": "REAL",  # city centroid for the geo map (None -> falls back to state)
    "job_type": "TEXT",      # fte | contract | intern | parttime  (employment type)
    "target_role": "INTEGER",  # 1 = in the user's target lane, 0 = out-of-lane (retail/labor/clinical)
}


def migrate(conn) -> None:
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(postings)").fetchall()}
    for name, typ in _POSTING_ADDED_COLUMNS.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE postings ADD COLUMN {name} {typ}")
    conn.execute("UPDATE postings SET status = 'new' WHERE status IS NULL")
    # companies: gsearched flag tracks the slow-roll Google careers-URL pass
    ccols = {r["name"] for r in conn.execute("PRAGMA table_info(companies)").fetchall()}
    if "gsearched" not in ccols:
        conn.execute("ALTER TABLE companies ADD COLUMN gsearched INTEGER DEFAULT 0")


# Seed list for the recruiter tracker (verified URLs, June 2026). Buckets match the
# Headhunter_Target_List.md the user already has. (firm, bucket, website, sort_order)
_RECRUITER_SEED = [
    ("ClearanceJobs (build profile)", "Cleared / GovTech", "https://www.clearancejobs.com/", 10),
    ("iQuasar", "Cleared / GovTech", "https://iquasar.com/service-offerings/cleared-recruitment/", 11),
    ("Sparks Group", "Cleared / GovTech", "https://sparksgroupinc.com/security-clearance-recruiting/", 12),
    ("ClearanceRecruiter", "Cleared / GovTech", "https://clearancerecruiter.com/", 13),
    ("Next Step Systems", "Cleared / GovTech", "https://www.nextstepsystems.com/security-clearance-cleared-it-jobs/", 14),
    ("Parallel Partners", "Cleared / GovTech", "https://www.parallelpartners.com/security-clearance-cleared-it-jobs/", 15),
    ("True (True Search)", "Exec Search", "https://trueplatform.com/true-search/", 20),
    ("Riviera Partners", "Exec Search", "https://www.rivierapartners.com/", 21),
    ("Heidrick & Struggles", "Exec Search", "https://www.heidrick.com/", 22),
    ("Korn Ferry", "Exec Search", "https://www.kornferry.com/", 23),
    ("Russell Reynolds", "Exec Search", "https://www.russellreynolds.com/", 24),
    ("Bespoke Partners", "Exec Search", "https://bespokepartners.com/", 25),
    ("Next Ventures", "SAP / ERP", "https://next-ventures.us/practices/sap-recruitment-agency/", 30),
    ("JRG Partners", "SAP / ERP", "https://www.jrgpartners.com/sap-executive-recruiters/", 31),
    ("Vortex Consulting", "SAP / ERP", "https://vortexconsulting.net/sap-solutions/sap-staffing/", 32),
    ("Procom", "SAP / ERP", "https://procomservices.com/en-us/sap-recruitment-experts/", 33),
    ("Alpha Apex Group", "SAP / ERP", "https://www.alphaapexgroup.com/", 34),
    ("Panorama Consulting", "SAP / ERP", "https://www.panorama-consulting.com/", 35),
]


def seed_recruiters(conn) -> int:
    """Populate the recruiter tracker the first time only (never clobbers edits)."""
    n = conn.execute("SELECT COUNT(*) c FROM recruiter_firms").fetchone()["c"]
    if n:
        return 0
    for firm, bucket, site, order in _RECRUITER_SEED:
        conn.execute(
            "INSERT INTO recruiter_firms (firm, bucket, website, resume_label, sort_order, updated_at) "
            "VALUES (?,?,?,?,?,?)",
            (firm, bucket, site, "Headhunter (broad) — PDF", order, now()))
    return len(_RECRUITER_SEED)


def init_db() -> None:
    with connect() as conn:
        if not config.MULTIUSER:
            conn.executescript(SCHEMA)
            migrate(conn)
        # MULTIUSER: schema is ensured in connect() via _ensure_multiuser().
        seed_recruiters(conn)


# ── companies ────────────────────────────────────────────────────────────────
def upsert_company(conn, name: str, **fields) -> int:
    """Insert or update a company by unique name. Returns company id."""
    row = conn.execute("SELECT id, source_lists FROM companies WHERE name = ?", (name,)).fetchone()
    src = fields.pop("source_list", None)
    if row:
        cid = row["id"]
        if src:
            existing = set(json.loads(row["source_lists"] or "[]"))
            existing.add(src)
            fields["source_lists"] = json.dumps(sorted(existing))
        if fields:
            cols = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE companies SET {cols} WHERE id = ?", (*fields.values(), cid))
        return cid
    fields["source_lists"] = json.dumps([src] if src else [])
    fields["created_at"] = now()
    keys = ["name", *fields.keys()]
    vals = [name, *fields.values()]
    ph = ", ".join("?" * len(keys))
    cur = conn.execute(f"INSERT INTO companies ({', '.join(keys)}) VALUES ({ph})", vals)
    return cur.lastrowid


# ── postings ─────────────────────────────────────────────────────────────────
def upsert_posting(conn, company_id: int, p: dict) -> str:
    """Insert/refresh a normalized posting dict. Returns 'new' | 'seen'.

    Listed salary (from the ATS) is stored with salary_source='listed' and never
    overwrites an existing salary unless the feed provides one.
    """
    ts = now()
    has_salary = p.get("salary_min") is not None or p.get("salary_max") is not None or p.get("salary_raw")
    sal = (p.get("salary_min"), p.get("salary_max"), p.get("salary_currency"),
           p.get("salary_period"), p.get("salary_raw"), "listed" if has_salary else None)
    existing = conn.execute(
        "SELECT id FROM postings WHERE company_id = ? AND ats_job_id = ?",
        (company_id, str(p["ats_job_id"])),
    ).fetchone()
    ct = corpus_table()
    if existing:
        conn.execute(
            f"""UPDATE {ct} SET title=?, location=?, remote=?, department=?, url=?,
               description=?, posted_at=?, last_seen_at=?, active=1 WHERE id=?""",
            (p.get("title"), p.get("location"), int(p.get("remote", 0)), p.get("department"),
             p.get("url"), p.get("description"), p.get("posted_at"), ts, existing["id"]),
        )
        if has_salary:
            conn.execute(
                f"""UPDATE {ct} SET salary_min=?, salary_max=?, salary_currency=?,
                   salary_period=?, salary_raw=?, salary_source=? WHERE id=?""",
                (*sal, existing["id"]),
            )
        return "seen"
    from . import dates, geo, jobtype, lane
    posted_date = dates.normalize(p.get("posted_at"), ts)
    state = geo.state_of(p.get("location"))
    place = geo.place_of(p.get("location"), state)
    city, lat, lon = place if place else (None, None, None)
    jtype = jobtype.classify(p.get("title"), p.get("job_type_hint"))
    target = 1 if lane.is_target_role(p.get("title")) else 0
    # In MULTIUSER mode `status` lives per-user (user_signals), not on the shared corpus row.
    status_col = "" if config.MULTIUSER else "status, "
    status_val = "" if config.MULTIUSER else "'new', "
    conn.execute(
        f"""INSERT INTO {ct} (company_id, ats_job_id, title, location, remote, department,
           url, description, posted_at, posted_date, state, city, lat, lon, job_type, target_role,
           salary_min, salary_max, salary_currency,
           salary_period, salary_raw, salary_source, {status_col}first_seen_at, last_seen_at, active)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, {status_val}?,?,1)""",
        (company_id, str(p["ats_job_id"]), p.get("title"), p.get("location"),
         int(p.get("remote", 0)), p.get("department"), p.get("url"), p.get("description"),
         p.get("posted_at"), posted_date, state, city, lat, lon, jtype, target, *sal, ts, ts),
    )
    return "new"


def backfill_dates(conn, limit=None) -> int:
    """Populate posted_date (normalized YYYY-MM-DD) for rows that don't have it yet."""
    from . import dates
    sql = "SELECT id, posted_at, first_seen_at FROM postings WHERE posted_date IS NULL AND posted_at IS NOT NULL"
    if limit:
        sql += f" LIMIT {int(limit)}"
    n = 0
    for r in conn.execute(sql).fetchall():
        nd = dates.normalize(r["posted_at"], r["first_seen_at"])
        if nd:
            conn.execute(f"UPDATE {corpus_table()} SET posted_date=? WHERE id=?", (nd, r["id"]))
            n += 1
    return n


def backfill_states(conn, limit=None) -> int:
    """Populate the parsed US state for rows that don't have it yet."""
    from . import geo
    sql = "SELECT id, location FROM postings WHERE state IS NULL AND location IS NOT NULL"
    if limit:
        sql += f" LIMIT {int(limit)}"
    n = 0
    for r in conn.execute(sql).fetchall():
        st = geo.state_of(r["location"])
        if st:
            conn.execute(f"UPDATE {corpus_table()} SET state=? WHERE id=?", (st, r["id"]))
            n += 1
    return n


def backfill_geo(conn, limit=None, batch=2000) -> int:
    """Populate parsed state + geocoded city/lat/lon for rows missing them.
    Covers rows that predate the geo columns. Returns rows updated."""
    from . import geo
    sql = ("SELECT id, location, state FROM postings "
           "WHERE location IS NOT NULL AND (lat IS NULL OR state IS NULL)")
    if limit:
        sql += f" LIMIT {int(limit)}"
    n = 0
    rows = conn.execute(sql).fetchall()
    for i, r in enumerate(rows):
        state = r["state"] or geo.state_of(r["location"])
        place = geo.place_of(r["location"], state)
        city, lat, lon = place if place else (None, None, None)
        conn.execute(f"UPDATE {corpus_table()} SET state=?, city=?, lat=?, lon=? WHERE id=?",
                     (state, city, lat, lon, r["id"]))
        n += 1
        if i % batch == 0:
            conn.commit()
    return n


def save_ai_fit(conn, posting_id, score, rationale, matched, gaps, model):
    # Per-user signal -> user_signals (MULTIUSER) or inline postings (legacy).
    user_set(conn, posting_id, ai_fit_score=score, ai_fit_rationale=rationale,
             ai_fit_matched=json.dumps(matched or []), ai_fit_gaps=json.dumps(gaps or []),
             ai_model=model, ai_scored_at=now())


def save_salary_estimate(conn, posting_id, smin, smax, currency="USD", period="year"):
    """Only fills AI estimate when there's no listed salary already. Salary is OBJECTIVE
    (about the job, same for all users) so it lives on the shared corpus row."""
    row = conn.execute("SELECT salary_source FROM postings WHERE id=?", (posting_id,)).fetchone()
    if row and row["salary_source"] == "listed":
        return False
    conn.execute(
        f"""UPDATE {corpus_table()} SET salary_min=?, salary_max=?, salary_currency=?,
           salary_period=?, salary_source='ai_estimated' WHERE id=?""",
        (smin, smax, currency, period, posting_id),
    )
    return True


def set_status(conn, posting_id, status, **fields):
    """Application lifecycle is per-user -> user_signals (MULTIUSER) or inline (legacy)."""
    cols = {"status": status}
    if status == "promoted":
        cols["promoted_at"] = now()
    if status == "generated":
        cols["generated_at"] = now()
    if status == "applied":
        cols["applied_at"] = now()
    cols.update(fields)   # e.g. resume_path, cover_path
    user_set(conn, posting_id, **cols)


def set_outreach(conn, posting_id, sent: bool = True):
    """Track that the recruiter intro was sent for this role. Per-user. Kept separate from
    the apply-lifecycle `status` because outreach can happen before or after applying."""
    user_set(conn, posting_id, outreach_sent_at=now() if sent else None)


def deactivate_missing(conn, company_id: int, seen_ids: set[str]) -> int:
    """Mark postings no longer present in the feed as inactive (closed). Objective -> corpus."""
    rows = conn.execute(
        "SELECT id, ats_job_id FROM postings WHERE company_id = ? AND active = 1", (company_id,)
    ).fetchall()
    ct = corpus_table()
    closed = 0
    for r in rows:
        if r["ats_job_id"] not in seen_ids:
            conn.execute(f"UPDATE {ct} SET active = 0 WHERE id = ?", (r["id"],))
            closed += 1
    return closed


# ── reputation ───────────────────────────────────────────────────────────────
def save_ai_reputation(conn, company_id, about, positives, negatives, score, model):
    conn.execute(
        """INSERT INTO company_reputation (company_id, ai_about, ai_positives, ai_negatives, ai_score, ai_model, ai_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(company_id) DO UPDATE SET
             ai_about=excluded.ai_about, ai_positives=excluded.ai_positives,
             ai_negatives=excluded.ai_negatives, ai_score=excluded.ai_score,
             ai_model=excluded.ai_model, ai_at=excluded.ai_at""",
        (company_id, about, json.dumps(positives), json.dumps(negatives), score, model, now()),
    )


def save_manual_reputation(conn, company_id, *, about=None, positives=None, negatives=None, score=None, note=None):
    conn.execute(
        """INSERT INTO company_reputation (company_id, manual_about, manual_positives, manual_negatives, manual_score, manual_note, manual_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(company_id) DO UPDATE SET
             manual_about=COALESCE(excluded.manual_about, company_reputation.manual_about),
             manual_positives=COALESCE(excluded.manual_positives, company_reputation.manual_positives),
             manual_negatives=COALESCE(excluded.manual_negatives, company_reputation.manual_negatives),
             manual_score=COALESCE(excluded.manual_score, company_reputation.manual_score),
             manual_note=COALESCE(excluded.manual_note, company_reputation.manual_note),
             manual_at=excluded.manual_at""",
        (company_id,
         about,
         json.dumps(positives) if positives is not None else None,
         json.dumps(negatives) if negatives is not None else None,
         score, note, now()),
    )
