"""
CHANGE LOG
-----------------------------------------------------------------------------
DATE/TIME           | AUTHOR                      | DESCRIPTION
-----------------------------------------------------------------------------
2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Regression guards for export mesh
                    |                             | self-intersection validation: a clean
                    |                             | tetrahedron passes; two intersecting closed
                    |                             | edge-manifold shells fail; coplanar overlap
                    |                             | is detected; invalid output is refused before
                    |                             | write; and a production-resolution boundary
                    |                             | sweep keeps real generated wings green.

All coordinates in the synthetic cases are millimetres, matching the export
validator. The real-wing sweep converts AeroSandbox's metre output exactly as
production `_wing_stls` does.
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

import export_build_files as export
import service
from aerosim.aeropolar import naca_kulfan


def _tetrahedron() -> tuple[np.ndarray, np.ndarray]:
    """@returns A consistently indexed closed tetrahedron in millimetres."""
    points = np.array([
        [0.0, 0.0, 0.0],
        [2.0, 0.0, 0.0],
        [0.0, 2.0, 0.0],
        [0.0, 0.0, 2.0],
    ])
    faces = np.array([
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
    ], dtype=np.int64)
    return points, faces


def _crossing_closed_shells() -> tuple[np.ndarray, np.ndarray]:
    """@returns Two individually closed tetrahedra whose surfaces cross.

    Every edge still belongs to exactly two faces, which proves the former
    topology-only validator would have accepted this geometry.
    """
    points, faces = _tetrahedron()
    shifted = points + np.array([0.5, 0.5, -0.5])
    return np.vstack([points, shifted]), np.vstack([faces, faces + len(points)])


def test_closed_non_intersecting_mesh_passes_every_gate(tmp_path) -> None:
    points, faces = _tetrahedron()
    report = export._check_mesh(points, faces)
    assert report["manifold"] is True
    assert report["degenerate_faces"] == 0
    assert report["self_intersections"] == 0
    assert report["self_intersection_pairs_sample"] == []
    assert report["self_intersection_free"] is True
    assert report["valid"] is True
    target = tmp_path / "clean.stl"
    written_report = export._write_validated_stl(str(target), points, faces)
    assert written_report["valid"] is True
    assert target.stat().st_size == 84 + 50 * len(faces)


def test_edge_manifold_shells_are_rejected_when_their_surfaces_cross() -> None:
    points, faces = _crossing_closed_shells()
    report = export._check_mesh(points, faces)
    assert report["manifold"] is True
    assert report["edges_on_1_tri"] == 0
    assert report["edges_on_3plus"] == 0
    assert report["degenerate_faces"] == 0
    assert report["self_intersections"] == 4
    assert report["self_intersection_pairs_sample"] == [
        [0, 5], [0, 7], [2, 5], [2, 7],
    ]
    assert report["valid"] is False


def test_coplanar_overlap_uses_the_projected_triangle_axes() -> None:
    a = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 2.0, 0.0]])
    crossing = np.array([[0.5, -0.2, 0.0], [1.5, 1.5, 0.0], [-0.2, 0.5, 0.0]])
    separate = np.array([[3.0, 3.0, 0.0], [4.0, 3.0, 0.0], [3.0, 4.0, 0.0]])
    assert export._triangles_intersect(a, crossing, 1e-9) is True
    assert export._triangles_intersect(a, separate, 1e-9) is False


def test_invalid_mesh_is_refused_before_the_target_is_written(tmp_path) -> None:
    points, faces = _crossing_closed_shells()
    target = tmp_path / "crossing.stl"
    with pytest.raises(export.MeshValidationError, match=r"self_intersections=4"):
        export._write_validated_stl(str(target), points, faces)
    assert not target.exists()


def test_invalid_export_mesh_maps_to_an_honest_design_refusal() -> None:
    mapped = service._classify(export.MeshValidationError("crossing wing"))
    assert mapped.code == "inadmissible_input"
    assert "MeshValidationError: crossing wing" in str(mapped)


def test_production_resolution_wing_boundary_sweep_is_intersection_free() -> None:
    """Exercise nominal and legal geometry-box corners at production resolution."""
    upper, lower, leading_edge, trailing_edge = naca_kulfan("2412")
    airfoil = export._airfoil({
        "kulfan_upper": upper,
        "kulfan_lower": lower,
        "leading_edge_weight": leading_edge,
        "TE_thickness": trailing_edge,
    })
    cases = [
        # span_m, area_m2, taper, root twist, tip twist
        (2.5, 0.52, 0.35, 0.0, -3.0),
        (2.5, 0.52, 1.00, 4.0, 1.0),
        (5.65, 1.72, 0.70, 2.0, 0.0),
        (79.9, 195.0, 0.35, 4.0, -3.0),
        (79.9, 195.0, 1.00, 0.0, 1.0),
    ]
    for span_m, area_m2, taper, twist_root, twist_tip in cases:
        design = SimpleNamespace(
            span_m=span_m,
            area_m2=area_m2,
            taper_ratio=taper,
            twist_root_deg=twist_root,
            twist_tip_deg=twist_tip,
        )
        points, faces = export._make_wing(
            airfoil, design, -span_m / 2.0, span_m / 2.0,
        ).mesh_body(method="tri", chordwise_resolution=export.STL_CHORDWISE_RES)
        points_mm, welded_faces = export._weld(
            np.asarray(points, dtype=float) * 1000.0,
            np.asarray(faces, dtype=np.int64),
        )
        report = export._check_mesh(points_mm, welded_faces)
        assert report["valid"] is True, (design, report)
        assert report["self_intersections"] == 0, (design, report)
