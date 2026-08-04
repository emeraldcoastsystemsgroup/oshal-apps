"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-----------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Regression cover for the two aeropolar
  |                                           | defects: (A) the strip-integration check
  |                                           | comparing two different reference areas and
  |                                           | aborting 12% of a planform sweep with an
  |                                           | undocumented AssertionError, and (B) the
  |                                           | viscous lift-slope correction exceeding the
  |                                           | inviscid VLM upper bound and saturating a
  |                                           | silent clamp. Every guard here is
  |                                           | mutation-tested: each one is watched going RED
  |                                           | against a deliberately broken module before it
  |                                           | is trusted going green.

Regression tests for aerosim.aeropolar robustness.

Runs standalone (no pytest in this venv):

    .venv/Scripts/python.exe tests/test_aeropolar_robustness.py

and is also collectible by pytest if it is ever installed -- every check is a
module-level `test_*` function that raises AssertionError on failure.

--------------------------------------------------------------------------------
WHAT THESE TESTS ARE GUARDING AGAINST, AND WHY THEY ARE SHAPED THIS WAY
--------------------------------------------------------------------------------
Both defects had the same failure signature: a check that LOOKED like it was
enforcing something was in fact enforcing nothing, and the tuning constant hid it.
So passing is not enough here. Each defect gets three kinds of coverage:

  1. The defect's own repro must now succeed (or fail with the DOCUMENTED type).
  2. A "the fix is not a loosened constant" test. For defect A: proof that the
     un-normalised comparison would still blow through the tolerance, so it is the
     area referencing and not the tolerance that closed it. For defect B: proof that
     the answer no longer depends on the stencil that caused it.
  3. A MUTATION test: the module is deliberately broken and the guard must fire.
     A guard nobody has watched go red is not a guard.

