# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | U.S. Standard Atmosphere 1976 with the
#   |                                           | MANDATORY geometric -> geopotential
#   |                                           | conversion, Sutherland viscosity and the
#   |                                           | Reynolds-number helper. Leaf module: no
#   |                                           | project-internal imports.
# -----------------------------------------------------------------------------
"""ISA-1976 atmosphere answer-machine for the persistent-flight simulator.

WHY THE GEOPOTENTIAL CONVERSION IS NOT OPTIONAL
-----------------------------------------------
The ISA hydrostatic integration is written in GEOPOTENTIAL height ``h`` (metres),
not geometric altitude ``z``.  Feeding ``z`` straight into the layer formulas
(the "naive" implementation) understates the density at 20 km by 1.0 %:

    naive   : rho(20 km) = 0.08803 kg/m3 , p = 5474.9 Pa
    correct : rho(20 km) = 0.08889 kg/m3 , p = 5528.0 Pa   <- agreed project value

The conversion is  h = r0 * z / (r0 + z)  with  r0 = 6356766.0 m  (the ISA
effective Earth radius, chosen so that g0 = 9.80665 m/s2 is exact at h = 0).
At 20 km geometric this maps to 19937.3 m geopotential, i.e. 62.7 m of "missing"
column - which is exactly the 1 % of density that a geopotential-naive model
throws away.  Every downstream Reynolds number, lift coefficient and required
power inherits that error, so the conversion happens here, once, for everybody.

UNITS
-----
Every public argument, return value and module constant carries SI units in its
name or in a trailing comment.  Altitudes taken by the public API are GEOMETRIC
metres above mean sea level; geopotential metres never leave this module except
through :func:`geopotential_altitude_m`, which is named for what it returns.

INVARIANTS
----------
* ``atmosphere`` is a pure function of altitude only.  It has no time argument
  and no state, so it can never inject energy into a trajectory.
* Density, pressure and temperature are strictly positive and continuous in z
  across every layer boundary (C0; the lapse rate itself is piecewise constant,
  which is the definition of the standard atmosphere, not a modelling slip).
"""

from __future__ import annotations

import math
from typing import NamedTuple, Union

import numpy as np

__all__ = [
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
]

ArrayLike = Union[float, np.ndarray]

# --------------------------------------------------------------------------- #
# Physical constants (U.S. Standard Atmosphere 1976, NASA-TM-X-74335)          #
# --------------------------------------------------------------------------- #
R_STAR_J_PER_KMOL_K = 8314.32          # universal gas constant, J/(kmol*K)
M_AIR_KG_PER_KMOL = 28.9644            # mean molar mass of dry air, kg/kmol
R_AIR_J_PER_KG_K = R_STAR_J_PER_KMOL_K / M_AIR_KG_PER_KMOL   # 287.0528 J/(kg*K)
G0_M_PER_S2 = 9.80665                  # standard gravity at h = 0, m/s2
GAMMA_AIR = 1.4                        # ratio of specific heats, dimensionless
R_EARTH_GEOPOTENTIAL_M = 6356766.0     # ISA effective Earth radius, m

# Sutherland's law for air (White, "Viscous Fluid Flow", 3rd ed., Table 1-2)
SUTHERLAND_C1_PA_S_PER_SQRT_K = 1.458e-6   # Pa*s/(K^0.5), from the project spec
SUTHERLAND_S_K = 110.4                     # Sutherland temperature, K

# Validity band, GEOMETRIC metres above MSL.  The lower bound admits sub-sea-level
# operation (Dead Sea, -430 m) with margin; the upper bound is where the ISA table
# itself stops.  Anything outside is a caller bug we refuse to paper over.
ALTITUDE_MIN_M = -5000.0
ALTITUDE_MAX_M = 47000.0

