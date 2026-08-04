"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression guards for
  |                                           | validate_screen.screen_design, the
  |                                           | per-design admissibility contract the
  |                                           | 30,000-design sweep calls. Each screen
  |                                           | is proven to FIRE on the exploit shape
  |                                           | it was written against (mutation-tested,
  |                                           | not just asserted on the happy path):
  |                                           | floor-riding SOC, undeclared mass,
  |                                           | post-construction parameter mutation,
  |                                           | over-claimed harvest, and the shipped
  |                                           | cases being admitted.
2 | maintainer@emeraldcoastsystemsgroup.com   | Floor-riding probe retuned 36.0 ->
  |                                           | 35.4 kg pack: the round-4 Re-bin
  |                                           | continuity fix (log-Re blend replacing
  |                                           | the nearest-bin CD staircase) lowered
  |                                           | this design's drag ~0.4% and floated
  |                                           | the old probe to min_soc 0.0768, out
  |                                           | of the floor-riding band under test.
3 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5: MUST-STAY-RED coverage for
  |                                           | screens #10/#11/#12 + the k_eff
  |                                           | altitude scaler. Measured before this
  |                                           | existed: deleting the fuselage floor
  |                                           | left the gate + all 24 unit specs
  |                                           | GREEN while that floor was the SOLE
  |                                           | stop for 6 closed+certified fantasy
  |                                           | designs. Each new test asserts the
  |                                           | SPECIFIC reason string its screen
  |                                           | emits, so deleting that screen turns
  |                                           | the test red (verified by deleting
  |                                           | each screen in a scratch copy). Also:
  |                                           | payload floor raised 0 W -> real
  |                                           | avionics wattage (round-5 F2), the
  |                                           | 1 mW hostile-survivor build pinned
  |                                           | red, and the solstice-only seasonal
  |                                           | FLAG pinned as flag-not-reject.

tests.test_screen_design -- the sweep contract must reject what the gate rejects.

Run with:  python -m pytest tests/test_screen_design.py -q

The expensive fixtures (24 h integrations of the real case designs) are built
ONCE per module and reused; every mutation is applied to a copy or is reverted,
so test order cannot matter.
"""

from __future__ import annotations

import copy
import dataclasses
import warnings

import numpy as np
import pytest

from aerosim.integrate import integrate_energy
from aerosim.validate import screen_design, SOC_FLOOR_STANDOFF
from aerosim.validate_designs import (
    DAY_S,
    DESIGN_A,
    DESIGN_B,
    SLOW_DT_S,
    build_solar_cruise,
)
from aerosim.vehicle import ElementForce, UndeclaredMassWarning


@pytest.fixture(scope="module")
def case_a():
    """Shipped case A, integrated once: (build, result)."""
    build = build_solar_cruise(DESIGN_A)
    result = integrate_energy(build.vehicle, build.env, 0.0, DAY_S, SLOW_DT_S)
    return build, result


@pytest.fixture(scope="module")
def case_b():
    """Shipped case B, integrated once: (build, result)."""
    build = build_solar_cruise(DESIGN_B)
    result = integrate_energy(build.vehicle, build.env, 0.0, DAY_S, SLOW_DT_S)
    return build, result


def test_shipped_cases_are_admitted(case_a, case_b) -> None:
    """The suite's own closing aircraft must pass the sweep contract -- if the
    gate and the screen ever disagree, one of them has drifted."""
    for build, result in (case_a, case_b):
        admissible, reasons = screen_design(build, result)
        assert admissible, f"shipped case rejected by its own sweep contract: {reasons}"


def test_floor_riding_design_is_rejected() -> None:
    """Round 2's exploit winners all sat exactly ON the SOC floor. A design that
    closes with min_soc inside SOC_FLOOR_STANDOFF of soc_min must be rejected
    even though closed=True."""
    # 35.4 kg retuned from 36.0 kg after the round-4 Re-bin continuity fix: the
    # nearest-bin CD staircase became a log-Re blend, drag fell ~0.4% on this
    # design, and the 36 kg probe floated up to min_soc 0.0768 -- outside the
    # floor-riding band this test exists to exercise (measured 2026-08-02:
    # 35.4 kg -> min_soc 0.0611, closed=True).
    design = dataclasses.replace(DESIGN_B, battery_mass_kg=35.4)
    build = build_solar_cruise(design)
    result = integrate_energy(build.vehicle, build.env, 0.0, DAY_S, SLOW_DT_S)
    assert result.closed, (
        "fixture drift: the 35.4 kg-pack probe no longer closes, so this test has "
        f"stopped exercising the floor-riding shape (min_soc {result.min_soc:.4f})"
    )
    assert result.min_soc < 0.05 + SOC_FLOOR_STANDOFF, (
        "fixture drift: the probe no longer rides the floor"
    )
    admissible, reasons = screen_design(build, result)
    assert not admissible
    assert any("SOC standoff" in r for r in reasons), reasons


def test_undeclared_mass_is_rejected(case_a) -> None:
    """An element that declares neither mass nor masslessness is unbilled cost;
    the screen must say so. Applied to a COPY of the case-A vehicle."""

    class _Undeclared:
        body_index = 0
        offset_m = np.zeros(3)

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):  # noqa: ANN001
            return ElementForce(np.zeros(3), np.zeros(3), 0.0)

    build, result = case_a
    mutated = copy.copy(build)
    mutated.vehicle = copy.deepcopy(build.vehicle)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UndeclaredMassWarning)
        mutated.vehicle.elements.append(_Undeclared())
    admissible, reasons = screen_design(mutated, result)
    assert not admissible
    assert any("mass declaration" in r for r in reasons), reasons


def test_post_construction_parameter_mutation_is_rejected(case_a) -> None:
    """Defense in depth: reassigning a live element's attribute past its declared
    bound (which __init__ can no longer be asked about) must be caught by the
    screen's recheck_element_params pass."""
    build, result = case_a
    mutated = copy.copy(build)
    mutated.vehicle = copy.deepcopy(build.vehicle)
    pack = next(e for e in mutated.vehicle.elements if hasattr(e, "eta_charge"))
    pack.eta_charge = 2.0  # bypasses __init__ entirely
    admissible, reasons = screen_design(mutated, result)
    assert not admissible
    assert any("param bounds" in r and "eta_charge" in r for r in reasons), reasons


