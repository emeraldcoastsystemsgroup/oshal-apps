# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Remove the caller's own generated packet for one posting (1.26.0). Until now a tailored packet could only be regenerated, never discarded, so an automated acceptance run that generated one to prove it cites a story had no way to leave the owner's store as it found it. The removal is the caller's store only: the packet directory under this user's applications folder and this user's own per-posting row (the per-user SQLite store, or the FORCE-RLS career_user_applications row bound to OSHAL_USER_SUB). A posting already applied or later keeps its packet: that packet is the application record.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Preview and permanently purge only this user's generated rows at least seven days old. The preview count is rechecked before mutation; packet files are buried until the database transaction commits, and scores/application state plus files are rolled back together on failure.

"""Discard one generated packet: the files and the per-user pointers to them.

A packet is what generate.generate_for leaves: ``APP_DIR/<company>__[<req>__]<posting id>/`` with
``application.json`` and the rendered resumes and cover, plus the user's own per-posting row
(status ``generated``, ``generated_at``, ``resume_path``, ``cover_path``). Removing it returns the
posting to the unworked state it had before generation, and nothing else changes: no other user's
store is reachable from here (APP_DIR is this user's folder; the row write goes through db.user_set,
which is RLS-scoped to the acting user in PostgreSQL mode).
"""
from __future__ import annotations

import json
import os
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config, db

# The statuses generate_for refuses to downgrade on regeneration: once a posting reaches one of
# them, its packet is the record of what was sent, so it is never discarded from here.
RECORD_STATUSES = frozenset({"applied", "interviewing", "interview", "offer", "rejected", "closed"})


