#!/usr/bin/env python3
"""
One-way nightly sync: the OneDrive job-hunter `jobs.db` (the user's source of truth, which
keeps scraping in parallel) -> the swarm career-hunter corpus + per-user signals.

The swarm copy is DISPOSABLE: each run rebuilds it to an exact mirror of jobs.db, so the
swarm jobs board stays current without the swarm doing any scraping of its own.

Flow (no writes to jobs.db — read-only snapshot):
  1. Take a CONSISTENT snapshot of jobs.db via the sqlite backup API (safe even while the
     old system is mid-scrape; folds in any WAL).
  2. docker cp the snapshot into the running oshal-local-api container.
  3. Drop the stale swarm corpus.db + this user's user-<sub>.db, then run the engine's
     _seed_corpus.py against the snapshot -> exact mirror (companies + objective postings
     into corpus.db; this user's fit/AI/status/recruiters into user-<sub>.db).
  4. Clean up the in-container + host snapshot.

Idempotent and safe to run on a schedule. Requires Docker Desktop running and the
oshal-local-api container up.
"""
import os
import sqlite3
import subprocess
import sys
import tempfile

# --- config (override via env) ------------------------------------------------
SRC = os.environ.get("JOBS_DB", r"C:\Users\you\OneDrive\Documents\Jobs 2026\job-hunter\data\jobs.db")
CONTAINER = os.environ.get("OSHAL_API_CONTAINER", "oshal-local-api")
USER_SUB = os.environ.get("OSHAL_USER_SUB", "")
BASE = "/app/output/career-hunter-data/default"
CORPUS = f"{BASE}/corpus.db"
USERDB = f"{BASE}/{USER_SUB}/user-{USER_SUB}.db"
ENGINE = "/app/apps/career-hunter/engine"


def run(cmd, **kw):
    print("  +", " ".join(cmd), flush=True)
    return subprocess.run(cmd, check=True, **kw)


def main():
    # DEPRECATED (2026-07 Jobs-2026 cutover). This DROP-AND-MIRROR (`rm -f corpus.db`) re-points
    # every OTHER user's `user_signals.posting_id` against a different id-space and orphans their
    # scores. Once the swarm is multi-user it must never run. Use _merge_native.py (natural-key
    # MERGE) instead. Guard: refuse when more than one real user store exists.
    try:
        default_dir = os.path.dirname(os.path.dirname(USERDB))  # .../default
        listing = subprocess.run(["docker", "exec", CONTAINER, "sh", "-lc", f"ls -1 {default_dir}"],
                                  capture_output=True, text=True, timeout=30).stdout.split()
        users = [d for d in listing if not d.startswith("_") and d not in ("corpus.db", "mock-user-001")]
        if len(users) > 1:
            sys.exit("DEPRECATED + REFUSED: drop-and-mirror would orphan other users' signals "
                     f"({len(users)} user stores: {users}). The swarm is the system of record now — "
                     "use apps/career-hunter/engine/_merge_native.py (natural-key merge).")
    except subprocess.SubprocessError:
        sys.exit("DEPRECATED: could not verify single-user safety — refusing. Use _merge_native.py.")

    if not os.path.exists(SRC):
        sys.exit(f"FATAL: source jobs.db not found: {SRC}")

    snap = os.path.join(tempfile.gettempdir(), "jobs-swarm-snapshot.db")
    print(f"[1/5] consistent snapshot of jobs.db -> {snap}", flush=True)
    src = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True, timeout=300)
    try:
        dst = sqlite3.connect(snap)
        with dst:
            src.backup(dst)
        dst.close()
    finally:
        src.close()
    size_gb = os.path.getsize(snap) / 1e9
    print(f"      snapshot {size_gb:.2f} GB", flush=True)

    print(f"[2/5] copy snapshot into {CONTAINER}:/tmp/jobs.db", flush=True)
    run(["docker", "cp", snap, f"{CONTAINER}:/tmp/jobs.db"])

    print(f"[3/5] rebuild swarm corpus + user {USER_SUB} signals (exact mirror)", flush=True)
    run(["docker", "exec", CONTAINER, "sh", "-c", f"rm -f '{CORPUS}' '{USERDB}'"])
    seed_env = (
        f"JOBHUNTER_MULTIUSER=1 OSHAL_USER_SUB={USER_SUB} "
        f"JOBHUNTER_CORPUS_DB={CORPUS} JOBHUNTER_USER_DB={USERDB} "
        f"CAREER_SRC_DB=/tmp/jobs.db"
    )
    run(["docker", "exec", CONTAINER, "sh", "-c", f"cd {ENGINE} && {seed_env} python _seed_corpus.py"])

    print("[4/5] cleanup", flush=True)
    run(["docker", "exec", CONTAINER, "sh", "-c", "rm -f /tmp/jobs.db"])
    try:
        os.remove(snap)
    except OSError:
        pass

    print("[5/5] swarm jobs corpus synced from jobs.db.", flush=True)


if __name__ == "__main__":
    main()
