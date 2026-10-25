# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Contract for the Career geographic search covering index, run against the production engine's connect() on real SQLite files: a writable corpus (the nightly ingest's private copy) gains idx_corpus_geo; a corpus without it that is read-only (the native kernel binds the published corpus read-only into every request sandbox) still connects, reads and keeps its rows, and stays without the index; a read-only corpus that already has it connects too.
"""Career geographic search index contract against the production engine (``jobhunter.db.connect``)."""
from __future__ import annotations

import json
import os
import sqlite3
import stat
import sys
import tempfile
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))
os.environ["JOBHUNTER_MULTIUSER"] = "1"
os.environ["JOBHUNTER_STORE"] = "sqlite"

from jobhunter import config, db  # noqa: E402

CHECKS: list[tuple[str, bool]] = []
INDEX = "idx_corpus_geo"


def check(name: str, condition: bool) -> None:
    CHECKS.append((name, bool(condition)))


def old_corpus(path: Path) -> None:
    """A corpus as published before the index existed: the engine's CORPUS_SCHEMA, one posting."""
    conn = sqlite3.connect(":memory:")
    conn.execute("ATTACH DATABASE ? AS corpus", (str(path),))
    conn.executescript(db.CORPUS_SCHEMA)
    conn.execute("INSERT INTO corpus.companies (id, name) VALUES (1, 'Fixture Co')")
    conn.execute("INSERT INTO corpus.postings_corpus (id, company_id, ats_job_id, active, target_role, state)"
                 " VALUES (1, 1, 'a', 1, 1, 'TX')")
    conn.execute("ANALYZE corpus")
    conn.commit()
    conn.close()


def has_index(path: Path) -> bool:
    conn = sqlite3.connect(":memory:", uri=True)
    conn.execute("ATTACH DATABASE ? AS corpus", (f"file:{path}?mode=ro",))
    try:
        return conn.execute("SELECT 1 FROM corpus.sqlite_master WHERE type='index' AND name=?",
                            (INDEX,)).fetchone() is not None
    finally:
        conn.close()


def engine_connect(corpus: Path, user: Path) -> int:
    """Open the store the way every engine command does; returns the in-lane count it reads."""
    config.CORPUS_DB = corpus
    config.USER_DB = user
    db._multiuser_inited.clear()
    with db.connect() as conn:
        return conn.execute("SELECT COUNT(*) FROM corpus.postings_corpus WHERE active=1 AND target_role=1").fetchone()[0]


def read_only(path: Path) -> None:
    path.chmod(stat.S_IRUSR | stat.S_IRGRP)


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        writable = root / "ingest" / "corpus.db"
        writable.parent.mkdir()
        old_corpus(writable)
        check("an old corpus has no geographic index", not has_index(writable))
        check("the ingest copy connects", engine_connect(writable, root / "ingest" / "user.db") == 1)
        check("a writable corpus gains the geographic index", has_index(writable))

        published = root / "published" / "corpus.db"
        published.parent.mkdir()
        old_corpus(published)
        read_only(published)
        try:
            count = engine_connect(published, root / "published" / "user.db")
            check("a read-only corpus without the index still connects and reads", count == 1)
        except Exception as err:  # the defect this contract guards: the schema step failing on a read-only corpus
            check(f"a read-only corpus without the index still connects and reads ({err})", False)
        check("a read-only corpus is left without the index", not has_index(published))

        read_only(writable)
        check("a read-only corpus with the index connects", engine_connect(writable, root / "ingest" / "user2.db") == 1)

    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}))


if __name__ == "__main__":
    main()