def test_overclaimed_harvest_is_rejected(case_a) -> None:
    """A result whose recorded harvest exceeds SCREEN_K_EFF_MAX of the
    astronomical ceiling on the design's own catalogue numbers must be rejected;
    the integrator cannot legitimately produce one."""
    build, result = case_a
    inflated = copy.copy(result)
    inflated.detail = dict(result.detail)
    inflated.detail["energy_in_J"] = float(result.detail["energy_in_J"]) * 3.0
    admissible, reasons = screen_design(build, inflated)
    assert not admissible
    assert any("harvest bound" in r for r in reasons), reasons


# --------------------------------------------------------------------------- #
# ROUND 5 -- MUST-STAY-RED: each test asserts the SPECIFIC reason string of    #
# ONE screen, so deleting that screen turns the test red. Measured before      #
# these existed: deleting the fuselage floor (screen #10) left the gate and    #
# every unit spec green while that floor was the SOLE stop for 6               #
# closed+certified fantasy designs.                                            #
# --------------------------------------------------------------------------- #


def _integrated(design):
    """Build + integrate one 24 h window: (build, result)."""
    build = build_solar_cruise(design)
    result = integrate_energy(build.vehicle, build.env, 0.0, DAY_S, SLOW_DT_S)
    return build, result


def test_one_gram_fuselage_stays_red(case_a) -> None:
    """Screen #10 (fuselage remainder floor) MUST fire on the R4 boundary
    rider: honest case-A elements with the as-flown total shaved so the
    structural remainder is exactly 1 gram. This design CLOSES -- the floor is
    its sole stop, which is why this test pins the reason string."""
    build_a, _ = case_a
    declared_kg = float(build_a.meta["mass_kg"]["declared_elements"])
    design = dataclasses.replace(
        DESIGN_A, name="one_gram_fuselage", mass_all_up_kg=declared_kg + 0.001)
    build, result = _integrated(design)
    admissible, reasons = screen_design(build, result, check_seasonal=False)
    assert not admissible
    assert any("fuselage floor" in r for r in reasons), reasons


