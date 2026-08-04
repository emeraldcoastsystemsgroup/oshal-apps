"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Acceptance + regression tests
    for the harness module (SPEC_electrical section 3): the AWG16 round-trip
    I2R anchor (13.9 A over 1 m one-way = 5.09 W +-1 %), the both-ways cold-
    copper honesty (-30 % at -56 degC), XT60 contact adders, the billed
    copper + insulation mass tied to the ASTM table via the CRC resistivity,
    quadratic light-load vanishing, and the fail-closed walls (uncatalogued
    gauges, out-of-band temperatures and bus voltages, non-segment entries).

Runs under pytest AND standalone:
    .venv/Scripts/python.exe tests/test_harness.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# FOOTPRINT rule: this process runs at BelowNormal priority.
if sys.platform == "win32":  # pragma: no branch
    try:
        import ctypes

        ctypes.windll.kernel32.SetPriorityClass(
            ctypes.windll.kernel32.GetCurrentProcess(), 0x4000
        )
    except Exception:
        pass

from aerosim.electrical import (
    AWG_RESISTANCE_20C_OHM_PER_M,
    HarnessSegment,
    INSULATION_MASS_FACTOR,
    RHO_CU_KG_M3,
    XT60_CONTACT_RESISTANCE_OHM,
    awg_conductor_area_m2,
    awg_resistance_ohm_per_m,
    harness_copper_mass_kg,
    segment_loss_W,
)
from aerosim.vehicle import ParamBoundsError


def test_awg16_round_trip_anchor():
    """300 W on the 21.6 V bus (13.9 A) over 1 m one-way of AWG16:
    13.9^2 x 2 x 0.01317 = 5.09 W +-1 % (SPEC acceptance)."""
    seg = HarnessSegment("pack->esc", awg=16, length_oneway_m=1.0,
                         n_connector_pairs=0)
    loss_W = segment_loss_W(seg, 300.0, 21.6)
    assert abs(loss_W - 5.09) / 5.09 < 0.01, loss_W


def test_cold_copper_both_ways_honesty():
    """At the ISA tropopause (-56.5 degC) copper resistance drops ~30 % --
    the harness IMPROVES at altitude (the battery worsens; neither without
    the other). At +75 degC it rises ~22 % -- the other way is honest too."""
    r_20c = awg_resistance_ohm_per_m(16)
    drop = 1.0 - awg_resistance_ohm_per_m(16, 216.65) / r_20c
    assert 0.28 < drop < 0.32, drop
    rise = awg_resistance_ohm_per_m(16, 348.15) / r_20c - 1.0
    assert 0.20 < rise < 0.24, rise
    # And the loss follows the resistance: same segment, cold air, less loss.
    seg = HarnessSegment("pack->esc", awg=16, length_oneway_m=1.0,
                         n_connector_pairs=0)
    assert segment_loss_W(seg, 300.0, 21.6, t_wire_K=216.65) < \
        segment_loss_W(seg, 300.0, 21.6)


def test_xt60_contact_pairs_add_resistance():
    """Each mated XT60 pair adds 0.55 mohm; a connectorized segment (+ and -)
    adds 1.1 mohm = 0.21 W at 13.9 A. Small but real (SPEC 3.3)."""
    bare = HarnessSegment("s", awg=16, length_oneway_m=1.0,
                          n_connector_pairs=0)
    conn = HarnessSegment("s", awg=16, length_oneway_m=1.0,
                          n_connector_pairs=2)
    i_A = 300.0 / 21.6
    extra_W = segment_loss_W(conn, 300.0, 21.6) - segment_loss_W(bare, 300.0, 21.6)
    assert abs(extra_W - i_A**2 * 2.0 * XT60_CONTACT_RESISTANCE_OHM) < 1.0e-12
    assert 0.20 < extra_W < 0.22


