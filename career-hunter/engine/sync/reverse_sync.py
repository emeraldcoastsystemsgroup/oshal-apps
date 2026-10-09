#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Implement the single career-reverse-sync worker: project the migration-106 PostgreSQL outbox back into corpus.db and each owner's user-<sub>.db, commit SQLite before the durable checkpoint, replay idempotently by per-row change_id, stop on anything it cannot map exactly, and export lag/claim/rollback-readiness metrics.

"""Career reverse synchronization: PostgreSQL outbox -> SQLite stores.

Runs only after a write promotion (BACKEND-CUTOVER.md). Before promotion SQLite is authoritative
and the outbox is empty because the loader's replay is not captured.

Checkpoint. change_id is allocated at write time, not commit time, so "the highest change_id seen"
is NOT a safe checkpoint: a transaction holding a lower id can commit after a higher one has been
read. The durable checkpoint is instead a transaction-id horizon. Every row whose ``txid`` is below
``txid_snapshot_xmin(txid_current_snapshot())`` belongs to a transaction that has finished, so the
window ``[checkpoint horizon, current xmin)`` is complete and final when it is read. The worker
applies that window in change_id order, commits SQLite, and only then advances the horizon.

Idempotence. Each SQLite file carries ``career_reverse_sync_applied`` recording the change_id that
last wrote each source row, committed in the same SQLite transaction as the row. A replayed or
older change for a row is skipped, so a crash at any point re-runs the window without duplicating
or regressing anything.

Fail closed. An unknown table or operation, an unexpected schema version or column, a missing or
ambiguous owner store, a source-key collision, a foreign tenant, or a SQLite table without the
expected columns stops the worker (exit 3) without advancing the checkpoint.

Claims. ``apply_claim_token`` is never projected: rollback requires zero outstanding claims, so the
SQLite row always receives a cleared token; ``apply_run_id`` and provenance are projected.

Fault injection. ``CAREER_REVERSE_SYNC_FAULT`` = before-sqlite-commit | after-sqlite-commit |
before-checkpoint-commit ends the process with exit 86 at that point (os._exit: no cleanup, like a
kill). The cutover contracts use it; nothing else sets it.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

ENGINE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = Path(os.environ.get("CAREER_DATA_ROOT", "/app/output/career-hunter-data/default"))
WORKER = "career-reverse-sync"
SCHEMA_VERSION = 1
FAULT_EXIT = 86
FAULT_POINTS = ("before-sqlite-commit", "after-sqlite-commit", "before-checkpoint-commit")
OPERATIONS = ("INSERT", "UPDATE", "DELETE")
VERSION_TABLE = "career_reverse_sync_applied"
TENANT_RESERVED = {"corpus.db", "corpus.db-journal", "corpus.db-shm", "corpus.db-wal",
                   ".career-run-locks", ".last-evening-run"}

log = logging.getLogger("career.reverse_sync")


class ProjectionError(RuntimeError):
    """A change the worker refuses to apply. The worker stops; the checkpoint does not move."""


def _log(level: int, event: str, **fields) -> None:
    """Write one structured JSON log line to stderr."""
    log.log(level, json.dumps({"event": event, "module": "career-reverse-sync", **fields},
                              default=str, sort_keys=True))


def _fault(point: str) -> None:
    """Terminate abruptly at an armed fault-injection point (contract use only)."""
    if os.environ.get("CAREER_REVERSE_SYNC_FAULT") == point:
        _log(logging.WARNING, "fault-injected", point=point)
        sys.stderr.flush()
        os._exit(FAULT_EXIT)


# ── value conversions (PostgreSQL JSON -> the engine's SQLite representation) ────────────────
def _ts(value):
    """TIMESTAMPTZ -> the engine's ISO-8601 UTC text at second precision (db.now())."""
    if value is None:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def _flag(value):
    """BOOLEAN -> the engine's 0/1 INTEGER."""
    return None if value is None else int(bool(value))


def _json_text(value):
    """JSONB -> the TEXT the engine writes with json.dumps."""
    return None if value is None else json.dumps(value)


def _real(value):
    """NUMERIC / DOUBLE -> REAL."""
    return None if value is None else float(value)


def _int(value):
    return None if value is None else int(value)


def _same(value):
    return value


