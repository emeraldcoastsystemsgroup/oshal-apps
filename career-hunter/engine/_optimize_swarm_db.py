"""Index + ANALYZE the multi-user swarm stores so the cockpit board is usable.

Measured on the live stack 2026-07-30 (corpus 1,333,466 postings / 607,864 active,
one user store with 1,172,769 signals), BEFORE this ran:

    board feed        33.7s     SEARCH pc USING idx_corpus_target + TEMP B-TREE FOR ORDER BY
    lane count        32.3s     SEARCH p USING idx_corpus_active   (active=1 is ~49% of rows)
    company roll-up  483.7s     CORRELATED SCALAR SUBQUERY, once per company x 1,240

...and GET /api/career-hunter/board simply timed out. Nothing was broken; the corpus had
only single-column indexes on low-cardinality flags, and `sqlite_stat1` was MISSING in
BOTH databases -- ANALYZE had never run, so the planner was choosing blind.

Same lesson as the native app's 07-29 pass: index the ACTUAL query shape and verify with
EXPLAIN, because a plausible-looking single-column index on a 50%-selective flag is worse
than no index at all.

Idempotent. Takes a write lock on both DBs, so do not run it against a live scrape.

    JOBHUNTER_MULTIUSER=1 OSHAL_USER_SUB=<sub> \
    JOBHUNTER_CORPUS_DB=.../corpus.db JOBHUNTER_USER_DB=.../user-<sub>.db \
    PYTHONPATH=<engine> python3 _optimize_swarm_db.py [--measure-only]
"""
from __future__ import annotations

import sys
import time

from jobhunter import config, db

# Verbatim shapes from routes/career-hunter-routes.js -- the queries the board actually
# runs, not approximations of them.
PROBES: list[tuple[str, str]] = [
    (
        "board feed",
        "SELECT pc.id, pc.title, us.ai_fit_score FROM corpus.postings_corpus pc "
        "JOIN user_signals us ON us.posting_id = pc.id "
        "WHERE pc.active=1 AND pc.target_role=1 AND us.ai_fit_score IS NOT NULL "
        "ORDER BY us.ai_fit_score DESC LIMIT 50",
    ),
    (
        "lane count",
        "SELECT COUNT(*) FROM corpus.postings_corpus p "
        "LEFT JOIN user_signals s ON s.posting_id = p.id "
        "WHERE p.active=1 AND COALESCE(p.target_role,0)=1",
    ),
    (
        "company roll-up",
        "SELECT c.name, (SELECT COUNT(*) FROM corpus.postings_corpus p "
        "WHERE p.company_id=c.id AND p.active=1) AS active_jobs "
        "FROM corpus.companies c ORDER BY active_jobs DESC LIMIT 20",
    ),
    (
        "fresh window",
        "SELECT COUNT(*) FROM corpus.postings_corpus "
        "WHERE first_seen_at >= date('now','-10 days')",
    ),
    (
        "status funnel",
        "SELECT status, COUNT(*) FROM user_signals "
        "WHERE status IS NOT NULL GROUP BY status",
    ),
]

# `corpus.` / `main.` prefixes are required: these are two ATTACHed databases.
INDEXES: list[tuple[str, str]] = [
    (
        "corpus.idx_corpus_lane",
        # The board's core predicate. Neither flag is selective alone -- active=1 is ~49%
        # of the table and target_role its own slice -- so the pre-existing single-column
        # idx_corpus_active / idx_corpus_target could never narrow this. Together they do.
        "CREATE INDEX IF NOT EXISTS corpus.idx_corpus_lane "
        "ON postings_corpus(active, target_role)",
    ),
    (
        "corpus.idx_corpus_company_active",
        # THE 483-second fix. The companies roll-up runs a correlated subquery per company
        # (`WHERE p.company_id=c.id AND p.active=1`), 1,240 times. Leading with company_id
        # turns each of those from an idx_corpus_active scan into a point lookup.
        "CREATE INDEX IF NOT EXISTS corpus.idx_corpus_company_active "
        "ON postings_corpus(company_id, active)",
    ),
    (
        "corpus.idx_corpus_seen",
        # Freshness. There was NO index on first_seen_at at all, while idx_corpus_posted
        # sat on posted_date -- the column ATS feeds omit for ~26% of rows, which makes any
        # "last N days" filter keyed to it quietly match almost nothing.
        "CREATE INDEX IF NOT EXISTS corpus.idx_corpus_seen "
        "ON postings_corpus(first_seen_at DESC)",
    ),
    (
        "main.idx_user_scored",
        # Serves ORDER BY ai_fit_score DESC while carrying posting_id, so the join back to
        # the corpus is covered. Partial: only rows that can appear on a scored board.
        "CREATE INDEX IF NOT EXISTS main.idx_user_scored "
        "ON user_signals(ai_fit_score DESC, posting_id) WHERE ai_fit_score IS NOT NULL",
    ),
    (
        "main.idx_user_status_posting",
        # The pipeline/funnel counts group by status; pairing posting_id keeps them
        # index-only instead of touching the table for every row.
        "CREATE INDEX IF NOT EXISTS main.idx_user_status_posting "
        "ON user_signals(status, posting_id)",
    ),
]


def measure(conn) -> dict[str, float]:
    out: dict[str, float] = {}
    for label, sql in PROBES:
        plan = " | ".join(r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql))
        t0 = time.perf_counter()
        conn.execute(sql).fetchall()
        dt = time.perf_counter() - t0
        out[label] = dt
        print(f"  {label:18s} {dt:8.2f}s   {plan[:130]}")
    return out


def main() -> int:
    measure_only = "--measure-only" in sys.argv
    if not config.MULTIUSER:
        print("Set JOBHUNTER_MULTIUSER=1 (this script is for the swarm layout).", file=sys.stderr)
        return 2

    print(f"corpus: {config.CORPUS_DB}")
    print(f"user  : {config.USER_DB}")
    with db.connect() as conn:
        conn.execute("PRAGMA cache_size = -524288")  # ~512 MB; keeps the builds off disk

        print("\n=== BEFORE ===")
        before = measure(conn)
        if measure_only:
            return 0

        print("\n=== BUILDING ===")
        for name, ddl in INDEXES:
            t0 = time.perf_counter()
            conn.execute(ddl)
            conn.commit()
            print(f"  {name:34s} {time.perf_counter()-t0:6.1f}s")

        # sqlite_stat1 was MISSING in both databases. Without it the planner guesses, and
        # it guessed wrong -- this is as load-bearing as the indexes themselves.
        print("\n=== ANALYZE (both attached databases) ===")
        for sch in ("main", "corpus"):
            t0 = time.perf_counter()
            conn.execute(f"ANALYZE {sch}")
            conn.commit()
            print(f"  ANALYZE {sch:8s} {time.perf_counter()-t0:6.1f}s")

        print("\n=== AFTER ===")
        after = measure(conn)

        print("\n=== DELTA ===")
        for label, _ in PROBES:
            b, a = before[label], after[label]
            print(f"  {label:18s} {b:8.2f}s -> {a:7.3f}s   {(b/a if a > 0 else float('inf')):8.0f}x")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
