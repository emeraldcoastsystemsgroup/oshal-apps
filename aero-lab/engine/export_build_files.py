"""
CHANGE LOG
-----------------------------------------------------------------------------
DATE/TIME           | AUTHOR                      | DESCRIPTION
-----------------------------------------------------------------------------
2026-08-03 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation -- the
                    |                             | FINAL_PRODUCT generation pattern
                    |                             | (FP_01 snapshot, FP_02 wing STLs,
                    |                             | FP_03 airfoil dat/template/ribs DXF,
                    |                             | FP_04 hull gore, FP_05 BOM) consolidated
                    |                             | into ONE module and PARAMETERIZED on the
                    |                             | evaluated design instead of the study's
                    |                             | hardcoded f=0.80 Tier-1 case. Every mass
                    |                             | and dimension comes from the engine's own
                    |                             | evaluation ledger, never hand-typed.
2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Extend STL validation beyond edge
                    |                             | counts: broad-phase AABBs plus exact
                    |                             | triangle separating-axis tests now reject
                    |                             | non-topological self-intersections before
                    |                             | any invalid target STL is written. Reports
                    |                             | retain the exact count and a bounded pair
                    |                             | sample for diagnosis.

export_build_files -- physical build package for an evaluated aero-lab design.

generate(vector, design, evaluation, out_dir) writes:
  design_snapshot.json                the full-precision provenance record
  wing.stl / wing_panel_*.stl         binary STL, mm, welded + topology/intersection-checked
  airfoil.dat                         Selig-format section (the exact CST weights evaluated)
  airfoil_template.dxf                root-chord section outline + spar mark (DXF R12)
  ribs.dxf                            8 stations at LOCAL chord (taper honoured)
  BOM.csv                             mechanically generated from the mass ledger
  BUILD_SHEET.md                      human build instructions + the engine verdict
  hull_gore.dxf / hull_gore.svg       (hybrid designs only) sphere gore flat pattern
  verify_stl.json / verify_dxf.json   re-parse verification reports
  (+ verify_gore.json for hybrids)

DXF files are minimal R12 written by hand (POLYLINE/VERTEX/SEQEND, CIRCLE,
TEXT, LINE) -- no library, same as the FP_03/FP_04 originals. All geometry
math is the originals' math generalized: constant-chord special case falls out
of the tapered formulas at taper_ratio = 1.
"""

from __future__ import annotations

import csv
import json
import math
import os
import struct

import numpy as np

SPAR_HOLE_D_MM = 10.0      # FP_03 operator-specified spar tube diameter
N_RIBS_PER_PANEL = 8       # FP_03 station count
N_GORES = 10               # FP_04 gore count
SEAM_ALLOW_MM = 15.0       # FP_04 seam allowance
STL_CHORDWISE_RES = 72     # FP_02 mesh resolution
SELF_INTERSECTION_SAMPLE_LIMIT = 20


class MeshValidationError(ValueError):
    """Raised when an exported STL fails a closed/manifold/intersection check."""


# ---------------------------------------------------------------------------
# Minimal DXF R12 writer (ported verbatim from FP_03/FP_04)
# ---------------------------------------------------------------------------
class Dxf:
    """@description Minimal DXF R12 writer: POLYLINE/VERTEX/SEQEND, CIRCLE,
        TEXT, LINE. Same entity set the FP_03/FP_04 drawings shipped with."""

    def __init__(self) -> None:
        self.e: list[str] = []

    def polyline(self, pts, closed: bool = True) -> None:
        """@description Add a polyline. @param pts [(x, y)] mm. @param closed Close it."""
        self.e += ["0", "POLYLINE", "8", "0", "66", "1",
                   "70", "1" if closed else "0"]
        for x, y in pts:
            self.e += ["0", "VERTEX", "8", "0",
                       "10", f"{x:.4f}", "20", f"{y:.4f}", "30", "0.0"]
        self.e += ["0", "SEQEND"]

    def circle(self, x: float, y: float, r: float) -> None:
        """@description Add a circle. @param x @param y Centre mm. @param r Radius mm."""
        self.e += ["0", "CIRCLE", "8", "0",
                   "10", f"{x:.4f}", "20", f"{y:.4f}", "40", f"{r:.4f}"]

    def line(self, x1: float, y1: float, x2: float, y2: float) -> None:
        """@description Add a line segment (mm)."""
        self.e += ["0", "LINE", "8", "0", "10", f"{x1:.4f}", "20", f"{y1:.4f}",
                   "11", f"{x2:.4f}", "21", f"{y2:.4f}"]

    def text(self, x: float, y: float, h: float, s: str) -> None:
        """@description Add a text label. @param h Text height mm. @param s Content."""
        self.e += ["0", "TEXT", "8", "0", "10", f"{x:.4f}", "20", f"{y:.4f}",
                   "40", f"{h:.4f}", "1", s]

    def save(self, path: str) -> None:
        """@description Write the R12 ENTITIES section. @param path Target file."""
        lines = (["0", "SECTION", "2", "ENTITIES"] + self.e
                 + ["0", "ENDSEC", "0", "EOF"])
        with open(path, "w", newline="\r\n") as fh:
            fh.write("\n".join(lines) + "\n")


