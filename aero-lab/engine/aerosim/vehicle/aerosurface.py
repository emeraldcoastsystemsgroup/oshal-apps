"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | AeroSurface: wing/sail element driven entirely by aeropolar, with log-Reynolds polar caching, wind-axis force assembly, and real trim solvers.
2 | maintainer@emeraldcoastsystemsgroup.com   | MASS CLOSURE: the wing now weighs what its geometry says it weighs. Mass is derived from vehicle/structure.py (Stender exponents calibrated to the measured AtlantikSolar airframe) or given explicitly (loud, floor-checked); the planform is envelope-checked at construction AND on every mass read, and AeroSurface joins the vehicle mass budget like PVArray/Battery. Closes round 2's massless-airframe optimum (AR 147.8 at 1.013 kg accepted).
3 | maintainer@emeraldcoastsystemsgroup.com   | PARAM BOUNDS at last (round 4): extra_CD0 and n_crit join the declared PARAM_BOUNDS table, validated at construction and re-checked on live instances via recheck_element_params. extra_CD0 in (0, 0.05] -- exactly 0.0 is REFUSED: a fuselage that weighs something wets something, so a drag-free non-wing is the boundary-rider exploit (measured: extra_CD0=0.0 admitted at usable 1.585); the quantitative wetted-area floor is enforced at the screen, where the billed fuselage mass is known; a negative value was a drag DISCOUNT; 0.05 caps a units error. n_crit in [4, 14] -- the e^N transition-amplification factor is a claim about AMBIENT TURBULENCE, not a free knob: ~9 is the standard-wind-tunnel value (XFOIL convention), 4-8 is dirty/turbulent air, 11-13 is clean-atmosphere sailplane practice, and ~14 is the quietest freestream measured (Mack's relation N ~= -8.43 - 2.4 ln(Tu) at Tu ~ 0.02%); beyond 14 the solver is being promised air that does not exist. nan/inf raise.
4 | maintainer@emeraldcoastsystemsgroup.com   | CONTINUITY IN REYNOLDS (round 4, FATAL 1 layer 1): coefficients() no longer reads the NEAREST Re bin -- it blends the two ADJACENT bin polars linearly in log-Re, so CL/CD are C0 across every bin boundary. The nearest-bin staircase put a 1.83e-3 CL jump (22.6 N on the R4 winner) at ~12.738 m/s against a trim tolerance of 9.7e-5 N; the trim fixed point oscillated across it, exhausted its iterations, and the bisection fallback walked to the 300 m/s rail where the polar has zero certified rows. Measured after: max |dCL| step 3.98e-6 over the same sweep (median 3.74e-6 -- the residual step IS the smooth gradient, no staircase left). Blended validity is AND of both bins, so an uncertified bin can never be averaged into a certified answer.
5 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 (cleanup): the last two undeclared constructor numbers join PARAM_BOUNDS. re_bins_per_decade gets [6, 24] and must be an INTEGER: it was ledgered as "cache resolution, not a physics knob", which was factually wrong -- measured, bins=1 moves the certified answer 0.8% (it IS an accuracy knob), and 0 / -3 crashed as a raw ZeroDivisionError in _bin_center_reynolds instead of a named refusal. 12 stays the shipped default; 6 is the coarsest that keeps per-bin Cd drift in the low percents, 24 is diminishing returns. incidence_deg gets [-90, 90]: it was ledgered as "angle command; trim writes to it at runtime", also wrong as a safety claim -- AeroSurface(incidence_deg=nan) constructed and every downstream coefficient lookup went silently nan. Both now raise ParamBoundsError at construction and on live-instance recheck; the two stale ledger entries are deleted per the stale-entry rule.

=============================================================================
THE ONE RULE THIS FILE ENFORCES
=============================================================================
No lift or drag coefficient is ever written down in this module. Every CL and CD
comes out of `aeropolar.wing_polar`, which comes out of NeuralFoil + AeroSandbox,
which comes out of the CST/Kulfan design vector. Search this file for a numeric
literal assigned to CL, CD, e_oswald or Cl^1.5/Cd -- there is none, and the
acceptance test proves the call happens by monkeypatching wing_polar.

The operator was right to challenge the hand-assumed Cl^1.5/Cd = 25. It happens
to land near 26 for AtlantikSolar, but that number must be DERIVED at the point
of use or the whole 30,000-candidate sweep is ranking assumptions instead of
aircraft.

=============================================================================
INTERFACE OBJECTION 4 -- the AtlantikSolar acceptance test looks over-determined
=============================================================================
The locked acceptance test reads:

    "AeroSurface on the AtlantikSolar WingGeometry at V = 9.5 m/s, rho = 1.18,
     alpha at best endurance produces lift within 2% of weight 68.0 N and drag
     consistent with CL^1.5/CD in [18, 32]"

Those are three independent constraints on two free quantities. Given
W = 68.0 N, S = 1.72 m^2, rho = 1.18 kg/m^3, V = 9.5 m/s, the lift condition
FIXES the lift coefficient:

    CL = W / (0.5 rho V^2 S) = 68.0 / (0.5*1.18*9.5^2*1.72) = 0.7425

so "alpha at best endurance" can satisfy the lift condition only if the polar's
best-endurance CL happens to be 0.7425. But the architecture brief's own
cross-check states Cl^1.5/Cd = 26.3 occurs "at CL = 1.0", and CL = 1.0 at
W = 68 N trims at V = sqrt(2W/(rho S CL)) = 8.19 m/s, not 9.5 m/s. The two
statements in the brief are mutually inconsistent by about 16% in speed.

This module does NOT tune anything to paper over that. It implements the honest
physics -- evaluate() flies at the commanded incidence, and separate real root
solvers find the trim -- and the self-test reports ALL THREE numbers side by
side (lift at the best-endurance alpha, the speed that alpha actually trims at,
and the CL^1.5/CD at the alpha that does trim 68 N at 9.5 m/s) so whoever owns
validate.py can see exactly which reading of the test is being satisfied and
which is not. Reporting the discrepancy is the correct behaviour; silently
choosing whichever branch passes would be the failure.
=============================================================================
"""

from __future__ import annotations

import warnings
from typing import TYPE_CHECKING

import numpy as np

from .geometry import WingGeometry
from .param_bounds import Bounds, ParamBoundsError, validate_declared
from .structure import (
    DESIGN_LOAD_FACTOR_DEFAULT,
    ExplicitWingMassWarning,
    check_explicit_wing_mass_kg,
    check_wing_structure_envelope,
    wing_mass_kg,
)
from .state import (
    BodyState,
    ElementForce,
    as_offset,
    moment_from_offset,
    relative_airspeed_vector,
    wind_axes,
)

if TYPE_CHECKING:  # pragma: no cover
    from ..env import AtmoSample, SolarSample, WindSample


#: Default angle-of-attack grid for cached polars, degrees. Spans from a little
#: below zero-lift to past the usual low-Reynolds stall so that trim solves have
#: a bracket, at 0.5 deg resolution (fine enough that linear interpolation error
#: in CL is well under 1e-3 in the attached-flow region).
DEFAULT_ALPHA_GRID_DEG: np.ndarray = np.arange(-6.0, 16.0 + 1e-9, 0.5)

#: Polar cache resolution, bins per decade of Reynolds number, dimensionless.
#: The locked spec says "caches a wing_polar per (Re decade, alpha grid)". A full
#: decade is far too coarse to cache on -- section Cd at these Reynolds numbers
#: changes by roughly a factor of two across one decade, so a decade-wide bin
#: would inject tens of percent of error into exactly the low-Re regime this
#: project exists to explore. 12 bins per decade means each bin spans a 21% Re
#: range, over which Cd moves well under 2%. This is strictly finer than the
#: spec and strictly more accurate; the caching behaviour it describes is intact.
RE_BINS_PER_DECADE: int = 12


class NoValidAeroPointError(RuntimeError):
    """
    @description Raised when a requested aerodynamic operating point has no
        solver-certified data -- Reynolds below aeropolar.RE_FLOOR, or the
        requested angle of attack outside the valid span of the polar. The
        optimizer may never select such a point, so this is an error rather
        than a silently-returned number.
    """


class AeroSurface:
    """
    @description A lifting surface -- wing, sail, canard or tail -- whose forces
        come entirely from a solver-derived polar. This is the element behind
        archetypes 1, 3 and 4.

        3-DOF ANGLE-OF-ATTACK CONVENTION. With no attitude state, the vehicle is
        assumed to pitch to hold the commanded incidence relative to the local
        air-relative velocity vector, so the section angle of attack is
        `incidence_deg` and the force triad is built about the instantaneous
        relative-wind direction (state.wind_axes). This is what makes gust and
        shear response fall out for free: a vertical gust rotates v_rel, which
        rotates the lift vector, which is precisely the mechanism dynamic
        soaring lives on -- no special-case code.

        IT HAS MASS. Round 2's optimizer found the global optimum to be a
        massless airframe (span and area were free, so the gate rewarded
        growing both without limit). The wing now joins the vehicle mass budget
        exactly the way PVArray and BatteryElement do: mass is DERIVED from the
        planform via vehicle/structure.py (Stender exponents, coefficient
        calibrated to the measured AtlantikSolar AS-2 airframe) at a documented
        design load factor, or pinned explicitly -- which is loud
        (ExplicitWingMassWarning) and floor-checked, never silent. `mass_kg` is
        a re-deriving property, so the envelope and the bill are re-applied on
        EVERY read: an instance built by bypassing __init__, or whose geometry
        is mutated afterwards, is caught the moment Vehicle.bind_masses (i.e.
        the integrator) asks what it weighs.
    """

    #: Joins the vehicle mass budget (see vehicle/mass.py).
    DECLARES_MASS_CLOSURE: bool = True

    #: Declared credible ranges (round 4) -- drives the constructor checks and
    #: param_bounds.recheck_element_params on live instances. The planform,
    #: load factor and explicit mass are range-checked in structure.py (their
    #: checks re-run on every mass read); incidence_deg is a runtime command
    #: the trim writes to. These two were the last unbounded knobs.
    PARAM_BOUNDS: dict[str, Bounds] = {
        # A fuselage that weighs something wets something: exactly 0.0 is the
        # boundary-rider exploit (drag-free non-wing), negative is a drag
        # DISCOUNT, and 0.05 on wing area is already a draggy strutted build.
        # The quantitative wetted-area floor is enforced by screen_design,
        # where the billed fuselage mass is known.
        "extra_CD0": Bounds(0.0, 0.05, lo_open=True, unit="-",
                            why="the vehicle carries a fuselage whether or not "
                                "the polar remembers it; 0.0 was round 4's "
                                "boundary rider (usable 1.585 admitted)"),
        # n_crit is the e^N transition amplification factor -- a claim about
        # the turbulence of the AIR, not a design variable. XFOIL convention:
        # ~9 standard wind tunnel, 4-8 dirty/turbulent freestream, 11-13 clean
        # atmosphere (sailplane practice), ~14 the quietest freestream
        # measured (Mack: N ~= -8.43 - 2.4 ln(Tu), Tu ~ 0.02% -> N ~ 14).
        "n_crit": Bounds(4.0, 14.0, unit="-",
                         why="transition-amplification claim about ambient "
                             "turbulence; beyond 14 is air that does not "
                             "exist, below 4 is not a freestream"),
        # ROUND 5: previously ledgered as "cache resolution, not a physics
        # knob" -- factually wrong. Measured: bins=1 moves the certified
        # answer 0.8% (a decade-wide bin evaluates the polar up to ~half a
        # decade off the true Re), and 0 / -3 crashed the bin math with a raw
        # ZeroDivisionError. Additionally required to be an INTEGER at
        # construction (a bin count is a count).
        "re_bins_per_decade": Bounds(6.0, 24.0, unit="1/decade",
                                     why="polar accuracy knob, not free: "
                                         "bins=1 shifts the certified answer "
                                         "0.8%, <=0 divides by zero; 12 is "
                                         "the shipped default"),
        # ROUND 5: previously ledgered as "angle command; trim writes to it
        # at runtime" -- true, but no safety claim: incidence_deg=nan
        # constructed and every coefficient lookup went silently nan. The
        # trim solvers only ever write values inside the polar's certified
        # alpha span, so bounding the COMMAND at +/-90 deg (beyond which an
        # "angle of attack relative to the wind" is not a flight condition)
        # costs nothing and kills nan/inf at the door.
        "incidence_deg": Bounds(-90.0, 90.0, unit="deg",
                                why="nan/inf incidence poisoned every "
                                    "downstream coefficient silently; beyond "
                                    "+/-90 deg the wind-axis convention is "
                                    "meaningless"),
    }

    def __init__(
        self,
        geometry: WingGeometry,
        body_index: int = 0,
        offset_m: np.ndarray | None = None,
        incidence_deg: float = 0.0,
        extra_CD0: float = 0.0,
        n_crit: float = 11.0,
        *,
        mass_kg: float | None = None,
        design_load_factor: float = DESIGN_LOAD_FACTOR_DEFAULT,
        alpha_grid_deg: np.ndarray | None = None,
        re_bins_per_decade: int = RE_BINS_PER_DECADE,
    ) -> None:
        """
        @description Construct a lifting surface.
        @param geometry The WingGeometry design vector (planform + CST weights).
        @param body_index Index of the body carrying this surface.
        @param offset_m Aerodynamic centre offset from the body reference, m.
        @param incidence_deg Commanded angle of attack relative to the local
            relative wind, degrees. Mutable at runtime -- the integrator's
            quasi-steady trim writes to it. RANGE [-90, 90] and finite
            (declared in PARAM_BOUNDS): nan/inf poisoned every downstream
            coefficient lookup silently before round 5.
        @param extra_CD0 Additional parasite drag coefficient referenced to this
            surface's area, dimensionless (fuselage, tail, landing gear,
            antenna). RANGE (0, 0.05] -- it must be STATED and positive: the
            signature's 0.0 placeholder RAISES, because a drag-free non-wing
            is the round-4 boundary-rider exploit. The billed-mass-derived
            wetted-area floor is additionally enforced by screen_design.
        @param n_crit Transition amplification factor, dimensionless. This is a
            claim about the turbulence of the air the vehicle flies in, not a
            free knob: 11 is the clean sailplane band and is the project
            default. RANGE [4, 14]; out of range RAISES (see PARAM_BOUNDS).
        @param mass_kg Explicit wing structural mass, kg, when a specific built
            wing is known. Leave None (the normal path) and it is DERIVED from
            the planform by structure.wing_mass_kg. An explicit value is LOUD
            (ExplicitWingMassWarning carries the model's own prediction next to
            the claim) and floor-checked at 0.4 kg/m^2 -- the massless airframe
            cannot be rebuilt through this argument.
        @param design_load_factor Design limit load factor n for the structural
            model, dimensionless. Default 3.0 -- the gust-margin value HALE
            solar aircraft size to (see structure.DESIGN_LOAD_FACTOR_DEFAULT).
            Range-checked to [2, 10]: turning n down is a wing-mass discount.
        @param alpha_grid_deg Angle-of-attack grid for cached polars, degrees.
        @param re_bins_per_decade Polar cache resolution, bins per Re decade.
            RANGE [6, 24], integer (declared in PARAM_BOUNDS): this is an
            ACCURACY knob -- bins=1 moved the certified answer 0.8% and
            bins<=0 divided by zero. Default 12 (RE_BINS_PER_DECADE).
        @raises MassClosureError When the planform or load factor is outside the
            structural validity envelope (e.g. aspect ratio > 40), or an
            explicit mass is below the credible floor.
        """
        self.geometry = geometry
        self.design_load_factor = float(design_load_factor)
        # Fail-closed at construction; re-checked on every mass read below.
        check_wing_structure_envelope(
            geometry.span_m, geometry.area_m2, self.design_load_factor
        )
        if mass_kg is None:
            #: Explicit mass override, kg, or None for the derived model path.
            self._explicit_mass_kg: float | None = None
        else:
            self._explicit_mass_kg = check_explicit_wing_mass_kg(
                mass_kg, geometry.area_m2
            )
            warnings.warn(
                f"AeroSurface built with EXPLICIT mass {self._explicit_mass_kg:.3f} "
                f"kg (model predicts "
                f"{wing_mass_kg(geometry.span_m, geometry.area_m2, self.design_load_factor):.3f} "
                f"kg for b={geometry.span_m:g} m, S={geometry.area_m2:g} m2, "
                f"n={self.design_load_factor:g}). Fine for a test pinning a known "
                f"build; a design sweep must use the derived path.",
                ExplicitWingMassWarning,
                stacklevel=2,
            )
        self.body_index = int(body_index)
        self.offset_m = as_offset(offset_m)
        checked = validate_declared(
            type(self),
            extra_CD0=extra_CD0,
            n_crit=n_crit,
            incidence_deg=incidence_deg,
            re_bins_per_decade=re_bins_per_decade,
        )
        self.incidence_deg = checked["incidence_deg"]
        self.extra_CD0 = checked["extra_CD0"]
        self.n_crit = checked["n_crit"]
        self.alpha_grid_deg = (
            DEFAULT_ALPHA_GRID_DEG if alpha_grid_deg is None
            else np.asarray(alpha_grid_deg, dtype=float)
        )
        # A bin count is a COUNT: in [6, 24] (checked above) and integral.
        # int(12.7) would silently resize every cache bin by 6%, so a
        # fractional value is refused, not truncated.
        if checked["re_bins_per_decade"] != int(checked["re_bins_per_decade"]):
            raise ParamBoundsError(
                f"AeroSurface.re_bins_per_decade must be an integer bin count, "
                f"got {re_bins_per_decade!r} -- truncating it would silently "
                f"resize every Reynolds cache bin"
            )
        self.re_bins_per_decade = int(checked["re_bins_per_decade"])

        #: Polar cache: {(re_bin, n_crit, alpha_grid_id) -> WingPolar}.
        self._polar_cache: dict[tuple, object] = {}
        #: Number of wing_polar calls actually made (diagnostic + cache proof).
        self.solver_calls: int = 0

        #: Diagnostics from the most recent evaluate().
        self.last_CL: float = 0.0
        self.last_CD: float = 0.0
        self.last_Re: float = 0.0
        self.last_valid: bool = False

    # -- mass ----------------------------------------------------------------

    @property
    def mass_kg(self) -> float:
        """
        @description Wing structural mass, kg, RE-DERIVED (and re-envelope-
            checked) on every read. This is the defense-in-depth half of the
            round-3 invariant: Vehicle.bind_masses reads this property each
            time the integrator closes the mass budget, so a surface built by
            bypassing __init__, or whose geometry was mutated after
            construction, still pays -- or is rejected -- at the point of use.
        @returns Wing mass, kg.
        @raises MassClosureError When the CURRENT geometry/load factor is
            outside the structural envelope, or the explicit mass no longer
            clears the areal-density floor for the current area.
        """
        if self._explicit_mass_kg is not None:
            return check_explicit_wing_mass_kg(
                self._explicit_mass_kg, self.geometry.area_m2
            )
        return wing_mass_kg(
            self.geometry.span_m, self.geometry.area_m2, self.design_load_factor
        )

    def mass_detail(self) -> str:
        """
        @description One-line derivation of the wing mass for the budget report.
        @returns e.g. "b=5.65 m, S=1.72 m2, AR=18.6, n=3 -> Stender/AS-2 model".
        """
        g = self.geometry
        source = (
            "explicit wing mass"
            if self._explicit_mass_kg is not None
            else "Stender/AS-2-calibrated model"
        )
        return (
            f"b={g.span_m:.2f} m, S={g.area_m2:.2f} m2, AR={g.aspect_ratio:.1f}, "
            f"n={self.design_load_factor:g} ({source})"
        )

    # -- polar acquisition ---------------------------------------------------

    def reference_reynolds(self, V_ms: float, rho_kgm3: float, mu_Pas: float) -> float:
        """
        @description Reynolds number on the mean aerodynamic chord, dimensionless.
        @param V_ms Airspeed, m/s.
        @param rho_kgm3 Air density, kg/m^3.
        @param mu_Pas Dynamic viscosity, Pa*s.
        @returns Reynolds number, dimensionless.
        """
        return rho_kgm3 * abs(V_ms) * self.geometry.reference_chord_m() / mu_Pas

    def _re_bin(self, reynolds: float) -> int:
        """
        @description Log-spaced Reynolds cache bin index, dimensionless.
        @param reynolds Reynolds number, dimensionless.
        @returns Integer bin index.
        """
        re_safe = max(float(reynolds), 1.0)
        return int(round(np.log10(re_safe) * self.re_bins_per_decade))

    def _bin_center_reynolds(self, re_bin: int) -> float:
        """
        @description Representative Reynolds number of a cache bin, dimensionless.
        @param re_bin Bin index.
        @returns Reynolds number at the bin centre.
        """
        return float(10.0 ** (re_bin / self.re_bins_per_decade))

    def _re_bin_bracket(self, reynolds: float) -> tuple[int, int, float]:
        """
        @description The two cache bins bracketing a Reynolds number in log-Re,
            with the linear blend weight of the UPPER bin. This is what makes
            the cached polar family continuous in Re: at a bin centre the weight
            is exactly 0 (pure lower bin), and approaching the next centre it
            tends to 1, so the blended coefficients are C0 across every
            boundary. The old nearest-bin lookup was a staircase whose treads
            met in a CL jump at every half-bin edge -- 1.83e-3 in CL (22.6 N)
            on the R4 winner -- which is what broke the trim fixed point.
        @param reynolds Reynolds number, dimensionless.
        @returns (lower_bin, upper_bin, weight_of_upper in [0, 1)).
        """
        re_safe = max(float(reynolds), 1.0)
        x = float(np.log10(re_safe) * self.re_bins_per_decade)
        b_lo = int(np.floor(x))
        return b_lo, b_lo + 1, x - b_lo

    def polar(self, V_ms: float, rho_kgm3: float, mu_Pas: float):
        """
        @description Fetch (or compute and cache) the wing polar covering this
            operating point.

            The polar is evaluated at the CENTRE Reynolds number of the cache
            bin, not at the exact instantaneous Re, so that a 24 h trajectory
            whose speed wanders by a few percent reuses one solver call instead
            of forcing thousands. NOTE: this grid-shaped view keeps the
            nearest-bin convention (it is what best_endurance and the trim
            bracket use); the CONTINUOUS per-point lookup is coefficients(),
            which blends the two adjacent bins in log-Re.

        @param V_ms Airspeed, m/s.
        @param rho_kgm3 Air density, kg/m^3.
        @param mu_Pas Dynamic viscosity, Pa*s.
        @returns A WingPolar as defined by aeropolar.
        """
        reynolds = self.reference_reynolds(V_ms, rho_kgm3, mu_Pas)
        return self._polar_for_bin(self._re_bin(reynolds), rho_kgm3, mu_Pas)

    def _polar_for_bin(self, re_bin: int, rho_kgm3: float, mu_Pas: float):
        """
        @description Fetch (or compute and cache) the wing polar of ONE cache
            bin, evaluated at that bin's centre Reynolds number. Because
            aeropolar.wing_polar is parameterised by (V, rho, mu) rather than by
            Re directly, the bin centre is hit by solving
            V_bin = Re_bin * mu / (rho * c_ref) at the true rho and mu -- which
            reproduces the target Re exactly, by definition of Re.

            The call goes through the MODULE OBJECT (`aeropolar.wing_polar`)
            rather than a bound name, so monkeypatching `aeropolar.wing_polar`
            is observed. The acceptance test depends on that.

        @param re_bin Cache bin index (see _re_bin / _re_bin_bracket).
        @param rho_kgm3 Air density, kg/m^3.
        @param mu_Pas Dynamic viscosity, Pa*s.
        @returns A WingPolar as defined by aeropolar.
        """
        from .. import aeropolar

        cache_key = (re_bin, self.n_crit, id(self.alpha_grid_deg), self.extra_CD0)

        cached = self._polar_cache.get(cache_key)
        if cached is not None:
            return cached

        re_target = self._bin_center_reynolds(re_bin)
        chord_m = self.geometry.reference_chord_m()
        v_bin_ms = re_target * mu_Pas / (rho_kgm3 * chord_m)  # m/s

        polar = aeropolar.wing_polar(
            span_m=self.geometry.span_m,
            area_m2=self.geometry.area_m2,
            taper_ratio=self.geometry.taper_ratio,
            sweep_deg=self.geometry.sweep_deg,
            twist_root_deg=self.geometry.twist_root_deg,
            twist_tip_deg=self.geometry.twist_tip_deg,
            kulfan_upper=self.geometry.kulfan_upper,
            kulfan_lower=self.geometry.kulfan_lower,
            leading_edge_weight=self.geometry.leading_edge_weight,
            TE_thickness=self.geometry.TE_thickness,
            alpha_deg=self.alpha_grid_deg,
            V_ms=v_bin_ms,
            rho_kgm3=rho_kgm3,
            mu_Pas=mu_Pas,
            n_crit=self.n_crit,
            extra_CD0=self.extra_CD0,
        )
        self.solver_calls += 1
        self._polar_cache[cache_key] = polar
        return polar

    # -- coefficient lookup --------------------------------------------------

    @staticmethod
    def _interp_certified(polar, alpha_deg: float) -> tuple[float, float, bool]:
        """
        @description Interpolate (CL, CD, valid) from ONE cached polar at an
            angle of attack, restricted to the solver-CERTIFIED points: any
            polar row with valid == False (Reynolds outside the certified band,
            NeuralFoil confidence under threshold, stalled) is excluded from
            the interpolant entirely rather than blended into it. A requested
            alpha outside the certified span returns valid = False.
        @param polar A WingPolar.
        @param alpha_deg Angle of attack, degrees.
        @returns (CL, CD, valid), coefficients dimensionless.
        """
        alpha_grid_deg = np.degrees(np.asarray(polar.alpha_rad, dtype=float))
        cl_grid = np.asarray(polar.CL, dtype=float)
        cd_grid = np.asarray(polar.CD, dtype=float)
        valid_grid = np.asarray(polar.valid, dtype=bool)

        if not valid_grid.any():
            return 0.0, 0.0, False

        a_valid = alpha_grid_deg[valid_grid]
        cl_valid = cl_grid[valid_grid]
        cd_valid = cd_grid[valid_grid]

        order = np.argsort(a_valid)
        a_valid, cl_valid, cd_valid = a_valid[order], cl_valid[order], cd_valid[order]

        in_range = bool(a_valid[0] <= alpha_deg <= a_valid[-1])
        cl = float(np.interp(alpha_deg, a_valid, cl_valid))
        cd = float(np.interp(alpha_deg, a_valid, cd_valid))
        return cl, cd, in_range

    def coefficients(
        self, alpha_deg: float, V_ms: float, rho_kgm3: float, mu_Pas: float
    ) -> tuple[float, float, bool]:
        """
        @description (CL, CD, valid) at an angle of attack and airspeed,
            CONTINUOUS in Reynolds number.

            The instantaneous Re is bracketed by its two adjacent cache bins and
            the two bin polars' certified interpolants are blended linearly in
            log-Re (see _re_bin_bracket). The old nearest-bin lookup made
            CL(V) a staircase whose 1.83e-3 jumps (tens of newtons at cruise
            dynamic pressure) sat against a 1e-8-relative trim tolerance -- the
            trim fixed point oscillated across the tread and fell to a rail
            where the polar was empty (the R4 winner, FATAL 1).

            VALIDITY IS AND, NEVER OR: the blended point is certified only when
            BOTH bracketing bins certify it. An uncertified bin (outside the
            Reynolds band, stalled, low confidence) can therefore never be
            averaged into a certified answer -- crossing out of the certified
            envelope flips valid to False one full bin before the numbers
            themselves could degrade.

        @param alpha_deg Angle of attack, degrees.
        @param V_ms Airspeed, m/s.
        @param rho_kgm3 Air density, kg/m^3.
        @param mu_Pas Dynamic viscosity, Pa*s.
        @returns (CL, CD, valid), coefficients dimensionless.
        """
        reynolds = self.reference_reynolds(V_ms, rho_kgm3, mu_Pas)
        b_lo, b_hi, w = self._re_bin_bracket(reynolds)

        cl_lo, cd_lo, ok_lo = self._interp_certified(
            self._polar_for_bin(b_lo, rho_kgm3, mu_Pas), alpha_deg
        )
        if w <= 0.0:
            return cl_lo, cd_lo, ok_lo
        cl_hi, cd_hi, ok_hi = self._interp_certified(
            self._polar_for_bin(b_hi, rho_kgm3, mu_Pas), alpha_deg
        )
        cl = (1.0 - w) * cl_lo + w * cl_hi
        cd = (1.0 - w) * cd_lo + w * cd_hi
        return cl, cd, bool(ok_lo and ok_hi)

    def best_endurance(self, V_ms: float, rho_kgm3: float, mu_Pas: float):
        """
        @description Best-endurance operating point of the cached polar,
            delegated to aeropolar.best_endurance_point so the maximisation
            (and its valid-points-only restriction) lives in one place.
        @param V_ms Airspeed, m/s.
        @param rho_kgm3 Air density, kg/m^3.
        @param mu_Pas Dynamic viscosity, Pa*s.
        @returns (CL, CD, CL**1.5/CD), all dimensionless.
        """
        from .. import aeropolar

        return aeropolar.best_endurance_point(self.polar(V_ms, rho_kgm3, mu_Pas))

    def best_endurance_alpha_deg(
        self, V_ms: float, rho_kgm3: float, mu_Pas: float
    ) -> float:
        """
        @description Angle of attack at the best-endurance point, degrees, found
            by locating the polar row whose CL matches the best-endurance CL.
        @param V_ms Airspeed, m/s.
        @param rho_kgm3 Air density, kg/m^3.
        @param mu_Pas Dynamic viscosity, Pa*s.
        @returns Best-endurance angle of attack, degrees.
        """
        polar = self.polar(V_ms, rho_kgm3, mu_Pas)
        cl_target, _, _ = self.best_endurance(V_ms, rho_kgm3, mu_Pas)
        cl_grid = np.asarray(polar.CL, dtype=float)
        valid_grid = np.asarray(polar.valid, dtype=bool)
        alpha_grid_deg = np.degrees(np.asarray(polar.alpha_rad, dtype=float))
        candidates = np.where(valid_grid)[0]
        if candidates.size == 0:
            raise NoValidAeroPointError("no solver-certified polar points")
        best = candidates[int(np.argmin(np.abs(cl_grid[candidates] - cl_target)))]
        return float(alpha_grid_deg[best])

    # -- trim solvers --------------------------------------------------------

    def trim_alpha_for_lift_N(
        self,
        target_lift_N: float,
        V_ms: float,
        rho_kgm3: float,
        mu_Pas: float,
    ) -> float:
        """
        @description Find the angle of attack at which this surface produces a
            given lift at a given airspeed, degrees. Real bisection on the
            certified part of the polar; no closed-form CL-alpha slope is
            assumed anywhere.
        @param target_lift_N Required lift, newtons.
        @param V_ms Airspeed, m/s.
        @param rho_kgm3 Air density, kg/m^3.
        @param mu_Pas Dynamic viscosity, Pa*s.
        @returns Trim angle of attack, degrees.
        """
        polar = self.polar(V_ms, rho_kgm3, mu_Pas)
        valid_grid = np.asarray(polar.valid, dtype=bool)
        if not valid_grid.any():
            raise NoValidAeroPointError("no solver-certified polar points to trim on")
        alpha_grid_deg = np.degrees(np.asarray(polar.alpha_rad, dtype=float))[valid_grid]

        dynamic_pressure_Pa = 0.5 * rho_kgm3 * V_ms ** 2
        cl_required = target_lift_N / (dynamic_pressure_Pa * self.geometry.area_m2)

        def lift_error(alpha_deg: float) -> float:
            cl, _, _ = self.coefficients(alpha_deg, V_ms, rho_kgm3, mu_Pas)
            return cl - cl_required

        lo_deg, hi_deg = float(alpha_grid_deg.min()), float(alpha_grid_deg.max())
        err_lo, err_hi = lift_error(lo_deg), lift_error(hi_deg)
        if err_lo * err_hi > 0.0:
            raise NoValidAeroPointError(
                f"required CL {cl_required:.4f} is outside the certified polar "
                f"(CL spans {lift_error(lo_deg) + cl_required:.4f} to "
                f"{lift_error(hi_deg) + cl_required:.4f})"
            )

        for _ in range(200):
            mid_deg = 0.5 * (lo_deg + hi_deg)
            err_mid = lift_error(mid_deg)
            if err_lo * err_mid <= 0.0:
                hi_deg = mid_deg
            else:
                lo_deg, err_lo = mid_deg, err_mid
            if hi_deg - lo_deg < 1.0e-10:
                break
        return 0.5 * (lo_deg + hi_deg)

    def trim_speed_for_lift_N(
        self,
        target_lift_N: float,
        alpha_deg: float,
        rho_kgm3: float,
        mu_Pas: float,
        v_guess_ms: float = 10.0,
    ) -> float:
        """
        @description Find the airspeed at which this surface produces a given
            lift at a fixed angle of attack, m/s.

            Fixed-point iteration rather than a closed form, because CL depends
            on Reynolds number which depends on the speed being solved for:
                V_{k+1} = sqrt( 2 L / (rho S CL(alpha, V_k)) )
            The map is a strong contraction (CL's Re-dependence is weak), and
            convergence is asserted rather than assumed.

        @param target_lift_N Required lift, newtons.
        @param alpha_deg Angle of attack, degrees.
        @param rho_kgm3 Air density, kg/m^3.
        @param mu_Pas Dynamic viscosity, Pa*s.
        @param v_guess_ms Initial guess, m/s.
        @returns Trim airspeed, m/s.
        """
        v_ms = float(v_guess_ms)
        for _ in range(100):
            cl, _, _ = self.coefficients(alpha_deg, v_ms, rho_kgm3, mu_Pas)
            if cl <= 0.0:
                raise NoValidAeroPointError(
                    f"CL = {cl:.4f} <= 0 at alpha = {alpha_deg:.2f} deg; cannot trim"
                )
            v_new_ms = np.sqrt(
                2.0 * target_lift_N / (rho_kgm3 * self.geometry.area_m2 * cl)
            )
            if abs(v_new_ms - v_ms) < 1.0e-10 * max(1.0, v_ms):
                return float(v_new_ms)
            v_ms = float(v_new_ms)
        raise NoValidAeroPointError(
            f"trim_speed_for_lift_N did not converge in 100 iterations "
            f"(last V = {v_ms:.6f} m/s, alpha = {alpha_deg:.3f} deg)"
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
        @description Aerodynamic force from the solver-derived polar.

            FREE-ENERGY GUARD: the entire force is built from
            relative_airspeed_vector and the wind-axis triad about it. Lift is
            exactly perpendicular to the AIR-relative velocity and drag exactly
            antiparallel to it, so in the air's own frame the net aerodynamic
            power on the body is -D*|v_rel| <= 0 always. A wing in uniform wind
            therefore cannot gain energy no matter how it manoeuvres; only a
            SHEARED field, where the air frame differs between two parts of the
            trajectory (or between two tethered bodies), permits extraction.
            That is exactly the physics archetypes 3 and 4 rely on, and it is a
            consequence of this construction rather than an added special case.

        @param bodies All vehicle bodies.
        @param atmo Ambient atmosphere sample.
        @param wind Local wind sample.
        @param sol Local solar sample (unused; a wing converts no energy).
        @param t_s Simulation time, s.
        @param dt_s Timestep, s.
        @returns ElementForce with power_elec_W exactly 0.0.
        """
        body = bodies[self.body_index]
        v_rel_ms = relative_airspeed_vector(body, wind)
        airspeed_ms = float(np.linalg.norm(v_rel_ms))

        if airspeed_ms <= 0.0:
            self.last_CL, self.last_CD, self.last_Re, self.last_valid = 0.0, 0.0, 0.0, False
            return ElementForce(np.zeros(3), np.zeros(3), 0.0)

        rho_kgm3 = float(atmo.rho_kgm3)
        mu_Pas = float(atmo.mu_Pas)

        cl, cd, valid = self.coefficients(
            self.incidence_deg, airspeed_ms, rho_kgm3, mu_Pas
        )
        self.last_CL, self.last_CD = cl, cd
        self.last_Re = self.reference_reynolds(airspeed_ms, rho_kgm3, mu_Pas)
        self.last_valid = valid

        dynamic_pressure_Pa = 0.5 * rho_kgm3 * airspeed_ms ** 2
        lift_N = dynamic_pressure_Pa * self.geometry.area_m2 * cl
        drag_N = dynamic_pressure_Pa * self.geometry.area_m2 * cd

        drag_axis, _side_axis, lift_axis = wind_axes(v_rel_ms)
        force_N = lift_N * lift_axis + drag_N * drag_axis

        return ElementForce(
            force_N=force_N,
            moment_Nm=moment_from_offset(self.offset_m, force_N),
            power_elec_W=0.0,
        )
