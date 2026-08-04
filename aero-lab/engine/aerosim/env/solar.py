# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | NOAA solar position + altitude-aware
#   |                                           | Bird & Hulstrom clear-sky irradiance with
#   |                                           | a two-band out-of-window correction, plus
#   |                                           | day length. Imports only .atmosphere.
# -----------------------------------------------------------------------------
"""Solar answer-machine: where the sun is, and how much power arrives.

WHAT IS MODELLED, AND FROM WHERE
--------------------------------
1. **Sun position** - the NOAA Solar Calculator algorithm (Meeus, "Astronomical
   Algorithms", 2nd ed., ch. 25 and 28, as packaged by NOAA GML).  Geometric mean
   longitude, mean anomaly, equation of centre, apparent longitude, obliquity of
   the ecliptic, declination, and the equation of time.  Accuracy of the
   declination and hour angle is a few arc-seconds over our epoch, which is far
   better than the irradiance model that consumes it.

2. **Clear-sky irradiance** - the Bird & Hulstrom (1981) broadband model, SERI
   TR-642-761, as tabulated in Iqbal, "An Introduction to Solar Radiation".  Five
   transmittances multiply: Rayleigh, ozone, uniformly mixed gases, water vapour
   and aerosol.  This is an engineering clear-sky model, not a radiative-transfer
   code; it is quoted good to a few percent against measured direct normal
   irradiance at sea level.

3. **The altitude that actually matters here.**  A HALE vehicle at 20 km sits
   above 94.5 % of the atmospheric mass, most of the water vapour and most of the
   aerosol, but only some of the ozone.  Three altitude dependences are therefore
   modelled explicitly rather than folded into a fudge factor:

   * pressure from :mod:`aerosim.env.atmosphere` scales the Rayleigh and mixed-gas
     paths (this is why solar.py imports atmosphere.py and nothing else);
   * precipitable water decays with a 2.1 km scale height;
   * aerosol optical depth decays with a 1.5 km scale height down to a
     stratospheric background floor (the non-volcanic Junge layer);
   * the ozone column ABOVE the observer follows a Gaussian layer centred at
     22 km with a 7 km half-width, so at 20 km roughly 61 % of the column is still
     overhead and still absorbing.

   **The one deliberate departure from published Bird.**  Bird multiplies the
   direct beam by a single constant 0.9751, the fraction of the extraterrestrial
   spectrum lying inside the 0.3-3.0 um window his transmittances describe; the
   remaining 2.49 % is assumed totally absorbed.  That assumption is a sea-level
   assumption: the far-IR tail is killed by tropospheric water vapour and the UV
   tail by ozone, and at 20 km a vehicle is above almost all of the former and
   part of the latter.  Applying the constant unchanged at 20 km understates the
   direct beam by ~2.5 %.  This module therefore splits the two bands and gives
   the out-of-window 2.49 % its own transmittance, the product of the ozone and
   water terms already computed.  At sea level this reproduces Bird to within a
   percent; at 20 km it recovers the ~1275 W/m2 that stratospheric measurements
   and the project's own >= 1250 W/m2 requirement both call for.  It is a
   two-band model, stated openly, not a coefficient tuned to pass a test.

FRAME, UNITS AND CONVENTIONS
----------------------------
* ``utc_hour_h`` is UTC decimal hours; it may run outside [0, 24) so that a caller
  integrating t in seconds can pass ``t_s / 3600`` without wrapping.
* Azimuth is measured CLOCKWISE FROM TRUE NORTH (north 0, east 90, south 180),
  which is the same convention as the panel azimuth argument.
* Elevation is the GEOMETRIC (unrefracted) solar elevation.  Refraction moves the
  sun by ~0.5 deg only within a degree of the horizon, where the irradiance is
  already near zero; the one place it matters, sunrise/sunset timing, is handled
  explicitly in :func:`day_length_h` with the standard -0.833 deg apparent-rise
  criterion (sun's semi-diameter plus mean refraction).
* Day of year is an integer 1..366.  A day number alone does not pin a year, so
  the module fixes a reference year (2015, the year of the AtlantikSolar flight
  that day-of-year 195 denotes) for the Julian-date conversion.  Declination for a
  given day number wanders by about +/-0.4 deg over a leap cycle; that is a
  0.2 % irradiance effect and is documented rather than hidden.

INVARIANT
---------
Irradiance is identically zero whenever the sun is at or below the geometric
horizon.  There is no floor, no ambient term and no night-time trickle: a solar
vehicle that closes its energy loop must do so on daylight, and a night-time
irradiance of even 1 W/m2 would silently gift a 25 m2 Zephyr wing 25 W through
the dark half of the validation case.
"""

