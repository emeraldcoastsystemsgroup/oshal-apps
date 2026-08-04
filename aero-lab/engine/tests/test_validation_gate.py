"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation. One guard
  |                                           | per defect closed in the validation
  |                                           | rewrite, each written so it goes RED if
  |                                           | the defect comes back: private
  |                                           | self-billing stand-ins, gross-energy
  |                                           | margin, the vacuous algebraic
  |                                           | cross-check, bands too loose to see a
  |                                           | 2x error, and a magic generator that
  |                                           | used to report closed = True.
2 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4 integration: the slow quad 2x
  |                                           | harvest guard now accepts a
  |                                           | TechCatalogueError at construction (the
  |                                           | new joint-frontier wall refuses the
  |                                           | fantasy cell before it can fly) while
  |                                           | still requiring the honest scale=1.0
  |                                           | build to construct and refuse to close.

Regression guards for aerosim.validate.

Run with:  python -m pytest tests/test_validation_gate.py -q

DESIGN RULE FOLLOWED HERE: a guard that only asserts the CURRENT behaviour is
worth very little. Every guard below is paired with an inline MUTATION -- the
defect is deliberately re-opened in a local object and the guard is asserted to
fire. A test that cannot be made to fail is not a test.

Most guards are fast (no 24 h integration). The two that must integrate are
marked ``slow`` in their names so a developer can deselect them with -k.
"""

from __future__ import annotations

import math
import warnings

import numpy as np
import pytest

from aerosim import validate as V
from aerosim import validate_bounds as B
from aerosim import validate_designs as D
from aerosim.integrate import FreeEnergyError, integrate_energy
from aerosim.validate_sensitivity import scaled_polar
from aerosim.vehicle import (
    BatteryElement,
    BodyState,
    ElementForce,
    PayloadLoad,
    PVArray,
    UndeclaredMassWarning,
    Vehicle,
    WindTurbine,
)

warnings.simplefilter("ignore", UndeclaredMassWarning)

G0_MS2 = 9.80665


# =========================================================================== #
# ROOT CAUSE -- a case must be built from SHIPPED elements                     #
# =========================================================================== #


class _SelfBillingStandIn:
    """The exact shape of the defect: a private element that bills its own drag.

    @description Reproduces validate._TrimmedCruiseLoad, whose ``evaluate``
        returned ``power_elec_W = -D*V/eta`` while the SHIPPED AeroSurface returns
        0.0 and bills nothing. Validation passed on this and the product was
        broken. It exists only so the guard can be shown to reject it.
    """

    def __init__(self) -> None:
        self.body_index = 0
        self.offset_m = np.zeros(3)
        self.MASSLESS_BY_CONSTRUCTION = True

    def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s) -> ElementForce:  # noqa: ANN001
        """@description Bills itself. @returns ElementForce with a made-up cost."""
        return ElementForce(np.zeros(3), np.zeros(3), -42.0)


def _minimal_vehicle(elements) -> Vehicle:
    """@description A one-body vehicle carrying the given elements.
    @param elements Force elements.  @returns Vehicle."""
    body = BodyState(pos_m=np.zeros(3), vel_ms=np.array([10.0, 0.0, 0.0]),
                     mass_kg=1.0)
    return Vehicle(bodies=[body], elements=list(elements))


def test_shipped_element_guard_accepts_shipped_elements():
    """A vehicle of public aerosim.vehicle elements passes cleanly."""
    veh = _minimal_vehicle([
        PayloadLoad(5.0, mass_kg=0.1),
        BatteryElement(capacity_J=1.0e5, initial_soc=1.0,
                       specific_energy_Wh_per_kg=200.0),
    ])
    report = V.assert_shipped_elements(veh)
    assert report["all_shipped"] is True
    assert report["allowance_used"] == []
    assert all(row["shipped"] for row in report["elements"])


def test_shipped_element_guard_rejects_a_private_stand_in():
    """MUTATION: re-open the root cause. The guard must refuse it."""
    veh = _minimal_vehicle([_SelfBillingStandIn(),
                            PayloadLoad(5.0, mass_kg=0.1)])
    with pytest.raises(V.ValidationError) as exc:
        V.assert_shipped_elements(veh)
    assert "_SelfBillingStandIn" in str(exc.value)
    assert "MISSING FEATURE" in str(exc.value)


def test_shipped_element_guard_allowance_is_explicit_and_recorded():
    """An allowance must be named, and must show up in the report."""
    veh = _minimal_vehicle([_SelfBillingStandIn()])
    report = V.assert_shipped_elements(veh, allow=("_SelfBillingStandIn",))
    assert report["all_shipped"] is False
    assert report["allowance_used"] == ["_SelfBillingStandIn"]


def test_shipped_element_guard_is_not_fooled_by_a_colliding_name():
    """MUTATION: a local class named like a shipped one must still be rejected."""
    class PVArray:  # noqa: N801 - deliberately shadows the shipped name
        """A local impostor wearing a shipped element's name."""

        def __init__(self) -> None:
            self.body_index = 0
            self.offset_m = np.zeros(3)
            self.MASSLESS_BY_CONSTRUCTION = True

        def evaluate(self, *a):  # noqa: ANN001, ANN201
            """@returns Free power."""
            return ElementForce(np.zeros(3), np.zeros(3), 1000.0)

    with pytest.raises(V.ValidationError):
        V.assert_shipped_elements(_minimal_vehicle([PVArray()]))


