# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial -- the worker against the real kernel:
#   |                                           | every base and feature builds to analytic numbers,
#   |                                           | a refused feature is reported and skipped, the
#   |                                           | STEP export is byte-stable across rebuilds, the
#   |                                           | contract refuses bad input per feature never per
#   |                                           | request, and the protocol answers every line.
#   |                                           | Runs inside the engine container:
#   |                                           |   python -m unittest discover -s tests
# 2 | maintainer@emeraldcoastsystemsgroup.com   | revolve, sweep and loft (BACKLOG B1) to analytic
#   |                                           | volumes: a cylinder cut through the axis, a Pappus
#   |                                           | annulus, a revolve about the plane's FIRST axis, a
#   |                                           | partial angle, a straight sweep, a right-corner
#   |                                           | mitred L sweep (area x centreline), a two-section
#   |                                           | frustum and a three-section ruled loft; the worker's
#   |                                           | own refusals stay per feature; hello publishes the
#   |                                           | new types and the plane->axis table.
# 3 | maintainer@emeraldcoastsystemsgroup.com   | The per-feature budget (BACKLOG B5): a shell that
#   |                                           | returns after a 1 ms budget is refused with code
#   |                                           | budget_exceeded and its result discarded (the box
#   |                                           | stays 32000 mm3) while the next feature still runs;
#   |                                           | a generous budget accepts it; a malformed budget is
#   |                                           | a request refusal; hello publishes the range.
# 4 | maintainer@emeraldcoastsystemsgroup.com   | Threads and text (BACKLOG B4): ISO metric external
#   |                                           | threaded boss (M10x1.5 + left-hand clearance),
#   |                                           | internal threaded hole, embossed/debossed text with
#   |                                           | the bundled OFL-1.1 font, per-feature refusals, and
#   |                                           | full watertight/manifold/Euler=2 STL mesh validation
#   |                                           | matching scan-to-print/mesh-validate.ts.
"""Real-kernel tests for cad_worker (need CadQuery; they run in the engine image)."""
import base64
import json
import math
import os
import struct
import subprocess
import sys
import unittest

ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE_DIR)
import cad_worker as w  # noqa: E402

BRACKET = {"kind": "contours", "size": {"x": 60, "y": 40, "z": 30}, "views": {
    "front": [[-30, 0], [30, 0], [30, 10], [-20, 10], [-20, 30], [-30, 30]],
    "top": [[-30, -20], [30, -20], [30, 20], [-30, 20]],
    "right": [[-20, 0], [20, 0], [20, 30], [-20, 30]]}}


def rebuild(base, features, **kw):
    return w.rebuild({"base": base, "features": features, **kw}, kw.pop("exports_on", False))


class Bases(unittest.TestCase):
    def test_box_rests_on_bed_centred(self):
        r = w.rebuild({"base": {"kind": "box", "sizeX": 60, "sizeY": 40, "sizeZ": 30}, "features": []}, False)
        e = r["report"]["extentsMm"]
        self.assertEqual([round(v, 6) for v in e["size"]], [60, 40, 30])
        self.assertAlmostEqual(e["min"][2], 0, places=6)
        self.assertAlmostEqual(e["min"][0], -30, places=6)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 72000, places=1)
        self.assertAlmostEqual(r["report"]["massG"], 89.28, places=2)  # PLA 1.24 g/cm3

    def test_cylinder(self):
        r = w.rebuild({"base": {"kind": "cylinder", "diameter": 40, "height": 50}, "features": []}, False)
        self.assertAlmostEqual(r["report"]["volumeMm3"], math.pi * 400 * 50, delta=1)

    def test_contours_is_the_visual_hull(self):
        r = w.rebuild({"base": BRACKET, "features": []}, False)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000, places=1)
        self.assertEqual([round(v, 6) for v in r["report"]["extentsMm"]["size"]], [60, 40, 30])
        self.assertEqual(r["report"]["faces"], 8)

    def test_sketch(self):
        r = w.rebuild({"base": {"kind": "sketch", "plane": "XY", "points": [[0, 0], [30, 0], [0, 30]], "height": 10}, "features": []}, False)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 4500, places=1)

    def test_mesh_round_trip(self):
        stl = w.export_stl(w.base_box({"sizeX": 20, "sizeY": 20, "sizeZ": 20}), 0.05)
        import base64
        r = w.rebuild({"base": {"kind": "mesh", "stl": base64.b64encode(stl).decode()}, "features": []}, False)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 8000, delta=1)


