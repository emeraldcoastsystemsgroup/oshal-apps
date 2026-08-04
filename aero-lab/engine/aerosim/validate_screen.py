"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | New module: screen_design, THE
  |                                           | per-design admissibility contract a
  |                                           | 30,000-design sweep calls, carved out
  |                                           | of validate.py when that file crossed
  |                                           | the project's 800-code-line
  |                                           | decomposition threshold. The seam
  |                                           | mirrors validate_designs (WHICH
  |                                           | VEHICLE) and validate_bounds (WHICH
  |                                           | PHYSICS): this module answers WHICH
  |                                           | DESIGNS A SWEEP MAY RANK. validate.py
  |                                           | re-exports everything here, so
  |                                           | `from aerosim.validate import
  |                                           | screen_design` remains the public
  |                                           | surface.
2 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 4 screens, each against a
  |                                           | measured exploit (R4_probe_boundary /
  |                                           | REV3_lens_probe): #9 TECHNOLOGY
  |                                           | CATALOGUE -- coupled (PV efficiency,
  |                                           | areal density) pairs and pack Wh/kg
  |                                           | checked against cited joint frontiers
  |                                           | (vehicle/tech_catalogue.py); #10
  |                                           | FUSELAGE REMAINDER FLOOR -- the
  |                                           | structural remainder must clear
  |                                           | structure.min_fuselage_boom_tail_
  |                                           | mass_kg (the 1-gram fuselage exploit);
  |                                           | #11 EXTRA_CD0 WETTED-AREA FLOOR -- a
  |                                           | fuselage that weighs something wets
  |                                           | something: minimal wetted area from
  |                                           | the billed remainder (solid-composite
  |                                           | sphere lower bound) x laminar Blasius
  |                                           | Cf must be covered by the declared
  |                                           | extra_CD0; #12 PAYLOAD FLOOR -- a
  |                                           | solar design with zero avionics draw
  |                                           | is an optimizer artifact, not an
  |                                           | aircraft; #7 K_EFF ceiling becomes
  |                                           | ALTITUDE-AWARE: 1.5 is honest at 20 km
  |                                           | and ~2x generous at sea level, so the
  |                                           | ceiling scales with the clear-sky
  |                                           | attainable (Bird-style zenith
  |                                           | transmittance ^ pressure ratio),
  |                                           | capped at 1.5 so nothing loosens.
