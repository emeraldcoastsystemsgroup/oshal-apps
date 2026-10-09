"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | The vendored real-chain sweep driver on a
  |                                           | pinned 20-design subset (seed 20260927, the
  |                                           | production default step): two runs are
  |                                           | byte-identical; the sample is a pure
  |                                           | function of (seed, index) inside
  |                                           | service.BOUNDS; every record is stamped with
  |                                           | the tree it was scored against and carries
  |                                           | only closed-set reasons; a resume after a
  |                                           | torn write re-scores exactly what is missing
  |                                           | and reproduces the same bytes; a changed
  |                                           | request, a missing --resume, a stale file
  |                                           | fingerprint and a tree that changes
  |                                           | mid-run are each refused.
2 | maintainer@emeraldcoastsystemsgroup.com   | verify_top was untested: no case reached
  |                                           | verify_survivor(chain="real"), because
  |                                           | nothing on the 20-design subset passes. Two
  |                                           | crafted-pass files over the fixedwing preset
  |                                           | vector now drive it: exactly one verify
  |                                           | record is appended for the top pass only,
  |                                           | its fresh-subprocess verdict reproduces the
  |                                           | in-process real-chain score (min SOC and the
  |                                           | closed-set soc_not_persistent code), 'agrees'
  |                                           | follows the record's own metrics both ways,
  |                                           | and report() lists the verify record.

