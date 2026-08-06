"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Glauert blade-element/momentum
    propeller solver (SPEC_electrical section 5): Prandtl tip+hub loss,
    sections STRICTLY via aerosim.aeropolar.section_polar (memoized on
    dRe 10% / dalpha 0.25 deg buckets with bilinear interpolation between
    bucket corners so the fixed point sees a continuous map), per-station
    momentum matching solved in induced-velocity form (finite at V = 0,
    exactly thruster.py's v_i algebra per annulus), Simpson integration on
    31 stations, tip-Mach guard, and the actuator-disk momentum floor as a
    FreeEnergyError. Anchored to UIUC-measured APC SF 10x4.7 / 11x4.7
    (aerosim/prop/uiuc_anchor.py); catalogue keys FROZEN 'apcsf_10x47',
    'apcsf_11x47'.
2 | maintainer@emeraldcoastsystemsgroup.com   | Replace the unexplained
    absolute-only swirl stop with measured combined absolute/relative
    convergence, expose the accepted residual on every PropPoint, and add a
    real 25/51/101-station stability report for thrust, torque and efficiency.

THE SECTION REPRESENTATION ('apcsf-thin') AND ITS ONE CALIBRATED NUMBER
-----------------------------------------------------------------------
The APC Slow Flyer blade is a thin undercambered section. It is represented
here as the NACA 4407 Kulfan vector (via aeropolar.naca_kulfan -- the same
CST pipeline every other surface in the project uses) evaluated at
alpha + ALPHA_REF_OFFSET_DEG, with ALPHA_REF_OFFSET_DEG = 3.5 deg. What the
offset is: the UIUC blade twist was measured photographically (PropellerScanner,
Brandt & Selig AIAA 2011-1255); for an undercambered blade the silhouette
chord joins the lower-surface tangency points and under-reads the true
chord-line angle (APC itself quotes pitch off the flat lower surface), and
NeuralFoil carries a residual low-Re cl bias for thin cambered sections. Both
land as a fixed rotation of the section's zero reference, so they are carried
as ONE section-definition angle. It was calibrated ONCE against the 10x4.7
dynamic table and then held fixed for the 11x4.7 dynamic table and both
static tables, which it passes untouched (see tests/test_bemt_uiuc.py):
worst-case CT error 4.2 %, CP 5.7 % in the anchor band. It is NOT a datasheet
number -> HONESTY ledger H-BEMT-1; bounds [0, 6] deg declared below.

UNITS: SI throughout; angles carry _deg or _rad in the name; rpm is 1/min.
"""

from __future__ import annotations

import hashlib
import math
from typing import NamedTuple

import numpy as np

from ..aeropolar import naca_kulfan, section_polar
from ..powerplant import FreeEnergyError, NoConvergenceError
from ..vehicle.param_bounds import Bounds, ParamBoundsError, require_in_range
from .uiuc_anchor import ANCHOR_CASES

__all__ = [
    "PropGeometry",
    "PropPoint",
    "PROP_CATALOGUE",
    "SECTION_CATALOGUE",
    "solve_prop_point",
    "ALPHA_REF_OFFSET_DEG",
    "TIP_MACH_LIMIT",
    "INVALID_THRUST_FRAC_TOL",
    "SWIRL_ABS_TOL_MS",
    "SWIRL_REL_TOL",
    "HONESTY_LEDGER",
    "polar_cache_info",
]

# -----------------------------------------------------------------------------
# Constants (each with its source)
# -----------------------------------------------------------------------------

#: Sutherland's-law coefficients for air (ISA 1976 / ICAO; identical values to
#: aerosim.env.sutherland_mu and aerosim.powerplant._mu_air_Pas -- cross-checked
#: numerically in tests/test_bemt_uiuc.py).
_SUTHERLAND_A_PAS_PER_SQRTK: float = 1.458e-6  # Pa*s/K^0.5
_SUTHERLAND_S_K: float = 110.4  # K

#: Speed of sound constants: gamma = 1.4 (diatomic air), R = 287.05287 J/(kg K)
#: (ISA 1976 specific gas constant for air).
_GAMMA_AIR: float = 1.4
_R_AIR_J_PER_KG_K: float = 287.05287

#: Tip Mach ceiling: the anchor envelope (UIUC tests, tip Ma ~ 0.26) and the
#: incompressible BEMT formulation both die well before 0.7; beyond it the
#: point is refused rather than extrapolated (SPEC 5.5).
TIP_MACH_LIMIT: float = 0.7

#: Calibrated zero-reference offset of the 'apcsf-thin' section, degrees.
#: See the header block -- HONESTY ledger H-BEMT-1. Bounds [0, 6]: 0 = raw
#: photographic twist; 6 deg would exceed any plausible chord-convention
#: correction for a ~4.5 % undercambered thin blade.
ALPHA_REF_OFFSET_DEG: float = 3.5

#: A prop point whose INVALID stations (Re band / NeuralFoil confidence /
#: drag floor, aeropolar's own gates) carry more than this fraction of the
#: total |thrust| integrand is marked valid=False. 0.10 mirrors aeropolar's
#: RE_FLOOR_AREA_TOLERANCE (10 % of wing AREA below the Re floor), applied to
#: the quantity a propeller exists to produce.
INVALID_THRUST_FRAC_TOL: float = 0.10

#: Memoization buckets (SPEC 5.3 caching contract): dalpha 0.25 deg,
#: dRe 10 % (log bucket), dMach 0.05. The cache is an EVALUATION cache with
#: bilinear interpolation over the (alpha, lnRe) bucket corners -- a
#: continuous map for the fixed point -- never a data source.
_ALPHA_BUCKET_DEG: float = 0.25
_LN_RE_BUCKET: float = math.log(1.10)
_MACH_BUCKET: float = 0.05

#: Fixed-point / bisection tolerances (SPEC 5.2). The station root remains at
#: numerical precision. The swirl loop uses a combined tolerance measured at
#: the UIUC 10x4.7 dynamic anchor: relaxing the absolute term through 2.5e-3
#: m/s moves thrust, torque and eta by less than 0.01%, while 25/51/101-station
#: discretisation itself moves them by 0.23%, 0.36% and 0.18%, respectively.
#: The 2.5e-3 term also clears the observed 2.17e-3 m/s limit cycle without
#: pretending that a dimensional velocity residual can be machine epsilon.
_STATION_TOL_MS: float = 1.0e-9
SWIRL_ABS_TOL_MS: float = 2.5e-3
SWIRL_REL_TOL: float = 1.0e-4
_MAX_OUTER_ITER: int = 100
_MIN_STATIONS: int = 25

HONESTY_LEDGER: tuple[str, ...] = (
    "H-BEMT-1: ALPHA_REF_OFFSET_DEG = 3.5 deg for 'apcsf-thin' is "
    "anchor-calibrated (10x4.7 dynamic table), not a datasheet value; "
    "cross-validated untouched on 11x4.7 dynamic + both statics. Replace if "
    "APC publishes true chord-line twist for the SF blade.",
    "H-BEMT-2: anchor evaluation uses ISA sea-level rho/T rather than the "
    "(unpublished per-run) UIUC tunnel state; residual Re sensitivity is far "
    "inside the acceptance bands.",
)


# -----------------------------------------------------------------------------
# Section catalogue
# -----------------------------------------------------------------------------


class _SectionModel:
    """
    @description One blade-section representation: a Kulfan CST vector plus
        the zero-reference angle its polar is queried at. Content-hashed so
        the polar memo key can never collide across sections (id() reuse after
        GC produced exactly that collision in prototyping).
    """

    def __init__(self, name: str, naca_code: str,
                 alpha_ref_offset_deg: float, source: str) -> None:
        """
        @description Build a section model from a NACA designation.
        @param name Catalogue key, e.g. 'apcsf-thin'.
        @param naca_code NACA 4-digit code fed to aeropolar.naca_kulfan.
        @param alpha_ref_offset_deg Zero-reference offset, degrees, [0, 6].
        @param source One-line provenance string.
        """
        self.name = str(name)
        self.alpha_ref_offset_deg = require_in_range(
            "alpha_ref_offset_deg", alpha_ref_offset_deg, 0.0, 6.0, unit="deg",
            element="_SectionModel",
            why="anchor-calibrated section zero reference (H-BEMT-1); beyond "
                "6 deg it would be a lift knob, not a chord convention",
        )
        self.kulfan_upper, self.kulfan_lower, self.leading_edge_weight, \
            self.te_thickness = naca_kulfan(naca_code)
        h = hashlib.sha256()
        h.update(np.asarray(self.kulfan_upper, float).tobytes())
        h.update(np.asarray(self.kulfan_lower, float).tobytes())
        h.update(np.float64(self.leading_edge_weight).tobytes())
        h.update(np.float64(self.te_thickness).tobytes())
        h.update(np.float64(self.alpha_ref_offset_deg).tobytes())
        #: Content hash -- the memo key component for this section.
        self.key = h.hexdigest()[:16]
        self.source = source


_SECTION_CACHE: dict[str, _SectionModel] = {}


def _get_section(name: str) -> _SectionModel:
    """
    @description Lazy singleton lookup of a section model (naca_kulfan pulls
        AeroSandbox geometry machinery; building it once keeps construction of
        PropGeometry cheap).
    @param name SECTION_CATALOGUE key.
    @returns The section model.
    @raises ParamBoundsError For an uncatalogued section name.
    """
    if name not in SECTION_CATALOGUE:
        raise ParamBoundsError(
            f"PropGeometry.section = {name!r} is not in SECTION_CATALOGUE "
            f"{sorted(SECTION_CATALOGUE)}; blade sections come from the "
            "catalogue so their polar provenance is pinned."
        )
    if name not in _SECTION_CACHE:
        spec = SECTION_CATALOGUE[name]
        _SECTION_CACHE[name] = _SectionModel(name, spec["naca_code"],
                                             spec["alpha_ref_offset_deg"],
                                             spec["source"])
    return _SECTION_CACHE[name]


#: Blade-section registry. 'apcsf-thin' is the anchored APC Slow Flyer
#: representation (see header). New sections join HERE with provenance.
SECTION_CATALOGUE: dict[str, dict] = {
    "apcsf-thin": {
        "naca_code": "4407",
        "alpha_ref_offset_deg": ALPHA_REF_OFFSET_DEG,
        "source": "NACA 4407 CST vector; zero reference +3.5 deg, "
                  "anchor-calibrated (H-BEMT-1), cross-validated on "
                  "apcsf_11x47 + statics",
    },
}


# -----------------------------------------------------------------------------
# Memoized section polar
# -----------------------------------------------------------------------------

_POLAR_MEMO: dict[tuple, tuple[float, float, bool]] = {}


def _polar_corner(sec: _SectionModel, ia: int, ir: int, ma_b: float,
                  n_crit: float) -> tuple[float, float, bool]:
    """
    @description One memo-bucket corner: section_polar evaluated at the bucket
        alpha / Re / Mach. The ONLY call site of section_polar in this module
        (SPEC 5.3: no lift or drag number may bypass aeropolar).
    @param sec Section model (content-hashed).
    @param ia Alpha bucket index (alpha_deg = ia * 0.25).
    @param ir ln-Re bucket index (Re = exp(ir * ln 1.10)).
    @param ma_b Mach bucket value.
    @param n_crit Transition amplification exponent.
    @returns (cl, cd, valid) at the corner.
    """
    key = (sec.key, ia, ir, ma_b, n_crit)
    hit = _POLAR_MEMO.get(key)
    if hit is None:
        p = section_polar(
            sec.kulfan_upper, sec.kulfan_lower, sec.leading_edge_weight,
            sec.te_thickness,
            np.array([ia * _ALPHA_BUCKET_DEG + sec.alpha_ref_offset_deg]),
            float(math.exp(ir * _LN_RE_BUCKET)), mach=ma_b, n_crit=n_crit,
        )
        hit = (float(p.CL[0]), float(p.CD[0]), bool(p.valid[0]))
        _POLAR_MEMO[key] = hit
    return hit


def _polar(sec: _SectionModel, alpha_deg: float, re: float, mach: float,
           n_crit: float) -> tuple[float, float, bool]:
    """
    @description Bilinear interpolation of (cl, cd) over the four surrounding
        (alpha, lnRe) bucket corners at the nearest Mach bucket. Continuous in
        its inputs, so the momentum fixed point cannot limit-cycle on bucket
        boundaries. valid requires every corner with nonzero weight valid.
    @param sec Section model.
    @param alpha_deg Section angle of attack, degrees.
    @param re Chord Reynolds number, dimensionless.
    @param mach Section Mach number, dimensionless.
    @param n_crit Transition amplification exponent.
    @returns (cl, cd, valid).
    """
    fa = alpha_deg / _ALPHA_BUCKET_DEG
    ia = math.floor(fa)
    wa = fa - ia
    fr = math.log(max(re, 1.0)) / _LN_RE_BUCKET
    ir = math.floor(fr)
    wr = fr - ir
    ma_b = round(mach / _MACH_BUCKET) * _MACH_BUCKET
    cl = cd = 0.0
    ok = True
    for i, w1 in ((ia, 1.0 - wa), (ia + 1, wa)):
        for j, w2 in ((ir, 1.0 - wr), (ir + 1, wr)):
            w = w1 * w2
            if w <= 1.0e-12:
                continue
            c_, d_, v_ = _polar_corner(sec, i, j, ma_b, n_crit)
            cl += w * c_
            cd += w * d_
            ok = ok and v_
    return cl, cd, ok


def polar_cache_info() -> dict[str, int]:
    """
    @description Cache introspection for the footprint tests.
    @returns {'entries': number of memoized bucket corners}.
    """
    return {"entries": len(_POLAR_MEMO)}


# -----------------------------------------------------------------------------
# Geometry
# -----------------------------------------------------------------------------


class PropGeometry:
    """
    @description One propeller's blade geometry: radial stations of chord and
        twist plus the section representation. Frozen public interface
        (SPEC 5): PropGeometry(name, diameter_m, n_blades, r_hub_m, r_over_R,
        c_over_R, beta_deg, section='apcsf-thin').
    """

    #: Declared bounds (SPEC 5.5). Scalars are checked by name; the per-station
    #: arrays are checked elementwise against the entries suffixed _station.
    PARAM_BOUNDS: dict[str, Bounds] = {
        "diameter_m": Bounds(0.0, 10.0, lo_open=True, unit="m",
                             why="matches Thruster's rotor bound: the largest "
                                 "HAPS props are ~2 m, 10 m is a helicopter"),
        "n_blades": Bounds(2.0, 6.0, unit="-",
                           why="1 blade needs a counterweight model; >6 is a "
                               "ducted fan, outside the anchor envelope"),
        "r_hub_over_R": Bounds(0.05, 0.35, unit="-",
                               why="UIUC geometries start at 0.15 r/R; below "
                                   "0.05 the hub singularity dominates"),
        "c_over_R_station": Bounds(0.0, 0.4, lo_open=True, unit="-",
                                   why="wider than any catalogued prop; a "
                                       "zero chord divides the polar Re"),
        "beta_deg_station": Bounds(0.0, 60.0, lo_open=True, unit="deg",
                                   why="above 60 deg the BEMT small-angle "
                                       "bracket fails before physics does"),
    }

    def __init__(self, name: str, diameter_m: float, n_blades: int,
                 r_hub_m: float, r_over_R: np.ndarray, c_over_R: np.ndarray,
                 beta_deg: np.ndarray, section: str = "apcsf-thin") -> None:
        """
        @description Construct and range-check a blade geometry.
        @param name Human-readable identifier (catalogue key for anchors).
        @param diameter_m Propeller diameter, m, (0, 10].
        @param n_blades Blade count, integer in [2, 6].
        @param r_hub_m Hub cutout radius, m; r_hub/R must be in [0.05, 0.35].
        @param r_over_R Radial stations, dimensionless, strictly increasing,
            ending at 1.0.
        @param c_over_R Chord per station, dimensionless, each in (0, 0.4].
        @param beta_deg Geometric pitch angle per station, degrees, (0, 60].
        @param section SECTION_CATALOGUE key; default the anchored
            'apcsf-thin'.
        @raises ParamBoundsError On any out-of-range value or malformed array.
        """
        self.name = str(name)
        self.diameter_m = require_in_range(
            "diameter_m", diameter_m, 0.0, 10.0, lo_open=True, unit="m",
            element="PropGeometry",
            why=self.PARAM_BOUNDS["diameter_m"].why)
        if int(n_blades) != n_blades:
            raise ParamBoundsError(
                f"PropGeometry.n_blades must be an integer, got {n_blades!r}")
        self.n_blades = int(require_in_range(
            "n_blades", int(n_blades), 2, 6, unit="-", element="PropGeometry",
            why=self.PARAM_BOUNDS["n_blades"].why))
        r = np.asarray(r_over_R, dtype=float).reshape(-1)
        c = np.asarray(c_over_R, dtype=float).reshape(-1)
        b = np.asarray(beta_deg, dtype=float).reshape(-1)
        if not (r.size == c.size == b.size) or r.size < 4:
            raise ParamBoundsError(
                f"PropGeometry '{self.name}': station arrays must be equal "
                f"length >= 4, got {r.size}/{c.size}/{b.size}")
        if np.any(np.diff(r) <= 0.0) or abs(r[-1] - 1.0) > 1.0e-9:
            raise ParamBoundsError(
                f"PropGeometry '{self.name}': r_over_R must be strictly "
                f"increasing and end at 1.0, got {r!r}")
        for i in range(r.size):
            require_in_range("c_over_R_station", float(c[i]), 0.0, 0.4,
                             lo_open=True, unit="-", element="PropGeometry",
                             why=self.PARAM_BOUNDS["c_over_R_station"].why)
            require_in_range("beta_deg_station", float(b[i]), 0.0, 60.0,
                             lo_open=True, unit="deg", element="PropGeometry",
                             why=self.PARAM_BOUNDS["beta_deg_station"].why)
        self.r_over_R = r
        self.c_over_R = c
        self.beta_deg = b
        self.r_hub_m = float(r_hub_m)
        self.r_hub_over_R = require_in_range(
            "r_hub_over_R", self.r_hub_m / (self.diameter_m / 2.0),
            0.05, 0.35, unit="-", element="PropGeometry",
            why=self.PARAM_BOUNDS["r_hub_over_R"].why)
        self.section = str(section)
        _get_section(self.section)  # existence check at construction

    @property
    def radius_m(self) -> float:
        """
        @description Tip radius, m.
        @returns diameter_m / 2.
        """
        return self.diameter_m / 2.0

    @property
    def disk_area_m2(self) -> float:
        """
        @description Full actuator-disk area pi R^2, m^2 -- the area the
            momentum floor (SPEC 6.4) and thruster.py both use.
        @returns Disk area, m^2.
        """
        return math.pi * self.radius_m ** 2


class PropPoint(NamedTuple):
    """
    @description One converged propeller operating point (frozen contract).
    @param ct Thrust coefficient T/(rho n^2 D^4), dimensionless.
    @param cp Power coefficient P/(rho n^3 D^5), dimensionless.
    @param eta Propulsive efficiency J*CT/CP, dimensionless (0 at V=0).
    @param thrust_N Thrust, N.
    @param torque_Nm Shaft torque, N*m.
    @param p_shaft_W Shaft power, W.
    @param valid False when stations failing aeropolar's certification gates
        carry more than INVALID_THRUST_FRAC_TOL of the |thrust| integrand.
    @param invalid_thrust_frac Fraction of |thrust| integrand from invalid
        stations, dimensionless (diagnostic; trailing field, defaulted).
    @param outer_iterations Swirl fixed-point iterations used.
    @param swirl_residual_ms Final maximum swirl-state delta, m/s.
    @param swirl_tolerance_ms Combined absolute/relative limit applied, m/s.
    @param n_stations Simpson radial station count used for this point.
    """

    ct: float
    cp: float
    eta: float
    thrust_N: float
    torque_Nm: float
    p_shaft_W: float
    valid: bool
    invalid_thrust_frac: float = 0.0
    outer_iterations: int = 0
    swirl_residual_ms: float = float("nan")
    swirl_tolerance_ms: float = float("nan")
    n_stations: int = 0


# -----------------------------------------------------------------------------
# The solver
# -----------------------------------------------------------------------------


def _mu_air_Pas(t_K: float) -> float:
    """
    @description Sutherland's law dynamic viscosity of air (ISA 1976 / ICAO
        coefficients; same values as aerosim.env.sutherland_mu).
    @param t_K Static temperature, K.
    @returns Dynamic viscosity, Pa*s.
    """
    return _SUTHERLAND_A_PAS_PER_SQRTK * t_K ** 1.5 / (t_K + _SUTHERLAND_S_K)


def _prandtl_F(B: int, r_m: float, R_m: float, r_hub_m: float,
               sin_phi: float) -> float:
    """
    @description Combined Prandtl tip and hub loss factor
        F = F_tip * F_hub, F_x = (2/pi) acos(exp(-f_x)) (Glauert 1935).
    @param B Blade count.
    @param r_m Station radius, m.
    @param R_m Tip radius, m.
    @param r_hub_m Hub radius, m.
    @param sin_phi sin of the local inflow angle (floored away from 0).
    @returns Loss factor in (0, 1], floored at 1e-4 to keep the momentum
        division finite at the exact tip station.
    """
    s = max(sin_phi, 1.0e-6)
    f_tip = (B / 2.0) * (R_m - r_m) / max(r_m * s, 1.0e-9)
    f_hub = (B / 2.0) * (r_m - r_hub_m) / max(r_m * s, 1.0e-9)
    F = ((2.0 / math.pi) ** 2
         * math.acos(min(math.exp(-max(f_tip, 0.0)), 1.0))
         * math.acos(min(math.exp(-max(f_hub, 0.0)), 1.0)))
    return max(F, 1.0e-4)


class _StationLoads(NamedTuple):
    """
    @description Per-station blade-element loads at a candidate induced
        velocity (internal).
    """

    dT_N_per_m: float
    dQ_Nm_per_m: float
    F: float
    valid: bool


def _station_loads(sec: _SectionModel, u_ms: float, ut_ms: float, v_ms: float,
                   omega_rad_s: float, r_m: float, c_m: float, beta_rad: float,
                   B: int, R_m: float, r_hub_m: float, rho_kgm3: float,
                   mu_Pas: float, a_sound_ms: float,
                   n_crit: float) -> _StationLoads:
    """
    @description Blade-element loads at one station for a candidate axial
        induced velocity u and (lagged) swirl ut. SPEC 5.2 equations verbatim:
        phi from atan2, alpha = beta - phi, section (cl, cd) via aeropolar,
        dT/dr and dQ/dr from the blade element, F from Prandtl.
    @param u_ms Axial induced velocity at the disk, m/s.
    @param ut_ms Tangential (swirl) induced velocity at the blade, m/s.
    @param v_ms Freestream axial velocity, m/s.
    @param omega_rad_s Shaft speed, rad/s.
    @param r_m,c_m,beta_rad Station radius, chord, pitch angle.
    @param B,R_m,r_hub_m Blade count, tip radius, hub radius.
    @param rho_kgm3,mu_Pas,a_sound_ms Air state.
    @param n_crit Transition amplification exponent.
    @returns _StationLoads.
    """
    va = v_ms + u_ms
    vt = omega_rad_s * r_m - ut_ms
    phi = math.atan2(va, vt)
    w = math.hypot(va, vt)
    alpha_deg = math.degrees(beta_rad - phi)
    re = rho_kgm3 * w * c_m / mu_Pas
    cl, cd, ok = _polar(sec, alpha_deg, re, w / a_sound_ms, n_crit)
    cph, sph = math.cos(phi), math.sin(phi)
    q = 0.5 * rho_kgm3 * w * w * B * c_m
    return _StationLoads(
        dT_N_per_m=q * (cl * cph - cd * sph),
        dQ_Nm_per_m=q * (cl * sph + cd * cph) * r_m,
        F=_prandtl_F(B, r_m, R_m, r_hub_m, sph),
        valid=ok,
    )


def _station_solve(sec: _SectionModel, ut_ms: float, v_ms: float,
                   omega_rad_s: float, r_m: float, c_m: float,
                   beta_rad: float, B: int, R_m: float, r_hub_m: float,
                   rho_kgm3: float, mu_Pas: float, a_sound_ms: float,
                   n_crit: float, u_seed_ms: float) -> tuple[float, _StationLoads]:
    """
    @description Solve one station's axial momentum balance for u by bisection
        (guaranteed bracket -> guaranteed convergence; SPEC 5.2's sanctioned
        fallback, used as the primary because NeuralFoil polars are only
        piecewise-smooth through stall). The balance, in v_i form (finite at
        V = 0, identical algebra to thruster.induced_velocity_ms per annulus):

            g(u) = dT_blade/dr (u) - 4 pi rho F r (V + u) u = 0

        g(0) <= 0 means the station produces no positive thrust at zero
        inflow (locally windmilling); u = 0 is returned with its loads --
        the negative dT is integrated honestly, not clamped.
    @param ut_ms Lagged swirl induced velocity, m/s (outer loop's job).
    @param u_seed_ms Warm-start guess from the previous outer iteration, m/s.
    @returns (u_ms, loads at u).
    @raises NoConvergenceError When no bracket exists below the doubling cap.
    """
    def g(u: float) -> tuple[float, _StationLoads]:
        ld = _station_loads(sec, u, ut_ms, v_ms, omega_rad_s, r_m, c_m,
                            beta_rad, B, R_m, r_hub_m, rho_kgm3, mu_Pas,
                            a_sound_ms, n_crit)
        mom = 4.0 * math.pi * rho_kgm3 * ld.F * r_m * (v_ms + u) * u
        return ld.dT_N_per_m - mom, ld

    g0, ld0 = g(0.0)
    if g0 <= 0.0:
        return 0.0, ld0
    hi = max(u_seed_ms * 1.5, 0.05 * omega_rad_s * r_m, 0.5)
    g_hi, _ = g(hi)
    n_grow = 0
    while g_hi > 0.0 and n_grow < 60:
        hi *= 1.6
        g_hi, _ = g(hi)
        n_grow += 1
    if g_hi > 0.0:
        raise NoConvergenceError(
            f"BEMT station r={r_m:.4f} m: no momentum bracket below "
            f"u={hi:.1f} m/s (V={v_ms:.2f} m/s, omega={omega_rad_s:.1f} "
            f"rad/s) -- blade element out-thrusts annulus momentum at any "
            "induced velocity; refusing the point."
        )
    lo = 0.0
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        g_mid, _ = g(mid)
        if g_mid > 0.0:
            lo = mid
        else:
            hi = mid
        if hi - lo < max(_STATION_TOL_MS, 1.0e-12 * hi):
            break
    u = 0.5 * (lo + hi)
    _, ld = g(u)
    return u, ld


def _assert_momentum_floor(thrust_N: float, p_shaft_W: float, v_ms: float,
                           rho_kgm3: float, disk_area_m2: float,
                           context: str) -> None:
    """
    @description THE FLOOR GUARD (SPEC 6.4). Momentum theory is exact physics
        for the ideal actuator disk; a real blade can only be worse:

            P_shaft >= T * (V + v_i),
            v_i = 0.5 * (-V + sqrt(V^2 + 2 T / (rho A)))

        (thruster.py's own v_i formula -- the two modules agree by algebra,
        not tuning; cross-checked against Thruster.induced_velocity_ms in
        tests/test_motor_esc.py). Corollaries: implied static figure of merit
        <= 0.9 (the Leishman wall Thruster's own FM bound enforces) and
        eta < 1. Violation is a solver fault, never a design.
    @param context One-line caller tag for the error message.
    @returns None.
    @raises FreeEnergyError On any violated bound.
    """
    if thrust_N <= 0.0:
        return
    v = abs(v_ms)
    v_i = 0.5 * (-v + math.sqrt(v * v + 2.0 * thrust_N
                                / (rho_kgm3 * disk_area_m2)))
    p_ideal_W = thrust_N * (v + v_i)
    if p_shaft_W < p_ideal_W * (1.0 - 1.0e-9):
        raise FreeEnergyError(
            f"{context}: BEMT shaft power {p_shaft_W:.4f} W beats the "
            f"actuator-disk floor {p_ideal_W:.4f} W for T={thrust_N:.4f} N "
            f"at V={v:.3f} m/s -- the polar returned thrust-producing drag "
            "or the tip-loss integration went non-physical."
        )
    if v == 0.0 and p_shaft_W > 0.0:
        fm = p_ideal_W / p_shaft_W
        if fm > 0.9:
            raise FreeEnergyError(
                f"{context}: implied static figure of merit {fm:.3f} exceeds "
                "0.9 (Leishman: no rotor demonstrates 0.9)."
            )
    if v > 0.0 and p_shaft_W > 0.0 and thrust_N * v / p_shaft_W >= 1.0:
        raise FreeEnergyError(
            f"{context}: propulsive efficiency "
            f"{thrust_N * v / p_shaft_W:.4f} >= 1."
        )


def _simpson(y: np.ndarray, x: np.ndarray) -> float:
    """
    @description Composite Simpson integration on a uniform odd-length grid.
    @param y Integrand samples.
    @param x Uniform abscissae (odd count).
    @returns Integral, units of y*x.
    """
    h = (x[-1] - x[0]) / (x.size - 1)
    return float(h / 3.0 * (y[0] + y[-1] + 4.0 * np.sum(y[1:-1:2])
                            + 2.0 * np.sum(y[2:-1:2])))


#: Warm-start store: geometry-name -> (v_ms, rpm, u array, ut array). Purely
#: an accelerator for repeated mission calls; results are bit-identical
#: because every station is re-solved to tolerance from any start.
_WARM_START: dict[tuple[str, int], tuple[np.ndarray, np.ndarray]] = {}


def solve_prop_point(geom: PropGeometry, v_ms: float, rpm: float,
                     rho_kgm3: float, t_K: float, *,
                     n_crit: float = 11.0,
                     n_stations: int = 31) -> PropPoint:
    """
    @description Solve one propeller operating point with Glauert BEMT +
        Prandtl tip/hub loss (SPEC 5.2). Sections strictly via
        aerosim.aeropolar.section_polar (memoized, H-BEMT bucket contract).
        Static case V = 0 uses the same equations in v_i form.
    @param geom Blade geometry (PropGeometry).
    @param v_ms Freestream axial velocity, m/s, >= 0.
    @param rpm Shaft speed, 1/min, (0, 30000].
    @param rho_kgm3 Air density, kg/m^3, > 0.
    @param t_K Static air temperature, K, > 0.
    @param n_crit Transition amplification exponent: 9 = wind tunnel
        (anchor validation), 11 = clean free flight (project default).
    @param n_stations Radial stations (odd, >= 25) for Simpson integration.
    @returns PropPoint. valid=False when invalid stations carry more than
        INVALID_THRUST_FRAC_TOL of the |thrust| integrand.
    @raises ParamBoundsError On out-of-range inputs or tip Mach > 0.7.
    @raises NoConvergenceError When a station cannot be converged.
    @raises FreeEnergyError When the result would beat the actuator disk.
    """
    v_ms = require_in_range("v_ms", v_ms, 0.0, 200.0, unit="m/s",
                            element="solve_prop_point",
                            why="negative axial inflow is the windmill "
                                "regime, outside the anchor envelope")
    rpm = require_in_range("rpm", rpm, 0.0, 30000.0, lo_open=True,
                           unit="1/min", element="solve_prop_point",
                           why="SPEC 5.5; the tip-Mach guard also applies")
    rho_kgm3 = require_in_range("rho_kgm3", rho_kgm3, 0.0, 10.0, lo_open=True,
                                unit="kg/m^3", element="solve_prop_point",
                                why="denser than any planetary atmosphere "
                                    "this project flies")
    t_K = require_in_range("t_K", t_K, 100.0, 400.0, unit="K",
                           element="solve_prop_point",
                           why="Sutherland fit range")
    if n_stations < _MIN_STATIONS or n_stations % 2 == 0:
        raise ParamBoundsError(
            f"n_stations must be odd and >= {_MIN_STATIONS} (Simpson), "
            f"got {n_stations}")

    sec = _get_section(geom.section)
    R_m = geom.radius_m
    B = geom.n_blades
    n_rev = rpm / 60.0
    omega = 2.0 * math.pi * n_rev
    mu = _mu_air_Pas(t_K)
    a_sound = math.sqrt(_GAMMA_AIR * _R_AIR_J_PER_KG_K * t_K)

    tip_mach = math.hypot(v_ms, omega * R_m) / a_sound
    if tip_mach > TIP_MACH_LIMIT:
        raise ParamBoundsError(
            f"solve_prop_point: tip Mach {tip_mach:.3f} > {TIP_MACH_LIMIT} "
            f"({geom.name} at {rpm:.0f} rpm, V={v_ms:.1f} m/s) -- "
            "compressibility outside the anchor envelope; refused.")

    r = np.linspace(geom.r_hub_m, R_m, n_stations)
    c = np.interp(r / R_m, geom.r_over_R, geom.c_over_R) * R_m
    beta = np.deg2rad(np.interp(r / R_m, geom.r_over_R, geom.beta_deg))

    warm = _WARM_START.get((geom.name, n_stations))
    if warm is not None:
        u, ut = warm[0].copy(), warm[1].copy()
    else:
        u, ut = np.zeros(n_stations), np.zeros(n_stations)

    dT = np.zeros(n_stations)
    dQ = np.zeros(n_stations)
    F = np.ones(n_stations)
    ok = np.ones(n_stations, dtype=bool)
    # Prandtl boundary condition: bound circulation vanishes at the exact hub
    # and tip stations (F -> 0 there; Glauert 1935). The endpoint stations
    # carry identically zero loading -- enforced, rather than letting the
    # 1/F floor turn 0/0 into swirl noise (measured: the raw tip station
    # flip-flopped ut between 0 and the clip at every outer iteration).
    interior = range(1, n_stations - 1)
    u[0] = u[-1] = ut[0] = ut[-1] = 0.0
    d_ut = float("inf")
    swirl_tol_ms = float("nan")
    outer_iterations = 0
    for _outer in range(_MAX_OUTER_ITER):
        outer_iterations = _outer + 1
        for i in interior:
            u[i], ld = _station_solve(
                sec, ut[i], v_ms, omega, float(r[i]), float(c[i]),
                float(beta[i]), B, R_m, geom.r_hub_m, rho_kgm3, mu, a_sound,
                n_crit, u_seed_ms=float(u[i]))
            dT[i], dQ[i], F[i], ok[i] = ld
        # Swirl momentum: dQ/dr = 4 pi rho (V+u) ut F r^2  ->  update ut.
        ut_new = dQ / (4.0 * math.pi * rho_kgm3
                       * np.maximum(v_ms + u, 1.0e-6) * F * r * r)
        ut_new = np.clip(ut_new, 0.0, 0.5 * omega * r)
        ut_new[0] = ut_new[-1] = 0.0
        d_ut = float(np.max(np.abs(ut_new - ut)))
        swirl_scale_ms = max(
            float(np.max(np.abs(ut_new))),
            float(np.max(np.abs(ut))),
        )
        swirl_tol_ms = SWIRL_ABS_TOL_MS + SWIRL_REL_TOL * swirl_scale_ms
        ut += 0.7 * (ut_new - ut)
        if d_ut <= swirl_tol_ms:
            break
    else:
        raise NoConvergenceError(
            f"solve_prop_point: swirl loop no convergence for {geom.name} at "
            f"rpm={rpm:.0f}, V={v_ms:.2f} m/s (last d_ut={d_ut:.2e} m/s, "
            f"combined tolerance={swirl_tol_ms:.2e} m/s)")

    _WARM_START[(geom.name, n_stations)] = (u.copy(), ut.copy())

    thrust_N = _simpson(dT, r)
    torque_Nm = _simpson(dQ, r)
    p_shaft_W = torque_Nm * omega
    ct = thrust_N / (rho_kgm3 * n_rev ** 2 * geom.diameter_m ** 4)
    cp = p_shaft_W / (rho_kgm3 * n_rev ** 3 * geom.diameter_m ** 5)
    J = v_ms / (n_rev * geom.diameter_m)
    eta = J * ct / cp if (cp > 0.0 and v_ms > 0.0) else 0.0

    abs_dT = np.abs(dT)
    total = float(np.sum(abs_dT))
    inv_frac = float(np.sum(abs_dT[~ok]) / total) if total > 0.0 else 0.0

    _assert_momentum_floor(thrust_N, p_shaft_W, v_ms, rho_kgm3,
                           geom.disk_area_m2,
                           context=f"solve_prop_point({geom.name})")

    return PropPoint(ct=ct, cp=cp, eta=eta, thrust_N=thrust_N,
                     torque_Nm=torque_Nm, p_shaft_W=p_shaft_W,
                     valid=bool(inv_frac <= INVALID_THRUST_FRAC_TOL),
                     invalid_thrust_frac=inv_frac,
                     outer_iterations=outer_iterations,
                     swirl_residual_ms=d_ut,
                     swirl_tolerance_ms=swirl_tol_ms,
                     n_stations=n_stations)


# -----------------------------------------------------------------------------
# Catalogue (FROZEN keys)
# -----------------------------------------------------------------------------


def _build_catalogue() -> dict[str, PropGeometry]:
    """
    @description Build the frozen prop catalogue from the UIUC-embedded
        geometry (hub cutout at the first tabulated station, 0.15 r/R).
    @returns {'apcsf_10x47': ..., 'apcsf_11x47': ...}.
    """
    out: dict[str, PropGeometry] = {}
    for key in ("apcsf_10x47", "apcsf_11x47"):
        case = ANCHOR_CASES[key]
        g = case["geometry"]
        d_m = case["diameter_m"]
        out[key] = PropGeometry(
            name=key, diameter_m=d_m, n_blades=2,
            r_hub_m=float(g["r_over_R"][0]) * d_m / 2.0,
            r_over_R=g["r_over_R"], c_over_R=g["c_over_R"],
            beta_deg=g["beta_deg"], section="apcsf-thin")
    return out


#: FROZEN catalogue keys 'apcsf_10x47', 'apcsf_11x47' (SPEC 5.4).
PROP_CATALOGUE: dict[str, PropGeometry] = _build_catalogue()


def _selftest() -> int:
    """
    @description Quick physical sanity of the solver (the full anchor run
        lives in uiuc_anchor._selftest / tests/test_bemt_uiuc.py).
    @returns 0 on pass, 1 on fail.
    """
    results: list[tuple[str, bool, str]] = []
    geom = PROP_CATALOGUE["apcsf_10x47"]
    pt = solve_prop_point(geom, 12.0, 6512.0, 1.225, 288.15, n_crit=9.0)
    results.append(("cruise point converges, eta in (0,1), valid",
                    0.0 < pt.eta < 1.0 and pt.valid,
                    f"J=0.435-class: ct={pt.ct:.4f} cp={pt.cp:.4f} "
                    f"eta={pt.eta:.3f} inv={pt.invalid_thrust_frac:.2f}"))
    pt0 = solve_prop_point(geom, 0.0, 6528.0, 1.225, 288.15, n_crit=9.0)
    fm = (pt0.thrust_N ** 1.5 / math.sqrt(2.0 * 1.225 * geom.disk_area_m2)
          / pt0.p_shaft_W)
    results.append(("static point: eta=0, implied FM <= 0.9",
                    pt0.eta == 0.0 and fm <= 0.9,
                    f"T={pt0.thrust_N:.3f} N P={pt0.p_shaft_W:.1f} W "
                    f"FM={fm:.3f}"))
    try:
        solve_prop_point(geom, 5.0, 20000.0, 1.225, 288.15)
        results.append(("tip Mach guard raises", False, "no raise at 20 krpm"))
    except ParamBoundsError as exc:
        results.append(("tip Mach guard raises", True, str(exc)[:70]))
    try:
        _assert_momentum_floor(2.0, 10.0, 10.0, 1.225, geom.disk_area_m2,
                               "selftest")
        results.append(("floor guard raises on fabricated free energy",
                        False, "20 W of thrust*V from 10 W of shaft passed"))
    except FreeEnergyError:
        results.append(("floor guard raises on fabricated free energy",
                        True, "P=10 W for T*V=20 W refused"))
    n_pass = 0
    print("=" * 79)
    print("aerosim.prop.bemt -- SOLVER SELF-TEST")
    print("=" * 79)
    for name, okk, detail in results:
        n_pass += okk
        print(f"[{'PASS' if okk else 'FAIL'}] {name}\n       {detail}")
    print(f"{n_pass}/{len(results)} checks passed; polar cache "
          f"{polar_cache_info()['entries']} entries")
    return 0 if n_pass == len(results) else 1


if __name__ == "__main__":
    import ctypes
    ctypes.windll.kernel32.SetPriorityClass(
        ctypes.windll.kernel32.GetCurrentProcess(), 0x4000
    )  # BelowNormal -- operator footprint rule
    raise SystemExit(_selftest())
