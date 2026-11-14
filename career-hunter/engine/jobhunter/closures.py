"""What a complete source read did to each job it no longer lists, and the nightly receipt that counts it.

A complete read may close the jobs it no longer lists (source_memory.ingest). Many of those are not closures: when a
source moves to another reader, the employer's same vacancy comes back under a new key. Each job the read stops listing
is now recorded in `posting_closures` with the time and the read (`source_pull_runs.attempt_id`) that did it, as one of:

  rekeyed          the read lists, for the first time, exactly one job from the same source with the same requisition
                   number, the same title and the same place, and no other job it stopped listing matches that one. The
                   job KEEPS ITS ID and takes the new key and listing; the new row, written by this same read and seen by
                   no one yet, is removed. Every person's saved, applied and removed marks, which are keyed by posting id,
                   therefore stay with the job, and a job someone removed does not come back as a new one.
  closed           marked inactive. `possible_rekey` names why a job with its requisition number was not followed:
                   title-differs, place-differs, several-successors, shared-successor or listed-before (the matching job
                   was already listed before this read, so people may hold marks on both); not-merged in the legacy
                   PostgreSQL store, which never folds one row into another.

A full pull ends with one receipt in `closure_receipts`: closed, possible re-key and re-keyed counts in total and per
source, from the per-job records written since the pull started (source changes, the review and maintenance included),
reconciled with the closed counts the source reads reported.

CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Record each job a complete read stops listing with its time and read, keep a re-keyed job as the same job, count ambiguous matches as possible re-keys, and write a receipt per full pull. 21,639 jobs closed on 2026-11-12 and nobody could say how many were real closures.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

from . import config, db

# Per-job records older than this are removed when a receipt is written; receipts beyond the newest RECEIPTS_KEPT too.
RETAIN_DAYS = 90
RECEIPTS_KEPT = 60
# The listing a re-keyed job takes from its new row. Never id, company or first-seen (it is the same job), and never a
# person's columns, which the legacy single-file table keeps on the same row.
LISTING = ("ats_job_id", "title", "location", "remote", "department", "url", "description", "posted_at", "posted_date",
           "state", "city", "lat", "lon", "job_type", "target_role", "salary_min", "salary_max", "salary_currency",
           "salary_period", "salary_raw", "salary_source", "last_seen_at", "active")
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
_RUN = re.compile(r"[A-Za-z0-9]+")
_NUMBERED = re.compile(r"[A-Za-z]{0,4}(\d+)")


def table(name):
    """The physical name of a corpus table, as source_memory names its own."""
    if config.POSTGRES:
        return "career_" + name
    return ("corpus." if config.MULTIUSER else "") + name


def _index(name, column):
    schema, _, bare = table("posting_closures").rpartition(".")
    return f"CREATE INDEX IF NOT EXISTS {schema + '.' if schema else ''}{name} ON {bare}({column})"


def ensure(conn):
    """Only ingest writers call this, on the pull's writable copy; a read-only snapshot never creates tables."""
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {table('posting_closures')} (id TEXT PRIMARY KEY,
        posting_id INTEGER NOT NULL, company_id INTEGER NOT NULL, ats_job_id TEXT NOT NULL, closed_at TEXT NOT NULL,
        attempt_id TEXT NOT NULL, outcome TEXT NOT NULL, possible_rekey TEXT, successor_id INTEGER, successor_key TEXT)""")
    conn.execute(_index("idx_posting_closures_posting", "posting_id"))
    conn.execute(_index("idx_posting_closures_at", "closed_at"))
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {table('closure_receipts')} (pull_started_at TEXT PRIMARY KEY,
        written_at TEXT NOT NULL, receipt TEXT NOT NULL)""")


def requisition_number(key, url=None):
    """The employer's requisition number a stored key, or failing that its link, carries: the last run of at least four
    significant digits, after at most a four-letter prefix (R, JR, REQ). A path key and a number key agree on it."""
    for text in (key, url):
        if not text:
            continue
        path, _, query = _UUID.sub(" ", str(text)).partition("?")
        for part in (path, query):
            for run in reversed(_RUN.findall(part)):
                matched = _NUMBERED.fullmatch(run)
                if matched and len(matched.group(1).lstrip("0")) >= 4:
                    return matched.group(1).lstrip("0")
    return None


def title_key(title):
    """A title compared without case or punctuation."""
    return " ".join(_RUN.findall((title or "").lower().replace("&", " and ")))


