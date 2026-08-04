"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Tether: tension-only penalty spring between two bodies, with optional cable aero drag and weight, and an exact Newton's-third-law guarantee on the internal tension.
2 | maintainer@emeraldcoastsystemsgroup.com   | MASS CLOSURE: linear_density_kg_m now DEFAULTS TO THE CABLE'S OWN GEOMETRY instead of to zero, cable mass joins the vehicle mass budget (half on each end body) instead of being applied as a weight force with no inertia, and EA_N is checked against the modulus its own cross-section implies.
3 | maintainer@emeraldcoastsystemsgroup.com   | PARAM BOUNDS (round-3 class fix): every numeric constructor parameter now validates against the declared PARAM_BOUNDS table (vehicle/param_bounds.py) at construction, re-checkable at spec extraction. Same rest_length/EA/stiffness semantics; adds finite/credible bands for damping, diameter, drag coefficient and an explicit linear density (an explicit 0.0 remains a legal, deliberately-typed declaration).

WHY A ZERO-MASS CABLE WAS A FREE-ENERGY DEFECT, NOT JUST AN OMISSION
---------------------------------------------------------------------
`linear_density_kg_m` defaulted to 0.0, so the default tether was a weightless
rigid-when-taut link of arbitrary length. Archetype 3 extracts energy precisely
BECAUSE the cable spans two altitudes moving at different speeds -- length is the
design variable that buys the shear -- and a sweep could buy any amount of it for
nothing. It now defaults to the mass its own diameter implies:

    lambda = rho_Dyneema * braid_solid_fraction * pi/4 * d^2

(2 mm SK75 -> 2.60 g/m, against ~2.4 g/m for real line). Set it explicitly for a
different material; setting it to zero is still allowed but must now be typed out
deliberately.

TWO FURTHER HOLES CLOSED HERE
-----------------------------
 1. WEIGHT WITHOUT INERTIA. Cable weight used to be injected as a force in
    evaluate_pair(). That gave the cable gravity but no mass in F = m a, i.e. a
    load the vehicle had to lift but never had to accelerate. The mass now goes
    into the mass budget, split half to each end body, and the INTEGRATOR applies
    gravity to it -- identical weight force, correct inertia, one owner.
 2. AN INFINITELY STIFF HAIR. EA_N and diameter_m were independent, so a sweep
    could take EA = 1e12 N on a 1 mm line: unbreakable, undeformable and nearly
    massless. EA now has to be achievable over its own cross-section; see
    mass.check_cable_stiffness and MAX_CREDIBLE_FIBRE_MODULUS_PA.

WHY THIS ELEMENT IS THE HEART OF ARCHETYPE 3
--------------------------------------------
The "sky sailboat" extracts energy from wind SHEAR: a wing in a fast layer is
tethered to a drogue or second wing in a slower layer, exactly as a sailboat
works the velocity difference between air and water. The tether is what couples
the two reference frames. Everything the archetype can do comes from this
element transferring force between two altitudes -- so its correctness is
load-bearing, and two invariants are enforced rather than assumed:

  (I1) NEWTON'S THIRD LAW. The internal tension is built as a single scalar
       magnitude T along a single unit vector u, applied as +T*u on body A and
       -T*u on body B. The two forces are the SAME arrays negated, so they
       cancel to exactly 0.0 in floating point, not merely to within a tolerance.

  (I2) THE UNDAMPED SPRING IS CONSERVATIVE. With damping_Ns_per_m = 0 the
       tension is a pure function of the separation length L, derived from the
       potential U(L) = EA (L - L0)^2 / (2 L0) for L > L0 and U = 0 otherwise.
       A function of |r| alone is a central force and therefore does exactly zero
       net work around any closed path in relative position. If this ever fails,
       the tether has become an energy source and archetypes 3 and 4 are lying.

