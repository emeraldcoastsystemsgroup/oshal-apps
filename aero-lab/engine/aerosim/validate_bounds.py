"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation. The
  |                                           | INDEPENDENT half of the validation
  |                                           | gate: closed-form classical bounds that
  |                                           | never call the solver, plus a reference
  |                                           | trim implemented differently from the
  |                                           | integrator's. Replaces validate.py's
  |                                           | "level-flight power cross-check", which
  |                                           | was an algebraic identity: its worst
  |                                           | residual over 20,000 random draws was
  |                                           | 9.27e-16 against a 2.0e-2 threshold, and
  |                                           | doubling wing CD or inflating CL 1.5x
  |                                           | both passed it silently.
2 | maintainer@emeraldcoastsystemsgroup.com   | Family 5: US Standard Atmosphere 1976
  |                                           | density anchors (published table values,
  |                                           | independent of env.atmosphere), so the
  |                                           | gate can pin the air the case flies in.
  |                                           | Round 2 measured an air-density x2
  |                                           | corruption passing case B silently --
  |                                           | every dynamic check moved WITH the
  |                                           | corrupted density. A hand-typed table
  |                                           | value does not move.
3 | maintainer@emeraldcoastsystemsgroup.com   | Family 6: hand-typed WING-MASS anchor,
  |                                           | same pattern as the rho anchor. Round-4
  |                                           | lens probe M3 measured: corrupting
  |                                           | structure.WING_MASS_COEFF_KG x0.5 left
  |                                           | the WHOLE case-A gate green (wing billed
  |                                           | 1.146 kg instead of 2.293, absorbed by
  |                                           | the structure remainder). Every dynamic
  |                                           | check moved WITH the corrupted
  |                                           | coefficient; a hand-typed expected mass
  |                                           | keyed by planform does not move.
  |                                           | published_wing_mass_anchor_kg() +
  |                                           | WING_MASS_ANCHOR_TOLERANCE, consumed by
  |                                           | validate._solar_cruise_gate.

aerosim.validate_bounds -- checks that can actually fail.

WHY THIS MODULE EXISTS
-----------------------------------------------------------------------------
A cross-check is only worth its runtime if there is a mutation it catches. The
check it replaces compared

    P = 0.5 rho V^3 S CD          against       P = sqrt(2 W^3/(rho S)) / (CL^1.5/CD)

and once V = sqrt(2W/(rho S CL)) has been substituted those two expressions are
the SAME expression. It could not fail, and it did not: a doubled CD moved the
answer from 34.890 W to 69.780 W with the check still green, because both sides
moved together.

Everything here is INDEPENDENT of aeropolar in the strong sense: it is classical
closed-form aerodynamics (Prandtl lifting line, Blasius flat plate, Rankine-Froude
actuator disk, Betz) plus published flight-test numbers. If the solver's polar is
corrupted, these bounds do not move with it, so they go red.

THE FOUR FAMILIES
-----------------------------------------------------------------------------
  1. DRAG FLOOR (two-sided in effect).  No wing can have less drag than its own
     induced drag at e = 1 plus a fully-laminar flat plate plus its declared
     parasite drag. Catches CD halved and CL inflated.
  2. PUBLISHED-PERFORMANCE ANCHOR.  CL^1.5/CD implied by a real aircraft's
     MEASURED level-flight power. Catches CD doubled -- which the drag floor
     alone cannot see, because too much drag is physically legal.
  3. MOMENTUM-THEORY FLOORS.  Hover induced power and the Betz limit. Neither
     depends on any solver at all.
  4. REFERENCE TRIM.  A second, independently written implementation of the
     level-flight trim, used to cross-check the integrator's quasi-steady trim.
     Same physics, different algorithm and different code path: the integrator
     bisects a force balance through the element objects, this iterates a closed
     form. Agreement is evidence; disagreement is a bug in one of them.

CIRCULARITY, STATED PLAINLY
-----------------------------------------------------------------------------
The band this replaces -- cl15_over_cd in [18, 32] -- is the SAME band
aeropolar.py's own self-test asserts. Checking a module's output against the
module's own acceptance criterion proves nothing. Family 2 above is anchored on
AtlantikSolar's published level-flight electrical power instead, which aeropolar
has never seen.

=============================================================================
UNITS -- every quantity carries SI units in its name or comment.
  *_m metres, *_m2 square metres, *_ms m/s, *_N newtons, *_W watts, *_kg
  kilograms, *_Pas pascal-seconds, *_kgm3 kg/m^3, *_deg degrees.
  Dimensionless: CL, CD, Cf, Re, aspect_ratio, e_oswald, cl15_over_cd, all eta_*.