def test_every_shipped_case_uses_only_shipped_elements():
    """The four real cases must contain no private element at all."""
    for build in (D.build_solar_cruise(D.DESIGN_A),
                  D.build_solar_cruise(D.DESIGN_B),
                  D.build_quadcopter_hover(),
                  D.build_turbine_free_flier()):
        report = V.assert_shipped_elements(build.vehicle)
        assert report["all_shipped"] is True, report


def test_case_E_is_the_only_allowance_and_it_is_disclosed():
    """Case E's adversary is allowed exactly once, and it is named in the report."""
    build = D.build_magic_generator()
    with pytest.raises(V.ValidationError):
        V.assert_shipped_elements(build.vehicle)          # no allowance -> refused
    report = V.assert_shipped_elements(build.vehicle, allow=("_MagicGenerator",))
    assert report["allowance_used"] == ["_MagicGenerator"]


# =========================================================================== #
# DEFECT 1 -- margin must be USABLE energy, never gross                        #
# =========================================================================== #


class _FakeResult:
    """@description Minimal stand-in carrying only a detail dict.
    @param detail The integrator detail dict."""

    def __init__(self, detail: dict) -> None:
        self.detail = detail


def test_usable_margin_excludes_energy_the_battery_cannot_absorb():
    """The measured case-A shape: 2671.4 Wh harvested, 1499 Wh spilled."""
    energy = V.usable_energy(_FakeResult({
        "energy_in_J": 2671.4 * 3600.0,
        "energy_out_J": 1300.0 * 3600.0,
        "unabsorbed_surplus_J": 1499.0 * 3600.0,
        "unabsorbed_shortfall_J": 0.0,
    }))
    assert energy["margin_ratio_gross"] == pytest.approx(2671.4 / 1300.0)
    assert energy["margin_ratio_usable"] == pytest.approx((2671.4 - 1499.0) / 1300.0)
    assert energy["margin_ratio_usable"] < energy["margin_ratio_gross"]
    assert energy["spilled_fraction_of_gross"] == pytest.approx(1499.0 / 2671.4)


def test_usable_margin_refuses_to_fall_back_to_gross():
    """MUTATION: hide the spill accounting. It must RAISE, not silently use gross.

    Falling back would restore the exact defect -- a margin that counts energy
    no battery could hold -- while looking like it still worked.
    """
    with pytest.raises(V.ValidationError) as exc:
        V.usable_energy(_FakeResult({"energy_in_J": 1.0, "energy_out_J": 1.0}))
    assert "GROSS" in str(exc.value)


def test_reported_margin_ratio_is_the_usable_one():
    """The CaseResult field a sweep would rank on must be the usable number."""
    energy = V.usable_energy(_FakeResult({
        "energy_in_J": 100.0, "energy_out_J": 50.0,
        "unabsorbed_surplus_J": 40.0, "unabsorbed_shortfall_J": 0.0,
    }))
    result = _FakeResult({"closed_reasons": [], "closure_mode": "limit-cycle"})
    result.closed, result.min_soc = True, 0.4
    case = V._finish("probe", True, result, energy, [], {}, None, None)
    assert case.margin_ratio == pytest.approx(60.0 / 50.0)
    assert case.detail["energy"]["margin_ratio_gross"] == pytest.approx(2.0)


# =========================================================================== #
# DEFECT 2 -- the retired cross-check was an identity; the new ones can fail    #
# =========================================================================== #


