"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Reflection-based guard for the round-3 CLASS: every numeric constructor parameter on every element exported from aerosim.vehicle must be range-checked (declared in PARAM_BOUNDS and enforced) or explicitly ledgered. Walks the export list, pushes every declared parameter out of range (zero, negative, 2x max, +/-inf, nan) and asserts each raises; proves the walker itself goes red on an unchecked element; pins the measured round-2 exploits (FM=5.0 thruster, soc_max=3.0 / eta=2.0 battery, negative film mass, Betz-busting cp) and the FROZEN non_mechanical_source opt-in contract.
2 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4 regressions. AeroSurface grew a PARAM_BOUNDS table (extra_CD0, n_crit), so its two ledger entries are DELETED per the stale-entry rule and it joins the baseline/mutation walk. New pinned exploits, each measured by R4_probe_bypass / R4_probe_boundary before the fix: (a) DERIVED-MASS CONSISTENCY -- capacity_J x3 on a live pack (723 Wh/kg effective) and area_m2 x2 on a live PVArray both passed recheck on stale bills; now recheck raises. (b) TECHNOLOGY CATALOGUE -- 0.4999 cell efficiency at 0.15 kg/m2 and a 499.9 Wh/kg pack, each inside its scalar band, jointly uncatalogued; construction and recheck refuse both, while the catalogued frontier points (0.24@0.20 thin film, 445.5 Wh/kg pack) still construct. (c) BuoyancyVolume film floor -- zero film raises, derived film clears the 0.018 kg/m2 areal floor, and a live cell whose volume is inflated past its film is caught at recheck.
3 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 (cleanup): AeroSurface declared incidence_deg [-90, 90] and re_bins_per_decade [6, 24] int, so their DOCUMENTED_GAPS entries are deleted per the stale-entry rule -- both carried factually-wrong rationales the audit quoted ("not a physics knob": bins=1 moved the answer 0.8% and 0/-3 crashed raw; "angle command": nan incidence constructed and poisoned every coefficient). The joint-PV-pair probe drops packing 0.99 -> 0.9 so it keeps testing the FRONTIER, not the new 0.92 packing cap (which tests/test_floors.py owns).

WHAT THIS FILE GUARDS (the CLASS, not the instances)
----------------------------------------------------
Round 2's finding was not four bad parameters; it was a defect CLASS: "every
constructor parameter an optimizer can turn is either unbilled or unbounded."
A per-exploit regression test would guard the four instances and wave the fifth
through. This file instead:

 1. COVERAGE -- enumerates every element class exported from aerosim.vehicle
    and every numeric parameter in its constructor signature, and fails unless
    the parameter is declared in the class's PARAM_BOUNDS (or is a body-index,
    or sits in the DOCUMENTED_GAPS ledger below, which is visible debt and is
    printed on every run). A future element with an unchecked divisor fails
    this test the day it is written.
 2. MUTATION -- for every declared (class, parameter, Bounds) it constructs
    the element with the parameter pushed out of range in every direction and
    asserts construction raises. The declared range IS the enforced range.
 3. DEFENSE IN DEPTH -- an element built by bypassing __init__ (or mutated
    after construction) must still be caught by recheck_element_params, which
    is what the integrator calls at spec extraction.
 4. THE GUARD GUARDS ITSELF -- a deliberately unchecked rogue element is fed
    to the coverage walker and the test fails unless the walker flags it
    (mutation-testing the guard; see "substring guards aren't guards").

The tests are written for pytest (plain test_* functions and asserts) but the
project venv has no pytest today, so the file also runs standalone:

    .venv/Scripts/python.exe tests/test_param_bounds.py
