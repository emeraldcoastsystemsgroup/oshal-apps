# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Rehearse the BACKEND-CUTOVER.md promotion and rollback on disposable stores with the real commands: load twice, converge, read-only PostgreSQL smoke through the engine, engine writes on PostgreSQL, a rollback gate that refuses while a claim is outstanding or the projector lags, reverse catch-up, convergence, and an engine read back on SQLite that holds every post-cutover write. Then take real observation samples: in bounds with an archived report, and reset by a missing nightly marker and by a sample gap.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve the first observation's timestamp precision so its inclusive activity cutoff cannot precede writes committed during the same wall-clock second. The observer formats archive names separately.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Use a low-entropy synthetic claim-token UUID. The random-looking value bound to a token name matched gitleaks' generic-api-key rule (entropy ~3.95), so gate C of the public store cut refused this fixture; the value is still a valid version-4 UUID and every comparison reads the same constant.

"""Career cutover drill (disposable).

This is the runbook's promotion and rollback sequence with every step driven by the command the
runbook names: ``scripts/migrate-sqlite-to-postgres.js``, ``engine/sync/report_convergence.py``,
``engine/sync/reverse_sync.py`` and the engine itself under ``JOBHUNTER_STORE=postgres`` and then
``JOBHUNTER_STORE=sqlite``. It rehearses the procedure on synthetic stores; it does not replace the
operator's live drill (backups, quiescing real writers, canary cohorts).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "tests" / "helpers"))

from career_fixture import (OBSERVER, PROJECTOR, build_stores, child_env,  # noqa: E402
                            deterministic_ats, parse_marker, run_engine, run_loader,
                            run_projector, run_reporter)
from career_pg import CUTOVER_MIGRATIONS, connect_as, disposable_postgres, scalar  # noqa: E402

OWNER = "drill-owner-a"
OTHER = "drill-owner-b"
RUN_ID = "3c2b1a09-8f7e-4d6c-9b5a-4a3b2c1d0e9f"
TOKEN = "00000000-0000-4000-8000-00000000c0d1"
READ = (
    "import json\nfrom jobhunter import db\nwith db.connect() as conn:\n"
    "    rows = conn.execute('SELECT id, title, status, active, application_source, "
    "application_task_id FROM postings ORDER BY id').fetchall()\n"
    "    firms = conn.execute('SELECT id, firm, status FROM recruiter_firms ORDER BY id').fetchall()\n"
    "    print('DRILL_READ=' + json.dumps({'postings': [dict(r) for r in rows], "
    "'recruiters': [dict(r) for r in firms]}, default=str))\n"
)


def check(condition: bool, message: str, detail=None) -> None:
    if not condition:
        suffix = "" if detail is None else "\n" + json.dumps(detail, indent=1, default=str)[:6000]
        raise AssertionError(message + suffix)


class Drill:
    """One disposable promotion + rollback, step by step."""

    def __init__(self, root: Path, data: Path, app_url: str, node_path: str):
        self.root, self.data, self.app_url, self.node_path = root, data, app_url, node_path
        self.evidence: dict = {}

    # ── engine in either backend ────────────────────────────────────────────
    def engine_read(self, store: str) -> dict:
        extra = None
        if store == "sqlite":
            extra = {"JOBHUNTER_MULTIUSER": 1, "JOBHUNTER_CORPUS_DB": self.root / "corpus.db",
                     "JOBHUNTER_USER_DB": self.root / OWNER / f"user-{OWNER}.db"}
        result = run_engine(self.app_url, OWNER, READ, self.data, store=store, extra_env=extra)
        return parse_marker(result.stdout, "DRILL_READ=")

    def engine_stats(self, store: str) -> str:
        extra = None
        if store == "sqlite":
            extra = {"JOBHUNTER_MULTIUSER": 1, "JOBHUNTER_CORPUS_DB": self.root / "corpus.db",
                     "JOBHUNTER_USER_DB": self.root / OWNER / f"user-{OWNER}.db"}
        code = "from jobhunter import cli\ncli.cmd_stats(None)\n"
        stdout = run_engine(self.app_url, OWNER, code, self.data, store=store, extra_env=extra).stdout
        return _tie_insensitive(stdout)

    def engine_write(self, body: str) -> None:
        code = ("from types import SimpleNamespace\nfrom jobhunter import cli, db\n"
                + body.strip() + "\n")
        run_engine(self.app_url, OWNER, code, self.data)

    def outbox_count(self) -> int:
        conn = connect_as(self.app_url, operator=True)
        try:
            return scalar(conn, "SELECT COUNT(*) FROM career_store_change_log")
        finally:
            conn.close()

    def gate(self) -> tuple[int, list[str]]:
        """The rollback gate the runbook names: reverse_sync.py --check-rollback-ready."""
        result = subprocess.run(
            [sys.executable, str(PROJECTOR), "--data-root", str(self.root), "--database-url",
             self.app_url, "--check-rollback-ready"], capture_output=True, text=True,
            encoding="utf-8", timeout=120, env=child_env())
        metrics = parse_marker(result.stdout, "CAREER_REVERSE_SYNC=") or {}
        return result.returncode, metrics.get("blockers", [])

    def converge(self, label: str) -> dict:
        result, report = run_reporter(self.root, self.app_url, "--require-convergence")
        check(result.returncode == 0, f"{label}: convergence failed",
              {"failures": (report or {}).get("failures"), "stderr": result.stderr[-2000:]})
        return {"converged": report["converged"], "failures": report["failures"]}

    # ── promotion ────────────────────────────────────────────────────────────
    def promote(self) -> None:
        digests = []
        for attempt in (1, 2):
            loaded = run_loader(self.root, self.app_url, self.node_path)
            check(loaded.returncode == 0, f"loader run {attempt} failed", loaded.stderr)
            _, report = run_reporter(self.root, self.app_url, "--require-convergence")
            check(report and report["converged"], f"loader run {attempt} did not converge",
                  (report or {}).get("failures"))
            digests.append(_postgres_digests(report))
        check(digests[0] == digests[1], "the second loader run changed observable rows")
        self.evidence["promotion"] = {"loaderRuns": 2, "replayUnchanged": True,
                                      "outboxAfterLoads": self.outbox_count()}
        check(self.evidence["promotion"]["outboxAfterLoads"] == 0, "loader rows reached the outbox")
        self.smoke()

    def smoke(self) -> None:
        """Read-only PostgreSQL smoke through the engine equals the same read on SQLite."""
        before = self.outbox_count()
        pg_read, sqlite_read = self.engine_read("postgres"), self.engine_read("sqlite")
        pg_stats, sqlite_stats = self.engine_stats("postgres"), self.engine_stats("sqlite")
        check(pg_read == sqlite_read, "PostgreSQL smoke read differs from SQLite", [pg_read, sqlite_read])
        check(pg_stats == sqlite_stats, "engine stats differ between backends", [pg_stats, sqlite_stats])
        check(self.outbox_count() == before, "the read-only smoke wrote to PostgreSQL")
        self.evidence["smoke"] = {"postings": len(pg_read["postings"]), "statsEqual": True,
                                  "writes": 0}

    # ── PostgreSQL takes writes ──────────────────────────────────────────────
    def write_on_postgres(self) -> None:
        """Projector running, then scrape (new + deactivated postings) and an Apply with a claim."""
        started, metrics = run_projector(self.root, self.app_url, "--until-caught-up", "--interval", "0.2")
        check(started.returncode == 0 and metrics["caughtUp"], "projector did not start caught up")
        with deterministic_ats() as (ats_url, server):
            server.fixture_jobs = [
                {"id": "5001", "title": "Principal Cloud Engineer", "location": "Remote, US"},
                {"id": "5002", "title": "Site Reliability Engineer", "location": "Austin, TX"},
            ]
            self.engine_write(
                "with db.connect() as conn:\n"
                f"    db.upsert_company(conn, 'Drill Ats Co', source_list='drill', ats_type='htmllist', "
                f"ats_token='{ats_url}')\n"
                "cli.cmd_scrape(SimpleNamespace(company='Drill Ats Co', list=None, limit=None))")
            server.fixture_jobs = server.fixture_jobs[:1]
            self.engine_write("cli.cmd_scrape(SimpleNamespace(company='Drill Ats Co', list=None, limit=None))")
        self.engine_write(
            "with db.connect() as conn:\n"
            "    db.set_status(conn, 12, 'promoted')\n"
            "    db.set_status(conn, 12, 'generated', resume_path='applications/drill.pdf')\n"
            "    db.set_status(conn, 12, 'applied', application_source='verified-submission', "
            f"application_task_id='drill-apply', apply_run_id='{RUN_ID}', apply_claim_token='{TOKEN}')")
        self.evidence["postgresWrites"] = {"outboxRows": self.outbox_count()}

    # ── rollback ─────────────────────────────────────────────────────────────
    def rollback(self) -> None:
        stale = self.engine_read("sqlite")
        blocked_both = self.gate()
        self.engine_write("with db.connect() as conn:\n    db.user_set(conn, 12, apply_claim_token=None)")
        blocked_lag = self.gate()
        caught, metrics = run_projector(self.root, self.app_url, "--until-caught-up", "--interval", "0.2")
        check(caught.returncode == 0 and metrics["caughtUp"], "projector did not catch up", caught.stderr[-2000:])
        ready = self.gate()
        check(blocked_both == (2, ["projector-lag", "outstanding-claims"]),
              "the gate did not refuse an outstanding claim + lag", blocked_both)
        check(blocked_lag == (2, ["projector-lag"]), "the gate did not refuse projector lag", blocked_lag)
        check(ready == (0, []), "the gate refused a caught-up, claim-free store", ready)
        convergence = self.converge("rollback")
        rolled = self.engine_read("sqlite")
        self.evidence["rollback"] = {
            "gate": {"claimAndLag": blocked_both, "lag": blocked_lag, "ready": ready},
            "convergence": convergence, "projected": metrics["appliedRows"],
            "staleBeforeProjection": _summary(stale), "afterRollback": _summary(rolled),
        }
        self.no_stale_rollback(rolled)

    def no_stale_rollback(self, rolled: dict) -> None:
        """Every post-cutover write is in SQLite, read back through the engine on SQLite."""
        by_title = {row["title"]: row for row in rolled["postings"]}
        posting = next(row for row in rolled["postings"] if row["id"] == 12)
        check(posting["status"] == "applied" and posting["application_source"] == "verified-submission"
              and posting["application_task_id"] == "drill-apply", "the Apply made on PostgreSQL is missing", posting)
        check(by_title.get("Principal Cloud Engineer", {}).get("active") == 1
              and by_title.get("Site Reliability Engineer", {}).get("active") == 0,
              "scraped or deactivated postings are stale", rolled["postings"])
        from sqlite3 import connect as sqlite_connect

        conn = sqlite_connect(self.root / OWNER / f"user-{OWNER}.db")
        try:
            token_row = conn.execute("SELECT apply_run_id, apply_claim_token FROM user_signals "
                                     "WHERE posting_id = 12").fetchone()
        finally:
            conn.close()
        check(token_row == (RUN_ID, None), "run correlation lost or claim token projected", token_row)


    # ── seven-day observation (first samples) ────────────────────────────────
    def observe(self) -> None:
        """Sample in bounds, then prove a missing nightly marker and a sample gap reset the window."""
        # Activity uses this exact cutoff; rounding down can exclude completed writes.
        start = datetime.now(timezone.utc)
        marker = self.root / ".last-evening-run"
        marker.write_text(start.isoformat(), encoding="utf-8")
        first = self._observe(start)
        marker.unlink()
        missing = self._observe(start + timedelta(hours=1))
        marker.write_text((start + timedelta(hours=30)).isoformat(), encoding="utf-8")
        gap = self._observe(start + timedelta(hours=31))
        sample, window = first["result"]["sample"], first["result"]["window"]
        check(first["exit"] == 0 and sample["inBounds"] and window["startedAt"]
              and sample["archivedReport"] and sample["rls"]["ok"], "first sample not in bounds", first)
        check(missing["exit"] == 2 and missing["result"]["window"]["startedAt"] is None
              and missing["result"]["sample"]["violations"] == ["nightly-marker-missing"],
              "a missing nightly marker did not reset the window", missing)
        check(gap["exit"] == 2 and gap["result"]["window"]["resets"][-1]["reasons"] == ["missing-sample"],
              "a sample gap did not reset the window", gap)
        archive = self.root / "_cutover"
        self.evidence["observation"] = {
            "firstSample": {"inBounds": True, "activity": sample["activity"], "rls": sample["rls"],
                            "reverseSync": sample["reverseSync"]["caughtUp"],
                            "archivedReport": sample["archivedReport"]},
            "resets": [reset["reasons"] for reset in gap["result"]["window"]["resets"]],
            "archivedReports": sorted(p.name for p in (archive / "reports").iterdir()),
            "samples": len(list((archive / "samples").iterdir())),
        }

    def _observe(self, now: datetime) -> dict:
        result = subprocess.run(
            [sys.executable, str(OBSERVER), "--data-root", str(self.root), "--database-url",
             self.app_url, "--now", now.isoformat()], capture_output=True, text=True,
            encoding="utf-8", timeout=180, env=child_env())
        parsed = parse_marker(result.stdout, "CAREER_CUTOVER_OBSERVATION=")
        check(parsed is not None, "the observer printed no sample", result.stderr[-2000:])
        return {"exit": result.returncode, "result": parsed}


def _tie_insensitive(stats: str) -> str:
    """`stats` orders its per-ATS counts by count only, so equal counts print in whatever order
    each backend returns them. Sort the entries inside that one line; every number still counts."""
    lines = []
    for line in stats.splitlines():
        if line.startswith("By ATS:"):
            head, _, items = line.partition(":")
            line = head + ": " + ", ".join(sorted(item.strip() for item in items.split(",")))
        lines.append(line)
    return "\n".join(lines)


def _postgres_digests(report: dict) -> dict:
    out = {f"corpus.{k}": v["postgres"] for k, v in report["corpus"].items()}
    for sub, datasets in report["users"].items():
        out.update({f"{sub}.{k}": v["postgres"] for k, v in datasets.items() if k != "keyQueries"})
    return out


def _summary(read: dict) -> dict:
    posting = next((row for row in read["postings"] if row["id"] == 12), {})
    return {"posting12": posting.get("status"), "postings": len(read["postings"]),
            "activeDrillPostings": sorted(row["title"] for row in read["postings"]
                                          if row["title"] in ("Principal Cloud Engineer",
                                                              "Site Reliability Engineer")
                                          and row["active"] == 1)}


def run(admin_url: str, node_path: str) -> dict:
    """Run the whole drill on fresh disposable stores and return its evidence."""
    with tempfile.TemporaryDirectory(prefix="career-cutover-drill-") as tmp:
        root, data = Path(tmp) / "default", Path(tmp) / "engine"
        data.mkdir()
        build_stores(root, {OWNER: 11, OTHER: None})
        with disposable_postgres(admin_url, CUTOVER_MIGRATIONS) as app_url:
            drill = Drill(root, data, app_url, node_path)
            drill.promote()
            drill.write_on_postgres()
            drill.rollback()
            drill.observe()
            return drill.evidence


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--admin-url", default=os.environ.get("CAREER_TEST_POSTGRES_ADMIN_URL"))
    parser.add_argument("--node-path", default=os.environ.get("CAREER_LOADER_NODE_PATH"))
    args = parser.parse_args()
    if not args.admin_url or not args.node_path:
        parser.error("--admin-url and --node-path (pg + better-sqlite3) are required")
    evidence = run(args.admin_url, args.node_path)
    print("CAREER_CUTOVER_DRILL=" + json.dumps(evidence, sort_keys=True, default=str,
                                               separators=(",", ":")))


if __name__ == "__main__":
    main()
