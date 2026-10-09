# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the migration-106 outbox on the NOBYPASSRLS owner role and the reverse projector's fault-injection, replay, commit-order and fail-closed behaviour against real SQLite stores and disposable PostgreSQL.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Stop racing the cluster-wide txid horizon: every single projector pass now starts only after the horizon covers the rows just written (run_projector settles by default), and the commit-order pass waits until T_late is the oldest open transaction on the whole server, so a write transaction in another database (a sibling contract under the parallel glob, or anything else) delays the proof instead of failing it.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Use a low-entropy synthetic claim-token UUID. The random-looking value bound to a token name matched gitleaks' generic-api-key rule (entropy ~3.95), so gate C of the public store cut refused this fixture; the value is still a valid version-4 UUID and every comparison reads the same constant.

"""Career reverse-synchronization contract.

Part A proves the outbox itself: a committed owner write records exactly one row in the same
transaction, a rolled-back one records none, owners cannot read or forge other owners' rows, and
only an OPERATOR loader session may suppress capture.

Part B proves ``engine/sync/reverse_sync.py``: writes made through the real engine in PostgreSQL
mode are projected into the SQLite stores; killing the worker before the SQLite commit, after it,
and before the checkpoint commit all replay to a converged store without duplicates or lost
lifecycle evidence; a full replay from horizon 0 changes nothing; a transaction that commits AFTER a
later change_id is still projected; and every unmappable change stops the worker without moving
its checkpoint.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "tests" / "helpers"))

from career_fixture import (build_stores, run_engine, run_loader, run_projector,  # noqa: E402
                            run_reporter, sqlite_fingerprint, sqlite_rows)
from career_pg import (CUTOVER_MIGRATIONS, connect_as, disposable_postgres, scalar,  # noqa: E402
                       wait_for_horizon)

OWNER_A = "reverse-owner-a"
OWNER_B = "reverse-owner-b"
OWNERS = (OWNER_A, OWNER_B)
RUN_ID = "7d4c2b1a-0e9f-4a8b-9c7d-6e5f4a3b2c1d"
TOKEN = "00000000-0000-4000-8000-00000000c0d2"


def check(condition: bool, message: str, detail=None) -> None:
    """Fail with a message the Node wrapper prints verbatim."""
    if not condition:
        suffix = "" if detail is None else "\n" + json.dumps(detail, indent=1, default=str)[:6000]
        raise AssertionError(message + suffix)


def outbox(app_url: str, where: str = "TRUE", params=()) -> list[dict]:
    conn = connect_as(app_url, operator=True)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT change_id, table_name, owner_sub, row_key, operation, row_after "
                        f"FROM career_store_change_log WHERE {where} ORDER BY change_id", params)
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        conn.close()


def operator_sql(app_url: str, *statements, replay: bool = False) -> None:
    """Run statements as the operator; ``replay=True`` marks them as a SQLite replay (uncaptured)."""
    conn = connect_as(app_url, operator=True)
    try:
        with conn.cursor() as cur:
            if replay:
                cur.execute("SELECT set_config('oshal.career_change_origin','sqlite-replay',false)")
            for statement in statements:
                cur.execute(*statement) if isinstance(statement, tuple) else cur.execute(statement)
        conn.commit()
    finally:
        conn.close()


# ── Part A: the outbox on the NOBYPASSRLS role ───────────────────────────────────────────────
def _owner_write(app_url: str, sub: str, statement: str, params=(), commit=True, origin=None):
    conn = connect_as(app_url, sub=sub)
    try:
        with conn.cursor() as cur:
            if origin:
                cur.execute("SELECT set_config('oshal.career_change_origin', %s, false)", (origin,))
            cur.execute(statement, params)
        conn.commit() if commit else conn.rollback()
    finally:
        conn.close()


def prove_outbox(app_url: str) -> dict:
    """Commit, rollback, isolation, forgery and replay-marker behaviour of migration 106."""
    before = len(outbox(app_url))
    _owner_write(app_url, OWNER_A, "UPDATE career_user_job_scores SET fit_score = 99 "
                 "WHERE user_sub = %s AND posting_id = 11", (OWNER_A,))
    rows = outbox(app_url, "change_id > 0")[before:]
    check(len(rows) == 1 and rows[0]["table_name"] == "career_user_job_scores"
          and rows[0]["owner_sub"] == OWNER_A and rows[0]["operation"] == "UPDATE"
          and rows[0]["row_key"] == {"user_sub": OWNER_A, "posting_id": 11}
          and rows[0]["row_after"]["fit_score"] == 99, "a committed owner write did not record exactly one row", rows)
    _owner_write(app_url, OWNER_A, "UPDATE career_user_job_scores SET fit_score = 12 "
                 "WHERE user_sub = %s AND posting_id = 11", (OWNER_A,), commit=False)
    after_rollback = len(outbox(app_url))
    _owner_write(app_url, OWNER_A, "UPDATE career_user_job_scores SET fit_score = fit_score "
                 "WHERE user_sub = %s", (OWNER_A,))
    after_noop = len(outbox(app_url))
    _owner_write(app_url, OWNER_A, "UPDATE career_user_job_scores SET fit_score = 71 "
                 "WHERE user_sub = %s AND posting_id = 11", (OWNER_A,), origin="sqlite-replay")
    after_owner_marker = len(outbox(app_url))
    operator_sql(app_url, ("UPDATE career_user_job_scores SET fit_score = 71 WHERE user_sub = %s "
                           "AND posting_id = 11", (OWNER_B,)), replay=True)
    after_operator_replay = len(outbox(app_url))
    check([after_rollback, after_noop, after_owner_marker, after_operator_replay]
          == [before + 1, before + 1, before + 2, before + 2],
          "rollback, no-op, owner-marker or operator-replay capture is wrong",
          [before, after_rollback, after_noop, after_owner_marker, after_operator_replay])
    return {"committed": 1, "rolledBack": 0, "noop": 0, "ownerMarkerCaptured": True,
            "operatorReplayCaptured": False, "isolation": _prove_outbox_isolation(app_url)}


def _prove_outbox_isolation(app_url: str) -> dict:
    """Owners read nothing, cannot forge another owner's row, and cannot rewrite the log."""
    import psycopg2

    conn = connect_as(app_url, sub=OWNER_B)
    try:
        seen = scalar(conn, "SELECT COUNT(*) FROM career_store_change_log")
        checkpoints = scalar(conn, "SELECT COUNT(*) FROM career_reverse_sync_checkpoint")
        with conn.cursor() as cur:
            cur.execute("UPDATE career_store_change_log SET owner_sub = %s", (OWNER_B,))
            rewritten = cur.rowcount
            cur.execute("DELETE FROM career_store_change_log")
            deleted = cur.rowcount
        conn.commit()
        forged = "allowed"
        try:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO career_store_change_log (table_name, owner_sub, row_key, "
                            "operation, row_after) VALUES ('career_user_job_scores', %s, '{}', "
                            "'UPDATE', '{}')", (OWNER_A,))
            conn.commit()
        except psycopg2.Error as error:
            conn.rollback()
            forged = type(error).__name__
        bad_op = "allowed"
        try:
            operator_sql(app_url, "INSERT INTO career_store_change_log (table_name, row_key, "
                         "operation) VALUES ('career_postings', '{}', 'TRUNCATE')")
        except psycopg2.Error as error:
            bad_op = type(error).__name__
    finally:
        conn.close()
    result = {"visibleToOwner": seen, "checkpointsVisible": checkpoints, "rewritten": rewritten,
              "deleted": deleted, "forgedForeignOwner": forged, "unknownOperation": bad_op}
    check(seen == 0 and checkpoints == 0 and rewritten == 0 and deleted == 0
          and forged != "allowed" and bad_op != "allowed", "outbox isolation failed", result)
    return result


