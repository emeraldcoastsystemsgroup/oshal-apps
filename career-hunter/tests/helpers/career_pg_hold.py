# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Hold one disposable FORCE-RLS PostgreSQL database open for a Node route suite (1.26.0). The Node suites drive the COMPILED routes, the real runner and the engine child; the child reaches PostgreSQL through DATABASE_URL as the same LOGIN NOSUPERUSER NOBYPASSRLS role career_pg.disposable_postgres creates for the Python contracts. This process owns that database for the suite's lifetime and runs the suite's seed and read-back statements as a named owner or as the operator, so the suite needs no PostgreSQL driver of its own.

"""Serve one disposable Career PostgreSQL database to a Node suite over stdin/stdout.

Usage: python tests/helpers/career_pg_hold.py --admin-url <throwaway server admin URL>

Once the database exists and the base migrations are applied it prints one line
``CAREER_PG_HOLD={"url": <the application role's URL>}``. Every later stdin line is one JSON
request ``{"as": "<owner sub>" | null, "sql": "...", "params": [...]}`` (``as: null`` runs as the
operator); each answers one line ``CAREER_PG_REPLY={"rows": [...], "rowcount": n}`` or
``CAREER_PG_REPLY={"error": "..."}``. End of input drops the database and the role.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from career_pg import BASE_MIGRATIONS, connect_as, disposable_postgres  # noqa: E402


def _answer(payload: dict) -> None:
    """@description Print one reply line and flush it, so the Node side never waits on a buffer."""
    sys.stdout.write("CAREER_PG_REPLY=" + json.dumps(payload, default=str) + "\n")
    sys.stdout.flush()


def _run(app_url: str, request: dict) -> dict:
    """
    @description Run one statement bound as an owner (RLS applies) or as the operator.
    @param app_url - The application role's URL.
    @param request - {as, sql, params}.
    @returns {rows, rowcount}.
    """
    owner = request.get("as")
    conn = connect_as(app_url, sub=owner, operator=owner is None)
    try:
        with conn.cursor() as cur:
            cur.execute(request["sql"], request.get("params") or [])
            rows = []
            if cur.description:
                names = [column[0] for column in cur.description]
                rows = [dict(zip(names, row)) for row in cur.fetchall()]
            count = cur.rowcount
        conn.commit()
        return {"rows": rows, "rowcount": count}
    finally:
        conn.close()


def main() -> int:
    """@description Create the database, announce it, serve requests until stdin closes."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--admin-url", required=True)
    args = parser.parse_args()
    with disposable_postgres(args.admin_url, BASE_MIGRATIONS) as app_url:
        sys.stdout.write("CAREER_PG_HOLD=" + json.dumps({"url": app_url}) + "\n")
        sys.stdout.flush()
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                _answer(_run(app_url, json.loads(line)))
            except Exception as error:  # noqa: BLE001 — the suite reads the error and fails the case
                _answer({"error": f"{type(error).__name__}: {error}"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
