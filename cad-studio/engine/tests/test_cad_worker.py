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
"""Real-kernel tests for cad_worker (need CadQuery; they run in the engine image)."""
import json
import math
import os
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
