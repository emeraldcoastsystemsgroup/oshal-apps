"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | New module: the wing structural mass model. Stender-exponent regression calibrated to the measured AtlantikSolar AS-2 airframe, fail-closed geometry/load-factor envelope checks, and the explicit-mass floor. Closes round 2's worst defect: the massless airframe.
2 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4 floors. (a) wing_mass_kg now applies its OWN 0.4 kg/m2 areal-density floor to the DERIVED path: the S^0.778 regression extrapolated far above the 1.72 m2 calibration planform undercut the module's own explicit-mass floor (measured: 0.226 kg/m2 at 199.9 m2 / AR 4 -- a wing the module itself says has never existed, billed 45.28 kg instead of >= 79.96 kg). mass = max(regression, 0.4 * S): regression validity, not new physics. (b) min_fuselage_boom_tail_mass_kg(): the structural-remainder floor that kills the 1-gram fuselage (round-4 boundary rider) -- derived from what the pod/boom/tail must CARRY (pack + payload + propulsion) plus SPAN, anchored to the same AS-2 split the wing model is calibrated to (0.25 kg on 6.93 kg), with a 0.8 statistical-fit factor so honest builds slightly cleaner than the anchor still pass while a gram cannot.
3 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 (cleanup): min_extra_CD0() -- the shell/slender-body parasite-drag floor that replaces the screen's vacuous solid-composite-sphere bound. Measured: the sphere floor sat 60-200x below any flown airframe (case-A class: floor ~2e-5 vs the honest 0.006; riding 0.0025 -> 0.0001 on the R6 frontier ship bought +3.4% usable, +11% stacked). The sphere was a bound so "strict" it bounded nothing: a real fuselage is a SHELL around packed equipment (50-150 kg/m3 bulk density, not 1600 kg/m3 solid CFRP), slender (fineness ~3, wetting ~1.18x the equal-volume sphere), trailing a boom and tail sized to the SPAN (the same AS-2 pod/boom/tail split min_fuselage_boom_tail_mass_kg is anchored to, same 0.8 fit factor), holding at most ~half its run laminar (Raymer component-buildup practice), with form/interference >= 1.2 (Hoerner). Result for the case-A-class fuselage: floor 3.4e-3 against the honest 0.006 (factor ~1.8), instead of 2e-5 (factor ~300). Every coefficient sits at the credulous end of its cited band, so the floor remains a lower bound: it can only REFUSE more, never over-bill an honest build.
4 | maintainer@emeraldcoastsystemsgroup.com   | MATERIALS TIE-IN (SPEC_materials sections 2.4 and 3): check_wing_mass_floor() -- the strength+gauge bottom-up build-up (spar.bottom_up_wing_mass_floor_kg) applied as a FAIL-CLOSED floor on any claimed wing mass. The build-up measured 0.57x / 0.64x of this module's regression at the Tier-1 / AS-2 anchors (strength does not size these wings; stiffness + non-optimum mass do), so the REGRESSION STAYS AUTHORITATIVE and the build-up only REFUSES lighter claims, never discounts. gust_load_factor is re-exported from spar.py so the FAR-23 discrete-gust check is importable next to the load-factor envelope it interrogates (n = 3 covers only ~6-7 m/s derived gusts at these wing loadings; the mission layer must design to n = 4 or carry the placard -- DESIGN_LOAD_FACTOR_DEFAULT itself is UNCHANGED, walls never move as a side effect).

WHY THIS MODULE EXISTS
----------------------
Round 2's adversarial optimizer found the global optimum of the shipped code to
be a MASSLESS AIRFRAME: 20.71 m of span and 13.70 m^2 of wing at 1.012 kg (and
1e-6 kg accepted), because AeroSurface declared no mass and the one warning that
would have said so was suppressed. The gate then REWARDED growing span and area,
since both were free. This module makes wing geometry cost mass, with the
physics that owns it (bending strength and skin area), so nothing needs
suppressing.

THE MODEL
---------
    m_wing = C * n^0.311 * S^0.778 * AR^0.467        [kg; S in m^2]

The EXPONENTS are Stender's (1969) statistical regression over built sailplane
airframes, as used for solar-aircraft preliminary design by Rizzo & Frediani
("A model for solar powered aircraft preliminary design", The Aeronautical
Journal, 2004) and surveyed in Noth's thesis ("Design of Solar Powered Airplanes
for Continuous Flight", ETH Zurich, Diss. 17947, 2008). n is the design load
factor, S the wing area, AR the aspect ratio. At fixed area the mass grows as
AR^0.467 = (b^2/S)^0.467, i.e. b^0.934 -- strictly monotonic in span. That is
the bending penalty that kills the free-aspect-ratio exploit.