=============================================================================
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from . import aeropolar
from .env import atmosphere, reynolds

# --------------------------------------------------------------------------- #
# Constants -- every one sourced in its own comment                            #
# --------------------------------------------------------------------------- #

#: Blasius laminar flat-plate friction coefficient constant, dimensionless, in
#: Cf = BLASIUS_CF_CONST / sqrt(Re_chord). Exact from the Blasius similarity
#: solution (Schlichting, Boundary-Layer Theory, 8th ed., eq. 6.59): 1.328.
BLASIUS_CF_CONST: float = 1.328

#: Minimum wetted-area ratio, dimensionless: wetted area / planform area. A wing
#: of ZERO thickness still has two sides, so 2.0 is the hard floor. A real 12 %
#: section is nearer 2.05. Using 2.0 keeps the drag floor a strict lower bound.
MIN_WETTED_AREA_RATIO: float = 2.0

#: Maximum span efficiency, dimensionless. Prandtl: the elliptic lift
#: distribution minimises induced drag, giving e = 1.0. No planform beats it, so
#: CDi >= CL^2/(pi AR) is a strict lower bound. (Values above 1 quoted in the
#: literature are always "e" absorbing a non-quadratic CD0, not a span
#: efficiency.)
MAX_SPAN_EFFICIENCY: float = 1.0

#: Betz limit on the actuator-disk power coefficient, dimensionless: 16/27.
BETZ_LIMIT_CP: float = 16.0 / 27.0

#: AtlantikSolar AS-2 published level-flight ELECTRICAL power, W, at 6.93 kg.
#: Oettershagen et al., "Perpetual flight with a small solar-powered UAV",
#: J. Field Robotics 35(4), 2018 -- reported as ~40 W total electrical draw in
#: level cruise. Used only as an anchor with a wide tolerance; never as a target.
ATLANTIKSOLAR_LEVEL_FLIGHT_ELEC_W: float = 40.0

#: AtlantikSolar published avionics + payload draw, W (same source). Subtracted
#: from the total so the anchor prices PROPULSION alone.
ATLANTIKSOLAR_AVIONICS_W: float = 5.8


class BoundViolation(AssertionError):
    """Raised when a solver-derived quantity violates a closed-form physical bound."""


# --------------------------------------------------------------------------- #
# Family 1 -- the drag floor                                                   #
# --------------------------------------------------------------------------- #


def laminar_skin_friction_CD(reynolds_chord: float,
                             wetted_area_ratio: float = MIN_WETTED_AREA_RATIO) -> float:
    """Absolute minimum profile drag coefficient of a lifting surface.

    @description Blasius fully-laminar flat plate, both sides, referenced to
        PLANFORM area:  CD_f = (wetted/planform) * 1.328 / sqrt(Re_c).
        This is a strict lower bound on a real section's profile drag for three
        independent reasons, each of which only adds drag: (a) no real airfoil
        holds laminar flow to the trailing edge, (b) pressure/form drag is >= 0,
        (c) a low-Reynolds laminar separation bubble adds more still. Nothing in
        this expression comes from aeropolar or NeuralFoil.
    @param reynolds_chord Reynolds number on the mean chord, dimensionless, > 0.
    @param wetted_area_ratio Wetted area / planform area, dimensionless, >= 2.
    @returns Minimum profile CD on planform area, dimensionless.
    @raises ValueError On a non-positive Reynolds number.
    """
    if not math.isfinite(reynolds_chord) or reynolds_chord <= 0.0:
        raise ValueError(f"reynolds_chord must be > 0 and finite, got {reynolds_chord!r}")
    return float(wetted_area_ratio) * BLASIUS_CF_CONST / math.sqrt(float(reynolds_chord))


def induced_drag_floor_CD(CL: float, aspect_ratio: float,
                          e_oswald_max: float = MAX_SPAN_EFFICIENCY) -> float:
    """Minimum induced drag coefficient at a given lift coefficient.

    @description Prandtl lifting-line: CDi = CL^2 / (pi * AR * e), minimised at
        the elliptic distribution e = 1. A finite wing producing CL cannot shed
        less vortex drag than this, whatever its section or twist.
    @param CL Lift coefficient, dimensionless.
    @param aspect_ratio Span^2 / area, dimensionless, > 0.
    @param e_oswald_max Largest admissible span efficiency, dimensionless.
    @returns Minimum induced CD, dimensionless.
    @raises ValueError On a non-positive aspect ratio.
    """
    if not math.isfinite(aspect_ratio) or aspect_ratio <= 0.0:
        raise ValueError(f"aspect_ratio must be > 0 and finite, got {aspect_ratio!r}")
    return float(CL) ** 2 / (math.pi * float(aspect_ratio) * float(e_oswald_max))


