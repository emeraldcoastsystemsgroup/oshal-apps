# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Build synthetic Career SQLite stores with the engine's own schema and drive the real loader, convergence reporter, reverse projector and engine (as one owner, in either backend) as child processes for the cutover contracts; host the loopback ATS the storage contract and the drill scrape.
# 2 | maintainer@emeraldcoastsystemsgroup.com | run_projector waits (bounded) until the cluster-wide txid horizon covers every committed outbox row before it starts the worker, so a projector run never races a transaction still open elsewhere on the server; settle=False leaves that to a caller that holds a transaction open on purpose.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Use a low-entropy synthetic claim-token UUID. The random-looking value bound to a token name matched gitleaks' generic-api-key rule (entropy ~3.95), so gate C of the public store cut refused this fixture; the value is still a valid version-4 UUID and every comparison reads the same constant.

"""Synthetic Career stores and process drivers for the cutover contracts.

The SQLite side is created from the engine's OWN schema strings (``db.CORPUS_SCHEMA``,
``db.USER_SCHEMA``) and the engine's own ``gaps.ensure_table`` - never a hand-written copy - so a
schema change in the engine reaches these proofs. The loader, reporter and projector run as real
child processes with an explicit environment: no DATABASE_URL, data root or store selector is ever
inherited from the caller's shell.
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from career_pg import wait_for_horizon


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
ENGINE_ROOT = PACKAGE_ROOT / "engine"
LOADER = PACKAGE_ROOT / "scripts" / "migrate-sqlite-to-postgres.js"
REPORTER = ENGINE_ROOT / "sync" / "report_convergence.py"
PROJECTOR = ENGINE_ROOT / "sync" / "reverse_sync.py"
OBSERVER = ENGINE_ROOT / "sync" / "observe_cutover.py"
NOW = "2026-09-20T12:00:00+00:00"

# Variables a child must never inherit from the developer's or CI's shell.
_SCRUB = ("DATABASE_URL", "CAREER_DATA_ROOT", "JOBHUNTER_STORE", "JOBHUNTER_MULTIUSER",
          "JOBHUNTER_DATA", "JOBHUNTER_DB", "JOBHUNTER_CORPUS_DB", "JOBHUNTER_USER_DB",
          "OSHAL_USER_SUB", "CAREER_REVERSE_SYNC_FAULT", "NODE_OPTIONS")


class _AtsHandler(BaseHTTPRequestHandler):
    """Serve the mutable deterministic HTML feed owned by the surrounding test server."""

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler names this hook
        query = parse_qs(urlsplit(self.path).query)
        page = int((query.get("page") or ["1"])[0])
        jobs = self.server.fixture_jobs if page == 1 else []
        cards = "".join(
            f'<article><a href="/jobs/{job["id"]}">{job["title"]}</a>'
            f'<span>{job["location"]}</span></article>'
            for job in jobs
        )
        body = f"<!doctype html><html><body>{cards}</body></html>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return


@contextmanager
def deterministic_ats():
    """Yield a loopback ATS URL plus a mutable job-list setter."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _AtsHandler)
    server.fixture_jobs = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/careers", server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def child_env(**extra) -> dict:
    """Return the current environment minus every store selector, plus ``extra``."""
    env = {key: value for key, value in os.environ.items() if key not in _SCRUB}
    env["PYTHONPATH"] = str(ENGINE_ROOT)
    env["PYTHONIOENCODING"] = "utf-8"
    env.update({key: str(value) for key, value in extra.items() if value is not None})
    return env


def engine_modules():
    """Import the engine's schema owners in SQLite mode with a throwaway data directory.

    ``jobhunter.config`` creates its data directory at import time, so the directory is pinned to
    a temporary path first; the package tree is never written.
    """
    os.environ["JOBHUNTER_STORE"] = "sqlite"
    os.environ.setdefault("JOBHUNTER_DATA", tempfile.mkdtemp(prefix="career-contract-engine-"))
    if str(ENGINE_ROOT) not in sys.path:
        sys.path.insert(0, str(ENGINE_ROOT))
    from jobhunter import db, gaps

    return db, gaps


def open_user_store(root: Path, sub: str) -> sqlite3.Connection:
    """Open ``root/<sub>/user-<sub>.db`` with the corpus attached, creating both schemas."""
    db, gaps = engine_modules()
    user_dir = root / sub
    user_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(user_dir / f"user-{sub}.db")
    conn.row_factory = sqlite3.Row
    conn.execute("ATTACH DATABASE ? AS corpus", (str(root / "corpus.db"),))
    conn.executescript(db.CORPUS_SCHEMA)
    conn.executescript(db.USER_SCHEMA)
    gaps.ensure_table(conn)
    return conn