def same_place(old, new):
    """The filed state and city when both have them, else the written location when both have one; two remote jobs
    are in one place, and a job with no place agrees with any."""
    if old.get("state") and new.get("state"):
        if old["state"].upper() != new["state"].upper():
            return False
        return not (old.get("city") and new.get("city")) or title_key(old["city"]) == title_key(new["city"])
    if old.get("remote") and new.get("remote"):
        return True
    left, right = title_key(old.get("location")), title_key(new.get("location"))
    return not (left and right) or left == right


def _closed(row, reason=None, candidate=None):
    return {"row": row, "outcome": "closed", "possible": reason, "successor": candidate}


def _decide(row, by_number, fresh):
    """What became of one job the read no longer lists."""
    number = requisition_number(row["ats_job_id"], row.get("url"))
    candidates = by_number.get(number, []) if number else []
    if not candidates:
        return _closed(row)
    titled = [c for c in candidates if title_key(c["title"]) == title_key(row["title"])]
    exact = [c for c in titled if same_place(row, c)]
    if not titled:
        return _closed(row, "title-differs", candidates[0] if len(candidates) == 1 else None)
    if not exact:
        return _closed(row, "place-differs", titled[0] if len(titled) == 1 else None)
    if len(exact) > 1:
        return _closed(row, "several-successors")
    if exact[0]["ats_job_id"] not in fresh or config.POSTGRES:
        # PostgreSQL stamps the scraping person's lane on a new row, so it is never folded into another.
        return _closed(row, "listed-before" if exact[0]["ats_job_id"] not in fresh else "not-merged", exact[0])
    return {"row": row, "outcome": "rekeyed", "possible": None, "successor": exact[0]}


def classify(leaving, listed, fresh):
    """Each job in `leaving` with what became of it. `listed` are the rows the read listed, `fresh` the keys it listed for
    the first time. A job is re-keyed only to a fresh row no other job it stopped listing also matches."""
    by_number = {}
    for row in listed:
        number = requisition_number(row["ats_job_id"], row.get("url"))
        if number:
            by_number.setdefault(number, []).append(row)
    decisions = [_decide(row, by_number, fresh) for row in leaving]
    claimed = Counter(d["successor"]["id"] for d in decisions if d["outcome"] == "rekeyed")
    for decision in decisions:
        if decision["outcome"] == "rekeyed" and claimed[decision["successor"]["id"]] > 1:
            decision.update(outcome="closed", possible="shared-successor")
    return decisions


def _company_rows(conn, company_id):
    columns = "id, ats_job_id, active, title, location, state, city, remote, url"
    return {str(row["ats_job_id"]): dict(row) for row in conn.execute(
        f"SELECT {columns} FROM {db.corpus_table()} WHERE company_id=?", (company_id,)).fetchall()}


def _rekey(conn, keep_id, new_id):
    """The job keeps its id and takes the new row's key and listing; the new row, only this read's, is removed."""
    corpus = db.corpus_table()
    new = dict(conn.execute(f"SELECT {','.join(LISTING)} FROM {corpus} WHERE id=?", (new_id,)).fetchone())
    conn.execute(f"DELETE FROM {corpus} WHERE id=?", (new_id,))
    conn.execute(f"UPDATE {corpus} SET {','.join(name + '=?' for name in LISTING)} WHERE id=?",
                 (*(new[name] for name in LISTING), keep_id))