# ── table specifications ─────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class TableSpec:
    """How one PostgreSQL table projects into one SQLite table."""

    pg_table: str
    scope: str                      # "corpus" (shared) or "owner" (per-user file)
    target: str                     # SQLite table
    key: str                        # SQLite identity column
    source_key: str                 # PostgreSQL column carrying that identity
    columns: dict                   # SQLite column -> (PostgreSQL column, converter)
    pg_columns: frozenset           # every column the PostgreSQL row may carry
    apply: Callable


def _cols(spec: dict) -> dict:
    """Normalize a column spec: a bare converter means the PostgreSQL column has the same name."""
    return {name: (pair if isinstance(pair, tuple) else (name, pair)) for name, pair in spec.items()}


COMPANY_COLUMNS = _cols({
    "id": _int, "name": _same, "ticker": _same, "domain": _same, "homepage": _same,
    "careers_url": _same, "ats_type": _same, "ats_token": _same, "industry": _same, "hq": _same,
    "source_lists": _json_text, "discover_status": _same, "gsearched": _flag, "referral": _int,
    "last_scraped_at": _ts, "created_at": _ts,
})
POSTING_COLUMNS = _cols({
    "id": _int, "company_id": _int, "ats_job_id": _same, "title": _same, "description": _same,
    "url": _same, "location": _same, "city": _same, "state": _same, "lat": _real, "lon": _real,
    "remote": _flag, "department": _same, "job_type": _same, "salary_min": _real,
    "salary_max": _real, "salary_currency": _same, "salary_period": _same, "salary_raw": _same,
    "salary_source": _same, "posted_at": _ts, "posted_date": _same, "first_seen_at": _ts,
    "last_seen_at": _ts, "active": _flag,
})
# The same mapping migration 097's `company_reputation` compatibility view gives the engine.
REPUTATION_COLUMNS = _cols({
    "company_id": _int, "ai_about": _same, "ai_positives": _same, "ai_negatives": _same,
    "ai_score": _int, "ai_at": ("ai_rated_at", _ts), "manual_about": _same,
    "manual_positives": _same, "manual_negatives": _same, "manual_score": _int,
    "manual_note": _same, "manual_at": ("updated_at", _ts),
})
SCORE_COLUMNS = _cols({
    "fit_score": _int, "ai_fit_score": _int, "ai_fit_rationale": _same,
    "ai_fit_matched": _json_text, "ai_fit_gaps": _json_text, "ai_model": _same,
    "ai_scored_at": _ts,
})
APPLICATION_COLUMNS = _cols({
    "status": _same, "resume_path": _same, "cover_path": _same, "promoted_at": _ts,
    "generated_at": _ts, "outreach_sent_at": _ts, "applied_at": _ts, "interview_at": _ts,
    "offer_at": _ts, "closed_at": _ts, "outcome": _same, "notes": _same, "apply_active": _int,
    "apply_claimed_at": _int, "apply_run_id": _same, "confirmation_path": _same,
    "application_source": _same, "application_task_id": _same,
})
# Projected as NULL whatever PostgreSQL holds: rollback requires zero outstanding claims.
CLEARED_APPLICATION_COLUMNS = ("apply_claim_token",)
APPLICATION_DEFAULTS = {"status": "new", "apply_active": 1}
RECRUITER_COLUMNS = _cols({
    "id": _int, "firm": _same, "bucket": _same, "website": _same, "contact_name": _same,
    "contact_role": _same, "contact_link": _same, "resume_label": _same, "channel": _same,
    "status": _same, "date_contacted": _same, "followup_date": _same, "next_action": _same,
    "notes": _same, "sort_order": _int, "updated_at": _ts,
})
GAP_COLUMNS = _cols({
    "key": _same, "n_jobs": _int, "avg_fit": _int, "sample_gaps": _same, "status": _same,
    "response": _same, "answered_at": _ts, "updated_at": _ts,
})
INTERVIEW_COLUMNS = _cols({
    "id": ("source_id", _int), "at": _ts, "company": _same, "role": _same, "transcript": _same,
    "answers": _same, "result": _same, "finalized": _int,
})


def _pg(*names: str) -> frozenset:
    return frozenset(names)


