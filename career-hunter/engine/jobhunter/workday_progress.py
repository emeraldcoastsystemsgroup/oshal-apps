# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Checkpoint complete Workday facet searches in the ingest's private scratch directory so a process restart keeps completed source work; changed counts, expired or malformed checkpoints are reread.
"""Anonymous listing progress, used only by the shared-corpus ingest writer."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time

from . import config

MAX_AGE = 4 * 60 * 60
MAX_BYTES = 40 * 1024 * 1024
LOG = logging.getLogger(__name__)


class Progress:
    def __init__(self, source):
        self.path, self.searches = None, {}
        if os.environ.get("JOBHUNTER_SOURCE_REQUESTS") and not config.POSTGRES:
            name = hashlib.sha256(source.encode()).hexdigest()
            self.path = config.DATA_DIR / (".workday-" + name + ".json")
            self._read()

    def _read(self):
        try:
            if not self.path.exists() or self.path.stat().st_size > MAX_BYTES:
                return
            value = json.loads(self.path.read_text())
            if value.get("version") == 1 and isinstance(value.get("searches"), dict):
                self.searches = value["searches"]
        except (OSError, ValueError, TypeError, AttributeError):
            LOG.exception("Workday progress could not be read; the source will be reread")

    def get(self, applied, total):
        saved = self.searches.get(json.dumps(applied, sort_keys=True))
        if not isinstance(saved, dict):
            return None
        rows, stamp = saved.get("rows"), saved.get("at")
        if not isinstance(stamp, (int, float)) or not 0 <= time.time() - stamp < MAX_AGE:
            return None
        if not isinstance(rows, list) or not rows or len(rows) != total:
            return None
        if any(not isinstance(row, dict) or not isinstance(row.get("ats_job_id"), str) or not row["ats_job_id"]
               or not isinstance(row.get("title"), str) or not row["title"].strip() for row in rows):
            return None
        return rows if len({row["ats_job_id"] for row in rows}) == total else None

    def keep(self, applied, rows):
        if self.path is None:
            return
        self.searches[json.dumps(applied, sort_keys=True)] = {"at": time.time(), "rows": rows}
        payload = json.dumps({"version": 1, "searches": self.searches})
        if len(payload.encode()) > MAX_BYTES:
            return
        temporary = self.path.with_suffix(".tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with temporary.open("w") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(self.path)
        except OSError:
            LOG.exception("Workday progress could not be saved; the source remains readable")

    def clear(self):
        if self.path is not None:
            try:
                self.path.unlink(missing_ok=True)
            except OSError:
                LOG.exception("Completed Workday progress could not be removed")