def _parse_dxf(path: str):
    """@description Re-parse a written DXF for verification (FP_03 pattern).
    @param path The DXF file.
    @returns (entity counts dict, [minx, miny, maxx, maxy] of VERTEX points)."""
    toks = open(path).read().split("\n")
    pairs = [(toks[i].strip(), toks[i + 1].strip())
             for i in range(0, len(toks) - 1, 2)]
    ents: dict = {}
    vx: list[float] = []
    vy: list[float] = []
    cur = None
    for code, val in pairs:
        if code == "0":
            cur = val
            ents[val] = ents.get(val, 0) + 1
        elif cur == "VERTEX" and code == "10":
            vx.append(float(val))
        elif cur == "VERTEX" and code == "20":
            vy.append(float(val))
    ext = [min(vx), min(vy), max(vx), max(vy)] if vx else None
    return ents, ext


# ---------------------------------------------------------------------------
# Planform helpers (tapered trapezoid; constant chord = taper 1 special case)
# ---------------------------------------------------------------------------
def _chords_m(design) -> tuple[float, float]:
    """@description Root/tip chords of the trapezoidal planform.
    @param design The _SolarCruiseDesign.
    @returns (root_chord_m, tip_chord_m): c_root = 2S / (b (1 + taper))."""
    c_root = 2.0 * design.area_m2 / (design.span_m * (1.0 + design.taper_ratio))
    return c_root, c_root * design.taper_ratio


def _airfoil(kulfan: dict):
    """@description Rebuild the evaluated CST section as an AeroSandbox airfoil.
    @param kulfan {kulfan_upper, kulfan_lower, leading_edge_weight, TE_thickness}.
    @returns asb.KulfanAirfoil."""
    import aerosandbox as asb
    return asb.KulfanAirfoil(
        name="aero-lab-cst-naca2412",
        upper_weights=np.asarray(kulfan["kulfan_upper"], dtype=float),
        lower_weights=np.asarray(kulfan["kulfan_lower"], dtype=float),
        leading_edge_weight=float(kulfan["leading_edge_weight"]),
        TE_thickness=float(kulfan["TE_thickness"]),
    )


# ---------------------------------------------------------------------------
# STL generation (FP_02 generalized: taper + twist, quarter-chord unswept)
# ---------------------------------------------------------------------------
def _make_wing(af, design, y0_m: float, y1_m: float):
    """@description One wing surface between two spanwise stations with local
        chord + linear twist; LE offset keeps the quarter-chord line straight.
        A tip-to-tip span crossing y = 0 gets a ROOT cross-section inserted --
        chord varies with |y|, so two tip xsecs alone would mesh a tip-chord
        prism and lose the root chord entirely (caught by verify_stl bbox).
    @param af The KulfanAirfoil. @param design The design point.
    @param y0_m @param y1_m Station y coordinates, m (0 = root).
    @returns asb.Wing (symmetric=False -- FP_02's cap-safe choice)."""
    import aerosandbox as asb
    c_root, _ = _chords_m(design)
    half = design.span_m / 2.0

    def xsec(y_m: float):
        frac = min(abs(y_m) / half, 1.0)
        c = c_root * (1.0 - frac * (1.0 - design.taper_ratio))
        tw = (design.twist_root_deg
              + frac * (design.twist_tip_deg - design.twist_root_deg))
        return asb.WingXSec(xyz_le=[0.25 * (c_root - c), y_m, 0.0],
                            chord=c, twist=tw, airfoil=af)

    ys = [y0_m, y1_m]
    if y0_m < 0.0 < y1_m:
        ys.insert(1, 0.0)
    return asb.Wing(name="aero-lab-wing", symmetric=False,
                    xsecs=[xsec(y) for y in ys])


def _weld(pts_mm: np.ndarray, faces: np.ndarray):
    """@description Merge coincident vertices (1e-3 mm) and drop degenerate
        sliver triangles (FP_02 verbatim).
    @returns (welded points mm, kept faces)."""
    key = np.round(pts_mm, 3)
    _, first, inv = np.unique(key, axis=0, return_index=True,
                              return_inverse=True)
    pts_w = pts_mm[np.sort(first)]
    order = np.argsort(first)
    rank = np.empty_like(order)
    rank[order] = np.arange(len(order))
    f = rank[inv[faces]]
    v0, v1, v2 = pts_w[f[:, 0]], pts_w[f[:, 1]], pts_w[f[:, 2]]
    areas = 0.5 * np.linalg.norm(np.cross(v1 - v0, v2 - v0), axis=1)
    keep = ((f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
            & (areas > 1e-6))
    return pts_w, f[keep]


def _write_stl(path: str, pts_mm: np.ndarray, faces: np.ndarray) -> None:
    """@description Write a binary STL (units mm) -- FP_02 verbatim."""
    v0, v1, v2 = (pts_mm[faces[:, k]] for k in range(3))
    n = np.cross(v1 - v0, v2 - v0)
    norm = np.linalg.norm(n, axis=1, keepdims=True)
    norm[norm == 0.0] = 1.0
    with open(path, "wb") as fh:
        fh.write(b"aero-lab build package wing (units: mm)".ljust(80, b" "))
        fh.write(struct.pack("<I", len(faces)))
        rec = np.zeros(len(faces), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)),
                                          ("attr", "<u2")])
        rec["n"] = (n / norm).astype("<f4")
        rec["v"][:, 0], rec["v"][:, 1], rec["v"][:, 2] = v0, v1, v2
        fh.write(rec.tobytes())