PG_COLUMNS = {
    "career_companies": _pg("id", "name", "ticker", "domain", "homepage", "careers_url",
                            "ats_type", "ats_token", "industry", "source_lists",
                            "last_scraped_at", "created_at", "updated_at", "hq",
                            "discover_status", "gsearched", "referral"),
    "career_postings": _pg(*POSTING_COLUMNS),
    "career_company_reputation": _pg("company_id", "ai_score", "ai_about", "ai_positives",
                                     "ai_negatives", "ai_rated_at", "manual_score",
                                     "manual_about", "manual_positives", "manual_negatives",
                                     "manual_note", "updated_at"),
    "career_user_job_scores": _pg("user_sub", "posting_id", "tenant_id", "target_role",
                                  "scored_at", *SCORE_COLUMNS),
    "career_user_applications": _pg("user_sub", "posting_id", "tenant_id", "created_at",
                                    "updated_at", "apply_claim_token", *APPLICATION_COLUMNS),
    "career_user_recruiter_firms": _pg("user_sub", "tenant_id", *RECRUITER_COLUMNS),
    "career_user_gap_themes": _pg("user_sub", "tenant_id", *GAP_COLUMNS),
    "career_user_interview_assessments": _pg("id", "user_sub", "tenant_id", "source_id",
                                             "at", "company", "role", "transcript", "answers",
                                             "result", "finalized"),
}


# ── SQLite writes ────────────────────────────────────────────────────────────────────────────
def _converted(spec: TableSpec, row: dict) -> dict:
    """Map a PostgreSQL row image onto the SQLite columns this spec owns."""
    return {column: convert(row.get(source)) for column, (source, convert) in spec.columns.items()}


def _upsert(conn, schema: str, table: str, key: str, values: dict) -> None:
    """INSERT or UPDATE one SQLite row by its identity column, touching only ``values``."""
    names = list(values)
    updates = ", ".join(f"{name}=excluded.{name}" for name in names if name != key)
    conn.execute(
        f"INSERT INTO {schema}.{table} ({', '.join(names)}) "
        f"VALUES ({', '.join('?' for _ in names)}) "
        f"ON CONFLICT({key}) DO {'UPDATE SET ' + updates if updates else 'NOTHING'}",
        [values[name] for name in names],
    )


def _refuse_collision(conn, schema: str, table: str, where: str, params, own_id, what: str) -> None:
    """Stop when a DIFFERENT SQLite row already holds this natural key."""
    other = conn.execute(f"SELECT id FROM {schema}.{table} WHERE {where}", params).fetchone()
    if other is not None and int(other[0]) != int(own_id):
        raise ProjectionError(f"source-key collision: {what} is held by SQLite id {other[0]}, "
                              f"PostgreSQL id {own_id}")


def apply_company(conn, schema, spec, change) -> None:
    """Project a career_companies change into corpus.companies (name collisions stop)."""
    if change["operation"] == "DELETE":
        conn.execute(f"DELETE FROM {schema}.companies WHERE id=?", (_key_value(spec, change),))
        return
    values = _converted(spec, change["row_after"])
    _refuse_collision(conn, schema, "companies", "name=?", (values["name"],), values["id"],
                      f"company name {values['name']!r}")
    _upsert(conn, schema, "companies", "id", values)


def apply_posting(conn, schema, spec, change) -> None:
    """Project a career_postings change into corpus.postings_corpus (natural-key collisions stop)."""
    if change["operation"] == "DELETE":
        conn.execute(f"DELETE FROM {schema}.postings_corpus WHERE id=?", (_key_value(spec, change),))
        return
    values = _converted(spec, change["row_after"])
    _refuse_collision(conn, schema, "postings_corpus", "company_id=? AND ats_job_id=?",
                      (values["company_id"], values["ats_job_id"]), values["id"],
                      f"posting ({values['company_id']}, {values['ats_job_id']!r})")
    exists = conn.execute(f"SELECT 1 FROM {schema}.postings_corpus WHERE id=?",
                          (values["id"],)).fetchone()
    if not exists:
        # SQLite keeps target_role on the shared row and sets it once, at ingest, from the title
        # (db.upsert_posting). A posting PostgreSQL ingested gets the same engine judgement here.
        from jobhunter import lane

        values["target_role"] = 1 if lane.is_target_role(values["title"]) else 0
    _upsert(conn, schema, "postings_corpus", "id", values)


def apply_reputation(conn, schema, spec, change) -> None:
    """Project a career_company_reputation change with the 097 view's column mapping."""
    if change["operation"] == "DELETE":
        conn.execute(f"DELETE FROM {schema}.company_reputation WHERE company_id=?",
                     (_key_value(spec, change),))
        return
    values = _converted(spec, change["row_after"])
    values["ai_model"] = None  # PostgreSQL has no ai_model column (097 reads it as NULL)
    _upsert(conn, schema, "company_reputation", "company_id", values)


