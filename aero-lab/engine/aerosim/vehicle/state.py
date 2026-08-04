"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Core state/force datatypes, the ForceElement contract, the two-body PairForceElement extension, and Vehicle.net assembly.
2 | maintainer@emeraldcoastsystemsgroup.com   | MASS AGGREGATION ONLY (see OBJECTION 5): BodyState.mass_kg now means STRUCTURE mass on input and DERIVED TOTAL after Vehicle binds the element masses into it; Vehicle gained bind_masses / mass_budget / assert_mass_declared and the loud fixed-mass escape hatch. Nothing was renamed, removed or re-ordered -- integrate.py keeps reading b.mass_kg and now gets the honest total.

=============================================================================
OBJECTION 5 -- a hand-entered BodyState.mass_kg makes energy storage FREE.
  BatteryElement took capacity_J with no mass and PVArray took area_m2 with no
  mass, so the only number that set the vehicle's weight was a literal typed into
  BodyState. Measured: 10x-ing case A's pack (703 -> 7030 Wh, about 28 kg of
  cells on a 6.93 kg aircraft) left the aircraft at 6.93 kg and the case still
  PASSED; 5000 Wh on the 1 kg negative-control quadcopter made it CLOSE. Over a
  30,000-candidate sweep with battery Wh and PV area as design variables, both go
  to infinity for free and every marginal design closes.
  RESOLVED HERE, IN THE AGGREGATION ONLY: the elements now carry mass (energy.py,
  thruster.py, tether.py, mass.py), and `Vehicle` sums structure + declared
  element mass into each body's mass_kg at construction. Because integrate.py
  already reads b.mass_kg for gravity, for the trim weight and for the re-trim
  trigger, a heavier pack immediately costs lift, drag, cruise power and trim
  speed with no change to the integrator at all.
  The input field was NOT renamed: `mass_kg` passed to the constructor is the
  STRUCTURE mass and is preserved verbatim in `structure_mass_kg`. The escape
  hatch for tests that must pin an all-up mass is
  `Vehicle(..., mass_closure=FIXED_TOTAL_MASS_OVERRIDE)`, which warns every time
  it is used and is never the default path.
=============================================================================
INTERFACE OBJECTIONS (see also aerosurface.py, thruster.py, energy.py)
=============================================================================
OBJECTION 1 -- ForceElement cannot express a two-body element, but Tether is one.
  The locked Protocol is:
      class ForceElement(Protocol):
          body_index: int
          offset_m: ndarray[3]
          def evaluate(...) -> ElementForce      # ONE force, ONE body
  but the locked Tether spec says it "emits equal-and-opposite forces on a and b",
  and its acceptance test reads BOTH ("|force on a + force on b| < 1e-9 N").
  A single-body return value provably cannot carry two forces.

  RESOLVED WITHOUT CHANGING THE SPECIFIED SIGNATURE: Tether satisfies ForceElement
  exactly (body_index == body_a, evaluate() returns the force on body A) and
  ADDITIONALLY implements the strictly-additive PairForceElement protocol defined
  below (`partner_index` + `evaluate_pair()`). Vehicle.net duck-types on
  `evaluate_pair`, so any element written by another agent against the plain
  ForceElement protocol keeps working untouched. Nothing was renamed or removed.

OBJECTION 2 -- BatteryElement cannot be a peer element in a single force pass.
  A battery's power flow is a function of the NET power of every OTHER element,
  which it cannot see from inside its own evaluate(). Evaluating it as a peer would
  either double-count or require a fixed-point solve inside net().
  RESOLVED: BatteryElement.evaluate() reports zeros (it is a buffer, not a source
  or a sink), Vehicle.net() returns the net generation-minus-consumption of all
  NON-battery elements, and the integrator drives the buffer explicitly through
  Vehicle.step_batteries(net_W, dt_s). This keeps net() single-pass and total.