class Features(unittest.TestCase):
    def test_hole_removes_a_cylinder(self):
        r = rebuild(BRACKET, [{"id": "h", "type": "hole", "params": {"axis": "z", "x": 10, "y": 0, "diameter": 6}}])
        self.assertTrue(r["features"][0]["ok"])
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000 - math.pi * 9 * 10, delta=1)

    def test_blind_hole_from_top(self):
        r = rebuild({"kind": "box", "sizeX": 40, "sizeY": 40, "sizeZ": 20}, [{"type": "hole", "params": {"diameter": 10, "depth": 5}}])
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000 - math.pi * 25 * 5, delta=1)

    def test_boss_box_sketch(self):
        feats = [
            {"type": "boss", "params": {"axis": "z", "x": 0, "y": 0, "from": 20, "diameter": 10, "height": 5}},
            {"type": "box-add", "params": {"center": [0, 0, 30], "size": [10, 10, 10]}},
            {"type": "box-cut", "params": {"center": [-15, -15, 5], "size": [10, 10, 30]}},
            {"type": "sketch-extrude", "params": {"plane": "XY", "offset": 20, "points": [[10, 10], [18, 10], [18, 18]], "height": 4, "mode": "add"}},
        ]
        r = rebuild({"kind": "box", "sizeX": 40, "sizeY": 40, "sizeZ": 20}, feats)
        self.assertEqual([f["ok"] for f in r["features"]], [True] * 4)
        expected = 32000 + math.pi * 25 * 5 + 1000 - 2000 + 32 * 4  # the cut box spans z -10..20: 20 mm of it lies inside
        self.assertAlmostEqual(r["report"]["volumeMm3"], expected, delta=1)

    def test_fillet_chamfer_shell(self):
        r = rebuild({"kind": "box", "sizeX": 40, "sizeY": 40, "sizeZ": 20}, [
            {"type": "fillet", "params": {"edges": "vertical", "radius": 5}},
            {"type": "chamfer", "params": {"edges": "top", "length": 1}},
            {"type": "shell", "params": {"thickness": 2, "openFace": "top"}},
        ])
        self.assertEqual([f["ok"] for f in r["features"]], [True, True, True])
        self.assertLess(r["report"]["volumeMm3"], 32000 * 0.5)
        self.assertTrue(r["report"]["valid"])

    def test_cut_plane_scale_mirror_rotate_translate(self):
        r = rebuild(BRACKET, [
            {"type": "cut-plane", "params": {"axis": "z", "at": 20, "keep": "below"}},
            {"type": "scale", "params": {"axis": "x", "target": 120}},
            {"type": "mirror", "params": {"plane": "YZ"}},
            {"type": "rotate", "params": {"axis": "z", "degrees": 90}},
            {"type": "translate", "params": {"dz": 5}},
        ])
        self.assertEqual([f["ok"] for f in r["features"]], [True] * 5)
        size = r["report"]["extentsMm"]["size"]
        self.assertAlmostEqual(size[1], 120, places=3)  # rotated: X became Y
        self.assertAlmostEqual(r["report"]["extentsMm"]["min"][2], 5, places=3)

    def test_refused_feature_is_reported_and_skipped(self):
        r = rebuild(BRACKET, [
            {"id": "bad", "type": "fillet", "params": {"edges": "all", "radius": 500}},
            {"id": "typo", "type": "holes", "params": {}},
            {"id": "off", "type": "hole", "enabled": False, "params": {"diameter": 6}},
            {"id": "good", "type": "hole", "params": {"axis": "z", "x": 10, "y": 0, "diameter": 6}},
        ])
        self.assertEqual([f["ok"] for f in r["features"]], [False, False, True, True])
        self.assertIn("kernel refused", r["features"][0]["error"])
        self.assertIn("feature.type", r["features"][1]["error"])
        self.assertTrue(r["features"][2]["skipped"])
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000 - math.pi * 9 * 10, delta=1)

    def test_bad_base_is_a_request_error(self):
        with self.assertRaises(w.FeatureError):
            w.rebuild({"base": {"kind": "box", "sizeX": -1, "sizeY": 1, "sizeZ": 1}, "features": []}, False)