"""
from __future__ import annotations

import inspect
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import aerosim.vehicle as vehicle_pkg
from aerosim.vehicle import (
    AeroSurface,
    BatteryElement,
    Bounds,
    BuoyancyVolume,
    INDEX_PARAMS,
    ParamBoundsError,
    PVArray,
    Thruster,
    WindTurbine,
    declared_bounds,
    naca4_geometry,
    recheck_element_params,
    require_in_range,
)

#: Shared planform for AeroSurface baselines (the case-A NACA 2412 geometry).
_BASE_GEOMETRY = naca4_geometry("2412", span_m=5.65, area_m2=1.72,
                                taper_ratio=0.7)

# --------------------------------------------------------------------------- #
# Known-good constructor kwargs for every shipped element that declares bounds. #
# Values are the validation-case numbers, so a bounds regression that rejects   #
# a KNOWN-FLOWN design also fails here.                                         #
# --------------------------------------------------------------------------- #

BASELINE_KWARGS: dict[str, dict] = {
    "Thruster": dict(diameter_m=0.36, max_electrical_power_W=120.0),
    "WindTurbine": dict(swept_area_m2=1.0, generator_rated_power_W=600.0),
    "BatteryElement": dict(capacity_J=703.0 * 3600.0,
                           specific_energy_Wh_per_kg=241.0),
    "PVArray": dict(area_m2=1.72, cell_efficiency_stc=0.237,
                    packing_factor=0.802, areal_density_kg_m2=0.4),
    "PayloadLoad": dict(power_W=5.8, mass_kg=0.150),
    "BuoyancyVolume": dict(volume_m3=4.003, gas="helium", film_mass_kg=0.5),
    "Tether": dict(body_a=0, body_b=1, rest_length_m=100.0, EA_N=1.0e4,
                   damping_Ns_per_m=2.0, diameter_m=0.002),
    # Round 4: AeroSurface joins the walk (extra_CD0 / n_crit declared).
    "AeroSurface": dict(geometry=_BASE_GEOMETRY, extra_CD0=0.006, n_crit=11.0),
}

# --------------------------------------------------------------------------- #
# DOCUMENTED GAPS -- visible debt, never a silent skip.                         #
#                                                                              #
# ROUND 5: incidence_deg and re_bins_per_decade are DECLARED in PARAM_BOUNDS   #
# now, so their entries are gone per the stale-entry rule -- and both of the   #
# rationales they carried were FACTUALLY WRONG, which is why the audit could   #
# quote the ledger against the code: "polar cache resolution, not a physics    #
# knob" (measured: bins=1 moved the certified answer 0.8%, and 0 / -3 crashed  #
# as a raw ZeroDivisionError) and "angle command; trim writes to it at         #
# runtime" (true, but no safety claim: incidence_deg=nan constructed and       #
# every coefficient lookup went silently nan). What remains is genuinely out   #
# of PARAM_BOUNDS' scope: two parameters range-checked in structure.py, whose  #
# checks re-run on every mass read -- a stronger guarantee than a              #
# construction-time table. The ledger stays LOUD: every run prints it, and a   #
# newly-declared or vanished parameter fails the stale-entry check below.      #
# --------------------------------------------------------------------------- #

DOCUMENTED_GAPS: dict[str, dict[str, str]] = {
    "AeroSurface": {
        # incidence_deg and re_bins_per_decade: DECLARED in PARAM_BOUNDS as of
        # round 5 (extra_CD0 and n_crit as of round 4) -- ledger entries
        # deleted per the stale-entry rule below.
        "design_load_factor": "range-checked [2, 10] in structure.py, not via "
                              "PARAM_BOUNDS",
        "mass_kg": "floor-checked by structure.check_explicit_wing_mass_kg, "
                   "not via PARAM_BOUNDS",
    },
}


def _element_classes() -> list[type]:
    """Every class exported from aerosim.vehicle that is a force element."""
    out: list[type] = []
    for name in sorted(set(vehicle_pkg.__all__)):
        obj = getattr(vehicle_pkg, name, None)
        if not isinstance(obj, type):
            continue
        if getattr(obj, "_is_protocol", False):
            continue  # ForceElement / PairForceElement protocol definitions
        if hasattr(obj, "evaluate") or hasattr(obj, "evaluate_pair"):
            out.append(obj)
    return out


def _numeric_params(cls: type) -> list[str]:
    """Numeric constructor parameters of an element class (physics knobs)."""
    names: list[str] = []
    for pname, param in inspect.signature(cls.__init__).parameters.items():
        if pname == "self" or pname in INDEX_PARAMS:
            continue
        ann = str(param.annotation)
        default = param.default
        is_bool = isinstance(default, bool) or "bool" in ann
        if is_bool:
            continue
        numeric_default = isinstance(default, (int, float)) and not isinstance(default, bool)
        numeric_ann = ("float" in ann) or (ann == "int")
        if numeric_default or numeric_ann or pname in declared_bounds(cls):
            names.append(pname)
    return names


def coverage_violations(classes: list[type]) -> list[str]:
    """
    @description The coverage walker: every numeric constructor parameter of
        every element class must be declared in PARAM_BOUNDS or sit in the
        DOCUMENTED_GAPS ledger. Returns the violations instead of asserting so
        the guard can be mutation-tested against a rogue class.
    @param classes Element classes to walk.
    @returns Human-readable violation strings, empty when covered.
    """
    problems: list[str] = []
    for cls in classes:
        table = declared_bounds(cls)
        ledger = DOCUMENTED_GAPS.get(cls.__name__, {})
        for pname in _numeric_params(cls):
            if pname in table:
                continue
            if pname in ledger:
                continue
            problems.append(
                f"{cls.__name__}.{pname} is a numeric constructor parameter "
                f"with NO declared bounds and no documented-gap entry -- "
                f"round-2 class violation (unbilled or unbounded)"
            )
    return problems


def _hostile_values(b: Bounds) -> list[float]:
    """Out-of-range probes for one declared bound: zero, negative/below,
    2x max (or just-above), the open endpoints, +/-inf and nan."""
    probes: list[float] = []
    if 0.0 < b.lo or (b.lo == 0.0 and b.lo_open):
        probes.append(0.0)
    probes.append(b.lo - abs(b.lo) - 1.0)  # strictly below lo, always negative when lo >= 0
    if math.isfinite(b.hi):
        probes.append(2.0 * b.hi if 2.0 * b.hi > b.hi else b.hi + 1.0)
    if b.lo_open:
        probes.append(b.lo)
    if b.hi_open and math.isfinite(b.hi):
        probes.append(b.hi)
    probes.extend([math.inf, -math.inf, math.nan])
    return probes


def _expect_raise(cls: type, kwargs: dict, tag: str, failures: list[str]) -> None:
    """Construct and record a failure if NO ValueError comes out."""
    import warnings
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            cls(**kwargs)
    except ValueError:
        return  # ParamBoundsError and MassClosureError are ValueErrors
    except Exception as exc:  # wrong error family is still fail-closed but noted
        failures.append(f"{tag}: raised {type(exc).__name__} instead of a ValueError")
        return
    failures.append(f"{tag}: CONSTRUCTED -- the bound is not enforced")


# --------------------------------------------------------------------------- #
# 1. Coverage: the class trap                                                   #
# --------------------------------------------------------------------------- #


def test_every_numeric_element_parameter_is_declared_or_ledgered() -> None:
    classes = _element_classes()
    assert len(classes) >= 8, (
        f"element walk found only {len(classes)} classes -- the reflection "
        f"is broken, which would make every other test here vacuous"
    )
    problems = coverage_violations(classes)
    assert not problems, "\n".join(problems)
    # The ledger is DEBT and must stay loud and current: an entry for a class
    # that no longer exists, or for a parameter that has since been declared,
    # is a stale exemption and must be deleted.
    for cls_name, entries in DOCUMENTED_GAPS.items():
        cls = getattr(vehicle_pkg, cls_name, None)
        assert isinstance(cls, type), f"DOCUMENTED_GAPS lists unknown class {cls_name}"
        sig_names = set(inspect.signature(cls.__init__).parameters)
        table = declared_bounds(cls)
        for pname in entries:
            assert pname in sig_names, (
                f"stale ledger entry {cls_name}.{pname}: no such constructor "
                f"parameter any more -- delete it"
            )
            assert pname not in table, (
                f"stale ledger entry {cls_name}.{pname}: now declared in "
                f"PARAM_BOUNDS -- delete the exemption"
            )
    print("    documented gaps (visible debt):")
    for cls_name, entries in DOCUMENTED_GAPS.items():
        for pname, why in entries.items():
            print(f"      {cls_name}.{pname}: {why}")


def test_the_coverage_walker_itself_goes_red_on_an_unchecked_element() -> None:
    """Mutation-test the guard: a rogue element with a bare unchecked divisor
    MUST be flagged, or the coverage test above proves nothing."""

    class RogueElement:  # deliberately violates the invariant
        def __init__(self, eta_free: float = 0.9) -> None:
            self.eta_free = float(eta_free)  # bare float(), divided by later

        def evaluate(self, *args): ...  # looks like a force element

    problems = coverage_violations([RogueElement])
    assert problems and "eta_free" in problems[0], (
        "the coverage walker did NOT flag a deliberately unchecked numeric "
        "parameter; the class guard is dead"
    )


# --------------------------------------------------------------------------- #
# 2. Mutation: every declared bound is actually enforced at construction        #
# --------------------------------------------------------------------------- #


def test_every_declared_bound_rejects_out_of_range_construction() -> None:
    failures: list[str] = []
    tested = 0
    for cls in _element_classes():
        table = declared_bounds(cls)
        if not table:
            continue
        base = BASELINE_KWARGS.get(cls.__name__)
        assert base is not None, (
            f"{cls.__name__} declares PARAM_BOUNDS but has no baseline kwargs "
            f"in this test -- add one so its bounds are mutation-tested"
        )
        sig_names = set(inspect.signature(cls.__init__).parameters)
        for pname, bound in table.items():
            if pname not in sig_names:
                continue  # attribute-only declaration (none today)
            for bad in _hostile_values(bound):
                kwargs = dict(base)
                kwargs[pname] = bad
                _expect_raise(cls, kwargs, f"{cls.__name__}({pname}={bad!r})", failures)
                tested += 1
    assert tested >= 150, f"only {tested} hostile constructions probed -- reflection broken"
    assert not failures, "\n".join(failures)
    print(f"    {tested} hostile constructions, all refused")


def test_baseline_elements_construct_and_pass_recheck() -> None:
    import warnings
    for cls in _element_classes():
        if not declared_bounds(cls):
            continue
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            el = cls(**BASELINE_KWARGS[cls.__name__])
        recheck_element_params(el)  # must NOT raise on a valid instance


# --------------------------------------------------------------------------- #
# 3. Defense in depth: bypassing __init__ is still caught                       #
# --------------------------------------------------------------------------- #


def test_recheck_catches_an_element_built_around_init() -> None:
    rogue = object.__new__(Thruster)  # never ran __init__, no checks ran
    rogue.figure_of_merit = 5.0
    rogue.eta_motor = 2.0
    rogue.eta_esc = 3.0
    try:
        recheck_element_params(rogue)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError(
            "a Thruster assembled via object.__new__ with FM=5.0 passed the "
            "spec-extraction recheck; defense in depth is dead"
        )


def test_recheck_catches_post_construction_tampering() -> None:
    pack = BatteryElement(**BASELINE_KWARGS["BatteryElement"])
    pack.eta_discharge = 2.0  # what __init__ validated, a mutation undoes
    try:
        recheck_element_params(pack)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError("mutated eta_discharge=2.0 passed recheck")

    pack2 = BatteryElement(**BASELINE_KWARGS["BatteryElement"])
    pack2.soc_min, pack2.soc_max = 0.6, 0.5  # each in range, ORDER violated
    try:
        recheck_element_params(pack2)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError("inverted SOC rails passed recheck (cross-check dead)")


# --------------------------------------------------------------------------- #
# 4. The measured round-2 exploits, pinned by name                              #
# --------------------------------------------------------------------------- #


def test_round2_exploit_thruster_free_drive_chain_raises() -> None:
    for kwargs in (dict(figure_of_merit=5.0, eta_motor=2.0, eta_esc=3.0),
                   dict(figure_of_merit=5.0),
                   dict(eta_motor=2.0),
                   dict(eta_esc=3.0),
                   dict(figure_of_merit=0.95),   # above any demonstrated rotor
                   dict(figure_of_merit=0.1)):   # below a functioning rotor
        try:
            Thruster(diameter_m=0.254, max_electrical_power_W=1.0e4,
                     n_rotors=4, **kwargs)
        except ParamBoundsError:
            continue
        raise AssertionError(f"Thruster({kwargs}) constructed -- the 30x free "
                             f"hover multiplier is back")


def test_round2_exploit_battery_soc_and_eta_raise() -> None:
    base = BASELINE_KWARGS["BatteryElement"]
    for kwargs in (dict(soc_max=3.0), dict(soc_max=100.0), dict(soc_min=-5.0),
                   dict(eta_charge=2.0, eta_discharge=2.0),
                   dict(eta_charge=10.0), dict(eta_discharge=10.0),
                   dict(soc_min=0.5, soc_max=0.5),   # empty usable band
                   dict(soc_min=0.9, soc_max=0.1)):  # inverted rails
        try:
            BatteryElement(**base, **kwargs)
        except ValueError:
            continue
        raise AssertionError(f"BatteryElement({kwargs}) constructed -- the "
                             f"940 Wh/kg-effective pack is back")


def test_round2_exploit_negative_film_mass_and_betz_cp_raise() -> None:
    from aerosim.vehicle import BuoyancyVolume
    try:
        BuoyancyVolume(volume_m3=44.907, film_mass_kg=-100.0)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError("film_mass_kg=-100 constructed: 981 N of free lift")
    try:
        WindTurbine(swept_area_m2=1.0, generator_rated_power_W=600.0, cp=0.60)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError("cp=0.60 (> Betz 16/27) constructed at __init__ time")
    # The exact Betz limit is legal (closed upper bound), and the checked
    # element still works.
    WindTurbine(swept_area_m2=1.0, generator_rated_power_W=600.0, cp=16.0 / 27.0)


def test_explicit_mass_cannot_undercut_best_demonstrated_hardware() -> None:
    try:
        Thruster(diameter_m=0.36, max_electrical_power_W=1000.0, mass_kg=0.01)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError("a 1 kW drive claiming 10 g constructed -- the "
                             "explicit-mass bypass is open")
    try:
        WindTurbine(swept_area_m2=2.0, generator_rated_power_W=5000.0, mass_kg=0.01)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError("a 5 kW turbine claiming 10 g constructed")
    # An honest explicit part mass at/above the floor still works.
    t = Thruster(diameter_m=0.36, max_electrical_power_W=1000.0, mass_kg=0.5)
    assert t.mass_kg == 0.5 and not t._mass_is_derived


# --------------------------------------------------------------------------- #
# 5. The FROZEN explicit exemption contract                                     #
# --------------------------------------------------------------------------- #


def test_non_mechanical_source_is_an_explicit_declared_opt_in() -> None:
    # The flag name is FROZEN: the integrator requires exactly this attribute.
    assert "non_mechanical_source" in vars(PVArray), (
        "PVArray must DECLARE non_mechanical_source in its own class body -- "
        "an inherited or instance-patched flag is not a declared opt-in"
    )
    assert PVArray.non_mechanical_source is True
    # No other shipped element quietly claims the exemption.
    for cls in _element_classes():
        if cls is PVArray:
            continue
        assert not getattr(cls, "non_mechanical_source", False), (
            f"{cls.__name__} claims the non-mechanical-source exemption; only "
            f"PVArray converts non-mechanical energy today"
        )
    # And the old attribute-name inference must be insufficient by design:
    # an imitator exposing packing_factor / cell_efficiency_stc but NOT the
    # declared flag is exactly what the integrator may no longer exempt.
    class Imitator:
        cell_efficiency_stc = 0.24
        packing_factor = 0.85
    assert not getattr(Imitator, "non_mechanical_source", False)


# --------------------------------------------------------------------------- #
# 6. ROUND 4 -- derived-mass consistency (the R4_probe_bypass vehicles)         #
# --------------------------------------------------------------------------- #


def test_recheck_catches_stale_battery_bill_capacity_mutated() -> None:
    """R4_probe_bypass attack 1, pinned: capacity_J x3 on a LIVE pack keeps
    every attribute inside its declared band but leaves the 2.917 kg bill
    stale -- 723 Wh/kg effective against the 500 fail-closed ceiling. The
    spec-extraction recheck must RE-DERIVE the mass and refuse."""
    pack = BatteryElement(**BASELINE_KWARGS["BatteryElement"])
    pack.capacity_J *= 3.0          # still inside (0, 3.6e10] -- in band
    try:
        recheck_element_params(pack)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError(
            "capacity_J x3 with a stale mass bill passed recheck -- the "
            "723 Wh/kg-effective bypass pack is back"
        )


def test_recheck_catches_stale_pv_bill_area_mutated() -> None:
    """R4_probe_bypass attack 2, pinned: area_m2 x2 on a LIVE PVArray with the
    stale mass bill (twice the panel at half the billed density) must be
    refused by the recheck's re-derivation."""
    arr = PVArray(**BASELINE_KWARGS["PVArray"])
    arr.area_m2 *= 2.0              # still inside [0, 1000] -- in band
    try:
        recheck_element_params(arr)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError(
            "area_m2 x2 with a stale mass bill passed recheck -- free panel "
            "is back"
        )


