"""Standing maintenance of the job sources, run after the nightly source review. See SOURCE-MAINTENANCE.md.

The pull is the only writer of the shared corpus, so this runs at the end of a full pull, on the pull's private copy,
and what it records publishes with the pull. Three passes, each inside its own hard time limit: a source the review
could not connect becomes one open decision for a person, a reader whose reads keep ending part way becomes one repair
brief for a developer, and employers with no job site are worked through a fixed runbook, a few a night.
"""
# CHANGE LOG
# 3 | maintainer@emeraldcoastsystemsgroup.com | A decision reads the clock once, so its wait is exactly the days stated and never a second short; and the sources Pass A raises are read in employer order, so decisions open and are listed in the same order every night.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Six fixes from review. (1) A board is the employer's own only on the same site as its saved homepage or under its name; the saved careers link proved nothing, because the board was reached from it, so a careers link on someone else's site was connected as a page read. (2) A part that asks to end the process (SystemExit) ends its pass and never the pull. (3) Connecting keeps a saved careers link, and changes nothing when the employer has meanwhile been given a board, chosen by a person or removed. (4) A suggestion is kept per employer until the employer has a board or is removed, so it no longer leaves the page after one night. (5) The same-site rule it uses treats two hosts on one vendor's domain as two sites. (6) See the real-socket guard test.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Maintain job sources after each full pull: raise one decision for a person when the review could not connect a source on three runs, write one repair brief per reader and reason for reads that stay partial, look for a job site for employers that have none along a fixed runbook, and keep one nightly report. Every pass has a hard time limit, and nothing here can stop the pull from publishing.
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
import traceback
from collections import Counter
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from . import ats, config, db, http, native_browser, resolve
from . import source_memory as memory
from . import source_requests as changes
from . import source_review as review

# Pass A: a source nothing could connect becomes one decision for a person.
MIN_FAILED_REVIEWS = 3       # Separate review runs in a row that found nothing, were refused, timed out or failed.
STALE_DAYS = 14              # No successful pull for this long, or never.
SNOOZE_DAYS = 60             # After "Keep trying" the same source is not raised again for this long.
KEEP_HISTORY = 12            # Review runs remembered per employer; the evidence a person sees is these.
ACTION_SECONDS = 60          # No network in this pass, so this only bounds a corpus that answers slowly.
# Pass B: a reader whose reads keep ending part way becomes one repair brief for a developer.
MIN_PARTIAL_PULLS = 3        # Partial on this many pulls in a row.
MIN_GROUP_EMPLOYERS = 3      # One odd employer is its own site; three on one reader is the reader.
LONE_EMPLOYER_JOBS = 500     # Unless that one employer is large.
BRIEF_EMPLOYERS = 10         # Employers named in a brief.
BRIEF_SECONDS = 60           # No network in this pass either.
# Pass C: employers with no job site, a few a night.
MAX_DISCOVERIES = 20         # Employers a night.
DISCOVERY_SECONDS = 3 * 60   # A hard stop for one employer.
MAX_DISCOVERY_SECONDS = 20 * 60  # A hard stop for the pass: the pull does not publish until it ends.
MIN_JOBS = 3                 # A board with fewer jobs is suggested, not connected.
MAX_CAREER_LINKS = 4         # Careers links tried from one homepage.
REFUSED_DAYS = review.BLOCKED_DAYS  # An employer that refuses us is left alone, as the review leaves it.
READER_SECONDS = native_browser.PROCESS_TIMEOUT + 5  # The page reader is only started with its whole deadline left.
# The report.
KEEP_REPORTS = 30
LIST_LIMIT = 50

FAILED_REVIEW = ("nothing", "blocked", "timeout", "error")
NO_SITE = ("pending", "not_found", "careers_only")
ENGINE = "career-hunter/engine/"
CONTRACT_SHAPE = "career-hunter/tests/career-jibe-feed-contract.py"
REASONS = {
    "completion_unverified": "The reader has no proof that it reached the end of the board's list.",
    "pagination_incomplete": "Not every page of the list was received.",
    "page_limit_reached": "The board has more jobs than the reader could read.",
    "http_refused": "The board refused a request part way through the list.",
    "invalid_feed_rows": "The board returned invalid or duplicate job records.",
}


class _AskedToExit(Exception):
    """A part of a pass asked to end the process, as the page reader does at its own hard deadline. The pass ends
    instead, because the pull has finished its work and must still publish."""


class _StatementStopped(Exception):
    """A statement was still running when its pass ran out of time, and was given up."""


