# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Remove the caller's own generated packet for one posting (1.26.0). Until now a tailored packet could only be regenerated, never discarded, so an automated acceptance run that generated one to prove it cites a story had no way to leave the owner's store as it found it. The removal is the caller's store only: the packet directory under this user's applications folder and this user's own per-posting row (the per-user SQLite store, or the FORCE-RLS career_user_applications row bound to OSHAL_USER_SUB). A posting already applied or later keeps its packet: that packet is the application record.

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
