"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation. WindTurbine
  |                                           | promoted from validate.py's private
  |                                           | _TurbineElement into a SHIPPED element.
  |                                           | Validation case D used to build a wind
  |                                           | turbine out of a private class that no
  |                                           | sweep would ever instantiate, which meant
  |                                           | the negative control tested code the
  |                                           | product does not contain. Extraction and
  |                                           | its momentum-theory reaction drag are
  |                                           | emitted TOGETHER, from one actuator disk,
  |                                           | so the two can never be separated; mass is
  |                                           | derived from the disk and the generator
  |                                           | rating so a sweep cannot buy swept area or
  |                                           | rated power for nothing.
2 | maintainer@emeraldcoastsystemsgroup.com   | PARAM BOUNDS (round-3 class
  |                                           | fix): cp was stored with bare
  |                                           | float() -- the Betz bound was
  |                                           | only enforced downstream at
  |                                           | evaluate time, and an element
  |                                           | built around __init__ never hit
  |                                           | it. cp now validates at
  |                                           | construction against (0, 16/27]
  |                                           | (Betz 1920), every numeric
  |                                           | parameter validates against the
  |                                           | declared PARAM_BOUNDS table,
  |                                           | the generator/rectifier
  |                                           | gravimetric DIVISORS are banded
  |                                           | (they discount mass when
  |                                           | raised), and an explicit
  |                                           | mass_kg may not undercut the
  |                                           | best-hardware floor.

MODULE: aerosim.vehicle.turbine -- an airborne wind turbine as a ForceElement.

WHY THIS IS A SHIPPED ELEMENT AND NOT A TEST FIXTURE
-----------------------------------------------------------------------------
Archetypes 3 and 4 (tethered sky sailboat, dynamic soarer) exist to extract
energy from a moving fluid. The extractor is therefore a first-class part of the
design space a 30,000-candidate sweep explores, and it must be the SAME object
the validation gate exercises. A private stand-in in validate.py proves only
that the stand-in is honest.

THE INVARIANT THIS ELEMENT EXISTS TO SATISFY
-----------------------------------------------------------------------------
integrate._GENERATION_REACTION_RULE: an element converting MECHANICAL energy may
report no more electrical generation than the mechanical power its own reaction
force removes from the flow,

    power_elec_W  <=  -(force_N . v_air)                                    [W]

For an actuator-disk turbine, with `a` the axial induction solving cp = 4a(1-a)^2
and ct = 4a(1-a):

    P_shaft = cp * (0.5 rho A V^3)        extraction                        [W]
    D       = ct * (0.5 rho A V^2)        reaction                          [N]
    P_shaft / (D V) = cp/ct = (1 - a) < 1                                   [-]

so the rule holds with margin (1-a) BEFORE the generator efficiency, and it holds
STRUCTURALLY -- the same `cp` drives both, through powerplant, so a design cannot
raise extraction without raising the drag that pays for it.

THE FRAME RULE, WHICH IS THE WHOLE FREE-ENERGY QUESTION
-----------------------------------------------------------------------------
V is the airspeed of the disk RELATIVE TO THE LOCAL AIR, taken from
state.relative_airspeed_vector. A free-flying vehicle drifting with a uniform
wind has v_air = 0 and this element produces EXACTLY zero. There is no code path
by which uniform air yields energy. Net extraction requires a second reference
frame: a ground tether, or two bodies in different wind layers, or a gust.

UNITS: *_m metres, *_m2 square metres, *_ms m/s, *_N newtons, *_W watts,
*_kg kilograms, *_kgm3 kg/m^3. Dimensionless: cp, ct, eta_*, axial induction.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from .mass import (
    MAX_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG,
    MAX_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG,
    MIN_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG,
    MIN_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG,
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
)

if TYPE_CHECKING:  # pragma: no cover - annotations only
    from ..env import AtmoSample, SolarSample, WindSample

#: Generator gravimetric power, W/kg. A direct-drive PM generator is the same
#: machine as a PM motor run backwards, so this reuses the motor figure from
#: mass.py rather than inventing a second constant. Sized on RATED electrical
#: output, which is the number a sweep would otherwise push up for free.
GENERATOR_SPECIFIC_POWER_W_PER_KG: float = 3000.0

