"""Source changes administrators asked for on the Companies page, applied by a full pull on its private copy.

A request mounts the shared corpus read-only, so the page cannot write it. The route leaves a change in the caller's
store, the kernel moves it to a queue only for an admission holding `career.administer`, and each pull is handed a
snapshot of that queue in the folder JOBHUNTER_SOURCE_REQUESTS names. What happened to each change is kept in the corpus,
so the page can say, and so a change the kernel hands over twice is applied once.

CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Resolve works on the native kernel: a saved change is applied by the next pull, on public addresses only and inside a hard time limit, and its outcome is kept for the page.
2 | maintainer@emeraldcoastsystemsgroup.com | Add, Remove and Put back on the Companies page: `add:<name>|<link>` creates an employer and reads its link, `remove:employer` closes its jobs and takes it out of every pull, and `restore:employer` lists it again.
3 | maintainer@emeraldcoastsystemsgroup.com | A person's answer to a source maintenance decision travels the same way: `keep:employer` marks the open decision kept and stops it being raised again for a while, and an applied `remove:employer` marks it archived.
4 | maintainer@emeraldcoastsystemsgroup.com | Apply only the exact confirmed source decision in one writer transaction; stale or recovered decisions do nothing, and generic remove or keep cannot answer an open decision.
5 | maintainer@emeraldcoastsystemsgroup.com | Verify explicit Oracle source changes with three actual jobs; the same pull still enumerates the changed board in full rather than timing out while resolving it.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from . import ats, config, db, http, resolve, source_review as review
from . import source_memory as memory

# A change the pull keeps stopping on is given up, so it cannot hold back the rest of the night. The person is told.
MAX_ATTEMPTS = 3
KEEP = 200
# An added employer has no row yet; the page sends this in place of its id, and the outcome names the row made.
NEW_EMPLOYER = 2147483647
REMOVE, RESTORE, ADD, KEEP_TRYING = "remove:employer", "restore:employer", "add:", "keep:employer"
DECISION = "decision:"


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


def _change_jobs(ats_type, token):
    """Prove an explicit source change promptly; the full pull still enumerates a previewed board."""
    if ats_type == "oracle_orc":
        return ats.OracleORC.preview(token)
    return review._jobs_at(ats_type, token)


def _from_link(url):
    """The board a link leads to and its jobs, or nothing. A page read directly is the last resort, as Resolve has always done."""
    hit = resolve.classify_url_deep(url)
    ats_type, token = hit if hit and hit[0] != "workday_host" else (None, None)
    feed = _change_jobs(ats_type, token) if ats_type else None
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
        if getattr(feed, "preview", False) and pull is not None:
            _reopen_preview(conn, pull, company["id"])
        added = {"new": counts["new"], "seen": counts["changed"] + counts["unchanged"], "closed": counts["closed"],
                 "skipped": counts["skipped"], "confirmed": int(counts["complete"]), "unconfirmed": int(not counts["complete"])}
        settled = pull is not None and company["id"] not in pull.finished and not getattr(feed, "preview", False)
        if settled:  # Read just now: the pull need not read the same board again tonight.
            pull.settle(conn, company["id"], **added)
    if settled:
        pull.finished.add(company["id"])
        pull.totals.update(added)
    return {"outcome": "applied", "board": f"{ats_type}:{token}", "jobs": len(feed), "new": counts["new"], "closed": counts["closed"],
            "from": f"{company['ats_type'] or 'none'}:{company['ats_token'] or ''}", "complete": bool(counts["complete"])}


def _reopen_preview(conn, pull, company_id):
    """An old source's completed checkpoint cannot stand in for enumeration of its replacement."""
    if company_id not in pull.finished:
        return
    table = memory.table("pull_checkpoint_sources")
    row = conn.execute(f"SELECT counts FROM {table} WHERE company_id=?", (company_id,)).fetchone()
    if row and row["counts"]:
        pull.totals.subtract(json.loads(row["counts"]))
    conn.execute(f"DELETE FROM {table} WHERE company_id=?", (company_id,))
    pull.finished.discard(company_id)
    pull.attempts.pop(company_id, None)