# ── Part B helpers ───────────────────────────────────────────────────────────────────────────
def checkpoint(app_url: str) -> dict:
    conn = connect_as(app_url, operator=True)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT horizon_txid, last_change_id, row_failures, last_error "
                        "FROM career_reverse_sync_checkpoint WHERE worker = 'career-reverse-sync'")
            row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()
    return {"horizon": row[0], "lastChangeId": row[1], "failures": row[2], "error": row[3]} \
        if row else {"horizon": 0, "lastChangeId": 0, "failures": 0, "error": None}


def converge(root: Path, app_url: str) -> None:
    result, report = run_reporter(root, app_url, "--require-convergence")
    check(result.returncode == 0, "stores did not converge after projection",
          {"failures": (report or {}).get("failures"), "stderr": result.stderr[-2000:]})


def catch_up(root: Path, app_url: str) -> dict:
    result, metrics = run_projector(root, app_url, "--until-caught-up", "--interval", "0.2")
    check(result.returncode == 0 and metrics and metrics["caughtUp"],
          "the projector did not catch up", {"stdout": result.stdout[-3000:], "stderr": result.stderr[-3000:]})
    return metrics


def passes(stderr: str) -> list[dict]:
    """The worker's structured pass-complete log lines."""
    out = []
    for line in stderr.splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("event") == "pass-complete":
            out.append(entry)
    return out


