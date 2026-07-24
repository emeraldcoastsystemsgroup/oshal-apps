#!/usr/bin/env python3
"""
CHANGE LOG
-------------------------------------------------------------------------------
DATE/TIME           | AUTHOR                                      | DESCRIPTION
-------------------------------------------------------------------------------
2026-07-16 01:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Host orchestrator for the ONE-TIME Jobs-2026 -> swarm cutover. Snapshots the native jobs.db (sqlite backup API, safe mid-run), docker-cp's it into the api container, runs the natural-key merge (_merge_native.py) phase-by-phase with the applications/ + career_db + lessons file copy interleaved before the user phase, and verifies. GATED: does nothing destructive without --go; --dry runs preflight+backup only. Mirrors sync_jobs_to_swarm.py's snapshot/docker-cp approach but MERGES (never drop-and-mirror), so other users' stores are never disturbed.

USAGE (host, from repo root, cron should be quiescent):
  python apps/career-hunter/sync/migrate_cutover.py --dry     # preflight + backup only (no mutation)
  python apps/career-hunter/sync/migrate_cutover.py --go      # full cutover (after --dry passes + operator OK)
"""
from __future__ import annotations
import os, sys, subprocess, sqlite3, tempfile
from datetime import datetime, timezone

SUB = os.environ.get("CUTOVER_SUB", "")
API = os.environ.get("CUTOVER_API_CONTAINER", "oshal-local-api")
JOBS2026 = os.environ.get("CUTOVER_JOBS2026", r"C:\Users\you\OneDrive\Documents\Jobs 2026")
NATIVE_DB = os.path.join(JOBS2026, "job-hunter", "data", "jobs.db")
NATIVE_APPS = os.path.join(JOBS2026, "job-hunter", "applications")
NATIVE_CAREER_DB = os.path.join(JOBS2026, "_career-db", "career_db.json")
NATIVE_ENRICH = os.path.join(JOBS2026, "_career-db", "enrichment_log.jsonl")
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
STORE = "/app/output/career-hunter-data/default"
UDIR = f"{STORE}/{SUB}"
BACKUP_DIR = f"/app/output/career-hunter-data/_backups/cutover-{STAMP}"
ENGINE = "/app/apps/career-hunter/engine"

MERGE_ENV = [
    "-e", "JOBHUNTER_MULTIUSER=1", "-e", f"OSHAL_USER_SUB={SUB}", "-e", "OSHAL_TENANT=default",
    "-e", f"JOBHUNTER_CORPUS_DB={STORE}/corpus.db", "-e", f"JOBHUNTER_USER_DB={UDIR}/user-{SUB}.db",
    "-e", "CAREER_SRC_DB=/tmp/cutover-jobs.db", "-e", f"MERGE_BACKUP_DIR={BACKUP_DIR}",
]


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    print("  $ " + " ".join(cmd), flush=True)
    return subprocess.run(cmd, check=True, **kw)


def merge_phase(phase: str) -> None:
    run(["docker", "exec", *MERGE_ENV, API, "python3", f"{ENGINE}/_merge_native.py", phase])


def snapshot_and_copy() -> None:
    print(f"[cutover] snapshotting native jobs.db ({NATIVE_DB}) via backup API…", flush=True)
    tmp = os.path.join(tempfile.gettempdir(), f"cutover-jobs-{STAMP}.db")
    src = sqlite3.connect(f"file:{NATIVE_DB}?mode=ro", uri=True)
    dst = sqlite3.connect(tmp)
    with dst:
        src.backup(dst)
    src.close(); dst.close()
    print(f"[cutover] snapshot -> {tmp} ({os.path.getsize(tmp)//(1024*1024)} MB); copying into {API}…", flush=True)
    run(["docker", "cp", tmp, f"{API}:/tmp/cutover-jobs.db"])
    os.remove(tmp)


def copy_file_assets() -> None:
    # applications/ (contents into the existing dir — overwrite same names, keep swarm extras, delete nothing)
    print("[cutover] copying applications/ (1.1GB, ~1,600 packets)…", flush=True)
    run(["docker", "exec", API, "mkdir", "-p", f"{UDIR}/applications", f"{UDIR}/career-library"])
    run(["docker", "cp", f"{NATIVE_APPS}/.", f"{API}:{UDIR}/applications/"])
    # career_db.json — back up the swarm copy into the cutover backup dir, then bring native over
    run(["docker", "exec", API, "sh", "-lc",
         f"[ -f {UDIR}/career_db.json ] && cp {UDIR}/career_db.json {BACKUP_DIR}/career_db.swarm.json || true"])
    run(["docker", "cp", NATIVE_CAREER_DB, f"{API}:{UDIR}/career_db.json"])
    if os.path.exists(NATIVE_ENRICH):
        run(["docker", "cp", NATIVE_ENRICH, f"{API}:{UDIR}/enrichment_log.jsonl"])
    # lessons library (best-effort; skip any that aren't present)
    for rel in ["job-hunter/AUDIT-INFLATION-2026-06-11.md", "job-hunter/_autoapply/WORKER_BRIEF.md",
                "job-hunter/COOL_LEADS.md", "job-hunter/NIGHT-GRIND-REPORT.md", "job-hunter/applications/_auto_apply_trace.jsonl"]:
        src = os.path.join(JOBS2026, *rel.split("/"))
        if os.path.exists(src):
            run(["docker", "cp", src, f"{API}:{UDIR}/career-library/{os.path.basename(src)}"])


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "--dry"
    if mode not in ("--dry", "--go"):
        sys.exit("usage: migrate_cutover.py --dry | --go")
    print(f"[cutover] sub={SUB} api={API} mode={mode} stamp={STAMP}", flush=True)
    run(["docker", "exec", API, "mkdir", "-p", BACKUP_DIR])
    snapshot_and_copy()
    merge_phase("preflight")
    merge_phase("backup")
    if mode == "--dry":
        print("[cutover] --dry complete: preflight + backup PASSED, corpus/user NOT mutated. "
              "Review, then re-run with --go.", flush=True)
        return
    merge_phase("corpus")
    copy_file_assets()            # applications/ must land before the user phase (confirmation scan)
    merge_phase("user")
    merge_phase("verify")
    print(f"[cutover] COMPLETE + VERIFIED. Backups at {BACKUP_DIR}. "
          "Now disable the native 'JobHunter Overnight Chain' task (schtasks /change /disable + verify).", flush=True)


if __name__ == "__main__":
    main()