OBJECTION 3 -- Thruster has no command input in its constructor signature.
  Thruster(diameter_m, max_electrical_power_W, body_index, axis) specifies the
  hardware but never says how much thrust to make, so evaluate() has no way to
  know its own operating point.
  RESOLVED: the constructor signature is untouched; command is applied through
  post-construction mutators (set_thrust_N / set_throttle), which is what the
  integrator's quasi-steady trim loop needs anyway.

OBJECTION 4 -- The AtlantikSolar AeroSurface acceptance test looks
  over-determined. See the block comment at the top of aerosurface.py; it is a
  physics objection, not an interface objection, and it is reported honestly by
  the self-test rather than tuned around.
=============================================================================
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol, Sequence, runtime_checkable

import numpy as np

from .mass import (
    FixedMassOverrideWarning,
    MassBudget,
    MassClosureError,
    UndeclaredMassError,
    UndeclaredMassWarning,
    build_mass_budget,
    undeclared_elements,
)

if TYPE_CHECKING:  # pragma: no cover - typing only, avoids a hard import cycle
    from ..env import AtmoSample, SolarSample, WindSample


#: Vehicle.mass_closure value for the normal path: total mass is DERIVED as
#: structure + declared element masses. This is the default and it is the only
#: value a design sweep may use.
MASS_CLOSURE_DERIVED: str = "derived"

#: Vehicle.mass_closure value for the escape hatch: BodyState.mass_kg is taken
#: verbatim as the all-up mass and element masses are NOT added. Deliberately
#: verbose, and it emits a FixedMassOverrideWarning every single time so it can
#: never become the quiet default. For tests that must pin a mass; never for a
#: design sweep, where it re-opens the free-battery defect by hand.
FIXED_TOTAL_MASS_OVERRIDE: str = "FIXED_TOTAL_MASS_OVERRIDE_FOR_TESTS_ONLY"


# ---------------------------------------------------------------------------
# Physical constants (units in the name; sources cited)
# ---------------------------------------------------------------------------

#: Standard gravity, m/s^2. ISO 80000-3 / CODATA defined value.
G0_MS2: float = 9.80665

#: World frame is ENU: +x East (m), +y North (m), +z UP (m).
#: Gravity therefore acts along -z.
UP_AXIS: np.ndarray = np.array([0.0, 0.0, 1.0], dtype=float)

#: Numerical floor for normalising a vector, m/s or m depending on use.
EPS_NORM: float = 1.0e-12


# ---------------------------------------------------------------------------
# State and force records
# ---------------------------------------------------------------------------


