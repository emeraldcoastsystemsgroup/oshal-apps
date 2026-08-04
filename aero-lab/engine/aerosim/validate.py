"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation: validation
  |                                           | cases A-D as a CI gate.
2 | maintainer@emeraldcoastsystemsgroup.com   | REWRITE. (a) Deleted every private
  |                                           | self-billing stand-in -- _TrimmedCruiseLoad,
  |                                           | _TurbineStationKeeping, _HoverLoad,
  |                                           | _IdealLiftSupport, _ConstantElectricalLoad,
  |                                           | _TurbineElement -- and rebuilt all four
  |                                           | vehicles from PUBLIC aerosim.vehicle
  |                                           | elements, enforced by
  |                                           | _assert_shipped_elements. (b) margin_ratio
  |                                           | is now USABLE energy, not gross: case A
  |                                           | spilled 59.8% of its reported harvest.
  |                                           | (c) Replaced the vacuous "level-flight
  |                                           | power cross-check" (an algebraic identity,
  |                                           | worst residual 9.27e-16 against a 2.0e-2
  |                                           | threshold) with closed-form bounds and a
  |                                           | published-performance anchor in
  |                                           | validate_bounds. (d) Bands are now
  |                                           | mutation-tested by validate_sensitivity.
  |                                           | (e) Added case E, the magic generator.
3 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 3. (a) Case A's mass budget
  |                                           | re-tuned around the now-billed wing:
  |                                           | the 2.543 kg structure plug is wing
  |                                           | 2.293 kg (Stender/AS-2 model) + 0.250 kg
  |                                           | pod/boom/tail; total still 6.93 kg and
  |                                           | every vehicle passes
  |                                           | assert_mass_declared() -- the warning
  |                                           | suppressions are gone. (b) Case B
  |                                           | RELABELLED a solution-existence demo
  |                                           | (NOT closure evidence): the honest wing
  |                                           | kills the old fitted 48 kg pack (report
  |                                           | in the case docstring); min_soc floor
  |                                           | raised 0.05 -> 0.10, strictly above
  |                                           | soc_min, so it can actually fail.
  |                                           | (c) screen_design(): the exported
  |                                           | per-design admissibility contract a
  |                                           | 30,000-design sweep calls -- carved to
  |                                           | validate_screen.py at the 800-code-line
  |                                           | threshold, re-exported here. (d) Family-5
  |                                           | USSA-1976 density anchor check wired
  |                                           | into both solar cases; with the five
  |                                           | new CLOSURE_MUTATIONS (pack x2, soc_max
  |                                           | 3.0, eta_charge 2.0, FM 5.0, rho x2)
  |                                           | every constructor guard is proven to
  |                                           | bite through the REAL builder path.

4 | maintainer@emeraldcoastsystemsgroup.com   | Case E's "< 1.0 s to reject" check
  |                                           | replaced by a MECHANISM assertion
  |                                           | (FreeEnergyError.t_s == 0.0: the guard
  |                                           | fired at the first evaluation). The
  |                                           | wall-clock form failed at 2669 ms under
  |                                           | CPU contention with all physics green;
  |                                           | wall time is still reported, never
  |                                           | gated. (Minimal cross-file edit by the
  |                                           | integrate.py owner, round 4.)

5 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4 (bounds/screen owner): Family-6
  |                                           | wing-mass anchor wired into
  |                                           | _solar_cruise_gate -- the billed wing
  |                                           | must match the HAND-TYPED expected mass
  |                                           | in validate_bounds (2.2926 kg +/-1% for
  |                                           | the AS-2 planform; skipped VISIBLY for
  |                                           | untabulated planforms). Closes lens
  |                                           | probe M3: WING_MASS_COEFF_KG x0.5
  |                                           | (wing billed 1.146 kg) left every gate
  |                                           | check green because all downstream
  |                                           | numbers moved WITH the corruption.

6 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4 integration (regression-gate
  |                                           | reconcile): case C's mutation acceptance
  |                                           | now uses MutationOutcome.raised -- the
  |                                           | new tech-catalogue frontier refuses the
  |                                           | pv x2.0 mutant (0.474 cell at 0.3995
  |                                           | kg/m2) AT CONSTRUCTION, which the old
  |                                           | `all(not caught)` conflated with the
  |                                           | forbidden outcome (mutant closing). A
  |                                           | named refusal is a stronger negative
  |                                           | result, not a failure. No band loosened;
  |                                           | _mutation_report also records `raised`.

7 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 (cleanup): the gate report
  |                                           | now carries the screen's round-5
  |                                           | additions -- seasonal_robustness
  |                                           | (closes_equinox at doy 80, same site;
  |                                           | 'flag: solstice-only' is a FLAG, not
  |                                           | a rejection) and tree_fingerprint
  |                                           | (the sweep-integrity stamp) -- copied
  |                                           | into detail explicitly because
  |                                           | screen_design stamps build.meta after
  |                                           | detail.update(build.meta) has run.
  |                                           | No band moved; case A's verdict
  |                                           | numbers are bit-identical.
8 | maintainer@emeraldcoastsystemsgroup.com   | FINAL GATE: usable_energy's spill input
  |                                           | is now BUS-side (integrate.py change
  |                                           | log #6 -- the old stored-equivalent
  |                                           | meter credited 1-eta_charge of every
  |                                           | spilled joule as usable, which the R7
  |                                           | convergence search farmed at 85.8%
  |                                           | spill for a fictitious 1.5477).  The
  |                                           | subtraction here is unchanged; the
  |                                           | measured margins move DOWN: case A
  |                                           | usable 1.1201 -> 1.0446, case B
  |                                           | 1.0909 -> 1.0548; C/D spill nothing,
  |                                           | bit-identical.  Docstring numbers
  |                                           | refreshed to the fixed meter.

aerosim.validate -- the module that decides whether the simulator is trustworthy.

``python -m aerosim.validate`` runs five cases end to end and exits 1 if any fails.

  A  AtlantikSolar (ETH Zurich)     expect closure TRUE   (81.5 h real flight)
  B  Zephyr-class HAPS              expect closure TRUE   (20 km; SOLUTION-
                                                          EXISTENCE DEMO ONLY,
                                                          NOT closure evidence)
  C  1 kg solar quadcopter, hover   expect closure FALSE  (negative control)
  D  turbine on a free-flier in a
     UNIFORM wind field             expect closure FALSE  (negative control)
  E  MAGIC GENERATOR                expect closure FALSE  (adversarial control)

Cases C, D and E are negative controls. A simulator that closes one is lying, and
the gate treats a "closure" on any of them as a failure of the whole suite.

=============================================================================
THE RULE THIS REWRITE EXISTS TO ENFORCE
=============================================================================
Every case builds its vehicle from the PUBLIC SHIPPED elements -- the exact
objects a 30,000-design sweep instantiates. Nothing else is admissible.

The previous suite did not. It carried private helper classes that charged
themselves for their own drag (``_TrimmedCruiseLoad.evaluate`` returned
``power_elec_W = -D*V/eta``), while the SHIPPED ``vehicle.AeroSurface`` returns
``power_elec_W = 0.0`` and bills nothing. So validation exercised code the
product does not contain, and passed while the product was broken.

Two elements genuinely did not exist and were therefore MISSING FEATURES, not a
licence to write stand-ins: ``vehicle.PayloadLoad`` (a constant electrical draw)
and ``vehicle.WindTurbine`` (an actuator-disk extractor with its momentum-theory
reaction). Both are now shipped, exported and mass-declared.

ONE private class remains, ``_MagicGenerator``, and it is justified in its own
docstring: it is case E's ADVERSARY, not part of any vehicle under test. It
exists to be rejected. ``_assert_shipped_elements`` still runs on case E, with
that single class named in an explicit allowance that appears in the report.

=============================================================================
WHAT margin_ratio MEANS NOW, AND WHY IT CHANGED
=============================================================================
It is USABLE electrical energy over consumed electrical energy:

    margin_ratio = (energy_in_J - unabsorbed_surplus_J) / energy_out_J

The old definition summed PV output unconditionally, with no reference to
whether the battery could hold it. Measured from the integrator's own limit-cycle
accounting: case A spills 1221.8 Wh of a 2671.4 Wh harvest (45.7%), and case B
spills 18640 Wh of 49314 Wh (37.8%). Ranking 30,000 designs on the gross number
rewards panel area that never becomes survivability -- the optimizer would buy
harvest it cannot store. ``margin_ratio_gross`` is still reported, clearly
labelled, and never gated on.

=============================================================================
UNITS -- every quantity in this module carries SI units in its name or comment.
  *_m metres, *_m2 square metres, *_s seconds, *_h hours, *_K kelvin,
  *_N newtons, *_W watts, *_J joules, *_Wh watt-hours, *_kg kilograms,
  *_Wm2 watts per square metre, *_ms metres per second, *_deg degrees.
  Dimensionless: CL, CD, cl15_over_cd, soc, margin_ratio, Re, all eta_* and
  all *_scale factors.