def total_drag_floor_CD(
    CL: float,
    aspect_ratio: float,
    reynolds_chord: float,
    extra_CD0: float = 0.0,
    wetted_area_ratio: float = MIN_WETTED_AREA_RATIO,
) -> float:
    """Strict lower bound on a wing's total drag coefficient.

    @description CD >= CDi_elliptic + CD_laminar_flat_plate + extra_CD0. Every
        term is a separate physical mechanism and none can be negative, so the
        sum is a bound rather than a fit. `extra_CD0` is the design's OWN
        declared non-wing parasite drag: the vehicle carries a fuselage whether
        or not the polar remembers it.
    @param CL Lift coefficient, dimensionless.
    @param aspect_ratio Span^2 / area, dimensionless.
    @param reynolds_chord Reynolds number on the mean chord, dimensionless.
    @param extra_CD0 Declared non-wing parasite CD on wing area, dimensionless.
    @param wetted_area_ratio Wetted area / planform area, dimensionless.
    @returns Minimum admissible total CD, dimensionless.
    """
    return (
        induced_drag_floor_CD(CL, aspect_ratio)
        + laminar_skin_friction_CD(reynolds_chord, wetted_area_ratio)
        + max(0.0, float(extra_CD0))
    )


def max_endurance_parameter(
    CL: float,
    aspect_ratio: float,
    reynolds_chord: float,
    extra_CD0: float = 0.0,
    wetted_area_ratio: float = MIN_WETTED_AREA_RATIO,
) -> float:
    """Largest CL^1.5/CD physically attainable at this lift coefficient.

    @description The drag floor turned into an endurance-parameter ceiling:
        (CL^1.5/CD)_max = CL^1.5 / total_drag_floor_CD(CL, ...). A solver
        reporting more than this has invented lift or lost drag.
    @param CL Lift coefficient, dimensionless.
    @param aspect_ratio Span^2 / area, dimensionless.
    @param reynolds_chord Reynolds number on the mean chord, dimensionless.
    @param extra_CD0 Declared non-wing parasite CD, dimensionless.
    @param wetted_area_ratio Wetted area / planform area, dimensionless.
    @returns Ceiling on CL^1.5/CD, dimensionless.
    """
    floor_CD = total_drag_floor_CD(CL, aspect_ratio, reynolds_chord,
                                   extra_CD0, wetted_area_ratio)
    return float(CL) ** 1.5 / floor_CD


@dataclass(frozen=True)
class PolarBoundReport:
    """Result of bounding one solver-derived polar point against closed-form physics.

    @param CL Solver CL, dimensionless.
    @param CD Solver CD, dimensionless.
    @param cl15_over_cd Solver CL^1.5/CD, dimensionless.
    @param reynolds_chord Reynolds number the point was taken at, dimensionless.
    @param aspect_ratio Span^2/area, dimensionless.
    @param CD_induced_floor Elliptic induced drag floor, dimensionless.
    @param CD_friction_floor Laminar flat-plate friction floor, dimensionless.
    @param CD_total_floor Sum of every floor term plus extra_CD0, dimensionless.
    @param cl15_over_cd_ceiling Endurance-parameter ceiling, dimensionless.
    @param drag_margin CD / CD_total_floor, dimensionless. < 1 is a violation.
    @param ok True when no bound is violated.
    @param violations Human-readable violation strings, empty when ok.
    """

    CL: float
    CD: float
    cl15_over_cd: float
    reynolds_chord: float
    aspect_ratio: float
    CD_induced_floor: float
    CD_friction_floor: float
    CD_total_floor: float
    cl15_over_cd_ceiling: float
    drag_margin: float
    ok: bool
    violations: tuple[str, ...]


