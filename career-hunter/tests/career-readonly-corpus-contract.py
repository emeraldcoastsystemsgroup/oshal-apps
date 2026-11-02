# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | A scoring pass on a shared read-only corpus keeps the person's scores: SQLite's real refusal on a read-only attach, not a double.
"""Enrichment of a read-only corpus is skipped and any other failure still raises (``jobhunter.db``)."""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))
os.environ["JOBHUNTER_MULTIUSER"] = "1"
os.environ["JOBHUNTER_STORE"] = "sqlite"

from jobhunter import db  # noqa: E402

CHECKS: list[tuple[str, bool]] = []


def check(name: str, condition: bool) -> None:
    CHECKS.append((name, bool(condition)))


def corpus_file(folder: str) -> str:
    path = os.path.join(folder, "corpus.db")
    made = sqlite3.connect(path)
    made.execute("CREATE TABLE postings_corpus (id INTEGER PRIMARY KEY, salary_min REAL, salary_max REAL, "
                 "salary_currency TEXT, salary_period TEXT, salary_source TEXT)")
    made.execute("INSERT INTO postings_corpus (id) VALUES (7)")
    made.commit()
    made.close()
    return path


def opened(path: str, mode: str) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute(f"ATTACH DATABASE 'file:{path}?mode={mode}' AS corpus")
    conn.execute("CREATE TABLE user_signals (posting_id INTEGER, ai_fit_score INTEGER)")
    return conn


def main() -> int:
    db.read_postings_table = lambda: "corpus.postings_corpus"
    db.corpus_table = lambda: "corpus.postings_corpus"
    with tempfile.TemporaryDirectory() as folder:
        path = corpus_file(folder)
        conn = opened(path, "ro")
        check("a read-only corpus refuses the salary estimate without raising",
              db.save_salary_estimate(conn, 7, 100000, 140000) is False)
        conn.execute("INSERT INTO user_signals VALUES (7, 88)")
        check("the person's score in the same connection stands",
              conn.execute("SELECT ai_fit_score FROM user_signals").fetchone()[0] == 88)
        check("the corpus row is untouched",
              conn.execute("SELECT salary_min FROM corpus.postings_corpus").fetchone()[0] is None)
        try:
            db.enrich_corpus(conn, "UPDATE corpus.no_such_table SET x=1")
            check("another failure still raises", False)
        except sqlite3.OperationalError:
            check("another failure still raises", True)
        conn.close()
        conn = opened(path, "rw")
        check("a writable corpus takes the estimate", db.save_salary_estimate(conn, 7, 100000, 140000) is True)
        check("and holds it", conn.execute("SELECT salary_min FROM corpus.postings_corpus").fetchone()[0] == 100000)
        conn.close()
    print(json.dumps({"checks": CHECKS}))
    return 0 if all(ok for _, ok in CHECKS) else 1


if __name__ == "__main__":
    sys.exit(main())
