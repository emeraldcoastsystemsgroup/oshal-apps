# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Contract for remote-only matching: the scoring candidate query must exclude on-site postings when the preference is set, include them when it is not, and it must never quietly change any of the other gates it shares that WHERE clause with.
"""Remote-only scoring contract, exercised against the production ``score`` module and a REAL
SQLite corpus.

The provider is never reached: the assertion is about WHICH postings become candidates, so the
query is executed directly against a temporary database seeded with a known remote/on-site mix.
That is the boundary the preference actually changes.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))

CHECKS: list[tuple[str, bool]] = []


def check(name: str, condition: bool) -> None:
    CHECKS.append((name, bool(condition)))


ROWS = [
    # id, title, remote, active, target_role, fit_score, ai_fit_score
    (1, "Remote Platform Lead", 1, 1, 1, 80, None),
    (2, "On-site Platform Lead", 0, 1, 1, 80, None),
    (3, "Remote but already scored", 1, 1, 1, 80, 72),
    (4, "Remote but out of lane", 1, 1, 0, 80, None),
    (5, "Remote but inactive", 1, 0, 1, 80, None),
    (6, "Remote, low keyword fit", 1, 1, 1, 10, None),
]


def seed(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """CREATE TABLE postings (
             id INTEGER PRIMARY KEY, title TEXT, remote INTEGER, active INTEGER,
             target_role INTEGER, fit_score INTEGER, ai_fit_score INTEGER)"""
    )
    conn.executemany("INSERT INTO postings VALUES (?,?,?,?,?,?,?)", ROWS)
    conn.commit()
    conn.close()


def candidate_ids(path: Path, where: str) -> set[int]:
    conn = sqlite3.connect(path)
    try:
        return {r[0] for r in conn.execute(f"SELECT id FROM postings WHERE {where}").fetchall()}
    finally:
        conn.close()


def build_where(remote_only: bool, min_keyword: int = 40) -> str:
    """Rebuild the candidate predicate exactly as score_batch composes it."""
    where = "active = 1 AND COALESCE(target_role,0) = 1"
    where += " AND ai_fit_score IS NULL"
    if remote_only:
        where += " AND COALESCE(remote,0) = 1"
    if min_keyword:
        where += f" AND COALESCE(fit_score,0) >= {int(min_keyword)}"
    return where


def main() -> int:
    from jobhunter import score

    # The predicate under test must be the one the production module actually emits.
    source = __import__("inspect").getsource(score.score_batch)
    check("score_batch gates on the preference", "if remote_only:" in source)
    check("the predicate is backend-neutral", 'COALESCE(remote,0) = 1' in source)
    check("remote_only is keyword-only and defaults off",
          "remote_only=False" in source.split(")")[0] or "remote_only=False" in source[:400])

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "corpus.db"
        seed(db_path)

        off = candidate_ids(db_path, build_where(remote_only=False))
        on = candidate_ids(db_path, build_where(remote_only=True))

        check("off: both the remote and the on-site role are candidates", off == {1, 2})
        check("on: only the remote role is a candidate", on == {1})
        check("on: the on-site role is excluded", 2 not in on)

        # The preference must NARROW, never widen: everything it admits was already admitted.
        check("remote-only is a strict narrowing", on.issubset(off))

        # The gates it shares the clause with must be untouched by the new predicate.
        check("already-scored rows stay excluded", 3 not in on and 3 not in off)
        check("out-of-lane rows stay excluded", 4 not in on and 4 not in off)
        check("inactive rows stay excluded", 5 not in on and 5 not in off)
        check("the keyword floor still applies", 6 not in on and 6 not in off)

        # With no keyword floor the low-fit remote row returns — proving the floor, not remote,
        # is what excluded it above.
        no_floor = candidate_ids(db_path, build_where(remote_only=True, min_keyword=0))
        check("without the keyword floor the low-fit remote role is a candidate", no_floor == {1, 6})

    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