def bound_polar_point(
    CL: float,
    CD: float,
    cl15_over_cd: float,
    span_m: float,
    area_m2: float,
    reynolds_chord: float,
    extra_CD0: float = 0.0,
    wetted_area_ratio: float = MIN_WETTED_AREA_RATIO,
) -> PolarBoundReport:
    """Bound one solver-derived polar point against closed-form aerodynamics.

    @description THE replacement for the vacuous cross-check. Every number on
        the right-hand side comes from Prandtl and Blasius; none comes from the
        module under test. Mutating the polar therefore moves the left side only,
        and the comparison goes red.
    @param CL Solver-derived lift coefficient, dimensionless.
    @param CD Solver-derived drag coefficient, dimensionless.
    @param cl15_over_cd Solver-derived CL^1.5/CD, dimensionless.
    @param span_m Wing span, m.
    @param area_m2 Wing reference area, m^2.
    @param reynolds_chord Reynolds number on the mean chord, dimensionless.
    @param extra_CD0 Declared non-wing parasite CD on wing area, dimensionless.
    @param wetted_area_ratio Wetted area / planform area, dimensionless.
    @returns A PolarBoundReport; inspect ``ok`` and ``violations``.
    """
    aspect_ratio = float(span_m) ** 2 / float(area_m2)
    cdi = induced_drag_floor_CD(CL, aspect_ratio)
    cdf = laminar_skin_friction_CD(reynolds_chord, wetted_area_ratio)
    floor = cdi + cdf + max(0.0, float(extra_CD0))
    ceiling = float(CL) ** 1.5 / floor
    margin = float(CD) / floor if floor > 0.0 else float("inf")

    violations: list[str] = []
    if CL <= 0.0:
        violations.append(f"CL = {CL:.6g} is not positive; a cruising wing must lift")
    if CD < floor:
        violations.append(
            f"CD = {CD:.6g} is BELOW the closed-form floor {floor:.6g} "
            f"(induced {cdi:.6g} at e=1 + laminar plate {cdf:.6g} + declared "
            f"parasite {extra_CD0:.6g}). Either CL is inflated or CD is lost."
        )
    if cl15_over_cd > ceiling:
        violations.append(
            f"CL^1.5/CD = {cl15_over_cd:.6g} exceeds the closed-form ceiling "
            f"{ceiling:.6g} at CL = {CL:.4g}, AR = {aspect_ratio:.3g}, "
            f"Re = {reynolds_chord:.0f}"
        )
    # Self-consistency of the triple the solver returned (cheap, and it has
    # caught a mis-indexed best-endurance row before).
    if CD > 0.0:
        implied = float(CL) ** 1.5 / float(CD)
        if abs(implied - float(cl15_over_cd)) > 1e-6 * max(1.0, abs(implied)):
            violations.append(
                f"the solver's own triple is inconsistent: CL^1.5/CD from "
                f"(CL, CD) is {implied:.6g}, reported {cl15_over_cd:.6g}"
            )

    return PolarBoundReport(
        CL=float(CL), CD=float(CD), cl15_over_cd=float(cl15_over_cd),
        reynolds_chord=float(reynolds_chord), aspect_ratio=aspect_ratio,
        CD_induced_floor=cdi, CD_friction_floor=cdf, CD_total_floor=floor,
        cl15_over_cd_ceiling=ceiling, drag_margin=margin,
        ok=not violations, violations=tuple(violations),
    )


# --------------------------------------------------------------------------- #
# Family 2 -- the published-performance anchor                                 #
# --------------------------------------------------------------------------- #


def endurance_parameter_from_measured_power(
    weight_N: float,
    rho_kgm3: float,
    wing_area_m2: float,
    propulsive_electrical_power_W: float,
    eta_chain: float,
) -> float:
    """CL^1.5/CD implied by an aircraft's MEASURED level-flight power.

    @description Inverts the level-flight identity the other way round:

            P_aero = sqrt(2 W^3 / (rho S)) / (CL^1.5/CD)
        =>  CL^1.5/CD = sqrt(2 W^3 / (rho S)) / (P_elec * eta_chain)

        This is not circular with the solver: P_elec is a number a real aircraft
        flew on, measured with a watt-meter, and the rest is geometry and air. It
        gives the gate an anchor aeropolar has never seen, which is what makes a
        DOUBLED CD detectable -- excess drag is physically legal, so no floor can
        catch it, but it lands the aircraft far from its published performance.
    @param weight_N Vehicle weight, N.
    @param rho_kgm3 Air density at the measured cruise altitude, kg/m^3.
    @param wing_area_m2 Wing reference area, m^2.
    @param propulsive_electrical_power_W Measured PROPULSIVE electrical power, W
        (total draw minus avionics).
    @param eta_chain Propulsive chain efficiency, electrical to useful work,
        dimensionless in (0, 1].
    @returns Implied CL^1.5/CD, dimensionless.
    @raises ValueError On non-positive power or efficiency.
    """
    if propulsive_electrical_power_W <= 0.0:
        raise ValueError(
            f"propulsive_electrical_power_W must be > 0, got "
            f"{propulsive_electrical_power_W!r}"
        )
    if not (0.0 < eta_chain <= 1.0):
        raise ValueError(f"eta_chain must be in (0, 1], got {eta_chain!r}")
    p_aero_W = float(propulsive_electrical_power_W) * float(eta_chain)
    return math.sqrt(2.0 * float(weight_N) ** 3 / (float(rho_kgm3) * float(wing_area_m2))) / p_aero_W