class SketchFeatures(unittest.TestCase):
    """revolve, sweep and loft (BACKLOG B1). Every expected volume is derived by hand in the
    comment above it; the base is a 40 x 40 x 20 box (x, y in -20..20, z in 0..20, 32000 mm3)."""
    BOX = {"kind": "box", "sizeX": 40, "sizeY": 40, "sizeZ": 20}
    SQUARE10 = [[-5, -5], [5, -5], [5, 5], [-5, 5]]

    def assertBuilt(self, r, count):
        self.assertEqual([f["ok"] for f in r["features"]], [True] * count, r["features"])
        self.assertTrue(r["report"]["valid"])

    def test_revolve_touching_the_axis_cuts_a_cylinder(self):
        # 5 x 30 rectangle on XZ against the Z axis, a full turn: a cylinder r 5, z 0..30.
        # Inside the box it removes pi * 25 * 20.
        r = rebuild(self.BOX, [{"type": "revolve", "params": {"points": [[0, 0], [5, 0], [5, 30], [0, 30]], "mode": "cut"}}])
        self.assertBuilt(r, 1)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000 - math.pi * 25 * 20, delta=1)

    def test_revolve_annulus_is_pappus(self):
        # Profile r 10..20, z 0..30 off the axis: a tube. In a 60 x 60 x 20 box it removes
        # pi * (20^2 - 10^2) * 20 = 6000 pi.
        box = {"kind": "box", "sizeX": 60, "sizeY": 60, "sizeZ": 20}
        r = rebuild(box, [{"type": "revolve", "params": {"plane": "XZ", "axis": "z", "points": [[10, 0], [20, 0], [20, 30], [10, 30]], "mode": "cut"}}])
        self.assertBuilt(r, 1)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 72000 - 6000 * math.pi, delta=1)

    def test_revolve_about_the_planes_first_axis(self):
        # On XZ the first axis is X: a 20 x 5 rectangle on it becomes a cylinder r 5 along X,
        # x -10..10, centred on z = 0. Only its upper half is inside the box: pi * 25 * 20 / 2.
        r = rebuild(self.BOX, [{"type": "revolve", "params": {"axis": "x", "points": [[-10, 0], [10, 0], [10, 5], [-10, 5]], "mode": "cut"}}])
        self.assertBuilt(r, 1)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000 - math.pi * 25 * 20 / 2, delta=1)

    def test_revolve_partial_angle(self):
        # A 10 x 10 profile on the top face (z 20..30) against the Z axis, 90 degrees:
        # a quarter cylinder r 10, h 10 = pi * 100 * 10 / 4 added.
        r = rebuild(self.BOX, [{"type": "revolve", "params": {"points": [[0, 20], [10, 20], [10, 30], [0, 30]], "degrees": 90}}])
        self.assertBuilt(r, 1)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000 + math.pi * 100 * 10 / 4, delta=1)

    def test_sweep_straight_path_is_a_prism(self):
        # 10 x 10 square on XY swept up the Z axis 0..50; z 20..50 lies outside the box: 100 * 30.
        r = rebuild(self.BOX, [{"type": "sweep", "params": {"points": self.SQUARE10, "path": [[0, 0], [0, 50]]}}])
        self.assertBuilt(r, 1)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000 + 3000, delta=1)
        self.assertAlmostEqual(r["report"]["extentsMm"]["size"][2], 50, places=3)

    def test_sweep_mitred_corner_is_area_times_centreline(self):
        # Path up 40 then +X 30 (XZ plane). A right-corner mitre on a section symmetric about the
        # path adds on the outside exactly what it drops on the inside: volume = 100 * (40 + 30).
        # The first leg's z 0..20 (100 * 20) is already inside the box.
        r = rebuild(self.BOX, [{"type": "sweep", "params": {"points": self.SQUARE10, "path": [[0, 0], [0, 40], [30, 40]]}}])
        self.assertBuilt(r, 1)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000 + 7000 - 2000, delta=1)

    def test_loft_between_two_squares_is_a_frustum(self):
        # 20 x 20 at z 20 (on the top face) to 10 x 10 at z 50, ruled: a square frustum,
        # h / 3 * (A1 + A2 + sqrt(A1 A2)) = 30 / 3 * (400 + 100 + 200) = 7000.
        r = rebuild(self.BOX, [{"type": "loft", "params": {"sections": [
            {"points": [[-10, -10], [10, -10], [10, 10], [-10, 10]], "offset": 20},
            {"points": self.SQUARE10, "offset": 50}]}}])
        self.assertBuilt(r, 1)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000 + 7000, delta=1)

    def test_loft_three_ruled_sections_are_two_frustums(self):
        # 20 -> 10 -> 20 squares at z 20, 50, 80: two 7000 frusta end to end.
        big = [[-10, -10], [10, -10], [10, 10], [-10, 10]]
        r = rebuild(self.BOX, [{"type": "loft", "params": {"ruled": True, "sections": [
            {"points": big, "offset": 20}, {"points": self.SQUARE10, "offset": 50}, {"points": big, "offset": 80}]}}])
        self.assertBuilt(r, 1)
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000 + 14000, delta=1)
        self.assertAlmostEqual(r["report"]["extentsMm"]["max"][2], 80, places=3)

    def test_worker_refusals_are_per_feature(self):
        # The worker re-checks what the api's contract checks; each refusal is reported and
        # skipped, and the model stays the box.
        r = rebuild(self.BOX, [
            {"id": "axis", "type": "revolve", "params": {"points": [[1, 0], [2, 0], [2, 3]], "axis": "y"}},
            {"id": "path", "type": "sweep", "params": {"points": self.SQUARE10, "path": [[0, 0]]}},
            {"id": "one", "type": "loft", "params": {"sections": [{"points": self.SQUARE10, "offset": 0}]}},
            {"id": "same", "type": "loft", "params": {"sections": [{"points": self.SQUARE10, "offset": 5}, {"points": self.SQUARE10, "offset": 5}]}},
        ])
        self.assertEqual([f["ok"] for f in r["features"]], [False] * 4)
        self.assertIn("axis must be one of", r["features"][0]["error"])
        self.assertIn("path must be a list of 2..", r["features"][1]["error"])
        self.assertIn("sections must be a list of 2..", r["features"][2]["error"])
        self.assertIn("repeats an earlier section", r["features"][3]["error"])
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000, places=1)

    def test_hello_publishes_the_new_types_and_plane_axes(self):
        h = w.hello()
        for name in ("revolve", "sweep", "loft"):
            self.assertIn(name, h["features"])
        self.assertEqual(h["planeAxes"], {"XY": ["x", "y"], "XZ": ["x", "z"], "YZ": ["y", "z"]})
        self.assertEqual(h["maxSections"], 32)