def _record(conn, company_id, attempt, at, decision, carried):
    """Re-key or close one job and record it. `carried` maps a new row folded into a job to that job's id, so a
    possible match names the posting that now carries its key."""
    row, successor = decision["row"], decision["successor"]
    rekeyed = decision["outcome"] == "rekeyed"
    if rekeyed:
        _rekey(conn, row["id"], successor["id"])
    else:
        conn.execute(f"UPDATE {db.corpus_table()} SET active={'FALSE' if config.POSTGRES else '0'} WHERE id=?", (row["id"],))
    conn.execute(f"""INSERT INTO {table('posting_closures')} (id, posting_id, company_id, ats_job_id, closed_at,
        attempt_id, outcome, possible_rekey, successor_id, successor_key) VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (f"{attempt}:{row['id']}", row["id"], company_id, row["ats_job_id"], at, attempt, decision["outcome"],
         decision["possible"], successor and carried.get(successor["id"], successor["id"]),
         successor and successor["ats_job_id"]))


def settle(conn, company_id, attempt, seen, before, counts):
    """Close or re-key every job a complete read no longer lists, and record each with the read. `before` maps each key
    stored before the read to its row. Adds to the read's `counts`: closed (rows marked inactive, possible re-keys
    included), rekeyed and possible_rekey; a re-keyed job, written as new by the read, is taken off new."""
    leaving = [key for key, row in before.items() if row.get("active") and key not in seen]
    if not leaving:
        return counts
    ensure(conn)
    rows = _company_rows(conn, company_id)
    listed = [row for key, row in rows.items() if key in seen]
    at, decisions = db.now(), classify([rows[key] for key in leaving], listed, {key for key in seen if key not in before})
    carried = {d["successor"]["id"]: d["row"]["id"] for d in decisions if d["outcome"] == "rekeyed"}
    for decision in decisions:
        _record(conn, company_id, attempt, at, decision, carried)
        counts["rekeyed" if decision["outcome"] == "rekeyed" else "closed"] += 1
        counts["new"] -= decision["outcome"] == "rekeyed"
        counts["possible_rekey"] += decision["possible"] is not None
    return counts


def _per_source(conn, started_at):
    """Counts per source from the per-job records written since `started_at`."""
    sources = {}
    for row in conn.execute(f"""SELECT company_id, outcome, possible_rekey IS NOT NULL AS possible, COUNT(*) AS n
            FROM {table('posting_closures')} WHERE closed_at >= ? GROUP BY company_id, outcome, possible_rekey IS NOT NULL""",
                            (started_at,)).fetchall():
        entry = sources.setdefault(row["company_id"], Counter())
        name = "rekeyed" if row["outcome"] == "rekeyed" else "possibleRekey" if row["possible"] else "closed"
        entry[name] += row["n"]
    companies = {row["id"]: row for row in conn.execute(f"SELECT id, name, ats_type FROM {db.companies_table()}").fetchall()}
    listed = []
    for company_id in sorted(sources):
        counts, company = sources[company_id], companies.get(company_id)
        listed.append({"companyId": company_id, "name": company["name"] if company else None,
                       "reader": company["ats_type"] if company else None,
                       "wentInactive": counts["closed"] + counts["possibleRekey"], "closed": counts["closed"],
                       "possibleRekey": counts["possibleRekey"], "rekeyed": counts["rekeyed"]})
    return listed


def receipt(conn, started_at, resumes=0):
    """The receipt of the pull that started at `started_at`, from the records since then."""
    sources = _per_source(conn, started_at)
    totals = {name: sum(source[name] for source in sources) for name in ("wentInactive", "closed", "possibleRekey", "rekeyed")}
    reported = conn.execute(f"SELECT COALESCE(SUM(closed_count), 0) AS n FROM {table('source_pull_runs')} WHERE completed_at >= ?",
                            (started_at,)).fetchone()["n"]
    totals.update(sourceRunsClosed=int(reported), sources=len(sources))
    return {"pullStartedAt": started_at, "writtenAt": db.now(), "resumes": resumes, "totals": totals, "sources": sources}


def write_receipt(started_at, resumes=0):
    """Keep the receipt of the pull that started at `started_at` in the corpus it publishes with, and print its line."""
    with db.connect() as conn:
        ensure(conn)
        made = receipt(conn, started_at, resumes)
        kept = table("closure_receipts")
        conn.execute(f"DELETE FROM {kept} WHERE pull_started_at=?", (started_at,))
        conn.execute(f"INSERT INTO {kept} (pull_started_at, written_at, receipt) VALUES (?,?,?)",
                     (started_at, made["writtenAt"], json.dumps(made, separators=(",", ":"))))
        conn.execute(f"""DELETE FROM {kept} WHERE pull_started_at NOT IN
            (SELECT pull_started_at FROM {kept} ORDER BY pull_started_at DESC LIMIT {RECEIPTS_KEPT})""")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=RETAIN_DAYS)).isoformat(timespec="seconds")
        conn.execute(f"DELETE FROM {table('posting_closures')} WHERE closed_at < ?", (cutoff,))
    totals = made["totals"]
    print(f"Closure receipt: {totals['closed']} closed, {totals['rekeyed']} re-keyed, {totals['possibleRekey']} closed "
          f"with a possible re-key, across {totals['sources']} source{'' if totals['sources'] == 1 else 's'}.", flush=True)
    return made
