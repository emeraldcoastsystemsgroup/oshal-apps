"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Guard the immutable UIUC source
    files, prove a byte mutation and pre-existing fetch drift are rejected, and
    pin fail-closed self-test behaviour without invoking the expensive
    aerodynamic anchor calculations.
"""

from __future__ import annotations

import shutil
import urllib.request
from pathlib import Path

import pytest

from aerosim.prop import uiuc_anchor


@pytest.fixture
def copied_uiuc_data(tmp_path: Path) -> Path:
    """Copy the complete immutable dataset for isolated mutation exercises."""
    for name in uiuc_anchor.UIUC_MANIFEST_SHA256:
        shutil.copyfile(Path(uiuc_anchor.UIUC_DATA_DIR, name), tmp_path / name)
    return tmp_path


def test_vendored_uiuc_files_match_manifest() -> None:
    """Every shipped source file must retain its provenance fingerprint."""
    checks = uiuc_anchor.verify_local_data()

    assert checks
    assert all(checks.values()), [name for name, valid in checks.items() if not valid]


def test_uiuc_manifest_rejects_one_byte_mutation(copied_uiuc_data: Path) -> None:
    """A scientific-data edit must fail while untouched files remain valid."""
    changed_name = next(iter(uiuc_anchor.UIUC_MANIFEST_SHA256))
    changed_path = copied_uiuc_data / changed_name
    source = changed_path.read_bytes()
    changed_path.write_bytes(source[:-1] + bytes([source[-1] ^ 1]))

    checks = uiuc_anchor.verify_local_data(str(copied_uiuc_data))

    assert checks[changed_name] is False
    assert all(valid for name, valid in checks.items() if name != changed_name)


def test_fetch_refuses_to_overwrite_existing_drift(
    copied_uiuc_data: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The recovery helper must not hide drift by silently replacing evidence."""
    changed_name = next(iter(uiuc_anchor.UIUC_MANIFEST_SHA256))
    changed_path = copied_uiuc_data / changed_name
    changed = changed_path.read_bytes() + b"unexpected-byte"
    changed_path.write_bytes(changed)

    def unexpected_download(*_args, **_kwargs) -> None:
        pytest.fail("existing drift must be rejected before a network request")

    monkeypatch.setattr(urllib.request, "urlretrieve", unexpected_download)

    with pytest.raises(RuntimeError, match="refusing to overwrite drifted data"):
        uiuc_anchor.fetch_uiuc_data(str(copied_uiuc_data))
    assert changed_path.read_bytes() == changed


def test_selftest_fails_closed_when_integrity_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No model-band result may mask a missing or drifted source artifact."""
    monkeypatch.setattr(
        uiuc_anchor,
        "verify_local_data",
        lambda: {"mutated-uiuc-source.txt": False},
    )
    monkeypatch.setattr(uiuc_anchor, "ANCHOR_CASES", {})

    assert uiuc_anchor._selftest() == 1