def test_r6_hostile_vector_stays_red() -> None:
    """One of the R6 search's closed hostile vectors whose ONLY hard stop was
    the fuselage floor (fus_over_floor 0.797; record measured usable 1.0840,
    min_soc 0.1915, reasons=[fuselage floor] alone). Rebuilt through the same
    to_design arithmetic the search used; the floor must still name it."""
    import math

    from aerosim.vehicle import Thruster, min_fuselage_boom_tail_mass_kg
    from aerosim.vehicle.structure import wing_mass_kg

    v = {  # R6_search_result.json, closed + sole-reason 'fuselage floor'
        # (pv_packing clamped 0.9860 -> 0.92: the round-5 MAX_PV_PACKING_FACTOR
        # wall now refuses the recorded value at construction -- an ADDED wall,
        # and this test's target is the fuselage floor, so the vector is kept
        # buildable)
        "area_m2": 65.34771329664807, "aspect_ratio": 39.39974686177596,
        "taper_ratio": 0.4596364513999749, "battery_mass_kg": 293.3004469872483,
        "pack_Wh_per_kg": 240.25537262490258, "cell_eff": 0.24100206248397907,
        "pv_density": 3.13449669128443, "pv_packing": 0.92,
        "extra_CD0": 0.0009397856734377308, "fus_over_floor": 0.7973666302087523,
        "prop_max_W": 9646.676423231112, "prop_diameter_m": 2.924838554638521,
        "altitude_m": 12517.413988663337, "latitude_deg": 2.197877084592463,
        "day_of_year": 188, "payload_W": 3.0002799580602075,
        "payload_mass_kg": 1.2308118965288928,
        "twist_root_deg": 2.193737899147218,
        "twist_tip_deg": -1.4309488455393056,
    }
    span_m = math.sqrt(v["aspect_ratio"] * v["area_m2"])
    wing_kg = wing_mass_kg(span_m, v["area_m2"], 3.0)
    thruster = Thruster(
        diameter_m=v["prop_diameter_m"], max_electrical_power_W=v["prop_max_W"],
        n_rotors=1, figure_of_merit=0.85, eta_motor=0.85, eta_esc=0.95)
    carried_kg = v["battery_mass_kg"] + v["payload_mass_kg"] + thruster.mass_kg
    fus_kg = (min_fuselage_boom_tail_mass_kg(carried_kg, span_m)
              * v["fus_over_floor"])
    total_kg = (v["battery_mass_kg"] + v["area_m2"] * v["pv_density"]
                + thruster.mass_kg + v["payload_mass_kg"] + wing_kg + fus_kg)
    design = dataclasses.replace(
        DESIGN_A, name="r6_hostile", span_m=span_m, area_m2=v["area_m2"],
        taper_ratio=v["taper_ratio"], twist_root_deg=v["twist_root_deg"],
        twist_tip_deg=v["twist_tip_deg"], extra_CD0=v["extra_CD0"],
        mass_all_up_kg=total_kg, battery_mass_kg=v["battery_mass_kg"],
        pack_Wh_per_kg=v["pack_Wh_per_kg"], pv_efficiency=v["cell_eff"],
        pv_packing=v["pv_packing"], pv_areal_density_kg_m2=v["pv_density"],
        prop_diameter_m=v["prop_diameter_m"],
        prop_max_electrical_W=v["prop_max_W"], payload_W=v["payload_W"],
        payload_mass_kg=v["payload_mass_kg"], altitude_m=v["altitude_m"],
        latitude_deg=v["latitude_deg"], day_of_year=v["day_of_year"])
    build, result = _integrated(design)
    admissible, reasons = screen_design(build, result, check_seasonal=False)
    assert not admissible
    assert any("fuselage floor" in r for r in reasons), reasons


def test_sub_floor_extra_cd0_stays_red() -> None:
    """Screen #11 (shell/slender-body extra_CD0 floor) MUST fire on a case-A
    variant declaring extra_CD0 = 1e-5: inside the element's (0, 0.05] band,
    but ~340x below the structure.min_extra_CD0 floor (~3.4e-3 for the case-A
    class pod/boom/tail) -- a fuselage that weighs something wets something."""
    design = dataclasses.replace(
        DESIGN_A, name="sub_floor_cd0", extra_CD0=1.0e-5)
    build, result = _integrated(design)
    admissible, reasons = screen_design(build, result, check_seasonal=False)
    assert not admissible
    assert any("extra_CD0 floor" in r for r in reasons), reasons


def test_one_milliwatt_payload_stays_red() -> None:
    """Screen #12 (payload floor) MUST fire on the hostile survivors' parking
    spot: payload_W = 1 mW (measured worth +1.7-2.8% usable in the R5/R6
    searches). The round-4 '> 0 W' floor admitted this; the round-5 floor is a
    real avionics wattage (AS-2 anchor 5.8 W scaled with mass^(2/3))."""
    design = dataclasses.replace(
        DESIGN_A, name="one_milliwatt_payload",
        payload_W=0.001, payload_mass_kg=0.001)
    build, result = _integrated(design)
    admissible, reasons = screen_design(build, result, check_seasonal=False)
    assert result.closed, "fixture drift: the 1 mW probe should still CLOSE"
    assert not admissible
    assert any("payload floor" in r for r in reasons), reasons