def test_light_load_loss_vanishes_quadratically():
    """Loss is recomputed from the ACTUAL current: quartering the power cuts
    the loss 16x, and zero power is exactly zero loss (night avionics)."""
    seg = HarnessSegment("s", awg=16, length_oneway_m=1.0,
                         n_connector_pairs=0)
    full_W = segment_loss_W(seg, 300.0, 21.6)
    quarter_W = segment_loss_W(seg, 75.0, 21.6)
    assert abs(full_W / quarter_W - 16.0) < 1.0e-9
    assert segment_loss_W(seg, 0.0, 21.6) == 0.0


def test_copper_mass_billing():
    """AWG16 cross-section recovered from ASTM B258 + CRC resistivity is the
    standard 1.31 mm^2; 1 m one-way bills 2 m of conductor at 8960 kg/m^3
    plus the flagged +40 % insulation (ledger H-3)."""
    area_m2 = awg_conductor_area_m2(16)
    assert abs(1.0e6 * area_m2 - 1.31) < 0.01
    seg = HarnessSegment("s", awg=16, length_oneway_m=1.0,
                         n_connector_pairs=0)
    mass_kg = harness_copper_mass_kg([seg])
    hand_kg = RHO_CU_KG_M3 * area_m2 * 2.0 * 1.0 * INSULATION_MASS_FACTOR
    assert abs(mass_kg - hand_kg) < 1.0e-12
    # Two segments bill the sum.
    assert abs(harness_copper_mass_kg([seg, seg]) - 2.0 * mass_kg) < 1.0e-12


def test_awg_table_is_the_astm_set():
    """Exactly the six catalogued gauges; every row positive and ordered
    (thinner wire = more ohms) -- a walked table row fails loudly."""
    assert sorted(AWG_RESISTANCE_20C_OHM_PER_M) == [12, 14, 16, 18, 20, 22]
    rows = [AWG_RESISTANCE_20C_OHM_PER_M[k] for k in (12, 14, 16, 18, 20, 22)]
    assert all(r > 0 for r in rows)
    assert rows == sorted(rows)


def test_fail_closed_walls():
    """Uncatalogued gauge, out-of-band temperature/bus/power, zero-length
    runs, non-integer connector counts and non-segment mass entries all
    refuse -- nothing interpolates or defaults."""
    for bad_awg in (10, 17, 24, "16", 16.0, True):
        try:
            awg_resistance_ohm_per_m(bad_awg)
            raise AssertionError(f"awg={bad_awg!r} accepted")
        except ParamBoundsError:
            pass
    try:
        awg_resistance_ohm_per_m(16, 100.0)
        raise AssertionError("100 K wire accepted")
    except ParamBoundsError:
        pass
    seg = HarnessSegment("s", awg=16, length_oneway_m=1.0,
                         n_connector_pairs=0)
    for p_W, v_V in ((-1.0, 21.6), (300.0, 5.0), (300.0, 60.0),
                     (float("nan"), 21.6)):
        try:
            segment_loss_W(seg, p_W, v_V)
            raise AssertionError(f"({p_W}, {v_V}) accepted")
        except ParamBoundsError:
            pass
    for kwargs in (dict(awg=13, length_oneway_m=1.0, n_connector_pairs=0),
                   dict(awg=16, length_oneway_m=0.0, n_connector_pairs=0),
                   dict(awg=16, length_oneway_m=-2.0, n_connector_pairs=0),
                   dict(awg=16, length_oneway_m=1.0, n_connector_pairs=-1),
                   dict(awg=16, length_oneway_m=1.0, n_connector_pairs=1.5)):
        try:
            HarnessSegment("s", **kwargs)
            raise AssertionError(f"{kwargs} constructed")
        except ParamBoundsError:
            pass
    try:
        harness_copper_mass_kg([("s", 16, 1.0, 0)])
        raise AssertionError("bare tuple billed as a segment")
    except ParamBoundsError:
        pass


if __name__ == "__main__":  # pragma: no cover
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001 - standalone reporter
                fails += 1
                print(f"FAIL {name}: {exc}")
    print("OVERALL", "PASS" if fails == 0 else f"FAIL ({fails})")
    raise SystemExit(0 if fails == 0 else 1)
