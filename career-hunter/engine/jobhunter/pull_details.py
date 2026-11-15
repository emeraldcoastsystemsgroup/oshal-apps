# CHANGE LOG
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.64.1 (owner, 2026-11-14: "Yes let's increase the pull"): defaults raised so the backlog clears in about two nights: 600 pages a source, 6,000 a pull, 80 minutes a pull, and a source's own read time (descriptions_source_seconds, 600) is a setting too. Politeness unchanged: the per-host pause, one page at a time per source, three refusals in a row end a source; a host shared by several sources gets no more than one source's cap. Pages go newest day first across sources, so the budget reaches every source's newest jobs before older ones.
# 1 | maintainer@emeraldcoastsystemsgroup.com | The full pull keeps the description of an in-lane job its list gave none for, read from the job's own page in a stage after every list is read, under caps an administrator can change or turn off without a release, so the native nightly scoring needs no outbound read for it.
"""Descriptions the pull keeps for jobs it has found (Lane CR8, 2026-11-14).

The native nightly scoring runs with no network and can read a posting's details only through the kernel's closed list
of exact addresses (Workday, Oracle Recruiting Cloud, SmartRecruiters). Most other lists the pull reads give a title, a
place and a link and no description, so those jobs could not be scored at all. The pull has the network, and the page
the link names is on the site the list came from, so once every list is read the pull reads a bounded number of those
pages and keeps each description in the shared corpus's listing text, the field scoring reads first.

The stage runs after the lists, never between them, so a slow site cannot hold back job finding; it never fails the pull
and stops at its caps. It reads only: a full pull; a source kind whose pages answer to a reader (posting_page.READERS);
an active, in-lane job (target_role) with no listing text, first seen in the last week, newest first; a job not read
twice before nor already in this pull. Caps: reads per source, reads per pull, the stage's minutes per pull (all three
counted across a stopped and continued pull), a source's own read seconds, and REFUSALS refusals in a row end a
source; no host gets more pages a pull than the per-source cap, however many sources share it. Within the caps the
newest day's jobs of every source come first. When no source has a page left to read the stage ends at once. Sources
take turns one page at a time, so the per-host delay of one site overlaps another's read. Every read is recorded with its text in one transaction, every BATCH reads, so a stopped pull keeps what it read and never reads it
again. A failed or empty read leaves the job as it is.

An administrator changes the stage with a source change (the Companies page's Resolve route, any listed employer) whose
target is `setting:<name>=<value>`; the pull applies it before its lists, so the same night follows it:
`setting:descriptions=off` (or `on`), `setting:descriptions_per_source=<0-1000>`, `setting:descriptions_per_pull=<0-20000>`,
`setting:descriptions_minutes=<0-180>`, `setting:descriptions_source_seconds=<0-3600>`. 0 reads nothing.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from . import db, posting_page
from . import source_memory as memory

# Defaults (owner, 2026-11-14: "Yes let's increase the pull"): the backlog clears in about two nights, at most 80 minutes
# a pull. A source's own seconds stop a slow site (one answered in 25 s) before it takes the stage's minutes.
DEFAULTS = {"descriptions": "on", "descriptions_per_source": "600", "descriptions_per_pull": "6000",
            "descriptions_minutes": "80", "descriptions_source_seconds": "600"}
LIMITS = {"descriptions_per_source": 1000, "descriptions_per_pull": 20000, "descriptions_minutes": 180,
          "descriptions_source_seconds": 3600}
SETTING = "setting:"
REFUSALS = 3
MAX_ATTEMPTS = 2
WINDOW_DAYS = 7
BATCH = 25
# Leave the kernel's ceiling (eight hours a run) room to publish: a run this old reads no pages.
RUN_SECONDS = 7 * 60 * 60
_STARTED = time.monotonic()


def ensure(conn):
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('source_detail_reads')} (
        company_id INTEGER NOT NULL, ats_job_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT NOT NULL, outcome TEXT NOT NULL, millis INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (company_id, ats_job_id))""")
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('pull_settings')} (
        name TEXT PRIMARY KEY, value TEXT NOT NULL, changed_at TEXT NOT NULL)""")


def settings(conn) -> dict:
    """The stage's settings: what an administrator saved, else the defaults."""
    saved = {row["name"]: row["value"] for row in conn.execute(f"SELECT name, value FROM {memory.table('pull_settings')}")}
    values = {name: saved.get(name, default) for name, default in DEFAULTS.items()}
    result = {"descriptions": values["descriptions"] == "on"}
    for name, ceiling in LIMITS.items():
        try:
            result[name] = max(0, min(ceiling, int(values[name])))
        except ValueError:
            result[name] = int(DEFAULTS[name])
    return result


