# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Share one disposable FORCE-RLS PostgreSQL database helper across the Career storage, convergence, reverse-sync and cutover-drill contracts, so every PostgreSQL proof runs as the same LOGIN NOSUPERUSER NOBYPASSRLS owner role the engine uses.
# 2 | maintainer@emeraldcoastsystemsgroup.com | The projector's txid horizon is cluster-wide, so a write transaction in ANY database on the shared server (a sibling contract run by the parallel node --test glob, or anything else) held single-pass assertions below the rows just written. disposable_postgres now serialises the contracts on one server with a session advisory lock on the admin connection, and wait_for_horizon lets a contract wait (bounded, named on timeout) until the horizon covers what it wrote.

"""Disposable PostgreSQL for the Career contracts.

Every contract receives an ADMIN URL (CI's service container, or a throwaway local container).
The helper never uses it for application work: it creates a short-lived database owned by a
LOGIN, NOSUPERUSER, NOBYPASSRLS role, applies the package migrations AS THAT ROLE, yields the
role's URL, and drops both afterwards. FORCE ROW LEVEL SECURITY therefore applies to every query
the contracts make, exactly as it does to the api role in a deployment.

The reverse projector's checkpoint is ``txid_snapshot_xmin(txid_current_snapshot())``, and that
horizon is CLUSTER-WIDE: an open write transaction in any database on the server holds it. Two
guards keep the contracts deterministic on a shared server. ``disposable_postgres`` holds a
session advisory lock on the admin database for its whole lifetime, so the Career contracts that
the parallel ``node --test`` glob starts together take the server one at a time; and
``wait_for_horizon`` waits, bounded, until the horizon covers the rows a contract just wrote, so a
transient transaction from anything else only delays an assertion instead of failing it.
"""
from __future__ import annotations

import os
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit


PACKAGE_ROOT = Path(__file__).resolve().parents[2]

# One advisory-lock key for every Career contract on a server (advisory locks are per database;
# every contract locks on the admin URL's database, so they share it).
SERVER_LOCK_SQL = "hashtext('oshal.career-hunter.contract-server')"
# Bounds, in seconds, overridable for a slow runner. The server lock waits for the siblings the
# glob started alongside this contract; the horizon wait outlasts a transient foreign transaction.
# The lock bound stays under the 600 s each contract wrapper allows its child, so a stuck server
# fails with the named message below rather than a bare child timeout.
SERVER_LOCK_SECONDS = float(os.environ.get("CAREER_TEST_SERVER_LOCK_SECONDS", "480"))
HORIZON_WAIT_SECONDS = float(os.environ.get("CAREER_TEST_HORIZON_WAIT_SECONDS", "120"))
POLL_SECONDS = 0.2

# The storage contract's historical set: the shared corpus, the per-user FORCE-RLS tables,
# the compatibility views and every application/interview identity migration.
BASE_MIGRATIONS = (
    "031-career-hunter.sql",
    "095-career-corpus.sql",
    "096-career-corpus-complete.sql",
    "097-career-postings-view.sql",
    "098-career-peruser-views.sql",
    "100-career-application-provenance.sql",
    "101-career-apply-claim-lease.sql",
    "102-career-apply-run-binding.sql",
    "103-career-interview-source-identity.sql",
)
# The reverse-synchronization outbox and its transaction-local capture triggers.
CUTOVER_MIGRATIONS = BASE_MIGRATIONS + ("106-career-store-change-log.sql",)


def app_database_url(admin_url: str, database: str, role: str, password: str) -> str:
    """Return a URL for ``role`` on ``database`` at the admin URL's host and port."""
    parsed = urlsplit(admin_url)
    host = parsed.hostname or "127.0.0.1"
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{quote(role)}:{quote(password)}@{host}{port}"
    return urlunsplit((parsed.scheme, netloc, f"/{database}", parsed.query, ""))


def apply_migrations(app_url: str, migrations=CUTOVER_MIGRATIONS) -> None:
    """Apply package migrations as the application role, in the order given."""
    import psycopg2

    app = psycopg2.connect(app_url)
    try:
        with app.cursor() as cur:
            for name in migrations:
                cur.execute((PACKAGE_ROOT / "migrations" / name).read_text(encoding="utf-8"))
        app.commit()
    finally:
        app.close()


