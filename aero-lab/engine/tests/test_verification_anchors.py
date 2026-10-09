"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | The four verification anchors the dated
  |                                           | FLOATER_REPORT (B4) listed as "never
  |                                           | evaluated", as ONE named gate: cold usable
  |                                           | capacity and R_int ratio (Zhang/Xu/Jow
  |                                           | 2003), C60 STC worst-bin MPP (datasheet
  |                                           | bin table), helium permeation through
  |                                           | 38 um LLDPE (Lee/Kim/Jung 2023 chain), and
  |                                           | mission ledger reconciliation -- flown on
  |                                           | the REAL chain here, where it was only
  |                                           | ever checked on the ideal fixture.

Each anchor asserts a published band or an energy identity, never a number
re-derived from the model under test. The three component anchors run in
milliseconds; the ledger anchor flies DESIGN_A's real chain for three hours
of accepted 60 s steps (about 45 s here).
"""

from __future__ import annotations

import pytest

from aerosim.electrical import (
    C60_BIN_TABLE,
    G_REF_WM2,
    T_REF_K,
    extract_c60_params,
    string_mpp,
)
from aerosim.mission import LEDGER_KEYS, MissionProfile, fly_mission
from aerosim.validate_designs import DESIGN_A, build_solar_cruise
from aerosim.vehicle import BuoyancyVolume
from aerosim.vehicle.electrochem import r_int_ohm, usable_capacity_frac

#: The named anchors, in FLOATER_REPORT B4 order.
ANCHORS = (
    "cold_usable_and_r_int",
    "c60_stc_worst_bin_mpp",
    "he_permeation_38um_lldpe",
    "mission_ledger_reconciliation_real_chain",
)


@pytest.fixture(scope="module", autouse=True)
def _no_operator_memory_wait():
    """The mission runner's production free-RAM wait is a host throttle, not physics."""
    from aerosim.mission import runner
    original = runner._footprint_guard
    runner._footprint_guard = lambda: None
    try:
        yield
    finally:
        runner._footprint_guard = original


def test_anchor_cold_usable_and_r_int() -> None:
    """Zhang/Xu/Jow 2003 at 0.2C: -20 C usable in [65, 90] %, -40 C <= 35 %,
    and R_int(-30 C)/R_int(25 C) in the measured [8, 13] band."""
    assert 0.65 <= usable_capacity_frac("nca_21700", 253.15) <= 0.90
    assert usable_capacity_frac("nca_21700", 233.15) <= 0.35
    ratio = (r_int_ohm("nca_21700", 0.5, 243.15, 4.85)
             / r_int_ohm("nca_21700", 0.5, 298.15, 4.85))
    assert 8.0 <= ratio <= 13.0, ratio


def test_anchor_c60_stc_worst_bin_mpp() -> None:
    """The WORST C60 bin (lowest datasheet Pmpp) reproduces its own MPP at
    STC: within 1 % of binned Pmpp and 1e-6 of Vmp*Imp."""
    worst = min(C60_BIN_TABLE, key=lambda b: C60_BIN_TABLE[b].pmpp_W)
    spec = C60_BIN_TABLE[worst]
    mpp = string_mpp(extract_c60_params(worst, 1.0), 1, G_REF_WM2, T_REF_K)
    assert abs(mpp.p_W - spec.pmpp_W) / spec.pmpp_W < 0.01, (worst, mpp.p_W)
    assert abs(mpp.p_W - spec.vmp_V * spec.imp_A) / (spec.vmp_V * spec.imp_A) < 1.0e-6


def test_anchor_he_permeation_38um_lldpe() -> None:
    """Helium loss through the default 38 um LLDPE cell (the Floater's 1.37 m3)
    lands on the two-independent-unit-chain anchors within +-10 %."""
    cell = BuoyancyVolume(volume_m3=1.37)
    assert cell.envelope_film == "lldpe_38um"
    for t_K, anchor in ((298.15, 0.034), (278.15, 0.014), (217.15, 0.0004)):
        assert cell.helium_loss_frac_per_day(t_K) == pytest.approx(anchor, rel=0.10), t_K


@pytest.fixture(scope="module")
def real_mission():
    """Three hours of DESIGN_A on the REAL chain from its sunset start, calm air."""
    build = build_solar_cruise(DESIGN_A, chain="real")
    profile = MissionProfile(
        start_utc_h=float(build.env.utc_hour_at_t0_h), duration_s=10800.0,
        altitude_m=500.0, lat_deg=47.6, day_of_year=195,
        wind_mean_ms=0.0, shear=False, dryden_sigma_ms=0.0)
    return fly_mission(build.vehicle, profile, dt_s=60.0)


def test_anchor_mission_ledger_reconciliation_real_chain(real_mission) -> None:
    """useful + prop + motor + esc + harness == drive electrical energy within
    1 %, nothing unattributed, on the accepted real-ECM trajectory."""
    mr = real_mission
    assert mr.sim.detail["storage_authority"] == "BatteryElement.step->PackEcm.step_power"
    assert mr.sim.certified
    assert set(mr.ledger) == set(LEDGER_KEYS)
    prop_elec = mr.extras["prop_elec_Wh"]
    assert prop_elec > 0.0
    chain = (mr.extras["useful_thrust_Wh"] + mr.ledger["prop"] + mr.ledger["motor"]
             + mr.ledger["esc"] + mr.ledger["harness"])
    assert chain == pytest.approx(prop_elec, rel=0.01)
    assert mr.extras["unattributed_prop_Wh"] <= 0.01 * prop_elec
    assert mr.ledger["payload"] == pytest.approx(DESIGN_A.payload_W * 3.0, rel=1e-3)


def test_the_gate_names_exactly_the_four_anchors() -> None:
    names = sorted(n[len("test_anchor_"):] for n in globals() if n.startswith("test_anchor_"))
    assert names == sorted(ANCHORS)
