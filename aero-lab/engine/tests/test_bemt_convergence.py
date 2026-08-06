"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Certify the real BEMT solver's
    combined swirl stop and thrust/torque/efficiency stability across the
    required 25/51/101-station resolutions using the vendored UIUC boundary.
"""

from __future__ import annotations

import pytest

from aerosim.prop import (
    BEMT_STABILITY_STATIONS,
    PROP_CATALOGUE,
    SWIRL_ABS_TOL_MS,
    SWIRL_REL_TOL,
    station_stability_report,
)


@pytest.fixture(scope="module")
def anchor_report() -> dict:
    """
    @description Exercise the real AeroSandbox/NeuralFoil-backed BEMT seam at
        the UIUC 10x4.7 dynamic anchor rather than a mocked section solver.
    @returns The production station-stability report.
    """
    return station_stability_report(
        PROP_CATALOGUE["apcsf_10x47"],
        12.0,
        6512.0,
        1.225,
        288.15,
        n_crit=9.0,
    )


def test_swirl_convergence_is_measured_and_scale_aware(anchor_report: dict) -> None:
    """Every accepted point exposes the exact combined convergence decision."""
    assert anchor_report["stations"] == list(BEMT_STABILITY_STATIONS)
    assert SWIRL_ABS_TOL_MS == 2.5e-3
    assert SWIRL_REL_TOL > 0.0
    for point in anchor_report["points"].values():
        assert 0 < point["outer_iterations"] <= 100
        assert point["swirl_residual_ms"] <= point["swirl_tolerance_ms"]
        assert point["swirl_tolerance_ms"] >= SWIRL_ABS_TOL_MS
        assert point["valid"] is True


def test_thrust_torque_and_efficiency_are_stable_at_25_51_101_stations(
    anchor_report: dict,
) -> None:
    """Discretisation must clear every measured absolute/relative output wall."""
    assert anchor_report["all_stable"] is True
    assert set(anchor_report["metrics"]) == {"thrust_N", "torque_Nm", "eta"}
    for metric in anchor_report["metrics"].values():
        assert metric["abs_tolerance"] > 0.0
        assert metric["rel_tolerance"] > 0.0
        assert metric["stable"] is True
        assert all(row["delta"] <= row["limit"] for row in metric["comparisons"])
