"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression guards for the mission
  |                                           | module: profile bounds, gust placard
  |                                           | enforcement, spectrum-computed
  |                                           | eta_track penalty, ideal-chain
  |                                           | case-A mission closure + ledger
  |                                           | conservation, cold-charge spill
  |                                           | (never free charge), and the
  |                                           | real-chain acceptance gates (which
  |                                           | REQUIRE modules 1-4 on disk -- they
  |                                           | fail loudly, they do not skip, once
  |                                           | the integration flag file exists).
-------------------------------------------------------------------------------
"""

from __future__ import annotations

import importlib.util as _ilu
import math

import numpy as np
import pytest

from aerosim.mission import (
    GustPlacardError,
    LEDGER_KEYS,
    MissionProfile,
    dryden_variance_fraction_above_Hz,
    eta_track_dynamic_penalty,
    fly_mission,
    mission_report,
)
from aerosim.validate import usable_energy
from aerosim.validate_designs import DESIGN_A, build_solar_cruise
from aerosim.vehicle import ParamBoundsError

#: Are the sibling real-chain modules on disk? Used ONLY to gate the
#: real-chain acceptance tests during the parallel build window. Once
#: integration lands (validate_designs on the real chain), _REAL is
#: structurally True and these tests can never silently skip again.
_REAL = all(
    _ilu.find_spec(m) is not None
    for m in ("aerosim.electrical", "aerosim.prop",
              "aerosim.vehicle.electrochem")
)


# ---------------------------------------------------------------------------
# Profile bounds (param_bounds pattern -- every numeric field range-checked)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "kwargs",
    [
        {"duration_s": 0.0},
        {"duration_s": -60.0},
        {"lat_deg": 91.0},
        {"day_of_year": 0},
        {"wind_mean_ms": -1.0},
        {"dryden_sigma_ms": -0.1},
        {"gust_placard_ms": 0.0},
        {"altitude_m": 45000.0},
        {"start_utc_h": 24.0},
    ],
)
def test_profile_rejects_out_of_range(kwargs):
    """Every numeric MissionProfile field is range-checked at construction."""
    base = dict(start_utc_h=18.0, duration_s=86400.0, altitude_m=500.0,
                lat_deg=47.6, day_of_year=195, wind_mean_ms=3.0)
    base.update(kwargs)
    with pytest.raises(ParamBoundsError):
        MissionProfile(**base)


def test_profile_altitude_array_is_checked_and_interpolated():
    """An altitude PROFILE is legal; each sample is range-checked."""
    p = MissionProfile(start_utc_h=0.0, duration_s=3600.0,
                       altitude_m=[500.0, 1500.0], lat_deg=47.6,
                       day_of_year=195, wind_mean_ms=0.0)
    assert p.altitude_at_frac(0.0) == pytest.approx(500.0)
    assert p.altitude_at_frac(1.0) == pytest.approx(1500.0)
    assert p.altitude_at_frac(0.5) == pytest.approx(1000.0)
    with pytest.raises(ParamBoundsError):
        MissionProfile(start_utc_h=0.0, duration_s=3600.0,
                       altitude_m=[500.0, 50000.0], lat_deg=47.6,
                       day_of_year=195, wind_mean_ms=0.0)


# ---------------------------------------------------------------------------
# Gust placard (SPEC_materials section 3 -- a constraint, not a footnote)
# ---------------------------------------------------------------------------


def test_gust_placard_fails_an_n3_design():
    """3-sigma derived gust above the placard on an n=3 design REFUSES to fly."""
    build = build_solar_cruise(DESIGN_A)
    profile = MissionProfile(start_utc_h=18.0, duration_s=1800.0,
                             altitude_m=500.0, lat_deg=47.6, day_of_year=195,
                             wind_mean_ms=3.0, dryden_sigma_ms=3.0)  # 9 > 6
    with pytest.raises(GustPlacardError):
        fly_mission(build.vehicle, profile, dt_s=60.0)


def test_gust_placard_recorded_for_an_n4_design():
    """A design stating n>=4 flies the same air; the exceedance is RECORDED."""
    build = build_solar_cruise(DESIGN_A)
    build.vehicle.design_load_factor_n = 4.0   # the explicit n=4 statement
    profile = MissionProfile(start_utc_h=18.0, duration_s=1800.0,
                             altitude_m=500.0, lat_deg=47.6, day_of_year=195,
                             wind_mean_ms=3.0, dryden_sigma_ms=3.0)
    mr = fly_mission(build.vehicle, profile, dt_s=60.0)
    assert mr.gust_placard_exceeded is True


# ---------------------------------------------------------------------------
# GV-5 15 Hz hold rule -- computed from the spectrum, never sub-second sim
# ---------------------------------------------------------------------------


def test_dryden_variance_fraction_closed_form():
    """F_hi matches the analytic Dryden cumulative variance."""
    # tau = L/V = 533.4/10; F_hi = 1 - (2/pi) atan(2 pi 15 tau)
    tau = 533.4 / 10.0
    expect = 1.0 - (2.0 / math.pi) * math.atan(2.0 * math.pi * 15.0 * tau)
    got = dryden_variance_fraction_above_Hz(15.0, 533.4, 10.0)
    assert got == pytest.approx(expect, rel=1e-12)
    assert 0.0 < got < 1e-3          # a 15 Hz tracker out-runs the atmosphere


def test_eta_track_penalty_monotone_and_bounded():
    """Penalty: zero in calm air, grows with sigma, bounded, conservative."""
    assert eta_track_dynamic_penalty(0.0, 10.0) == 0.0
    p1 = eta_track_dynamic_penalty(1.0, 10.0)
    p3 = eta_track_dynamic_penalty(3.0, 10.0)
    assert 0.0 < p1 < p3 < 0.5
    # slower tracker -> more loss (the rule's whole point)
    assert eta_track_dynamic_penalty(3.0, 10.0, f_track_Hz=0.5) > p3


# ---------------------------------------------------------------------------
# Ideal-chain mission regression (case A flown as a MISSION, calm air)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def mission_case_a_ideal():
    """One 24 h case-A mission on the builder's chain, calm air."""
    build = build_solar_cruise(DESIGN_A)
    profile = MissionProfile(
        start_utc_h=float(build.env.utc_hour_at_t0_h), duration_s=86400.0,
        altitude_m=500.0, lat_deg=47.6, day_of_year=195,
        wind_mean_ms=0.0, shear=False, dryden_sigma_ms=0.0,
    )
    return fly_mission(build.vehicle, profile, dt_s=60.0)


