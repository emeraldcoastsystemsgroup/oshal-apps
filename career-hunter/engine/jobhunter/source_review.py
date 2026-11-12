"""Nightly review of the job sources the pull could not read. See SOURCE-REVIEW.md.

Runs at the end of a full pull, on the pull's private copy of the shared corpus, so what it finds
publishes with the pull and a failed review costs nothing that was already read. It rechecks dead
sources and employers with no feed, repairs one only on evidence from the employer's own page, and
writes a report the Companies page shows.
"""
# CHANGE LOG
# 4 | maintainer@emeraldcoastsystemsgroup.com | A careers link or homepage on a board vendor's site lends the employer no name in `_resembles`. Its site label is the vendor's ("lever" from jobs.lever.co/acme, "myworkdayjobs" from acme.wd5.myworkdayjobs.com), so any board with that word in it (cleverdevices) looked like the employer, and the review could move the employer onto another company's board. The employer's own name and its own site still count.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Two hosts on one board vendor's domain are no longer the same site. `_same_site` compared the last two labels of a host, so foo.avature.net and bar.avature.net, two employers' boards, counted as one site. On a vendor's domain the whole host must now match. The vendor domains are read from the two patterns the engine already keeps of vendors' hosts, and from the resolver's own reading of an address.
# 2 | maintainer@emeraldcoastsystemsgroup.com | An employer an administrator removed is not reviewed and not counted as having no feed.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Recheck dead sources and employers with no feed after each full pull under a bounded public-only budget, repair only on the employer's own evidence, report name-only matches as suggestions, and record what changed and what is still broken.
from __future__ import annotations

import json
import re
import signal
import time
import traceback
import uuid
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import urlsplit

from . import ats, config, db, discover, http, resolve
from . import source_memory as memory

MAX_SOURCES = 150           # Measured at about 6 seconds a source: around the whole queue in a few nights.
MAX_SECONDS = 20 * 60       # The pull publishes when this ends, so the review may not hold it long.
SOURCE_SECONDS = 5 * 60     # A hard stop for one source, so nothing an employer does can hold the pull.
MAX_PAGE_BYTES = 2_000_000
MIN_FAILED_PULLS = 3        # One bad night is usually the employer's site, not a moved board.
RECHECK_DAYS = 7
BLOCKED_DAYS = 30           # An employer that refuses us is left alone, never worked around.
MAX_CANDIDATES = 3
KEEP_REPORTS = 30
LIST_LIMIT = 50
MASS_CLOSE_JOBS, MASS_CLOSE_SHARE = 50, 0.5
STUCK_JOBS, STUCK_RUNS = 500, 3

_REFUSING_STATUS = {401, 403, 407, 429, 451}
_CHALLENGE = re.compile(r"cf-chl|just a moment\.\.\.|unusual traffic", re.I)
CHALLENGE_PAGE_BYTES = 20_000  # Challenge pages are small; a full careers page may merely mention one of these.
# Hosted by the vendor at a fixed address, and able to prove a whole feed. A repair onto anything
# else would leave the dead source's jobs open for good, and some take any host as a "token".
_REPAIRABLE = {"greenhouse", "lever", "ashby", "workday"}
# These need a browser, or belong to one employer, so a link to one proves nothing about this employer.
_NOT_A_BOARD = {"web", "htmllist", "webflow", "symphony", "amazon", "apple", "google", "microsoft", "gdcareers", "gsroles"}
_HELD = ("manual", "multi")  # A person chose these; the review never overrides that.
_COMMON_WORDS = {"group", "holdings", "corporation", "company", "companies", "international", "services", "technologies",
                 "technology", "systems", "solutions", "financial", "health", "global", "national", "american", "first",
                 "general", "united", "partners", "capital", "industries", "brands", "energy", "careers", "class"}
_SECOND_LEVEL = {"co", "com", "org", "net", "ac", "gov", "edu"}


class SourceTimedOut(BaseException):
    """Not an Exception: connectors catch Exception freely, and swallowing this would remove the only hard stop."""


@contextmanager
def _time_limit(seconds):
    """Interrupts even a blocking read, which a budget checked between sources never could."""
    def expired(*_):
        raise SourceTimedOut()

    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, max(seconds, 0.001))
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def ensure(conn):
    """Only the ingest writer calls this; a published corpus is read-only to everyone else."""
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('source_review_runs')} (run_id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL, finished_at TEXT NOT NULL, report TEXT NOT NULL)""")
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('source_review_items')} (company_id INTEGER PRIMARY KEY,
        reviewed_at TEXT NOT NULL, retry_after TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT NOT NULL)""")


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _in_days(days):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(timespec="seconds")