def test_recheck_catches_stale_thruster_bill_rating_mutated() -> None:
    """Same bypass shape on the drive: raising max_electrical_power_W on a
    live instance without re-billing must be refused."""
    th = Thruster(**BASELINE_KWARGS["Thruster"])
    th.max_electrical_power_W *= 10.0   # still inside [0, 1e6] -- in band
    try:
        recheck_element_params(th)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError(
            "max_electrical_power_W x10 with a stale mass bill passed recheck"
        )


# --------------------------------------------------------------------------- #
# 7. ROUND 4 -- the technology catalogue (the R4_probe_boundary pair)           #
# --------------------------------------------------------------------------- #


def test_joint_uncatalogued_pv_pair_raises_and_frontier_points_pass() -> None:
    """FATAL 2 pinned: 0.4999 (concentrator-record) efficiency at 0.15 kg/m2
    (thin-film) areal density -- each inside its scalar band, jointly a
    technology that has never existed -- must refuse at construction. The
    catalogued frontier pairs must still construct."""
    try:
        # packing 0.9 keeps this probe INSIDE the round-5 packing cap, so the
        # refusal below is the JOINT (efficiency, density) frontier and not a
        # packing_factor rejection standing in for it.
        PVArray(area_m2=1.72, cell_efficiency_stc=0.4999, packing_factor=0.9,
                areal_density_kg_m2=0.15)
    except ValueError:  # TechCatalogueError is a MassClosureError (ValueError)
        pass
    else:
        raise AssertionError(
            "the round-4 boundary-rider PV pair (0.4999 @ 0.15 kg/m2) "
            "constructed -- the joint frontier is dead"
        )
    # Catalogued technologies still construct: thin film at its own class
    # efficiency, and the AtlantikSolar module point.
    PVArray(area_m2=1.0, cell_efficiency_stc=0.14, packing_factor=0.9,
            areal_density_kg_m2=0.15)
    PVArray(area_m2=1.72, cell_efficiency_stc=0.237, packing_factor=0.802,
            areal_density_kg_m2=0.72)
    # And the live-instance path: drift a legal array's efficiency past its
    # density class after construction -- recheck must refuse.
    arr = PVArray(area_m2=1.0, cell_efficiency_stc=0.14, packing_factor=0.9,
                  areal_density_kg_m2=0.15)
    arr.cell_efficiency_stc = 0.45   # inside (0, 0.5] -- in band, uncatalogued
    try:
        recheck_element_params(arr)
    except ValueError:  # TechCatalogueError is a MassClosureError (ValueError)
        pass
    else:
        raise AssertionError("post-construction 0.45 @ 0.15 kg/m2 passed recheck")