def _prune_signal(conn, posting_id) -> None:
    """Remove a user_signals row once neither its score half nor its application half remains."""
    empty = " AND ".join(f"{name} IS NULL" for name in (*SCORE_COLUMNS, *APPLICATION_COLUMNS)
                         if name not in APPLICATION_DEFAULTS)
    conn.execute(f"DELETE FROM main.user_signals WHERE posting_id=? AND {empty} "
                 "AND COALESCE(status,'new')='new' AND COALESCE(apply_active,1)=1", (posting_id,))


def _apply_signal_half(conn, spec, change, defaults: dict, cleared=()) -> None:
    """Upsert or clear one half (scores or application) of a user_signals row."""
    posting_id = int(change["row_key"]["posting_id"])
    if change["operation"] == "DELETE":
        values = {name: defaults.get(name) for name in spec.columns}
        values.update({name: None for name in cleared})
    else:
        values = _converted(spec, change["row_after"])
        values.update({name: None for name in cleared})
    _upsert(conn, "main", "user_signals", "posting_id", {"posting_id": posting_id, **values})
    if change["operation"] == "DELETE":
        _prune_signal(conn, posting_id)


def apply_score(conn, _schema, spec, change) -> None:
    """Project an owner's score row into the score half of user_signals."""
    _apply_signal_half(conn, spec, change, {})


def apply_application(conn, _schema, spec, change) -> None:
    """Project an owner's application row into user_signals with the claim token cleared."""
    _apply_signal_half(conn, spec, change, APPLICATION_DEFAULTS, CLEARED_APPLICATION_COLUMNS)


def _owned_row(target: str, key: str):
    """Build an apply function for a plain owner table keyed by one column."""
    def apply(conn, schema, spec, change) -> None:
        if change["operation"] == "DELETE":
            conn.execute(f"DELETE FROM {schema}.{target} WHERE {key}=?", (_key_value(spec, change),))
            return
        values = _converted(spec, change["row_after"])
        if values[key] is None:
            raise ProjectionError(f"{spec.pg_table} row has no {spec.source_key}; the SQLite row "
                                  "it belongs to cannot be identified")
        _upsert(conn, schema, target, key, values)
    return apply


SPECS = {spec.pg_table: spec for spec in (
    TableSpec("career_companies", "corpus", "companies", "id", "id", COMPANY_COLUMNS,
              PG_COLUMNS["career_companies"], apply_company),
    TableSpec("career_postings", "corpus", "postings_corpus", "id", "id", POSTING_COLUMNS,
              PG_COLUMNS["career_postings"], apply_posting),
    TableSpec("career_company_reputation", "corpus", "company_reputation", "company_id",
              "company_id", REPUTATION_COLUMNS, PG_COLUMNS["career_company_reputation"],
              apply_reputation),
    TableSpec("career_user_job_scores", "owner", "user_signals", "posting_id", "posting_id",
              SCORE_COLUMNS, PG_COLUMNS["career_user_job_scores"], apply_score),
    TableSpec("career_user_applications", "owner", "user_signals", "posting_id", "posting_id",
              APPLICATION_COLUMNS, PG_COLUMNS["career_user_applications"], apply_application),
    TableSpec("career_user_recruiter_firms", "owner", "recruiter_firms", "id", "id",
              RECRUITER_COLUMNS, PG_COLUMNS["career_user_recruiter_firms"],
              _owned_row("recruiter_firms", "id")),
    TableSpec("career_user_gap_themes", "owner", "gap_themes", "key", "key", GAP_COLUMNS,
              PG_COLUMNS["career_user_gap_themes"], _owned_row("gap_themes", "key")),
    TableSpec("career_user_interview_assessments", "owner", "interview_assessments", "id",
              "source_id", INTERVIEW_COLUMNS, PG_COLUMNS["career_user_interview_assessments"],
              _owned_row("interview_assessments", "id")),
)}


def _key_value(spec: TableSpec, change: dict):
    """The SQLite identity of the changed row, read from the captured key."""
    value = change["row_key"].get(spec.source_key)
    if value is None:
        raise ProjectionError(f"{spec.pg_table} change has no {spec.source_key}; the SQLite row "
                              "it belongs to cannot be identified")
    return value


