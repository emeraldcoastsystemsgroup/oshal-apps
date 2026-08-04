"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression guards for the three fatal defects
  |                                           | found in aerosim.integrate: (1) unbilled
  |                                           | along-track drag manufacturing energy in the
  |                                           | slow loop, (2) 'closed' being a one-window test
  |                                           | that certified daily-deficit designs, and (3)
  |                                           | the free-energy guard being computed and then
  |                                           | discarded so it failed OPEN.  Every test here
  |                                           | is a REPRO that was confirmed to reproduce the
  |                                           | defect before the fix; each asserts the gate is
  |                                           | now RED.
2 | maintainer@emeraldcoastsystemsgroup.com   | Rebuilt every fixture on PUBLIC shipped
  |                                           | elements. validate.py's private stand-ins
  |                                           | (_TrimmedCruiseLoad, _TurbineElement,
  |                                           | _ConstantElectricalLoad, _IdealLiftSupport,
  |                                           | _TurbineStationKeeping) were the root cause
  |                                           | of the validation defect and were deleted;
  |                                           | the turbine and the payload load are now
  |                                           | vehicle.WindTurbine and vehicle.PayloadLoad,
  |                                           | and the trimmed-cruise and station-keeping
  |                                           | stand-ins are AeroSurface + Thruster driven
  |                                           | by the integrator's own autothrottle. Every
  |                                           | assertion's INTENT is unchanged.
3 | maintainer@emeraldcoastsystemsgroup.com   | Round-3 fixture re-measurement: DESIGN_B
  |                                           | now bills its wing honestly (19.96 kg) and
  |                                           | carries 40 kg of 445.5 Wh/kg pack instead
  |                                           | of the impossible 48 kg of 337.5, so the
  |                                           | false-pass packing band MOVED. Re-measured
  |                                           | on this tree: 0.30-0.50 are false passes
  |                                           | (seeded min_soc 0.133-0.165 vs the true
  |                                           | limit cycle on the 0.05 floor); 0.55 now
  |                                           | GENUINELY closes (+1986 Wh/day, limit-cycle
  |                                           | min_soc 0.1247) and is excluded. Assertion
  |                                           | intent unchanged.
-------------------------------------------------------------------------------

tests.test_no_free_energy -- the free-energy and persistence guards.

WHY THESE TESTS EXIST
    The point of this simulator is to sweep ~30,000 candidate aircraft and let an OPTIMIZER
    pick winners.  An optimizer is an adversary: it finds every unbilled cost and every
    massless resource and it drives straight into it.  Each defect below was a resource the
    optimizer could have mined:

      FATAL 1  drag was optional.  integrate_energy pinned the vehicle's velocity but only
               ever solved the VERTICAL balance; the along-track deficit was handed to the
               thrusters and, when they saturated or were absent, silently DISCARDED.  A
               vehicle with a turbine and a 300 W thruster flew forever in STILL AIR at a
               sustained +249 W net.
      FATAL 2  'closed' was min_soc over ONE window seeded with a free full battery, so a
               design running a 6.6% daily deficit certified as closed and died on night two.
      FATAL 3  max_gen_violation_W was computed every step and then thrown into a dict.  A
               zero-force element returning +1000 W produced closed=True, min_soc=1.0.

RUNNING
    python tests/test_no_free_energy.py          (no pytest in the project venv)
    python -m pytest tests/test_no_free_energy.py -q   (if pytest is ever installed)

UNITS
    SI throughout, carried in every name: _J joules, _W watts, _N newtons, _s seconds,
    _m metres, _ms metres/second, _m2 square metres, _kg kilograms, _Wh watt-hours.
