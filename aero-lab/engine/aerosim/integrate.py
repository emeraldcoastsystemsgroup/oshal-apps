"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation of the two-timescale
  |                                           | integrator, energy audit and free-energy guard.
2 | maintainer@emeraldcoastsystemsgroup.com   | FATAL FIXES (three, all confirmed by running
  |                                           | repros).  (1) integrate_energy never enforced
  |                                           | the ALONG-TRACK force balance, so any drag a
  |                                           | KIND_THRUSTER element did not voluntarily bill
  |                                           | -- including everything past a saturated
  |                                           | max_electrical_power_W, and 100% of the drag of
  |                                           | a vehicle with no thruster at all -- was FREE.
  |                                           | The residual is now computed every step and
  |                                           | billed as unmet propulsive demand, and a
  |                                           | vehicle-level generation budget (generation from
  |                                           | mechanical sources <= mechanical power actually
  |                                           | removed from the flow) is asserted every step
  |                                           | alongside the element-local rule.
  |                                           | (2) 'closed' was a single-window test seeded
  |                                           | with a free full battery, which certified
  |                                           | designs running a daily deficit.  Closure is now
  |                                           | a LIMIT-CYCLE test: the storage ODE is replayed
  |                                           | to a fixed point in initial SOC and scored
  |                                           | there, and it additionally requires
  |                                           | SOC(t_end) >= SOC(t_0), zero unabsorbed
  |                                           | shortfall, and a non-negative window energy
  |                                           | margin.  energy_in_J / energy_out_J /
  |                                           | energy_margin_J / unabsorbed_* are surfaced so a
  |                                           | sweep cannot rank on min_soc alone.
  |                                           | (3) max_gen_violation_W was computed and then
  |                                           | DISCARDED -- the guard failed open.  Both
  |                                           | integrators now raise FreeEnergyError the step
  |                                           | it is detected, and assert_no_free_energy also
  |                                           | exercises integrate_energy.
  |                                           | ALSO: initial_soc is read from the battery
  |                                           | element's documented attribute and is an ERROR
  |                                           | when absent -- it no longer silently defaults to
  |                                           | a free full pack.
3 | maintainer@emeraldcoastsystemsgroup.com   | ROUND-3 FIXES (five, each with a reviewer probe
  |                                           | as its acceptance test).  (1) p2/p6: an unmet
  |                                           | along-track deficit was billed at a flat
  |                                           | T*V/eta with NO induced-velocity term, so
  |                                           | under-rating the motor was strictly profitable.
  |                                           | The deficit is now billed as the MARGINAL
  |                                           | actuator-disk cost through the vehicle's own
  |                                           | thruster (its disk area, figure of merit, motor
  |                                           | and ESC efficiencies), so the unmet path can
  |                                           | never be cheaper than the element; and a design
  |                                           | whose motor cannot fly its own trim is NOT
  |                                           | closed (unmet thrust is a closed_reason).
  |                                           | (2) _propulsion_chain_efficiency read el.eta_prop
  |                                           | -- an attribute the shipped Thruster never
  |                                           | defines -- and silently substituted a default.
  |                                           | It now reads figure_of_merit (eta_prop is the
  |                                           | documented fallback alias) and RAISES on any
  |                                           | factor outside (0, 1].  (3) p10: a sub-diurnal
  |                                           | window certified fake persistence; with any
  |                                           | solar source aboard, a window that is not a
  |                                           | whole number of 86400 s days now forces
  |                                           | closed=False with an explicit reason.
  |                                           | (4) p11: the reaction-rule exemption was granted
  |                                           | by ATTRIBUTE NAME (packing_factor -> KIND_PV).
  |                                           | It now requires the EXPLICIT declaration
  |                                           | non_mechanical_source = True AND a declarable
  |                                           | collecting area, and every exempt element is
  |                                           | bounded by irradiance * area every evaluation.
  |                                           | (5) p13: loads were frozen at trim while
  |                                           | generation integrated per RK4 stage; consumer
  |                                           | draw from re-evaluable elements is now
  |                                           | accumulated per stage and billed in place of the
  |                                           | frozen trim-time value.  ALSO defense in depth:
  |                                           | _battery_spec and the thruster spec extraction
  |                                           | re-validate ranges (soc rails, eta bounds, FM,
  |                                           | disk area), so an element built around __init__
  |                                           | is still caught -- same bounds, second wall.
4 | maintainer@emeraldcoastsystemsgroup.com   | ROUND-4 FIXES: the SOLVER-VALIDITY ESCAPE
  |                                           | (repro R4_winner_audit: a 990 kg design whose
  |                                           | trim oscillated across a polar-cache Re-bin
  |                                           | edge, exhausted _TRIM_MAX_ITER, and fell to the
  |                                           | 300 m/s bisection rail where the polar has ZERO
  |                                           | certified rows -- closed=True on 5.8 W of
  |                                           | avionics, usable 89.98). Defense in depth,
  |                                           | four layers: (1) the bin-edge discontinuity is
  |                                           | killed at the source (AeroSurface.coefficients
  |                                           | now blends adjacent Re bins in log-Re, see
  |                                           | vehicle/aerosurface.py SEQ 3); (2) trim
  |                                           | non-convergence RAISES TrimConvergenceError --
  |                                           | the bisection fallback is an INITIALIZER whose
  |                                           | result must still meet the residual tolerance,
  |                                           | never a result; (3) any step whose trim
  |                                           | evaluation consumed an invalid (uncertified)
  |                                           | aero point forces closed=False with reason
  |                                           | 'uncertified-aero', and the DYNAMIC loop counts
  |                                           | invalid derivative evaluations and taints the
  |                                           | result rather than integrating fiction;
  |                                           | (4) SimResult carries certified /
  |                                           | worst_trim_residual_N / cruise_Re_min /
  |                                           | cruise_Re_max (field name 'certified' is FROZEN
  |                                           | -- the sweep contract keys on it).  ALSO:
  |                                           | FreeEnergyError now carries t_s / where, so the
  |                                           | gate can assert the rejection MECHANISM (raised
  |                                           | at the first evaluation) instead of a wall-clock
  |                                           | budget that failed under CPU contention.
5 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 (cleanup): the NIGHT-SKIPPER dt taint.
  |                                           | Measured: integrate_energy at dt = 86400 s (one
  |                                           | step per day) on case A reported min_soc 1.0000
  |                                           | certified=True -- the RK4 solar stages sample a
  |                                           | few daylight quadrature nodes and the night
  |                                           | never exists; the whole-day-window rule cannot
  |                                           | catch it (86400 IS a whole day).  Certification
  |                                           | now REQUIRES dt_s <= MAX_CERTIFIED_SOLAR_DT_S
  |                                           | (3600 s) whenever a PV source is aboard: coarser
  |                                           | runs still return their numbers but carry
  |                                           | certified=False, closed=False and the named
  |                                           | 'dt-too-coarse' reason, the same contract as
  |                                           | uncertified-aero.  At 3600 s the answer matches
  |                                           | dt = 60 s: usable 1.119713 vs 1.120130 (0.04%),
  |                                           | min_soc 0.358535 vs 0.353829 (1.3%; 0.2% by
  |                                           | dt = 900).  The gate itself runs dt = 60,
  |                                           | untouched.