@dataclass
class BodyState:
    """
    @description One rigid body's translational state in the ENU world frame. In
        3-DOF (the prototype's sweep path) `att_quat` stays None and the body is
        a point mass; the field exists so a Phase-2 6-DOF integrator can populate
        it without changing the dataclass.
    @param pos_m Position in the ENU world frame, metres. Shape (3,).
    @param vel_ms Inertial velocity in the ENU world frame, m/s. Shape (3,).
        NOTE this is GROUND velocity, not airspeed. Air-relative velocity is
        always vel_ms - wind_vector and every element computes it that way; see
        `relative_airspeed_vector`.
    @param mass_kg TWO MEANINGS, and the distinction is the whole of OBJECTION 5.
        ON INPUT it is the body's STRUCTURE mass, kg: airframe, avionics,
        payload -- everything that is not a force element with a declared mass of
        its own. It MUST NOT include a battery pack, a PV array, motors or a
        tether (those elements now carry their own mass), and it MUST NOT include
        lifting-gas or balloon-film mass (BuoyancyVolume accounts for both in its
        force, see buoyancy.py). AFTER the body is placed in a Vehicle it holds
        the DERIVED TOTAL, structure + every declared element mass on this body,
        which is the number integrate.py reads for gravity and for the trim
        weight. The structure figure is preserved verbatim in structure_mass_kg,
        so binding is idempotent.
    @param att_quat Attitude quaternion (w, x, y, z), dimensionless, or None in
        3-DOF. Shape (4,) when present.
    @param structure_mass_kg Explicit structure mass, kg. Optional and normally
        left None -- it then takes the constructor's mass_kg. Pass it by name
        when you want the code to say which meaning is intended; passing both
        with different values raises rather than picking one.
    """

    pos_m: np.ndarray
    vel_ms: np.ndarray
    mass_kg: float
    att_quat: np.ndarray | None = None
    structure_mass_kg: float | None = None

    def __post_init__(self) -> None:
        self.pos_m = np.asarray(self.pos_m, dtype=float).reshape(3)
        self.vel_ms = np.asarray(self.vel_ms, dtype=float).reshape(3)
        self.mass_kg = float(self.mass_kg)
        if self.structure_mass_kg is None:
            self.structure_mass_kg = float(self.mass_kg)
        else:
            self.structure_mass_kg = float(self.structure_mass_kg)
            if abs(self.structure_mass_kg - self.mass_kg) > 1.0e-12:
                raise MassClosureError(
                    f"BodyState received mass_kg = {self.mass_kg} kg and "
                    f"structure_mass_kg = {self.structure_mass_kg} kg. On input "
                    f"they are the SAME quantity (the structure mass); the total "
                    f"is derived by Vehicle. Pass one, or pass both equal."
                )
        if self.att_quat is not None:
            self.att_quat = np.asarray(self.att_quat, dtype=float).reshape(4)

    def set_total_mass_kg(self, element_mass_kg: float) -> float:
        """
        @description Write the derived all-up mass of this body into mass_kg.
            Idempotent by construction: it always recomputes from the preserved
            structure mass, so re-binding a Vehicle after its element list
            changes cannot accumulate.
        @param element_mass_kg Declared element mass carried by this body, kg.
        @returns The new total mass, kg.
        """
        self.mass_kg = float(self.structure_mass_kg) + float(element_mass_kg)
        return self.mass_kg

    @property
    def altitude_m(self) -> float:
        """
        @description Geometric altitude above MSL, metres -- the +z component of
            the ENU position. This is the altitude `env.atmosphere` expects
            (it does the geopotential conversion internally).
        @returns Altitude, m.
        """
        return float(self.pos_m[2])


@dataclass
class ElementForce:
    """
    @description What one force-producing element contributes on one body in one
        evaluation. Every element -- wing, balloon, tether, thruster, PV panel --
        returns this same record, which is what lets archetypes 1-4 be
        configurations of the same engine rather than four code paths.
    @param force_N Force in the ENU world frame, newtons. Shape (3,).
    @param moment_Nm Moment about the body reference point in the ENU world
        frame, newton-metres. Shape (3,). Computed as offset_m x force_N in
        3-DOF; carried so a 6-DOF integrator has it available.
    @param power_elec_W Electrical power, watts. SIGN CONVENTION, used everywhere
        in this package: power_elec_W > 0 means the element GENERATES (PV array,
        regen turbine); power_elec_W < 0 means it CONSUMES (thruster). Purely
        mechanical elements (wing, balloon, tether) return exactly 0.0.
    """

    force_N: np.ndarray
    moment_Nm: np.ndarray
    power_elec_W: float

    def __post_init__(self) -> None:
        self.force_N = np.asarray(self.force_N, dtype=float).reshape(3)
        self.moment_Nm = np.asarray(self.moment_Nm, dtype=float).reshape(3)
        self.power_elec_W = float(self.power_elec_W)


def zero_force() -> ElementForce:
    """
    @description A no-contribution ElementForce. Used by elements that are
        present but inactive this step (a slack tether, an unpowered thruster).
    @returns ElementForce with exactly zero force, moment and power.
    """
    return ElementForce(np.zeros(3), np.zeros(3), 0.0)


# ---------------------------------------------------------------------------
# The element contracts
# ---------------------------------------------------------------------------


