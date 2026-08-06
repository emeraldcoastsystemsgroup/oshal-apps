"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | BEMTThruster force element:
  |                                           | UIUC-anchored Glauert BEMT ->
  |                                           | Drela Kv/R/I0 motor -> PWM ESC ->
  |                                           | load-side harness I2R. It implements
  |                                           | the existing Thruster command/evaluate
  |                                           | contract while keeping every real loss
  |                                           | under one owner and reasserting the
  |                                           | actuator-disk power floor.
2 | maintainer@emeraldcoastsystemsgroup.com   | Enforce the battery-direct ESC boundary:
  |                                           | the rpm ceiling now respects both the
  |                                           | catalogued motor power rating and terminal
  |                                           | voltage available from the DC bus. The ESC
  |                                           | is PWM/buck hardware, never an implicit
  |                                           | lossless voltage booster.
3 | maintainer@emeraldcoastsystemsgroup.com   | Route n_rotors through the finite range guard
  |                                           | before checking integer-ness, so +/-inf and
  |                                           | NaN fail as ParamBoundsError instead of leaking
  |                                           | Python's int-conversion OverflowError.

The actuator-disk Thruster remains the explicit ideal model. This module owns
the real propulsion path described by SPEC_electrical section 6.3. Harness
resistance crosses into this module as a required scalar so importing the
propulsion package never creates an electrical/vehicle package cycle.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import numpy as np

from ..powerplant import FreeEnergyError, NoConvergenceError
from ..prop.bemt import PropGeometry, PropPoint, TIP_MACH_LIMIT, solve_prop_point
from ..prop.motor import (
    EscParams,
    MotorOp,
    MotorParams,
    VENDOR_ANCHORS,
    esc_input_power_W,
    esc_rated_efficiency,
    motor_inverse,
    validate_motor,
)
from .mass import ESC_SPECIFIC_POWER_W_PER_KG, propeller_mass_kg
from .param_bounds import Bounds, ParamBoundsError, validate_declared
from .state import (
    BodyState,
    ElementForce,
    as_offset,
    moment_from_offset,
    relative_airspeed_vector,
    safe_unit,
    wind_axes,
)

if TYPE_CHECKING:  # pragma: no cover
    from ..env import AtmoSample, SolarSample, WindSample

__all__ = ["BEMTThruster"]

_TIP_MACH_MARGIN: float = 0.98
_RPM_FLOOR: float = 50.0
_RPM_TOL_REL: float = 1.0e-6
_POINT_CACHE_MAX: int = 4096


def _geometry_fingerprint(geom: PropGeometry) -> tuple:
    """
    @description Immutable content key for an otherwise mutable PropGeometry.
                 Point caching must follow blade content, never merely its name, or a
                 post-construction geometry mutation could receive a stale certified point.
    @param geom Propeller geometry. @returns Hashable content tuple.
    """
    return (
        str(geom.name),
        float(geom.diameter_m),
        int(geom.n_blades),
        float(geom.r_hub_m),
        str(geom.section),
        tuple(float(v) for v in np.asarray(geom.r_over_R).reshape(-1)),
        tuple(float(v) for v in np.asarray(geom.c_over_R).reshape(-1)),
        tuple(float(v) for v in np.asarray(geom.beta_deg).reshape(-1)),
    )


