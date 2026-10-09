"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | The package docs name the vendored engine
  |                                           | by its fingerprint, and that name had
  |                                           | drifted: README, BACKLOG and BUILD_CONTRACT
  |                                           | all said 603cf4c5e8d9e4c9 while the shipped
  |                                           | bytes hashed to something else. This guard
  |                                           | computes service._fingerprint() over the
  |                                           | tree and requires every doc to state THAT
  |                                           | value, with no other engine fingerprint in
  |                                           | them except the recorded upstream tree's.

Runs offline in milliseconds: hashing four files, reading three docs.
"""

from __future__ import annotations

import re
from pathlib import Path

import service

PACKAGE_DIR = Path(__file__).resolve().parents[2]

#: The docs that state which engine tree the package vendors.
DOCS = ("README.md", "BACKLOG.md", "BUILD_CONTRACT.md")

#: Fingerprints of OTHER trees the docs legitimately name. The only one is the
#: upstream working checkout recorded in BACKLOG section B (2026-09-16), which
#: this package does not ship and never selects by default.
OTHER_TREES = {"0a9aaab7ff87f747": "live upstream checkout (BACKLOG section B)"}

_BACKTICKED_FP = re.compile(r"`([0-9a-f]{16})`")


def _computed() -> str:
    """@returns The vendored tree's fingerprint as service.py computes it."""
    fp = service._fingerprint()
    assert fp is not None and re.fullmatch(r"[0-9a-f]{16}", fp), fp
    return fp


def test_service_fingerprints_the_vendored_tree() -> None:
    """The fingerprint is taken over the tree shipped beside service.py."""
    assert Path(service.ENGINE_DIR).resolve() == Path(service.__file__).resolve().parent


def test_every_doc_states_the_computed_fingerprint() -> None:
    """Each doc names the value the code computes today."""
    fp = _computed()
    for name in DOCS:
        text = (PACKAGE_DIR / name).read_text(encoding="utf-8")
        assert f"`{fp}`" in text, (
            f"{name} does not state the vendored engine fingerprint {fp}; "
            f"update it (service._fingerprint())")


def test_no_doc_names_a_stale_fingerprint() -> None:
    """Any other backticked 16-hex value must be a recorded foreign tree."""
    fp = _computed()
    for name in DOCS:
        text = (PACKAGE_DIR / name).read_text(encoding="utf-8")
        stale = sorted({m for m in _BACKTICKED_FP.findall(text)
                        if m != fp and m not in OTHER_TREES})
        assert not stale, f"{name} names engine fingerprint(s) {stale}; the tree is {fp}"