def _is_packet_of(entry: Path, posting_id: int) -> bool:
    """
    @description True when a directory is this posting's packet: its name ends with the posting
    id after a double underscore and its application.json names the same posting.
    @param entry - One entry of the applications folder.
    @param posting_id - The posting.
    @returns Whether the entry is that posting's packet.
    """
    if entry.is_symlink() or not entry.is_dir() or not entry.name.endswith(f"__{posting_id}"):
        return False
    record = entry / "application.json"
    if record.is_symlink() or not record.is_file():
        return False
    try:
        data = json.loads(record.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return isinstance(data, dict) and data.get("posting_id") == posting_id


def packet_dirs(posting_id: int) -> list:
    """
    @description This user's packet directories for one posting (normally one).
    @param posting_id - The posting.
    @returns The directories, sorted by name.
    """
    app_dir = Path(config.APP_DIR)
    if not app_dir.is_dir():
        return []
    return sorted((e for e in app_dir.iterdir() if _is_packet_of(e, posting_id)), key=lambda p: p.name)


# The status an untouched posting holds: the column default in both stores (user_signals.status in
# SQLite, career_user_applications.status in PostgreSQL, which the compat view also COALESCEs to).
UNWORKED_STATUS = "new"


def _cutoff(cutoff_at: str) -> datetime:
    """Parse an explicit, timezone-aware cutoff and enforce the seven-day minimum age."""
    if not isinstance(cutoff_at, str) or not cutoff_at.strip():
        raise ValueError("a timezone-aware cutoff timestamp is required")
    value = cutoff_at.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("cutoff timestamp must include a timezone")
    parsed = parsed.astimezone(timezone.utc)
    if parsed > datetime.now(timezone.utc) - timedelta(days=7):
        raise ValueError("cutoff must be at least seven days old")
    return parsed


def _cutoff_text(cutoff: datetime) -> str:
    return cutoff.isoformat(timespec="seconds")


def _generated_rows(conn, cutoff: datetime, *, lock: bool = False) -> list:
    """Read the acting user's old Ready rows from its physical application store."""
    if db.config.POSTGRES:
        user_sub = db.require_sub()
        sql = """SELECT posting_id, generated_at::text AS generated_at
                   FROM career_user_applications
                  WHERE user_sub=? AND status='generated'
                    AND generated_at < CAST(? AS timestamptz)
                  ORDER BY generated_at, posting_id"""
        if lock:
            sql += " FOR UPDATE"
        return conn.execute(sql, (user_sub, _cutoff_text(cutoff))).fetchall()
    if not db.config.MULTIUSER:
        raise RuntimeError("per-user packet purge is available only in multi-user storage")
    sql = """SELECT posting_id, generated_at FROM user_signals
              WHERE status='generated' AND generated_at IS NOT NULL
                AND julianday(generated_at) < julianday(?)
              ORDER BY julianday(generated_at), posting_id"""
    return conn.execute(sql, (_cutoff_text(cutoff),)).fetchall()


def _packet_dirs_for(posting_ids: set[int]) -> dict[int, list[Path]]:
    """Index this user's verified packet directories with one applications-folder walk."""
    found: dict[int, list[Path]] = {posting_id: [] for posting_id in posting_ids}
    app_dir = Path(config.APP_DIR)
    if not posting_ids or not app_dir.is_dir():
        return found
    for entry in app_dir.iterdir():
        if entry.is_symlink() or not entry.is_dir():
            continue
        suffix = entry.name.rpartition("__")[2]
        if not suffix.isdigit():
            continue
        posting_id = int(suffix)
        if posting_id in found and _is_packet_of(entry, posting_id):
            found[posting_id].append(entry)
    for directories in found.values():
        directories.sort(key=lambda item: item.name)
    return found


def preview_generated_before(cutoff_at: str) -> dict:
    """Preview old Ready rows and their verified private packet directories."""
    try:
        cutoff = _cutoff(cutoff_at)
    except (TypeError, ValueError) as error:
        return {"ok": False, "code": "invalid-cutoff", "error": str(error)}
    with db.connect() as conn:
        rows = _generated_rows(conn, cutoff)
    ids = {int(row["posting_id"]) for row in rows}
    packet_map = _packet_dirs_for(ids)
    timestamps = [str(row["generated_at"]) for row in rows if row["generated_at"] is not None]
    match_rows = len(ids)
    if db.config.POSTGRES and ids:
        with db.connect() as conn:
            posting_ids = sorted(ids)
            placeholders = ", ".join("?" for _ in posting_ids)
            row = conn.execute(
                f"""SELECT COUNT(*) AS n FROM career_user_job_scores
                      WHERE user_sub=? AND posting_id IN ({placeholders})""",
                (db.require_sub(), *posting_ids),
            ).fetchone()
            match_rows = int(row["n"] if row else 0)
    return {
        "ok": True,
        "mode": "preview",
        "cutoffAt": _cutoff_text(cutoff),
        "readyRows": len(rows),
        "matchRows": match_rows,
        "packetDirectories": sum(len(dirs) for dirs in packet_map.values()),
        "readyRowsWithoutPacket": sum(not dirs for dirs in packet_map.values()),
        "oldestQueuedAt": min(timestamps) if timestamps else None,
        "newestQueuedAt": max(timestamps) if timestamps else None,
    }


def purge_generated_before(cutoff_at: str, expected_count: int) -> dict:
    """Permanently remove only this user's generated rows older than the explicit cutoff.

    The count supplied by the preview must still match inside the database transaction. Application and
    score rows are deleted in one database transaction; verified packet directories are first
    moved aside, restored on any database failure, and deleted only after commit.
    """
    try:
        cutoff = _cutoff(cutoff_at)
    except (TypeError, ValueError) as error:
        return {"ok": False, "code": "invalid-cutoff", "error": str(error)}
    if not isinstance(expected_count, int) or expected_count < 0:
        return {"ok": False, "code": "invalid-count", "error": "expected count must be a non-negative integer"}

    graves: list[tuple[Path, Path]] = []
    score_rows = expected_count
    try:
        with db.connect() as conn:
            rows = _generated_rows(conn, cutoff, lock=db.config.POSTGRES)
            if len(rows) != expected_count:
                return {
                    "ok": False,
                    "code": "count-changed",
                    "error": "the Ready queue changed after preview; preview it again",
                    "readyRows": len(rows),
                }
            posting_ids = {int(row["posting_id"]) for row in rows}
            packet_map = _packet_dirs_for(posting_ids)
            directories = [entry for group in packet_map.values() for entry in group]
            for directory in directories:
                grave = directory.with_name(f".purged-{uuid.uuid4().hex}")
                os.replace(directory, grave)
                graves.append((directory, grave))

            if posting_ids:
                ids = sorted(posting_ids)
                placeholders = ", ".join("?" for _ in ids)
                if db.config.POSTGRES:
                    user_sub = db.require_sub()
                    deleted = conn.execute(
                        f"""DELETE FROM career_user_applications
                             WHERE user_sub=? AND status='generated'
                               AND generated_at < CAST(? AS timestamptz)
                               AND posting_id IN ({placeholders})""",
                        (user_sub, _cutoff_text(cutoff), *ids),
                    ).rowcount
                    if deleted != expected_count:
                        raise RuntimeError("the locked Ready queue changed during purge")
                    score_deleted = conn.execute(
                        f"DELETE FROM career_user_job_scores WHERE user_sub=? AND posting_id IN ({placeholders})",
                        (user_sub, *ids),
                    ).rowcount
                    score_rows = int(score_deleted)
                else:
                    deleted = conn.execute(
                        f"""DELETE FROM user_signals
                             WHERE status='generated' AND generated_at IS NOT NULL
                               AND julianday(generated_at) < julianday(?)
                               AND posting_id IN ({placeholders})""",
                        (_cutoff_text(cutoff), *ids),
                    ).rowcount
                    if deleted != expected_count:
                        raise RuntimeError("the locked Ready queue changed during purge")
    except Exception:
        for original, grave in reversed(graves):
            try:
                os.replace(grave, original)
            except OSError:
                pass
        raise

    cleanup_errors = 0
    for _original, grave in graves:
        try:
            shutil.rmtree(grave)
        except OSError:
            cleanup_errors += 1
    return {
        "ok": True,
        "mode": "purge",
        "cutoffAt": _cutoff_text(cutoff),
        "purgedReadyRows": expected_count,
        "purgedMatchRows": score_rows,
        "removedPacketDirectories": len(graves),
        "packetCleanupErrors": cleanup_errors,
        "otherStatusesPreserved": True,
        "sharedCorpusPreserved": True,
    }


def _cleared(status: str) -> dict:
    """
    @description The per-user columns a discarded packet clears. The status goes back to the
    unworked value only when it is the packet's own `generated`; any other status is the owner's
    and is kept.
    @param status - The posting's current status for this user.
    @returns Columns for db.user_set.
    """
    cols = {"resume_path": None, "cover_path": None, "generated_at": None}
    if status == "generated":
        cols["status"] = UNWORKED_STATUS
    return cols


def _bury(dirs: list) -> list:
    """
    @description Move each packet aside under a name no packet scan matches, so the delete that
    follows the database commit cannot leave a half-removed packet that still looks live.
    @param dirs - Packet directories.
    @returns (original, buried) pairs, in the same order.
    """
    graves = []
    for directory in dirs:
        grave = directory.with_name(f".removing-{uuid.uuid4().hex}")
        os.replace(directory, grave)
        graves.append((directory, grave))
    return graves


def remove(posting_id: int) -> dict:
    """
    @description Discard this user's generated packet for one posting. The row write and the move
    aside happen inside one database transaction; if either fails the packets are moved back and
    nothing is committed.
    @param posting_id - The posting.
    @returns {ok, removed, status} or {ok: False, code: 'not-found'|'conflict', error}.
    """
    dirs = packet_dirs(posting_id)
    if not dirs:
        return {"ok": False, "code": "not-found", "error": "no generated packet for this posting"}
    graves: list = []
    try:
        with db.connect() as conn:
            row = conn.execute("SELECT status FROM postings WHERE id=?", (posting_id,)).fetchone()
            status = str((row["status"] if row else None) or "")
            if status in RECORD_STATUSES:
                return {"ok": False, "code": "conflict",
                        "error": f"the posting is {status}: its packet is the application record"}
            if row:
                db.user_set(conn, posting_id, **_cleared(status))
            graves = _bury(dirs)
    except Exception:
        for original, grave in reversed(graves):
            os.replace(grave, original)
        raise
    for _original, grave in graves:
        shutil.rmtree(grave)
    after = _cleared(status).get("status", status or None) if row else None
    return {"ok": True, "removed": [d.name for d in dirs], "status": after}