def engine(app_url: str, sub: str, data: Path, body: str) -> None:
    """Run engine calls as ``sub`` in PostgreSQL mode (``conn`` is db.connect())."""
    code = ("import json\nfrom jobhunter import db\nwith db.connect() as conn:\n"
            + "".join(f"    {line}\n" for line in body.strip().splitlines()))
    run_engine(app_url, sub, code, data)


# ── Part B: fault injection ──────────────────────────────────────────────────────────────────
ROUNDS = (
    ("before-sqlite-commit", OWNER_A,
     "db.set_status(conn, 12, 'generated', resume_path='applications/r12.pdf')\n"
     "db.user_set(conn, 11, notes='engine note')\n"
     "db.save_ai_fit(conn, 13, 91, 'engine rationale', ['go'], ['rust'], 'fixture-model')"),
    ("after-sqlite-commit", OWNER_A,
     "db.set_status(conn, 12, 'applied', application_source='verified-submission', "
     "application_task_id='drill-task', confirmation_path='applications/c12.html', "
     f"apply_run_id='{RUN_ID}', apply_claim_token='{TOKEN}')\n"
     "cid = db.upsert_company(conn, 'Engine Born Labs', source_list='engine')\n"
     "db.upsert_posting(conn, cid, {'ats_job_id': 'e-1', 'title': 'Staff Platform Engineer', "
     "'location': 'Remote, US', 'remote': 1})"),
    ("before-checkpoint-commit", OWNER_B,
     "conn.execute(\"UPDATE career_user_recruiter_firms SET status='Contacted', notes='engine' WHERE id=1\")\n"
     "conn.execute(\"UPDATE career_user_gap_themes SET status='answered', response='engine' WHERE key='kubernetes'\")"),
)


def fault_round(root: Path, app_url: str, data: Path, point: str, owner: str, body: str) -> dict:
    """Write through the engine, kill the worker at ``point``, then prove the replay converges."""
    engine(app_url, owner, data, body)
    before_sqlite = sqlite_fingerprint(root, OWNERS)
    before = checkpoint(app_url)
    killed, _ = run_projector(root, app_url, fault=point)
    after_kill = checkpoint(app_url)
    changed = sqlite_fingerprint(root, OWNERS) != before_sqlite
    check(killed.returncode == 86, f"{point}: the fault did not fire", killed.stderr[-2000:])
    check(after_kill["horizon"] == before["horizon"], f"{point}: checkpoint advanced before commit",
          [before, after_kill])
    check(changed == (point != "before-sqlite-commit"),
          f"{point}: SQLite state after the kill is wrong (changed={changed})")
    replay, metrics = run_projector(root, app_url, "--until-caught-up", "--interval", "0.2")
    check(replay.returncode == 0 and metrics["caughtUp"], f"{point}: replay failed", replay.stderr[-3000:])
    replayed = passes(replay.stderr)
    check(checkpoint(app_url)["horizon"] > before["horizon"], f"{point}: replay did not advance")
    converge(root, app_url)
    return {"point": point, "exit": killed.returncode, "sqliteChangedByKill": changed,
            "replaySkipped": sum(p.get("skipped", 0) for p in replayed),
            "replayApplied": sum(p.get("applied", 0) for p in replayed)}