THE COEFFICIENT IS CALIBRATED TO THE ANCHOR, AND HERE IS THE ADMISSION
----------------------------------------------------------------------
The published Stender coefficient (8.763 with the result in newtons, i.e.
~0.893 kg) reproduces 1960s sailplane structures. Evaluated at the AtlantikSolar
AS-2 planform it predicts ~7.5 kg of wing; the MEASURED AS-2 airframe is
2.543 kg total structure (6.93 kg all-up minus the declared element masses).
Modern CFRP solar-UAV construction is roughly 3.3x lighter than the 1969
sailplane fleet at the same planform, so the coefficient C is CALIBRATED to the
anchor at import time (see WING_MASS_COEFF_KG below) and the published value is
not used. Only the exponents -- the SHAPE of the scaling -- are taken from the
literature. This is exactly the "if the regression and the anchor disagree,
calibrate the coefficient to the anchor and say so" rule.

WHY NOT NOTH'S m ~ b^3.1 * AR^-0.25 FAMILY: Noth's fit is over solar aircraft
almost all under ~6 m of span. Extrapolated to the round-2 winner (b = 20.7 m)
its b^3.1 term predicts ~113 kg of wing, where direct areal scaling of the
measured AS-2 airframe gives ~20 kg and classic b^3/S scaling ~16 kg. Outside
its data it explodes; Stender's S,AR form (calibrated on aircraft up to ~20 m
sailplane spans) extrapolates to this class credibly: ~15 kg for the winner,
inside the 15-25 kg band the anchor scalings bracket.

THE ANCHOR AND THE WING/FUSELAGE SPLIT (documented, as required)
----------------------------------------------------------------
AtlantikSolar AS-2 (Oettershagen et al., J. Field Robotics 35(4), 2018):
6.93 kg all-up, 1.72 m^2, 5.65 m span, AR 18.56. After the shipped element
masses (battery 2.917 kg, PV 0.994 kg, propulsion 0.076 kg, payload 0.150 kg)
the measured structure remainder is 2.543 kg. AS-2 is a pod-and-boom design:
one small avionics pod, a slim CFRP tail boom and small tail surfaces. 0.25 kg
(~10% of structure) is ALLOCATED to pod+boom+tail -- an engineering split, not
a catalogue value: the wing carries the battery internally and dominates the
build, and a quarter kilogram is the right order for a pod/boom/tail set on a
6.93 kg aircraft. The remaining 2.293 kg is the WING the model is calibrated
to. The case-A builder carries the 0.25 kg as its fuselage line.

EVERY PARAMETER IS RANGE-CHECKED (the round-3 governing invariant)
------------------------------------------------------------------
The regression is only valid where aircraft have actually been built, so its
inputs are fail-closed bounds, not advice:
  - aspect ratio  <= 40   (highest-AR solar/HALE aircraft flown: Helios at
                           30.9; the manned record, eta, is 51.3; nothing in
                           the calibration class exceeds ~31. AR 147.8 is not
                           "a heavy wing", it is outside engineering reality
                           and is REJECTED.)
  - span          <= 80 m (Helios HP03, 75.3 m, the largest solar aircraft
                           ever flown)
  - area          <= 200 m^2 (Helios, 183.6 m^2)
  - load factor   in [2, 10] (below 2 is beneath any credible gust envelope --
                           even transport-category limit load is 2.5; above 10
                           is beyond aerobatic practice)
  - explicit wing masses >= 0.4 kg/m^2 * S (the lightest complete airframe
                           ever flown, MIT Daedalus, was ~1.0 kg/m^2 all-in
                           over 30.8 m^2; a wing alone below 0.4 kg/m^2 has
                           never existed)
