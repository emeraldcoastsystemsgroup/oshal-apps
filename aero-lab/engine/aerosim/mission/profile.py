"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | MissionProfile (frozen interface), the
  |                                           | mission wind-field builder (reusing
  |                                           | env/wind.py ShearLayerWindField +
  |                                           | DrydenTurbulenceField -- no new wind
  |                                           | model), the gust-placard check from
  |                                           | SPEC_materials section 3, and the
  |                                           | GV-5 15 Hz spectrum-computed eta_track
  |                                           | dynamic penalty (footprint rule: no
  |                                           | sub-second simulation).
-------------------------------------------------------------------------------

aerosim.mission.profile -- WHAT a realistic flight is, before anything flies it.

UNITS: SI everywhere; every quantity carries its unit in its name.

HONESTY LEDGER (module-level; unsourced or judgment values, flagged loudly)
    H-M1  POA/airspeed -> PV-power coupling factor in the eta_track dynamic
          penalty is bounded at 1.0 (relative power modulation cannot exceed
          the relative gust modulation to first order). This is an upper-bound
          coupling, not a measured transfer function. Effect: the penalty is
          conservative (over-billed, never under-billed).
    H-M2  The shear profile below the anchor altitude uses the 1/7 power law
          (Hellmann exponent 0.143, open terrain). Real stratospheric profiles
          are not power laws; the vehicle cruises AT the anchor altitude where
          the profile equals wind_mean_ms exactly, so the shape below matters
          only to transient excursions. Flagged, not silently defaulted.