def test_the_retired_cross_check_really_was_vacuous():
    """Evidence, not assertion: the old check cannot fail, at any CL or CD.

    The two expressions it compared were

        P = 0.5 rho V^3 S CD          and      P = sqrt(2 W^3/(rho S)) / (CL^1.5/CD)

    which are identically equal once V = sqrt(2W/(rho S CL)). This walks a wide
    random sample -- including grossly corrupted polars -- and shows the residual
    never leaves float noise, so no mutation could ever have tripped it.
    """
    rng = np.random.default_rng(0)
    worst = 0.0
    for _ in range(20_000):
        W = float(rng.uniform(5.0, 800.0))
        rho = float(rng.uniform(0.05, 1.3))
        S = float(rng.uniform(0.2, 40.0))
        CL = float(rng.uniform(0.2, 2.0))
        CD = float(rng.uniform(0.005, 0.30))     # includes doubled / halved drag
        V_ms = math.sqrt(2.0 * W / (rho * S * CL))
        direct = 0.5 * rho * V_ms ** 3 * S * CD
        formula = math.sqrt(2.0 * W ** 3 / (rho * S)) / (CL ** 1.5 / CD)
        worst = max(worst, abs(direct - formula) / max(formula, 1e-12))
    assert worst < 1e-12, f"worst relative residual {worst:.3e}"


def test_drag_floor_is_a_real_constraint_at_the_nominal_design():
    """Case A's solved polar must sit ABOVE the closed-form floor, with margin."""
    report = _case_A_bound_report()
    assert report.ok, report.violations
    assert 1.05 < report.drag_margin < 3.0, report.drag_margin


def _case_A_bound_report():
    """@description Bound case A's reference polar. @returns PolarBoundReport."""
    build = D.build_solar_cruise(D.DESIGN_A)
    ref = build.reference
    return B.bound_polar_point(
        CL=ref.CL, CD=ref.CD, cl15_over_cd=ref.cl15_over_cd,
        span_m=D.DESIGN_A.span_m, area_m2=D.DESIGN_A.area_m2,
        reynolds_chord=ref.Re, extra_CD0=D.DESIGN_A.extra_CD0,
    )


@pytest.mark.parametrize("cl_scale, cd_scale", [(1.0, 0.5), (1.5, 1.0), (2.0, 1.0)])
def test_drag_floor_fires_on_a_corrupted_polar(cl_scale, cd_scale):
    """MUTATION: the corruptions the retired identity passed silently."""
    ref_CL, ref_CD, ref_Re = 0.8726, 0.033554, 176468.0
    CL = ref_CL * cl_scale
    CD = ref_CD * cd_scale
    report = B.bound_polar_point(
        CL=CL, CD=CD, cl15_over_cd=CL ** 1.5 / CD,
        span_m=D.DESIGN_A.span_m, area_m2=D.DESIGN_A.area_m2,
        reynolds_chord=ref_Re, extra_CD0=D.DESIGN_A.extra_CD0,
    )
    assert not report.ok, f"bound did not fire: {report}"


def test_drag_floor_terms_match_hand_computation():
    """The floor must be the textbook expression, not a fitted constant."""
    CL, AR, Re = 0.9, 18.0, 200_000.0
    cdi = B.induced_drag_floor_CD(CL, AR)
    assert cdi == pytest.approx(CL ** 2 / (math.pi * AR))
    cdf = B.laminar_skin_friction_CD(Re)
    assert cdf == pytest.approx(2.0 * 1.328 / math.sqrt(Re))


def test_published_anchor_is_independent_of_the_solver():
    """The anchor must come from measured power, and must not move with the polar.

    MUTATION: corrupt every polar the solver returns. The anchor is unchanged,
    which is precisely what makes comparing against it a test.
    """
    args = dict(weight_N=D.DESIGN_A.mass_all_up_kg * G0_MS2,
                altitude_m=D.DESIGN_A.altitude_m,
                wing_area_m2=D.DESIGN_A.area_m2, eta_chain=V.ETA_CHAIN_CRUISE)
    clean = B.atlantiksolar_anchor_cl15_over_cd(**args)
    with scaled_polar(cl_scale=1.5, cd_scale=0.5):
        corrupted = B.atlantiksolar_anchor_cl15_over_cd(**args)
    assert clean == corrupted
    assert 15.0 < clean < 35.0


def test_hover_floor_is_computed_without_powerplant():
    """The independent hover floor must equal the textbook form exactly."""
    T_N, rho, A = 9.80665, 1.225, 0.20268
    assert B.ideal_hover_power_W(T_N, rho, A) == pytest.approx(
        T_N ** 1.5 / math.sqrt(2.0 * rho * A))