class FeatureBudget(unittest.TestCase):
    """The per-feature budget (BACKLOG B5): read when the feature returns; over it, the feature is
    refused and its result discarded, and later features still run."""
    BOX = {"kind": "box", "sizeX": 40, "sizeY": 40, "sizeZ": 20}
    SHELL = {"id": "shell", "type": "shell", "params": {"thickness": 2, "openFace": "top"}}
    HOLE = {"id": "hole", "type": "hole", "params": {"diameter": 10}}

    def test_a_feature_past_its_budget_is_refused_and_discarded(self):
        # A hollowing shell (with its validity check) takes far longer than 1 ms on OCCT: refused,
        # its result discarded, so the solid is still the full box and never the shelled one
        # (< 16000 mm3). The hole after it still RUNS against that box; under the same 1 ms budget
        # it is accepted only if it returned within it.
        r = w.rebuild({"base": self.BOX, "features": [self.SHELL, self.HOLE], "featureBudgetMs": 1}, False)
        shell, hole = r["features"]
        self.assertFalse(shell["ok"])
        self.assertEqual(shell["code"], "budget_exceeded")
        self.assertGreater(shell["ms"], 1)
        self.assertIn("over the 1 ms per-feature budget", shell["error"])
        self.assertIn("ms", hole, "the feature after a budget refusal still ran")
        if hole["ok"]:
            self.assertLessEqual(hole["ms"], 1)
        else:
            self.assertEqual(hole["code"], "budget_exceeded")
        expected = 32000 - (math.pi * 25 * 20 if hole["ok"] else 0)
        self.assertAlmostEqual(r["report"]["volumeMm3"], expected, delta=1)

    def test_a_generous_budget_accepts_the_same_feature(self):
        r = w.rebuild({"base": self.BOX, "features": [self.SHELL], "featureBudgetMs": 600000}, False)
        self.assertTrue(r["features"][0]["ok"], r["features"][0])
        self.assertNotIn("code", r["features"][0])
        self.assertLess(r["report"]["volumeMm3"], 32000 * 0.5)

    def test_a_malformed_budget_is_a_request_refusal(self):
        for bad in (0, 600001, 2.5, "60000", True):
            with self.assertRaises(w.FeatureError, msg=repr(bad)):
                w.rebuild({"base": self.BOX, "features": [], "featureBudgetMs": bad}, False)

    def test_hello_publishes_the_budget_range(self):
        self.assertEqual(w.hello()["featureBudgetMs"], {"min": 1, "max": 600000})