def _queue(conn):
    """Sources waiting for a look, the longest-unchecked first, so a small budget still goes round them all."""
    return [dict(row) for row in conn.execute(f"""
        SELECT c.id, c.name, c.homepage, c.careers_url, c.ats_type, c.ats_token,
               s.status, s.last_error_code, s.consecutive_failures
          FROM {db.companies_table()} c
          LEFT JOIN {memory.table('source_pull_state')} s ON s.company_id = c.id
          LEFT JOIN {memory.table('source_review_items')} i ON i.company_id = c.id
         WHERE COALESCE(c.ats_type, '') NOT IN ({','.join('?' for _ in _HELD)})
           AND COALESCE(c.discover_status, '') NOT IN ('manual', 'removed')
           AND (COALESCE(c.ats_token, '') = ''
                OR (s.status IN ('empty_unconfirmed', 'failed') AND s.consecutive_failures >= ?))
           AND (i.retry_after IS NULL OR i.retry_after <= ?)
         ORDER BY i.reviewed_at IS NOT NULL, i.reviewed_at, c.id""",
        (*_HELD, MIN_FAILED_PULLS, _now())).fetchall()]


def _capped_text(response):
    """The start of a body at most: a page is only searched for links, and the size is the employer's choice."""
    chunks, size = [], 0
    try:
        for chunk in response.iter_content(64 * 1024):
            chunks.append(chunk)
            size += len(chunk)
            if size >= MAX_PAGE_BYTES:
                break
    finally:
        response.close()
    return b"".join(chunks)[:MAX_PAGE_BYTES].decode(response.encoding or "utf-8", "replace")


def _read_page(url):
    """An employer's page, or why not: 'blocked' and 'unsafe' stop the source, 'unavailable' does not."""
    try:
        response = http.get_once(url, timeout=discover._T, allow_redirects=True, stream=True)
        if response.status_code in _REFUSING_STATUS:
            response.close()
            return None, "blocked"
        text, ok, final = _capped_text(response), response.ok, response.url
    except http.PrivateAddressRefused:
        return None, "unsafe"
    except Exception:  # noqa: BLE001 — a dead or malformed URL is the ordinary case for a stale source.
        return None, "unavailable"
    if len(text) < CHALLENGE_PAGE_BYTES and _CHALLENGE.search(text):
        return None, "blocked"
    return (SimpleNamespace(url=final, text=text), None) if ok and text else (None, "unavailable")


def _site(url):
    """The part of a hostname an employer owns, allowing for suffixes like co.uk."""
    labels = (urlsplit(url).hostname or "").lower().split(".")
    keep = 3 if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in _SECOND_LEVEL else 2
    return labels[-keep:]


def _vendor_domains():
    """Domains on which every employer has a host of its own, read from the two patterns the engine already keeps of
    board vendors' hosts: the ones the resolver follows out of a careers page, and the ones discovery finds in one."""
    domains = set()
    for pattern in (resolve._EMBED_HOSTS.pattern, discover._ATS_IN_HTML.pattern):
        hosts = re.search(r"\(\?:([^()]+)\)", pattern)
        domains.update(host.replace("\\.", ".").lower() for host in (hosts.group(1).split("|") if hosts else ()))
    return frozenset(domains)


_VENDOR_DOMAINS = _vendor_domains()


def _on_vendor_domain(host):
    """Whether a host belongs to a board vendor and not to one employer: it is on one of the vendor domains, or the
    resolver reads a board off its bare address. Nothing is read from the network."""
    host = (host or "").lower()
    if any(host == domain or host.endswith("." + domain) for domain in _VENDOR_DOMAINS):
        return True
    return bool(host) and resolve.classify_url(f"https://{host}/") is not None


def _same_site(left, right):
    """Whether two addresses are on one employer's site. On a board vendor's domain every employer has its own host
    (foo.avature.net and bar.avature.net are two employers), so there the whole host must match."""
    hosts = [(urlsplit(url).hostname or "").lower() for url in (left, right)]
    if any(_on_vendor_domain(host) for host in hosts):
        return bool(hosts[0]) and hosts[0] == hosts[1]
    return _site(left) == _site(right)