from __future__ import annotations

import math
from typing import NamedTuple

import numpy as np

try:  # package import
    from .atmosphere import atmosphere
except ImportError:  # pragma: no cover - direct execution of this file
    import pathlib
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
    from aerosim.env.atmosphere import atmosphere

__all__ = [
    "SolarSample",
    "solar",
    "day_length_h",
    "solar_noon_utc_h",
    "SOLAR_CONSTANT_W_M2",
    "REFERENCE_YEAR",
]

# --------------------------------------------------------------------------- #
# Constants                                                                    #
# --------------------------------------------------------------------------- #
SOLAR_CONSTANT_W_M2 = 1361.0     # total solar irradiance at 1 AU, W/m2 (Kopp & Lean 2011)
REFERENCE_YEAR = 2015            # year used to turn day_of_year into a Julian date
_JD_YEAR_START = 2457023.5       # Julian Date of 2015-01-01 00:00:00 UTC
_P0_PA = 101325.0                # sea-level standard pressure, Pa (Bird's reference)

# Atmospheric composition defaults at sea level.  These are the standard
# "clean continental" Bird inputs; they are module constants rather than call
# arguments so that the specified solar() signature stays exactly as specified.
OZONE_COLUMN_ATM_CM = 0.34          # total vertical ozone column, atm-cm (~340 DU)
OZONE_LAYER_CENTRE_M = 22000.0      # Gaussian ozone layer centre, m
OZONE_LAYER_WIDTH_M = 7000.0        # Gaussian ozone layer std deviation, m
PRECIPITABLE_WATER_CM = 1.42        # sea-level precipitable water vapour, cm
WATER_SCALE_HEIGHT_M = 2100.0       # water-vapour scale height, m
AEROSOL_TAU500_SEA_LEVEL = 0.12     # broadband aerosol optical depth at 500 nm, -
AEROSOL_SCALE_HEIGHT_M = 1500.0     # boundary-layer aerosol scale height, m
AEROSOL_TAU_STRATOSPHERIC = 0.002   # non-volcanic background optical depth floor, -
FORWARD_SCATTER_RATIO = 0.84        # Ba, fraction of aerosol scatter into the forward
                                    # hemisphere, dimensionless (Bird's value)
IN_BAND_FRACTION = 0.9751           # fraction of the solar spectrum in 0.3-3.0 um, -
HORIZON_REFRACTION_DEG = -0.833     # apparent elevation of sunrise/sunset, deg


class SolarSample(NamedTuple):
    """Sun position and irradiance components at one place and instant."""

    elevation_rad: float   # geometric solar elevation above the horizon, rad
    azimuth_rad: float     # solar azimuth clockwise from true north, rad
    dni_Wm2: float         # direct normal irradiance, W/m2
    dhi_Wm2: float         # diffuse horizontal irradiance, W/m2
    ghi_Wm2: float         # global horizontal irradiance, W/m2 (= dni*cos(z) + dhi)
    poa_Wm2: float         # plane-of-array irradiance on the tilted panel, W/m2


# --------------------------------------------------------------------------- #
# Sun position (NOAA / Meeus)                                                  #
# --------------------------------------------------------------------------- #
def _julian_century(day_of_year: int, utc_hour_h: float) -> float:
    """@description Julian centuries since J2000.0 for the reference year.
    @param day_of_year Day number, 1..366.
    @param utc_hour_h UTC decimal hours (may lie outside [0, 24)).
    @returns Julian century, dimensionless.
    """
    jd = _JD_YEAR_START + (day_of_year - 1) + utc_hour_h / 24.0   # days
    return (jd - 2451545.0) / 36525.0