# ── validation ───────────────────────────────────────────────────────────────────────────────
def validate(change: dict, tenant: str) -> TableSpec:
    """Return the spec for a change, or raise for anything the worker cannot map exactly."""
    where = f"change {change['change_id']} ({change['table_name']})"
    if change["schema_version"] != SCHEMA_VERSION:
        raise ProjectionError(f"{where}: schema version {change['schema_version']} is not "
                              f"{SCHEMA_VERSION}")
    spec = SPECS.get(change["table_name"])
    if spec is None:
        raise ProjectionError(f"{where}: unknown table")
    if change["operation"] not in OPERATIONS:
        raise ProjectionError(f"{where}: unknown operation {change['operation']!r}")
    row = change["row_after"]
    if change["operation"] != "DELETE":
        if not isinstance(row, dict):
            raise ProjectionError(f"{where}: {change['operation']} without a row image")
        unexpected = sorted(set(row) - spec.pg_columns)
        if unexpected:
            raise ProjectionError(f"{where}: schema mismatch, unexpected column(s) {unexpected}")
        if "tenant_id" in row and row["tenant_id"] != tenant:
            raise ProjectionError(f"{where}: tenant {row['tenant_id']!r} is not {tenant!r}")
    if (spec.scope == "owner") != bool(change["owner_sub"]):
        raise ProjectionError(f"{where}: owner {change['owner_sub']!r} does not fit a "
                              f"{spec.scope} table")
    return spec


def owner_database(root: Path, owner: str) -> Path:
    """Resolve an owner's SQLite store exactly as the loader and reporter enumerate it."""
    if not owner or owner in (".", "..") or any(c in owner for c in "/\\\0:") \
            or owner.startswith(("_", ".")) or owner.lower() in TENANT_RESERVED:
        raise ProjectionError(f"owner {owner!r} is not a direct store directory name")
    entries = os.listdir(root)
    if owner not in entries:
        raise ProjectionError(f"missing owner store for {owner!r}")
    if any(entry != owner and entry.lower() == owner.lower() for entry in entries):
        raise ProjectionError(f"ambiguous owner store path for {owner!r} (case alias)")
    user_dir = root / owner
    name = f"user-{owner}.db"
    if user_dir.is_symlink() or not user_dir.is_dir():
        raise ProjectionError(f"ambiguous owner store path for {owner!r}")
    files = os.listdir(user_dir)
    if name not in files or (user_dir / name).is_symlink() or not (user_dir / name).is_file():
        raise ProjectionError(f"missing owner store for {owner!r}")
    if any(entry != name and entry.lower() == name.lower() for entry in files):
        raise ProjectionError(f"ambiguous owner store path for {owner!r} (case alias)")
    return user_dir / name