# --------------------------------------------------------------------------- #
# Family 2b -- the astronomical harvest bound                                  #
# --------------------------------------------------------------------------- #

#: Solar constant, W/m^2. WMO / Duffie & Beckman value.
SOLAR_CONSTANT_WM2: float = 1367.0


def daily_extraterrestrial_insolation_J_m2(latitude_deg: float, day_of_year: int) -> float:
    """Daily solar energy on a horizontal surface ABOVE the atmosphere, J/m^2.

    @description Closed form, Duffie & Beckman "Solar Engineering of Thermal
        Processes" eq. 1.10.3:

            H0 = (86400/pi) Gsc E0 [ cos(phi) cos(dec) sin(ws) + ws sin(phi) sin(dec) ]

        with the eccentricity correction E0 = 1 + 0.033 cos(360 n/365), Cooper's
        declination, and the sunset hour angle ws = arccos(-tan phi tan dec) in
        RADIANS in the second term.

        This is PURE ASTRONOMY -- orbit geometry and spherical trigonometry, one
        closed expression, no atmosphere and no solar module. It is what makes a
        harvest check possible that does not consult the model being checked: it
        independently pins day length, declination, the sun's path and the cosine
        projection, all in a single number.
    @param latitude_deg Degrees north, positive north.
    @param day_of_year 1..365.
    @returns Daily extraterrestrial insolation on a horizontal plane, J/m^2.
    """
    phi = math.radians(float(latitude_deg))
    n = int(day_of_year)
    dec = math.radians(23.45 * math.sin(math.radians(360.0 * (284 + n) / 365.0)))
    e0 = 1.0 + 0.033 * math.cos(math.radians(360.0 * n / 365.0))
    cos_ws = -math.tan(phi) * math.tan(dec)
    ws_rad = math.acos(max(-1.0, min(1.0, cos_ws)))   # polar day/night clamped
    return (86400.0 / math.pi) * SOLAR_CONSTANT_WM2 * e0 * (
        math.cos(phi) * math.cos(dec) * math.sin(ws_rad)
        + ws_rad * math.sin(phi) * math.sin(dec)
    )


def effective_clearness_index(
    harvest_gross_J: float,
    gross_area_m2: float,
    packing_factor: float,
    cell_efficiency_stc: float,
    mppt_efficiency: float,
    latitude_deg: float,
    day_of_year: int,
) -> float:
    """The array's whole-day performance as a fraction of the astronomical ceiling.

    @description

            K_eff = harvest / (area * packing * eta_stc * eta_mppt * H0)

        One dimensionless number that bundles everything between the top of the
        atmosphere and the bus: atmospheric transmittance, air mass, the cell's
        temperature derate and any orientation loss. It is LINEAR in cell
        efficiency, packing and MPPT efficiency, which is exactly why it detects
        a factor-of-two error in any of them -- the closure verdict does not,
        because a design with large spill absorbs a halved harvest by spilling
        less (measured on case A: halving cell efficiency moved the usable margin
        only 1.1201 -> 1.0598 and the aircraft still closed).

        Values above 1.0 are legitimate and expected at altitude, where the cells
        run far below 25 C and the temperature coefficient works in their favour;
        case B measures about 1.2 at 20 km. Values above about 1.5 are not.
    @param harvest_gross_J Gross electrical energy the array produced, J.
    @param gross_area_m2 Array gross area, m^2.
    @param packing_factor Cell coverage fraction, dimensionless.
    @param cell_efficiency_stc Cell efficiency at STC, dimensionless.
    @param mppt_efficiency Tracker efficiency, dimensionless.
    @param latitude_deg Site latitude, degrees north.
    @param day_of_year 1..365.
    @returns K_eff, dimensionless.
    @raises ValueError When the denominator is not positive.
    """
    h0_J_m2 = daily_extraterrestrial_insolation_J_m2(latitude_deg, day_of_year)
    denom_J = (float(gross_area_m2) * float(packing_factor) * float(cell_efficiency_stc)
               * float(mppt_efficiency) * h0_J_m2)
    if denom_J <= 0.0:
        raise ValueError(
            f"effective_clearness_index needs a positive astronomical ceiling; got "
            f"area {gross_area_m2!r}, packing {packing_factor!r}, eta "
            f"{cell_efficiency_stc!r}, mppt {mppt_efficiency!r}, H0 {h0_J_m2!r}"
        )
    return float(harvest_gross_J) / denom_J