# --------------------------------------------------------------------------- #
# ISA layer table, in GEOPOTENTIAL metres.                                     #
# Base temperatures / pressures below the first layer are the defined sea-level #
# values; every other base is CHAINED from them at import time so that no       #
# hand-typed table value can drift out of agreement with the layer integration. #
# --------------------------------------------------------------------------- #
_LAYER_BASE_H_M = np.array([0.0, 11000.0, 20000.0, 32000.0, 47000.0])  # geopotential m
_LAYER_LAPSE_K_PER_M = np.array([-0.0065, 0.0, 0.0010, 0.0028])        # dT/dh, K/m
_T0_K = 288.15          # sea-level standard temperature, K
_P0_PA = 101325.0       # sea-level standard pressure, Pa


def _build_layer_bases() -> tuple[np.ndarray, np.ndarray]:
    """Chain the ISA layer base temperatures (K) and pressures (Pa).

    @description Integrates the hydrostatic equation layer by layer from the two
        defined sea-level constants so the 11/20/32 km bases are DERIVED rather
        than transcribed.  Called once at import.
    @returns (T_base_K, p_base_Pa) arrays, one entry per layer boundary.
    """
    n_layers = len(_LAYER_LAPSE_K_PER_M)
    t_base_k = np.empty(n_layers + 1)   # K
    p_base_pa = np.empty(n_layers + 1)  # Pa
    t_base_k[0] = _T0_K
    p_base_pa[0] = _P0_PA
    for i in range(n_layers):
        dh_m = _LAYER_BASE_H_M[i + 1] - _LAYER_BASE_H_M[i]   # geopotential m
        lapse_k_per_m = _LAYER_LAPSE_K_PER_M[i]
        t_top_k = t_base_k[i] + lapse_k_per_m * dh_m
        if lapse_k_per_m == 0.0:
            # Isothermal layer: p = p_b * exp(-g0*dh/(R*T))
            p_base_pa[i + 1] = p_base_pa[i] * np.exp(
                -G0_M_PER_S2 * dh_m / (R_AIR_J_PER_KG_K * t_base_k[i])
            )
        else:
            # Gradient layer: p = p_b * (T/T_b)^(-g0/(R*L))
            p_base_pa[i + 1] = p_base_pa[i] * (t_top_k / t_base_k[i]) ** (
                -G0_M_PER_S2 / (R_AIR_J_PER_KG_K * lapse_k_per_m)
            )
        t_base_k[i + 1] = t_top_k
    return t_base_k, p_base_pa


_T_BASE_K, _P_BASE_PA = _build_layer_bases()


class AtmoSample(NamedTuple):
    """Thermodynamic state of the air at one altitude.

    @description All fields are scalars for scalar input and ndarrays (same shape
        as the input) for array input.
    """

    T_K: float        # static temperature, K
    p_Pa: float       # static pressure, Pa
    rho_kgm3: float   # density, kg/m3
    mu_Pas: float     # dynamic viscosity, Pa*s
    a_ms: float       # speed of sound, m/s


def geopotential_altitude_m(altitude_m: ArrayLike) -> ArrayLike:
    """Convert GEOMETRIC altitude to GEOPOTENTIAL altitude.

    @description h = r0 * z / (r0 + z).  This is the conversion whose omission
        costs 1 % of density at 20 km; see the module docstring.
    @param altitude_m Geometric altitude above MSL, m (scalar or ndarray).
    @returns Geopotential altitude, m, same shape as the input.
    """
    z_m = np.asarray(altitude_m, dtype=float)
    h_m = R_EARTH_GEOPOTENTIAL_M * z_m / (R_EARTH_GEOPOTENTIAL_M + z_m)
    return float(h_m) if h_m.ndim == 0 else h_m


def sutherland_mu(T_K: ArrayLike) -> ArrayLike:
    """Dynamic viscosity of air from Sutherland's law.

    @description mu = 1.458e-6 * T^1.5 / (T + 110.4).  Cross-check pinned by the
        project spec: mu(216.65 K) = 1.4216e-5 Pa*s.
    @param T_K Static temperature, K (scalar or ndarray), must be > 0.
    @returns Dynamic viscosity, Pa*s, same shape as the input.
    """
    t_k = np.asarray(T_K, dtype=float)
    if np.any(t_k <= 0.0):
        raise ValueError("sutherland_mu: temperature must be > 0 K")
    mu_pas = SUTHERLAND_C1_PA_S_PER_SQRT_K * t_k**1.5 / (t_k + SUTHERLAND_S_K)
    return float(mu_pas) if mu_pas.ndim == 0 else mu_pas