def apply_setting(target: str) -> dict:
    """An administrator's `setting:<name>=<value>` change, kept in the corpus for this and every later pull."""
    match = re.fullmatch(r"setting:([a-z_]+)=([a-z0-9]+)", target or "")
    name, value = (match.group(1), match.group(2)) if match else (None, None)
    if name == "descriptions" and value in ("on", "off"):
        pass
    elif name in LIMITS and value.isdigit() and int(value) <= LIMITS[name]:
        value = str(int(value))
    else:
        return {"outcome": "bad_setting"}
    with db.connect() as conn:
        ensure(conn)
        conn.execute(f"""INSERT INTO {memory.table('pull_settings')} (name, value, changed_at) VALUES (?, ?, ?)
            ON CONFLICT (name) DO UPDATE SET value=EXCLUDED.value, changed_at=EXCLUDED.changed_at""", (name, value, db.now()))
    return {"outcome": "setting_saved", "setting": name, "value": value}


def _iso(moment):
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


def spent(conn, started_at) -> dict:
    """What this pull's stage has done so far, by every process the pull has run in."""
    row = conn.execute(f"""SELECT COUNT(*) AS n, COALESCE(SUM(millis), 0) AS ms,
        COALESCE(SUM(outcome = 'saved'), 0) AS kept FROM {memory.table('source_detail_reads')}
        WHERE last_attempt_at >= ? AND outcome <> 'skipped'""", (started_at,)).fetchone()
    return {"reads": int(row["n"]), "seconds": int(row["ms"]) / 1000.0, "described": int(row["kept"])}


def candidates(conn, company_id, started_at, limit):
    """One source's jobs to read: active, in lane, no listing text, first seen this week, not read twice nor in this pull."""
    since = _iso(datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS))
    return [dict(row) for row in conn.execute(
        f"""SELECT p.id, p.ats_job_id, p.title, p.url, p.first_seen_at FROM {db.corpus_table()} p
            LEFT JOIN {memory.table('source_detail_reads')} r ON r.company_id = p.company_id AND r.ats_job_id = p.ats_job_id
            WHERE p.company_id = ? AND p.active = 1 AND p.target_role = 1
              AND TRIM(COALESCE(p.description, '')) = '' AND p.first_seen_at >= ?
              AND COALESCE(r.attempts, 0) < ? AND (r.last_attempt_at IS NULL OR r.last_attempt_at < ?)
            ORDER BY p.first_seen_at DESC, p.id DESC LIMIT ?""",
        (company_id, since, MAX_ATTEMPTS, started_at, limit)).fetchall()]


def _record(conn, done):
    """Keep each description and each read in one transaction. A job that gained listing text meanwhile is not touched."""
    reads = memory.table('source_detail_reads')
    for company_id, posting, text, outcome, millis in done:
        if text:
            conn.execute(f"UPDATE {db.corpus_table()} SET description = ? WHERE id = ? AND TRIM(COALESCE(description, '')) = ''",
                         (text, posting["id"]))
        tries = MAX_ATTEMPTS if outcome == "skipped" else 1
        conn.execute(f"""INSERT INTO {reads} (company_id, ats_job_id, attempts, last_attempt_at, outcome, millis)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (company_id, ats_job_id) DO UPDATE SET attempts = attempts + EXCLUDED.attempts,
            last_attempt_at = EXCLUDED.last_attempt_at, outcome = EXCLUDED.outcome, millis = EXCLUDED.millis""",
                     (company_id, str(posting["ats_job_id"]), tries, db.now(), outcome, millis))