def seed_corpus(conn: sqlite3.Connection) -> dict:
    """Two employers and four postings, including an ATS UI-label date the loader must NULL."""
    companies = [
        (1, "Fixture Systems", "Technology", "greenhouse", "fixture", '["seed"]', 0, 1),
        (2, "Harbor Robotics", "Aerospace", "lever", "harbor", '["seed", "manual"]', 1, 0),
    ]
    conn.executemany(
        "INSERT INTO corpus.companies (id,name,industry,ats_type,ats_token,source_lists,"
        "gsearched,referral,discover_status,last_scraped_at,created_at) "
        "VALUES (?,?,?,?,?,?,?,?,'found',?,?)",
        [row + (NOW, NOW) for row in companies],
    )
    postings = [
        (11, 1, "11", "Senior Platform Engineer", "Austin, TX", 1, 1, "2026-09-18", 150000.0),
        (12, 1, "12", "Cloud Automation Lead", "Remote, US", 1, 1, "Posted 30+ Days Ago", None),
        (13, 2, "13", "Robotics Software Engineer", "Denver, CO", 0, 1, "2026-09-19", 132000.5),
        (14, 2, "14", "Warehouse Associate", "Denver, CO", 0, 0, None, None),
    ]
    conn.executemany(
        "INSERT INTO corpus.postings_corpus (id,company_id,ats_job_id,title,location,remote,"
        "active,posted_at,salary_max,description,url,target_role,job_type,posted_date,"
        "first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,'fixture description',"
        "'https://jobs.example.com/'||?,?, 'fte', '2026-09-19', ?, ?)",
        [p + (p[0], 0 if p[0] == 14 else 1, NOW, NOW) for p in postings],
    )
    return {"companies": [c[0] for c in companies], "postings": [p[0] for p in postings]}


def seed_owner(conn: sqlite3.Connection, owner: str, applied_posting: int | None) -> None:
    """One owner's scores, optional applied lifecycle, a recruiter, a gap and an interview."""
    for posting, fit, ai in ((11, 71, 88), (12, 64, None), (13, 58, 72)):
        conn.execute(
            "INSERT INTO user_signals (posting_id,fit_score,ai_fit_score,ai_fit_rationale,"
            "ai_fit_matched,ai_fit_gaps,ai_model,ai_scored_at) VALUES (?,?,?,?,?,?,?,?)",
            (posting, fit, ai, f"{owner} rationale" if ai else None,
             '["kubernetes"]' if ai else None, '["go"]' if ai else None,
             "fixture-model" if ai else None, NOW if ai else None),
        )
    if applied_posting is not None:
        conn.execute(
            "UPDATE user_signals SET status='applied', promoted_at=?, generated_at=?, "
            "applied_at=?, resume_path='applications/resume.pdf', "
            "application_source='verified-submission', application_task_id='fixture-task', "
            "confirmation_path='applications/confirmation.html', "
            "apply_run_id='5f0f3c9a-9b7a-4c55-9d2c-0b8f7a1c2d3e', "
            "apply_claim_token='00000000-0000-4000-8000-00000000c0d3' WHERE posting_id=?",
            (NOW, NOW, NOW, applied_posting),
        )
    conn.execute(
        "INSERT INTO recruiter_firms (id,firm,bucket,status,sort_order,updated_at) "
        "VALUES (1,?, 'Exec Search','To contact',10,?)",
        (f"{owner} Search Partners", NOW),
    )
    conn.execute(
        "INSERT INTO gap_themes (key,n_jobs,avg_fit,sample_gaps,status,updated_at) "
        "VALUES ('kubernetes',3,71,'[\"k8s\"]','open',?)",
        (NOW,),
    )
    conn.execute(
        "INSERT INTO interview_assessments (id,at,company,role,transcript,result,finalized) "
        "VALUES (1,?,'Fixture Systems','Platform Engineer','fixture transcript','{}',1)",
        (NOW,),
    )


def build_stores(root: Path, owners: dict[str, int | None]) -> dict:
    """Create corpus.db and one user store per owner; ``owners`` maps sub -> applied posting."""
    root.mkdir(parents=True, exist_ok=True)
    seeded = None
    for owner, applied in owners.items():
        conn = open_user_store(root, owner)
        try:
            if seeded is None:
                seeded = seed_corpus(conn)
            seed_owner(conn, owner, applied)
            conn.commit()
        finally:
            conn.close()
    return seeded or {}