def reynolds(rho_kgm3: float, V_ms: float, chord_m: float, mu_Pas: float) -> float:
    """Chord Reynolds number.

    @description Re = rho * V * c / mu.  Dimensionless.  Cross-check pinned by the
        project spec: reynolds(0.0889, 15.0, 0.10, 1.4216e-5) = 9381.
    @param rho_kgm3 Air density, kg/m3.
    @param V_ms True airspeed (magnitude of the air-relative velocity), m/s.
    @param chord_m Reference chord length, m.
    @param mu_Pas Dynamic viscosity, Pa*s (> 0).
    @returns Reynolds number, dimensionless.
    """
    mu = np.asarray(mu_Pas, dtype=float)
    if np.any(mu <= 0.0):
        raise ValueError("reynolds: viscosity must be > 0 Pa*s")
    re = np.asarray(rho_kgm3, dtype=float) * np.asarray(V_ms, dtype=float) * np.asarray(
        chord_m, dtype=float
    ) / mu
    return float(re) if re.ndim == 0 else re


# Pure-Python copies of the layer table, used by the scalar fast path below.
# numpy's scalar-boxing overhead makes the vectorized path cost ~120 us per scalar
# call; a 30,000-design sweep at 1,440 slow-loop steps each would spend over an
# hour inside this one function. The fast path performs the IDENTICAL arithmetic
# in the identical order and is verified bit-for-bit against the array path in the
# self-test, so it is a speed optimisation with no numerical freedom.
_PY_LAYER_BASE_H_M = [float(v) for v in _LAYER_BASE_H_M]
_PY_LAYER_LAPSE_K_PER_M = [float(v) for v in _LAYER_LAPSE_K_PER_M]
_PY_T_BASE_K = [float(v) for v in _T_BASE_K]
_PY_P_BASE_PA = [float(v) for v in _P_BASE_PA]
_N_LAYERS = len(_PY_LAYER_LAPSE_K_PER_M)


def _atmosphere_scalar(z_m: float) -> AtmoSample:
    """@description Scalar fast path for :func:`atmosphere`; see the note above.
    @param z_m GEOMETRIC altitude above MSL, m. Assumed already range-checked.
    @returns AtmoSample of Python floats.
    """
    h_m = R_EARTH_GEOPOTENTIAL_M * z_m / (R_EARTH_GEOPOTENTIAL_M + z_m)  # geopotential m

    layer = 0
    for i in range(1, _N_LAYERS):
        if h_m >= _PY_LAYER_BASE_H_M[i]:
            layer = i
        else:
            break

    t_base_k = _PY_T_BASE_K[layer]
    p_base_pa = _PY_P_BASE_PA[layer]
    lapse_k_per_m = _PY_LAYER_LAPSE_K_PER_M[layer]
    dh_m = h_m - _PY_LAYER_BASE_H_M[layer]

    t_k = t_base_k + lapse_k_per_m * dh_m                                # K
    if lapse_k_per_m == 0.0:
        p_pa = p_base_pa * math.exp(
            -G0_M_PER_S2 * dh_m / (R_AIR_J_PER_KG_K * t_base_k)
        )
    else:
        p_pa = p_base_pa * (t_k / t_base_k) ** (
            -G0_M_PER_S2 / (R_AIR_J_PER_KG_K * lapse_k_per_m)
        )

    return AtmoSample(
        T_K=t_k,
        p_Pa=p_pa,
        rho_kgm3=p_pa / (R_AIR_J_PER_KG_K * t_k),
        mu_Pas=SUTHERLAND_C1_PA_S_PER_SQRT_K * t_k**1.5 / (t_k + SUTHERLAND_S_K),
        a_ms=math.sqrt(GAMMA_AIR * R_AIR_J_PER_KG_K * t_k),
    )


