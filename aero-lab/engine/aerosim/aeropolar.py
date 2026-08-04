"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-----------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation: NeuralFoil section
  |                                           | polars, AeroSandbox VLM span/induced model,
  |                                           | viscous strip closure, Reynolds validity gate.
2 | maintainer@emeraldcoastsystemsgroup.com   | Fix the strip-integration consistency check,
  |                                           | which compared AeroSandbox's s_ref-referenced
  |                                           | CL against an area_m2-referenced strip rebuild
  |                                           | and aborted 12% of a random planform sweep with
  |                                           | an UNDOCUMENTED AssertionError. VLM coefficients
  |                                           | are now renormalised from s_ref to area_m2
  |                                           | before comparison (see AREA REFERENCE below);
  |                                           | the tolerance is set from the measured residual;
  |                                           | and a design that cannot be evaluated now raises
  |                                           | the documented NoValidPointError. Added a strip
  |                                           | geometry area-closure check.
3 | maintainer@emeraldcoastsystemsgroup.com   | Fix the viscous lift-slope correction, which
  |                                           | RAISED the finite-wing lift slope above the
  |                                           | inviscid VLM potential-flow upper bound (+18.4%
  |                                           | on case A) and silently saturated its own clamp.
  |                                           | The 2D slope is now a noise-averaged local fit
  |                                           | instead of a 6-degree secant, it is bounded by
  |                                           | the thick-airfoil inviscid ceiling, the
  |                                           | correction is applied as a RATIO against the
  |                                           | VLM's own 2*pi inviscid basis, the finite-wing
  |                                           | slope is hard-bounded by the inviscid VLM value,
  |                                           | and every binding clamp is reported on WingPolar
  |                                           | via `slope_flags` instead of being swallowed.

aerosim.aeropolar -- geometry -> lift.

This module is the ONLY place in the simulator where a lift or drag coefficient is
produced. Nothing here is hand-entered: every CL, CD, CM comes out of NeuralFoil 0.3.3
(a surrogate trained on 7.9M XFOIL cases) for the 2D section, and out of an AeroSandbox
4.2.10 vortex-lattice solve for the 3D span / induced-drag effects. The one place a
literal aerodynamic number appears is the Blasius laminar flat-plate friction floor used
as a physical sanity bound (derived, cited, and only ever used to REJECT a point).

--------------------------------------------------------------------------------
UNITS -- read this before touching anything
--------------------------------------------------------------------------------
  span_m, area_m2, chord_m           : metres, square metres
  alpha_deg                          : DEGREES on all public inputs
  alpha_rad                          : RADIANS on all public outputs (NamedTuple fields)
  sweep_deg, twist_*_deg             : degrees
  V_ms                               : m/s        rho_kgm3 : kg/m^3        mu_Pas : Pa*s
  Re, CL, CD, CDi, CDp, CM, e_oswald : dimensionless
  kulfan_* weights, TE_thickness     : dimensionless, chord-normalised
  n_crit                             : dimensionless (Orr-Sommerfeld amplification exponent)

--------------------------------------------------------------------------------
THE REYNOLDS HONESTY POLICY (the reason this module exists)
--------------------------------------------------------------------------------
Neither NeuralFoil nor XFOIL is ground truth below Re ~ 100k: XFOIL itself has no
experimental validation there with laminar separation bubbles, and NeuralFoil is a
surrogate FOR XFOIL. So this module never pretends. It returns a number AND a per-point
`valid` flag, and `best_endurance_point()` will only ever select a valid point.

A point is valid iff ALL of:
  * RE_FLOOR <= Re <= RE_CEIL                     (defensible band; hard gate)
  * NeuralFoil analysis_confidence >= CONFIDENCE_FLOOR
  * CD exceeds the Blasius laminar flat-plate floor (a negative or sub-friction drag
    is a solver artefact, never a design)
  * (wing only) the section is not past its own 2D CL_max -- we do not model stall,
    so we refuse to certify post-stall points rather than extrapolate into them
  * (wing only) at most RE_FLOOR_AREA_TOLERANCE of the wing AREA sits below RE_FLOOR

n_crit is NOT a free knob -- it is a claim about the atmosphere the vehicle flies in.
Default is 11.0 (clean sailplane band). `ncrit_spread()` exists so a reported polar can
carry the 9/11/13 spread instead of a single number dressed up as truth.

--------------------------------------------------------------------------------
AREA REFERENCE -- there are TWO wing areas and they are not the same number
--------------------------------------------------------------------------------
`area_m2` is the FLAT PLANFORM area: the trapezoid the caller asked for, and the
area the whole simulator references (wing loading W/S, level-flight power
sqrt(2W^3/(rho*S)), every CL and CD this module returns).

`asb.Airplane.s_ref` is the area AeroSandbox lofts between the wing cross-sections
as a MEAN CAMBER SURFACE. When the wing is twisted, the root and tip chord lines are
rotated out of the XY plane by different angles, so the lofted quadrilateral is a
warped surface and its area exceeds the flat trapezoid. Measured on this box for a
5.65 m / 1.72 m^2 / taper-0.7 planform: identical to 12 digits at zero twist, and
+6.117e-7 relative with 2 deg of root twist -- present at zero sweep and at 15 deg
sweep alike, so twist is the whole cause. Across 400 random planforms (span 1-40 m,
AR 6-40, taper 0.2-1.0, sweep 0-25 deg) the mismatch is median 4.4e-7, p90 2.9e-6,
max 8.5e-6 relative.

The VLM reports its coefficients referenced to `s_ref`. This module renormalises
them to `area_m2` on the way out of `_vlm_strip_loading`
(CL_area = CL_sref * s_ref / area_m2), because the physical force is
L = q * CL_sref * s_ref and the rest of the simulator will multiply by `area_m2`.
Skipping that renormalisation is not merely a bookkeeping nit -- it was silently
biasing lift, and it made the strip-integration consistency check compare two
DIFFERENT quantities and abort 12% of a random planform sweep. After
renormalisation the strip rebuild agrees with the VLM to double-precision roundoff
(measured over 360 VLM solves: median 1.1e-16, max 1.2e-15 relative), which is what
lets `_STRIP_INTEGRATION_TOL_REL` be a real panel-binning test instead of a float
lottery.

--------------------------------------------------------------------------------
THE LIFT SLOPE, AND WHY NeuralFoil REPORTS a0 > 2*pi
--------------------------------------------------------------------------------
The VLM is a vortex lattice on the MEAN CAMBER SURFACE. It carries no thickness, so
the 2D section slope implicit in its answer is exactly the thin-airfoil 2*pi, and
its finite-wing slope is the inviscid potential-flow value. For an attached-flow
wing that value is an UPPER BOUND: a boundary layer decambers the section and can
only reduce the slope. Any "correction" that pushes the finite-wing slope above it
is not a correction, it is a lift bonus the optimizer will find and spend.

NeuralFoil nevertheless reports 2D slopes above 2*pi at the Reynolds numbers these
archetypes fly. Measured on this box for NACA 2412:

    stencil                Re 82,671   Re 178,176   Re 500,000   Re 2,000,000
    secant (-2,+4) deg     9.143       7.302        6.463        6.451
    central +-1.0 deg      9.563       9.121        6.864        6.243
    central +-0.5 deg     10.212       8.176        6.440        6.201
    central +-0.1 deg     10.527       7.698        6.131        6.162
                          (1.68x2pi)  (1.23x2pi)   (0.98x2pi)   (0.98x2pi)

That is TWO different effects and they must be handled differently:

1. A REAL inviscid thickness effect. Thin-airfoil theory gives 2*pi for a plate;
   adding thickness raises it to approximately 2*pi*(1 + 0.77*t/c) (Abbott & von
   Doenhoff, Theory of Wing Sections, Ch. 4). For the 12.01%-thick NACA 2412 that
   is 1.092*2*pi = 6.86 /rad. The VLM structurally cannot see this. It is the
   ceiling below which a measured a0 is credible.

2. A LOW-REYNOLDS ARTEFACT above that ceiling. Below about Re 2e5 the section lift
   curve is genuinely nonlinear -- a laminar separation bubble shortens as alpha
   rises, so cl climbs faster than any linear slope -- and NeuralFoil's surrogate
   fit of it is not smooth. Measured cl(alpha) at Re 82,671, 1-degree local slopes
   from -4 to +8 deg: 4.89, 3.72, 10.08, 7.58, 11.55, 10.03, 8.79, 6.83, 5.60,
   5.29, 4.84, 3.95 /rad. There is no local derivative to recover there; narrowing
   the stencil makes the answer WORSE, not better (10.53 /rad at +-0.1 deg). A
   number from that region is not a lift slope and this module refuses to treat it
   as one.

So the policy, implemented in `wing_polar`:
  * a0 is a least-squares line over a narrow SYMMETRIC stencil about zero incidence
    (`_LIFT_SLOPE_ALPHAS_DEG`), which averages the surrogate wiggle instead of
    amplifying it the way a 2-point difference does. It is NOT a 6-degree secant --
    a 6-degree chord across the bubble-collapse region was the original defect.
  * a0 is clamped to [0.5*2*pi, 2*pi*(1 + 0.77*t/c)] using the ACTUAL thickness of
    the Kulfan design vector.
  * The correction is applied as a RATIO against the VLM's own inviscid basis:
        ratio = m_LL(a0_viscous) / m_LL(2*pi),  m_LL(a) = a / (1 + a/(pi*AR*e))
    rather than by substituting m_LL(a0) for the VLM answer outright. Lifting line
    with a drag-derived Oswald e and a 4-chordwise-panel VLM disagree by a few
    percent on the same INVISCID wing (5.658 vs 5.464 /rad for case A), so the
    ratio form cancels that systematic offset; the substitution form charged it to
    viscosity, which is where the +18.4% came from.
  * ratio is hard-bounded to <= 1.0. The viscous finite-wing slope may never exceed
    the inviscid VLM value. A floor of 0.75 guards a collapsed measurement.
  * EVERY binding clamp is reported in `WingPolar.slope_flags`, alongside the
    measured a0 and both slopes. A clamp that saturates in silence is a lie; a
    sweep driver is expected to record these flags.

