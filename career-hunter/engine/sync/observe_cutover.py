#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Take one post-promotion observation sample (convergence, reverse-sync lag, nightly completion marker, owner-isolation probe, ingest/score/draft/application activity), archive one convergence report per nightly completion, and keep the seven-day window honest: a missing sample, a failed marker or any out-of-bounds signal resets it.
# 2 | maintainer@emeraldcoastsystemsgroup.com | A window.json that exists but cannot be read or parsed no longer counts as "no window": the sampler logs it at ERROR, keeps the file aside as window.unreadable-<stamp>.json and records a 'window-unreadable' reset, so the sample exits 2 instead of silently starting a fresh window. Only a missing file means the first sample. An unreadable nightly marker is logged too (it was already recorded as a violation).

"""Career cutover observation sample and seven-day window.

Run once after every nightly completion (and as often as wanted in between) once PostgreSQL takes
writes. Each run:

* builds the full convergence report (``report_convergence.build_report``) and archives it once per
  nightly completion marker under ``<archive>/reports/``;
* reads the reverse projector's metrics (``reverse_sync.collect_metrics``);
* reads the evening chain's completion marker (``<data-root>/.last-evening-run``, written by the
  package cron only after a successful scrape);
* probes owner isolation: as each owner, with the operator setting off, every per-user table must
  show zero rows belonging to anyone else, and the outbox must show none at all;
* counts activity since the previous sample: postings ingested and deactivated, rows scored,
  drafts generated, approvals queued, and application-state transitions;
* appends the sample and updates ``window.json``. The window only completes after the configured
  days of consecutive in-bounds samples; a gap longer than ``--max-sample-gap-hours``, a stale or
  missing nightly marker, a ``window.json`` that exists but cannot be read (kept aside as
  ``window.unreadable-<stamp>.json``), or any other violation resets it and records why.

Route latency percentiles and database error rates are not measured here: they belong to the core
monitoring stack, which already scrapes the api.

Exit status: 0 in bounds, 2 when this sample reset the window.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import report_convergence  # noqa: E402
import reverse_sync  # noqa: E402

SCHEMA_VERSION = 1
OWNER_TABLES = ("career_user_job_scores", "career_user_applications",
                "career_user_recruiter_firms", "career_user_gap_themes",
                "career_user_interview_assessments")
MARKER = ".last-evening-run"
WINDOW_UNREADABLE = "window-unreadable"

log = logging.getLogger("career.observe_cutover")


def _log(level: int, event: str, **fields) -> None:
    """Write one structured JSON log line to stderr."""
    log.log(level, json.dumps({"event": event, "module": "career-observe-cutover", **fields},
                              default=str, sort_keys=True))


def _now(value: str | None) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")) if value else datetime.now(timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return None if value is None else value.astimezone(timezone.utc).isoformat(timespec="seconds")


def _stamp(iso: str) -> str:
    """A filename-safe UTC stamp (20260927T221900Z) for an ISO-8601 time."""
    return _now(iso).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def owner_label(user_sub: str) -> str:
    """A stable, non-reversible label for an owner in anything the status route serves."""
    return "owner-" + hashlib.sha256(user_sub.encode("utf-8")).hexdigest()[:12]


def redact_failures(failures: list[str], owners: list[str]) -> list[str]:
    """Replace raw owner subjects inside dataset names with their labels."""
    out = []
    for name in failures:
        for owner in owners:
            prefix = f"users.{owner}."
            if name.startswith(prefix):
                name = f"users.{owner_label(owner)}." + name[len(prefix):]
                break
        out.append(name)
    return out


# ── signals ──────────────────────────────────────────────────────────────────────────────────
def nightly_marker(root: Path, now: datetime, max_age_hours: float) -> dict:
    """The evening chain's completion marker and whether it is fresh enough."""
    path = root / MARKER
    try:
        completed = _now(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError) as error:
        # Recorded as the nightly-marker-missing violation, which resets the window.
        _log(logging.WARNING, "nightly-marker-unreadable", path=str(path), error=repr(error))
        return {"completedAt": None, "ageHours": None, "ok": False}
    age = (now - completed).total_seconds() / 3600
    return {"completedAt": _iso(completed), "ageHours": round(age, 2), "ok": 0 <= age <= max_age_hours}