# ── the SQLite side of one pass ──────────────────────────────────────────────────────────────
class Projection:
    """Lazily opened SQLite targets for one window; each file commits with its version rows."""

    def __init__(self, root: Path, tenant: str):
        self.root = root
        self.tenant = tenant
        self.targets: dict[str, tuple[sqlite3.Connection, str]] = {}
        self.checked: set[tuple[str, str]] = set()
        self.applied = 0
        self.skipped = 0
        self.per_table: dict[str, int] = {}

    def _open(self, label: str, path: Path, schema: str) -> tuple[sqlite3.Connection, str]:
        if not path.is_file():
            raise ProjectionError(f"missing SQLite store {label}")
        if schema == "corpus":
            conn = sqlite3.connect(":memory:", isolation_level=None, timeout=120)
            conn.execute("ATTACH DATABASE ? AS corpus", (str(path),))
        else:
            conn = sqlite3.connect(path, isolation_level=None, timeout=120)
        conn.execute("PRAGMA busy_timeout = 120000")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(f"CREATE TABLE IF NOT EXISTS {schema}.{VERSION_TABLE} ("
                     "table_name TEXT NOT NULL, row_key TEXT NOT NULL, change_id INTEGER NOT NULL, "
                     "PRIMARY KEY (table_name, row_key))")
        self.targets[label] = (conn, schema)
        return conn, schema

    def target(self, spec: TableSpec, owner: str | None) -> tuple[sqlite3.Connection, str]:
        label = "corpus" if spec.scope == "corpus" else f"owner:{owner}"
        if label in self.targets:
            return self.targets[label]
        if spec.scope == "corpus":
            return self._open(label, self.root / "corpus.db", "corpus")
        return self._open(label, owner_database(self.root, owner), "main")

    def _check_schema(self, conn, schema: str, spec: TableSpec, label: str) -> None:
        if (label, spec.target) in self.checked:
            return
        have = {row[1] for row in conn.execute(f"PRAGMA {schema}.table_info({spec.target})")}
        needed = {spec.key, *spec.columns, *(("target_role",) if spec.target == "postings_corpus" else ())}
        if spec.pg_table == "career_user_applications":
            needed |= set(CLEARED_APPLICATION_COLUMNS)
        missing = sorted(needed - have)
        if missing:
            raise ProjectionError(f"schema mismatch: {label} {spec.target} lacks {missing}")
        self.checked.add((label, spec.target))

    def apply(self, change: dict) -> None:
        spec = validate(change, self.tenant)
        conn, schema = self.target(spec, change["owner_sub"])
        label = "corpus" if spec.scope == "corpus" else f"owner:{change['owner_sub']}"
        self._check_schema(conn, schema, spec, label)
        row_key = json.dumps(change["row_key"], sort_keys=True, separators=(",", ":"))
        prior = conn.execute(f"SELECT change_id FROM {schema}.{VERSION_TABLE} "
                             "WHERE table_name=? AND row_key=?", (spec.pg_table, row_key)).fetchone()
        if prior is not None and int(prior[0]) >= int(change["change_id"]):
            self.skipped += 1
            return
        try:
            spec.apply(conn, schema, spec, change)
        except sqlite3.IntegrityError as error:
            raise ProjectionError(f"change {change['change_id']} ({spec.pg_table}): "
                                  f"source-key collision in SQLite: {error}") from error
        conn.execute(f"INSERT INTO {schema}.{VERSION_TABLE} (table_name,row_key,change_id) "
                     "VALUES (?,?,?) ON CONFLICT(table_name,row_key) DO UPDATE SET "
                     "change_id=excluded.change_id", (spec.pg_table, row_key, change["change_id"]))
        self.applied += 1
        self.per_table[spec.pg_table] = self.per_table.get(spec.pg_table, 0) + 1

    def commit(self) -> None:
        """Commit every touched file (corpus first), then reopen transactions for the next chunk."""
        _fault("before-sqlite-commit")
        for label in sorted(self.targets, key=lambda name: name != "corpus"):
            self.targets[label][0].execute("COMMIT")
        _fault("after-sqlite-commit")
        for conn, _schema in self.targets.values():
            conn.execute("BEGIN IMMEDIATE")

    def close(self, commit: bool) -> None:
        for conn, _schema in self.targets.values():
            try:
                conn.execute("COMMIT" if commit else "ROLLBACK")
            finally:
                conn.close()
        self.targets.clear()


# ── the PostgreSQL side ──────────────────────────────────────────────────────────────────────
def connect(database_url: str, worker: str, lock: bool):
    """Open the operator session; a projecting run also takes the single-worker lock or exits 4."""
    import psycopg2

    pg = psycopg2.connect(database_url)
    with pg.cursor() as cur:
        cur.execute("SELECT set_config('oshal.is_operator','on',false)")
        locked = True
        if lock:
            cur.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (worker,))
            locked = cur.fetchone()[0]
    pg.commit()
    if not locked:
        pg.close()
        _log(logging.ERROR, "worker-lock-held", worker=worker)
        raise SystemExit(4)
    return pg


def load_checkpoint(pg, worker: str) -> dict:
    """Read (creating at horizon 0 when absent) this worker's durable checkpoint."""
    with pg.cursor() as cur:
        cur.execute("INSERT INTO career_reverse_sync_checkpoint (worker) VALUES (%s) "
                    "ON CONFLICT (worker) DO NOTHING", (worker,))
        cur.execute("SELECT horizon_txid, last_change_id FROM career_reverse_sync_checkpoint "
                    "WHERE worker=%s", (worker,))
        horizon, last_change = cur.fetchone()
    pg.commit()
    return {"horizon": int(horizon), "lastChangeId": int(last_change)}