def atmosphere(altitude_m: ArrayLike) -> AtmoSample:
    """Full thermodynamic state of the standard atmosphere at a geometric altitude.

    @description Converts geometric -> geopotential altitude (MANDATORY, see module
        docstring), locates the ISA layer, integrates the hydrostatic equation
        within it, then closes with the ideal gas law, Sutherland's law and the
        isentropic speed of sound.  Fully vectorized.
    @param altitude_m GEOMETRIC altitude above MSL, m (scalar or ndarray).
        Valid over [-5000, 47000] m; outside that band a ValueError is raised
        rather than silently extrapolating a table that has ended.
    @returns AtmoSample(T_K, p_Pa, rho_kgm3, mu_Pas, a_ms).
    """
    if type(altitude_m) is float or type(altitude_m) is int:
        z_scalar = float(altitude_m)
        if not math.isfinite(z_scalar):
            raise ValueError("atmosphere: altitude must be finite")
        if z_scalar < ALTITUDE_MIN_M or z_scalar > ALTITUDE_MAX_M:
            raise ValueError(
                f"atmosphere: geometric altitude outside the ISA validity band "
                f"[{ALTITUDE_MIN_M}, {ALTITUDE_MAX_M}] m; got {z_scalar} m"
            )
        return _atmosphere_scalar(z_scalar)

    z_m = np.asarray(altitude_m, dtype=float)
    scalar_input = z_m.ndim == 0
    z_m = np.atleast_1d(z_m)

    if np.any(~np.isfinite(z_m)):
        raise ValueError("atmosphere: altitude must be finite")
    if np.any(z_m < ALTITUDE_MIN_M) or np.any(z_m > ALTITUDE_MAX_M):
        raise ValueError(
            f"atmosphere: geometric altitude outside the ISA validity band "
            f"[{ALTITUDE_MIN_M}, {ALTITUDE_MAX_M}] m; got "
            f"[{float(np.min(z_m))}, {float(np.max(z_m))}] m"
        )

    h_m = np.asarray(geopotential_altitude_m(z_m), dtype=float)   # geopotential m
    h_m = np.atleast_1d(h_m)

    # Layer index: 0 for h below 11 km (the -6.5 K/km layer also covers h < 0),
    # clipped to the last defined layer at the top of the table.
    idx = np.searchsorted(_LAYER_BASE_H_M, h_m, side="right") - 1
    idx = np.clip(idx, 0, len(_LAYER_LAPSE_K_PER_M) - 1)

    h_base_m = _LAYER_BASE_H_M[idx]                 # geopotential m
    t_base_k = _T_BASE_K[idx]                       # K
    p_base_pa = _P_BASE_PA[idx]                     # Pa
    lapse_k_per_m = _LAYER_LAPSE_K_PER_M[idx]       # K/m
    dh_m = h_m - h_base_m                           # geopotential m above layer base

    t_k = t_base_k + lapse_k_per_m * dh_m           # K

    is_isothermal = lapse_k_per_m == 0.0
    # Gradient branch: p = p_b * (T/T_b)^(-g0/(R*L)).  np.where evaluates BOTH
    # branches, so the lapse rate is temporarily replaced by a harmless non-zero
    # value in the isothermal slots to keep the division finite.
    safe_lapse = np.where(is_isothermal, 1.0, lapse_k_per_m)
    p_gradient_pa = p_base_pa * (t_k / t_base_k) ** (
        -G0_M_PER_S2 / (R_AIR_J_PER_KG_K * safe_lapse)
    )
    p_isothermal_pa = p_base_pa * np.exp(
        -G0_M_PER_S2 * dh_m / (R_AIR_J_PER_KG_K * t_base_k)
    )
    p_pa = np.where(is_isothermal, p_isothermal_pa, p_gradient_pa)

    rho_kgm3 = p_pa / (R_AIR_J_PER_KG_K * t_k)                      # kg/m3
    mu_pas = np.asarray(sutherland_mu(t_k), dtype=float)            # Pa*s
    a_ms = np.sqrt(GAMMA_AIR * R_AIR_J_PER_KG_K * t_k)              # m/s

    if scalar_input:
        return AtmoSample(
            T_K=float(t_k[0]),
            p_Pa=float(p_pa[0]),
            rho_kgm3=float(rho_kgm3[0]),
            mu_Pas=float(mu_pas[0]),
            a_ms=float(a_ms[0]),
        )
    return AtmoSample(T_K=t_k, p_Pa=p_pa, rho_kgm3=rho_kgm3, mu_Pas=mu_pas, a_ms=a_ms)