# =========================================================================== #
# DEFECT 3 -- the harvest bound sees a 2x error the closure verdict cannot      #
# =========================================================================== #


def test_extraterrestrial_insolation_matches_an_independent_derivation():
    """Cross-check eq. 1.10.3 against a DIFFERENT closed form at the equator.

    On the equinox at the equator the declination is zero, so the sun rises due
    east, sets due west and the day is exactly 12 h. The mean of cos(zenith) over
    those 12 h is 2/pi, giving

        H0 = Gsc * E0 * (2/pi) * 43200 s

    which shares no algebra with eq. 1.10.3's hour-angle integral. They must agree
    to machine precision, and they do.
    """
    day = 81                                          # 22 March, near the equinox
    h0 = B.daily_extraterrestrial_insolation_J_m2(0.0, day)
    e0 = 1.0 + 0.033 * math.cos(math.radians(360.0 * day / 365.0))
    independent = B.SOLAR_CONSTANT_WM2 * e0 * (2.0 / math.pi) * 43200.0
    assert h0 == pytest.approx(independent, rel=1e-12), (h0, independent)
    assert 36.0e6 < h0 < 39.0e6, h0

    # Polar night must clamp to zero-length day, not blow up on acos.
    assert B.daily_extraterrestrial_insolation_J_m2(80.0, 355) >= 0.0
    # A polar summer day must exceed the equatorial equinox value (24 h of sun).
    assert B.daily_extraterrestrial_insolation_J_m2(80.0, 172) > h0


def test_clearness_index_is_linear_in_cell_efficiency():
    """The whole point: halve the modelled harvest and K_eff halves."""
    kw = dict(gross_area_m2=1.72, packing_factor=0.802,
              cell_efficiency_stc=0.237, mppt_efficiency=0.95,
              latitude_deg=47.6, day_of_year=195)
    k1 = B.effective_clearness_index(harvest_gross_J=2671.4 * 3600.0, **kw)
    k2 = B.effective_clearness_index(harvest_gross_J=1335.7 * 3600.0, **kw)
    assert k2 == pytest.approx(k1 / 2.0)
    assert 0.55 <= k1 <= 0.95, k1


def test_clearness_index_denominator_uses_the_catalogue_not_the_element():
    """MUTATION: normalising by the element's own efficiency would be circular.

    If the denominator tracked the mutated efficiency, K_eff would be invariant
    and the check would measure nothing. It must NOT be invariant.
    """
    build = D.build_solar_cruise(D.DESIGN_A, pv_efficiency_scale=0.5)
    array = next(e for e in build.vehicle.elements if isinstance(e, PVArray))
    assert array.cell_efficiency_stc == pytest.approx(D.DESIGN_A.pv_efficiency * 0.5)
    catalogue = B.effective_clearness_index(
        harvest_gross_J=1000.0 * 3600.0, gross_area_m2=D.DESIGN_A.area_m2,
        packing_factor=D.DESIGN_A.pv_packing,
        cell_efficiency_stc=D.DESIGN_A.pv_efficiency, mppt_efficiency=0.95,
        latitude_deg=47.6, day_of_year=195)
    circular = B.effective_clearness_index(
        harvest_gross_J=1000.0 * 3600.0, gross_area_m2=D.DESIGN_A.area_m2,
        packing_factor=D.DESIGN_A.pv_packing,
        cell_efficiency_stc=array.cell_efficiency_stc, mppt_efficiency=0.95,
        latitude_deg=47.6, day_of_year=195)
    assert circular == pytest.approx(2.0 * catalogue)


def test_mass_closure_makes_the_pack_cost_airframe():
    """A bigger pack must eat structure, not arrive weightless."""
    base = D.build_solar_cruise(D.DESIGN_A)
    assert base.meta["mass_kg"]["derived_total"] == pytest.approx(
        D.DESIGN_A.mass_all_up_kg)
    heavier = D.build_solar_cruise(D.DESIGN_A, pack_specific_energy_scale=0.5)
    # Half the Wh/kg at the same pack MASS: capacity halves, structure is unmoved.
    assert heavier.meta["battery_capacity_Wh"] == pytest.approx(
        base.meta["battery_capacity_Wh"] / 2.0)
    assert heavier.meta["mass_kg"]["derived_total"] == pytest.approx(
        D.DESIGN_A.mass_all_up_kg)