def _parse_binary_stl(data):
    count = struct.unpack_from("<I", data, 80)[0]
    verts, vlist, tris = {}, [], []
    off = 84
    for _ in range(count):
        vals = struct.unpack_from("<12fH", data, off)
        off += 50
        tri = []
        for k in range(3):
            pt = (vals[3 + 3 * k], vals[4 + 3 * k], vals[5 + 3 * k])
            idx = verts.get(pt)
            if idx is None:
                idx = len(vlist)
                verts[pt] = idx
                vlist.append(pt)
            tri.append(idx)
        tris.append(tuple(tri))
    return vlist, tris


def validate_binary_stl(data):
    """Exact mirror of scan-to-print/src-routes/engine/geometry/mesh-validate.ts."""
    vlist, tris = _parse_binary_stl(data)
    xs = [v[0] for v in vlist]
    ys = [v[1] for v in vlist]
    zs = [v[2] for v in vlist]
    diag = math.sqrt((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2 + (max(zs) - min(zs)) ** 2)
    area_eps = diag * diag * 1e-12
    census, degen, vol6, referenced = {}, 0, 0.0, set()
    for a, b, c in tris:
        referenced.update((a, b, c))
        va, vb, vc = vlist[a], vlist[b], vlist[c]
        ab = (vb[0] - va[0], vb[1] - va[1], vb[2] - va[2])
        ac = (vc[0] - va[0], vc[1] - va[1], vc[2] - va[2])
        cx, cy, cz = ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]
        if 0.5 * math.sqrt(cx * cx + cy * cy + cz * cz) <= area_eps:
            degen += 1
        vol6 += (va[0] * (vb[1] * vc[2] - vb[2] * vc[1]) + va[1] * (vb[2] * vc[0] - vb[0] * vc[2])
                 + va[2] * (vb[0] * vc[1] - vb[1] * vc[0]))
        for e0, e1 in ((a, b), (b, c), (c, a)):
            key = (e0, e1) if e0 < e1 else (e1, e0)
            cnt, fwd = census.get(key, (0, 0))
            census[key] = (cnt + 1, fwd + (1 if e0 <= e1 else 0))
    boundary = sum(1 for c, _ in census.values() if c == 1)
    non_man = sum(1 for c, _ in census.values() if c > 2)
    winding = len(tris) > 0 and all(f == 1 for c, f in census.values() if c == 2)
    watertight = len(tris) > 0 and (boundary + non_man) == 0
    euler = len(referenced) - len(census) + len(tris)
    vol = vol6 / 6.0
    outward = watertight and winding and vol > 0
    return {
        "valid": watertight and winding and outward and degen == 0 and euler == 2,
        "watertight": watertight, "boundaryEdges": boundary, "nonManifoldEdges": non_man,
        "consistentWinding": winding, "outwardFacing": outward, "degenerate": degen,
        "eulerCharacteristic": euler, "volumeMm3": round(vol, 3), "triangles": len(tris),
    }