"""

from __future__ import annotations

import os
import sys
import traceback

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aerosim.env import make_uniform_field                                    # noqa: E402
from aerosim.integrate import (                                              # noqa: E402
    EnvBundle,
    FreeEnergyError,
    assert_no_free_energy,
    integrate_dynamic,
    integrate_energy,
)
from aerosim.validate_designs import (                                       # noqa: E402
    DESIGN_B,
    _naca_geometry,
    build_solar_cruise,
)
from aerosim.vehicle import (                                                # noqa: E402
    AeroSurface,
    BatteryElement,
    BodyState,
    ElementForce,
    PayloadLoad,
    Thruster,
    Vehicle,
    WindTurbine,
    naca4_geometry,
)

#: Generator ratings large enough that no fixture below is ever clamped by them.
#: A clamp would be legitimate physics but would quietly change what these guards
#: measure, so the ratings are stated once and kept clear of the operating point.
_UNCLAMPED_RATING_W: float = 5000.0
from aerosim.vehicle.mass import (                                           # noqa: E402
    PACK_ATLANTIKSOLAR_WH_PER_KG,
    PACK_SI_ANODE_WH_PER_KG,
    PV_LAMINATED_FLEXIBLE_KG_M2,
)

J_PER_WH: float = 3600.0            # J/Wh
G0_MS2: float = 9.80665             # m/s^2
DAY_S: float = 86400.0              # s


# ======================================================================================
# Fixtures -- the two reviewer repro vehicles, verbatim in physics
# ======================================================================================


def _still_air_env() -> EnvBundle:
    """
    @description The field in which the physics forbids extraction outright: PERFECTLY STILL
                 AIR.  A uniform field has an inertial air-relative frame, and a still field
                 is the degenerate case of one, so a free-flier in it has no reservoir at all
                 beyond its own kinetic and potential energy.
    @returns EnvBundle with a zero uniform wind field, equator, solstice.
    """
    return EnvBundle(
        wind=make_uniform_field(0.0, 0.0, 0.0),
        latitude_deg=0.0,
        longitude_deg=0.0,
        day_of_year=172,
        utc_hour_at_t0_h=0.0,
    )


def _turbine_freeflier() -> Vehicle:
    """
    @description REPRO_free_energy.py's vehicle: a real wing, a real momentum-theory turbine,
                 a thruster whose 300 W budget CANNOT cancel the turbine's reaction drag, and
                 a battery.  EVERY element is now public aerosim.vehicle code, including the
                 turbine (vehicle.WindTurbine), which bills its own reaction force -- so the
                 manufactured energy was never the element's fault.  It was the integrator
                 discarding the residual.
    @returns Vehicle.
    """
    geometry = naca4_geometry("2412", span_m=5.65, area_m2=1.72, taper_ratio=0.7)
    elements = [
        AeroSurface(geometry=geometry, incidence_deg=4.0, extra_CD0=0.006),
        WindTurbine(swept_area_m2=2.0, generator_rated_power_W=_UNCLAMPED_RATING_W,
                    cp=0.40, eta_gen=0.90),
        Thruster(diameter_m=0.30, max_electrical_power_W=300.0),
        BatteryElement(
            capacity_J=703.0 * J_PER_WH,
            initial_soc=1.0,
            specific_energy_Wh_per_kg=PACK_ATLANTIKSOLAR_WH_PER_KG,
        ),
    ]
    body = BodyState(
        pos_m=np.array([0.0, 0.0, 1000.0]),
        vel_ms=np.array([10.0, 0.0, 0.0]),
        mass_kg=6.93,
    )
    return Vehicle(bodies=[body], elements=elements)


def _bare_wing_freeflier() -> Vehicle:
    """
    @description The PUREST form of FATAL 1: a wing and a battery, NO thruster at all.  The
                 wing's own drag was never charged to anything, so this flew a 24 h window at
                 power_out = 0.00 W with margin = inf and closed = True.  Drag was optional.
    @returns Vehicle.
    """
    geometry = naca4_geometry("2412", span_m=5.65, area_m2=1.72, taper_ratio=0.7)
    elements = [
        AeroSurface(geometry=geometry, incidence_deg=4.0, extra_CD0=0.006),
        BatteryElement(
            capacity_J=703.0 * J_PER_WH,
            initial_soc=1.0,
            specific_energy_Wh_per_kg=PACK_ATLANTIKSOLAR_WH_PER_KG,
        ),
    ]
    body = BodyState(
        pos_m=np.array([0.0, 0.0, 1000.0]),
        vel_ms=np.array([10.0, 0.0, 0.0]),
        mass_kg=6.93,
    )
    return Vehicle(bodies=[body], elements=elements)


class MagicGenerator:
    """
    @description The reviewer's FATAL 3 repro element: electricity from nothing.  It exerts
                 NO force, so it removes NO momentum from the flow, and yet it reports
                 +power_W at the bus.  It is not classified as a photovoltaic and it does not
                 declare non_mechanical_source, so _GENERATION_REACTION_RULE must reject it.

                 This is a TEST ADVERSARY, deliberately unphysical -- it is the thing the
                 guard exists to catch, not a modelling shortcut.  Before the fix the guard
                 measured it correctly (max_gen_violation_W = 1000.0) and then reported
                 closed=True, min_soc=1.0: the guard failed OPEN.
    @param power_W Electrical power conjured, watts.
    """

    def __init__(self, power_W: float = 1000.0, body_index: int = 0) -> None:
        self.power_W = float(power_W)            # W
        self.body_index = int(body_index)
        self.offset_m = np.zeros(3, dtype=float)  # m
        #: Declares itself weightless so the mass-closure warning is not a false alarm; it
        #: really is a fiction, and its mass is not what is under test.
        self.MASSLESS_BY_CONSTRUCTION = True

    def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s) -> ElementForce:  # noqa: ANN001
        """
        @description Zero force, positive power. @returns ElementForce.
        """
        return ElementForce(
            force_N=np.zeros(3, dtype=float),
            moment_Nm=np.zeros(3, dtype=float),
            power_elec_W=+self.power_W,
        )


def _magic_generator_vehicle() -> Vehicle:
    """
    @description The reviewer's FATAL 3 repro: a 5 kg free-flier carrying a MagicGenerator,
                 a 300 W load and a 1e6 J pack, in a uniform zero-wind field.
    @returns Vehicle.
    """
    geometry = naca4_geometry("2412", span_m=5.0, area_m2=1.5, taper_ratio=0.8)
    elements = [
        AeroSurface(geometry=geometry, incidence_deg=4.0, extra_CD0=0.006),
        MagicGenerator(power_W=1000.0),
        PayloadLoad(300.0, mass_kg=0.0, label="payload"),
        BatteryElement(
            capacity_J=1.0e6,
            initial_soc=1.0,
            specific_energy_Wh_per_kg=PACK_ATLANTIKSOLAR_WH_PER_KG,
        ),
    ]
    body = BodyState(
        pos_m=np.array([0.0, 0.0, 1000.0]),
        vel_ms=np.array([15.0, 0.0, 0.0]),
        mass_kg=5.0,
    )
    return Vehicle(bodies=[body], elements=elements)


#: The deficit fixture IS validation case B, with only the array coverage moved.
#: It used to be a hand-maintained COPY of the case "so it is reproducible without
#: importing validate's case function" -- and the copy is exactly how a guard stops
#: testing what it was written for. After mass closure and the propulsion change the
#: copy failed to close at ANY packing, so these limit-cycle guards were measuring a
#: design that had drifted away from the case they exist to protect. Delegating keeps
#: them in lockstep: if case B's design point moves, these move with it.
_ZEPHYR_ALL_UP_MASS_KG: float = DESIGN_B.mass_all_up_kg    # kg
_ZEPHYR_WING_AREA_M2: float = DESIGN_B.area_m2             # m^2
_ZEPHYR_ALTITUDE_M: float = DESIGN_B.altitude_m            # m MSL


def _zephyr_like(pv_packing: float) -> tuple[Vehicle, EnvBundle]:
    """
    @description Validation case B (Zephyr-S class HAPS at 20 km, 10 N, solstice) with the
                 solar array coverage as a free parameter.  At the shipped 0.90 it closes;
                 cut the array back and it runs a DAILY DEFICIT that a one-window test could
                 not see.  Built from PUBLIC shipped elements by the case's own builder, so
                 the vehicle here and the vehicle the gate certifies are the same object.

                 MASS CLOSURE is the builder's: BodyState.mass_kg is the STRUCTURE mass and
                 each element adds its own on top, with the structure solved backwards from
                 the published 75 kg all-up.  Shrinking the array therefore also makes the
                 aircraft lighter, which is the honest coupling and is why the deficit band
                 is narrower than it was on the pre-mass-closure tree.
    @param pv_packing Fraction of the wing laminated with cells, dimensionless 0..1.
    @returns (Vehicle, EnvBundle) anchored so t = 0 is local sunset -- the only start that
             puts the whole night first.
    """
    build = build_solar_cruise(DESIGN_B, pv_packing_override=float(pv_packing))
    return build.vehicle, build.env


# ======================================================================================
# FATAL 1 -- unbilled along-track drag
# ======================================================================================


def test_turbine_freeflier_in_still_air_cannot_net_generate() -> None:
    """
    @description REPRO_free_energy.py.  Before the fix: power_in 549.37 W, power_out 300.00 W,
                 NET +249.37 W sustained for 24 h in STILL AIR, closed=True, min_soc 1.000.
                 The turbine billed its reaction drag honestly; the INTEGRATOR discarded the
                 along-track residual once the 300 W thruster saturated.
    """
    vehicle = _turbine_freeflier()
    result = integrate_energy(vehicle, _still_air_env(), 0.0, DAY_S, 60.0)
    net_W = float(np.mean(result.power_in_W - result.power_out_W))

    assert net_W <= 0.0, (
        f"FREE ENERGY: a free-flier in STILL AIR netted {net_W:+.2f} W. In a uniform field "
        "the air is at rest in the vehicle's own frame -- there is no reservoir."
    )
    assert result.detail["max_unmet_thrust_N"] > 0.0, (
        "the 300 W thruster CANNOT cancel this turbine's reaction drag, so an unmet "
        "along-track force must have been measured; measuring 0 N means the residual is "
        "being silently absorbed again"
    )
    assert result.detail["unmet_propulsion_J"] > 0.0, (
        "the unmet along-track force must be BILLED as propulsive energy, not merely counted"
    )
    assert result.closed is False, (
        "a vehicle that spends more than it makes in still air must not certify as closed"
    )


def test_bare_wing_pays_for_its_own_drag() -> None:
    """
    @description The purest form of FATAL 1.  Before the fix a wing + battery with NO thruster
                 flew a 24 h window at power_out = 0.00 W, margin = inf and closed = True --
                 the wing's own drag was never charged to anything at all.
    """
    vehicle = _bare_wing_freeflier()
    result = integrate_energy(vehicle, _still_air_env(), 0.0, DAY_S, 60.0)

    assert float(np.min(result.power_out_W)) > 0.0, (
        "a wing holding altitude in still air is doing work against its own drag every "
        f"second; power_out floor was {float(np.min(result.power_out_W)):.4f} W"
    )
    assert result.closed is False, (
        "a vehicle with no energy source at all cannot fly for a day and certify as closed"
    )
    # The billed power must be the real thing: drag * V / chain, i.e. large enough to drain
    # the pack.  A token non-zero number would still be an exploitable under-charge.
    energy_out_Wh = float(result.detail["energy_out_J"]) / J_PER_WH
    assert energy_out_Wh > float(703.0), (
        f"24 h of billed propulsion came to only {energy_out_Wh:.1f} Wh, less than the "
        "703 Wh pack -- the drag bill is being under-charged"
    )


# ======================================================================================
# FATAL 3 -- the guard must not fail open
# ======================================================================================


def test_magic_generator_raises_in_slow_loop() -> None:
    """
    @description The reviewer's FATAL 3 repro.  Before the fix integrate_energy returned
                 closed=True, min_soc=1.0, power_in 1000.0 W, power_out 300.0 W and stashed
                 detail['max_gen_violation_W'] = 1000.0 where nothing ever read it.
    """
    vehicle = _magic_generator_vehicle()
    try:
        result = integrate_energy(vehicle, _still_air_env(), 0.0, DAY_S, 60.0)
    except FreeEnergyError as exc:
        assert "FREE ENERGY DETECTED" in str(exc)
        return
    raise AssertionError(
        "integrate_energy did NOT raise on a zero-force element generating 1000 W. "
        f"closed={result.closed}, min_soc={result.min_soc}, "
        f"max_gen_violation_W={result.detail.get('max_gen_violation_W')} -- "
        "the guard is failing OPEN again."
    )


def test_magic_generator_raises_in_fast_loop() -> None:
    """
    @description The same adversary through the OTHER integrator.  integrate_dynamic recorded
                 the violation too and also never acted on it.
    """
    vehicle = _magic_generator_vehicle()
    try:
        result = integrate_dynamic(vehicle, _still_air_env(), 0.0, 5.0, 0.05)
    except FreeEnergyError as exc:
        assert "FREE ENERGY DETECTED" in str(exc)
        return
    raise AssertionError(
        "integrate_dynamic did NOT raise on a zero-force element generating 1000 W. "
        f"max_gen_violation_W={result.detail.get('max_gen_violation_W')}"
    )


def test_magic_generator_raises_in_randomised_gate() -> None:
    """
    @description assert_no_free_energy already caught this one before the fix; it is asserted
                 here so the cheap per-step guard and the expensive randomised gate can never
                 drift apart in what they consider a violation.
    """
    vehicle = _magic_generator_vehicle()
    try:
        assert_no_free_energy(vehicle, n_trajectories=3, seed=0, cycle_period_s=2.0)
    except FreeEnergyError as exc:
        assert "FREE ENERGY DETECTED" in str(exc)
        return
    raise AssertionError("assert_no_free_energy did NOT raise on the MagicGenerator vehicle")


def _turbine_plus_stationkeeper() -> tuple[Vehicle, EnvBundle]:
    """
    @description Validation case D's shape, on SHIPPED elements: a real wing, a
                 momentum-theory turbine, and the propulsor that cancels the turbine's
                 reaction drag under the integrator's own autothrottle.  The turbine is
                 legitimately generating about 338 W out of the 375 W it takes from the flow
                 at the disk, and the propulsor pays far more electricity than that to put
                 the momentum back.

                 The former fixture used a drag-free _IdealLiftSupport and a
                 _TurbineStationKeeping that priced its own thrust; both were private
                 stand-ins and both are gone.  A REAL wing adds its own drag, which makes the
                 vehicle's net fluid force non-zero -- so this fixture is now a WEAKER
                 provocation of the false positive than the netting bug needed.  The guard
                 below therefore also asserts the turbine's extraction is large and positive,
                 which is what actually exercises the per-element flooring.
    @returns (Vehicle, EnvBundle) in a uniform 8 m/s field at 15 m/s airspeed.
    """
    from aerosim.env import atmosphere
    from aerosim.vehicle.mass import PACK_LI_PO_HOBBY_WH_PER_KG

    altitude_m = 1000.0
    all_up_mass_kg = 5.0
    wind_u_ms = 8.0
    airspeed_ms = 15.0
    capacity_J = 1.0e6
    rho_kgm3 = float(atmosphere(altitude_m).rho_kgm3)
    turbine = WindTurbine(swept_area_m2=0.5, generator_rated_power_W=600.0,
                          cp=0.40, eta_gen=0.90)
    battery = BatteryElement(
        capacity_J=capacity_J, initial_soc=1.0, body_index=0,
        specific_energy_Wh_per_kg=PACK_LI_PO_HOBBY_WH_PER_KG,
    )
    thruster = Thruster(diameter_m=0.4, max_electrical_power_W=3000.0,
                        figure_of_merit=0.85, eta_motor=0.85, eta_esc=0.95,
                        axis=np.array([1.0, 0.0, 0.0]))
    geometry = _naca_geometry(span_m=3.0, area_m2=0.6, taper_ratio=0.7, sweep_deg=0.0,
                              twist_root_deg=2.0, twist_tip_deg=0.0)
    surface = AeroSurface(geometry=geometry, incidence_deg=0.0, extra_CD0=0.010)
    surface.incidence_deg = surface.trim_alpha_for_lift_N(
        all_up_mass_kg * G0_MS2, airspeed_ms, rho_kgm3,
        float(atmosphere(altitude_m).mu_Pas))
    body = BodyState(
        pos_m=np.array([0.0, 0.0, altitude_m], dtype=float),
        vel_ms=np.array([wind_u_ms + airspeed_ms, 0.0, 0.0], dtype=float),
        mass_kg=all_up_mass_kg - turbine.mass_kg - battery.mass_kg - thruster.mass_kg,
    )
    vehicle = Vehicle(bodies=[body], elements=[surface, turbine, thruster, battery])
    env = EnvBundle(
        wind=make_uniform_field(wind_u_ms, 0.0, 0.0),
        latitude_deg=10.0, longitude_deg=0.0, day_of_year=172, utc_hour_at_t0_h=12.0,
    )
    return vehicle, env


def test_extractor_plus_propulsor_is_not_a_false_positive() -> None:
    """
    @description The vehicle-level generation budget must sum extraction PER ELEMENT and
                 floor each term at zero, never take -sum(F_fluid) . v_air.  A vehicle that
                 carries both a turbine and the propulsor that cancels its drag has a NET
                 fluid force of exactly zero; the net form declared its wholly legitimate
                 338 W a violation and raised on validation case D at t = 0.

                 A guard that fires on correct physics is worse than no guard: it trains
                 everyone to route around it.
    """
    vehicle, env = _turbine_plus_stationkeeper()
    result = integrate_dynamic(vehicle, env, 0.0, 5.0, 0.05)

    assert float(np.max(result.power_in_W)) > 100.0, (
        "fixture drift: this turbine is supposed to be generating real power, so the guard "
        "is actually being exercised"
    )
    assert float(result.detail["max_gen_surplus_W"]) <= 1e-6, (
        "the vehicle-level budget flagged a legitimate extractor+propulsor pair; the "
        "extraction terms are being netted against each other again"
    )
    assert float(np.mean(result.power_in_W - result.power_out_W)) < 0.0, (
        "station-keeping against a turbine's own drag must cost more than the turbine makes"
    )


def test_honest_vehicle_passes_the_gate() -> None:
    """
    @description The guard must be sharp, not merely loud: a vehicle whose every element bills
                 its reaction force has to survive.  Without this, "raise on everything" would
                 pass the three tests above and the guard would be worthless.
    """
    vehicle = _turbine_freeflier()
    assert_no_free_energy(vehicle, n_trajectories=3, seed=0, cycle_period_s=2.0)


# ======================================================================================
# FATAL 2 -- closure is a limit-cycle test
# ======================================================================================


def test_daily_deficit_design_is_not_closed() -> None:
    """
    @description The case-B airframe with the array shrunk to pv_packing = 0.45.  It runs a
                 NET DAILY DEFICIT, so no periodic state above the floor exists and it dies on
                 night two -- yet one 24 h window seeded with a free full battery reported
                 min_soc 0.0807 and closed=True.  (The reviewer measured the deficit at 6.6%
                 of daily throughput on the pre-mass-closure tree; on this tree the same
                 packing measures about 1.8%.  The sign is what the guard is about, and it is
                 the same sign.)
    """
    vehicle, env = _zephyr_like(pv_packing=0.45)
    result = integrate_energy(vehicle, env, 0.0, DAY_S, 60.0)

    margin_J = float(result.detail["energy_margin_J"])
    assert margin_J < 0.0, (
        "fixture drift: this design is supposed to run a daily deficit, but the window "
        f"margin came out {margin_J / J_PER_WH:+.1f} Wh"
    )
    assert result.closed is False, (
        f"a design running a {-margin_J / J_PER_WH:.0f} Wh/day deficit certified as CLOSED "
        f"(min_soc={result.min_soc:.4f}). Closure is a limit-cycle test, not one window."
    )
    assert result.detail["limit_cycle_sustainable"] is False, (
        "a negative daily balance means no periodic state above the floor exists"
    )
    assert float(result.detail["unabsorbed_shortfall_J"]) > 0.0, (
        "on its limit cycle this design leaves demand unserved; that must be surfaced, not "
        "hidden inside a clipped state of charge"
    )


def test_false_pass_band_is_closed_everywhere() -> None:
    """
    @description Sweep the whole measured false-pass band.  A single point could be a lucky
                 escape; the defect was that an entire CONTIGUOUS BAND of under-arrayed
                 designs certified.  RE-MEASURED for round 3 (DESIGN_B now bills its
                 19.96 kg wing and carries 40 kg of 445.5 Wh/kg pack): every packing from
                 0.30 to 0.50 reports a seeded min_soc between 0.133 and 0.165 -- the old
                 one-window verdict closes all of them -- while the true limit cycle sits
                 on the 0.05 floor with daily deficits of 753 to 11712 Wh.  0.55, in the
                 band on the pre-round-3 tree, now GENUINELY closes (+1986 Wh/day,
                 limit-cycle min_soc 0.1247) and is excluded for that measured reason
                 rather than dropped silently.
    """
    bad: list[str] = []
    not_a_false_pass: list[str] = []
    for packing in (0.30, 0.35, 0.40, 0.45, 0.50):
        vehicle, env = _zephyr_like(pv_packing=packing)
        result = integrate_energy(vehicle, env, 0.0, DAY_S, 60.0)
        seeded = float(result.detail["min_soc_as_seeded"])
        soc_min = float(result.detail["soc_min"])
        # The OLD verdict, computed here rather than mutated in, so this test proves the band
        # is still a false-pass band and cannot quietly stop testing anything.
        old_verdict_closed = seeded > soc_min + 1e-9
        if not old_verdict_closed:
            not_a_false_pass.append(
                f"packing={packing:.2f} seeded min_soc={seeded:.4f}"
            )
        if result.closed:
            bad.append(
                f"packing={packing:.2f} closed=True "
                f"margin={float(result.detail['energy_margin_J']) / J_PER_WH:+.0f} Wh/day"
            )
    assert not not_a_false_pass, (
        "fixture drift: these packings are no longer in the false-pass band, so this test "
        "has stopped testing the defect it was written for: " + "; ".join(not_a_false_pass)
    )
    assert not bad, "designs in the known false-pass band still certify as closed: " + \
        "; ".join(bad)


def test_min_soc_is_the_limit_cycle_not_the_seeded_window() -> None:
    """
    @description Even the SHIPPED case B overstated its floor -- the reviewer measured 0.1103
                 reported against a true limit-cycle 0.0807, a 37% overstatement -- because
                 the window was seeded with a full battery it never had to earn.  On this tree
                 the same design measures 0.1067 seeded against 0.0769 on the limit cycle.

                 The window starts at local SUNSET, so a design on its limit cycle enters the
                 night with whatever the previous day left it, which is strictly less than a
                 free full pack.  The reported floor must therefore be STRICTLY below the
                 seeded floor: equality would mean the free full pack is back.
    """
    vehicle, env = _zephyr_like(pv_packing=0.90)
    result = integrate_energy(vehicle, env, 0.0, DAY_S, 60.0)

    seeded = float(result.detail["min_soc_as_seeded"])
    assert result.min_soc < seeded - 1e-6, (
        f"reported min_soc {result.min_soc:.4f} is not below the seeded-window floor "
        f"{seeded:.4f} -- the run is being credited with a full battery at sunset that the "
        "previous day never actually delivered"
    )
    assert result.detail["closure_mode"] == "limit-cycle"
    assert float(result.detail["limit_cycle_soc0"]) < 1.0 - 1e-9, (
        "the limit-cycle start of charge came out full; the fixed point is not being solved"
    )
    assert result.closed is True, (
        "the shipped case-B design does close; a guard that rejects everything is not a guard"
    )


def test_initial_soc_is_not_silently_full() -> None:
    """
    @description integrate.py read soc0 = getattr(el, 'initial_soc', 1.0) against an element
                 that never set the attribute, so EVERY run in the project silently started
                 on a full pack -- the cheapest free resource in the model.  The value must
                 now come from the element, and a pack that declares nothing is an ERROR.
    """
    vehicle, env = _zephyr_like(pv_packing=0.90)
    battery = [e for e in vehicle.elements if hasattr(e, "capacity_J")][0]
    battery.initial_soc = 0.30
    result = integrate_energy(vehicle, env, 0.0, DAY_S, 60.0)
    assert abs(float(result.detail["initial_soc_declared"]) - 0.30) < 1e-12, (
        "the integrator ignored the element's declared initial_soc "
        f"({result.detail['initial_soc_declared']}) -- it is defaulting again"
    )

    class _UndeclaredPack:
        """A storage element that declares no starting state of charge at all."""

        capacity_J = 1.0e6
        body_index = 0
        offset_m = np.zeros(3)
        MASSLESS_BY_CONSTRUCTION = True

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):  # noqa: ANN001, ANN201
            """@returns ElementForce of exact zeros."""
            return ElementForce(np.zeros(3), np.zeros(3), 0.0)

    vehicle2, env2 = _zephyr_like(pv_packing=0.90)
    vehicle2.elements = [e for e in vehicle2.elements if not hasattr(e, "capacity_J")]
    vehicle2.elements.append(_UndeclaredPack())
    try:
        integrate_energy(vehicle2, env2, 0.0, 600.0, 60.0)
    except ValueError as exc:
        assert "state of charge" in str(exc)
        return
    raise AssertionError(
        "a storage element declaring no initial state of charge was silently given a full "
        "pack instead of raising"
    )


# ======================================================================================
# Runner
# ======================================================================================

TESTS = [
    test_turbine_freeflier_in_still_air_cannot_net_generate,
    test_bare_wing_pays_for_its_own_drag,
    test_magic_generator_raises_in_slow_loop,
    test_magic_generator_raises_in_fast_loop,
    test_magic_generator_raises_in_randomised_gate,
    test_extractor_plus_propulsor_is_not_a_false_positive,
    test_honest_vehicle_passes_the_gate,
    test_daily_deficit_design_is_not_closed,
    test_false_pass_band_is_closed_everywhere,
    test_min_soc_is_the_limit_cycle_not_the_seeded_window,
    test_initial_soc_is_not_silently_full,
]


def main() -> int:
    """
    @description Run every guard and report pass/fail per test.
    @returns Process exit code: 0 when every guard is green, 1 otherwise.
    """
    import warnings

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