def test_a_pack_that_outweighs_the_aircraft_raises():
    """MUTATION: an element set heavier than the airframe must not fly anyway."""
    huge = D.dataclasses.replace(D.DESIGN_A, battery_mass_kg=50.0) \
        if hasattr(D, "dataclasses") else None
    import dataclasses
    huge = dataclasses.replace(D.DESIGN_A, battery_mass_kg=50.0)
    with pytest.raises(V.ValidationError) as exc:
        D.build_solar_cruise(huge)
    assert "exceeds the as-flown" in str(exc.value)


# =========================================================================== #
# CASE E -- the magic generator must be rejected                               #
# =========================================================================== #


def test_magic_generator_is_rejected_by_the_integrator():
    """It used to report closed = True with min_soc = 1.0."""
    build = D.build_magic_generator()
    with pytest.raises(FreeEnergyError):
        integrate_energy(build.vehicle, build.env, 0.0, 3600.0, 60.0)


def test_magic_generator_is_rejected_on_the_first_step():
    """Rejection must be cheap enough to run inside a 30,000-design sweep."""
    import time
    build = D.build_magic_generator()
    t0 = time.perf_counter()
    with pytest.raises(FreeEnergyError) as exc:
        integrate_energy(build.vehicle, build.env, 0.0, 86400.0, 60.0)
    assert "t = 0.0 s" in str(exc.value)
    assert time.perf_counter() - t0 < 5.0


def test_the_same_airframe_without_the_adversary_does_not_raise():
    """Control: the guard must not be firing on the airframe itself."""
    build = D.build_solar_cruise(D.DESIGN_A)
    integrate_energy(build.vehicle, build.env, 0.0, 3600.0, 60.0)


# =========================================================================== #
# The shipped WindTurbine obeys the generation-reaction rule                   #
# =========================================================================== #


def test_wind_turbine_pays_for_what_it_extracts():
    """P_elec <= -(F . v_air), structurally, from one cp through powerplant."""
    from aerosim.env import atmosphere, make_uniform_field

    turbine = WindTurbine(swept_area_m2=0.5, generator_rated_power_W=5000.0)
    atmo = atmosphere(1000.0)
    wind = make_uniform_field(0.0, 0.0, 0.0).sample(0.0, 0.0, 1000.0, 0.0)
    for V_ms in (1.0, 5.0, 15.0, 30.0):
        body = BodyState(pos_m=np.array([0.0, 0.0, 1000.0]),
                         vel_ms=np.array([V_ms, 0.0, 0.0]), mass_kg=1.0)
        force = turbine.evaluate([body], atmo, wind, None, 0.0, 1.0)
        mech_removed_W = -float(np.dot(force.force_N, body.vel_ms))
        assert force.power_elec_W <= mech_removed_W + 1e-9, V_ms
        assert force.power_elec_W >= 0.0


def test_wind_turbine_in_still_relative_air_produces_exactly_zero():
    """Drifting with the flow must yield 0.0 -- identically, not approximately."""
    from aerosim.env import atmosphere, make_uniform_field

    turbine = WindTurbine(swept_area_m2=0.5, generator_rated_power_W=600.0)
    field = make_uniform_field(8.0, 0.0, 0.0)
    body = BodyState(pos_m=np.array([0.0, 0.0, 1000.0]),
                     vel_ms=np.array([8.0, 0.0, 0.0]), mass_kg=1.0)
    force = turbine.evaluate([body], atmosphere(1000.0),
                             field.sample(0.0, 0.0, 1000.0, 0.0), None, 0.0, 1.0)
    assert force.power_elec_W == 0.0
    assert np.array_equal(force.force_N, np.zeros(3))


def test_wind_turbine_rating_clamp_does_not_reduce_its_drag():
    """A saturated generator must keep paying full reaction drag.

    Reducing the drag with the power would hand momentum back to the vehicle
    that was never returned to the air -- free thrust, dressed as saturation.
    """
    from aerosim.env import atmosphere, make_uniform_field

    tiny = WindTurbine(swept_area_m2=0.5, generator_rated_power_W=1.0)
    big = WindTurbine(swept_area_m2=0.5, generator_rated_power_W=100000.0)
    atmo = atmosphere(1000.0)
    wind = make_uniform_field(0.0, 0.0, 0.0).sample(0.0, 0.0, 1000.0, 0.0)
    body = BodyState(pos_m=np.array([0.0, 0.0, 1000.0]),
                     vel_ms=np.array([20.0, 0.0, 0.0]), mass_kg=1.0)
    f_tiny = tiny.evaluate([body], atmo, wind, None, 0.0, 1.0)
    f_big = big.evaluate([body], atmo, wind, None, 0.0, 1.0)
    assert tiny.last_rating_limited is True
    assert f_tiny.power_elec_W == pytest.approx(1.0)
    assert np.allclose(f_tiny.force_N, f_big.force_N)