UNITS: span_m/area_m2 metres and square metres, alpha degrees on input, lift slopes
1/rad, Re/CL/CD/ratios dimensionless, V_ms m/s, rho_kgm3 kg/m^3, mu_Pas Pa*s.
"""

from __future__ import annotations

import math
import sys
import traceback
from pathlib import Path
from typing import Callable, List, Tuple

import numpy as np

import aerosandbox as asb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aerosim import aeropolar  # noqa: E402
from aerosim.aeropolar import (  # noqa: E402
    NoValidPointError,
    best_endurance_point,
    naca_kulfan,
    wing_polar,
)

# -----------------------------------------------------------------------------
# Shared fixtures -- computed once, since a cold wing_polar costs ~0.75 s
# -----------------------------------------------------------------------------

_UP, _LO, _LEW, _TE = naca_kulfan("2412")

# ISA at 500 m geopotential, as returned by aerosim.env.atmosphere(500.0). Hardcoded
# so this file does not depend on a sibling module's health; the Reynolds numbers the
# tests assert against are the cross-check that these are still the right values.
RHO_KGM3: float = 1.1672725123243854
MU_PAS: float = 1.773657203776756e-05

# Case A -- AtlantikSolar (ETH Zurich), at its trimmed level-flight speed.
CASE_A: dict = dict(
    span_m=5.65, area_m2=1.72, taper_ratio=0.7, sweep_deg=0.0,
    twist_root_deg=2.0, twist_tip_deg=0.0,
)
CASE_A_V_MS: float = 8.8021

# Archetype 1 -- 2.5 m span, 1.2 kg, AR 14. The design where the +-25% clamp used to
# bind at EXACTLY 1.25x inviscid and say nothing about it.
ARCH1: dict = dict(
    span_m=2.5, area_m2=2.5**2 / 14.0, taper_ratio=0.7, sweep_deg=0.0,
    twist_root_deg=2.0, twist_tip_deg=0.0,
)
ARCH1_V_MS: float = 6.962

# A 3 m chord planform. Swept over speed it crosses the band where NeuralFoil returns a
# credible sub-2*pi section slope and the viscous correction therefore runs FREE. Its
# existence is what proves the correction is not dead code that always returns the
# inviscid answer. Measured band on this box (rho/mu above, taper 1.0, AR 10):
#   Re   592,305 -> a0 1.0118 x 2pi, capped
#   Re   789,739 -> a0 0.9502 x 2pi, ratio 0.958370, UNCLAMPED
#   Re   987,174 -> a0 0.9463 x 2pi, ratio 0.955068, UNCLAMPED
#   Re 1,184,609 -> a0 0.9596 x 2pi, ratio 0.966248, UNCLAMPED
#   Re 1,579,479 -> a0 0.9812 x 2pi, ratio 0.984371, UNCLAMPED
#   Re 1,974,349 -> a0 0.9923 x 2pi, ratio 0.993613, UNCLAMPED
#   Re 2,369,218 -> a0 1.0000 x 2pi, capped
#   Re 3,948,697 -> a0 1.0166 x 2pi, capped
# Above ~2.4e6 a0 creeps just over 2*pi -- the real thick-airfoil effect the VLM cannot
# see -- and the inviscid VLM bound correctly catches it.
HIGH_RE: dict = dict(
    span_m=30.0, area_m2=90.0, taper_ratio=1.0, sweep_deg=0.0,
    twist_root_deg=2.0, twist_tip_deg=0.0,
)
HIGH_RE_V_MS: float = 10.0
HIGH_RE_SCAN_V_MS: Tuple[float, ...] = (4.0, 5.0, 6.0, 8.0, 10.0)

# The exact planform the defect report names as aborting: span 12.032 m, AR 8.09,
# taper 0.898 -> requested S 17.894811372 vs s_ref 17.894857594 (1.583e-6 relative),
# and at alpha 6 deg 0.703712289 vs 0.703710471 = 1.818e-6 > the old 1.0e-6 tolerance.
DEFECT_SPAN_M: float = 12.032
DEFECT_AR: float = 8.09
DEFECT_TAPER: float = 0.898
DEFECT_AREA_M2: float = DEFECT_SPAN_M**2 / DEFECT_AR

_ALPHAS_DEG = np.arange(-2.0, 12.01, 0.5)


def _polar(geom: dict, V_ms: float, alpha_deg=None):
    """Build a wing polar for one of the fixture planforms.

    @description Thin wrapper so every test uses the same section, atmosphere and
        parasite drag, and only the planform and speed vary.
    @param geom Planform keyword dict (span_m, area_m2, taper_ratio, sweep_deg, twists).
    @param V_ms True airspeed, m/s.
    @param alpha_deg Angles of attack, DEGREES; defaults to the standard sweep grid.
    @returns aeropolar.WingPolar
    """
    return wing_polar(
        alpha_deg=_ALPHAS_DEG if alpha_deg is None else alpha_deg,
        V_ms=float(V_ms),
        rho_kgm3=RHO_KGM3,
        mu_Pas=MU_PAS,
        kulfan_upper=_UP,
        kulfan_lower=_LO,
        leading_edge_weight=_LEW,
        TE_thickness=_TE,
        n_crit=11.0,
        extra_CD0=0.006,
        **geom,
    )


# =============================================================================
# DEFECT A -- the strip-integration check compared two different reference areas
# =============================================================================


def test_A1_defect_planform_no_longer_aborts() -> str:
    """The exact planform named in the defect report must now evaluate.

    @description span 12.032 m / AR 8.09 / taper 0.898 raised
        "AssertionError: panel binning is wrong" at alpha 6 deg because the VLM's
        s_ref-referenced CL was compared against an area_m2-referenced strip rebuild.
    @returns Evidence string.
    """
    polar = _polar(
        dict(span_m=DEFECT_SPAN_M, area_m2=DEFECT_AREA_M2, taper_ratio=DEFECT_TAPER,
             sweep_deg=0.0, twist_root_deg=2.0, twist_tip_deg=0.0),
        12.0,
    )
    assert np.all(np.isfinite(polar.CL)), "non-finite CL"
    assert np.all(polar.CD > 0.0), "non-positive CD"
    return (f"polar built, {int(polar.valid.sum())}/{polar.valid.size} certified, "
            f"CD {polar.CD.min():.5f}..{polar.CD.max():.5f}")


def test_A2_vlm_coefficients_referenced_to_requested_area() -> str:
    """VLM CL must be referenced to area_m2, not to AeroSandbox's lofted s_ref.

    @description Proves the renormalisation actually happened: the returned CL must
        equal the strip rebuild 2*sum(strip_lift/q)/area_m2, and must NOT equal the
        raw s_ref-referenced value (the two differ for a twisted wing).
    @returns Evidence string.
    """
    airfoil = aeropolar._kulfan_airfoil(_UP, _LO, _LEW, _TE)
    wing = aeropolar._build_wing(
        DEFECT_SPAN_M, DEFECT_AREA_M2, DEFECT_TAPER, 0.0, 2.0, 0.0, airfoil
    )
    airplane = asb.Airplane(name="regression", wings=[wing])
    s_ref_m2 = float(airplane.s_ref)
    area_mismatch = abs(s_ref_m2 - DEFECT_AREA_M2) / DEFECT_AREA_M2  # dimensionless

    # The trigger condition must still be present, or this test proves nothing.
    assert area_mismatch > 1e-7, (
        f"s_ref now matches area to {area_mismatch:.3e} -- AeroSandbox changed and this "
        "test no longer exercises the defect"
    )

    CL, CDi, eta, strip_lift_per_q_m2, dy_m = aeropolar._vlm_strip_loading(
        airplane, 6.0, DEFECT_AREA_M2
    )
    rebuilt_CL = 2.0 * strip_lift_per_q_m2.sum() / DEFECT_AREA_M2
    residual = abs(rebuilt_CL - CL) / max(1.0, abs(CL))  # dimensionless
    assert residual <= aeropolar._STRIP_INTEGRATION_TOL_REL, (
        f"normalised residual {residual:.3e} exceeds tolerance "
        f"{aeropolar._STRIP_INTEGRATION_TOL_REL:.1e}"
    )
    # And it is genuinely the area_m2 reference, not s_ref.
    CL_if_sref_referenced = CL * DEFECT_AREA_M2 / s_ref_m2
    assert abs(CL - CL_if_sref_referenced) > 0.0, "no renormalisation was applied"
    return (f"s_ref/area mismatch {area_mismatch:.3e}; normalised strip residual "
            f"{residual:.3e} <= {aeropolar._STRIP_INTEGRATION_TOL_REL:.1e}")


def test_A3_fix_is_the_referencing_not_a_loosened_tolerance() -> str:
    """The tolerance was not simply widened until the defect stopped firing.

    @description This is the test that would catch the lazy fix. If someone deletes the
        renormalisation and bumps the tolerance instead, the UN-normalised residual --
        which is what the old code compared -- still exceeds the tolerance by orders of
        magnitude, so this asserts the gap is real and that the current tolerance is
        far TIGHTER than the mismatch it used to trip on.
    @returns Evidence string.
    """
    airfoil = aeropolar._kulfan_airfoil(_UP, _LO, _LEW, _TE)
    wing = aeropolar._build_wing(
        DEFECT_SPAN_M, DEFECT_AREA_M2, DEFECT_TAPER, 0.0, 2.0, 0.0, airfoil
    )
    airplane = asb.Airplane(name="regression", wings=[wing])
    s_ref_m2 = float(airplane.s_ref)

    CL_area, _, _, strip_lift_per_q_m2, _ = aeropolar._vlm_strip_loading(
        airplane, 6.0, DEFECT_AREA_M2
    )
    rebuilt_CL = 2.0 * strip_lift_per_q_m2.sum() / DEFECT_AREA_M2
    CL_sref = CL_area * DEFECT_AREA_M2 / s_ref_m2  # undo the renormalisation

    raw_residual = abs(rebuilt_CL - CL_sref) / max(1.0, abs(CL_sref))
    norm_residual = abs(rebuilt_CL - CL_area) / max(1.0, abs(CL_area))

    assert raw_residual > 1.0e-6, (
        f"the old 1e-6 tolerance would no longer fire ({raw_residual:.3e}) -- this test "
        "no longer reproduces the defect"
    )
    assert norm_residual < raw_residual / 1.0e5, (
        f"normalisation only improved the residual from {raw_residual:.3e} to "
        f"{norm_residual:.3e}; that is not a fix, that is a tolerance change"
    )
    assert aeropolar._STRIP_INTEGRATION_TOL_REL < 1.0e-6, (
        "the tolerance is now LOOSER than the one that was failing "
        f"({aeropolar._STRIP_INTEGRATION_TOL_REL:.1e} >= 1e-6) -- the defect was hidden, "
        "not fixed"
    )
    return (f"un-normalised residual {raw_residual:.3e} (> old 1e-6 tolerance); "
            f"normalised {norm_residual:.3e}; tolerance now "
            f"{aeropolar._STRIP_INTEGRATION_TOL_REL:.1e}, TIGHTER than the old one")


def test_A4_random_planform_sweep_raises_no_assertionerror() -> str:
    """A random planform sweep must not abort, and must refuse only via the contract.

    @description The optimizer premise: ~30,000 candidate aircraft. A sweep driver
        catches NoValidPointError. An AssertionError escaping wing_polar either kills
        the sweep or silently loses designs. Measured before the fix: 12% aborted.
    @returns Evidence string.
    """
    rng = np.random.default_rng(11)
    alphas = np.arange(-2.0, 12.01, 1.0)
    n_ok = n_nvp = n_abort = 0
    first_abort = ""
    n = 60
    for _ in range(n):
        span_m = float(rng.uniform(1.0, 40.0))
        AR = float(rng.uniform(6.0, 40.0))
        taper = float(rng.uniform(0.2, 1.0))
        sweep_deg = float(rng.uniform(0.0, 25.0))
        try:
            wing_polar(
                span_m, span_m**2 / AR, taper, sweep_deg, 2.0, 0.0,
                _UP, _LO, _LEW, _TE, alphas, 12.0, 1.0, 1.8e-5,
                n_crit=11.0, extra_CD0=0.006,
            )
            n_ok += 1
        except NoValidPointError:
            n_nvp += 1
        except AssertionError as exc:
            n_abort += 1
            first_abort = first_abort or str(exc).splitlines()[0][:140]
    assert n_abort == 0, (
        f"{n_abort}/{n} planforms aborted with AssertionError: {first_abort}"
    )
    return (f"{n} planforms: {n_ok} evaluated, {n_nvp} refused as NoValidPointError, "
            f"{n_abort} AssertionError")


def test_A5_no_valid_point_error_is_catchable_as_valueerror() -> str:
    """The documented refusal type must be catchable the way a sweep driver catches it.

    @description NoValidPointError subclasses ValueError; that is the contract a driver
        relies on. An AssertionError (a BaseException-derived assert) is not catchable
        by the same handler, which is the whole reason defect A was fatal.
    @returns Evidence string.
    """
    assert issubclass(NoValidPointError, ValueError)
    assert not issubclass(NoValidPointError, AssertionError)
    assert not issubclass(AssertionError, ValueError), (
        "AssertionError is catchable as ValueError on this Python -- the distinction "
        "this module relies on does not hold"
    )
    return "NoValidPointError <: ValueError, and AssertionError is not"


def test_A6_MUTATION_strip_check_still_detects_a_real_binning_fault() -> str:
    """MUTATION: break the lift bookkeeping and confirm both tiers of the guard fire.

    @description The risk of fixing defect A by relaxing a tolerance is a guard that no
        longer guards. So corrupt the VLM's reported CL relative to the panel forces the
        strips are rebuilt from, and require:
          * a small corruption (1e-6 relative, above the 1e-10 tolerance and below the
            1e-3 gross bound) -> NoValidPointError, the documented "cannot evaluate";
          * a gross corruption (50%) -> AssertionError, a loud module fault.
        If either tier stays silent, the guard is decorative.
    @returns Evidence string.
    """
    real_run = asb.VortexLatticeMethod.run
    observed = {}

    def _mutated_run(scale: float) -> Callable:
        def _run(self, *args, **kwargs):
            results = dict(real_run(self, *args, **kwargs))
            results["CL"] = results["CL"] * scale
            return results
        return _run

    try:
        for label, scale, expected in (
            ("subtle (1 + 1e-6)", 1.0 + 1.0e-6, NoValidPointError),
            ("gross (1.5x)", 1.5, AssertionError),
        ):
            asb.VortexLatticeMethod.run = _mutated_run(scale)
            aeropolar._VLM_CACHE.clear()
            try:
                _polar(CASE_A, CASE_A_V_MS, np.array([0.0, 4.0]))
                observed[label] = None
            except expected as exc:
                observed[label] = type(exc).__name__
            except BaseException as exc:  # noqa: BLE001 -- wrong type is the failure
                observed[label] = f"WRONG TYPE {type(exc).__name__}: {exc}"
    finally:
        asb.VortexLatticeMethod.run = real_run
        aeropolar._VLM_CACHE.clear()

    assert observed["subtle (1 + 1e-6)"] == "NoValidPointError", (
        f"subtle corruption produced {observed['subtle (1 + 1e-6)']!r}, expected "
        "NoValidPointError -- the tolerance no longer detects a real binning fault"
    )
    assert observed["gross (1.5x)"] == "AssertionError", (
        f"gross corruption produced {observed['gross (1.5x)']!r}, expected AssertionError"
    )

    # A mutation test that leaves the module broken is worse than none.
    healthy = _polar(CASE_A, CASE_A_V_MS, np.array([0.0, 4.0]))
    assert np.all(np.isfinite(healthy.CL)), "module did not recover from the mutation"
    return (f"subtle -> {observed['subtle (1 + 1e-6)']}, "
            f"gross -> {observed['gross (1.5x)']}, module recovered")


def test_A7_MUTATION_strip_geometry_closure_is_enforced() -> str:
    """MUTATION: corrupt the strip widths and confirm the area-closure check fires.

    @description The CL check cannot see this class of fault -- splitting or mis-sizing
        strips leaves the lift SUM untouched while corrupting the per-strip Reynolds
        numbers and the area weights CDp is built from. This is the guard that covers it.
    @returns Evidence string.
    """
    real_loading = aeropolar._vlm_strip_loading

    def _shrunken(airplane, alpha_deg, area_m2):
        CL, CDi, eta, strip_lift, dy_m = real_loading(airplane, alpha_deg, area_m2)
        return CL, CDi, eta, strip_lift, dy_m * 0.97  # 3% narrow strips

    fired = None
    try:
        aeropolar._vlm_strip_loading = _shrunken
        aeropolar._VLM_CACHE.clear()
        try:
            _polar(CASE_A, CASE_A_V_MS, np.array([0.0, 4.0]))
        except NoValidPointError as exc:
            fired = str(exc).splitlines()[0][:110]
        except BaseException as exc:  # noqa: BLE001
            fired = f"WRONG TYPE {type(exc).__name__}"
    finally:
        aeropolar._vlm_strip_loading = real_loading
        aeropolar._VLM_CACHE.clear()

    assert fired is not None and not fired.startswith("WRONG TYPE"), (
        f"strip-geometry corruption was not caught (got {fired!r})"
    )
    healthy = _polar(CASE_A, CASE_A_V_MS, np.array([0.0, 4.0]))
    assert np.all(np.isfinite(healthy.CL)), "module did not recover from the mutation"
    return f"caught as NoValidPointError: {fired}"


# =============================================================================
# DEFECT B -- the viscous lift-slope correction exceeded the inviscid VLM bound
# =============================================================================


def test_B1_case_A_slope_no_longer_exceeds_inviscid() -> str:
    """Case A: the shipped lift slope must not be +18.4% above the inviscid VLM value.

    @description Measured defect: cached VLM dCL/dalpha = 5.4639 /rad, module shipped
        6.4695 /rad (+18.4%), implying a 2D a0 of 7.3045 /rad = 1.163 x 2*pi -- a
        VISCOUS section slope above the inviscid thin-airfoil limit.
    @returns Evidence string.
    """
    polar = _polar(CASE_A, CASE_A_V_MS)
    assert abs(polar.Re_mean[0] - 178_176.0) / 178_176.0 < 0.01, (
        f"operating point drifted: Re {polar.Re_mean[0]:,.0f}, expected ~178,176"
    )
    assert abs(polar.CL_slope_inviscid_per_rad - 5.4639) < 5e-3, (
        f"inviscid VLM slope {polar.CL_slope_inviscid_per_rad:.4f} /rad, "
        "expected 5.4639 -- the VLM baseline moved"
    )
    assert polar.CL_slope_per_rad <= polar.CL_slope_inviscid_per_rad * (1 + 1e-12), (
        f"viscous slope {polar.CL_slope_per_rad:.4f} exceeds inviscid "
        f"{polar.CL_slope_inviscid_per_rad:.4f} /rad"
    )
    assert polar.CL_slope_per_rad < 6.4695 * 0.99, (
        f"slope {polar.CL_slope_per_rad:.4f} /rad is still at the defective 6.4695"
    )
    # The implied 2D section slope must be physical (below the thin-airfoil limit).
    AR = CASE_A["span_m"] ** 2 / CASE_A["area_m2"]
    m = polar.CL_slope_per_rad
    a0_implied = m / (1.0 - m / (math.pi * AR * polar.e_oswald))  # 1/rad
    assert a0_implied < 2.0 * math.pi, (
        f"implied 2D a0 {a0_implied:.4f} /rad = {a0_implied/(2*math.pi):.3f} x 2pi "
        "is above the inviscid thin-airfoil limit"
    )
    return (f"slope {m:.4f} /rad (was 6.4695, inviscid bound "
            f"{polar.CL_slope_inviscid_per_rad:.4f}); implied 2D a0 {a0_implied:.4f} "
            f"= {a0_implied/(2*math.pi):.3f} x 2pi; flags {polar.slope_flags}")


def test_B2_archetype1_clamp_no_longer_binds_in_silence() -> str:
    """Archetype 1: the +-25% clamp used to bind EXACTLY and say nothing.

    @description Measured defect: VLM inviscid 5.2513 /rad, module shipped 6.5641 /rad
        = exactly 1.25 x inviscid, i.e. the guard clamp was saturated and swallowed.
    @returns Evidence string.
    """
    polar = _polar(ARCH1, ARCH1_V_MS)
    assert abs(polar.Re_mean[0] - 82_666.0) / 82_666.0 < 0.01, (
        f"operating point drifted: Re {polar.Re_mean[0]:,.0f}, expected ~82,666"
    )
    assert abs(polar.CL_slope_inviscid_per_rad - 5.2513) < 5e-3, (
        f"inviscid VLM slope {polar.CL_slope_inviscid_per_rad:.4f} /rad, expected 5.2513"
    )
    assert polar.CL_slope_per_rad <= polar.CL_slope_inviscid_per_rad * (1 + 1e-12)
    assert abs(polar.CL_slope_per_rad - 6.5641) > 1e-3, "still shipping 1.25 x inviscid"
    assert polar.slope_flags, (
        "a clamp bound at this Reynolds number but slope_flags is empty -- the "
        "saturation is silent again"
    )
    return (f"slope {polar.CL_slope_per_rad:.4f} /rad (was 6.5641 = 1.25 x inviscid "
            f"{polar.CL_slope_inviscid_per_rad:.4f}); flags {polar.slope_flags}")


def test_B3_slope_bound_holds_across_the_design_space() -> str:
    """The viscous/inviscid slope ratio must be <= 1 for every planform in a sweep.

    @description This is the invariant an optimizer would exploit: a lift slope above
        the potential-flow solution is free lift at a commanded incidence. It must hold
        everywhere, not just on the archetypes with a hand-written case.
    @returns Evidence string.
    """
    rng = np.random.default_rng(5)
    alphas = np.arange(0.0, 9.01, 1.0)
    worst = 0.0
    worst_geom: Tuple = ()
    n_flagged = n = 0
    for _ in range(30):
        span_m = float(rng.uniform(1.0, 40.0))
        AR = float(rng.uniform(6.0, 40.0))
        taper = float(rng.uniform(0.2, 1.0))
        sweep_deg = float(rng.uniform(0.0, 25.0))
        try:
            polar = wing_polar(
                span_m, span_m**2 / AR, taper, sweep_deg, 2.0, 0.0,
                _UP, _LO, _LEW, _TE, alphas, 12.0, 1.0, 1.8e-5,
                n_crit=11.0, extra_CD0=0.006,
            )
        except NoValidPointError:
            continue
        n += 1
        ratio = polar.CL_slope_per_rad / polar.CL_slope_inviscid_per_rad
        if polar.slope_flags:
            n_flagged += 1
        if ratio > worst:
            worst, worst_geom = ratio, (round(span_m, 2), round(AR, 2), round(taper, 3))
        assert ratio <= 1.0 + 1e-12, (
            f"span {span_m:.3f} AR {AR:.2f} taper {taper:.3f}: viscous/inviscid slope "
            f"ratio {ratio:.9f} > 1 -- free lift"
        )
        assert polar.CL_slope_per_rad > 0.0, "non-positive lift slope emitted"
    return (f"{n} planforms, max viscous/inviscid ratio {worst:.9f} at {worst_geom}, "
            f"{n_flagged} carried clamp flags")


def test_B4_correction_runs_free_where_a_credible_slope_exists() -> str:
    """The correction must actually apply somewhere, not always return the inviscid.

    @description Without this test the fix could degenerate into "always return the
        inviscid slope", which passes every bound check and quietly deletes the viscous
        model. So scan a speed band rather than assert at one hand-picked point: where
        NeuralFoil returns a credible sub-2*pi a0, the ratio must land STRICTLY inside
        (floor, 1) with NO clamp flags, and the resulting slope must be strictly below
        the inviscid VLM value. Requires at least three such points, so a single lucky
        operating condition cannot carry the test.
    @returns Evidence string.
    """
    rows = []
    live = []
    for V_ms in HIGH_RE_SCAN_V_MS:
        polar = _polar(HIGH_RE, V_ms, np.arange(0.0, 9.01, 1.0))
        ratio = polar.CL_slope_per_rad / polar.CL_slope_inviscid_per_rad
        rows.append(
            f"Re {polar.Re_mean[0]:,.0f} a0 {polar.a0_section_per_rad/(2*math.pi):.4f}"
            f"x2pi ratio {ratio:.6f} {'FREE' if not polar.slope_flags else 'clamped'}"
        )
        if polar.slope_flags:
            continue
        assert polar.a0_section_per_rad < 2.0 * math.pi, (
            f"unclamped at a0 {polar.a0_section_per_rad:.4f} /rad, which is above 2*pi"
        )
        assert aeropolar._SLOPE_RATIO_FLOOR < ratio < 1.0, (
            f"unclamped ratio {ratio:.6f} is not a live correction (must be strictly "
            f"inside ({aeropolar._SLOPE_RATIO_FLOOR}, 1.0))"
        )
        assert polar.CL_slope_per_rad < polar.CL_slope_inviscid_per_rad, (
            "an unclamped correction did not reduce the slope"
        )
        live.append(ratio)

    assert len(live) >= 3, (
        f"the viscous correction never ran free across {len(HIGH_RE_SCAN_V_MS)} "
        f"operating points -- it has degenerated into 'always return the inviscid "
        f"slope'. Scan: {'; '.join(rows)}"
    )
    return (f"{len(live)}/{len(HIGH_RE_SCAN_V_MS)} points unclamped, viscous reduction "
            f"{100*(1-max(live)):.2f}%..{100*(1-min(live)):.2f}%  |  "
            + "; ".join(rows))


def test_B5_answer_does_not_depend_on_the_stencil_that_caused_the_defect() -> str:
    """Swapping the lift-slope stencil must not move case A's polar.

    @description The defect's root input was _LIFT_SLOPE_ALPHAS_DEG = (-2, +4): a
        6-degree secant across a nonlinear low-Re lift curve. If the fix were a retuned
        stencil, restoring the old one would restore the defect. It must not: the
        physical bound, not the stencil, decides the answer here.
    @returns Evidence string.
    """
    original = aeropolar._LIFT_SLOPE_ALPHAS_DEG
    try:
        aeropolar._VLM_CACHE.clear()
        base = _polar(CASE_A, CASE_A_V_MS)
        moved = {}
        for stencil in ((-2.0, 4.0), (-0.5, 0.5), (-3.0, -1.5, 0.0, 1.5, 3.0)):
            aeropolar._LIFT_SLOPE_ALPHAS_DEG = stencil
            aeropolar._VLM_CACHE.clear()
            trial = _polar(CASE_A, CASE_A_V_MS)
            moved[stencil] = abs(trial.CL_slope_per_rad - base.CL_slope_per_rad)
            assert trial.CL_slope_per_rad <= trial.CL_slope_inviscid_per_rad * (1 + 1e-12)
    finally:
        aeropolar._LIFT_SLOPE_ALPHAS_DEG = original
        aeropolar._VLM_CACHE.clear()
    worst = max(moved.values())
    assert worst < 1e-9, (
        f"the lift slope still depends on the stencil (worst move {worst:.3e} /rad): "
        f"{ {k: f'{v:.3e}' for k, v in moved.items()} }"
    )
    return (f"3 stencils incl. the original (-2,+4): max slope movement {worst:.3e} /rad "
            f"about {base.CL_slope_per_rad:.4f} /rad")


def test_B6_MUTATION_inflated_a0_is_capped_and_reported() -> str:
    """MUTATION: force NeuralFoil to report a huge a0; the bound and the flag must hold.

    @description This is the mutation the ORIGINAL code failed: an inflated section
        slope propagated straight through into a finite-wing slope above the inviscid
        VLM value. Here it must be capped AND the cap must be reported. Also mutates
        downward, to prove the floor is reported rather than swallowed too.
    @returns Evidence string.
    """
    real_section_polar = aeropolar.section_polar

    def _scaled_section_polar(scale: float) -> Callable:
        def _sp(*args, **kwargs):
            polar = real_section_polar(*args, **kwargs)
            return polar._replace(CL=polar.CL * scale)
        return _sp

    seen = {}
    try:
        for label, scale in (("a0 inflated 3x", 3.0), ("a0 collapsed 0.05x", 0.05)):
            aeropolar.section_polar = _scaled_section_polar(scale)
            aeropolar._VLM_CACHE.clear()
            polar = _polar(CASE_A, CASE_A_V_MS, np.array([0.0, 4.0]))
            seen[label] = (
                polar.CL_slope_per_rad,
                polar.CL_slope_inviscid_per_rad,
                polar.slope_flags,
            )
    finally:
        aeropolar.section_polar = real_section_polar
        aeropolar._VLM_CACHE.clear()

    used_hi, inv_hi, flags_hi = seen["a0 inflated 3x"]
    assert used_hi <= inv_hi * (1 + 1e-12), (
        f"a 3x inflated section slope produced {used_hi:.4f} /rad against an inviscid "
        f"bound of {inv_hi:.4f} -- the cap does not hold"
    )
    assert "slope_capped_at_inviscid_vlm" in flags_hi, (
        f"the cap bound but was not reported; flags {flags_hi}"
    )

    used_lo, inv_lo, flags_lo = seen["a0 collapsed 0.05x"]
    assert "a0_below_floor" in flags_lo and "slope_ratio_floored" in flags_lo, (
        f"a collapsed section slope was clamped without reporting it; flags {flags_lo}"
    )
    assert abs(used_lo - aeropolar._SLOPE_RATIO_FLOOR * inv_lo) < 1e-9, (
        f"floor not applied as documented: {used_lo:.6f} vs "
        f"{aeropolar._SLOPE_RATIO_FLOOR * inv_lo:.6f} /rad"
    )

    healthy = _polar(CASE_A, CASE_A_V_MS, np.array([0.0, 4.0]))
    assert healthy.slope_flags == ("a0_above_inviscid_ceiling",
                                   "slope_capped_at_inviscid_vlm"), (
        f"module did not recover from the mutation; flags {healthy.slope_flags}"
    )
    return (f"inflated -> {used_hi:.4f} /rad capped at inviscid {inv_hi:.4f}, "
            f"flags {flags_hi}; collapsed -> {used_lo:.4f} /rad at the "
            f"{aeropolar._SLOPE_RATIO_FLOOR} floor, flags {flags_lo}")


def test_B7_raw_a0_is_reported_even_when_it_is_not_believed() -> str:
    """The unclamped NeuralFoil a0 must stay visible on the polar.

    @description The module's decision is that a0 > 2*pi(1 + 0.77 t/c) at low Re is a
        surrogate artefact of a nonlinear lift curve, not a real slope. That decision is
        auditable only if the raw number survives to the caller alongside the flag.
    @returns Evidence string.
    """
    polar = _polar(CASE_A, CASE_A_V_MS)
    assert polar.a0_section_per_rad > 2.0 * math.pi, (
        f"case A's raw a0 is {polar.a0_section_per_rad:.4f} /rad; this test assumed the "
        "above-2*pi condition it is auditing"
    )
    assert "a0_above_inviscid_ceiling" in polar.slope_flags
    airfoil = aeropolar._kulfan_airfoil(_UP, _LO, _LEW, _TE)
    t_over_c = float(airfoil.max_thickness())  # dimensionless
    ceiling = 2.0 * math.pi * (1.0 + aeropolar._THICKNESS_LIFT_SLOPE_FACTOR * t_over_c)
    assert polar.a0_section_per_rad > ceiling, "the ceiling was not the binding clamp"
    return (f"raw a0 {polar.a0_section_per_rad:.4f} /rad "
            f"= {polar.a0_section_per_rad/(2*math.pi):.3f} x 2pi reported; "
            f"t/c {t_over_c:.5f} -> ceiling {ceiling:.4f} /rad; flags "
            f"{polar.slope_flags}")


# =============================================================================
# Cross-cutting: the fix must not move the physics it was not supposed to move
# =============================================================================


def test_C1_case_A_endurance_factor_is_unmoved() -> str:
    """Case A's best CL^1.5/CD must still derive to ~24.30 from the geometry.

    @description The endurance figure of merit depends on CD-as-a-function-of-CL, which
        the lift-slope fix does not touch. If this moves materially, the fix leaked into
        the drag polar. 24.30 is the SOLVER-DERIVED value; a literal here would be the
        exact defect the operator objected to, so it is asserted as a band around the
        derived number, not substituted for it.
    @returns Evidence string.
    """
    polar = _polar(CASE_A, CASE_A_V_MS)
    CL, CD, factor = best_endurance_point(polar)
    assert 24.0 <= factor <= 24.6, (
        f"case A best CL^1.5/CD = {factor:.4f}, expected ~24.30"
    )
    return f"best CL^1.5/CD = {factor:.4f} at CL {CL:.4f}, CD {CD:.5f}"


def test_C2_free_energy_invariants_survive_the_fix() -> str:
    """No polar may carry CD <= 0 or CDi < 0, and no certified point may be non-lifting.

    @description The renormalisation multiplies CDi by s_ref/area_m2; a sign or
        reciprocal slip there would be a drag reduction the optimizer would find.
    @returns Evidence string.
    """
    checked = 0
    for geom, V_ms in ((CASE_A, CASE_A_V_MS), (ARCH1, ARCH1_V_MS),
                       (HIGH_RE, HIGH_RE_V_MS)):
        polar = _polar(geom, V_ms)
        assert np.all(polar.CD > 0.0), f"CD <= 0 (min {polar.CD.min():.6g})"
        assert np.all(polar.CDi >= 0.0), f"CDi < 0 (min {polar.CDi.min():.6g})"
        assert np.all(polar.CDp > 0.0), f"CDp <= 0 (min {polar.CDp.min():.6g})"
        assert np.allclose(polar.CD, polar.CDi + polar.CDp), "CD != CDi + CDp"
        assert 0.0 < polar.e_oswald <= 1.2, f"e_oswald {polar.e_oswald:.4f} unphysical"
        checked += 1
    return f"{checked} polars: CD > 0, CDi >= 0, CD == CDi + CDp, e_oswald in range"


def test_C3_wing_polar_is_still_deterministic() -> str:
    """Two identical calls must be bit-identical, cache warm or cold.

    @description An optimizer's finite-difference gradients are meaningless otherwise,
        and the new flag path must not introduce order dependence.
    @returns Evidence string.
    """
    aeropolar._VLM_CACHE.clear()
    cold = _polar(CASE_A, CASE_A_V_MS)
    warm = _polar(CASE_A, CASE_A_V_MS)
    assert np.array_equal(cold.CL, warm.CL), "CL not bit-identical"
    assert np.array_equal(cold.CD, warm.CD), "CD not bit-identical"
    assert cold.CL_slope_per_rad == warm.CL_slope_per_rad, "slope not bit-identical"
    assert cold.slope_flags == warm.slope_flags, "flags differ between calls"
    return f"cold == warm, flags {cold.slope_flags}"


# -----------------------------------------------------------------------------
# Standalone runner (no pytest in this venv)
# -----------------------------------------------------------------------------

_TESTS: List[Callable[[], str]] = [
    test_A1_defect_planform_no_longer_aborts,
    test_A2_vlm_coefficients_referenced_to_requested_area,
    test_A3_fix_is_the_referencing_not_a_loosened_tolerance,
    test_A4_random_planform_sweep_raises_no_assertionerror,
    test_A5_no_valid_point_error_is_catchable_as_valueerror,
    test_A6_MUTATION_strip_check_still_detects_a_real_binning_fault,
    test_A7_MUTATION_strip_geometry_closure_is_enforced,
    test_B1_case_A_slope_no_longer_exceeds_inviscid,
    test_B2_archetype1_clamp_no_longer_binds_in_silence,
    test_B3_slope_bound_holds_across_the_design_space,
    test_B4_correction_runs_free_where_a_credible_slope_exists,
    test_B5_answer_does_not_depend_on_the_stencil_that_caused_the_defect,
    test_B6_MUTATION_inflated_a0_is_capped_and_reported,
    test_B7_raw_a0_is_reported_even_when_it_is_not_believed,
    test_C1_case_A_endurance_factor_is_unmoved,
    test_C2_free_energy_invariants_survive_the_fix,
    test_C3_wing_polar_is_still_deterministic,
]


def main() -> int:
    """Run every regression check and print the actual computed evidence.

    @description Prints one PASS/FAIL line per check with the numbers it measured, so a
        green run is auditable rather than merely reassuring.
    @returns 0 if every check passed, 1 otherwise.
    """
    import time

    print("=" * 78)
    print("aerosim.aeropolar robustness regression")
    print(f"  aerosandbox {asb.__version__}   numpy {np.__version__}")
    print("=" * 78)
    failures = 0
    for fn in _TESTS:
        t0 = time.perf_counter()
        try:
            detail = fn()
            print(f"  [PASS] {fn.__name__} ({time.perf_counter()-t0:.1f} s)")
            print(f"         {detail}")
        except BaseException as exc:  # noqa: BLE001 -- report, do not abort the suite
            failures += 1
            print(f"  [FAIL] {fn.__name__} ({time.perf_counter()-t0:.1f} s)")
            print(f"         {type(exc).__name__}: {exc}")
            traceback.print_exc()
    print("\n" + "=" * 78)
    verdict = "PASS" if failures == 0 else "FAIL"
    print(f"{verdict}  --  {len(_TESTS)-failures}/{len(_TESTS)} checks passed")
    print("=" * 78)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