def stream_window(pg, low: int, high: int, batch: int):
    """Yield the window's changes in change_id order, ``batch`` rows at a time."""
    from psycopg2.extras import RealDictCursor

    cursor = pg.cursor(name="career_reverse_sync_window", cursor_factory=RealDictCursor)
    cursor.itersize = batch
    try:
        cursor.execute(
            "SELECT change_id, txid, schema_version, table_name, owner_sub, row_key, operation, "
            "row_after, committed_at FROM career_store_change_log "
            "WHERE txid >= %s AND txid < %s ORDER BY change_id", (low, high))
        while True:
            rows = cursor.fetchmany(batch)
            if not rows:
                return
            yield [dict(row) for row in rows]
    finally:
        cursor.close()


def run_pass(pg, root: Path, worker: str, tenant: str, batch: int) -> dict:
    """Project one complete window and advance the checkpoint; returns what it did."""
    checkpoint = load_checkpoint(pg, worker)
    with pg.cursor() as cur:
        cur.execute("SELECT txid_snapshot_xmin(txid_current_snapshot())")
        horizon = int(cur.fetchone()[0])
    if horizon <= checkpoint["horizon"]:
        pg.rollback()
        return {"window": [checkpoint["horizon"], horizon], "applied": 0, "skipped": 0}
    projection = Projection(root, tenant)
    last_change, last_commit = checkpoint["lastChangeId"], None
    try:
        for chunk in stream_window(pg, checkpoint["horizon"], horizon, batch):
            for change in chunk:
                projection.apply(change)
                last_change = max(last_change, int(change["change_id"]))
                last_commit = max(filter(None, (last_commit, change["committed_at"])))
            projection.commit()
    except BaseException:
        projection.close(commit=False)
        pg.rollback()
        raise
    projection.close(commit=True)
    advance_checkpoint(pg, worker, checkpoint, horizon, last_change, last_commit, projection.applied)
    return {"window": [checkpoint["horizon"], horizon], "applied": projection.applied,
            "skipped": projection.skipped, "perTable": projection.per_table}


def advance_checkpoint(pg, worker, checkpoint, horizon, last_change, last_commit, applied) -> None:
    """Move the horizon only after SQLite is durable; refuse if another writer moved it."""
    with pg.cursor() as cur:
        cur.execute(
            "UPDATE career_reverse_sync_checkpoint SET horizon_txid=%s, last_change_id=%s, "
            "applied_rows=applied_rows+%s, last_committed_at=GREATEST(last_committed_at, %s), "
            "last_error=NULL, updated_at=NOW() WHERE worker=%s AND horizon_txid=%s",
            (horizon, last_change, applied, last_commit, worker, checkpoint["horizon"]))
        moved = cur.rowcount
    if moved != 1:
        pg.rollback()
        raise ProjectionError("checkpoint moved underneath this worker; refusing to overwrite it")
    _fault("before-checkpoint-commit")
    pg.commit()


def record_failure(pg, worker: str, message: str) -> None:
    """Count the failure and keep its reason on the checkpoint row; the horizon stays put."""
    with pg.cursor() as cur:
        cur.execute("UPDATE career_reverse_sync_checkpoint SET row_failures=row_failures+1, "
                    "last_error=%s, updated_at=NOW() WHERE worker=%s", (message[:2000], worker))
    pg.commit()


# ── metrics and rollback readiness ───────────────────────────────────────────────────────────
def collect_metrics(pg, worker: str) -> dict:
    """Checkpoint lag, per-table counts, outstanding claims and the rollback verdict."""
    with pg.cursor() as cur:
        cur.execute("SELECT horizon_txid, last_change_id, applied_rows, row_failures, "
                    "last_committed_at, last_error, updated_at FROM career_reverse_sync_checkpoint "
                    "WHERE worker=%s", (worker,))
        row = cur.fetchone() or (0, 0, 0, 0, None, None, None)
        horizon = int(row[0])
        cur.execute("SELECT COALESCE(MAX(change_id),0), COUNT(*) FILTER (WHERE txid >= %s), "
                    "MIN(committed_at) FILTER (WHERE txid >= %s) FROM career_store_change_log",
                    (horizon, horizon))
        latest, pending, oldest_pending = cur.fetchone()
        cur.execute("SELECT table_name, COUNT(*) FILTER (WHERE txid < %s), "
                    "COUNT(*) FILTER (WHERE txid >= %s) FROM career_store_change_log "
                    "GROUP BY table_name ORDER BY table_name", (horizon, horizon))
        per_table = {name: {"projected": int(done), "pending": int(todo)}
                     for name, done, todo in cur.fetchall()}
        cur.execute("SELECT COUNT(*) FROM career_user_applications WHERE apply_claim_token IS NOT NULL "
                    "OR (apply_active = 0 AND applied_at IS NULL)")
        claims = int(cur.fetchone()[0])
    pg.rollback()
    now = datetime.now(timezone.utc)
    blockers = (["projector-lag"] if pending else []) + (["outstanding-claims"] if claims else []) \
        + (["projector-failed"] if row[5] else [])
    return {
        "worker": worker, "horizonTxid": horizon, "lastChangeId": int(row[1]),
        "latestChangeId": int(latest), "pendingRows": int(pending), "appliedRows": int(row[2]),
        "rowFailures": int(row[3]), "lastCommittedAt": _ts(row[4]), "lastError": row[5],
        "checkpointUpdatedAt": _ts(row[6]),
        "lagSeconds": 0 if oldest_pending is None else round((now - oldest_pending).total_seconds(), 3),
        "perTable": per_table, "outstandingClaims": claims, "caughtUp": pending == 0,
        "rollbackReady": not blockers, "blockers": blockers, "generatedAt": _ts(now),
    }


