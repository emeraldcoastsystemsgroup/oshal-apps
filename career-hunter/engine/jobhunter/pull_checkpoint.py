"""Where a full pull has got to, kept inside the corpus copy the pull is writing.

The kernel runs a pull on a private copy of the shared corpus and publishes that copy when the pull exits cleanly. It now
keeps the copy when a restart stops the pull, so all that has to be remembered is in that one file: each employer's jobs
and the note that it is finished commit in the same transaction, so they can never disagree. A copy taken from a published
corpus holds a finished pull, so a new pull starts by itself, with no flag passed between the kernel and the engine.

CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | A pull stopped by a kernel restart continues from the last employer it finished instead of starting again from nothing.
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta, timezone

from . import config, db
from . import source_memory as memory

# The next night's pull starts at about 24 hours, so a pull this old is read again in full rather than carried over it.
MAX_AGE_HOURS = 20
# A source the pull keeps stopping on is skipped, so one that cannot be read can never hold back every source after it.
# Its count survives a pull that expires around it: a source that hangs to the kernel's 8 hour ceiling uses a day on 3 tries.
MAX_ATTEMPTS = 3


def _ensure(conn):
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('pull_checkpoint')} (id INTEGER PRIMARY KEY CHECK (id = 1),
        started_at TEXT NOT NULL, finished_at TEXT, resumes INTEGER NOT NULL DEFAULT 0)""")
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {memory.table('pull_checkpoint_sources')} (company_id INTEGER PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 0, counts TEXT)""")


def _recent(started_at):
    try:
        return datetime.now(timezone.utc) - datetime.fromisoformat(started_at) < timedelta(hours=MAX_AGE_HOURS)
    except (TypeError, ValueError):
        return False


class Pull:
    """One full pull across however many processes it takes. `totals` covers all of them."""

    def __init__(self, started_at, resumes, sources):
        self.started_at, self.resumes = started_at, resumes
        self.attempts = {row["company_id"]: row["attempts"] for row in sources}
        self.finished = {row["company_id"] for row in sources if row["counts"] is not None}
        self.totals = Counter()
        for row in sources:
            self.totals.update(json.loads(row["counts"] or "{}"))

    def claim(self, source):
        """False when this pull has already dealt with the source. The attempt is counted before any reading, so a
        source that ends the process is known to the next one."""
        company_id = source["id"]
        if company_id in self.finished:
            return False
        attempts = self.attempts.get(company_id, 0) + 1
        with db.connect() as conn:
            if attempts > MAX_ATTEMPTS:
                print(f"   {source['name']:<28} skipped: the pull stopped {MAX_ATTEMPTS} times while reading it; existing jobs kept", flush=True)
                attempt, started = memory.begin_on(conn, company_id)
                # Not a failure of the source: restarts may simply have landed on it, so it earns no repair evidence.
                memory.finish(conn, company_id, attempt, started, "failed", "pull_interrupted", already_finished=True)
                self.settle(conn, company_id, unconfirmed=1)
                self.totals["unconfirmed"] += 1
                return False
            conn.execute(f"""INSERT INTO {memory.table('pull_checkpoint_sources')} (company_id,attempts) VALUES (?,?)
                ON CONFLICT (company_id) DO UPDATE SET attempts=EXCLUDED.attempts""", (company_id, attempts))
        return True

    def settle(self, conn, company_id, **counts):
        """Mark the source finished on the caller's transaction, the one holding its jobs."""
        conn.execute(f"""INSERT INTO {memory.table('pull_checkpoint_sources')} (company_id,counts) VALUES (?,?)
            ON CONFLICT (company_id) DO UPDATE SET counts=EXCLUDED.counts""", (company_id, json.dumps(counts)))

    def finish(self):
        """The pull is over, so whichever copy is run next starts a new one."""
        with db.connect() as conn:
            conn.execute(f"UPDATE {memory.table('pull_checkpoint')} SET finished_at=?", (db.now(),))
            conn.execute(f"DELETE FROM {memory.table('pull_checkpoint_sources')}")


def begin(fresh=False):
    """The pull to run: the one stopped in this corpus when there is one, else a new one; `fresh` always starts a new one.
    None for a process that cannot write the corpus, or in PostgreSQL mode, which has no private copy to continue."""
    if config.POSTGRES or not db.corpus_writable():
        return None
    checkpoint, sources = memory.table("pull_checkpoint"), memory.table("pull_checkpoint_sources")
    with db.connect() as conn:
        _ensure(conn)
        row = conn.execute(f"SELECT started_at,finished_at,resumes FROM {checkpoint}").fetchone()
        if not fresh and row and row["finished_at"] is None and _recent(row["started_at"]):
            conn.execute(f"UPDATE {checkpoint} SET resumes=resumes+1")
            kept = [dict(source) for source in conn.execute(f"SELECT company_id,attempts,counts FROM {sources}").fetchall()]
            pull = Pull(row["started_at"], row["resumes"] + 1, kept)
            print(f"Continuing the pull started {pull.started_at}: {len(pull.finished)} sources already read. Pass --fresh to read them all.", flush=True)
            return pull
        started = db.now()
        conn.execute(f"DELETE FROM {sources}" + ("" if fresh else " WHERE counts IS NOT NULL"))
        conn.execute(f"""INSERT INTO {checkpoint} (id,started_at) VALUES (1,?) ON CONFLICT (id) DO UPDATE SET
            started_at=EXCLUDED.started_at,finished_at=NULL,resumes=0""", (started,))
        kept = [dict(source) for source in conn.execute(f"SELECT company_id,attempts,counts FROM {sources}").fetchall()]
        return Pull(started, 0, kept)