Consequence, stated plainly: below about Re 2e5 the ceiling and the cap both bind,
and this module returns the INVISCID VLM lift slope with
`slope_capped_at_inviscid_vlm` set. That is the honest answer -- we cannot measure a
defensible viscous reduction from a nonlinear surrogate lift curve -- and it is an
upper bound, so an optimizer cannot profit from it. Above Re ~5e5 the measurement
lands under the ceiling and a genuine (small, ~1%) viscous reduction is applied.

--------------------------------------------------------------------------------
FREE-ENERGY INVARIANT (project rule 6)
--------------------------------------------------------------------------------
This module produces forces only -- it has no power output and no time argument, so it
cannot be a source of energy by itself. The one way it could LIE a downstream integrator
into free energy is by returning CD <= 0 (thrust from a wing in still air). Therefore:

    wing_polar() and section_polar() assert CD > 0 at every returned point, and any
    point whose CD falls below the Blasius laminar flat-plate floor
    CD_min = 2 * 1.328 / sqrt(Re) is marked valid=False.

A wing element consuming this module can never be handed a negative-drag polar.

--------------------------------------------------------------------------------
INTERFACE OBJECTIONS (implemented as specified regardless -- see project rule 1)
--------------------------------------------------------------------------------
1. `WingPolar.Re_mean: ndarray` is specified per-alpha, but `wing_polar()` takes a single
   fixed `V_ms`, so the mean-aerodynamic-chord Reynolds number cannot vary with alpha.
   It is returned as a constant-filled array of the requested alpha shape. This is only
   useful shape-wise; do not read a trend into it. (A trim-following polar would need
   V per alpha, which the signature does not admit.)

2. `ncrit_spread(...same args as wing_polar..., n_crits=...)` therefore accepts an
   `n_crit` parameter that it must ignore -- sweeping n_crit is the entire point of the
   function. It is kept in the signature at wing_polar's exact position so a caller can
   splat wing_polar's argument list straight in. Passing it is a no-op and is logged in
   the returned dict's provenance only by omission.

3. `best_endurance_point()` returns CL**1.5/CD, which is undefined for CL < 0. This
   module defines the endurance factor as 0.0 whenever CL <= 0 rather than emitting NaN,
   so a `max()` over a polar that dips negative at low alpha still behaves. Note the
   acceptance test at Re 9,400 relies on this: raw CL**1.5 there is NaN for the first
   alpha rows because NeuralFoil correctly reports negative lift.

4. `section_polar(..., mach=...)`: NeuralFoil 0.3.3's `get_aero_from_kulfan_parameters`
   has NO mach argument. Compressibility is applied by AeroSandbox's KulfanAirfoil
   wrapper (Prandtl-Glauert-type correction), so this module routes through
   `KulfanAirfoil.get_aero_from_neuralfoil` rather than calling neuralfoil directly.
   At the Mach numbers these archetypes fly (< 0.1) the correction is < 0.5%.

5. The CL-vs-alpha mapping is inviscid-VLM-derived with a viscous lift-slope correction
   that can only REDUCE the slope (see THE LIFT SLOPE above); the alpha of zero lift is
   taken from the VLM (which does see camber) and is NOT viscously corrected.
   Consequence: the CD-vs-CL polar -- the thing endurance depends on -- is viscously
   closed and trustworthy; the absolute alpha at which a given CL occurs carries roughly
   a half-degree of inviscid optimism, and below Re ~2e5 the slope itself is the inviscid
   upper bound (flagged). Do not use `WingPolar.alpha_rad` as a rigging-angle authority,
   and DO read `slope_flags` before trusting an incidence-driven lift.

6. The a0 stencil is centred on ZERO incidence, not on the operating alpha. The model is
   a single straight line CL = m*alpha + CL_at_zero_alpha anchored at the VLM's zero-lift
   condition, so one slope must serve the whole polar, and the linear region near zero is
   where a slope is least contaminated by the bubble nonlinearity. A trim-following local
   slope would need V and alpha per point, which the signature does not admit.