def ensure(conn):
    """Only the ingest writer calls this; a published corpus is read-only to everyone else."""
    memory.ensure(conn)
    review.ensure(conn)
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('source_review_history')} (company_id INTEGER NOT NULL,
        reviewed_at TEXT NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY (company_id, reviewed_at))""")
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('source_actions')} (id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, opened_at TEXT NOT NULL, decided_at TEXT,
        snooze_until TEXT, evidence TEXT NOT NULL)""")
    conn.execute(f"""CREATE UNIQUE INDEX IF NOT EXISTS {memory.table('source_actions_one_open')}
        ON source_actions (company_id) WHERE state = 'open'""")
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('source_repair_briefs')} (id TEXT PRIMARY KEY,
        reader TEXT NOT NULL, reason TEXT NOT NULL, opened_at TEXT NOT NULL, updated_at TEXT NOT NULL, state TEXT NOT NULL,
        brief TEXT NOT NULL, employers TEXT NOT NULL)""")
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('source_discovery')} (company_id INTEGER PRIMARY KEY,
        last_tried_at TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, outcome TEXT NOT NULL, step TEXT, detail TEXT NOT NULL)""")
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('source_suggestions')} (company_id INTEGER PRIMARY KEY,
        board TEXT NOT NULL, step TEXT, reason TEXT NOT NULL, jobs INTEGER, owner TEXT, suggested_at TEXT NOT NULL)""")
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('source_maintenance_runs')} (run_id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL, finished_at TEXT NOT NULL, report TEXT NOT NULL)""")


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _in_days(days):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(timespec="seconds")


def _open_jobs(conn, company_id):
    on = "TRUE" if config.POSTGRES else "1"
    return conn.execute(f"SELECT COUNT(*) AS n FROM {db.corpus_table()} WHERE company_id=? AND active={on}",
                        (company_id,)).fetchone()["n"]


# ── Pass A: escalate what could not be connected ─────────────────────────────

def _remember_reviews(conn):
    """The review keeps one outcome per employer, so each run's outcome is copied here to count separate runs."""
    history = memory.table("source_review_history")
    conn.execute(f"""INSERT INTO {history} (company_id,reviewed_at,outcome)
        SELECT company_id,reviewed_at,outcome FROM {memory.table('source_review_items')} WHERE true
        ON CONFLICT (company_id,reviewed_at) DO NOTHING""")
    conn.execute(f"""DELETE FROM {history} WHERE rowid IN (SELECT rowid FROM (SELECT rowid,
        ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY reviewed_at DESC) AS n FROM {history}) WHERE n > ?)""",
                 (KEEP_HISTORY,))


def _review_runs(conn):
    """Each employer's remembered review runs, newest first."""
    runs = {}
    for row in conn.execute(f"""SELECT company_id,reviewed_at,outcome FROM {memory.table('source_review_history')}
            ORDER BY company_id, reviewed_at DESC""").fetchall():
        runs.setdefault(row["company_id"], []).append({"at": row["reviewed_at"], "outcome": row["outcome"]})
    return runs


def _failed_in_a_row(runs):
    """How many of the newest review runs failed to connect, counted back to the first one that did not."""
    count = 0
    for run in runs:
        if run["outcome"] not in FAILED_REVIEW:
            break
        count += 1
    return count


def _unconnected(conn):
    """Sources the pull cannot read now, by the review's own rule, with no successful pull for STALE_DAYS or ever."""
    held = ",".join("?" for _ in review._HELD)
    return [dict(row) for row in conn.execute(f"""
        SELECT c.id, c.name, c.homepage, c.careers_url, c.ats_type, c.ats_token,
               s.last_error_code, s.consecutive_failures, s.last_success_at
          FROM {db.companies_table()} c
          LEFT JOIN {memory.table('source_pull_state')} s ON s.company_id = c.id
         WHERE COALESCE(c.ats_type, '') NOT IN ({held})
           AND COALESCE(c.discover_status, '') NOT IN ('manual', 'removed')
           AND (COALESCE(c.ats_token, '') = ''
                OR (s.status IN ('empty_unconfirmed', 'failed') AND s.consecutive_failures >= ?))
           AND (s.last_success_at IS NULL OR s.last_success_at <= ?)
         ORDER BY c.id""",
        (*review._HELD, review.MIN_FAILED_PULLS, _in_days(-STALE_DAYS))).fetchall()]


def _evidence(conn, row, runs):
    """What a person needs to decide: what was tried, how each try went, and what is still stored."""
    seen = conn.execute(f"SELECT MAX(last_seen_at) AS at FROM {db.corpus_table()} WHERE company_id=?", (row["id"],)).fetchone()["at"]
    return {"employer": row["name"],
            "board": f"{row['ats_type']}:{row['ats_token']}" if row["ats_token"] else None,
            "link": row["careers_url"], "homepage": row["homepage"], "reviews": runs,
            "lastErrorCode": row["last_error_code"], "failuresInARow": row["consecutive_failures"] or 0,
            "lastSuccessAt": row["last_success_at"], "lastJobsReadAt": seen, "openJobs": _open_jobs(conn, row["id"])}