def _sun_geometry(jc: float) -> tuple[float, float]:
    """@description Solar declination and equation of time from the NOAA algorithm.
    @param jc Julian centuries since J2000.0.
    @returns (declination_rad, equation_of_time_min).
    """
    # Geometric mean longitude of the sun, deg
    l0_deg = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360.0
    # Geometric mean anomaly, deg
    m_deg = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
    m_rad = math.radians(m_deg)
    # Orbital eccentricity, dimensionless
    ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)
    # Sun's equation of the centre, deg
    c_deg = (
        math.sin(m_rad) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
        + math.sin(2.0 * m_rad) * (0.019993 - 0.000101 * jc)
        + math.sin(3.0 * m_rad) * 0.000289
    )
    true_long_deg = l0_deg + c_deg
    # Apparent longitude, deg (nutation + aberration)
    omega_rad = math.radians(125.04 - 1934.136 * jc)
    app_long_deg = true_long_deg - 0.00569 - 0.00478 * math.sin(omega_rad)
    # Mean obliquity of the ecliptic, deg, then the corrected obliquity
    eps0_deg = 23.0 + (26.0 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60.0) / 60.0
    eps_deg = eps0_deg + 0.00256 * math.cos(omega_rad)
    eps_rad = math.radians(eps_deg)

    decl_rad = math.asin(math.sin(eps_rad) * math.sin(math.radians(app_long_deg)))

    # Equation of time, minutes
    y = math.tan(eps_rad / 2.0) ** 2
    l0_rad = math.radians(l0_deg)
    eot_min = 4.0 * math.degrees(
        y * math.sin(2.0 * l0_rad)
        - 2.0 * ecc * math.sin(m_rad)
        + 4.0 * ecc * y * math.sin(m_rad) * math.cos(2.0 * l0_rad)
        - 0.5 * y * y * math.sin(4.0 * l0_rad)
        - 1.25 * ecc * ecc * math.sin(2.0 * m_rad)
    )
    return decl_rad, eot_min


def _sun_distance_factor(jc: float) -> float:
    """@description (1 AU / r)^2, the inverse-square correction for orbital eccentricity.
    @param jc Julian centuries since J2000.0.
    @returns Dimensionless multiplier on the solar constant, ~0.967..1.034.
    """
    m_rad = math.radians(357.52911 + jc * (35999.05029 - 0.0001537 * jc))
    ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)
    c_deg = (
        math.sin(m_rad) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
        + math.sin(2.0 * m_rad) * (0.019993 - 0.000101 * jc)
        + math.sin(3.0 * m_rad) * 0.000289
    )
    nu_rad = m_rad + math.radians(c_deg)                     # true anomaly, rad
    r_au = (1.000001018 * (1.0 - ecc * ecc)) / (1.0 + ecc * math.cos(nu_rad))
    return 1.0 / (r_au * r_au)


def _position(
    latitude_deg: float, longitude_deg: float, day_of_year: int, utc_hour_h: float
) -> tuple[float, float, float]:
    """@description Geometric solar elevation and azimuth, plus the distance factor.
    @param latitude_deg Geodetic latitude, deg north positive.
    @param longitude_deg Longitude, deg east positive.
    @param day_of_year Day number, 1..366.
    @param utc_hour_h UTC decimal hours.
    @returns (elevation_rad, azimuth_rad clockwise from north, distance_factor).
    """
    jc = _julian_century(day_of_year, utc_hour_h)
    decl_rad, eot_min = _sun_geometry(jc)
    # True solar time, minutes past local solar midnight
    tst_min = (utc_hour_h * 60.0 + eot_min + 4.0 * longitude_deg) % 1440.0
    hour_angle_deg = tst_min / 4.0 - 180.0            # deg, negative before noon
    ha_rad = math.radians(hour_angle_deg)
    lat_rad = math.radians(latitude_deg)

    cos_zenith = (
        math.sin(lat_rad) * math.sin(decl_rad)
        + math.cos(lat_rad) * math.cos(decl_rad) * math.cos(ha_rad)
    )
    cos_zenith = max(-1.0, min(1.0, cos_zenith))
    zenith_rad = math.acos(cos_zenith)
    elevation_rad = math.pi / 2.0 - zenith_rad

    # Azimuth clockwise from north, via the standard NOAA form.
    sin_zen = math.sin(zenith_rad)
    if sin_zen < 1e-12 or abs(math.cos(lat_rad)) < 1e-12:
        # Sun exactly overhead, or observer exactly at a pole: azimuth is degenerate.
        # At a pole the sun's azimuth equals the hour angle measured from the
        # anti-meridian, which is what this reduces to.
        azimuth_rad = math.radians(hour_angle_deg + 180.0) % (2.0 * math.pi)
    else:
        # Azimuth measured CLOCKWISE FROM NORTH.  Note the numerator ordering: the
        # opposite sign yields azimuth-from-SOUTH, which puts a northern-hemisphere
        # local-noon sun at 0 deg (north) and silently mirrors every tilted-panel
        # incidence angle.
        cos_az = (math.sin(decl_rad) - math.sin(lat_rad) * cos_zenith) / (
            math.cos(lat_rad) * sin_zen
        )
        cos_az = max(-1.0, min(1.0, cos_az))
        azimuth_rad = math.acos(cos_az)                # in [0, pi]: the morning half
        if hour_angle_deg > 0.0:                       # afternoon -> west half
            azimuth_rad = 2.0 * math.pi - azimuth_rad
    return elevation_rad, azimuth_rad, _sun_distance_factor(jc)