# --------------------------------------------------------------------------- #
# Family 3 -- momentum-theory floors                                           #
# --------------------------------------------------------------------------- #


def ideal_hover_power_W(thrust_N: float, rho_kgm3: float, disk_area_m2: float) -> float:
    """Irreducible induced power to hover, W.

    @description Rankine-Froude: P_ideal = T^1.5 / sqrt(2 rho A). Set by disk
        area alone -- no rotor quality, motor efficiency or control scheme
        reduces it. It is the floor that makes negative control C fail correctly,
        and it is computed here WITHOUT calling powerplant, so the two are an
        independent pair rather than one implementation checked against itself.
    @param thrust_N Total thrust, N, > 0.
    @param rho_kgm3 Air density, kg/m^3, > 0.
    @param disk_area_m2 Total rotor disk area, m^2, > 0.
    @returns Ideal induced power, W.
    @raises ValueError On non-positive inputs.
    """
    if thrust_N <= 0.0 or rho_kgm3 <= 0.0 or disk_area_m2 <= 0.0:
        raise ValueError(
            f"ideal_hover_power_W needs positive thrust_N/rho_kgm3/disk_area_m2, "
            f"got {thrust_N!r}, {rho_kgm3!r}, {disk_area_m2!r}"
        )
    return float(thrust_N) ** 1.5 / math.sqrt(2.0 * float(rho_kgm3) * float(disk_area_m2))


def assert_below_betz(cp: float) -> None:
    """Assert a power coefficient respects the Betz limit.

    @param cp Power coefficient, dimensionless.
    @raises BoundViolation When cp exceeds 16/27.
    """
    if float(cp) > BETZ_LIMIT_CP + 1e-12:
        raise BoundViolation(
            f"cp = {cp:.6g} exceeds the Betz limit {BETZ_LIMIT_CP:.6g}; no "
            f"actuator disk extracts more than 16/27 of the kinetic flux"
        )


# --------------------------------------------------------------------------- #
# Family 5 -- published-atmosphere anchors                                      #
# --------------------------------------------------------------------------- #

#: US Standard Atmosphere 1976 air density at selected geometric altitudes,
#: kg/m^3 -- HAND-TYPED TABLE VALUES from the published standard (NOAA/NASA/
#: USAF, "U.S. Standard Atmosphere, 1976", table 1), deliberately NOT computed
#: from env.atmosphere. That independence is the point: when a mutation
#: corrupts the model's density, every dynamic quantity (trim speed, Reynolds,
#: cruise power) moves WITH the corruption and no cross-check between them can
#: see it -- round 2 measured air-density x2 passing case B silently. A table
#: value from a book does not move. Keys are the exact design altitudes the
#: validation cases fly at.
USSA1976_RHO_KGM3: dict[float, float] = {
    0.0: 1.2250,        # sea level
    500.0: 1.1673,      # case A cruise altitude
    1000.0: 1.1117,     # case D altitude
    20000.0: 0.088910,  # case B cruise altitude (the project's stated invariant)
}

#: Fractional tolerance on the ISA density anchor, dimensionless. env.atmosphere
#: implements the same 1976 standard, so agreement should be ~1e-4; 1 % leaves
#: room for a deliberately different atmosphere model while still catching any
#: factor-of-interest error (a x2 is 100 sigma out).
ISA_RHO_TOLERANCE: float = 0.01


# --------------------------------------------------------------------------- #
# Family 6 -- the hand-typed wing-mass anchor                                   #
# --------------------------------------------------------------------------- #

#: Expected wing structural mass at anchored planforms, kg -- HAND-TYPED, the
#: same defense pattern as USSA1976_RHO_KGM3 and for the same reason: when the
#: structural model's coefficient is corrupted, every downstream quantity
#: (structure remainder, trim, margins) moves WITH it and the gate stays green
#: -- MEASURED (round-4 lens probe M3): structure.WING_MASS_COEFF_KG x0.5
#: billed the case-A wing at 1.146 kg and no check fired. This literal does
#: not move. Keyed by (span_m, area_m2); the value is the AS-2 anchor wing
#: (measured 2.543 kg structure minus the documented 0.25 kg pod/boom/tail
#: split -- see vehicle/structure.py) that the model is CALIBRATED to
#: reproduce at the default load factor, written here as a literal ON PURPOSE:
#: deriving it from the module under test would be circular.
WING_MASS_ANCHOR_KG: dict[tuple[float, float], float] = {
    (5.65, 1.72): 2.2926,   # AtlantikSolar AS-2 planform, n = 3.0
}