def test_payload_mass_must_support_the_draw() -> None:
    """Screen #12's second clause: an honest 5.8 W draw billed to a 1-gram
    'payload' (5800 W/kg installed) must be rejected -- the 150 W/kg ceiling
    is ~4x the densest catalogued suite (AS-2, 38.7 W/kg)."""
    design = dataclasses.replace(
        DESIGN_A, name="gram_payload_full_draw", payload_mass_kg=0.001)
    build, result = _integrated(design)
    admissible, reasons = screen_design(build, result, check_seasonal=False)
    assert not admissible
    assert any("payload mass" in r for r in reasons), reasons


def test_screen_k_eff_max_altitude_scaler_is_pinned() -> None:
    """The altitude-aware K_eff ceiling cannot be silently flattened: 1.5
    holds ONLY at the 20 km anchor; at case A's 500 m it must be ~1.16
    (measured 1.161985 at the round-5 pin). A flat 1.5 at low altitude was
    the measured ~2x headroom round 4 closed."""
    from aerosim.validate_screen import SCREEN_K_EFF_MAX, screen_k_eff_max

    assert screen_k_eff_max(20000.0) == pytest.approx(SCREEN_K_EFF_MAX)
    assert screen_k_eff_max(500.0) == pytest.approx(1.161985, abs=5e-4)
    assert screen_k_eff_max(0.0) < screen_k_eff_max(500.0) < screen_k_eff_max(20000.0)


def test_solstice_only_design_is_flagged_not_rejected() -> None:
    """Round 5's midnight-sun finding: the same ship scores 1.5865 at 60N
    solstice vs 1.3544 at the equator while honest hardware is site-flat. A
    67N solstice specialist (closes on day 172, dies at the equinox) must be
    ADMITTED but carry the 'flag: solstice-only' flag, and
    build.meta['seasonal_robustness'].closes_equinox must be False."""
    import math

    from aerosim.vehicle import Thruster, min_fuselage_boom_tail_mass_kg
    from aerosim.vehicle.structure import wing_mass_kg

    # Every knob HONEST (catalogued ELO pair 0.30 @ 0.2 kg/m2, packing 0.92,
    # AS-2's extra_CD0 0.006, real 5.8 W avionics): the ONLY liberty this
    # design takes is seasonal -- a pack sized for the 67N midnight-sun night.
    # Measured 2026-08-02: batt 0.5-0.7 kg closes day 172 / dies at doy 80;
    # batt >= 0.9 kg is season-flat. 0.6 kg sits mid-band.
    S_m2, AR = 1.9, 18.0
    span_m = math.sqrt(AR * S_m2)
    wing_kg = wing_mass_kg(span_m, S_m2, 3.0)
    thruster = Thruster(diameter_m=0.5, max_electrical_power_W=400.0,
                        n_rotors=1, figure_of_merit=0.85, eta_motor=0.85,
                        eta_esc=0.95)
    battery_kg, payload_kg = 0.6, 0.150
    fus_kg = min_fuselage_boom_tail_mass_kg(
        battery_kg + payload_kg + thruster.mass_kg, span_m)
    total_kg = (battery_kg + S_m2 * 0.2 + thruster.mass_kg + payload_kg
                + wing_kg + fus_kg)
    design = dataclasses.replace(
        DESIGN_A, name="midnight_sun", span_m=span_m, area_m2=S_m2,
        extra_CD0=0.006, mass_all_up_kg=total_kg,
        battery_mass_kg=battery_kg, pack_Wh_per_kg=445.4999,
        pv_efficiency=0.30, pv_packing=0.92, pv_areal_density_kg_m2=0.2,
        prop_diameter_m=0.5, prop_max_electrical_W=400.0,
        payload_W=5.8, payload_mass_kg=payload_kg,
        altitude_m=500.0, latitude_deg=67.0, day_of_year=172)
    build, result = _integrated(design)
    assert result.closed, "fixture drift: the 67N specialist should close on day 172"
    admissible, reasons = screen_design(build, result)
    assert admissible, f"the flag must NOT reject: {reasons}"
    assert any(r.startswith("flag: solstice-only") for r in reasons), reasons
    seasonal = build.meta["seasonal_robustness"]
    assert seasonal["closes_equinox"] is False
    assert seasonal["equinox_day_of_year"] == 80
