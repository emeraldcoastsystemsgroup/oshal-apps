"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Make the vendored engine the
    single test import root so collection is identical from the package,
    store, or CI working directory without per-test sys.path mutations.
"""

from __future__ import annotations

import sys
from pathlib import Path


ENGINE_ROOT = Path(__file__).resolve().parents[1]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))