#: Rectifier / MPPT gravimetric power, W/kg. Same class of power electronics as
#: an ESC (mass.ESC_SPECIFIC_POWER_W_PER_KG = 12000); the conservative end.
RECTIFIER_SPECIFIC_POWER_W_PER_KG: float = 12000.0


class WindTurbine:
    """
    @description An airborne wind turbine: an actuator disk that converts the
        mechanical power it removes from the flow into electrical power, and
        emits the momentum-theory reaction drag that removal costs.

        Extraction and reaction are computed from ONE cp through
        powerplant.turbine_power_W / powerplant.turbine_drag_N, so they cannot
        drift apart. The disk has mass (blades sized by diameter, generator and
        rectifier sized by the rating), so swept area and rated power are both
        billed.
    """

    #: Joins the vehicle mass budget (see vehicle/mass.py).
    DECLARES_MASS_CLOSURE: bool = True

    #: Betz limit, dimensionless: the maximum fraction of the kinetic power in
    #: the stream tube any actuator-disk extractor can remove (Betz, 1920).
    BETZ_LIMIT: float = 16.0 / 27.0

    #: Declared credible range for every numeric constructor parameter. Drives
    #: the constructor checks and param_bounds.recheck_element_params.
    PARAM_BOUNDS: dict[str, Bounds] = {
        "swept_area_m2": Bounds(0.0, 1000.0, lo_open=True, unit="m2",
                                why="billed via the disk-sized blade mass; "
                                    "bounded so inf/nan cannot ride the "
                                    "billed path"),
        "generator_rated_power_W": Bounds(0.0, 1.0e6, lo_open=True, unit="W",
                                          why="billed via the generator mass "
                                              "and clamps the output"),
        "cp": Bounds(0.0, 16.0 / 27.0, lo_open=True, unit="-",
                     why="Betz limit (Betz 1920): no disk extracts more than "
                         "16/27 of the stream-tube power; a negative cp turns "
                         "the drag reaction into unbilled thrust"),
        "eta_gen": Bounds(0.0, 1.0, lo_open=True, unit="-",
                          why="shaft-to-bus efficiency above 1 is a free "
                              "energy multiplier"),
        "mass_kg": Bounds(0.0, 1.0e4, lo_open=True, unit="kg",
                          why="explicit part mass; the credibility floor vs "
                              "the derived turbine is cross-checked "
                              "separately"),
        "generator_specific_power_W_per_kg": Bounds(
            MIN_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG,
            MAX_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG, unit="W/kg",
            why="mass DIVISOR: a PM generator is a PM motor run backwards, "
                "same gravimetric band"),
        "rectifier_specific_power_W_per_kg": Bounds(
            MIN_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG,
            MAX_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG, unit="W/kg",
            why="mass DIVISOR: same power-electronics class as an ESC"),
    }

    def __init__(
        self,
        swept_area_m2: float,
        generator_rated_power_W: float,
        cp: float = 0.40,
        eta_gen: float = 0.90,
        body_index: int = 0,
        *,
        offset_m: np.ndarray | None = None,
        mass_kg: float | None = None,
        generator_specific_power_W_per_kg: float = GENERATOR_SPECIFIC_POWER_W_PER_KG,
        rectifier_specific_power_W_per_kg: float = RECTIFIER_SPECIFIC_POWER_W_PER_KG,
    ) -> None:
        """
        @description Construct an airborne wind turbine.
        @param swept_area_m2 Rotor swept area, m^2, > 0.
        @param generator_rated_power_W Electrical power the generator can deliver
            at the bus, W, > 0. Output is CLAMPED to it (a real machine saturates)
            and the generator mass is sized by it, so a sweep cannot have an
            unlimited rating for nothing.
        @param cp Power coefficient, dimensionless, RANGE (0, 16/27]: the Betz
            limit is enforced HERE at construction (and re-checked at
            spec-extraction), not only downstream in powerplant -- an element
            assembled around __init__ must still be caught.
        @param eta_gen Generator + rectifier efficiency, shaft to bus,
            dimensionless 0..1.
        @param body_index Index of the body carrying the turbine.
        @param offset_m Disk centre offset from the body reference, m.
        @param mass_kg Installed turbine mass, kg, when a specific part is known.
            Leave None (the normal path) and it is DERIVED from the disk and the
            rating; passing 0.0 is rejected, because a weightless extractor is
            exactly the free lunch this parameter exists to close.
        @param generator_specific_power_W_per_kg Generator gravimetric power, W/kg.
        @param rectifier_specific_power_W_per_kg Rectifier gravimetric power, W/kg.
        @raises ValueError On a non-positive swept area or rating.
        @raises ParamBoundsError On an out-of-range parameter or an explicit mass below the credibility floor.
        """
        checked = validate_declared(
            type(self),
            swept_area_m2=swept_area_m2,
            generator_rated_power_W=generator_rated_power_W,
            cp=cp,
            eta_gen=eta_gen,
            generator_specific_power_W_per_kg=generator_specific_power_W_per_kg,
            rectifier_specific_power_W_per_kg=rectifier_specific_power_W_per_kg,
        )

        self.swept_area_m2 = checked["swept_area_m2"]
        self.generator_rated_power_W = checked["generator_rated_power_W"]
        self.cp = checked["cp"]
        self.eta_gen = checked["eta_gen"]
        self.body_index = int(body_index)
        self.offset_m = as_offset(offset_m)

        #: Equivalent single-rotor diameter, m, from the swept area.
        self.diameter_m = float(np.sqrt(4.0 * self.swept_area_m2 / np.pi))
        #: Blade / hub mass, kg, sized by the disk (same fit as a propeller).
        self.rotor_mass_kg = propeller_mass_kg(self.diameter_m, 1)
        #: Generator + rectifier mass, kg, sized by the rating.
        self.generator_mass_kg = motor_drive_mass_kg(
            max_electrical_power_W=self.generator_rated_power_W,
            n_rotors=1,
            motor_specific_power_W_per_kg=generator_specific_power_W_per_kg,
            esc_specific_power_W_per_kg=rectifier_specific_power_W_per_kg,
        )

        if mass_kg is None:
            #: Installed turbine mass, kg (blades + generator + rectifier).
            self.mass_kg = self.rotor_mass_kg + self.generator_mass_kg
            self._mass_is_derived = True
        else:
            self.mass_kg = validate_declared(type(self), mass_kg=mass_kg)["mass_kg"]
            self._mass_is_derived = False

        # Cross-parameter constraints (explicit-mass credibility floor).
        self.validate_cross_params()

        #: Air-relative speed at the disk on the last evaluate(), m/s (diagnostic).
        self.last_airspeed_ms: float = 0.0
        #: Reaction drag on the last evaluate(), N (diagnostic).
        self.last_drag_N: float = 0.0
        #: Electrical power delivered on the last evaluate(), W (diagnostic).
        self.last_power_elec_W: float = 0.0
        #: True when the last evaluate() was clamped by the generator rating.
        self.last_rating_limited: bool = False

    def min_credible_mass_kg(self) -> float:
        """
        @description The lightest a turbine of this disk and rating could be if
            built from the best demonstrated hardware (generator at the motor
            band's ceiling, rectifier at the ESC band's ceiling, blades on the
            deliberately-light propeller fit). An explicit mass_kg below this is
            a typed-in mass discount.
        @returns Credibility floor for the installed turbine mass, kg.
        """
        return propeller_mass_kg(self.diameter_m, 1) + motor_drive_mass_kg(
            max_electrical_power_W=self.generator_rated_power_W,
            n_rotors=1,
            motor_specific_power_W_per_kg=MAX_CREDIBLE_MOTOR_SPECIFIC_POWER_W_PER_KG,
            esc_specific_power_W_per_kg=MAX_CREDIBLE_ESC_SPECIFIC_POWER_W_PER_KG,
        )

    def validate_cross_params(self) -> None:
        """
        @description Constraints a single (lo, hi) bound cannot express,
            re-runnable on a live instance by
            param_bounds.recheck_element_params (defense in depth).
        @returns None. Raises on violation.
        @raises ParamBoundsError When an explicit mass_kg undercuts the
            best-hardware credibility floor for this disk and rating.
        """
        floor_kg = self.min_credible_mass_kg()
        if not self._mass_is_derived and self.mass_kg < floor_kg:
            raise ParamBoundsError(
                f"WindTurbine explicit mass_kg = {self.mass_kg:g} kg is below "
                f"the credibility floor of {floor_kg:.4f} kg for a "
                f"{self.swept_area_m2:g} m2 disk with a "
                f"{self.generator_rated_power_W:g} W generator built from the "
                f"best demonstrated hardware. A lighter 'known part' is an "
                f"unbilled mass discount; pass None to derive the mass instead."
            )

    def mass_detail(self) -> str:
        """
        @description One-line derivation of the turbine mass for the budget report.
        @returns e.g. "0.798 m disk 0.095 + 300 W generator 0.125 kg".
        """
        if not self._mass_is_derived:
            return "explicit part mass"
        return (
            f"{self.diameter_m:.3f} m disk {self.rotor_mass_kg:.4f} "
            f"+ {self.generator_rated_power_W:.0f} W generator "
            f"{self.generator_mass_kg:.4f}"
        )

    def axial_induction(self) -> float:
        """
        @description Actuator-disk axial induction factor for this cp,
            dimensionless, solving cp = 4a(1-a)^2 on the low-induction branch.
            Delegated to powerplant so exactly one implementation exists.
        @returns Axial induction a, dimensionless in [0, 1/3].
        """
        from ..powerplant import turbine_axial_induction

        return float(turbine_axial_induction(self.cp))

    def shaft_power_W(self, airspeed_ms: float, rho_kgm3: float) -> float:
        """
        @description Mechanical power the disk removes from the flow, W.
        @param airspeed_ms Air-relative speed at the disk, m/s.
        @param rho_kgm3 Air density, kg/m^3.
        @returns Shaft power, W, >= 0.
        """
        from ..powerplant import turbine_power_W

        if airspeed_ms <= 0.0:
            return 0.0
        return float(
            turbine_power_W(float(airspeed_ms), float(rho_kgm3), self.swept_area_m2, self.cp)
        )

    def reaction_drag_N(self, airspeed_ms: float, rho_kgm3: float) -> float:
        """
        @description Momentum-theory reaction force the extraction costs, N. This
            is not an add-on to the power: it is the same actuator disk seen as a
            force, and the vehicle must pay for it through its propulsion.
        @param airspeed_ms Air-relative speed at the disk, m/s.
        @param rho_kgm3 Air density, kg/m^3.
        @returns Drag, N, >= 0.
        """
        from ..powerplant import turbine_drag_N

        if airspeed_ms <= 0.0:
            return 0.0
        return float(
            turbine_drag_N(float(airspeed_ms), float(rho_kgm3), self.swept_area_m2, self.cp)
        )

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
        @description Electrical generation and the reaction drag that pays for it.

            FREE-ENERGY GUARD, STRUCTURAL: the airspeed comes from
            relative_airspeed_vector, so drifting with a uniform wind gives
            v_air = 0 and BOTH the power and the drag are exactly zero. When the
            generator rating clamps the output, the drag is NOT reduced with it --
            a saturated machine still spins the same disk in the same flow, and
            reducing the drag would hand the vehicle back momentum it never
            returned to the air. Clamping therefore only ever makes the element
            LESS profitable, which keeps the generation-reaction rule satisfied.

        @param bodies All vehicle bodies.
        @param atmo Ambient atmosphere sample.
        @param wind Local wind sample.
        @param sol Local solar sample (unused; a turbine converts no sunlight).
        @param t_s Simulation time, s.
        @param dt_s Timestep, s.
        @returns ElementForce whose force_N opposes motion through the air and
            whose power_elec_W >= 0 (generation).
        """
        body = bodies[self.body_index]
        v_air_ms = relative_airspeed_vector(body, wind)
        airspeed_ms = float(np.linalg.norm(v_air_ms))
        self.last_airspeed_ms = airspeed_ms

        if airspeed_ms <= 0.0:
            self.last_drag_N = 0.0
            self.last_power_elec_W = 0.0
            self.last_rating_limited = False
            return ElementForce(np.zeros(3), np.zeros(3), 0.0)

        rho_kgm3 = float(atmo.rho_kgm3)
        shaft_W = self.shaft_power_W(airspeed_ms, rho_kgm3)
        drag_N = self.reaction_drag_N(airspeed_ms, rho_kgm3)

        power_elec_W = shaft_W * self.eta_gen
        self.last_rating_limited = power_elec_W > self.generator_rated_power_W
        if self.last_rating_limited:
            power_elec_W = self.generator_rated_power_W

        self.last_drag_N = drag_N
        self.last_power_elec_W = power_elec_W

        # Drag opposes motion through the air: -v_hat.
        force_N = -drag_N * safe_unit(v_air_ms)
        return ElementForce(
            force_N=force_N,
            moment_Nm=moment_from_offset(self.offset_m, force_N),
            power_elec_W=power_elec_W,
        )