def test_pack_beyond_catalogue_frontier_raises_and_frontier_passes() -> None:
    """FATAL 2's pack half pinned: 499.9 Wh/kg sits inside the 500 scalar
    backstop but beyond the best catalogued cell x best packaging (445.5);
    construction must refuse. The frontier itself (case B's pack) must pass."""
    try:
        BatteryElement(capacity_J=1.0e6, specific_energy_Wh_per_kg=499.9)
    except ValueError:  # TechCatalogueError is a MassClosureError (ValueError)
        pass
    else:
        raise AssertionError(
            "a 499.9 Wh/kg pack constructed -- the boundary ride inside the "
            "500 scalar ceiling is back"
        )
    BatteryElement(capacity_J=1.0e6, specific_energy_Wh_per_kg=445.5)


# --------------------------------------------------------------------------- #
# 8. ROUND 4 -- the balloon film floor                                          #
# --------------------------------------------------------------------------- #


def test_zero_film_raises_and_derived_film_clears_the_floor() -> None:
    from aerosim.vehicle import MIN_BALLOON_FILM_AREAL_DENSITY_KG_M2
    try:
        BuoyancyVolume(volume_m3=44.907, film_mass_kg=0.0)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError("a zero-mass envelope constructed: skinless lift")
    cell = BuoyancyVolume(volume_m3=44.907)          # derived film
    assert cell.film_mass_kg >= (MIN_BALLOON_FILM_AREAL_DENSITY_KG_M2
                                 * cell.surface_area_m2)
    # Live-instance drift: inflate the volume so the once-legal film is now
    # thinner than any flown envelope -- recheck must refuse.
    small = BuoyancyVolume(volume_m3=4.003, film_mass_kg=0.5)
    small.volume_m3 = 1000.0          # in band; film now ~0.001 kg/m2
    try:
        recheck_element_params(small)
    except ParamBoundsError:
        pass
    else:
        raise AssertionError("volume x250 with a stale film passed recheck")