def _on_page(response):
    """(ats_type, token) of every job board this page points at, then likely jobs links on its own site."""
    boards, links = [], []
    found = ats.detect_from_url(response.url)
    if found[0]:
        boards.append(found)
    for kind, first, second in discover._find_career_links(response.text, response.url):
        if kind == "ats" and (first, second) not in boards:
            boards.append((first, second))
        elif kind == "page" and _same_site(first, response.url):
            links.append(first)
    return boards, sorted(links)[:2]


def _employer_evidence(row):
    """Boards the employer's own pages point at. A guessed homepage or name is not evidence."""
    current = (row["ats_type"], (row["ats_token"] or "").lower())
    for start in (row["careers_url"], row["homepage"]):
        if not start:
            continue
        response, problem = _read_page(start)
        if problem in ("blocked", "unsafe"):
            return [], problem
        if problem:
            continue
        boards, links = _on_page(response)
        for link in links if not boards else []:
            nested, problem = _read_page(link)
            if problem in ("blocked", "unsafe"):
                return [], problem
            if nested:
                boards.extend(board for board in _on_page(nested)[0] if board not in boards)
        boards = [board for board in boards if (board[0], board[1].lower()) != current and board[0] not in _NOT_A_BOARD]
        if boards:
            return boards, None
    return [], None


def _jobs_at(ats_type, token):
    """A feed only counts if it returns titled jobs right now."""
    try:
        feed = ats.fetch(ats_type, token)
    except Exception:  # noqa: BLE001 — a candidate that cannot be read is simply not a candidate.
        return None
    return feed if any(isinstance(job, dict) and job.get("title") for job in feed) else None


def _owner(ats_type, token, company_id):
    with db.connect() as conn:
        row = conn.execute(f"SELECT name FROM {db.companies_table()} WHERE ats_type=? AND LOWER(ats_token)=LOWER(?) AND id<>?",
                           (ats_type, token, company_id)).fetchone()
    return row["name"] if row else None


def _name_match(row):
    """A board that merely shares the employer's name could be anyone's, so it is only ever a suggestion."""
    current = (row["ats_type"], row["ats_token"])
    for slug in discover._slugs(row["name"]):
        for connector in ats.PROBE_ORDER:
            try:
                token = connector.probe(slug)
            except Exception:  # noqa: BLE001 — most guesses do not exist; that is what a probe finds out.
                continue
            if token and (connector.NAME, token) != current and not _owner(connector.NAME, token, row["id"]):
                feed = _jobs_at(connector.NAME, token)
                if feed:
                    return connector.NAME, token, len(feed)
    return None


def _repair(row, ats_type, token, feed):
    """Move the source and take its jobs in one transaction, so a failure leaves the old source exactly as it was."""
    with db.connect() as conn:
        feed.attempt_id, feed.started_at = memory.begin_on(conn, row["id"], memory.source_key(ats_type, token))
        conn.execute(f"UPDATE {db.companies_table()} SET ats_type=?, ats_token=?, discover_status='found' WHERE id=?",
                     (ats_type, token, row["id"]))
        return memory.ingest(conn, row["id"], feed)


def _resembles(row, token):
    """Whether a board's name looks like this employer's, by its name or its own website. A link alone is not enough:
    footers and partner pages link to other companies' boards, and older discovery really did cross employers this way."""
    board = re.sub(r"[^a-z0-9]", "", token.split(":")[0].lower())
    if len(board) < 3 or board in _COMMON_WORDS:
        return False
    names = {re.sub(r"[^a-z0-9]", "", slug) for slug in discover._slugs(row["name"])}
    names |= {word for word in re.findall(r"[a-z0-9]+", row["name"].lower()) if len(word) >= 4 and word not in _COMMON_WORDS}
    names -= _COMMON_WORDS  # Trimming "American Group" leaves a word that would match anyone's board.
    # A link on a board vendor's site is the employer's page there: its site label is the vendor's, not the employer's.
    names |= {_site(url)[0] for url in (row["careers_url"], row["homepage"])
              if url and urlsplit(url).hostname and not _on_vendor_domain(urlsplit(url).hostname)}
    return any(board == name or (len(name) >= 4 and name in board) or (len(board) >= 4 and board in name) for name in names)


def _suggest(reason, options, jobs=None):
    return {"outcome": "suggested", "reason": reason, "options": options, **({} if jobs is None else {"jobs": jobs})}