All checks raise MassClosureError. AeroSurface calls them at construction AND
on every mass read (its mass_kg is a re-deriving property), so an element built
by bypassing __init__, or mutated afterwards, is still caught the moment the
mass budget -- or the integrator via Vehicle.bind_masses -- reads it.
"""

from __future__ import annotations

import math

import numpy as np

from .mass import MassClosureError

# ---------------------------------------------------------------------------
# The anchor: AtlantikSolar AS-2, measured
# ---------------------------------------------------------------------------

#: AS-2 wingspan, m (Oettershagen et al. 2018).
ATLANTIKSOLAR_SPAN_M: float = 5.65

#: AS-2 wing reference area, m^2.
ATLANTIKSOLAR_AREA_M2: float = 1.72

#: AS-2 structure mass, kg: measured 6.93 kg all-up minus the shipped declared
#: element masses (battery + PV + propulsion + payload). This exact value is the
#: number the validation builder's structure line absorbed as a plug before this
#: module existed.
ATLANTIKSOLAR_STRUCTURE_KG: float = 2.542647551867219

#: Pod + tail boom + tail surfaces allocation, kg. ENGINEERING SPLIT (~10% of
#: structure), documented in the header: AS-2's fuselage is a small avionics pod
#: on a slim CFRP boom; the wing (which also houses the battery) dominates the
#: airframe. The case-A builder carries this as its fuselage line.
FUSELAGE_BOOM_TAIL_KG: float = 0.25

#: The wing mass the model is calibrated to, kg: structure minus pod/boom/tail.
ANCHOR_WING_MASS_KG: float = ATLANTIKSOLAR_STRUCTURE_KG - FUSELAGE_BOOM_TAIL_KG


# ---------------------------------------------------------------------------
# The regression: Stender exponents, anchor-calibrated coefficient
# ---------------------------------------------------------------------------

#: Load-factor exponent, dimensionless (Stender 1969 via Rizzo & Frediani 2004).
STENDER_EXP_LOAD_FACTOR: float = 0.311

#: Wing-area exponent, dimensionless (same source).
STENDER_EXP_AREA: float = 0.778

#: Aspect-ratio exponent, dimensionless (same source). At fixed area this is the
#: bending penalty: m ~ b^(2*0.467).
STENDER_EXP_ASPECT_RATIO: float = 0.467

#: Default design load factor, dimensionless. Solar HALE aircraft fly benign
#: profiles but must survive gust and manoeuvre loads; published solar-UAV
#: structural sizing works to a limit load factor of about 3 with gust margin
#: (Noth's thesis and the AtlantikSolar lineage descend from that practice).
DESIGN_LOAD_FACTOR_DEFAULT: float = 3.0

#: Published Stender coefficient, kg (8.763 with the result in newtons / g0).
#: NOT USED in the model -- kept so the calibration admission is checkable:
#: WING_MASS_COEFF_KG / STENDER_PUBLISHED_COEFF_KG ~ 0.31, i.e. modern CFRP
#: solar-UAV structure is ~3.3x lighter than the 1969 sailplane fleet fit.
STENDER_PUBLISHED_COEFF_KG: float = 8.763 / 9.80665

#: The model coefficient C, kg, CALIBRATED so that the anchor planform at the
#: default load factor returns exactly ANCHOR_WING_MASS_KG. Derived at import --
#: never a hand-typed literal, so it cannot drift from the anchor constants.
WING_MASS_COEFF_KG: float = ANCHOR_WING_MASS_KG / (
    DESIGN_LOAD_FACTOR_DEFAULT ** STENDER_EXP_LOAD_FACTOR
    * ATLANTIKSOLAR_AREA_M2 ** STENDER_EXP_AREA
    * (ATLANTIKSOLAR_SPAN_M ** 2 / ATLANTIKSOLAR_AREA_M2) ** STENDER_EXP_ASPECT_RATIO
)


# ---------------------------------------------------------------------------
# The validity envelope -- fail-closed bounds, not advice
# ---------------------------------------------------------------------------

#: Ceiling on structural aspect ratio, dimensionless. Highest-AR solar/HALE
#: aircraft flown is Helios (30.9); the manned sailplane record (eta) is 51.3.
#: 40 covers everything in the calibration class with margin; beyond it the
#: regression has no data and the answer is rejection, not extrapolation.
MAX_STRUCTURAL_ASPECT_RATIO: float = 40.0

#: Ceiling on span, m. Helios HP03 (75.3 m) is the largest solar aircraft flown.
MAX_WING_SPAN_M: float = 80.0

#: Ceiling on wing area, m^2. Helios: 183.6 m^2.
MAX_WING_AREA_M2: float = 200.0

#: Floor / ceiling on design load factor, dimensionless. Below 2 is beneath any
#: credible gust envelope (transport-category limit load is 2.5); above 10 is
#: beyond aerobatic practice. The floor matters: n is a constructor parameter an
#: optimizer can turn DOWN to discount the wing.
MIN_DESIGN_LOAD_FACTOR: float = 2.0
MAX_DESIGN_LOAD_FACTOR: float = 10.0

#: Floor on the areal density an EXPLICIT wing mass may imply, kg/m^2. The
#: lightest complete airframe ever flown (MIT Daedalus: ~31 kg over 30.8 m^2)
#: was ~1.0 kg/m^2 all-in; the anchor wing is 1.33 kg/m^2. A claimed wing below
#: 0.4 kg/m^2 has never existed and is rejected, so the explicit-mass escape
#: hatch cannot be used to rebuild the massless airframe.
MIN_WING_AREAL_DENSITY_KG_M2: float = 0.4


class ExplicitWingMassWarning(UserWarning):
    """
    @description Emitted every time an AeroSurface is given an explicit mass
        instead of deriving it from the structural model. The hatch exists for
        tests pinning a mass; it never happens quietly, and the message carries
        the model's own prediction so a discount is visible in the log.
    """


# ---------------------------------------------------------------------------
# Range checks (construction AND spec-extraction reuse the same functions)
# ---------------------------------------------------------------------------


def check_design_load_factor(load_factor: float) -> float:
    """
    @description Validate a design load factor against engineering practice.
        FAIL-CLOSED: n is a constructor parameter, so an unbounded n is either a
        free wing (n -> 0) or an accidental battleship (n -> 1e6 unit error).
    @param load_factor Design limit load factor, dimensionless.
    @returns The same value as a float when credible.
    @raises MassClosureError Outside [MIN_DESIGN_LOAD_FACTOR,
        MAX_DESIGN_LOAD_FACTOR] or non-finite.
    """
    n = float(load_factor)
    if not np.isfinite(n) or not (MIN_DESIGN_LOAD_FACTOR <= n <= MAX_DESIGN_LOAD_FACTOR):
        raise MassClosureError(
            f"design load factor {load_factor!r} is outside the credible band "
            f"[{MIN_DESIGN_LOAD_FACTOR:g}, {MAX_DESIGN_LOAD_FACTOR:g}]. Below "
            f"{MIN_DESIGN_LOAD_FACTOR:g} is beneath any flyable gust envelope "
            f"(transport-category limit load is 2.5), and turning n down is a "
            f"wing-mass discount an optimizer will always take."
        )
    return n


def check_wing_structure_envelope(
    span_m: float, area_m2: float, load_factor: float = DESIGN_LOAD_FACTOR_DEFAULT
) -> tuple[float, float, float, float]:
    """
    @description Validate a wing planform against the structural model's
        validity envelope. This is THE guard both paths share: AeroSurface calls
        it at construction and on every mass read, and the integrator's
        spec-extraction can call it directly, so an element built by bypassing
        __init__ is still caught (round-3 defense in depth).
    @param span_m Full span b, m.
    @param area_m2 Reference area S, m^2.
    @param load_factor Design limit load factor, dimensionless.
    @returns (span_m, area_m2, aspect_ratio, load_factor) as validated floats.
    @raises MassClosureError When any input is non-finite, non-positive, or
        outside the demonstrated envelope (see the module constants).
    """
    b = float(span_m)
    s = float(area_m2)
    if not np.isfinite(b) or b <= 0.0:
        raise MassClosureError(f"span_m must be a positive finite number, got {span_m!r}")
    if not np.isfinite(s) or s <= 0.0:
        raise MassClosureError(f"area_m2 must be a positive finite number, got {area_m2!r}")
    if b > MAX_WING_SPAN_M:
        raise MassClosureError(
            f"span_m = {b:g} m exceeds the {MAX_WING_SPAN_M:g} m envelope ceiling "
            f"(Helios HP03, the largest solar aircraft flown, spanned 75.3 m)."
        )
    if s > MAX_WING_AREA_M2:
        raise MassClosureError(
            f"area_m2 = {s:g} m2 exceeds the {MAX_WING_AREA_M2:g} m2 envelope "
            f"ceiling (Helios: 183.6 m2)."
        )
    aspect_ratio = b * b / s
    if aspect_ratio > MAX_STRUCTURAL_ASPECT_RATIO:
        raise MassClosureError(
            f"aspect ratio {aspect_ratio:.1f} (b = {b:g} m, S = {s:g} m2) exceeds "
            f"the fail-closed structural ceiling of "
            f"{MAX_STRUCTURAL_ASPECT_RATIO:g}. The highest-AR solar/HALE aircraft "
            f"flown is Helios at 30.9 and the manned record is 51.3; the wing-mass "
            f"regression has no data beyond this and a hair-thin 45 m spar is not "
            f"a design, it is an optimizer exploit. REJECTED, not billed."
        )
    n = check_design_load_factor(load_factor)
    return b, s, aspect_ratio, n


def wing_mass_kg(
    span_m: float,
    area_m2: float,
    load_factor: float = DESIGN_LOAD_FACTOR_DEFAULT,
) -> float:
    """
    @description Structural mass of one wing, kg:

            m = C * n^0.311 * S^0.778 * AR^0.467

        Stender exponents, coefficient calibrated to the measured AtlantikSolar
        AS-2 airframe (see the module header for the derivation, the sources and
        the calibration admission). Monotonically increasing in span at fixed
        area (m ~ b^0.934), which is the bending penalty; range-checked against
        the envelope of aircraft that have actually been built.

    @param span_m Full tip-to-tip span b, m.
    @param area_m2 Reference (planform) area S, m^2.
    @param load_factor Design limit load factor n, dimensionless. Default
        DESIGN_LOAD_FACTOR_DEFAULT (3.0, the HALE gust-margin value).
    @returns Wing structural mass, kg, > 0.
    @raises MassClosureError When the planform or load factor is outside the
        validity envelope (fail-closed; see check_wing_structure_envelope).
    """
    b, s, aspect_ratio, n = check_wing_structure_envelope(span_m, area_m2, load_factor)
    regression_kg = (
        WING_MASS_COEFF_KG
        * n ** STENDER_EXP_LOAD_FACTOR
        * s ** STENDER_EXP_AREA
        * aspect_ratio ** STENDER_EXP_ASPECT_RATIO
    )
    # ROUND-4 FLOOR: the same 0.4 kg/m2 areal-density floor the EXPLICIT path
    # enforces applies to the DERIVED path too. The S^0.778 exponent means the
    # implied areal density falls as S^-0.222, and from S ~ 25 m2 (at low AR)
    # the regression -- calibrated at 1.72 m2 -- drops below the lightest
    # airframe density that has ever existed (measured: 0.226 kg/m2 at
    # 199.9 m2 / AR 4). Outside its data the regression is a lower-quality
    # estimate than the demonstrated-hardware floor, so the floor wins. This is
    # a statement about regression VALIDITY, not new physics, and it can only
    # INCREASE the billed mass -- no band is loosened.
    return max(regression_kg, MIN_WING_AREAL_DENSITY_KG_M2 * s)


def check_explicit_wing_mass_kg(mass_kg: float, area_m2: float) -> float:
    """
    @description Validate an EXPLICITLY specified wing mass against the lightest
        structure that has ever flown. The explicit path is a declared opt-out
        of the derived model (for tests pinning a mass), and the round-3
        invariant says an opt-out must still be range-checked -- otherwise
        mass_kg = 1e-6 rebuilds the massless airframe one argument over.
    @param mass_kg Claimed wing mass, kg.
    @param area_m2 The wing's reference area, m^2 (for the areal-density floor).
    @returns The same mass, as a float, when credible.
    @raises MassClosureError Non-finite, non-positive, or below
        MIN_WING_AREAL_DENSITY_KG_M2 * area_m2.
    """
    m = float(mass_kg)
    s = float(area_m2)
    if not np.isfinite(m) or m <= 0.0:
        raise MassClosureError(
            f"explicit wing mass_kg must be a positive finite number, got {mass_kg!r}"
        )
    floor_kg = MIN_WING_AREAL_DENSITY_KG_M2 * s
    if m < floor_kg:
        raise MassClosureError(
            f"explicit wing mass {m:g} kg over {s:g} m2 is "
            f"{m / s if s > 0 else float('nan'):.3f} kg/m2, below the "
            f"{MIN_WING_AREAL_DENSITY_KG_M2:g} kg/m2 floor ({floor_kg:.3f} kg for "
            f"this area). The lightest complete airframe ever flown (MIT "
            f"Daedalus) was ~1.0 kg/m2 all-in; no wing at this density has ever "
            f"existed. Use the derived model (mass_kg=None) or claim a real mass."
        )
    return m


# ---------------------------------------------------------------------------
# ROUND 4: the fuselage/boom/tail remainder floor
# ---------------------------------------------------------------------------

#: AS-2 mass CARRIED by the pod/boom/tail, kg: battery 2.917 + payload 0.150 +
#: propulsion 0.076 (Oettershagen et al. 2018 element masses, the same set the
#: structure remainder above is derived from). The pod houses the avionics and
#: reacts the pack/payload/motor loads; the boom and tail scale with span.
AS2_CARRIED_MASS_KG: float = 3.143

#: Pod mass as a fraction of carried mass, dimensionless -- HALF the AS-2
#: pod/boom/tail allocation attributed to the carried-mass-scaled pod:
#: (0.5 * 0.25 kg) / 3.143 kg. An engineering split of the same documented
#: 0.25 kg the wing calibration uses; derived at import, never hand-typed.
MIN_POD_MASS_FRACTION_OF_CARRIED: float = (
    0.5 * FUSELAGE_BOOM_TAIL_KG / AS2_CARRIED_MASS_KG
)

#: Boom + tail linear density floor, kg per metre of SPAN -- the other half of
#: the AS-2 allocation over its 5.65 m span: (0.5 * 0.25) / 5.65 kg/m. A tail
#: boom's length (and the tail area it carries) scales with the wing span it
#: has to stabilise.
MIN_BOOM_TAIL_KG_PER_M_SPAN: float = 0.5 * FUSELAGE_BOOM_TAIL_KG / ATLANTIKSOLAR_SPAN_M

#: Statistical-fit factor on the floor, dimensionless. The AS-2 fraction is ONE
#: family point, not a strict physical bound, so the floor admits builds up to
#: 20 % cleaner than the anchor (and the anchor itself, which sits exactly ON
#: the un-factored estimate by construction). It does not admit a 1-gram
#: fuselage: the round-4 boundary rider's floor is ~0.17 kg, 170x its claim.
FUSELAGE_FLOOR_FIT_FACTOR: float = 0.8


def min_fuselage_boom_tail_mass_kg(carried_mass_kg: float, span_m: float) -> float:
    """
    @description Floor on the fuselage/boom/tail structural REMAINDER, kg --
        the round-4 answer to the 1-gram fuselage. A pod that houses a pack, a
        payload and a motor, plus a boom and tail sized to the span, cannot
        weigh nothing:

            floor = 0.8 * (0.0398 * m_carried + 0.0221 kg/m * b)

        with both coefficients derived at import from the SAME documented
        AtlantikSolar 0.25 kg pod/boom/tail split the wing-mass calibration
        uses (see the module header and FUSELAGE_BOOM_TAIL_KG). The 0.8 factor
        is the statistical-fit allowance documented on
        FUSELAGE_FLOOR_FIT_FACTOR.
    @param carried_mass_kg Mass the fuselage must carry, kg: battery + payload
        + propulsion element masses (NOT wing or PV, which the wing carries).
    @param span_m Wing span, m (sizes the boom and tail).
    @returns The floor, kg, > 0.
    @raises MassClosureError On non-finite or negative inputs.
    """
    m = float(carried_mass_kg)
    b = float(span_m)
    if not np.isfinite(m) or m < 0.0:
        raise MassClosureError(
            f"carried_mass_kg must be >= 0 and finite, got {carried_mass_kg!r}"
        )
    if not np.isfinite(b) or b <= 0.0:
        raise MassClosureError(f"span_m must be > 0 and finite, got {span_m!r}")
    return FUSELAGE_FLOOR_FIT_FACTOR * (
        MIN_POD_MASS_FRACTION_OF_CARRIED * m + MIN_BOOM_TAIL_KG_PER_M_SPAN * b
    )


# ---------------------------------------------------------------------------
# ROUND 5: the extra_CD0 shell/slender-body floor
# ---------------------------------------------------------------------------

#: Bulk packaging density of a loaded equipment pod, kg/m^3 -- the DENSE end of
#: the realistic band, so the enclosed volume (and hence the wetted area and
#: the floor built on it) is a strict MINIMUM. Conceptual-design practice puts
#: packed-fuselage / equipment-bay bulk densities at roughly 50-150 kg/m^3
#: (Raymer, "Aircraft Design: A Conceptual Approach", fuselage volume sizing;
#: a loaded GA fuselage runs ~100-140 kg/m^3). The retired bound used SOLID
#: CFRP at 1600 kg/m^3 -- a fuselage that is one solid billet of laminate has
#: never been built, which is exactly why that floor bounded nothing.
POD_PACKAGING_DENSITY_KG_M3: float = 150.0

#: Surface area of the MINIMUM-surface body (a sphere) per V^(2/3),
#: dimensionless: (36*pi)^(1/3) = 4.836. Isoperimetric inequality -- no closed
#: shell enclosing volume V has less surface, so this term is exact, not fit.
SPHERE_AREA_PER_V23: float = (36.0 * math.pi) ** (1.0 / 3.0)

#: Wetted-area penalty of a SLENDER pod over the equal-volume sphere,
#: dimensionless. Real pods are streamlined bodies of revolution, not spheres:
#: Hoerner ("Fluid-Dynamic Drag", ch. 6) puts the minimum-drag fineness ratio
#: at ~2.5-4; a prolate spheroid at fineness 3 wets 1.18x the equal-volume
#: sphere (closed-form surface ratio, derived not fitted). Using the SPHERE
#: alone would credit a shape no one flies; 1.18 is the low end of slender.
POD_SLENDER_WETTED_FACTOR: float = 1.18

#: AS-2 tail-boom diameter, m, and boom length as a fraction of span -- the
#: slim CFRP boom of the anchor aircraft (~30 mm tube, ~2.0 m on the 5.65 m
#: span). Same documented pod-and-boom configuration the mass split above is
#: anchored to.
AS2_BOOM_DIAMETER_M: float = 0.03
AS2_BOOM_LENGTH_FRACTION_OF_SPAN: float = 0.36

#: Tail planform as a fraction of wing area, dimensionless, and wetted area
#: per unit tail planform (both sides). ~15 % of S for a conventional
#: horizontal+vertical tail set is the low end of sailplane/solar-UAV practice
#: (tail volume coefficients V_H ~ 0.3-0.5, V_v ~ 0.02-0.04 at these tail
#: arms; Raymer's tables); a thin section wets ~2x its planform.
AS2_TAIL_AREA_FRACTION_OF_WING: float = 0.15
TAIL_WETTED_PER_PLANFORM: float = 2.0

#: Boom + tail wetted area per metre of SPAN, m^2/m, DERIVED at import from
#: the AS-2 boom/tail geometry above (boom pi*d*L + tail fraction of the
#: anchor wing, both referenced to the anchor span) with the SAME 0.8
#: statistical-fit factor the fuselage mass floor carries -- builds slightly
#: cleaner than the anchor pass, a bare wing with no tail cannot.
BOOM_TAIL_WETTED_M2_PER_M_SPAN: float = FUSELAGE_FLOOR_FIT_FACTOR * (
    math.pi * AS2_BOOM_DIAMETER_M
    * AS2_BOOM_LENGTH_FRACTION_OF_SPAN * ATLANTIKSOLAR_SPAN_M
    + TAIL_WETTED_PER_PLANFORM
    * AS2_TAIL_AREA_FRACTION_OF_WING * ATLANTIKSOLAR_AREA_M2
) / ATLANTIKSOLAR_SPAN_M

#: Largest fraction of the pod/boom run that may be credited as LAMINAR,
#: dimensionless. Component-buildup practice (Raymer ch. 12) assumes bodies
#: mostly turbulent; even sailplane-quality pods behind a propeller and under
#: a wing hold laminar flow over at most ~half their run. The retired floor
#: assumed 100 % laminar EVERYWHERE -- one more factor of ~3 of vacuity.
LAMINAR_RUN_FRACTION_MAX: float = 0.5

#: Blasius laminar flat-plate friction: Cf = 1.328 / sqrt(Re).
BLASIUS_CF_CONST: float = 1.328

#: Prandtl turbulent flat-plate friction: Cf = 0.074 * Re^(-1/5).
PRANDTL_TURBULENT_CF_CONST: float = 0.074

#: Floor on the combined form + interference factor, dimensionless. Hoerner's
#: streamlined-body form factor 1 + 60/f^3 + f/400 is ~1.17 at fineness 3, and
#: wing/body + boom junctions cost >= 5 % more (Raymer's component-buildup
#: interference factors start at 1.05); 1.2 is the floor of the product.
FORM_INTERFERENCE_FACTOR_MIN: float = 1.2


def min_extra_CD0(
    carried_mass_kg: float,
    span_m: float,
    wing_area_m2: float,
    reynolds: float,
) -> float:
    """
    @description Floor on the extra parasite-drag coefficient (referenced to
        wing area) that the non-wing airframe of a design MUST declare -- the
        round-5 replacement for the vacuous solid-composite-sphere bound.
        A pod that packs the pack/payload/drive at a realistic bulk density
        (50-150 kg/m^3; the dense end is used so the volume is a minimum),
        shaped as the minimum-surface shell times the slender-body factor,
        plus a boom and tail sized to the span by the SAME AS-2 split the
        fuselage mass floor uses, dragged at a half-laminar/half-turbulent
        flat-plate Cf with the Hoerner form/interference floor:

            V_pod   = m_carried / 150
            S_pod   = 4.836 * V_pod^(2/3) * 1.18
            S_bt    = 0.100 * b                       [AS-2-derived, 0.8-fit]
            Cf      = 0.5 * 1.328/sqrt(Re) + 0.5 * 0.074/Re^0.2
            floor   = 1.2 * Cf * (S_pod + S_bt) / S_wing

        Case-A class (3.14 kg carried, 5.65 m span, 1.72 m^2, Re 1.8e5) lands
        at ~3.4e-3 -- factor ~1.8 below the AS-2-honest 0.006, where the
        sphere bound sat at ~2e-5 (factor ~300, i.e. no floor at all).
    @param carried_mass_kg Mass the pod must enclose, kg: battery + payload +
        propulsion element masses (the same carried set screen #10 feeds
        min_fuselage_boom_tail_mass_kg).
    @param span_m Wing span, m (sizes the boom and tail).
    @param wing_area_m2 Reference wing area the coefficient is normalised by,
        m^2.
    @param reynolds Cruise Reynolds number on the wing reference chord,
        dimensionless (the screen passes its reference trim's Re).
    @returns The extra_CD0 floor, dimensionless, > 0.
    @raises MassClosureError On non-finite or non-positive inputs (a floor
        evaluated on junk would fail open).
    """
    m = float(carried_mass_kg)
    b = float(span_m)
    s = float(wing_area_m2)
    re = float(reynolds)
    if not np.isfinite(m) or m < 0.0:
        raise MassClosureError(
            f"carried_mass_kg must be >= 0 and finite, got {carried_mass_kg!r}"
        )
    if not np.isfinite(b) or b <= 0.0:
        raise MassClosureError(f"span_m must be > 0 and finite, got {span_m!r}")
    if not np.isfinite(s) or s <= 0.0:
        raise MassClosureError(
            f"wing_area_m2 must be > 0 and finite, got {wing_area_m2!r}"
        )
    if not np.isfinite(re) or re <= 0.0:
        raise MassClosureError(
            f"reynolds must be > 0 and finite, got {reynolds!r}"
        )
    pod_volume_m3 = m / POD_PACKAGING_DENSITY_KG_M3
    pod_wetted_m2 = (
        SPHERE_AREA_PER_V23 * pod_volume_m3 ** (2.0 / 3.0)
        * POD_SLENDER_WETTED_FACTOR
    )
    boom_tail_wetted_m2 = BOOM_TAIL_WETTED_M2_PER_M_SPAN * b
    cf_laminar = BLASIUS_CF_CONST / math.sqrt(re)
    cf_turbulent = PRANDTL_TURBULENT_CF_CONST / re ** 0.2
    cf = (
        LAMINAR_RUN_FRACTION_MAX * cf_laminar
        + (1.0 - LAMINAR_RUN_FRACTION_MAX) * cf_turbulent
    )
    return (
        FORM_INTERFERENCE_FACTOR_MIN
        * cf * (pod_wetted_m2 + boom_tail_wetted_m2) / s
    )


# ---------------------------------------------------------------------------
# MATERIALS TIE-IN (change-log 4): the bottom-up floor hook + the gust check
# ---------------------------------------------------------------------------

from .spar import bottom_up_wing_mass_floor_kg, gust_load_factor  # noqa: E402,F401
# gust_load_factor is re-exported on purpose: the FAR-23 discrete-gust number
# that decides whether DESIGN_LOAD_FACTOR_DEFAULT is enough belongs beside
# the load-factor envelope this module enforces. See spar.py for the formula
# and the U_de constants (14 CFR 23.341 / 23.333(c)).


def check_wing_mass_floor(
    mass_kg: float,
    span_m: float,
    area_m2: float,
    aum_kg: float,
    n_limit: float,
) -> float:
    """
    @description FAIL-CLOSED floor: REFUSE a wing lighter than its own
        strength + gauge bottom-up build-up (SPEC_materials 2.4). The
        build-up is a structural LOWER BOUND -- it omits the stiffness and
        non-optimum mass that actually size wings of this class (it measured
        0.57x / 0.64x of the Stender regression at the Tier-1 / AS-2
        anchors), so it must NEVER be used to discount the regression; it
        exists only to reject a claimed wing that could not even be built to
        strength and minimum gauge. Both numbers are reported by the mass
        audit; movement between them is explained, not absorbed.
    @param mass_kg Claimed wing mass, kg.
    @param span_m Full span b, m.
    @param area_m2 Planform area S, m^2.
    @param aum_kg All-up mass the load factor applies to, kg.
    @param n_limit Design limit load factor, dimensionless.
    @returns The same mass, as a float, when it clears the floor.
    @raises MassClosureError When the claimed wing undercuts its own
        build-up floor (or on junk inputs, via the build-up's own bounds).
    """
    m = float(mass_kg)
    if not np.isfinite(m) or m <= 0.0:
        raise MassClosureError(
            f"check_wing_mass_floor: mass_kg must be a positive finite "
            f"number, got {mass_kg!r}")
    floor_kg = bottom_up_wing_mass_floor_kg(span_m, area_m2, aum_kg, n_limit)
    if m < floor_kg * (1.0 - 1.0e-9):
        raise MassClosureError(
            f"wing mass {m:g} kg over b = {span_m:g} m / S = {area_m2:g} m2 "
            f"at n = {n_limit:g} undercuts its OWN strength+gauge build-up "
            f"floor of {floor_kg:.3f} kg (gauge-limited CF spar + ribs + "
            f"D-box + film + 18% assembly overhead, SPEC_materials 2.4). A "
            f"wing lighter than its own bill of materials cannot be built; "
            f"the Stender regression remains the authoritative estimate."
        )
    return m


# ---------------------------------------------------------------------------
# Import-time anchor self-check: the calibration cannot silently drift
# ---------------------------------------------------------------------------

_anchor_model_kg = wing_mass_kg(
    ATLANTIKSOLAR_SPAN_M, ATLANTIKSOLAR_AREA_M2, DESIGN_LOAD_FACTOR_DEFAULT
)
if abs(_anchor_model_kg - ANCHOR_WING_MASS_KG) > 1.0e-9 * ANCHOR_WING_MASS_KG:
    raise MassClosureError(  # pragma: no cover - only reachable by editing constants
        f"wing mass model no longer reproduces its own anchor: model "
        f"{_anchor_model_kg!r} kg vs anchor {ANCHOR_WING_MASS_KG!r} kg. A constant "
        f"was edited without recalibrating WING_MASS_COEFF_KG."
    )
del _anchor_model_kg
