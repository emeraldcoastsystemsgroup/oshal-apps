"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 (cleanup) guards, one per finding. (1) min_extra_CD0 replaces the vacuous solid-sphere bound: the case-A-class floor must land within a factor 3 of the AS-2-honest 0.006 (it was ~300x below), a declared 0.0001 on a kg-scale pod must sit far below the floor (screen refusal), and the floor is monotone + fail-closed on junk. (2) Tolerance compounding: the measured corner (0.32999 @ 0.1905 kg/m2) refuses while both honest neighbours (frontier-exact in the lighter class, frontier x1.10 at the point's own density) still construct; packing_factor caps at 0.92. (3) re_bins_per_decade [6, 24] int and finite incidence_deg raise NAMED ParamBoundsError -- bins=0 previously died as a raw ZeroDivisionError and nan incidence constructed. (4) The night-skipper: dt = 86400 s on case A reported min_soc 1.0 certified; certification now requires dt <= 3600 s with a PV source aboard, and the refusal carries a named reason.

Each test pins a MEASURED pre-fix exploit (R6_probe_cd0_and_controls.out,
R7_probe_cleanup_before.out) so a regression re-opens a known hole loudly.
Runs under pytest AND standalone:

    .venv/Scripts/python.exe tests/test_floors.py
"""
from __future__ import annotations

import math
import os
import sys
import warnings

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aerosim.vehicle import (
    AeroSurface,
    MAX_PV_PACKING_FACTOR,
    MassClosureError,
    ParamBoundsError,
    PVArray,
    min_extra_CD0,
    naca4_geometry,
    recheck_element_params,
)

#: The AS-2-honest extra_CD0 for the case-A class, dimensionless (DESIGN_A's
#: declared value -- what the vacuous floor was supposed to be near).
AS2_HONEST_EXTRA_CD0 = 0.006

#: Case-A-class fuselage: carried mass (battery 2.917 + payload 0.150 +
#: propulsion 0.076 kg), span, wing area, and the case-A mean cruise Re.
CASE_A_CARRIED_KG = 3.143
CASE_A_SPAN_M = 5.65
CASE_A_AREA_M2 = 1.72
CASE_A_CRUISE_RE = 178300.0

_GEOM = naca4_geometry("2412", span_m=5.65, area_m2=1.72, taper_ratio=0.7)


# --------------------------------------------------------------------------- #
# 1. The extra_CD0 shell/slender-body floor is not vacuous                      #
# --------------------------------------------------------------------------- #


def test_extra_cd0_floor_is_within_a_factor_3_of_flown_hardware() -> None:
    """The retired solid-sphere bound gave ~2e-5 here -- 300x below the
    AS-2-honest 0.006, i.e. no floor at all. The shell/slender-body floor must
    land within a factor 3 (measured: 3.4e-3, factor 1.77) while staying BELOW
    the honest declaration so case A itself keeps passing."""
    floor = min_extra_CD0(CASE_A_CARRIED_KG, CASE_A_SPAN_M, CASE_A_AREA_M2,
                          CASE_A_CRUISE_RE)
    assert floor < AS2_HONEST_EXTRA_CD0, (
        f"floor {floor:.4g} exceeds the honest AS-2 declaration "
        f"{AS2_HONEST_EXTRA_CD0} -- case A would refuse its own fuselage"
    )
    assert floor > AS2_HONEST_EXTRA_CD0 / 3.0, (
        f"floor {floor:.4g} is more than a factor 3 below the AS-2-honest "
        f"{AS2_HONEST_EXTRA_CD0} -- the vacuous-floor regression is back "
        f"(the solid-sphere bound sat at ~2e-5)"
    )


def test_extra_cd0_floor_kills_the_r6_rider() -> None:
    """R6_probe_cd0_and_controls measured: declared 0.0001 on the rider-mid
    frontier ship (11.65 kg carried, 13.86 m span, 8 m2, Re 2.73e5) screened
    admissible against a floor of 1e-5 and bought +3.4% usable. The new floor
    for that ship must sit far above 0.0001."""
    floor = min_extra_CD0(11.65, 13.856, 8.0, 273000.0)
    assert floor > 10.0 * 0.0001, (
        f"kg-scale pod floor {floor:.4g} does not refuse the 0.0001 rider"
    )
    # The rider's other setting, 0.0025, is a plausible clean large-wing build
    # and stays admissible: the floor is a floor, not a re-pricing.
    assert floor < 0.0025


def test_extra_cd0_floor_is_monotone_and_fail_closed() -> None:
    base = min_extra_CD0(3.0, 5.65, 1.72, 2.0e5)
    assert min_extra_CD0(6.0, 5.65, 1.72, 2.0e5) > base      # more pod
    assert min_extra_CD0(3.0, 11.3, 1.72, 2.0e5) > base      # more boom+tail
    assert min_extra_CD0(3.0, 5.65, 3.44, 2.0e5) < base      # more wing dilutes
    for bad_kwargs in (
        dict(carried_mass_kg=-1.0),
        dict(carried_mass_kg=math.nan),
        dict(span_m=0.0),
        dict(span_m=math.inf),
        dict(wing_area_m2=0.0),
        dict(reynolds=0.0),
        dict(reynolds=math.nan),
    ):
        kwargs = dict(carried_mass_kg=3.0, span_m=5.65, wing_area_m2=1.72,
                      reynolds=2.0e5)
        kwargs.update(bad_kwargs)
        try:
            min_extra_CD0(**kwargs)
        except MassClosureError:
            continue
        raise AssertionError(f"min_extra_CD0({bad_kwargs}) returned a number "
                             f"-- a floor evaluated on junk fails open")


def test_screen_refuses_the_cd0_rider_end_to_end() -> None:
    """The R6 rider through the real screen: same ship, declared extra_CD0
    0.0001 (screened admissible before the fix, floor 1e-5), must now come
    back inadmissible with the floor named."""
    import dataclasses

    from aerosim import validate_designs as vd
    from aerosim.validate import _run_window, screen_design
    from aerosim.vehicle import Thruster, min_fuselage_boom_tail_mass_kg
    from aerosim.vehicle.structure import wing_mass_kg

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        S, AR, batt_kg = 8.0, 24.0, 11.0
        b_span = math.sqrt(AR * S)
        th = Thruster(diameter_m=0.9, max_electrical_power_W=2000.0,
                      n_rotors=1, figure_of_merit=0.85, eta_motor=0.85,
                      eta_esc=0.95)
        carried = batt_kg + 0.150 + th.mass_kg
        fus_kg = min_fuselage_boom_tail_mass_kg(carried, b_span)
        total = (batt_kg + S * 0.20 + th.mass_kg + 0.150
                 + wing_mass_kg(b_span, S, 3.0) + fus_kg)
        d = dataclasses.replace(
            vd.DESIGN_A, name="cd0-rider-guard", span_m=b_span, area_m2=S,
            taper_ratio=0.7, extra_CD0=0.0001, mass_all_up_kg=total,
            battery_mass_kg=batt_kg, pack_Wh_per_kg=445.4999,
            pv_efficiency=0.30, pv_packing=0.90, pv_areal_density_kg_m2=0.20,
            prop_diameter_m=0.9, prop_max_electrical_W=2000.0,
            payload_W=5.8, payload_mass_kg=0.150, altitude_m=2000.0,
            latitude_deg=-10.0, day_of_year=172,
        )
        build = vd.build_solar_cruise(d)
        result, _ = _run_window(build)
        admissible, reasons = screen_design(build, result,
                                            check_seasonal=False)
    assert not admissible, "the 0.0001 extra_CD0 rider screened admissible"
    assert any("extra_CD0 floor" in r for r in reasons), (
        f"refusal does not name the extra_CD0 floor: {reasons}"
    )


# --------------------------------------------------------------------------- #
# 2. Tolerance compounding at the catalogue frontier                            #
# --------------------------------------------------------------------------- #


def test_pv_tolerances_do_not_compound_across_the_class_edge() -> None:
    """Measured corner (R6/R7): 0.32999 claimed at 0.1905 kg/m2 -- the ELO
    point (0.30 @ 0.20) stretched by the 5% density-class tolerance AND the
    10% efficiency tolerance at once, a ~1730 W/kg cell that does not exist.
    Must refuse; both honest neighbours must still construct."""
    try:
        PVArray(area_m2=1.0, cell_efficiency_stc=0.32999, packing_factor=0.9,
                areal_density_kg_m2=0.1905)
    except ValueError:  # TechCatalogueError is a MassClosureError (ValueError)
        pass
    else:
        raise AssertionError(
            "0.32999 @ 0.1905 kg/m2 constructed -- the tolerance stack "
            "(+4.1% usable measured) is back"
        )
    # Lighter than the point's own density: frontier EXACTLY, no headroom.
    PVArray(area_m2=1.0, cell_efficiency_stc=0.30, packing_factor=0.9,
            areal_density_kg_m2=0.1905)
    # At the point's own density: the 10% bin-spread headroom applies.
    PVArray(area_m2=1.0, cell_efficiency_stc=0.33, packing_factor=0.9,
            areal_density_kg_m2=0.20)
    # And a hair past the headroom at the point's own density still refuses.
    try:
        PVArray(area_m2=1.0, cell_efficiency_stc=0.3305, packing_factor=0.9,
                areal_density_kg_m2=0.20)
    except ValueError:
        pass
    else:
        raise AssertionError("0.3305 @ 0.20 constructed (ceiling is 0.33)")


def test_packing_factor_caps_at_the_catalogue_ceiling() -> None:
    """packing 0.999 was legal and rode the corner. Best flown ~0.90
    (Zephyr-class layouts; AS-2 as-flown 0.802): the declared bound now ends
    at MAX_PV_PACKING_FACTOR = 0.92."""
    assert MAX_PV_PACKING_FACTOR == 0.92
    for bad in (0.999, 0.93, 1.0):
        try:
            PVArray(area_m2=1.0, cell_efficiency_stc=0.237, packing_factor=bad,
                    areal_density_kg_m2=0.72)
        except ParamBoundsError:
            continue
        raise AssertionError(f"packing_factor={bad} constructed")
    # The cap itself and every case value still construct.
    for ok in (0.92, 0.90, 0.802):
        PVArray(area_m2=1.0, cell_efficiency_stc=0.237, packing_factor=ok,
                areal_density_kg_m2=0.72)
    # Live-instance drift past the cap is caught at recheck.
    arr = PVArray(area_m2=1.0, cell_efficiency_stc=0.237, packing_factor=0.9,
                  areal_density_kg_m2=0.72)
    arr.packing_factor = 0.999
    try:
        recheck_element_params(arr)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError("packing_factor drifted to 0.999 passed recheck")


# --------------------------------------------------------------------------- #
# 3. re_bins_per_decade and incidence_deg are named refusals, not crashes       #
# --------------------------------------------------------------------------- #


def test_re_bins_out_of_range_is_a_named_error_not_a_crash() -> None:
    """Measured before: bins=0 died as a raw ZeroDivisionError inside
    _bin_center_reynolds, bins=-3 and bins=1 CONSTRUCTED (bins=1 moved the
    certified answer 0.8%). All must now be ParamBoundsError at construction."""
    for bad in (0, -3, 1, 5, 25, 48, 12.5, math.nan, math.inf):
        try:
            AeroSurface(_GEOM, extra_CD0=0.006, re_bins_per_decade=bad)
        except ParamBoundsError:
            continue
        except ZeroDivisionError:
            raise AssertionError(
                f"re_bins_per_decade={bad} still crashes as ZeroDivisionError "
                f"-- the named refusal regressed"
            )
        raise AssertionError(f"re_bins_per_decade={bad} constructed")
    # The declared range's endpoints and the default all work.
    for ok in (6, 12, 24):
        s = AeroSurface(_GEOM, extra_CD0=0.006, re_bins_per_decade=ok)
        assert s.re_bins_per_decade == ok
        recheck_element_params(s)


def test_nan_incidence_is_refused_at_construction_and_recheck() -> None:
    """Measured before: AeroSurface(incidence_deg=nan) constructed and every
    coefficient lookup went silently nan."""
    for bad in (math.nan, math.inf, -math.inf, 200.0, -200.0):
        try:
            AeroSurface(_GEOM, extra_CD0=0.006, incidence_deg=bad)
        except ParamBoundsError:
            continue
        raise AssertionError(f"incidence_deg={bad!r} constructed")
    # The trim's runtime writes stay legal; drifting to nan is caught live.
    s = AeroSurface(_GEOM, extra_CD0=0.006, incidence_deg=3.0)
    s.incidence_deg = 4.2          # a trim write
    recheck_element_params(s)      # fine
    s.incidence_deg = math.nan     # post-construction poisoning
    try:
        recheck_element_params(s)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError("nan incidence on a live instance passed recheck")


# --------------------------------------------------------------------------- #
# 4. The night-skipper: dt taint with a PV source aboard                        #
# --------------------------------------------------------------------------- #


def test_one_step_per_day_is_not_certified() -> None:
    """Measured before: dt = 86400 s on case A reported min_soc 1.0000 with
    closed=True certified=True -- one step per day never samples the night.
    Now: the numbers are still reported, but certified=False, closed=False,
    and the reason names dt."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from aerosim import validate_designs as vd
        from aerosim.integrate import integrate_energy

        build = vd.build_solar_cruise(vd.DESIGN_A)
        r = integrate_energy(build.vehicle, build.env, 0.0, 86400.0, 86400.0)
    assert not r.certified, "dt=86400 s with a PV source came back certified"
    assert not r.closed, "dt=86400 s with a PV source came back closed"
    assert any("dt-too-coarse" in reason
               for reason in r.detail["closed_reasons"]), (
        f"no named dt reason: {r.detail['closed_reasons']}"
    )