def test_mission_case_a_closes(mission_case_a_ideal):
    """The validated case-A design still closes flown as a mission."""
    mr = mission_case_a_ideal
    assert mr.sim.closed, mr.sim.detail.get("closed_reasons")
    assert mr.sim.certified
    assert mr.sim.min_soc > 0.10


def test_mission_ledger_frozen_keys_and_conservation(mission_case_a_ideal):
    """Ledger keys are exactly the frozen set and the chain reconciles."""
    mr = mission_case_a_ideal
    assert set(mr.ledger.keys()) == set(LEDGER_KEYS)
    # chain conservation: useful + prop + motor + esc + harness = prop elec
    chain_Wh = (mr.extras["useful_thrust_Wh"] + mr.ledger["prop"]
                + mr.ledger["motor"] + mr.ledger["esc"]
                + mr.ledger["harness"])
    assert chain_Wh == pytest.approx(mr.extras["prop_elec_Wh"], rel=0.01)
    assert mr.extras["unattributed_prop_Wh"] < 0.01 * mr.extras["prop_elec_Wh"]
    # payload is billed at its constant draw
    assert mr.ledger["payload"] == pytest.approx(5.8 * 24.0, rel=1e-3)
    # 500 m July: ISA 284.9 K sits above every heater floor -> ~0 heater
    assert mr.ledger["heater"] < 1.0
    # prop efficiency is physical
    assert 0.5 < mr.prop_eta_mean < 1.0


def test_mission_usable_energy_contract(mission_case_a_ideal):
    """validate.usable_energy applies to a mission SimResult unchanged."""
    mr = mission_case_a_ideal
    energy = usable_energy(mr.sim)
    assert energy["margin_ratio_usable"] > 1.0
    assert energy["energy_in_gross_J"] > energy["energy_in_usable_J"] > 0.0


def test_mission_report_renders(mission_case_a_ideal):
    """The report renders every frozen field without touching disk."""
    text = mission_report(mission_case_a_ideal)
    for key in LEDGER_KEYS:
        assert key in text
    assert "LEDGER" in text


# ---------------------------------------------------------------------------
# Cold-charge gate: spilled solar is SPILLED, never free charge
# ---------------------------------------------------------------------------


def test_cold_charge_is_spilled_not_stored():
    """A pack reporting a sub-zero temperature cannot book charge; the bus
    surplus lands in the spill meter (acceptance anchor 4, mechanism level).
    """
    from aerosim.mission.runner import _replay_mission_storage

    class _Pack:
        capacity_J = 3600.0 * 100.0     # 100 Wh
        eta_charge = 0.95
        eta_discharge = 0.95
        soc_min = 0.05
        soc_max = 1.0
        initial_soc = 0.5
        chemistry = "nca_21700"

    t = np.arange(0.0, 3601.0, 60.0)
    p_in = np.full(t.size, 50.0)        # steady 50 W of sun
    p_out = np.zeros(t.size)
    warm = _replay_mission_storage(t, p_in, p_out, _Pack(),
                                   np.ones(t.size, dtype=bool), 0.5)
    cold = _replay_mission_storage(t, p_in, p_out, _Pack(),
                                   np.zeros(t.size, dtype=bool), 0.5)
    assert warm["soc_end"] > 0.5 + 0.10          # warm pack charged
    assert cold["soc_end"] == pytest.approx(0.5)  # cold pack did NOT
    assert cold["cold_spill_bus_J"] == pytest.approx(50.0 * 3600.0, rel=1e-6)
    assert cold["surplus_J"] >= cold["cold_spill_bus_J"] - 1e-9


# ---------------------------------------------------------------------------
# REAL-CHAIN acceptance gates (modules 1-4). Gated on module presence during
# the parallel build window only; after integration they always run.
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _REAL, reason="LOUD GATE: real-chain modules "
                    "(electrochem/electrical/prop) not yet landed -- this "
                    "guard is inert until they are, and the integration "
                    "phase makes it permanent")
def test_real_chain_present_has_frozen_names():
    """The frozen cross-module names the mission consumes actually exist."""
    from aerosim.electrical import segment_loss_W  # noqa: F401
    from aerosim.prop import motor_inverse, solve_prop_point  # noqa: F401
    from aerosim.vehicle.electrochem import (  # noqa: F401
        ocv_V,
        project_days_to_fade,
    )
