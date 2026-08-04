# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Barrel for the env package: atmosphere,
#   |                                           | wind and solar. Also runs the combined
#   |                                           | acceptance test for the module.
# -----------------------------------------------------------------------------
"""``aerosim.env`` - the environment answer-machine.

At any (x, y, z, t) this package answers three questions and nothing else:

* **atmosphere** - density, pressure, temperature, viscosity, speed of sound,
  with the mandatory geometric -> geopotential conversion.
* **wind** - an ENU wind VECTOR together with its ANALYTIC vertical gradient,
  C1-continuous by construction so that shear archetypes cannot harvest a kink.
* **solar** - sun position and clear-sky irradiance, altitude-resolved, exactly
  zero below the horizon.

Import from this barrel, never from the submodules::

    from aerosim.env import atmosphere, sutherland_mu, reynolds
    from aerosim.env import make_shear_layer_field, WindSample
    from aerosim.env import solar, day_length_h

===============================================================================
INTERFACE OBJECTIONS (implemented as specified; recorded, not acted on)
===============================================================================

1. ``WindField.sample(x, y, z, t)`` cannot parameterise Dryden turbulence
   correctly.  The Dryden spectrum is defined against the VEHICLE's airspeed V:
   the correlation time is tau = L / V, and the same air with the same L looks
   like a 13 s process to a 15 m/s solar plane and a 1.3 s process to a 150 m/s
   jet.  A field that only sees position and time cannot know V.
   IMPLEMENTED AS SPECIFIED.  The mitigation is Taylor's frozen-turbulence
   hypothesis: tau = L / V_ref with V_ref taken from the base wind magnitude at
   the origin, combined in quadrature with sigma so the still-air limit falls
   back to the eddy-turnover time L / sigma instead of dividing by zero.  An
   additive keyword-only ``reference_speed_ms`` lets a caller who does know the
   airspeed override it; the 5-positional-argument call specified in the plan
   behaves exactly as written.  If a later phase wants MIL-spec-faithful gust
   response, the right fix is to pass V into ``sample``, which is a signature
   change and therefore not mine to make.

2. ``make_dryden_turbulence`` contributes 0.0 to the reported ``dudz_1s``.
   This is not laziness, it is the honest answer.  Dryden is a temporal spectrum
   along a flight path, not a resolved 3-D field, so it has no defensible
   d/dz - fabricating one would inject exactly the kind of unearned shear power
   that archetypes 3 and 4 are supposed to be tested against.  Callers doing
   gust soaring must take their energy from the TIME variation of the wind in
   the fast (dt = 0.05 s) loop, which is real, continuous and present.

3. ``make_shear_layer_field`` takes no vertical-wind nodes, so ``w_ms`` and
   ``dwdz_1s`` are always exactly 0.0 for that field.  That is self-consistent
   (a horizontally homogeneous layered profile has no mean updraft, and mass
   continuity would be violated if it did), but it means thermal/ridge lift is
   not expressible through this constructor.  A dynamic soarer feeding on
   updraughts needs either a new constructor or a composed field.  Not a defect
   in the spec, just a capability the spec does not contain.

4. ``atmosphere`` is documented "valid 0..47000 m" but is implemented over
   [-5000, 47000] m and RAISES outside that band rather than clamping.  The
   negative extension costs nothing (the -6.5 K/km layer is continuous through
   z = 0) and stops a trajectory that dips to -20 m during a landing flare from
   crashing the sweep.  The refusal to extrapolate above 47 km is deliberate:
   the ISA table ends there, and a silently extrapolated density is exactly the
   kind of confident fiction this project exists to keep out of the loop.

5. ``AtmoSample`` is annotated ``float`` per field while ``atmosphere`` is
   required to be vectorized.  Array input returns arrays in those fields.  The
   annotation is therefore a lie for the array path.  Implemented as specified;
   downstream type checkers will need ``float | ndarray`` if they get strict.
"""

if __name__ == "__main__" and __package__ in (None, ""):
    # Direct execution (`python aerosim/env/__init__.py`).  Relative imports cannot
    # resolve in script context, so re-enter through the package and exit from
    # there; the body below then runs exactly once, as a proper package module.
    import os as _os
    import sys as _sys

    _sys.path.insert(
        0, _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
    )
    from aerosim.env import _selftest as _st

    raise SystemExit(_st())

from .atmosphere import (
    ALTITUDE_MAX_M,
    ALTITUDE_MIN_M,
    GAMMA_AIR,
    G0_M_PER_S2,
    R_AIR_J_PER_KG_K,
    R_EARTH_GEOPOTENTIAL_M,
    AtmoSample,
    atmosphere,
    geopotential_altitude_m,
    reynolds,
    sutherland_mu,
)
from .solar import (
    REFERENCE_YEAR,
    SOLAR_CONSTANT_W_M2,
    SolarSample,
    day_length_h,
    solar,
    solar_noon_utc_h,
)
from .wind import (
    DrydenTurbulenceField,
    ShearLayerWindField,
    UniformWindField,
    WindField,
    WindSample,
    make_dryden_turbulence,
    make_shear_layer_field,
    make_uniform_field,
)