def rls_probe(database_url: str, owners: list[str]) -> dict:
    """As each owner (operator off), count rows of any OTHER owner and any outbox row."""
    import psycopg2

    visible = {}
    conn = psycopg2.connect(database_url)
    try:
        for owner in owners:
            with conn.cursor() as cur:
                cur.execute("SELECT set_config('oshal.current_sub', %s, false), "
                            "set_config('oshal.is_operator', 'off', false)", (owner,))
                foreign = 0
                for table in OWNER_TABLES:
                    cur.execute(f"SELECT COUNT(*) FROM {table} WHERE user_sub <> %s", (owner,))
                    foreign += int(cur.fetchone()[0])
                cur.execute("SELECT COUNT(*) FROM career_store_change_log")
                foreign += int(cur.fetchone()[0])
            conn.rollback()
            visible[owner_label(owner)] = foreign
    finally:
        conn.close()
    return {"probedOwners": len(owners), "foreignRowsVisible": sum(visible.values()),
            "byOwner": visible, "ok": sum(visible.values()) == 0}


ACTIVITY_SQL = {
    "postingsIngested": "SELECT COUNT(*) FROM career_postings WHERE first_seen_at > %(since)s "
                        "AND first_seen_at <= %(until)s",
    "postingsDeactivated": "SELECT COUNT(*) FROM career_store_change_log WHERE table_name = "
                           "'career_postings' AND operation = 'UPDATE' AND row_after->>'active' = "
                           "'false' AND committed_at > %(since)s AND committed_at <= %(until)s",
    "rowsScored": "SELECT COUNT(*) FROM career_user_job_scores WHERE ai_scored_at > %(since)s "
                  "AND ai_scored_at <= %(until)s",
    "draftsGenerated": "SELECT COUNT(*) FROM career_user_applications WHERE generated_at > "
                       "%(since)s AND generated_at <= %(until)s",
    "approvalsQueued": "SELECT COUNT(*) FROM career_hunter_applications WHERE created_at > "
                       "%(since)s AND created_at <= %(until)s",
}


def activity(database_url: str, since: datetime, until: datetime) -> dict:
    """Ingest, deactivation, scoring, drafting and application transitions in (since, until]."""
    import psycopg2

    conn = psycopg2.connect(database_url)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('oshal.is_operator','on',false)")
            out = {}
            for name, sql in ACTIVITY_SQL.items():
                cur.execute(sql, {"since": since, "until": until})
                out[name] = int(cur.fetchone()[0])
            cur.execute("SELECT COALESCE(row_after->>'status', 'deleted'), COUNT(*) FROM "
                        "career_store_change_log WHERE table_name = 'career_user_applications' "
                        "AND committed_at > %(since)s AND committed_at <= %(until)s GROUP BY 1 "
                        "ORDER BY 1", {"since": since, "until": until})
            out["applicationTransitions"] = {status: int(n) for status, n in cur.fetchall()}
        conn.rollback()
        return {"since": _iso(since), "until": _iso(until), **out}
    finally:
        conn.close()


def projector_metrics(database_url: str, worker: str) -> dict:
    """The reverse projector's metrics, read without taking its worker lock."""
    pg = reverse_sync.connect(database_url, worker, lock=False)
    try:
        return reverse_sync.collect_metrics(pg, worker)
    finally:
        pg.close()


# ── bounds and the window ────────────────────────────────────────────────────────────────────
DEFAULT_POLICY = {"windowDays": 7, "maxSampleGapHours": 26, "maxNightlyAgeHours": 26,
                  "maxProjectorLagSeconds": 900}


def violations(sample: dict, policy: dict) -> list[str]:
    """Every reason this sample is out of bounds; empty means in bounds."""
    found = []
    if not sample["convergence"]["converged"]:
        found.append("convergence-drift")
    if not sample["nightly"]["ok"]:
        found.append("nightly-marker-missing" if sample["nightly"]["completedAt"] is None
                     else "nightly-marker-stale")
    projector = sample["reverseSync"]
    if projector.get("lastError"):
        found.append("projector-failed")
    if (projector.get("lagSeconds") or 0) > policy["maxProjectorLagSeconds"]:
        found.append("projector-lag")
    if not sample["rls"]["ok"]:
        found.append("rls-isolation")
    return found