def lifecycle(root: Path) -> dict:
    """Owner A's projected application: every lifecycle fact, no live claim token, no duplicate."""
    rows = sqlite_rows(root, OWNER_A, "SELECT status, generated_at, applied_at, resume_path, "
                       "application_source, application_task_id, confirmation_path, apply_run_id, "
                       "apply_claim_token FROM user_signals WHERE posting_id = 12")
    count = sqlite_rows(root, OWNER_A, "SELECT COUNT(*) AS n FROM user_signals")[0]["n"]
    postings = sqlite_rows(root, OWNER_A, "SELECT id, title, target_role FROM corpus.postings_corpus "
                           "WHERE ats_job_id = 'e-1'")
    recruiters = sqlite_rows(root, OWNER_B, "SELECT COUNT(*) AS n, MAX(notes) AS notes FROM recruiter_firms")
    check(len(rows) == 1, "posting 12 lost or duplicated", rows)
    row = rows[0]
    check(row["status"] == "applied" and row["generated_at"] and row["applied_at"]
          and row["application_source"] == "verified-submission"
          and row["application_task_id"] == "drill-task" and row["apply_run_id"] == RUN_ID
          and row["apply_claim_token"] is None, "lifecycle evidence was lost", row)
    check(len(postings) == 1 and postings[0]["target_role"] == 1, "engine-born posting wrong", postings)
    check(recruiters[0]["n"] == 1 and recruiters[0]["notes"] == "engine", "recruiter duplicated", recruiters)
    # Posting 11 carried a claim token in the pre-promotion SQLite snapshot; the projected
    # application must clear it rather than keep stale claim state.
    seeded = sqlite_rows(root, OWNER_A, "SELECT notes, apply_claim_token, application_source "
                         "FROM user_signals WHERE posting_id = 11")[0]
    check(seeded == {"notes": "engine note", "apply_claim_token": None,
                     "application_source": "verified-submission"}, "stale claim token kept", seeded)
    return {"application": row, "userSignals": count, "enginePosting": postings[0],
            "seededClaimCleared": seeded["apply_claim_token"] is None}


def full_replay(root: Path, app_url: str) -> dict:
    """Rewind the checkpoint to 0: every change replays and nothing in SQLite moves."""
    before = sqlite_fingerprint(root, OWNERS)
    operator_sql(app_url, "UPDATE career_reverse_sync_checkpoint SET horizon_txid = 0")
    result, metrics = run_projector(root, app_url, "--until-caught-up", "--interval", "0.2")
    replayed = passes(result.stderr)
    unchanged = sqlite_fingerprint(root, OWNERS) == before
    check(result.returncode == 0 and unchanged, "a full replay changed SQLite", result.stderr[-2000:])
    converge(root, app_url)
    return {"unchanged": unchanged, "applied": sum(p.get("applied", 0) for p in replayed),
            "skipped": sum(p.get("skipped", 0) for p in replayed), "metrics": metrics}


# ── Part B: commit order is not change_id order ──────────────────────────────────────────────
def commit_order(root: Path, app_url: str) -> dict:
    """A change with a LOWER change_id that commits LATER must still reach SQLite.

    T_early takes a transaction id first, T_late then writes owner A's recruiter (lower change_id)
    and stays open, T_early writes owner B's recruiter (higher change_id) and commits, and one more
    transaction (a later id than T_late) commits too, so the newest COMPLETED id is past T_late. A
    pass now may project B, but must not move its checkpoint past A's still-running transaction;
    once T_late commits, the next pass must deliver A's change.

    The horizon is cluster-wide, so before that pass the contract waits until T_late is the oldest
    transaction open anywhere on the server: the pass then sees exactly [checkpoint, T_late).
    """
    early, late = connect_as(app_url, sub=OWNER_B), connect_as(app_url, sub=OWNER_A)
    try:
        with early.cursor() as cur:
            cur.execute("SELECT txid_current()")
        with late.cursor() as cur:
            cur.execute("UPDATE career_user_recruiter_firms SET notes = 'late-commit' WHERE id = 1")
            cur.execute("SELECT txid_current()")
            late_txid = int(cur.fetchone()[0])
        with early.cursor() as cur:
            cur.execute("UPDATE career_user_recruiter_firms SET notes = 'early-commit' WHERE id = 1")
        early.commit()
        _owner_write(app_url, OWNER_B, "UPDATE career_user_gap_themes SET n_jobs = n_jobs + 1 "
                     "WHERE key = 'kubernetes'")
        settled = wait_for_horizon(app_url, equals=late_txid)
        first, _ = run_projector(root, app_url, settle=False)
        mid_a = sqlite_rows(root, OWNER_A, "SELECT notes FROM recruiter_firms WHERE id = 1")[0]["notes"]
        mid_b = sqlite_rows(root, OWNER_B, "SELECT notes FROM recruiter_firms WHERE id = 1")[0]["notes"]
        late.commit()
    finally:
        early.close()
        late.close()
    catch_up(root, app_url)
    end_a = sqlite_rows(root, OWNER_A, "SELECT notes FROM recruiter_firms WHERE id = 1")[0]["notes"]
    check(first.returncode == 0 and mid_b == "early-commit" and mid_a != "late-commit",
          "the first pass did not hold back the open transaction", [mid_a, mid_b])
    check(end_a == "late-commit", "a change committed after a higher change_id was lost", end_a)
    converge(root, app_url)
    return {"projectedWhileOpen": mid_b, "heldBack": mid_a, "deliveredAfterCommit": end_a,
            "firstPassHorizon": settled["horizon"] == late_txid}