class ThreadAndTextFeatures(unittest.TestCase):
    """ISO metric thread and embossed/debossed text (BACKLOG B4) on the real OCCT kernel."""
    BOX = {"kind": "box", "sizeX": 40, "sizeY": 40, "sizeZ": 20}

    def assertValidMesh(self, res):
        stl_bytes = base64.b64decode(res["exports"]["stl"])
        mesh = validate_binary_stl(stl_bytes)
        self.assertTrue(mesh["valid"], f"STL failed mesh validation: {mesh}")
        self.assertEqual(mesh["boundaryEdges"], 0)
        self.assertEqual(mesh["nonManifoldEdges"], 0)
        self.assertEqual(mesh["degenerate"], 0)
        self.assertEqual(mesh["eulerCharacteristic"], 2)
        return mesh

    def test_external_threaded_boss_passes_mesh_validator(self):
        # M10x1.5, length 10 mm on top of a 40x40x20 box (base volume 32000 mm3).
        # Minor r = 5 - 5/8 * sqrt(3)/2 * 1.5 = 4.1881 mm -> minor cyl = 551.0 mm3, major cyl = 785.4 mm3.
        r = w.rebuild({
            "base": self.BOX,
            "features": [{"id": "m10-boss", "type": "thread", "params": {
                "kind": "external", "nominalDiameterMm": 10, "pitchMm": 1.5, "lengthMm": 10}}],
            "exports": ["stl"],
        }, True)
        self.assertTrue(r["features"][0]["ok"], r["features"])
        self.assertTrue(r["report"]["valid"])
        added = r["report"]["volumeMm3"] - 32000.0
        self.assertGreater(added, 551.0)
        self.assertLess(added, 785.4)
        self.assertAlmostEqual(r["report"]["extentsMm"]["max"][2], 30.0, places=3)
        self.assertValidMesh(r)

    def test_external_lefthand_thread_with_clearance_on_x_axis(self):
        r = w.rebuild({
            "base": self.BOX,
            "features": [{"id": "m8-lh", "type": "thread", "params": {
                "kind": "external", "nominalDiameterMm": 8, "pitchMm": 1.25, "lengthMm": 8,
                "axis": "x", "y": 0, "z": 10, "handedness": "left", "clearanceMm": 0.15}}],
            "exports": ["stl"],
        }, True)
        self.assertTrue(r["features"][0]["ok"], r["features"])
        self.assertTrue(r["report"]["valid"])
        self.assertGreater(r["report"]["volumeMm3"], 32000.0)
        self.assertAlmostEqual(r["report"]["extentsMm"]["max"][0], 28.0, places=3)
        self.assertValidMesh(r)

    def test_internal_threaded_hole_removes_material_and_is_watertight(self):
        r = w.rebuild({
            "base": self.BOX,
            "features": [{"id": "m10-hole", "type": "thread", "params": {
                "kind": "internal", "nominalDiameterMm": 10, "pitchMm": 1.5, "lengthMm": 10}}],
            "exports": ["stl"],
        }, True)
        self.assertTrue(r["features"][0]["ok"], r["features"])
        self.assertTrue(r["report"]["valid"])
        removed = 32000.0 - r["report"]["volumeMm3"]
        self.assertGreater(removed, 551.0)
        self.assertLess(removed, 785.4)
        self.assertValidMesh(r)

    def test_embossed_text_increases_volume_and_is_watertight(self):
        r = w.rebuild({
            "base": self.BOX,
            "features": [{"id": "lbl-emb", "type": "text", "params": {
                "text": "OSHAL", "mode": "emboss", "sizeMm": 8, "depthMm": 1.0, "face": "top"}}],
            "exports": ["stl"],
        }, True)
        self.assertTrue(r["features"][0]["ok"], r["features"])
        self.assertTrue(r["report"]["valid"])
        self.assertGreater(r["report"]["volumeMm3"], 32000.0)
        self.assertAlmostEqual(r["report"]["extentsMm"]["max"][2], 21.0, places=3)
        self.assertValidMesh(r)

    def test_debossed_text_decreases_volume_and_is_watertight(self):
        r = w.rebuild({
            "base": self.BOX,
            "features": [{"id": "lbl-deb", "type": "text", "params": {
                "text": "OSHAL", "mode": "deboss", "sizeMm": 8, "depthMm": 1.0, "face": "front", "angleDeg": 5}}],
            "exports": ["stl"],
        }, True)
        self.assertTrue(r["features"][0]["ok"], r["features"])
        self.assertTrue(r["report"]["valid"])
        self.assertLess(r["report"]["volumeMm3"], 32000.0)
        self.assertValidMesh(r)

    def test_thread_and_text_refusals_and_hello(self):
        r = rebuild(self.BOX, [
            {"id": "bad-kind", "type": "thread", "params": {"kind": "tapered", "nominalDiameterMm": 10, "pitchMm": 1.5, "lengthMm": 10}},
            {"id": "bad-pitch", "type": "thread", "params": {"kind": "external", "nominalDiameterMm": 6, "pitchMm": 3.5, "lengthMm": 10}},
            {"id": "bad-len", "type": "thread", "params": {"kind": "external", "nominalDiameterMm": 10, "pitchMm": 1.5, "lengthMm": 1.0}},
            {"id": "empty-txt", "type": "text", "params": {"text": "   ", "sizeMm": 8, "depthMm": 1.0}},
            {"id": "bad-mode", "type": "text", "params": {"text": "OK", "mode": "engrave", "sizeMm": 8, "depthMm": 1.0}},
        ])
        self.assertEqual([f["ok"] for f in r["features"]], [False] * 5)
        self.assertIn("kind", r["features"][0]["error"])
        self.assertIn("pitchMm", r["features"][1]["error"])
        self.assertIn("lengthMm", r["features"][2]["error"])
        self.assertIn("text", r["features"][3]["error"])
        self.assertIn("mode", r["features"][4]["error"])
        self.assertAlmostEqual(r["report"]["volumeMm3"], 32000.0, places=1)
        h = w.hello()
        self.assertIn("thread", h["features"])
        self.assertIn("text", h["features"])
        self.assertEqual(h["bundledFont"], "LiberationSans-Regular.ttf")


