"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression guards for the round-3 integrator
  |                                           | fixes: (1) unmet thrust billed at the vehicle
  |                                           | thruster's own actuator-disk price and visible
  |                                           | in closed_reasons, (2) the propulsion chain
  |                                           | read from figure_of_merit and RAISING outside
  |                                           | (0,1], (3) sub-diurnal windows refused when a
  |                                           | solar source is aboard, (4) the reaction-rule
  |                                           | exemption requiring the explicit declared flag
  |                                           | plus an irradiance*area bound, (5) consumer
  |                                           | draw billed per RK4 stage instead of frozen at
  |                                           | trim, and the battery/thruster second-wall
  |                                           | range re-validation at spec extraction.
-------------------------------------------------------------------------------

tests.test_billing -- every constructor parameter is range-checked or billed.

THE GOVERNING INVARIANT (round 3): every numeric parameter on every shipped element is
either (a) range-checked at construction AND re-checked at spec extraction inside the
integrator, or (b) billed -- it costs mass or energy proportionally, through the physics
that owns it.  And every guard exemption is an EXPLICIT declared opt-in, never inferred
from an attribute name.  Each test below is a reviewer probe (p2/p6, p10, p11, p13,
p3/p5/p8) reduced to a red/green assertion.

RUNNING
    python tests/test_billing.py                       (no pytest in the project venv)

UNITS
    SI throughout, carried in every name: _J joules, _W watts, _N newtons, _s seconds,
    _m metres, _ms metres/second, _m2 square metres, _kg kilograms, _Wh watt-hours.
"""

from __future__ import annotations

import dataclasses
import os
import sys
import traceback
import warnings

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aerosim.integrate import (                                              # noqa: E402
    FreeEnergyError,
    _battery_spec,
    _propulsion_chain_efficiency,
    _thruster_billing_spec,
    _unmet_propulsion_power_W,
    integrate_energy,
)
from aerosim.validate_designs import (                                       # noqa: E402
    DESIGN_A,
    build_quadcopter_hover,
    build_solar_cruise,
)
from aerosim.vehicle.state import ElementForce                               # noqa: E402

DAY_S: float = 86400.0              # s
H_S: float = 3600.0                 # s/h
J_PER_WH: float = 3600.0            # J/Wh


def _quiet_append(vehicle, element) -> None:
    """
    @description Append a test adversary to a vehicle's element list without tripping the
                 undeclared-mass warning machinery (the adversaries declare their masses).
    @param vehicle The vehicle.  @param element The element to add.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        vehicle.elements = list(vehicle.elements) + [element]


# ======================================================================================
# Fix 1 (probes p2 + p6) -- unmet thrust is billed at the element's own price, visibly
# ======================================================================================


def test_unmet_thrust_billed_at_element_price_and_not_closed() -> None:
    """
    @description Under-rating the motor used to be strictly profitable: the deficit was
                 billed flat T*V/eta with no induced-velocity term (150 W -> usable 1.0942;
                 1 W -> usable 1.1326, closed=True, monotone).  The bill is now the MARGINAL
                 actuator-disk cost on the vehicle's own disk -- bit-for-bit the shipped
                 Thruster's power law -- so the total propulsion bill is IDENTICAL whatever
                 the rating, and a motor that cannot fly its own trim is NOT closed.
    """
    runs = {}
    for pmax_W in (150.0, 5.0):
        design = dataclasses.replace(DESIGN_A, prop_max_electrical_W=pmax_W)
        build = build_solar_cruise(design)
        result = integrate_energy(build.vehicle, build.env, 0.0, DAY_S, 60.0)
        runs[pmax_W] = result

    out_150_Wh = float(runs[150.0].detail["energy_out_J"]) / J_PER_WH
    out_5_Wh = float(runs[5.0].detail["energy_out_J"]) / J_PER_WH
    assert out_5_Wh >= out_150_Wh - 1e-6, (
        f"under-rating the motor REDUCED the 24 h propulsion bill again: {out_5_Wh:.2f} Wh "
        f"at 5 W vs {out_150_Wh:.2f} Wh at 150 W -- the unmet path is undercutting the "
        "element's own actuator-disk price"
    )
    assert runs[5.0].detail["max_unmet_thrust_N"] > 1e-3, (
        "fixture drift: a 5 W drive is supposed to saturate at trim so the unmet path is "
        "actually exercised"
    )
    assert runs[5.0].closed is False, (
        "a design whose motor cannot fly its own trim certified as closed"
    )
    assert any("unmet thrust" in r for r in runs[5.0].detail["closed_reasons"]), (
        "saturation must be VISIBLE: unmet thrust above tolerance has to appear in "
        f"closed_reasons, got {runs[5.0].detail['closed_reasons']}"
    )

    # And the billing identity itself, bit-for-bit against the shipped element.
    thruster = [e for e in build_solar_cruise(DESIGN_A).vehicle.elements
                if hasattr(e, "max_electrical_power_W")][0]
    build = build_solar_cruise(DESIGN_A)
    spec = _thruster_billing_spec(build.vehicle)
    eta_chain = _propulsion_chain_efficiency(build.vehicle)
    V_ms, rho_kgm3 = 10.0, 1.16727
    for T_served_N, T_unmet_N in ((0.0, 2.5), (1.0, 1.5), (2.0, 5.0)):
        billed_W = _unmet_propulsion_power_W(spec, T_served_N, T_unmet_N, V_ms, rho_kgm3,
                                             eta_chain)
        marginal_W = (thruster.electrical_power_W(T_served_N + T_unmet_N, V_ms, rho_kgm3)
                      - thruster.electrical_power_W(T_served_N, V_ms, rho_kgm3))
        assert billed_W >= marginal_W - 1e-9, (
            f"unmet path bills {billed_W:.6f} W for {T_unmet_N} N on top of {T_served_N} N; "
            f"the element's own marginal price is {marginal_W:.6f} W -- a discount is back"
        )