def _escalate(conn):
    """One open decision per source nothing could connect. One that reads again, or was settled another way, is withdrawn."""
    _remember_reviews(conn)
    runs, table = _review_runs(conn), memory.table("source_actions")
    due = {row["id"]: row for row in _unconnected(conn)
           if _failed_in_a_row(runs.get(row["id"], [])) >= MIN_FAILED_REVIEWS}
    is_open = {row["company_id"]: row["id"] for row in conn.execute(f"SELECT id,company_id FROM {table} WHERE state='open'").fetchall()}
    snoozed = {row["company_id"] for row in conn.execute(
        f"SELECT company_id FROM {table} WHERE state='kept' AND snooze_until > ?", (_now(),)).fetchall()}
    counts = {"opened": 0, "withdrawn": 0}
    for company_id, action_id in is_open.items():
        if company_id in due:
            conn.execute(f"UPDATE {table} SET evidence=? WHERE id=?",
                         (json.dumps(_evidence(conn, due[company_id], runs[company_id])), action_id))
        else:
            conn.execute(f"DELETE FROM {table} WHERE id=?", (action_id,))
            counts["withdrawn"] += 1
    for company_id, row in due.items():
        if company_id not in is_open and company_id not in snoozed:
            conn.execute(f"INSERT INTO {table} (company_id,kind,state,opened_at,evidence) VALUES (?,'archive','open',?,?)",
                         (company_id, _now(), json.dumps(_evidence(conn, row, runs[company_id]))))
            counts["opened"] += 1
    return counts


def decide(conn, company_id, state):
    """A person's answer to an open decision: 'archived' when the employer was removed, 'kept' to keep trying.
    Returns None when no decision was waiting, else until when the source is not raised again (nothing for 'archived').
    Called by the pull as it applies the person's saved change."""
    ensure(conn)
    now = datetime.now(timezone.utc)  # One reading of the clock, so the wait is exactly SNOOZE_DAYS from the decision.
    until = (now + timedelta(days=SNOOZE_DAYS)).isoformat(timespec="seconds") if state == "kept" else None
    done = conn.execute(f"""UPDATE {memory.table('source_actions')} SET state=?,decided_at=?,snooze_until=?
        WHERE company_id=? AND state='open'""", (state, now.isoformat(timespec="seconds"), until, company_id))
    return {"until": until} if done.rowcount else None


# ── Pass B: partial reads go to a developer ──────────────────────────────────

def _partial_sources(conn):
    """Sources whose newest MIN_PARTIAL_PULLS pulls all ended partial, the most stored jobs first."""
    on = "TRUE" if config.POSTGRES else "1"
    return [dict(row) for row in conn.execute(f"""
        SELECT c.id, c.name, c.ats_type AS reader, c.ats_token AS board,
               COALESCE(s.last_error_code, 'completion_unverified') AS reason, s.fetched AS read,
               s.consecutive_failures AS pulls,
               (SELECT COUNT(*) FROM {db.corpus_table()} p WHERE p.company_id = c.id AND p.active = {on}) AS jobs
          FROM {memory.table('source_pull_state')} s JOIN {db.companies_table()} c ON c.id = s.company_id
         WHERE s.status = 'partial' AND COALESCE(c.discover_status, '') <> 'removed'
           AND c.id IN (SELECT company_id FROM (SELECT company_id, status, ROW_NUMBER() OVER (
                   PARTITION BY company_id ORDER BY completed_at DESC, attempt_id DESC) AS n
                   FROM {memory.table('source_pull_runs')})
                 WHERE n <= ? GROUP BY company_id HAVING COUNT(*) = ? AND SUM(status = 'partial') = ?)
         ORDER BY jobs DESC, c.name""", (MIN_PARTIAL_PULLS,) * 3).fetchall()]


def _groups(sources):
    """Sources by reader and reason, keeping a group only when it is the reader's fault to look at, not one site's."""
    groups = {}
    for source in sources:
        if source["reader"] in ats.BY_NAME:
            groups.setdefault((source["reader"], source["reason"]), []).append(source)
    return {key: rows for key, rows in groups.items()
            if len(rows) >= MIN_GROUP_EMPLOYERS or rows[0]["jobs"] >= LONE_EMPLOYER_JOBS}


def brief_id(reader, reason):
    """The same reader and reason is the same brief every night, so a developer's copy stays the current one."""
    return hashlib.sha256(f"{reader}\n{reason}".encode()).hexdigest()[:16]


def _reader_source(reader):
    """Where a reader lives: what to call it and the files that hold it."""
    if reader == "web":
        return "the page reader", [ENGINE + "jobhunter/browser_fetch.cjs", ENGINE + "jobhunter/native_browser.py"]
    cls = ats.BY_NAME[reader]
    return f"the `{cls.__name__}` class", [ENGINE + cls.__module__.replace(".", "/") + ".py"]


def _cell(value):
    """Employer text inside a Markdown table cell: one line, and no cell or code boundary of its own."""
    return " ".join(str(value if value is not None else "").split()).replace("|", "/").replace("`", "'")