# --------------------------------------------------------------------------- #
# 9. ROUND 4 -- the last unbounded AeroSurface knobs                            #
# --------------------------------------------------------------------------- #


def test_aerosurface_drag_free_and_quiet_air_knobs_raise() -> None:
    import warnings
    for kwargs in (dict(extra_CD0=0.0),      # the boundary rider's fuselage
                   dict(extra_CD0=-0.01),    # a drag DISCOUNT
                   dict(extra_CD0=0.1),      # units error
                   dict(extra_CD0=0.006, n_crit=20.0),   # air that does not exist
                   dict(extra_CD0=0.006, n_crit=1.0),
                   dict(extra_CD0=float("nan"))):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                AeroSurface(_BASE_GEOMETRY, **kwargs)
        except ValueError:
            continue
        raise AssertionError(f"AeroSurface({kwargs}) constructed")
    # The shipped case values still construct.
    AeroSurface(_BASE_GEOMETRY, extra_CD0=0.006, n_crit=11.0)


# --------------------------------------------------------------------------- #
# 10. The helper itself                                                         #
# --------------------------------------------------------------------------- #


def test_require_in_range_is_fail_closed() -> None:
    assert require_in_range("x", 0.5, 0.0, 1.0, lo_open=True) == 0.5
    for bad in (0.0, -1.0, 1.5, math.inf, -math.inf, math.nan, "0.5", None, True):
        try:
            require_in_range("x", bad, 0.0, 1.0, lo_open=True)
        except ParamBoundsError:
            continue
        raise AssertionError(f"require_in_range accepted {bad!r}")
    # Closed endpoints are legal values.
    assert require_in_range("x", 1.0, 0.0, 1.0) == 1.0
    assert require_in_range("x", 0.0, 0.0, 1.0) == 0.0


# --------------------------------------------------------------------------- #
# Standalone runner (the venv has no pytest today)                              #
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
    print(f"tests/test_param_bounds.py -- {len(tests)} guards for the round-3 class")
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