# ======================================================================================
# Fix 2 -- the propulsion chain reads figure_of_merit and raises out of range
# ======================================================================================


def test_chain_reads_figure_of_merit_and_raises_outside_unit_interval() -> None:
    """
    @description _propulsion_chain_efficiency read el.eta_prop -- never defined by the
                 shipped Thruster -- and silently returned 0.6864 whatever the figure of
                 merit.  Case C's hover quad (FM 0.65, motor 0.85, ESC 0.95) must resolve to
                 exactly 0.524875, and a chain factor outside (0, 1] must RAISE, never be
                 substituted with a default (second wall: even on an element built around
                 its constructor).
    """
    quad = build_quadcopter_hover()
    eta = _propulsion_chain_efficiency(quad.vehicle)
    assert abs(eta - 0.65 * 0.85 * 0.95) < 1e-12, (
        f"case C's chain resolved to {eta!r}, not 0.524875 -- figure_of_merit is being "
        "ignored again"
    )

    class _ImpostorThruster:
        """A Thruster-shaped object built AROUND __init__: no construction checks ran."""

        max_electrical_power_W = 150.0      # W -> classifies KIND_THRUSTER
        diameter_m = 0.30                   # m
        n_rotors = 1
        figure_of_merit = 0.85
        eta_motor = 5.0                     # the free-energy knob
        eta_esc = 0.95
        body_index = 0
        offset_m = np.zeros(3)

    class _StubVehicle:
        bodies: list = []
        elements = [_ImpostorThruster()]

    try:
        _propulsion_chain_efficiency(_StubVehicle())
    except ValueError as exc:
        assert "eta_motor" in str(exc)
    else:
        raise AssertionError(
            "eta_motor = 5.0 slipped through spec extraction -- the chain is substituting "
            "a default instead of raising"
        )


# ======================================================================================
# Fix 3 (probe p10) -- no sub-diurnal closure verdict with a solar source aboard
# ======================================================================================


def test_sub_diurnal_window_cannot_certify_persistence() -> None:
    """
    @description The daylight half of a day that does NOT close used to certify closed=True
                 min_soc 0.9034.  With any PV element present, a window that is not an
                 integer multiple of 86400 s must force closed=False with an explicit reason
                 -- and a whole-day window must NOT carry that reason.
    """
    build = build_solar_cruise(DESIGN_A)
    half = integrate_energy(build.vehicle, build.env, 12.0 * H_S, 24.0 * H_S, 60.0)
    assert half.closed is False, (
        "a 12 h daylight window with a solar source aboard certified closed=True"
    )
    assert any("integer multiple" in r for r in half.detail["closed_reasons"]), (
        f"the sub-diurnal refusal must be an explicit closed_reason, got "
        f"{half.detail['closed_reasons']}"
    )

    build2 = build_solar_cruise(DESIGN_A)
    full = integrate_energy(build2.vehicle, build2.env, 0.0, DAY_S, 60.0)
    assert not any("integer multiple" in r for r in full.detail["closed_reasons"]), (
        "a whole-day window was refused as sub-diurnal -- the guard is firing on correct "
        "usage"
    )