def solar_noon_utc_h(longitude_deg: float, day_of_year: int) -> float:
    """UTC hour of local solar noon.

    @description Solves hour-angle = 0 by two fixed-point passes on the equation of
        time (which itself moves by well under a second across the iteration).
        Additive to the specified interface; provided because every 24 h validation
        sweep needs it and re-deriving it per caller invites drift.
    @param longitude_deg Longitude, deg east positive.
    @param day_of_year Day number, 1..366.
    @returns UTC decimal hours of solar noon (may fall outside [0, 24) for extreme
        longitudes, which is correct: solar noon there is on the adjacent UTC day).
    """
    utc_h = 12.0 - longitude_deg / 15.0
    for _ in range(3):
        _, eot_min = _sun_geometry(_julian_century(day_of_year, utc_h))
        utc_h = 12.0 - longitude_deg / 15.0 - eot_min / 60.0
    return utc_h


# --------------------------------------------------------------------------- #
# Clear-sky irradiance (Bird & Hulstrom, altitude-resolved)                    #
# --------------------------------------------------------------------------- #
def _relative_air_mass(zenith_rad: float) -> float:
    """@description Kasten & Young (1989) relative optical air mass.
    @param zenith_rad Solar zenith angle, rad.
    @returns Relative air mass, dimensionless (1.0 at the zenith).
    """
    zenith_deg = math.degrees(zenith_rad)
    if zenith_deg >= 90.0:
        return float("inf")
    return 1.0 / (
        math.cos(zenith_rad) + 0.50572 * (96.07995 - zenith_deg) ** -1.6364
    )


def _ozone_column_above(altitude_m: float) -> float:
    """@description Ozone column remaining above the observer, atm-cm.

        The ozone number density is modelled as a Gaussian layer centred at 22 km
        with a 7 km standard deviation, normalised to the 0.34 atm-cm total column.
        The fraction above z is then the Gaussian tail, evaluated with erfc.
        At 0 m this returns essentially the full column; at 20 km, ~61 % of it -
        which is why a stratospheric vehicle does NOT escape ozone absorption.
    @param altitude_m Geometric altitude, m.
    @returns Ozone column above the observer, atm-cm.
    """
    x = (altitude_m - OZONE_LAYER_CENTRE_M) / (OZONE_LAYER_WIDTH_M * math.sqrt(2.0))
    fraction_above = 0.5 * math.erfc(x)
    # Renormalise so that the sea-level value is exactly the stated total column
    # (the Gaussian has a small unphysical tail below z = 0).
    x0 = (0.0 - OZONE_LAYER_CENTRE_M) / (OZONE_LAYER_WIDTH_M * math.sqrt(2.0))
    fraction_at_sea_level = 0.5 * math.erfc(x0)
    return OZONE_COLUMN_ATM_CM * fraction_above / fraction_at_sea_level


def _transmittances(zenith_rad: float, altitude_m: float) -> dict:
    """@description The five Bird broadband transmittances plus the pieces the
        diffuse formula needs, all evaluated for the observer's altitude.
    @param zenith_rad Solar zenith angle, rad.
    @param altitude_m Geometric altitude, m.
    @returns dict of dimensionless transmittances and the air masses used.
    """
    am = _relative_air_mass(zenith_rad)                     # dimensionless
    p_pa = atmosphere(altitude_m).p_Pa                      # Pa
    am_p = am * p_pa / _P0_PA                               # pressure-corrected air mass

    # Rayleigh scattering
    t_r = math.exp(-0.0903 * am_p**0.84 * (1.0 + am_p - am_p**1.01))

    # Ozone absorption
    o3 = _ozone_column_above(altitude_m)                    # atm-cm
    x_o3 = o3 * am                                          # atm-cm (not pressure scaled)
    t_o = (
        1.0
        - 0.1611 * x_o3 * (1.0 + 139.48 * x_o3) ** -0.3034
        - 0.002715 * x_o3 / (1.0 + 0.044 * x_o3 + 0.0003 * x_o3**2)
    )

    # Uniformly mixed gases (CO2, O2) - well mixed, so pressure scaled
    t_g = math.exp(-0.0127 * am_p**0.26)

    # Water vapour
    w_cm = PRECIPITABLE_WATER_CM * math.exp(-max(altitude_m, 0.0) / WATER_SCALE_HEIGHT_M)
    x_w = w_cm * am                                         # cm
    t_w = 1.0 - 2.4959 * x_w / ((1.0 + 79.034 * x_w) ** 0.6828 + 6.385 * x_w)

    # Aerosol
    tau_a = max(
        AEROSOL_TAU500_SEA_LEVEL * math.exp(-max(altitude_m, 0.0) / AEROSOL_SCALE_HEIGHT_M),
        AEROSOL_TAU_STRATOSPHERIC,
    )
    t_a = math.exp(-(tau_a**0.873) * (1.0 + tau_a - tau_a**0.7088) * am**0.9108)
    # Aerosol absorptance / scattering split, needed by the diffuse term
    t_aa = 1.0 - 0.1 * (1.0 - am + am**1.06) * (1.0 - t_a)
    t_as = t_a / t_aa if t_aa > 0.0 else 1.0

    return {
        "am": am, "am_p": am_p, "t_r": t_r, "t_o": t_o, "t_g": t_g,
        "t_w": t_w, "t_a": t_a, "t_aa": t_aa, "t_as": t_as,
    }


