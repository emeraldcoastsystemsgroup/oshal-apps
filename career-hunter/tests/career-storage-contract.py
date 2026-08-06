# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise one real ATS/storage/nightly contract against SQLite and a disposable FORCE-RLS PostgreSQL database.

"""Backend-neutral Career storage contract used by the Node release gate.

The suite deliberately calls production ``db``, ``cli`` and ``match`` functions. SQLite uses
a real temporary database. PostgreSQL creates a short-lived database owned by a LOGIN,
NOSUPERUSER, NOBYPASSRLS role, applies the package migrations, and connects through the same
``DATABASE_URL`` path as the engine. The local ATS is an actual HTTP server, not a patched
fetch function, so pagination, parsing, refresh and deactivation all cross their real boundary.
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
import threading
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, quote, urlencode, urlsplit, urlunsplit


PACKAGE_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = [
    "031-career-hunter.sql",
    "095-career-corpus.sql",
    "096-career-corpus-complete.sql",
    "097-career-postings-view.sql",
    "100-career-application-provenance.sql",
    "101-career-apply-claim-lease.sql",
    "102-career-apply-run-binding.sql",
    "103-career-interview-source-identity.sql",
]


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


def _app_database_url(admin_url: str, database: str, role: str, password: str) -> str:
    parsed = urlsplit(admin_url)
    host = parsed.hostname or "127.0.0.1"
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{quote(role)}:{quote(password)}@{host}{port}"
    return urlunsplit((parsed.scheme, netloc, f"/{database}", parsed.query, ""))


@contextmanager
def disposable_postgres(admin_url: str):
    """Create an isolated non-superuser database, apply migrations, then remove both."""
    import psycopg2
    from psycopg2 import sql

    suffix = uuid.uuid4().hex[:12]
    database = f"career_contract_{suffix}"
    role = f"career_contract_role_{suffix}"
    password = uuid.uuid4().hex
    admin = psycopg2.connect(admin_url)
    admin.autocommit = True
    try:
        with admin.cursor() as cur:
            cur.execute(
                sql.SQL("CREATE ROLE {} LOGIN PASSWORD %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS")
                .format(sql.Identifier(role)),
                (password,),
            )
            cur.execute(
                sql.SQL("CREATE DATABASE {} OWNER {}")
                .format(sql.Identifier(database), sql.Identifier(role))
            )
        app_url = _app_database_url(admin_url, database, role, password)
        app = psycopg2.connect(app_url)
        try:
            with app.cursor() as cur:
                for name in MIGRATIONS:
                    cur.execute((PACKAGE_ROOT / "migrations" / name).read_text(encoding="utf-8"))
            app.commit()
        finally:
            app.close()
        yield app_url
    finally:
        with admin.cursor() as cur:
            cur.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname=%s AND pid <> pg_backend_pid()",
                (database,),
            )
            cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(database)))
            cur.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(role)))
        admin.close()


def _read_application(db, conn, posting_id: int) -> dict:
    """Return the same lifecycle facts from the physical table in either backend."""
    if db.config.POSTGRES:
        row = conn.execute(
            "SELECT status, promoted_at, generated_at, applied_at, application_source, "
            "application_task_id, apply_run_id::text AS apply_run_id, "
            "apply_claim_token::text AS apply_claim_token "
            "FROM career_user_applications WHERE posting_id=?",
            (posting_id,),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT status, promoted_at, generated_at, applied_at, application_source, "
            "application_task_id, apply_run_id, apply_claim_token "
            "FROM postings WHERE id=?",
            (posting_id,),
        ).fetchone()
    return dict(row)


def run_shared_contract(backend: str) -> dict:
    """Run the exact same observable contract against the configured production backend."""
    from jobhunter import cli, db, match

    db.init_db()
    with deterministic_ats() as (ats_url, server):
        with db.connect() as conn:
            company_id = db.upsert_company(
                conn,
                "Fixture Systems",
                source_list="contract-a",
                industry="Technology",
                ats_type="htmllist",
                ats_token=ats_url,
            )
            same_company_id = db.upsert_company(
                conn,
                "Fixture Systems",
                source_list="contract-b",
                industry="Aerospace",
            )
            assert same_company_id == company_id

        server.fixture_jobs = [
            {"id": "1001", "title": "Senior Platform Engineer Contract", "location": "Austin, TX"},
            {"id": "1002", "title": "Cloud Automation Lead", "location": "Remote, US"},
        ]
        cli.cmd_scrape(SimpleNamespace(company="Fixture Systems", list=None, limit=None))
        indexed_first = match.rescore_recent(14)

        with db.connect() as conn:
            first = conn.execute(
                "SELECT id, title, job_type, active, fit_score FROM postings "
                "WHERE company_id=? AND ats_job_id='1001'",
                (company_id,),
            ).fetchone()
            second = conn.execute(
                "SELECT id, active FROM postings WHERE company_id=? AND ats_job_id='1002'",
                (company_id,),
            ).fetchone()
            assert first and second
            assert first["job_type"] == "contract"
            assert int(first["active"]) == 1 and int(second["active"]) == 1
            assert first["fit_score"] is not None
            posting_id = int(first["id"])

        server.fixture_jobs = [
            {"id": "1001", "title": "Principal Platform Engineer Contract", "location": "Austin, TX"},
        ]
        cli.cmd_scrape(SimpleNamespace(company="Fixture Systems", list=None, limit=None))
        indexed_second = match.rescore_recent(14)

    run_id = str(uuid.uuid4())
    claim_token = str(uuid.uuid4())
    with db.connect() as conn:
        company = conn.execute(
            "SELECT id, industry, source_lists FROM companies WHERE id=?", (company_id,)
        ).fetchone()
        sources = db._as_list(company["source_lists"])
        assert company["industry"] == "Aerospace"
        assert sources == ["contract-a", "contract-b"]

        refreshed = conn.execute(
            "SELECT title, active FROM postings WHERE company_id=? AND ats_job_id='1001'",
            (company_id,),
        ).fetchone()
        deactivated = conn.execute(
            "SELECT active FROM postings WHERE company_id=? AND ats_job_id='1002'",
            (company_id,),
        ).fetchone()
        assert refreshed["title"] == "Principal Platform Engineer Contract"
        assert int(refreshed["active"]) == 1
        assert int(deactivated["active"]) == 0

        sequence_id = db.upsert_company(conn, "Sequence Sentinel", source_list="contract")
        assert sequence_id > company_id
        assert db.upsert_company(conn, "Sequence Sentinel", source_list="contract") == sequence_id

        db.set_status(conn, posting_id, "promoted")
        db.set_status(conn, posting_id, "generated", resume_path="applications/resume.pdf")
        db.set_status(
            conn,
            posting_id,
            "applied",
            application_source="verified-submission",
            application_task_id="contract-task",
            confirmation_path="applications/confirmation.html",
            apply_run_id=run_id,
            apply_claim_token=claim_token,
        )
        db.set_status(conn, posting_id, "applied", application_source="manual-mark")
        application = _read_application(db, conn, posting_id)
        assert application["status"] == "applied"
        assert application["promoted_at"] is not None
        assert application["generated_at"] is not None
        assert application["applied_at"] is not None
        assert application["application_source"] == "verified-submission"
        assert application["application_task_id"] == "contract-task"
        assert application["apply_run_id"] == run_id
        assert application["apply_claim_token"] == claim_token

        counts = {
            "companies": int(conn.execute("SELECT COUNT(*) AS n FROM companies").fetchone()["n"]),
            "postings": int(conn.execute("SELECT COUNT(*) AS n FROM postings").fetchone()["n"]),
            "active": int(conn.execute("SELECT COUNT(*) AS n FROM postings WHERE active=1").fetchone()["n"]),
            "applied": int(conn.execute("SELECT COUNT(*) AS n FROM postings WHERE status='applied'").fetchone()["n"]),
        }

        if db.config.POSTGRES:
            conn.execute("SELECT set_config('oshal.current_sub','contract-other',false)")
            isolated = conn.execute(
                "SELECT COUNT(*) AS n FROM career_user_applications"
            ).fetchone()["n"]
            assert int(isolated) == 0
            conn.apply_sub_guc()

    assert indexed_first == 2
    assert indexed_second == 1
    assert counts["postings"] == 2
    assert counts["active"] == 1
    assert counts["applied"] == 1
    return {
        "backend": backend,
        "ats": {"firstIndexed": indexed_first, "secondIndexed": indexed_second},
        "counts": counts,
        "companyId": company_id,
        "sequenceId": sequence_id,
        "postingId": posting_id,
        "applicationSource": application["application_source"],
    }


def run_sqlite() -> dict:
    with tempfile.TemporaryDirectory(prefix="career-contract-sqlite-") as root:
        os.environ.update({
            "JOBHUNTER_STORE": "sqlite",
            "JOBHUNTER_MULTIUSER": "0",
            "JOBHUNTER_DATA": root,
            "JOBHUNTER_DB": str(Path(root) / "jobs.db"),
            "JOBHUNTER_CAREER_DB": str(Path(root) / "career_db.json"),
            "JOBHUNTER_DELAY": "0",
            "OSHAL_USER_SUB": "contract-owner",
        })
        return run_shared_contract("sqlite")


def run_postgres(admin_url: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="career-contract-postgres-") as root:
        with disposable_postgres(admin_url) as app_url:
            os.environ.update({
                "JOBHUNTER_STORE": "postgres",
                "DATABASE_URL": app_url,
                "JOBHUNTER_DATA": root,
                "JOBHUNTER_CAREER_DB": str(Path(root) / "career_db.json"),
                "JOBHUNTER_DELAY": "0",
                "OSHAL_USER_SUB": "contract-owner",
            })
            return run_shared_contract("postgres")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("sqlite", "postgres"), required=True)
    parser.add_argument("--admin-url", default=os.environ.get("CAREER_TEST_POSTGRES_ADMIN_URL"))
    args = parser.parse_args()
    if args.backend == "postgres" and not args.admin_url:
        parser.error("--admin-url or CAREER_TEST_POSTGRES_ADMIN_URL is required for postgres")
    report = run_sqlite() if args.backend == "sqlite" else run_postgres(args.admin_url)
    print("CAREER_STORAGE_CONTRACT=" + json.dumps(report, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