def _from_evidence(row, boards):
    """What the employer's page supports, or None if none of its boards is live."""
    readable = [board for board in boards if board[0] in _REPAIRABLE]
    named = [f"{ats_type}:{token}" for ats_type, token in boards]
    if len(readable) > MAX_CANDIDATES:
        return _suggest("several boards on the employer's page", named)
    if not readable:
        return _suggest("a board that cannot be proven whole", named) if named else None
    live = [(ats_type, token, feed) for ats_type, token in readable if (feed := _jobs_at(ats_type, token))]
    if not live:
        return None
    if len(live) + len(boards) - len(readable) > 1:
        return _suggest("several boards on the employer's page", named, max(len(feed) for *_, feed in live))
    ats_type, token, feed = live[0]
    owner = _owner(ats_type, token, row["id"])
    if owner:
        return {"outcome": "duplicate", "board": f"{ats_type}:{token}", "owner": owner}
    if not feed.complete:
        return _suggest("the feed could not be proven whole", named, len(feed))
    if not _resembles(row, token):
        return _suggest("the board's name does not look like this employer", named, len(feed))
    counts = _repair(row, ats_type, token, feed)
    return {"outcome": "repaired", "from": f"{row['ats_type'] or 'none'}:{row['ats_token'] or ''}",
            "to": f"{ats_type}:{token}", "jobs": len(feed), "new": counts["new"], "closed": counts["closed"]}


def _review_one(row):
    boards, problem = _employer_evidence(row)
    if problem:
        return {"outcome": problem}
    result = _from_evidence(row, boards)
    if result:
        return result
    match = _name_match(row)
    if match:
        return _suggest("name match only", [f"{match[0]}:{match[1]}"], match[2])
    return {"outcome": "nothing"}


def _check_all(queue, max_sources, max_seconds):
    """Sources one at a time, each isolated: the per-host limit holds, and one bad page costs one source."""
    deadline, results = time.monotonic() + max_seconds, []
    with http.public_only():
        for row in queue[:max_sources]:
            left = deadline - time.monotonic()
            if left <= 0:
                break
            try:
                with _time_limit(min(SOURCE_SECONDS, left)):
                    result = _review_one(row)
            except SourceTimedOut:
                result = {"outcome": "timeout"}
            except Exception as error:  # noqa: BLE001 — recorded in the report; the next source still runs.
                result = {"outcome": "error", "errorType": type(error).__name__}
            results.append((row, result))
            print(f"   reviewed {row['name']}: {result['outcome']}", flush=True)
    return results


def _record(conn, results):
    for row, result in results:
        days = BLOCKED_DAYS if result["outcome"] in ("blocked", "unsafe") else RECHECK_DAYS
        conn.execute(f"""INSERT INTO {memory.table('source_review_items')} (company_id,reviewed_at,retry_after,outcome,detail)
            VALUES (?,?,?,?,?) ON CONFLICT (company_id) DO UPDATE SET reviewed_at=EXCLUDED.reviewed_at,
            retry_after=EXCLUDED.retry_after,outcome=EXCLUDED.outcome,detail=EXCLUDED.detail""",
            (row["id"], _now(), _in_days(days), result["outcome"], json.dumps(result)))


def _source_counts(conn):
    states = Counter(row["status"] for row in conn.execute(f"SELECT status FROM {memory.table('source_pull_state')}").fetchall())
    no_feed = conn.execute(f"SELECT COUNT(*) AS n FROM {db.companies_table()} WHERE COALESCE(ats_token,'')='' AND COALESCE(discover_status,'')<>'removed'").fetchone()["n"]
    return {"whole": states["ok"] + states["not_modified"], "unverified": states["partial"],
            "empty": states["empty_unconfirmed"], "failed": states["failed"], "noFeed": no_feed}


def _delta(conn, since):
    row = conn.execute(f"""SELECT COUNT(*) AS sources, COALESCE(SUM(fetched),0) AS read, COALESCE(SUM(new_count),0) AS new,
        COALESCE(SUM(changed_count),0) AS changed, COALESCE(SUM(unchanged_count),0) AS unchanged,
        COALESCE(SUM(closed_count),0) AS closed, COALESCE(SUM(status='not_modified'),0) AS notModified
        FROM {memory.table('source_pull_runs')} WHERE last_attempt_at >= ?""", (since,)).fetchone()
    return dict(row)