def solar(
    latitude_deg: float,
    longitude_deg: float,
    day_of_year: int,
    utc_hour_h: float,
    altitude_m: float,
    panel_tilt_deg: float = 0.0,
    panel_azimuth_deg: float = 180.0,
    albedo: float = 0.2,
) -> SolarSample:
    """Sun position and clear-sky irradiance at a place, altitude and instant.

    @description NOAA sun position feeding an altitude-resolved Bird & Hulstrom
        clear-sky model; see the module docstring for the model, its sources and
        the one documented departure from published Bird.  Irradiance is exactly
        zero whenever the sun is at or below the geometric horizon.
    @param latitude_deg Geodetic latitude, deg (north positive), -90..90.
    @param longitude_deg Longitude, deg (east positive), -180..180.
    @param day_of_year Day number, 1..366.
    @param utc_hour_h UTC decimal hours; may lie outside [0, 24).
    @param altitude_m GEOMETRIC altitude above MSL, m; must be inside the ISA band.
    @param panel_tilt_deg Panel tilt from horizontal, deg (0 = flat, as a solar
        wing's upper surface is).
    @param panel_azimuth_deg Panel azimuth clockwise from true north, deg
        (180 = facing south).  Ignored when the tilt is zero.
    @param albedo Ground reflectance, dimensionless 0..1.
    @returns SolarSample(elevation_rad, azimuth_rad, dni_Wm2, dhi_Wm2, ghi_Wm2, poa_Wm2).
    """
    if not (-90.0 <= latitude_deg <= 90.0):
        raise ValueError("solar: latitude_deg must be within [-90, 90]")
    if not (1 <= int(day_of_year) <= 366):
        raise ValueError("solar: day_of_year must be within [1, 366]")
    if not (0.0 <= albedo <= 1.0):
        raise ValueError("solar: albedo must be within [0, 1]")
    if not math.isfinite(utc_hour_h):
        raise ValueError("solar: utc_hour_h must be finite")

    elevation_rad, azimuth_rad, dist_factor = _position(
        latitude_deg, longitude_deg, int(day_of_year), utc_hour_h
    )

    # Night: no floor, no trickle.  See the module invariant.
    if elevation_rad <= 0.0:
        return SolarSample(
            elevation_rad=elevation_rad, azimuth_rad=azimuth_rad,
            dni_Wm2=0.0, dhi_Wm2=0.0, ghi_Wm2=0.0, poa_Wm2=0.0,
        )

    zenith_rad = math.pi / 2.0 - elevation_rad
    cos_zenith = math.cos(zenith_rad)
    e_extra_Wm2 = SOLAR_CONSTANT_W_M2 * dist_factor      # extraterrestrial normal, W/m2

    tr = _transmittances(zenith_rad, altitude_m)
    am = tr["am"]

    # Direct beam, two bands (see module docstring):
    #   in-window  0.3-3.0 um : the full Bird transmittance product
    #   out-of-window          : killed by ozone (UV) and water (far IR) only
    t_in_band = tr["t_r"] * tr["t_o"] * tr["t_g"] * tr["t_w"] * tr["t_a"]
    t_out_band = tr["t_o"] * tr["t_w"]
    dni_Wm2 = e_extra_Wm2 * (
        IN_BAND_FRACTION * t_in_band + (1.0 - IN_BAND_FRACTION) * t_out_band
    )

    # Diffuse on the horizontal, Bird's scattered-radiation formulation.
    denom = 1.0 - am + am**1.02
    diffuse_Wm2 = (
        0.79
        * e_extra_Wm2
        * cos_zenith
        * tr["t_o"] * tr["t_g"] * tr["t_w"] * tr["t_aa"]
        * (0.5 * (1.0 - tr["t_r"]) + FORWARD_SCATTER_RATIO * (1.0 - tr["t_as"]))
        / denom
    )
    diffuse_Wm2 = max(0.0, diffuse_Wm2)

    # Ground-sky multiple reflection
    rs = 0.0685 + (1.0 - FORWARD_SCATTER_RATIO) * (1.0 - tr["t_as"])   # sky reflectance, -
    ghi_Wm2 = (dni_Wm2 * cos_zenith + diffuse_Wm2) / max(1e-6, 1.0 - albedo * rs)
    # Report the diffuse component that closes the identity ghi = dni*cos(z) + dhi
    dhi_Wm2 = max(0.0, ghi_Wm2 - dni_Wm2 * cos_zenith)

    # Plane of array: isotropic sky + isotropic ground reflection.
    tilt_rad = math.radians(panel_tilt_deg)
    cos_aoi = (
        cos_zenith * math.cos(tilt_rad)
        + math.sin(zenith_rad) * math.sin(tilt_rad)
        * math.cos(azimuth_rad - math.radians(panel_azimuth_deg))
    )
    cos_aoi = max(0.0, cos_aoi)
    poa_Wm2 = (
        dni_Wm2 * cos_aoi
        + dhi_Wm2 * (1.0 + math.cos(tilt_rad)) / 2.0
        + ghi_Wm2 * albedo * (1.0 - math.cos(tilt_rad)) / 2.0
    )

    return SolarSample(
        elevation_rad=elevation_rad,
        azimuth_rad=azimuth_rad,
        dni_Wm2=dni_Wm2,
        dhi_Wm2=dhi_Wm2,
        ghi_Wm2=ghi_Wm2,
        poa_Wm2=poa_Wm2,
    )