def run_loader(root: Path, app_url: str, node_path: str, *extra: str) -> subprocess.CompletedProcess:
    """Run the real SQLite -> PostgreSQL loader against the synthetic stores."""
    return subprocess.run(
        ["node", str(LOADER), *extra],
        cwd=PACKAGE_ROOT, capture_output=True, text=True, encoding="utf-8", timeout=180,
        env=child_env(CAREER_DATA_ROOT=root, DATABASE_URL=app_url, NODE_PATH=node_path),
    )


def run_reporter(root: Path, app_url: str, *extra: str) -> tuple[subprocess.CompletedProcess, dict | None]:
    """Run the real convergence reporter and parse its final report line."""
    result = subprocess.run(
        [sys.executable, str(REPORTER), "--data-root", str(root), "--database-url", app_url, *extra],
        cwd=PACKAGE_ROOT, capture_output=True, text=True, encoding="utf-8", timeout=180,
        env=child_env(),
    )
    return result, parse_marker(result.stdout, "CAREER_CONVERGENCE_REPORT=")


def run_projector(root: Path, app_url: str, *extra: str, fault: str | None = None,
                  timeout: int = 180, settle: bool = True) -> tuple[subprocess.CompletedProcess, dict | None]:
    """Run the real reverse projector, optionally armed with one fault-injection kill point.

    ``settle`` first waits until the cluster-wide horizon is past every committed outbox row, so
    the worker's first pass sees everything written so far. A caller holding a transaction open on
    purpose passes ``settle=False`` and waits with ``wait_for_horizon(equals=...)`` itself.
    """
    if settle:
        wait_for_horizon(app_url)
    result = subprocess.run(
        [sys.executable, str(PROJECTOR), "--data-root", str(root), "--database-url", app_url, *extra],
        cwd=PACKAGE_ROOT, capture_output=True, text=True, encoding="utf-8", timeout=timeout,
        env=child_env(CAREER_REVERSE_SYNC_FAULT=fault),
    )
    return result, parse_marker(result.stdout, "CAREER_REVERSE_SYNC=")


def run_engine(app_url: str, sub: str, code: str, data_dir: Path,
               store: str = "postgres", extra_env: dict | None = None) -> subprocess.CompletedProcess:
    """Run engine code (``from jobhunter import ...``) as one owner in a child process.

    ``store='postgres'`` binds the child exactly as the api does: JOBHUNTER_STORE=postgres, the
    disposable app-role DATABASE_URL and the owner's OSHAL_USER_SUB, so every write crosses FORCE
    RLS and the 106 capture triggers.
    """
    env = child_env(JOBHUNTER_STORE=store, OSHAL_USER_SUB=sub, JOBHUNTER_DATA=data_dir,
                    JOBHUNTER_DELAY=0, JOBHUNTER_CAREER_DB=data_dir / "career_db.json",
                    DATABASE_URL=app_url if store == "postgres" else None, **(extra_env or {}))
    result = subprocess.run([sys.executable, "-c", code], cwd=PACKAGE_ROOT, capture_output=True,
                            text=True, encoding="utf-8", timeout=180, env=env)
    if result.returncode != 0:
        raise AssertionError(f"engine child failed for {sub}:\n{result.stdout}\n{result.stderr}")
    return result


def parse_marker(stdout: str, marker: str) -> dict | None:
    """Return the JSON payload of the LAST line carrying ``marker``."""
    lines = [line for line in (stdout or "").splitlines() if line.startswith(marker)]
    return json.loads(lines[-1][len(marker):]) if lines else None


def sqlite_rows(root: Path, sub: str, query: str, params=()) -> list[dict]:
    """Read one owner's SQLite store (corpus attached) and return plain dict rows."""
    conn = sqlite3.connect(f"file:{root / sub / f'user-{sub}.db'}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("ATTACH DATABASE ? AS corpus", (str(root / "corpus.db"),))
        return [dict(row) for row in conn.execute(query, params).fetchall()]
    finally:
        conn.close()


def sqlite_fingerprint(root: Path, owners) -> dict:
    """A deterministic dump of every projected SQLite table, for replay no-op comparisons."""
    first = next(iter(owners))
    out = {
        "companies": sqlite_rows(root, first, "SELECT * FROM corpus.companies ORDER BY id"),
        "postings": sqlite_rows(root, first, "SELECT * FROM corpus.postings_corpus ORDER BY id"),
        "reputation": sqlite_rows(root, first, "SELECT * FROM corpus.company_reputation ORDER BY company_id"),
    }
    for owner in owners:
        out[owner] = {
            table: sqlite_rows(root, owner, f"SELECT * FROM {table} ORDER BY {key}")
            for table, key in (("user_signals", "posting_id"), ("recruiter_firms", "id"),
                               ("gap_themes", "key"), ("interview_assessments", "id"))
        }
    return out