FORCE BOOKKEEPING. evaluate_pair() returns tension PLUS the external cable loads
(aerodynamic drag on the cable, cable weight). Only the tension is internal, so
only the tension is subject to (I1); drag and weight are genuine external loads
from the air and from gravity and are not required to cancel. `tension_forces()`
exposes the internal pair alone for the third-law guard. Both external loads are
OFF by default (zero relative wind gives zero drag; linear_density_kg_m defaults
to 0.0), so the acceptance test sees pure tension.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from .mass import check_cable_stiffness, rope_linear_density_kg_m
from .param_bounds import Bounds, validate_declared
from .state import (
    BodyState,
    ElementForce,
    as_offset,
    relative_airspeed_vector,
)

if TYPE_CHECKING:  # pragma: no cover
    from ..env import AtmoSample, SolarSample, WindSample


class Tether:
    """
    @description A tension-only elastic cable between two bodies. Modelled as a
        penalty spring: it pulls when stretched beyond its rest length and does
        nothing at all when slack, which is the physically correct behaviour for
        a cable and is what keeps a two-body kite system from being pushed apart
        by a numerical artefact.

        It weighs what its diameter and length say it weighs; see the header
        block for why a weightless cable was a free-energy defect.
    """

    #: Joins the vehicle mass budget (see vehicle/mass.py). Splits half to each
    #: end body via mass_distribution().
    DECLARES_MASS_CLOSURE: bool = True

    #: Declared credible range for every numeric constructor parameter. Drives
    #: the constructor checks and param_bounds.recheck_element_params.
    PARAM_BOUNDS: dict[str, Bounds] = {
        "rest_length_m": Bounds(0.0, 1.0e5, lo_open=True, unit="m",
                                why="billed via linear density x length; "
                                    "bounded so inf/nan cannot ride the "
                                    "billed path (100 km is past any tether)"),
        "EA_N": Bounds(0.0, 1.0e9, lo_open=True, unit="N",
                       why="cross-checked against the modulus its own "
                           "cross-section implies (check_cable_stiffness)"),
        "damping_Ns_per_m": Bounds(0.0, 1.0e6, unit="N*s/m",
                                   why="strictly dissipative; negative damping "
                                       "is a free-energy source"),
        "diameter_m": Bounds(0.0, 0.5, lo_open=True, unit="m",
                             why="drives both drag area and derived mass; "
                                 "0.5 m is past any airborne cable"),
        "drag_coefficient": Bounds(0.5, 3.0, unit="-",
                                   why="subcritical cylinder is ~1.1 "
                                       "(Hoerner), a faired cable ~0.5; "
                                       "lower is a free tether -- disabling "
                                       "cable drag is the EXPLICIT "
                                       "include_aero_drag=False opt-out, not "
                                       "a tiny coefficient"),
        "linear_density_kg_m": Bounds(0.0, 100.0, unit="kg/m",
                                      why="explicit 0.0 is a LEGAL deliberate "
                                          "declaration (see header); negative "
                                          "or non-finite is not"),
    }

    def __init__(
        self,
        body_a: int,
        body_b: int,
        rest_length_m: float,
        EA_N: float,
        damping_Ns_per_m: float = 0.0,
        diameter_m: float = 0.001,
        drag_coefficient: float = 1.1,
        *,
        linear_density_kg_m: float | None = None,
        include_aero_drag: bool = True,
    ) -> None:
        """
        @description Construct a tether.
        @param body_a Index of the first body. Becomes `body_index` for the
            ForceElement protocol.
        @param body_b Index of the second body. Exposed as `partner_index` for
            the PairForceElement extension.
        @param rest_length_m Unstretched cable length L0, metres.
        @param EA_N Axial stiffness = Young's modulus * cross-section area,
            newtons. For Dyneema SK75, E ~ 109 GPa; a 1 mm diameter line gives
            EA ~ 8.6e4 N.
        @param damping_Ns_per_m Axial structural damping coefficient, N*s/m.
            Strictly dissipative; zero makes the tether exactly conservative.
        @param diameter_m Cable diameter, metres, for the aero drag area.
        @param drag_coefficient Cross-flow drag coefficient of the cable,
            dimensionless. 1.1 is the standard subcritical circular-cylinder
            value (Hoerner, "Fluid-Dynamic Drag"), and is the spec default.
        @param linear_density_kg_m Cable mass per unit length, kg/m. Default None
            DERIVES it from `diameter_m` as braided Dyneema SK75 (975 kg/m^3 at
            0.85 solid fraction), which is the standard tether material. Cable
            mass is carried in the vehicle MASS budget, half on each end body,
            not injected as a weight force -- so it is lifted AND accelerated.
            An explicit 0.0 is accepted but has to be typed on purpose.
        @param include_aero_drag Whether to apply cable cross-flow drag.
        """
        checked = validate_declared(
            type(self),
            rest_length_m=rest_length_m,
            EA_N=EA_N,
            damping_Ns_per_m=damping_Ns_per_m,
            diameter_m=diameter_m,
            drag_coefficient=drag_coefficient,
        )
        rest_length_m = checked["rest_length_m"]
        EA_N = checked["EA_N"]
        damping_Ns_per_m = checked["damping_Ns_per_m"]
        diameter_m = checked["diameter_m"]
        drag_coefficient = checked["drag_coefficient"]
        if body_a == body_b:
            raise ValueError("a tether must connect two DIFFERENT bodies")
        #: Tensile modulus EA_N implies over its own cross-section, Pa. Raises
        #: MassClosureError above MAX_CREDIBLE_FIBRE_MODULUS_PA.
        self.implied_modulus_Pa = check_cable_stiffness(float(EA_N), float(diameter_m))

        self.body_a = int(body_a)
        self.body_b = int(body_b)
        #: ForceElement protocol: the tether's "own" body is body A.
        self.body_index = int(body_a)
        #: PairForceElement extension: the other end.
        self.partner_index = int(body_b)
        self.offset_m = as_offset(None)

        self.rest_length_m = float(rest_length_m)
        self.EA_N = float(EA_N)
        self.damping_Ns_per_m = float(damping_Ns_per_m)
        self.diameter_m = float(diameter_m)
        self.drag_coefficient = float(drag_coefficient)
        if linear_density_kg_m is None:
            self.linear_density_kg_m = rope_linear_density_kg_m(float(diameter_m))
            self._linear_density_is_derived = True
        else:
            self.linear_density_kg_m = validate_declared(
                type(self), linear_density_kg_m=linear_density_kg_m
            )["linear_density_kg_m"]
            self._linear_density_is_derived = False
        self.include_aero_drag = bool(include_aero_drag)

    # -- mass ----------------------------------------------------------------

    @property
    def mass_kg(self) -> float:
        """
        @description Deployed cable mass, kg = linear density x rest length. Rest
            length is the design variable (the deployed length); elastic stretch
            adds no material.
        @returns Cable mass, kg.
        """
        return self.linear_density_kg_m * self.rest_length_m

    def mass_distribution(self) -> dict[int, float]:
        """
        @description How the cable's mass is carried by the two end bodies.

            Split half and half, which is the correct lumped-mass reduction for a
            straight uniform cable: it puts the combined centre of mass at the
            midpoint and gives each end half the cable's inertia. A single-body
            lump would move the vehicle's CG onto one end and let the other end
            accelerate for free.

        @returns {body_a: kg, body_b: kg}.
        """
        half_kg = 0.5 * self.mass_kg
        return {self.body_a: half_kg, self.body_b: half_kg}

    def mass_detail(self) -> str:
        """
        @description One-line derivation of the cable mass for the budget report.
        @returns e.g. "100.0 m x 2.604 g/m (derived from 2.0 mm)".
        """
        source = (
            f"derived from {self.diameter_m * 1000.0:.1f} mm"
            if self._linear_density_is_derived
            else "explicit linear density"
        )
        return (
            f"{self.rest_length_m:.1f} m x {self.linear_density_kg_m * 1000.0:.3f} "
            f"g/m ({source}), split 50/50"
        )

    # -- internal tension ----------------------------------------------------

    def tension_N(self, bodies: list[BodyState]) -> float:
        """
        @description Scalar cable tension, newtons, always >= 0.

            T = max(0, EA * (L - L0)/L0 + c * dL/dt)   for L > L0
            T = 0                                      for L <= L0

            The outer max() enforces tension-only behaviour even when the damping
            term is large and negative during a fast retraction; a cable cannot
            push.

        @param bodies All vehicle bodies.
        @returns Tension magnitude, N.
        """
        pos_a = bodies[self.body_a].pos_m
        pos_b = bodies[self.body_b].pos_m
        separation_m = pos_b - pos_a
        length_m = float(np.linalg.norm(separation_m))

        if length_m <= self.rest_length_m:
            return 0.0

        strain = (length_m - self.rest_length_m) / self.rest_length_m  # dimensionless
        tension_spring_N = self.EA_N * strain

        if self.damping_Ns_per_m != 0.0:
            unit_ab = separation_m / length_m  # dimensionless
            rel_vel_ms = bodies[self.body_b].vel_ms - bodies[self.body_a].vel_ms
            extension_rate_ms = float(np.dot(rel_vel_ms, unit_ab))  # dL/dt, m/s
            tension_damp_N = self.damping_Ns_per_m * extension_rate_ms
        else:
            tension_damp_N = 0.0

        return max(0.0, tension_spring_N + tension_damp_N)

    def potential_energy_J(self, bodies: list[BodyState]) -> float:
        """
        @description Elastic strain energy stored in the cable, joules:
            U = EA (L - L0)^2 / (2 L0) when stretched, else 0. The undamped
            tension is exactly -dU/dL, which is invariant (I2) in algebraic form.
        @param bodies All vehicle bodies.
        @returns Stored strain energy, J.
        """
        pos_a = bodies[self.body_a].pos_m
        pos_b = bodies[self.body_b].pos_m
        length_m = float(np.linalg.norm(pos_b - pos_a))
        if length_m <= self.rest_length_m:
            return 0.0
        return self.EA_N * (length_m - self.rest_length_m) ** 2 / (2.0 * self.rest_length_m)

    def tension_forces(self, bodies: list[BodyState]) -> tuple[np.ndarray, np.ndarray]:
        """
        @description The INTERNAL tension pair, newtons: (force on body A, force
            on body B). Built from one magnitude and one unit vector and negated,
            so the two sum to exactly zero in floating point -- invariant (I1).
        @param bodies All vehicle bodies.
        @returns (force_on_a_N, force_on_b_N), each shape (3,), in the ENU frame.
        """
        pos_a = bodies[self.body_a].pos_m
        pos_b = bodies[self.body_b].pos_m
        separation_m = pos_b - pos_a
        length_m = float(np.linalg.norm(separation_m))

        if length_m <= self.rest_length_m or length_m == 0.0:
            zero = np.zeros(3)
            return zero, zero.copy()

        unit_ab = separation_m / length_m  # dimensionless, points A -> B
        tension = self.tension_N(bodies)  # N

        force_on_a_N = tension * unit_ab      # A is pulled toward B
        force_on_b_N = -force_on_a_N          # exact negation: (I1) holds bitwise
        return force_on_a_N, force_on_b_N

    # -- external cable loads ------------------------------------------------

    def _cable_drag_N(
        self,
        bodies: list[BodyState],
        atmo: "AtmoSample",
        wind: "WindSample",
    ) -> np.ndarray:
        """
        @description Total cross-flow aerodynamic drag on the cable, newtons.

            Only the component of relative wind NORMAL to the cable produces
            appreciable drag on a smooth cylinder; the tangential component is
            skin friction and is two orders of magnitude smaller, so it is
            dropped. Drag is evaluated at the mean of the two endpoints'
            air-relative velocities, which is the correct leading-order
            (mid-span) value for a straight cable.

            FREE-ENERGY GUARD: built from air-relative velocity only, so it
            vanishes identically when the cable drifts with the air.

        @param bodies All vehicle bodies.
        @param atmo Ambient atmosphere sample.
        @param wind Local wind sample.
        @returns Total cable drag force, N, shape (3,), to be split between ends.
        """
        pos_a = bodies[self.body_a].pos_m
        pos_b = bodies[self.body_b].pos_m
        separation_m = pos_b - pos_a
        length_m = float(np.linalg.norm(separation_m))
        if length_m <= 0.0:
            return np.zeros(3)

        unit_ab = separation_m / length_m
        v_rel_a = relative_airspeed_vector(bodies[self.body_a], wind)
        v_rel_b = relative_airspeed_vector(bodies[self.body_b], wind)
        v_rel_mean_ms = 0.5 * (v_rel_a + v_rel_b)

        # Component normal to the cable.
        v_normal_ms = v_rel_mean_ms - float(np.dot(v_rel_mean_ms, unit_ab)) * unit_ab
        speed_normal_ms = float(np.linalg.norm(v_normal_ms))
        if speed_normal_ms <= 0.0:
            return np.zeros(3)

        area_m2 = self.diameter_m * length_m  # projected cable area, m^2
        drag_magnitude_N = (
            0.5 * float(atmo.rho_kgm3) * speed_normal_ms ** 2
            * self.drag_coefficient * area_m2
        )
        return -drag_magnitude_N * (v_normal_ms / speed_normal_ms)

    def cable_mass_kg(self, bodies: list[BodyState]) -> float:
        """
        @description Mass of the cable as currently spanned, kg = linear density
            * max(separation, rest length). Diagnostic only: the vehicle mass
            budget uses the state-independent `mass_kg` (rest length), because a
            body mass that changed with position would make the equations of
            motion non-conservative in a way nothing bills for.
        @param bodies All vehicle bodies.
        @returns Cable mass, kg.
        """
        if self.linear_density_kg_m == 0.0:
            return 0.0
        pos_a = bodies[self.body_a].pos_m
        pos_b = bodies[self.body_b].pos_m
        length_m = float(np.linalg.norm(pos_b - pos_a))
        return self.linear_density_kg_m * max(length_m, self.rest_length_m)

    # -- the PairForceElement / ForceElement contract ------------------------

    def evaluate_pair(
        self,
        bodies: list[BodyState],
        atmo: "AtmoSample",
        wind: "WindSample",
        sol: "SolarSample",
        t_s: float,
        dt_s: float,
    ) -> tuple[ElementForce, ElementForce]:
        """
        @description Full two-body evaluation: internal tension plus external
            cable aerodynamic drag, split equally between the two ends.

            CABLE WEIGHT IS DELIBERATELY NOT EMITTED HERE. It used to be, which
            gave the cable gravity but no inertia -- a load the vehicle had to
            lift but never had to accelerate. Its mass is now declared into the
            vehicle mass budget (mass_distribution(), half to each end body) and
            the integrator applies gravity to it along with everything else. The
            weight force on each body is identical; the inertia is now correct
            and there is exactly one owner of it.

        @param bodies All vehicle bodies.
        @param atmo Ambient atmosphere sample.
        @param wind Local wind sample.
        @param sol Local solar sample (unused; a cable converts no energy).
        @param t_s Simulation time, s.
        @param dt_s Timestep, s.
        @returns (ElementForce on body A, ElementForce on body B). power_elec_W
            is exactly 0.0 on both.
        """
        force_on_a_N, force_on_b_N = self.tension_forces(bodies)

        if self.include_aero_drag:
            drag_total_N = self._cable_drag_N(bodies, atmo, wind)
            half_drag_N = 0.5 * drag_total_N
            force_on_a_N = force_on_a_N + half_drag_N
            force_on_b_N = force_on_b_N + half_drag_N

        zero_moment = np.zeros(3)
        return (
            ElementForce(force_on_a_N, zero_moment, 0.0),
            ElementForce(force_on_b_N, zero_moment.copy(), 0.0),
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
        @description ForceElement-protocol view of the tether: the force on body
            A alone. Vehicle.net prefers evaluate_pair() so that body B's
            reaction is applied too; this method exists so a Tether is a valid
            plain ForceElement for any code that only knows the base protocol.
        @returns ElementForce on body A.
        """
        force_a, _ = self.evaluate_pair(bodies, atmo, wind, sol, t_s, dt_s)
        return force_a