def test_hourly_step_still_certifies_and_matches_the_fine_answer() -> None:
    """dt = 3600 s is the certification ceiling: 24 samples per diurnal cycle.
    Measured against dt = 60 s on case A: usable margin 1.119713 vs 1.120130
    (0.04%) and min_soc 0.358535 vs the certified 0.353829 (1.3%). Guard: the
    hourly run must stay certified, closed, and within 2% of the certified
    case-A min_soc -- if it drifts past that, the ceiling itself is wrong."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from aerosim import validate_designs as vd
        from aerosim.integrate import integrate_energy

        build = vd.build_solar_cruise(vd.DESIGN_A)
        r = integrate_energy(build.vehicle, build.env, 0.0, 86400.0, 3600.0)
    assert r.certified and r.closed
    certified_min_soc = 0.35382872510736812   # case A at dt = 60 s, round 4
    assert abs(float(r.min_soc) - certified_min_soc) < 0.02 * certified_min_soc


# --------------------------------------------------------------------------- #
# Standalone runner (mirrors tests/test_param_bounds.py)                        #
# --------------------------------------------------------------------------- #


def _main() -> int:
    """
    @description Run every test_* function in this module and report.
    @returns 0 when all passed, 1 otherwise.
    """
    tests = [(name, fn) for name, fn in sorted(globals().items())
             if name.startswith("test_") and callable(fn)]
    failures: list[tuple[str, str]] = []
    print("=" * 88)
    print(f"tests/test_floors.py -- {len(tests)} round-5 cleanup guards")
    print("=" * 88)
    for name, fn in tests:
        try:
            fn()
        except AssertionError as exc:
            failures.append((name, str(exc)))
            print(f"  [FAIL] {name}\n         {exc}")
        except Exception as exc:  # pragma: no cover - unexpected error
            failures.append((name, f"{type(exc).__name__}: {exc}"))
            print(f"  [ERROR] {name}\n         {type(exc).__name__}: {exc}")
        else:
            print(f"  [PASS] {name}")
    print("-" * 88)
    print(f"  {len(tests) - len(failures)}/{len(tests)} passed")
    print("=" * 88)
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(_main())