def _parse_add(target):
    """(name, link) from `add:<name>|<link>`, each percent-encoded by the route, or None when either is not usable."""
    name, sep, link = target[len(ADD):].partition("|")
    name, link = unquote(name), unquote(link)
    if not sep or any(ord(ch) < 32 or ord(ch) == 127 for ch in name + link):
        return None
    name, link = " ".join(name.split()), link.strip()
    if not 2 <= len(name) <= 120:
        return None
    parts = urlsplit(link)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return name, link


def _add(change, pull):
    """A new employer from a name and its careers or job-board link. One that is already listed is not made twice: a
    removed one is put back and reads the link, any other is named back to the person."""
    parsed = _parse_add(change["target"])
    if parsed is None:
        return {"outcome": "bad_target"}
    name, link = parsed
    if not _is_public_link(link):  # Before anything reads it.
        return {"outcome": "unsafe", "name": name}
    from . import cli  # cli runs this module during a pull; imported here so neither needs the other loaded first.
    with db.connect() as conn:
        found = cli._match_existing(conn, name)
        if found is not None:
            row = dict(conn.execute(f"SELECT id,name,discover_status FROM {db.companies_table()} WHERE id=?",
                                    (found["id"],)).fetchone())
            if row["discover_status"] != "removed":
                return {"outcome": "duplicate", "owner": row["name"], "companyId": row["id"], "name": name}
            company_id = row["id"]
            conn.execute(f"UPDATE {db.companies_table()} SET discover_status='careers_only',careers_url=? WHERE id=?",
                         (link, company_id))
        else:
            company_id = db.upsert_company(conn, name, careers_url=link, discover_status="careers_only", source_list="added")
    result = _apply({**change, "company_id": company_id, "target": link}, pull)
    return {**result, "outcome": "added" if result["outcome"] == "applied" else result["outcome"],
            "companyId": company_id, "name": name}


def _company(company_id):
    with db.connect() as conn:
        row = conn.execute(f"SELECT id,name,ats_type,ats_token,careers_url,discover_status FROM {db.companies_table()} WHERE id=?",
                           (company_id,)).fetchone()
    return dict(row) if row else None


def _writer_company(conn, company_id):
    """Read current source state only after reserving this decision's writer transaction."""
    if not config.POSTGRES:
        conn.execute("BEGIN IMMEDIATE")
    _maintenance().ensure(conn)
    lock = " FOR UPDATE" if config.POSTGRES else ""
    row = conn.execute(f"SELECT id,name,discover_status FROM {db.companies_table()} WHERE id=?{lock}",
                       (company_id,)).fetchone()
    return dict(row) if row else None


def _open_decision(conn, company_id):
    lock = " FOR UPDATE" if config.POSTGRES else ""
    return conn.execute(f"SELECT id FROM {memory.table('source_actions')} WHERE company_id=? AND state='open'{lock}",
                        (company_id,)).fetchone()


def _remove_on(conn, company):
    """Keep the employer row for saved jobs while removing its active jobs inside the caller's transaction."""
    if company["discover_status"] == "removed":
        return {"outcome": "removed", "closed": 0, "name": company["name"]}
    on, off = ("TRUE", "FALSE") if config.POSTGRES else ("1", "0")
    closed = conn.execute(f"SELECT COUNT(*) AS n FROM {db.corpus_table()} WHERE company_id=? AND active={on}",
                          (company["id"],)).fetchone()["n"]
    conn.execute(f"UPDATE {db.corpus_table()} SET active={off} WHERE company_id=? AND active={on}", (company["id"],))
    conn.execute(f"UPDATE {db.companies_table()} SET discover_status='removed' WHERE id=?", (company["id"],))
    conn.execute(f"DELETE FROM {memory.table('source_pull_state')} WHERE company_id=?", (company["id"],))
    return {"outcome": "removed", "closed": closed, "name": company["name"]}


def _remove(company):
    """A generic removal cannot stand in for confirming a particular open source decision."""
    with db.connect() as conn:
        current = _writer_company(conn, company["id"])
        if current is None:
            return {"outcome": "unknown_company"}
        if _open_decision(conn, current["id"]):
            return {"outcome": "decision_required", "name": current["name"]}
        return _remove_on(conn, current)


def _maintenance():
    """Source maintenance uses this module's link checks, so it is loaded here and not at the top."""
    from . import source_maintenance
    return source_maintenance


