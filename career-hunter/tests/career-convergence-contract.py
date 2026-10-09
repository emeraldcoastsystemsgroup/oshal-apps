# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the real loader and convergence reporter end to end: synthetic SQLite stores built from the engine schema, a disposable FORCE-RLS PostgreSQL database, two loader runs with zero observable change on replay, a green --require-convergence gate, cross-user key-query isolation, and exit 2 naming every dataset a mutation breaks.

"""Career convergence contract (loader + reporter across the real SQLite/PostgreSQL boundary).

Nothing here is doubled. The SQLite stores are built with the engine's own schema, the loader is
``scripts/migrate-sqlite-to-postgres.js`` run by node with the real ``pg`` and ``better-sqlite3``
drivers, the reporter is ``engine/sync/report_convergence.py``, and PostgreSQL is a disposable
database owned by a LOGIN NOSUPERUSER NOBYPASSRLS role with the package migrations applied.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "tests" / "helpers"))

from career_fixture import build_stores, run_loader, run_reporter  # noqa: E402
from career_pg import CUTOVER_MIGRATIONS, connect_as, disposable_postgres, scalar  # noqa: E402

OWNER_A = "convergence-owner-a"
OWNER_B = "convergence-owner-b"
APPLIED = 11


def _check(condition: bool, message: str, detail=None) -> None:
    """Fail the contract with a message the Node wrapper prints verbatim."""
    if not condition:
        suffix = "" if detail is None else f"\n{json.dumps(detail, indent=1, default=str)[:4000]}"
        raise AssertionError(message + suffix)


def _load(root: Path, app_url: str, node_path: str) -> None:
    result = run_loader(root, app_url, node_path)
    _check(result.returncode == 0, "loader failed", {"stdout": result.stdout, "stderr": result.stderr})


def _digests(report: dict) -> dict:
    """The PostgreSQL side of every digest: what a replay must leave unchanged."""
    out = {f"corpus.{k}": v["postgres"] for k, v in report["corpus"].items()}
    for sub, datasets in report["users"].items():
        for name, entry in datasets.items():
            if name != "keyQueries":
                out[f"{sub}.{name}"] = entry["postgres"]
    return out


def _converge(root: Path, app_url: str) -> dict:
    result, report = run_reporter(root, app_url, "--require-convergence")
    _check(result.returncode == 0 and report and report["converged"],
           "the loaded stores did not converge", {"stderr": result.stderr, "report": report})
    _check(report["failures"] == [], "a converged report still names failures", report["failures"])
    for sub in (OWNER_A, OWNER_B):
        _check(report["users"][sub]["interviews"]["postgresUnmapped"] == 0,
               f"{sub} has unmapped interviews", report["users"][sub]["interviews"])
    return report


def _prove_isolation(app_url: str, report: dict) -> dict:
    """Owner B's key queries and B's own RLS session never see owner A's rows."""
    b_queries = report["users"][OWNER_B]["keyQueries"]
    a_queries = report["users"][OWNER_A]["keyQueries"]
    _check(a_queries["appliedPostingIds"]["postgres"] == [APPLIED], "A's application missing", a_queries)
    _check(b_queries["appliedPostingIds"]["postgres"] == [], "B's key query saw A's application", b_queries)
    _check(all(row["status"] == "new" for row in b_queries["topActive"]["postgres"]),
           "B's board carries A's lifecycle status", b_queries["topActive"])
    conn = connect_as(app_url, sub=OWNER_B)
    try:
        seen = {
            "applications": scalar(conn, "SELECT COUNT(*) FROM career_user_applications"),
            "foreignScores": scalar(conn, "SELECT COUNT(*) FROM career_user_job_scores WHERE user_sub <> %s", (OWNER_B,)),
            "ownScores": scalar(conn, "SELECT COUNT(*) FROM career_user_job_scores"),
            "foreignRecruiters": scalar(conn, "SELECT COUNT(*) FROM career_user_recruiter_firms WHERE user_sub <> %s", (OWNER_B,)),
        }
    finally:
        conn.close()
    _check(seen["applications"] == 0 and seen["foreignScores"] == 0 and seen["foreignRecruiters"] == 0,
           "B's RLS session read A's rows", seen)
    _check(seen["ownScores"] == 3, "B's own scores are not visible to B", seen)
    return seen