class BEMTThruster:
    """
    @description Real propulsor element. Required thrust is inverted to a
        converged BEMT shaft speed, then the associated torque flows through
        the catalogued motor, ESC and harness to one bus-power result.
    """

    DECLARES_MASS_CLOSURE: bool = True

    PARAM_BOUNDS: dict[str, Bounds] = {
        "diameter_m": Bounds(
            0.0, 10.0, lo_open=True, unit="m",
            why="the blade geometry owns the physical disk; zero has no momentum price",
        ),
        "max_electrical_power_W": Bounds(
            0.0, 1.0e6, lo_open=True, unit="W",
            why="derived from catalogued continuous motor ratings and billed per rotor",
        ),
        "v_bus_V": Bounds(
            7.2, 50.8, unit="V",
            why="SPEC_electrical 3.1 battery-direct 2S..12S hardware band",
        ),
        "r_harness_ohm": Bounds(
            0.0, 1.0, lo_open=True, unit="Ohm",
            why="a zero-ohm load harness is free copper; builder derives this from AWG runs",
        ),
        "n_rotors": Bounds(
            1.0, 64.0, unit="-",
            why="each rotor, motor, ESC and propeller is billed; 64 caps configuration errors",
        ),
        "n_crit": Bounds(
            4.0, 14.0, unit="-",
            why="aeropolar convention: 9 tunnel, 11 clean free flight",
        ),
    }

    def __init__(
        self,
        geom: PropGeometry,
        motor: MotorParams,
        esc: EscParams = EscParams(),
        *,
        v_bus_V: float = 21.6,
        r_harness_ohm: float,
        n_rotors: int = 1,
        body_index: int = 0,
        offset_m: np.ndarray | None = None,
        axis: np.ndarray | None = None,
        n_crit: float = 11.0,
        strict_certification: bool = False,
    ) -> None:
        """
        @description Construct the real propulsion element.
        @param geom One propeller's validated blade geometry.
        @param motor Catalogued Drela motor parameters.
        @param esc ESC conduction/fixed-loss parameters.
        @param v_bus_V Pack-direct bus voltage, V.
        @param r_harness_ohm Required round-trip load-harness resistance, Ohm.
        @param n_rotors Identical rotor/motor/ESC units sharing total thrust.
        @param body_index Carrying body. @param offset_m Force application offset, m.
        @param axis Thrust direction in the flight-path body frame.
        @param n_crit Aerodynamic transition parameter.
        @param strict_certification Raise when the converged prop point consumes too much
            uncertified sectional polar data; default records the verdict so trim probes
            can explore while the integrated result remains certification-tainted.
        """
        if not isinstance(geom, PropGeometry):
            raise ParamBoundsError(
                f"BEMTThruster.geom must be a PropGeometry, got {type(geom).__name__}"
            )
        motor = validate_motor(motor)
        max_power_W = float(n_rotors) * float(motor.rating_W)
        checked = validate_declared(
            type(self),
            diameter_m=geom.diameter_m,
            max_electrical_power_W=max_power_W,
            v_bus_V=v_bus_V,
            r_harness_ohm=r_harness_ohm,
            n_rotors=n_rotors,
            n_crit=n_crit,
        )
        if int(checked["n_rotors"]) != checked["n_rotors"]:
            raise ParamBoundsError(
                f"BEMTThruster.n_rotors must be a whole count, got {n_rotors!r}"
            )
        self.geom = geom
        self.motor = motor
        self.esc = esc.validated()
        self.diameter_m = checked["diameter_m"]
        self.max_electrical_power_W = checked["max_electrical_power_W"]
        self.v_bus_V = checked["v_bus_V"]
        self.r_harness_ohm = checked["r_harness_ohm"]
        self.n_rotors = int(checked["n_rotors"])
        self.n_crit = checked["n_crit"]
        self.body_index = int(body_index)
        self.axis = safe_unit(
            np.array([1.0, 0.0, 0.0]) if axis is None
            else np.asarray(axis, dtype=float)
        )
        self.offset_m = as_offset(offset_m)
        self.strict_certification = bool(strict_certification)

        self.per_rotor_disk_area_m2 = self.geom.disk_area_m2
        self.disk_area_m2 = self.n_rotors * self.per_rotor_disk_area_m2
        self.esc_mass_kg = self.motor.rating_W / ESC_SPECIFIC_POWER_W_PER_KG
        self.mass_kg = self.n_rotors * (
            self.motor.mass_kg
            + self.esc_mass_kg
            + propeller_mass_kg(self.geom.diameter_m, 1)
        )

        self._commanded_thrust_N: float | None = 0.0
        self._commanded_throttle: float | None = None
        self._last_rpm: float | None = None
        self._point_cache: dict[tuple, PropPoint] = {}
        self._refused_points: set[tuple] = set()

        self.last_chain: dict[str, float] = {}
        self.last_point_valid: bool = True
        self.last_point_reason: str = "ok"
        self.n_uncertified_points: int = 0
        self.n_unsolvable_bracket_probes: int = 0
        self.validate_cross_params()

    def validate_cross_params(self) -> None:
        """
        @description Re-derive rating, mass and disk area from live component data. This is
            the post-construction mutation wall used by param_bounds.recheck_element_params.
        @returns None. @raises ParamBoundsError On stale billing or an invalid ESC pairing.
        """
        derived_power_W = self.n_rotors * self.motor.rating_W
        if not math.isclose(
            self.max_electrical_power_W, derived_power_W, rel_tol=1.0e-6, abs_tol=1.0e-9
        ):
            raise ParamBoundsError(
                f"BEMTThruster rating {self.max_electrical_power_W:g} W is stale; "
                f"{self.n_rotors} x {self.motor.rating_W:g} W derives {derived_power_W:g} W"
            )
        derived_area_m2 = self.n_rotors * self.geom.disk_area_m2
        if not math.isclose(
            self.disk_area_m2, derived_area_m2, rel_tol=1.0e-6, abs_tol=1.0e-12
        ):
            raise ParamBoundsError(
                f"BEMTThruster disk area {self.disk_area_m2:g} m2 is stale; "
                f"the live geometry derives {derived_area_m2:g} m2"
            )
        derived_mass_kg = self.n_rotors * (
            self.motor.mass_kg
            + self.motor.rating_W / ESC_SPECIFIC_POWER_W_PER_KG
            + propeller_mass_kg(self.geom.diameter_m, 1)
        )
        if not math.isclose(
            self.mass_kg, derived_mass_kg, rel_tol=1.0e-6, abs_tol=1.0e-12
        ):
            raise ParamBoundsError(
                f"BEMTThruster billed mass {self.mass_kg:g} kg is stale; "
                f"the live motor/ESC/propeller set derives {derived_mass_kg:g} kg"
            )
        anchor = VENDOR_ANCHORS.get(self.motor.name)
        if anchor is not None:
            esc_rated_efficiency(self.esc, self.motor.rating_W, anchor["i_rated_A"])

    def mass_detail(self) -> str:
        """@description Human-readable installed drive mass derivation. @returns Text."""
        return (
            f"{self.n_rotors} x ({self.motor.name} {self.motor.mass_kg:.4f} + "
            f"ESC {self.esc_mass_kg:.4f} + {self.geom.diameter_m:.3f} m prop "
            f"{propeller_mass_kg(self.geom.diameter_m, 1):.4f}) kg"
        )

    def set_thrust_N(self, thrust_N: float) -> None:
        """@description Command total thrust, N; negative commands clamp to zero."""
        self._commanded_thrust_N = max(0.0, float(thrust_N))
        self._commanded_throttle = None

    def set_throttle(self, throttle: float) -> None:
        """@description Command a fraction of each motor's continuous rating."""
        self._commanded_throttle = float(np.clip(throttle, 0.0, 1.0))
        self._commanded_thrust_N = None

    def _rpm_tip_ceiling(self, v_ms: float, t_K: float) -> float:
        """@description Tip-Mach-limited shaft-speed ceiling, rpm."""
        a_sound_ms = math.sqrt(1.4 * 287.05287 * float(t_K))
        v_tip_max_ms = _TIP_MACH_MARGIN * TIP_MACH_LIMIT * a_sound_ms
        if v_tip_max_ms <= abs(float(v_ms)):
            raise ParamBoundsError(
                f"BEMTThruster({self.geom.name}) airspeed {v_ms:g} m/s exceeds "
                "the tip-Mach operating margin before the propeller turns"
            )
        omega_max = math.sqrt(v_tip_max_ms**2 - float(v_ms) ** 2) / self.geom.radius_m
        return min(30000.0 * (1.0 - 1.0e-9), omega_max * 60.0 / (2.0 * math.pi))

    def _point_key(
        self, rpm: float, v_ms: float, rho_kgm3: float, t_K: float
    ) -> tuple:
        """@description Full physical cache key for one BEMT point."""
        return (
            _geometry_fingerprint(self.geom),
            float(rpm), float(v_ms), float(rho_kgm3), float(t_K), float(self.n_crit),
        )

    def _point(self, rpm: float, v_ms: float, rho_kgm3: float, t_K: float) -> PropPoint:
        """@description Solve or retrieve one content-keyed per-rotor BEMT point."""
        key = self._point_key(rpm, v_ms, rho_kgm3, t_K)
        cached = self._point_cache.get(key)
        if cached is not None:
            return cached
        point = solve_prop_point(
            self.geom, v_ms, rpm, rho_kgm3, t_K, n_crit=self.n_crit
        )
        if len(self._point_cache) >= _POINT_CACHE_MAX:
            self._point_cache.pop(next(iter(self._point_cache)))
        self._point_cache[key] = point
        return point

    def _point_or_none(
        self, rpm: float, v_ms: float, rho_kgm3: float, t_K: float
    ) -> PropPoint | None:
        """@description Bracket probe; solver refusals shrink the search and are recorded."""
        key = self._point_key(rpm, v_ms, rho_kgm3, t_K)
        if key in self._refused_points:
            return None
        try:
            return self._point(rpm, v_ms, rho_kgm3, t_K)
        except (NoConvergenceError, ParamBoundsError):
            self.n_unsolvable_bracket_probes += 1
            if len(self._refused_points) < _POINT_CACHE_MAX:
                self._refused_points.add(key)
            return None

    def _motor_op(self, point: PropPoint, rpm: float) -> MotorOp:
        """@description Drela inverse for one converged per-rotor prop point."""
        omega_rad_s = float(rpm) * 2.0 * math.pi / 60.0
        return motor_inverse(self.motor, max(point.torque_Nm, 0.0), omega_rad_s)

    def _rpm_at_motor_power(
        self, v_ms: float, rho_kgm3: float, t_K: float, p_target_W: float
    ) -> float:
        """@description Highest rpm inside motor-power and direct-bus limits."""
        if p_target_W <= 0.0:
            return _RPM_FLOOR
        lo = _RPM_FLOOR
        hi = self._rpm_tip_ceiling(v_ms, t_K)
        high_point = self._point_or_none(hi, v_ms, rho_kgm3, t_K)
        if high_point is not None:
            high_op = self._motor_op(high_point, hi)
            if (
                high_op.p_elec_W <= p_target_W
                and high_op.v_V <= self.v_bus_V
            ):
                return hi
        for _ in range(80):
            mid = 0.5 * (lo + hi)
            point = self._point_or_none(mid, v_ms, rho_kgm3, t_K)
            motor_op = self._motor_op(point, mid) if point is not None else None
            if (
                motor_op is None
                or motor_op.p_elec_W > p_target_W
                or motor_op.v_V > self.v_bus_V
            ):
                hi = mid
            else:
                lo = mid
            if hi - lo <= _RPM_TOL_REL * max(hi, 1.0):
                break
        # `lo` advanced only through solvable points.
        return lo

    def _rpm_for_thrust(
        self,
        thrust_per_rotor_N: float,
        v_ms: float,
        rho_kgm3: float,
        t_K: float,
        rpm_max: float,
    ) -> float:
        """@description Bisection in rpm for the commanded per-rotor thrust."""
        point_max = self._point(rpm_max, v_ms, rho_kgm3, t_K)
        if point_max.thrust_N <= thrust_per_rotor_N:
            return rpm_max
        lo, hi = _RPM_FLOOR, rpm_max
        warm = self._last_rpm
        if warm is not None and lo < warm < hi:
            warm_lo, warm_hi = max(lo, 0.8 * warm), min(hi, 1.25 * warm)
            point_lo = self._point_or_none(warm_lo, v_ms, rho_kgm3, t_K)
            point_hi = self._point_or_none(warm_hi, v_ms, rho_kgm3, t_K)
            if (
                point_lo is not None and point_hi is not None
                and point_lo.thrust_N < thrust_per_rotor_N <= point_hi.thrust_N
            ):
                lo, hi = warm_lo, warm_hi
        for _ in range(80):
            mid = 0.5 * (lo + hi)
            point = self._point_or_none(mid, v_ms, rho_kgm3, t_K)
            if point is None:
                hi = mid
            elif point.thrust_N < thrust_per_rotor_N:
                lo = mid
            else:
                hi = mid
            if hi - lo <= _RPM_TOL_REL * max(hi, 1.0):
                break
        return hi

    def point_validity(
        self, v_ms: float, rpm: float, rho_kgm3: float, t_K: float = 288.15
    ) -> tuple[bool, str]:
        """@description Certification verdict for a converged operating point."""
        try:
            point = self._point(rpm, v_ms, rho_kgm3, t_K)
        except (NoConvergenceError, ParamBoundsError) as exc:
            return False, f"{type(exc).__name__}: {exc}"
        if not point.valid:
            return False, (
                f"invalid sectional-polar thrust fraction "
                f"{point.invalid_thrust_frac:.4f} exceeds the certified limit"
            )
        return True, "ok"

    def max_thrust_N(
        self, airspeed_ms: float, rho_kgm3: float, t_K: float = 288.15
    ) -> float:
        """@description Maximum total thrust at the motor/tip-Mach ceiling."""
        rpm = self._rpm_at_motor_power(
            airspeed_ms, rho_kgm3, t_K, self.motor.rating_W
        )
        return max(0.0, self._point(rpm, airspeed_ms, rho_kgm3, t_K).thrust_N) \
            * self.n_rotors

    def _chain(
        self, point: PropPoint, rpm: float, v_ms: float, rho_kgm3: float
    ) -> float:
        """@description Bill motor, ESC and harness after reasserting momentum floors."""
        thrust_N = float(point.thrust_N)
        p_shaft_W = float(point.p_shaft_W)
        if thrust_N > 0.0:
            v = abs(float(v_ms))
            induced_ms = 0.5 * (
                -v + math.sqrt(
                    v * v + 2.0 * thrust_N
                    / (float(rho_kgm3) * self.per_rotor_disk_area_m2)
                )
            )
            p_ideal_W = thrust_N * (v + induced_ms)
            if p_shaft_W < p_ideal_W * (1.0 - 1.0e-9):
                raise FreeEnergyError(
                    f"BEMTThruster({self.geom.name}) shaft power {p_shaft_W:.4f} W "
                    f"beats actuator-disk floor {p_ideal_W:.4f} W"
                )
            if v == 0.0 and p_shaft_W > 0.0 and p_ideal_W / p_shaft_W > 0.9:
                raise FreeEnergyError(
                    f"BEMTThruster({self.geom.name}) implied static FM "
                    f"{p_ideal_W / p_shaft_W:.4f} exceeds 0.9"
                )
            if v > 0.0 and p_shaft_W > 0.0 and thrust_N * v / p_shaft_W >= 1.0:
                raise FreeEnergyError(
                    f"BEMTThruster({self.geom.name}) propulsive efficiency >= 1"
                )
        motor_op = self._motor_op(point, rpm)
        if motor_op.v_V > self.v_bus_V * (1.0 + 1.0e-9):
            raise ParamBoundsError(
                f"BEMTThruster({self.geom.name}) motor needs "
                f"{motor_op.v_V:.4f} V at {rpm:.1f} rpm but the battery-direct "
                f"bus supplies {self.v_bus_V:.4f} V; the PWM ESC cannot boost"
            )
        p_esc_each_W = esc_input_power_W(
            self.esc, motor_op.p_elec_W, motor_op.i_A
        )
        p_esc_total_W = p_esc_each_W * self.n_rotors
        i_bus_A = p_esc_total_W / self.v_bus_V
        p_harness_W = i_bus_A * i_bus_A * self.r_harness_ohm
        p_bus_W = p_esc_total_W + p_harness_W
        p_shaft_total_W = p_shaft_W * self.n_rotors
        if p_bus_W < p_shaft_total_W * (1.0 - 1.0e-9):
            raise FreeEnergyError(
                f"BEMTThruster({self.geom.name}) bus draw {p_bus_W:.4f} W is "
                f"below shaft power {p_shaft_total_W:.4f} W"
            )
        advance_ratio = (
            abs(float(v_ms)) / ((float(rpm) / 60.0) * self.geom.diameter_m)
            if rpm > 0.0 else math.inf
        )
        self.last_chain = {
            "p_shaft_W": p_shaft_total_W,
            "p_motor_elec_W": motor_op.p_elec_W * self.n_rotors,
            "p_esc_in_W": p_esc_total_W,
            "p_harness_W": p_harness_W,
            "p_bus_W": p_bus_W,
            "rpm": float(rpm),
            "motor_terminal_V": float(motor_op.v_V),
            "motor_current_A": float(motor_op.i_A),
            "eta_prop": float(point.eta),
            "eta_motor": float(motor_op.eta),
            "point_valid": float(bool(point.valid)),
            "advance_ratio": advance_ratio,
            "invalid_thrust_frac": float(point.invalid_thrust_frac),
        }
        return p_bus_W

    def thrust_axis_world(self, body: BodyState, wind: "WindSample") -> np.ndarray:
        """@description Map body-frame thrust axis into the ENU flight-path frame."""
        v_rel_ms = relative_airspeed_vector(body, wind)
        drag_axis, side_axis, lift_axis = wind_axes(v_rel_ms)
        forward_axis = -drag_axis
        return safe_unit(
            self.axis[0] * forward_axis
            + self.axis[1] * side_axis
            + self.axis[2] * lift_axis,
            fallback=forward_axis,
        )

    def evaluate(
        self,
        bodies: list[BodyState],
        atmo: "AtmoSample",
        wind: "WindSample",
        sol: "SolarSample",
        t_s: float,
        dt_s: float,
    ) -> ElementForce:
        """
        @description Return thrust and the full real-chain bus draw. The element is always
            an electrical sink; an uncertified converged point is recorded (and optionally
            raised) so numerical trim probes do not silently become certified flight.
        @returns ElementForce with power_elec_W <= 0.
        """
        del sol, t_s, dt_s
        self.last_point_valid = True
        self.last_point_reason = "ok"
        body = bodies[self.body_index]
        rho_kgm3 = float(atmo.rho_kgm3)
        t_K = float(atmo.T_K)
        airspeed_ms = float(np.linalg.norm(relative_airspeed_vector(body, wind)))

        if self._commanded_throttle is not None:
            if self._commanded_throttle <= 0.0:
                self.last_chain = {}
                return ElementForce(np.zeros(3), np.zeros(3), 0.0)
            rpm = self._rpm_at_motor_power(
                airspeed_ms,
                rho_kgm3,
                t_K,
                self._commanded_throttle * self.motor.rating_W,
            )
        else:
            thrust_command_N = float(self._commanded_thrust_N or 0.0)
            if thrust_command_N <= 0.0:
                self.last_chain = {}
                return ElementForce(np.zeros(3), np.zeros(3), 0.0)
            rpm_max = self._rpm_at_motor_power(
                airspeed_ms, rho_kgm3, t_K, self.motor.rating_W
            )
            rpm = self._rpm_for_thrust(
                thrust_command_N / self.n_rotors,
                airspeed_ms,
                rho_kgm3,
                t_K,
                rpm_max,
            )

        point = self._point(rpm, airspeed_ms, rho_kgm3, t_K)
        self.last_point_valid = bool(point.valid)
        if not point.valid:
            self.last_point_reason = (
                f"invalid sectional-polar thrust fraction "
                f"{point.invalid_thrust_frac:.4f}"
            )
            self.n_uncertified_points += 1
            if self.strict_certification:
                raise NoConvergenceError(
                    f"BEMTThruster({self.geom.name}) converged outside its "
                    f"certified sectional-polar support: {self.last_point_reason}"
                )
        self._last_rpm = rpm
        thrust_total_N = max(0.0, float(point.thrust_N)) * self.n_rotors
        if thrust_total_N <= 0.0:
            self.last_chain = {}
            return ElementForce(np.zeros(3), np.zeros(3), 0.0)
        p_bus_W = self._chain(point, rpm, airspeed_ms, rho_kgm3)
        force_N = thrust_total_N * self.thrust_axis_world(body, wind)
        return ElementForce(
            force_N=force_N,
            moment_Nm=moment_from_offset(self.offset_m, force_N),
            power_elec_W=-p_bus_W,
        )