def _axis_separates(a: np.ndarray, b: np.ndarray, axis: np.ndarray,
                    eps_mm: float) -> bool:
    """@description Test one separating axis for two triangles.
    @param a @param b Triangle vertices, shape (3, 3), mm.
    @param axis Candidate 3-D axis (need not be normalized).
    @param eps_mm Contact tolerance in mm.
    @returns True only when the projected intervals are disjoint.

    Near-zero cross products mean parallel edges and therefore provide no axis;
    they are skipped. Normalising first keeps `eps_mm` a physical length rather
    than silently changing it with triangle size.
    """
    norm = float(np.linalg.norm(axis))
    if norm <= np.finfo(float).eps:
        return False
    unit = axis / norm
    pa = a @ unit
    pb = b @ unit
    return bool(pa.max() < pb.min() - eps_mm
                or pb.max() < pa.min() - eps_mm)


def _coplanar_triangles_intersect(a: np.ndarray, b: np.ndarray,
                                  normal: np.ndarray,
                                  eps_mm: float) -> bool:
    """@description Exact 2-D SAT after projecting coplanar triangles onto
        their numerically strongest coordinate plane.
    @returns True for overlap or contact; either is invalid for unrelated faces.

    The usual 3-D triangle axes collapse to the common plane normal for coplanar
    faces. Projecting and testing all six in-plane edge normals is therefore not
    optional: without it, two disjoint coplanar triangles would be false positives.
    """
    drop = int(np.argmax(np.abs(normal)))
    a2 = np.delete(a, drop, axis=1)
    b2 = np.delete(b, drop, axis=1)
    for tri in (a2, b2):
        edges = np.roll(tri, -1, axis=0) - tri
        for edge in edges:
            axis = np.array([-edge[1], edge[0]], dtype=float)
            norm = float(np.linalg.norm(axis))
            if norm <= np.finfo(float).eps:
                continue
            unit = axis / norm
            pa = a2 @ unit
            pb = b2 @ unit
            if pa.max() < pb.min() - eps_mm or pb.max() < pa.min() - eps_mm:
                return False
    return True


def _triangles_intersect(a: np.ndarray, b: np.ndarray,
                         eps_mm: float) -> bool:
    """@description Triangle/triangle intersection by the separating-axis
        theorem, with a dedicated coplanar projection.
    @param a @param b Triangle vertices, shape (3, 3), mm.
    @param eps_mm Physical contact tolerance, mm.
    @returns True when the closed triangles overlap or touch.

    For non-coplanar triangles the complete candidate set is both face normals
    plus all nine edge-edge cross products. Degenerate triangles are reported by
    `_check_mesh` and do not participate in this secondary diagnostic.
    """
    edges_a = np.roll(a, -1, axis=0) - a
    edges_b = np.roll(b, -1, axis=0) - b
    normal_a = np.cross(edges_a[0], edges_a[1])
    normal_b = np.cross(edges_b[0], edges_b[1])
    norm_a = float(np.linalg.norm(normal_a))
    norm_b = float(np.linalg.norm(normal_b))
    if norm_a <= np.finfo(float).eps or norm_b <= np.finfo(float).eps:
        return False

    unit_a = normal_a / norm_a
    unit_b = normal_b / norm_b
    b_from_a_plane = (b - a[0]) @ unit_a
    a_from_b_plane = (a - b[0]) @ unit_b
    if (np.all(b_from_a_plane > eps_mm)
            or np.all(b_from_a_plane < -eps_mm)
            or np.all(a_from_b_plane > eps_mm)
            or np.all(a_from_b_plane < -eps_mm)):
        return False

    coplanar = (float(np.max(np.abs(b_from_a_plane))) <= eps_mm
                and float(np.max(np.abs(a_from_b_plane))) <= eps_mm)
    if coplanar:
        return _coplanar_triangles_intersect(a, b, normal_a, eps_mm)

    axes = [normal_a, normal_b]
    axes.extend(np.cross(edge_a, edge_b)
                for edge_a in edges_a for edge_b in edges_b)
    return not any(_axis_separates(a, b, axis, eps_mm) for axis in axes)