#: Fractional tolerance on the wing-mass anchor, dimensionless. The model is
#: calibrated to the anchor so agreement should be ~1e-4; 1 % leaves room for
#: a legitimate recalibration of the split while catching any
#: factor-of-interest corruption (x0.5 is 50 sigma out).
WING_MASS_ANCHOR_TOLERANCE: float = 0.01


def published_wing_mass_anchor_kg(span_m: float, area_m2: float) -> float | None:
    """Hand-typed anchor wing mass for a planform, or None when untabulated.

    @description Lookup only -- no model call and no interpolation. A planform
        between table rows returns None and the caller must SKIP the check
        visibly rather than fake an anchor by consulting the structural model
        under test.
    @param span_m Wing span, m.
    @param area_m2 Wing reference area, m^2.
    @returns Expected billed wing mass, kg, or None when the planform is not
        anchored.
    """
    return WING_MASS_ANCHOR_KG.get((float(span_m), float(area_m2)))


def published_isa_rho_kgm3(altitude_m: float) -> float | None:
    """Published USSA-1976 density at a case altitude, or None when untabulated.

    @description Lookup only -- no interpolation and no model call. A sweep
        altitude between table rows returns None, and the caller must SKIP the
        check visibly rather than fake an anchor by interpolating with the very
        model under test.
    @param altitude_m Geometric altitude, m.
    @returns Density, kg/m^3, or None when the altitude is not tabulated.
    """
    return USSA1976_RHO_KGM3.get(float(altitude_m))


# --------------------------------------------------------------------------- #
# Family 4 -- the reference trim (an independent second implementation)         #
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ReferenceTrim:
    """Level-flight trim solved by the reference implementation.

    @param CL Lift coefficient, dimensionless.
    @param CD Drag coefficient, dimensionless.
    @param cl15_over_cd CL^1.5/CD, dimensionless.
    @param alpha_deg Angle of attack at the best-endurance point, degrees.
    @param e_oswald Span efficiency reported by the solver, dimensionless.
    @param V_ms True airspeed, m/s.
    @param Re Reynolds number on the mean geometric chord, dimensionless.
    @param chord_m Mean geometric chord, m.
    @param P_aero_W Aerodynamic power required, W.
    @param n_iter Iterations used, dimensionless.
    """

    CL: float
    CD: float
    cl15_over_cd: float
    alpha_deg: float
    e_oswald: float
    V_ms: float
    Re: float
    chord_m: float
    P_aero_W: float
    n_iter: int


class ReferenceTrimError(RuntimeError):
    """Raised when the reference trim cannot be solved at all."""


