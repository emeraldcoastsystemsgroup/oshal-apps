# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | An engine read opens a person's store on a real read-only file in rollback mode, still marked WAL, and in an older shape, and leaves its bytes alone.
"""``jobhunter.db.connect`` against files this process really cannot write."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def shape(path: Path, name: str) -> None:
    conn = sqlite3.connect(path)
    if name == "older":
        conn.execute("ALTER TABLE user_signals DROP COLUMN ai_input_fingerprint")
        conn.execute("DROP TABLE gap_themes")
    conn.execute(f"PRAGMA journal_mode = {'WAL' if name == 'still-wal' else 'DELETE'}")
    conn.close()


def main() -> int:
    root = Path(tempfile.mkdtemp(prefix="career-read-only-store-"))
    corpus_dir, built = root / "corpus", root / "built"
    corpus_dir.mkdir(); built.mkdir()
    os.environ.update({
        "JOBHUNTER_STORE": "sqlite", "JOBHUNTER_MULTIUSER": "1", "JOBHUNTER_DATA": str(built),
        "JOBHUNTER_CORPUS_DB": str(corpus_dir / "corpus.db"), "JOBHUNTER_USER_DB": str(built / "user-owner.db"),
        "OSHAL_USER_SUB": "owner",
    })
    from jobhunter import config, db, gaps
    db.init_db()
    with db.connect() as conn:
        company = db.upsert_company(conn, "Read Fixture", source_list="contract")
        conn.execute(f"INSERT INTO {db.corpus_table()} (company_id, ats_job_id, title, url, first_seen_at, last_seen_at, active) "
                     "VALUES (?,?,?,?,?,?,1)", (company, "1", "Architect", "https://example.test/1", "2026-11-04", "2026-11-04"))
        posting = conn.execute("SELECT id FROM postings").fetchone()["id"]
        db.user_set(conn, posting, fit_score=77)
        gaps.ensure_table(conn)
        conn.commit()
    (corpus_dir / "corpus.db").chmod(0o444); corpus_dir.chmod(0o555)
    results, frozen = {}, []
    for name in ("rollback", "still-wal", "older"):
        folder = root / name
        folder.mkdir()
        store = folder / "user-owner.db"
        with sqlite3.connect(built / "user-owner.db") as live:
            live.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        shutil.copyfile(built / "user-owner.db", store)
        shape(store, name)
        store.chmod(0o444); folder.chmod(0o555); frozen.append(folder)
        before = digest(store)
        config.USER_DB, config.DATA_DIR = store, folder
        db._multiuser_inited.clear()
        with db.connect() as conn:
            fit = conn.execute("SELECT fit_score FROM postings").fetchone()["fit_score"]
        results[name] = {"fit": fit, "scanned": gaps.is_scanned(), "unchanged": digest(store) == before,
                         "leftBeside": sorted(p.name for p in folder.iterdir() if p.name != store.name)}
    print("CAREER_READ_ONLY_STORE=" + json.dumps(results, sort_keys=True))
    db._portable_paths.clear()
    corpus_dir.chmod(0o755)
    for folder in frozen:
        folder.chmod(0o755)
    shutil.rmtree(root, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