# ── Part B: fail closed ──────────────────────────────────────────────────────────────────────
def _log_row(table: str, owner, key: dict, operation: str, after, version: int = 1) -> tuple:
    return ("INSERT INTO career_store_change_log (table_name, owner_sub, row_key, operation, "
            "row_after, schema_version) VALUES (%s, %s, %s::jsonb, %s, %s::jsonb, %s)",
            (table, owner, json.dumps(key), operation,
             None if after is None else json.dumps(after), version))


def _refusal(root: Path, app_url: str, name: str, fragment: str) -> dict:
    """Run the worker once and prove it stopped on ``fragment`` with nothing moved."""
    before_sqlite = sqlite_fingerprint(root, OWNERS)
    before = checkpoint(app_url)
    result, metrics = run_projector(root, app_url)
    after = checkpoint(app_url)
    check(result.returncode == 3 and fragment in (after["error"] or ""),
          f"{name}: the worker did not stop on {fragment!r}",
          {"error": after["error"], "stderr": result.stderr[-1500:]})
    check(after["horizon"] == before["horizon"] and sqlite_fingerprint(root, OWNERS) == before_sqlite,
          f"{name}: a refused window moved the checkpoint or SQLite")
    return {"case": name, "exit": result.returncode, "error": after["error"],
            "failuresCounted": after["failures"] - before["failures"],
            "metricsError": (metrics or {}).get("lastError")}


def _clear(app_url: str, where: str, *cleanup) -> None:
    operator_sql(app_url, f"DELETE FROM career_store_change_log WHERE {where}")
    if cleanup:
        operator_sql(app_url, *cleanup, replay=True)


def fail_closed(root: Path, app_url: str) -> list[dict]:
    """Each unmappable change stops the worker; removing it lets the worker continue."""
    cases = []
    operator_sql(app_url, _log_row("career_unknown_table", None, {"id": 1}, "INSERT", {"id": 1}))
    cases.append(_refusal(root, app_url, "unknown-table", "unknown table"))
    _clear(app_url, "table_name = 'career_unknown_table'")
    operator_sql(app_url, _log_row("career_postings", None, {"id": 11}, "UPDATE", {"id": 11}, 2))
    cases.append(_refusal(root, app_url, "schema-version", "schema version 2"))
    _clear(app_url, "schema_version = 2")
    operator_sql(app_url, "INSERT INTO career_user_job_scores (user_sub, posting_id, fit_score) "
                 "VALUES ('ghost-owner', 11, 50)")
    cases.append(_refusal(root, app_url, "missing-owner", "missing owner store"))
    _clear(app_url, "owner_sub = 'ghost-owner'",
           "DELETE FROM career_user_job_scores WHERE user_sub = 'ghost-owner'")
    cases.append(_collision_case(root, app_url))
    _owner_interview(app_url)
    cases.append(_refusal(root, app_url, "missing-source-id", "has no source_id"))
    _clear(app_url, "table_name = 'career_user_interview_assessments'",
           "DELETE FROM career_user_interview_assessments WHERE source_id IS NULL")
    cases.append(_schema_case(root, app_url))
    catch_up(root, app_url)
    converge(root, app_url)
    return cases


