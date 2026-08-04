"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 regression guards for the
  |                                           | SWEEP INTEGRITY CONTRACT, written
  |                                           | against the measured operational
  |                                           | fatal: the on-disk mutate->restore
  |                                           | harness edited the LIVE tree while a
  |                                           | search was running (structure.py
  |                                           | momentarily read 'return 0.0 *'),
  |                                           | 27/145 of the search's records were
  |                                           | scored against mutant code and 3
  |                                           | fantasy survivors were recorded with
  |                                           | reasons=[]. Guards: the fingerprint
  |                                           | is stable + content-sensitive and is
  |                                           | stamped into every screen verdict;
  |                                           | the rewritten copy-tree harness runs
  |                                           | a gate mutation WHILE a background
  |                                           | evaluation loops, and the loop's
  |                                           | fingerprints/verdicts never change;
  |                                           | verify_survivor refuses a stale
  |                                           | fingerprint and reproduces a genuine
  |                                           | survivor in a fresh subprocess.

tests.test_sweep_integrity -- a verdict scored against a mutant tree is not a
result. Run with:  python -m pytest tests/test_sweep_integrity.py -q
"""

from __future__ import annotations

import sys
import threading
from pathlib import Path

import pytest

from aerosim.integrate import integrate_energy
from aerosim.validate_designs import (
    DAY_S,
    DESIGN_A,
    SLOW_DT_S,
    build_solar_cruise,
)
from aerosim.validate_screen import (
    SweepIntegrityError,
    screen_design,
    tree_fingerprint,
    verify_survivor,
)

#: Project root (the directory AUDIT_mutations.py lives in).
_ROOT = Path(__file__).resolve().parents[1]


def _harness():
    """Import the copy-tree mutation harness from the project root."""
    sys.path.insert(0, str(_ROOT))
    try:
        import AUDIT_mutations
    finally:
        sys.path.pop(0)
    return AUDIT_mutations


@pytest.fixture(scope="module")
def case_a():
    """Shipped case A, integrated once: (build, result)."""
    build = build_solar_cruise(DESIGN_A)
    result = integrate_energy(build.vehicle, build.env, 0.0, DAY_S, SLOW_DT_S)
    return build, result


def test_canonical_window_constants_match_the_designs_module() -> None:
    """validate_screen re-integrates with its own window constants (to avoid a
    layering cycle); they must equal the canonical ones or the equinox run is
    a different experiment."""
    from aerosim.validate_screen import _SEASONAL_DT_S, _SEASONAL_WINDOW_S

    assert _SEASONAL_WINDOW_S == DAY_S
    assert _SEASONAL_DT_S == SLOW_DT_S


def test_fingerprint_is_stable_and_content_sensitive(tmp_path) -> None:
    """Same tree -> same hash; a faithful copy hashes identically; one edited
    byte in the copy changes it. (Sensitivity is proven on the COPY -- the
    live tree is never written, that being the whole point.)"""
    harness = _harness()
    fp_live = tree_fingerprint()
    assert fp_live == tree_fingerprint(), "fingerprint not deterministic"
    copy_root = harness.make_tree_copy(tmp_path)
    fp_copy = tree_fingerprint(copy_root / "aerosim")
    assert fp_copy == fp_live, "a faithful copy must fingerprint identically"
    target = copy_root / "aerosim" / "vehicle" / "structure.py"
    target.write_text(
        target.read_text(encoding="utf-8").replace(
            "FUSELAGE_FLOOR_FIT_FACTOR * (", "0.0 * (", 1),
        encoding="utf-8")
    assert tree_fingerprint(copy_root / "aerosim") != fp_live, (
        "an edited evaluation module must change the fingerprint")


def test_screen_verdict_is_stamped_with_the_fingerprint(case_a) -> None:
    """Every screen verdict carries the tree it was scored against."""
    build, result = case_a
    screen_design(build, result, check_seasonal=False)
    fp = tree_fingerprint()
    assert build.meta["tree_fingerprint"] == fp
    assert result.detail["tree_fingerprint"] == fp


def test_gate_mutation_cannot_corrupt_a_concurrent_evaluation(case_a) -> None:
    """THE ROUND-5 FATAL, re-run safely: a gate mutation executes (in the
    copy-tree harness) WHILE a background loop keeps evaluating against the
    live tree. Every loop iteration's fingerprint must equal the pre-run
    fingerprint and every verdict must match a clean re-run -- with the old
    in-place harness this measured 27/145 corrupted records."""
    harness = _harness()
    build, result = case_a
    fp_before = tree_fingerprint()

    records: list[tuple[str, bool, tuple[str, ...]]] = []
    stop = threading.Event()

    def evaluate_loop() -> None:
        while not stop.is_set():
            fp = tree_fingerprint()
            admissible, reasons = screen_design(build, result,
                                                check_seasonal=False)
            records.append((fp, admissible, tuple(reasons)))

    thread = threading.Thread(target=evaluate_loop, daemon=True)
    thread.start()
    try:
        # A real gate mutation (screen #10's wall removed), a cheap guard: in
        # the MUTANT copy the fuselage floor is 0.0, so the guard exits red.
        mut = dict(
            name="M6-lite fuselage floor -> 0.0 (concurrency regression)",
            path="aerosim/vehicle/structure.py",
            old="    return FUSELAGE_FLOOR_FIT_FACTOR * (",
            new="    return 0.0 * (",
            guards=[["-c",
                     "from aerosim.vehicle.structure import "
                     "min_fuselage_boom_tail_mass_kg as f; import sys; "
                     "sys.exit(1 if f(3.149, 5.65) < 0.01 else 0)"]],
        )
        outcome = harness.run_mutant(mut, quiet=True)
    finally:
        stop.set()
        thread.join(timeout=60.0)

    assert outcome["patched"], "harness failed to patch its tree COPY"
    assert outcome["died"], (
        "the mutant survived its guard INSIDE the copy -- the copy was not "
        "actually mutated")
    assert tree_fingerprint() == fp_before, "the LIVE tree changed"
    assert records, "the background evaluation never ran"
    assert all(fp == fp_before for fp, _, _ in records), (
        "a concurrent evaluation saw a mutated tree")
    clean_admissible, clean_reasons = screen_design(build, result,
                                                    check_seasonal=False)
    assert all(
        (admissible, reasons) == (clean_admissible, tuple(clean_reasons))
        for _, admissible, reasons in records
    ), "a concurrent evaluation's verdict diverged from the clean re-run"


def test_verify_survivor_refuses_a_stale_fingerprint() -> None:
    """A survivor scored under a different tree must refuse BEFORE any
    re-evaluation is attempted."""
    with pytest.raises(SweepIntegrityError, match="changed since scoring"):
        verify_survivor(DESIGN_A, expected_fingerprint="0" * 64)


def test_verify_survivor_reproduces_case_a_in_a_fresh_subprocess() -> None:
    """The happy path is load-bearing too: case A re-evaluated from scratch in
    a fresh subprocess against the current tree must come back admissible,
    closed, and stamped with the same fingerprint."""
    verdict = verify_survivor(DESIGN_A, expected_fingerprint=tree_fingerprint(),
                              check_seasonal=False)
    assert verdict["tree_fingerprint"] == tree_fingerprint()
    assert verdict["closed"] is True
    assert verdict["admissible"] is True
    assert verdict["min_soc"] == pytest.approx(0.3538, abs=2e-4)
