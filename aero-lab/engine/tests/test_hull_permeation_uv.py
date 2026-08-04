"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression guards for the hull + envelope-chemistry half of the materials module (vehicle/hull.py + the buoyancy.py round-5 edits): prolate membrane stresses (155/82 MPa at the measured 12.35 kPa -- REFUSED; 2.5 MPa at the 200 Pa vent setpoint -- passes), the two honest hull closures (vented +0.202 kg exactly decomposed, PET >= 1.0 kg), the He permeation anchors from the SPEC_chemistry two-independent-unit-chain (3.4/1.4/0.04 %/day for the 1.37 m^3 / 38 um hybrid at 25/+5/-56 C, 10 m^3 sphere 1.8 %/day, metallized Mylar ~0.006 %/day), UV dose-to-failure lives (unstabilized ~29 d band 12-56 at float dose, stabilized >= 100 d), daylight-only dose accrual, He decay coupling into the lift with the slack-aware displaced volume, the explicit-ideal loudness, and the recheck guard on a stale hull-closure bill.
"""

from __future__ import annotations

import math
import warnings

import pytest

from aerosim.env import SolarSample, WindSample, atmosphere
from aerosim.vehicle import BodyState, BuoyancyVolume
from aerosim.vehicle.buoyancy import (
    IdealEnvelopeWarning,
    UV_DC_BAND_UNSTABILIZED_MJ_M2,
    UV_DC_MJ_M2,
    UV_RETENTION_MISSION_FLOOR,
)
from aerosim.vehicle.hull import (
    HYBRID_PEAK_SUPERPRESSURE_PA,
    HYBRID_SEMI_MAJOR_M,
    HYBRID_SEMI_MINOR_M,
    HULL_FILM_THICKNESS_M,
    hull_closure,
    hull_membrane_stress_Pa,
    require_hull_film_ok,
    vented_ballonet_mass_kg,
)
from aerosim.vehicle.mass import MassClosureError
from aerosim.vehicle.param_bounds import (
    ParamBoundsError,
    recheck_element_params,
)

#: Float-altitude daily UV dose, MJ/m^2/day (105 W/m^2 x 14 h, SPEC_chemistry
#: 6.1) -- the denominator of every life anchor here.
FLOAT_UV_DOSE_MJ_M2_DAY = 5.3


def _still() -> WindSample:
    return WindSample(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)


def _dark() -> SolarSample:
    return SolarSample(-0.5, 0.0, 0.0, 0.0, 0.0, 0.0)


def _full_sun() -> SolarSample:
    """Float-class sun: DNI ~ TSI, so 0.077 x 1361 ~ 105 W/m^2 of UV."""
    return SolarSample(1.0, 0.0, 1361.0, 0.0, 1145.0, 1361.0)


# --------------------------------------------------------------------------- #
# 1. Hull membrane stresses and the fail-closed film gate                      #
# --------------------------------------------------------------------------- #


def test_unlobed_skin_stresses_at_measured_superpressure() -> None:
    hoop_Pa, merid_Pa = hull_membrane_stress_Pa(
        HYBRID_PEAK_SUPERPRESSURE_PA, HYBRID_SEMI_MINOR_M,
        HYBRID_SEMI_MAJOR_M, HULL_FILM_THICKNESS_M)
    assert hoop_Pa == pytest.approx(155.0e6, rel=0.02)
    assert merid_Pa == pytest.approx(82.0e6, rel=0.02)


def test_155_mpa_unlobed_lldpe_is_refused() -> None:
    """The hull as previously billed cannot exist: 38 um LLDPE at the
    measured 12.35 kPa is 2-6x its BREAK stress and must raise."""
    with pytest.raises(ParamBoundsError):
        require_hull_film_ok(
            HYBRID_PEAK_SUPERPRESSURE_PA, HYBRID_SEMI_MINOR_M,
            HYBRID_SEMI_MAJOR_M, HULL_FILM_THICKNESS_M, 5.0e6)


def test_vented_setpoint_passes_at_2p5_mpa() -> None:
    governing_Pa = require_hull_film_ok(
        200.0, HYBRID_SEMI_MINOR_M, HYBRID_SEMI_MAJOR_M,
        HULL_FILM_THICKNESS_M, 5.0e6)
    assert governing_Pa == pytest.approx(2.5e6, rel=0.03)


def test_hull_closure_options() -> None:
    vent = hull_closure("vented_ballonet")
    # Exactly the pasted decomposition: ballonet 0.082 + valve/blower 0.120.
    assert vent.added_mass_kg == pytest.approx(0.202, abs=0.0015)
    assert vent.added_mass_kg - 0.120 == pytest.approx(0.082, abs=0.0015)
    assert vent.setpoint_Pa == 200.0
    assert vent.blower_duty_W == pytest.approx(5.0)
    pet = hull_closure("superpressure_pet")
    assert pet.added_mass_kg >= 1.0            # the >= +1.0 kg verdict
    assert pet.setpoint_Pa == HYBRID_PEAK_SUPERPRESSURE_PA
    ideal = hull_closure("ideal")
    assert ideal.added_mass_kg == 0.0
    with pytest.raises(MassClosureError):
        hull_closure("bare_500pa_sphere")      # never again an option


def test_ballonet_mass_scales_with_volume() -> None:
    assert vented_ballonet_mass_kg(1.61) == pytest.approx(0.202, abs=0.0015)
    assert vented_ballonet_mass_kg(3.22) > vented_ballonet_mass_kg(1.61)
    with pytest.raises(ParamBoundsError):
        vented_ballonet_mass_kg(-1.0)


# --------------------------------------------------------------------------- #
# 2. Helium permeation anchors (two-independent-unit-chain, +-10%)             #
# --------------------------------------------------------------------------- #


def test_lldpe_hybrid_permeation_anchors() -> None:
    cell = BuoyancyVolume(volume_m3=1.37)
    for t_K, anchor in ((298.15, 0.034), (278.15, 0.014), (217.15, 0.0004)):
        rate = cell.helium_loss_frac_per_day(t_K)
        assert rate == pytest.approx(anchor, rel=0.10), f"at {t_K} K"


def test_sphere_worked_example_and_a_over_v_scaling() -> None:
    sphere = BuoyancyVolume(volume_m3=10.0)
    assert sphere.helium_loss_frac_per_day(298.15) == pytest.approx(
        0.018, rel=0.10)
    # Loss ~ A/V: the bigger cell loses a smaller FRACTION per day.
    small = BuoyancyVolume(volume_m3=1.37)
    assert (sphere.helium_loss_frac_per_day(298.15)
            < small.helium_loss_frac_per_day(298.15))


def test_mylar_and_metallized_films() -> None:
    uncoated = BuoyancyVolume(volume_m3=1.37, envelope_film="mylar_38um")
    coated = BuoyancyVolume(volume_m3=1.37,
                            envelope_film="metallized_mylar_38um")
    assert uncoated.helium_loss_frac_per_day(298.15) == pytest.approx(
        0.0056, rel=0.15)                      # graph-read +-30% source, H16
    assert coated.helium_loss_frac_per_day(298.15) == pytest.approx(
        6.0e-5, rel=0.15)                      # ~0.006 %/day
    assert coated.helium_loss_frac_per_day(298.15) == pytest.approx(
        uncoated.helium_loss_frac_per_day(298.15) / 100.0)


def test_cold_nearly_stops_permeation() -> None:
    """E_P = 30 kJ/mol: -56 C flux is ~x0.011 of 25 C -- stratospheric cold
    nearly stops the leak; warm ground days dominate."""
    cell = BuoyancyVolume(volume_m3=1.37)
    ratio = (cell.helium_loss_frac_per_day(217.15)
             / cell.helium_loss_frac_per_day(298.15))
    assert ratio == pytest.approx(0.011, rel=0.10)
    with pytest.raises(ParamBoundsError):
        cell.helium_loss_frac_per_day(100.0)   # outside any film's world


def test_ideal_film_is_explicit_loud_and_lossless() -> None:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        cell = BuoyancyVolume(volume_m3=1.37, envelope_film="ideal",
                              hull_structure="ideal")
    assert any(issubclass(w.category, IdealEnvelopeWarning) for w in caught)
    assert cell.helium_loss_frac_per_day(298.15) == 0.0
    assert cell.hull_closure_mass_kg == 0.0
    with pytest.raises(ParamBoundsError):
        BuoyancyVolume(volume_m3=1.37, envelope_film="unobtanium_film")
    with pytest.raises(ParamBoundsError):
        BuoyancyVolume(volume_m3=1.37, hull_structure="wishful_thinking")


# --------------------------------------------------------------------------- #
# 3. UV dose-to-failure lives (H17 bounded model, band carried through)        #
# --------------------------------------------------------------------------- #


def test_uv_lives_at_float_dose() -> None:
    life_unstab_d = math.log(2.0) * UV_DC_MJ_M2["unstabilized"] / FLOAT_UV_DOSE_MJ_M2_DAY
    assert life_unstab_d == pytest.approx(29.0, rel=0.05)
    lo_dc, hi_dc = UV_DC_BAND_UNSTABILIZED_MJ_M2
    band_lo_d = math.log(2.0) * lo_dc / FLOAT_UV_DOSE_MJ_M2_DAY
    band_hi_d = math.log(2.0) * hi_dc / FLOAT_UV_DOSE_MJ_M2_DAY
    assert 10.0 < band_lo_d < 13.0 and 53.0 < band_hi_d < 60.0   # 12-56 band
    life_stab_d = math.log(2.0) * UV_DC_MJ_M2["stabilized"] / FLOAT_UV_DOSE_MJ_M2_DAY
    assert life_stab_d >= 100.0                # GUSTO 57 d lower bound x margin
    assert UV_RETENTION_MISSION_FLOOR == 0.5


# --------------------------------------------------------------------------- #
# 4. Accrual in a live cell: daylight-only dose, He decay into the lift        #
# --------------------------------------------------------------------------- #


def _step(cell: BuoyancyVolume, alt_m: float, sol: SolarSample,
          dt_s: float) -> float:
    body = BodyState(pos_m=[0.0, 0.0, alt_m], vel_ms=[0.0, 0.0, 0.0],
                     mass_kg=0.0)
    return float(cell.evaluate([body], atmosphere(alt_m), _still(), sol,
                               0.0, dt_s).force_N[2])


def test_uv_dose_accrues_only_in_daylight() -> None:
    cell = BuoyancyVolume(volume_m3=1.37, uv_grade="unstabilized")
    for _ in range(6):
        _step(cell, 500.0, _dark(), 3600.0)
    assert cell.uv_dose_MJ_m2 == 0.0
    assert cell.uv_retention == 1.0
    for _ in range(14):                        # a 14 h full-sun float day
        _step(cell, 500.0, _full_sun(), 3600.0)
    # 0.077 x 1361 W/m2 x 14 h = 5.28 MJ/m2 -- the SPEC 5.3 MJ/m2/day rate.
    assert cell.uv_dose_MJ_m2 == pytest.approx(5.3, rel=0.05)
    assert cell.uv_retention == pytest.approx(
        math.exp(-cell.uv_dose_MJ_m2 / UV_DC_MJ_M2["unstabilized"]))
    assert cell.uv_retention < 1.0


def test_helium_decay_reduces_lift_via_slack_volume() -> None:
    cell = BuoyancyVolume(volume_m3=1.37, superpressure_Pa=200.0)
    lift0_N = _step(cell, 500.0, _dark(), 3600.0)
    assert cell.helium_frac_remaining <= 1.0
    for _ in range(5 * 24 - 1):                # five warm nights of leak
        _step(cell, 500.0, _dark(), 3600.0)
    lift5_N = _step(cell, 500.0, _dark(), 3600.0)
    # ~1.3-1.5 %/day at ~280 K film temperature -> 6-8% of the charge gone.
    assert 0.90 <= cell.helium_frac_remaining <= 0.96
    # The 200 Pa superpressure margin (~0.2% of ambient) is long gone: the
    # cell is slack and lift tracks n_He downward (SPEC_chemistry 5.2).
    assert lift5_N < lift0_N
    # Exact slack-model identity from the cell's own state: displaced volume
    # = min(V, m*R_spec*T_gas/p_amb), lift = (rho*V_disp - m - film -
    # closure)*g. (The pure %lift = %He identity holds only at constant
    # temperature -- the slack cell's displaced volume also tracks the gas
    # temperature, which sits below ambient on an IR-cooled night.)
    atmo = atmosphere(500.0)
    v_disp_m3 = min(1.37, cell.gas_mass_kg * cell.R_spec_J_kgK
                    * cell.gas_temp_K / float(atmo.p_Pa))
    lift_pred_N = (float(atmo.rho_kgm3) * v_disp_m3 - cell.gas_mass_kg
                   - cell.film_mass_kg - cell.hull_closure_mass_kg) * 9.80665
    assert lift5_N == pytest.approx(lift_pred_N, rel=1.0e-6)
    # Order-of-magnitude coupling band: the lift lost is the He-loss fraction
    # of the gross displaced-air lift, within the thermal-slack factor.
    loss_frac = (lift0_N - lift5_N) / (
        float(atmo.rho_kgm3) * 1.37 * 9.80665)
    he_lost = 1.0 - cell.helium_frac_remaining
    assert 0.3 * he_lost < loss_frac < 1.2 * he_lost


def test_ideal_film_lift_does_not_decay() -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", IdealEnvelopeWarning)
        cell = BuoyancyVolume(volume_m3=1.37, superpressure_Pa=200.0,
                              envelope_film="ideal")
    lift0_N = _step(cell, 500.0, _dark(), 3600.0)
    for _ in range(48):
        _step(cell, 500.0, _dark(), 3600.0)
    lift2_N = _step(cell, 500.0, _dark(), 3600.0)
    assert cell.helium_frac_remaining == 1.0
    assert lift2_N == pytest.approx(lift0_N, abs=1.0e-9)


# --------------------------------------------------------------------------- #
# 5. Billing and recheck: the closure cannot be stale, the film pays PET rates #
# --------------------------------------------------------------------------- #


def test_hull_closure_mass_is_billed_and_rechecked() -> None:
    cell = BuoyancyVolume(volume_m3=1.61)
    assert cell.hull_closure_mass_kg == pytest.approx(0.202, abs=0.0015)
    # Net lift pays for the closure: the same cell with the explicit ideal
    # hull lifts MORE by exactly the closure weight.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", IdealEnvelopeWarning)
        free = BuoyancyVolume(volume_m3=1.61, hull_structure="ideal")
    lift_real_N = _step(cell, 500.0, _dark(), 60.0)
    lift_free_N = _step(free, 500.0, _dark(), 60.0)
    assert lift_free_N - lift_real_N == pytest.approx(
        cell.hull_closure_mass_kg * 9.80665, rel=1.0e-3)
    # A live cell whose closure bill was zeroed after construction is caught.
    cell.hull_closure_mass_kg = 0.0
    with pytest.raises(ParamBoundsError):
        recheck_element_params(cell)


def test_pet_film_weighs_pet_not_lldpe() -> None:
    lldpe = BuoyancyVolume(volume_m3=1.37)
    pet = BuoyancyVolume(volume_m3=1.37, envelope_film="mylar_38um")
    assert pet.film_mass_kg == pytest.approx(
        lldpe.film_mass_kg * 1390.0 * 38.0e-6 / 0.035, rel=1.0e-6)


def test_superpressure_pet_hull_bills_a_sized_skin() -> None:
    cell = BuoyancyVolume(volume_m3=1.61, superpressure_Pa=12345.0,
                          hull_structure="superpressure_pet")
    # Sphere-equivalent PET skin at 50 MPa allowable: t = dP*r/(2*sigma) --
    # of order the teardrop's ~1 kg-class closure, and never free.
    assert cell.hull_closure_mass_kg > 0.5