@runtime_checkable
class ForceElement(Protocol):
    """
    @description The single contract every force-producing element satisfies. An
        element reads the bodies and the local fluid/solar state and returns the
        force, moment and electrical power it contributes to ONE body.
    """

    body_index: int
    offset_m: np.ndarray

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
        @description Evaluate this element's contribution at the current state.
        @param bodies All bodies in the vehicle; the element reads its own via
            `body_index` and may read others (a tether reads two).
        @param atmo Local atmosphere sample (T_K, p_Pa, rho_kgm3, mu_Pas, a_ms).
        @param wind Local wind sample: components m/s and analytic d/dz in 1/s.
        @param sol Local solar sample: angles in rad, irradiances in W/m^2.
        @param t_s Simulation time, seconds.
        @param dt_s Timestep, seconds. Elements carrying internal state (balloon
            gas temperature, battery charge) integrate over this interval.
        @returns The element's ElementForce contribution.
        """
        ...


@runtime_checkable
class PairForceElement(Protocol):
    """
    @description STRICTLY-ADDITIVE extension to ForceElement for elements that
        act between TWO bodies (see OBJECTION 1 in this module's docstring). A
        PairForceElement is also a valid ForceElement: `evaluate()` returns the
        force on `body_index` (body A) alone, so code that only knows the base
        protocol still works. `Vehicle.net` duck-types on `evaluate_pair` and
        applies both halves when it is present, which is what makes the
        equal-and-opposite guarantee reach the integrator.
    """

    body_index: int
    partner_index: int
    offset_m: np.ndarray

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
        @description Evaluate a two-body element.
        @returns (force_on_body_index, force_on_partner_index). Newton's third
            law requires force_on_a.force_N + force_on_b.force_N == 0 to machine
            precision for any internal-force element; Tether asserts this.
        """
        ...


# ---------------------------------------------------------------------------
# Frame helpers shared by every element
# ---------------------------------------------------------------------------


def relative_airspeed_vector(
    body: BodyState, wind: "WindSample"
) -> np.ndarray:
    """
    @description Air-relative velocity of a body, ENU, m/s: ground velocity minus
        the local wind vector.

        THIS FUNCTION IS THE FREE-ENERGY GUARD. Every element in this package
        derives its aerodynamic state from this call and never from
        `body.vel_ms` directly. Because the result depends only on the
        DIFFERENCE between body and air velocity, the whole force model is
        Galilean-invariant: adding a uniform wind W to the field while adding the
        same W to every body's velocity leaves every force unchanged, so a
        vehicle in uniform wind cannot extract energy. `selftest_galilean()` in
        __init__.py asserts this numerically, and integrate.assert_no_free_energy
        is the system-level companion.

    @param body The body whose air-relative velocity is wanted.
    @param wind Local wind sample; u/v/w are East/North/Up in m/s.
    @returns Air-relative velocity vector, ENU, m/s. Shape (3,).
    """
    wind_vec_ms = np.array([wind.u_ms, wind.v_ms, wind.w_ms], dtype=float)
    return body.vel_ms - wind_vec_ms


def safe_unit(vec: np.ndarray, fallback: np.ndarray | None = None) -> np.ndarray:
    """
    @description Normalise a vector, returning a fallback when it is degenerate.
    @param vec Vector to normalise (any units).
    @param fallback Unit vector to return when |vec| < EPS_NORM; defaults to +x.
    @returns Dimensionless unit vector, shape (3,).
    """
    norm = float(np.linalg.norm(vec))
    if norm < EPS_NORM:
        if fallback is None:
            return np.array([1.0, 0.0, 0.0])
        return np.asarray(fallback, dtype=float).reshape(3)
    return np.asarray(vec, dtype=float).reshape(3) / norm


def wind_axes(v_rel_ms: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    @description Build the 3-DOF wind-axis triad from an air-relative velocity.

        Returns (drag_axis, side_axis, lift_axis), all dimensionless unit
        vectors in the ENU world frame:
          drag_axis  = -v_hat        (drag opposes motion through the air)
          side_axis  = unit(z_up x v_hat)   ("left" when flying level)
          lift_axis  = v_hat x side_axis    (perpendicular to flight, "up")

        Sanity check baked into the construction: for level eastbound flight
        v_hat = +x, side_axis = unit(z x x) = +y, lift_axis = x x y = +z, i.e.
        lift points up. When v_hat is vertical (a balloon ascending, a wing in a
        pure climb) z x v_hat degenerates; +y North is substituted as the side
        axis, which keeps the triad orthonormal and continuous in magnitude.

    @param v_rel_ms Air-relative velocity, ENU, m/s. Shape (3,).
    @returns (drag_axis, side_axis, lift_axis), each a unit vector of shape (3,).
    """
    v_hat = safe_unit(v_rel_ms)
    side_raw = np.cross(UP_AXIS, v_hat)
    if float(np.linalg.norm(side_raw)) < 1.0e-9:
        # Flight path is (anti)parallel to +z; pick North as the side axis.
        side_axis = np.array([0.0, 1.0, 0.0])
        side_axis = safe_unit(side_axis - float(np.dot(side_axis, v_hat)) * v_hat)
    else:
        side_axis = side_raw / float(np.linalg.norm(side_raw))
    lift_axis = np.cross(v_hat, side_axis)
    lift_axis = safe_unit(lift_axis)
    return -v_hat, side_axis, lift_axis


# ---------------------------------------------------------------------------
# The vehicle
# ---------------------------------------------------------------------------


@dataclass
class Vehicle:
    """
    @description A vehicle IS a set of force-producing elements in a moving fluid
        field. There is no aircraft class, no balloon class and no kite class:
        archetypes 1-4 are different `elements` lists over different `bodies`
        lists, which is the whole point of this module.
          1. Solar fixed-wing      -> [AeroSurface, Thruster, PVArray, Battery]
          2. Super-pressure balloon-> [BuoyancyVolume, PVArray, Battery]
          3. Tethered sky sailboat -> two bodies + [AeroSurface, AeroSurface,
                                      Tether] across a shear layer
          4. Dynamic soarer        -> [AeroSurface] flown through a shear field
    @param bodies Ordered list of BodyState; element.body_index indexes into it.
        Each body's mass_kg is read as its STRUCTURE mass and is overwritten with
        the derived all-up mass at construction (OBJECTION 5).
    @param elements Ordered list of ForceElement (and PairForceElement).
    @param mass_closure MASS_CLOSURE_DERIVED (default) or
        FIXED_TOTAL_MASS_OVERRIDE. The override warns loudly on every use and is
        for tests only.
    """

    bodies: list[BodyState]
    elements: list[ForceElement] = field(default_factory=list)
    mass_closure: str = MASS_CLOSURE_DERIVED

    def __post_init__(self) -> None:
        """
        @description Close the vehicle's mass at construction and audit the
            element list for undeclared mass. This runs BEFORE any force is
            evaluated, so nothing can ever read a pre-closure mass.
        """
        if self.mass_closure == FIXED_TOTAL_MASS_OVERRIDE:
            warnings.warn(
                "Vehicle mass_closure = FIXED_TOTAL_MASS_OVERRIDE: element masses "
                "(battery pack, PV array, motors, tether) are NOT being added to "
                "the body masses. This re-opens the free-energy-storage defect and "
                "must never be used in a design sweep.",
                FixedMassOverrideWarning,
                stacklevel=3,
            )
            return
        if self.mass_closure != MASS_CLOSURE_DERIVED:
            raise MassClosureError(
                f"mass_closure must be {MASS_CLOSURE_DERIVED!r} or "
                f"{FIXED_TOTAL_MASS_OVERRIDE!r}, got {self.mass_closure!r}"
            )
        self.bind_masses()
        unknown = undeclared_elements(self.elements)
        if unknown:
            names = ", ".join(sorted({type(e).__name__ for e in unknown}))
            warnings.warn(
                f"Vehicle mass closure is INCOMPLETE: {names} declare neither a "
                f"mass nor MASSLESS_BY_CONSTRUCTION, so their mass is unknown and "
                f"is being treated as absent from the budget. Undeclared is not "
                f"zero. Call Vehicle.assert_mass_declared() in a design sweep.",
                UndeclaredMassWarning,
                stacklevel=3,
            )

    # -- mass closure --------------------------------------------------------

    def element_mass_by_body_kg(self) -> np.ndarray:
        """
        @description Declared element mass carried by each body, kg.
        @returns Array shape (n_bodies,), kg. Elements that have not opted into
            the mass protocol contribute nothing here and are reported instead by
            `undeclared_element_names`.
        """
        return self.mass_budget().element_mass_by_body_kg()

    def bind_masses(self) -> np.ndarray:
        """
        @description Write structure + declared element mass into every body's
            mass_kg. Called automatically at construction and again by
            total_mass_kg / weight_N / gravity_forces_N, so a vehicle whose
            element list is mutated after construction cannot go stale.
            Idempotent: BodyState.set_total_mass_kg always recomputes from the
            preserved structure mass.
        @returns Array of per-body all-up masses, kg, shape (n_bodies,).
        """
        if self.mass_closure == FIXED_TOTAL_MASS_OVERRIDE:
            return np.array([float(b.mass_kg) for b in self.bodies], dtype=float)
        element_mass_kg = self.element_mass_by_body_kg()
        return np.array(
            [
                body.set_total_mass_kg(float(element_mass_kg[i]))
                for i, body in enumerate(self.bodies)
            ],
            dtype=float,
        )

    def mass_budget(self) -> MassBudget:
        """
        @description The vehicle's full mass statement: per-body structure mass,
            every declared element contribution with its derivation, and the
            names of any elements whose mass is unknown.
        @returns A MassBudget. `MassBudget.report()` prints it.
        """
        return build_mass_budget(
            structure_mass_kg=[float(b.structure_mass_kg) for b in self.bodies],
            elements=self.elements,
        )

    def undeclared_element_names(self) -> list[str]:
        """
        @description Class names of elements whose mass is unknown.
        @returns Sorted unique class names; empty when the budget is complete.
        """
        return sorted({type(e).__name__ for e in undeclared_elements(self.elements)})

    def assert_mass_declared(self, allow: Sequence[str] = ()) -> None:
        """
        @description Fail unless every element has either declared a mass or
            declared itself massless. THIS IS THE CALL A DESIGN SWEEP MUST MAKE:
            an element with unknown mass is an unbilled cost, and an optimizer
            finds every unbilled cost.
        @param allow Class names that are permitted to remain undeclared, for the
            case where a caller has accounted for them inside the structure mass
            and is prepared to say so explicitly.
        @raises UndeclaredMassError When any element outside `allow` is
            undeclared.
        """
        allowed = {str(name) for name in allow}
        offenders = sorted(
            {type(e).__name__ for e in undeclared_elements(self.elements)} - allowed
        )
        if offenders:
            raise UndeclaredMassError(
                f"elements with unknown mass: {', '.join(offenders)}. Give each a "
                f"DECLARES_MASS_CLOSURE = True plus a mass_kg, or set "
                f"MASSLESS_BY_CONSTRUCTION = True if it genuinely has no mass of "
                f"its own, or pass its name in allow=(...) to accept it as part of "
                f"the structure mass."
            )

    def net(
        self,
        atmo: "AtmoSample",
        wind: "WindSample",
        sol: "SolarSample",
        t_s: float,
        dt_s: float,
    ) -> tuple[np.ndarray, float]:
        """
        @description Sum every element into per-body forces and one net
            electrical power. Gravity is NOT included -- it is the integrator's
            job and depends on body mass, not on any element.

            Battery elements contribute exactly zero to the electrical total by
            design (OBJECTION 2): they are a buffer between generation and
            consumption, so counting them here would double-count. Use
            `step_batteries` to move energy into and out of them.

        @param atmo Local atmosphere sample at the vehicle's altitude.
        @param wind Local wind sample.
        @param sol Local solar sample.
        @param t_s Simulation time, s.
        @param dt_s Timestep, s.
        @returns (forces_N, net_electrical_power_W) where forces_N has shape
            (n_bodies, 3) in newtons (ENU) and the power is watts, positive when
            the vehicle generates more than it consumes.
        """
        n_bodies = len(self.bodies)
        forces_N = np.zeros((n_bodies, 3), dtype=float)
        net_power_W = 0.0

        for element in self.elements:
            pair_fn = getattr(element, "evaluate_pair", None)
            if pair_fn is not None:
                ef_a, ef_b = pair_fn(self.bodies, atmo, wind, sol, t_s, dt_s)
                forces_N[element.body_index] += ef_a.force_N
                forces_N[element.partner_index] += ef_b.force_N
                net_power_W += ef_a.power_elec_W + ef_b.power_elec_W
            else:
                ef = element.evaluate(self.bodies, atmo, wind, sol, t_s, dt_s)
                forces_N[element.body_index] += ef.force_N
                net_power_W += ef.power_elec_W

        return forces_N, float(net_power_W)

    @property
    def batteries(self) -> list:
        """
        @description Every BatteryElement attached to this vehicle, in order.
        @returns List of BatteryElement (duck-typed on the `step` method so this
            module does not import energy.py and create a cycle).
        """
        return [e for e in self.elements if hasattr(e, "capacity_J") and hasattr(e, "step")]

    def step_batteries(self, net_power_W: float, dt_s: float) -> float:
        """
        @description Push the vehicle's net electrical power into (or pull it out
            of) the battery bank over one timestep. Charge is shared equally by
            capacity across packs.
        @param net_power_W Net electrical power, W. Positive charges the bank.
        @param dt_s Timestep, s.
        @returns Unserved power, W: positive when generation could not be
            absorbed (bank full), negative when demand could not be met (bank
            empty). Zero means the bank handled it. The integrator treats a
            negative return as a closure failure.
        """
        packs = self.batteries
        if not packs:
            return float(net_power_W)
        total_capacity_J = sum(p.capacity_J for p in packs)
        if total_capacity_J <= 0.0:
            return float(net_power_W)
        unserved_W = 0.0
        for pack in packs:
            share = pack.capacity_J / total_capacity_J  # dimensionless 0..1
            unserved_W += pack.step(net_power_W * share, dt_s)
        return float(unserved_W)

    def total_mass_kg(self) -> float:
        """
        @description All-up mass, kg: every body's structure mass plus every
            declared element mass (battery packs, PV arrays, motors, tethers).
            Re-binds first, so it is correct even if the element list changed
            after construction. Excludes lifting gas and balloon film, which
            BuoyancyVolume carries in its force (see buoyancy.py).
        @returns Total mass, kg.
        """
        return float(np.sum(self.bind_masses()))

    def weight_N(self) -> float:
        """
        @description All-up weight, newtons, at standard gravity.
        @returns Weight, N.
        """
        return self.total_mass_kg() * G0_MS2

    def gravity_forces_N(self) -> np.ndarray:
        """
        @description Per-body gravitational force, ENU, newtons, on the DERIVED
            all-up masses. Provided so the integrator does not have to re-derive
            the sign convention.
        @returns Array shape (n_bodies, 3); each row is (0, 0, -m*g0).
        """
        masses_kg = self.bind_masses()
        out = np.zeros((len(self.bodies), 3), dtype=float)
        out[:, 2] = -masses_kg * G0_MS2
        return out


def moment_from_offset(offset_m: np.ndarray, force_N: np.ndarray) -> np.ndarray:
    """
    @description Moment of a force applied at an offset from the body reference
        point: M = r x F.
    @param offset_m Application point relative to the body reference, m, shape (3,).
    @param force_N Applied force, N, shape (3,).
    @returns Moment, N*m, shape (3,).
    """
    return np.cross(np.asarray(offset_m, dtype=float).reshape(3),
                    np.asarray(force_N, dtype=float).reshape(3))


def as_offset(offset_m: Sequence[float] | np.ndarray | None) -> np.ndarray:
    """
    @description Normalise an element offset argument to a (3,) float array.
    @param offset_m Offset in metres, or None for the body reference point.
    @returns Offset, m, shape (3,).
    """
    if offset_m is None:
        return np.zeros(3)
    return np.asarray(offset_m, dtype=float).reshape(3)
