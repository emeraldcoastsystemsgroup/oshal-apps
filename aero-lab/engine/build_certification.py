"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the physical
  |                                           | build-certification gate. Every export
  |                                           | now carries a buildCertification block that
  |                                           | reads "not certified" and lists the
  |                                           | pressure / material / purity / mass evidence
  |                                           | the exported design needs; a pure
  |                                           | reconcile_build_evidence() certifies a build
  |                                           | only when every applicable class reconciles
  |                                           | to that design. An engine verdict certifies
  |                                           | a simulation; only this certifies hardware.

aero-lab build certification.

WHY. The exporter's files are a simulation's output. Four physical facts
decide whether the thing a person builds is the thing the engine flew, and
each has already been measured wrong on the reference Floater
(../BACKLOG.md section C):

  pressure  A sealed film cell cannot take the diurnal superheat
            (HYBRID_PEAK_SUPERPRESSURE_PA measured sealed); it needs a vented
            relief holding the cell at the film-stress setpoint, or a
            superpressure structure rated past that peak.
  material  The barrier film must be the ledger's film, at its areal density
            and no leakier than its permeability datum.
  purity    Party helium (>= 80 %) drops f 0.800 -> 0.703 and the design
            closes on no pack; only high-purity helium is the gas the engine
            flew.
  mass      Real parts weighed 274 g over the certified ledger; a build is the
            ledger only when every line is weighed and the total agrees.

For a pure fixed-wing export (buoyancy_fraction 0) pressure, material and
purity do not apply and say so; mass always applies.

This module is PURE: no file I/O, no clock, no network. The exporter writes
build_certification_block(snapshot) into design_snapshot.json and
BUILD_SHEET.md; reconcile_build_evidence(snapshot, evidence) is the only path
to certified=True.
"""

from __future__ import annotations

import math
from typing import Any

from aerosim.vehicle.buoyancy import (
    ENVELOPE_FILM_AREAL_DENSITY_KG_M2,
    HELIUM_PERMEABILITY_25C_MOL_M_S_PA,
)
from aerosim.vehicle.hull import HYBRID_PEAK_SUPERPRESSURE_PA, VENT_SETPOINT_PA

SCHEMA = "aero-lab.build-certification/1"
CLASSES = ("pressure", "material", "purity", "mass")

#: The film the exported hybrid was flown with: service._attach_buoyancy builds
#: BuoyancyVolume without envelope_film, so its default applies
#: (tests/test_build_certification_gate.py asserts the two agree).
LEDGER_FILM = "lldpe_38um"

#: Minimum helium purity, mole fraction. reference-design/BOM_v2_deltas.csv
#: (helium cylinder row): "you must specify 99.995%"; the party tank's own
#: label is "not less than 80 percent helium".
HELIUM_PURITY_MIN_FRAC = 0.99995

#: Declared judgment bands (like real_chain's +/-15 % claim band): the film
#: gauge tolerance on areal density, and the LLDPE permeability proxy's own
#: +/-20 % honesty band (buoyancy.py HONESTY H15) as the leak allowance.
FILM_AREAL_DENSITY_BAND_FRAC = 0.10
FILM_PERMEABILITY_ALLOWANCE_FRAC = 0.20

#: Declared judgment bands on the weighed ledger: the all-up total within 2 %
#: of the exported ledger, each line within max(5 g, 10 %) of its row.
MASS_TOTAL_BAND_FRAC = 0.02
MASS_LINE_BAND_FRAC = 0.10
MASS_LINE_FLOOR_G = 5.0

#: Relief shapes a sealed cell may use (buoyancy.BuoyancyVolume hull_structure
#: vocabulary: a vented ballonet / vent valve, or a superpressure structure).
VENTED_RELIEFS = frozenset({"vented_ballonet", "vent_valve"})
SUPERPRESSURE_RELIEFS = frozenset({"superpressure_structure"})


def _is_hybrid(snapshot: dict) -> bool:
    """@description True when the exported design carries a buoyant envelope.
    @param snapshot The exported design_snapshot.json object.
    @returns bool."""
    vector = snapshot.get("design_vector") or {}
    hybrid = (snapshot.get("evaluation") or {}).get("hybrid")
    return bool(hybrid) or float(vector.get("buoyancy_fraction", 0.0) or 0.0) > 0.0


def _ledger(snapshot: dict) -> tuple[list[dict], float]:
    """@description The exported mass ledger as grams.
    @param snapshot The exported snapshot.
    @returns ([{label, mass_g}], total_g).
    @raises ValueError When the snapshot carries no mass ledger."""
    build = (snapshot.get("evaluation") or {}).get("build") or {}
    rows = build.get("massBreakdown")
    if not isinstance(rows, list) or not rows:
        raise ValueError("snapshot has no evaluation.build.massBreakdown ledger")
    lines = [{"label": str(r["label"]), "mass_g": float(r["kg"]) * 1000.0} for r in rows]
    return lines, float(build["massAllUpKg"]) * 1000.0


def requirements(snapshot: dict) -> list[dict]:
    """@description The evidence each class needs for THIS exported design.
    @param snapshot The exported snapshot.
    @returns One {class, applies, requires} per CLASSES entry, in order."""
    hybrid = _is_hybrid(snapshot)
    lines, total_g = _ledger(snapshot)
    return [
        {"class": "pressure", "applies": hybrid, "requires": {
            "relief": sorted(VENTED_RELIEFS | SUPERPRESSURE_RELIEFS),
            "vented_setpoint_max_Pa": VENT_SETPOINT_PA,
            "superpressure_rating_min_Pa": HYBRID_PEAK_SUPERPRESSURE_PA}},
        {"class": "material", "applies": hybrid, "requires": {
            "film": LEDGER_FILM,
            "areal_density_kg_m2": ENVELOPE_FILM_AREAL_DENSITY_KG_M2[LEDGER_FILM],
            "areal_density_band_frac": FILM_AREAL_DENSITY_BAND_FRAC,
            "he_permeability_25C_max_mol_m_s_Pa":
                HELIUM_PERMEABILITY_25C_MOL_M_S_PA[LEDGER_FILM]
                * (1.0 + FILM_PERMEABILITY_ALLOWANCE_FRAC)}},
        {"class": "purity", "applies": hybrid, "requires": {
            "helium_purity_min_frac": HELIUM_PURITY_MIN_FRAC}},
        {"class": "mass", "applies": True, "requires": {
            "ledger": lines, "total_g": total_g,
            "total_band_frac": MASS_TOTAL_BAND_FRAC,
            "line_band_frac": MASS_LINE_BAND_FRAC,
            "line_floor_g": MASS_LINE_FLOOR_G}},
    ]


def _miss(cls: str, code: str, **detail: Any) -> dict:
    """@description One structured mismatch.
    @param cls Evidence class.  @param code Mismatch code.
    @param detail Its numbers/labels.
    @returns {class, code, **detail}."""
    return {"class": cls, "code": code, **detail}


def _finite(value: Any) -> float | None:
    """@description A finite float, or None for anything else.
    @param value Raw evidence value.
    @returns float | None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(float(value)) else None


