"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Thruster: actuator-disk propulsor continuous from hover to cruise, exactly reproducing powerplant.hover_power_W at zero airspeed.
2 | maintainer@emeraldcoastsystemsgroup.com   | MASS CLOSURE: the drive now weighs something. mass_kg is derived from max_electrical_power_W (motors + ESCs) and from rotor diameter (propellers), so the two things a sweep pushes up -- installed power and disk area -- both cost weight. Explicit mass_kg override retained for a known part.
3 | maintainer@emeraldcoastsystemsgroup.com   | PARAM BOUNDS (round-3 class fix): figure_of_merit / eta_motor / eta_esc were stored with bare float() and DIVIDED BY -- Thruster(FM=5.0, eta_motor=2.0, eta_esc=3.0) constructed and returned 1.45 W for a hover whose actuator-disk floor is 43.57 W, a 30x free multiplier. Every numeric constructor parameter now validates against the declared PARAM_BOUNDS table (vehicle/param_bounds.py). FM is held to [0.3, 0.9]: Leishman, "Principles of Helicopter Aerodynamics" -- well-designed full-scale rotors reach FM ~0.7-0.82, small UAV rotors 0.4-0.65, and no rotor demonstrates 0.9. The gravimetric divisors (motor/ESC specific power) are banded, and an EXPLICIT mass_kg may not be lighter than the best demonstrated hardware could build the same drive.
4 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4 derived-mass consistency: the gravimetric divisors are now STORED on the instance and validate_cross_params RE-DERIVES the billed drive+rotor mass from the live rating/disk/divisors (1e-6 relative), so mutating max_electrical_power_W (or a divisor) on a live instance without re-billing is caught at spec-extraction recheck -- the same bypass shape as the battery capacity_J x3 exploit R4_probe_bypass measured.

WHY A THRUSTER NEEDS A MASS AND WHY IT IS DERIVED, NOT DEFAULTED TO ZERO
------------------------------------------------------------------------
Momentum theory rewards disk area: hover power goes as T^1.5/sqrt(2 rho A), so a
sweep that can grow the rotor for free will grow it without limit, and a sweep
that can raise max_electrical_power_W for free gets unlimited thrust authority
for nothing. Both are now billed, from sourced gravimetric constants in mass.py:

    m_drive = P_max/3000 W/kg (motors) + P_max/12000 W/kg (ESCs)
    m_rotor = 0.15 kg/m^2 * D^2 per rotor

Unlike the battery pack and the PV array, this one is DERIVED rather than
required-from-the-caller: the arguments it derives from (power limit, diameter,
rotor count) are already in the constructor, so there is no way to specify a
thruster without also specifying its mass. A required argument would add a
keyword without adding any information.

WHY ONE FORMULA INSTEAD OF A HOVER BRANCH AND A CRUISE BRANCH
-------------------------------------------------------------
Axial-flight momentum theory gives the induced velocity v_i from

    T = 2 rho A (V + v_i) v_i     =>     v_i = [-V + sqrt(V^2 + 2T/(rho A))] / 2

and the ideal induced power is P_ideal = T (V + v_i). This ONE expression covers
both regimes: at V = 0 it collapses to

    v_i = sqrt(T / (2 rho A))     and     P_ideal = T^1.5 / sqrt(2 rho A)

which is bit-for-bit the ideal term inside powerplant.hover_power_W, and at high
V it tends to T*V. A hover branch spliced onto a cruise branch would put a
derivative discontinuity right where negative control C operates; there is none
here.

CONSISTENCY WITH powerplant.propeller_efficiency IS ALGEBRAIC, NOT COINCIDENTAL.
That function's induced term is eta = 2/(1 + sqrt(1 + T/(0.5 rho A V^2))).
Substituting v_i above, V/(V + v_i) = 2/(1 + sqrt(1 + 2T/(rho A V^2))), which is
the same expression. The two modules therefore agree by construction rather than
by tuning, and `shaft_power_via_powerplant_W()` is provided to demonstrate it
numerically in the self-test.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from .mass import (
    MOTOR_SPECIFIC_POWER_W_PER_KG,
    ESC_SPECIFIC_POWER_W_PER_KG,
    MAX_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG,
    MIN_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG,
    MAX_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG,
    MIN_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG,
    motor_drive_mass_kg,
    propeller_mass_kg,
)
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


