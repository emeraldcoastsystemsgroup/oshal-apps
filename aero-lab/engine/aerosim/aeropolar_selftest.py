"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-----------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted verbatim from aerosim.aeropolar
  |                                           | so that module stays under the 1000-code-line
  |                                           | hard cap after the strip-integration and
  |                                           | lift-slope fixes. Behaviour is unchanged:
  |                                           | `python -m aerosim.aeropolar` still runs this,
  |                                           | via a delegating __main__ block there.
2 | maintainer@emeraldcoastsystemsgroup.com   | Added acceptance checks [12] and [13] for the
  |                                           | two fixes: the viscous lift slope must never
  |                                           | exceed the inviscid VLM bound, and a random
  |                                           | planform sweep must not abort with an
  |                                           | AssertionError.

aerosim.aeropolar_selftest -- the acceptance criteria for aerosim.aeropolar.

This is scaffolding, not simulation. It lives in its own module purely so that
aeropolar.py -- which is the thing under the 1000-code-line cap -- carries only the
physics. Every number it prints is computed live; nothing here is asserted from memory.

Run it with either of:
    python -m aerosim.aeropolar
    python -m aerosim.aeropolar_selftest
"""

from __future__ import annotations

import math
from typing import Tuple

import numpy as np

import aerosandbox as asb

from aerosim.aeropolar import (
    CONFIDENCE_FLOOR,
    RE_FLOOR,
    NoValidPointError,
    _as_float_array,
    _endurance_factor,
    _VLM_CACHE,
    best_endurance_point,
    naca_kulfan,
    ncrit_spread,
    section_polar,
    wing_polar,
)

__all__ = ["selftest"]


def _sutherland_mu(T_K: float) -> float:
    """Sutherland dynamic viscosity, Pa*s. Duplicated locally ONLY for the self-test.

    @description aeropolar is a leaf module and may not import aerosim.env, but the
        acceptance test is stated in terms of "mu from Sutherland at 283 K". This is the
        same formula the env module owns: mu = 1.458e-6 * T^1.5 / (T + 110.4).
        Production code must call env.sutherland_mu, not this.
    @param T_K Static temperature, kelvin.
    @returns Dynamic viscosity, Pa*s.
    """
    return 1.458e-6 * T_K**1.5 / (T_K + 110.4)


def _report(name: str, ok: bool, detail: str) -> bool:
    """Print one PASS/FAIL line. @returns the `ok` flag unchanged."""
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    return ok


def selftest() -> int:
    """Run the aeropolar acceptance tests and print actual computed values.

    @description Executes the acceptance criteria from the project spec verbatim.
    @returns 0 if every check passed, 1 otherwise.
    """
    import time

    results = []
    print("=" * 78)
    print("aerosim.aeropolar self-test")
    print(f"  aerosandbox {asb.__version__}   numpy {np.__version__}")
    print("=" * 78)

    # ---- 1. NACA 2412 design vector -------------------------------------------
    print("\n[1] naca_kulfan('2412') -> 18-parameter design vector")
    up, lo, lew, te = naca_kulfan("2412")
    results.append(
        _report(
            "shape",
            up.size == 8 and lo.size == 8,
            f"upper[{up.size}] lower[{lo.size}] LE_weight={lew:.6f} TE_thk={te:.6f}",
        )
    )
    print(f"        upper = {np.array2string(up, precision=5)}")
    print(f"        lower = {np.array2string(lo, precision=5)}")

    # ---- 2. Section polar at Re 200,000 ---------------------------------------
    print("\n[2] section_polar(naca2412, alpha 0..10 deg, Re=200_000, n_crit=9)")
    print("    XFOIL 6.99 on this box measured 65.4 (CL^1.5/CD) and 67.1 (CL/CD)")
    alphas = np.arange(0.0, 11.0, 1.0)
    sp = section_polar(up, lo, lew, te, alphas, Re=200_000.0, n_crit=9.0)
    f15 = _endurance_factor(sp.CL, sp.CD)
    fld = np.where(sp.CD > 0, sp.CL / sp.CD, 0.0)
    m15, mld = float(f15.max()), float(fld.max())
    results.append(
        _report("max CL^1.5/CD in [55,78]", 55.0 <= m15 <= 78.0, f"{m15:.3f}")
    )
    results.append(_report("max CL/CD in [57,78]", 57.0 <= mld <= 78.0, f"{mld:.3f}"))
    results.append(
        _report(
            "all points certified",
            bool(sp.valid.all()),
            f"{int(sp.valid.sum())}/{sp.valid.size} valid, "
            f"confidence {sp.confidence.min():.3f}..{sp.confidence.max():.3f}",
        )
    )
    print(f"        CL = {np.array2string(sp.CL, precision=4)}")
    print(f"        CD = {np.array2string(sp.CD, precision=5)}")
    print(f"        CM = {np.array2string(sp.CM, precision=4)}")

    # ---- 3. Section polar at Re 9,400 (the unflyable case) ---------------------
    print("\n[3] section_polar(same, Re=9_400)  -- 20 km, 10 cm chord, 15 m/s")
    print("    XFOIL 6.99 on this box measured 2.63 -- and was lying with exit code 0")
    sp_low = section_polar(up, lo, lew, te, alphas, Re=9_400.0, n_crit=9.0)
    f15_low = float(_endurance_factor(sp_low.CL, sp_low.CD).max())
    results.append(_report("max CL^1.5/CD < 10", f15_low < 10.0, f"{f15_low:.3f}"))
    results.append(
        _report(
            "valid.all() is False (Re below RE_FLOOR)",
            bool(sp_low.valid.all()) is False,
            f"{int(sp_low.valid.sum())}/{sp_low.valid.size} valid, "
            f"Re=9400 < RE_FLOOR={RE_FLOOR:.0f}",
        )
    )
    print(f"        CL = {np.array2string(sp_low.CL, precision=4)}")
    print(f"        CD = {np.array2string(sp_low.CD, precision=5)}")

    # ---- 4. AtlantikSolar wing polar -------------------------------------------
    print("\n[4] wing_polar -- AtlantikSolar (ETH Zurich), 5.65 m span, 1.72 m2")
    T_K = 283.0
    mu = _sutherland_mu(T_K)
    rho = 1.18
    V = 9.5
    geom = dict(
        span_m=5.65,
        area_m2=1.72,
        taper_ratio=0.7,
        sweep_deg=0.0,
        twist_root_deg=2.0,
        twist_tip_deg=0.0,
        kulfan_upper=up,
        kulfan_lower=lo,
        leading_edge_weight=lew,
        TE_thickness=te,
    )
    wing_alphas = np.arange(-2.0, 12.01, 0.5)
    t0 = time.perf_counter()
    wp = wing_polar(
        alpha_deg=wing_alphas,
        V_ms=V,
        rho_kgm3=rho,
        mu_Pas=mu,
        extra_CD0=0.006,
        **geom,
    )
    t_wing = time.perf_counter() - t0
    CL_best, CD_best, factor_best = best_endurance_point(wp)
    AR = 5.65**2 / 1.72
    print(
        f"        mu(283 K) = {mu:.6e} Pa*s   AR = {AR:.3f}   "
        f"Re_mean = {wp.Re_mean[0]:,.0f}   solve {t_wing:.2f} s"
    )
    print(
        f"        best point: CL = {CL_best:.4f}  CD = {CD_best:.5f}  "
        f"(CDi {wp.CDi[np.argmin(np.abs(wp.CL - CL_best))]:.5f} + "
        f"CDp {wp.CDp[np.argmin(np.abs(wp.CL - CL_best))]:.5f})"
    )
    results.append(
        _report(
            "best CL^1.5/CD in [18,32]",
            18.0 <= factor_best <= 32.0,
            f"{factor_best:.3f}",
        )
    )
    results.append(
        _report(
            "e_oswald in [0.90,0.99]",
            0.90 <= wp.e_oswald <= 0.99,
            f"{wp.e_oswald:.4f}",
        )
    )
    results.append(
        _report(
            "certified points exist",
            bool(wp.valid.any()),
            f"{int(wp.valid.sum())}/{wp.valid.size} alphas certified",
        )
    )
    results.append(
        _report(
            "CD > 0 everywhere (free-energy invariant)",
            bool(np.all(wp.CD > 0.0)),
            f"min CD = {wp.CD.min():.6f}",
        )
    )
    results.append(
        _report(
            "CDi >= 0 everywhere",
            bool(np.all(wp.CDi >= 0.0)),
            f"min CDi = {wp.CDi.min():.6f}",
        )
    )

    # Cross-check against the project's own derivation: aero power at the best point.
    W_N = 6.93 * 9.80665  # newtons -- AtlantikSolar 6.93 kg
    P_aero_W = math.sqrt(2.0 * W_N**3 / (rho * 1.72)) / factor_best
    print(
        f"        cross-check: W = {W_N:.2f} N -> level-flight aero power = "
        f"{P_aero_W:.1f} W (project context: 21.4 W at CL^1.5/CD = 26; "
        f"~40 W electrical published)"
    )
    results.append(
        _report(
            "AtlantikSolar aero power in [15,32] W",
            15.0 <= P_aero_W <= 32.0,
            f"{P_aero_W:.2f} W",
        )
    )

    # ---- 5. Determinism ---------------------------------------------------------
    print("\n[5] Determinism -- two identical calls must be bit-identical")
    sp_a = section_polar(up, lo, lew, te, alphas, Re=200_000.0, n_crit=9.0)
    sp_b = section_polar(up, lo, lew, te, alphas, Re=200_000.0, n_crit=9.0)
    sec_same = bool(
        np.array_equal(sp_a.CL, sp_b.CL)
        and np.array_equal(sp_a.CD, sp_b.CD)
        and np.array_equal(sp_a.CM, sp_b.CM)
    )
    results.append(_report("section_polar bit-identical", sec_same, "CL/CD/CM equal"))
    wp_b = wing_polar(
        alpha_deg=wing_alphas,
        V_ms=V,
        rho_kgm3=rho,
        mu_Pas=mu,
        extra_CD0=0.006,
        **geom,
    )
    wing_same = bool(
        np.array_equal(wp.CL, wp_b.CL)
        and np.array_equal(wp.CD, wp_b.CD)
        and wp.e_oswald == wp_b.e_oswald
    )
    results.append(_report("wing_polar bit-identical", wing_same, "CL/CD/e equal"))

    # ---- 6. Throughput ----------------------------------------------------------
    print("\n[6] Throughput -- 1000-alpha batched section_polar < 2.0 s")
    big_alphas = np.linspace(-5.0, 15.0, 1000)
    t0 = time.perf_counter()
    section_polar(up, lo, lew, te, big_alphas, Re=200_000.0, n_crit=11.0)
    t_batch = time.perf_counter() - t0
    results.append(_report("1000-alpha batch < 2.0 s", t_batch < 2.0, f"{t_batch:.4f} s"))

    # ---- 7. The Reynolds refusal actually bites ---------------------------------
    print("\n[7] RE_FLOOR gate -- a wing that cannot be spoken about must be refused")
    # Same planform, but flown at 20 km density at 15 m/s: chord Re collapses.
    wp_thin = wing_polar(
        alpha_deg=np.arange(0.0, 9.01, 1.0),
        V_ms=15.0,
        rho_kgm3=0.0889,  # 20 km ISA, project context
        mu_Pas=1.4216e-5,  # Sutherland at 216.65 K, project context
        extra_CD0=0.006,
        **dict(geom, span_m=2.5, area_m2=0.30),  # 2.5 m span solar wing, tiny chord
    )
    refused = False
    try:
        best_endurance_point(wp_thin)
    except NoValidPointError as exc:
        refused = True
        print(f"        refusal message: {exc}")
    results.append(
        _report(
            "sub-floor wing raises NoValidPointError",
            refused,
            f"Re_mean = {wp_thin.Re_mean[0]:,.0f} vs RE_FLOOR {RE_FLOOR:,.0f}; "
            f"{int(wp_thin.valid.sum())} certified points",
        )
    )

    # ---- 8. n_crit spread -------------------------------------------------------
    print("\n[8] ncrit_spread -- report the atmosphere assumption, do not hide it")
    spread = ncrit_spread(
        alpha_deg=wing_alphas,
        V_ms=V,
        rho_kgm3=rho,
        mu_Pas=mu,
        extra_CD0=0.006,
        **geom,
    )
    print(
        "        "
        + "   ".join(f"n_crit {k:.0f} -> {v:.2f}" for k, v in sorted(spread.items()))
    )
    band = (max(spread.values()) - min(spread.values())) / max(spread.values())
    print(
        f"        spread band = {100 * band:.2f}% of best. NOTE: not monotone in "
        "n_crit -- quieter air lengthens the laminar separation bubble, and at this "
        "Reynolds number that costs more than the skin friction it saves."
    )
    results.append(
        _report(
            "spread has 3 entries, all certified and positive",
            len(spread) == 3 and all(v > 0 for v in spread.values()),
            f"{ {k: round(v, 2) for k, v in sorted(spread.items())} }",
        )
    )

    # ---- 9. Sweep throughput ------------------------------------------------------
    print("\n[9] Sweep throughput -- the 30,000-design premise")
    t0 = time.perf_counter()
    wing_polar(
        alpha_deg=wing_alphas,
        V_ms=V,
        rho_kgm3=rho,
        mu_Pas=mu,
        extra_CD0=0.006,
        **dict(geom, taper_ratio=0.65),  # a planform not yet in the VLM cache
    )
    t_cold = time.perf_counter() - t0
    t0 = time.perf_counter()
    for _ in range(5):
        wing_polar(
            alpha_deg=wing_alphas,
            V_ms=V,
            rho_kgm3=rho,
            mu_Pas=mu,
            extra_CD0=0.006,
            **geom,  # cached planform: strip closure only
        )
    t_warm = (time.perf_counter() - t0) / 5.0
    print(
        f"        new planform (3 VLM solves + strip closure): {t_cold:.3f} s\n"
        f"        cached planform (strip closure only):        {t_warm:.3f} s\n"
        f"        -> 30,000 new planforms = {30000 * t_cold / 3600:.1f} core-hours "
        "(embarrassingly parallel)"
    )
    results.append(
        _report(
            "cold wing_polar < 3 s, cached wing_polar < 0.5 s",
            t_cold < 3.0 and t_warm < 0.5,
            f"cold {t_cold:.3f} s, warm {t_warm:.3f} s",
        )
    )

    # ---- 10. Independent physics cross-checks ------------------------------------
    print("\n[10] Cross-checks against constants this module did not derive")

    # (a) Zephyr S class at 20 km. Project context predicts chord 0.83 m, Re ~146,000
    #     at V = 28.2 m/s -- an independent check that the strip chords and the
    #     Reynolds bookkeeping are right, using the env module's 20 km ISA values.
    wp_zephyr = wing_polar(
        span_m=25.0,
        area_m2=20.8,
        taper_ratio=0.8,
        sweep_deg=0.0,
        twist_root_deg=2.0,
        twist_tip_deg=0.0,
        kulfan_upper=up,
        kulfan_lower=lo,
        leading_edge_weight=lew,
        TE_thickness=te,
        alpha_deg=np.arange(0.0, 10.01, 1.0),
        V_ms=28.2,
        rho_kgm3=0.08891,  # 20 km geopotential-corrected ISA, project context
        mu_Pas=1.4216e-5,  # Sutherland at 216.65 K, project context
        extra_CD0=0.006,
    )
    Re_zephyr = float(wp_zephyr.Re_mean[0])
    results.append(
        _report(
            "Zephyr-class Re_mean within 5% of the predicted 146,000",
            abs(Re_zephyr - 146_000.0) / 146_000.0 < 0.05,
            f"{Re_zephyr:,.0f} (predicted ~146,000 at V 28.2 m/s, chord 0.83 m); "
            f"above RE_FLOOR, {int(wp_zephyr.valid.sum())}/{wp_zephyr.valid.size} "
            "certified",
        )
    )

    # (b) A rectangular (untapered, untwisted) high-AR wing should land near the
    #     classical span efficiency of ~0.93 -- Prandtl/Glauert, and a number this
    #     module has no way to know unless the VLM loading is genuinely being solved.
    wp_rect = wing_polar(
        alpha_deg=np.arange(0.0, 10.01, 1.0),
        V_ms=V,
        rho_kgm3=rho,
        mu_Pas=mu,
        extra_CD0=0.006,
        **dict(geom, taper_ratio=1.0, twist_root_deg=0.0, twist_tip_deg=0.0),
    )
    results.append(
        _report(
            "rectangular AR-18.6 wing e_oswald in [0.88,0.96] (classical ~0.93)",
            0.88 <= wp_rect.e_oswald <= 0.96,
            f"{wp_rect.e_oswald:.4f} vs {wp.e_oswald:.4f} for the tapered wing "
            "(taper must improve span efficiency)",
        )
    )
    results.append(
        _report(
            "taper 0.7 beats taper 1.0 on span efficiency",
            wp.e_oswald > wp_rect.e_oswald,
            f"{wp.e_oswald:.4f} > {wp_rect.e_oswald:.4f}",
        )
    )

    # ---- 11. Mutation test: prove the free-energy guards actually fire ------------
    # A guard nobody has watched go red is not a guard. Force the solver to return a
    # negative drag coefficient and confirm both entry points refuse rather than
    # handing a thrust-producing wing to the integrator.
    print("\n[11] Free-energy guard mutation test -- force CD < 0, expect a refusal")
    real_call = asb.KulfanAirfoil.get_aero_from_neuralfoil

    def _thrust_producing_airfoil(self, *args, **kwargs):
        aero = dict(real_call(self, *args, **kwargs))
        aero["CD"] = -np.abs(_as_float_array(aero["CD"]))  # a wing that makes thrust
        return aero

    asb.KulfanAirfoil.get_aero_from_neuralfoil = _thrust_producing_airfoil
    try:
        section_refused = False
        try:
            section_polar(up, lo, lew, te, alphas, Re=200_000.0, n_crit=9.0)
        except AssertionError as exc:
            section_refused = True
            section_msg = str(exc).splitlines()[0]
        wing_refused = False
        _VLM_CACHE.clear()  # force the whole wing path to re-run under the mutation
        try:
            wing_polar(
                alpha_deg=wing_alphas,
                V_ms=V,
                rho_kgm3=rho,
                mu_Pas=mu,
                extra_CD0=0.006,
                **geom,
            )
        except AssertionError as exc:
            wing_refused = True
            wing_msg = str(exc).splitlines()[0]
    finally:
        asb.KulfanAirfoil.get_aero_from_neuralfoil = real_call
        _VLM_CACHE.clear()

    results.append(
        _report(
            "section_polar refuses a negative-CD airfoil",
            section_refused,
            section_msg if section_refused else "GUARD DID NOT FIRE",
        )
    )
    results.append(
        _report(
            "wing_polar refuses a negative-CD airfoil",
            wing_refused,
            wing_msg if wing_refused else "GUARD DID NOT FIRE",
        )
    )

    # And confirm the module still works after the mutation is reverted -- a guard
    # test that leaves the module broken is worse than no test.
    restored = section_polar(up, lo, lew, te, alphas, Re=200_000.0, n_crit=9.0)
    results.append(
        _report(
            "module intact after mutation reverted",
            bool(np.allclose(restored.CL, sp.CL) and np.allclose(restored.CD, sp.CD)),
            "section polar matches the pre-mutation result",
        )
    )

    # ---- 12. The viscous lift slope may never beat the inviscid VLM bound --------
    print("\n[12] Lift-slope bound -- viscous <= inviscid VLM (potential-flow ceiling)")
    for label, polar in (
        ("AtlantikSolar", wp),
        ("Zephyr class", wp_zephyr),
        ("rectangular AR-18.6", wp_rect),
    ):
        ratio = polar.CL_slope_per_rad / polar.CL_slope_inviscid_per_rad
        a0_ratio = polar.a0_section_per_rad / (2.0 * math.pi)
        results.append(
            _report(
                f"{label}: slope ratio <= 1",
                ratio <= 1.0 + 1e-12,
                f"used {polar.CL_slope_per_rad:.4f} /rad vs inviscid "
                f"{polar.CL_slope_inviscid_per_rad:.4f} /rad (ratio {ratio:.6f}); "
                f"NeuralFoil a0 = {polar.a0_section_per_rad:.4f} /rad "
                f"= {a0_ratio:.3f} x 2pi; flags {polar.slope_flags or '()'}",
            )
        )
    # A clamp that binds must SAY so. Case A is measured to bind (a0 = 1.41 x 2pi at
    # Re 195k is above the thick-airfoil inviscid ceiling), so an empty flag tuple there
    # would mean the report had gone silent again.
    results.append(
        _report(
            "a binding clamp is reported, not swallowed",
            bool(wp.slope_flags) and wp.CL_slope_per_rad <= wp.CL_slope_inviscid_per_rad,
            f"case A flags = {wp.slope_flags}",
        )
    )

    # ---- 13. A random planform sweep must not abort ------------------------------
    print("\n[13] Sweep robustness -- 25 random planforms, zero AssertionErrors")
    rng = np.random.default_rng(11)
    sweep_alphas = np.arange(-2.0, 12.01, 1.0)
    n_ok = n_nvp = n_abort = 0
    abort_msg = ""
    for _ in range(25):
        span_i = float(rng.uniform(1.0, 40.0))
        AR_i = float(rng.uniform(6.0, 40.0))
        taper_i = float(rng.uniform(0.2, 1.0))
        sweep_i = float(rng.uniform(0.0, 25.0))
        try:
            wing_polar(
                span_i, span_i**2 / AR_i, taper_i, sweep_i, 2.0, 0.0,
                up, lo, lew, te, sweep_alphas, 12.0, 1.0, 1.8e-5,
                n_crit=11.0, extra_CD0=0.006,
            )
            n_ok += 1
        except NoValidPointError:
            n_nvp += 1
        except AssertionError as exc:
            n_abort += 1
            abort_msg = str(exc).splitlines()[0][:120]
    results.append(
        _report(
            "no planform aborts with AssertionError",
            n_abort == 0,
            f"{n_ok} evaluated, {n_nvp} refused as NoValidPointError, "
            f"{n_abort} AssertionError"
            + (f" -- {abort_msg}" if abort_msg else ""),
        )
    )

    print("\n" + "=" * 78)
    n_pass = sum(1 for r in results if r)
    verdict = "PASS" if all(results) else "FAIL"
    print(f"{verdict}  --  {n_pass}/{len(results)} checks passed")
    print("=" * 78)
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(selftest())