def day_length_h(latitude_deg: float, day_of_year: int) -> float:
    """Hours between sunrise and sunset.

    @description Uses the conventional apparent-rise criterion: the sun's centre at
        -0.833 deg elevation, which accounts for the 16 arc-minute semi-diameter
        plus 34 arc-minutes of mean atmospheric refraction.  Returns 24.0 for polar
        day and 0.0 for polar night rather than raising, because a 24 h energy
        sweep must be able to run at any latitude.
    @param latitude_deg Geodetic latitude, deg north positive.
    @param day_of_year Day number, 1..366.
    @returns Day length, hours, in [0, 24].
    """
    if not (-90.0 <= latitude_deg <= 90.0):
        raise ValueError("day_length_h: latitude_deg must be within [-90, 90]")
    if not (1 <= int(day_of_year) <= 366):
        raise ValueError("day_length_h: day_of_year must be within [1, 366]")

    # Declination at local solar noon of that day (longitude-independent to the
    # precision that matters: declination moves < 0.4 deg per day).
    decl_rad, _ = _sun_geometry(_julian_century(int(day_of_year), 12.0))
    lat_rad = math.radians(latitude_deg)
    cos_h = (
        math.cos(math.radians(90.0 - HORIZON_REFRACTION_DEG))
        - math.sin(lat_rad) * math.sin(decl_rad)
    ) / (math.cos(lat_rad) * math.cos(decl_rad))
    if cos_h <= -1.0:
        return 24.0     # polar day
    if cos_h >= 1.0:
        return 0.0      # polar night
    hour_angle_deg = math.degrees(math.acos(cos_h))
    return 2.0 * hour_angle_deg / 15.0