"""

from __future__ import annotations

import math
from typing import Optional, Sequence, Union

import numpy as np

from ..env.wind import (
    DrydenTurbulenceField,
    ShearLayerWindField,
    make_uniform_field,
)
from ..vehicle.param_bounds import Bounds, validate_declared

# ------------------------------------------------------------------------------
# Constants (every one cited or flagged in the module HONESTY ledger above)
# ------------------------------------------------------------------------------

#: s in one solar day (same constant integrate.py uses).
DAY_S: float = 86400.0

#: Dryden turbulence scale length above 2000 ft, m. MIL-F-8785C: L_u = L_v =
#: L_w = 1750 ft = 533.4 m for medium/high-altitude turbulence.
DRYDEN_L_HIGH_ALT_M: float = 533.4

#: Peak-factor mapping an RMS turbulence intensity to the "derived gust" the
#: placard is written against: U_peak ~= 3 * sigma. Standard continuous-gust
#: design practice (Hoblit, "Gust Loads on Aircraft: Concepts and
#: Applications", AIAA Education Series, 1988, ch. 4: limit-load exceedance
#: set near the 3-sigma level of the gust process).
GUST_PEAK_FACTOR: float = 3.0

#: MPPT re-solve rate, Hz. Genasun GV-5 datasheet (Sunforge LLC, 2021):
#: "MPPT update at 15 Hz". Between re-solves the operating voltage is HELD --
#: power flicker faster than this is not tracked (SPEC_electrical section 2.1).
F_TRACK_HZ_DEFAULT: float = 15.0

#: Hellmann power-law exponent for the sub-anchor shear shape, open terrain.
#: Hellmann (1916); Peterson & Hennessey, J. Appl. Meteorology 17 (1978).
#: See HONESTY H-M2.
HELLMANN_EXPONENT: float = 0.143

#: Design load factor the gust placard assumes when the vehicle declares none.
#: Same value as vehicle/structure.py DESIGN_LOAD_FACTOR_DEFAULT (3.0) -- read
#: there at use-site so the two cannot drift.
#: SPEC_materials section 3: n = 3 covers a derived gust of only ~6 m/s at
#: solar-plane wing loadings; the placard default below is exactly that limit.
GUST_PLACARD_MS_DEFAULT: float = 6.0

#: Deterministic seed for the mission's Dryden realisation. A mission is a
#: reproducible experiment: the same profile must fly the same air. Change the
#: profile (any field) to change the flight, never the hidden seed.
MISSION_DRYDEN_SEED: int = 20260802


class GustPlacardError(RuntimeError):
    """Raised when the commanded environment exceeds the design's gust placard.

    @description SPEC_materials section 3 disposition: an n = 3 design carries
        an explicit operational limit -- no flight in conditions with derived
        gusts above the placard (default 6 m/s). The mission module enforces it
        as a hard constraint, not a narrative footnote: the run FAILS unless
        the design explicitly states n >= 4.
    """


class MissionProfile:
    """The realistic-flight environment order: where, when, how long, how rough.

    @description Frozen public interface (build contract). All numeric fields
        are range-checked at construction through the same PARAM_BOUNDS
        pattern every vehicle element uses.
    @param start_utc_h UTC hour of day at mission time t = 0, h, [0, 24).
    @param duration_s Mission length, s, > 0.
    @param altitude_m Cruise altitude, m MSL -- a scalar for constant-altitude
        missions or a 1-D array of altitudes interpreted as an equally spaced
        profile over the mission duration (resampled to the runner's chunk
        grid; climbs are billed, descents credit nothing -- see runner.py).
    @param lat_deg Site latitude, deg north.
    @param day_of_year 1..366.
    @param wind_mean_ms Mean horizontal wind at the cruise altitude, m/s.
    @param shear True (default) builds the sheared profile (ShearLayerWindField
        anchored to wind_mean_ms at cruise altitude); False = uniform wind.
    @param dryden_sigma_ms RMS Dryden turbulence intensity, m/s (all three
        axes; MIL-F-8785C high-altitude form with L = 533.4 m).
    @param gust_placard_ms Operational derived-gust limit, m/s (SPEC_materials
        section 3: the n = 3 placard, default 6.0). The environment's 3-sigma
        derived gust exceeding this FAILS the run unless the design states
        n >= 4.
    @raises ParamBoundsError On any out-of-range numeric field.
    """

    #: Declared credible range for every numeric constructor parameter
    #: (vehicle/param_bounds.py pattern -- the round-3 class guard).
    PARAM_BOUNDS: dict = {
        "start_utc_h": Bounds(0.0, 24.0, hi_open=True, unit="h",
                              why="an hour of day; 24 wraps to 0"),
        "duration_s": Bounds(0.0, 100.0 * DAY_S, lo_open=True, unit="s",
                             why="a mission longer than 100 days should be run "
                                 "as staged missions; unbounded time is how a "
                                 "runaway loop eats the operator's machine"),
        "altitude_m": Bounds(0.0, 40000.0, unit="m",
                             why="env.atmosphere validity is 0..47 km; 40 km "
                                 "leaves margin for gust excursions"),
        "lat_deg": Bounds(-90.0, 90.0, unit="deg", why="a latitude"),
        "day_of_year": Bounds(1.0, 366.0, unit="-", why="a calendar day"),
        "wind_mean_ms": Bounds(0.0, 60.0, unit="m/s",
                               why="60 m/s is the strong polar-night jet; "
                                   "beyond it no vehicle in this class "
                                   "penetrates and the number is a typo"),
        "dryden_sigma_ms": Bounds(0.0, 15.0, unit="m/s",
                                  why="MIL-F-8785C 'severe' is ~7 m/s; 15 "
                                      "already exceeds any survivable case"),
        "gust_placard_ms": Bounds(0.0, 20.0, lo_open=True, unit="m/s",
                                  why="SPEC_materials section 3: the FAR-23 Vc "
                                      "gust (15.24 m/s) is an avoid-region for "
                                      "this vehicle class; a placard above 20 "
                                      "is not a placard"),
    }

    def __init__(
        self,
        start_utc_h: float,
        duration_s: float,
        altitude_m: Union[float, Sequence[float], np.ndarray],
        lat_deg: float,
        day_of_year: int,
        wind_mean_ms: float,
        shear: bool = True,
        dryden_sigma_ms: float = 0.0,
        gust_placard_ms: float = GUST_PLACARD_MS_DEFAULT,
    ) -> None:
        alt_arr = np.atleast_1d(np.asarray(altitude_m, dtype=float))
        if alt_arr.ndim != 1 or alt_arr.size < 1:
            raise ValueError("MissionProfile: altitude_m must be a scalar or a "
                             "1-D array of altitudes")
        # Range-check EVERY altitude sample through the same table.
        for z in alt_arr:
            validate_declared(type(self), altitude_m=float(z))
        checked = validate_declared(
            type(self),
            start_utc_h=start_utc_h, duration_s=duration_s, lat_deg=lat_deg,
            day_of_year=float(day_of_year), wind_mean_ms=wind_mean_ms,
            dryden_sigma_ms=dryden_sigma_ms, gust_placard_ms=gust_placard_ms,
        )
        self.start_utc_h = checked["start_utc_h"]
        self.duration_s = checked["duration_s"]
        self.altitude_m = alt_arr if alt_arr.size > 1 else float(alt_arr[0])
        self.lat_deg = checked["lat_deg"]
        self.day_of_year = int(checked["day_of_year"])
        self.wind_mean_ms = checked["wind_mean_ms"]
        self.shear = bool(shear)
        self.dryden_sigma_ms = checked["dryden_sigma_ms"]
        self.gust_placard_ms = checked["gust_placard_ms"]

    # -- derived views -------------------------------------------------------

    def altitude_at_frac(self, frac: float) -> float:
        """@description Altitude at a mission fraction, m.
        @param frac Dimensionless mission progress in [0, 1].
        @returns Altitude, m (linear interpolation over an array profile)."""
        if np.isscalar(self.altitude_m):
            return float(self.altitude_m)
        alts = np.asarray(self.altitude_m, dtype=float)
        x = np.linspace(0.0, 1.0, alts.size)
        return float(np.interp(min(max(frac, 0.0), 1.0), x, alts))

    def cruise_altitude_m(self) -> float:
        """@description The anchor altitude for the wind profile, m.
        @returns The first altitude of the profile (mission entry state)."""
        return self.altitude_at_frac(0.0)

    def derived_gust_ms(self) -> float:
        """@description The environment's derived gust for the placard check.
        @returns GUST_PEAK_FACTOR * dryden_sigma_ms, m/s (3-sigma peak,
            Hoblit 1988 -- see the constant's citation)."""
        return GUST_PEAK_FACTOR * self.dryden_sigma_ms


# ------------------------------------------------------------------------------
# Wind-field construction -- REUSES env/wind.py, builds no new physics
# ------------------------------------------------------------------------------


def build_wind_field(
    profile: MissionProfile,
    dt_s: float,
    seed: int = MISSION_DRYDEN_SEED,
    reference_speed_ms: Optional[float] = None,
):
    """Assemble the mission's wind field from the shipped env/wind.py models.

    @description shear=True -> ShearLayerWindField with the 1/7 power-law shape
        (HONESTY H-M2) anchored so u(cruise altitude) = wind_mean_ms exactly;
        shear=False -> uniform field. dryden_sigma_ms > 0 wraps the base in
        DrydenTurbulenceField (MIL-F-8785C, L = 533.4 m all axes) generated on
        the slow-loop grid -- the sub-15 Hz tracking penalty is computed from
        the SPECTRUM (eta_track_dynamic_penalty), never by sub-second
        simulation (footprint rule).
    @param profile The mission order.
    @param dt_s Slow-loop step, s -- the Dryden generation grid.
    @param seed Deterministic realisation seed (default MISSION_DRYDEN_SEED).
    @param reference_speed_ms Airspeed for Taylor's frozen-turbulence tau,
        m/s; None lets DrydenTurbulenceField use its documented fallback.
    @returns An env.wind WindField.
    """
    z_ref_m = profile.cruise_altitude_m()
    if profile.shear and z_ref_m > 0.0 and profile.wind_mean_ms > 0.0:
        # 1/7 power law up to the anchor, constant above (PCHIP keeps it C1).
        # u(z) = U_ref * (z / z_ref)^0.143  (Hellmann; HONESTY H-M2).
        fracs = np.array([0.02, 0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0])
        z_nodes = np.unique(np.concatenate([[0.0], fracs * z_ref_m]))
        u_nodes = np.where(
            z_nodes <= z_ref_m,
            profile.wind_mean_ms * (np.maximum(z_nodes, 1e-9) / z_ref_m)
            ** HELLMANN_EXPONENT,
            profile.wind_mean_ms,
        )
        u_nodes[z_nodes == 0.0] = 0.0
        base = ShearLayerWindField(z_nodes, u_nodes, np.zeros_like(u_nodes))
    else:
        base = make_uniform_field(profile.wind_mean_ms, 0.0, 0.0)

    if profile.dryden_sigma_ms > 0.0:
        return DrydenTurbulenceField(
            base=base,
            sigma_ms=(profile.dryden_sigma_ms,) * 3,
            L_m=(DRYDEN_L_HIGH_ALT_M,) * 3,
            dt_s=float(dt_s),
            seed=int(seed),
            reference_speed_ms=reference_speed_ms,
        )
    return base


# ------------------------------------------------------------------------------
# Gust placard -- SPEC_materials section 3, enforced not narrated
# ------------------------------------------------------------------------------


def check_gust_placard(profile: MissionProfile, design_n_limit: float) -> bool:
    """Enforce the SPEC_materials section-3 placard disposition.

    @description "keep n = 3 and carry an explicit operational limit (no
        flight in conditions with derived gusts > 6 m/s), surfaced in the
        mission module as a hard constraint the Dryden-turbulence flight must
        respect". A design stating n >= 4 may fly the exceeding environment
        (the +9.4 % wing-mass n = 4 build); the exceedance is still RECORDED.
    @param profile The mission order.
    @param design_n_limit The design load factor the vehicle declares,
        dimensionless (3.0 when it declares none -- structure.py default).
    @returns True when the environment's derived gust exceeds the placard
        (recorded in MissionResult.gust_placard_exceeded).
    @raises GustPlacardError When exceeded AND the design does not state
        n >= 4 -- the run fails, it does not quietly continue.
    """
    exceeded = profile.derived_gust_ms() > profile.gust_placard_ms + 1e-12
    if exceeded and design_n_limit < 4.0:
        raise GustPlacardError(
            f"mission orders a 3-sigma derived gust of "
            f"{profile.derived_gust_ms():.2f} m/s (sigma = "
            f"{profile.dryden_sigma_ms:.2f} m/s x peak factor "
            f"{GUST_PEAK_FACTOR:g}) against a {profile.gust_placard_ms:.2f} "
            f"m/s placard, and the design states n = {design_n_limit:g} < 4. "
            "SPEC_materials section 3: n = 3 covers ~6 m/s derived gusts "
            "only. Either design to n = 4 (declare design_load_factor_n >= 4 "
            "on the vehicle, +9.4 % wing mass via the Stender exponent) or "
            "fly a calmer environment. The placard is a hard constraint, not "
            "a narrative footnote."
        )
    return exceeded


# ------------------------------------------------------------------------------
# GV-5 15 Hz hold rule -- eta_track dynamic penalty FROM THE SPECTRUM
# ------------------------------------------------------------------------------


def dryden_variance_fraction_above_Hz(
    f_c_Hz: float, L_m: float, v_ref_ms: float
) -> float:
    """Fraction of longitudinal Dryden gust variance above a cutoff frequency.

    @description The Dryden longitudinal PSD is S(w) = 2 sigma^2 tau /
        (1 + (w tau)^2) with tau = L/V (Taylor frozen turbulence, the same
        mapping env/wind.py uses). Its cumulative variance is
        (2/pi) atan(w tau), so the fraction ABOVE w_c = 2 pi f_c is
            F_hi = 1 - (2/pi) atan(2 pi f_c L / V)          [-]
        Closed form -- no sub-second simulation (footprint rule).
        Source: MIL-F-8785C Dryden form; the integral is elementary.
    @param f_c_Hz Cutoff frequency, Hz (the tracker's re-solve rate).
    @param L_m Turbulence scale length, m.
    @param v_ref_ms Airspeed carrying eddies past the vehicle, m/s, > 0.
    @returns Variance fraction in [0, 1].
    """
    if f_c_Hz <= 0.0:
        return 1.0
    tau_s = L_m / max(v_ref_ms, 1.0)  # same 1 m/s floor env/wind.py applies
    return 1.0 - (2.0 / math.pi) * math.atan(2.0 * math.pi * f_c_Hz * tau_s)


def eta_track_dynamic_penalty(
    sigma_ms: float,
    v_ref_ms: float,
    L_m: float = DRYDEN_L_HIGH_ALT_M,
    f_track_Hz: float = F_TRACK_HZ_DEFAULT,
) -> float:
    """The GV-5 15 Hz hold rule, computed from the turbulence spectrum.

    @description Between MPP re-solves (1/f_track = 67 ms for the GV-5) the
        operating voltage is HELD; power flicker faster than f_track is
        unrecoverable tracking loss. The relative array-power modulation is
        bounded by the relative gust modulation sigma/V (attitude/airspeed ->
        POA coupling factor <= 1, HONESTY H-M1), and only the variance
        fraction ABOVE f_track is lost, so:

            delta_eta = F_hi(f_track) * (sigma / V)^2       [-]

        For atmospheric turbulence (tau = L/V of tens of seconds) against a
        15 Hz tracker F_hi is ~1e-4: the penalty EMERGES as small because a
        15 Hz tracker genuinely out-runs the atmosphere -- that is the honest
        physical answer, not an idealisation. It grows exactly where it
        should: low airspeed, small eddies, slow trackers.
    @param sigma_ms RMS gust intensity, m/s.
    @param v_ref_ms Cruise airspeed, m/s.
    @param L_m Turbulence scale length, m (MIL-F-8785C 533.4 default).
    @param f_track_Hz Tracker re-solve rate, Hz (GV-5 datasheet 15).
    @returns Fractional eta_track reduction, dimensionless in [0, 1).
    """
    if sigma_ms <= 0.0 or v_ref_ms <= 0.0:
        return 0.0
    f_hi = dryden_variance_fraction_above_Hz(f_track_Hz, L_m, v_ref_ms)
    rel = min(sigma_ms / v_ref_ms, 1.0)  # coupling bounded at 1 (H-M1)
    return min(f_hi * rel * rel, 0.5)