def update_window(window: dict | None, sample: dict, policy: dict,
                  reset_reason: str | None = None) -> dict:
    """Advance the observation window by one sample, resetting it on any violation or gap.

    ``reset_reason`` is a reset the stored window itself forces (``window-unreadable``); it is
    recorded first, ahead of the sample's own violations.
    """
    window = dict(window or {"schemaVersion": SCHEMA_VERSION, "startedAt": None, "samples": 0,
                             "inBoundsSamples": 0, "lastSampleAt": None, "resets": [],
                             "complete": False, "completedAt": None})
    window["windowDays"] = policy["windowDays"]
    sampled = _now(sample["sampledAt"])
    reasons = ([reset_reason] if reset_reason else []) + list(sample["violations"])
    if window["lastSampleAt"]:
        gap = (sampled - _now(window["lastSampleAt"])).total_seconds() / 3600
        if gap > policy["maxSampleGapHours"]:
            reasons.insert(0, "missing-sample")
    if reasons:
        window.update(startedAt=None, inBoundsSamples=0, complete=False, completedAt=None)
        window["resets"] = (window["resets"] + [{"at": _iso(sampled), "reasons": reasons}])[-50:]
    else:
        window["startedAt"] = window["startedAt"] or _iso(sampled)
        window["inBoundsSamples"] += 1
        elapsed = sampled - _now(window["startedAt"])
        if not window["complete"] and elapsed >= timedelta(days=policy["windowDays"]):
            window.update(complete=True, completedAt=_iso(sampled))
    window["samples"] += 1
    window["lastSampleAt"] = _iso(sampled)
    window["lastSampleReset"] = bool(reasons)
    return window