# ======================================================================================
# Fix 4 (probe p11) -- the exemption is an explicit declared opt-in, and it is bounded
# ======================================================================================


class _ZeroForceGenerator:
    """A zero-force +200 W element -- the exemption adversary. Declares its (zero) mass."""

    DECLARES_MASS_CLOSURE = True
    mass_kg = 0.0
    body_index = 0
    offset_m = np.zeros(3)

    def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):  # noqa: ANN001, ANN201
        """@returns +200 W for exactly zero force, forever."""
        return ElementForce(np.zeros(3), np.zeros(3), 200.0)


def test_packing_factor_no_longer_buys_the_exemption() -> None:
    """
    @description KIND_PV used to be awarded to anything carrying an attribute called
                 packing_factor, and KIND_PV was exempt from the generation-reaction rule:
                 one attribute turned a magic generator into certified free energy
                 (closed=True, min_soc=1.0).  Classification must grant NOTHING.
    """
    class _Impostor(_ZeroForceGenerator):
        packing_factor = 1.0                # the one attribute that used to buy it

    build = build_solar_cruise(DESIGN_A)
    _quiet_append(build.vehicle, _Impostor())
    try:
        integrate_energy(build.vehicle, build.env, 0.0, DAY_S, 60.0)
    except FreeEnergyError:
        return
    raise AssertionError(
        "a zero-force +200 W element with packing_factor = 1.0 was exempted by its "
        "attribute name again"
    )


def test_flag_without_area_gets_no_exemption() -> None:
    """
    @description An element declaring non_mechanical_source = True but no declarable
                 collecting area has nothing to bound its output against, so it gets NO
                 exemption and the reaction rule kills it.
    """
    class _NoArea(_ZeroForceGenerator):
        non_mechanical_source = True        # explicit flag, but no area_m2 anywhere

    build = build_solar_cruise(DESIGN_A)
    _quiet_append(build.vehicle, _NoArea())
    try:
        integrate_energy(build.vehicle, build.env, 0.0, DAY_S, 60.0)
    except FreeEnergyError:
        return
    raise AssertionError(
        "an exempt-flagged element with NO declarable collecting area kept its exemption"
    )


def test_exempt_element_is_bounded_by_irradiance_times_area() -> None:
    """
    @description The exemption's price: p_elec <= irradiance_at(pos, t) * area * 1.0.  A
                 properly flagged 1 m^2 'collector' reporting 200 W at NIGHT (the case-A
                 window starts at sunset) out-generates a zero-irradiance sky and must raise.
    """
    class _NightSun(_ZeroForceGenerator):
        non_mechanical_source = True
        area_m2 = 1.0                       # m^2, declared -- so the bound applies

    build = build_solar_cruise(DESIGN_A)
    _quiet_append(build.vehicle, _NightSun())
    try:
        integrate_energy(build.vehicle, build.env, 0.0, DAY_S, 60.0)
    except FreeEnergyError as exc:
        assert "out-generate the sun" in str(exc)
        return
    raise AssertionError(
        "a declared 1 m^2 collector generating 200 W at night was not stopped by the "
        "irradiance * area bound"
    )


def test_honest_pv_array_keeps_the_exemption() -> None:
    """
    @description The shipped PVArray (explicit flag + real area, total efficiency < 1) must
                 survive a full day untouched -- a guard that also fires on the honest
                 element teaches everyone to route around it.
    """
    build = build_solar_cruise(DESIGN_A)
    result = integrate_energy(build.vehicle, build.env, 0.0, DAY_S, 60.0)
    assert float(np.max(result.power_in_W)) > 50.0, (
        "fixture drift: case A's array is supposed to generate real daytime power so the "
        "bound is actually exercised"
    )


# ======================================================================================
# Fix 5 (probe p13) -- loads are billed per RK4 stage, not frozen at trim
# ======================================================================================