def _self_intersection_report(pts_mm: np.ndarray,
                              faces: np.ndarray) -> tuple[int, list[list[int]], float]:
    """@description Count intersections between non-topological face pairs.
    @param pts_mm Vertex coordinates, mm. @param faces Triangle indices.
    @returns (exact pair count, bounded [[face_i, face_j], ...] sample, tolerance_mm).

    An AABB broad phase removes the overwhelming majority of O(n^2) pairs before
    exact SAT. Pairs sharing a vertex are intentionally topological neighbours:
    their legal shared edge/vertex is not mesh self-intersection. A fold-through
    is still exposed by the surrounding non-neighbour face pairs.
    """
    triangles = pts_mm[faces]
    mesh_scale_mm = float(np.linalg.norm(pts_mm.max(axis=0) - pts_mm.min(axis=0)))
    eps_mm = max(1e-9, mesh_scale_mm * 1e-10)
    lo = triangles.min(axis=1)
    hi = triangles.max(axis=1)
    count = 0
    sample: list[list[int]] = []
    for i in range(len(faces) - 1):
        rest = np.arange(i + 1, len(faces), dtype=np.int64)
        overlaps = np.all(lo[i] <= hi[rest] + eps_mm, axis=1)
        overlaps &= np.all(lo[rest] <= hi[i] + eps_mm, axis=1)
        for j in rest[overlaps]:
            # Do not call ordinary mesh adjacency an intersection. The primary
            # edge-count check separately catches broken or over-used edges.
            if np.any(faces[i][:, None] == faces[j][None, :]):
                continue
            if _triangles_intersect(triangles[i], triangles[j], eps_mm):
                count += 1
                if len(sample) < SELF_INTERSECTION_SAMPLE_LIMIT:
                    sample.append([int(i), int(j)])
    return count, sample, eps_mm