def _write_json(path: Path, value) -> None:
    """Write through a temporary file and an atomic rename, so a reader never sees half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, sort_keys=True, indent=1, default=str) + "\n", encoding="utf-8")
    os.replace(temp, path)


def _set_aside(path: Path, error: Exception) -> str:
    """Keep an unreadable window.json aside (never overwrite it) and name the forced reset.

    If it cannot even be moved, the sample fails loudly rather than write over the evidence.
    """
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    aside = path.with_name(f"window.unreadable-{stamp}.json")
    try:
        os.replace(path, aside)
    except OSError as move_error:
        _log(logging.ERROR, "window-unreadable-not-set-aside", path=str(path), error=repr(error),
             moveError=repr(move_error))
        raise
    _log(logging.ERROR, WINDOW_UNREADABLE, path=str(path), keptAs=str(aside), error=repr(error),
         effect="the observation window resets")
    return WINDOW_UNREADABLE


def load_window(archive: Path) -> tuple[dict | None, str | None]:
    """The stored window and any reset it forces.

    ``(None, None)`` only when window.json does not exist (before the first sample). A file that
    exists but cannot be read, is not JSON, or is not a JSON object is logged at ERROR, kept aside,
    and returned as ``(None, "window-unreadable")`` so this sample records a reset.
    """
    path = archive / "window.json"
    try:
        window = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, None
    except (OSError, ValueError) as error:
        return None, _set_aside(path, error)
    if not isinstance(window, dict):
        return None, _set_aside(path, TypeError(f"window.json holds {type(window).__name__}"))
    return window, None


def record(archive: Path, sample: dict, policy: dict,
           loaded: tuple[dict | None, str | None] | None = None) -> dict:
    """Persist one sample: samples/<stamp>.json, latest.json and the updated window.json.

    ``loaded`` is what load_window returned for this sample (read here when omitted).
    """
    window, reset_reason = loaded if loaded is not None else load_window(archive)
    window = update_window(window, sample, policy, reset_reason)
    _write_json(archive / "samples" / f"sample-{_stamp(sample['sampledAt'])}.json", sample)
    _write_json(archive / "latest.json", sample)
    _write_json(archive / "window.json", window)
    return window


def archive_report(archive: Path, report: dict, nightly: dict) -> str | None:
    """Keep exactly one convergence report per nightly completion marker."""
    if not nightly["completedAt"]:
        return None
    name = f"convergence-{_stamp(nightly['completedAt'])}.json"
    path = archive / "reports" / name
    if not path.exists():
        _write_json(path, report)
    return f"reports/{name}"


# ── one sample ───────────────────────────────────────────────────────────────────────────────
def _convergence_summary(report: dict, seconds: float) -> dict:
    owners = list(report["users"])
    return {"converged": report["converged"], "failures": redact_failures(report["failures"], owners),
            "owners": len(owners), "seconds": round(seconds, 3),
            "corpus": {name: {"sqlite": d["sqlite"]["count"], "postgres": d["postgres"]["count"]}
                       for name, d in report["corpus"].items()}}


def take_sample(args, policy: dict, now: datetime, window: dict | None) -> tuple[dict, dict]:
    """Collect every signal for one sample; returns (sample, full convergence report)."""
    root = args.data_root.resolve()
    since = _now(window["lastSampleAt"]) if window and window.get("lastSampleAt") \
        else now - timedelta(hours=args.first_window_hours)
    started = time.monotonic()
    report = report_convergence.build_report(root, args.database_url, None)
    seconds = time.monotonic() - started
    projector = projector_metrics(args.database_url, args.worker)
    sample = {
        "schemaVersion": SCHEMA_VERSION, "sampledAt": _iso(now),
        "nightly": nightly_marker(root, now, policy["maxNightlyAgeHours"]),
        "convergence": _convergence_summary(report, seconds),
        "reverseSync": {key: projector[key] for key in (
            "caughtUp", "pendingRows", "lagSeconds", "rowFailures", "lastError",
            "outstandingClaims", "lastChangeId", "latestChangeId", "perTable")},
        "rls": rls_probe(args.database_url, list(report["users"])),
        "activity": activity(args.database_url, since, now),
    }
    sample["violations"] = violations(sample, policy)
    sample["inBounds"] = not sample["violations"]
    return sample, report


def _parse(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--data-root", type=Path, default=report_convergence.DEFAULT_ROOT)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--archive-dir", type=Path, help="default: <data-root>/_cutover")
    parser.add_argument("--worker", default=reverse_sync.WORKER)
    parser.add_argument("--window-days", type=int, default=DEFAULT_POLICY["windowDays"])
    parser.add_argument("--max-sample-gap-hours", type=float, default=DEFAULT_POLICY["maxSampleGapHours"])
    parser.add_argument("--max-nightly-age-hours", type=float, default=DEFAULT_POLICY["maxNightlyAgeHours"])
    parser.add_argument("--max-projector-lag-seconds", type=float,
                        default=DEFAULT_POLICY["maxProjectorLagSeconds"])
    parser.add_argument("--first-window-hours", type=float, default=24.0,
                        help="activity window for the very first sample")
    parser.add_argument("--now", help="sample time (ISO-8601); defaults to the current time")
    args = parser.parse_args(argv)
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    return args


def main(argv=None) -> int:
    """Take, archive and record one sample; exit 2 when it reset the window."""
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
    args = _parse(argv)
    policy = {"windowDays": args.window_days, "maxSampleGapHours": args.max_sample_gap_hours,
              "maxNightlyAgeHours": args.max_nightly_age_hours,
              "maxProjectorLagSeconds": args.max_projector_lag_seconds}
    archive = (args.archive_dir or (args.data_root / "_cutover")).resolve()
    now = _now(args.now)
    loaded = load_window(archive)
    sample, report = take_sample(args, policy, now, loaded[0])
    sample["archivedReport"] = archive_report(archive, report, sample["nightly"])
    window = record(archive, sample, policy, loaded)
    print("CAREER_CUTOVER_OBSERVATION=" + json.dumps({"sample": sample, "window": window},
                                                     sort_keys=True, default=str,
                                                     separators=(",", ":")), flush=True)
    return 2 if window["lastSampleReset"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