def _collision_case(root: Path, app_url: str) -> dict:
    """A PostgreSQL company whose name SQLite already holds under another id."""
    corpus = sqlite3.connect(":memory:")
    corpus.execute("ATTACH DATABASE ? AS corpus", (str(root / "corpus.db"),))
    corpus.execute("INSERT INTO corpus.companies (id, name) VALUES (900, 'Collision Co')")
    corpus.commit()
    operator_sql(app_url, "INSERT INTO career_companies (id, name) VALUES (901, 'Collision Co')")
    try:
        return _refusal(root, app_url, "source-key-collision", "source-key collision")
    finally:
        _clear(app_url, "table_name = 'career_companies' AND row_key = '{\"id\": 901}'::jsonb",
               "DELETE FROM career_companies WHERE id = 901")
        corpus.execute("DELETE FROM corpus.companies WHERE id = 900")
        corpus.commit()
        corpus.close()


def _owner_interview(app_url: str) -> None:
    """An owner-written interview with no SQLite source identity."""
    _owner_write(app_url, OWNER_A, "INSERT INTO career_user_interview_assessments (user_sub, at, "
                 "company, role, transcript, result, finalized) VALUES (%s, NOW(), 'Unmapped', "
                 "'Role', 't', '{}', 0)", (OWNER_A,))


def _schema_case(root: Path, app_url: str) -> dict:
    """A SQLite store whose target table lacks a column the change carries."""
    path = root / OWNER_B / f"user-{OWNER_B}.db"
    conn = sqlite3.connect(path)
    conn.execute("ALTER TABLE gap_themes RENAME COLUMN response TO response_moved")
    conn.commit()
    _owner_write(app_url, OWNER_B, "UPDATE career_user_gap_themes SET n_jobs = 9 WHERE key = 'kubernetes'")
    try:
        return _refusal(root, app_url, "sqlite-schema-mismatch", "schema mismatch")
    finally:
        conn.execute("ALTER TABLE gap_themes RENAME COLUMN response_moved TO response")
        conn.commit()
        conn.close()


def run(admin_url: str, node_path: str) -> dict:
    """Execute Part A and Part B against one disposable database and one synthetic store."""
    with tempfile.TemporaryDirectory(prefix="career-reverse-sync-") as tmp:
        root, data = Path(tmp) / "default", Path(tmp) / "engine"
        data.mkdir()
        build_stores(root, {OWNER_A: 11, OWNER_B: None})
        with disposable_postgres(admin_url, CUTOVER_MIGRATIONS) as app_url:
            loaded = run_loader(root, app_url, node_path)
            check(loaded.returncode == 0, "loader failed", loaded.stderr)
            outbox_part = prove_outbox(app_url)
            baseline = catch_up(root, app_url)
            converge(root, app_url)
            rounds = [fault_round(root, app_url, data, *spec) for spec in ROUNDS]
            evidence = lifecycle(root)
            replay = full_replay(root, app_url)
            order = commit_order(root, app_url)
            refusals = fail_closed(root, app_url)
            final = catch_up(root, app_url)
    return {"outbox": outbox_part, "baseline": baseline, "rounds": rounds, "lifecycle": evidence,
            "fullReplay": replay, "commitOrder": order, "failClosed": refusals, "final": final}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--admin-url", default=os.environ.get("CAREER_TEST_POSTGRES_ADMIN_URL"))
    parser.add_argument("--node-path", default=os.environ.get("CAREER_LOADER_NODE_PATH"))
    args = parser.parse_args()
    if not args.admin_url or not args.node_path:
        parser.error("--admin-url and --node-path (pg + better-sqlite3) are required")
    summary = run(args.admin_url, args.node_path)
    print("CAREER_REVERSE_SYNC_CONTRACT=" + json.dumps(summary, sort_keys=True, default=str,
                                                       separators=(",", ":")))


if __name__ == "__main__":
    main()