def test_wind_turbine_and_payload_are_not_weightless():
    """MUTATION: a massless extractor or payload is the free lunch to close."""
    from aerosim.vehicle.mass import MassClosureError

    assert WindTurbine(swept_area_m2=0.5, generator_rated_power_W=600.0).mass_kg > 0.0
    with pytest.raises(MassClosureError):
        WindTurbine(swept_area_m2=0.5, generator_rated_power_W=600.0, mass_kg=0.0)
    with pytest.raises(MassClosureError):
        PayloadLoad(5.8)                       # mass_kg omitted
    assert PayloadLoad(5.8, mass_kg=0.0).mass_kg == 0.0     # explicit zero is legal


# =========================================================================== #
# Provenance -- no hand-entered lift constant                                  #
# =========================================================================== #


def test_builders_reach_the_solver_and_hardcode_no_lift_constant():
    """The static AST proof, on every builder the suite uses."""
    for fn in V._PROVENANCE_TARGETS:
        report = V.assert_lift_is_solver_derived(fn)
        assert report["reaches_solver"] is True, fn.__name__
        assert report["hardcoded"] == [], fn.__name__


def test_provenance_guard_catches_a_hand_entered_lift_constant():
    """MUTATION: hand-enter the number the operator objected to."""
    def _offender():
        """A builder that assumes its own endurance parameter."""
        cl15_over_cd = 25.0
        return B.reference_trim, cl15_over_cd

    with pytest.raises(V.ValidationError) as exc:
        V.assert_lift_is_solver_derived(_offender)
    assert "cl15_over_cd = 25.0" in str(exc.value)


def test_provenance_guard_catches_a_builder_that_never_calls_the_solver():
    """MUTATION: a case that skips the solver entirely."""
    def _offender():
        """A builder that never touches aeropolar."""
        return 1.0

    with pytest.raises(V.ValidationError) as exc:
        V.assert_lift_is_solver_derived(_offender)
    assert "never reaches the aero solver" in str(exc.value)


# =========================================================================== #
# Slow: the two negative controls really do refuse to close                    #
# =========================================================================== #


def test_slow_quadcopter_does_not_close_even_at_double_the_harvest():
    """Negative control C must survive a 2x optimistic error and still fail.

    Round-4 update: the tech-catalogue frontier now refuses the doubled cell
    (0.474 efficiency at thin-film areal density) AT CONSTRUCTION -- the
    over-claim cannot even be built, which is a strictly stronger negative
    outcome than "built it and it still failed to close". The honest scale=1.0
    build must still construct AND still refuse to close; the mutated scale is
    allowed to die at either wall, but at one of them it must die.
    """
    from aerosim.vehicle import TechCatalogueError

    # The honest quadcopter must be constructible -- if the catalogue refuses
    # the REAL 0.237 cell the wall is miscalibrated, and this test goes red.
    build = D.build_quadcopter_hover(pv_efficiency_scale=1.0)
    result = integrate_energy(build.vehicle, build.env, 0.0, 86400.0, 60.0)
    assert result.closed is False, "the honest 1 kg quad must not close"

    # The 2x optimistic mutant must die at a NAMED wall: either the catalogue
    # refuses the fantasy cell at construction, or it runs and fails to close.
    try:
        build2 = D.build_quadcopter_hover(pv_efficiency_scale=2.0)
    except TechCatalogueError:
        pass  # refused at construction: the strongest form of "does not close"
    else:
        result2 = integrate_energy(build2.vehicle, build2.env, 0.0, 86400.0, 60.0)
        assert result2.closed is False, "a 2x harvest over-claim closed the quad"


def test_slow_uniform_wind_turbine_runs_a_net_loss():
    """Negative control D: extraction in a single reference frame must lose."""
    build = D.build_turbine_free_flier()
    result = integrate_energy(build.vehicle, build.env, 0.0, 86400.0, 60.0)
    energy = V.usable_energy(result)
    assert result.closed is False
    assert energy["margin_ratio_usable"] < 1.0