def hold_server(admin, seconds: float = SERVER_LOCK_SECONDS) -> float:
    """Take the Career contract server lock on an autocommit admin connection; bounded.

    A session advisory lock assigns no transaction id, so holding it never moves the horizon; it
    is released when the admin connection closes. Returns the seconds spent waiting.
    """
    started = time.monotonic()
    while True:
        with admin.cursor() as cur:
            cur.execute(f"SELECT pg_try_advisory_lock({SERVER_LOCK_SQL})")
            if cur.fetchone()[0]:
                return time.monotonic() - started
        if time.monotonic() - started > seconds:
            raise TimeoutError(f"another Career contract held the PostgreSQL server for {seconds:.0f}s "
                               "(CAREER_TEST_SERVER_LOCK_SECONDS)")
        time.sleep(POLL_SECONDS)


@contextmanager
def disposable_postgres(admin_url: str, migrations=CUTOVER_MIGRATIONS):
    """Create an isolated non-superuser database, apply migrations, then remove both.

    The admin connection holds the contract server lock from before the database exists until
    after it is dropped, so no other Career contract writes on this server meanwhile.
    """
    import psycopg2
    from psycopg2 import sql

    suffix = uuid.uuid4().hex[:12]
    database = f"career_contract_{suffix}"
    role = f"career_contract_role_{suffix}"
    password = uuid.uuid4().hex
    admin = psycopg2.connect(admin_url)
    admin.autocommit = True
    try:
        hold_server(admin)
        with admin.cursor() as cur:
            cur.execute(
                sql.SQL("CREATE ROLE {} LOGIN PASSWORD %s NOSUPERUSER NOCREATEDB NOCREATEROLE "
                        "NOINHERIT NOBYPASSRLS").format(sql.Identifier(role)),
                (password,),
            )
            cur.execute(
                sql.SQL("CREATE DATABASE {} OWNER {}")
                .format(sql.Identifier(database), sql.Identifier(role))
            )
        app_url = app_database_url(admin_url, database, role, password)
        apply_migrations(app_url, migrations)
        yield app_url
    finally:
        with admin.cursor() as cur:
            cur.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname=%s AND pid <> pg_backend_pid()",
                (database,),
            )
            cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(database)))
            cur.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(role)))
        admin.close()


def connect_as(app_url: str, *, sub: str | None = None, operator: bool = False):
    """Open a connection bound the way the engine binds one: an owner subject, or the operator."""
    import psycopg2

    conn = psycopg2.connect(app_url)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT set_config('oshal.current_sub', %s, false), "
            "set_config('oshal.is_operator', %s, false)",
            (sub or "", "on" if operator else "off"),
        )
    conn.commit()
    return conn


def scalar(conn, query: str, params=()):
    """Run one query and return the first column of its first row."""
    with conn.cursor() as cur:
        cur.execute(query, params)
        row = cur.fetchone()
    conn.commit()
    return None if row is None else row[0]


def wait_for_horizon(app_url: str, *, equals: int | None = None,
                     seconds: float = HORIZON_WAIT_SECONDS) -> dict:
    """Wait until the projector's horizon covers what the caller wrote; bounded.

    By default: until ``txid_snapshot_xmin(txid_current_snapshot())`` is past the highest txid in
    the committed outbox, so one projector pass is guaranteed to see every row written so far.
    With ``equals``: until the horizon is exactly that txid, i.e. that still-open transaction is
    the oldest one running anywhere on the server. The horizon is cluster-wide, so what it waits
    out may be a write transaction in a different database. Returns the values it settled on.
    """
    started = time.monotonic()
    conn = connect_as(app_url, operator=True)
    try:
        while True:
            with conn.cursor() as cur:
                cur.execute("SELECT txid_snapshot_xmin(txid_current_snapshot()), "
                            "(SELECT COALESCE(MAX(txid), 0) FROM career_store_change_log)")
                horizon, newest = (int(value) for value in cur.fetchone())
            conn.rollback()
            if (horizon == equals) if equals is not None else (horizon > newest):
                return {"horizon": horizon, "newestTxid": newest,
                        "waitedSeconds": round(time.monotonic() - started, 3)}
            if time.monotonic() - started > seconds:
                target = f"== {equals}" if equals is not None else f"> {newest}"
                raise TimeoutError(
                    f"the cluster-wide txid horizon stayed at {horizon} (needed {target}) for "
                    f"{seconds:.0f}s: a write transaction elsewhere on this server is still open "
                    "(CAREER_TEST_HORIZON_WAIT_SECONDS)")
            time.sleep(POLL_SECONDS)
    finally:
        conn.close()