def emit(metrics: dict, output: Path | None) -> None:
    """Print the metrics marker line and, when asked, write the same JSON to a file."""
    payload = json.dumps(metrics, sort_keys=True, separators=(",", ":"), default=str)
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(payload + "\n", encoding="utf-8")
    print("CAREER_REVERSE_SYNC=" + payload, flush=True)


# ── entry point ──────────────────────────────────────────────────────────────────────────────
def _parse(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--data-root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--worker", default=WORKER)
    parser.add_argument("--tenant", default="default")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--metrics-output", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--until-caught-up", action="store_true",
                      help="repeat passes until no captured change is pending")
    mode.add_argument("--follow", action="store_true", help="run as the long-lived worker")
    mode.add_argument("--status", action="store_true", help="report metrics; project nothing")
    mode.add_argument("--check-rollback-ready", action="store_true",
                      help="exit 0 only when caught up with zero outstanding claims")
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--max-passes", type=int, default=600)
    args = parser.parse_args(argv)
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    if args.batch_size < 1:
        parser.error("--batch-size must be positive")
    return args


def _loop(pg, args) -> bool:
    """Run one pass, passes until caught up (bounded), or with --follow until stopped.

    Returns False only when --until-caught-up ran out of passes while writes kept arriving; that
    is lag, not a projection failure, so it is reported (exit 5) without touching row_failures.
    """
    root = args.data_root.resolve()
    passes = 0
    while True:
        result = run_pass(pg, root, args.worker, args.tenant, args.batch_size)
        _log(logging.INFO, "pass-complete", **result)
        passes += 1
        if not (args.until_caught_up or args.follow):
            return True
        if args.until_caught_up and collect_metrics(pg, args.worker)["caughtUp"]:
            return True
        if args.until_caught_up and passes >= args.max_passes:
            _log(logging.WARNING, "still-lagging", passes=passes)
            return False
        time.sleep(args.interval)


def _project(pg, args) -> int:
    """Projecting modes: 0 done, 3 stopped on a change it refused, 5 still lagging."""
    try:
        caught_up = _loop(pg, args)
    except ProjectionError as error:
        _log(logging.ERROR, "projection-stopped", error=str(error))
        record_failure(pg, args.worker, str(error))
        emit(collect_metrics(pg, args.worker), args.metrics_output)
        return 3
    emit(collect_metrics(pg, args.worker), args.metrics_output)
    return 0 if caught_up else 5


def main(argv=None) -> int:
    """Entry point; the exit code is the verdict (see _project and --check-rollback-ready)."""
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
    args = _parse(argv)
    if str(ENGINE_ROOT) not in sys.path:
        sys.path.insert(0, str(ENGINE_ROOT))
    reading = args.status or args.check_rollback_ready
    pg = connect(args.database_url, args.worker, lock=not reading)
    try:
        if not reading:
            return _project(pg, args)
        metrics = collect_metrics(pg, args.worker)
        emit(metrics, args.metrics_output)
        if args.check_rollback_ready and not metrics["rollbackReady"]:
            print("CAREER_ROLLBACK_BLOCKED=" + ",".join(metrics["blockers"]), file=sys.stderr)
            return 2
        return 0
    finally:
        pg.close()


if __name__ == "__main__":
    raise SystemExit(main())