def reference_trim(
    geometry: Any,
    weight_N: float,
    rho_kgm3: float,
    mu_Pas: float,
    extra_CD0: float,
    n_crit: float = 11.0,
    alpha_deg: np.ndarray | None = None,
    max_iter: int = 30,
    tol: float = 1.0e-8,
) -> ReferenceTrim:
    """Solve trimmed level flight by a route the integrator does not use.

    @description The integrator trims by BISECTING the vertical force balance of
        the assembled element objects at fixed incidence. This trims by iterating
        the closed form V = sqrt(2W/(rho S CL)) against the solver's
        best-endurance point. Same physics, different algorithm, different code:
        that is what makes agreement between the two informative rather than
        tautological.

        It is a REFERENCE, not a case ingredient. No validation vehicle is built
        from its output -- the vehicles are assembled from shipped elements and
        the integrator does its own trim. This exists purely to be compared
        against, and to supply the (CL, CD, Re) triple the closed-form bounds are
        applied to.
    @param geometry A vehicle.WingGeometry (planform + Kulfan weights).
    @param weight_N Vehicle weight, N.
    @param rho_kgm3 Air density, kg/m^3.
    @param mu_Pas Dynamic viscosity, Pa*s.
    @param extra_CD0 Non-wing parasite CD on wing area, dimensionless.
    @param n_crit Transition amplification exponent, dimensionless.
    @param alpha_deg Angle-of-attack sweep, degrees; defaults to -2..14 at 0.5.
    @param max_iter Iteration cap, dimensionless.
    @param tol Relative airspeed convergence tolerance, dimensionless.
    @returns The solved ReferenceTrim.
    @raises ReferenceTrimError When the solver certifies no valid point, or the
        iteration does not converge.
    """
    if alpha_deg is None:
        alpha_deg = np.arange(-2.0, 14.01, 0.5)
    area_m2 = float(geometry.area_m2)
    chord_m = area_m2 / float(geometry.span_m)

    V_ms = math.sqrt(2.0 * float(weight_N) / (float(rho_kgm3) * area_m2 * 1.0))
    CL = CD = cl15 = e_osw = alpha_star_deg = float("nan")
    converged = False
    used = 0
    for used in range(1, max_iter + 1):
        polar = aeropolar.wing_polar(
            span_m=float(geometry.span_m),
            area_m2=area_m2,
            taper_ratio=float(geometry.taper_ratio),
            sweep_deg=float(geometry.sweep_deg),
            twist_root_deg=float(geometry.twist_root_deg),
            twist_tip_deg=float(geometry.twist_tip_deg),
            kulfan_upper=np.asarray(geometry.kulfan_upper, dtype=float),
            kulfan_lower=np.asarray(geometry.kulfan_lower, dtype=float),
            leading_edge_weight=float(geometry.leading_edge_weight),
            TE_thickness=float(geometry.TE_thickness),
            alpha_deg=np.asarray(alpha_deg, dtype=float),
            V_ms=V_ms,
            rho_kgm3=float(rho_kgm3),
            mu_Pas=float(mu_Pas),
            n_crit=float(n_crit),
            extra_CD0=float(extra_CD0),
        )
        try:
            CL, CD, cl15 = aeropolar.best_endurance_point(polar)
        except Exception as exc:
            raise ReferenceTrimError(
                f"wing solver certified no valid point at V = {V_ms:.3f} m/s, "
                f"rho = {rho_kgm3:.5f} kg/m3, "
                f"Re ~ {reynolds(rho_kgm3, V_ms, chord_m, mu_Pas):.0f}: {exc}"
            ) from exc
        e_osw = float(getattr(polar, "e_oswald", float("nan")))
        cl_grid = np.asarray(polar.CL, dtype=float)
        valid = np.asarray(polar.valid, dtype=bool)
        idx = np.where(valid)[0]
        alpha_star_deg = float(
            np.degrees(np.asarray(polar.alpha_rad, dtype=float))[
                idx[int(np.argmin(np.abs(cl_grid[idx] - CL)))]
            ]
        ) if idx.size else float("nan")

        if not (CL > 0.0):
            raise ReferenceTrimError(f"best-endurance CL must be positive, got {CL}")
        V_new = math.sqrt(2.0 * float(weight_N) / (float(rho_kgm3) * area_m2 * float(CL)))
        converged = abs(V_new - V_ms) <= tol * max(1.0, V_ms)
        V_ms = 0.5 * V_ms + 0.5 * V_new
        if converged:
            break
    if not converged:
        raise ReferenceTrimError(
            f"reference trim did not converge in {max_iter} iterations "
            f"(last V = {V_ms:.6f} m/s)"
        )

    Re = float(reynolds(rho_kgm3, V_ms, chord_m, mu_Pas))
    P_aero_W = 0.5 * float(rho_kgm3) * V_ms ** 3 * area_m2 * float(CD)
    return ReferenceTrim(
        CL=float(CL), CD=float(CD), cl15_over_cd=float(cl15),
        alpha_deg=alpha_star_deg, e_oswald=e_osw, V_ms=float(V_ms), Re=Re,
        chord_m=chord_m, P_aero_W=P_aero_W, n_iter=used,
    )


def atlantiksolar_anchor_cl15_over_cd(
    weight_N: float,
    altitude_m: float,
    wing_area_m2: float,
    eta_chain: float,
) -> float:
    """CL^1.5/CD implied by AtlantikSolar's published 40 W level-flight draw.

    @description The gate's non-circular anchor for case A. See
        ATLANTIKSOLAR_LEVEL_FLIGHT_ELEC_W for the citation.
    @param weight_N As-flown weight, N.
    @param altitude_m Cruise altitude, m MSL.
    @param wing_area_m2 Wing area, m^2.
    @param eta_chain Propulsive chain efficiency, dimensionless.
    @returns Implied CL^1.5/CD, dimensionless.
    """
    rho_kgm3 = float(atmosphere(float(altitude_m)).rho_kgm3)
    return endurance_parameter_from_measured_power(
        weight_N=weight_N,
        rho_kgm3=rho_kgm3,
        wing_area_m2=wing_area_m2,
        propulsive_electrical_power_W=(
            ATLANTIKSOLAR_LEVEL_FLIGHT_ELEC_W - ATLANTIKSOLAR_AVIONICS_W
        ),
        eta_chain=eta_chain,
    )