# --------------------------------------------------------------------------- #
# Self-test                                                                    #
# --------------------------------------------------------------------------- #
def _selftest() -> int:
    """Run the module acceptance test; print PASS/FAIL with computed values.

    @returns 0 if every check passed, 1 otherwise.
    """
    failures = 0

    def check(name: str, got: float, want: float, tol_frac: float, unit: str) -> None:
        nonlocal failures
        err = abs(got - want) / abs(want) if want != 0 else abs(got - want)
        ok = err <= tol_frac
        failures += 0 if ok else 1
        print(
            f"  [{'PASS' if ok else 'FAIL'}] {name:<48s} got={got:>14.6g} {unit:<6s}"
            f" want={want:<12.6g} err={err * 100:7.4f}% tol={tol_frac * 100:g}%"
        )

    def check_abs(name: str, got: float, want: float, tol: float, unit: str) -> None:
        nonlocal failures
        err = abs(got - want)
        ok = err <= tol
        failures += 0 if ok else 1
        print(
            f"  [{'PASS' if ok else 'FAIL'}] {name:<48s} got={got:>14.6g} {unit:<6s}"
            f" want={want:<12.6g} err={err:7.4g} tol={tol:g}"
        )

    print("=" * 92)
    print("aerosim.env.atmosphere self-test")
    print("=" * 92)

    print("\n-- ISA density ladder (geometric altitude, 0.5% tolerance) --")
    for z_m, want_rho in ((0.0, 1.2250), (5000.0, 0.7364), (10000.0, 0.4135),
                          (15000.0, 0.1948), (20000.0, 0.0889)):
        s = atmosphere(z_m)
        check(f"rho at {z_m:.0f} m", s.rho_kgm3, want_rho, 0.005, "kg/m3")

    print("\n-- 20 km full state --")
    s20 = atmosphere(20000.0)
    check_abs("T at 20000 m", s20.T_K, 216.65, 0.2, "K")
    check("p at 20000 m", s20.p_Pa, 5529.0, 0.005, "Pa")
    print(f"         (a = {s20.a_ms:.3f} m/s, mu = {s20.mu_Pas:.6e} Pa*s)")

    print("\n-- geopotential conversion is actually happening --")
    # Reproduce the naive (geopotential-omitted) model and prove it FAILS the test.
    h_naive_m = 20000.0
    t_naive_k = 216.65
    p_naive_pa = _P_BASE_PA[1] * np.exp(
        -G0_M_PER_S2 * (h_naive_m - 11000.0) / (R_AIR_J_PER_KG_K * t_naive_k)
    )
    rho_naive = p_naive_pa / (R_AIR_J_PER_KG_K * t_naive_k)
    naive_err = abs(rho_naive - 0.0889) / 0.0889
    ok = naive_err > 0.005
    failures += 0 if ok else 1
    print(
        f"  [{'PASS' if ok else 'FAIL'}] naive rho(20km) = {rho_naive:.5f} kg/m3 "
        f"(expected ~0.08803), off by {naive_err * 100:.2f}% -> MUST exceed the 0.5% "
        f"tolerance: {'it does' if ok else 'IT DOES NOT'}"
    )
    print(f"         geopotential h(20000 m geometric) = "
          f"{geopotential_altitude_m(20000.0):.1f} m")

    print("\n-- Sutherland + Reynolds --")
    mu = sutherland_mu(216.65)
    check("sutherland_mu(216.65 K)", mu, 1.4216e-5, 0.001, "Pa*s")
    re = reynolds(0.0889, 15.0, 0.10, 1.4216e-5)
    check("Re(20km, 15 m/s, 0.10 m chord)", re, 9381.0, 0.01, "-")
    # Solve reynolds(...) == 200000 for the product V*c at 20 km.
    vc_m2s = 200000.0 * s20.mu_Pas / s20.rho_kgm3   # m2/s
    check("V*c for Re=200k at 20 km", vc_m2s, 31.98, 0.01, "m2/s")

    print("\n-- vectorization + continuity --")
    z_arr = np.array([0.0, 5000.0, 10000.0, 15000.0, 20000.0])
    s_arr = atmosphere(z_arr)
    scalar_match = max(
        abs(float(s_arr.rho_kgm3[i]) - atmosphere(float(z_arr[i])).rho_kgm3)
        for i in range(len(z_arr))
    )
    ok = isinstance(s_arr.rho_kgm3, np.ndarray) and scalar_match == 0.0
    failures += 0 if ok else 1
    print(f"  [{'PASS' if ok else 'FAIL'}] array call matches scalar call bit-for-bit "
          f"(max |diff| = {scalar_match:g})")
    # C0 continuity across every layer boundary (geometric altitudes bracketing it).
    # The probe half-width is 1 mm: over that distance the PHYSICAL density change is
    # only ~1.5e-7 relative (scale height ~6.5 km), so a genuine discontinuity in the
    # chained layer bases would stand out by orders of magnitude.
    probe_dz_m = 1.0e-3
    worst_jump = 0.0
    for h_boundary_m in (11000.0, 20000.0, 32000.0):
        # invert h = r0 z/(r0+z)  ->  z = r0 h/(r0-h)
        z_b = R_EARTH_GEOPOTENTIAL_M * h_boundary_m / (R_EARTH_GEOPOTENTIAL_M - h_boundary_m)
        lo = atmosphere(z_b - probe_dz_m)
        hi = atmosphere(z_b + probe_dz_m)
        worst_jump = max(worst_jump, abs(hi.rho_kgm3 - lo.rho_kgm3) / lo.rho_kgm3)
    ok = worst_jump < 1.0e-6
    failures += 0 if ok else 1
    print(f"  [{'PASS' if ok else 'FAIL'}] density continuous across layer boundaries "
          f"(worst relative jump over the 2 mm probe = {worst_jump:.3e}; the physical "
          f"hydrostatic change over 2 mm is ~3.1e-7, so this is gradient, not a step)")

    print("\n-- scalar fast path == vectorized reference path --")
    # The scalar path is a hand-written duplicate of the array arithmetic. If the two
    # ever diverge, every downstream energy integral silently depends on which one a
    # caller happened to hit. Require BIT equality across the whole validity band.
    probe_z = np.linspace(ALTITUDE_MIN_M, ALTITUDE_MAX_M, 20001)
    ref = atmosphere(probe_z)                       # vectorized path
    worst_ulp = 0.0
    mismatches = 0
    for k, zz in enumerate(probe_z):
        fast = atmosphere(float(zz))                # scalar fast path
        for field_i, name in enumerate(("T_K", "p_Pa", "rho_kgm3", "mu_Pas", "a_ms")):
            got = getattr(fast, name)
            want = float(ref[field_i][k])
            if got != want:
                mismatches += 1
                worst_ulp = max(worst_ulp, abs(got - want) / abs(want))
    ok = mismatches == 0
    failures += 0 if ok else 1
    print(f"  [{'PASS' if ok else 'FAIL'}] scalar and array paths agree bit-for-bit "
          f"({len(probe_z)} altitudes x 5 fields; {mismatches} mismatches, worst "
          f"relative {worst_ulp:.2e})")

    print("\n-- range guard --")
    guarded = 0
    for bad_z in (-6000.0, 48000.0, float("nan")):
        try:
            atmosphere(bad_z)
        except ValueError:
            guarded += 1
    ok = guarded == 3
    failures += 0 if ok else 1
    print(f"  [{'PASS' if ok else 'FAIL'}] out-of-band / non-finite altitudes rejected "
          f"({guarded}/3)")

    print("\n" + "=" * 92)
    print(f"atmosphere.py: {'ALL CHECKS PASSED' if failures == 0 else f'{failures} CHECK(S) FAILED'}")
    print("=" * 92)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(_selftest())