The 30k run itself is an elapsed-time job and is not launched here. The two
verify_top cases cost one in-process real-chain score of the fixedwing preset
plus one fresh-subprocess re-run each.
"""

from __future__ import annotations

import json
import shutil

import pytest

import service
import sweep_real
from aerosim import validate_screen, validity

N = 20
SEED = sweep_real.DEFAULT_SEED


@pytest.fixture(scope="module")
def first_run(tmp_path_factory):
    """The pinned subset, scored once."""
    out = tmp_path_factory.mktemp("sweep") / "a.jsonl"
    result = sweep_real.run_sweep(str(out), n=N, seed=SEED)
    assert result == {"evaluated": N, "skipped": 0, "path": str(out)}
    return out


def _lines(path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_two_runs_are_byte_identical(first_run, tmp_path) -> None:
    second = tmp_path / "b.jsonl"
    sweep_real.run_sweep(str(second), n=N, seed=SEED)
    assert second.read_bytes() == first_run.read_bytes()


def test_the_sample_is_pinned_and_inside_the_bounds() -> None:
    a = [sweep_real.sample_vector(SEED, i) for i in range(N)]
    assert a == [sweep_real.sample_vector(SEED, i) for i in range(N)]
    assert a != [sweep_real.sample_vector(SEED + 1, i) for i in range(N)]
    for v in a:
        assert service._validate_vector(v) == v
        assert v["buoyancy_fraction"] == 0.0


def test_header_and_records_are_stamped(first_run) -> None:
    header, *records = _lines(first_run)
    assert header["type"] == "header" and header["chain"] == "real"
    assert header["sampleHash"] == sweep_real.sample_hash(SEED, N)
    assert header["engineFingerprint"] == service._fingerprint()
    assert header["treeFingerprint"] == validate_screen.tree_fingerprint()
    assert header["dtS"] == 60.0 and header["windowS"] == 86400.0
    assert [r["index"] for r in records] == list(range(N))
    for r in records:
        assert r["treeFingerprint"] == header["treeFingerprint"]
        assert r["vector"] == sweep_real.sample_vector(SEED, r["index"])
        assert r["outcome"] in ("pass", "fail", "error")
        assert all(validity.is_reason(x) for x in r["reasons"] + r["flags"])
        if r["outcome"] == "fail":
            assert r["reasons"]


def test_report_summarises_the_file(first_run) -> None:
    summary = sweep_real.report(str(first_run))
    assert summary["complete"] is True and summary["recorded"] == N
    assert sum(summary["outcomes"].values()) == N
    assert sum(summary["reasonCodes"].values()) >= summary["outcomes"].get("fail", 0)


def test_resume_after_a_torn_write_reproduces_the_bytes(first_run, tmp_path) -> None:
    lines = first_run.read_bytes().splitlines(keepends=True)
    partial = tmp_path / "partial.jsonl"
    partial.write_bytes(b"".join(lines[:8]) + lines[8][:25])      # header + 7 + torn 8th
    result = sweep_real.run_sweep(str(partial), n=N, seed=SEED, resume=True)
    assert result["skipped"] == 7 and result["evaluated"] == N - 7
    assert partial.read_bytes() == first_run.read_bytes()


def test_an_existing_file_needs_resume(first_run, tmp_path) -> None:
    copy = tmp_path / "copy.jsonl"
    shutil.copy(first_run, copy)
    with pytest.raises(sweep_real.SweepConfigError, match="--resume"):
        sweep_real.run_sweep(str(copy), n=N, seed=SEED)
    assert copy.read_bytes() == first_run.read_bytes()


def test_a_changed_request_is_refused(first_run, tmp_path) -> None:
    copy = tmp_path / "copy.jsonl"
    shutil.copy(first_run, copy)
    with pytest.raises(sweep_real.SweepConfigError, match="seed"):
        sweep_real.run_sweep(str(copy), n=N, seed=SEED + 1, resume=True)
    with pytest.raises(sweep_real.SweepConfigError, match="dtS"):
        sweep_real.run_sweep(str(copy), n=N, seed=SEED, dt_s=600.0, resume=True)


def test_a_stale_fingerprint_is_refused(first_run, tmp_path) -> None:
    header, *rest = first_run.read_text(encoding="utf-8").splitlines(keepends=True)
    obj = json.loads(header)
    obj["treeFingerprint"] = "0" * 64
    stale = tmp_path / "stale.jsonl"
    stale.write_text(sweep_real._canon(obj) + "\n" + "".join(rest[:3]), encoding="utf-8")
    before = stale.read_bytes()
    with pytest.raises(validate_screen.SweepIntegrityError, match="do not mix trees"):
        sweep_real.run_sweep(str(stale), n=N, seed=SEED, resume=True)
    assert stale.read_bytes() == before


def test_a_tree_that_changes_mid_run_stops_the_sweep(tmp_path, monkeypatch) -> None:
    screen = service._load_engine()["validate_screen"]
    real = screen.tree_fingerprint
    calls = {"n": 0}

    def drifting() -> str:
        calls["n"] += 1
        return real() if calls["n"] <= 3 else "f" * 64       # header + 2 designs, then drift

    monkeypatch.setattr(screen, "tree_fingerprint", drifting)
    out = tmp_path / "drift.jsonl"
    with pytest.raises(screen.SweepIntegrityError, match="mid-sweep at design 2"):
        sweep_real.run_sweep(str(out), n=N, seed=SEED)
    header, *records = _lines(out)
    assert [r["index"] for r in records] == [0, 1]


@pytest.fixture(scope="module")
def fixedwing_real() -> tuple[dict, dict]:
    """The reference presets by key, and the fixedwing preset scored in-process
    on the real chain exactly as _score scores a sweep design: the numbers a
    real-chain verify must reproduce. test_reference_certification pins this
    score as a flight failure (soc_not_persistent); the ideal chain closes it."""
    hooks, cert, _m = sweep_real._hooks()
    presets = {p["key"]: p["v"] for p in cert.load_presets()}
    scored = service._json_safe(cert.certify_preset(
        hooks, {"key": "fixedwing", "v": presets["fixedwing"]},
        window_s=sweep_real.SWEEP_WINDOW_S, dt_s=sweep_real.SWEEP_DT_S))
    assert (scored["outcome"], scored["stage"]) == ("fail", "flight")
    return presets, scored


def _design(index: int, vector: dict, outcome: str, metrics: dict | None,
            reasons: list | None = None) -> dict:
    """A crafted sweep design record, in the shape _score writes."""
    return {"type": "design", "index": index, "treeFingerprint": validate_screen.tree_fingerprint(),
            "vector": vector, "outcome": outcome, "stage": None,
            "reasons": list(reasons or []), "flags": [], "metrics": metrics}


def _write_sweep(path, designs: list[dict]) -> bytes:
    """Write a header from make_header plus the crafted designs; return the bytes."""
    header = sweep_real.make_header(SEED, len(designs), sweep_real.SWEEP_DT_S,
                                    validate_screen.tree_fingerprint())
    path.write_text("".join(sweep_real._canon(o) + "\n" for o in [header, *designs]),
                    encoding="utf-8")
    return path.read_bytes()


def _appended(path, before: bytes) -> list[dict]:
    """The records written after `before`, which must be an unchanged prefix."""
    after = path.read_bytes()
    assert after.startswith(before)
    return [json.loads(line) for line in after[len(before):].decode("utf-8").splitlines()]


def test_verify_top_reconfirms_the_top_pass_on_the_real_chain(fixedwing_real, tmp_path) -> None:
    presets, scored = fixedwing_real
    usable = scored["metrics"]["usable"]
    out = tmp_path / "verify.jsonl"
    before = _write_sweep(out, [
        # crafted pass carrying the real-chain score: the record verify_top must pick
        _design(0, presets["fixedwing"], "pass", scored["metrics"], scored["reasons"]),
        # a lower-ranked pass; tier1 refuses at build, so verifying it would raise
        _design(1, presets["tier1"], "pass", {**scored["metrics"], "usable": usable - 0.5}),
        # a higher usable that is not a pass is never verified
        _design(2, presets["tier1"], "fail", {**scored["metrics"], "usable": usable + 5.0}),
    ])
    returned = sweep_real.verify_top(str(out), 1)
    written = _appended(out, before)
    assert len(returned) == 1 and len(written) == 1
    record = written[0]
    assert record == json.loads(sweep_real._canon(returned[0]))
    assert (record["type"], record["index"]) == ("verify", 0)
    verdict = record["verdict"]
    assert verdict["tree_fingerprint"] == validate_screen.tree_fingerprint()
    # the fresh subprocess ran the REAL chain: it reproduces the in-process real-chain score
    assert verdict["closed"] is False and verdict["admissible"] is False
    assert verdict["min_soc"] == scored["metrics"]["minSoc"]
    codes = verdict["closed_reason_codes"]
    assert [c["code"] for c in codes] == ["soc_not_persistent"]
    assert codes == [r for r in scored["reasons"] if r["code"] != "screen_rule"]
    assert all(validity.is_reason(c) for c in codes + verdict["screen_reason_codes"])
    # the record's own metrics say not closed, not admissible: the real chain agrees
    assert record["agrees"] is True
    assert sweep_real.report(str(out))["verified"] == [record]


def test_verify_top_flags_a_pass_the_real_chain_does_not_reproduce(fixedwing_real,
                                                                   tmp_path) -> None:
    presets, scored = fixedwing_real
    claim = {**scored["metrics"], "closed": True, "admissible": True}   # the ideal chain's verdict
    out = tmp_path / "claim.jsonl"
    before = _write_sweep(out, [_design(0, presets["fixedwing"], "pass", claim)])
    returned = sweep_real.verify_top(str(out), 1)
    written = _appended(out, before)
    assert len(returned) == 1 and written == [json.loads(sweep_real._canon(returned[0]))]
    record = written[0]
    assert record["verdict"]["closed"] is False
    assert record["verdict"]["min_soc"] == scored["metrics"]["minSoc"]
    assert record["agrees"] is False
    assert sweep_real.report(str(out))["verified"] == [record]