def _brief(reader, reason, rows):
    """The brief a developer tool is handed with the named files: what is wrong, where, who it affects and what done means."""
    what, files = _reader_source(reader)
    words = REASONS.get(reason, f"The read ended with the code {reason}.")
    jobs = sum(row["jobs"] for row in rows)
    table = "\n".join(f"| {_cell(row['name'])} | {_cell(row['board'])} | {row['read']} | {row['pulls']} | {row['jobs']} |"
                      for row in rows[:BRIEF_EMPLOYERS])
    handed = "\n".join(f"- `{path}`" for path in [*files, ENGINE + "jobhunter/source_memory.py", CONTRACT_SHAPE])
    return f"""# Repair the {reader} reader: reads keep ending part way

## What is wrong

- Reader: {what} in `{files[0]}`.
- Reason code: `{reason}`. {words}
- Employers affected: {len(rows)}.
- Open jobs stored for the employers affected: {jobs}.
- Every employer counted here ended its last {MIN_PARTIAL_PULLS} nightly pulls as partial.

A partial read refreshes the jobs it received and closes none, so a job that left one of these boards stays open in Career.

## Employers affected

Most stored jobs first; {min(len(rows), BRIEF_EMPLOYERS)} of {len(rows)} shown.

| Employer | Board token | Jobs read on the last pull | Unconfirmed pulls in a row | Open jobs stored |
|---|---|---|---|---|
{table}

## What done means

- The reader returns a `source_memory.Feed` with `complete=True` and `reason=None` only when it has proven the end of the list, or has read the count the board states. In every other case it keeps returning a partial feed with a reason, which closes nothing.
- A contract test in the shape of `{CONTRACT_SHAPE}` proves both over recorded board replies and a real temporary SQLite store: a whole list closes a job that left it, and a list cut short, refused part way or empty closes nothing.
- The test has a `.test.mjs` wrapper beside it and a case in `career-hunter/tests/test-lab.yaml`.

## Files to hand over

{handed}
"""


def _write_brief(conn, key, rows):
    """Open a new brief, reopen a closed one, or bring an open one up to date. Returns which."""
    reader, reason = key
    table, now = memory.table("source_repair_briefs"), _now()
    employers = json.dumps({"count": len(rows), "jobs": sum(row["jobs"] for row in rows), "shown": [
        {"id": row["id"], "name": row["name"], "board": row["board"], "read": row["read"], "pulls": row["pulls"], "jobs": row["jobs"]}
        for row in rows[:BRIEF_EMPLOYERS]]})
    existing = conn.execute(f"SELECT state FROM {table} WHERE id=?", (brief_id(reader, reason),)).fetchone()
    if existing is None:
        conn.execute(f"""INSERT INTO {table} (id,reader,reason,opened_at,updated_at,state,brief,employers)
            VALUES (?,?,?,?,?,'open',?,?)""", (brief_id(reader, reason), reader, reason, now, now, _brief(reader, reason, rows), employers))
        return "opened"
    reopened = existing["state"] != "open"
    conn.execute(f"""UPDATE {table} SET state='open',updated_at=?,brief=?,employers=?{',opened_at=?' if reopened else ''}
        WHERE id=?""", (now, _brief(reader, reason, rows), employers, *([now] if reopened else []), brief_id(reader, reason)))
    return "opened" if reopened else "updated"


def _repair_briefs(conn):
    """One brief per reader and reason that qualifies tonight; one that no longer qualifies is closed."""
    groups, table = _groups(_partial_sources(conn)), memory.table("source_repair_briefs")
    counts = Counter({"opened": 0, "updated": 0, "closed": 0})
    for key, rows in groups.items():
        counts[_write_brief(conn, key, rows)] += 1
    current = [brief_id(*key) for key in groups]
    closed = conn.execute(f"""UPDATE {table} SET state='closed',updated_at=? WHERE state='open'
        AND id NOT IN ({','.join('?' for _ in current) or "''"})""", (_now(), *current))
    counts["closed"] = closed.rowcount
    return dict(counts)


# ── Pass C: find a job site for employers that have none ─────────────────────

def _stop(outcome):
    return {"result": "stop", "outcome": outcome}


def _nothing(note, **more):
    return {"result": "nothing", "note": note, **more}


def _address(link):
    """A saved link as an address to read. Some were saved without their scheme."""
    link = (link or "").strip()
    return link if not link or "://" in link else "https://" + link


def _names_a_board(link):
    """Whether a link's own address names a job board, so its page need not be read to know."""
    named = resolve.classify_url(link)
    return bool(named) and named[0] != "workday_host"


def _board_at(link, must_open=False):
    """Runbook step 1 on one link: the job board it leads to, and that board's jobs."""
    if not changes._is_public_link(link):
        return _stop("unsafe")
    if not _names_a_board(link):
        # The address does not name a board, so the page is read. A refusal ends the work on this employer.
        page, problem = review._read_page(link)
        if problem in ("blocked", "unsafe"):
            return _stop(problem)
        if must_open and not page:
            return _nothing("the link did not open", link=link)
    hit = resolve.classify_url_deep(link)
    if not hit or hit[0] not in ats.BY_NAME:
        return _nothing("no job board found from this link", link=link)
    feed = review._jobs_at(*hit)
    if not feed:
        return _nothing("the board returned no jobs", link=link, board=f"{hit[0]}:{hit[1]}")
    return {"result": "board", "ats": hit[0], "token": hit[1], "link": link, "feed": feed}