def _check_mesh(pts_mm: np.ndarray, faces: np.ndarray) -> dict:
    """@description Mesh verification: finite indexed triangles, bbox,
        degeneracy, edge-manifoldness and geometric self-intersection.
    @returns The check report dict."""
    pts_mm = np.asarray(pts_mm, dtype=float)
    faces = np.asarray(faces, dtype=np.int64)
    if pts_mm.ndim != 2 or pts_mm.shape[1:] != (3,) or len(pts_mm) < 4:
        raise MeshValidationError(
            f"mesh points must have shape (n>=4, 3), got {pts_mm.shape}")
    if faces.ndim != 2 or faces.shape[1:] != (3,) or len(faces) < 4:
        raise MeshValidationError(
            f"mesh faces must have shape (n>=4, 3), got {faces.shape}")
    if not np.all(np.isfinite(pts_mm)):
        raise MeshValidationError("mesh contains non-finite vertex coordinates")
    if int(faces.min()) < 0 or int(faces.max()) >= len(pts_mm):
        raise MeshValidationError("mesh face index lies outside the vertex array")

    lo, hi = pts_mm.min(axis=0), pts_mm.max(axis=0)
    v0, v1, v2 = (pts_mm[faces[:, k]] for k in range(3))
    areas = 0.5 * np.linalg.norm(np.cross(v1 - v0, v2 - v0), axis=1)
    f = faces
    edges = np.sort(np.stack([np.concatenate([f[:, 0], f[:, 1], f[:, 2]]),
                              np.concatenate([f[:, 1], f[:, 2], f[:, 0]])],
                             axis=1), axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    degenerate_faces = int(np.sum(areas < 1e-9))
    manifold = bool(np.all(counts == 2))
    intersections, pair_sample, eps_mm = _self_intersection_report(pts_mm, faces)
    return {"triangles": int(len(faces)),
            "bbox_mm": [[round(float(a), 2) for a in lo],
                        [round(float(b), 2) for b in hi]],
            "size_mm": [round(float(b - a), 2) for a, b in zip(lo, hi)],
            "degenerate_faces": degenerate_faces,
            "edges_on_1_tri": int(np.sum(counts == 1)),
            "edges_on_3plus": int(np.sum(counts >= 3)),
            "manifold": manifold,
            "self_intersections": intersections,
            "self_intersection_pairs_sample": pair_sample,
            "self_intersection_tolerance_mm": eps_mm,
            "self_intersection_free": intersections == 0,
            "valid": bool(degenerate_faces == 0 and manifold
                          and intersections == 0)}


def _write_validated_stl(path: str, pts_mm: np.ndarray,
                         faces: np.ndarray) -> dict:
    """@description Validate a mesh and write it only when every gate passes.
    @param path Target STL path. @param pts_mm @param faces Mesh arrays.
    @returns The retained validation report.
    @raises MeshValidationError Before opening the target when invalid.
    """
    report = _check_mesh(pts_mm, faces)
    if not report["valid"]:
        raise MeshValidationError(
            f"{os.path.basename(path)} failed mesh validation: "
            f"degenerate_faces={report['degenerate_faces']}, "
            f"edges_on_1_tri={report['edges_on_1_tri']}, "
            f"edges_on_3plus={report['edges_on_3plus']}, "
            f"self_intersections={report['self_intersections']}")
    _write_stl(path, pts_mm, faces)
    return report


def _wing_stls(af, design, out_dir: str) -> tuple[list[str], dict]:
    """@description wing.stl (tip-to-tip) + capped left/right panels.
    @returns ([file names], verify report)."""
    half = design.span_m / 2.0
    report: dict = {}
    files: list[str] = []
    jobs = [("wing.stl", -half, half), ("wing_panel_right.stl", 0.0, half)]
    right_mesh = None
    for name, y0, y1 in jobs:
        pts, faces = _make_wing(af, design, y0, y1).mesh_body(
            method="tri", chordwise_resolution=STL_CHORDWISE_RES)
        pts_mm, faces = _weld(np.asarray(pts, dtype=float) * 1000.0,
                              np.asarray(faces, dtype=np.int64))
        report[name] = _write_validated_stl(
            os.path.join(out_dir, name), pts_mm, faces)
        files.append(name)
        if name == "wing_panel_right.stl":
            right_mesh = (pts_mm, faces)
    pts_l, faces_r = right_mesh
    pts_l = pts_l.copy()
    pts_l[:, 1] *= -1.0
    faces_l = faces_r[:, ::-1].copy()
    report["wing_panel_left.stl"] = _write_validated_stl(
        os.path.join(out_dir, "wing_panel_left.stl"), pts_l, faces_l)
    files.append("wing_panel_left.stl")
    c_root, c_tip = _chords_m(design)
    report["expected_dims_mm"] = {
        "span_mm": design.span_m * 1000.0,
        "root_chord_mm": c_root * 1000.0, "tip_chord_mm": c_tip * 1000.0,
        "max_thickness_root_mm": float(af.max_thickness()) * c_root * 1000.0}
    return files, report


# ---------------------------------------------------------------------------
# Airfoil dat + template + ribs (FP_03 generalized to local chord)
# ---------------------------------------------------------------------------
def _spar_geometry(coords: np.ndarray, chord_mm: float) -> dict:
    """@description Spar hole at 30 % of the LOCAL chord, mid-thickness.
        Hole shrinks (and finally drops) when the local web is too thin --
        FP_03 asserted; a parameterized exporter must degrade honestly instead.
    @param coords Selig airfoil coordinates (unit chord).
    @param chord_mm Local chord, mm.
    @returns {x_mm, y_mm, thickness_mm, hole_d_mm (0 = omitted)}."""
    n_le = int(np.argmin(coords[:, 0]))
    upper, lower = coords[:n_le + 1][::-1], coords[n_le:]
    yu = float(np.interp(0.30, upper[:, 0], upper[:, 1]))
    yl = float(np.interp(0.30, lower[:, 0], lower[:, 1]))
    thick = (yu - yl) * chord_mm
    hole = SPAR_HOLE_D_MM if thick > SPAR_HOLE_D_MM + 6.0 else max(thick - 6.0, 0.0)
    if hole < 3.0:
        hole = 0.0
    return {"x_mm": 0.30 * chord_mm, "y_mm": 0.5 * (yu + yl) * chord_mm,
            "thickness_mm": thick, "hole_d_mm": hole}


def _airfoil_dat(af, out_dir: str) -> np.ndarray:
    """@description Write airfoil.dat (Selig order) -- FP_03 verbatim.
    @returns The unit-chord coordinate array."""
    coords = np.asarray(af.coordinates, dtype=float)
    with open(os.path.join(out_dir, "airfoil.dat"), "w", newline="\n") as fh:
        fh.write("aero-lab CST section (aerosim SECTION_CODE 2412, "
                 "18 Kulfan weights)\n")
        for x, y in coords:
            fh.write(f" {x:.6f}  {y:+.6f}\n")
    return coords


def _template_dxf(coords: np.ndarray, c_root_mm: float, out_dir: str) -> dict:
    """@description Root-chord section outline + chord line + spar mark.
    @returns The spar geometry used (for the verify report)."""
    spar = _spar_geometry(coords, c_root_mm)
    d = Dxf()
    d.polyline((coords * c_root_mm).tolist(), closed=True)
    d.line(0.0, 0.0, c_root_mm, 0.0)
    if spar["hole_d_mm"] > 0.0:
        d.circle(spar["x_mm"], spar["y_mm"], spar["hole_d_mm"] / 2.0)
    d.text(10.0, -22.0, 6.0,
           f"AERO-LAB CST SECTION (NACA2412 KULFAN) ROOT CHORD "
           f"{c_root_mm:.1f} MM - UNITS MM")
    d.text(10.0, -32.0, 5.0,
           f"SPAR {spar['hole_d_mm']:.0f} MM DIA AT 30% CHORD "
           f"X={spar['x_mm']:.1f} Y={spar['y_mm']:.1f}"
           if spar["hole_d_mm"] > 0.0 else
           "WEB TOO THIN FOR A SPAR HOLE AT THIS CHORD - SURFACE-MOUNT SPAR")
    d.save(os.path.join(out_dir, "airfoil_template.dxf"))
    return spar


def _ribs_dxf(coords: np.ndarray, design, out_dir: str) -> dict:
    """@description 8 ribs per panel at LOCAL chord (taper honoured), laid out
        2 x 4; spar hole tracks 30 % of each rib's own chord.
    @returns Station table for the verify report."""
    c_root_mm, c_tip_mm = (c * 1000.0 for c in _chords_m(design))
    half_mm = design.span_m * 1000.0 / 2.0
    stations = np.linspace(0.0, half_mm, N_RIBS_PER_PANEL)
    pitch_x, pitch_y = c_root_mm + 60.0, 90.0
    d = Dxf()
    table = []
    for i, sta in enumerate(stations):
        frac = sta / half_mm if half_mm > 0 else 0.0
        c_mm = c_root_mm + frac * (c_tip_mm - c_root_mm)
        tw = (design.twist_root_deg
              + frac * (design.twist_tip_deg - design.twist_root_deg))
        spar = _spar_geometry(coords, c_mm)
        ox, oy = (i % 4) * pitch_x, -(i // 4) * pitch_y
        d.polyline((coords * c_mm + [ox, oy]).tolist(), closed=True)
        if spar["hole_d_mm"] > 0.0:
            d.circle(ox + spar["x_mm"], oy + spar["y_mm"],
                     spar["hole_d_mm"] / 2.0)
        d.text(ox + 0.25 * c_mm, oy - 14.0, 4.0,
               f"RIB {i + 1}/{N_RIBS_PER_PANEL} STA {sta:.0f} MM "
               f"C {c_mm:.0f} MM TWIST {tw:+.1f} DEG (CUT 2X)")
        table.append({"station_mm": round(float(sta), 1),
                      "chord_mm": round(float(c_mm), 1),
                      "twist_deg": round(float(tw), 2),
                      "spar_hole_mm": round(spar["hole_d_mm"], 1)})
    d.text(0.0, -pitch_y - 40.0, 6.0,
           f"RIBS: AERO-LAB CST SECTION, ROOT {c_root_mm:.0f} / TIP "
           f"{c_tip_mm:.0f} MM, SPAR AT 30% LOCAL CHORD - UNITS MM")
    d.text(0.0, -pitch_y - 52.0, 4.5,
           f"{N_RIBS_PER_PANEL} STATIONS PER PANEL 0..{half_mm:.0f} MM - "
           f"TWIST IS SET AT ASSEMBLY (RIBS CUT FLAT, ROTATE ON SPAR)")
    d.save(os.path.join(out_dir, "ribs.dxf"))
    return {"stations": table}


# ---------------------------------------------------------------------------
# Hull gore (FP_04 generalized: sphere = the shipped in-sim envelope shape)
# ---------------------------------------------------------------------------
def _hull_gore(radius_m: float, volume_m3: float, out_dir: str) -> dict:
    """@description Flat gore pattern for the SPHERICAL envelope the hybrid
        evaluation actually flew (BuoyancyVolume is a sphere by construction).
        FP_04's meridian-unroll math with a = b = radius.
    @returns Verify report; writes hull_gore.dxf + hull_gore.svg."""
    A = B = radius_m * 1000.0
    surface_mm2 = 4.0 * math.pi * A * A
    t = np.linspace(0.0, math.pi, 4001)
    r = B * np.sin(t)
    dsdt = np.sqrt((A * np.sin(t)) ** 2 + (B * np.cos(t)) ** 2)
    s = np.concatenate([[0.0],
                        np.cumsum(0.5 * (dsdt[1:] + dsdt[:-1]) * np.diff(t))])
    S_M = float(s[-1])
    w = math.pi * r / N_GORES
    net_area = float(np.trapezoid(2.0 * w, s))
    area_err_pct = 100.0 * (N_GORES * net_area - surface_mm2) / surface_mm2
    wp = np.gradient(w, s)
    den = np.sqrt(1.0 + wp * wp)
    off_x, off_y = w + SEAM_ALLOW_MM / den, s - SEAM_ALLOW_MM * wp / den
    th_t, th_n = math.atan2(-wp[-1], 1.0), math.atan2(-wp[0], 1.0)
    tail = [(SEAM_ALLOW_MM * math.cos(th), S_M + SEAM_ALLOW_MM * math.sin(th))
            for th in np.linspace(th_t, math.pi - th_t, 24)]
    nose = [(SEAM_ALLOW_MM * math.cos(th), SEAM_ALLOW_MM * math.sin(th))
            for th in np.linspace(math.pi - th_n, 2.0 * math.pi + th_n, 24)]
    right = list(zip(off_x[::16], off_y[::16]))
    cut = right + tail + [(-x, y) for x, y in right[::-1]] + nose
    net = (list(zip(w[::16], s[::16]))
           + [(-x, y) for x, y in zip(w[::16][::-1], s[::16][::-1])])
    d = Dxf()
    d.polyline(cut, closed=True)
    d.polyline(net, closed=True)
    d.line(0.0, -SEAM_ALLOW_MM, 0.0, S_M + SEAM_ALLOW_MM)
    d.text(-150.0, -60.0, 12.0,
           f"HULL GORE 1 OF {N_GORES} - SPHERE DIA {2 * A:.0f} MM "
           f"(V = {volume_m3:.3f} M3) - UNITS MM")
    d.text(-150.0, -80.0, 9.0,
           f"NET LENGTH {S_M:.0f} MM, MAX NET WIDTH {2 * w.max():.0f} MM, "
           f"SEAM ALLOWANCE {SEAM_ALLOW_MM:.0f} MM (OUTER = CUT, INNER = SEW)")
    d.text(-150.0, -96.0, 9.0,
           "CUT FROM 38UM LLDPE - FLAT PATTERN NEGLECTS DOUBLE CURVATURE")
    d.save(os.path.join(out_dir, "hull_gore.dxf"))
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" '
           f'width="{int(S_M * 0.27) + 120}" height="320" '
           f'font-family="monospace">',
           '<rect width="100%" height="100%" fill="white"/>',
           '<polygon points="'
           + " ".join(f"{60 + y * 0.27:.1f},{120 + x * 0.27:.1f}"
                      for x, y in cut)
           + '" fill="#eef6ff" stroke="#0a58a3" stroke-width="1.5"/>',
           f'<text x="60" y="20" font-size="13">HULL GORE - 1 of {N_GORES} - '
           f'sphere dia {2 * A:.0f} mm (V = {volume_m3:.3f} m3) - '
           f'net length {S_M:.0f} mm - units mm</text>', "</svg>"]
    with open(os.path.join(out_dir, "hull_gore.svg"), "w") as fh:
        fh.write("\n".join(svg) + "\n")
    ents, ext = _parse_dxf(os.path.join(out_dir, "hull_gore.dxf"))
    return {"meridian_len_mm": round(S_M, 1),
            "max_net_width_mm": round(2 * float(w.max()), 1),
            "unroll_area_error_pct": round(area_err_pct, 4),
            "dxf_entities": ents, "vertex_extent_mm": ext}


# ---------------------------------------------------------------------------
# BOM + build sheet (FP_05 pattern: rows FROM the ledger, never hand-typed)
# ---------------------------------------------------------------------------
def _bom_csv(vector: dict, evaluation: dict, out_dir: str) -> None:
    """@description BOM.csv generated mechanically from the evaluation's mass
        breakdown; the component rows sum to the stated all-up mass."""
    g = lambda kg: round(kg * 1000.0, 1)  # noqa: E731 - FP_05's own idiom
    cap_wh = evaluation["build"]["packWh"]
    rows = [["item", "mass_g", "spec", "source"]]
    spec = {
        "wing structure": f"span {evaluation['build']['spanM']:.2f} m, area "
                          f"{evaluation['build']['areaM2']:.2f} m2, taper "
                          f"{vector['taper_ratio']:.2f}; ribs.dxf + spar + film",
        "battery pack": f"{cap_wh:.0f} Wh at {vector['pack_Wh_per_kg']:.0f} "
                        f"Wh/kg pack level + BMS",
        "solar array": f"cell eff {vector['cell_eff']:.3f}, packing "
                       f"{vector['pv_packing']:.2f}, laminate "
                       f"{vector['pv_density']:.2f} kg/m2 on wing area",
        "propulsion": f"motor+ESC+prop, {vector['prop_max_W']:.0f} W max, "
                      f"prop dia {vector['prop_diameter_m']:.2f} m",
        "payload + avionics": f"draw {vector['payload_W']:.2f} W",
        "fuselage / boom / tail": f"{vector['fus_over_floor']:.2f} x the "
                                  f"structural floor at carried mass",
        "envelope film + tapes": "38 um LLDPE + tapes/valve (hull_gore.dxf)",
        "helium": "balloon-grade He fill",
    }
    for row in evaluation["build"]["massBreakdown"]:
        rows.append([row["label"], g(row["kg"]),
                     spec.get(row["label"], ""), "engine mass ledger"])
    rows.append(["TOTAL all-up", g(evaluation["build"]["massAllUpKg"]),
                 "sums the ledger exactly", "engine mass ledger"])
    path = os.path.join(out_dir, "BOM.csv")
    with open(path, "w", newline="") as fh:
        csv.writer(fh).writerows(rows)
    with open(path) as fh:
        back = list(csv.reader(fh))
    tot = sum(float(r[1]) for r in back[1:-1])
    assert abs(tot - float(back[-1][1])) < 0.5, (tot, back[-1][1])


def _build_sheet(vector: dict, evaluation: dict, spar: dict,
                 out_dir: str) -> None:
    """@description BUILD_SHEET.md -- dimensions, ledger and the engine's own
        verdict, stated as evaluated (never aspirational)."""
    b = evaluation["build"]
    e = evaluation["energy"]
    v = evaluation["verdict"]
    lines = [
        "# aero-lab build sheet", "",
        "Generated from the aerosim engine evaluation of this exact design "
        "vector. Every number below is the engine's, not an estimate.", "",
        "## Verdict",
        f"- 24 h limit cycle closed: **{evaluation['closed']}**",
        f"- admissibility screen: **{v['admissible']}**"
        + ("" if v["admissible"] else " -- reasons: "
           + "; ".join(v["reasons"])),
        f"- min SOC {e['minSoc']:.4f}, usable margin {e['usable']:.4f}", "",
        "## Airframe",
        f"- span {b['spanM']:.3f} m, area {b['areaM2']:.3f} m2, "
        f"taper {vector['taper_ratio']:.2f}",
        f"- twist root {vector['twist_root_deg']:+.2f} deg / tip "
        f"{vector['twist_tip_deg']:+.2f} deg (ribs cut flat -- set twist at "
        f"assembly on the spar)",
        "- section: NACA 2412 carried as CST/Kulfan weights (airfoil.dat)",
        f"- spar at 30% chord; root web {spar['thickness_mm']:.1f} mm, "
        f"hole {spar['hole_d_mm']:.0f} mm"
        + (" (OMITTED -- web too thin; surface-mount the spar)"
           if spar["hole_d_mm"] == 0.0 else ""), "",
        "## Mass ledger (engine, sums exactly)",
    ]
    for row in b["massBreakdown"]:
        lines.append(f"- {row['label']}: {row['kg'] * 1000.0:.1f} g")
    lines.append(f"- **TOTAL all-up: {b['massAllUpKg'] * 1000.0:.1f} g**")
    lines += ["", "## Energy system",
              f"- pack {b['packWh']:.1f} Wh "
              f"({vector['battery_mass_kg']:.3f} kg at "
              f"{vector['pack_Wh_per_kg']:.0f} Wh/kg)",
              f"- site: lat {vector['latitude_deg']:.1f} deg, day "
              f"{int(vector['day_of_year'])}, altitude "
              f"{vector['altitude_m']:.0f} m"]
    if evaluation.get("hybrid"):
        h = evaluation["hybrid"]
        lines += ["", "## Buoyant envelope (evaluated as a SPHERE)",
                  f"- volume {h['volume_m3']:.3f} m3, film "
                  f"{h['film_kg'] * 1000:.0f} g, helium "
                  f"{h['helium_kg'] * 1000:.0f} g "
                  f"(f = {h['buoyancy_fraction']:.2f})",
                  "- gore pattern: hull_gore.dxf / .svg"]
    lines += ["", "## Files", "See design_snapshot.json for full provenance; "
              "verify_*.json are the re-parse checks run at export time.", ""]
    with open(os.path.join(out_dir, "BUILD_SHEET.md"), "w") as fh:
        fh.write("\n".join(lines))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def generate(vector: dict, design, evaluation: dict, out_dir: str) -> list:
    """@description Produce the complete build package for an EVALUATED design.
    @param vector The validated wire design vector.
    @param design The mapped _SolarCruiseDesign the engine flew.
    @param evaluation The JSON-safe evaluate response (ledger + verdict).
    @param out_dir Target directory (exists).
    @returns Bare file names written (the route's download allow-list)."""
    from aerosim import aeropolar
    up_w, lo_w, le_w, te_t = aeropolar.naca_kulfan("2412")
    kulfan = {"kulfan_upper": [float(x) for x in up_w],
              "kulfan_lower": [float(x) for x in lo_w],
              "leading_edge_weight": float(le_w),
              "TE_thickness": float(te_t)}
    af = _airfoil(kulfan)
    c_root_mm, c_tip_mm = (c * 1000.0 for c in _chords_m(design))

    files, verify_stl = _wing_stls(af, design, out_dir)
    coords = _airfoil_dat(af, out_dir)
    spar = _spar_geometry(coords, c_root_mm)
    _template_dxf(coords, c_root_mm, out_dir)
    ribs_report = _ribs_dxf(coords, design, out_dir)
    files += ["airfoil.dat", "airfoil_template.dxf", "ribs.dxf"]

    if evaluation.get("hybrid"):
        radius_m = (3.0 * evaluation["hybrid"]["volume_m3"]
                    / (4.0 * math.pi)) ** (1.0 / 3.0)
        gore_report = _hull_gore(radius_m, evaluation["hybrid"]["volume_m3"],
                                 out_dir)
        with open(os.path.join(out_dir, "verify_gore.json"), "w") as fh:
            json.dump(gore_report, fh, indent=1)
        files += ["hull_gore.dxf", "hull_gore.svg", "verify_gore.json"]

    _bom_csv(vector, evaluation, out_dir)
    _build_sheet(vector, evaluation, spar, out_dir)
    files += ["BOM.csv", "BUILD_SHEET.md"]

    snapshot = {
        "provenance": {
            "generator": "aero-lab export_build_files (FP_01..FP_05 pattern, "
                         "parameterized on the evaluated design)",
            "airfoil": "NACA 2412 as CST/Kulfan weights -- "
                       "aerosim validate_designs SECTION_CODE via "
                       "aeropolar.naca_kulfan",
            "evaluation_chain": "to_design -> build_solar_cruise -> "
                                "integrate_energy 24 h -> usable_energy -> "
                                "screen_design (the R6/R7 sweep chain)",
        },
        "design_vector": vector,
        "planform": {"span_m": float(design.span_m),
                     "area_m2": float(design.area_m2),
                     "root_chord_mm": c_root_mm, "tip_chord_mm": c_tip_mm,
                     "taper": float(design.taper_ratio),
                     "twist_root_deg": float(design.twist_root_deg),
                     "twist_tip_deg": float(design.twist_tip_deg)},
        "airfoil_cst": kulfan,
        "spar": spar,
        "ribs": ribs_report,
        "evaluation": evaluation,
    }
    with open(os.path.join(out_dir, "design_snapshot.json"), "w") as fh:
        json.dump(snapshot, fh, indent=1)
    with open(os.path.join(out_dir, "verify_stl.json"), "w") as fh:
        json.dump(verify_stl, fh, indent=1)
    dxf_report = {}
    for name in ("airfoil_template.dxf", "ribs.dxf"):
        ents, ext = _parse_dxf(os.path.join(out_dir, name))
        dxf_report[name] = {"entities": ents, "vertex_extent_mm": ext}
    assert dxf_report["ribs.dxf"]["entities"]["POLYLINE"] == N_RIBS_PER_PANEL
    with open(os.path.join(out_dir, "verify_dxf.json"), "w") as fh:
        json.dump(dxf_report, fh, indent=1)
    files += ["design_snapshot.json", "verify_stl.json", "verify_dxf.json"]
    return files
