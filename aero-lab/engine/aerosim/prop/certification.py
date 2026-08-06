"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Derive and report the BEMT
    25/51/101-station thrust, torque and efficiency stability contract without
    growing the production solver past its decomposition threshold.
"""

from __future__ import annotations

from .bemt import PropGeometry, PropPoint, solve_prop_point

__all__ = [
    "BEMT_STABILITY_STATIONS",
    "BEMT_STABILITY_TOLERANCES",
    "station_stability_report",
]

#: Certification resolutions required by APP-03.
BEMT_STABILITY_STATIONS: tuple[int, int, int] = (25, 51, 101)

#: Combined (absolute, relative) output tolerances. At the UIUC 10x4.7
#: dynamic anchor, 25-vs-101 stations differ by 0.00601 N thrust, 0.000321 Nm
#: torque and 0.00123 eta. These limits retain measured headroom while staying
#: below the UIUC model-to-measurement acceptance bands.
BEMT_STABILITY_TOLERANCES: dict[str, tuple[float, float]] = {
    "thrust_N": (1.0e-2, 3.0e-3),
    "torque_Nm": (4.0e-4, 5.0e-3),
    "eta": (2.0e-3, 3.0e-3),
}


def _metric_report(
    name: str,
    points: dict[int, PropPoint],
    reference: PropPoint,
) -> dict:
    """
    @description Compare one output to the 101-station reference with its
        combined absolute/relative limit.
    @param name PropPoint field name.
    @param points Solved points keyed by station count.
    @param reference The 101-station point.
    @returns JSON-safe metric report.
    """
    abs_tol, rel_tol = BEMT_STABILITY_TOLERANCES[name]
    ref_value = float(getattr(reference, name))
    comparisons = []
    for stations in BEMT_STABILITY_STATIONS[:-1]:
        observed = float(getattr(points[stations], name))
        delta = abs(observed - ref_value)
        limit = abs_tol + rel_tol * max(abs(observed), abs(ref_value))
        comparisons.append({
            "stations": stations,
            "observed": observed,
            "delta": delta,
            "limit": limit,
            "stable": delta <= limit,
        })
    return {
        "reference": ref_value,
        "abs_tolerance": abs_tol,
        "rel_tolerance": rel_tol,
        "comparisons": comparisons,
        "stable": all(item["stable"] for item in comparisons),
    }


def _point_report(point: PropPoint) -> dict:
    """
    @description Select the convergence evidence that makes a solver result
        auditable without serializing the full numerical point twice.
    @param point A solved BEMT operating point.
    @returns JSON-safe convergence diagnostics.
    """
    return {
        "outer_iterations": point.outer_iterations,
        "swirl_residual_ms": point.swirl_residual_ms,
        "swirl_tolerance_ms": point.swirl_tolerance_ms,
        "valid": point.valid,
    }


def station_stability_report(
    geom: PropGeometry,
    v_ms: float,
    rpm: float,
    rho_kgm3: float,
    t_K: float,
    *,
    n_crit: float = 11.0,
) -> dict:
    """
    @description Run the real BEMT boundary at 25/51/101 stations and compare
        thrust, torque and efficiency to the 101-station reference. This is
        certification evidence, not an alternate solver or cached fixture.
    @param geom Blade geometry.
    @param v_ms Freestream axial velocity, m/s.
    @param rpm Shaft speed, 1/min.
    @param rho_kgm3 Air density, kg/m^3.
    @param t_K Static air temperature, K.
    @param n_crit Transition amplification exponent.
    @returns JSON-safe report with observed values, limits and verdict.
    """
    points = {
        stations: solve_prop_point(
            geom, v_ms, rpm, rho_kgm3, t_K,
            n_crit=n_crit, n_stations=stations,
        )
        for stations in BEMT_STABILITY_STATIONS
    }
    reference = points[BEMT_STABILITY_STATIONS[-1]]
    metrics = {
        name: _metric_report(name, points, reference)
        for name in BEMT_STABILITY_TOLERANCES
    }
    return {
        "stations": list(BEMT_STABILITY_STATIONS),
        "metrics": metrics,
        "points": {
            str(stations): _point_report(point)
            for stations, point in points.items()
        },
        "all_stable": all(metric["stable"] for metric in metrics.values()),
    }
