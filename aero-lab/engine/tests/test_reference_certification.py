"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | The four shipped reference presets
  |                                           | (tier1, fixedwing, hybrid80, r7winner) on
  |                                           | the fingerprinted REAL chain through the
  |                                           | service's own 'certify' command: every
  |                                           | preset passes, or fails with at least one
  |                                           | reason from the closed validity set --
  |                                           | never an untyped error. The measured
  |                                           | outcomes are pinned so a re-sized preset
  |                                           | (package BACKLOG A) has to move this
  |                                           | record and the README together. A rerun is
  |                                           | identical, and the public evaluate default
  |                                           | is still the ideal chain.

Cost: one full certify (about a minute: three presets refuse at build, the
fixed wing flies a 24 h / 60 s real-chain window) plus a one-preset rerun.
"""

from __future__ import annotations

import inspect
import json

import pytest

import certify_reference
import service
from aerosim import validity
from aerosim.validate_designs import build_solar_cruise
from aerosim.validate_screen import tree_fingerprint

KEYS = ["tier1", "fixedwing", "hybrid80", "r7winner"]

#: Measured on this tree (engine/TEST_STATUS.md, 2026-09-27): each preset's
#: first structured reason on the real chain.
EXPECTED_FIRST_REASON = {
    "tier1": ("build", "negative_airframe_mass"),
    "fixedwing": ("flight", "soc_not_persistent"),
    "hybrid80": ("build", "negative_airframe_mass"),
    "r7winner": ("build", "param_out_of_bounds"),
}


@pytest.fixture(scope="module")
def report() -> dict:
    """One real certify run, through the service command the worker serves."""
    return service._json_safe(service.cmd_certify({}))


def test_certify_is_a_served_command_with_a_capability_flag() -> None:
    assert service.COMMANDS["certify"] is service.cmd_certify
    assert service._caps()["certify"] is True


def test_report_is_stamped_with_the_engine_that_produced_it(report) -> None:
    assert report["schema"] == certify_reference.SCHEMA
    assert report["chain"] == "real"
    assert report["engineFingerprint"] == service._fingerprint()
    assert report["treeFingerprint"] == tree_fingerprint()
    assert report["windowS"] == 86400.0 and report["dtS"] == 60.0


def test_the_four_presets_run_in_file_order(report) -> None:
    assert [p["key"] for p in report["presets"]] == KEYS
    assert [p["key"] for p in certify_reference.load_presets()] == KEYS


def test_every_preset_passes_or_fails_for_a_structured_reason(report) -> None:
    for preset in report["presets"]:
        assert preset["outcome"] in ("pass", "fail"), (preset["key"], preset.get("error"))
        if preset["outcome"] == "fail":
            assert preset["reasons"], preset["key"]
        for reason in preset["reasons"] + preset["flags"]:
            assert validity.is_reason(reason), (preset["key"], reason)
    assert report["summary"]["error"] == 0
    assert sum(report["summary"].values()) == 4


def test_measured_outcomes_are_pinned(report) -> None:
    for preset in report["presets"]:
        stage, code = EXPECTED_FIRST_REASON[preset["key"]]
        assert preset["outcome"] == "fail"
        assert (preset["stage"], preset["reasons"][0]["code"]) == (stage, code), preset


def test_failing_numbers_are_the_engines_own(report) -> None:
    by_key = {p["key"]: p for p in report["presets"]}
    fixed = by_key["fixedwing"]
    soc = fixed["reasons"][0]
    assert soc["soc_end"] < soc["soc_start"] == pytest.approx(1.0)
    assert soc["min_soc"] == pytest.approx(fixed["metrics"]["minSoc"])
    assert fixed["metrics"]["certified"] is True and fixed["metrics"]["closed"] is False
    assert fixed["pack"]["topology"] == "6s6p"
    r7 = by_key["r7winner"]["reasons"][0]
    assert r7["param"] == "PVArrayDiode.cell_efficiency_stc"
    assert not (r7["lo"] <= r7["value"] <= r7["hi"])
    for key in ("tier1", "hybrid80"):
        mass = by_key[key]["reasons"][0]
        assert mass["structure_kg"] < 0.0


def test_a_rerun_is_identical(report) -> None:
    again = service._json_safe(service.cmd_certify({"keys": ["fixedwing"]}))
    first = next(p for p in report["presets"] if p["key"] == "fixedwing")
    assert json.dumps(again["presets"][0], sort_keys=True) == json.dumps(first, sort_keys=True)


def test_unknown_preset_key_is_a_caller_error() -> None:
    with pytest.raises(service.WorkerError) as info:
        service.cmd_certify({"keys": ["nope"]})
    assert info.value.code == "invalid_design"
    with pytest.raises(service.WorkerError):
        service.cmd_certify({"keys": "tier1"})


def test_public_evaluate_default_is_still_the_ideal_chain() -> None:
    assert inspect.signature(build_solar_cruise).parameters["chain"].default == "ideal"
    assert "chain=" not in inspect.getsource(service._run_chain)