"""

from __future__ import annotations

import math
from typing import Dict, NamedTuple, Sequence, Tuple

import numpy as np

import aerosandbox as asb

__all__ = [
    "RE_FLOOR",
    "RE_CEIL",
    "CONFIDENCE_FLOOR",
    "RE_FLOOR_AREA_TOLERANCE",
    "NoValidPointError",
    "SectionPolar",
    "WingPolar",
    "naca_kulfan",
    "section_polar",
    "wing_polar",
    "best_endurance_point",
    "ncrit_spread",
]

# -----------------------------------------------------------------------------
# Policy constants (dimensionless unless noted)
# -----------------------------------------------------------------------------

RE_FLOOR: float = 30_000.0
"""Below this chord Reynolds number no point is certified, whatever the solver says.
Rationale: XFOIL (and therefore its surrogate) has no experimental validation in the
laminar-separation-bubble regime below ~1e5, and its behaviour degrades to fiction
around 1e4 -- measured on this box: 9 confidently-converged rows of nonsense at
Re 9,400 with exit code 0. 30,000 is the point below which we decline to guess."""

RE_CEIL: float = 5.0e6
"""Upper edge of the band this project cares about. Above it NeuralFoil is still
usable but transition modelling assumptions (n_crit) stop dominating, and none of the
persistent-flight archetypes get there."""

CONFIDENCE_FLOOR: float = 0.6
"""Minimum NeuralFoil `analysis_confidence` (0..1) for a point to be certified.
NeuralFoil emits this as a first-class output; it collapses when the requested state is
far from its 7.9M-case training distribution."""

RE_FLOOR_AREA_TOLERANCE: float = 0.10
"""Fraction of WING AREA permitted to operate below RE_FLOOR before the whole wing
polar is invalidated. A strongly tapered high-AR wing will always have a few
centimetres of tip below the floor; that tip carries almost no lift and contributes
almost no drag. More than 10% of the area in the unmodelled regime is a different
matter -- that is a wing we cannot speak about."""

_BLASIUS_CF_COEFF: float = 1.328
"""Blasius laminar flat-plate mean skin-friction coefficient constant:
Cf = 1.328 / sqrt(Re_x). Standard boundary-layer result (Schlichting, Boundary-Layer
Theory, 8th ed., Ch. 6). Used ONLY as a lower physical bound on section CD -- an
airfoil cannot have less drag than a flat plate of the same wetted length in fully
laminar flow. Wetted length is 2x chord (upper + lower), hence the factor 2 below."""

# VLM discretisation. Horseshoe-VLM induced drag converges slowly and non-monotonically
# in panel count. Measured on this box for the AtlantikSolar planform (AR 18.56,
# taper 0.7, unswept), fitting CDi vs CL over the alphas below:
#   panels/semispan  8      14     20     30      40      50      60      80
#   e_oswald         1.029  1.001  0.991  0.9835  0.9799  0.9777  0.9758  0.9589
# 40 sits inside the 0.96-0.98 plateau, is 2% off the 80-panel answer, and costs about
# 0.6 s per planform (cached, so an n_crit spread pays it once).
_N_SPAN_STRIPS: int = 40
_N_CHORD_PANELS: int = 4

# Three alphas fix a line for CL and a parabola for CDi. The window is chosen to bracket
# the operating range of a HALE cruise polar (CL ~ 0.1 to ~0.9 here) rather than to sit
# at zero incidence: the VLM's CL(alpha) and CDi(alpha) are NOT exactly polynomial (the
# freestream direction rotates with alpha), so the fit window is a real modelling
# choice, worth ~2% in e_oswald between a +/-2 deg and a 0-8 deg window.
_VLM_FIT_ALPHAS_DEG: Tuple[float, float, float] = (-2.0, 2.0, 6.0)

# Internal alpha grid (degrees) on which each spanwise strip's 2D polar is built before
# being re-indexed by local cl. Spans washed-out tips (negative cl) through past stall.
_STRIP_ALPHA_GRID_DEG: np.ndarray = np.arange(-10.0, 18.01, 1.0)

# Alphas (degrees) at which the viscous 2D lift-curve slope is measured. A LEAST-SQUARES
# LINE over a narrow symmetric stencil about zero incidence, not a secant between two
# endpoints. Rationale, measured (see the module docstring table): the original
# (-2, +4) deg secant spans 6 degrees of a strongly nonlinear low-Re lift curve and
# returned a0 = 9.14 /rad = 1.46 x 2*pi at Re 82,671; but narrowing to a 2-point
# difference makes it worse (10.53 /rad at +-0.1 deg) because NeuralFoil's surrogate
# cl(alpha) is not smooth there. Five points over +-1 deg averages that wiggle: it
# recovers 6.24 /rad = 0.99 x 2*pi at Re 2e6 where a clean slope exists, and where no
# clean slope exists the thickness ceiling below catches the result honestly.
_LIFT_SLOPE_ALPHAS_DEG: Tuple[float, ...] = (-1.0, -0.5, 0.0, 0.5, 1.0)

_TWO_PI: float = 2.0 * math.pi

_THICKNESS_LIFT_SLOPE_FACTOR: float = 0.77
"""Coefficient in the inviscid thick-airfoil lift-slope estimate
a0 = 2*pi*(1 + 0.77*t/c). Abbott & von Doenhoff, Theory of Wing Sections, Ch. 4.
Used ONLY as a CEILING on a measured 2D slope -- a section slope above the inviscid
thickness limit is not a viscous measurement, it is a surrogate artefact."""

_A0_FLOOR_FRACTION: float = 0.5
"""Lower sanity bound on the measured 2D lift slope, as a fraction of 2*pi. A section
whose measured slope is below half the thin-airfoil value has not been measured, it has
been mis-measured (a stencil that fell into stall, or a NaN). Clamped and flagged."""

_SLOPE_RATIO_FLOOR: float = 0.75
"""Lower bound on the viscous/inviscid finite-wing lift-slope ratio. The UPPER bound is
1.0 and is physics, not a guard: an attached-flow wing cannot out-lift its own
potential-flow solution. This floor is the guard, against a collapsed a0 measurement
dragging the whole polar down."""

# Consistency tolerances for the VLM strip decomposition, both relative.
#
# _STRIP_INTEGRATION_TOL_REL: after both sides are referenced to `area_m2` (see AREA
# REFERENCE in the module docstring) the strip rebuild reproduces the VLM's own CL to
# double-precision roundoff. Measured over 360 VLM solves across 120 random planforms
# (span 1-40 m, AR 6-40, taper 0.2-1.0, sweep 0-25 deg, twist 0-5 deg):
# median 1.110e-16, p90 4.441e-16, max 1.221e-15 relative. 1e-10 leaves five orders of
# headroom over the worst observed float behaviour while sitting seven orders BELOW the
# smallest real binning fault (dropping one strip of forty perturbs CL by ~2e-2).
# The value it replaced, 1e-6, was not measured from anything and fired on 12% of a
# random planform sweep purely on the s_ref-vs-area_m2 reference mismatch.
_STRIP_INTEGRATION_TOL_REL: float = 1.0e-10

# _STRIP_INTEGRATION_GROSS_TOL_REL: above this the decomposition is not "numerically
# awkward for this planform", it is structurally wrong (panels lost, strips merged, the
# symmetric half mis-selected) and no geometry input should be able to cause it. That is
# a fault in this module, so it stays a loud AssertionError. Below it, the design is
# simply one we decline to certify -- NoValidPointError, the documented contract.
_STRIP_INTEGRATION_GROSS_TOL_REL: float = 1.0e-3

# _STRIP_AREA_CLOSURE_TOL_REL: the strip chords and widths must rebuild the requested
# planform area (2 * sum(chord_m * dy_m) == area_m2). This is the invariant that the CL
# check CANNOT see -- a strip split in two leaves the lift sum untouched but corrupts the
# per-strip Reynolds numbers and the area weighting that CDp is built from. Both the
# chord distribution and the midpoint rule are exact for a straight-tapered wing, so the
# true residual is roundoff.
_STRIP_AREA_CLOSURE_TOL_REL: float = 1.0e-9


class NoValidPointError(ValueError):
    """Raised when a polar contains no point this module is willing to certify.

    @description Signals that every alpha in the requested polar failed the Reynolds
        band, confidence, drag-floor or stall gate. Callers (the optimizer) MUST treat
        this as "this design cannot be evaluated", never as "this design scores zero".
    """


# -----------------------------------------------------------------------------
# Return types
# -----------------------------------------------------------------------------


class SectionPolar(NamedTuple):
    """2D airfoil-section polar. All fields dimensionless except alpha_rad (radians).

    @description One entry per requested angle of attack.
    alpha_rad   : angle of attack, RADIANS
    CL, CD, CM  : section lift / drag / quarter-chord pitching-moment coefficients
    confidence  : NeuralFoil analysis_confidence, 0..1
    valid       : bool -- this module certifies the point (see module docstring policy)
    """

    alpha_rad: np.ndarray
    CL: np.ndarray
    CD: np.ndarray
    CM: np.ndarray
    confidence: np.ndarray
    valid: np.ndarray


class WingPolar(NamedTuple):
    """3D finite-wing polar. All fields dimensionless except alpha_rad (radians).

    @description One entry per requested angle of attack.
    alpha_rad : wing reference angle of attack, RADIANS
    CL        : wing lift coefficient, referenced to `area_m2`
    CD        : total = CDi + CDp
    CDi       : vortex-induced drag from the VLM solve (includes the twist offset, so
                it is NOT exactly CL^2/(pi*AR*e) unless twist is zero)
    CDp       : viscous profile drag from the strip closure PLUS `extra_CD0`
    Re_mean   : area-weighted mean strip chord Reynolds number (constant -- objection 1)
    e_oswald  : span efficiency from the CL^2 coefficient of the VLM CDi(CL) curve
    valid     : bool per point

    The remaining four fields exist so a saturated clamp cannot hide. Read them.
    CL_slope_per_rad          : d(CL)/d(alpha) ACTUALLY used to build CL above, 1/rad
    CL_slope_inviscid_per_rad : the VLM potential-flow slope, 1/rad. This is an UPPER
                                BOUND on the field above and the module enforces it.
    a0_section_per_rad        : the 2D section slope AS MEASURED from NeuralFoil, 1/rad,
                                BEFORE any clamping -- so the raw number stays auditable.
                                Compare against 2*pi = 6.2832.
    slope_flags               : tuple of the names of every clamp that BOUND while
                                deriving the lift slope; empty tuple means nothing was
                                clamped and the correction ran free. Possible values:
                                  'a0_below_floor'
                                  'a0_above_inviscid_ceiling'
                                  'slope_capped_at_inviscid_vlm'
                                  'slope_ratio_floored'
                                A sweep driver should record these: a design whose lift
                                slope was capped is reported at its inviscid upper bound,
                                which is honest but is not a viscous answer.
    """

    alpha_rad: np.ndarray
    CL: np.ndarray
    CD: np.ndarray
    CDi: np.ndarray
    CDp: np.ndarray
    Re_mean: np.ndarray
    e_oswald: float
    valid: np.ndarray
    CL_slope_per_rad: float
    CL_slope_inviscid_per_rad: float
    a0_section_per_rad: float
    slope_flags: Tuple[str, ...]


# -----------------------------------------------------------------------------
# Small numeric helpers
# -----------------------------------------------------------------------------


def _endurance_factor(CL: np.ndarray, CD: np.ndarray) -> np.ndarray:
    """CL**1.5 / CD, defined as 0.0 wherever CL <= 0 or CD <= 0.

    @description The endurance figure of merit for level flight
        (P = sqrt(2W^3/(rho*S)) * CD/CL^1.5 / eta). CL**1.5 is undefined for negative
        lift, so rather than emit NaN and poison a max(), a non-lifting point simply
        scores zero -- it is never the best endurance point.
    @param CL Lift coefficient array, dimensionless.
    @param CD Drag coefficient array, dimensionless.
    @returns ndarray of CL^1.5/CD, dimensionless, zero where undefined.
    """
    CL = np.asarray(CL, dtype=float)
    CD = np.asarray(CD, dtype=float)
    ok = (CL > 0.0) & (CD > 0.0) & np.isfinite(CL) & np.isfinite(CD)
    out = np.zeros(np.broadcast(CL, CD).shape, dtype=float)
    np.divide(np.where(ok, CL, 0.0) ** 1.5, np.where(ok, CD, 1.0), out=out, where=ok)
    return out


def _blasius_cd_floor(Re: np.ndarray | float) -> np.ndarray | float:
    """Lower physical bound on section CD: a fully laminar flat plate of 2x chord wetted.

    @description Cf = 1.328/sqrt(Re) per wetted side (Blasius); an airfoil has upper and
        lower surfaces, so CD_min = 2 * 1.328 / sqrt(Re). Any solver output below this
        is an artefact -- it would be a wing with less drag than a flat plate, i.e. a
        thrust source. Used to invalidate, never to silently patch.
    @param Re Chord Reynolds number, dimensionless.
    @returns Minimum credible section drag coefficient, dimensionless.
    """
    Re = np.maximum(np.asarray(Re, dtype=float), 1.0)
    return 2.0 * _BLASIUS_CF_COEFF / np.sqrt(Re)


def _as_float_array(x) -> np.ndarray:
    """Coerce an AeroSandbox / CasADi / scalar result into a contiguous float ndarray.

    @description AeroSandbox returns CasADi DM objects when a design is being traced and
        plain numpy otherwise. Everything downstream here is pure numpy, so normalise.
    @param x Any array-like, DM, or scalar.
    @returns 1-D or n-D float64 ndarray.
    """
    if hasattr(x, "full"):  # casadi.DM
        x = x.full()
    return np.asarray(x, dtype=float)


def _monotone_lift_branch(cl: np.ndarray, seed_index: int) -> np.ndarray:
    """Indices of the strictly-increasing attached-flow branch around a seed alpha.

    @description np.interp requires a strictly increasing x-array, and inverting a local
        cl back to an operating point is only unambiguous on the attached branch. A 2D
        lift curve computed over a wide alpha grid with NeuralFoil's 360-degree effects
        enabled has THREE regions: negative stall (cl falling as alpha falls, typically
        below about -8 deg), the attached linear/nonlinear branch, and positive stall.
        Growing outward from a seed index inside the attached branch is the only correct
        way to isolate it -- scanning from index 0 lands in negative stall and truncates
        the branch to a single point (measured: NACA 2412 at Re 200k negative-stalls at
        -8 deg, so a left-to-right scan returned a 1-element branch and invalidated
        every wing polar).
    @param cl Section lift coefficients over the internal alpha grid, dimensionless.
    @param seed_index Index into `cl` known to lie in attached flow (use the grid point
        nearest zero incidence).
    @returns Integer index array into `cl`, ascending, strictly increasing in cl.
    """
    lo_i = hi_i = int(seed_index)
    while lo_i > 0 and cl[lo_i - 1] < cl[lo_i] - 1e-9:
        lo_i -= 1
    while hi_i < cl.size - 1 and cl[hi_i + 1] > cl[hi_i] + 1e-9:
        hi_i += 1
    return np.arange(lo_i, hi_i + 1, dtype=int)


# -----------------------------------------------------------------------------
# Airfoil parameterisation
# -----------------------------------------------------------------------------


def naca_kulfan(code: str) -> Tuple[np.ndarray, np.ndarray, float, float]:
    """Convert a NACA designation into the 18-parameter CST/Kulfan design vector.

    @description The design vector IS the geometry for this project: 8 upper CST
        weights + 8 lower CST weights + a leading-edge weight + a trailing-edge
        thickness = 18 numbers, all dimensionless and chord-normalised. This helper
        exists so validation cases can be stated against a recognisable airfoil while
        the optimizer still works in pure CST space.
    @param code NACA 4- or 5-digit designation, e.g. "2412" or "naca2412" or "23012".
    @returns (upper_weights[8], lower_weights[8], leading_edge_weight, TE_thickness),
        all dimensionless, chord-normalised.
    @raises ValueError if the code is not a recognisable NACA series.
    """
    if not isinstance(code, str):
        raise ValueError(f"naca_kulfan: code must be a string, got {type(code)!r}")
    digits = code.strip().lower()
    if digits.startswith("naca"):
        digits = digits[4:]
    digits = digits.strip()
    if not digits.isdigit() or len(digits) not in (4, 5):
        raise ValueError(
            f"naca_kulfan: expected a 4- or 5-digit NACA code, got {code!r}"
        )

    kulfan = asb.Airfoil(f"naca{digits}").to_kulfan_airfoil()
    upper = np.asarray(kulfan.upper_weights, dtype=float).copy()
    lower = np.asarray(kulfan.lower_weights, dtype=float).copy()
    if upper.size != 8 or lower.size != 8:
        raise ValueError(
            "naca_kulfan: AeroSandbox returned "
            f"{upper.size}/{lower.size} CST weights, expected 8/8"
        )
    return upper, lower, float(kulfan.leading_edge_weight), float(kulfan.TE_thickness)


def _kulfan_airfoil(
    kulfan_upper: np.ndarray,
    kulfan_lower: np.ndarray,
    leading_edge_weight: float,
    TE_thickness: float,
) -> "asb.KulfanAirfoil":
    """Build an AeroSandbox KulfanAirfoil from the raw 18-parameter design vector.

    @description Keeps the public interface primitive (arrays and floats, no project
        types) so this module stays a true leaf that other agents can import without
        pulling in a Vehicle definition.
    @param kulfan_upper 8 upper-surface CST weights, dimensionless.
    @param kulfan_lower 8 lower-surface CST weights, dimensionless.
    @param leading_edge_weight Kulfan LE modification weight, dimensionless.
    @param TE_thickness Trailing-edge thickness, chord-normalised.
    @returns asb.KulfanAirfoil
    """
    upper = np.asarray(kulfan_upper, dtype=float).reshape(-1)
    lower = np.asarray(kulfan_lower, dtype=float).reshape(-1)
    if upper.size != lower.size:
        raise ValueError(
            f"kulfan weight count mismatch: upper {upper.size} vs lower {lower.size}"
        )
    return asb.KulfanAirfoil(
        name="aerosim-design-vector",
        lower_weights=lower,
        upper_weights=upper,
        leading_edge_weight=float(leading_edge_weight),
        TE_thickness=float(TE_thickness),
    )


# -----------------------------------------------------------------------------
# 2D section polar
# -----------------------------------------------------------------------------


def section_polar(
    kulfan_upper: np.ndarray,
    kulfan_lower: np.ndarray,
    leading_edge_weight: float,
    TE_thickness: float,
    alpha_deg: np.ndarray,
    Re: float,
    mach: float = 0.0,
    n_crit: float = 11.0,
    model: str = "xlarge",
) -> SectionPolar:
    """2D section polar from the CST design vector, via NeuralFoil.

    @description The single entry point for 2D aerodynamics in this project. No lift or
        drag number anywhere in the simulator is permitted to bypass this call. Points
        outside the defensible Reynolds band, or that NeuralFoil is not confident about,
        or whose drag falls below the laminar flat-plate floor, come back with
        valid=False -- but they still come back with a number, so a caller can report
        WHAT the untrustworthy answer was.
    @param kulfan_upper 8 upper CST weights, dimensionless, chord-normalised.
    @param kulfan_lower 8 lower CST weights, dimensionless, chord-normalised.
    @param leading_edge_weight Kulfan LE weight, dimensionless.
    @param TE_thickness Trailing-edge thickness, chord-normalised.
    @param alpha_deg Angles of attack, DEGREES (scalar or array).
    @param Re Chord Reynolds number, dimensionless.
    @param mach Freestream Mach number, dimensionless. Applied by AeroSandbox's
        compressibility correction (NeuralFoil itself has no Mach input -- objection 4).
    @param n_crit Transition amplification exponent, dimensionless. NOT a tuning knob:
        it is a claim about freestream turbulence. 9 = wind tunnel, 11 = clean sailplane
        air (this project's default), 13 = very quiet air.
    @param model NeuralFoil model size: one of xxsmall..xxxlarge. "xlarge" is the
        accuracy/speed knee for sweep work.
    @returns SectionPolar
    @raises ValueError on a non-finite or non-positive Reynolds number.
    """
    alpha_deg_arr = np.atleast_1d(np.asarray(alpha_deg, dtype=float))
    Re_f = float(Re)
    if not math.isfinite(Re_f) or Re_f <= 0.0:
        raise ValueError(f"section_polar: Re must be finite and positive, got {Re!r}")

    airfoil = _kulfan_airfoil(
        kulfan_upper, kulfan_lower, leading_edge_weight, TE_thickness
    )

    aero = airfoil.get_aero_from_neuralfoil(
        alpha=alpha_deg_arr,
        Re=Re_f,
        mach=float(mach),
        n_crit=float(n_crit),
        model_size=str(model),
        include_360_deg_effects=True,
    )

    CL = _as_float_array(aero["CL"]).reshape(-1)
    CD = _as_float_array(aero["CD"]).reshape(-1)
    CM = _as_float_array(aero["CM"]).reshape(-1)
    confidence = _as_float_array(aero["analysis_confidence"]).reshape(-1)
    confidence = np.broadcast_to(confidence, CL.shape).copy()

    re_in_band = RE_FLOOR <= Re_f <= RE_CEIL
    cd_floor = float(_blasius_cd_floor(Re_f))

    valid = (
        np.full(CL.shape, re_in_band, dtype=bool)
        & (confidence >= CONFIDENCE_FLOOR)
        & np.isfinite(CL)
        & np.isfinite(CD)
        & (CD >= cd_floor)
    )

    # FREE-ENERGY INVARIANT: a section may never be handed downstream with CD <= 0.
    # NeuralFoil has never produced one here, but a surrogate is a surrogate.
    if np.any(CD <= 0.0):
        raise AssertionError(
            "section_polar: NeuralFoil returned CD <= 0 "
            f"(min {CD.min():.6g}) at Re={Re_f:.0f} -- refusing to emit a "
            "thrust-producing airfoil. This is a solver fault, not a design."
        )

    return SectionPolar(
        alpha_rad=np.deg2rad(alpha_deg_arr),
        CL=CL,
        CD=CD,
        CM=CM,
        confidence=confidence,
        valid=valid,
    )


# -----------------------------------------------------------------------------
# 3D wing: geometry, VLM linear model, strip closure
# -----------------------------------------------------------------------------


class _LinearWingModel(NamedTuple):
    """Everything the (geometry-only, alpha-independent) VLM solve tells us.

    @description Cached per planform. Three VLM solves fix a lift line and an
        induced-drag parabola. Crucially the drag parabola is fitted in CL, not in
        alpha: CDi = q2*CL^2 + q1*CL + q0 is exactly what the Oswald definition
        CD = CD0 + CL^2/(pi*AR*e) means, and it keeps the induced drag consistent with
        the viscously-corrected CL that wing_polar actually flies at. The spanwise
        loading is decomposed into basic (twist-driven, CL-independent) and additional
        (CL-proportional) components -- the classical decomposition -- so any CL can be
        turned into a local cl distribution without re-solving.

    CL_slope_per_rad : d(CL)/d(alpha), 1/rad, VLM inviscid
    CL_at_zero_alpha : CL at alpha = 0, dimensionless (camber + twist)
    CDi_coeffs       : (q2, q1, q0) with CDi = q2*CL^2 + q1*CL + q0, CL dimensionless
    eta              : strip centre spanwise station, y/(b/2), dimensionless, semispan
    chord_m          : strip chord, metres
    dy_m             : strip span extent, metres (semispan; cosine-spaced)
    cl_basic         : local cl at CL = 0, dimensionless
    cl_additional    : d(local cl)/d(CL), dimensionless
    aspect_ratio     : b^2/S, dimensionless
    e_oswald         : span efficiency from the CL^2 coefficient of CDi(CL)
    """

    CL_slope_per_rad: float
    CL_at_zero_alpha: float
    CDi_coeffs: Tuple[float, float, float]
    eta: np.ndarray
    chord_m: np.ndarray
    dy_m: np.ndarray
    cl_basic: np.ndarray
    cl_additional: np.ndarray
    aspect_ratio: float
    e_oswald: float


# Keyed by the exact planform + airfoil design vector. The VLM is deterministic, so a
# cache hit is bit-identical to a re-solve; this is purely a throughput measure (a
# 30,000-design sweep and ncrit_spread() both re-ask for the same planform).
_VLM_CACHE: Dict[tuple, _LinearWingModel] = {}


def _build_wing(
    span_m: float,
    area_m2: float,
    taper_ratio: float,
    sweep_deg: float,
    twist_root_deg: float,
    twist_tip_deg: float,
    airfoil: "asb.KulfanAirfoil",
) -> "asb.Wing":
    """Assemble the AeroSandbox Wing for a straight-tapered planform.

    @description Sweep is applied about the QUARTER CHORD (the aerodynamic convention),
        so the leading-edge x offset at the tip is
        (b/2)*tan(sweep) + 0.25*c_root - 0.25*c_tip. Reference area is exact by
        construction: c_root = 2*S / (b*(1 + taper)).
    @param span_m Full span, metres (tip to tip).
    @param area_m2 Reference planform area, square metres (both halves).
    @param taper_ratio c_tip/c_root, dimensionless, in (0, 1].
    @param sweep_deg Quarter-chord sweep, degrees.
    @param twist_root_deg Root incidence, degrees (positive nose-up).
    @param twist_tip_deg Tip incidence, degrees (twist_tip < twist_root = washout).
    @param airfoil Section shape used at both stations.
    @returns asb.Wing with symmetric=True.
    """
    if span_m <= 0.0 or area_m2 <= 0.0:
        raise ValueError(
            f"_build_wing: span_m and area_m2 must be positive, "
            f"got {span_m!r}, {area_m2!r}"
        )
    if not (0.0 < taper_ratio <= 1.0):
        raise ValueError(
            f"_build_wing: taper_ratio must lie in (0, 1], got {taper_ratio!r}"
        )

    c_root_m = 2.0 * area_m2 / (span_m * (1.0 + taper_ratio))  # metres
    c_tip_m = c_root_m * taper_ratio  # metres
    semispan_m = 0.5 * span_m  # metres
    x_le_tip_m = (
        semispan_m * math.tan(math.radians(sweep_deg)) + 0.25 * c_root_m - 0.25 * c_tip_m
    )

    return asb.Wing(
        name="aerosim-wing",
        symmetric=True,
        xsecs=[
            asb.WingXSec(
                xyz_le=[0.0, 0.0, 0.0],
                chord=c_root_m,
                twist=float(twist_root_deg),
                airfoil=airfoil,
            ),
            asb.WingXSec(
                xyz_le=[x_le_tip_m, semispan_m, 0.0],
                chord=c_tip_m,
                twist=float(twist_tip_deg),
                airfoil=airfoil,
            ),
        ],
    )


def _vlm_strip_loading(
    airplane: "asb.Airplane",
    alpha_deg: float,
    area_m2: float,
) -> Tuple[float, float, np.ndarray, np.ndarray, np.ndarray]:
    """One VLM solve; return integrated coefficients and the semispan strip loading.

    @description Panel forces are converted from AeroSandbox geometry axes into WIND
        axes so that lift and induced drag are the true freestream-normal and
        freestream-parallel components (not a small-angle approximation). Panels are
        binned by their spanwise station into strips.

        The returned CL and CDi are referenced to `area_m2`, NOT to the airplane's own
        `s_ref`. AeroSandbox lofts s_ref as a twisted mean-camber surface and it exceeds
        the flat planform area whenever the wing is twisted (measured: up to 8.5e-6
        relative across the design space -- see AREA REFERENCE in the module docstring).
        The physical lift is L = q * CL_sref * s_ref, so referencing it to the area the
        rest of the simulator uses means scaling by s_ref/area_m2. Doing this here is
        what makes the strip-integration check below compare like with like.
    @param airplane AeroSandbox Airplane holding exactly one symmetric wing.
    @param alpha_deg Angle of attack, degrees.
    @param area_m2 Reference area, square metres (the FLAT planform area).
    @returns (CL, CDi, eta[nstrip], strip_lift_per_q_m2[nstrip], dy_m[nstrip]) where CL
        and CDi are referenced to `area_m2`, and strip_lift_per_q_m2 is the strip lift
        divided by dynamic pressure, in m^2, for ONE semispan.
    @raises NoValidPointError if the strip decomposition cannot reproduce the VLM's own
        lift for this planform to `_STRIP_INTEGRATION_TOL_REL` -- i.e. this design cannot
        be evaluated.
    @raises AssertionError if the mismatch exceeds `_STRIP_INTEGRATION_GROSS_TOL_REL`,
        which no geometry input should be able to provoke and therefore indicates a fault
        in this module rather than a property of the design.
    """
    vlm = asb.VortexLatticeMethod(
        airplane=airplane,
        op_point=asb.OperatingPoint(velocity=1.0, alpha=float(alpha_deg)),
        spanwise_resolution=_N_SPAN_STRIPS,
        chordwise_resolution=_N_CHORD_PANELS,
        align_trailing_vortices_with_wind=False,
    )
    results = vlm.run()

    forces_geom = _as_float_array(vlm.forces_geometry)  # (n_panels, 3), newtons
    fx_w, fy_w, fz_w = vlm.op_point.convert_axes(
        forces_geom[:, 0],
        forces_geom[:, 1],
        forces_geom[:, 2],
        from_axes="geometry",
        to_axes="wind",
    )
    lift_panel_N = -_as_float_array(fz_w)  # wind-axis z points down; lift is -z

    front_left = _as_float_array(vlm.front_left_vertices)
    front_right = _as_float_array(vlm.front_right_vertices)
    back_left = _as_float_array(vlm.back_left_vertices)
    back_right = _as_float_array(vlm.back_right_vertices)
    y_centre_m = 0.25 * (
        front_left[:, 1] + front_right[:, 1] + back_left[:, 1] + back_right[:, 1]
    )

    q_Pa = float(_as_float_array(vlm.op_point.dynamic_pressure()))

    # Keep only the starboard (y > 0) semispan; the wing is symmetric by construction.
    starboard = y_centre_m > 1e-9
    y_key = np.round(y_centre_m[starboard], 9)
    stations_m = np.unique(y_key)  # ascending, metres

    lift_star_N = lift_panel_N[starboard]
    y_inboard_m = np.abs(front_left[starboard, 1])
    y_outboard_m = np.abs(front_right[starboard, 1])

    n_strips = stations_m.size
    strip_lift_per_q_m2 = np.empty(n_strips, dtype=float)
    dy_m = np.empty(n_strips, dtype=float)
    for i, station_m in enumerate(stations_m):
        mask = y_key == station_m
        strip_lift_per_q_m2[i] = lift_star_N[mask].sum() / q_Pa
        dy_m[i] = abs(y_outboard_m[mask][0] - y_inboard_m[mask][0])

    # AeroSandbox references results["CL"]/["CD"] to airplane.s_ref, the LOFTED
    # mean-camber-surface area, which is not the flat planform area whenever the wing is
    # twisted. Renormalise to area_m2 so every number this module emits shares one
    # reference area. (Verified: L/q = CL_sref * s_ref exactly -- see AREA REFERENCE.)
    s_ref_m2 = float(_as_float_array(airplane.s_ref))
    if not math.isfinite(s_ref_m2) or s_ref_m2 <= 0.0:
        raise AssertionError(
            f"_vlm_strip_loading: airplane.s_ref is {s_ref_m2!r} -- AeroSandbox built a "
            "degenerate wing surface."
        )
    area_scale = s_ref_m2 / area_m2  # dimensionless
    CL = float(_as_float_array(results["CL"]).reshape(-1)[0]) * area_scale
    # VLM CD is induced only.
    CDi = float(_as_float_array(results["CD"]).reshape(-1)[0]) * area_scale

    semispan_m = stations_m.max() + 0.5 * dy_m[-1]
    eta = stations_m / semispan_m  # dimensionless

    # Integration consistency: the strip lifts must rebuild the reported CL. BOTH sides
    # are now referenced to area_m2, so this tests the panel binning and nothing else.
    rebuilt_CL = 2.0 * strip_lift_per_q_m2.sum() / area_m2
    residual = abs(rebuilt_CL - CL) / max(1.0, abs(CL))  # dimensionless
    if residual > _STRIP_INTEGRATION_GROSS_TOL_REL:
        raise AssertionError(
            "_vlm_strip_loading: strip integration does not reproduce CL "
            f"({rebuilt_CL:.12g} vs {CL:.12g}, relative residual {residual:.3e} > "
            f"{_STRIP_INTEGRATION_GROSS_TOL_REL:.1e}) -- panel binning is wrong. "
            f"{n_strips} strips from {int(starboard.sum())} starboard panels at "
            f"alpha {alpha_deg:.3f} deg. No geometry input should cause this; it is a "
            "fault in this module."
        )
    if residual > _STRIP_INTEGRATION_TOL_REL:
        raise NoValidPointError(
            "_vlm_strip_loading: the VLM strip decomposition for this planform does not "
            f"reproduce its own CL to {_STRIP_INTEGRATION_TOL_REL:.1e} "
            f"(rebuilt {rebuilt_CL:.12g} vs {CL:.12g}, relative residual "
            f"{residual:.3e}) at alpha {alpha_deg:.3f} deg with {n_strips} strips. "
            "This design cannot be evaluated."
        )

    return CL, CDi, eta, strip_lift_per_q_m2, dy_m


def _linear_wing_model(
    span_m: float,
    area_m2: float,
    taper_ratio: float,
    sweep_deg: float,
    twist_root_deg: float,
    twist_tip_deg: float,
    kulfan_upper: np.ndarray,
    kulfan_lower: np.ndarray,
    leading_edge_weight: float,
    TE_thickness: float,
) -> _LinearWingModel:
    """Solve (or fetch from cache) the geometry-only inviscid model of a planform.

    @description Runs the VLM at three alphas, which is exact for a linear system, and
        extracts: the lift-curve line, the induced-drag parabola, the basic/additional
        spanwise loading decomposition, and the Oswald span efficiency. None of this
        depends on Reynolds number, n_crit, or flight speed, so it is cached and reused
        across the whole n_crit spread and across repeated design evaluations.
    @param span_m Full span, metres.  @param area_m2 Reference area, square metres.
    @param taper_ratio Dimensionless, (0, 1].  @param sweep_deg Quarter-chord, degrees.
    @param twist_root_deg / twist_tip_deg Degrees.
    @param kulfan_* / leading_edge_weight / TE_thickness Section design vector.
    @returns _LinearWingModel
    @raises NoValidPointError if the VLM solve for this planform is not usable as a
        linear model -- non-positive induced-drag curvature (lift-dependent thrust),
        non-positive inviscid lift slope, or a strip decomposition that does not close on
        the requested planform area. All three are properties of the design, so they use
        the documented "cannot be evaluated" type rather than aborting a sweep.
    """
    cache_key = (
        round(float(span_m), 9),
        round(float(area_m2), 9),
        round(float(taper_ratio), 9),
        round(float(sweep_deg), 9),
        round(float(twist_root_deg), 9),
        round(float(twist_tip_deg), 9),
        tuple(np.round(np.asarray(kulfan_upper, dtype=float).reshape(-1), 12)),
        tuple(np.round(np.asarray(kulfan_lower, dtype=float).reshape(-1), 12)),
        round(float(leading_edge_weight), 12),
        round(float(TE_thickness), 12),
    )
    cached = _VLM_CACHE.get(cache_key)
    if cached is not None:
        return cached

    airfoil = _kulfan_airfoil(
        kulfan_upper, kulfan_lower, leading_edge_weight, TE_thickness
    )
    wing = _build_wing(
        span_m,
        area_m2,
        taper_ratio,
        sweep_deg,
        twist_root_deg,
        twist_tip_deg,
        airfoil,
    )
    airplane = asb.Airplane(name="aerosim-airplane", wings=[wing])
    aspect_ratio = float(span_m**2 / area_m2)

    alphas_rad = np.deg2rad(np.array(_VLM_FIT_ALPHAS_DEG, dtype=float))
    CL_samples = np.empty(alphas_rad.size, dtype=float)
    CDi_samples = np.empty(alphas_rad.size, dtype=float)
    strip_lift_samples = []
    eta = dy_m = None
    for i, alpha_deg in enumerate(_VLM_FIT_ALPHAS_DEG):
        CL_i, CDi_i, eta, strip_lift_i, dy_m = _vlm_strip_loading(
            airplane, alpha_deg, area_m2
        )
        CL_samples[i] = CL_i
        CDi_samples[i] = CDi_i
        strip_lift_samples.append(strip_lift_i)
    strip_lift_per_q_m2 = np.vstack(strip_lift_samples)  # (n_alpha, n_strip), m^2

    # Lift line: CL = slope * alpha + intercept, exact for a linear system.
    CL_slope_per_rad, CL_at_zero_alpha = np.polyfit(alphas_rad, CL_samples, 1)

    # Induced-drag parabola in CL -- this is literally the Oswald definition,
    # CDi = CL^2/(pi*AR*e) + (linear and constant terms from twist).
    q2, q1, q0 = np.polyfit(CL_samples, CDi_samples, 2)

    # Oswald efficiency from the CL^2 coefficient alone. Using the curvature (rather
    # than a pointwise CL^2/(pi*AR*CDi)) removes the twist-driven offset, which is what
    # makes this a property of the SHAPE rather than of the operating point.
    # A non-positive curvature is lift-dependent THRUST, so no polar may be emitted --
    # but it is an outcome of THIS planform's VLM solve, not a fault in this module, so
    # it is reported as the documented "cannot be evaluated" type. The free-energy
    # invariant is protected either way: nothing is returned.
    if not math.isfinite(q2) or q2 <= 0.0:
        raise NoValidPointError(
            "_linear_wing_model: the VLM induced-drag curvature for this planform is "
            f"non-positive ({q2:.6g}), which would be a lift-dependent THRUST. "
            f"span {span_m:.4f} m, area {area_m2:.4f} m^2, AR {aspect_ratio:.3f}, "
            f"taper {taper_ratio:.4f}, sweep {sweep_deg:.3f} deg. "
            "This design cannot be evaluated."
        )
    e_oswald = float(1.0 / (math.pi * aspect_ratio * q2))

    # The inviscid lift slope is the upper bound the viscous correction is measured
    # against, so a non-positive one makes the whole correction meaningless.
    if not math.isfinite(CL_slope_per_rad) or CL_slope_per_rad <= 0.0:
        raise NoValidPointError(
            "_linear_wing_model: the VLM inviscid lift slope for this planform is "
            f"non-positive ({CL_slope_per_rad:.6g} /rad). "
            "This design cannot be evaluated."
        )

    # Strip chords, metres. Straight-tapered planform, exact.
    c_root_m = 2.0 * area_m2 / (span_m * (1.0 + taper_ratio))
    chord_m = c_root_m * (1.0 - (1.0 - taper_ratio) * eta)

    # Strip GEOMETRY closure. The CL check in _vlm_strip_loading cannot see this: a
    # strip split in two leaves the lift sum untouched but corrupts the per-strip
    # Reynolds numbers and the area weights CDp is built from. The chord distribution is
    # linear and the strip centres are midpoints, so the midpoint rule is exact and the
    # only expected residual is roundoff.
    strip_area_closure = float(2.0 * np.sum(chord_m * dy_m))  # m^2
    closure_residual = abs(strip_area_closure - area_m2) / area_m2  # dimensionless
    if closure_residual > _STRIP_AREA_CLOSURE_TOL_REL:
        raise NoValidPointError(
            "_linear_wing_model: the VLM strip geometry does not rebuild the requested "
            f"planform area ({strip_area_closure:.12g} vs {area_m2:.12g} m^2, relative "
            f"residual {closure_residual:.3e} > {_STRIP_AREA_CLOSURE_TOL_REL:.1e}) from "
            f"{chord_m.size} strips. The per-strip Reynolds numbers and drag area "
            "weights would be wrong. This design cannot be evaluated."
        )

    # Local section lift coefficient at each sampled alpha:
    #   cl(y) = strip_lift/(q * c(y) * dy)
    cl_samples = strip_lift_per_q_m2 / (chord_m * dy_m)[None, :]  # (n_alpha, n_strip)

    # Basic/additional decomposition: cl(y) = cl_basic(y) + cl_additional(y) * CL.
    # Least squares over the sampled alphas (exact -- both are linear in alpha).
    design = np.vstack([np.ones_like(CL_samples), CL_samples]).T  # (n_alpha, 2)
    coeffs, *_ = np.linalg.lstsq(design, cl_samples, rcond=None)  # (2, n_strip)
    cl_basic = coeffs[0, :]
    cl_additional = coeffs[1, :]

    model = _LinearWingModel(
        CL_slope_per_rad=float(CL_slope_per_rad),
        CL_at_zero_alpha=float(CL_at_zero_alpha),
        CDi_coeffs=(float(q2), float(q1), float(q0)),
        eta=eta,
        chord_m=chord_m,
        dy_m=dy_m,
        cl_basic=cl_basic,
        cl_additional=cl_additional,
        aspect_ratio=aspect_ratio,
        e_oswald=e_oswald,
    )
    _VLM_CACHE[cache_key] = model
    return model


def wing_polar(
    span_m: float,
    area_m2: float,
    taper_ratio: float,
    sweep_deg: float,
    twist_root_deg: float,
    twist_tip_deg: float,
    kulfan_upper: np.ndarray,
    kulfan_lower: np.ndarray,
    leading_edge_weight: float,
    TE_thickness: float,
    alpha_deg: np.ndarray,
    V_ms: float,
    rho_kgm3: float,
    mu_Pas: float,
    n_crit: float = 11.0,
    extra_CD0: float = 0.0,
) -> WingPolar:
    """Finite-wing polar: VLM span effects + NeuralFoil viscous strip closure.

    @description The method, stated plainly so it can be argued with:
        1. One cached VLM solve gives the inviscid lift line, the induced-drag parabola,
           the Oswald span efficiency, and the basic/additional spanwise loading.
        2. The inviscid lift slope is corrected TOWARD (never above) the viscous answer,
           using a 2D slope measured from NeuralFoil at the area-weighted mean chord
           Reynolds number and applied as a ratio of lifting-line evaluations,
           m_LL(a) = a/(1 + a/(pi*AR*e)), against the VLM's own 2*pi inviscid basis. The
           result is hard-bounded by the inviscid VLM slope, because that is the
           potential-flow upper bound for an attached-flow wing. Every clamp that binds
           is reported in `slope_flags` -- read it. Below Re ~2e5 the bound binds and the
           returned slope IS the inviscid one; see THE LIFT SLOPE in the module
           docstring for why no defensible viscous slope exists there.
        3. Every spanwise strip gets its OWN 2D polar at its OWN local chord Reynolds
           number -- which is the whole point at these scales, where a tapered wing's
           tip can sit below RE_FLOOR while its root is comfortable.
        4. Each strip's viscous drag is read off its own polar AT ITS LOCAL LIFT
           COEFFICIENT (not at the wing's alpha), then area-weighted into CDp.
        5. Anything the solvers cannot defend comes back valid=False.
    @param span_m Full span, metres.
    @param area_m2 Reference planform area, square metres.
    @param taper_ratio c_tip/c_root, dimensionless, (0, 1].
    @param sweep_deg Quarter-chord sweep, degrees.
    @param twist_root_deg Root incidence, degrees.
    @param twist_tip_deg Tip incidence, degrees (less than root = washout).
    @param kulfan_upper 8 upper CST weights, dimensionless.
    @param kulfan_lower 8 lower CST weights, dimensionless.
    @param leading_edge_weight Kulfan LE weight, dimensionless.
    @param TE_thickness Trailing-edge thickness, chord-normalised.
    @param alpha_deg Wing angles of attack, DEGREES.
    @param V_ms True airspeed, m/s.
    @param rho_kgm3 Air density, kg/m^3.
    @param mu_Pas Dynamic viscosity, Pa*s (from the env module's Sutherland law).
    @param n_crit Transition amplification exponent, dimensionless.
    @param extra_CD0 Fuselage + tail + interference parasite drag referenced to
        `area_m2`, dimensionless. Folded into CDp.
    @returns WingPolar
    @raises ValueError on non-physical inputs (negative speed, density, viscosity or
        parasite drag; a taper ratio outside (0, 1]).
    @raises NoValidPointError -- a subclass of ValueError -- when this particular design
        cannot be evaluated: a VLM strip decomposition that will not close, a
        non-positive induced-drag curvature, or a non-positive inviscid lift slope. This
        is the documented contract for a sweep driver, and it is what the optimizer must
        catch. It never means "this design scores zero".
    @raises AssertionError ONLY for faults in this module or its solvers, which no
        geometry input should be able to provoke: a drag-negative (thrust-producing)
        section or wing, a gross panel-binning failure, or a viscous lift slope that
        came out above the inviscid VLM bound. These are meant to be loud.
    """
    alpha_deg_arr = np.atleast_1d(np.asarray(alpha_deg, dtype=float))
    V = float(V_ms)
    rho = float(rho_kgm3)
    mu = float(mu_Pas)
    if V <= 0.0 or rho <= 0.0 or mu <= 0.0:
        raise ValueError(
            "wing_polar: V_ms, rho_kgm3 and mu_Pas must all be positive, got "
            f"{V_ms!r}, {rho_kgm3!r}, {mu_Pas!r}"
        )
    if extra_CD0 < 0.0:
        raise ValueError(
            f"wing_polar: extra_CD0 must be >= 0 (negative parasite drag is thrust), "
            f"got {extra_CD0!r}"
        )

    model = _linear_wing_model(
        span_m,
        area_m2,
        taper_ratio,
        sweep_deg,
        twist_root_deg,
        twist_tip_deg,
        kulfan_upper,
        kulfan_lower,
        leading_edge_weight,
        TE_thickness,
    )
    airfoil = _kulfan_airfoil(
        kulfan_upper, kulfan_lower, leading_edge_weight, TE_thickness
    )

    # --- Per-strip Reynolds numbers -----------------------------------------------
    strip_area_m2 = model.chord_m * model.dy_m  # m^2, one semispan
    strip_area_fraction = strip_area_m2 / strip_area_m2.sum()  # dimensionless
    Re_strip = rho * V * model.chord_m / mu  # dimensionless
    Re_area_weighted = float(np.sum(Re_strip * strip_area_fraction))
    below_floor_area_fraction = float(
        np.sum(strip_area_fraction[Re_strip < RE_FLOOR])
    )
    above_ceil_area_fraction = float(np.sum(strip_area_fraction[Re_strip > RE_CEIL]))

    # --- One batched NeuralFoil call: every strip x every internal alpha ----------
    n_strips = model.chord_m.size
    n_grid = _STRIP_ALPHA_GRID_DEG.size
    alpha_flat_deg = np.tile(_STRIP_ALPHA_GRID_DEG, n_strips)  # degrees
    Re_flat = np.repeat(Re_strip, n_grid)  # dimensionless
    mach = V / 340.29  # dimensionless; 340.29 m/s = ISA sea-level speed of sound
    strip_aero = airfoil.get_aero_from_neuralfoil(
        alpha=alpha_flat_deg,
        Re=Re_flat,
        mach=mach,
        n_crit=float(n_crit),
        model_size="xlarge",
        include_360_deg_effects=True,
    )
    cl_grid = _as_float_array(strip_aero["CL"]).reshape(n_strips, n_grid)
    cd_grid = _as_float_array(strip_aero["CD"]).reshape(n_strips, n_grid)
    conf_grid = np.broadcast_to(
        _as_float_array(strip_aero["analysis_confidence"]).reshape(-1),
        (n_strips * n_grid,),
    ).reshape(n_strips, n_grid)

    if np.any(cd_grid <= 0.0):
        raise AssertionError(
            "wing_polar: NeuralFoil returned a non-positive section CD "
            f"(min {cd_grid.min():.6g}) -- refusing to emit a thrust-producing wing."
        )

    # --- Viscous lift-slope correction --------------------------------------------
    # Read THE LIFT SLOPE in the module docstring before touching this. The invariant it
    # exists to protect: a viscous, attached-flow finite wing may never lift better than
    # the inviscid potential-flow (VLM) solution of the same planform. The previous
    # implementation violated that by +18.4% on case A and saturated a silent clamp.
    #
    # Step 1: measure the 2D section slope as a LEAST-SQUARES LINE over a narrow
    # symmetric stencil about zero incidence, at the area-weighted mean Reynolds number.
    # A line over 5 points averages NeuralFoil's low-Re surrogate wiggle; a 2-point
    # secant either amplifies it (narrow) or integrates the bubble nonlinearity (wide).
    ref_polar = section_polar(
        kulfan_upper,
        kulfan_lower,
        leading_edge_weight,
        TE_thickness,
        np.array(_LIFT_SLOPE_ALPHAS_DEG, dtype=float),
        Re=Re_area_weighted,
        mach=mach,
        n_crit=float(n_crit),
        model="xlarge",
    )
    a0_measured_per_rad = float(
        np.polyfit(np.asarray(ref_polar.alpha_rad, dtype=float), ref_polar.CL, 1)[0]
    )

    # Step 2: bound the measurement by inviscid thick-airfoil theory. A 2D slope above
    # 2*pi*(1 + 0.77*t/c) cannot be a viscous slope -- viscosity decambers, it does not
    # add lift -- so it is a surrogate artefact of the nonlinear low-Re lift curve and is
    # clamped rather than believed. t/c comes from the ACTUAL Kulfan design vector.
    slope_flags: list = []
    thickness_over_chord = float(_as_float_array(airfoil.max_thickness()))
    a0_ceiling_per_rad = _TWO_PI * (
        1.0 + _THICKNESS_LIFT_SLOPE_FACTOR * thickness_over_chord
    )
    a0_floor_per_rad = _A0_FLOOR_FRACTION * _TWO_PI
    a0_used_per_rad = a0_measured_per_rad
    if not math.isfinite(a0_used_per_rad) or a0_used_per_rad < a0_floor_per_rad:
        slope_flags.append("a0_below_floor")
        a0_used_per_rad = a0_floor_per_rad
    elif a0_used_per_rad > a0_ceiling_per_rad:
        slope_flags.append("a0_above_inviscid_ceiling")
        a0_used_per_rad = a0_ceiling_per_rad

    # Step 3: apply the correction as a RATIO against the VLM's own inviscid basis. The
    # VLM is a mean-camber-surface lattice, so the 2D slope implicit in its answer is the
    # thin-airfoil 2*pi. Taking the ratio of two lifting-line evaluations cancels the
    # systematic disagreement between lifting line (with a drag-derived Oswald e) and a
    # 4-chordwise-panel VLM on the SAME inviscid wing -- an offset the old substitution
    # form silently charged to viscosity.
    denom = math.pi * model.aspect_ratio * model.e_oswald  # dimensionless
    if denom > 0.0 and math.isfinite(denom):
        m_visc_ll_per_rad = a0_used_per_rad / (1.0 + a0_used_per_rad / denom)
        m_inviscid_ll_per_rad = _TWO_PI / (1.0 + _TWO_PI / denom)
        slope_ratio = m_visc_ll_per_rad / m_inviscid_ll_per_rad  # dimensionless
    else:
        slope_flags.append("degenerate_lifting_line_denominator")
        slope_ratio = 1.0

    # Step 4: the physical bound. ratio <= 1 is not a guard, it is the statement that an
    # attached-flow wing cannot out-lift its own potential-flow solution. The floor IS a
    # guard, against a collapsed measurement. Either one binding is reported, never
    # swallowed.
    if slope_ratio > 1.0:
        slope_flags.append("slope_capped_at_inviscid_vlm")
        slope_ratio = 1.0
    elif slope_ratio < _SLOPE_RATIO_FLOOR:
        slope_flags.append("slope_ratio_floored")
        slope_ratio = _SLOPE_RATIO_FLOOR

    CL_slope_per_rad = float(slope_ratio * model.CL_slope_per_rad)
    if CL_slope_per_rad > model.CL_slope_per_rad * (1.0 + 1e-12):
        raise AssertionError(
            "wing_polar: the viscous lift slope "
            f"({CL_slope_per_rad:.6g} /rad) exceeds the inviscid VLM upper bound "
            f"({model.CL_slope_per_rad:.6g} /rad). An attached-flow wing cannot "
            "out-lift its own potential-flow solution -- refusing."
        )
    slope_flags_tuple: Tuple[str, ...] = tuple(slope_flags)

    # --- Wing lift and induced drag at every requested alpha ----------------------
    alpha_rad = np.deg2rad(alpha_deg_arr)
    CL = CL_slope_per_rad * alpha_rad + model.CL_at_zero_alpha
    q2, q1, q0 = model.CDi_coeffs
    CDi = q2 * CL**2 + q1 * CL + q0  # parabola in CL -- the Oswald form
    CDi = np.maximum(CDi, 0.0)  # induced drag is a loss; it is never negative

    # --- Strip closure: viscous drag at each strip's own local lift coefficient ---
    # cl_local[a, s] = cl_basic[s] + cl_additional[s] * CL[a]
    cl_local = model.cl_basic[None, :] + model.cl_additional[None, :] * CL[:, None]

    cd_local = np.empty_like(cl_local)
    conf_local = np.empty_like(cl_local)
    stalled = np.zeros_like(cl_local, dtype=bool)
    under_range = np.zeros_like(cl_local, dtype=bool)
    # Seed the branch search at the grid point nearest zero incidence, which is inside
    # attached flow for any sane airfoil.
    seed_index = int(np.argmin(np.abs(_STRIP_ALPHA_GRID_DEG)))
    for s in range(n_strips):
        branch = _monotone_lift_branch(cl_grid[s], seed_index)
        cl_branch = cl_grid[s][branch]
        cd_branch = cd_grid[s][branch]
        conf_branch = conf_grid[s][branch]
        cd_local[:, s] = np.interp(cl_local[:, s], cl_branch, cd_branch)
        conf_local[:, s] = np.interp(cl_local[:, s], cl_branch, conf_branch)
        stalled[:, s] = cl_local[:, s] > cl_branch[-1]
        under_range[:, s] = cl_local[:, s] < cl_branch[0]

    # Area-weighted profile drag, referenced to area_m2. The semispan area fractions
    # apply unchanged to the full wing by symmetry.
    CDp_wing = np.sum(cd_local * strip_area_fraction[None, :], axis=1)
    CDp = CDp_wing + float(extra_CD0)
    CD = CDi + CDp

    # --- Validity gate -------------------------------------------------------------
    reynolds_ok = (
        (RE_FLOOR <= Re_area_weighted <= RE_CEIL)
        and (below_floor_area_fraction <= RE_FLOOR_AREA_TOLERANCE)
        and (above_ceil_area_fraction <= RE_FLOOR_AREA_TOLERANCE)
    )
    confidence_ok = conf_local.min(axis=1) >= CONFIDENCE_FLOOR
    not_stalled = ~stalled.any(axis=1)
    in_polar_range = ~under_range.any(axis=1)
    # Wing-level Blasius floor: the area-weighted sum of each strip's own laminar
    # flat-plate minimum. A total CD below this is a wing with less drag than a flat
    # plate of the same wetted area -- i.e. a thrust source, i.e. a bug.
    wing_cd_floor = float(
        np.sum(_blasius_cd_floor(Re_strip) * strip_area_fraction)
    )
    drag_sane = CD > wing_cd_floor

    valid = (
        np.full(alpha_rad.shape, reynolds_ok, dtype=bool)
        & confidence_ok
        & not_stalled
        & in_polar_range
        & drag_sane
        & np.isfinite(CL)
        & np.isfinite(CD)
    )

    # FREE-ENERGY INVARIANT: a wing polar with CD <= 0 would let a downstream
    # integrator fly forever on nothing. It is not a bad design -- it is a bug.
    if np.any(CD <= 0.0):
        raise AssertionError(
            "wing_polar: computed a non-positive total CD "
            f"(min {CD.min():.6g}) -- that wing would be a thrust source. Refusing."
        )
    if np.any(CDi < 0.0):
        raise AssertionError("wing_polar: negative induced drag -- VLM fault.")

    return WingPolar(
        alpha_rad=alpha_rad,
        CL=CL,
        CD=CD,
        CDi=CDi,
        CDp=CDp,
        Re_mean=np.full(alpha_rad.shape, Re_area_weighted, dtype=float),
        e_oswald=model.e_oswald,
        valid=valid,
        CL_slope_per_rad=CL_slope_per_rad,
        CL_slope_inviscid_per_rad=float(model.CL_slope_per_rad),
        a0_section_per_rad=a0_measured_per_rad,
        slope_flags=slope_flags_tuple,
    )


# -----------------------------------------------------------------------------
# Polar reduction
# -----------------------------------------------------------------------------


def best_endurance_point(p: WingPolar) -> Tuple[float, float, float]:
    """Best CL^1.5/CD point of a wing polar, considering ONLY certified points.

    @description CL^1.5/CD is the endurance figure of merit: level-flight power is
        P = sqrt(2W^3/(rho*S)) * (CD/CL^1.5) / eta, so maximising it minimises the power
        the vehicle must find. Invalid points are not merely penalised, they are
        unreachable -- an optimizer must never be able to win by walking into the
        regime where the solver stops being trustworthy.
    @param p A WingPolar.
    @returns (CL, CD, CL**1.5/CD), all dimensionless.
    @raises NoValidPointError if no point in the polar is certified and lifting.
    """
    factor = _endurance_factor(p.CL, p.CD)
    selectable = np.asarray(p.valid, dtype=bool) & (factor > 0.0)
    if not selectable.any():
        n_valid = int(np.count_nonzero(p.valid))
        raise NoValidPointError(
            "best_endurance_point: no certified lifting point in this polar "
            f"({n_valid} of {p.valid.size} alphas passed the validity gate; "
            f"Re_mean = {float(np.atleast_1d(p.Re_mean)[0]):.0f}, "
            f"RE_FLOOR = {RE_FLOOR:.0f})."
        )
    masked = np.where(selectable, factor, -np.inf)
    i = int(np.argmax(masked))
    return float(p.CL[i]), float(p.CD[i]), float(factor[i])


def ncrit_spread(
    span_m: float,
    area_m2: float,
    taper_ratio: float,
    sweep_deg: float,
    twist_root_deg: float,
    twist_tip_deg: float,
    kulfan_upper: np.ndarray,
    kulfan_lower: np.ndarray,
    leading_edge_weight: float,
    TE_thickness: float,
    alpha_deg: np.ndarray,
    V_ms: float,
    rho_kgm3: float,
    mu_Pas: float,
    n_crit: float = 11.0,
    extra_CD0: float = 0.0,
    n_crits: Sequence[float] = (9.0, 11.0, 13.0),
) -> Dict[float, float]:
    """Best CL^1.5/CD across a spread of transition assumptions -- for honest reporting.

    @description n_crit is a claim about the turbulence of the air the vehicle flies in,
        not a knob to tune until the design closes. A single-n_crit polar reported as
        truth hides the fact that a laminar-flow HALE wing's performance swings with the
        atmosphere it meets. Report the spread.

        DO NOT ASSUME THE TREND IS MONOTONE. Quieter air (higher n_crit) is not simply
        better at these Reynolds numbers: delaying transition also LENGTHENS the laminar
        separation bubble, and the bubble's pressure drag can outweigh the skin-friction
        saved. Measured on this box for NACA 2412 at Re 195k, section cd at CL 0.4 rises
        with n_crit (0.01011 / 0.01053 / 0.01119 for n_crit 9 / 11 / 13), so the wing's
        best CL^1.5/CD peaks at n_crit 11 rather than 13. At Re 100k and n_crit 13 the
        same section shows a bubble burst (cd jumping to 0.139 above CL 0.7). An
        optimizer handed only the n_crit-13 polar would design straight into that.
    @param n_crit IGNORED -- present only so a caller can splat wing_polar's exact
        argument list in (interface objection 2). Sweeping n_crit is the point.
    @param n_crits Transition amplification exponents to evaluate, dimensionless.
        9 = wind tunnel / turbulent air, 11 = clean sailplane air, 13 = very quiet air.
    @returns dict mapping n_crit -> best CL^1.5/CD. A design with NO certified point at
        a given n_crit maps to 0.0 rather than raising, so a spread is always reportable.
    @raises Whatever wing_polar raises for non-physical geometry.
    """
    del n_crit  # deliberately unused -- see docstring and interface objection 2
    spread: Dict[float, float] = {}
    for nc in n_crits:
        polar = wing_polar(
            span_m,
            area_m2,
            taper_ratio,
            sweep_deg,
            twist_root_deg,
            twist_tip_deg,
            kulfan_upper,
            kulfan_lower,
            leading_edge_weight,
            TE_thickness,
            alpha_deg,
            V_ms,
            rho_kgm3,
            mu_Pas,
            n_crit=float(nc),
            extra_CD0=extra_CD0,
        )
        try:
            spread[float(nc)] = best_endurance_point(polar)[2]
        except NoValidPointError:
            spread[float(nc)] = 0.0
    return spread


# -----------------------------------------------------------------------------
# Self-test
# -----------------------------------------------------------------------------
# The acceptance criteria live in aerosim.aeropolar_selftest, not here. They are
# scaffolding, and this module is the one under the 1000-code-line hard cap; keeping
# them out means the cap constrains physics rather than test prose. The entry point is
# unchanged -- `python -m aerosim.aeropolar` still runs them.

if __name__ == "__main__":
    from aerosim.aeropolar_selftest import selftest

    raise SystemExit(selftest())