class Thruster:
    """
    @description An electrically driven propulsor: propeller, rotor or ducted
        fan, modelled as an actuator disk. Command is applied through
        `set_thrust_N` (what the integrator's quasi-steady trim needs) or
        `set_throttle` (what an open-loop schedule needs); see OBJECTION 3 in
        state.py for why the command is not a constructor argument.

        It has mass: motors and ESCs sized by the power limit, propellers sized
        by the disk. See the header block for why that is derived rather than
        required.
    """

    #: Joins the vehicle mass budget (see vehicle/mass.py).
    DECLARES_MASS_CLOSURE: bool = True

    #: Declared credible range for every numeric constructor parameter -- the
    #: table drives the constructor checks AND the integrator's spec-extraction
    #: re-check (param_bounds.recheck_element_params), so the documented range
    #: and the enforced range cannot drift apart.
    PARAM_BOUNDS: dict[str, Bounds] = {
        "diameter_m": Bounds(0.0, 10.0, lo_open=True, unit="m",
                             why="one rotor; the largest HAPS props are ~2 m, "
                                 "10 m is already a helicopter"),
        "max_electrical_power_W": Bounds(0.0, 1.0e6, unit="W",
                                         why="billed via motor_drive_mass_kg; "
                                             "bounded so inf/nan cannot ride "
                                             "the billed path"),
        "n_rotors": Bounds(1.0, 64.0, unit="-",
                           why="billed per rotor; 64 caps combinatorial "
                               "nonsense, not physics"),
        # Real rotors: Leishman, "Principles of Helicopter Aerodynamics" --
        # a well-designed full-scale rotor reaches FM ~0.7-0.82 and small-UAV
        # rotors/propellers in static thrust measure 0.4-0.65. No rotor has
        # demonstrated FM 0.9; below 0.3 it is not a functioning propulsor.
        "figure_of_merit": Bounds(0.3, 0.9, unit="-",
                                  why="divided by: FM=5.0 bought hover at "
                                      "1/7.7 of the actuator-disk floor"),
        "eta_motor": Bounds(0.0, 1.0, lo_open=True, unit="-",
                            why="divided by: an efficiency above 1 is a free "
                                "energy multiplier"),
        "eta_esc": Bounds(0.0, 1.0, lo_open=True, unit="-",
                          why="divided by: an efficiency above 1 is a free "
                              "energy multiplier"),
        "mass_kg": Bounds(0.0, 1.0e4, lo_open=True, unit="kg",
                          why="explicit part mass; the credibility floor vs "
                              "the derived drive is cross-checked separately"),
        "motor_specific_power_W_per_kg": Bounds(
            MIN_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG,
            MAX_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG, unit="W/kg",
            why="mass DIVISOR: raising it buys a lighter drive with a typed "
                "number"),
        "esc_specific_power_W_per_kg": Bounds(
            MIN_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG,
            MAX_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG, unit="W/kg",
            why="mass DIVISOR: raising it buys a lighter drive with a typed "
                "number"),
    }

    def __init__(
        self,
        diameter_m: float,
        max_electrical_power_W: float,
        body_index: int = 0,
        axis: np.ndarray | None = None,
        *,
        n_rotors: int = 1,
        figure_of_merit: float = 0.65,
        eta_motor: float = 0.85,
        eta_esc: float = 0.95,
        offset_m: np.ndarray | None = None,
        mass_kg: float | None = None,
        motor_specific_power_W_per_kg: float = MOTOR_SPECIFIC_POWER_W_PER_KG,
        esc_specific_power_W_per_kg: float = ESC_SPECIFIC_POWER_W_PER_KG,
    ) -> None:
        """
        @description Construct a propulsor.
        @param diameter_m Disk diameter of ONE rotor, metres.
        @param max_electrical_power_W Electrical power limit at the bus, watts.
            Thrust commands that would exceed it are clamped by a real inversion
            of the power law, not by truncating the force.
        @param body_index Index of the body this thruster pushes.
        @param axis Thrust direction in the BODY frame, dimensionless, shape (3,).
            The 3-DOF body frame is built from the flight path each step:
            x = flight direction, y = right/side, z = lift direction. So
            [1,0,0] is a tractor propeller along the flight path (archetype 1)
            and [0,0,1] is a lifting rotor (negative control C). Defaults to
            [1,0,0].
        @param n_rotors Number of rotors sharing the thrust, dimensionless. Total
            disk area is n_rotors * pi * (diameter/2)^2, which is what momentum
            theory actually depends on -- four small rotors are far worse than
            one large one at equal total area only through profile losses, but
            far worse than one large one at equal DIAMETER, and this is where
            that shows up.
        @param figure_of_merit Rotor figure of merit, dimensionless, RANGE
            [0.3, 0.9] (real rotors: Leishman -- full-scale optimized rotors
            ~0.7-0.82, small UAV rotors 0.4-0.65). 0.65 is the small-propeller
            value used by powerplant.hover_power_W. Out of range RAISES.
        @param eta_motor Motor efficiency, dimensionless (0, 1]. Out of range
            RAISES -- it is divided by.
        @param eta_esc Electronic speed controller efficiency, dimensionless
            (0, 1]. Out of range RAISES -- it is divided by.
        @param offset_m Thrust application point relative to the body reference, m.
        @param mass_kg Installed propulsion mass, kg, when a specific part is
            known. Leave None (the normal path) and it is DERIVED from the power
            limit and the disk; passing 0.0 is rejected, because a weightless
            drive is the free lunch this parameter exists to close.
        @param motor_specific_power_W_per_kg Motor gravimetric power, W/kg.
        @param esc_specific_power_W_per_kg ESC gravimetric power, W/kg.
        """
        checked = validate_declared(
            type(self),
            diameter_m=diameter_m,
            max_electrical_power_W=max_electrical_power_W,
            n_rotors=n_rotors,
            figure_of_merit=figure_of_merit,
            eta_motor=eta_motor,
            eta_esc=eta_esc,
            motor_specific_power_W_per_kg=motor_specific_power_W_per_kg,
            esc_specific_power_W_per_kg=esc_specific_power_W_per_kg,
        )

        self.diameter_m = checked["diameter_m"]
        self.max_electrical_power_W = checked["max_electrical_power_W"]
        self.body_index = int(body_index)
        self.axis = safe_unit(
            np.array([1.0, 0.0, 0.0]) if axis is None else np.asarray(axis, dtype=float)
        )
        self.n_rotors = int(checked["n_rotors"])
        self.figure_of_merit = checked["figure_of_merit"]
        self.eta_motor = checked["eta_motor"]
        self.eta_esc = checked["eta_esc"]
        self.offset_m = as_offset(offset_m)

        #: Total actuator-disk area, m^2.
        self.disk_area_m2 = self.n_rotors * np.pi * (self.diameter_m / 2.0) ** 2

        #: Gravimetric divisors, W/kg, STORED so validate_cross_params can
        #: RE-DERIVE the billed drive mass on a live instance (round 4) and so
        #: recheck_element_params re-range-checks them after construction.
        self.motor_specific_power_W_per_kg = checked["motor_specific_power_W_per_kg"]
        self.esc_specific_power_W_per_kg = checked["esc_specific_power_W_per_kg"]

        #: Motor + ESC mass, kg, sized by the electrical power limit.
        self.drive_mass_kg = motor_drive_mass_kg(
            max_electrical_power_W=self.max_electrical_power_W,
            n_rotors=self.n_rotors,
            motor_specific_power_W_per_kg=self.motor_specific_power_W_per_kg,
            esc_specific_power_W_per_kg=self.esc_specific_power_W_per_kg,
        )
        #: Propeller / rotor mass, kg, sized by the disk.
        self.rotor_mass_kg = propeller_mass_kg(self.diameter_m, self.n_rotors)
        if mass_kg is None:
            #: Installed propulsion mass, kg (motors + ESCs + rotors).
            self.mass_kg = self.drive_mass_kg + self.rotor_mass_kg
            self._mass_is_derived = True
        else:
            self.mass_kg = validate_declared(type(self), mass_kg=mass_kg)["mass_kg"]
            self._mass_is_derived = False

        #: Commanded thrust, N. Set by set_thrust_N(); None means throttle mode.
        self._commanded_thrust_N: float | None = 0.0
        #: Commanded throttle, dimensionless 0..1. Set by set_throttle().
        self._commanded_throttle: float | None = None

        # Cross-parameter constraints (explicit-mass credibility floor).
        self.validate_cross_params()

    def min_credible_mass_kg(self) -> float:
        """
        @description The lightest a drive of this rating and disk could be if
            built from the BEST demonstrated hardware: motors at
            MAX_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG, ESCs at
            MAX_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG, and the propeller fit
            (which is already pinned at the light end of its data). An explicit
            mass_kg below this is a mass discount typed into the constructor.
        @returns Credibility floor for the installed propulsion mass, kg.
        """
        return motor_drive_mass_kg(
            max_electrical_power_W=self.max_electrical_power_W,
            n_rotors=self.n_rotors,
            motor_specific_power_W_per_kg=MAX_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG,
            esc_specific_power_W_per_kg=MAX_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG,
        ) + propeller_mass_kg(self.diameter_m, self.n_rotors)

    def validate_cross_params(self) -> None:
        """
        @description Constraints a single (lo, hi) bound cannot express,
            re-runnable on a live instance by
            param_bounds.recheck_element_params (defense in depth).

            ROUND 4 addition: when the mass is on the DERIVED path, it is
            RE-DERIVED here from the live instance's own rating, disk and
            gravimetric divisors and must match the billed mass_kg to 1e-6
            relative -- so raising max_electrical_power_W (or the divisors) on
            a live instance without re-billing is caught at recheck, the same
            bypass shape as the battery capacity_J x3 exploit.
        @returns None. Raises on violation.
        @raises ParamBoundsError When an explicit mass_kg undercuts the
            best-hardware credibility floor for this rating and disk, or a
            derived mass is inconsistent with the live parameters.
        """
        if self._mass_is_derived:
            derived_kg = motor_drive_mass_kg(
                max_electrical_power_W=self.max_electrical_power_W,
                n_rotors=self.n_rotors,
                motor_specific_power_W_per_kg=self.motor_specific_power_W_per_kg,
                esc_specific_power_W_per_kg=self.esc_specific_power_W_per_kg,
            ) + propeller_mass_kg(self.diameter_m, self.n_rotors)
            if abs(self.mass_kg - derived_kg) > 1.0e-6 * max(derived_kg, 1e-12):
                raise ParamBoundsError(
                    f"Thruster billed mass {self.mass_kg:g} kg is inconsistent "
                    f"with its own parameters: {self.max_electrical_power_W:g} W "
                    f"/ {self.n_rotors} x {self.diameter_m:g} m derives "
                    f"{derived_kg:.6f} kg. A rating or divisor changed after "
                    f"construction without re-billing the mass."
                )
        floor_kg = self.min_credible_mass_kg()
        if not self._mass_is_derived and self.mass_kg < floor_kg:
            raise ParamBoundsError(
                f"Thruster explicit mass_kg = {self.mass_kg:g} kg is below the "
                f"credibility floor of {floor_kg:.4f} kg for a "
                f"{self.max_electrical_power_W:g} W / {self.n_rotors} x "
                f"{self.diameter_m:g} m drive built from the best demonstrated "
                f"hardware ({MAX_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG:g} W/kg "
                f"motors, {MAX_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG:g} W/kg "
                f"ESCs). A lighter 'known part' is an unbilled mass discount; "
                f"pass None to derive the mass instead."
            )

    def mass_detail(self) -> str:
        """
        @description One-line derivation of the propulsion mass for the budget
            report.
        @returns e.g. "120 W drive 0.050 + 1 x 0.36 m rotor 0.019 kg".
        """
        if not self._mass_is_derived:
            return "explicit part mass"
        return (
            f"{self.max_electrical_power_W:.0f} W drive {self.drive_mass_kg:.4f} "
            f"+ {self.n_rotors} x {self.diameter_m:.3f} m rotor "
            f"{self.rotor_mass_kg:.4f}"
        )

    # -- command interface ---------------------------------------------------

    def set_thrust_N(self, thrust_N: float) -> None:
        """
        @description Command a thrust. The thruster will draw whatever electrical
            power that costs, clamped at max_electrical_power_W.
        @param thrust_N Commanded thrust, newtons, >= 0.
        """
        self._commanded_thrust_N = max(0.0, float(thrust_N))
        self._commanded_throttle = None

    def set_throttle(self, throttle: float) -> None:
        """
        @description Command a fraction of maximum electrical power. Thrust is
            solved from the power law.
        @param throttle Throttle setting, dimensionless 0..1.
        """
        self._commanded_throttle = float(np.clip(throttle, 0.0, 1.0))
        self._commanded_thrust_N = None

    # -- actuator-disk physics ----------------------------------------------

    def induced_velocity_ms(self, thrust_N: float, airspeed_ms: float, rho_kgm3: float) -> float:
        """
        @description Axial induced velocity at the disk, m/s, from momentum
            theory: v_i = [-V + sqrt(V^2 + 2T/(rho A))] / 2.
        @param thrust_N Thrust, N.
        @param airspeed_ms Axial airspeed through the disk, m/s.
        @param rho_kgm3 Air density, kg/m^3.
        @returns Induced velocity, m/s.
        """
        if thrust_N <= 0.0:
            return 0.0
        v = float(airspeed_ms)
        return 0.5 * (-v + np.sqrt(v ** 2 + 2.0 * thrust_N / (rho_kgm3 * self.disk_area_m2)))

    def electrical_power_W(self, thrust_N: float, airspeed_ms: float, rho_kgm3: float) -> float:
        """
        @description Electrical power needed to produce a thrust at an airspeed,
            watts (a POSITIVE magnitude; the ElementForce sign convention makes it
            negative when reported).

                P_ideal = T (V + v_i)
                P_shaft = P_ideal / FM
                P_elec  = P_shaft / (eta_motor * eta_esc)

            Verified against powerplant.hover_power_W(9.81, 1.225, 0.203, 0.65,
            0.85, 0.95): v_i = 4.4413 m/s, P_ideal = 43.57 W, P_shaft = 67.03 W,
            P_elec = 83.01 W -- identical, because it is the same algebra.

        @param thrust_N Thrust, N.
        @param airspeed_ms Airspeed, m/s.
        @param rho_kgm3 Air density, kg/m^3.
        @returns Electrical power draw, W, >= 0.
        """
        if thrust_N <= 0.0:
            return 0.0
        v_i = self.induced_velocity_ms(thrust_N, airspeed_ms, rho_kgm3)
        power_ideal_W = thrust_N * (abs(airspeed_ms) + v_i)
        power_shaft_W = power_ideal_W / self.figure_of_merit
        return power_shaft_W / (self.eta_motor * self.eta_esc)

    def shaft_power_via_powerplant_W(
        self, thrust_N: float, airspeed_ms: float, rho_kgm3: float, rpm: float
    ) -> float:
        """
        @description Cross-check path: shaft power computed through
            powerplant.propeller_efficiency instead of the internal actuator-disk
            expression. Used by the self-test to demonstrate the two modules
            agree on the induced term. Not used in the force path (it is
            singular at V = 0, which is exactly where negative control C sits).
        @param thrust_N Thrust, N.
        @param airspeed_ms Airspeed, m/s, must be > 0.
        @param rho_kgm3 Air density, kg/m^3.
        @param rpm Propeller speed, revolutions per minute.
        @returns Shaft power, W.
        """
        from ..powerplant import propeller_efficiency

        if airspeed_ms <= 0.0 or thrust_N <= 0.0:
            raise ValueError("cross-check path requires airspeed_ms > 0 and thrust_N > 0")
        eta_prop = propeller_efficiency(
            V_ms=airspeed_ms,
            rpm=rpm,
            diameter_m=self.diameter_m,
            thrust_N=thrust_N / self.n_rotors,
            rho_kgm3=rho_kgm3,
        )
        return thrust_N * airspeed_ms / eta_prop

    def max_thrust_N(self, airspeed_ms: float, rho_kgm3: float) -> float:
        """
        @description Largest thrust the power limit allows at this airspeed,
            newtons, by inverting electrical_power_W with bisection.

            The power law is strictly increasing in T (both T and v_i(T) grow
            with T), so bisection is guaranteed to converge and there is exactly
            one root. Bracketed by doubling from a physically generous upper
            bound rather than assuming one.

        @param airspeed_ms Airspeed, m/s.
        @param rho_kgm3 Air density, kg/m^3.
        @returns Maximum available thrust, N.
        """
        if self.max_electrical_power_W <= 0.0:
            return 0.0

        power_budget_W = self.max_electrical_power_W
        # Static-thrust bound gives a good starting bracket:
        #   P = T^1.5/sqrt(2 rho A)/(FM eta) -> T = (P FM eta sqrt(2 rho A))^(2/3)
        static_bound_N = (
            power_budget_W
            * self.figure_of_merit
            * self.eta_motor
            * self.eta_esc
            * np.sqrt(2.0 * rho_kgm3 * self.disk_area_m2)
        ) ** (2.0 / 3.0)
        hi_N = max(static_bound_N, 1.0e-6)
        for _ in range(200):
            if self.electrical_power_W(hi_N, airspeed_ms, rho_kgm3) >= power_budget_W:
                break
            hi_N *= 2.0
        else:  # pragma: no cover - unreachable for finite power budgets
            return hi_N

        lo_N = 0.0
        for _ in range(200):
            mid_N = 0.5 * (lo_N + hi_N)
            if self.electrical_power_W(mid_N, airspeed_ms, rho_kgm3) > power_budget_W:
                hi_N = mid_N
            else:
                lo_N = mid_N
            if hi_N - lo_N < 1.0e-12 * max(1.0, hi_N):
                break
        return lo_N

    def thrust_axis_world(self, body: BodyState, wind: "WindSample") -> np.ndarray:
        """
        @description Map the body-frame thrust axis into the ENU world frame
            using the 3-DOF flight-path frame (see state.wind_axes).
        @param body The body this thruster is attached to.
        @param wind Local wind sample.
        @returns Unit thrust direction in the ENU world frame, shape (3,).
        """
        v_rel_ms = relative_airspeed_vector(body, wind)
        drag_axis, side_axis, lift_axis = wind_axes(v_rel_ms)
        forward_axis = -drag_axis  # flight direction through the air
        world_axis = (
            self.axis[0] * forward_axis
            + self.axis[1] * side_axis
            + self.axis[2] * lift_axis
        )
        return safe_unit(world_axis, fallback=forward_axis)

    # -- the ForceElement contract ------------------------------------------

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
        @description Thrust force and the electrical power it costs.

            FREE-ENERGY GUARD: airspeed is taken from relative_airspeed_vector,
            so a uniform wind changes nothing. A thruster is strictly a SINK --
            power_elec_W is always <= 0 here and there is no code path by which
            this element can return positive power. Regeneration, if ever added,
            belongs in a turbine element with its own momentum-theory drag
            reaction (powerplant.turbine_drag_N), never here.

        @param bodies All vehicle bodies.
        @param atmo Ambient atmosphere sample.
        @param wind Local wind sample.
        @param sol Local solar sample (unused).
        @param t_s Simulation time, s.
        @param dt_s Timestep, s.
        @returns ElementForce with power_elec_W <= 0 (consumption).
        """
        body = bodies[self.body_index]
        rho_kgm3 = float(atmo.rho_kgm3)
        v_rel_ms = relative_airspeed_vector(body, wind)
        airspeed_ms = float(np.linalg.norm(v_rel_ms))

        thrust_limit_N = self.max_thrust_N(airspeed_ms, rho_kgm3)

        if self._commanded_throttle is not None:
            power_budget_W = self._commanded_throttle * self.max_electrical_power_W
            saved_limit = self.max_electrical_power_W
            self.max_electrical_power_W = power_budget_W
            try:
                thrust_N = self.max_thrust_N(airspeed_ms, rho_kgm3)
            finally:
                self.max_electrical_power_W = saved_limit
        else:
            thrust_N = min(float(self._commanded_thrust_N or 0.0), thrust_limit_N)

        if thrust_N <= 0.0:
            return ElementForce(np.zeros(3), np.zeros(3), 0.0)

        power_elec_W = self.electrical_power_W(thrust_N, airspeed_ms, rho_kgm3)
        force_N = thrust_N * self.thrust_axis_world(body, wind)

        return ElementForce(
            force_N=force_N,
            moment_Nm=moment_from_offset(self.offset_m, force_N),
            power_elec_W=-power_elec_W,  # sign convention: consumption is negative
        )