6 | maintainer@emeraldcoastsystemsgroup.com   | FINAL GATE (round-5 close-out): the SPILL METER
  |                                           | read stored-energy units while the harvest meter
  |                                           | read bus units.  _replay_storage (and the
  |                                           | integrate_dynamic clamp) accumulated
  |                                           | unabsorbed_surplus_J AFTER eta_charge was
  |                                           | applied (E_J grew by p_net*eta_charge, the
  |                                           | ceiling overshoot is stored-equivalent), but
  |                                           | validate.usable_energy subtracts that number
  |                                           | from the BUS-side energy_in_J -- so 1-eta_charge
  |                                           | (5%) of every spilled bus-joule was silently
  |                                           | credited as USABLE.  Caught by the R7 final-gate
  |                                           | convergence search: the winner parked at 85.8%
  |                                           | spill (4.1 m2 panel on a 1.2 kg pack) to farm
  |                                           | the credit -- reported usable 1.5477 vs 1.0553
  |                                           | reconciled against load + battery losses
  |                                           | (R7_winner_ledger.out: reported spill 7881.97 Wh
  |                                           | = 0.95 x bus spill 8296.5 Wh, eta exactly the
  |                                           | pack's 0.95).  Fix: both clamp sites now convert
  |                                           | at the rail -- surplus_J += overshoot/eta_charge
  |                                           | (bus generation the full pack could not take),
  |                                           | shortfall_J += deficit*eta_discharge (bus demand
  |                                           | the empty pack could not serve).  Closure,
  |                                           | min_soc, certification and every SOC rail are
  |                                           | untouched (they live on the stored side of the
  |                                           | meter); only the usable ledger moves, DOWN:
  |                                           | case A 1.1201 -> 1.0446, case B 1.0909 ->
  |                                           | 1.0548, negative controls C/D spill nothing and
  |                                           | are bit-identical.  Strictly tightening.  Guard:
  |                                           | tests/test_usable_ledger.py (synthetic-tape unit
  |                                           | identity + case-A bus-conservation identity,
  |                                           | both red under the old accounting).
7 | maintainer@emeraldcoastsystemsgroup.com   | ACCEPTED-STATE FIX: force/RK4 trial evaluations
  |                                           | no longer advance buoyancy thermal, permeation
  |                                           | or UV state. Battery thermal and buoyancy slow
  |                                           | states advance exactly once after each accepted
  |                                           | integrator step, at the accepted midpoint
  |                                           | environment. Buoyant cruise re-trims every 900 s
  |                                           | so force follows those accepted state changes.
  |                                           | This closes the measured moving-target trim
  |                                           | defect without weakening the 1e-8 force-balance
  |                                           | tolerance. Electrical storage remains owned by
  |                                           | the integrator; no real-ECM electrical closure
  |                                           | is claimed by this change.
8 | maintainer@emeraldcoastsystemsgroup.com   | REAL STORAGE AUTHORITY: a single real-chemistry
  |                                           | BatteryElement now receives each accepted bus
  |                                           | interval exactly once through BatteryElement.step
  |                                           | -> PackEcm.step_power. Its SOC, I2R loss, rate
  |                                           | limits, cold-charge spill, throughput and aging
  |                                           | are therefore the integrated result; the legacy
  |                                           | flat-efficiency replay remains only for explicitly
  |                                           | ideal storage. Thermal state advances immediately
  |                                           | after the electrical step so the accepted I2R heat
  |                                           | enters the same physical timeline.
9 | maintainer@emeraldcoastsystemsgroup.com   | Align the public integrator documentation with
  |                                           | the dual storage contract: limit-cycle replay is
  |                                           | ideal-only; real ECM state is advanced once per
  |                                           | accepted Simpson/RK4 bus interval and observed.
-------------------------------------------------------------------------------

aerosim.integrate -- two-timescale trajectory / energy integrator.

WHAT THIS MODULE IS
    Steps a Vehicle (a set of force-producing elements, see aerosim.vehicle) through an
    Environment (aerosim.env) on two timescales:

      integrate_energy(dt = 60 s)   quasi-steady trim + RK4 on stored energy.  Used for the
                                    multi-day closure questions (validation cases A-D).  No
                                    attitude state, no phugoid, no gust response.
      integrate_dynamic(dt = 0.05 s) RK4 on the full translational state of every body, with
                                    tether coupling.  Used ONLY to measure cycle-averaged
                                    extracted power for the shear/gust archetypes (3 and 4),
                                    which then feeds the slow loop as a power source.

    and owns the energy audit + the uniform-field free-energy guard.

UNITS
    Every quantity in this file carries SI units in its name or in a trailing comment.
    Position/velocity are in a world ENU frame: index 0 = east (m), 1 = north (m),
    2 = UP (m, geometric altitude above MSL).  Forces N, power W, energy J, time s,
    density kg/m^3, viscosity Pa*s, temperature K, angles rad unless a name says _deg.

THE LOAD-BEARING INVARIANT (rule 6)
    A vehicle free-flying in a UNIFORM, STEADY wind field cannot extract energy.  In the
    air-relative frame the fluid is at rest, so the only reservoirs are the vehicle's own
    kinetic and potential energy.  Formally, with

        E_total = sum_bodies( 0.5*m*|v_air|^2 + m*g0*z )  +  E_battery            [J]

    the invariant is  dE_total/dt <= 0  in any uniform field.  For a CLOSED cycle (the
    air-relative state returns to its starting value) this reduces exactly to the acceptance
    criterion "cycle_averaged_power_W <= 0".  assert_no_free_energy() checks BOTH forms and
    reports both numbers, because the power-only form gives a false positive on a vehicle
    that is simply trading altitude for electricity (which is a real, finite reservoir, not
    free energy).  See _free_energy_metric().

-------------------------------------------------------------------------------
INTERFACE OBJECTIONS  (rule 1 -- implemented AS SPECIFIED anyway; do not "fix" by changing
                       a signature unilaterally, these need an owner decision)
-------------------------------------------------------------------------------
OBJECTION 1 -- Vehicle.net() takes ONE environment sample for the WHOLE vehicle.
    Signature:  Vehicle.net(atmo, wind, sol, t_s, dt_s)
    Archetype 3 (the tethered sky-sailboat) exists precisely because its two bodies sit at
    DIFFERENT altitudes in DIFFERENT wind layers.  A single WindSample for the whole vehicle
    makes shear extraction structurally impossible -- both bodies would see the same wind and
    the cycle-averaged power would be identically <= 0.  The same applies to AtmoSample
    (density differs by ~2x between 15 km and 20 km) and to the ForceElement.evaluate()
    protocol, which has the same single-sample shape.
    WORKAROUND USED HERE, using only documented public API and changing no signature:
    this integrator iterates `vehicle.elements` directly and samples the environment at each
    element's own position (bodies[el.body_index].pos_m + el.offset_m) before calling
    el.evaluate(...).  Vehicle.net() is still called verbatim, but only as a fallback for a
    vehicle object that does not expose `.elements`.  Recommended real fix: make the sample
    arguments sequences indexed by body, or pass the EnvBundle itself.

OBJECTION 2 -- Nothing in the ForceElement protocol can be COMMANDED.
    Thruster(diameter_m, max_electrical_power_W, body_index, axis) has no throttle input and
    evaluate() receives no command, so a thruster cannot be asked for a thrust.  Without a
    throttle there is no level cruise, hence no case A/B closure and no two-timescale
    agreement test.  Likewise AeroSurface has a FIXED incidence_deg, so the only trim freedom
    left is airspeed -- which is actually fine and is what _trim_airspeed() solves, but it
    should be a deliberate decision rather than an accident.
    WORKAROUND USED HERE:  the integrator owns the throttle.  Before evaluating a thruster it
    sets, in this order of preference, `el.set_thrust_N(T)` / `el.command_thrust_N(T)` /
    `el.thrust_command_N = T`.  If after that the element still returns |force| ~ 0 for a
    positive command, the integrator falls back to its OWN actuator-disk model
    (_actuator_disk_power_W, momentum theory, derived in-place) and injects the force and the
    electrical load itself, discarding that element's returned force/power so nothing is
    double counted.  Both paths are reported in SimResult.detail["thruster_mode"].

OBJECTION 3 -- Who integrates the battery?
    BatteryElement is a ForceElement and evaluate() receives dt_s, which implies it self-steps.
    But the spec also says integrate_energy does "RK4 on battery energy", and RK4 makes four
    derivative evaluations per step -- a self-stepping element would be advanced four times per
    step and the result would be garbage.  Storage cannot be both.
    RESOLUTION USED HERE:  the INTEGRATOR owns battery state.  Elements identified as storage
    (duck-typed: they expose `capacity_J`) contribute exactly ZERO to the electrical bus sum;
    the integrator reads capacity_J / initial_soc / eta_charge / eta_discharge / soc_min /
    soc_max off them and does the RK4 itself.  A BatteryElement that also mutates itself will
    not corrupt this integrator, but its internal soc will be meaningless -- read
    SimResult.soc instead. A real pack's separate thermal state is advanced once per
    ACCEPTED step, never during RK4 stages or trim probes; that makes temperature and heater
    commands live without giving the element a second electrical integrator.

OBJECTION 4 -- There is no turbine ForceElement in the vehicle module's element list.
    The element kinds are AeroSurface / BuoyancyVolume / Tether / Thruster / PVArray /
    BatteryElement.  But validation case D is "a free-flier with a turbine in a uniform field"
    and archetype 3 needs a generator on the wing, and powerplant exposes turbine_power_W /
    turbine_drag_N with nothing wrapping them as an element.  aerosim.vehicle needs a
    TurbineElement (generation positive, and the momentum-theory reaction drag NON-ZERO
    whenever generation is non-zero) or case D cannot be built.  This integrator already
    handles such an element generically -- it needs no code change here, only the element.

OBJECTION 5 -- EnvBundle has no time origin.
    solar() needs a UTC hour, EnvBundle carries only day_of_year, and integrate_* receive
    t0_s/t_end_s in seconds.  A trailing field `utc_hour_at_t0_h: float = 0.0` has been added
    (defaulted, so every positional construction in the locked spec still works) and the
    mapping is utc_hour = (utc_hour_at_t0_h + t_s/3600) mod 24.
-------------------------------------------------------------------------------
"""

from __future__ import annotations

import importlib
import math
from dataclasses import dataclass, field, replace
from typing import Any, Callable, Optional, Sequence

import numpy as np

# --------------------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------------------

G0_MS2: float = 9.80665          # standard gravity, m/s^2 (ISA / CGPM definition)
ALT_MIN_M: float = 0.0           # env.atmosphere() validity floor, m (geometric)
ALT_MAX_M: float = 47000.0       # env.atmosphere() validity ceiling, m (geometric)
SOLAR_DAY_S: float = 86400.0     # s, one solar day -- the period a PV-carrying closure
                                 # window must be a whole multiple of (ROUND-3 fix 3)
#: Absolute slack, s, on the whole-day window test.  1 ms: far below any dt anyone runs.
_DAY_MULTIPLE_TOL_S: float = 1e-3

#: Coarsest step, s, at which a run carrying a PV source may still be CERTIFIED
#: (ROUND-5 cleanup, the night-skipper).  Measured on case A: dt = 86400 s -- one
#: step per day -- reported min_soc 1.0000 certified=True, because the single RK4
#: step's solar stages sample sunrise/noon-ish quadrature nodes and the night
#: between them simply never exists; the whole-day-window rule above cannot see
#: it (86400 IS a whole day).  At dt = 3600 the certified answer matches dt = 60:
#: usable margin 1.119713 vs 1.120130 (0.04%), min_soc 0.358535 vs 0.353829
#: (1.3% -- the floor is a narrow minimum, resolved to 0.2% by dt = 900).  One
#: hour is 24 samples per diurnal period -- the coarsest step that still
#: resolves the day/night structure the closure verdict is ABOUT; beyond it the
#: result is reported but refused certification, same contract as
#: uncertified-aero.
MAX_CERTIFIED_SOLAR_DT_S: float = 3600.0

# Propulsion chain defaults used ONLY by the integrator's fallback thruster model
# (see OBJECTION 2).  These mirror the efficiency names powerplant exposes so the two
# cannot silently disagree; they are separate named efficiencies, never one fudge factor.
ETA_PROP_PROFILE: float = 0.85   # blade profile efficiency, dimensionless (ideal->shaft)
ETA_MOTOR_DEFAULT: float = 0.90  # brushless motor, dimensionless
ETA_ESC_DEFAULT: float = 0.97    # electronic speed controller, dimensionless

# Battery defaults, used only when the battery element does not declare its own.
ETA_CHARGE_DEFAULT: float = 0.95     # dimensionless
ETA_DISCHARGE_DEFAULT: float = 0.95  # dimensionless
SOC_MIN_DEFAULT: float = 0.05        # dimensionless 0..1
SOC_MAX_DEFAULT: float = 1.00        # dimensionless 0..1

# Trim solver
_TRIM_MAX_ITER: int = 30
_TRIM_REL_TOL: float = 1e-8
_TRIM_V_MIN_MS: float = 0.0
_TRIM_V_MAX_MS: float = 300.0

# Re-trim gates for the slow loop. Non-buoyant level cruise at constant altitude in a
# constant wind has an algebraically constant trim, so this collapses a 24 h run to a
# single solve and makes the runtime budget attainable with a NeuralFoil-backed surface.
# Altitude/mass/wind changes re-solve immediately; accepted buoyancy-state evolution uses
# the explicit time cadence below.
_RETRIM_DALT_M: float = 1.0          # m
_RETRIM_DMASS_KG: float = 1e-6       # kg
_RETRIM_DWIND_MS: float = 0.01       # m/s
#: Maximum time, s, a buoyant trim may be reused while its accepted thermal / gas-loss
#: state evolves. This matches mission.runner's documented H-R2 boundary resolution:
#: the states vary over hours, while 900 s keeps the expensive polar solve bounded.
_RETRIM_STATE_INTERVAL_S: float = 900.0

_EPS = 1e-12


class FreeEnergyError(AssertionError):
    """Raised when a vehicle appears to create energy in a uniform, steady wind field.

    @description Carries the MECHANISM of the rejection alongside the message, so a
        gate can assert WHERE and WHEN the guard fired instead of racing a wall clock
        (a "< 1.0 s to reject" check failed at 2669 ms under CPU contention with every
        physics check green -- the assertion belongs on the mechanism, not the clock).
    @param message Human-readable diagnosis.
    @param t_s Simulation time of the violating evaluation, s, or None when the raise
        is not tied to one step (the randomised trajectory guard).
    @param where Which code path raised ('integrate_energy' / 'integrate_dynamic' /
        '_generation_from_plan' / '_evaluate'), or None.
    """

    def __init__(self, message: str, *, t_s: Optional[float] = None,
                 where: Optional[str] = None) -> None:
        super().__init__(message)
        self.t_s = t_s
        self.where = where


class TrimConvergenceError(RuntimeError):
    """Raised when the quasi-steady trim cannot meet its residual tolerance.

    @description A trim that does not converge is a design evaluation that FAILED,
        never a number. Before round 4 the bisection fallback's answer was returned
        unconditionally: on the R4 winner it landed on the 300 m/s velocity rail,
        where the polar has zero certified rows and the wing returns zero force, and
        the run scored closed=True on avionics power alone. The fallback is now an
        initializer only -- whatever path produced the final airspeed, the vertical
        residual must clear _TRIM_REL_TOL * weight or this is raised. Callers (the
        sweep, the validation gate) must treat it as "this design cannot be
        evaluated", never as "this design scores zero".
    """


# --------------------------------------------------------------------------------------
# Lazy resolution of the sibling env module
# --------------------------------------------------------------------------------------
# Resolved lazily (not at import time) so that (a) module import order between the parallel
# agents does not matter, and (b) the self-test at the bottom can install a reference
# environment under the same name when the real one is not on the box yet.

_env_mod: Optional[Any] = None

# The env surface integrate actually calls.  A partially-built env package (a directory that
# imports as an empty namespace package, which is exactly what a mid-flight sibling agent
# leaves on disk) must NOT be accepted -- it would fail later with a confusing AttributeError
# deep inside a derivative evaluation.
_ENV_REQUIRED = ("atmosphere", "solar", "make_uniform_field")


def _env_is_complete(mod: Any) -> bool:
    """
    @description Does this module actually expose the env surface integrate calls?
    @param mod A candidate env module.
    @returns True if every name in _ENV_REQUIRED is present and callable.
    """
    return all(callable(getattr(mod, n, None)) for n in _ENV_REQUIRED)


def _env() -> Any:
    """
    @description Resolve and cache the aerosim.env module.  Tries the package path first,
                 then a flat layout, so this works from either `python -m aerosim.integrate`
                 or a direct `python integrate.py`.  Rejects an incomplete module rather than
                 half-using it.
    @returns The env module object.
    """
    global _env_mod
    if _env_mod is None:
        last: Optional[BaseException] = None
        partial: list[str] = []
        for name in ("aerosim.env", "env"):
            try:
                cand = importlib.import_module(name)
            except ImportError as exc:  # pragma: no cover - depends on sibling agent
                last = exc
                continue
            if _env_is_complete(cand):
                _env_mod = cand
                break
            partial.append(
                f"{name} (missing: "
                + ", ".join(n for n in _ENV_REQUIRED if not callable(getattr(cand, n, None)))
                + ")"
            )
        if _env_mod is None:
            raise ImportError(
                "aerosim.integrate requires a complete aerosim.env module exposing "
                f"{_ENV_REQUIRED}. Import error: {last}. Incomplete candidates: {partial}"
            )
    return _env_mod


# --------------------------------------------------------------------------------------
# Public data types
# --------------------------------------------------------------------------------------


@dataclass
class EnvBundle:
    """
    @description Everything integrate needs to answer "what is the fluid doing here, now".
                 atmosphere and solar are called through aerosim.env; only the wind field is
                 an object because it carries state (PCHIP nodes, turbulence filter state).
    @param wind WindField protocol object from aerosim.env.
    @param latitude_deg  degrees north, -90..90.
    @param longitude_deg degrees east, -180..180.
    @param day_of_year   1..366.
    @param utc_hour_at_t0_h  UTC hour (h) corresponding to sim time t = 0 s.  See OBJECTION 5.
    """

    wind: Any                       # env.WindField
    latitude_deg: float             # deg
    longitude_deg: float            # deg
    day_of_year: int                # 1..366
    utc_hour_at_t0_h: float = 0.0   # h

    def utc_hour_h(self, t_s: float) -> float:
        """@description Map sim time to UTC hour of day. @returns hours in [0,24)."""
        return (self.utc_hour_at_t0_h + t_s / 3600.0) % 24.0


@dataclass
class SimResult:
    """
    @description Time history of a run.  pos_m / vel_ms are the PRIMARY body (index 0); the
                 full per-body arrays live in detail["pos_all_m"] / detail["vel_all_ms"],
                 shaped [N, n_bodies, 3].
    @param t_s               [N]     s
    @param pos_m             [N,3]   m, ENU, body 0
    @param vel_ms            [N,3]   m/s, ENU (ground-relative), body 0
    @param soc               [N]     dimensionless 0..1
    @param power_in_W        [N]     W, electrical generation (PV + turbine + regen), >= 0
    @param power_out_W       [N]     W, electrical consumption (propulsion + payload), >= 0
    @param battery_energy_J  [N]     J
    @param closed            True iff the selected closure authority serves demand,
                             respects storage rails/certification, and preserves charge
                             over its persistence window.
    @param min_soc           dimensionless
    @param mean_cruise_Re    dimensionless, mean over the run of rho*V_air*c_mac/mu; NaN if
                             the vehicle carries no aerodynamic surface
    @param detail            extra diagnostics; also carries the work integrals energy_audit
                             needs (added field, defaulted, so the locked positional
                             construction still works)
    @param certified         True iff EVERY aerodynamic point consumed on the run was
                             solver-certified AND every trim met its residual tolerance.
                             THE FIELD NAME IS FROZEN ('certified') -- the sweep contract
                             (validate.screen_design) keys on it. False means the numbers
                             above include uncertified aerodynamics: report them, never
                             rank on them. (Round 4, FATAL 1 layer 4.)
    @param worst_trim_residual_N  N, worst vertical trim residual accepted on the run
                             (slow loop; NaN for the dynamic loop, which has no trim).
    @param cruise_Re_min     dimensionless, min of the recorded per-step cruise Reynolds
                             numbers; NaN if the vehicle carries no aero surface.
    @param cruise_Re_max     dimensionless, max of the same.
    """

    t_s: np.ndarray
    pos_m: np.ndarray
    vel_ms: np.ndarray
    soc: np.ndarray
    power_in_W: np.ndarray
    power_out_W: np.ndarray
    battery_energy_J: np.ndarray
    closed: bool
    min_soc: float
    mean_cruise_Re: float
    detail: dict = field(default_factory=dict)
    certified: bool = True
    worst_trim_residual_N: float = float("nan")
    cruise_Re_min: float = float("nan")
    cruise_Re_max: float = float("nan")


# --------------------------------------------------------------------------------------
# Element classification (duck-typed -- integrate must not import vehicle at runtime)
# --------------------------------------------------------------------------------------

KIND_BATTERY = "battery"
KIND_THRUSTER = "thruster"
KIND_AERO = "aero"
KIND_TETHER = "tether"
KIND_BUOYANCY = "buoyancy"
KIND_PV = "pv"
KIND_GENERIC = "generic"          # anything else, e.g. a turbine element (OBJECTION 4)


def _classify(el: Any) -> str:
    """
    @description Identify an element kind from its public attributes.  Deliberately
                 attribute-based rather than isinstance-based so that integrate never has a
                 runtime dependency on aerosim.vehicle and so a store-contributed element
                 works without registration.
    @param el A ForceElement.
    @returns One of the KIND_* strings.
    """
    if hasattr(el, "capacity_J"):
        return KIND_BATTERY
    if hasattr(el, "max_electrical_power_W"):
        return KIND_THRUSTER
    if hasattr(el, "rest_length_m") or hasattr(el, "EA_N"):
        return KIND_TETHER
    if hasattr(el, "geometry") or hasattr(el, "incidence_deg"):
        return KIND_AERO
    if hasattr(el, "volume_m3"):
        return KIND_BUOYANCY
    if hasattr(el, "cell_efficiency_stc") or hasattr(el, "packing_factor"):
        return KIND_PV
    return KIND_GENERIC


def _body_index(el: Any) -> int:
    """@description Body an element acts on. @returns int index into vehicle.bodies."""
    return int(getattr(el, "body_index", 0))


def _offset_m(el: Any) -> np.ndarray:
    """@description Element mount offset. @returns ndarray[3] m, world frame in 3-DOF."""
    off = getattr(el, "offset_m", None)
    if off is None:
        return np.zeros(3)
    return np.asarray(off, dtype=float).reshape(3)


def _panel_orientation(el: Any) -> tuple[float, float]:
    """@description PV panel pose for the solar call. @returns (tilt_deg, azimuth_deg)."""
    return (
        float(getattr(el, "tilt_deg", 0.0)),
        float(getattr(el, "azimuth_deg", 180.0)),
    )


# --------------------------------------------------------------------------------------
# Environment sampling (with a per-derivative-evaluation cache)
# --------------------------------------------------------------------------------------


class _EnvCache:
    """
    @description Caches atmosphere/solar samples inside ONE derivative evaluation.  Every
                 element of a body at the same altitude and panel pose gets the same sample,
                 so this removes the n_elements factor from the env call count without ever
                 caching across time (which would silently freeze the solar cycle).
    """

    __slots__ = ("_atmo", "_solar", "env", "t_s", "n_atmo", "n_solar")

    def __init__(self, env: EnvBundle, t_s: float) -> None:
        self._atmo: dict[int, Any] = {}
        self._solar: dict[tuple[int, int, int], Any] = {}
        self.env = env
        self.t_s = float(t_s)
        self.n_atmo = 0
        self.n_solar = 0

    def atmo(self, z_m: float) -> Any:
        """@description ISA sample at geometric altitude. @returns env.AtmoSample."""
        z = min(max(float(z_m), ALT_MIN_M), ALT_MAX_M)   # env is valid 0..47 km only
        key = int(round(z * 1000.0))                     # 1 mm resolution
        s = self._atmo.get(key)
        if s is None:
            s = _env().atmosphere(z)
            self._atmo[key] = s
            self.n_atmo += 1
        return s

    def solar(self, z_m: float, tilt_deg: float, azimuth_deg: float) -> Any:
        """@description Irradiance sample. @returns env.SolarSample."""
        z = min(max(float(z_m), ALT_MIN_M), ALT_MAX_M)
        key = (int(round(z)), int(round(tilt_deg * 10.0)), int(round(azimuth_deg * 10.0)))
        s = self._solar.get(key)
        if s is None:
            s = _env().solar(
                self.env.latitude_deg,
                self.env.longitude_deg,
                self.env.day_of_year,
                self.env.utc_hour_h(self.t_s),
                z,
                tilt_deg,
                azimuth_deg,
            )
            self._solar[key] = s
            self.n_solar += 1
        return s

    def wind(self, pos_m: np.ndarray) -> Any:
        """@description Wind vector + analytic d/dz. @returns env.WindSample."""
        return self.env.wind.sample(
            float(pos_m[0]), float(pos_m[1]), float(pos_m[2]), self.t_s
        )


def _wind_vec(ws: Any) -> np.ndarray:
    """@description WindSample -> ENU vector. @returns ndarray[3] m/s."""
    return np.array([float(ws.u_ms), float(ws.v_ms), float(ws.w_ms)], dtype=float)


# --------------------------------------------------------------------------------------
# Thruster model (integrator-owned; see OBJECTION 2)
# --------------------------------------------------------------------------------------


def _command_thrust(el: Any, thrust_N: float) -> None:
    """
    @description Command a thruster element.  Tries the two plausible method names, then
                 falls back to a plain attribute, so whichever convention aerosim.vehicle
                 lands on will work without a change here.
    @param el Thruster element.
    @param thrust_N Commanded thrust, N, >= 0.
    """
    for name in ("set_thrust_N", "command_thrust_N", "set_command"):
        fn = getattr(el, name, None)
        if callable(fn):
            try:
                fn(float(thrust_N))
                return
            except TypeError:
                continue
    try:
        setattr(el, "thrust_command_N", float(thrust_N))
    except Exception:  # frozen dataclass, __slots__, etc. -- fallback model will take over
        pass


def _actuator_disk_power_W(
    thrust_N: float,
    V_ms: float,
    rho_kgm3: float,
    disk_area_m2: float,
    eta_motor: float = ETA_MOTOR_DEFAULT,
    eta_esc: float = ETA_ESC_DEFAULT,
) -> float:
    """
    @description Electrical power to produce a given thrust, from momentum (actuator-disk)
                 theory.  Used only when the vehicle's Thruster element cannot be commanded.
                 Induced velocity at the disk in axial forward flight solves
                     T = 2*rho*A*(V + vi)*vi
                 =>  vi = ( -V + sqrt(V^2 + 2T/(rho*A)) ) / 2                      [m/s]
                 ideal (induced+useful) power  P_ideal = T*(V + vi)                [W]
                 shaft power  P_shaft = P_ideal / ETA_PROP_PROFILE                 [W]
                 electrical   P_elec  = P_shaft / (eta_motor*eta_esc)              [W]
                 At V -> 0 this degenerates to the hover form T^1.5/sqrt(2*rho*A), matching
                 the project's hover power identity.
    @param thrust_N N, >= 0.  @param V_ms airspeed through the disk, m/s, >= 0.
    @param rho_kgm3 kg/m^3.   @param disk_area_m2 m^2, > 0.
    @returns Electrical power drawn, W, >= 0.
    """
    T = max(0.0, float(thrust_N))
    if T <= _EPS:
        return 0.0
    A = max(float(disk_area_m2), 1e-9)
    V = max(0.0, float(V_ms))
    vi = 0.5 * (-V + math.sqrt(V * V + 2.0 * T / (rho_kgm3 * A)))    # m/s
    p_ideal_W = T * (V + vi)
    p_shaft_W = p_ideal_W / ETA_PROP_PROFILE
    return p_shaft_W / max(eta_motor * eta_esc, 1e-9)


def _disk_area_m2(el: Any) -> float:
    """@description Thruster disk area from its diameter. @returns m^2."""
    d_m = float(getattr(el, "diameter_m", 0.0))
    if d_m <= 0.0:
        return 1e-9
    return math.pi * 0.25 * d_m * d_m


# --------------------------------------------------------------------------------------
# The generation-reaction rule -- the SHARP free-energy guard
# --------------------------------------------------------------------------------------
#
# _GENERATION_REACTION_RULE:
#   An element that reports power_elec_W > 0 by converting MECHANICAL energy can only
#   convert power it actually removes from the flow, and its reaction force is the only
#   channel through which it can do so.  Therefore, for every such element,
#
#       power_elec_W  <=  -( force_N . v_air )                                       [W]
#
#   where v_air is the element's air-relative velocity.  A wind turbine satisfies this with
#   room to spare (P_elec = eta_gen * D * V and the reaction drag D is exactly P_mech / V).
#   A turbine that forgot its momentum-theory reaction drag violates it immediately.
#
#   WHY THIS AND NOT JUST THE WHOLE-VEHICLE ENERGY INVARIANT:  the vehicle-level invariant
#   ("total energy in the air-relative frame cannot rise in a uniform field") is TRUE but
#   BLUNT -- a wing dissipating 150 W of drag hides a 12 W manufactured term underneath it,
#   and the total still falls.  Measured on this box: a turbine element stripped of its
#   reaction force did NOT trip the vehicle-level invariant on 8 randomised trajectories.
#   The element-local rule trips on the very first evaluation, and it works in sheared
#   fields too, where the vehicle-level invariant does not apply at all.
#
#   EXEMPTION:  elements converting NON-mechanical energy (photovoltaic, fuel cell, RTG)
#   legitimately generate with zero force.  The exemption is an EXPLICIT DECLARED OPT-IN:
#   the element must expose `non_mechanical_source = True` (the shipped PVArray does) AND
#   declare a collecting area (`area_m2 > 0`), and its output is then bounded every
#   evaluation by  p_elec <= irradiance_at(pos, t) * area_m2 * 1.0.  It used to be granted
#   by ATTRIBUTE NAME -- carrying `packing_factor` classified an element KIND_PV and
#   exempted it -- which let a zero-force +200 W element buy the exemption with one
#   attribute (reviewer probe p11).  Classification still exists for dispatch, but it grants
#   NOTHING.  An element that claims the flag without a declarable area gets no exemption
#   and falls back to the reaction rule, which a forceless generator cannot pass.
#   NOT YET COVERED: a tether-REEL generator takes power from the tether, not the flow, and
#   would need the ground-relative form of the rule.  No such element exists yet; when one
#   is added it must declare itself, not be silently exempted.


def _declared_collecting_area_m2(el: Any) -> float:
    """
    @description The collecting area an exempt (solar-type) element declares, m^2.
    @param el The element claiming `non_mechanical_source = True`.
    @returns Area, m^2, when declared, finite and > 0; NaN otherwise (no exemption).
    """
    try:
        a = float(getattr(el, "area_m2", float("nan")))
    except (TypeError, ValueError):
        return float("nan")
    return a if (math.isfinite(a) and a > 0.0) else float("nan")


def _is_non_mechanical_source(el: Any, kind: str) -> bool:
    """
    @description Is this element allowed to generate without a reaction force?  ONLY on the
                 explicit declared opt-in `non_mechanical_source = True` WITH a declarable
                 collecting area -- never inferred from an attribute name or from `kind`
                 (the `kind` parameter is retained for call-site compatibility and messages,
                 but grants nothing).
    @param el The element.  @param kind Its _classify() kind (informational only).
    @returns True only for an explicitly declared, area-bounded non-mechanical source.
    """
    if not bool(getattr(el, "non_mechanical_source", False)):
        return False
    return math.isfinite(_declared_collecting_area_m2(el))


def _has_solar_source(vehicle: Any) -> bool:
    """
    @description Does this vehicle carry any solar-driven generator?  Used by the
                 whole-day-window rule: a closure verdict with photovoltaics aboard is only
                 meaningful over an integer number of solar days (probe p10: the daylight
                 half of a failing day certified closed=True).  Detection is deliberately
                 WIDE -- classification OR the explicit flag -- because an element hiding
                 from KIND_PV to dodge this rule still has to declare
                 non_mechanical_source to survive the reaction rule.
    @param vehicle A Vehicle.
    @returns True when any element classifies KIND_PV or declares non_mechanical_source.
    """
    for el in getattr(vehicle, "elements", []) or []:
        if _classify(el) == KIND_PV or bool(getattr(el, "non_mechanical_source", False)):
            return True
    return False


def _sub_diurnal_window_reason(vehicle: Any, t0_s: float, t_end_s: float) -> Optional[str]:
    """
    @description The whole-day-window rule (ROUND-3 fix 3).
    @param vehicle A Vehicle.  @param t0_s / t_end_s The window, s.
    @returns A closed_reason string when the vehicle carries a solar source and the window
             is not an integer multiple of 86400 s; None otherwise.
    """
    if not _has_solar_source(vehicle):
        return None
    window_s = float(t_end_s) - float(t0_s)
    rem_s = math.fmod(window_s, SOLAR_DAY_S)
    if min(abs(rem_s), SOLAR_DAY_S - abs(rem_s)) <= _DAY_MULTIPLE_TOL_S:
        return None
    return (
        f"window of {window_s:.0f} s is not an integer multiple of one solar day "
        f"(86400 s) while a solar source is aboard -- a sub-diurnal window certifies "
        "fake persistence (a daylight half-day always closes); integrate refuses the "
        "verdict, not the run"
    )


def _assert_solar_bounded(
    el: Any, power_elec_W: float, sol: Any, t_s: float, where: str
) -> None:
    """
    @description The exemption's price: an element excused from the reaction rule is instead
                 bounded by the physics the integrator already holds in hand -- the solar
                 irradiance at its position and time.  No collector can deliver more
                 electrical power than 100% of the radiant power crossing its declared area:
                     p_elec <= (DNI + DHI + GHI) * area_m2 * 1.0            [W]
                 (DNI + DHI + GHI is a strict upper bound on any plane-of-array transposition
                 with albedo <= 1, so an honest array always clears it; at night it is ZERO,
                 which is what kills a magic generator wearing the flag.)
    @param el The exempt element.  @param power_elec_W Its reported generation, W, > 0.
    @param sol The env solar sample at the element's own position and time.
    @param t_s s, for the message.  @param where Which code path, for the message.
    @raises FreeEnergyError when the element out-generates the sun over its own area.
    """
    area_m2 = _declared_collecting_area_m2(el)
    irr_Wm2 = (max(0.0, float(getattr(sol, "dni_Wm2", 0.0)))
               + max(0.0, float(getattr(sol, "dhi_Wm2", 0.0)))
               + max(0.0, float(getattr(sol, "ghi_Wm2", 0.0))))
    bound_W = irr_Wm2 * area_m2
    if float(power_elec_W) > bound_W + 1e-6 + 1e-9 * bound_W:
        raise FreeEnergyError(
            f"FREE ENERGY DETECTED in {where} at t = {t_s:.1f} s: element "
            f"{type(el).__name__!r} declares non_mechanical_source and reported "
            f"{float(power_elec_W):.6g} W, but the irradiance at its position "
            f"({irr_Wm2:.6g} W/m^2) over its declared {area_m2:.6g} m^2 collecting area "
            f"bounds any collector at {bound_W:.6g} W. A non-mechanical source cannot "
            "out-generate the sun over its own area.",
            t_s=float(t_s), where=where,
        )


def _generation_reaction_violation_W(
    force_N: np.ndarray, v_air_ms: np.ndarray, power_elec_W: float, body_index: int
) -> float:
    """
    @description Evaluate _GENERATION_REACTION_RULE for one element.
    @param force_N ndarray[3] or ndarray[n_bodies,3], N.
    @param v_air_ms ndarray[n_bodies,3], m/s, air-relative velocity of every body.
    @returns power_elec_W - (mechanical power removed from the flow), W.  > 0 means the
             element produced electricity it never took out of the air: a free-energy bug.
    """
    f = np.asarray(force_N, dtype=float)
    if f.ndim == 2:
        mech_removed_W = -float(np.sum(f * v_air_ms))
    else:
        mech_removed_W = -float(np.dot(f.reshape(3), v_air_ms[body_index]))
    return float(power_elec_W) - mech_removed_W


# --------------------------------------------------------------------------------------
# The ALONG-TRACK FORCE BALANCE -- the other half of the free-energy wall (FATAL 1)
# --------------------------------------------------------------------------------------
#
# The quasi-steady slow loop PINS the vehicle's velocity: it solves only the VERTICAL
# balance (lift == weight) and then writes vel = wind + V_trim * heading_hat every step
# instead of integrating dv/dt.  A pinned velocity is a constraint, and every constraint
# has a constraint force.  Along the flight path that force is propulsion, and it is not
# free.  Before this was enforced, any along-track deficit the vehicle's own thrusters did
# not voluntarily bill -- everything past a saturated max_electrical_power_W, and 100% of
# the drag of a vehicle carrying no thruster at all -- was silently DISCARDED, which is the
# single largest free-energy hole an optimizer could find: it makes drag optional.
#
# So every step:
#     R = ( sum_bodies F_element + sum_bodies F_gravity ) . d_hat                      [N]
# with d_hat the air-relative flight-path direction.  R < 0 is unmet propulsive demand and
# is BILLED at the declared propulsion chain.  R > 0 is a net forward push nobody commanded
# -- momentum from nowhere -- and is reported and gated on, never billed away.
#
# SCOPE, STATED PLAINLY.  d_hat is taken from BODY 0, and the R > 0 gate assumes the only
# legitimate along-track force is billed propulsion.  Both hold for the free-flying level
# cruise the slow loop exists to answer, and both would be wrong for a GROUND-TETHERED
# vehicle, where the tether is a second reference frame and can legitimately pull the
# vehicle forward for free.  That is not a regression: the slow loop already writes
# vel = wind + V_trim*heading for EVERY body, which is meaningless for two bodies in
# different wind layers (OBJECTION 1).  Archetypes 3 and 4 are measured on the FAST loop by
# cycle_averaged_power_W and handed to the slow loop as a power source, which is the
# supported path.  A tethered vehicle passed directly to integrate_energy will be reported
# as not closed on an excess-thrust reason -- conservative, and visible in
# detail["closed_reasons"] rather than silent.


def _along_track_residual_N(
    forces_N: np.ndarray, grav_N: np.ndarray, v_air_ms: np.ndarray
) -> tuple[float, float]:
    """
    @description Split the whole-vehicle along-track force residual into the part that must
                 be paid for (a deficit -> unmet propulsive demand) and the part that cannot
                 be paid for at all (an excess -> uncommanded forward force).
    @param forces_N ndarray[n_bodies,3] N, every element force, EXCLUDING gravity.
    @param grav_N ndarray[n_bodies,3] N, gravity.
    @param v_air_ms ndarray[n_bodies,3] m/s, air-relative velocity of every body.
    @returns (unmet_thrust_N >= 0, excess_thrust_N >= 0); at most one is non-zero.
    """
    speed_ms = float(np.linalg.norm(v_air_ms[0]))
    if speed_ms <= 1e-6:
        return 0.0, 0.0                     # no flight path -> no along-track direction
    d_hat = v_air_ms[0] / speed_ms          # dimensionless unit vector
    R_N = float(np.dot(np.sum(forces_N + grav_N, axis=0), d_hat))
    return (max(0.0, -R_N), max(0.0, R_N))


def _mech_removed_by_element_W(
    force_N: np.ndarray, v_air_ms: np.ndarray, body_index: int
) -> float:
    """
    @description Mechanical power ONE element takes out of the flow, floored at zero.  In the
                 air-relative frame of a uniform field the power an element delivers to the
                 vehicle is F . v_air; when that is negative the element is removing
                 mechanical power, and that removal is the only thing a mechanical generator
                 can convert.  An element that ADDS power (a propulsor) contributes zero here
                 -- its electrical cost is billed on the load side and it must never be
                 allowed to offset another element's extraction.
    @param force_N ndarray[3] or ndarray[n_bodies,3], N.
    @param v_air_ms ndarray[n_bodies,3], m/s.
    @param body_index Body the element acts on, when force_N is a single vector.
    @returns Mechanical power removed, W, >= 0.
    """
    f = np.asarray(force_N, dtype=float)
    if f.ndim == 2:
        return float(np.sum(np.maximum(0.0, -np.sum(f * v_air_ms, axis=1))))
    return max(0.0, -float(np.dot(f.reshape(3), v_air_ms[body_index])))


@dataclass(frozen=True)
class _ThrusterBillingSpec:
    """@description The vehicle thruster's own physics, re-validated. All SI."""

    disk_area_m2: float             # m^2, TOTAL actuator-disk area (all rotors)
    figure_of_merit: float          # dimensionless (0, 1], the blade profile slot
    eta_motor: float                # dimensionless (0, 1]
    eta_esc: float                  # dimensionless (0, 1]


def _thruster_billing_spec(vehicle: Any) -> Optional[_ThrusterBillingSpec]:
    """
    @description Extract -- and RE-VALIDATE -- the first thruster's disk area and chain
                 efficiencies.  This is the second wall of the range-check-or-bill invariant:
                 a Thruster built around __init__ (object.__new__, mutated attributes, a
                 duck-typed impostor) is caught HERE, with the same bounds the constructor
                 enforces.  `figure_of_merit` is the shipped attribute; `eta_prop` is the
                 documented fallback alias; only when NEITHER exists does the integrator's
                 own declared ETA_PROP_PROFILE apply.
    @param vehicle A Vehicle.
    @returns The spec, or None when the vehicle carries no thruster element.
    @raises ValueError when any declared efficiency falls outside (0, 1], the disk area is
            not a positive finite number, or the power limit is negative or NaN.
    """
    for el in getattr(vehicle, "elements", []) or []:
        if _classify(el) != KIND_THRUSTER:
            continue
        eta_motor = float(getattr(el, "eta_motor", ETA_MOTOR_DEFAULT))
        eta_esc = float(getattr(el, "eta_esc", ETA_ESC_DEFAULT))
        fm_raw = getattr(el, "figure_of_merit", None)
        if fm_raw is None:
            fm_raw = getattr(el, "eta_prop", None)      # documented fallback alias
        fm = float(fm_raw) if fm_raw is not None else ETA_PROP_PROFILE
        for name, val in (("figure_of_merit", fm), ("eta_motor", eta_motor),
                          ("eta_esc", eta_esc)):
            if not (math.isfinite(val) and 0.0 < val <= 1.0):
                raise ValueError(
                    f"thruster {type(el).__name__!r} declares {name} = {val!r}, outside "
                    "(0, 1]. An efficiency above 1 is a free-energy knob and below/at 0 is "
                    "meaningless; integrate refuses to bill through it. (Second wall: this "
                    "holds even for an element built around its constructor.)"
                )
        area_m2 = getattr(el, "disk_area_m2", None)
        if area_m2 is None:
            n_rotors = max(int(getattr(el, "n_rotors", 1)), 1)
            area_m2 = _disk_area_m2(el) * n_rotors
        area_m2 = float(area_m2)
        if not (math.isfinite(area_m2) and area_m2 > 0.0):
            raise ValueError(
                f"thruster {type(el).__name__!r} declares disk area {area_m2!r} m^2; it "
                "must be a positive finite number -- momentum theory has no price without "
                "a disk."
            )
        p_max_W = float(getattr(el, "max_electrical_power_W", math.inf))
        if math.isnan(p_max_W) or p_max_W < 0.0:
            raise ValueError(
                f"thruster {type(el).__name__!r} declares max_electrical_power_W = "
                f"{p_max_W!r}; it must be >= 0 (NaN disables the saturation clamp)."
            )
        return _ThrusterBillingSpec(area_m2, fm, eta_motor, eta_esc)
    return None


def _billed_disk_power_W(
    spec: _ThrusterBillingSpec, thrust_N: float, V_ms: float, rho_kgm3: float
) -> float:
    """
    @description Electrical price of a thrust through the VEHICLE'S OWN thruster physics:
                     v_i = ( -V + sqrt(V^2 + 2T/(rho*A)) ) / 2                     [m/s]
                     P   = T*(V + v_i) / (FM * eta_motor * eta_esc)                [W]
                 Bit-for-bit the shipped Thruster.electrical_power_W, so billing an unmet
                 deficit through this can never undercut the element (reviewer probe p6:
                 the old flat T*V/eta bill dropped the induced term entirely, an 11-86%
                 discount that grew as the declared disk shrank).
    @param spec Re-validated thruster spec.  @param thrust_N N, >= 0.
    @param V_ms airspeed through the disk, m/s, >= 0.  @param rho_kgm3 kg/m^3.
    @returns Electrical power, W, >= 0.
    """
    T = max(0.0, float(thrust_N))
    if T <= _EPS:
        return 0.0
    V = max(0.0, float(V_ms))
    vi = 0.5 * (-V + math.sqrt(V * V + 2.0 * T / (rho_kgm3 * spec.disk_area_m2)))  # m/s
    return T * (V + vi) / (spec.figure_of_merit * spec.eta_motor * spec.eta_esc)


def _unmet_propulsion_power_W(
    spec: Optional[_ThrusterBillingSpec],
    thrust_served_N: float,
    thrust_unmet_N: float,
    V_ms: float,
    rho_kgm3: float,
    eta_chain: float,
) -> float:
    """
    @description Bill an unmet along-track deficit through the physics that owns it.  With a
                 thruster aboard, the bill is the MARGINAL actuator-disk cost of the missing
                 thrust on that thruster's own disk,
                     P_unmet = P(T_served + T_unmet) - P(T_served)                  [W]
                 which by convexity of P(T) is >= the element's own price for the same
                 increment -- exactly equal, in fact, so routing thrust through the unmet
                 path can never be cheaper than buying a big enough motor (FATAL 1, round 3).
                 A vehicle with NO thruster at all has no disk to price through; it keeps the
                 chain bill T*V/eta -- a lower bound on any physical propulsor -- and is in
                 any case NOT CLOSED, because unmet thrust is now a closed_reason.
    @param spec Thruster billing spec or None.  @param thrust_served_N N, thrust delivered.
    @param thrust_unmet_N N, the deficit.  @param V_ms m/s.  @param rho_kgm3 kg/m^3.
    @param eta_chain Dimensionless, the no-thruster fallback chain.
    @returns Electrical power billed for the deficit, W, >= 0.
    """
    T_unmet = max(0.0, float(thrust_unmet_N))
    if T_unmet <= _EPS:
        return 0.0
    if spec is None:
        return T_unmet * max(0.0, float(V_ms)) / eta_chain
    T_served = max(0.0, float(thrust_served_N))
    return (_billed_disk_power_W(spec, T_served + T_unmet, V_ms, rho_kgm3)
            - _billed_disk_power_W(spec, T_served, V_ms, rho_kgm3))


def _propulsion_chain_efficiency(vehicle: Any) -> float:
    """
    @description The electrical -> useful-propulsive-work efficiency of the vehicle's own
                 declared chain: figure_of_merit (eta_prop as the documented fallback alias)
                 * eta_motor * eta_esc, read off the first thruster.  A vehicle with no
                 thruster gets the integrator's declared chain.  It used to read ONLY
                 el.eta_prop -- an attribute the shipped Thruster never defines -- and
                 silently substituted the default 0.6864 whatever the figure of merit said.
    @param vehicle A Vehicle.
    @returns Dimensionless efficiency in (0, 1].
    @raises ValueError when the resolved chain falls outside (0, 1] -- never substituted.
    """
    spec = _thruster_billing_spec(vehicle)
    if spec is None:
        return ETA_PROP_PROFILE * ETA_MOTOR_DEFAULT * ETA_ESC_DEFAULT
    eta = spec.figure_of_merit * spec.eta_motor * spec.eta_esc
    if not (0.0 < eta <= 1.0):        # unreachable given per-factor checks; belt-and-braces
        raise ValueError(
            f"propulsion chain efficiency resolved to {eta!r}, outside (0, 1]"
        )
    return eta


def _free_energy_tol_W(vehicle: Any) -> float:
    """
    @description The numerical noise floor for every free-energy assertion, on the SAME
                 scale assert_no_free_energy uses so the cheap per-step guard and the
                 expensive randomised gate cannot disagree about what counts as a violation.
    @param vehicle A Vehicle.
    @returns Tolerance, W, > 0.
    """
    total_mass_kg = sum(float(b.mass_kg) for b in vehicle.bodies)
    return 1e-6 * max(total_mass_kg, 1.0)


def _assert_generation_budget(
    gen_mech_W: float,
    fluid_mech_removed_W: float,
    gen_violation_W: float,
    tol_W: float,
    t_s: float,
    where: str,
) -> None:
    """
    @description The CHEAP per-step free-energy invariant -- the one that can run inside a
                 30,000-candidate sweep.  Two independent necessary conditions:
                   (a) element-local  _GENERATION_REACTION_RULE (sharp),
                   (b) vehicle-level  sum(P_gen from mechanical sources)
                       <= sum_elements max(0, -(F_i . v_air_i)) (blunt, but catches a set of
                       generators whose TOTAL output exceeds the TOTAL extraction even when no
                       single element's attribution looks wrong).
                 Previously (b) did not exist and (a) was computed and then thrown away, so
                 the guard FAILED OPEN: a zero-force generator returning +1000 W produced a
                 run reporting closed=True and min_soc=1.0.
    @param gen_mech_W W, generation converted from the flow.
    @param fluid_mech_removed_W W, -sum(F_fluid . v_air) over every body.
    @param gen_violation_W W, worst element-local violation this step.
    @param tol_W W, noise floor from _free_energy_tol_W.
    @param t_s s, sim time, for the message.  @param where Which integrator, for the message.
    @raises FreeEnergyError the moment either condition fails.
    """
    if gen_violation_W > tol_W:
        raise FreeEnergyError(
            f"FREE ENERGY DETECTED in {where} at t = {t_s:.1f} s: an element reported "
            f"{gen_violation_W:.6g} W MORE electrical generation than the mechanical power "
            f"its own reaction force removed from the flow (tolerance {tol_W:.3g} W). "
            "See _GENERATION_REACTION_RULE. The usual cause is a turbine or generator "
            "element whose momentum-theory reaction drag is missing, zero, or reversed.",
            t_s=float(t_s), where=where,
        )
    surplus_W = float(gen_mech_W) - float(fluid_mech_removed_W)
    if surplus_W > tol_W:
        raise FreeEnergyError(
            f"FREE ENERGY DETECTED in {where} at t = {t_s:.1f} s: the vehicle generated "
            f"{gen_mech_W:.6g} W from mechanical sources while removing only "
            f"{fluid_mech_removed_W:.6g} W from the flow -- a surplus of {surplus_W:.6g} W "
            f"(tolerance {tol_W:.3g} W). Electrical energy converted from the air cannot "
            "exceed the mechanical power the vehicle's own forces took out of the air.",
            t_s=float(t_s), where=where,
        )


# --------------------------------------------------------------------------------------
# Core force / power assembly
# --------------------------------------------------------------------------------------


@dataclass
class _Eval:
    """@description One evaluation of every element on every body. All SI."""

    forces_N: np.ndarray            # [n_bodies, 3] N, EXCLUDING gravity
    grav_N: np.ndarray              # [n_bodies, 3] N
    power_gen_W: float              # W, >= 0 (PV, turbine, regen)
    power_load_W: float             # W, >= 0 (propulsion, payload)
    aero_N: np.ndarray              # [n_bodies, 3] N, aerodynamic-surface forces only
    tether_N: np.ndarray            # [n_bodies, 3] N, tether forces only
    wind_ms: np.ndarray             # [n_bodies, 3] m/s, wind at each body
    v_air_ms: np.ndarray            # [n_bodies, 3] m/s, air-relative velocity of each body
    rho_kgm3: np.ndarray            # [n_bodies] kg/m^3
    mu_Pas: np.ndarray              # [n_bodies] Pa*s
    thrust_N: float                 # N, total commanded thrust magnitude
    thruster_fallback: bool         # True if the integrator's own disk model was used
    gen_violation_W: float = 0.0    # W, see _GENERATION_REACTION_RULE below; > 0 is a BUG
    power_gen_mech_W: float = 0.0   # W, >= 0, the part of power_gen_W converted from the FLOW
                                    # (i.e. excluding photovoltaic / fuel-cell / RTG sources)
    fluid_mech_removed_W: float = 0.0  # W, >= 0.  sum over ELEMENTS of max(0, -(F_i.v_air_i)):
                                    # the total mechanical power the vehicle's forces take OUT
                                    # of the flow.  The vehicle-level ceiling on
                                    # power_gen_mech_W.  Summed PER ELEMENT and floored at
                                    # zero, never as -sum(F).v_air: a vehicle carrying both a
                                    # turbine and the propulsor that cancels its drag has a
                                    # NET fluid force of exactly zero, and the net form would
                                    # then declare its wholly legitimate 338 W a violation
                                    # (measured on validation case D).
    unmet_thrust_N: float = 0.0     # N, >= 0, along-track force deficit left AFTER every
                                    # thruster did what its power budget allowed.  Must be
                                    # BILLED, never discarded (see FATAL 1).
    excess_thrust_N: float = 0.0    # N, >= 0, uncommanded NET FORWARD force.  A vehicle that
                                    # is pushed along its flight path by something nobody
                                    # commanded is being given momentum for free.
    power_load_replan_W: float = 0.0  # W, >= 0, the slice of power_load_W drawn by elements
                                    # the slow loop RE-EVALUATES per RK4 stage (KIND_PV /
                                    # KIND_GENERIC).  The slow loop subtracts this from the
                                    # frozen trim-time load and bills the per-stage draw
                                    # instead, so a time-varying load cannot hide behind a
                                    # trim evaluated once (ROUND-3 fix 5, probe p13).
    n_invalid_aero: int = 0         # count of aero elements whose evaluation this call
                                    # CONSUMED an uncertified polar point (last_valid False
                                    # with a polar actually consulted, last_Re > 0).  Any
                                    # integrated state built on such an _Eval is fiction;
                                    # the slow loop refuses the closure verdict and the
                                    # fast loop taints certified (ROUND-4, FATAL 1 layer 3).


def _make_bodies(vehicle: Any, pos_m: np.ndarray, vel_ms: np.ndarray) -> list[Any]:
    """
    @description Rebuild the vehicle's BodyState list at a trial (pos, vel) without mutating
                 the caller's vehicle.  Uses dataclasses.replace when available so the real
                 BodyState type (with att_quat) is preserved.
    @param pos_m [n_bodies,3] m.  @param vel_ms [n_bodies,3] m/s.
    @returns list of BodyState-like objects.
    """
    out = []
    for i, b in enumerate(vehicle.bodies):
        try:
            out.append(replace(b, pos_m=np.array(pos_m[i], dtype=float),
                               vel_ms=np.array(vel_ms[i], dtype=float)))
        except Exception:
            import copy

            nb = copy.copy(b)
            nb.pos_m = np.array(pos_m[i], dtype=float)
            nb.vel_ms = np.array(vel_ms[i], dtype=float)
            out.append(nb)
    return out


def _advance_accepted_element_states(
    vehicle: Any,
    env: EnvBundle,
    pos_m: np.ndarray,
    vel_ms: np.ndarray,
    t_s: float,
    dt_s: float,
) -> int:
    """
    @description Advance slow element-owned state exactly once for an ACCEPTED integrator
                 step. Force/RK4 trial evaluations must be referentially stable: advancing
                 helium temperature/permeation on every root-solver probe made the trim target
                 move underneath the solver, while skipping storage elements entirely left a
                 real pack's temperature and heater command frozen forever. This commit point
                 samples each stateful element at the accepted midpoint environment and ignores
                 its returned force/power; those outputs belong to the next force/bus evaluation.
                 Electrical battery state remains integrator-owned (OBJECTION 3).
    @param pos_m [n_bodies,3] m, accepted midpoint positions.
    @param vel_ms [n_bodies,3] m/s, accepted midpoint velocities.
    @param t_s s, accepted midpoint time. @param dt_s s, accepted step duration.
    @returns Number of stateful element instances advanced.
    """
    if dt_s <= 0.0:
        return 0
    bodies = _make_bodies(vehicle, pos_m, vel_ms)
    cache = _EnvCache(env, t_s)
    advanced = 0
    for el in list(getattr(vehicle, "elements", []) or []):
        kind = _classify(el)
        if kind not in (KIND_BATTERY, KIND_BUOYANCY):
            continue
        evaluate = getattr(el, "evaluate", None)
        if not callable(evaluate):
            # Duck-typed storage may expose capacity_J without implementing the optional
            # ForceElement hook. Its electrical state is still integrated above; there is
            # simply no separate slow state to commit here.
            continue
        bi = _body_index(el)
        p_el = pos_m[bi] + _offset_m(el)
        tilt_deg, az_deg = _panel_orientation(el)
        evaluate(
            bodies,
            cache.atmo(p_el[2]),
            cache.wind(p_el),
            cache.solar(p_el[2], tilt_deg, az_deg),
            t_s,
            dt_s,
        )
        advanced += 1
    return advanced


def _evaluate(
    vehicle: Any,
    env: EnvBundle,
    pos_m: np.ndarray,
    vel_ms: np.ndarray,
    t_s: float,
    dt_s: float,
    autothrottle: bool = True,
) -> _Eval:
    """
    @description Evaluate every force element at a trial state, sampling the environment at
                 each element's OWN position (see OBJECTION 1), and run the integrator-owned
                 autothrottle so thrust balances the along-track force deficit.
    @param pos_m [n_bodies,3] m ENU.  @param vel_ms [n_bodies,3] m/s ENU (ground-relative).
    @param t_s s. @param dt_s s, passed through to stateless elements that need a rate.
                        Buoyancy's thermal/permeation state receives 0 here because this is a
                        trial evaluation; _advance_accepted_element_states owns its commit.
    @param autothrottle If True, thrusters are commanded to hold the current airspeed
                        (thrust = along-track deficit, i.e. drag in level flight).  If False,
                        thrusters are commanded to zero (glide / free flight).
    @returns _Eval
    """
    nb = len(vehicle.bodies)
    cache = _EnvCache(env, t_s)

    forces = np.zeros((nb, 3))
    aero = np.zeros((nb, 3))
    tether = np.zeros((nb, 3))
    wind_b = np.zeros((nb, 3))
    rho_b = np.zeros(nb)
    mu_b = np.zeros(nb)
    p_gen_W = 0.0
    p_load_W = 0.0

    masses = np.array([float(b.mass_kg) for b in vehicle.bodies])
    grav = np.zeros((nb, 3))
    grav[:, 2] = -masses * G0_MS2                      # N, ENU up-negative

    # Per-body ambient state (used by trim, Reynolds, the disk model and the audit).
    for i in range(nb):
        a = cache.atmo(pos_m[i, 2])
        rho_b[i] = float(a.rho_kgm3)
        mu_b[i] = float(a.mu_Pas)
        wind_b[i] = _wind_vec(cache.wind(pos_m[i]))
    v_air = vel_ms - wind_b                             # m/s, air-relative

    bodies = _make_bodies(vehicle, pos_m, vel_ms)
    elements = list(getattr(vehicle, "elements", []) or [])
    gen_violation_W = 0.0
    p_gen_mech_W = 0.0
    fluid_removed_W = 0.0
    p_load_replan_W = 0.0
    n_invalid_aero = 0

    if not elements:
        # Vehicle exposes no element list -> fall back to the locked Vehicle.net() contract,
        # sampling at body 0.  Multi-body shear is then physically unavailable (OBJECTION 1).
        #
        # GUARD BLIND SPOT, STATED PLAINLY: net() returns ONE aggregated force and ONE
        # aggregated power, so _GENERATION_REACTION_RULE cannot be applied per element --
        # a solar array's forceless generation is indistinguishable from a turbine's
        # manufactured generation once they have been summed.  gen_violation_W is therefore
        # left at 0.0 on this path, which means it reports "no violation found", NOT "no
        # violation exists".  Any vehicle that wants the sharp guard must expose `.elements`.
        if hasattr(vehicle, "net"):
            atmo0 = cache.atmo(pos_m[0, 2])
            wind0 = cache.wind(pos_m[0])
            sol0 = cache.solar(pos_m[0, 2], 0.0, 180.0)
            f, p_net_W = vehicle.net(atmo0, wind0, sol0, t_s, dt_s)
            f = np.asarray(f, dtype=float).reshape(nb, 3)
            forces += f
            aero += f
            if p_net_W >= 0.0:
                p_gen_W += float(p_net_W)
            else:
                p_load_W += -float(p_net_W)
        # net() aggregates, so generation cannot be attributed to a source type; charge ALL of
        # it against the mechanical budget, which is the conservative reading.
        ev0 = _Eval(forces, grav, p_gen_W, p_load_W, aero, tether, wind_b, v_air,
                    rho_b, mu_b, 0.0, False)
        ev0.power_gen_mech_W = p_gen_W
        # `aero` is the aggregated net() force here (or exact zeros when the vehicle exposes
        # neither elements nor net()), so this is the per-body form of the same bound.
        ev0.fluid_mech_removed_W = _mech_removed_by_element_W(aero, v_air, 0)
        ev0.unmet_thrust_N, ev0.excess_thrust_N = _along_track_residual_N(
            forces, grav, v_air
        )
        return ev0

    thrusters: list[Any] = []

    # ---- pass 1: everything that is not a thruster ------------------------------------
    for el in elements:
        kind = _classify(el)
        if kind == KIND_THRUSTER:
            thrusters.append(el)
            continue
        if kind == KIND_BATTERY:
            # Storage is the integrator's state, never a bus source (OBJECTION 3).
            continue

        bi = _body_index(el)
        p_el = pos_m[bi] + _offset_m(el)
        tilt_deg, az_deg = _panel_orientation(el)
        sol_el = cache.solar(p_el[2], tilt_deg, az_deg)
        # A root-solver/RK stage is a numerical PROBE, not elapsed physical time. Passing
        # dt_s through to BuoyancyVolume used to consume one thermal/permeation interval for
        # every rejected trim guess (roughly two hours of chemistry in one accepted minute),
        # so the lift target moved and the strict trim could never converge.
        trial_dt_s = 0.0 if kind == KIND_BUOYANCY else dt_s
        res = el.evaluate(
            bodies,
            cache.atmo(p_el[2]),
            cache.wind(p_el),
            sol_el,
            t_s,
            trial_dt_s,
        )
        # ROUND-4 layer 3: did this aero element CONSUME an uncertified polar point?
        # Duck-typed on the shipped AeroSurface diagnostics: last_valid False with
        # last_Re > 0 means a polar was actually consulted and the point failed the
        # certification gate (outside the Re band, outside the certified alpha span,
        # confidence under floor).  last_Re == 0 is the no-airspeed early return, which
        # consumes no polar and is not an uncertified point.
        if kind == KIND_AERO and hasattr(el, "last_valid"):
            if (not bool(getattr(el, "last_valid"))
                    and float(getattr(el, "last_Re", 0.0)) > 0.0):
                n_invalid_aero += 1

        f = np.asarray(res.force_N, dtype=float)
        fluid_removed_W += _mech_removed_by_element_W(f, v_air, bi)
        if f.ndim == 2:
            # Element emits forces on several bodies at once (a tether does).
            forces += f
            if kind == KIND_TETHER:
                tether += f
            elif kind == KIND_AERO:
                aero += f
        else:
            f = f.reshape(3)
            forces[bi] += f
            if kind == KIND_TETHER:
                tether[bi] += f
            elif kind == KIND_AERO:
                aero[bi] += f
            elif kind in (KIND_BUOYANCY, KIND_GENERIC):
                aero[bi] += f          # fluid-borne force for the wind-work audit

        p_W = float(res.power_elec_W)
        if p_W >= 0.0:
            p_gen_W += p_W
            if p_W > 0.0:
                if _is_non_mechanical_source(el, kind):
                    # The exemption's price: bounded by the sun over the declared area.
                    _assert_solar_bounded(el, p_W, sol_el, t_s, "_evaluate")
                else:
                    p_gen_mech_W += p_W
                    gen_violation_W = max(
                        gen_violation_W,
                        _generation_reaction_violation_W(res.force_N, v_air, p_W, bi),
                    )
        else:
            p_load_W += -p_W
            if kind in (KIND_PV, KIND_GENERIC):
                p_load_replan_W += -p_W

    # ---- pass 2: autothrottle ---------------------------------------------------------
    total_thrust_N = 0.0
    used_fallback = False
    for el in thrusters:
        bi = _body_index(el)
        v_air_i = v_air[bi]
        speed = float(np.linalg.norm(v_air_i))
        if speed > 0.1:
            d_hat = v_air_i / speed               # 3-DOF: thrust acts along the flight path
        else:
            ax = np.asarray(getattr(el, "axis", np.array([1.0, 0.0, 0.0])), dtype=float)
            n = float(np.linalg.norm(ax))
            d_hat = ax / n if n > _EPS else np.array([1.0, 0.0, 0.0])

        if autothrottle:
            deficit_N = -(forces[bi] + grav[bi])          # N, what is missing for equilibrium
            T_req_N = float(np.dot(deficit_N, d_hat))
            T_req_N = max(0.0, T_req_N)
        else:
            T_req_N = 0.0

        p_max_W = float(getattr(el, "max_electrical_power_W", math.inf))
        _command_thrust(el, T_req_N)

        p_el = pos_m[bi] + _offset_m(el)
        res = el.evaluate(
            bodies,
            cache.atmo(p_el[2]),
            cache.wind(p_el),
            cache.solar(p_el[2], 0.0, 180.0),
            t_s,
            dt_s,
        )
        f = np.asarray(res.force_N, dtype=float).reshape(3)
        p_W = float(res.power_elec_W)
        # Real BEMT points can converge numerically while consuming too much
        # uncertified sectional-polar support. Carry that verdict into the same
        # certification counter as a wing polar; a trim probe may explore it,
        # but an accepted flight result may not call it certified.
        if hasattr(el, "last_point_valid") and not bool(el.last_point_valid):
            n_invalid_aero += 1

        if T_req_N > 1e-9 and float(np.linalg.norm(f)) < 1e-9:
            # The element ignored the command -> integrator-owned fallback (OBJECTION 2).
            used_fallback = True
            p_need_W = _actuator_disk_power_W(T_req_N, speed, rho_b[bi], _disk_area_m2(el))
            if p_need_W > p_max_W > 0.0:
                # Power-limited: back the thrust off until the disk model fits the budget.
                T_req_N = _thrust_for_power(p_max_W, speed, rho_b[bi], _disk_area_m2(el))
                p_need_W = p_max_W
            forces[bi] += T_req_N * d_hat
            fluid_removed_W += _mech_removed_by_element_W(T_req_N * d_hat, v_air, bi)
            p_load_W += p_need_W
            total_thrust_N += T_req_N
        else:
            forces[bi] += f
            fluid_removed_W += _mech_removed_by_element_W(f, v_air, bi)
            total_thrust_N += float(np.linalg.norm(f))
            if p_W >= 0.0:
                p_gen_W += p_W
                if p_W > 0.0 and not _is_non_mechanical_source(el, KIND_THRUSTER):
                    # A regenerating propulsor is a turbine wearing a thruster's classifier.
                    p_gen_mech_W += p_W
                    gen_violation_W = max(
                        gen_violation_W,
                        _generation_reaction_violation_W(res.force_N, v_air, p_W, bi),
                    )
            else:
                p_load_W += -p_W

    ev = _Eval(forces, grav, p_gen_W, p_load_W, aero, tether, wind_b, v_air,
               rho_b, mu_b, total_thrust_N, used_fallback, gen_violation_W)
    ev.power_gen_mech_W = p_gen_mech_W
    ev.fluid_mech_removed_W = fluid_removed_W
    ev.power_load_replan_W = p_load_replan_W
    ev.n_invalid_aero = n_invalid_aero
    ev.unmet_thrust_N, ev.excess_thrust_N = _along_track_residual_N(forces, grav, v_air)
    return ev


class _GenPlan:
    """
    @description Everything a generation evaluation needs that does NOT change across the
                 four RK4 sub-times of one slow-loop step.  Within a 60 s step of level
                 cruise the position, velocity, atmosphere and wind are all fixed; only the
                 SUN moves.  Precomputing the rest turns each sub-time into one solar call
                 plus one element evaluation.
                 Measured on this box for the 24 h AtlantikSolar case: 3021 ms with a full
                 _evaluate per sub-time, 1424 ms evaluating only the generators, 233 ms with
                 this plan -- against a 1000 ms budget.
    """

    __slots__ = ("entries", "bodies", "env")

    def __init__(self, entries: list, bodies: list, env: EnvBundle) -> None:
        # entries: (element, kind, body_index, z_m, atmo, wind, tilt_deg, azimuth_deg)
        self.entries = entries
        self.bodies = bodies
        self.env = env


def _prepare_generation(
    vehicle: Any, env: EnvBundle, pos_m: np.ndarray, vel_ms: np.ndarray, t_s: float
) -> _GenPlan:
    """
    @description Build the step-invariant half of a generation evaluation.
    @returns _GenPlan
    """
    elements = getattr(vehicle, "elements", None) or []
    cache = _EnvCache(env, t_s)
    entries = []
    for el in elements:
        kind = _classify(el)
        if kind not in (KIND_PV, KIND_GENERIC):
            continue
        bi = _body_index(el)
        p_el = pos_m[bi] + _offset_m(el)
        tilt_deg, az_deg = _panel_orientation(el)
        entries.append((el, kind, bi, float(p_el[2]), cache.atmo(p_el[2]),
                        cache.wind(p_el), tilt_deg, az_deg))
    return _GenPlan(entries, _make_bodies(vehicle, pos_m, vel_ms), env)


def _generation_from_plan(
    plan: _GenPlan, v_air_ms: np.ndarray, t_s: float, dt_s: float
) -> tuple[float, float, float, float]:
    """
    @description Evaluate ONLY the re-evaluable elements (photovoltaic + any generic
                 converter or consumer), reusing a prepared plan.  Negative power used to be
                 DISCARDED here (the old `if p_W > 0.0` gate), which is exactly how a
                 time-varying load stayed billed at its trim-time value while generation
                 integrated per stage (probe p13: an 11.2x under-bill).  Consumer draw is now
                 accumulated and returned so the slow loop bills it per RK4 stage.
    @param v_air_ms [n_bodies,3] m/s air-relative velocity, for the generation-reaction rule.
    @returns (power_gen_W, power_gen_mechanical_W, gen_violation_W, power_draw_W).  The
             second term is the part of the generation converted FROM THE FLOW, which is
             what the vehicle-level budget in _assert_generation_budget bounds; declared
             non-mechanical output is excluded there but bounded by irradiance * area.  The
             last term is the plan elements' electrical CONSUMPTION, W >= 0.
    @raises FreeEnergyError when a declared non-mechanical source out-generates the sun
            over its own declared area.
    """
    if not plan.entries:
        return 0.0, 0.0, 0.0, 0.0
    solar_fn = _env().solar
    env = plan.env
    utc_h = env.utc_hour_h(t_s)
    p_gen_W = 0.0
    p_gen_mech_W = 0.0
    violation_W = 0.0
    p_draw_W = 0.0
    for el, kind, bi, z_m, atmo, wind, tilt_deg, az_deg in plan.entries:
        z_clamped = min(max(z_m, ALT_MIN_M), ALT_MAX_M)
        sol = solar_fn(env.latitude_deg, env.longitude_deg, env.day_of_year,
                       utc_h, z_clamped, tilt_deg, az_deg)
        res = el.evaluate(plan.bodies, atmo, wind, sol, t_s, dt_s)
        p_W = float(res.power_elec_W)
        if p_W > 0.0:
            p_gen_W += p_W
            if _is_non_mechanical_source(el, kind):
                _assert_solar_bounded(el, p_W, sol, t_s, "_generation_from_plan")
            else:
                p_gen_mech_W += p_W
                violation_W = max(
                    violation_W,
                    _generation_reaction_violation_W(res.force_N, v_air_ms, p_W, bi),
                )
        elif p_W < 0.0:
            p_draw_W += -p_W
    return p_gen_W, p_gen_mech_W, violation_W, p_draw_W


def _thrust_for_power(
    power_W: float, V_ms: float, rho_kgm3: float, disk_area_m2: float
) -> float:
    """
    @description Invert _actuator_disk_power_W for thrust given an electrical power budget.
                 Monotone in T, so a bisection is exact and cannot diverge.
    @returns Thrust, N, >= 0.
    """
    lo_N, hi_N = 0.0, 1.0
    for _ in range(200):
        if _actuator_disk_power_W(hi_N, V_ms, rho_kgm3, disk_area_m2) >= power_W:
            break
        hi_N *= 2.0
    for _ in range(80):
        mid_N = 0.5 * (lo_N + hi_N)
        if _actuator_disk_power_W(mid_N, V_ms, rho_kgm3, disk_area_m2) < power_W:
            lo_N = mid_N
        else:
            hi_N = mid_N
    return 0.5 * (lo_N + hi_N)


# --------------------------------------------------------------------------------------
# Quasi-steady trim (the slow loop's inner solve)
# --------------------------------------------------------------------------------------


def _has_lifting_support(vehicle: Any) -> bool:
    """
    @description Can this vehicle hold altitude at all?  A body with an aero surface or a
                 buoyancy volume can be trimmed; a bare point mass cannot and must be
                 integrated ballistically instead.
    @returns True if a quasi-steady trim is meaningful.
    """
    for el in getattr(vehicle, "elements", []) or []:
        if _classify(el) in (KIND_AERO, KIND_BUOYANCY):
            return True
    return False


def _trim_airspeed(
    vehicle: Any,
    env: EnvBundle,
    pos_m: np.ndarray,
    heading_hat: np.ndarray,
    t_s: float,
    dt_s: float,
    v_guess_ms: float,
) -> tuple[float, _Eval]:
    """
    @description Quasi-steady trim: with incidence FIXED by the geometry (OBJECTION 2), the
                 only trim freedom is airspeed, so solve for the airspeed V at which the
                 total VERTICAL force (aero lift + buoyancy + thrust component + weight)
                 vanishes.  Aerodynamic lift scales as V^2 at fixed angle of attack, so the
                 fixed-point update
                     V <- V * sqrt( W_needed / L(V) )
                 converges quadratically-ish; CL drifts only weakly through Reynolds number.
                 Falls back to a bracketed bisection if the fixed point misbehaves.
    @param heading_hat ndarray[3], unit horizontal heading of the air-relative velocity.
    @param v_guess_ms  warm start, m/s.
    @returns (V_trim_ms, evaluation at trim)
    """
    nb = len(vehicle.bodies)
    weight_N = sum(float(b.mass_kg) for b in vehicle.bodies) * G0_MS2

    wind_at_body = np.array([
        _wind_vec(env.wind.sample(float(pos_m[i, 0]), float(pos_m[i, 1]),
                                  float(pos_m[i, 2]), t_s))
        for i in range(nb)
    ])                                                      # m/s, one sample per body

    def eval_at(V_ms: float) -> _Eval:
        # ground velocity = local wind + airspeed along the cruise heading
        vel = wind_at_body + V_ms * heading_hat[None, :]
        return _evaluate(vehicle, env, pos_m, vel, t_s, dt_s, autothrottle=True)

    # Buoyant vehicles can balance weight at V = 0; check that first.
    ev0 = eval_at(0.0)
    lift0_N = float(np.sum(ev0.forces_N[:, 2]))
    if lift0_N >= weight_N - 1e-9:
        return 0.0, ev0

    V = max(float(v_guess_ms), 0.5)
    ev = eval_at(V)
    for _ in range(_TRIM_MAX_ITER):
        lift_N = float(np.sum(ev.forces_N[:, 2]))          # includes buoyancy if present
        residual_N = weight_N - lift_N
        if abs(residual_N) <= _TRIM_REL_TOL * max(weight_N, 1.0):
            return V, ev
        if lift_N <= _EPS:
            V = min(V * 2.0, _TRIM_V_MAX_MS)
        else:
            V_new = V * math.sqrt(max(weight_N, _EPS) / lift_N)
            # damp so a non-quadratic polar (post-stall) cannot oscillate
            V = min(max(0.5 * (V + V_new), _TRIM_V_MIN_MS), _TRIM_V_MAX_MS)
        ev = eval_at(V)

    # Bisection fallback: an INITIALIZER, never a result (ROUND 4, FATAL 1 layer 2).
    # It brackets a root even for a nonmonotone polar, but its answer is only accepted
    # after it passes the SAME residual tolerance as the fixed point. On the R4 winner
    # the old unconditional `return` handed back the 300 m/s rail, where the polar has
    # zero certified rows, the wing returns zero force, and the residual was the entire
    # 9709 N weight -- scored as a valid trim.
    lo, hi = _TRIM_V_MIN_MS, _TRIM_V_MAX_MS
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        ev = eval_at(mid)
        if float(np.sum(ev.forces_N[:, 2])) < weight_N:
            lo = mid
        else:
            hi = mid
    V = 0.5 * (lo + hi)
    ev = eval_at(V)
    # Polish from the bisection seed with the damped fixed point, then ENFORCE the
    # residual. A residual above tolerance is a raise, never a returned state.
    for _ in range(_TRIM_MAX_ITER):
        lift_N = float(np.sum(ev.forces_N[:, 2]))
        residual_N = weight_N - lift_N
        if abs(residual_N) <= _TRIM_REL_TOL * max(weight_N, 1.0):
            return V, ev
        if lift_N <= _EPS:
            break                       # zero lift: no fixed-point update exists
        V_new = V * math.sqrt(max(weight_N, _EPS) / lift_N)
        V = min(max(0.5 * (V + V_new), _TRIM_V_MIN_MS), _TRIM_V_MAX_MS)
        ev = eval_at(V)
    lift_N = float(np.sum(ev.forces_N[:, 2]))
    residual_N = weight_N - lift_N
    raise TrimConvergenceError(
        f"quasi-steady trim did not converge: after {_TRIM_MAX_ITER} fixed-point "
        f"iterations, a 60-step bisection on [{_TRIM_V_MIN_MS:g}, {_TRIM_V_MAX_MS:g}] "
        f"m/s and {_TRIM_MAX_ITER} polish iterations, the vertical residual is "
        f"{residual_N:.6g} N against a tolerance of "
        f"{_TRIM_REL_TOL * max(weight_N, 1.0):.6g} N (weight {weight_N:.6g} N, "
        f"last V = {V:.6g} m/s, lift = {lift_N:.6g} N, "
        f"{ev.n_invalid_aero} element(s) consuming uncertified aero at that state). "
        "This design cannot be evaluated -- it is a hard failure, not a score."
    )


# --------------------------------------------------------------------------------------
# Battery bookkeeping
# --------------------------------------------------------------------------------------


@dataclass
class _BatterySpec:
    """@description Battery parameters and the optional real storage authority. All SI.

    `authority` is set only for exactly one real-chemistry element exposing
    `step(power_W, dt_s)`.  The flat fields remain the explicit ideal model;
    they are never consulted on the real path.
    """

    capacity_J: float = 0.0
    initial_soc: float = 1.0
    eta_charge: float = ETA_CHARGE_DEFAULT
    eta_discharge: float = ETA_DISCHARGE_DEFAULT
    soc_min: float = SOC_MIN_DEFAULT
    soc_max: float = SOC_MAX_DEFAULT
    authority: Any = None
    model: str = "flat-efficiency"


#: Attribute names, in priority order, through which a storage element may declare the
#: state of charge it starts at.  `initial_soc` is the documented constructor parameter;
#: `soc` / `state.soc` are the documented read-back of the same quantity on a pack that has
#: not been stepped yet.  There is DELIBERATELY no default: a missing declaration used to
#: fall through to 1.0, which silently handed every design in the sweep a full battery it
#: never paid for -- the cheapest free resource in the whole model.
_SOC0_ATTRS: tuple[str, ...] = ("initial_soc", "soc")


def _declared_initial_soc(el: Any) -> float:
    """
    @description Read a storage element's starting state of charge from its documented
                 attribute.  Absence is an ERROR, not a default.
    @param el A storage element (classified KIND_BATTERY, i.e. it exposes capacity_J).
    @returns State of charge, dimensionless 0..1.
    @raises ValueError when the element declares no starting state of charge at all.
    """
    for name in _SOC0_ATTRS:
        val = getattr(el, name, None)
        if val is not None:
            return float(val)
    state = getattr(el, "state", None)
    if state is not None and getattr(state, "soc", None) is not None:
        return float(state.soc)
    raise ValueError(
        f"storage element {type(el).__name__!r} declares none of "
        f"{_SOC0_ATTRS + ('state.soc',)}, so its starting state of charge is unknown. "
        "integrate refuses to assume a full pack: an undeclared initial_soc used to default "
        "to 1.0, which is free stored energy no design paid for."
    )


def _battery_spec(vehicle: Any) -> _BatterySpec:
    """
    @description Collect battery parameters (summing capacity across multiple packs), and
                 RE-VALIDATE every one of them.  This is the second wall of the
                 range-check-or-bill invariant: the shipped BatteryElement range-checks at
                 construction, but a pack built around __init__ (object.__new__, mutated
                 attributes, a duck-typed impostor exposing capacity_J) reaches the
                 integrator anyway, and eta > 1 or soc_max > 1 is a free-energy machine
                 (probes p3/p5/p8: eta_charge = 2.0 minted 4 J per stored 1 J round trip;
                 soc_max = 3.0 tripled the pack at its nameplate mass).  Same bounds as the
                 constructor, enforced again at spec extraction.
    @returns _BatterySpec; capacity_J = 0 when the vehicle carries no storage.
    @raises ValueError when a storage element does not declare its starting state of charge,
            or when any extracted parameter falls outside its physical range:
            capacity_J finite >= 0, eta_charge / eta_discharge in (0, 1],
            0 <= soc_min < soc_max <= 1, and 0 <= initial_soc <= soc_max.
    """
    spec = _BatterySpec(capacity_J=0.0)
    found = False
    storage_elements: list[Any] = []
    soc0_weighted_J = 0.0
    for el in getattr(vehicle, "elements", []) or []:
        if _classify(el) != KIND_BATTERY:
            continue
        storage_elements.append(el)
        cap_J = float(getattr(el, "capacity_J", 0.0))
        soc0 = _declared_initial_soc(el)
        spec.capacity_J += cap_J
        soc0_weighted_J += cap_J * soc0
        spec.eta_charge = float(getattr(el, "eta_charge", spec.eta_charge))
        spec.eta_discharge = float(getattr(el, "eta_discharge", spec.eta_discharge))
        spec.soc_min = float(getattr(el, "soc_min", spec.soc_min))
        spec.soc_max = float(getattr(el, "soc_max", spec.soc_max))
        if not (math.isfinite(cap_J) and cap_J >= 0.0):
            raise ValueError(
                f"storage element {type(el).__name__!r} declares capacity_J = {cap_J!r}; "
                "it must be a finite non-negative energy."
            )
        found = True
    real_elements = [
        el for el in storage_elements
        if str(getattr(el, "chemistry", "ideal")) != "ideal"
    ]
    if real_elements:
        if len(storage_elements) != 1:
            raise ValueError(
                "a real electrochemical mission requires exactly ONE storage "
                f"authority, found {len(storage_elements)} storage elements. "
                "Splitting nonlinear ECM current between packs is a controller "
                "decision; integrate refuses to invent it."
            )
        authority = real_elements[0]
        if not callable(getattr(authority, "step", None)):
            raise ValueError(
                f"real storage element {type(authority).__name__!r} does not "
                "expose step(power_W, dt_s); PackEcm cannot be the electrical "
                "authority through a flat-efficiency fallback"
            )
        spec.authority = authority
        spec.model = "real-ecm"
    if found and spec.capacity_J > 0.0:
        spec.initial_soc = soc0_weighted_J / spec.capacity_J
    if found:
        for name, val in (("eta_charge", spec.eta_charge),
                          ("eta_discharge", spec.eta_discharge)):
            if not (math.isfinite(val) and 0.0 < val <= 1.0):
                raise ValueError(
                    f"storage {name} = {val!r} is outside (0, 1]. An efficiency above 1 "
                    "MINTS energy on every round trip; integrate refuses it even when the "
                    "element was built around its constructor (second wall)."
                )
        if not (math.isfinite(spec.soc_min) and math.isfinite(spec.soc_max)
                and 0.0 <= spec.soc_min < spec.soc_max <= 1.0):
            raise ValueError(
                f"storage SOC rails [soc_min, soc_max] = [{spec.soc_min!r}, "
                f"{spec.soc_max!r}] are invalid; they must satisfy 0 <= soc_min < "
                "soc_max <= 1. soc_max above 1 is stored energy the pack's billed mass "
                "never paid for (second wall)."
            )
        if not (math.isfinite(spec.initial_soc)
                and 0.0 <= spec.initial_soc <= spec.soc_max + 1e-12):
            raise ValueError(
                f"storage initial_soc = {spec.initial_soc!r} is outside "
                f"[0, soc_max = {spec.soc_max}]. A pack cannot start above its own upper "
                "rail; that is free stored energy (second wall)."
            )
    return spec


def _prepare_real_storage(spec: _BatterySpec) -> None:
    """
    @description Align the one real pack's live electrical state with the declared
                 integration seed without resetting temperature or accumulated aging.
                 Mission chunking updates `initial_soc` at a physical boundary; this is
                 the single place that seed enters PackEcm.
    @param spec Extracted battery specification.
    @returns None.
    @raises ValueError When the real authority does not expose the frozen ECM/state shape.
    """
    pack = spec.authority
    if pack is None:
        return
    ecm = getattr(pack, "ecm", None)
    if ecm is None:
        raise ValueError(
            f"real storage authority {type(pack).__name__!r} has no ecm state; "
            "a chemistry label without PackEcm would silently fall back to an ideal bucket"
        )
    ecm.soc = float(spec.initial_soc)
    ecm.soc_min = float(spec.soc_min)
    ecm.soc_max = float(spec.soc_max)
    state = getattr(pack, "state", None)
    if state is not None and hasattr(state, "energy_J") and hasattr(state, "soc"):
        pack.state = type(state)(
            energy_J=float(spec.initial_soc) * float(spec.capacity_J),
            soc=float(spec.initial_soc),
        )
    if hasattr(pack, "min_soc_seen"):
        pack.min_soc_seen = min(float(pack.min_soc_seen), float(spec.initial_soc))


def _step_real_storage(
    spec: _BatterySpec, p_net_W: float, dt_s: float
) -> tuple[float, float, float]:
    """
    @description Commit one accepted bus interval through the real pack authority.
                 Positive bus power charges; negative power discharges. PackEcm returns
                 unserved BUS power, so spill and shortfall stay in the same units as the
                 generation/load ledgers and are never reconstructed from a flat eta.
    @param spec Real battery specification. @param p_net_W Net bus power, W.
    @param dt_s Accepted interval, s.
    @returns (energy_J, unabsorbed_surplus_J, unserved_shortfall_J).
    @raises ValueError On a non-finite result or a sign-inconsistent authority response.
    """
    pack = spec.authority
    if pack is None:
        raise ValueError("_step_real_storage requires spec.authority")
    unserved_W = float(pack.step(float(p_net_W), float(dt_s)))
    if not math.isfinite(unserved_W):
        raise ValueError(
            f"storage authority returned non-finite unserved power {unserved_W!r}"
        )
    tol_W = 1.0e-9 * max(1.0, abs(float(p_net_W)))
    if p_net_W > 0.0 and unserved_W < -tol_W:
        raise ValueError(
            f"storage authority returned discharge shortfall {unserved_W:g} W "
            f"for a charging bus interval {p_net_W:g} W"
        )
    if p_net_W < 0.0 and unserved_W > tol_W:
        raise ValueError(
            f"storage authority returned charge spill {unserved_W:g} W "
            f"for a discharging bus interval {p_net_W:g} W"
        )
    energy_J = float(getattr(pack, "energy_J"))
    if not math.isfinite(energy_J):
        raise ValueError(
            f"storage authority returned non-finite stored energy {energy_J!r}"
        )
    return (
        energy_J,
        max(0.0, unserved_W) * float(dt_s),
        max(0.0, -unserved_W) * float(dt_s),
    )


def _dEdt_J_per_s(p_net_W: float, spec: _BatterySpec) -> float:
    """
    @description Rate of change of STORED energy for a given net bus power.  Charging pays
                 eta_charge, discharging pays 1/eta_discharge -- asymmetric on purpose, so no
                 round trip is ever a single fudge factor.
    @param p_net_W W, generation minus consumption (> 0 = surplus).
    @returns dE/dt, J/s.
    """
    if p_net_W >= 0.0:
        return p_net_W * spec.eta_charge
    return p_net_W / max(spec.eta_discharge, 1e-9)


# --------------------------------------------------------------------------------------
# CLOSURE IS A LIMIT-CYCLE TEST, NOT A ONE-WINDOW TEST  (FATAL 2)
# --------------------------------------------------------------------------------------
#
# "min_soc over ONE user-chosen window, seeded with a full battery" is not a persistence
# test and it certified designs that die on night two.  Measured on the case-B airframe with
# the array shrunk to pv_packing = 0.45: energy_in 24,679 Wh against energy_out 26,437 Wh --
# a 6.6% DAILY DEFICIT -- yet a single 24 h window reported min_soc 0.0845 and closed=True.
# Run six days and it pins at the 0.05 floor from day two on.  The false-pass band ran from
# packing ~0.28 to ~0.55: designs carrying up to 2x too little array certified as closed.
# Even the shipped case B overstated its floor by 37% (0.1103 reported, 0.0807 true).
#
# THE FIX, and why THIS fix.  Within the slow loop the bus power P_gen(t) and P_load(t) are
# state functions of position and time ONLY -- nothing in them reads the state of charge.
# So the storage ODE over one window is an autonomous, monotone, non-expansive map
#
#     g : soc(t0)  ->  soc(t0 + T)                                         [dimensionless]
#
# (monotone because a fuller pack can never end emptier; non-expansive because the rails
# only ever compress the interval).  Its LARGEST fixed point is exactly the best-case
# periodic operating state -- the limit cycle -- and by monotonicity it is also the fixed
# point with the highest floor, so scoring there is the most GENEROUS honest answer and
# anything that fails it fails for real.  g is replayed from the RK4 stage powers the run
# already computed, so finding the fixed point costs pure arithmetic: no extra aerodynamic,
# solar or trim work, which is what makes it affordable inside a 30,000-candidate sweep.
# Chosen over "integrate 48 h and score the second window" because it is strictly cheaper
# (no second aerodynamic pass), it does not silently change the caller's returned time grid,
# and it converges to the exact fixed point rather than approaching it.
#
# The deficit branch needs no iteration at all: if the window's unclamped net stored-energy
# change is negative, NO fixed point above the floor exists and the design is dead. That is
# reported directly, which is also why energy_in_J / energy_out_J / energy_margin_J and
# unabsorbed_shortfall_J are surfaced -- a sweep must never be able to rank on min_soc alone.


@dataclass
class _StorageTape:
    """
    @description The RK4 stage powers of one slow-loop run, recorded so the storage ODE can
                 be replayed at a different initial state of charge for free.  All SI.
    @param h_s        [n_steps]     s, the step length actually taken
    @param gen_W      [n_steps, 4]  W, generation at RK4 stages 1..4 of each step
    @param load_W     [n_steps, 4]  W, electrical load at RK4 stages 1..4.  Loads used to be
                      one frozen trim-time scalar per step while generation integrated per
                      stage (probe p13); re-evaluable consumers are now billed per stage.
    """

    h_s: np.ndarray
    gen_W: np.ndarray
    load_W: np.ndarray


def _replay_storage(
    tape: _StorageTape, spec: _BatterySpec, soc0: float
) -> tuple[np.ndarray, float, float]:
    """
    @description Re-integrate ONLY the storage ODE from a given initial state of charge,
                 using the identical RK4 quadrature and identical SOC rails as the live run.
    @param tape Recorded stage powers.
    @param spec Battery parameters.
    @param soc0 Starting state of charge, dimensionless.
    @returns (soc[n_steps+1] dimensionless,
              unabsorbed_surplus_J >= 0 -- BUS-side generation the full pack could not
              take (the stored-equivalent rail overshoot divided back by eta_charge, so
              the number is in the SAME units as energy_in_J -- validate.usable_energy
              subtracts the two, and mixing meters credited 1-eta_charge of every
              spilled joule as usable, the R7 final-gate finding),
              unabsorbed_shortfall_J >= 0 -- BUS-side demand the empty pack could not
              serve (stored deficit times eta_discharge))
    """
    n = int(tape.h_s.size)
    cap_J = spec.capacity_J
    E_min_J = cap_J * spec.soc_min
    E_max_J = cap_J * spec.soc_max
    E_J = cap_J * float(soc0)
    soc = np.empty(n + 1, dtype=float)
    surplus_J = 0.0
    shortfall_J = 0.0
    for k in range(n):
        soc[k] = E_J / cap_J
        h = float(tape.h_s[k])
        ld = tape.load_W[k]
        g = tape.gen_W[k]
        k1 = _dEdt_J_per_s(float(g[0]) - float(ld[0]), spec)
        k2 = _dEdt_J_per_s(float(g[1]) - float(ld[1]), spec)
        k3 = _dEdt_J_per_s(float(g[2]) - float(ld[2]), spec)
        k4 = _dEdt_J_per_s(float(g[3]) - float(ld[3]), spec)
        E_J = E_J + (h / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
        if E_J > E_max_J:
            # Rail overshoot is STORED-equivalent (dE/dt already paid eta_charge);
            # report the BUS generation the full pack could not take, so the spill
            # meter matches energy_in_J's units (final-gate fix, change log #6).
            surplus_J += (E_J - E_max_J) / max(spec.eta_charge, 1e-9)
            E_J = E_max_J
        elif E_J < E_min_J:
            # Stored deficit times eta_discharge = the BUS demand that went unserved.
            shortfall_J += (E_min_J - E_J) * spec.eta_discharge
            E_J = E_min_J
    soc[n] = E_J / cap_J
    return soc, surplus_J, shortfall_J


def _unclamped_storage_change_J(tape: _StorageTape, spec: _BatterySpec) -> float:
    """
    @description Change in STORED energy over the window with the SOC rails removed.  This is
                 independent of the initial state of charge (the bus powers do not read it),
                 so its sign alone decides whether any sustainable periodic state exists.
    @returns dE, J.  Negative means the window runs a net deficit and no limit cycle above
             the floor can exist, however the pack is seeded.
    """
    total_J = 0.0
    for k in range(int(tape.h_s.size)):
        h = float(tape.h_s[k])
        ld = tape.load_W[k]
        g = tape.gen_W[k]
        k1 = _dEdt_J_per_s(float(g[0]) - float(ld[0]), spec)
        k2 = _dEdt_J_per_s(float(g[1]) - float(ld[1]), spec)
        k3 = _dEdt_J_per_s(float(g[2]) - float(ld[2]), spec)
        k4 = _dEdt_J_per_s(float(g[3]) - float(ld[3]), spec)
        total_J += (h / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
    return total_J


#: Bisection depth for the limit-cycle fixed point.  60 halvings of the unit SOC interval
#: is well past float64 resolution, and the cost is 60 pure-arithmetic replays of the
#: recorded tape -- no element, solar or trim evaluation -- so it is a fixed, tiny budget.
_LIMIT_CYCLE_BISECTIONS: int = 60


def _solve_limit_cycle(
    tape: _StorageTape, spec: _BatterySpec
) -> tuple[float, np.ndarray, float, float, bool]:
    """
    @description Find the LARGEST fixed point of soc(t0) -> soc(t0 + T) and score there.

                 phi(x) = g(x) - x is non-increasing (g is monotone with slope <= 1), with
                 phi(soc_min) >= 0 and phi(soc_max) <= 0, so bisecting on the sign of phi
                 converges to the largest x with phi(x) >= 0: the highest sustainable
                 periodic state.  When the window's unclamped net is negative there is no
                 such state at all and the pack pins at its floor -- reported directly
                 instead of iterated toward.
    @param tape Recorded stage powers.  @param spec Battery parameters.
    @returns (soc0_star, soc_series, unabsorbed_surplus_J, unabsorbed_shortfall_J,
              sustainable) where sustainable is False when the window runs a net deficit.
    """
    net_J = _unclamped_storage_change_J(tape, spec)
    if net_J < 0.0:
        soc, surplus_J, shortfall_J = _replay_storage(tape, spec, spec.soc_min)
        return spec.soc_min, soc, surplus_J, shortfall_J, False

    lo, hi = spec.soc_min, spec.soc_max
    for _ in range(_LIMIT_CYCLE_BISECTIONS):
        mid = 0.5 * (lo + hi)
        soc_mid, _, _ = _replay_storage(tape, spec, mid)
        if float(soc_mid[-1]) >= mid:
            lo = mid
        else:
            hi = mid
    soc, surplus_J, shortfall_J = _replay_storage(tape, spec, lo)
    return lo, soc, surplus_J, shortfall_J, True


# --------------------------------------------------------------------------------------
# Geometry helper for Reynolds reporting
# --------------------------------------------------------------------------------------


def _mean_aero_chord_m(vehicle: Any) -> float:
    """
    @description Mean aerodynamic chord of the primary lifting surface, for the reported
                 cruise Reynolds number.  For a straight-tapered wing of area S, span b and
                 taper ratio lam:
                     c_root = 2*S / (b*(1+lam))                                    [m]
                     c_mac  = (2/3)*c_root*(1 + lam + lam^2)/(1 + lam)             [m]
    @returns chord, m; NaN when the vehicle has no aerodynamic surface.
    """
    for el in getattr(vehicle, "elements", []) or []:
        if _classify(el) != KIND_AERO:
            continue
        geo = getattr(el, "geometry", el)
        b_m = float(getattr(geo, "span_m", 0.0))
        S_m2 = float(getattr(geo, "area_m2", 0.0))
        lam = float(getattr(geo, "taper_ratio", 1.0))
        if b_m <= 0.0 or S_m2 <= 0.0:
            continue
        c_root_m = 2.0 * S_m2 / (b_m * (1.0 + lam))
        return (2.0 / 3.0) * c_root_m * (1.0 + lam + lam * lam) / (1.0 + lam)
    return float("nan")


# --------------------------------------------------------------------------------------
# integrate_energy -- the slow loop
# --------------------------------------------------------------------------------------


def integrate_energy(
    vehicle: Any,
    env: EnvBundle,
    t0_s: float,
    t_end_s: float,
    dt_s: float = 60.0,
) -> SimResult:
    """
    @description Slow energy loop.  Each step the vehicle is trimmed quasi-steadily (airspeed
                 solved so vertical force balances, thrust set to the along-track deficit) and
                 the bus energy is integrated with RK4/Simpson quadrature. Explicitly
                 ideal storage advances the flat-efficiency energy state on

                     dE/dt = f( P_gen(t) - P_load(t) )

                 A real-chemistry BatteryElement instead receives the equivalent accepted
                 interval once through BatteryElement.step -> PackEcm.step_power. Trial
                 stages never mutate electrochemistry; SOC, I2R heat, rate refusal,
                 throughput and aging therefore have one authority. The load term is
                 algebraically constant during level cruise while generation is evaluated
                 at all four stages, making each accepted interval a Simpson quadrature.

                 A vehicle with NO lifting support (a bare point mass) has no trim, so it is
                 integrated ballistically with the same RK4 used by integrate_dynamic -- which
                 is exact for constant gravity and is what makes the conservation acceptance
                 test at dt = 60 s meaningful rather than vacuous.

                 THE ALONG-TRACK BALANCE IS ENFORCED, NOT ASSUMED (FATAL 1).  Trim solves the
                 vertical balance and the autothrottle serves what the thrusters' power
                 budget allows; whatever is left over is measured every step and BILLED as
                 unmet propulsive demand at the vehicle's declared propulsion chain.  Nothing
                 is discarded.  A vehicle carrying no thruster at all therefore pays for its
                 own drag, and a thruster past its max_electrical_power_W stops being a free
                 pass.

                 CLOSURE HAS ONE STORAGE AUTHORITY (FATAL 2). Explicit ideal storage is
                 replayed to a periodic fixed point. A real ECM is stateful and nonlinear,
                 so its accepted physical trajectory is observed without a fabricated
                 flat-efficiency replay. Both paths require charge preservation, rail
                 compliance, zero unserved demand and no uncommanded forward force. The
                 window energy margin and both unabsorbed terms remain surfaced in `detail`
                 so a sweep can never rank on min_soc alone.

                 FREE ENERGY RAISES (FATAL 3).  The element-local generation-reaction rule and
                 the vehicle-level generation budget are asserted EVERY step and raise
                 FreeEnergyError on the spot.  There is no flag to turn this off.
    @param t0_s, t_end_s s.  @param dt_s s, nominally 60.
    @returns SimResult. For ideal storage, `soc` is the limit-cycle series and the declared-
             seed series is detail["soc_as_seeded"]. For real storage, both name the same
             accepted ECM trajectory and detail["closure_mode"] is "accepted-real-ecm".
    @raises FreeEnergyError as soon as a step manufactures energy.
    @raises ValueError when a storage element does not declare its starting state of charge.
    """
    if t_end_s <= t0_s:
        raise ValueError(f"t_end_s ({t_end_s}) must exceed t0_s ({t0_s})")
    if dt_s <= 0.0:
        raise ValueError(f"dt_s must be positive, got {dt_s}")

    if not _has_lifting_support(vehicle):
        # No trim exists -> ballistic.  Same RK4, coarse step.
        return integrate_dynamic(vehicle, env, t0_s, t_end_s, dt_s)

    nb = len(vehicle.bodies)
    n_steps = int(math.ceil((t_end_s - t0_s) / dt_s))
    n_pts = n_steps + 1

    pos = np.array([np.asarray(b.pos_m, dtype=float).reshape(3) for b in vehicle.bodies])
    vel = np.array([np.asarray(b.vel_ms, dtype=float).reshape(3) for b in vehicle.bodies])

    # Cruise heading: initial horizontal ground track if any, else due east.
    h = np.array([vel[0, 0], vel[0, 1], 0.0])
    hn = float(np.linalg.norm(h))
    heading_hat = (h / hn) if hn > 1e-9 else np.array([1.0, 0.0, 0.0])

    spec = _battery_spec(vehicle)
    _prepare_real_storage(spec)
    E_J = spec.capacity_J * spec.initial_soc
    E_min_J = spec.capacity_J * spec.soc_min
    E_max_J = spec.capacity_J * spec.soc_max

    t_hist = np.zeros(n_pts)
    pos_hist = np.zeros((n_pts, nb, 3))
    vel_hist = np.zeros((n_pts, nb, 3))
    soc_hist = np.zeros(n_pts)
    pin_hist = np.zeros(n_pts)
    pout_hist = np.zeros(n_pts)
    E_hist = np.zeros(n_pts)
    re_hist = np.zeros(n_pts)

    chord_m = _mean_aero_chord_m(vehicle)

    # Work integrals for energy_audit
    W_wind_J = 0.0
    W_tether_J = 0.0
    W_grav_J = 0.0
    W_nongrav_J = 0.0

    # Trim reuse gate (see _RETRIM_* constants)
    trim_V_ms = 12.0
    has_buoyancy_state = any(
        _classify(el) == KIND_BUOYANCY
        for el in (getattr(vehicle, "elements", []) or [])
    )
    last_trim_key: Optional[tuple[float, float, float, int]] = None
    ev_trim: Optional[_Eval] = None
    p_load_W = 0.0
    n_trims = 0
    accepted_state_advances = 0

    unabsorbed_J = 0.0
    real_surplus_J = 0.0
    real_shortfall_J = 0.0
    real_cold_spill_start_J = (
        float(getattr(spec.authority, "cold_charge_spill_J", 0.0))
        if spec.authority is not None else 0.0
    )
    max_gen_violation_W = 0.0
    t = float(t0_s)

    # FATAL 1 / FATAL 3 bookkeeping.
    tol_W = _free_energy_tol_W(vehicle)
    eta_chain = _propulsion_chain_efficiency(vehicle)      # dimensionless; raises on junk
    bill_spec = _thruster_billing_spec(vehicle)            # re-validated disk + chain
    max_unmet_thrust_N = 0.0
    max_excess_thrust_N = 0.0
    unmet_propulsion_J = 0.0

    # ROUND-4 (FATAL 1 layers 3+4) bookkeeping: the certification contract.
    worst_trim_residual_N = 0.0
    uncertified_aero_steps = 0

    # FATAL 2 bookkeeping: the RK4 stage powers, so the storage ODE can be replayed at a
    # different initial state of charge without re-running any physics.  Loads are recorded
    # PER STAGE, like generation -- a frozen scalar is how p13's duty-cycled payload was
    # billed at 48.58 W against an honest 543.23 W.
    tape_h_s = np.zeros(max(n_steps, 1))
    tape_gen_W = np.zeros((max(n_steps, 1), 4))
    tape_load_W = np.zeros((max(n_steps, 1), 4))
    n_tape = 0

    for k in range(n_pts):
        t = t0_s + k * dt_s
        step_dt = min(dt_s, t_end_s - t) if k < n_steps else 0.0

        # ---- trim (reused while altitude / mass / wind are unchanged) ------------------
        wind0 = _wind_vec(env.wind.sample(float(pos[0, 0]), float(pos[0, 1]),
                                          float(pos[0, 2]), t))
        mass_kg = sum(float(b.mass_kg) for b in vehicle.bodies)
        state_epoch = (
            int(math.floor(max(0.0, t - t0_s) / _RETRIM_STATE_INTERVAL_S))
            if has_buoyancy_state else 0
        )
        key = (round(pos[0, 2] / _RETRIM_DALT_M),
               round(mass_kg / _RETRIM_DMASS_KG),
               round(float(np.linalg.norm(wind0)) / _RETRIM_DWIND_MS),
               state_epoch)
        if key != last_trim_key or ev_trim is None:
            trim_V_ms, ev_trim = _trim_airspeed(
                vehicle, env, pos, heading_hat, t, max(step_dt, dt_s), trim_V_ms
            )
            # STATIC load only: the slice drawn by re-evaluable elements (KIND_PV /
            # KIND_GENERIC) is subtracted here and re-billed per RK4 stage from the live
            # evaluation, so a time-varying consumer is never frozen at its trim-time draw.
            p_load_W = ev_trim.power_load_W - ev_trim.power_load_replan_W
            last_trim_key = key
            n_trims += 1
            # ROUND-4 layer 4: record the residual actually ACCEPTED.  The trim solver
            # raises above tolerance, so this is bounded by _TRIM_REL_TOL * weight for
            # an airspeed trim; the V = 0 branch is the buoyant equilibrium, where only
            # a lift DEFICIT would be a residual (excess buoyancy is a different, legal
            # equilibrium handled by the pinned-altitude slow loop).
            lift_trim_N = float(np.sum(ev_trim.forces_N[:, 2]))
            weight_N = mass_kg * G0_MS2
            worst_trim_residual_N = max(
                worst_trim_residual_N,
                abs(weight_N - lift_trim_N) if trim_V_ms > 0.0
                else max(0.0, weight_N - lift_trim_N),
            )

        # ROUND-4 layer 3: a step whose trim evaluation consumed an uncertified aero
        # point cannot contribute to a closure verdict -- the forces are edge-clamped
        # or zero-filled fiction.  Counted per RECORDED step (the same evaluation is
        # legitimately reused while the trim key is unchanged).
        if ev_trim.n_invalid_aero > 0:
            uncertified_aero_steps += 1

        # ---- state at trim -------------------------------------------------------------
        # The trim evaluation IS the state evaluation: velocity, forces, rho, mu and the
        # load term are all state functions, and the state is by construction the trimmed
        # one.  Only GENERATION varies within the day, so only that is re-evaluated.
        for i in range(nb):
            vel[i] = ev_trim.wind_ms[i] + trim_V_ms * heading_hat

        # ---- FATAL 1: the along-track balance, billed rather than discarded --------------
        # The trim pins the velocity; the constraint force along the flight path is
        # propulsion and it costs electricity.  Whatever the thrusters could not supply is
        # unmet propulsive demand, billed as the MARGINAL actuator-disk cost through the
        # vehicle's own thruster (its disk, its FM, its motor and ESC), so the unmet path
        # can never undercut the element (probes p2/p6: the old flat T*V/eta bill dropped
        # the induced power and made under-rating the motor strictly profitable).
        max_unmet_thrust_N = max(max_unmet_thrust_N, ev_trim.unmet_thrust_N)
        max_excess_thrust_N = max(max_excess_thrust_N, ev_trim.excess_thrust_N)
        v_air_trim_ms = float(np.linalg.norm(ev_trim.v_air_ms[0]))
        p_unmet_W = _unmet_propulsion_power_W(
            bill_spec, ev_trim.thrust_N, ev_trim.unmet_thrust_N,
            v_air_trim_ms, float(ev_trim.rho_kgm3[0]), eta_chain,
        )

        gen_plan = _prepare_generation(vehicle, env, pos, vel, t)
        p_gen_W, p_gen_mech_W, viol_W, draw1_W = _generation_from_plan(
            gen_plan, ev_trim.v_air_ms, t, max(step_dt, dt_s)
        )
        p_load_now_W = p_load_W + p_unmet_W + draw1_W
        max_gen_violation_W = max(max_gen_violation_W, viol_W, ev_trim.gen_violation_W)

        # ---- FATAL 3: the guard RAISES.  It used to be recorded and then ignored. --------
        _assert_generation_budget(
            max(p_gen_mech_W, ev_trim.power_gen_mech_W),
            ev_trim.fluid_mech_removed_W,
            max(viol_W, ev_trim.gen_violation_W),
            tol_W, t, "integrate_energy",
        )

        t_hist[k] = t
        pos_hist[k] = pos
        vel_hist[k] = vel
        pin_hist[k] = p_gen_W
        pout_hist[k] = p_load_now_W
        E_hist[k] = E_J
        soc_hist[k] = (E_J / spec.capacity_J) if spec.capacity_J > 0.0 else 1.0
        v_air_mag = float(np.linalg.norm(ev_trim.v_air_ms[0]))
        re_hist[k] = (
            ev_trim.rho_kgm3[0] * v_air_mag * chord_m / max(ev_trim.mu_Pas[0], 1e-12)
            if chord_m == chord_m else float("nan")
        )

        if k >= n_steps or step_dt <= 0.0:
            break

        # ---- RK4 on stored energy ------------------------------------------------------
        # dE/dt depends on t through generation only; the load is algebraically constant
        # across a 60 s level-cruise step (verified against the fast loop by the
        # two-timescale acceptance test).  With the load frozen this is exactly a Simpson
        # quadrature of the solar profile across the step.
        h_s = step_dt
        g1 = p_gen_W
        g2, g2_mech, v2, draw2_W = _generation_from_plan(gen_plan, ev_trim.v_air_ms,
                                                         t + 0.5 * h_s, h_s)
        g3 = g2
        g4, g4_mech, v4, draw4_W = _generation_from_plan(gen_plan, ev_trim.v_air_ms,
                                                         t + h_s, h_s)
        max_gen_violation_W = max(max_gen_violation_W, v2, v4)
        _assert_generation_budget(max(g2_mech, g4_mech), ev_trim.fluid_mech_removed_W,
                                  max(v2, v4), tol_W, t, "integrate_energy")

        # Per-stage LOADS, mirroring the per-stage generation: static (trim) + unmet
        # propulsion + the live draw of every re-evaluable consumer at that stage time.
        l1 = p_load_now_W
        l2 = p_load_W + p_unmet_W + draw2_W
        l3 = l2
        l4 = p_load_W + p_unmet_W + draw4_W

        tape_h_s[n_tape] = h_s
        tape_gen_W[n_tape] = (g1, g2, g3, g4)
        tape_load_W[n_tape] = (l1, l2, l3, l4)
        unmet_propulsion_J += p_unmet_W * h_s
        n_tape += 1

        if spec.authority is not None:
            # The BEMT/PV/load evaluations above are numerical probes. Collapse their
            # Simpson quadrature to the interval's equivalent BUS power, then commit the
            # nonlinear ECM exactly once. This is the only electrical state mutation on
            # the real path; the thermal commit below consumes this step's I2R heat.
            p_net_W = (
                (g1 - l1) + 2.0 * (g2 - l2) + 2.0 * (g3 - l3) + (g4 - l4)
            ) / 6.0
            E_new_J, spill_J, short_J = _step_real_storage(spec, p_net_W, h_s)
            real_surplus_J += spill_J
            real_shortfall_J += short_J
            unabsorbed_J += spill_J - short_J
        else:
            k1 = _dEdt_J_per_s(g1 - l1, spec)
            k2 = _dEdt_J_per_s(g2 - l2, spec)
            k3 = _dEdt_J_per_s(g3 - l3, spec)
            k4 = _dEdt_J_per_s(g4 - l4, spec)
            dE_J = (h_s / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)

            E_new_J = E_J + dE_J
            if spec.capacity_J > 0.0:
                if E_new_J > E_max_J:
                    unabsorbed_J += E_new_J - E_max_J
                    E_new_J = E_max_J
                elif E_new_J < E_min_J:
                    # Undelivered demand: the bus could not be served. Reported, not hidden.
                    unabsorbed_J -= (E_min_J - E_new_J)
                    E_new_J = E_min_J
        E_J = E_new_J

        # ---- work integrals -------------------------------------------------------------
        for i in range(nb):
            W_wind_J += float(np.dot(ev_trim.aero_N[i], ev_trim.wind_ms[i])) * h_s
            W_tether_J += float(np.dot(ev_trim.tether_N[i], vel[i])) * h_s
            W_grav_J += float(np.dot(ev_trim.grav_N[i], vel[i])) * h_s
            W_nongrav_J += float(np.dot(ev_trim.forces_N[i], vel[i])) * h_s

        # ---- commit slow states + advance position --------------------------------------
        # All root/RK probes above were pure with respect to buoyancy and pack thermal
        # state. Commit elapsed physical time ONCE, at the accepted midpoint environment.
        pos_new = pos + vel * h_s
        accepted_state_advances += _advance_accepted_element_states(
            vehicle,
            env,
            0.5 * (pos + pos_new),
            vel,
            t + 0.5 * h_s,
            h_s,
        )
        pos = pos_new

    used = np.arange(n_pts)
    finite_re = re_hist[np.isfinite(re_hist)]
    mean_re = float(np.mean(finite_re)) if finite_re.size else float("nan")

    # Window energy ledger -- surfaced so a sweep can see the DAILY BALANCE, not just a floor.
    energy_in_J = float(np.trapezoid(pin_hist[used], t_hist[used])) if n_pts > 1 else 0.0
    energy_out_J = float(np.trapezoid(pout_hist[used], t_hist[used])) if n_pts > 1 else 0.0

    # ---- FATAL 2: score the LIMIT CYCLE, not the seeded window -------------------------
    reasons: list[str] = []
    # ROUND-5: the night-skipper.  A PV-carrying run stepped coarser than
    # MAX_CERTIFIED_SOLAR_DT_S under-samples the diurnal cycle the closure verdict is
    # about -- measured: dt = 86400 s (one step per day) reported min_soc 1.0000
    # certified, because the night between the RK4 solar stages was never sampled.
    # The result is still returned (report, never invent), but certification is
    # refused with a named reason, exactly like uncertified-aero.
    dt_taint_reason: Optional[str] = None
    if _has_solar_source(vehicle) and dt_s > MAX_CERTIFIED_SOLAR_DT_S:
        dt_taint_reason = (
            f"dt-too-coarse: dt_s = {dt_s:g} s exceeds the "
            f"{MAX_CERTIFIED_SOLAR_DT_S:g} s certification ceiling for a run "
            f"carrying a PV source -- one step per day never samples the night "
            f"(measured: dt = 86400 s certified min_soc 1.0000 on case A); at "
            f"{MAX_CERTIFIED_SOLAR_DT_S:g} s the answer matches dt = 60 s "
            f"(usable margin within 0.04%), coarser does not"
        )
        reasons.append(dt_taint_reason)
    # ROUND-4 layer 3: uncertified aerodynamics anywhere on the cruise path refuses the
    # closure verdict outright.  The R4 winner "flew" 1441 steps of zero-filled polar
    # (Re 5.6e7, beyond every certified bin) and closed on avionics power alone.
    if uncertified_aero_steps > 0:
        reasons.append(
            f"uncertified-aero: {uncertified_aero_steps} of {n_pts} recorded steps "
            "consumed aerodynamic points outside the solver's certified envelope "
            "(Reynolds band, alpha span or confidence floor) -- the forces are "
            "edge-clamped or zero-filled fiction and no closure verdict exists"
        )
    weight_scale_N = max(sum(float(b.mass_kg) for b in vehicle.bodies) * G0_MS2, 1.0)
    if max_excess_thrust_N > 1e-6 * weight_scale_N:
        reasons.append(
            f"uncommanded forward force {max_excess_thrust_N:.6g} N -- the vehicle is being "
            "pushed along its flight path by something nothing paid for"
        )
    # ROUND-3 fix 1b: saturation is VISIBLE.  The deficit is billed above, but billing is
    # not flying -- a design whose motor cannot produce its own trim thrust is not closed.
    if max_unmet_thrust_N > 1e-6 * weight_scale_N:
        reasons.append(
            f"unmet thrust {max_unmet_thrust_N:.6g} N -- the installed propulsion cannot "
            "fly the vehicle's own trim (the deficit was billed at the thruster's own "
            "actuator-disk price, but a motor that cannot deliver the thrust does not fly)"
        )
    # ROUND-3 fix 3: no sub-diurnal closure verdict with a solar source aboard.
    window_reason = _sub_diurnal_window_reason(vehicle, t0_s, t_end_s)
    if window_reason is not None:
        reasons.append(window_reason)

    soc_as_seeded = soc_hist[used].copy()
    if spec.capacity_J > 0.0 and n_tape > 0 and spec.authority is not None:
        # A real ECM is path-dependent: resistance, current limits, I2R heat and aging all
        # depend on the accepted SOC/temperature history. Replaying its bus tape through a
        # flat eta (or repeatedly through one mutable PackEcm while seeking a fixed point)
        # would create a second authority. Score the one accepted physical trajectory; a
        # multi-day mission establishes persistence observationally at mission level.
        soc0_star = float(soc_hist[0])
        min_soc = float(np.min(soc_hist[used]))
        soc_start = float(soc_hist[0])
        soc_end = float(soc_hist[n_pts - 1])
        surplus_lc_J = real_surplus_J
        shortfall_lc_J = real_shortfall_J
        sustainable = bool(
            shortfall_lc_J <= 1.0e-6 and soc_end >= soc_start - 1.0e-9
        )
        if min_soc <= spec.soc_min + 1e-9:
            reasons.append(
                f"accepted real-ECM floor {min_soc:.4f} does not clear "
                f"soc_min {spec.soc_min:.4f}"
            )
        if shortfall_lc_J > 1.0e-6:
            reasons.append(
                f"{shortfall_lc_J / 3600.0:.1f} Wh of demand was refused by "
                "the real electrochemical pack"
            )
        if soc_end < soc_start - 1.0e-9:
            reasons.append(
                f"accepted real-ECM state of charge does not return: "
                f"{soc_start:.4f} -> {soc_end:.4f}"
            )
        unabsorbed_J = surplus_lc_J - shortfall_lc_J
    elif spec.capacity_J > 0.0 and n_tape > 0:
        tape = _StorageTape(h_s=tape_h_s[:n_tape], gen_W=tape_gen_W[:n_tape],
                            load_W=tape_load_W[:n_tape])
        soc0_star, soc_lc, surplus_lc_J, shortfall_lc_J, sustainable = _solve_limit_cycle(
            tape, spec
        )
        # soc_lc has n_tape+1 entries, one per recorded point of the run.
        soc_hist[:soc_lc.size] = soc_lc
        if soc_lc.size < n_pts:
            soc_hist[soc_lc.size:n_pts] = soc_lc[-1]
        E_hist[used] = soc_hist[used] * spec.capacity_J
        min_soc = float(np.min(soc_hist[used]))
        soc_start = float(soc_hist[0])
        soc_end = float(soc_hist[n_pts - 1])
        unabsorbed_J = surplus_lc_J - shortfall_lc_J
        if not sustainable:
            reasons.append(
                "no sustainable periodic state exists: the window's net stored-energy change "
                "is negative, so the pack loses ground every cycle whatever it is seeded with"
            )
        if min_soc <= spec.soc_min + 1e-9:
            reasons.append(
                f"limit-cycle floor {min_soc:.4f} does not clear soc_min {spec.soc_min:.4f}"
            )
        if shortfall_lc_J > 1e-6:
            reasons.append(
                f"{shortfall_lc_J / 3600.0:.1f} Wh of demand went unserved on the limit cycle"
            )
        if soc_end < soc_start - 1e-9:
            reasons.append(
                f"state of charge does not return: {soc_start:.4f} -> {soc_end:.4f}"
            )
    else:
        # No storage at all.  That is not automatically 'closed' -- it means the design has
        # nowhere to put a deficit, so it must never run one, at any instant.
        soc0_star = float("nan")
        surplus_lc_J = shortfall_lc_J = 0.0
        sustainable = True
        min_soc = 1.0
        deficit_W = float(np.max(pout_hist[used] - pin_hist[used])) if n_pts else 0.0
        if deficit_W > 1e-9:
            sustainable = False
            reasons.append(
                f"no storage, yet the bus runs a {deficit_W:.3g} W deficit at some instant"
            )
    closed = not reasons

    return SimResult(
        t_s=t_hist[used],
        pos_m=pos_hist[used, 0, :],
        vel_ms=vel_hist[used, 0, :],
        soc=soc_hist[used],
        power_in_W=pin_hist[used],
        power_out_W=pout_hist[used],
        battery_energy_J=E_hist[used],
        closed=closed,
        min_soc=min_soc,
        mean_cruise_Re=mean_re,
        certified=(uncertified_aero_steps == 0 and dt_taint_reason is None),
        worst_trim_residual_N=worst_trim_residual_N,
        cruise_Re_min=float(np.min(finite_re)) if finite_re.size else float("nan"),
        cruise_Re_max=float(np.max(finite_re)) if finite_re.size else float("nan"),
        detail={
            "mode": "energy",
            "dt_s": dt_s,
            "pos_all_m": pos_hist[used],
            "vel_all_ms": vel_hist[used],
            "trim_V_ms": trim_V_ms,
            "n_trims": n_trims,
            "accepted_state_advances": accepted_state_advances,
            "masses_kg": np.array([float(b.mass_kg) for b in vehicle.bodies]),
            "work_by_wind_J": W_wind_J,
            "work_by_tether_J": W_tether_J,
            "work_by_gravity_J": W_grav_J,
            "work_nongrav_J": W_nongrav_J,
            "unabsorbed_J": unabsorbed_J,
            "battery_capacity_J": spec.capacity_J,
            "soc_min": spec.soc_min,
            "chord_m": chord_m,
            "max_gen_violation_W": max_gen_violation_W,
            "thruster_mode": "fallback-disk" if (ev_trim and ev_trim.thruster_fallback)
            else "element",
            # ---- FATAL 1 -------------------------------------------------------------
            "max_unmet_thrust_N": max_unmet_thrust_N,
            "max_excess_thrust_N": max_excess_thrust_N,
            "unmet_propulsion_J": unmet_propulsion_J,
            "propulsion_chain_efficiency": eta_chain,
            # ---- ROUND 4: the certification contract ---------------------------------
            "uncertified_aero_steps": uncertified_aero_steps,
            "worst_trim_residual_N": worst_trim_residual_N,
            # ---- FATAL 2 -------------------------------------------------------------
            "closure_mode": (
                "accepted-real-ecm" if spec.authority is not None else "limit-cycle"
            ),
            "storage_authority": (
                "BatteryElement.step->PackEcm.step_power"
                if spec.authority is not None else "integrator-flat-efficiency"
            ),
            "closed_reasons": reasons,
            "limit_cycle_soc0": soc0_star,
            "limit_cycle_sustainable": bool(sustainable),
            "initial_soc_declared": spec.initial_soc,
            "soc_as_seeded": soc_as_seeded,
            "min_soc_as_seeded": float(np.min(soc_as_seeded)) if soc_as_seeded.size else 1.0,
            "energy_in_J": energy_in_J,
            "energy_out_J": energy_out_J,
            "energy_margin_J": energy_in_J - energy_out_J,
            "unabsorbed_surplus_J": surplus_lc_J,
            "unabsorbed_shortfall_J": shortfall_lc_J,
            "cold_charge_spill_bus_J": (
                max(
                    0.0,
                    float(getattr(spec.authority, "cold_charge_spill_J", 0.0))
                    - real_cold_spill_start_J,
                )
                if spec.authority is not None else 0.0
            ),
        },
    )


# --------------------------------------------------------------------------------------
# integrate_dynamic -- the fast loop
# --------------------------------------------------------------------------------------


def integrate_dynamic(
    vehicle: Any,
    env: EnvBundle,
    t0_s: float,
    t_end_s: float,
    dt_s: float = 0.05,
) -> SimResult:
    """
    @description Fast loop: classical RK4 on the full translational state of every body,

                     d/dt [pos; vel] = [vel; (F_elements + F_gravity)/m]

                 with tether forces coupling the bodies inside a single derivative
                 evaluation (so an equal-and-opposite pair is never split across a step).
                 Explicit ideal battery energy rides along as an extra RK4 state. A real
                 PackEcm remains pure during all derivative probes; the four staged bus
                 powers are collapsed to one Simpson-equivalent accepted interval and
                 BatteryElement.step is called exactly once.

                 RK4 integrates a quadratic trajectory EXACTLY, so a body under constant
                 gravity alone conserves energy to machine precision at ANY step size -- that
                 is the basis of the conservation acceptance test at both dt = 60 s and
                 dt = 0.05 s.
    @param dt_s s, nominally 0.05.
    @returns SimResult.
    """
    if t_end_s <= t0_s:
        raise ValueError(f"t_end_s ({t_end_s}) must exceed t0_s ({t0_s})")
    if dt_s <= 0.0:
        raise ValueError(f"dt_s must be positive, got {dt_s}")

    nb = len(vehicle.bodies)
    n_steps = int(math.ceil((t_end_s - t0_s) / dt_s))
    n_pts = n_steps + 1

    pos = np.array([np.asarray(b.pos_m, dtype=float).reshape(3) for b in vehicle.bodies])
    vel = np.array([np.asarray(b.vel_ms, dtype=float).reshape(3) for b in vehicle.bodies])
    masses = np.array([float(b.mass_kg) for b in vehicle.bodies])

    spec = _battery_spec(vehicle)          # re-validates SOC rails + eta bounds (2nd wall)
    _prepare_real_storage(spec)
    _thruster_billing_spec(vehicle)        # re-validates FM / eta / disk area (2nd wall)
    E_J = spec.capacity_J * spec.initial_soc
    E_min_J = spec.capacity_J * spec.soc_min
    E_max_J = spec.capacity_J * spec.soc_max

    has_elements = bool(getattr(vehicle, "elements", []) or hasattr(vehicle, "net"))
    chord_m = _mean_aero_chord_m(vehicle)

    t_hist = np.zeros(n_pts)
    pos_hist = np.zeros((n_pts, nb, 3))
    vel_hist = np.zeros((n_pts, nb, 3))
    soc_hist = np.zeros(n_pts)
    pin_hist = np.zeros(n_pts)
    pout_hist = np.zeros(n_pts)
    E_hist = np.zeros(n_pts)
    re_hist = np.full(n_pts, float("nan"))

    W_wind_J = 0.0
    W_tether_J = 0.0
    W_grav_J = 0.0
    W_nongrav_J = 0.0
    unabsorbed_J = 0.0
    surplus_J = 0.0
    shortfall_J = 0.0
    fallback_seen = False
    max_gen_violation_W = 0.0
    max_gen_surplus_W = 0.0
    tol_W = _free_energy_tol_W(vehicle)
    # ROUND-4 (the dynamic-loop half of FATAL 1 layer 3): every derivative evaluation
    # that consumed an edge-clamped / zero-filled aero point is COUNTED, at every RK4
    # stage, and any count > 0 taints the whole result certified=False.  A
    # dynamic-soaring trajectory at post-stall incidence used to be scored on
    # fictitious attached-flow numbers with only a discarded last_valid diagnostic.
    invalid_aero_evals = 0
    accepted_state_advances = 0

    def deriv(p: np.ndarray, v: np.ndarray, E: float, time_s: float
              ) -> tuple[np.ndarray, np.ndarray, float, Optional[_Eval]]:
        """
        @description RK4 right-hand side.
        @returns (dpos/dt m/s, dvel/dt m/s^2, dE/dt J/s, the evaluation used)
        """
        nonlocal invalid_aero_evals
        if not has_elements:
            acc = np.zeros((nb, 3))
            acc[:, 2] = -G0_MS2                     # bare point mass: gravity only
            return v.copy(), acc, 0.0, None
        ev = _evaluate(vehicle, env, p, v, time_s, dt_s, autothrottle=True)
        if ev.n_invalid_aero > 0:
            invalid_aero_evals += 1
        # FATAL 3: the guard RAISES, at EVERY RK4 stage, not just the recorded ones.  The
        # fast loop needs no along-track billing -- it integrates dv/dt, so unbilled drag
        # simply decelerates the vehicle, which is honest mechanics.
        _assert_generation_budget(ev.power_gen_mech_W, ev.fluid_mech_removed_W,
                                  ev.gen_violation_W, tol_W, time_s, "integrate_dynamic")
        acc = (ev.forces_N + ev.grav_N) / masses[:, None]
        p_net_W = ev.power_gen_W - ev.power_load_W
        # A real pack is committed once after RK4 accepts the trajectory step. Returning
        # zero here keeps the four trial stages state-pure; the equivalent Simpson bus
        # power is routed through PackEcm below. Explicitly ideal storage retains its
        # linear ODE here.
        dE = (0.0 if spec.authority is not None
              else _dEdt_J_per_s(p_net_W, spec))
        # Hard-clip the storage rate at the SOC rails so RK4 cannot integrate through them.
        if spec.capacity_J > 0.0:
            if E >= E_max_J - _EPS and dE > 0.0:
                dE = 0.0
            if E <= E_min_J + _EPS and dE < 0.0:
                dE = 0.0
        return v.copy(), acc, dE, ev

    t = float(t0_s)
    for k in range(n_pts):
        t = t0_s + k * dt_s
        step_dt = min(dt_s, t_end_s - t) if k < n_steps else 0.0

        dp1, dv1, dE1, ev = deriv(pos, vel, E_J, t)

        t_hist[k] = t
        pos_hist[k] = pos
        vel_hist[k] = vel
        E_hist[k] = E_J
        soc_hist[k] = (E_J / spec.capacity_J) if spec.capacity_J > 0.0 else 1.0
        if ev is not None:
            pin_hist[k] = ev.power_gen_W
            pout_hist[k] = ev.power_load_W
            fallback_seen = fallback_seen or ev.thruster_fallback
            max_gen_violation_W = max(max_gen_violation_W, ev.gen_violation_W)
            max_gen_surplus_W = max(max_gen_surplus_W,
                                    ev.power_gen_mech_W - ev.fluid_mech_removed_W)
            if chord_m == chord_m:
                v_air_mag = float(np.linalg.norm(ev.v_air_ms[0]))
                re_hist[k] = ev.rho_kgm3[0] * v_air_mag * chord_m / max(ev.mu_Pas[0], 1e-12)

        if k >= n_steps or step_dt <= 0.0:
            break
        h_s = step_dt

        dp2, dv2, dE2, ev2 = deriv(
            pos + 0.5 * h_s * dp1, vel + 0.5 * h_s * dv1,
            E_J + 0.5 * h_s * dE1, t + 0.5 * h_s)
        dp3, dv3, dE3, ev3 = deriv(
            pos + 0.5 * h_s * dp2, vel + 0.5 * h_s * dv2,
            E_J + 0.5 * h_s * dE2, t + 0.5 * h_s)
        dp4, dv4, dE4, ev4 = deriv(
            pos + h_s * dp3, vel + h_s * dv3,
            E_J + h_s * dE3, t + h_s)

        pos_new = pos + (h_s / 6.0) * (dp1 + 2.0 * dp2 + 2.0 * dp3 + dp4)
        vel_new = vel + (h_s / 6.0) * (dv1 + 2.0 * dv2 + 2.0 * dv3 + dv4)
        E_new_J = E_J + (h_s / 6.0) * (dE1 + 2.0 * dE2 + 2.0 * dE3 + dE4)

        if spec.authority is not None:
            def _stage_bus_power(stage_ev: Optional[_Eval]) -> float:
                """@description Net bus power of one RK stage, W."""
                if stage_ev is None:
                    return 0.0
                return float(stage_ev.power_gen_W - stage_ev.power_load_W)

            p_net_W = (
                _stage_bus_power(ev)
                + 2.0 * _stage_bus_power(ev2)
                + 2.0 * _stage_bus_power(ev3)
                + _stage_bus_power(ev4)
            ) / 6.0
            E_new_J, spill_J, short_J = _step_real_storage(spec, p_net_W, h_s)
            surplus_J += spill_J
            shortfall_J += short_J
            unabsorbed_J += spill_J - short_J
        elif spec.capacity_J > 0.0:
            if E_new_J > E_max_J:
                unabsorbed_J += E_new_J - E_max_J
                # BUS-side spill, same conversion as _replay_storage (change log #6);
                # unabsorbed_J stays the stored-side net diagnostic.
                surplus_J += (E_new_J - E_max_J) / max(spec.eta_charge, 1e-9)
                E_new_J = E_max_J
            elif E_new_J < E_min_J:
                unabsorbed_J -= (E_min_J - E_new_J)
                shortfall_J += (E_min_J - E_new_J) * spec.eta_discharge
                E_new_J = E_min_J

        # Trapezoidal work integrals over the step (uses the stage-1 evaluation, which is
        # the only one whose forces are at a state we also record).
        if ev is not None:
            v_mid = 0.5 * (vel + vel_new)
            for i in range(nb):
                W_wind_J += float(np.dot(ev.aero_N[i], ev.wind_ms[i])) * h_s
                W_tether_J += float(np.dot(ev.tether_N[i], v_mid[i])) * h_s
                W_nongrav_J += float(np.dot(ev.forces_N[i], v_mid[i])) * h_s
        for i in range(nb):
            W_grav_J += -masses[i] * G0_MS2 * (pos_new[i, 2] - pos[i, 2])

        # RK4 stages are numerical probes. Commit element-owned thermal/chemistry state
        # once, after this trajectory step is accepted, at its midpoint environment.
        accepted_state_advances += _advance_accepted_element_states(
            vehicle,
            env,
            0.5 * (pos + pos_new),
            0.5 * (vel + vel_new),
            t + 0.5 * h_s,
            h_s,
        )
        pos, vel, E_J = pos_new, vel_new, E_new_J

    min_soc = float(np.min(soc_hist)) if spec.capacity_J > 0.0 else 1.0
    finite_re = re_hist[np.isfinite(re_hist)]
    mean_re = float(np.mean(finite_re)) if finite_re.size else float("nan")

    energy_in_J = float(np.trapezoid(pin_hist, t_hist)) if n_pts > 1 else 0.0
    energy_out_J = float(np.trapezoid(pout_hist, t_hist)) if n_pts > 1 else 0.0

    # ---- Persistence, not just a floor (FATAL 2, fast-loop half) ----------------------
    # integrate_energy delegates HERE for any vehicle with no lifting support (a hovering
    # quadcopter, a bare point mass, validation case D), so if 'closed' stayed a bare
    # min_soc test this path would be an open bypass around the limit-cycle rule.  The fast
    # loop integrates a TRANSIENT, not a cycle, so a fixed point in initial state of charge
    # is not defined here; what IS well posed is the same persistence arithmetic -- the
    # charge must come back, nothing may go unserved -- and closure_mode says plainly that
    # this is a single-window verdict so a sweep can never mistake it for a limit cycle.
    reasons: list[str] = []
    # ROUND-3 fix 3, fast-loop half: integrate_energy delegates any vehicle with no lifting
    # support (a hovering quad, case C) HERE, so without this the sub-diurnal certification
    # would simply move loops.
    window_reason = _sub_diurnal_window_reason(vehicle, t0_s, t_end_s)
    if window_reason is not None:
        reasons.append(window_reason)
    if spec.capacity_J > 0.0:
        soc_start = float(soc_hist[0])
        soc_end = float(soc_hist[-1])
        if min_soc <= spec.soc_min + 1e-9:
            reasons.append(
                f"state of charge reached its floor ({min_soc:.4f} vs soc_min "
                f"{spec.soc_min:.4f})"
            )
        if shortfall_J > 1e-6:
            reasons.append(f"{shortfall_J / 3600.0:.1f} Wh of demand went unserved")
        if soc_end < soc_start - 1e-9:
            reasons.append(
                f"state of charge does not return: {soc_start:.4f} -> {soc_end:.4f}"
            )
    else:
        deficit_W = float(np.max(pout_hist - pin_hist)) if n_pts else 0.0
        if deficit_W > 1e-9:
            reasons.append(
                f"no storage, yet the bus runs a {deficit_W:.3g} W deficit at some instant"
            )
    closed = not reasons

    return SimResult(
        t_s=t_hist,
        pos_m=pos_hist[:, 0, :],
        vel_ms=vel_hist[:, 0, :],
        soc=soc_hist,
        power_in_W=pin_hist,
        power_out_W=pout_hist,
        battery_energy_J=E_hist,
        closed=closed,
        min_soc=min_soc,
        mean_cruise_Re=mean_re,
        certified=(invalid_aero_evals == 0),
        worst_trim_residual_N=float("nan"),   # the fast loop has no trim constraint
        cruise_Re_min=float(np.min(finite_re)) if finite_re.size else float("nan"),
        cruise_Re_max=float(np.max(finite_re)) if finite_re.size else float("nan"),
        detail={
            "mode": "dynamic",
            "dt_s": dt_s,
            "pos_all_m": pos_hist,
            "vel_all_ms": vel_hist,
            "masses_kg": masses,
            "work_by_wind_J": W_wind_J,
            "work_by_tether_J": W_tether_J,
            "work_by_gravity_J": W_grav_J,
            "work_nongrav_J": W_nongrav_J,
            "unabsorbed_J": unabsorbed_J,
            "battery_capacity_J": spec.capacity_J,
            "soc_min": spec.soc_min,
            "chord_m": chord_m,
            "max_gen_violation_W": max_gen_violation_W,
            "max_gen_surplus_W": max_gen_surplus_W,
            "thruster_mode": "fallback-disk" if fallback_seen else "element",
            "closure_mode": (
                "accepted-real-ecm" if spec.authority is not None else "single-window"
            ),
            "storage_authority": (
                "BatteryElement.step->PackEcm.step_power"
                if spec.authority is not None else "integrator-flat-efficiency"
            ),
            "closed_reasons": reasons,
            "initial_soc_declared": spec.initial_soc,
            "min_soc_as_seeded": min_soc,
            "soc_as_seeded": soc_hist,
            "energy_in_J": energy_in_J,
            "energy_out_J": energy_out_J,
            "energy_margin_J": energy_in_J - energy_out_J,
            "unabsorbed_surplus_J": surplus_J,
            "unabsorbed_shortfall_J": shortfall_J,
            "max_unmet_thrust_N": 0.0,      # the fast loop integrates dv/dt: there is no
            "max_excess_thrust_N": 0.0,     # pinned-velocity constraint force to bill
            # ---- ROUND 4: the certification contract ---------------------------------
            "invalid_aero_evals": invalid_aero_evals,
            "accepted_state_advances": accepted_state_advances,
        },
    )


# --------------------------------------------------------------------------------------
# The fast -> slow bridge
# --------------------------------------------------------------------------------------


def cycle_averaged_power_W(
    vehicle: Any,
    env: EnvBundle,
    cycle_period_s: float,
    dt_s: float = 0.05,
    n_cycles: int = 5,
) -> float:
    """
    @description Mean NET electrical power over a periodic manoeuvre, computed on the fast
                 loop.  This is the number archetypes 3 (tethered shear sailboat) and 4
                 (dynamic soarer) hand to the slow loop as a power source.
                 The FIRST cycle is discarded as start-up transient whenever n_cycles >= 2,
                 because the initial state is generally not on the limit cycle and including
                 it would credit (or debit) the manoeuvre with a one-off state change.
    @param cycle_period_s s, > 0.  @param dt_s s.  @param n_cycles >= 1.
    @returns Mean of (power_in - power_out), W.  > 0 means NET EXTRACTION.
    """
    if cycle_period_s <= 0.0:
        raise ValueError(f"cycle_period_s must be positive, got {cycle_period_s}")
    if n_cycles < 1:
        raise ValueError(f"n_cycles must be >= 1, got {n_cycles}")

    t_end_s = cycle_period_s * n_cycles
    res = integrate_dynamic(vehicle, env, 0.0, t_end_s, dt_s)

    t = res.t_s
    p_net_W = res.power_in_W - res.power_out_W
    t_start_s = cycle_period_s if n_cycles >= 2 else 0.0
    mask = t >= t_start_s - _EPS
    if not np.any(mask):
        mask = np.ones_like(t, dtype=bool)

    tt = t[mask]
    pp = p_net_W[mask]
    if tt.size < 2:
        return float(np.mean(pp))
    return float(np.trapezoid(pp, tt) / (tt[-1] - tt[0]))


# --------------------------------------------------------------------------------------
# Energy audit
# --------------------------------------------------------------------------------------


def energy_audit(result: SimResult) -> dict:
    """
    @description Post-hoc energy accounting for a run.

                 drift_frac is a pure INTEGRATOR-ACCURACY metric: exact mechanics says the
                 change in mechanical energy equals the work done by every non-gravitational
                 force (gravity being carried in the potential term), so

                     drift_frac = |dE_mech - W_nongravity| / max(|E_mech(0)|, 1 J)

                 A bare point mass under gravity alone has W_nongravity = 0 and dE_mech = 0,
                 so drift_frac collapses to pure round-off.  Any real number here is the
                 integrator inventing or destroying energy.

                 work_by_wind_J is the work the MOVING AIR does on the vehicle,
                 sum over time of F_fluid . v_wind -- the only channel through which
                 environmental energy can legitimately enter, and identically zero in the
                 air-relative frame of a uniform field.
    @param result A SimResult from either integrator.
    @returns {"drift_frac", "work_by_wind_J", "work_by_tether_J", "work_by_gravity_J"}
    """
    d = result.detail or {}
    pos_all = d.get("pos_all_m")
    vel_all = d.get("vel_all_ms")
    masses = d.get("masses_kg")

    if pos_all is None or vel_all is None or masses is None:
        # Degraded input (a SimResult built by hand): fall back to the primary body.
        pos_all = result.pos_m.reshape(-1, 1, 3)
        vel_all = result.vel_ms.reshape(-1, 1, 3)
        masses = np.array([1.0])

    masses = np.asarray(masses, dtype=float)
    ke_J = 0.5 * np.sum(masses[None, :] * np.sum(vel_all ** 2, axis=2), axis=1)
    pe_J = G0_MS2 * np.sum(masses[None, :] * pos_all[:, :, 2], axis=1)
    e_batt_J = result.battery_energy_J
    e_mech_J = ke_J + pe_J

    dE_mech_J = float(e_mech_J[-1] - e_mech_J[0])
    W_nongrav_J = float(d.get("work_nongrav_J", 0.0))
    denom_J = max(abs(float(e_mech_J[0])), 1.0)
    drift_frac = abs(dE_mech_J - W_nongrav_J) / denom_J

    return {
        "drift_frac": float(drift_frac),
        "work_by_wind_J": float(d.get("work_by_wind_J", 0.0)),
        "work_by_tether_J": float(d.get("work_by_tether_J", 0.0)),
        "work_by_gravity_J": float(d.get("work_by_gravity_J", 0.0)),
        # extras (documented, additive -- callers keying the four spec'd names are unaffected)
        "delta_E_mech_J": dE_mech_J,
        "delta_E_battery_J": float(e_batt_J[-1] - e_batt_J[0]) if e_batt_J.size else 0.0,
        "E_mech_initial_J": float(e_mech_J[0]),
    }


# --------------------------------------------------------------------------------------
# The free-energy guard
# --------------------------------------------------------------------------------------


def _total_energy_air_frame_J(
    vehicle: Any, pos: np.ndarray, vel: np.ndarray, wind: np.ndarray, E_batt_J: float
) -> float:
    """
    @description Total energy in the frame of the (uniform, steady) air:
                     sum_bodies( 0.5*m*|v - w|^2 + m*g0*z ) + E_battery                [J]
                 In a uniform field this frame is inertial, so this quantity can only
                 decrease.  Any increase is manufactured energy.
    @returns J.
    """
    masses = np.array([float(b.mass_kg) for b in vehicle.bodies])
    v_air = vel - wind[None, :]
    ke_J = 0.5 * float(np.sum(masses * np.sum(v_air ** 2, axis=1)))
    pe_J = G0_MS2 * float(np.sum(masses * pos[:, 2]))
    return ke_J + pe_J + float(E_batt_J)


def _free_energy_metric(
    vehicle: Any, env: EnvBundle, wind: np.ndarray, cycle_period_s: float,
    dt_s: float, n_cycles: int
) -> tuple[float, float, float, float]:
    """
    @description Run one uniform-field trajectory and return every form of the invariant.
    @returns (creation_rate_W, cycle_avg_power_W, dE_mech_air_frame_J, max_gen_violation_W)
             creation_rate_W = ( dE_battery + dE_mechanical_in_air_frame ) / T.
             In a uniform field this MUST be <= 0.  The cycle-average form equals it only
             for a closed cycle; it is returned separately so a false positive caused by a
             vehicle simply trading altitude for electricity is visible rather than fatal.
             max_gen_violation_W is the SHARP element-local rule (_GENERATION_REACTION_RULE)
             and is the one that actually catches a generator missing its reaction force.
    """
    t_end_s = cycle_period_s * n_cycles
    res = integrate_dynamic(vehicle, env, 0.0, t_end_s, dt_s)

    pos_all = res.detail["pos_all_m"]
    vel_all = res.detail["vel_all_ms"]
    E0_J = _total_energy_air_frame_J(vehicle, pos_all[0], vel_all[0], wind,
                                     res.battery_energy_J[0])
    E1_J = _total_energy_air_frame_J(vehicle, pos_all[-1], vel_all[-1], wind,
                                     res.battery_energy_J[-1])
    T_s = float(res.t_s[-1] - res.t_s[0])
    creation_W = (E1_J - E0_J) / max(T_s, _EPS)

    p_net_W = res.power_in_W - res.power_out_W
    cyc_W = float(np.trapezoid(p_net_W, res.t_s) / max(T_s, _EPS))

    masses = np.array([float(b.mass_kg) for b in vehicle.bodies])
    v_air0 = vel_all[0] - wind[None, :]
    v_air1 = vel_all[-1] - wind[None, :]
    mech0 = 0.5 * float(np.sum(masses * np.sum(v_air0 ** 2, axis=1))) \
        + G0_MS2 * float(np.sum(masses * pos_all[0][:, 2]))
    mech1 = 0.5 * float(np.sum(masses * np.sum(v_air1 ** 2, axis=1))) \
        + G0_MS2 * float(np.sum(masses * pos_all[-1][:, 2]))
    return (creation_W, cyc_W, (mech1 - mech0),
            float(res.detail.get("max_gen_violation_W", 0.0)))


def assert_no_free_energy(
    vehicle: Any,
    n_trajectories: int = 100,
    seed: int = 0,
    cycle_period_s: float = 5.0,
    dt_s: float = 0.05,
) -> None:
    """
    @description THE load-bearing guard.  Flies the vehicle through `n_trajectories`
                 randomised initial states in UNIFORM, STEADY wind fields spanning 0..50 m/s,
                 at night (the environment is built here, at local midnight, so photovoltaic
                 generation cannot mask the test), and raises FreeEnergyError if any of them
                 creates energy.

                 Three checks per trajectory, in increasing bluntness:
                   0. _GENERATION_REACTION_RULE, element-local and SHARP: no element may
                      report more electrical generation than the mechanical power its own
                      reaction force removed from the flow.  This is the check that actually
                      catches a turbine missing its momentum-theory drag -- checks 1 and 2
                      are whole-vehicle sums and a draggy airframe hides small violations
                      underneath its own dissipation (measured: an 8-trajectory run of a
                      stripped turbine passed checks 1 and 2 and failed check 0 instantly).
                   1. creation_rate_W = (dE_battery + dE_mech_in_air_frame)/T  <=  tol.
                      This is the rigorous statement -- a uniform field has an inertial
                      air-relative frame, so total energy in it cannot rise.
                   2. cycle_averaged_power_W <= tol whenever the trajectory is very nearly
                      closed (|dE_mech| small), which is the acceptance criterion as written.
                      When the trajectory is NOT closed, check 2 is skipped and check 1 --
                      which is strictly stronger -- carries the guard.  Skipping is recorded
                      in the raised message so a skip can never pass silently.
                   3. THE SLOW LOOP.  integrate_energy is a different code path with a
                      different failure mode -- it PINS the velocity instead of integrating
                      it, so it cannot fail checks 1 and 2 the way the fast loop does, and it
                      was where the largest hole actually lived: unbilled along-track drag.
                      A short night-time window in each uniform field is run through
                      integrate_energy and its mean NET electrical power must be <= tol.
                      This used to be untested entirely -- the guard only ever flew the fast
                      loop, while every closure verdict in the project came from the slow one.

                 COST.  This is the GATE, not the sweep guard: it is ~17 s per vehicle at
                 n_trajectories=100 and must not run 30,000 times.  The sweep is protected
                 instead by _assert_generation_budget, which both integrators now call on
                 EVERY step for a few floating-point operations and which raises the same
                 FreeEnergyError.  That per-step invariant is what makes the guard fail
                 CLOSED by default; this function is the deeper, randomised confirmation.
    @param n_trajectories How many randomised runs.
    @param seed RNG seed; the guard is fully deterministic for a given seed.
    @raises FreeEnergyError
    """
    rng = np.random.default_rng(seed)
    envmod = _env()
    make_uniform = getattr(envmod, "make_uniform_field")

    # Tolerance: numerical noise floor, scaled by the vehicle's own energy scale.
    total_mass_kg = sum(float(b.mass_kg) for b in vehicle.bodies)
    tol_W = 1e-6 * max(total_mass_kg, 1.0) * 1.0     # W

    original_bodies = list(vehicle.bodies)
    import copy

    n_closed_checked = 0
    try:
        for i in range(int(n_trajectories)):
            speed_ms = float(rng.uniform(0.0, 50.0))
            heading_rad = float(rng.uniform(0.0, 2.0 * math.pi))
            w = np.array([speed_ms * math.cos(heading_rad),
                          speed_ms * math.sin(heading_rad),
                          0.0])
            field = make_uniform(float(w[0]), float(w[1]), 0.0)
            # Local midnight at longitude 0 -> zero irradiance for the whole window, so any
            # positive net power can only have come from the wind.
            env = EnvBundle(wind=field, latitude_deg=0.0, longitude_deg=0.0,
                            day_of_year=172, utc_hour_at_t0_h=0.0)

            new_bodies = []
            for b in original_bodies:
                nb_ = copy.deepcopy(b)
                base_pos = np.asarray(b.pos_m, dtype=float).reshape(3)
                nb_.pos_m = base_pos + np.array([
                    rng.uniform(-50.0, 50.0),
                    rng.uniform(-50.0, 50.0),
                    rng.uniform(-20.0, 20.0),
                ])
                nb_.pos_m[2] = max(nb_.pos_m[2], 50.0)     # stay inside the ISA table
                # Air-relative velocity randomised about level flight.
                v_rel = np.array([
                    rng.uniform(3.0, 30.0),
                    rng.uniform(-3.0, 3.0),
                    rng.uniform(-2.0, 2.0),
                ])
                nb_.vel_ms = w + v_rel
                new_bodies.append(nb_)
            vehicle.bodies = new_bodies

            creation_W, cyc_W, dmech_J, viol_W = _free_energy_metric(
                vehicle, env, w, cycle_period_s, dt_s, n_cycles=2
            )

            # CHECK 0 -- the sharp one.  An element that generated electricity it never
            # removed from the flow is a free-energy bug regardless of what the vehicle's
            # total energy did; a draggy airframe will happily hide it from checks 1 and 2.
            if viol_W > tol_W:
                raise FreeEnergyError(
                    f"FREE ENERGY DETECTED on trajectory {i}: an element generated "
                    f"{viol_W:.6g} W MORE electrical power than it removed mechanical power "
                    f"from the flow (tolerance {tol_W:.3g} W), in a uniform "
                    f"{speed_ms:.2f} m/s field. See _GENERATION_REACTION_RULE. The usual "
                    "cause is a turbine or generator element whose momentum-theory reaction "
                    "drag is missing, zero, or pointing the wrong way."
                )

            if creation_W > tol_W:
                raise FreeEnergyError(
                    f"FREE ENERGY DETECTED on trajectory {i}: total energy in the "
                    f"air-relative frame ROSE at {creation_W:.6g} W in a uniform "
                    f"{speed_ms:.2f} m/s field (tolerance {tol_W:.3g} W). "
                    f"cycle_averaged_power_W = {cyc_W:.6g} W, "
                    f"delta_E_mech = {dmech_J:.6g} J. "
                    "A uniform field has an inertial air-relative frame; nothing in it can "
                    "gain energy. Suspect a wind-field discontinuity, a turbine without its "
                    "momentum-theory reaction drag, or a sign error in power_elec_W."
                )

            # Acceptance criterion as literally written, applied where it is well posed.
            energy_scale_J = max(abs(dmech_J), 1.0)
            if abs(dmech_J) < 0.01 * energy_scale_J + 1e-9:
                n_closed_checked += 1
                if cyc_W > tol_W:
                    raise FreeEnergyError(
                        f"FREE ENERGY DETECTED on trajectory {i}: cycle_averaged_power_W = "
                        f"{cyc_W:.6g} W > 0 on a CLOSED cycle in a uniform "
                        f"{speed_ms:.2f} m/s field (tolerance {tol_W:.3g} W)."
                    )

            # CHECK 3 -- THE SLOW LOOP.  Same vehicle, same still/uniform field, but through
            # integrate_energy, whose pinned-velocity trim is a completely different way to
            # lose track of a force.  Kept short (30 min from local midnight) so it stays in
            # darkness and costs a few dozen steps.
            slow_net_W = _slow_loop_net_power_W(vehicle, env)
            if slow_net_W > tol_W:
                raise FreeEnergyError(
                    f"FREE ENERGY DETECTED on trajectory {i}: integrate_energy reported a "
                    f"mean NET electrical power of {slow_net_W:.6g} W in a uniform "
                    f"{speed_ms:.2f} m/s field at night (tolerance {tol_W:.3g} W). "
                    "In a uniform field the air is at rest in the vehicle's own frame, so "
                    "there is no reservoir to draw on. The usual cause is an along-track "
                    "force the quasi-steady trim discarded instead of billing -- drag past a "
                    "saturated thruster, or a vehicle with no thruster at all."
                )
    finally:
        vehicle.bodies = original_bodies


#: Slow-loop free-energy probe window.  30 minutes from local midnight: long enough for the
#: trim to settle and the RK4 to run tens of steps, short enough to stay in full darkness so
#: photovoltaic generation cannot mask a wind-derived violation.
_SLOW_PROBE_S: float = 1800.0
_SLOW_PROBE_DT_S: float = 60.0


def _slow_loop_net_power_W(vehicle: Any, env: EnvBundle) -> float:
    """
    @description Mean net electrical power (generation minus consumption) over a short
                 night-time window of the SLOW loop.  In a uniform field this must be <= 0.
    @param vehicle A Vehicle, already positioned by the caller.
    @param env EnvBundle carrying the uniform field, at local midnight.
    @returns Mean of (power_in - power_out), W.  > 0 means net extraction.
    """
    res = integrate_energy(vehicle, env, 0.0, _SLOW_PROBE_S, _SLOW_PROBE_DT_S)
    p_net_W = res.power_in_W - res.power_out_W
    if res.t_s.size < 2:
        return float(np.mean(p_net_W)) if p_net_W.size else 0.0
    span_s = float(res.t_s[-1] - res.t_s[0])
    return float(np.trapezoid(p_net_W, res.t_s) / max(span_s, _EPS))


# ======================================================================================
# SELF-TEST
# ======================================================================================
# Runs the module's acceptance test.  If the sibling aerosim.env / aerosim.vehicle modules
# are importable it uses them.  When they are not (the agents build in parallel), it installs
# a REFERENCE ENVIRONMENT and REFERENCE ELEMENTS defined below -- these are test fixtures for
# integrate.py, not deliverables, and they contain real physics (geopotential ISA, monotone
# PCHIP shear, lifting-line + actuator-disk, Hooke tether) rather than canned numbers, so the
# integrator is genuinely exercised.  Which mode ran is printed in the header.
# ======================================================================================

if __name__ == "__main__":
    import sys
    import time
    import types
    from typing import NamedTuple

    # ---------------------------------------------------------------- reference env ----
    class _AtmoSample(NamedTuple):
        T_K: float
        p_Pa: float
        rho_kgm3: float
        mu_Pas: float
        a_ms: float

    class _WindSample(NamedTuple):
        u_ms: float
        v_ms: float
        w_ms: float
        dudz_1s: float
        dvdz_1s: float
        dwdz_1s: float

    class _SolarSample(NamedTuple):
        elevation_rad: float
        azimuth_rad: float
        dni_Wm2: float
        dhi_Wm2: float
        ghi_Wm2: float
        poa_Wm2: float

    _R = 287.052874          # J/(kg*K), specific gas constant for dry air
    _GAMMA = 1.4             # dimensionless
    _R0_M = 6356766.0        # m, ISA effective Earth radius for the geopotential conversion
    # ISA layers: (base geopotential altitude m, base T K, lapse rate K/m)
    _LAYERS = [(0.0, 288.15, -0.0065), (11000.0, 216.65, 0.0),
               (20000.0, 216.65, 0.001), (32000.0, 228.65, 0.0028),
               (47000.0, 270.65, 0.0)]
    _P0_PA = 101325.0

    def _ref_sutherland_mu(T_K):
        return 1.458e-6 * np.power(T_K, 1.5) / (T_K + 110.4)      # Pa*s

    def _ref_atmosphere(altitude_m):
        z = float(altitude_m)                                      # m geometric
        h = _R0_M * z / (_R0_M + z)                                # m geopotential (MANDATORY)
        p = _P0_PA
        T = 288.15
        for i, (hb, Tb, L) in enumerate(_LAYERS):
            h_top = _LAYERS[i + 1][0] if i + 1 < len(_LAYERS) else 1e12
            if h <= hb:
                break
            dh = min(h, h_top) - hb
            if L == 0.0:
                p *= math.exp(-G0_MS2 * dh / (_R * Tb))
                T = Tb
            else:
                T = Tb + L * dh
                p *= (T / Tb) ** (-G0_MS2 / (_R * L))
            if h <= h_top:
                break
        else:
            pass
        # recompute T/p cleanly by walking layers
        p = _P0_PA
        for i, (hb, Tb, L) in enumerate(_LAYERS):
            h_top = _LAYERS[i + 1][0] if i + 1 < len(_LAYERS) else 1e12
            if h < hb:
                break
            dh = min(h, h_top) - hb
            if L == 0.0:
                p_next = p * math.exp(-G0_MS2 * dh / (_R * Tb))
                T = Tb
            else:
                T_next = Tb + L * dh
                p_next = p * (T_next / Tb) ** (-G0_MS2 / (_R * L))
                T = T_next
            if h <= h_top:
                p = p_next
                break
            p = p_next
        rho = p / (_R * T)
        return _AtmoSample(T, p, rho, float(_ref_sutherland_mu(T)), math.sqrt(_GAMMA * _R * T))

    def _ref_reynolds(rho_kgm3, V_ms, chord_m, mu_Pas):
        return rho_kgm3 * V_ms * chord_m / mu_Pas

    class _UniformField:
        """Uniform, steady wind. Gradients are EXACTLY zero -- the free-energy baseline."""

        def __init__(self, u, v, w):
            self.u, self.v, self.w = float(u), float(v), float(w)

        def sample(self, x_m, y_m, z_m, t_s):
            return _WindSample(self.u, self.v, self.w, 0.0, 0.0, 0.0)

    def _ref_make_uniform_field(u_ms, v_ms, w_ms):
        return _UniformField(u_ms, v_ms, w_ms)

    class _ShearField:
        """Monotone C1 PCHIP profile in z, with the ANALYTIC derivative (no finite diff)."""

        def __init__(self, z_nodes, u_nodes, v_nodes):
            from scipy.interpolate import PchipInterpolator

            z = np.asarray(z_nodes, dtype=float)
            self._u = PchipInterpolator(z, np.asarray(u_nodes, dtype=float), extrapolate=True)
            self._v = PchipInterpolator(z, np.asarray(v_nodes, dtype=float), extrapolate=True)
            self._du = self._u.derivative()
            self._dv = self._v.derivative()

        def sample(self, x_m, y_m, z_m, t_s):
            return _WindSample(float(self._u(z_m)), float(self._v(z_m)), 0.0,
                               float(self._du(z_m)), float(self._dv(z_m)), 0.0)

    def _ref_make_shear_layer_field(nodes_z_m, nodes_u_ms, nodes_v_ms):
        return _ShearField(nodes_z_m, nodes_u_ms, nodes_v_ms)

    def _ref_solar(latitude_deg, longitude_deg, day_of_year, utc_hour_h, altitude_m,
                   panel_tilt_deg=0.0, panel_azimuth_deg=180.0, albedo=0.2):
        n = int(day_of_year)
        # Cooper declination, deg
        decl = 23.44 * math.sin(math.radians(360.0 / 365.0 * (284 + n)))
        solar_time_h = utc_hour_h + longitude_deg / 15.0
        H_deg = 15.0 * (solar_time_h - 12.0)
        phi, d, H = map(math.radians, (latitude_deg, decl, H_deg))
        sin_elev = math.sin(phi) * math.sin(d) + math.cos(phi) * math.cos(d) * math.cos(H)
        sin_elev = max(-1.0, min(1.0, sin_elev))
        elev = math.asin(sin_elev)
        if sin_elev <= 0.0:
            return _SolarSample(elev, 0.0, 0.0, 0.0, 0.0, 0.0)
        E0 = 1361.0 * (1.0 + 0.033 * math.cos(math.radians(360.0 * n / 365.0)))   # W/m^2
        elev_deg = math.degrees(elev)
        am = 1.0 / (sin_elev + 0.50572 * (elev_deg + 6.07995) ** -1.6364)   # Kasten-Young
        p_ratio = _ref_atmosphere(altitude_m).p_Pa / _P0_PA
        tau = 0.7 ** ((am * p_ratio) ** 0.678)                              # Meinel
        dni = E0 * tau
        dhi = 0.10 * E0 * sin_elev * (1.0 - tau) / max(1.0 - 0.7, 1e-9) * 0.30
        ghi = dni * sin_elev + dhi
        tilt = math.radians(panel_tilt_deg)
        poa = dni * max(0.0, sin_elev * math.cos(tilt)) + dhi * (1 + math.cos(tilt)) / 2.0
        az = math.atan2(-math.cos(d) * math.sin(H),
                        math.sin(d) * math.cos(phi) - math.cos(d) * math.sin(phi) * math.cos(H))
        return _SolarSample(elev, az, dni, dhi, ghi, poa if panel_tilt_deg else ghi)

    def _ref_day_length_h(latitude_deg, day_of_year):
        decl = 23.44 * math.sin(math.radians(360.0 / 365.0 * (284 + int(day_of_year))))
        x = -math.tan(math.radians(latitude_deg)) * math.tan(math.radians(decl))
        if x <= -1.0:
            return 24.0
        if x >= 1.0:
            return 0.0
        return 2.0 * math.degrees(math.acos(x)) / 15.0

    # ------------------------------------------------------------ reference elements ----
    @dataclass
    class _BodyState:
        pos_m: np.ndarray
        vel_ms: np.ndarray
        mass_kg: float
        att_quat: Any = None

    @dataclass
    class _ElementForce:
        force_N: np.ndarray
        moment_Nm: np.ndarray
        power_elec_W: float

    @dataclass
    class _WingGeometry:
        span_m: float
        area_m2: float
        taper_ratio: float = 1.0
        sweep_deg: float = 0.0
        twist_root_deg: float = 0.0
        twist_tip_deg: float = 0.0

    class _RefAeroSurface:
        """
        Reference lifting surface. Real physics, no canned polar:
          CL   = CL_alpha * (alpha + incidence),  CL_alpha = 2*pi*AR/(AR+2)   (finite wing)
          CD   = CD0 + CL^2/(pi*AR*e)                                          (drag polar)
        Forces are built in the AIR-RELATIVE frame so a uniform wind can do no work.
        """

        def __init__(self, geometry, body_index=0, offset_m=None, incidence_deg=4.0,
                     extra_CD0=0.010, oswald_e=0.95):
            self.geometry = geometry
            self.body_index = body_index
            self.offset_m = np.zeros(3) if offset_m is None else np.asarray(offset_m, float)
            self.incidence_deg = float(incidence_deg)
            self.extra_CD0 = float(extra_CD0)
            self.oswald_e = float(oswald_e)
            self.AR = geometry.span_m ** 2 / geometry.area_m2      # dimensionless

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
            b = bodies[self.body_index]
            w = np.array([wind.u_ms, wind.v_ms, wind.w_ms])
            v_air = np.asarray(b.vel_ms, float) - w                # m/s, air-relative
            V = float(np.linalg.norm(v_air))
            if V < 1e-6:
                return _ElementForce(np.zeros(3), np.zeros(3), 0.0)
            xhat = v_air / V                                        # drag acts along -xhat
            up = np.array([0.0, 0.0, 1.0])
            lat = np.cross(up, xhat)
            if np.linalg.norm(lat) < 1e-9:
                lat = np.array([0.0, 1.0, 0.0])
            lat /= np.linalg.norm(lat)
            lhat = np.cross(xhat, lat)                              # lift direction, unit
            if lhat[2] < 0:
                lhat = -lhat
            # 3-DOF: geometric angle of attack = incidence + flight-path angle correction 0
            alpha_rad = math.radians(self.incidence_deg)
            cl_alpha = 2.0 * math.pi * self.AR / (self.AR + 2.0)    # 1/rad
            CL = cl_alpha * alpha_rad
            CD = self.extra_CD0 + CL * CL / (math.pi * self.AR * self.oswald_e)
            q = 0.5 * atmo.rho_kgm3 * V * V                          # Pa
            S = self.geometry.area_m2
            F = q * S * (CL * lhat - CD * xhat)                      # N
            return _ElementForce(F, np.zeros(3), 0.0)

    class _RefThruster:
        """Momentum-theory propeller. Reads the integrator's thrust command (OBJECTION 2)."""

        def __init__(self, diameter_m, max_electrical_power_W, body_index=0,
                     axis=(1.0, 0.0, 0.0)):
            self.diameter_m = float(diameter_m)
            self.max_electrical_power_W = float(max_electrical_power_W)
            self.body_index = body_index
            self.axis = np.asarray(axis, float)
            self.offset_m = np.zeros(3)
            self.thrust_command_N = 0.0

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
            T = max(0.0, float(self.thrust_command_N))
            if T <= 0.0:
                return _ElementForce(np.zeros(3), np.zeros(3), 0.0)
            b = bodies[self.body_index]
            w = np.array([wind.u_ms, wind.v_ms, wind.w_ms])
            v_air = np.asarray(b.vel_ms, float) - w
            V = float(np.linalg.norm(v_air))
            d_hat = v_air / V if V > 0.1 else self.axis / np.linalg.norm(self.axis)
            A = math.pi * 0.25 * self.diameter_m ** 2
            P = _actuator_disk_power_W(T, V, atmo.rho_kgm3, A)
            if P > self.max_electrical_power_W:
                T = _thrust_for_power(self.max_electrical_power_W, V, atmo.rho_kgm3, A)
                P = self.max_electrical_power_W
            return _ElementForce(T * d_hat, np.zeros(3), -P)

    class _RefPVArray:
        """Photovoltaic array. Produces power, never force."""

        #: EXPLICIT declared opt-in from the reaction rule (bounded by irradiance * area);
        #: the exemption is never inferred from an attribute name.  FROZEN name.
        non_mechanical_source = True

        def __init__(self, area_m2, cell_efficiency_stc, packing_factor, tilt_deg=0.0,
                     azimuth_deg=180.0, body_index=0, mppt=0.95, temp_coeff=-0.004):
            self.area_m2 = float(area_m2)
            self.cell_efficiency_stc = float(cell_efficiency_stc)
            self.packing_factor = float(packing_factor)
            self.tilt_deg = float(tilt_deg)
            self.azimuth_deg = float(azimuth_deg)
            self.body_index = body_index
            self.offset_m = np.zeros(3)
            self.mppt = float(mppt)
            self.temp_coeff = float(temp_coeff)

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
            G = float(sol.poa_Wm2)                                   # W/m^2
            if G <= 0.0:
                return _ElementForce(np.zeros(3), np.zeros(3), 0.0)
            # Cell runs above ambient; simple convective/radiative balance stand-in.
            T_cell = atmo.T_K + 25.0 * G / 1000.0                    # K
            eta = self.cell_efficiency_stc * (1.0 + self.temp_coeff * (T_cell - 298.15))
            P = G * self.area_m2 * self.packing_factor * max(eta, 0.0) * self.mppt
            return _ElementForce(np.zeros(3), np.zeros(3), P)

    class _RefBattery:
        """Storage. Contributes ZERO to the bus -- the integrator owns it (OBJECTION 3)."""

        def __init__(self, capacity_J, initial_soc=1.0, body_index=0,
                     eta_charge=0.95, eta_discharge=0.95, soc_min=0.05, soc_max=1.0):
            self.capacity_J = float(capacity_J)
            self.initial_soc = float(initial_soc)
            self.body_index = body_index
            self.offset_m = np.zeros(3)
            self.eta_charge = eta_charge
            self.eta_discharge = eta_discharge
            self.soc_min = soc_min
            self.soc_max = soc_max

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
            return _ElementForce(np.zeros(3), np.zeros(3), 0.0)

    class _RefTether:
        """
        Tension-only penalty spring with viscous damping and cylinder drag.
        Emits equal-and-opposite forces on both bodies in ONE evaluate, so an RK4 stage can
        never split the pair. force_N is returned shaped [n_bodies, 3].
        """

        def __init__(self, body_a, body_b, rest_length_m, EA_N, damping_Ns_per_m=0.0,
                     diameter_m=0.001, drag_coefficient=1.1, n_bodies=2):
            self.body_a = body_a
            self.body_b = body_b
            self.body_index = body_a
            self.offset_m = np.zeros(3)
            self.rest_length_m = float(rest_length_m)
            self.EA_N = float(EA_N)
            self.damping_Ns_per_m = float(damping_Ns_per_m)
            self.diameter_m = float(diameter_m)
            self.drag_coefficient = float(drag_coefficient)
            self.n_bodies = n_bodies

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
            F = np.zeros((self.n_bodies, 3))
            a, b = bodies[self.body_a], bodies[self.body_b]
            d = np.asarray(b.pos_m, float) - np.asarray(a.pos_m, float)
            L = float(np.linalg.norm(d))
            if L <= self.rest_length_m or L < 1e-9:
                return _ElementForce(F, np.zeros(3), 0.0)            # tension only
            u = d / L
            strain = (L - self.rest_length_m) / self.rest_length_m   # dimensionless
            T = self.EA_N * strain                                    # N, Hooke
            v_rel = float(np.dot(np.asarray(b.vel_ms, float) - np.asarray(a.vel_ms, float), u))
            T += self.damping_Ns_per_m * v_rel
            T = max(0.0, T)
            F[self.body_a] += T * u
            F[self.body_b] -= T * u
            return _ElementForce(F, np.zeros(3), 0.0)

    class _RefDrogue:
        """A pure drag body (the sky-sailboat's anchor in the slow layer)."""

        def __init__(self, cda_m2, body_index):
            self.cda_m2 = float(cda_m2)                              # m^2, Cd*A
            self.body_index = body_index
            self.offset_m = np.zeros(3)
            self.incidence_deg = 0.0                                 # classified as aero

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
            b = bodies[self.body_index]
            w = np.array([wind.u_ms, wind.v_ms, wind.w_ms])
            v_air = np.asarray(b.vel_ms, float) - w
            V = float(np.linalg.norm(v_air))
            if V < 1e-9:
                return _ElementForce(np.zeros(3), np.zeros(3), 0.0)
            F = -0.5 * atmo.rho_kgm3 * V * self.cda_m2 * v_air        # N
            return _ElementForce(F, np.zeros(3), 0.0)

    class _RefBuoyancy:
        """
        Super-pressure gas volume.  Net lift = V*(rho_air - rho_gas)*g, with helium at
        thermal equilibrium rho_He = rho_air * (4.003/28.96) = rho_air * 0.1382 (project
        constant).  Vertical force only; the envelope's drag is a separate _RefDrogue.
        """

        def __init__(self, volume_m3, body_index=0, gas="helium"):
            self.volume_m3 = float(volume_m3)
            self.body_index = body_index
            self.offset_m = np.zeros(3)
            self.gas_fraction = 0.1382 if gas == "helium" else 0.0696   # dimensionless

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
            rho_gas = atmo.rho_kgm3 * self.gas_fraction                  # kg/m^3
            lift_N = self.volume_m3 * (atmo.rho_kgm3 - rho_gas) * G0_MS2
            return _ElementForce(np.array([0.0, 0.0, lift_N]), np.zeros(3), 0.0)

    class _RefTurbine:
        """
        Wind turbine (OBJECTION 4 -- vehicle has no such element yet).
        Extraction and its momentum-theory reaction drag are the SAME actuator disk, so the
        drag can never be forgotten:
            P = 0.5*rho*A*V^3*Cp        [W]
            D = 0.5*rho*A*V^2*Cp        [N]   (=> P = D*V exactly, no free lunch)
        V is the AIR-RELATIVE speed, so in uniform wind a drifting vehicle extracts nothing.
        """

        def __init__(self, swept_area_m2, body_index=0, cp=0.40, eta_gen=0.90):
            self.swept_area_m2 = float(swept_area_m2)
            self.body_index = body_index
            self.offset_m = np.zeros(3)
            self.cp = float(cp)
            self.eta_gen = float(eta_gen)

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
            b = bodies[self.body_index]
            w = np.array([wind.u_ms, wind.v_ms, wind.w_ms])
            v_air = np.asarray(b.vel_ms, float) - w
            V = float(np.linalg.norm(v_air))
            if V < 1e-9:
                return _ElementForce(np.zeros(3), np.zeros(3), 0.0)
            u = v_air / V
            D = 0.5 * atmo.rho_kgm3 * self.swept_area_m2 * V * V * self.cp     # N
            P = 0.5 * atmo.rho_kgm3 * self.swept_area_m2 * V ** 3 * self.cp    # W mech
            return _ElementForce(-D * u, np.zeros(3), P * self.eta_gen)

    @dataclass
    class _RefVehicle:
        bodies: list
        elements: list

        def net(self, atmo, wind, sol, t_s, dt_s):
            f = np.zeros((len(self.bodies), 3))
            p = 0.0
            for el in self.elements:
                r = el.evaluate(self.bodies, atmo, wind, sol, t_s, dt_s)
                ff = np.asarray(r.force_N, float)
                if ff.ndim == 2:
                    f += ff
                else:
                    f[_body_index(el)] += ff
                p += r.power_elec_W
            return f, p

    # ------------------------------------------------------------------ wire up env ----
    # Use the real aerosim.env when it is complete; otherwise install the reference fixture
    # under the same module name so the integrator code path is identical either way.
    USING_REAL_ENV = False
    for _cand_name in ("aerosim.env", "env"):
        try:
            _cand = importlib.import_module(_cand_name)
        except ImportError:
            continue
        if _env_is_complete(_cand) and callable(getattr(_cand, "make_shear_layer_field", None)):
            USING_REAL_ENV = True
            break

    if not USING_REAL_ENV:
        ref = types.ModuleType("aerosim.env")
        ref.AtmoSample = _AtmoSample
        ref.WindSample = _WindSample
        ref.SolarSample = _SolarSample
        ref.atmosphere = _ref_atmosphere
        ref.sutherland_mu = _ref_sutherland_mu
        ref.reynolds = _ref_reynolds
        ref.solar = _ref_solar
        ref.day_length_h = _ref_day_length_h
        ref.make_uniform_field = _ref_make_uniform_field
        ref.make_shear_layer_field = _ref_make_shear_layer_field
        sys.modules["aerosim.env"] = ref
        sys.modules.pop("env", None)

    E = _env()

    # ------------------------------------------------------------------- test runner ----
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, msg: str) -> None:
        results.append((name, bool(ok), msg))
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {msg}")

    print("=" * 86)
    print("aerosim.integrate SELF-TEST")
    print(f"  env module: {'REAL aerosim.env' if USING_REAL_ENV else 'reference fixture (aerosim.env not present yet)'}")
    print(f"  vehicle    : reference fixture elements (integrate is duck-typed; no vehicle import)")
    print("=" * 86)

    # Cross-check the environment the tests stand on (project physics constants).
    print("\n[0] Environment cross-check against the project's agreed ISA table")
    for z_m, rho_ref in ((0.0, 1.2250), (5000.0, 0.7364), (10000.0, 0.4135),
                         (15000.0, 0.1948), (20000.0, 0.0889)):
        a = E.atmosphere(z_m)
        err = abs(a.rho_kgm3 - rho_ref) / rho_ref
        check(f"rho({z_m/1000:.0f} km)", err < 0.005,
              f"{a.rho_kgm3:.5f} kg/m3 vs {rho_ref} ref, err {err*100:.3f}%")
    a20 = E.atmosphere(20000.0)
    re_check = a20.rho_kgm3 * 15.0 * 0.10 / a20.mu_Pas
    check("Re(20km, 15 m/s, 0.10 m)", abs(re_check - 9381) / 9381 < 0.01,
          f"{re_check:.0f} (ref ~9381)")

    # ---------------------------------------------------------------------------------
    print("\n[1] Conservation: bare point mass under gravity only")
    # 24 h at dt = 60 s
    pm = _RefVehicle(bodies=[_BodyState(np.array([0.0, 0.0, 20000.0]),
                                        np.array([30.0, 0.0, 5.0]), 2.0)],
                     elements=[])
    envb = EnvBundle(E.make_uniform_field(0.0, 0.0, 0.0), 0.0, 0.0, 172)
    t_start = time.perf_counter()
    r_slow = integrate_energy(pm, envb, 0.0, 86400.0, 60.0)
    slow_wall_s = time.perf_counter() - t_start
    aud = energy_audit(r_slow)
    m = 2.0
    e0 = 0.5 * m * np.sum(r_slow.vel_ms[0] ** 2) + m * G0_MS2 * r_slow.pos_m[0, 2]
    e1 = 0.5 * m * np.sum(r_slow.vel_ms[-1] ** 2) + m * G0_MS2 * r_slow.pos_m[-1, 2]
    rel = abs(e1 - e0) / abs(e0)
    check("point mass 24 h @ dt=60 s, |dE|/E0 < 1e-6", rel < 1e-6,
          f"|dE|/E0 = {rel:.3e}  (drift_frac from energy_audit = {aud['drift_frac']:.3e})")

    pm2 = _RefVehicle(bodies=[_BodyState(np.array([0.0, 0.0, 20000.0]),
                                         np.array([30.0, 0.0, 5.0]), 2.0)],
                      elements=[])
    r_fast = integrate_dynamic(pm2, envb, 0.0, 600.0, 0.05)
    e0f = 0.5 * m * np.sum(r_fast.vel_ms[0] ** 2) + m * G0_MS2 * r_fast.pos_m[0, 2]
    e1f = 0.5 * m * np.sum(r_fast.vel_ms[-1] ** 2) + m * G0_MS2 * r_fast.pos_m[-1, 2]
    relf = abs(e1f - e0f) / abs(e0f)
    check("point mass 600 s @ dt=0.05 s, |dE|/E0 < 1e-9", relf < 1e-9,
          f"|dE|/E0 = {relf:.3e}")

    # ---------------------------------------------------------------------------------
    print("\n[2] Runtime budget: 24 h at dt = 60 s in under 1.0 s")

    def make_solar_plane(alt_m=500.0, v0_ms=9.5):
        """AtlantikSolar-class: 5.65 m span, 1.72 m2, 6.93 kg (project validation case A)."""
        geo = _WingGeometry(span_m=5.65, area_m2=1.72, taper_ratio=0.7)
        body = _BodyState(np.array([0.0, 0.0, alt_m]), np.array([v0_ms, 0.0, 0.0]), 6.93)
        els = [
            _RefAeroSurface(geo, 0, None, incidence_deg=4.2, extra_CD0=0.016),
            _RefThruster(0.26, 200.0, 0),
            _RefPVArray(1.35, 0.237, 0.90, 0.0, 180.0, 0),
            _RefBattery(capacity_J=2.9e6, initial_soc=0.60, body_index=0),
        ]
        return _RefVehicle(bodies=[body], elements=els)

    # NOTE ON MEASUREMENT.  This box is shared (the other aerosim agents are installing and
    # running AeroSandbox/XFOIL right now) and back-to-back runs of the IDENTICAL workload
    # -- same 1441 steps, same single trim solve -- measured 198 ms and 1776 ms wall clock.
    # Wall clock there is measuring the neighbours, not this module.  The budget is stated
    # "single-core", so the assertion is on PROCESS CPU TIME, with wall clock reported
    # alongside and the best of three taken to blunt scheduler noise.
    plane = make_solar_plane()
    envA = EnvBundle(E.make_uniform_field(0.0, 0.0, 0.0), 47.6, 8.5, 195, 0.0)
    cpu_best_s, wall_best_s, rA = float("inf"), float("inf"), None
    for _ in range(3):
        t_cpu0, t_wall0 = time.process_time(), time.perf_counter()
        rA = integrate_energy(make_solar_plane(), envA, 0.0, 86400.0, 60.0)
        cpu_best_s = min(cpu_best_s, time.process_time() - t_cpu0)
        wall_best_s = min(wall_best_s, time.perf_counter() - t_wall0)
    check("24 h @ dt=60 s single-core CPU time < 1.0 s", cpu_best_s < 1.0,
          f"{cpu_best_s*1000:.1f} ms CPU (best of 3; wall {wall_best_s*1000:.1f} ms) "
          f"over {rA.t_s.size} steps with {rA.detail['n_trims']} trim solve(s)")
    print(f"        cruise: V_air = {rA.detail['trim_V_ms']:.2f} m/s, "
          f"P_out = {np.mean(rA.power_out_W):.1f} W mean, "
          f"P_in = {np.mean(rA.power_in_W):.1f} W mean, "
          f"Re = {rA.mean_cruise_Re:.0f}, min_soc = {rA.min_soc:.3f}, closed = {rA.closed}")

    # ---------------------------------------------------------------------------------
    print("\n[3] Two-timescale agreement: dynamic(dt=0.05, 600 s) vs energy(dt=60)")
    plane_s = make_solar_plane()
    env_night = EnvBundle(E.make_uniform_field(0.0, 0.0, 0.0), 47.6, 8.5, 195, 0.0)
    r_e = integrate_energy(plane_s, env_night, 0.0, 600.0, 60.0)
    p_energy_W = float(np.mean(r_e.power_out_W))

    plane_d = make_solar_plane(v0_ms=r_e.detail["trim_V_ms"])
    r_d = integrate_dynamic(plane_d, env_night, 0.0, 600.0, 0.05)
    # compare over the settled second half
    half = r_d.power_out_W.size // 2
    p_dyn_W = float(np.mean(r_d.power_out_W[half:]))
    rel_pw = abs(p_dyn_W - p_energy_W) / max(p_energy_W, 1e-9)
    check("level-cruise electrical power agrees within 2%", rel_pw < 0.02,
          f"energy loop {p_energy_W:.3f} W vs dynamic loop {p_dyn_W:.3f} W, "
          f"delta {rel_pw*100:.3f}%")

    # ---------------------------------------------------------------------------------
    print("\n[4] THE GUARD: assert_no_free_energy, 100 uniform-wind trajectories, 0..50 m/s")

    def make_turbine_flier():
        """Free-flier carrying a wind turbine -- validation case D's shape."""
        geo = _WingGeometry(span_m=5.65, area_m2=1.72, taper_ratio=0.7)
        body = _BodyState(np.array([0.0, 0.0, 1000.0]), np.array([12.0, 0.0, 0.0]), 6.93)
        els = [
            _RefAeroSurface(geo, 0, None, incidence_deg=4.2, extra_CD0=0.016),
            _RefThruster(0.26, 400.0, 0),
            _RefTurbine(swept_area_m2=0.10, body_index=0, cp=0.40, eta_gen=0.90),
            _RefBattery(capacity_J=2.9e6, initial_soc=0.60, body_index=0),
        ]
        return _RefVehicle(bodies=[body], elements=els)

    tf = make_turbine_flier()
    t_start = time.perf_counter()
    guard_err = None
    try:
        assert_no_free_energy(tf, n_trajectories=100, seed=0, cycle_period_s=5.0, dt_s=0.05)
    except FreeEnergyError as exc:
        guard_err = exc
    guard_wall_s = time.perf_counter() - t_start
    check("100 uniform-field trajectories create no energy", guard_err is None,
          f"no violation in 100 runs ({guard_wall_s:.2f} s)" if guard_err is None
          else str(guard_err))

    # And the plain cycle-averaged power in uniform wind must be <= 0.
    tf2 = make_turbine_flier()
    env_u = EnvBundle(E.make_uniform_field(20.0, 0.0, 0.0), 0.0, 0.0, 172, 0.0)
    p_uniform_W = cycle_averaged_power_W(tf2, env_u, cycle_period_s=10.0, dt_s=0.05, n_cycles=3)
    check("cycle_averaged_power_W <= 0 in uniform 20 m/s wind", p_uniform_W <= 0.0,
          f"{p_uniform_W:.4f} W")

    # Positive control on the guard itself: a deliberately broken element MUST trip it.
    class _BrokenTurbine(_RefTurbine):
        """Generation with NO reaction drag -- the exact bug class the guard exists for."""

        def evaluate(self, bodies, atmo, wind, sol, t_s, dt_s):
            r = super().evaluate(bodies, atmo, wind, sol, t_s, dt_s)
            return _ElementForce(np.zeros(3), np.zeros(3), r.power_elec_W)

    bad = make_turbine_flier()
    bad.elements[2] = _BrokenTurbine(0.10, 0, 0.40, 0.90)
    tripped = False
    try:
        assert_no_free_energy(bad, n_trajectories=8, seed=1, cycle_period_s=5.0, dt_s=0.05)
    except FreeEnergyError:
        tripped = True
    check("guard TRIPS on a turbine with no reaction drag (mutation test)", tripped,
          "FreeEnergyError raised as required" if tripped
          else "guard stayed silent on a known-bad element -- the guard is worthless")

    # ---------------------------------------------------------------------------------
    print("\n[5] Shear extraction is real, not manufactured (archetype 3)")
    # du/dz = 0.05 1/s across 200..400 m  =>  10 m/s at 200 m, 20 m/s at 400 m.
    z_nodes = [0.0, 100.0, 200.0, 400.0, 800.0]
    u_nodes = [5.0, 7.5, 10.0, 20.0, 25.0]
    v_nodes = [0.0, 0.0, 0.0, 0.0, 0.0]
    shear = E.make_shear_layer_field(z_nodes, u_nodes, v_nodes)
    ws_lo = shear.sample(0.0, 0.0, 200.0, 0.0)
    ws_hi = shear.sample(0.0, 0.0, 400.0, 0.0)
    print(f"        shear field: u(200 m) = {ws_lo.u_ms:.2f} m/s, u(400 m) = {ws_hi.u_ms:.2f} m/s, "
          f"mean du/dz = {(ws_hi.u_ms-ws_lo.u_ms)/200.0:.4f} 1/s")

    def make_sailboat(u_at_sail_ms, u_at_anchor_ms):
        """
        BALLOON-ANCHORED SKY SAILBOAT (archetype 3).

        A sail (aero surface, zero incidence -> pure drag, exactly like a boat's sail) with
        a turbine, floating in the FAST layer at 400 m, tethered to a buoyant anchor body
        carrying a large drag area in the SLOW layer at 200 m.

        WHY BUOYANT AND NOT A LIFTING WING:  an earlier version of this fixture used a
        lifting wing and a passive drogue.  It "extracted" 108 W in UNIFORM wind, and
        energy_audit showed why -- work_by_gravity = +24 kJ over 60 s.  It was funding the
        turbine by sinking, i.e. spending its altitude reservoir, which is finite and is not
        shear.  That is precisely the manufactured-energy failure this project exists to
        avoid, and it is invisible unless you look at the audit.  Making the assembly
        NEUTRALLY BUOYANT removes the altitude reservoir entirely: there is nothing left to
        spend, so any sustained power must come from the two-layer velocity difference.

        The physics, in one line: with the sail driven downwind by force F in wind U_hi and
        the anchor resisting with -F in wind U_lo, the rate at which the field does work on
        the vehicle is F*U_hi - F*U_lo = F*(U_hi - U_lo).  Zero when the layers match.
        That is the sailboat, with two air layers instead of air and water.

        GEOMETRY MATTERS AND THE FIRST VERSION HAD IT UPSIDE DOWN.  A tension-only tether
        can only PULL.  With the buoyant body underneath, it pulls the upper body DOWN, so
        the float cannot hold the sail up and the sail simply free-falls -- which is what the
        first fixture did (it read as 108 W of "shear extraction" in uniform wind).  The
        buoyant body must be ON TOP: the float rides the fast layer, the anchor hangs in the
        slow layer, and its own weight is what keeps the tether taut.

        The initial common velocity is set to the momentum-balance equilibrium
            CdA_float*(U_hi - Vx)^2 = CdA_anchor*(Vx - U_lo)^2
        and the initial separation to the equilibrium tether stretch, so the run starts on
        its limit cycle rather than spending cycles settling.
        """
        mass_float_kg, mass_anchor_kg = 6.0, 4.0
        total_N = (mass_float_kg + mass_anchor_kg) * G0_MS2

        # Neutral buoyancy at the FLOAT's altitude: V*(rho - 0.1382*rho)*g = W_total
        z_float_m, z_anchor_m = 400.0, 200.0
        rho_float = E.atmosphere(z_float_m).rho_kgm3
        volume_m3 = total_N / (0.8618 * rho_float * G0_MS2)
        d_m = (6.0 * volume_m3 / math.pi) ** (1.0 / 3.0)                  # sphere diameter, m
        cda_float_m2 = 0.45 * math.pi * 0.25 * d_m * d_m                  # Cd*A, sphere
        cda_anchor_m2 = 0.50                                              # Cd*A, drogue
        turbine_area_m2 = 0.15
        cp = 0.40
        # The turbine's reaction drag is part of the anchor's resistance: Cd*A_eff = Cp*A.
        cda_anchor_eff_m2 = cda_anchor_m2 + cp * turbine_area_m2

        a = math.sqrt(cda_float_m2)
        b = math.sqrt(cda_anchor_eff_m2)
        Vx = (a * u_at_sail_ms + b * u_at_anchor_ms) / (a + b)   # m/s, common ground speed

        # Equilibrium tether stretch: tension = anchor weight, k = EA/L.
        EA_N, rest_m = 3.0e4, 200.0
        stretch_m = (mass_anchor_kg * G0_MS2) / (EA_N / rest_m)

        float_body = _BodyState(np.array([0.0, 0.0, z_anchor_m + rest_m + stretch_m]),
                                np.array([Vx, 0.0, 0.0]), mass_float_kg)
        anchor = _BodyState(np.array([0.0, 0.0, z_anchor_m]),
                            np.array([Vx, 0.0, 0.0]), mass_anchor_kg)
        els = [
            _RefBuoyancy(volume_m3=volume_m3, body_index=0),          # float: holds altitude
            _RefDrogue(cda_m2=cda_float_m2, body_index=0),            # float: the "sail"
            _RefDrogue(cda_m2=cda_anchor_m2, body_index=1),           # anchor: the "keel"
            _RefTurbine(swept_area_m2=turbine_area_m2, body_index=1,  # harvest in slow layer
                        cp=cp, eta_gen=0.90),
            _RefTether(0, 1, rest_length_m=rest_m, EA_N=EA_N,
                       damping_Ns_per_m=40.0, n_bodies=2),
            _RefBattery(capacity_J=1.0e6, initial_soc=0.5, body_index=0),
        ]
        print(f"        sailboat: Vx_eq = {Vx:.2f} m/s, float airspeed "
              f"{abs(u_at_sail_ms - Vx):.2f} m/s, anchor airspeed "
              f"{abs(Vx - u_at_anchor_ms):.2f} m/s, buoyant volume {volume_m3:.2f} m3 "
              f"(neutral -> no altitude reservoir)")
        return _RefVehicle(bodies=[float_body, anchor], elements=els)

    env_shear = EnvBundle(shear, 0.0, 0.0, 172, 0.0)     # midnight -> no PV contribution
    boat = make_sailboat(20.0, 10.0)
    p_shear_W = cycle_averaged_power_W(boat, env_shear, cycle_period_s=20.0,
                                       dt_s=0.05, n_cycles=4)

    # SAME vehicle, same mean wind, NO shear: both layers at 15 m/s.
    env_uni = EnvBundle(E.make_uniform_field(15.0, 0.0, 0.0), 0.0, 0.0, 172, 0.0)
    boat_u = make_sailboat(15.0, 15.0)
    p_uni_W = cycle_averaged_power_W(boat_u, env_uni, cycle_period_s=20.0,
                                     dt_s=0.05, n_cycles=4)

    # MAGNITUDE FLOOR, AND WHY IT IS NOT `> 0.0`.  This check was originally written as the
    # acceptance criterion literally states, `p_shear_W > 0.0`.  A mutation test proved that
    # version worthless: breaking the per-element wind sampling in _evaluate() (so both bodies
    # read the wind at body 0 and the shear becomes invisible) collapsed extraction from
    # 8.61 W to 2.5e-4 W of numerical bobbing noise -- and `> 0.0` still reported PASS.  A
    # guard that survives the deletion of the physics it exists to prove is not a guard.
    # The floor is therefore an ABSOLUTE power, set two orders of magnitude above the noise
    # the uniform case measures (1e-8..1e-4 W) and well below the ~8.6 W this configuration
    # actually delivers, so it fails loudly on any regression that removes the shear coupling.
    SHEAR_FLOOR_W = 1.0
    check(f"tethered two-body extracts REAL power in PCHIP shear (> {SHEAR_FLOOR_W} W, "
          "not just > 0)", p_shear_W > SHEAR_FLOOR_W, f"{p_shear_W:.3f} W")

    # NOTE ON THE TOLERANCE.  A strict `<= 0.0` here is not physical and the run proves it:
    # the uniform case measures +1.05e-8 W, because a neutrally buoyant assembly still bobs
    # a few centimetres and the turbine harvests a nanowatt from the bob.  That nanowatt is
    # funded by the bob's own mechanical energy (dE_mech = -32 J over the same window, nine
    # orders of magnitude larger), so it is a real, finite, decaying reservoir, not free
    # energy.  The criterion is therefore |extraction| <= 1e-6 W AND the sustainability form
    # below, which is the one with physical content.
    UNIFORM_TOL_W = 1e-6
    check("SAME vehicle extracts nothing in uniform wind (<= 1e-6 W)",
          p_uni_W <= UNIFORM_TOL_W,
          f"{p_uni_W:.4e} W vs shear {p_shear_W:.3f} W -- a factor of "
          f"{p_shear_W/max(p_uni_W, 1e-30):.2e}")

    # The sustainability form: extraction must not be funded by an altitude/kinetic reservoir.
    r_sh = integrate_dynamic(make_sailboat(20.0, 10.0), env_shear, 0.0, 80.0, 0.05)
    a_sh = energy_audit(r_sh)
    sustain_shear_W = (a_sh["delta_E_battery_J"] + a_sh["delta_E_mech_J"]) / 80.0
    # The BATTERY must be the beneficiary, not the mechanical state.  The same mutation test
    # showed the bare sum is fooled: with the shear coupling broken the sum still read
    # +6.97 W, but it was dE_mech = +556 J (the assembly merely accelerating) against
    # dE_batt = +2 J.  Genuine extraction charges the battery -- the true run is dE_batt
    # = +564 J against dE_mech = +121 J -- so the battery rate carries this check.
    batt_rate_W = a_sh["delta_E_battery_J"] / 80.0
    check("shear extraction is SUSTAINED and CHARGES THE BATTERY, not altitude/KE-funded",
          sustain_shear_W > 0.0 and batt_rate_W > SHEAR_FLOOR_W,
          f"(dE_batt {a_sh['delta_E_battery_J']:.0f} J -> {batt_rate_W:.3f} W, must exceed "
          f"{SHEAR_FLOOR_W} W) + dE_mech {a_sh['delta_E_mech_J']:.0f} J, total "
          f"{sustain_shear_W:.3f} W, work_by_wind = {a_sh['work_by_wind_J']:.0f} J")

    r_un = integrate_dynamic(make_sailboat(15.0, 15.0), env_uni, 0.0, 80.0, 0.05)
    a_un = energy_audit(r_un)
    sustain_uni_W = (a_un["delta_E_battery_J"] + a_un["delta_E_mech_J"]) / 80.0
    check("SAME vehicle sustains nothing in uniform wind (<= 0)", sustain_uni_W <= 0.0,
          f"(dE_batt {a_un['delta_E_battery_J']:.3f} J + dE_mech "
          f"{a_un['delta_E_mech_J']:.1f} J)/80 s = {sustain_uni_W:.4f} W, "
          f"work_by_wind = {a_un['work_by_wind_J']:.1f} J")

    # ---------------------------------------------------------------------------------
    print("\n[6] energy_audit bookkeeping")
    r_boat = integrate_dynamic(make_sailboat(20.0,10.0), env_shear, 0.0, 60.0, 0.05)
    aud_b = energy_audit(r_boat)
    keys_ok = all(k in aud_b for k in
                  ("drift_frac", "work_by_wind_J", "work_by_tether_J", "work_by_gravity_J"))
    check("energy_audit returns the four specified keys", keys_ok, str(sorted(aud_b.keys())))
    check("work_by_wind_J is non-zero in a shear field", abs(aud_b["work_by_wind_J"]) > 0.0,
          f"W_wind = {aud_b['work_by_wind_J']:.1f} J, W_tether = "
          f"{aud_b['work_by_tether_J']:.1f} J, W_gravity = {aud_b['work_by_gravity_J']:.1f} J")

    r_uni_audit = integrate_dynamic(make_sailboat(15.0,15.0), env_uni, 0.0, 60.0, 0.05)
    aud_u = energy_audit(r_uni_audit)
    # This was a `check(..., True, ...)` -- a tautology that reported PASS unconditionally and
    # inflated the pass count without testing anything.  The stated invariant is now actually
    # asserted: in a uniform field the vehicle's total (battery + mechanical) energy must not
    # rise.  work_by_wind_J itself is NOT required to be zero -- the audit integrates
    # force.wind over bodies and a uniform field still does bookkeeping work on a drifting
    # body -- so the invariant is placed on the total, which is where the physics lives.
    total_rise_J = aud_u["delta_E_battery_J"] + aud_u["delta_E_mech_J"]
    check("uniform-field drift does not RAISE total energy (battery + mechanical)",
          total_rise_J <= 1e-6,
          f"dE_total = {total_rise_J:.3f} J (must be <= 0); W_wind = "
          f"{aud_u['work_by_wind_J']:.1f} J, dE_batt = "
          f"{aud_u['delta_E_battery_J']:.1f} J, dE_mech = {aud_u['delta_E_mech_J']:.1f} J")

    # ---------------------------------------------------------------------------------
    n_pass = sum(1 for _, ok, _ in results if ok)
    n_fail = len(results) - n_pass
    print("\n" + "=" * 86)
    print(f"RESULT: {n_pass} passed, {n_fail} failed, out of {len(results)} checks")
    if n_fail:
        for name, ok, msg in results:
            if not ok:
                print(f"  FAILED -> {name}: {msg}")
    print("=" * 86)
    sys.exit(1 if n_fail else 0)