def _check_pressure(req: dict, ev: dict) -> list[dict]:
    """@description A sealed cell needs a relief that holds it at the vent
        setpoint, or a structure rated past the measured sealed peak.
    @param req The pressure requirement.  @param ev The pressure evidence.
    @returns Mismatches (empty when reconciled)."""
    relief = ev.get("relief")
    if relief in VENTED_RELIEFS:
        setpoint = _finite(ev.get("relief_setpoint_Pa"))
        limit = req["requires"]["vented_setpoint_max_Pa"]
        if setpoint is None or setpoint > limit:
            return [_miss("pressure", "relief_setpoint_above_film_limit",
                          measured_Pa=setpoint, limit_Pa=limit)]
        return []
    if relief in SUPERPRESSURE_RELIEFS:
        rating = _finite(ev.get("rated_superpressure_Pa"))
        need = req["requires"]["superpressure_rating_min_Pa"]
        if rating is None or rating < need:
            return [_miss("pressure", "superpressure_rating_below_peak",
                          measured_Pa=rating, required_Pa=need)]
        return []
    return [_miss("pressure", "relief_missing", relief=relief)]


def _check_material(req: dict, ev: dict) -> list[dict]:
    """@description The film must be the ledger's, at its density, no leakier.
    @param req The material requirement.  @param ev The material evidence.
    @returns Mismatches."""
    need = req["requires"]
    if ev.get("film") != need["film"]:
        return [_miss("material", "film_mismatch", measured=ev.get("film"),
                      required=need["film"])]
    out: list[dict] = []
    density = _finite(ev.get("areal_density_kg_m2"))
    nominal = need["areal_density_kg_m2"]
    if density is None or abs(density - nominal) > need["areal_density_band_frac"] * nominal:
        out.append(_miss("material", "film_areal_density_out_of_band",
                         measured_kg_m2=density, ledger_kg_m2=nominal,
                         band_frac=need["areal_density_band_frac"]))
    perm = _finite(ev.get("he_permeability_25C_mol_m_s_Pa"))
    ceiling = need["he_permeability_25C_max_mol_m_s_Pa"]
    if perm is None or perm > ceiling:
        out.append(_miss("material", "film_permeability_above_ledger",
                         measured=perm, ceiling=ceiling))
    return out


