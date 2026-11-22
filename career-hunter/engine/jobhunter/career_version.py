# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Generate again (lane CAREER-REGEN, 2026-11-21: Roger's open applications were made before this week's fixes and need new documents): the Career version a packet was made by, read from the package manifest beside the engine, so application.json records it (`career_version`) and My jobs can tell which jobs have documents from an earlier Career. '' when the manifest cannot be read, never a guess.
"""The installed Career version, as its manifest states it."""
import re
from functools import lru_cache

from . import config

_VERSION = re.compile(r'^version:\s*["\']?(\d+\.\d+\.\d+)["\']?\s*(?:#.*)?$', re.M)
_LIMIT = 256 * 1024


@lru_cache(maxsize=1)
def current() -> str:
    """The top-level `version:` of the package manifest (oshal-app.yaml beside engine/), or '' when unreadable."""
    manifest = config.ROOT.parent / 'oshal-app.yaml'
    try:
        if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size > _LIMIT:
            return ''
        found = _VERSION.search(manifest.read_text(encoding='utf-8'))
    except OSError:
        return ''
    return found.group(1) if found else ''