3 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 (cleanup). (a) PAYLOAD FLOOR
  |                                           | is now a real avionics WATTAGE, not
  |                                           | "> 0": every hostile survivor in the
  |                                           | R5/R6 searches parked payload_W at
  |                                           | 1 mW (+1.7-2.8% measured usable). The
  |                                           | floor scales from the AS-2 anchor
  |                                           | (5.8 W published on 6.93 kg) with
  |                                           | total mass^(2/3) -- actuation/sensing
  |                                           | scale with surface area under
  |                                           | geometric similarity; the autopilot+
  |                                           | radio baseline is the absolute 1.0 W
  |                                           | floor -- and the billed payload MASS
  |                                           | must support the draw at <= 150 W/kg
  |                                           | (about 4x the densest catalogued
  |                                           | suite, AS-2's 38.7 W/kg).
  |                                           | (b) SEASONAL ROBUSTNESS: same ship,
  |                                           | same site, day-of-year 80 (equinox)
  |                                           | re-closure; closes_equinox recorded,
  |                                           | designs that close ONLY on their own
  |                                           | day are FLAGGED 'flag: solstice-only'
  |                                           | -- NOT rejected: latitude/season can
  |                                           | be a legitimate mission choice, but a
  |                                           | sweep must be able to see the
  |                                           | difference (measured: the same ship
  |                                           | scored 1.5865 at 60N solstice vs
  |                                           | 1.3544 at the equator; honest
  |                                           | hardware is site-flat). Reasons with
  |                                           | the 'flag:' prefix do not affect
  |                                           | admissibility.
  |                                           | (c) SWEEP INTEGRITY CONTRACT:
  |                                           | tree_fingerprint() stamped into every
  |                                           | screen verdict, and verify_survivor()
  |                                           | re-evaluates a survivor in a FRESH
  |                                           | subprocess, refusing on fingerprint
  |                                           | mismatch -- added after an on-disk
  |                                           | mutation harness was caught mid-cycle
  |                                           | scoring 27/145 of a concurrent search
  |                                           | against mutant code (structure.py
  |                                           | momentarily read 'return 0.0 *'; 3
  |                                           | fantasy survivors, reasons=[]).
4 | maintainer@emeraldcoastsystemsgroup.com   | ROUND 5 (cleanup), screen #11: the
  |                                           | solid-composite-sphere extra_CD0
  |                                           | floor was VACUOUS -- measured 60-200x
  |                                           | below any flown airframe (case-A
  |                                           | class ~2e-5 vs honest 0.006; riding
  |                                           | 0.0025 -> 0.0001 bought +3.4% usable,
  |                                           | +11% stacked). Replaced by
  |                                           | structure.min_extra_CD0: carried mass
  |                                           | packed at a realistic pod bulk
  |                                           | density (150 kg/m3, dense end of the
  |                                           | cited 50-150 band) in a slender
  |                                           | minimum-surface shell, AS-2-anchored
  |                                           | boom+tail wetted area per span (same
  |                                           | split as screen #10), half-laminar
  |                                           | flat-plate Cf, Hoerner form/
  |                                           | interference >= 1.2. Case-A class
  |                                           | floor 3.4e-3 (factor ~1.8 of honest);
  |                                           | 0.0001 on a kg-scale pod REFUSES.
  |                                           | CFRP_SOLID_DENSITY_KG_M3 retired.

aerosim.validate_screen -- per-design admissibility for the optimizer sweep.

Every screen exists because a previous round's optimizer exploited its absence.
The checks re-use the validation gate's own guards (mass declaration, parameter
re-check, the Prandtl+Blasius drag floor, the astronomical harvest ceiling), so
the sweep and the validation suite cannot drift apart -- and _solar_cruise_gate
asserts that screen_design ADMITS every case the suite passes, which makes the
coupling itself falsifiable.

SWEEP INTEGRITY CONTRACT (round 5) -- MANDATORY for any sweep:
Every screen verdict is stamped with tree_fingerprint(), the content hash of
every .py file in the aerosim package ON DISK at verdict time. A sweep MUST
record that stamp with each SimResult/verdict it stores, and MUST re-confirm
any design it intends to promote ("survivor") through verify_survivor(), which
re-evaluates the design in a FRESH subprocess against the current tree and
REFUSES (SweepIntegrityError) when fingerprints do not match. This exists
because it happened: an on-disk mutate->restore harness ran concurrently with
a search, 27/145 of the search's records were scored against mutant code, and
3 fantasy survivors were recorded with reasons=[]. Mutation harnesses must
never edit the evaluation tree in place (patch in-process, or mutate a copy of
the tree in a temp dir -- see AUDIT_mutations.py); the fingerprint stamp is
how a sweep proves that rule held for ITS OWN records.

UNITS: SI throughout, carried in names -- *_N newtons, *_m2 square metres,
*_J joules, *_Wh watt-hours, *_N_m2 newtons per square metre. Dimensionless:
soc, K_eff, aspect ratio.
"""

from __future__ import annotations

import copy as _copy
import dataclasses
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any

from . import validate_bounds as bounds
from .env import atmosphere, day_length_h
from .integrate import EnvBundle, integrate_energy
from .vehicle import (
    MAX_STRUCTURAL_ASPECT_RATIO,
    AeroSurface,
    BatteryElement,
    PayloadLoad,
    PVArray,
    TechCatalogueError,
    Thruster,
    UndeclaredMassError,
    check_pack_technology,
    check_pv_technology_pair,
    min_extra_CD0,
    min_fuselage_boom_tail_mass_kg,
    recheck_element_params,
)

#: A design's limit-cycle min_soc must clear its soc_min by at least this,
#: dimensionless. Round 2's exploit winners ALL sat exactly ON the floor
#: (min_soc == soc_min to 4 decimals): a design with zero standoff has no
#: margin for one cloudy morning and is an optimizer artifact, not an aircraft.
SOC_FLOOR_STANDOFF: float = 0.02

#: Ceiling on the effective daily clearness index a sweep design may claim,
#: dimensionless, AT THE 20 km ANCHOR ALTITUDE. validate_bounds.
#: effective_clearness_index: values above 1.0 are legitimate at altitude
#: (cold cells + thin atmosphere, case B measures ~1.13); values above about
#: 1.5 exceed what geometry, transmittance and the temperature derate can
#: jointly deliver ANYWHERE in the atmosphere. ROUND 4: 1.5 is honest at
#: 20 km but ~2x generous at sea level, so the enforced ceiling is
#: screen_k_eff_max(altitude_m), which scales this anchor DOWN with the
#: clear-sky attainable and never up.
SCREEN_K_EFF_MAX: float = 1.5

#: Altitude the SCREEN_K_EFF_MAX anchor is honest at, m: case B's 20 km, where
#: ~95 % of the atmosphere's mass is below the wing.
K_EFF_ANCHOR_ALTITUDE_M: float = 20000.0

#: Clear-sky broadband zenith transmittance of the FULL atmosphere,
#: dimensionless. Bird & Hulstrom's clear-sky model (SERI/TR-642-761, 1981)
#: puts the broadband direct+circumsolar transmittance at AM1 for a clean dry
#: atmosphere near 0.75; the same number anchors the classic "clear-sky daily
#: clearness index ~0.7-0.75" rule the case-A band documents. Used ONLY as a
#: ratio between altitudes (Beer's law in the pressure fraction), never as an
#: absolute harvest prediction.
TAU_CLEAR_SKY_ZENITH_SEA_LEVEL: float = 0.75

#: RETIRED (round 5): CFRP_SOLID_DENSITY_KG_M3 = 1600.0 and the solid-sphere
#: wetted-area bound built on it. "Strict" was the defect: a fuselage is a
#: SHELL around packed equipment, not a solid billet of laminate, so the
#: sphere floor sat 60-200x below any flown airframe and bounded nothing.
#: Screen #11 now consumes structure.min_extra_CD0 (shell/slender-body pod at
#: realistic packing density + AS-2-anchored boom/tail wetted area + Hoerner
#: form/interference floor), which lands within a factor ~2 of the AS-2-honest
#: 0.006 for the case-A class.

#: AS-2 avionics anchor for the payload-draw floor: the PUBLISHED 5.8 W
#: avionics+payload draw of the 6.93 kg AtlantikSolar AS-2 (Oettershagen et
#: al. 2018) -- the same aircraft every other anchor in this suite is
#: calibrated to.
AVIONICS_ANCHOR_DRAW_W: float = 5.8
AVIONICS_ANCHOR_MASS_KG: float = 6.93

#: Mass exponent of the avionics-draw floor, dimensionless. Actuation and
#: sensing power scale with control-surface / wetted area, which under
#: geometric similarity goes as mass^(2/3); the autopilot+radio baseline is
#: mass-independent and is covered by the absolute AVIONICS_MIN_DRAW_W floor.
#: Cross-checked against the catalogue: at 75 kg (Zephyr S class) the floor is
#: 28.4 W against a documented 50 W payload budget -- below every honest
#: catalogued suite, so the floor bills fantasy without taxing hardware.
#: (Exponent 1.0 would demand 62.8 W of the 75 kg class, ABOVE its documented
#: budget -- too aggressive; 2/3 is the physically-motivated choice that stays
#: strictly below the catalogue.)
AVIONICS_MASS_EXPONENT: float = 2.0 / 3.0

#: Absolute floor on mission avionics draw, W: no autopilot + C2 radio that
#: can fly ANY mission aircraft runs below ~1 W continuous.
AVIONICS_MIN_DRAW_W: float = 1.0

#: Ceiling on installed avionics/payload specific power, W/kg. The densest
#: catalogued suite here is AS-2's 5.8 W on 0.150 kg = 38.7 W/kg (installed:
#: boards + enclosure + harness + antennas); 150 W/kg is ~4x that -- generous
#: headroom for honest hardware while a 1-gram "payload" drawing 5.8 W
#: (5800 W/kg) refuses.
AVIONICS_MAX_SPECIFIC_POWER_W_PER_KG: float = 150.0

#: Day-of-year of the March equinox, the seasonal-robustness re-closure day.
#: The equinox is the season-neutral day: daily extraterrestrial insolation at
#: the equinox is within a few percent of the ANNUAL MEAN at every latitude,
#: so a design that closes at doy 80 closes most of the year at its site,
#: while a midnight-sun solstice specialist does not.
EQUINOX_DAY_OF_YEAR: int = 80

#: Prefix marking a reason string as a FLAG, not a rejection: flagged reasons
#: are reported in screen_design's reasons list but EXCLUDED from the
#: admissibility test. Exists for facts a sweep must see but that may be a
#: legitimate mission choice (seasonal/latitude dependence).
FLAG_PREFIX: str = "flag: "

#: The integrator's canonical 24 h slow-loop window, s, and step, s -- must
#: match validate_designs.DAY_S / SLOW_DT_S (asserted in tests).
_SEASONAL_WINDOW_S: float = 86400.0
_SEASONAL_DT_S: float = 60.0


class SweepIntegrityError(RuntimeError):
    """The evaluation tree changed between scoring and verification.

    @description Raised by verify_survivor when the tree fingerprint recorded
        with a sweep verdict (or the parent process's current tree) does not
        match the tree the fresh re-evaluation ran against. A verdict scored
        against one tree and reported against another is not a result.
    """


def min_avionics_draw_W(total_mass_kg: float) -> float:
    """Floor on the total mission avionics/payload draw for a solar design.

    @description ROUND 5. Every hostile survivor of the R5/R6 searches parked
        payload_W at the old floor's edge (1 mW), worth a measured +1.7-2.8%
        usable margin over an honestly-equipped ship. The floor is the AS-2
        anchor (published 5.8 W on 6.93 kg) scaled with total mass^(2/3)
        (see AVIONICS_MASS_EXPONENT for the scaling argument and the
        catalogue cross-check), never below AVIONICS_MIN_DRAW_W.
    @param total_mass_kg As-built total vehicle mass, kg, > 0.
    @returns Minimum admissible total PayloadLoad draw, W.
    """
    scaled_W = AVIONICS_ANCHOR_DRAW_W * (
        float(total_mass_kg) / AVIONICS_ANCHOR_MASS_KG) ** AVIONICS_MASS_EXPONENT
    return max(AVIONICS_MIN_DRAW_W, scaled_W)


def screen_k_eff_max(altitude_m: float) -> float:
    """Altitude-aware ceiling on the effective daily clearness index.

    @description ROUND 4. The K_eff a design can honestly reach scales with
        how much atmosphere is still above it. Beer's law in the pressure
        fraction gives the clear-sky attainable ratio between altitudes:

            tau(z) = TAU_CLEAR_SKY_ZENITH_SEA_LEVEL ** (p(z) / p0)

        and the enforced ceiling is the 20 km anchor value scaled by
        tau(z)/tau(20 km), CAPPED at the anchor so the band can only tighten
        (measured: at 500 m the ceiling drops 1.5 -> ~1.16, closing the ~2x
        headroom the flat 1.5 gave low-altitude designs; at 20 km it is
        exactly the unchanged 1.5).
    @param altitude_m Design cruise altitude, m MSL (clamped to [0, 47000],
        the atmosphere model's range).
    @returns Ceiling on K_eff, dimensionless, <= SCREEN_K_EFF_MAX.
    """
    z_m = min(max(float(altitude_m), 0.0), 47000.0)
    p0_Pa = float(atmosphere(0.0).p_Pa)
    frac = float(atmosphere(z_m).p_Pa) / p0_Pa                    # dimensionless
    frac_anchor = float(atmosphere(K_EFF_ANCHOR_ALTITUDE_M).p_Pa) / p0_Pa
    scale = TAU_CLEAR_SKY_ZENITH_SEA_LEVEL ** (frac - frac_anchor)
    return SCREEN_K_EFF_MAX * min(1.0, scale)

#: Wing-loading plausibility band for the persistent-flight sweep class, N/m^2.
#: Anchors: AtlantikSolar 39.5, Zephyr S 35.4, Helios ~44 N/m^2. The band is an
#: order of magnitude around that cluster -- below ~5 N/m^2 the "wing" is a
#: paper kite no gust survives; above ~200 N/m^2 it is a sailplane wing loading
#: no solar-endurance aircraft has flown at.
SCREEN_WING_LOADING_N_M2: tuple[float, float] = (5.0, 200.0)

#: Aspect-ratio plausibility band, dimensionless. The ceiling is the structural
#: envelope (vehicle/structure.py, Helios 30.9 flown, hard stop 40); the floor
#: rejects stub wings (AR < 4) that only appear when an optimizer is gaming the
#: area term of some other bill.
SCREEN_ASPECT_RATIO: tuple[float, float] = (4.0, MAX_STRUCTURAL_ASPECT_RATIO)


def tree_fingerprint(package_root: str | Path | None = None) -> str:
    """Content hash of every .py file in the aerosim package ON DISK.

    @description THE SWEEP INTEGRITY STAMP. sha256 over (relative path,
        file bytes) of every *.py under the package directory, sorted, so any
        edit to any evaluation-tree module -- including a mutation harness's
        "temporary" one -- changes the value. screen_design stamps it into
        every verdict; verify_survivor refuses on mismatch. Reads the DISK,
        not sys.modules: the fatal this guards against was an on-disk edit.
    @param package_root Directory to fingerprint; None uses this module's own
        package directory (the live evaluation tree).
    @returns Hex digest, 64 chars.
    """
    root = Path(package_root) if package_root is not None else Path(__file__).parent
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\x00")
        digest.update(path.read_bytes())
        digest.update(b"\x00")
    return digest.hexdigest()


#: Script run by verify_survivor in the fresh subprocess: rebuild, integrate,
#: screen, and report -- against whatever tree that subprocess imports.
_VERIFY_SCRIPT = """\
import json, sys, warnings
warnings.simplefilter("ignore")
payload = json.loads(sys.stdin.read())
from aerosim.validate_designs import _SolarCruiseDesign, build_solar_cruise
from aerosim.integrate import integrate_energy
from aerosim.validate_screen import screen_design, tree_fingerprint
design = _SolarCruiseDesign(**payload["design"])
build = build_solar_cruise(design)
result = integrate_energy(build.vehicle, build.env, 0.0,
                          payload["window_s"], payload["dt_s"])
admissible, reasons = screen_design(build, result,
                                    check_seasonal=payload["check_seasonal"])
print("VERIFY_SURVIVOR_JSON:" + json.dumps({
    "tree_fingerprint": tree_fingerprint(),
    "admissible": bool(admissible),
    "reasons": list(reasons),
    "closed": bool(result.closed),
    "min_soc": float(result.min_soc),
}))
"""


def verify_survivor(
    design: Any,
    expected_fingerprint: str | None = None,
    check_seasonal: bool = True,
    timeout_s: float = 900.0,
) -> dict:
    """Re-evaluate a sweep survivor in a FRESH subprocess against the CURRENT tree.

    @description MANDATORY before promoting any sweep survivor (see the module
        docstring's SWEEP INTEGRITY CONTRACT). The subprocess imports aerosim
        from this tree from scratch, rebuilds the design, integrates the 24 h
        window, screens it, and reports its own tree_fingerprint(). Refuses --
        SweepIntegrityError, never a silent pass -- when (a) the recorded
        fingerprint the survivor was scored under differs from the current
        tree, or (b) the subprocess's fingerprint differs from the parent's
        (the tree changed WHILE verifying). A survivor that cannot be
        reproduced against the current tree is not a survivor.
    @param design The survivor's design point: a validate_designs
        _SolarCruiseDesign (or a dict of its fields).
    @param expected_fingerprint The tree fingerprint recorded on the
        survivor's original verdict, or None to skip the recorded-vs-current
        comparison (the fresh-subprocess comparison still runs).
    @param check_seasonal Forwarded to screen_design in the subprocess.
    @param timeout_s Subprocess wall-clock limit, s.
    @returns The subprocess verdict: {tree_fingerprint, admissible, reasons,
        closed, min_soc}.
    @raises SweepIntegrityError On any fingerprint mismatch, or when the
        subprocess produces no verdict.
    """
    current = tree_fingerprint()
    if expected_fingerprint is not None and expected_fingerprint != current:
        raise SweepIntegrityError(
            f"survivor was scored against tree {expected_fingerprint[:12]}... "
            f"but the current tree is {current[:12]}... -- the evaluation tree "
            f"changed since scoring; re-run the sweep, do not promote")
    fields = (dataclasses.asdict(design) if dataclasses.is_dataclass(design)
              else dict(design))
    payload = json.dumps({"design": fields, "window_s": _SEASONAL_WINDOW_S,
                          "dt_s": _SEASONAL_DT_S,
                          "check_seasonal": bool(check_seasonal)})
    proc = subprocess.run(
        [sys.executable, "-c", _VERIFY_SCRIPT], input=payload,
        capture_output=True, text=True, timeout=timeout_s,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    verdict = None
    for line in proc.stdout.splitlines():
        if line.startswith("VERIFY_SURVIVOR_JSON:"):
            verdict = json.loads(line[len("VERIFY_SURVIVOR_JSON:"):])
    if verdict is None:
        raise SweepIntegrityError(
            f"fresh re-evaluation produced no verdict (exit {proc.returncode}): "
            f"{(proc.stderr or proc.stdout)[-300:]}")
    if verdict["tree_fingerprint"] != current:
        raise SweepIntegrityError(
            f"tree changed while verifying: parent saw {current[:12]}..., the "
            f"fresh subprocess ran against {verdict['tree_fingerprint'][:12]}...")
    return verdict


def screen_design(build: Any, result: Any,
                  check_seasonal: bool = True) -> tuple[bool, list[str]]:
    """Per-design admissibility for a sweep: (admissible, reasons).

    @description THE SWEEP CONTRACT. A 30,000-design optimizer calls this on
        every (build, result) pair BEFORE ranking the design; a design is
        admissible only when the returned list is empty. Every screen exists
        because a previous round's optimizer exploited its absence, and the
        checks deliberately re-use the gate's own guards so the sweep and the
        validation suite cannot drift apart:

          1. MASS DECLARATION -- Vehicle.assert_mass_declared(): an element
             with unknown mass is an unbilled cost.
          2. PARAM RE-CHECK -- vehicle.recheck_element_params on every element
             (defense in depth: an element built around __init__ is caught at
             screening even if the integrator's own re-check is bypassed).
          3. CLOSURE -- result.closed must be True, with the integrator's own
             closed_reasons quoted.
          4. SOC-FLOOR STANDOFF -- limit-cycle min_soc must clear soc_min by
             SOC_FLOOR_STANDOFF (round 2's winners all sat ON the floor).
          5. UNMET / EXCESS THRUST -- no demand silently discarded, no
             uncommanded forward force (tolerance 1e-6 x weight, matching the
             integrator's own closure test).
          6. DRAG FLOOR -- the closed-form Prandtl+Blasius bound on the
             design's trimmed polar point (winged designs with a reference
             trim only).
          7. K_EFF CEILING -- claimed harvest may not exceed the
             ALTITUDE-AWARE ceiling screen_k_eff_max(altitude) of the
             astronomical ceiling on the design's own catalogue numbers
             (solar designs only; round 4 -- 1.5 was ~2x generous at sea
             level).
          8. WING LOADING + ASPECT RATIO -- plausibility bands for the sweep
             class (winged designs only).
          9. TECHNOLOGY CATALOGUE (round 4) -- (PV efficiency, areal density)
             pairs and pack Wh/kg against cited joint frontiers of hardware
             that exists TOGETHER (vehicle/tech_catalogue.py).
         10. FUSELAGE REMAINDER FLOOR (round 4) -- the structural remainder
             must clear structure.min_fuselage_boom_tail_mass_kg for what it
             carries and the span it stabilises (winged designs).
         11. EXTRA_CD0 WETTED-AREA FLOOR (round 4) -- the declared non-wing
             parasite drag must cover the minimal wetted area the billed
             fuselage mass implies (winged designs with a reference trim).
         12. PAYLOAD FLOOR (rounds 4+5) -- the design's total avionics/payload
             draw must clear min_avionics_draw_W (AS-2's published 5.8 W
             scaled with mass^(2/3), absolute floor 1 W), and the billed
             payload mass must support that draw at <=
             AVIONICS_MAX_SPECIFIC_POWER_W_PER_KG. Round 4's "> 0 W" floor
             let every hostile survivor park at 1 mW (+1.7-2.8% measured).
         13. SEASONAL ROBUSTNESS (round 5, solar designs that closed and are
             otherwise admissible) -- the SAME ship is re-integrated at the
             SAME site on the equinox (day-of-year 80). closes_equinox is
             recorded in build.meta["seasonal_robustness"]; a design that
             closes only on its own (solstice-side) day gets the
             'flag: solstice-only' FLAG. A flag, deliberately NOT a
             rejection: high-latitude summer can be a legitimate mission
             choice, but a sweep ranking usable margin must be able to tell a
             midnight-sun specialist (measured: the same ship scores 1.5865
             at 60N solstice vs 1.3544 at the equator) from site-flat honest
             hardware.

        Screens 6-11 SKIP silently for designs without the relevant feature (a
        quadcopter has no wing) -- absence of a feature is not a violation.
        Every failed screen contributes one human-readable reason, so a sweep
        log can histogram WHY designs died.

        INTEGRITY STAMP (round 5): the verdict is stamped with
        tree_fingerprint() -- into result.detail["tree_fingerprint"] and
        build.meta["tree_fingerprint"] -- and any survivor promoted from a
        sweep MUST be re-confirmed through verify_survivor() (see the module
        docstring's SWEEP INTEGRITY CONTRACT).
    @param build The assembled design: a _Build from a validate_designs builder
        (or any object with .vehicle, .reference, .meta of the same shape).
    @param result The integrator's SimResult for the design's 24 h window.
    @param check_seasonal Run screen 13's equinox re-integration (one extra
        24 h slow-loop window; skipped automatically for designs that are not
        solar, did not close, or already failed a hard screen). False skips
        it -- for callers that only need the hard screens.
    @returns (admissible, reasons) -- admissible is True iff reasons contains
        no HARD reason; reasons prefixed FLAG_PREFIX ('flag: ') are
        informational and do not affect admissibility.
    """
    reasons: list[str] = []
    vehicle = build.vehicle

    # INTEGRITY STAMP -- the tree this verdict was scored against, on disk.
    fingerprint = tree_fingerprint()
    if isinstance(getattr(build, "meta", None), dict):
        build.meta["tree_fingerprint"] = fingerprint
    if isinstance(getattr(result, "detail", None), dict):
        result.detail["tree_fingerprint"] = fingerprint

    # 1. Mass declaration -- unbilled mass is round 2's root defect.
    try:
        vehicle.assert_mass_declared()
    except UndeclaredMassError as exc:
        reasons.append(f"mass declaration: {exc}")

    # 2. Defense-in-depth parameter re-check on the LIVE instances.
    for element in vehicle.elements:
        try:
            recheck_element_params(element)
        except Exception as exc:  # noqa: BLE001 - the reason string is the point
            reasons.append(
                f"param bounds: {type(element).__name__}: {exc}")

    # 3. Closure, in the integrator's own words.
    if not bool(result.closed):
        reasons.append(
            f"not closed: {result.detail.get('closed_reasons')}")

    # 4. SOC-floor standoff.
    packs = vehicle.batteries
    if packs:
        soc_min = max(float(getattr(p, "soc_min", 0.0)) for p in packs)
        min_soc = float(result.min_soc)
        if not (min_soc >= soc_min + SOC_FLOOR_STANDOFF):
            reasons.append(
                f"SOC standoff: limit-cycle min_soc {min_soc:.4f} is within "
                f"{SOC_FLOOR_STANDOFF} of soc_min {soc_min:.4f} -- round 2's "
                f"exploit winners all sat exactly on the floor")

    # 5. Unmet / excess thrust against the integrator's own weight scale.
    tol_N = 1e-6 * max(1.0, vehicle.weight_N())
    unmet_N = float(result.detail.get("max_unmet_thrust_N", 0.0))
    excess_N = float(result.detail.get("max_excess_thrust_N", 0.0))
    if unmet_N > tol_N:
        reasons.append(
            f"unmet thrust: {unmet_N:.4g} N of commanded thrust could not be "
            f"served (billed, and inadmissible)")
    if excess_N > tol_N:
        reasons.append(f"excess thrust: {excess_N:.4g} N of uncommanded force")

    # 6. Closed-form drag floor on the trimmed point (winged designs).
    reference = getattr(build, "reference", None)
    surfaces = [e for e in vehicle.elements if isinstance(e, AeroSurface)]
    if reference is not None and surfaces:
        geometry = surfaces[0].geometry
        report = bounds.bound_polar_point(
            CL=reference.CL, CD=reference.CD,
            cl15_over_cd=reference.cl15_over_cd,
            span_m=geometry.span_m, area_m2=geometry.area_m2,
            reynolds_chord=reference.Re,
            extra_CD0=float(build.meta.get("extra_CD0_effective",
                                           surfaces[0].extra_CD0)),
        )
        if not report.ok:
            reasons.append(f"drag floor: {'; '.join(report.violations)}")

    # 7. K_eff ceiling on the design's own catalogue numbers (solar designs).
    #    ROUND 4: the ceiling is ALTITUDE-AWARE -- 1.5 is honest at 20 km and
    #    ~2x generous at sea level. Altitude comes from the design meta;
    #    absent it, sea level (the STRICTEST ceiling) applies, fail-closed.
    meta = getattr(build, "meta", None)
    meta = meta if isinstance(meta, dict) else {}
    altitude_m = meta.get("site", {}).get("altitude_m")
    if altitude_m is None:
        altitude_m = meta.get("design", {}).get("altitude_m", 0.0)
    arrays = [e for e in vehicle.elements if isinstance(e, PVArray)]
    harvest_J = float(result.detail.get("energy_in_J", 0.0))
    if arrays and harvest_J > 0.0:
        env = build.env
        h0_J_m2 = bounds.daily_extraterrestrial_insolation_J_m2(
            env.latitude_deg, env.day_of_year)
        denom_J = h0_J_m2 * sum(
            a.area_m2 * a.packing_factor * a.cell_efficiency_stc
            * a.mppt_efficiency for a in arrays)
        if denom_J > 0.0:
            k_eff = harvest_J / denom_J
            k_eff_ceiling = screen_k_eff_max(float(altitude_m))
            if k_eff > k_eff_ceiling:
                reasons.append(
                    f"harvest bound: K_eff {k_eff:.3f} exceeds the "
                    f"altitude-aware ceiling {k_eff_ceiling:.3f} at "
                    f"{float(altitude_m):.0f} m (anchor {SCREEN_K_EFF_MAX} at "
                    f"20 km, scaled by the clear-sky attainable) -- the array "
                    f"claims more than geometry and transmittance allow")

    # 8. Wing loading and aspect ratio plausibility (winged designs).
    if surfaces:
        area_m2 = sum(s.geometry.area_m2 for s in surfaces)
        loading_N_m2 = vehicle.weight_N() / area_m2 if area_m2 > 0.0 else float("inf")
        lo, hi = SCREEN_WING_LOADING_N_M2
        if not (lo <= loading_N_m2 <= hi):
            reasons.append(
                f"wing loading {loading_N_m2:.1f} N/m2 outside the "
                f"[{lo:g}, {hi:g}] N/m2 plausibility band for the "
                f"persistent-flight class")
        ar_lo, ar_hi = SCREEN_ASPECT_RATIO
        for s in surfaces:
            ar = s.geometry.aspect_ratio
            if not (ar_lo <= ar <= ar_hi):
                reasons.append(
                    f"aspect ratio {ar:.1f} outside [{ar_lo:g}, {ar_hi:g}]")

    # 9. TECHNOLOGY CATALOGUE (round 4) -- coupled parameters must exist
    #    TOGETHER, not merely each inside its own scalar band. The measured
    #    boundary rider (0.4999 concentrator efficiency at 0.15 kg/m2 thin
    #    film + a 499.9 Wh/kg pack) died here. The same checks run inside the
    #    elements' validate_cross_params (screen #2), so a bypass-built
    #    instance is caught either way; this step names the reason.
    for a in arrays:
        try:
            check_pv_technology_pair(a.cell_efficiency_stc, a.areal_density_kg_m2)
        except TechCatalogueError as exc:
            reasons.append(str(exc))
    for p in packs:
        try:
            check_pack_technology(p.specific_energy_Wh_per_kg)
        except TechCatalogueError as exc:
            reasons.append(str(exc))

    # 10. FUSELAGE/BOOM/TAIL REMAINDER FLOOR (round 4, winged designs) -- the
    #     structural remainder must be able to CARRY the pack, payload and
    #     drive and hold a tail on a boom sized to the span. The measured
    #     boundary rider billed 1 gram; its floor is ~0.17 kg.
    if surfaces:
        budget = vehicle.mass_budget()
        remainder_kg = float(budget.total_structure_mass_kg)
        carried_kg = float(sum(
            e.mass_kg for e in vehicle.elements
            if isinstance(e, (BatteryElement, PayloadLoad, Thruster))))
        span_m = max(float(s.geometry.span_m) for s in surfaces)
        floor_kg = min_fuselage_boom_tail_mass_kg(carried_kg, span_m)
        if remainder_kg < floor_kg * (1.0 - 1.0e-9):
            reasons.append(
                f"fuselage floor: structural remainder {remainder_kg:.4f} kg "
                f"cannot be the pod/boom/tail that carries {carried_kg:.3f} kg "
                f"of pack+payload+drive on a {span_m:.2f} m span -- the "
                f"AS-2-anchored floor is {floor_kg:.3f} kg "
                f"(structure.min_fuselage_boom_tail_mass_kg)")

    # 11. EXTRA_CD0 SHELL/SLENDER-BODY FLOOR (rounds 4+5, winged designs with
    #     a reference trim) -- a fuselage that weighs something wets something.
    #     Round 4's solid-composite-sphere bound was measured 60-200x below
    #     any flown airframe (case-A class ~2e-5 vs the honest 0.006; riding
    #     0.0025 -> 0.0001 bought +3.4% usable). The floor now lives with the
    #     physics that owns it, structure.min_extra_CD0: the CARRIED mass
    #     (same set screen #10 feeds the fuselage mass floor) packed at a
    #     realistic pod bulk density inside a slender minimum-surface shell,
    #     plus AS-2-anchored boom+tail wetted area scaled to span, at a
    #     half-laminar/half-turbulent flat-plate Cf with Hoerner's
    #     form/interference floor. Case-A class lands at ~3.4e-3 (factor ~1.8
    #     below the honest 0.006), so a declared 0.0001 on a kg-scale pod now
    #     REFUSES instead of riding.
    if surfaces and reference is not None:
        area_m2 = sum(s.geometry.area_m2 for s in surfaces)
        carried_kg = float(sum(
            e.mass_kg for e in vehicle.elements
            if isinstance(e, (BatteryElement, PayloadLoad, Thruster))))
        span_m = max(float(s.geometry.span_m) for s in surfaces)
        if area_m2 > 0.0 and float(reference.Re) > 0.0:
            extra_cd0_floor = min_extra_CD0(
                carried_kg, span_m, area_m2, float(reference.Re))
            extra_cd0 = float(build.meta.get("extra_CD0_effective",
                                             surfaces[0].extra_CD0))
            if extra_cd0 < extra_cd0_floor * (1.0 - 1.0e-9):
                reasons.append(
                    f"extra_CD0 floor: declared {extra_cd0:.3g} is below the "
                    f"shell/slender-body estimate {extra_cd0_floor:.3g} for a "
                    f"pod packing {carried_kg:.3f} kg of pack+payload+drive "
                    f"plus a boom and tail on a {span_m:.2f} m span (laminar-"
                    f"capped flat-plate Cf at Re {float(reference.Re):.0f}, "
                    f"Hoerner form/interference floor; "
                    f"structure.min_extra_CD0) -- a fuselage that weighs "
                    f"something wets something, and it is a SHELL, not a "
                    f"solid billet")

    # 12. PAYLOAD FLOOR (rounds 4+5, solar designs) -- an aircraft with a
    #     token avionics draw cannot fly a mission. Round 4 required "> 0 W";
    #     every hostile search survivor then parked at 1 mW (measured worth
    #     +1.7-2.8% usable). The floor is now a real wattage scaled from the
    #     AS-2 anchor, and the billed payload mass must support the draw.
    if arrays:
        payload_draw_W = sum(
            float(e.power_W) for e in vehicle.elements
            if isinstance(e, PayloadLoad))
        payload_mass_kg = sum(
            float(e.mass_kg) for e in vehicle.elements
            if isinstance(e, PayloadLoad))
        total_mass_kg = float(vehicle.total_mass_kg())
        floor_W = min_avionics_draw_W(total_mass_kg)
        if payload_draw_W < floor_W * (1.0 - 1.0e-9):
            reasons.append(
                f"payload floor: total avionics/payload draw "
                f"{payload_draw_W:.4g} W is below the "
                f"{floor_W:.2f} W floor for a {total_mass_kg:.2f} kg aircraft "
                f"(AS-2 anchor 5.8 W at 6.93 kg scaled with mass^(2/3), "
                f"absolute floor {AVIONICS_MIN_DRAW_W:g} W) -- autopilot, "
                f"radios and sensors are not optional on a mission aircraft; "
                f"a token draw is an optimizer artifact")
        min_payload_mass_kg = (payload_draw_W
                               / AVIONICS_MAX_SPECIFIC_POWER_W_PER_KG)
        if payload_draw_W > 0.0 and payload_mass_kg < min_payload_mass_kg * (1.0 - 1.0e-9):
            reasons.append(
                f"payload mass: {payload_mass_kg:.4g} kg of payload cannot "
                f"draw {payload_draw_W:.4g} W -- that is "
                f"{payload_draw_W / max(payload_mass_kg, 1e-12):.0f} W/kg "
                f"installed against the "
                f"{AVIONICS_MAX_SPECIFIC_POWER_W_PER_KG:g} W/kg ceiling "
                f"(densest catalogued suite: AS-2 at 38.7 W/kg)")

    # 13. SEASONAL ROBUSTNESS (round 5, solar designs) -- re-close the SAME
    #     ship at the SAME site on the equinox. Only run when the design
    #     closed and no HARD screen has fired (a rejected design needs no
    #     seasonal diagnosis), and only when the caller asked for it.
    hard_reasons = [r for r in reasons if not r.startswith(FLAG_PREFIX)]
    env = getattr(build, "env", None)
    if (check_seasonal and arrays and env is not None
            and bool(result.closed) and not hard_reasons):
        if int(env.day_of_year) == EQUINOX_DAY_OF_YEAR:
            closes_equinox = True
            equinox_min_soc = float(result.min_soc)
        else:
            eq_length_h = float(day_length_h(env.latitude_deg,
                                             EQUINOX_DAY_OF_YEAR))
            eq_env = EnvBundle(
                wind=env.wind, latitude_deg=env.latitude_deg,
                longitude_deg=env.longitude_deg,
                day_of_year=EQUINOX_DAY_OF_YEAR,
                utc_hour_at_t0_h=((12.0 - env.longitude_deg / 15.0)
                                  + 0.5 * eq_length_h),
            )
            eq_result = integrate_energy(_copy.deepcopy(vehicle), eq_env, 0.0,
                                         _SEASONAL_WINDOW_S, _SEASONAL_DT_S)
            closes_equinox = bool(eq_result.closed)
            equinox_min_soc = float(eq_result.min_soc)
        if isinstance(getattr(build, "meta", None), dict):
            build.meta["seasonal_robustness"] = {
                "equinox_day_of_year": EQUINOX_DAY_OF_YEAR,
                "design_day_of_year": int(env.day_of_year),
                "closes_equinox": closes_equinox,
                "equinox_min_soc": equinox_min_soc,
            }
        if not closes_equinox:
            reasons.append(
                f"{FLAG_PREFIX}solstice-only: closes on its own day "
                f"{int(env.day_of_year)} but NOT at the equinox (doy "
                f"{EQUINOX_DAY_OF_YEAR}, same site, equinox min_soc "
                f"{equinox_min_soc:.4f}) -- a seasonal specialist, not "
                f"site-flat hardware; flagged, not rejected, because "
                f"latitude/season may be a legitimate mission choice")
        hard_reasons = [r for r in reasons if not r.startswith(FLAG_PREFIX)]

    return (not hard_reasons), reasons