__all__ = [
    # atmosphere
    "AtmoSample",
    "atmosphere",
    "sutherland_mu",
    "reynolds",
    "geopotential_altitude_m",
    "R_AIR_J_PER_KG_K",
    "G0_M_PER_S2",
    "GAMMA_AIR",
    "R_EARTH_GEOPOTENTIAL_M",
    "ALTITUDE_MIN_M",
    "ALTITUDE_MAX_M",
    # wind
    "WindSample",
    "WindField",
    "make_uniform_field",
    "make_shear_layer_field",
    "make_dryden_turbulence",
    "UniformWindField",
    "ShearLayerWindField",
    "DrydenTurbulenceField",
    # solar
    "SolarSample",
    "solar",
    "day_length_h",
    "solar_noon_utc_h",
    "SOLAR_CONSTANT_W_M2",
    "REFERENCE_YEAR",
]


def _selftest() -> int:
    """Run every submodule self-test plus the cross-module integration checks.

    @description The integration checks are the ones no single submodule can make:
        that the daily insolation this environment hands to validation cases A and
        B is physically plausible, and that a Reynolds number assembled from the
        atmosphere and a wind field lands where the project's own cross-checks say
        it must.
    @returns 0 if everything passed, 1 otherwise.
    """
    import math
    from importlib import import_module

    import numpy as np

    # NOTE: `from . import atmosphere` would bind the FUNCTION re-exported by this
    # barrel, not the submodule - the barrel deliberately shadows all three module
    # names.  import_module goes to sys.modules and gets the real modules.
    _atmo_mod = import_module("aerosim.env.atmosphere")
    _wind_mod = import_module("aerosim.env.wind")
    _solar_mod = import_module("aerosim.env.solar")

    rc = 0
    rc |= _atmo_mod._selftest()
    print()
    rc |= _wind_mod._selftest()
    print()
    rc |= _solar_mod._selftest()

    failures = 0

    def report(name: str, ok: bool, detail: str) -> None:
        nonlocal failures
        failures += 0 if ok else 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {name:<50s} {detail}")

    print()
    print("=" * 92)
    print("aerosim.env integration checks (cross-module)")
    print("=" * 92)

    print("\n-- daily insolation available to the validation cases --")
    # Trapezoidal integration of GHI over a full UTC day, 1-minute resolution.
    def daily_kwh_per_m2(lat_deg: float, lon_deg: float, doy: int, alt_m: float) -> float:
        hours = np.linspace(0.0, 24.0, 1441)                     # h
        ghi = np.array([solar(lat_deg, lon_deg, doy, float(h), alt_m).ghi_Wm2
                        for h in hours])                          # W/m2
        return float(np.trapezoid(ghi, hours) / 1000.0)           # kWh/m2/day

    def extraterrestrial_daily_kwh(lat_deg: float, doy: int) -> float:
        """@description Analytic daily extraterrestrial insolation on a horizontal
            surface, the hard physical ceiling any GHI integral must sit under:
            H0 = (24/pi) * E * (cos(phi)cos(delta)sin(ws) + ws*sin(phi)sin(delta)).
        @param lat_deg Latitude, deg. @param doy Day number.
        @returns kWh/m2/day.
        """
        decl_rad, _ = _solar_mod._sun_geometry(_solar_mod._julian_century(doy, 12.0))
        e_wm2 = SOLAR_CONSTANT_W_M2 * _solar_mod._sun_distance_factor(
            _solar_mod._julian_century(doy, 12.0)
        )
        phi = math.radians(lat_deg)
        cos_ws = -math.tan(phi) * math.tan(decl_rad)
        cos_ws = max(-1.0, min(1.0, cos_ws))
        ws = math.acos(cos_ws)                                   # sunset hour angle, rad
        return (24.0 / math.pi) * e_wm2 * (
            math.cos(phi) * math.cos(decl_rad) * math.sin(ws)
            + ws * math.sin(phi) * math.sin(decl_rad)
        ) / 1000.0

    # The discriminating quantity is the clearness index Kt = H / H0, not the raw
    # kWh: it isolates the ATMOSPHERE from the geometry.  Clear-sky Kt at sea level
    # runs 0.70-0.80; at 20 km a vehicle is above ~94.5% of the air mass, so Kt must
    # approach - and must never exceed - unity.
    case_a_kwh = daily_kwh_per_m2(47.6, 8.5, 195, 500.0)
    case_a_h0 = extraterrestrial_daily_kwh(47.6, 195)
    kt_a = case_a_kwh / case_a_h0
    report("Case A (47.6 N, 14 Jul, 500 m) clearness index",
           0.70 <= kt_a <= 0.82,
           f"H = {case_a_kwh:.2f} of H0 = {case_a_h0:.2f} kWh/m2/day -> Kt = {kt_a:.3f} "
           f"(clear-sky sea level is 0.70-0.80)")

    case_b_kwh = daily_kwh_per_m2(10.0, 0.0, 172, 20000.0)
    case_b_h0 = extraterrestrial_daily_kwh(10.0, 172)
    kt_b = case_b_kwh / case_b_h0
    report("Case B (10 N, 21 Jun, 20 km) clearness index",
           0.93 <= kt_b <= 1.00,
           f"H = {case_b_kwh:.2f} of H0 = {case_b_h0:.2f} kWh/m2/day -> Kt = {kt_b:.3f} "
           f"(above 94.5% of the air mass)")
    report("no daily total exceeds the extraterrestrial ceiling",
           kt_a < 1.0 and kt_b < 1.0,
           f"Kt(A) = {kt_a:.3f}, Kt(B) = {kt_b:.3f}, both < 1.000")
    report("altitude buys more energy than it costs in day length",
           kt_b > kt_a and case_b_kwh > case_a_kwh,
           f"{case_b_kwh:.2f} kWh/m2/day at 20 km vs {case_a_kwh:.2f} at 500 m")

    print("\n-- Reynolds numbers the aeropolar module will be handed --")
    # AtlantikSolar: 5.65 m span, 1.72 m2 -> mean chord 0.3044 m, cruise ~9.5 m/s
    chord_a_m = 1.72 / 5.65                                       # m
    atm_a = atmosphere(500.0)
    re_a = reynolds(atm_a.rho_kgm3, 9.5, chord_a_m, atm_a.mu_Pas)
    report("AtlantikSolar cruise Re is above the RE_FLOOR of 30k",
           re_a > 30000.0,
           f"Re = {re_a:,.0f} at V = 9.5 m/s, c = {chord_a_m:.4f} m, 500 m")
    # Zephyr S: 25 m span, ~20.8 m2 -> mean chord 0.832 m, V ~28.2 m/s at 20 km
    chord_b_m = 20.8 / 25.0                                       # m
    atm_b = atmosphere(20000.0)
    re_b = reynolds(atm_b.rho_kgm3, 28.2, chord_b_m, atm_b.mu_Pas)
    report("Zephyr S cruise Re >= 100k (plan expects ~146k)",
           re_b >= 100000.0,
           f"Re = {re_b:,.0f} at V = 28.2 m/s, c = {chord_b_m:.3f} m, 20 km")
    # The project's unflyability cross-check.
    re_bad = reynolds(atm_b.rho_kgm3, 15.0, 0.10, atm_b.mu_Pas)
    report("10 cm chord at 15 m/s at 20 km is UNFLYABLE (Re << 30k)",
           re_bad < 10000.0, f"Re = {re_bad:,.0f}")

    print("\n-- no free energy from a uniform field, measured not asserted --")
    # A direct measurement of the quantity integrate.assert_no_free_energy will
    # guard: the wind-gradient power term.  In a uniform field every gradient is
    # exactly zero, so the term is exactly zero for ANY vehicle state.
    uf = make_uniform_field(20.0, -7.0, 0.0)
    rng = np.random.default_rng(2026)
    worst_power_term = 0.0
    for _ in range(100):
        z = float(rng.uniform(0.0, 20000.0))
        w = uf.sample(float(rng.uniform(-1e4, 1e4)), float(rng.uniform(-1e4, 1e4)),
                      z, float(rng.uniform(0.0, 86400.0)))
        # Shear power per unit mass scales as (V . dW/dz) * w_z; with an arbitrary
        # 100 m/s state vector this is still identically zero.
        term = abs(100.0 * w.dudz_1s + 100.0 * w.dvdz_1s + 100.0 * w.dwdz_1s)
        worst_power_term = max(worst_power_term, term)
    report("shear power term is identically 0 in a uniform field",
           worst_power_term == 0.0,
           f"worst over 100 random states = {worst_power_term!r} (identity, not tolerance)")

    # And that the SAME quantity is non-zero in a real shear layer, so the guard
    # is discriminating rather than vacuously true.
    sf = make_shear_layer_field([0.0, 200.0, 400.0, 600.0], [5.0, 5.0, 15.0, 15.0],
                                [0.0, 0.0, 0.0, 0.0])
    shear_term = abs(100.0 * sf.sample(0.0, 0.0, 300.0, 0.0).dudz_1s)
    report("the same term is NON-zero in a real shear layer", shear_term > 1.0,
           f"{shear_term:.3f} (guard is discriminating, not vacuous)")

    print("\n" + "=" * 92)
    total_fail = failures + (1 if rc else 0)
    print(f"aerosim.env: {'ALL MODULES + INTEGRATION CHECKS PASSED' if total_fail == 0 else 'FAILURES PRESENT'}")
    print("=" * 92)
    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(_selftest())