def _mutate(app_url: str) -> None:
    """Break one dataset of each kind the reporter must name."""
    conn = connect_as(app_url, operator=True)
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE career_postings SET title = 'Mutated Title' WHERE id = 13")
            cur.execute("UPDATE career_user_job_scores SET ai_fit_score = 5 "
                        "WHERE user_sub = %s AND posting_id = 12", (OWNER_A,))
            cur.execute("DELETE FROM career_user_applications WHERE user_sub = %s", (OWNER_A,))
            cur.execute("INSERT INTO career_user_interview_assessments (user_sub, at, company, role, "
                        "transcript, result, finalized, source_id) "
                        "VALUES (%s, NOW(), 'Pre-103', 'Unmapped', 't', '{}', 0, NULL)", (OWNER_A,))
        conn.commit()
    finally:
        conn.close()


def run(admin_url: str, node_path: str) -> dict:
    """Execute the whole contract and return the evidence summary."""
    with tempfile.TemporaryDirectory(prefix="career-convergence-") as tmp:
        root = Path(tmp) / "default"
        build_stores(root, {OWNER_A: APPLIED, OWNER_B: None})
        with disposable_postgres(admin_url, CUTOVER_MIGRATIONS) as app_url:
            _load(root, app_url, node_path)
            first = _converge(root, app_url)
            operator = connect_as(app_url, operator=True)
            try:
                token = scalar(operator, "SELECT COUNT(*) FROM career_user_applications "
                               "WHERE apply_claim_token IS NOT NULL")
                run_id = scalar(operator, "SELECT apply_run_id::text FROM career_user_applications "
                                "WHERE user_sub = %s", (OWNER_A,))
                outbox_after_first = scalar(operator, "SELECT COUNT(*) FROM career_store_change_log")
                _load(root, app_url, node_path)
                outbox_after_replay = scalar(operator, "SELECT COUNT(*) FROM career_store_change_log")
            finally:
                operator.close()
            _check(token == 0, "the loader imported a live claim token", token)
            _check(run_id == "5f0f3c9a-9b7a-4c55-9d2c-0b8f7a1c2d3e", "durable Apply run id lost", run_id)
            _check(outbox_after_first == 0 and outbox_after_replay == 0,
                   "loader replay rows reached the reverse-sync outbox",
                   [outbox_after_first, outbox_after_replay])
            second = _converge(root, app_url)
            _check(_digests(first) == _digests(second), "the second loader run changed observable rows",
                   {"first": _digests(first), "second": _digests(second)})
            isolation = _prove_isolation(app_url, second)
            _mutate(app_url)
            broken, report = run_reporter(root, app_url, "--require-convergence")
        failed_line = next((line for line in broken.stderr.splitlines()
                            if line.startswith("CAREER_CONVERGENCE_FAILED=")), "")
        named = failed_line.split("=", 1)[1].split(",") if failed_line else []
        return {
            "firstDigests": _digests(first),
            "replayUnchanged": True,
            "isolation": isolation,
            "mutation": {"exit": broken.returncode, "named": named,
                         "reportFailures": (report or {}).get("failures")},
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--admin-url", default=os.environ.get("CAREER_TEST_POSTGRES_ADMIN_URL"))
    parser.add_argument("--node-path", default=os.environ.get("CAREER_LOADER_NODE_PATH"))
    args = parser.parse_args()
    if not args.admin_url or not args.node_path:
        parser.error("--admin-url and --node-path (pg + better-sqlite3) are required")
    summary = run(args.admin_url, args.node_path)
    print("CAREER_CONVERGENCE_CONTRACT=" + json.dumps(summary, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
