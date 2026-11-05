"""Source changes administrators asked for on the Companies page, applied by a full pull on its private copy.

A request mounts the shared corpus read-only, so the page cannot write it. The route leaves a change in the caller's
store, the kernel moves it to a queue only for an admission holding `career.administer`, and each pull is handed a
snapshot of that queue in the folder JOBHUNTER_SOURCE_REQUESTS names. What happened to each change is kept in the corpus,
so the page can say, and so a change the kernel hands over twice is applied once.

CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Resolve works on the native kernel: a saved change is applied by the next pull, on public addresses only and inside a hard time limit, and its outcome is kept for the page.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from . import ats, db, http, resolve, source_review as review
from . import source_memory as memory

# A change the pull keeps stopping on is given up, so it cannot hold back the rest of the night. The person is told.
MAX_ATTEMPTS = 3
KEEP = 200


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure(conn):
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('source_requests')} (id TEXT PRIMARY KEY, company_id INTEGER NOT NULL,
        target TEXT NOT NULL, requested_by TEXT, requested_at INTEGER, finished_at TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        outcome TEXT NOT NULL, detail TEXT)""")


def _waiting(folder):
    """The changes handed to this pull, oldest first. One that cannot be read is said aloud and skipped."""
    changes = []
    for path in sorted(Path(folder).glob("*.json")):
        try:
            change = json.loads(path.read_text(encoding="utf-8"))
            changes.append({"id": str(change["id"]), "company_id": int(change["companyId"]), "target": str(change["target"]),
                            "requested_by": change.get("requestedBy"), "requested_at": change.get("requestedAt")})
        except (OSError, ValueError, KeyError, TypeError):
            print(f"   source change {path.name}: unreadable, skipped", flush=True)
    return sorted(changes, key=lambda change: change["requested_at"] or 0)


def _claim(conn, change):
    """Whether to work on this change now. The attempt is written first, so one that ends the process is known to the next."""
    table = memory.table("source_requests")
    row = conn.execute(f"SELECT attempts,outcome FROM {table} WHERE id=?", (change["id"],)).fetchone()
    if row is None:
        conn.execute(f"""INSERT INTO {table} (id,company_id,target,requested_by,requested_at,attempts,outcome)
            VALUES (?,?,?,?,?,1,'started')""", (change["id"], change["company_id"], change["target"],
                                                change["requested_by"], change["requested_at"]))
        return True
    if row["outcome"] != "started":
        return False
    if row["attempts"] >= MAX_ATTEMPTS:
        _finish(conn, change["id"], {"outcome": "interrupted"})
        return False
    conn.execute(f"UPDATE {table} SET attempts=attempts+1 WHERE id=?", (change["id"],))
    return True


def _finish(conn, change_id, result):
    table = memory.table("source_requests")
    detail = {key: value for key, value in result.items() if key != "outcome"}
    conn.execute(f"UPDATE {table} SET outcome=?,detail=?,finished_at=? WHERE id=?",
                 (result["outcome"], json.dumps(detail), _now(), change_id))
    conn.execute(f"""DELETE FROM {table} WHERE outcome<>'started' AND id NOT IN
        (SELECT id FROM {table} ORDER BY finished_at DESC, id DESC LIMIT ?)""", (KEEP,))


def _parse_target(target):
    """(ats_type, token, url): a board named as `greenhouse:acme`, or a link to work out. (None, None, None) is neither."""
    kind, _, token = target.partition(":")
    if kind in ats.BY_NAME and token:
        return kind, token, None
    parts = urlsplit(target)
    if parts.scheme in ("http", "https") and parts.hostname:
        return None, None, target
    return None, None, None


def _reader_guarded():
    """The page reader is a browser, which the Python address guard does not cover, so a change only uses it under its
    own read policy (HTTPS on 443, addresses screened). Without that, as where the kernel has no browser bundle, it does not read."""
    return os.environ.get("JOBHUNTER_BROWSER_NATIVE") == "1"


def _link_in(url, token):
    """The link a change would read directly: its own, or a token that is one (`web:https://...`, `webflow:https://...|id`)."""
    return url or (token.split("|")[0] if token and "://" in token else None)


def _is_public_link(link):
    parts = urlsplit(link)
    return parts.scheme in ("http", "https") and bool(parts.hostname) and http._host_is_public(parts.hostname)


