"""Retained source attempts and content deltas for the shared jobs corpus.

CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Remember per-employer pull health and posting hashes; only a verified complete nonempty feed may close missing jobs.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone

from . import config, db


class Feed(list):
    """A list compatible with existing adapters, carrying explicit enumeration evidence."""
    def __init__(self, rows=(), *, complete=False, reason="completion_unverified"):
        super().__init__(rows)
        self.complete = complete
        self.reason = reason
        self.attempt_id = None
        self.started_at = None
        self.finalized = False
        self.not_modified = False
        self.validators = {}
        self.request_key = None


def table(name):
    if config.POSTGRES:
        return "career_" + name
    return ("corpus." if config.MULTIUSER else "") + name


def ensure(conn):
    """Only ingest writers call this; read-only snapshots never create telemetry."""
    fields = """last_attempt_at TEXT, last_success_at TEXT, completed_at TEXT,
        status TEXT NOT NULL, last_error_code TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0,
        fetched INTEGER NOT NULL DEFAULT 0, new_count INTEGER NOT NULL DEFAULT 0,
        changed_count INTEGER NOT NULL DEFAULT 0, unchanged_count INTEGER NOT NULL DEFAULT 0,
        closed_count INTEGER NOT NULL DEFAULT 0"""
    conn.execute(f"CREATE TABLE IF NOT EXISTS {table('source_pull_state')} (company_id INTEGER PRIMARY KEY, {fields})")
    conn.execute(f"CREATE TABLE IF NOT EXISTS {table('source_pull_runs')} (attempt_id TEXT PRIMARY KEY, company_id INTEGER NOT NULL, {fields})")
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {table('source_posting_hashes')} (
        company_id INTEGER NOT NULL, ats_job_id TEXT NOT NULL, content_hash TEXT NOT NULL,
        PRIMARY KEY (company_id, ats_job_id))""")
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {table('source_http_validators')} (
        company_id INTEGER PRIMARY KEY, request_key TEXT NOT NULL, etag TEXT, last_modified TEXT)""")
    conn.execute(f"CREATE TABLE IF NOT EXISTS {table('source_identity')} (company_id INTEGER PRIMARY KEY, identity_hash TEXT NOT NULL)")


def begin_on(conn, company_id, identity_key=None):
    """Record an attempt on an already-held installation writer connection."""
    attempt, started = str(uuid.uuid4()), datetime.now(timezone.utc).isoformat()
    ensure(conn)
    if identity_key:
        previous = conn.execute(f"SELECT identity_hash FROM {table('source_identity')} WHERE company_id=?", (company_id,)).fetchone()
        if not previous or previous["identity_hash"] != identity_key:
            # Existing jobs remain visible; evidence from a different source is not reusable.
            for name in ("source_posting_hashes", "source_http_validators", "source_pull_state", "source_pull_runs"):
                conn.execute(f"DELETE FROM {table(name)} WHERE company_id=?", (company_id,))
            conn.execute(f"""INSERT INTO {table('source_identity')} (company_id,identity_hash) VALUES (?,?)
                ON CONFLICT (company_id) DO UPDATE SET identity_hash=EXCLUDED.identity_hash""", (company_id, identity_key))
    conn.execute(f"""INSERT INTO {table('source_pull_state')} (company_id,last_attempt_at,status)
        VALUES (?,?,'running') ON CONFLICT (company_id) DO UPDATE SET
        last_attempt_at=EXCLUDED.last_attempt_at,status='running'""", (company_id, started))
    return attempt, started


def begin(company_id, identity_key=None):
    with db.connect() as conn:
        return begin_on(conn, company_id, identity_key)


def listing_url(ats_type, token):
    """Exact single-GET listing whose validator contract is reviewed; others use no cache."""
    if ats_type == "greenhouse":
        return f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
    if ats_type == "lever":
        return f"https://api.lever.co/v0/postings/{token}?mode=json"
    return None


def source_key(ats_type, token):
    return hashlib.sha256(json.dumps([ats_type, token, listing_url(ats_type, token)], separators=(",", ":")).encode()).hexdigest()


def finish(conn, company_id, attempt, started, status, reason=None, *, already_finished=False, **counts):
    ensure(conn)
    completed = datetime.now(timezone.utc).isoformat()
    previous = conn.execute(f"SELECT last_success_at,consecutive_failures FROM {table('source_pull_state')} WHERE company_id=?", (company_id,)).fetchone()
    confirmed = status in {"ok", "not_modified"}
    success = completed if confirmed else (previous["last_success_at"] if previous else None)
    failures = 0 if confirmed else (previous["consecutive_failures"] if previous else 0) + (0 if already_finished else 1)
    values = (started, success, completed, status, reason, failures,
              counts.get("fetched", 0), counts.get("new", 0), counts.get("changed", 0),
              counts.get("unchanged", 0), counts.get("closed", 0))
    cols = "last_attempt_at,last_success_at,completed_at,status,last_error_code,consecutive_failures,fetched,new_count,changed_count,unchanged_count,closed_count"
    conn.execute(f"""INSERT INTO {table('source_pull_state')} (company_id,{cols})
        VALUES ({','.join('?' for _ in range(12))}) ON CONFLICT (company_id) DO UPDATE SET
        {','.join(f'{key}=EXCLUDED.{key}' for key in cols.split(','))}""", (company_id, *values))
    conn.execute(f"""INSERT INTO {table('source_pull_runs')} (attempt_id,company_id,{cols})
        VALUES ({','.join('?' for _ in range(13))}) ON CONFLICT (attempt_id) DO UPDATE SET
        {','.join(f'{key}=EXCLUDED.{key}' for key in cols.split(','))}""", (attempt, company_id, *values))
    conn.execute(f"""DELETE FROM {table('source_pull_runs')} WHERE company_id=? AND attempt_id NOT IN
        (SELECT attempt_id FROM {table('source_pull_runs')} WHERE company_id=? ORDER BY completed_at DESC,attempt_id DESC LIMIT 20)""", (company_id, company_id))


def fetch(company_id, ats_type, token):
    """Persist an attempt before I/O; do not persist URLs, tokens or provider error bodies."""
    from . import ats, http
    # Only these full-board, single-GET endpoints have a safe 304 contract.
    url = listing_url(ats_type, token)
    key = hashlib.sha256(url.encode()).hexdigest() if url else None
    identity_key = source_key(ats_type, token)
    attempt, started = begin(company_id, identity_key)
    headers = {}
    with db.connect() as conn:
        saved = conn.execute(f"SELECT request_key,etag,last_modified FROM {table('source_http_validators')} WHERE company_id=?", (company_id,)).fetchone()
        if saved and saved["request_key"] == key:
            if saved["etag"]:
                headers["If-None-Match"] = saved["etag"]
            elif saved["last_modified"]:
                headers["If-Modified-Since"] = saved["last_modified"]
        elif saved:
            conn.execute(f"DELETE FROM {table('source_http_validators')} WHERE company_id=?", (company_id,))
    try:
        with http.conditional(url, headers) as checked:
            rows = ats.fetch(ats_type, token)
    except Exception:
        with db.connect() as conn:
            finish(conn, company_id, attempt, started, "failed", "fetch_failed")
        raise
    feed = rows if isinstance(rows, Feed) else Feed(rows)
    feed.attempt_id, feed.started_at = attempt, started
    feed.validators, feed.request_key = checked["validators"], key
    if feed.not_modified and not headers:
        feed.not_modified, feed.complete, feed.reason = False, False, "unexpected_not_modified"
    # Empty/partial attempts also remain visible when an older caller elects not to ingest.
    if (not feed and not feed.not_modified) or not feed.complete:
        with db.connect() as conn:
            finish(conn, company_id, attempt, started, "partial" if feed else "empty_unconfirmed",
                   feed.reason if feed else "empty_unconfirmed", fetched=len(feed))
        feed.finalized = True
    return feed


FIELDS = ("title", "location", "remote", "department", "url", "description",
          "salary_min", "salary_max", "salary_currency", "salary_period", "salary_raw")


def payload_hash(posting):
    """Relative 'posted 3 days ago' text is not a content change. Missing detail stays missing."""
    data = {key: posting[key] for key in FIELDS if posting.get(key) is not None}
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def ingest(conn, company_id, rows):
    """Apply a bounded company transaction; unchanged rows update only freshness/reactivation."""
    ensure(conn)
    feed = rows if isinstance(rows, Feed) else Feed(rows)
    attempt, started = feed.attempt_id or str(uuid.uuid4()), feed.started_at or db.now()
    # Do not duplicate a large employer's complete inline descriptions in memory.
    columns = ",".join(("id", "ats_job_id", "active", *(key for key in FIELDS if key != "description")))
    current = {str(row["ats_job_id"]): dict(row) for row in conn.execute(
        f"SELECT {columns} FROM {db.corpus_table()} WHERE company_id=?", (company_id,)).fetchall()}
    hashes = {row["ats_job_id"]: row["content_hash"] for row in conn.execute(
        f"SELECT ats_job_id,content_hash FROM {table('source_posting_hashes')} WHERE company_id=?", (company_id,)).fetchall()}
    counts = dict(fetched=len(feed), new=0, changed=0, unchanged=0, closed=0, skipped=0)
    if feed.not_modified:
        counts["unchanged"] = sum(bool(row.get("active")) for row in current.values())
        yes = "TRUE" if config.POSTGRES else "1"
        conn.execute(f"UPDATE {db.corpus_table()} SET last_seen_at=? WHERE company_id=? AND active={yes}", (db.now(), company_id))
        conn.execute(f"UPDATE {db.companies_table()} SET last_scraped_at=? WHERE id=?", (db.now(), company_id))
        finish(conn, company_id, attempt, started, "not_modified", **counts)
        counts["complete"] = True
        return counts
    seen = set()
    valid = True
    for posting in feed:
        if not isinstance(posting, dict) or posting.get("ats_job_id") is None or not posting.get("title"):
            counts["skipped"] += 1
            valid = False
            continue
        job_id = str(posting["ats_job_id"])
        if job_id in seen:
            valid = False
            continue
        seen.add(job_id)
        digest = payload_hash(posting)
        previous = current.get(job_id)
        baseline_fields = [key for key in FIELDS if key != "description" and key in posting
                           and (not key.startswith("salary_") or posting.get(key) is not None)]
        baseline_same = previous is not None and all(previous.get(key) == posting.get(key) for key in baseline_fields)
        if baseline_same and hashes.get(job_id) != digest and posting.get("description") is not None:
            baseline_same = conn.execute(f"SELECT description FROM {db.corpus_table()} WHERE id=?", (previous["id"],)).fetchone()["description"] == posting["description"]
        unchanged = previous is not None and (hashes.get(job_id) == digest or (job_id not in hashes and baseline_same))
        if unchanged:
            yes = "TRUE" if config.POSTGRES else "1"
            conn.execute(f"UPDATE {db.corpus_table()} SET last_seen_at=?,active={yes} WHERE id=?", (db.now(), previous["id"]))
            counts["unchanged" if previous.get("active") else "changed"] += 1
        else:
            payload = dict(posting)
            # List-only adapters must not erase a previously enriched full description.
            if previous and payload.get("description") is None:
                payload["description"] = conn.execute(f"SELECT description FROM {db.corpus_table()} WHERE id=?", (previous["id"],)).fetchone()["description"]
            outcome = db.upsert_posting(conn, company_id, payload)
            counts["new" if outcome == "new" else "changed" if outcome == "seen" else "skipped"] += 1
        conn.execute(f"""INSERT INTO {table('source_posting_hashes')} (company_id,ats_job_id,content_hash)
            VALUES (?,?,?) ON CONFLICT (company_id,ats_job_id) DO UPDATE SET content_hash=EXCLUDED.content_hash""", (company_id, job_id, digest))
    complete = bool(feed) and feed.complete and valid
    if complete:
        counts["closed"] = db.deactivate_missing(conn, company_id, seen)
        conn.execute(f"UPDATE {db.companies_table()} SET last_scraped_at=? WHERE id=?", (db.now(), company_id))
        if feed.request_key and feed.validators:
            conn.execute(f"""INSERT INTO {table('source_http_validators')} (company_id,request_key,etag,last_modified)
                VALUES (?,?,?,?) ON CONFLICT (company_id) DO UPDATE SET request_key=EXCLUDED.request_key,
                etag=EXCLUDED.etag,last_modified=EXCLUDED.last_modified""",
                (company_id, feed.request_key, feed.validators.get("ETag"), feed.validators.get("Last-Modified")))
        elif feed.request_key:
            conn.execute(f"DELETE FROM {table('source_http_validators')} WHERE company_id=?", (company_id,))
    status = "ok" if complete else "partial" if feed else "empty_unconfirmed"
    reason = None if complete else "invalid_feed_rows" if not valid else feed.reason if feed else "empty_unconfirmed"
    finish(conn, company_id, attempt, started, status, reason, already_finished=feed.finalized, **counts)
    counts["complete"] = complete
    return counts