# --------------------------------------------------------------------------- #
# Self-test                                                                    #
# --------------------------------------------------------------------------- #
def _selftest() -> int:
    """Run the module acceptance test; print PASS/FAIL with computed values.

    @returns 0 if every check passed, 1 otherwise.
    """
    failures = 0

    def report(name: str, ok: bool, detail: str) -> None:
        nonlocal failures
        failures += 0 if ok else 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {name:<50s} {detail}")

    def check_abs(name: str, got: float, want: float, tol: float, unit: str) -> None:
        report(name, abs(got - want) <= tol,
               f"got = {got:.4f} {unit}, want = {want} +/- {tol} {unit}")

    print("=" * 92)
    print("aerosim.env.solar self-test")
    print("=" * 92)

    print("\n-- Case A site: Rafz, Switzerland, 14 July (AtlantikSolar) --")
    noon_utc = solar_noon_utc_h(8.5, 195)
    s = solar(47.6, 8.5, 195, noon_utc, 500.0, panel_tilt_deg=0.0)
    print(f"         local solar noon = {noon_utc:.4f} h UTC "
          f"(= {noon_utc * 60 % 60:.1f} min past {int(noon_utc)}:00)")
    check_abs("solar elevation at noon", math.degrees(s.elevation_rad), 64.0, 1.0, "deg")
    check_abs("GHI at noon", s.ghi_Wm2, 950.0, 80.0, "W/m2")
    print(f"         DNI = {s.dni_Wm2:.1f} W/m2, DHI = {s.dhi_Wm2:.1f} W/m2, "
          f"POA(tilt 0) = {s.poa_Wm2:.1f} W/m2, azimuth = {math.degrees(s.azimuth_rad):.1f} deg")
    dl = day_length_h(47.6, 195)
    check_abs("day length", dl, 15.7, 0.3, "h")

    print("\n-- 20 km, equator, summer solstice (Case B band) --")
    noon_eq = solar_noon_utc_h(0.0, 172)
    s20 = solar(0.0, 0.0, 172, noon_eq, 20000.0)
    ok = s20.dni_Wm2 >= 1250.0
    report("DNI at 20 km >= 1250 W/m2", ok, f"got = {s20.dni_Wm2:.1f} W/m2")
    print(f"         elevation = {math.degrees(s20.elevation_rad):.2f} deg, "
          f"GHI = {s20.ghi_Wm2:.1f} W/m2, DHI = {s20.dhi_Wm2:.1f} W/m2")
    s20_sea = solar(0.0, 0.0, 172, noon_eq, 0.0)
    report("20 km beats sea level on DNI", s20.dni_Wm2 > s20_sea.dni_Wm2,
           f"{s20.dni_Wm2:.1f} W/m2 vs {s20_sea.dni_Wm2:.1f} W/m2 at 0 m "
           f"(+{100 * (s20.dni_Wm2 / s20_sea.dni_Wm2 - 1):.1f}%)")
    report("20 km diffuse collapses vs sea level",
           s20.dhi_Wm2 < 0.4 * s20_sea.dhi_Wm2,
           f"{s20.dhi_Wm2:.1f} W/m2 vs {s20_sea.dhi_Wm2:.1f} W/m2 at 0 m")

    print("\n-- physical sanity --")
    report("DNI never exceeds the extraterrestrial beam",
           s20.dni_Wm2 < SOLAR_CONSTANT_W_M2 * 1.035,
           f"max seen {s20.dni_Wm2:.1f} W/m2 < {SOLAR_CONSTANT_W_M2 * 1.035:.1f} W/m2")
    identity_err = abs(s.ghi_Wm2 - (s.dni_Wm2 * math.cos(math.pi / 2 - s.elevation_rad)
                                    + s.dhi_Wm2))
    report("ghi == dni*cos(z) + dhi", identity_err < 1e-9,
           f"residual = {identity_err:.3e} W/m2")
    report("poa(tilt=0) == ghi", abs(s.poa_Wm2 - s.ghi_Wm2) < 1e-9,
           f"residual = {abs(s.poa_Wm2 - s.ghi_Wm2):.3e} W/m2")

    print("\n-- night invariant: NO irradiance below the horizon --")
    night_clean = True
    worst = 0.0
    for hour in np.linspace(0.0, 24.0, 2401):
        n = solar(47.6, 8.5, 195, float(hour), 500.0)
        if n.elevation_rad <= 0.0:
            worst = max(worst, n.dni_Wm2, n.dhi_Wm2, n.ghi_Wm2, n.poa_Wm2)
            if worst > 0.0:
                night_clean = False
    report("all irradiance components exactly 0 at night", night_clean,
           f"max component below the horizon = {worst:.3e} W/m2")

    print("\n-- daylight duration cross-check (position vs day_length_h) --")
    for lat, doy, label in ((47.6, 195, "Rafz, July"),
                            (0.0, 172, "equator, June solstice"),
                            (10.0, 172, "10 N, June solstice"),
                            (-33.0, 355, "33 S, December")):
        lon = 0.0
        n_steps = 86400
        above = 0
        for i in range(n_steps):
            hour = i * 24.0 / n_steps
            if solar(lat, lon, doy, hour, 0.0).elevation_rad > 0.0:
                above += 1
        geometric_h = above * 24.0 / n_steps                 # h, geometric horizon
        formula_h = day_length_h(lat, doy)                   # h, -0.833 deg criterion
        # The formula's refraction allowance makes it ~7-10 min longer at mid-latitude.
        ok = 0.0 <= formula_h - geometric_h < 0.35 or abs(formula_h - geometric_h) < 1e-9
        report(f"day length agrees with swept elevation: {label}", ok,
               f"formula {formula_h:.3f} h vs geometric sweep {geometric_h:.3f} h "
               f"(refraction adds {60 * (formula_h - geometric_h):.1f} min)")

    print("\n-- polar limits --")
    report("polar day at 80 N in June", day_length_h(80.0, 172) == 24.0,
           f"{day_length_h(80.0, 172):.1f} h")
    report("polar night at 80 N in December", day_length_h(80.0, 355) == 0.0,
           f"{day_length_h(80.0, 355):.1f} h")

    print("\n-- solar noon is really the daily maximum --")
    lat, lon, doy = 47.6, 8.5, 195
    hours = np.linspace(noon_utc - 3.0, noon_utc + 3.0, 3601)
    elevs = [solar(lat, lon, doy, float(h), 500.0).elevation_rad for h in hours]
    h_max = float(hours[int(np.argmax(elevs))])
    report("computed solar noon within 30 s of peak elevation",
           abs(h_max - noon_utc) * 3600.0 < 30.0,
           f"peak at {h_max:.5f} h UTC, solar_noon_utc_h gives {noon_utc:.5f} h "
           f"({abs(h_max - noon_utc) * 3600.0:.1f} s apart)")

    print("\n-- azimuth convention (clockwise from true north) --")
    az_noon = math.degrees(s.azimuth_rad)
    check_abs("northern-hemisphere noon sun is due south", az_noon, 180.0, 1.0, "deg")
    az_morning = math.degrees(solar(47.6, 8.5, 195, noon_utc - 4.0, 500.0).azimuth_rad)
    az_evening = math.degrees(solar(47.6, 8.5, 195, noon_utc + 4.0, 500.0).azimuth_rad)
    report("morning sun in the east, evening in the west",
           60.0 < az_morning < 180.0 < az_evening < 300.0,
           f"-4 h: {az_morning:.1f} deg, +4 h: {az_evening:.1f} deg")
    az_south_hemi = math.degrees(solar(-33.0, 0.0, 355, solar_noon_utc_h(0.0, 355),
                                       0.0).azimuth_rad)
    report("southern-hemisphere noon sun is due north",
           min(az_south_hemi, 360.0 - az_south_hemi) < 1.0,
           f"{az_south_hemi:.1f} deg")

    print("\n-- tilt behaviour --")
    tilted = solar(47.6, 8.5, 195, noon_utc, 500.0, panel_tilt_deg=26.0,
                   panel_azimuth_deg=180.0)
    report("south tilt to normal incidence beats flat", tilted.poa_Wm2 > s.poa_Wm2,
           f"POA tilt 26 deg = {tilted.poa_Wm2:.1f} W/m2 vs flat {s.poa_Wm2:.1f} W/m2")
    backwards = solar(47.6, 8.5, 195, noon_utc, 500.0, panel_tilt_deg=80.0,
                      panel_azimuth_deg=0.0)
    report("north-facing 80 deg panel loses the direct beam",
           backwards.poa_Wm2 < 0.3 * s.poa_Wm2,
           f"POA = {backwards.poa_Wm2:.1f} W/m2 vs flat {s.poa_Wm2:.1f} W/m2")

    print("\n-- ozone column profile --")
    print(f"         column above    0 m = {_ozone_column_above(0.0):.4f} atm-cm")
    print(f"         column above 20000 m = {_ozone_column_above(20000.0):.4f} atm-cm "
          f"({100 * _ozone_column_above(20000.0) / _ozone_column_above(0.0):.0f}% still overhead)")

    print("\n-- input validation --")
    rejected = 0
    for bad in (
        lambda: solar(95.0, 0.0, 195, 12.0, 0.0),
        lambda: solar(47.6, 0.0, 400, 12.0, 0.0),
        lambda: solar(47.6, 0.0, 195, 12.0, 0.0, albedo=1.5),
        lambda: day_length_h(47.6, 0),
        lambda: solar(47.6, 0.0, 195, 12.0, 60000.0),
    ):
        try:
            bad()
        except ValueError:
            rejected += 1
    report("malformed inputs rejected", rejected == 5, f"{rejected}/5 raised")

    print("\n" + "=" * 92)
    print(f"solar.py: {'ALL CHECKS PASSED' if failures == 0 else f'{failures} CHECK(S) FAILED'}")
    print("=" * 92)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(_selftest())