def test_duty_cycled_load_is_billed_per_stage() -> None:
    """
    @description A load of 5 W for the first 60 s and 500 W thereafter was billed at its
                 trim-time 5 W for the whole day: 48.58 W reported against an honest
                 543.23 W (11.2x).  The re-evaluable consumers' draw must now be accumulated
                 per RK4 stage, so adding this element raises the mean bus draw by its true
                 time average (~499.66 W), not its trim snapshot.
    """
    class _DutyCycledPayload:
        DECLARES_MASS_CLOSURE = True
        mass_kg = 0.150                     # kg
        body_index = 0
        offset_m = np.zeros(3)

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):  # noqa: ANN001, ANN201
            """@returns -5 W before t = 60 s, -500 W after."""
            return ElementForce(np.zeros(3), np.zeros(3),
                                -(5.0 if t_s < 60.0 else 500.0))

    base_build = build_solar_cruise(DESIGN_A)
    base = integrate_energy(base_build.vehicle, base_build.env, 0.0, DAY_S, 60.0)

    build = build_solar_cruise(DESIGN_A)
    _quiet_append(build.vehicle, _DutyCycledPayload())
    loaded = integrate_energy(build.vehicle, build.env, 0.0, DAY_S, 60.0)

    honest_mean_W = (5.0 * 60.0 + 500.0 * (DAY_S - 60.0)) / DAY_S     # ~499.66 W
    delta_W = float(np.mean(loaded.power_out_W)) - float(np.mean(base.power_out_W))
    assert abs(delta_W - honest_mean_W) < 5.0, (
        f"the duty-cycled load added {delta_W:.2f} W to the mean bus draw; its honest time "
        f"average is {honest_mean_W:.2f} W -- the load is frozen at its trim-time value "
        "again"
    )
    assert loaded.closed is False, (
        "a 500 W continuous load on case A's bus cannot close; it certified anyway"
    )


# ======================================================================================
# Defense in depth -- the second wall at spec extraction
# ======================================================================================


def test_battery_spec_revalidates_ranges() -> None:
    """
    @description The shipped BatteryElement range-checks at construction (first wall); a
                 pack built AROUND __init__ still reaches _battery_spec, where eta > 1 mints
                 energy every round trip and soc_max > 1 is stored energy the billed mass
                 never paid for.  Same bounds, second wall: spec extraction must raise.
    """
    def _pack(**attrs):
        class _ImpostorPack:
            capacity_J = 1.0e6              # J -> classifies KIND_BATTERY
            initial_soc = 0.5
            eta_charge = 0.95
            eta_discharge = 0.95
            soc_min = 0.05
            soc_max = 1.0
            body_index = 0
            offset_m = np.zeros(3)

            def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):  # noqa: ANN001, ANN201
                return ElementForce(np.zeros(3), np.zeros(3), 0.0)

        pack = _ImpostorPack()
        for key, val in attrs.items():
            setattr(pack, key, val)

        class _StubVehicle:
            bodies: list = []
            elements = [pack]

        return _StubVehicle()

    for attrs in (dict(eta_charge=2.0), dict(eta_discharge=2.0), dict(soc_max=3.0),
                  dict(soc_min=-5.0), dict(initial_soc=3.0),
                  dict(soc_min=0.9, soc_max=0.1)):
        try:
            _battery_spec(_pack(**attrs))
        except ValueError:
            continue
        raise AssertionError(
            f"a storage element built around its constructor with {attrs} passed spec "
            "extraction -- the second wall is down"
        )

    # And the wall must NOT fire on an honest pack (a guard that rejects everything
    # is not a guard).
    spec = _battery_spec(_pack())
    assert spec.capacity_J == 1.0e6


# ======================================================================================
# Runner
# ======================================================================================

TESTS = [
    test_unmet_thrust_billed_at_element_price_and_not_closed,
    test_chain_reads_figure_of_merit_and_raises_outside_unit_interval,
    test_sub_diurnal_window_cannot_certify_persistence,
    test_packing_factor_no_longer_buys_the_exemption,
    test_flag_without_area_gets_no_exemption,
    test_exempt_element_is_bounded_by_irradiance_times_area,
    test_honest_pv_array_keeps_the_exemption,
    test_duty_cycled_load_is_billed_per_stage,
    test_battery_spec_revalidates_ranges,
]


def main() -> int:
    """
    @description Run every guard and report pass/fail per test.
    @returns Process exit code: 0 when every guard is green, 1 otherwise.
    """
    warnings.simplefilter("ignore")
    failures = 0
    for fn in TESTS:
        try:
            fn()
        except BaseException:                      # noqa: BLE001 -- report, do not mask
            failures += 1
            print(f"FAIL  {fn.__name__}")
            traceback.print_exc()
        else:
            print(f"ok    {fn.__name__}")
    print(f"\n{len(TESTS) - failures}/{len(TESTS)} guards green")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