def _saved_link(row, _left):
    """Step 1: the employer's saved careers link."""
    return _board_at(row["careers_url"]) if row["careers_url"] else _nothing("no saved careers link")


def _career_links(page):
    """The homepage's careers links, found the way `resolve.resolve_platform` finds them: the page's own links that look
    like a job search, then the usual careers addresses on the homepage's own domain. A link to another site counts only
    when its address is itself a job board."""
    found = [urljoin(page.url, a["href"]) for a in BeautifulSoup(page.text, "lxml").find_all("a", href=True)
             if resolve._CAREER_LINK.search(a["href"])]
    links = {}
    for link in [*found, *resolve._candidate_starts(None, page.url, None)[1:]]:
        if review._same_site(link, page.url) or _names_a_board(link):
            links.setdefault(link.rstrip("/"), link)
    links.pop(page.url.rstrip("/"), None)
    return list(links.values())[:MAX_CAREER_LINKS]


def _homepage_link(row, _left):
    """Step 2: the careers links on the employer's own homepage, each through step 1 until one leads to a board."""
    if not row["homepage"]:
        return _nothing("no saved homepage")
    if not changes._is_public_link(row["homepage"]):
        return _stop("unsafe")
    page, problem = review._read_page(row["homepage"])
    if problem in ("blocked", "unsafe"):
        return _stop(problem)
    if not page:
        return _nothing("the homepage could not be read")
    tried = []
    for link in _career_links(page):
        if link.rstrip("/") == (row["careers_url"] or "").rstrip("/") or not changes._is_public_link(link):
            continue
        tried.append(link)
        found = _board_at(link, must_open=True)
        if found["result"] == "stop" or found["result"] == "board":
            return found
    return _nothing("no job board found from the homepage", links=tried)


def _page_read(row, left):
    """Step 3: read the saved careers link as a page. Only under the page reader's own read policy, and only with its
    whole deadline left, so the stop for this employer never lands in the middle of a browser."""
    link = row["careers_url"]
    if not link or not changes._reader_guarded():
        return _nothing("the page reader is not available here" if link else "no saved careers link")
    if not changes._is_public_link(link):
        return _stop("unsafe")
    if left() < READER_SECONDS:
        return _nothing("too little time left for a page read")
    from . import webscrape
    try:
        jobs = webscrape.scrape_careers(link)
    except native_browser.BrowserReadUnavailable as refusal:
        if refusal.code in ("browser_refused", "challenge_detected"):
            return _stop("blocked")
        return _nothing("the page could not be read", code=refusal.code)
    except Exception as error:  # noqa: BLE001 — a page that cannot be read is the ordinary case here.
        return _nothing("the page could not be read", errorType=type(error).__name__)
    if len(jobs) < MIN_JOBS:
        return _nothing("the page showed fewer than 3 jobs", link=link)
    return {"result": "board", "ats": "web", "token": link, "link": link,
            "feed": memory.Feed(jobs, reason="completion_unverified")}


# The runbook: each step named, tried in this order, and recorded with what it found.
RUNBOOK = (("saved-link", _saved_link), ("homepage-link", _homepage_link), ("page-read", _page_read))


def _connect(row, found):
    """Set the board and take its jobs in one transaction, as a saved change does, but found, not chosen by a person.
    A saved careers link is kept; only an empty one is filled. Nothing changes, and no job is taken, if the employer
    has meanwhile been given a board, been chosen by a person or been removed."""
    feed = found["feed"]
    with db.connect() as conn:
        changed = conn.execute(f"""UPDATE {db.companies_table()} SET ats_type=?,ats_token=?,discover_status='found',
            careers_url=CASE WHEN COALESCE(careers_url,'')='' THEN ? ELSE careers_url END
            WHERE id=? AND COALESCE(ats_type,'')='' AND COALESCE(discover_status,'') NOT IN ('manual','removed')""",
                               (found["ats"], found["token"], found["link"], row["id"]))
        if not changed.rowcount:
            return {"outcome": "nothing", "reason": "the employer was given a board or removed while it was looked up"}
        feed.attempt_id, feed.started_at = memory.begin_on(conn, row["id"], memory.source_key(found["ats"], found["token"]))
        counts = memory.ingest(conn, row["id"], feed)
        # It is connected now, so a decision opened for it earlier tonight has nothing left to ask.
        conn.execute(f"DELETE FROM {memory.table('source_actions')} WHERE company_id=? AND state='open'", (row["id"],))
    return {"outcome": "connected", "board": f"{found['ats']}:{found['token']}", "jobs": len(feed), "new": counts["new"],
            "complete": bool(counts["complete"])}