def _from_link(url):
    """The board a link leads to and its jobs, or nothing. A page read directly is the last resort, as Resolve has always done."""
    hit = resolve.classify_url_deep(url)
    ats_type, token = hit if hit and hit[0] != "workday_host" else (None, None)
    feed = review._jobs_at(ats_type, token) if ats_type else None
    if len(feed or ()) < 3 and ats_type != "web" and _reader_guarded():
        from . import webscrape
        try:
            jobs = webscrape.scrape_careers(url)
        except Exception:  # noqa: BLE001 — a page that cannot be read leaves what the board gave, if anything.
            jobs = []
        if len(jobs) >= 3:
            return "web", url, memory.Feed(jobs, reason="completion_unverified")
    return ats_type, token, feed


def _move(company, ats_type, token, url, feed, pull):
    """Move the source and take its jobs in one transaction. `manual` keeps the source review away from a person's choice."""
    with db.connect() as conn:
        feed.attempt_id, feed.started_at = memory.begin_on(conn, company["id"], memory.source_key(ats_type, token))
        conn.execute(f"""UPDATE {db.companies_table()} SET ats_type=?,ats_token=?,discover_status='manual',
            careers_url=COALESCE(?,careers_url) WHERE id=?""", (ats_type, token, url, company["id"]))
        counts = memory.ingest(conn, company["id"], feed)
        added = {"new": counts["new"], "seen": counts["changed"] + counts["unchanged"], "closed": counts["closed"],
                 "skipped": counts["skipped"], "confirmed": int(counts["complete"]), "unconfirmed": int(not counts["complete"])}
        settled = pull is not None and company["id"] not in pull.finished
        if settled:  # Read just now: the pull need not read the same board again tonight.
            pull.settle(conn, company["id"], **added)
    if settled:
        pull.finished.add(company["id"])
        pull.totals.update(added)
    return {"outcome": "applied", "board": f"{ats_type}:{token}", "jobs": len(feed), "new": counts["new"], "closed": counts["closed"],
            "from": f"{company['ats_type'] or 'none'}:{company['ats_token'] or ''}", "complete": bool(counts["complete"])}


def _apply(change, pull):
    with db.connect() as conn:
        row = conn.execute(f"SELECT id,name,ats_type,ats_token FROM {db.companies_table()} WHERE id=?", (change["company_id"],)).fetchone()
    if row is None:
        return {"outcome": "unknown_company"}
    company = dict(row)
    ats_type, token, url = _parse_target(change["target"])
    if not ats_type and not url:
        return {"outcome": "bad_target"}
    link = _link_in(url, token)
    if link and not _is_public_link(link):  # Before anything reads it.
        return {"outcome": "unsafe"}
    if ats_type == "web" and (not link or not _reader_guarded()):
        return {"outcome": "no_jobs"}
    feed = review._jobs_at(ats_type, token) if ats_type else None
    if url:
        ats_type, token, feed = _from_link(url)
    if not feed:
        if not url:
            return {"outcome": "no_jobs"}
        with db.connect() as conn:
            conn.execute(f"UPDATE {db.companies_table()} SET careers_url=? WHERE id=?", (url, company["id"]))
        return {"outcome": "saved_no_jobs"}
    holder = review._owner(ats_type, token, company["id"])
    if holder:
        return {"outcome": "duplicate", "board": f"{ats_type}:{token}", "owner": holder}
    return _move(company, ats_type, token, url, feed, pull)


def _attempt(change, pull):
    """One change, isolated: it cannot stop the pull, and a slow or hostile page costs that change and no more."""
    try:
        with review._time_limit(review.SOURCE_SECONDS):
            return _apply(change, pull)
    except review.SourceTimedOut:
        return {"outcome": "timeout"}
    except http.PrivateAddressRefused:
        return {"outcome": "unsafe"}
    except Exception as error:  # noqa: BLE001 — recorded for the page; the next change and the pull still run.
        return {"outcome": "error", "errorType": type(error).__name__}


def apply_waiting(pull):
    """Apply what this pull was handed, before it lists its sources, so a moved source is read tonight."""
    folder = os.environ.get("JOBHUNTER_SOURCE_REQUESTS")
    changes = _waiting(folder) if folder and os.path.isdir(folder) else []
    if not changes:
        return
    with db.connect() as conn:
        _ensure(conn)
    with http.public_only():
        for change in changes:
            with db.connect() as conn:
                if not _claim(conn, change):
                    continue
            result = _attempt(change, pull)
            with db.connect() as conn:
                _finish(conn, change["id"], result)
            print(f"   source change for company {change['company_id']}: {result['outcome']}", flush=True)
