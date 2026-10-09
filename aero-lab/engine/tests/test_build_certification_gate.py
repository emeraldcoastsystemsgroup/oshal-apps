"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | The physical build-certification gate:
  |                                           | an export is never certified; no evidence
  |                                           | is four blockers on a hybrid (one on a
  |                                           | fixed wing); each class refuses on the
  |                                           | facts already recorded against the Floater
  |                                           | (80 % party helium, a sealed cell with no
  |                                           | vent, parts 274 g over the ledger, the
  |                                           | wrong film); matching evidence certifies;
  |                                           | and a real export still writes every file
  |                                           | plus the block, with the BOM's helium line
  |                                           | stating the purity instead of
  |                                           | "balloon-grade".

The export case runs the service's own export command once on the hybrid80
preset (ideal chain, as the public route does) into a pytest temp dir.
"""

from __future__ import annotations

import copy
import csv
import inspect
import json

import pytest

import build_certification as bc
import certify_reference
import service
from aerosim.vehicle.buoyancy import (
    BuoyancyVolume,
    ENVELOPE_FILM_AREAL_DENSITY_KG_M2,
    HELIUM_PERMEABILITY_25C_MOL_M_S_PA,
)
from aerosim.vehicle.hull import HYBRID_PEAK_SUPERPRESSURE_PA, VENT_SETPOINT_PA


def _preset(key: str) -> dict:
    return next(p for p in certify_reference.load_presets() if p["key"] == key)


@pytest.fixture(scope="module")
def export_dir(tmp_path_factory):
    """One real export of the hybrid80 preset through service.cmd_export."""
    work = tmp_path_factory.mktemp("aero-export")
    out = service.cmd_export({"design": _preset("hybrid80")["v"], "workDir": str(work)})
    return work / "exports" / out["exportId"], out["files"]


@pytest.fixture(scope="module")
def snapshot(export_dir) -> dict:
    folder, _files = export_dir
    return json.loads((folder / "design_snapshot.json").read_text(encoding="utf-8"))


def _matching_evidence(snapshot: dict) -> dict:
    """Evidence that reconciles: vented relief at the setpoint, the ledger film,
    99.995 % helium, every ledger line weighed at its ledger mass."""
    lines = bc.requirements(snapshot)[3]["requires"]["ledger"]
    return {
        "pressure": {"relief": "vented_ballonet", "relief_setpoint_Pa": VENT_SETPOINT_PA},
        "material": {"film": "lldpe_38um",
                     "areal_density_kg_m2": ENVELOPE_FILM_AREAL_DENSITY_KG_M2["lldpe_38um"],
                     "he_permeability_25C_mol_m_s_Pa":
                         HELIUM_PERMEABILITY_25C_MOL_M_S_PA["lldpe_38um"]},
        "purity": {"helium_purity_frac": 0.99995},
        "mass": {"weighed": [{"label": ln["label"], "mass_g": ln["mass_g"]} for ln in lines]},
    }


def _codes(verdict: dict) -> list[tuple[str, str]]:
    return [(m["class"], m["code"]) for m in verdict["mismatches"]]


# --------------------------------------------------------------------------- #

def test_ledger_film_is_the_film_the_service_flies() -> None:
    default = inspect.signature(BuoyancyVolume.__init__).parameters["envelope_film"].default
    assert bc.LEDGER_FILM == default
    assert "envelope_film" not in inspect.getsource(service._attach_buoyancy)


def test_export_writes_every_file_and_an_uncertified_block(export_dir, snapshot) -> None:
    folder, files = export_dir
    for name in files:
        assert (folder / name).is_file(), name
    for name in ("design_snapshot.json", "BUILD_SHEET.md", "BOM.csv", "hull_gore.dxf",
                 "wing.stl", "verify_stl.json"):
        assert name in files
    block = snapshot["buildCertification"]
    assert block["status"] == "not certified" and block["certified"] is False
    assert [r["class"] for r in block["requirements"]] == list(bc.CLASSES)
    assert all(r["applies"] for r in block["requirements"])
    assert [(b["class"], b["code"]) for b in block["blockers"]] == [
        (c, "evidence_missing") for c in bc.CLASSES]
    sheet = (folder / "BUILD_SHEET.md").read_text(encoding="utf-8")
    assert "## Build certification" in sheet and "**not certified**" in sheet
    assert sheet.count("- blocker: ") == 4


def test_bom_helium_line_states_the_purity(export_dir) -> None:
    folder, _files = export_dir
    rows = list(csv.reader((folder / "BOM.csv").open(encoding="utf-8")))
    helium = next(r for r in rows if r[0] == "helium")
    assert "balloon-grade" not in helium[2]
    assert "99.995" in helium[2]
    film = next(r for r in rows if r[0] == "envelope film + tapes")
    assert "relief" in film[2]


def test_no_evidence_is_four_blockers_on_a_hybrid(snapshot) -> None:
    verdict = bc.reconcile_build_evidence(snapshot, None)
    assert verdict["certified"] is False and verdict["status"] == "not certified"
    assert _codes(verdict) == [(c, "evidence_missing") for c in bc.CLASSES]


def test_fixed_wing_needs_only_mass_evidence(snapshot) -> None:
    fixed = copy.deepcopy(snapshot)
    fixed["design_vector"]["buoyancy_fraction"] = 0.0
    fixed["evaluation"]["hybrid"] = None
    verdict = bc.reconcile_build_evidence(fixed, None)
    assert _codes(verdict) == [("mass", "evidence_missing")]
    assert verdict["classes"]["pressure"] == "not-applicable"


def test_matching_evidence_certifies(snapshot) -> None:
    verdict = bc.reconcile_build_evidence(snapshot, _matching_evidence(snapshot))
    assert verdict["certified"] is True, verdict["mismatches"]
    assert set(verdict["classes"].values()) == {"reconciled"}


def test_party_helium_refuses(snapshot) -> None:
    """Recorded: 80 % party helium drops f 0.800 -> 0.703 (BACKLOG C)."""
    ev = _matching_evidence(snapshot)
    ev["purity"] = {"helium_purity_frac": 0.80}
    verdict = bc.reconcile_build_evidence(snapshot, ev)
    assert _codes(verdict) == [("purity", "helium_purity_below_minimum")]
    assert verdict["mismatches"][0]["measured_frac"] == 0.80


def test_sealed_cell_without_a_vent_refuses(snapshot) -> None:
    """Recorded: the sealed build has no vent/ballonet (BACKLOG C)."""
    ev = _matching_evidence(snapshot)
    ev["pressure"] = {"relief": "none"}
    assert _codes(bc.reconcile_build_evidence(snapshot, ev)) == [("pressure", "relief_missing")]
    ev["pressure"] = {"relief": "vent_valve", "relief_setpoint_Pa": 500.0}
    assert _codes(bc.reconcile_build_evidence(snapshot, ev)) == [
        ("pressure", "relief_setpoint_above_film_limit")]
    ev["pressure"] = {"relief": "superpressure_structure",
                      "rated_superpressure_Pa": HYBRID_PEAK_SUPERPRESSURE_PA - 1.0}
    assert _codes(bc.reconcile_build_evidence(snapshot, ev)) == [
        ("pressure", "superpressure_rating_below_peak")]
    ev["pressure"]["rated_superpressure_Pa"] = HYBRID_PEAK_SUPERPRESSURE_PA
    assert bc.reconcile_build_evidence(snapshot, ev)["certified"] is True


def test_as_built_parts_over_the_ledger_refuse(snapshot) -> None:
    """Recorded (BACKLOG C): the DIY pack +92 g, motor/ESC/prop +65 g, and an
    MPPT the ledger carried as 0 g (+57 g)."""
    ev = _matching_evidence(snapshot)
    weighed = ev["mass"]["weighed"]
    for row in weighed:
        if row["label"] == "battery pack":
            row["mass_g"] += 92.0
        if row["label"] == "propulsion":
            row["mass_g"] += 65.0
    weighed.append({"label": "MPPT", "mass_g": 57.0})
    verdict = bc.reconcile_build_evidence(snapshot, ev)
    codes = _codes(verdict)
    assert ("mass", "mass_line_out_of_band") in codes
    assert ("mass", "mass_item_not_in_ledger") in codes
    total = next(m for m in verdict["mismatches"] if m["code"] == "mass_total_out_of_band")
    assert total["delta_g"] == pytest.approx(92.0 + 65.0 + 57.0)
    assert {m["label"] for m in verdict["mismatches"]
            if m["code"] == "mass_line_out_of_band"} == {"battery pack", "propulsion"}


def test_an_unweighed_line_refuses(snapshot) -> None:
    ev = _matching_evidence(snapshot)
    ev["mass"]["weighed"] = [r for r in ev["mass"]["weighed"] if r["label"] != "helium"]
    codes = _codes(bc.reconcile_build_evidence(snapshot, ev))
    assert ("mass", "mass_line_unweighed") in codes


def test_the_wrong_or_leaky_film_refuses(snapshot) -> None:
    ev = _matching_evidence(snapshot)
    ev["material"] = dict(ev["material"], film="mylar_38um")
    assert _codes(bc.reconcile_build_evidence(snapshot, ev)) == [("material", "film_mismatch")]
    ev = _matching_evidence(snapshot)
    ev["material"]["areal_density_kg_m2"] *= 2.0          # the 70 g/m2 laminate
    ev["material"]["he_permeability_25C_mol_m_s_Pa"] *= 1.5
    assert _codes(bc.reconcile_build_evidence(snapshot, ev)) == [
        ("material", "film_areal_density_out_of_band"),
        ("material", "film_permeability_above_ledger")]