class Exports(unittest.TestCase):
    def test_step_stl_svg_and_byte_stability(self):
        args = {"base": BRACKET, "features": [{"type": "hole", "params": {"x": 10, "y": 0, "diameter": 6}}], "views": ["front", "top"]}
        a = w.rebuild(dict(args), True)
        b = w.rebuild(dict(args), True)
        self.assertTrue(a["exports"]["step"].startswith("ISO-10303-21"))
        self.assertEqual(a["exports"]["step"], b["exports"]["step"], "STEP must be byte-stable for the same list")
        self.assertEqual(a["exports"]["stl"], b["exports"]["stl"])
        self.assertIn("<svg", a["exports"]["svg"]["front"])
        self.assertEqual(sorted(a["exports"]["svg"]), ["front", "top"])


class Protocol(unittest.TestCase):
    def test_every_line_is_answered(self):
        proc = subprocess.Popen([sys.executable, os.path.join(ENGINE_DIR, "cad_worker.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        lines = [json.dumps({"id": 1, "cmd": "hello"}), "not json", json.dumps({"id": 3, "cmd": "nope"}),
                 json.dumps({"id": 4, "cmd": "check", "args": {"base": {"kind": "box", "sizeX": 1, "sizeY": 1, "sizeZ": 1}, "features": []}})]
        out, _ = proc.communicate(("\n".join(lines) + "\n").encode("utf-8"), timeout=120)
        answers = [json.loads(l) for l in out.decode("utf-8").splitlines() if l.strip()]
        self.assertEqual([a["ok"] for a in answers], [True, False, False, True])
        self.assertEqual(answers[0]["result"]["protocol"], w.PROTOCOL)
        self.assertIn("hole", answers[0]["result"]["features"])
        self.assertEqual(answers[3]["result"]["exports"], {})


if __name__ == "__main__":
    unittest.main()
