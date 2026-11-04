# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Keep bounded scoring traversal in a validated owner-private cursor, advancing no-model passes without expanding their selectors or model budgets.
"""Bounded owner-private traversal of scoring candidates; contains no model calls."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import uuid

from . import config

CURSOR_FILE = 'score-freshness-cursors.json'
MAX_CURSORS = 32
MAX_BYTES = 8192
MAX_OFFSET = 1_000_000_000


def fingerprint(value) -> str:
    """Stable evidence identity; timestamps belong only when they affect model evidence."""
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def read_cursor(key):
    """Read one small regular owner file; malformed state never silently widens a pass."""
    path = config.DATA_DIR / CURSOR_FILE
    if not path.exists() and not path.is_symlink():
        return {}, 0
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_BYTES:
        raise ValueError('score_cursor_unavailable')
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(value, dict):
            raise ValueError()
        positions = value['positions']
        if value.get('version') != 1 or not isinstance(positions, dict) or len(positions) > MAX_CURSORS:
            raise ValueError()
        if any(not isinstance(name, str) or not re.fullmatch(r'[0-9a-f]{64}', name)
               or type(offset) is not int or not 0 <= offset <= MAX_OFFSET
               for name, offset in positions.items()):
            raise ValueError()
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError('score_cursor_unavailable') from error
    return positions, positions.get(key, 0)


def write_cursor(positions, key, offset):
    """Publish after a successful pass, including passes that find only fresh scores."""
    positions = dict(positions)
    positions.pop(key, None)
    positions[key] = offset if offset <= MAX_OFFSET else 0
    positions = dict(list(positions.items())[-MAX_CURSORS:])
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = config.DATA_DIR / CURSOR_FILE
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as output:
            os.chmod(temporary, 0o600)
            json.dump({'version': 1, 'positions': positions}, output, separators=(',', ':'))
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
