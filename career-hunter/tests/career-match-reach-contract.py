# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | The nightly match reaches a job first seen late and a job never matched, on the per-person SQLite store over a read-only corpus and on PostgreSQL under its row policy.
"""The keyword match a person's board depends on, against the production ``db`` and ``match``."""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import tempfile
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "tests" / "helpers"))
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))

DAY = datetime.timedelta(days=1)
# name: (days since the employer's date, days since first seen, open, saved keyword fit)
JOBS = {
    "fresh": (2, 2, True, None),
    "undated": (None, 2, True, None),
    "first-seen-late": (30, 0, True, None),
    "never-matched": (30, 30, True, None),
    "already-matched": (30, 30, True, 77),
    "closed": (30, 0, False, None),
}


def seed(db, company_id: int) -> None:
    now = datetime.datetime.now(datetime.timezone.utc)
    with db.connect() as conn:
        for name, (posted, seen, active, _) in JOBS.items():
            first_seen = (now - seen * DAY).isoformat(timespec="seconds")
            posted_date = None if posted is None else (now - posted * DAY).date().isoformat()
            conn.execute(
                f"INSERT INTO {db.corpus_table()} (company_id, ats_job_id, title, description, url, "
                "posted_date, first_seen_at, last_seen_at, active) VALUES (?,?,?,?,?,?,?,?,?)",
                (company_id, name, "Cloud Platform Architect", "cloud automation", f"https://example.test/{name}",
                 posted_date, first_seen, first_seen, active),
            )
        conn.commit()


def fits(db) -> dict:
    with db.connect() as conn:
        rows = conn.execute("SELECT ats_job_id, fit_score FROM postings").fetchall()
    return {row["ats_job_id"]: row["fit_score"] for row in rows}


def exercise(db, match, *, read_only_corpus) -> dict:
    db.init_db()
    with db.connect() as conn:
        company_id = db.upsert_company(conn, "Reach Fixture", source_list="contract")
    seed(db, company_id)
    with db.connect() as conn:
        for name, (*_, fit) in JOBS.items():
            if fit is not None:
                row = conn.execute("SELECT id FROM postings WHERE ats_job_id=?", (name,)).fetchone()
                db.user_set(conn, row["id"], fit_score=fit)
        conn.commit()
    read_only_corpus()
    first = match.rescore_recent(14)
    matched = fits(db)
    second = match.rescore_recent(14)
    return {"first": first, "second": second, "fits": matched}


def run_sqlite() -> dict:
    with tempfile.TemporaryDirectory(prefix="career-match-reach-") as root:
        career = Path(root) / "career_db.json"
        career.write_text(json.dumps({"skills": {"cloud": {"items": ["kubernetes"]}}}), encoding="utf-8")
        corpus = Path(root) / "corpus.db"
        os.environ.update({
            "JOBHUNTER_STORE": "sqlite", "JOBHUNTER_MULTIUSER": "1", "JOBHUNTER_DATA": root,
            "JOBHUNTER_CORPUS_DB": str(corpus), "JOBHUNTER_USER_DB": str(Path(root) / "user-reach-owner.db"),
            "JOBHUNTER_CAREER_DB": str(career), "OSHAL_USER_SUB": "reach-owner",
        })
        from jobhunter import db, match
        return exercise(db, match, read_only_corpus=lambda: corpus.chmod(0o444))


def run_postgres(admin_url: str) -> dict:
    from career_pg import CUTOVER_MIGRATIONS, disposable_postgres
    with tempfile.TemporaryDirectory(prefix="career-match-reach-") as root:
        career = Path(root) / "career_db.json"
        career.write_text(json.dumps({"skills": {"cloud": {"items": ["kubernetes"]}}}), encoding="utf-8")
        with disposable_postgres(admin_url, CUTOVER_MIGRATIONS) as app_url:
            os.environ.update({
                "JOBHUNTER_STORE": "postgres", "DATABASE_URL": app_url, "JOBHUNTER_DATA": root,
                "JOBHUNTER_CAREER_DB": str(career), "OSHAL_USER_SUB": "reach-owner",
            })
            from jobhunter import db, match
            return exercise(db, match, read_only_corpus=lambda: None)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("sqlite", "postgres"), required=True)
    parser.add_argument("--admin-url", default=os.environ.get("CAREER_TEST_POSTGRES_ADMIN_URL"))
    args = parser.parse_args()
    report = run_sqlite() if args.backend == "sqlite" else run_postgres(args.admin_url)
    print("CAREER_MATCH_REACH=" + json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