def _board_hosts(found):
    """The hosts a board is read from, when its token holds addresses: a page or list read is its link, a host-token
    reader is its host. A vendor's own id for a board (a Greenhouse name, a Workday tenant) holds none."""
    hosts = []
    for part in found["token"].split("|"):
        host = urlsplit(part).hostname if "://" in part else part if "." in part and ":" not in part and "/" not in part else None
        if host:
            hosts.append(host.lower())
    return hosts


def _is_employers_own(row, found):
    """Whether the board is the employer's own: on the same site as its saved homepage, or under the employer's name by
    the review's rule. The saved careers link proves nothing here, because the board was reached from it: a careers
    link on an aggregator's or a staffing firm's site would otherwise vouch for itself. A homepage on a vendor's
    domain lends no name either, since that name is the vendor's."""
    homepage = row["homepage"]
    hosts = _board_hosts(found)
    if homepage and any(review._same_site("https://" + host, homepage) for host in hosts):
        return True
    vendor_home = bool(homepage) and review._on_vendor_domain(urlsplit(homepage).hostname)
    known = {**row, "careers_url": None, "homepage": None if vendor_home else homepage}
    return any(review._resembles(known, name) for name in (hosts or [found["token"]]))


def _judge(row, found):
    """Connect only a board with enough jobs, that is the employer's own and that no other employer holds. Anything
    weaker is left for a person."""
    board, jobs = f"{found['ats']}:{found['token']}", len(found["feed"])
    suggest = lambda reason, **more: {"outcome": "suggested", "reason": reason, "options": [board], "jobs": jobs, **more}
    owner = review._owner(found["ats"], found["token"], row["id"])
    if owner:
        return suggest("another employer already uses this board", owner=owner)
    if jobs < MIN_JOBS:
        return suggest("the board has fewer than 3 jobs")
    if not _is_employers_own(row, found):
        return suggest("it is not on the employer's own site" if _board_hosts(found) else "the board's name does not look like this employer")
    return _connect(row, found)


def _discover_one(row, steps, left):
    """Walk the runbook for one employer. The first step that finds a board ends it: connected, or left for a person."""
    row = {**row, "careers_url": _address(row["careers_url"]), "homepage": _address(row["homepage"])}
    for name, step in RUNBOOK:
        found = step(row, left)
        note = {key: value for key, value in found.items() if key != "feed"}
        if found["result"] == "board":
            note["board"], note["jobs"] = f"{found['ats']}:{found['token']}", len(found["feed"])
        steps.append({"step": name, **note})
        if found["result"] == "stop":
            return {"outcome": found["outcome"], "step": name}
        if found["result"] == "board":
            return {**_judge(row, found), "step": name}
    return {"outcome": "nothing"}


def _attempt(row, seconds):
    """One employer, isolated: a slow or hostile site costs that employer and no more."""
    steps, deadline = [], time.monotonic() + seconds
    try:
        with review._time_limit(seconds):
            return {**_discover_one(row, steps, lambda: deadline - time.monotonic()), "steps": steps}
    except review.SourceTimedOut:
        result = {"outcome": "timeout"}
    except http.PrivateAddressRefused:
        result = {"outcome": "unsafe"}
    except SystemExit as asked:
        raise _AskedToExit() from asked
    except Exception as error:  # noqa: BLE001 — recorded for the report; the next employer still runs.
        result = {"outcome": "error", "errorType": type(error).__name__}
    # A step is recorded when it ends, so the one that was cut short is the next in the runbook.
    return {**result, "step": RUNBOOK[min(len(steps), len(RUNBOOK) - 1)][0], "steps": steps}


def _discovery_queue(conn, since):
    """Employers with no board, least recently tried first, less those already tried in this pull. One that refused us
    waits REFUSED_DAYS."""
    table = memory.table("source_discovery")
    tried = conn.execute(f"SELECT COUNT(*) AS n FROM {table} WHERE last_tried_at >= ?", (since,)).fetchone()["n"]
    rows = [dict(row) for row in conn.execute(f"""
        SELECT c.id, c.name, c.homepage, c.careers_url FROM {db.companies_table()} c
          LEFT JOIN {table} d ON d.company_id = c.id
         WHERE COALESCE(c.ats_type, '') = '' AND c.discover_status IN ({','.join('?' for _ in NO_SITE)})
           AND (d.company_id IS NULL OR d.last_tried_at < ?)
           AND (d.outcome IS NULL OR d.outcome NOT IN ('blocked', 'unsafe') OR d.last_tried_at <= ?)
         ORDER BY d.last_tried_at IS NOT NULL, d.last_tried_at, c.id""", (*NO_SITE, since, _in_days(-REFUSED_DAYS))).fetchall()]
    return rows[:max(MAX_DISCOVERIES - tried, 0)], max(len(rows) - max(MAX_DISCOVERIES - tried, 0), 0)