def _keep(company):
    """Only a target identifying the confirmed decision may keep an open source decision."""
    with db.connect() as conn:
        current = _writer_company(conn, company["id"])
        if current is None:
            return {"outcome": "unknown_company"}
        if _open_decision(conn, current["id"]):
            return {"outcome": "decision_required", "name": current["name"]}
        outcome = "removed_employer" if current["discover_status"] == "removed" else "no_decision"
        return {"outcome": outcome, "name": current["name"]}


def _parse_decision(target):
    """A closed, canonical target binds the answer to one immutable source-action identity."""
    fields = target.split(":")
    if len(target) > 2048 or len(fields) != 4 or fields[0] != "decision" or fields[3] not in ("archive", "keep"):
        return None
    if re.fullmatch(r"[1-9][0-9]{0,15}", fields[1]) is None or int(fields[1]) > 9007199254740991:
        return None
    try:
        opened = unquote(fields[2], encoding="utf-8", errors="strict")
        if not 1 <= len(opened) <= 128 or any(ord(ch) < 32 or ord(ch) == 127 for ch in opened):
            return None
        if quote(opened, safe="-_.~") != fields[2]:
            return None
    except (UnicodeError, ValueError):
        return None
    return int(fields[1]), opened, fields[3]


def _aware_instant(value):
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None and parsed.utcoffset() is not None else None
    except (AttributeError, TypeError, ValueError):
        return None


def _recovered_since(conn, company_id, opened):
    lock = " FOR UPDATE" if config.POSTGRES else ""
    row = conn.execute(f"SELECT last_success_at FROM {memory.table('source_pull_state')} WHERE company_id=?{lock}",
                       (company_id,)).fetchone()
    success, original = _aware_instant(row["last_success_at"] if row else None), _aware_instant(opened)
    return success is not None and original is not None and success > original


def _apply_decision(change):
    parsed = _parse_decision(change["target"])
    if parsed is None:
        return {"outcome": "bad_target"}
    action_id, opened, answer = parsed
    with db.connect() as conn:
        company = _writer_company(conn, change["company_id"])
        lock = " FOR UPDATE" if config.POSTGRES else ""
        action = conn.execute(f"""SELECT id FROM {memory.table('source_actions')}
            WHERE id=? AND company_id=? AND opened_at=? AND kind='archive' AND state='open'{lock}""",
            (action_id, change["company_id"], opened)).fetchone()
        if company is None or action is None or company["discover_status"] in ("manual", "removed"):
            return {"outcome": "stale_decision"}
        if _recovered_since(conn, company["id"], opened):
            return {"outcome": "stale_decision"}
        decided = _maintenance().decide(conn, company["id"], "archived" if answer == "archive" else "kept")
        if decided is None:
            return {"outcome": "stale_decision"}
        if answer == "archive":
            return _remove_on(conn, company)
        return {"outcome": "kept", "name": company["name"], "until": decided["until"]}


def _restore(company):
    """Listed again as it was found. The same pull reads it, and a job still on its board opens again."""
    if company["discover_status"] != "removed":
        return {"outcome": "restored", "name": company["name"]}
    status = "found" if company["ats_type"] else "careers_only" if company["careers_url"] else "pending"
    with db.connect() as conn:
        conn.execute(f"UPDATE {db.companies_table()} SET discover_status=? WHERE id=?", (status, company["id"]))
    return {"outcome": "restored", "name": company["name"]}


def _apply(change, pull):
    if change["target"].startswith(DECISION):
        return _apply_decision(change)
    if change["target"].startswith(ADD):
        return _add(change, pull)
    company = _company(change["company_id"])
    if company is None:
        return {"outcome": "unknown_company"}
    if change["target"] == REMOVE:
        return _remove(company)
    if change["target"] == RESTORE:
        return _restore(company)
    if change["target"] == KEEP_TRYING:
        return _keep(company)
    if company["discover_status"] == "removed":
        return {"outcome": "removed_employer", "name": company["name"]}
    ats_type, token, url = _parse_target(change["target"])
    if not ats_type and not url:
        return {"outcome": "bad_target"}
    link = _link_in(url, token)
    if link and not _is_public_link(link):  # Before anything reads it.
        return {"outcome": "unsafe"}
    if ats_type == "web" and (not link or not _reader_guarded()):
        return {"outcome": "no_jobs"}
    feed = _change_jobs(ats_type, token) if ats_type else None
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