class _Turns:
    """The pages to read, newest day first: sources take turns one page at a time within the newest day any of them still
    has, then the next day's, so a night's budget goes to the newest jobs of every source before older ones. A source
    stops at its own seconds or its refusals; a host stops at the per-source page cap, however many sources share it."""

    def __init__(self, queues, source_seconds, per_host):
        self.queues = [(source, list(rows)) for source, rows in queues if rows]
        self.used, self.refused, self.hosts = {}, {}, {}
        self.source_seconds, self.per_host = source_seconds, per_host

    @staticmethod
    def _day(rows):
        return str(rows[0].get("first_seen_at") or "")[:10]

    @staticmethod
    def _host(posting):
        return (urlsplit(str(posting.get("url") or "")).hostname or "").lower()

    def _open(self, source, rows):
        key = source["id"]
        while rows and self.hosts.get(self._host(rows[0]), 0) >= self.per_host:
            rows.pop(0)
        return bool(rows) and self.used.get(key, 0) < self.source_seconds and self.refused.get(key, 0) < REFUSALS

    def next(self):
        self.queues = [(source, rows) for source, rows in self.queues if self._open(source, rows)]
        if not self.queues:
            return None
        day = max(self._day(rows) for _, rows in self.queues)
        at = next(i for i, (_, rows) in enumerate(self.queues) if self._day(rows) == day)
        source, rows = self.queues.pop(at)
        posting = rows.pop(0)
        self.queues.append((source, rows))
        host = self._host(posting)
        self.hosts[host] = self.hosts.get(host, 0) + 1
        return source, posting

    def note(self, source, outcome, seconds):
        key = source["id"]
        self.used[key] = self.used.get(key, 0) + seconds
        self.refused[key] = self.refused.get(key, 0) + 1 if outcome in ("refused", "unreadable") else 0


def _plan(pull, sources):
    """The settings and each describable source's queue, or (settings, None) when the stage has nothing to do."""
    with db.connect() as conn:
        ensure(conn)
        chosen = settings(conn)
        done = spent(conn, pull.started_at)
        room = chosen["descriptions_per_pull"] - done["reads"]
        if not chosen["descriptions"] or room <= 0 or done["seconds"] >= chosen["descriptions_minutes"] * 60:
            return chosen, done, None
        ranked = sorted((s for s in sources if posting_page.describable(s.get("ats_type"))),
                        key=lambda s: (posting_page.RANK.index(s["ats_type"]), s["id"]))
        queues = [(s, candidates(conn, s["id"], pull.started_at, chosen["descriptions_per_source"])) for s in ranked]
    return chosen, done, (queues, room, chosen["descriptions_per_source"])


def stage(pull, sources) -> dict:
    """After every list is read: read and keep descriptions under the caps. Never raises.

    Returns this pull's totals {'described', 'detail_reads'} across every process it ran in.
    """
    if pull is None:
        return {"described": 0, "detail_reads": 0}
    try:
        chosen, done, plan = _plan(pull, sources)
        if plan is not None and time.monotonic() - _STARTED < RUN_SECONDS:
            queues, room, per_host = plan
            _read(queues, room, chosen["descriptions_minutes"] * 60 - done["seconds"], chosen["descriptions_source_seconds"], per_host)
        with db.connect() as conn:
            done = spent(conn, pull.started_at)
    except Exception as error:
        print(f"Descriptions stopped: {type(error).__name__}; the pull carries on.", flush=True)
        return {"described": 0, "detail_reads": 0}
    return {"described": done["described"], "detail_reads": done["reads"]}


def _read(queues, room, seconds_left, source_seconds, per_host):
    """Read in turns until a cap is reached or no source has a page left, whichever comes first. Returns the reads."""
    turns, began, batch, reads = _Turns(queues, source_seconds, per_host), time.monotonic(), [], 0
    while reads < room and time.monotonic() - began < seconds_left and time.monotonic() - _STARTED < RUN_SECONDS:
        turn = turns.next()
        if turn is None:
            break
        source, posting = turn
        start = time.monotonic()
        text, outcome = posting_page.read(source["ats_type"], source.get("ats_token"), posting)
        took = time.monotonic() - start
        batch.append((source["id"], posting, text, outcome, int(took * 1000)))
        if outcome == "skipped":  # Not a page this source may read: recorded so it is never offered again, not counted.
            continue
        turns.note(source, outcome, took)
        reads += 1
        if len(batch) >= BATCH:
            with db.connect() as conn:
                _record(conn, batch)
            batch = []
    if batch:
        with db.connect() as conn:
            _record(conn, batch)
    return reads