def _keep_suggestion(conn, row, result):
    """One open suggestion per employer, replaced when the runbook suggests again. A try that connects the employer,
    or looks again and finds nothing, ends it."""
    table = memory.table("source_suggestions")
    if result["outcome"] == "suggested":
        conn.execute(f"""INSERT INTO {table} (company_id,board,step,reason,jobs,owner,suggested_at) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT (company_id) DO UPDATE SET board=EXCLUDED.board,step=EXCLUDED.step,reason=EXCLUDED.reason,
            jobs=EXCLUDED.jobs,owner=EXCLUDED.owner,suggested_at=EXCLUDED.suggested_at""",
                     (row["id"], result["options"][0], result.get("step"), result["reason"], result.get("jobs"), result.get("owner"), _now()))
    elif result["outcome"] in ("connected", "nothing"):
        conn.execute(f"DELETE FROM {table} WHERE company_id=?", (row["id"],))


def _drop_settled_suggestions(conn):
    """A suggestion ends when its employer has a board, however it got one, or is removed."""
    conn.execute(f"""DELETE FROM {memory.table('source_suggestions')} WHERE company_id NOT IN (SELECT id FROM {db.companies_table()}
        WHERE COALESCE(ats_type,'')='' AND COALESCE(discover_status,'')<>'removed')""")


def _record_discovery(row, result, started=False):
    """Kept per employer as it is tried. The try is written before any reading, so one that ends the process is known."""
    table = memory.table("source_discovery")
    detail = json.dumps({key: value for key, value in result.items() if key not in ("outcome", "step")})
    with db.connect() as conn:
        if started:
            conn.execute(f"""INSERT INTO {table} (company_id,last_tried_at,tries,outcome,step,detail) VALUES (?,?,1,?,?,?)
                ON CONFLICT (company_id) DO UPDATE SET last_tried_at=EXCLUDED.last_tried_at,tries=tries+1,
                outcome=EXCLUDED.outcome,step=EXCLUDED.step,detail=EXCLUDED.detail""",
                         (row["id"], _now(), result["outcome"], result.get("step"), detail))
        else:
            conn.execute(f"UPDATE {table} SET outcome=?,step=?,detail=? WHERE company_id=?",
                         (result["outcome"], result.get("step"), detail, row["id"]))
            _keep_suggestion(conn, row, result)


def _discover(since):
    """Employers one at a time under the public-address guard, until the night's count or the pass's time runs out."""
    deadline = time.monotonic() + MAX_DISCOVERY_SECONDS
    with db.connect() as conn:
        queue, waiting = _discovery_queue(conn, since)
    tried, stopped = 0, {}
    with http.public_only():
        for row in queue:
            left = deadline - time.monotonic()
            if left <= 0:
                break
            tried += 1
            _record_discovery(row, {"outcome": "error", "reason": "the pull stopped during this try"}, started=True)
            try:
                result = _attempt(row, min(DISCOVERY_SECONDS, left))
            except _AskedToExit:
                # A reader asked to end the process so nothing it started lingers. The pull is about to end, so the
                # pass ends here instead and the pull still publishes.
                _record_discovery(row, {"outcome": "timeout", "reason": "a reader passed its own deadline and asked to end the process"})
                stopped = {"stopped": True}
                break
            _record_discovery(row, result)
            print(f"   looked for a job site for {row['name']}: {result['outcome']}", flush=True)
    return {"tried": tried, "waiting": waiting + len(queue) - tried, **stopped}


# ── The nightly report ───────────────────────────────────────────────────────

def _boxed(seconds, work):
    """One pass inside its own hard stop. A pass that fails or runs out is said in the report, and the next still runs."""
    clock = time.monotonic()
    try:
        if seconds is None:  # The pass keeps its own stops, one per employer, which a second alarm would cancel.
            result = work()
        else:
            with review._time_limit(seconds):
                result = work()
    except (review.SourceTimedOut, _StatementStopped):
        result = {"timedOut": True}
    except SystemExit:  # Something in the pass asked to end the process. The pass ends; the pull goes on to publish.
        traceback.print_exc()
        result = {"stopped": True}
    except Exception as error:  # noqa: BLE001 — written to stderr, whose tail the kernel keeps with the run.
        traceback.print_exc()
        result = {"errorType": type(error).__name__}
    return {**result, "seconds": round(time.monotonic() - clock, 1)}


def _in_transaction(work, seconds):
    """A pass that writes in one transaction, so a pass stopped part way leaves nothing half done. The alarm lands only
    between statements (measured: a 0.5 second limit ended a 5 second statement when it returned), so the connection
    also gives up a statement that is still running when the pass's time ends."""
    def in_one():
        deadline = time.monotonic() + seconds
        try:
            with db.connect() as conn:
                conn.set_progress_handler(lambda: time.monotonic() > deadline, 100_000)
                return work(conn)
        except sqlite3.OperationalError as stopped:
            if time.monotonic() > deadline and "interrupt" in str(stopped):
                raise _StatementStopped() from stopped
            raise
    return in_one