def _check_purity(req: dict, ev: dict) -> list[dict]:
    """@description The lifting gas must be the high-purity helium the engine flew.
    @param req The purity requirement.  @param ev The purity evidence.
    @returns Mismatches."""
    purity = _finite(ev.get("helium_purity_frac"))
    need = req["requires"]["helium_purity_min_frac"]
    if purity is None or purity < need:
        return [_miss("purity", "helium_purity_below_minimum",
                      measured_frac=purity, required_frac=need)]
    return []


def _check_mass(req: dict, ev: dict) -> list[dict]:
    """@description Every ledger line weighed and inside its band, nothing
        weighed that the ledger does not carry, and the total inside its band.
    @param req The mass requirement.  @param ev {weighed: [{label, mass_g}]}.
    @returns Mismatches."""
    need = req["requires"]
    weighed = {}
    for row in ev.get("weighed") or []:
        grams = _finite(row.get("mass_g")) if isinstance(row, dict) else None
        if grams is not None:
            weighed[str(row.get("label"))] = grams
    out: list[dict] = []
    for line in need["ledger"]:
        got = weighed.pop(line["label"], None)
        if got is None:
            out.append(_miss("mass", "mass_line_unweighed", label=line["label"]))
            continue
        band = max(need["line_floor_g"], need["line_band_frac"] * line["mass_g"])
        if abs(got - line["mass_g"]) > band:
            out.append(_miss("mass", "mass_line_out_of_band", label=line["label"],
                             weighed_g=got, ledger_g=line["mass_g"], band_g=band))
    for label, grams in sorted(weighed.items()):
        out.append(_miss("mass", "mass_item_not_in_ledger", label=label, weighed_g=grams))
    total = sum(float(r["mass_g"]) for r in (ev.get("weighed") or [])
                if isinstance(r, dict) and _finite(r.get("mass_g")) is not None)
    band_g = need["total_band_frac"] * need["total_g"]
    if abs(total - need["total_g"]) > band_g:
        out.append(_miss("mass", "mass_total_out_of_band", weighed_g=total,
                         ledger_g=need["total_g"], delta_g=total - need["total_g"],
                         band_g=band_g))
    return out


_CHECKS = {"pressure": _check_pressure, "material": _check_material,
           "purity": _check_purity, "mass": _check_mass}


def reconcile_build_evidence(snapshot: dict, evidence: dict | None) -> dict:
    """@description Certify a physical build against its exported design.
        certified is True ONLY when every applicable class has evidence and
        every check reconciles; anything missing or mismatched refuses.
    @param snapshot The exported design_snapshot.json object.
    @param evidence {pressure?, material?, purity?, mass?: {weighed: [...]}} or None.
    @returns {schema, certified, status, mismatches[], classes{cls: state}}."""
    evidence = evidence if isinstance(evidence, dict) else {}
    mismatches: list[dict] = []
    classes: dict[str, str] = {}
    for req in requirements(snapshot):
        cls = req["class"]
        if not req["applies"]:
            classes[cls] = "not-applicable"
            continue
        ev = evidence.get(cls)
        if not isinstance(ev, dict):
            mismatches.append(_miss(cls, "evidence_missing"))
            classes[cls] = "missing"
            continue
        found = _CHECKS[cls](req, ev)
        mismatches += found
        classes[cls] = "mismatch" if found else "reconciled"
    certified = not mismatches
    return {"schema": SCHEMA, "certified": certified,
            "status": "certified" if certified else "not certified",
            "mismatches": mismatches, "classes": classes}


def build_certification_block(snapshot: dict) -> dict:
    """@description The block every export writes: not certified, the
        requirements, and one blocker per applicable class (no evidence has
        been reconciled at export time, by construction).
    @param snapshot The exported snapshot (design_vector + evaluation).
    @returns {schema, status, certified, rule, requirements, blockers}."""
    verdict = reconcile_build_evidence(snapshot, None)
    return {
        "schema": SCHEMA,
        "status": verdict["status"],
        "certified": verdict["certified"],
        "rule": ("No build is certified until its pressure, material, purity and "
                 "mass evidence reconciles to this exported design "
                 "(build_certification.reconcile_build_evidence)."),
        "requirements": requirements(snapshot),
        "blockers": verdict["mismatches"],
    }


__all__ = [
    "CLASSES", "HELIUM_PURITY_MIN_FRAC", "LEDGER_FILM", "SCHEMA",
    "build_certification_block", "reconcile_build_evidence", "requirements",
]