def _attention(conn, since):
    """What a person should look at: the shapes that hid real faults in this feed before."""
    runs, companies, state = memory.table("source_pull_runs"), db.companies_table(), memory.table("source_pull_state")
    mass = [dict(row) for row in conn.execute(f"""SELECT c.name AS company, c.ats_type AS ats, r.closed_count AS closed,
        r.fetched AS kept FROM {runs} r JOIN {companies} c ON c.id=r.company_id
        WHERE r.last_attempt_at >= ? AND r.closed_count >= ?
          AND r.closed_count >= ? * (r.closed_count + r.fetched) ORDER BY r.closed_count DESC LIMIT ?""",
        (since, MASS_CLOSE_JOBS, MASS_CLOSE_SHARE, LIST_LIMIT)).fetchall()]
    stuck = [dict(row) for row in conn.execute(f"""SELECT c.name AS company, c.ats_type AS ats, MAX(ranked.fetched) AS jobs FROM (
        SELECT company_id, fetched, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY completed_at DESC, attempt_id DESC) AS n
          FROM {runs}) ranked JOIN {companies} c ON c.id=ranked.company_id
          JOIN {state} s ON s.company_id=ranked.company_id
        WHERE ranked.n <= ? AND s.status = 'partial' GROUP BY ranked.company_id
        HAVING COUNT(*) = ? AND MIN(ranked.fetched) = MAX(ranked.fetched) AND MIN(ranked.fetched) >= ?
           AND MAX(ranked.fetched) % 100 = 0
        ORDER BY jobs DESC LIMIT ?""", (STUCK_RUNS, STUCK_RUNS, STUCK_JOBS, LIST_LIMIT)).fetchall()]
    broken = [dict(row) for row in conn.execute(f"""SELECT c.name AS company, c.ats_type AS ats, s.last_error_code AS code,
        s.consecutive_failures AS pulls FROM {state} s JOIN {companies} c ON c.id=s.company_id
        WHERE s.status IN ('empty_unconfirmed','failed') ORDER BY s.consecutive_failures DESC, c.name LIMIT ?""",
        (LIST_LIMIT,)).fetchall()]
    return {"massClosed": mass, "stuck": stuck, "stillBroken": broken}


def _previous_counts(conn):
    row = conn.execute(f"SELECT report FROM {memory.table('source_review_runs')} ORDER BY finished_at DESC, run_id DESC LIMIT 1").fetchone()
    try:
        return json.loads(row["report"])["sources"] if row else None
    except (KeyError, TypeError, ValueError):
        return None


def _report(conn, results, waiting, started, since, seconds):
    outcomes = Counter(result["outcome"] for _, result in results)
    entry = lambda row, result: {"company": row["name"], "id": row["id"], **{k: v for k, v in result.items() if k != "outcome"}}
    pick = lambda name: [entry(row, result) for row, result in results if result["outcome"] == name][:LIST_LIMIT]
    return {"version": 1, "startedAt": started, "finishedAt": _now(), "seconds": seconds,
            "sources": _source_counts(conn), "previousSources": _previous_counts(conn), "delta": _delta(conn, since),
            "review": {"checked": len(results), "waiting": waiting, "outcomes": dict(outcomes),
                       "repaired": pick("repaired"), "suggested": pick("suggested"), "duplicates": pick("duplicate")},
            **_attention(conn, since)}


def run(since=None, *, max_sources=MAX_SOURCES, max_seconds=MAX_SECONDS):
    """Review once and store the report. `since` bounds the pull the report describes; default the last day."""
    if config.POSTGRES or not db.corpus_writable():
        print("Source review: skipped, this process cannot write the corpus.", flush=True)
        return None
    started, clock = _now(), time.monotonic()
    since = since or (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
    with db.connect() as conn:
        memory.ensure(conn)
        ensure(conn)
        queue = _queue(conn)
    results = _check_all(queue, max_sources, max_seconds)
    with db.connect() as conn:
        _record(conn, results)
        report = _report(conn, results, len(queue) - len(results), started, since, round(time.monotonic() - clock))
        runs = memory.table("source_review_runs")
        conn.execute(f"INSERT INTO {runs} (run_id,started_at,finished_at,report) VALUES (?,?,?,?)",
                     (str(uuid.uuid4()), started, report["finishedAt"], json.dumps(report)))
        conn.execute(f"""DELETE FROM {runs} WHERE run_id NOT IN
            (SELECT run_id FROM {runs} ORDER BY finished_at DESC, run_id DESC LIMIT ?)""", (KEEP_REPORTS,))
    done = report["review"]
    print(f"Source review: {done['checked']} checked, {dict(done['outcomes'])}; {done['waiting']} still waiting.", flush=True)
    return report


def after_pull(since):
    """The pull already succeeded, so nothing here may stop it from publishing."""
    try:
        return run(since)
    except Exception:  # noqa: BLE001 — written to stderr, whose tail the kernel keeps with the run.
        print("Source review failed; the pull publishes without it.", flush=True)
        traceback.print_exc()
        return None