def _discovered(conn, since):
    """What this pull's discovery did, read back from what it recorded, so a pull that restarted reports the whole night."""
    rows = conn.execute(f"""SELECT d.company_id, c.name, d.outcome, d.step, d.detail FROM {memory.table('source_discovery')} d
        JOIN {db.companies_table()} c ON c.id = d.company_id WHERE d.last_tried_at >= ? ORDER BY c.name""", (since,)).fetchall()
    entries = [{"company": row["name"], "id": row["company_id"], "outcome": row["outcome"], "step": row["step"],
                **{key: value for key, value in json.loads(row["detail"]).items() if key != "steps"}} for row in rows]
    pick = lambda outcome: [{key: value for key, value in entry.items() if key != "outcome"}
                            for entry in entries if entry["outcome"] == outcome][:LIST_LIMIT]
    return {"tried": len(entries), "outcomes": dict(Counter(entry["outcome"] for entry in entries)),
            "connected": pick("connected"), "suggested": pick("suggested")}


def _report(conn, since, started, seconds, passes):
    actions, briefs = memory.table("source_actions"), memory.table("source_repair_briefs")
    count = lambda sql, *args: conn.execute(sql, args).fetchone()["n"]
    open_briefs = [dict(row) for row in conn.execute(
        f"SELECT id,reader,reason,employers FROM {briefs} WHERE state='open' ORDER BY reader,reason").fetchall()]
    return {"version": 1, "startedAt": started, "finishedAt": _now(), "seconds": seconds, "since": since,
            "actions": {**passes["actions"], "limitSeconds": ACTION_SECONDS,
                        "open": count(f"SELECT COUNT(*) AS n FROM {actions} WHERE state='open'"),
                        "openedSince": count(f"SELECT COUNT(*) AS n FROM {actions} WHERE state='open' AND opened_at >= ?", since)},
            "briefs": {**passes["briefs"], "limitSeconds": BRIEF_SECONDS, "open": len(open_briefs),
                       "list": [{"id": brief["id"], "reader": brief["reader"], "reason": brief["reason"],
                                 **{key: json.loads(brief["employers"])[key] for key in ("count", "jobs")}} for brief in open_briefs][:LIST_LIMIT]},
            "discovery": {**passes["discovery"], "limitSeconds": MAX_DISCOVERY_SECONDS, "limitEmployers": MAX_DISCOVERIES,
                          "employerSeconds": DISCOVERY_SECONDS, **_discovered(conn, since),
                          "suggestionsOpen": count(f"SELECT COUNT(*) AS n FROM {memory.table('source_suggestions')}")}}


def _store(conn, since, report):
    """One report per pull: a pull that restarted writes over its own. The newest KEEP_REPORTS are kept."""
    runs = memory.table("source_maintenance_runs")
    conn.execute(f"""INSERT INTO {runs} (run_id,started_at,finished_at,report) VALUES (?,?,?,?)
        ON CONFLICT (run_id) DO UPDATE SET finished_at=EXCLUDED.finished_at,report=EXCLUDED.report""",
                 ("pull-" + since, report["startedAt"], report["finishedAt"], json.dumps(report)))
    conn.execute(f"""DELETE FROM {runs} WHERE run_id NOT IN
        (SELECT run_id FROM {runs} ORDER BY finished_at DESC, run_id DESC LIMIT ?)""", (KEEP_REPORTS,))


def run(since=None):
    """Maintain once and store the report. `since` is when the pull began; default the last day."""
    if config.POSTGRES or not db.corpus_writable():
        print("Source maintenance: skipped, this process cannot write the corpus.", flush=True)
        return None
    started, clock = _now(), time.monotonic()
    since = since or _in_days(-1)
    with db.connect() as conn:
        ensure(conn)
    passes = {"actions": _boxed(ACTION_SECONDS, _in_transaction(_escalate, ACTION_SECONDS)),
              "briefs": _boxed(BRIEF_SECONDS, _in_transaction(_repair_briefs, BRIEF_SECONDS)),
              "discovery": _boxed(None, lambda: _discover(since))}
    with db.connect() as conn:
        _drop_settled_suggestions(conn)
        report = _report(conn, since, started, round(time.monotonic() - clock), passes)
        _store(conn, since, report)
    print(f"Source maintenance: {report['actions']['open']} sources need a decision, {report['briefs']['open']} repair briefs open, "
          f"{report['discovery']['tried']} employers looked up {report['discovery']['outcomes']}.", flush=True)
    return report


def after_pull(since):
    """The pull already succeeded, so nothing here may stop it from publishing: not a failure, and not a part that asks
    to end the process. A person's interrupt is not caught."""
    try:
        return run(since)
    except (Exception, SystemExit):  # noqa: BLE001 — written to stderr, whose tail the kernel keeps with the run.
        print("Source maintenance failed; the pull publishes without it.", flush=True)
        traceback.print_exc()
        return None