=============================================================================
"""

from __future__ import annotations

import argparse
import ast
import inspect
import json
import math
import os
import sys
import textwrap
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

import numpy as np

from . import powerplant
from . import validate_bounds as bounds
from .env import atmosphere, solar
from .integrate import (
    EnvBundle,
    FreeEnergyError,
    SimResult,
    assert_no_free_energy,
    integrate_energy,
)
from .validate_sensitivity import (
    CLOSURE_MUTATIONS,
    REPORTED_SENSITIVITIES,
    Mutation,
    run_mutations,
)
from .vehicle import BatteryElement, BodyState, Thruster, Vehicle, WindTurbine
from .validate_screen import (
    SCREEN_ASPECT_RATIO,
    SCREEN_K_EFF_MAX,
    SCREEN_WING_LOADING_N_M2,
    SOC_FLOOR_STANDOFF,
    screen_design,
)
from . import vehicle as vehicle_pkg
from .validate_designs import (
    DAY_S,
    DESIGN_A,
    DESIGN_B,
    ETA_CHAIN_CRUISE,
    FREE_ENERGY_TRAJECTORIES,
    G0_MS2,
    J_PER_WH,
    SLOW_DT_S,
    ValidationError,
    _Build,
    _sanitize,
    _SolarCruiseDesign,
    build_magic_generator,
    build_quadcopter_hover,
    build_solar_cruise,
    build_turbine_free_flier,
)


# --------------------------------------------------------------------------- #
# Result types                                                                 #
# --------------------------------------------------------------------------- #


@dataclass
class CaseResult:
    """Verdict for one validation case.

    @description Carries the pass/fail decision AND the numbers that produced it,
        so a red CI run is diagnosable from the report alone.
    @param name Human-readable case name.
    @param expect_closure True when the real vehicle is known to close a 24 h
        energy loop; False for the three negative controls.
    @param closed Whether the design settles into a sustainable periodic state
        (from ``integrate_energy``'s limit-cycle test).
    @param passed True only when ``closed == expect_closure`` AND every check in
        the case's acceptance list holds.
    @param min_soc Lowest state of charge on the limit cycle, dimensionless 0..1.
    @param margin_ratio USABLE electrical energy produced / electrical energy
        consumed, dimensionless. Surplus the battery could not absorb is
        EXCLUDED. See the module docstring.
    @param cl15_over_cd Solver-derived CL^1.5/CD at the trimmed cruise point,
        dimensionless; None for cases with no wing.
    @param mean_cruise_Re Reynolds number at the trimmed cruise point,
        dimensionless; None for cases with no wing.
    @param detail Everything else: design point, mass budget, environment,
        energies, bounds, mutation outcomes and any traceback.
    """

    name: str
    expect_closure: bool
    closed: bool
    passed: bool
    min_soc: float
    margin_ratio: float
    cl15_over_cd: float | None
    mean_cruise_Re: float | None
    detail: dict = field(default_factory=dict)


@dataclass
class _Check:
    """One acceptance criterion and the number that decided it.

    @param label What is being asserted.
    @param ok Whether it holds.
    @param actual The measured value, rendered.
    """

    label: str
    ok: bool
    actual: str


# --------------------------------------------------------------------------- #
# Small helpers                                                                #
# --------------------------------------------------------------------------- #


def _trapz(y: np.ndarray, x: np.ndarray) -> float:
    """Trapezoidal integral, numpy-2 safe.

    @param y Integrand samples (any unit).
    @param x Abscissa samples (same length as y).
    @returns Integral of y dx, in unit(y)*unit(x).
    """
    fn = getattr(np, "trapezoid", None) or np.trapz  # noqa: NPY201 - deliberate fallback
    return float(fn(np.asarray(y, dtype=float), np.asarray(x, dtype=float)))


def _fmt(value: Any, spec: str = ".4g") -> str:
    """@returns A short rendering of a possibly-None, possibly-non-finite number."""
    if value is None:
        return "-"
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return str(value)
    try:
        return format(value, spec)
    except Exception:
        return str(value)


# --------------------------------------------------------------------------- #
# DEFECT 1 -- margin must be USABLE energy                                      #
# --------------------------------------------------------------------------- #


def usable_energy(result: SimResult) -> dict:
    """Split the window's electrical energy into what was usable and what spilled.

    @description ``integrate_energy`` reports, on the LIMIT CYCLE it solved for,
        how much BUS-side generation the pack could not absorb
        (``unabsorbed_surplus_J``, same units as ``energy_in_J`` since the
        final-gate fix -- integrate.py change log #6) and how much bus demand it
        could not serve (``unabsorbed_shortfall_J``). The usable margin is the
        only one a sweep may rank on:

            usable = (energy_in_J - unabsorbed_surplus_J) / energy_out_J

        Measured on case A with the bus-side meter: gross 2.5553, usable 1.0446
        -- 59.1 % of the harvest is spilled. The original ledger summed PV
        output with no reference to battery state at all (margin 2.55), and the
        round-2..5 ledger under-counted spill by the eta_charge factor (margin
        1.1201): panel area must never look like survivability.
    @param result A SimResult from integrate_energy or integrate_dynamic.
    @returns dict of energies in J and Wh plus gross and usable margin ratios.
    @raises ValidationError When the integrator did not report the accounting
        this function depends on -- silently substituting the gross number is
        exactly the defect being fixed.
    """
    d = result.detail
    for key in ("energy_in_J", "energy_out_J", "unabsorbed_surplus_J",
                "unabsorbed_shortfall_J"):
        if key not in d:
            raise ValidationError(
                f"integrator detail is missing {key!r}; usable margin cannot be "
                f"computed and the GROSS margin must never be substituted for it"
            )
    e_in_J = float(d["energy_in_J"])
    e_out_J = float(d["energy_out_J"])
    spill_J = float(d["unabsorbed_surplus_J"])
    short_J = float(d["unabsorbed_shortfall_J"])
    usable_in_J = e_in_J - spill_J
    return {
        "energy_in_gross_J": e_in_J,
        "energy_in_usable_J": usable_in_J,
        "energy_out_J": e_out_J,
        "unabsorbed_surplus_J": spill_J,
        "unabsorbed_shortfall_J": short_J,
        "energy_in_gross_Wh": e_in_J / J_PER_WH,
        "energy_in_usable_Wh": usable_in_J / J_PER_WH,
        "energy_out_Wh": e_out_J / J_PER_WH,
        "spilled_Wh": spill_J / J_PER_WH,
        "unserved_Wh": short_J / J_PER_WH,
        "spilled_fraction_of_gross": (spill_J / e_in_J) if e_in_J > 0.0 else 0.0,
        "margin_ratio_gross": (e_in_J / e_out_J) if e_out_J > 0.0 else float("inf"),
        "margin_ratio_usable": (usable_in_J / e_out_J) if e_out_J > 0.0 else float("inf"),
    }


def per_element_Wh(vehicle: Vehicle, env: EnvBundle, result: SimResult) -> dict:
    """Per-element electrical energy over the window -- DIAGNOSTIC ONLY.

    @description Walks the recorded trajectory and integrates each element's own
        ``power_elec_W``. This is a breakdown for reading a red run, never a
        margin: a PV array's number here is GROSS output, including energy no
        battery could hold. It is deliberately not used by any acceptance check.
    @param vehicle The vehicle whose elements are evaluated.
    @param env The environment bundle.
    @param result The integrator result supplying the trajectory grid.
    @returns {element_label: energy_Wh}, signed (positive generates).
    """
    t_s = np.asarray(result.t_s, dtype=float)
    pos = np.asarray(result.detail.get("pos_all_m"), dtype=float)
    vel = np.asarray(result.detail.get("vel_all_ms"), dtype=float)
    if pos.ndim != 3 or pos.shape[0] != t_s.size:
        return {}
    bodies = [
        BodyState(pos_m=pos[0, i].copy(), vel_ms=vel[0, i].copy(),
                  mass_kg=float(b.structure_mass_kg))
        for i, b in enumerate(vehicle.bodies)
    ]
    n_el = len(vehicle.elements)
    p_W = np.zeros((t_s.size, n_el))
    for k in range(t_s.size):
        for i, b in enumerate(bodies):
            b.pos_m, b.vel_ms = pos[k, i], vel[k, i]
        z_m = float(np.clip(pos[k, 0, 2], 0.0, 47000.0))
        atmo = atmosphere(z_m)
        wind = env.wind.sample(float(pos[k, 0, 0]), float(pos[k, 0, 1]), z_m, float(t_s[k]))
        sol = solar(env.latitude_deg, env.longitude_deg, env.day_of_year,
                    env.utc_hour_h(float(t_s[k])), z_m, 0.0, 180.0)
        for j, el in enumerate(vehicle.elements):
            p_W[k, j] = float(el.evaluate(bodies, atmo, wind, sol,
                                          float(t_s[k]), SLOW_DT_S).power_elec_W)
    return {
        f"{type(el).__name__}[{j}]": _trapz(p_W[:, j], t_s) / J_PER_WH
        for j, el in enumerate(vehicle.elements)
    }


def harvest_check(build: _Build, energy: dict, catalogue: dict,
                  band: tuple[float, float]) -> tuple[_Check, dict]:
    """Bound the modelled solar harvest against pure astronomy.

    @description DEFECT 3's answer for the harvest half of the budget. The
        closure verdict CANNOT see a factor-of-two error in cell efficiency on a
        design with large spill -- measured on case A, halving it moved the
        usable margin only 1.1201 -> 1.0598 and the aircraft still (correctly)
        closed, because the harvest it lost was harvest it was throwing away
        anyway. That is a true statement about the aircraft and a fatal blind
        spot in a gate.

        So the harvest is bounded on its own terms, as an effective daily
        clearness index against the CLOSED-FORM extraterrestrial insolation. The
        denominator uses the design's CATALOGUE cell efficiency -- the datasheet
        number, held fixed under mutation -- so mutating what the model actually
        uses moves K_eff linearly and is caught immediately. Normalising by the
        element's OWN (mutated) efficiency instead would be circular and would
        measure exactly nothing.
    @param build The assembled case.
    @param energy usable_energy() output, for the gross harvest.
    @param catalogue Datasheet PV numbers: area_m2, packing, efficiency, mppt.
    @param band Acceptable [lo, hi] on K_eff, dimensionless, with the physical
        justification recorded by the calling case.
    @returns (the check, a detail dict).
    """
    k_eff = bounds.effective_clearness_index(
        harvest_gross_J=energy["energy_in_gross_J"],
        gross_area_m2=catalogue["area_m2"], packing_factor=catalogue["packing"],
        cell_efficiency_stc=catalogue["efficiency"],
        mppt_efficiency=catalogue["mppt"],
        latitude_deg=build.env.latitude_deg, day_of_year=build.env.day_of_year,
    )
    h0_MJ_m2 = bounds.daily_extraterrestrial_insolation_J_m2(
        build.env.latitude_deg, build.env.day_of_year) / 1.0e6
    lo, hi = band
    check = _Check(
        f"effective daily clearness index in [{lo}, {hi}]", lo <= k_eff <= hi,
        f"K_eff = {k_eff:.4f} from {energy['energy_in_gross_Wh']:.0f} Wh gross "
        f"against {h0_MJ_m2:.2f} MJ/m2 extraterrestrial on "
        f"{catalogue['area_m2'] * catalogue['packing']:.3f} m2 of "
        f"{catalogue['efficiency']:.3f}-efficiency cells",
    )
    return check, {"effective_clearness_index": k_eff, "band": [lo, hi],
                   "extraterrestrial_daily_MJ_m2": h0_MJ_m2,
                   "catalogue": catalogue,
                   "source": "Duffie & Beckman eq. 1.10.3 -- pure orbital "
                             "geometry, no atmosphere and no solar module"}


# --------------------------------------------------------------------------- #
# THE ROOT-CAUSE GUARD -- every element must be one the product ships           #
# --------------------------------------------------------------------------- #

#: Classes exported from aerosim.vehicle. Built once, from the package's own
#: __all__, so adding an element to the package is enough -- there is no second
#: list here to forget to update.
_SHIPPED_ELEMENT_NAMES: frozenset[str] = frozenset(
    name for name in getattr(vehicle_pkg, "__all__", ())
    if isinstance(getattr(vehicle_pkg, name, None), type)
)


def assert_shipped_elements(vehicle: Vehicle, allow: Sequence[str] = ()) -> dict:
    """Prove a case's vehicle is built only from PUBLIC shipped elements.

    @description THE guard for the defect this rewrite exists to close. The
        previous suite validated private stand-ins that charged themselves for
        their own drag while the shipped AeroSurface billed nothing, so the gate
        was green and the product was broken.

        An element passes when its class is exported from ``aerosim.vehicle``
        AND is defined inside that package. A locally-defined class with a
        colliding name therefore does not sneak through.
    @param vehicle The assembled vehicle.
    @param allow Class names explicitly permitted despite not being shipped. Any
        use of this must be justified in the calling case and appears in the
        report; it is never silent.
    @returns dict describing every element and the allowance actually used.
    @raises ValidationError On any unshipped element that was not allowed.
    """
    allowed = set(allow)
    rows: list[dict] = []
    offenders: list[str] = []
    used_allowance: list[str] = []
    for el in vehicle.elements:
        cls = type(el)
        shipped = (
            cls.__name__ in _SHIPPED_ELEMENT_NAMES
            and getattr(cls, "__module__", "").startswith("aerosim.vehicle")
            and getattr(vehicle_pkg, cls.__name__, None) is cls
        )
        rows.append({"class": cls.__name__, "module": cls.__module__, "shipped": shipped})
        if shipped:
            continue
        if cls.__name__ in allowed:
            used_allowance.append(cls.__name__)
        else:
            offenders.append(f"{cls.__module__}.{cls.__name__}")
    if offenders:
        raise ValidationError(
            f"vehicle contains element(s) the product does not ship: {offenders}. "
            f"A validation case must be built from the objects a 30,000-design "
            f"sweep instantiates. If a shipped element cannot express the case, "
            f"that is a MISSING FEATURE in the element -- add it to "
            f"aerosim.vehicle and export it."
        )
    return {
        "elements": rows,
        "all_shipped": not used_allowance,
        "allowance_granted": sorted(allowed),
        "allowance_used": sorted(set(used_allowance)),
        "shipped_catalogue": sorted(_SHIPPED_ELEMENT_NAMES),
    }


# --------------------------------------------------------------------------- #
# THE SWEEP CONTRACT (screen_design) lives in validate_screen.py -- carved out  #
# at the 800-code-line threshold -- and is re-exported from this module's       #
# import block, so `from aerosim.validate import screen_design` is the stable   #
# public surface a sweep should use.                                            #
# --------------------------------------------------------------------------- #
# Provenance guard: prove the lift number came from the solver                  #
# --------------------------------------------------------------------------- #

_LIFT_NAME_TOKENS = (
    "cl15", "cl_15", "clcd", "cl_cd", "cl_over", "endurance",
    "lift_to_drag", "l_over_d", "lod", "cl_1_5",
)
_SOLVER_TOKENS = (
    "wing_polar", "best_endurance_point", "best_endurance_alpha_deg",
    "reference_trim", "trim_alpha_for_lift_N", "AeroSurface",
)


def assert_lift_is_solver_derived(fn: Callable) -> dict:
    """Static proof that a builder contains no hand-entered lift constant.

    @description Walks the function's AST and (a) requires that it reaches the
        aero solver, and (b) forbids binding a numeric CONSTANT to any name
        meaning a lift or endurance figure of merit -- assignment targets,
        annotated assignments and keyword arguments alike. This is the
        machine-checkable form of "lift is never a hand-entered assumption".
    @param fn The builder function to inspect.
    @returns dict with reaches_solver, calls and hardcoded.
    @raises ValidationError When a hardcoded lift constant is found or the
        function never reaches the solver.
    """
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    fndef = tree.body[0]

    calls: set[str] = set()
    for node in ast.walk(fndef):
        if isinstance(node, ast.Call):
            try:
                calls.add(ast.unparse(node.func))
            except Exception:  # pragma: no cover - unparse is total on 3.11
                pass
    reaches = any(any(tok in c for tok in _SOLVER_TOKENS) for c in calls)

    hardcoded: list[str] = []
    for node in ast.walk(fndef):
        pairs: list[tuple[str, ast.AST]] = []
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if isinstance(tgt, ast.Name):
                    pairs.append((tgt.id, node.value))
                elif isinstance(tgt, ast.Attribute):
                    pairs.append((tgt.attr, node.value))
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            if isinstance(node.target, ast.Name):
                pairs.append((node.target.id, node.value))
        elif isinstance(node, ast.keyword) and node.arg:
            pairs.append((node.arg, node.value))
        for name, val in pairs:
            if not any(tok in name.lower() for tok in _LIFT_NAME_TOKENS):
                continue
            const = val
            if isinstance(const, ast.UnaryOp) and isinstance(const.operand, ast.Constant):
                const = const.operand
            if isinstance(const, ast.Constant) and isinstance(const.value, (int, float)):
                hardcoded.append(f"{name} = {const.value}")

    if hardcoded:
        raise ValidationError(
            f"{fn.__name__}: lift figure of merit is hand-entered: {hardcoded}. "
            f"Geometry must produce lift via the solver."
        )
    if not reaches:
        raise ValidationError(
            f"{fn.__name__}: never reaches the aero solver (calls seen: {sorted(calls)})"
        )
    return {"reaches_solver": reaches, "calls": sorted(calls), "hardcoded": hardcoded}


# --------------------------------------------------------------------------- #
# Shared evaluation                                                            #
# --------------------------------------------------------------------------- #


def _run_window(build: _Build, duration_s: float = DAY_S) -> tuple[SimResult, float]:
    """Integrate one 24 h window.

    @param build The assembled case.
    @param duration_s Window length, s.
    @returns (SimResult, wall-clock seconds).
    """
    t0 = time.perf_counter()
    result = integrate_energy(build.vehicle, build.env, 0.0, duration_s, SLOW_DT_S)
    return result, time.perf_counter() - t0


def _bound_checks(build: _Build, result: SimResult, anchor_cl15: float | None,
                  anchor_tolerance: float) -> tuple[list[_Check], dict]:
    """Apply the closed-form bounds and the trim cross-check to a winged case.

    @description DEFECT 2's replacement. Three families, none of which is a
        rearrangement of the equation being checked:
          * the drag floor and endurance ceiling from validate_bounds (Prandtl +
            Blasius), which move only if the solver's polar is wrong;
          * a published-performance anchor, which aeropolar has never seen;
          * agreement between the closed-form reference trim and the
            integrator's own bisected element trim -- two algorithms, two code
            paths.
    @param build The assembled case (carries the reference trim).
    @param result The integrator result.
    @param anchor_cl15 CL^1.5/CD implied by published flight data, dimensionless,
        or None when no published anchor exists for this design.
    @param anchor_tolerance Fractional band around the anchor, dimensionless.
    @returns (checks, detail dict).
    """
    ref = build.reference
    report = bounds.bound_polar_point(
        CL=ref.CL, CD=ref.CD, cl15_over_cd=ref.cl15_over_cd,
        span_m=build.meta["design"]["span_m"], area_m2=build.meta["design"]["area_m2"],
        reynolds_chord=ref.Re, extra_CD0=build.meta["extra_CD0_effective"],
    )
    v_int_ms = float(result.detail.get("trim_V_ms", float("nan")))
    v_rel_err = abs(v_int_ms - ref.V_ms) / max(ref.V_ms, 1e-9)
    re_rel_err = (abs(float(result.mean_cruise_Re) - ref.Re) / max(ref.Re, 1e-9)
                  if np.isfinite(result.mean_cruise_Re) else float("inf"))

    checks = [
        _Check("polar respects the closed-form drag floor", report.ok,
               f"CD {report.CD:.5f} vs floor {report.CD_total_floor:.5f} "
               f"(margin {report.drag_margin:.3f}); "
               f"CL^1.5/CD {report.cl15_over_cd:.3f} vs ceiling "
               f"{report.cl15_over_cd_ceiling:.3f}"
               + ("" if report.ok else f" -- {report.violations}")),
        _Check("reference trim and integrator trim agree within 2 %",
               v_rel_err <= 0.02,
               f"V_ref {ref.V_ms:.4f} m/s vs V_int {v_int_ms:.4f} m/s "
               f"({v_rel_err:.3%})"),
        _Check("reference Reynolds and integrator Reynolds agree within 3 %",
               re_rel_err <= 0.03,
               f"Re_ref {ref.Re:.0f} vs Re_int {result.mean_cruise_Re:.0f} "
               f"({re_rel_err:.3%})"),
    ]
    detail: dict = {"closed_form_bounds": _sanitize(report),
                    "trim_cross_check": {"V_reference_ms": ref.V_ms,
                                         "V_integrator_ms": v_int_ms,
                                         "V_relative_error": v_rel_err,
                                         "Re_reference": ref.Re,
                                         "Re_integrator": float(result.mean_cruise_Re),
                                         "Re_relative_error": re_rel_err}}
    if anchor_cl15 is not None:
        lo, hi = anchor_cl15 * (1.0 - anchor_tolerance), anchor_cl15 * (1.0 + anchor_tolerance)
        ok = lo <= ref.cl15_over_cd <= hi
        checks.append(_Check(
            f"CL^1.5/CD within +/-{anchor_tolerance:.0%} of the PUBLISHED anchor", ok,
            f"solver {ref.cl15_over_cd:.3f} vs published-derived {anchor_cl15:.3f} "
            f"(band [{lo:.2f}, {hi:.2f}], ratio {ref.cl15_over_cd / anchor_cl15:.4f})"))
        detail["published_anchor"] = {
            "cl15_over_cd_from_published_power": anchor_cl15,
            "band": [lo, hi], "tolerance": anchor_tolerance,
            "source": "AtlantikSolar published ~40 W level-flight electrical draw "
                      "(Oettershagen et al. 2018); NOT aeropolar's own self-test "
                      "band, which would be circular",
        }
    return checks, detail


def _finish(name: str, expect_closure: bool, result: SimResult, energy: dict,
            checks: list[_Check], detail: dict,
            cl15: float | None, re: float | None) -> CaseResult:
    """Assemble a CaseResult from the pieces every case produces.

    @param name Case name.  @param expect_closure Expected closure verdict.
    @param result Integrator result.  @param energy usable_energy() output.
    @param checks Every acceptance criterion.  @param detail Report payload.
    @param cl15 Solver CL^1.5/CD or None.  @param re Cruise Reynolds or None.
    @returns The CaseResult.
    """
    closure_ok = bool(result.closed) is bool(expect_closure)
    checks = [_Check(f"closed is {expect_closure}", closure_ok,
                     f"closed={result.closed}, reasons="
                     f"{result.detail.get('closed_reasons')}")] + checks
    passed = all(c.ok for c in checks)
    detail = dict(detail)
    detail["checks"] = [{"label": c.label, "ok": c.ok, "actual": c.actual}
                        for c in checks]
    detail["energy"] = energy
    detail["closure"] = {
        "mode": result.detail.get("closure_mode"),
        "reasons": result.detail.get("closed_reasons"),
        "limit_cycle_soc0": result.detail.get("limit_cycle_soc0"),
        "limit_cycle_sustainable": result.detail.get("limit_cycle_sustainable"),
        "min_soc_as_seeded": result.detail.get("min_soc_as_seeded"),
        "max_unmet_thrust_N": result.detail.get("max_unmet_thrust_N"),
        "max_excess_thrust_N": result.detail.get("max_excess_thrust_N"),
        "max_gen_violation_W": result.detail.get("max_gen_violation_W"),
    }
    return CaseResult(
        name=name, expect_closure=expect_closure, closed=bool(result.closed),
        passed=bool(passed), min_soc=float(result.min_soc),
        margin_ratio=float(energy["margin_ratio_usable"]),
        cl15_over_cd=cl15, mean_cruise_Re=re, detail=detail,
    )


def _solar_cruise_gate(
    design: _SolarCruiseDesign,
    min_soc_floor: float,
    usable_margin_band: tuple[float, float],
    anchor_cl15: float | None,
    anchor_tolerance: float,
    clearness_band: tuple[float, float] = (0.0, 10.0),
    **scales: float,
) -> tuple[CaseResult, _Build, SimResult]:
    """Build, run and gate one solar endurance case.

    @param design The design point.
    @param min_soc_floor Lowest acceptable limit-cycle state of charge.
    @param usable_margin_band Acceptable [lo, hi] on the USABLE margin.
    @param anchor_cl15 Published-derived CL^1.5/CD, or None.
    @param anchor_tolerance Fractional band around the anchor, dimensionless.
    @param clearness_band Acceptable [lo, hi] on the effective daily clearness
        index, dimensionless.
    @param scales Mutation scale factors forwarded to the builder.
    @returns (CaseResult, the build, the integrator result).
    """
    build = build_solar_cruise(design, **scales)
    result, wall_s = _run_window(build)
    energy = usable_energy(result)
    checks, detail = _bound_checks(build, result, anchor_cl15, anchor_tolerance)
    lo, hi = usable_margin_band
    checks += [
        _Check(f"min_soc >= {min_soc_floor}", result.min_soc >= min_soc_floor,
               f"min_soc={result.min_soc:.4f} (as seeded "
               f"{result.detail.get('min_soc_as_seeded'):.4f})"),
        _Check(f"USABLE margin in [{lo}, {hi}]",
               lo <= energy["margin_ratio_usable"] <= hi,
               f"usable {energy['margin_ratio_usable']:.4f} "
               f"(gross {energy['margin_ratio_gross']:.4f}, "
               f"{energy['spilled_fraction_of_gross']:.1%} of harvest spilled)"),
        _Check("no unmet propulsive demand was discarded",
               float(result.detail.get("max_unmet_thrust_N", 0.0)) <= 1e-6,
               f"max unmet thrust {result.detail.get('max_unmet_thrust_N'):.3g} N, "
               f"billed {result.detail.get('unmet_propulsion_J', 0.0) / J_PER_WH:.3f} Wh"),
        _Check("no uncommanded forward force",
               float(result.detail.get("max_excess_thrust_N", 0.0)) <= 1e-6,
               f"max excess thrust {result.detail.get('max_excess_thrust_N'):.3g} N"),
    ]
    harvest, harvest_detail = harvest_check(
        build, energy,
        catalogue={"area_m2": design.area_m2, "packing": design.pv_packing,
                   "efficiency": design.pv_efficiency, "mppt": 0.95},
        band=clearness_band,
    )
    checks.append(harvest)
    detail["harvest_bound"] = harvest_detail
    # Pack-chemistry audit, same pattern as harvest_check's catalogue
    # normalisation: compare the AS-BUILT element against the DESIGN's declared
    # chemistry, which is held fixed under mutation. This is the ONLY check
    # that can see pack_specific_energy x2 on case A -- MEASURED: the closure
    # verdict and the usable margin are both blind to it (margin identical at
    # 1.1201 to 4 decimals), because on a closed limit cycle the pack returns
    # to its starting charge, pinning usable/out at ~1/(eta_chg*eta_dis)
    # whatever the capacity. An energy ratio structurally cannot catch a
    # storage-size error; only the spec-vs-instance audit can.
    pack_el = next(el for el in build.vehicle.elements
                   if isinstance(el, BatteryElement))
    chem_err = (abs(pack_el.specific_energy_Wh_per_kg - design.pack_Wh_per_kg)
                / design.pack_Wh_per_kg)
    checks.append(_Check(
        "pack specific energy equals the design's catalogue chemistry",
        chem_err <= 1e-9,
        f"element {pack_el.specific_energy_Wh_per_kg:.2f} Wh/kg vs catalogue "
        f"{design.pack_Wh_per_kg:.2f} Wh/kg ({pack_el.capacity_Wh:.0f} Wh on "
        f"{pack_el.mass_kg:.2f} kg)"))
    # Family 5: pin the AIR. Every dynamic check moves WITH a corrupted density
    # (round 2 measured rho x2 passing case B silently); the published
    # USSA-1976 table value is the one number that does not.
    rho_model_kgm3 = float(build.meta["atmosphere"]["rho_kgm3"])
    rho_pub_kgm3 = bounds.published_isa_rho_kgm3(design.altitude_m)
    if rho_pub_kgm3 is not None:
        rho_err = abs(rho_model_kgm3 - rho_pub_kgm3) / rho_pub_kgm3
        checks.append(_Check(
            f"site air density matches published USSA-1976 within "
            f"{bounds.ISA_RHO_TOLERANCE:.0%}",
            rho_err <= bounds.ISA_RHO_TOLERANCE,
            f"model {rho_model_kgm3:.6f} kg/m3 vs table {rho_pub_kgm3:.6f} "
            f"kg/m3 at {design.altitude_m:.0f} m ({rho_err:.3%})"))
        detail["isa_density_anchor"] = {
            "altitude_m": design.altitude_m, "model_rho_kgm3": rho_model_kgm3,
            "published_rho_kgm3": rho_pub_kgm3, "relative_error": rho_err,
            "source": "U.S. Standard Atmosphere, 1976 (NOAA/NASA/USAF), table 1",
        }
    else:  # pragma: no cover - every shipped case altitude is tabulated
        detail["isa_density_anchor"] = {
            "altitude_m": design.altitude_m,
            "skipped": "altitude not in the USSA-1976 anchor table -- SKIPPED "
                       "visibly, never interpolated with the model under test",
        }
    # Family 6: pin the WING MASS the same way the air is pinned. Round-4
    # lens probe M3 measured structure.WING_MASS_COEFF_KG x0.5 leaving this
    # whole gate green -- every downstream number moved WITH the corrupted
    # coefficient. The hand-typed anchor in validate_bounds does not move.
    from .vehicle import AeroSurface as _AeroSurface
    wing_el = next(el for el in build.vehicle.elements
                   if isinstance(el, _AeroSurface))
    wing_anchor_kg = bounds.published_wing_mass_anchor_kg(
        design.span_m, design.area_m2)
    if wing_anchor_kg is not None:
        wing_billed_kg = float(wing_el.mass_kg)
        wing_err = abs(wing_billed_kg - wing_anchor_kg) / wing_anchor_kg
        checks.append(_Check(
            f"billed wing mass matches the hand-typed anchor within "
            f"{bounds.WING_MASS_ANCHOR_TOLERANCE:.0%}",
            wing_err <= bounds.WING_MASS_ANCHOR_TOLERANCE,
            f"billed {wing_billed_kg:.4f} kg vs anchor {wing_anchor_kg:.4f} kg "
            f"for b={design.span_m:g} m, S={design.area_m2:g} m2 "
            f"({wing_err:.3%})"))
        detail["wing_mass_anchor"] = {
            "span_m": design.span_m, "area_m2": design.area_m2,
            "billed_kg": wing_billed_kg, "anchor_kg": wing_anchor_kg,
            "relative_error": wing_err,
            "source": "hand-typed AS-2 anchor wing (measured structure minus "
                      "the documented pod/boom/tail split) -- deliberately "
                      "NOT derived from vehicle/structure.py, which is the "
                      "module under test",
        }
    else:
        detail["wing_mass_anchor"] = {
            "span_m": design.span_m, "area_m2": design.area_m2,
            "skipped": "planform not in the wing-mass anchor table -- SKIPPED "
                       "visibly, never derived from the module under test",
        }
    detail.update(build.meta)
    detail["wall_clock_s"] = wall_s
    detail["bands"] = {"min_soc>=": min_soc_floor,
                       "margin_ratio_usable": list(usable_margin_band),
                       "anchor_tolerance": anchor_tolerance}
    # The sweep contract must admit the aircraft the suite validates -- if
    # screen_design ever rejects a case the gate passes (or vice versa), the
    # sweep and the gate have drifted apart, which is itself a failure.
    admissible, screen_reasons = screen_design(build, result)
    checks.append(_Check(
        "screen_design (the sweep contract) admits this design",
        admissible, f"admissible={admissible}, reasons={screen_reasons}"))
    detail["sweep_screen"] = {"admissible": admissible, "reasons": screen_reasons}
    # Round 5: the screen stamps these into build.meta AFTER detail already
    # copied it above, so carry them into the report explicitly -- the
    # seasonal verdict and the tree fingerprint are report-worthy facts.
    detail["seasonal_robustness"] = build.meta.get("seasonal_robustness")
    detail["tree_fingerprint"] = build.meta.get("tree_fingerprint")
    detail["shipped_elements"] = assert_shipped_elements(build.vehicle)
    detail["per_element_Wh_diagnostic"] = per_element_Wh(build.vehicle, build.env, result)
    detail["power_budget_W"] = {
        "mean_out": float(np.mean(result.power_out_W)),
        "mean_in_gross": float(np.mean(result.power_in_W)),
        "peak_in_gross": float(np.max(result.power_in_W)),
        "reference_aero_W": build.reference.P_aero_W,
    }
    detail["trim"] = _sanitize(build.reference)
    return (_finish(design.name, True, result, energy, checks, detail,
                    build.reference.cl15_over_cd, build.reference.Re),
            build, result)


# --------------------------------------------------------------------------- #
# The cases                                                                    #
# --------------------------------------------------------------------------- #


def case_A_atlantiksolar() -> CaseResult:
    """Case A: AtlantikSolar must close a 24 h loop in July at 47.6 N.

    @description ETH Zurich's AS-2 flew 81.5 hours continuously from 14 July 2015.
        The simulator must reproduce that closure from geometry alone, with a
        vehicle assembled only from shipped elements and with every element's
        mass billed. Nothing about the polar is entered: CL, CD, CL^1.5/CD, the
        cruise speed and the Reynolds number all fall out of aeropolar.
    @returns The case verdict.
    """
    anchor = bounds.atlantiksolar_anchor_cl15_over_cd(
        weight_N=DESIGN_A.mass_all_up_kg * G0_MS2, altitude_m=DESIGN_A.altitude_m,
        wing_area_m2=DESIGN_A.area_m2, eta_chain=ETA_CHAIN_CRUISE,
    )
    # K_eff band for a 500 m site at 47.6 N in July: a clear-sky daily clearness
    # index of 0.70-0.78 against a ~0.96 warm-cell temperature derate lands near
    # 0.70; measured 0.7630. The band is roughly +/-25 % of that -- wider than
    # the model's own uncertainty, and still catching a factor of two decisively.
    band_A = (0.55, 0.95)

    def gate_A(**kw: float) -> CaseResult:
        """@description Case A's gate, re-runnable under mutation scales.
        @param kw Mutation scale factors.  @returns The mutant's CaseResult."""
        return _solar_cruise_gate(DESIGN_A, 0.10, (1.02, 1.35), anchor, 0.20,
                                  band_A, **kw)[0]

    res, _build, _result = _solar_cruise_gate(
        DESIGN_A, min_soc_floor=0.10, usable_margin_band=(1.02, 1.35),
        anchor_cl15=anchor, anchor_tolerance=0.20, clearness_band=band_A,
    )
    res.detail["mutations"] = _mutation_report(gate_A)
    res.detail["reported_sensitivities"] = _mutation_report(
        gate_A, expect_caught=False, mutations=REPORTED_SENSITIVITIES)
    res.detail["published_cross_check"] = {
        "level_flight_electrical_W_published": bounds.ATLANTIKSOLAR_LEVEL_FLIGHT_ELEC_W,
        "level_flight_electrical_W_modelled": res.detail["power_budget_W"]["mean_out"],
        "note": "modelled draw is the 24 h mean of the bus; the published figure "
                "is a cruise-point measurement, so the modelled number should sit "
                "slightly ABOVE it",
    }
    res.passed = bool(res.passed and all(m["caught"] for m in res.detail["mutations"]))
    return res


def case_B_zephyr_s() -> CaseResult:
    """Case B: a Zephyr-class HAPS SOLUTION-EXISTENCE DEMONSTRATION at 20 km.

    @description STATUS RELABELLED (round 3): this case is NOT closure evidence
        and must never be cited as validation against a real aircraft. Case A is
        the closure evidence -- a measured 81.5 h flight reproduced from
        geometry. Case B demonstrates only that A SOLUTION EXISTS in the
        Zephyr class (25 m span, 75 kg -- the published Airbus Zephyr S
        figures -- at 20 km, 10 N, solstice) under assumptions that are each
        DOCUMENTED but jointly aggressive: a NACA 2412 section standing in for a
        proprietary HALE section, and a 445.5 Wh/kg pack (published Amprius
        450 Wh/kg silicon-anode cell x the 0.99 minimal-packaging fraction
        AtlantikSolar demonstrated -- a fraction mass.py itself says never to
        assume for a new design). No published cruise-power anchor exists for
        this airframe, so the polar is bounded by closed-form physics plus the
        USSA-1976 density anchor only.

        THE ROUND-3 MODEL FINDING THAT FORCED THE RELABEL: with the wing
        honestly billed (19.96 kg by the Stender/AS-2 model), the previous
        fitted design -- 48 kg of catalogue 337.5 Wh/kg pack -- is IMPOSSIBLE:
        it no longer fits the 75 kg aircraft, and no pack that fits closes
        (measured: 46.5 kg, leaving an absurd 0.45 kg fuselage, is still 122 Wh
        short on the limit cycle). The real Zephyr S flies for months, so the
        model is conservative for this class -- section, pack packaging, or PV
        efficiency -- and that discrepancy is reported upward here rather than
        absorbed by loosening a band.

        Its min_soc floor is 0.10, STRICTLY above the pack's soc_min of 0.05:
        the previous floor equalled soc_min, so the check could not fail -- a
        design bleeding to the rail every dawn still "passed". A floor above
        the rail is falsifiable; measured min_soc is 0.1565.
    @returns The case verdict.
    """
    # K_eff band at 20 km: almost the whole atmosphere is BELOW the aircraft
    # (transmittance ~0.92-0.97) and the cells sit near -56 C, where the
    # -0.4 %/K coefficient works in their favour by about +33 %. Values above 1.0
    # are correct here and are not a bug. Measured 1.1270.
    band_B = (0.85, 1.45)

    def gate_B(**kw: float) -> CaseResult:
        """@description Case B's gate, re-runnable under mutation scales.
        @param kw Mutation scale factors.  @returns The mutant's CaseResult."""
        return _solar_cruise_gate(DESIGN_B, 0.10, (1.02, 1.35), None, 0.20,
                                  band_B, **kw)[0]

    res, _build, _result = _solar_cruise_gate(
        DESIGN_B, min_soc_floor=0.10, usable_margin_band=(1.02, 1.35),
        anchor_cl15=None, anchor_tolerance=0.20, clearness_band=band_B,
    )
    res.detail["evidence_status"] = (
        "SOLUTION-EXISTENCE DEMONSTRATION ONLY -- this case shows a design in "
        "the Zephyr class can close under documented-but-aggressive pack "
        "assumptions. It is NOT closure evidence against a real aircraft; case "
        "A is. Do not cite case B as validation."
    )
    res.detail["mutations"] = _mutation_report(gate_B)
    res.detail["reported_sensitivities"] = _mutation_report(
        gate_B, expect_caught=False, mutations=REPORTED_SENSITIVITIES)
    res.detail["design_finding"] = (
        "ROUND-3 MODEL FINDING: billing the wing honestly (19.96 kg, "
        "Stender/AS-2) kills the previous fitted design -- 48 kg of catalogue "
        "337.5 Wh/kg silicon-anode pack no longer fits the 75 kg aircraft, and "
        "no pack mass that fits closes (46.5 kg with a 0.45 kg fuselage is "
        "still 122 Wh short on the limit cycle). Closure in this class needs "
        "~445 Wh/kg at pack level (Amprius 450 cell x 0.99 packaging): the "
        "shipped design carries 40 kg of it (53 % battery fraction, inside the "
        "45-55 % HAPS band) and leaves a 6.95 kg fuselage/boom/tail line. The "
        "real Zephyr S flies for months, so the model is conservative for this "
        "class; the gap is reported, not fitted away."
    )
    res.passed = bool(res.passed and all(m["caught"] for m in res.detail["mutations"]))
    return res


def case_C_quadcopter_hover() -> CaseResult:
    """Negative control C: a 1 kg hovering quadcopter must NOT close.

    @description Hover costs T^1.5/sqrt(2 rho A) of induced power before any
        efficiency, and 0.203 m^2 of disk on a 1 kg airframe is roughly 83 W
        electrical against roughly 24 W of daily-average solar. A simulator that
        closes this case is lying.
    @returns The case verdict.
    """
    build = build_quadcopter_hover()
    result, wall_s = _run_window(build)
    energy = usable_energy(result)
    m = build.meta
    hover_W = m["hover_electrical_power_W"]
    ideal_W = m["hover_ideal_power_W"]
    checks = [
        _Check("USABLE margin in [0.15, 0.45]",
               0.15 <= energy["margin_ratio_usable"] <= 0.45,
               f"usable {energy['margin_ratio_usable']:.4f} "
               f"(gross {energy['margin_ratio_gross']:.4f}); solar mean "
               f"{np.mean(result.power_in_W):.1f} W vs hover {hover_W:.1f} W"),
        _Check("shipped Thruster reproduces powerplant.hover_power_W",
               abs(hover_W - m["hover_powerplant_cross_check_W"])
               <= 1e-9 * max(1.0, hover_W),
               f"Thruster {hover_W:.6f} W vs powerplant "
               f"{m['hover_powerplant_cross_check_W']:.6f} W"),
        _Check("hover power respects the closed-form induced-power floor",
               hover_W > ideal_W,
               f"electrical {hover_W:.2f} W > ideal induced {ideal_W:.2f} W "
               f"(overall efficiency {ideal_W / hover_W:.4f})"),
        _Check("the pack cannot carry the night",
               energy["unserved_Wh"] > 0.0,
               f"{energy['unserved_Wh']:.2f} Wh of demand went unserved; "
               f"endurance on a full pack "
               f"{m['battery_capacity_Wh'] / hover_W:.2f} h"),
    ]
    harvest, harvest_detail = harvest_check(
        build, energy,
        catalogue={"area_m2": 0.42, "packing": 0.85, "efficiency": 0.237,
                   "mppt": 0.95},
        # Sea level at 10 N on the solstice: a clear-sky clearness index around
        # 0.72 against a warm-cell derate. Measured 0.6868.
        band=(0.50, 0.90),
    )
    checks.append(harvest)
    detail = dict(m)
    detail["wall_clock_s"] = wall_s
    detail["harvest_bound"] = harvest_detail
    detail["shipped_elements"] = assert_shipped_elements(build.vehicle)
    detail["per_element_Wh_diagnostic"] = per_element_Wh(build.vehicle, build.env, result)
    detail["bands"] = {"closed": False, "margin_ratio_usable": [0.15, 0.45]}
    detail["verdict_note"] = "a closing quadcopter would mean the simulator lies"
    res = _finish("C_QuadcopterHover", False, result, energy, checks, detail, None, None)
    # A negative control is mutated in the OPTIMISTIC direction only: the
    # question worth asking is whether a 2x over-claim can make it close.
    # Polar mutations are omitted -- this vehicle has no wing, so they would be
    # no-ops recorded as evidence, which is worse than not running them.
    res.detail["mutations"] = _mutation_report(
        _gate_quad, expect_caught=False, mutations=_QUAD_MUTATIONS,
    )
    # For a NEGATIVE control the one forbidden outcome is the mutant CLOSING
    # (caught=True via a run that passed its inverted gate). A mutant REFUSED at
    # construction by a named wall (raised=True -- e.g. the tech-catalogue
    # frontier refusing a 0.474-efficiency cell at thin-film areal density) is
    # an acceptable, strictly stronger outcome: the over-claim cannot even be
    # built, let alone close. Typed flag, not a string match.
    res.passed = bool(res.passed and all(
        m["raised"] or not m["caught"] for m in res.detail["mutations"]))
    return res


#: Case C is mutated only where a mutation means something for a wingless
#: hovering vehicle, and only in the direction that could rescue it.
_QUAD_MUTATIONS: tuple[Mutation, ...] = (
    Mutation(name="pv_cell_efficiency x2.0",
             overrides={"pv_efficiency_scale": 2.0},
             rationale="doubling the harvest must still not lift a 1 kg quad "
                       "through the night"),
    Mutation(name="pack_specific_energy x2.0",
             overrides={"pack_specific_energy_scale": 2.0},
             rationale="doubling the pack at constant mass must still not close "
                       "an 83 W hover on 24 W of mean solar"),
)


def _gate_quad(**scales: float) -> CaseResult:
    """Re-run case C's gate under mutation scales.

    @description Used only by the sensitivity report. A NEGATIVE control must
        stay failed under mutation, so for case C "caught" is inverted: the
        interesting outcome is that even a 2x optimistic error does not make it
        close.
    @param scales Mutation scale factors.
    @returns A CaseResult whose ``passed`` means "still correctly not closing".
    """
    build = build_quadcopter_hover(**{k: v for k, v in scales.items()
                                      if k in ("pv_efficiency_scale",
                                               "pack_specific_energy_scale")})
    result, _ = _run_window(build)
    energy = usable_energy(result)
    return CaseResult(
        name="C_mutant", expect_closure=False, closed=bool(result.closed),
        passed=not result.closed, min_soc=float(result.min_soc),
        margin_ratio=float(energy["margin_ratio_usable"]),
        cl15_over_cd=None, mean_cruise_Re=None,
        detail={"summary": f"closed={result.closed} "
                           f"usable={energy['margin_ratio_usable']:.4f}"},
    )


def case_D_uniform_wind_turbine() -> CaseResult:
    """Negative control D: a turbine on a free-flier in uniform wind must lose.

    @description A free-flying vehicle in a UNIFORM wind field has exactly one
        reference frame available to it, so it can extract nothing net. Turning a
        turbine costs a momentum-theory drag the propulsion must pay for, and the
        round trip through generator, storage, motor and propeller returns about
        22 cents on the dollar on the project's specified cost basis.

        THREE ratios are reported because they bill different things, and the
        difference is a real modelling choice rather than an error:
          * the VEHICLE ratio, from the shipped elements end to end;
          * the TURBINE-ONLY ratio, its generation against the cost of cancelling
            its own drag, which isolates the extractor from the airframe;
          * powerplant.round_trip_efficiency(), the project's specified basis,
            which charges the FULL kinetic flux through the disk (an implicit
            thrust coefficient of 1.0) rather than the momentum-theory reaction
            (ct = 0.4619). All three are far below 1.0, so the verdict is
            identical; only the number moves.
    @returns The case verdict.
    """
    build = build_turbine_free_flier()
    result, wall_s = _run_window(build)
    energy = usable_energy(result)
    m = build.meta
    turbine = next(el for el in build.vehicle.elements if isinstance(el, WindTurbine))
    thruster = next(el for el in build.vehicle.elements if isinstance(el, Thruster))
    rho_kgm3 = m["operating_point"]["rho_kgm3"]
    V_ms = m["operating_point"]["relative_airspeed_ms"]

    gen_W = turbine.shaft_power_W(V_ms, rho_kgm3) * turbine.eta_gen
    drag_N = turbine.reaction_drag_N(V_ms, rho_kgm3)
    cancel_W = thruster.electrical_power_W(drag_N, V_ms, rho_kgm3)
    ratio_turbine_only = gen_W / cancel_W if cancel_W > 0.0 else float("inf")
    eff = m["efficiencies"]
    # The PROJECT INVARIANT is a statement about powerplant's CANONICAL chain
    # (cp 0.40, eta_gen 0.90, charge 0.95, discharge 0.95, motor 0.85, prop 0.80)
    # = 0.220932, so it is asserted on the canonical defaults. This vehicle runs a
    # different propeller number -- ETA_PROP_CRUISE = 0.85 rather than 0.80 -- so
    # ITS product is 0.234740. Reporting the two separately keeps the invariant
    # sharp instead of letting one case's configuration quietly edit a project
    # constant.
    rt_canonical = float(powerplant.round_trip_efficiency())
    rt_this_vehicle = float(powerplant.round_trip_efficiency(
        cp=eff["cp"], eta_gen=eff["eta_gen"], eta_charge=eff["eta_charge"],
        eta_discharge=eff["eta_discharge"], eta_motor=eff["eta_motor"],
        eta_prop=eff["eta_prop_profile"],
    ))
    chain_only = (eff["eta_gen"] * eff["eta_charge"] * eff["eta_discharge"]
                  * eff["eta_motor"] * eff["eta_prop_profile"])

    # Drifting with the air must produce EXACTLY zero, structurally.
    drift_body = BodyState(pos_m=np.array([0.0, 0.0, m["operating_point"]["altitude_m"]]),
                           vel_ms=np.array([m["wind_field"]["u_ms"], 0.0, 0.0]),
                           mass_kg=1.0)
    drift_W = float(turbine.evaluate(
        [drift_body], atmosphere(m["operating_point"]["altitude_m"]),
        build.env.wind.sample(0.0, 0.0, m["operating_point"]["altitude_m"], 0.0),
        solar(10.0, 0.0, 172, 12.0, m["operating_point"]["altitude_m"]),
        0.0, SLOW_DT_S).power_elec_W)

    guard = "pass"
    t_guard = time.perf_counter()
    try:
        assert_no_free_energy(build.vehicle, n_trajectories=FREE_ENERGY_TRAJECTORIES,
                              seed=0)
    except Exception as exc:  # noqa: BLE001 - the guard's verdict is the datum
        guard = f"FAIL: {type(exc).__name__}: {exc}"
    guard_s = time.perf_counter() - t_guard

    checks = [
        _Check("vehicle USABLE margin < 1.0 (net loss)",
               energy["margin_ratio_usable"] < 1.0,
               f"vehicle {energy['margin_ratio_usable']:.4f}"),
        _Check("turbine-only round trip < 1.0",
               ratio_turbine_only < 1.0,
               f"{ratio_turbine_only:.4f} = {gen_W:.2f} W generated / {cancel_W:.2f} W "
               f"to cancel its own {drag_N:.3f} N of reaction drag"),
        _Check("the vehicle ratio is strictly below the conversion chain alone",
               energy["margin_ratio_usable"] < chain_only,
               f"{energy['margin_ratio_usable']:.4f} < {chain_only:.4f}; the "
               f"difference is the momentum-theory drag penalty"),
        _Check("powerplant.round_trip_efficiency() on its canonical chain is "
               "the specified 0.220932",
               abs(rt_canonical - 0.220932) < 1e-9,
               f"canonical {rt_canonical:.6f}; this vehicle's own chain "
               f"(eta_prop {eff['eta_prop_profile']}) gives {rt_this_vehicle:.6f}"),
        _Check("every round-trip basis is below 1.0",
               max(rt_canonical, rt_this_vehicle, ratio_turbine_only,
                   energy["margin_ratio_usable"]) < 1.0,
               f"canonical {rt_canonical:.4f}, vehicle chain {rt_this_vehicle:.4f}, "
               f"turbine-only {ratio_turbine_only:.4f}, "
               f"vehicle {energy['margin_ratio_usable']:.4f}"),
        _Check("drifting with the air produces EXACTLY zero",
               abs(drift_W) < 1e-12, f"{drift_W:.3e} W"),
        _Check(f"assert_no_free_energy over {FREE_ENERGY_TRAJECTORIES} trajectories",
               guard == "pass", f"{guard} ({guard_s:.1f} s)"),
        _Check("cp respects the Betz limit",
               eff["cp"] <= bounds.BETZ_LIMIT_CP,
               f"cp {eff['cp']:.4f} <= 16/27 = {bounds.BETZ_LIMIT_CP:.4f}"),
    ]
    detail = dict(m)
    detail["wall_clock_s"] = wall_s
    detail["shipped_elements"] = assert_shipped_elements(build.vehicle)
    detail["per_element_Wh_diagnostic"] = per_element_Wh(build.vehicle, build.env, result)
    detail["ratios"] = {
        "vehicle_usable": energy["margin_ratio_usable"],
        "vehicle_gross": energy["margin_ratio_gross"],
        "turbine_only_bus_to_bus": ratio_turbine_only,
        "conversion_chain_only_no_drag_penalty": chain_only,
        "powerplant_round_trip_canonical": rt_canonical,
        "powerplant_round_trip_this_vehicle_chain": rt_this_vehicle,
        "note": "the specified 0.2209 bills the FULL kinetic flux (implicit "
                "ct = 1.0); the shipped WindTurbine bills the momentum-theory "
                "reaction ct = 0.4619, which is why the measured ratios are "
                "higher. Every one is far below 1.0.",
    }
    detail["free_energy_guard"] = guard
    detail["drifting_with_the_air_power_W"] = drift_W
    detail["bands"] = {"closed": False, "vehicle_usable<": 1.0,
                       "turbine_only<": 1.0}
    return _finish("D_UniformWindTurbine", False, result, energy, checks, detail,
                   None, None)


def case_E_magic_generator() -> CaseResult:
    """Adversarial control E: a zero-force +1000 W generator must be rejected.

    @description The guard for archetypes 3 and 4, which have no other end-to-end
        case. Before integrate's FATAL-3 fix this vehicle reported closed = True
        with min_soc = 1.0 -- the violation was computed and then discarded.

        PASS requires either that ``integrate_energy`` RAISES FreeEnergyError, or
        that it reports closed = False. Raising is the better outcome and is what
        the current integrator does, on the first step; both are accepted because
        the invariant being validated is "the simulator does not accept free
        energy", not "the simulator raises a particular exception type".
    @returns The case verdict.
    """
    build = build_magic_generator()
    raised: Exception | None = None
    result: SimResult | None = None
    t0 = time.perf_counter()
    try:
        result = integrate_energy(build.vehicle, build.env, 0.0, DAY_S, SLOW_DT_S)
    except FreeEnergyError as exc:
        raised = exc
    wall_s = time.perf_counter() - t0

    detail = dict(build.meta)
    detail["wall_clock_s"] = wall_s
    detail["shipped_elements"] = assert_shipped_elements(
        build.vehicle, allow=("_MagicGenerator",))
    detail["environment"] = {"wind": "uniform (0,0,0) -- STILL AIR",
                             "utc_hour_at_t0_h": build.env.utc_hour_at_t0_h,
                             "note": "local midnight, so no solar power can mask "
                                     "the manufactured watts"}

    if raised is not None:
        detail["outcome"] = "raised"
        detail["exception"] = f"{type(raised).__name__}: {raised}"
        checks = [
            _Check("integrate_energy rejects the magic generator", True,
                   f"{type(raised).__name__} raised: {str(raised)[:150]}"),
            _Check("it is a FreeEnergyError, not an incidental failure",
                   isinstance(raised, FreeEnergyError), type(raised).__name__),
            # MECHANISM, not wall clock (round 4): the old check asserted
            # `wall_s < 1.0` and failed at 2669 ms under CPU contention with every
            # physics check green. What "cheap enough for a 30k sweep" actually
            # requires is that the guard fires on the FIRST evaluation -- before a
            # single energy step is integrated -- which FreeEnergyError now reports
            # directly via its t_s attribute. Wall clock is still recorded in
            # detail["wall_clock_s"] as information, never gated on.
            _Check("rejection fires at the FIRST evaluation (t_s = 0), not on a clock",
                   getattr(raised, "t_s", None) == 0.0,
                   f"FreeEnergyError.t_s = {getattr(raised, 't_s', None)} s from "
                   f"{getattr(raised, 'where', None)!r} "
                   f"(wall {wall_s * 1000:.1f} ms, informational)"),
        ]
        return CaseResult(
            name="E_MagicGenerator", expect_closure=False, closed=False,
            passed=all(c.ok for c in checks), min_soc=float("nan"),
            margin_ratio=float("nan"), cl15_over_cd=None, mean_cruise_Re=None,
            detail={**detail,
                    "checks": [{"label": c.label, "ok": c.ok, "actual": c.actual}
                               for c in checks]},
        )

    assert result is not None
    energy = usable_energy(result)
    checks = [
        _Check("a vehicle manufacturing 1000 W does not close",
               not result.closed,
               f"closed={result.closed}, min_soc={result.min_soc:.4f}, "
               f"reasons={result.detail.get('closed_reasons')}"),
        _Check("the generation-reaction violation was recorded",
               float(result.detail.get("max_gen_violation_W", 0.0)) > 0.0,
               f"{result.detail.get('max_gen_violation_W')} W"),
    ]
    detail["outcome"] = "did not raise"
    return _finish("E_MagicGenerator", False, result, energy, checks, detail, None, None)


# --------------------------------------------------------------------------- #
# DEFECT 3 -- prove the bands bite                                             #
# --------------------------------------------------------------------------- #


def _mutation_report(gate: Callable[..., CaseResult],
                     expect_caught: bool = True,
                     mutations: tuple = CLOSURE_MUTATIONS) -> list[dict]:
    """Run the mutation set against a case gate and record the outcomes.

    @description The direct, non-circular answer to "are the bands tight enough
        to detect a 2x error in a dominant parameter?" -- inject the error and
        look. For a case expected to CLOSE, every mutation must be caught. For a
        negative control the interesting question is the opposite (does it stay
        failed?), and ``expect_caught`` records which question was asked.

        The gate is called ONCE per mutation; its verdict and its numbers come
        out of the same run, so the summary in the report can never describe a
        different integration from the one that decided the verdict.
    @param gate Callable taking scale keywords and returning a CaseResult.
    @param expect_caught True when a caught mutation is the required outcome.
    @param mutations Which mutations to apply.
    @returns One dict per mutation.
    """
    def _once(**kwargs: float) -> tuple[bool, str]:
        r = gate(**kwargs)
        return r.passed, (f"closed={r.closed} min_soc={r.min_soc:.4f} "
                          f"usable_margin={r.margin_ratio:.4f}")

    outcomes = run_mutations(_once, mutations)
    return [{"mutation": o.name, "caught": o.caught, "raised": o.raised,
             "required": expect_caught, "detail": o.detail} for o in outcomes]


# --------------------------------------------------------------------------- #
# Suite                                                                        #
# --------------------------------------------------------------------------- #

CASES: tuple[Callable[[], CaseResult], ...] = (
    case_A_atlantiksolar,
    case_B_zephyr_s,
    case_C_quadcopter_hover,
    case_D_uniform_wind_turbine,
    case_E_magic_generator,
)

#: Builders whose lift provenance is proved statically before anything runs.
_PROVENANCE_TARGETS: tuple[Callable, ...] = (
    build_solar_cruise, build_turbine_free_flier, bounds.reference_trim,
)


def run_all(report_path: str | None = None) -> list[CaseResult]:
    """Run every validation case and optionally write a JSON report.

    @description Returns the results so a test can use them; ``main()`` owns the
        process exit status. A case that raises is reported as a failure with its
        traceback rather than taking the suite down -- a gate must always produce
        a report.
    @param report_path Where to write the JSON report; None writes nothing.
    @returns The case results, in order A..E.
    """
    provenance: dict = {}
    for fn in _PROVENANCE_TARGETS:
        try:
            provenance[fn.__name__] = assert_lift_is_solver_derived(fn)
        except ValidationError as exc:
            provenance[fn.__name__] = {"error": str(exc)}

    results: list[CaseResult] = []
    for case in CASES:
        try:
            res = case()
            res.detail["lift_provenance"] = provenance
        except Exception as exc:  # noqa: BLE001 - a gate must always report
            res = CaseResult(
                name=getattr(case, "__name__", str(case)),
                expect_closure=case in (case_A_atlantiksolar, case_B_zephyr_s),
                closed=False, passed=False, min_soc=float("nan"),
                margin_ratio=float("nan"), cl15_over_cd=None, mean_cruise_Re=None,
                detail={"error": f"{type(exc).__name__}: {exc}",
                        "traceback": traceback.format_exc()},
            )
        results.append(res)

    if any("error" in p for p in provenance.values()):
        for r in results:
            r.passed = False

    if report_path:
        payload = {
            "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "all_passed": all(r.passed for r in results),
            "lift_provenance": provenance,
            "cases": [
                {"name": r.name, "expect_closure": r.expect_closure,
                 "closed": r.closed, "passed": r.passed, "min_soc": r.min_soc,
                 "margin_ratio_usable": r.margin_ratio,
                 "cl15_over_cd": r.cl15_over_cd, "mean_cruise_Re": r.mean_cruise_Re,
                 "detail": _sanitize(r.detail)}
                for r in results
            ],
        }
        os.makedirs(os.path.dirname(os.path.abspath(report_path)) or ".", exist_ok=True)
        with open(report_path, "w", encoding="utf-8") as fh:
            json.dump(_sanitize(payload), fh, indent=2)
    return results


def print_report(results: Sequence[CaseResult]) -> None:
    """Print the human-readable verdict table and every failed check.

    @param results The case results.
    """
    print()
    print("=" * 100)
    print("aerosim validation suite -- cases A-E   (margin_ratio is USABLE energy)")
    print("=" * 100)
    print(f"{'case':<24}{'expect':<9}{'closed':<9}{'min_soc':>9}{'usable':>9}"
          f"{'gross':>9}{'CL^1.5/CD':>11}{'Re':>10}  verdict")
    print("-" * 100)
    for r in results:
        gross = r.detail.get("energy", {}).get("margin_ratio_gross")
        print(f"{r.name:<24}{('close' if r.expect_closure else 'FAIL'):<9}"
              f"{str(r.closed):<9}{_fmt(r.min_soc, '.3f'):>9}"
              f"{_fmt(r.margin_ratio, '.4f'):>9}{_fmt(gross, '.4f'):>9}"
              f"{_fmt(r.cl15_over_cd, '.2f'):>11}{_fmt(r.mean_cruise_Re, '.0f'):>10}"
              f"  {'PASS' if r.passed else 'FAIL'}")
    print("-" * 100)
    for r in results:
        failed = [c for c in r.detail.get("checks", []) if not c["ok"]]
        bad_mut = [m for m in r.detail.get("mutations", [])
                   if m["required"] and not m["caught"]]
        if failed or bad_mut or "error" in r.detail:
            print(f"\n{r.name}:")
        for c in failed:
            print(f"    [FAIL] {c['label']}: {c['actual']}")
        for m in bad_mut:
            print(f"    [FAIL] mutation not caught -- {m['mutation']}: {m['detail']}")
        if "error" in r.detail:
            print(f"    raised: {r.detail['error']}")
            print(textwrap.indent(str(r.detail.get("traceback", "")), "        "))
    print()


def main() -> int:
    """CLI entry point: ``python -m aerosim.validate``.

    @returns 0 when every case passes, 1 otherwise.
    """
    parser = argparse.ArgumentParser(description="aerosim validation gate (cases A-E)")
    parser.add_argument(
        "--report",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "validation-report.json"),
        help="path of the JSON report to write",
    )
    parser.add_argument("--quiet", action="store_true", help="suppress the table")
    args = parser.parse_args()

    results = run_all(report_path=args.report)
    if not args.quiet:
        print_report(results)
        print(f"report written to {args.report}")
    return 0 if all(r.passed for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
