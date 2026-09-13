#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the CAD Studio engine
#   |                                           | worker: a JSON-lines stdio interpreter that rebuilds a
#   |                                           | model from a BASE (box, cylinder, sketch, scan contours
#   |                                           | = intersection of extruded view outlines, or an STL
#   |                                           | mesh sewn into a solid) plus an ORDERED FEATURE LIST
#   |                                           | (hole, boss, box add/cut, sketch extrude, fillet,
#   |                                           | chamfer, shell, cut plane, scale, mirror, rotate,
#   |                                           | translate) on the OCCT kernel through CadQuery, then
#   |                                           | reports geometry (extents, volume, area, mass at a
#   |                                           | density, validity) and exports STEP (timestamp
#   |                                           | normalised so the same list gives the same bytes), a
#   |                                           | binary STL and hidden-line SVG views. A feature that
#   |                                           | the kernel refuses is reported failed WITH the reason
#   |                                           | and skipped, so an iterating agent always gets a
#   |                                           | buildable model back. No network, no filesystem beyond
#   |                                           | a scratch dir, nothing the model list did not say.
"""cad_worker -- CAD Studio's deterministic rebuild worker (CadQuery / OCCT).

Protocol (one JSON object per line on stdin, one per line on stdout):
  request  {"id": <any>, "cmd": "hello" | "rebuild" | "check", "args": {...}}
  response {"id": <same>, "ok": true, "result": {...}}
           {"id": <same>, "ok": false, "error": {"code": "...", "message": "..."}}

`rebuild` args: {"base": {...}, "features": [...], "exports": ["step","stl","svg"],
                 "views": ["front","top","right","iso"], "densityGcm3": 1.24, "stlToleranceMm": 0.05}
`check` is `rebuild` without exports (fast validation of a list).

World frame == Scan to Print's: right-handed, Z up, millimetres, footprint centred on X=Y=0,
the base rests on Z=0, the front faces -Y.
"""
import base64
import io
import json
import math
import os
import re
import sys
import tempfile
import time

import cadquery as cq

PROTOCOL = 1
VIEW_DIRECTIONS = {
    "front": (0, -1, 0), "back": (0, 1, 0), "left": (-1, 0, 0), "right": (1, 0, 0),
    "top": (0, 0, 1), "bottom": (0, 0, -1), "iso": (1, -1, 1),
}
EDGE_SELECTORS = {
    "all": None, "vertical": "|Z", "horizontal": "#Z", "top": ">Z", "bottom": "<Z",
    "parallel-x": "|X", "parallel-y": "|Y", "parallel-z": "|Z",
}
FACE_SELECTORS = {"top": ">Z", "bottom": "<Z", "front": "<Y", "back": ">Y", "left": "<X", "right": ">X"}
PLANES = {"XY": "XY", "XZ": "XZ", "YZ": "YZ"}
AXES = ("x", "y", "z")
LIMITS = {"maxFeatures": 200, "maxPoints": 2000, "maxDimensionMm": 2000.0, "minDimensionMm": 0.01}


class FeatureError(Exception):
    """A feature the kernel or the contract refuses; reported per feature, never fatal."""


# ── helpers ────────────────────────────────────────────────────────────────────
def _num(value, name, lo=None, hi=None):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise FeatureError(f"{name} must be a finite number")
    if lo is not None and value < lo:
        raise FeatureError(f"{name} must be >= {lo}")
    if hi is not None and value > hi:
        raise FeatureError(f"{name} must be <= {hi}")
    return float(value)


def _dim(value, name):
    return _num(value, name, LIMITS["minDimensionMm"], LIMITS["maxDimensionMm"])


def _points(value, name):
    if not isinstance(value, list) or len(value) < 3 or len(value) > LIMITS["maxPoints"]:
        raise FeatureError(f"{name} must be a list of 3..{LIMITS['maxPoints']} [u, v] points")
    pts = []
    for p in value:
        if not isinstance(p, list) or len(p) != 2:
            raise FeatureError(f"{name} points must be [u, v] pairs")
        pts.append((_num(p[0], name + ".u", -LIMITS["maxDimensionMm"], LIMITS["maxDimensionMm"]),
                    _num(p[1], name + ".v", -LIMITS["maxDimensionMm"], LIMITS["maxDimensionMm"])))
    return pts


def _choice(value, name, choices):
    if value not in choices:
        raise FeatureError(f"{name} must be one of {sorted(choices)}")
    return value


def _bbox(shape):
    bb = shape.val().BoundingBox()
    return {"min": [bb.xmin, bb.ymin, bb.zmin], "max": [bb.xmax, bb.ymax, bb.zmax],
            "size": [bb.xlen, bb.ylen, bb.zlen]}


def _rest_on_bed(shape):
    """Centre the footprint on X = Y = 0 and rest the part on Z = 0 (the shared world frame)."""
    bb = shape.val().BoundingBox()
    return shape.translate((-(bb.xmin + bb.xmax) / 2, -(bb.ymin + bb.ymax) / 2, -bb.zmin))


def _cylinder(axis, u, v, along_from, along_to, diameter):
    """A cylinder of `diameter` along `axis` between two coordinates, centred at (u, v) in the
    other two axes (u, v are the remaining axes in x, y, z order)."""
    r = diameter / 2
    length = along_to - along_from
    if axis == "z":
        return cq.Workplane("XY").workplane(offset=along_from).center(u, v).circle(r).extrude(length)
    if axis == "x":
        # YZ plane: u = y, v = z; plane normal +X, offset along X.
        return cq.Workplane("YZ").workplane(offset=along_from).center(u, v).circle(r).extrude(length)
    # XZ plane normal is -Y in CadQuery; extrude towards +Y by using a negative offset frame.
    return (cq.Workplane("XZ").workplane(offset=-along_from).center(u, v).circle(r).extrude(-length))


def _axis_index(axis):
    return AXES.index(axis)


def _validity(shape):
    try:
        return bool(shape.val().isValid())
    except Exception:  # noqa: BLE001 -- OCCT can throw from a broken shape; that is the answer
        return False


# ── bases ──────────────────────────────────────────────────────────────────────
def base_box(p):
    sx, sy, sz = _dim(p.get("sizeX"), "sizeX"), _dim(p.get("sizeY"), "sizeY"), _dim(p.get("sizeZ"), "sizeZ")
    return cq.Workplane("XY").box(sx, sy, sz).translate((0, 0, sz / 2))


def base_cylinder(p):
    d, h = _dim(p.get("diameter"), "diameter"), _dim(p.get("height"), "height")
    return cq.Workplane("XY").circle(d / 2).extrude(h)


def base_sketch(p):
    plane = _choice(p.get("plane", "XY"), "plane", PLANES)
    pts = _points(p.get("points"), "points")
    h = _dim(p.get("height"), "height")
    return _rest_on_bed(cq.Workplane(plane).polyline(pts).close().extrude(h))


def base_contours(p):
    """The scan bridge: each view outline (mm, in that view's image axes) extruded along its
    viewing axis; the solid is their intersection -- the visual hull as a B-rep."""
    views = p.get("views")
    if not isinstance(views, dict) or not views:
        raise FeatureError("contours.views must map view names to outlines")
    size = p.get("size") or {}
    depth = max(_dim(size.get(a, 1.0), "size." + a) for a in AXES) * 2 + 1
    solids = []
    if "front" in views:  # front outline in (X, Z), looks along +Y: extrude along Y
        pts = _points(views["front"], "views.front")
        solids.append(cq.Workplane("XZ").polyline(pts).close().extrude(depth, both=True))
    if "top" in views:  # top outline in (X, Y) with the front (-Y) at the bottom of the image
        pts = _points(views["top"], "views.top")
        solids.append(cq.Workplane("XY").polyline(pts).close().extrude(depth, both=True))
    if "right" in views:  # right outline in (Y, Z), looks along -X: extrude along X
        pts = _points(views["right"], "views.right")
        solids.append(cq.Workplane("YZ").polyline(pts).close().extrude(depth, both=True))
    if not solids:
        raise FeatureError("contours needs at least one of front, top, right")
    shape = solids[0]
    for other in solids[1:]:
        shape = shape.intersect(other)
    return _rest_on_bed(shape)


MESH_MAX_TRIANGLES = 100_000


def _read_stl_triangulation(data: bytes):
    """Read STL bytes into an OCCT Poly_Triangulation (the reader handles ASCII and binary)."""
    from OCP.RWStl import RWStl
    tmp = tempfile.NamedTemporaryFile(suffix=".stl", delete=False)
    try:
        tmp.write(data)
        tmp.close()
        tri = RWStl.ReadFile_s(tmp.name)
    finally:
        os.unlink(tmp.name)
    if tri is None:
        raise FeatureError("mesh.stl could not be read")
    return tri


def base_mesh(p):
    """An STL (base64) turned into a B-rep solid: one planar face per triangle, sewn into a shell,
    closed into a solid (what FreeCAD's makeShapeFromMesh does). Refused honestly when the mesh
    does not close, is not a valid solid, or is too large for interactive booleans."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeSolid, BRepBuilderAPI_Sewing
    from OCP.BRepLib import BRepLib
    from OCP.TopAbs import TopAbs_SHELL
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    raw = p.get("stl")
    if not isinstance(raw, str) or not raw:
        raise FeatureError("mesh.stl must be a base64 STL")
    data = base64.b64decode(raw)
    if len(data) > 64 * 1024 * 1024:
        raise FeatureError("mesh.stl exceeds 64 MB")
    tri = _read_stl_triangulation(data)
    count = tri.NbTriangles()
    if count > MESH_MAX_TRIANGLES:
        raise FeatureError(f"mesh.stl has {count} triangles; the limit for a CAD base is {MESH_MAX_TRIANGLES} — reduce the scan resolution")
    sewing = BRepBuilderAPI_Sewing(1e-4)
    for i in range(1, count + 1):
        a, b, c = tri.Triangle(i).Get()
        polygon = BRepBuilderAPI_MakePolygon(tri.Node(a), tri.Node(b), tri.Node(c), True)
        if not polygon.IsDone():
            continue  # a degenerate (zero-area) triangle adds nothing to the surface
        face = BRepBuilderAPI_MakeFace(polygon.Wire(), True)
        if face.IsDone():
            sewing.Add(face.Face())
    sewing.Perform()
    exp = TopExp_Explorer(sewing.SewedShape(), TopAbs_SHELL)
    if not exp.More():
        raise FeatureError("mesh.stl did not sew into a closed shell (open edges)")
    shell = TopoDS.Shell_s(exp.Current())
    solid = BRepBuilderAPI_MakeSolid(shell).Solid()
    BRepLib.OrientClosedSolid_s(solid)
    wp = cq.Workplane("XY").newObject([cq.Shape.cast(solid)])
    if not _validity(wp) or wp.val().Volume() <= 0:
        raise FeatureError("mesh.stl did not close into a valid solid (open edges or self-intersections)")
    return _rest_on_bed(wp)


BASES = {"box": base_box, "cylinder": base_cylinder, "sketch": base_sketch, "contours": base_contours, "mesh": base_mesh}


# ── features ───────────────────────────────────────────────────────────────────
def feat_hole(shape, p):
    axis = _choice(p.get("axis", "z"), "axis", AXES)
    d = _dim(p.get("diameter"), "diameter")
    bb = shape.val().BoundingBox()
    lo = [bb.xmin, bb.ymin, bb.zmin][_axis_index(axis)]
    hi = [bb.xmax, bb.ymax, bb.zmax][_axis_index(axis)]
    others = [a for a in AXES if a != axis]
    u = _num(p.get(others[0], 0.0), others[0], -LIMITS["maxDimensionMm"], LIMITS["maxDimensionMm"])
    v = _num(p.get(others[1], 0.0), others[1], -LIMITS["maxDimensionMm"], LIMITS["maxDimensionMm"])
    if p.get("through", "depth" not in p):
        tool = _cylinder(axis, u, v, lo - 1, hi + 1, d)
    else:
        depth = _dim(p.get("depth"), "depth")
        tool = _cylinder(axis, u, v, hi - depth, hi + 1, d)  # blind, from the + side
    return shape.cut(tool)


def feat_boss(shape, p):
    axis = _choice(p.get("axis", "z"), "axis", AXES)
    d, h = _dim(p.get("diameter"), "diameter"), _dim(p.get("height"), "height")
    others = [a for a in AXES if a != axis]
    u = _num(p.get(others[0], 0.0), others[0], -LIMITS["maxDimensionMm"], LIMITS["maxDimensionMm"])
    v = _num(p.get(others[1], 0.0), others[1], -LIMITS["maxDimensionMm"], LIMITS["maxDimensionMm"])
    start = _num(p.get("from", 0.0), "from", -LIMITS["maxDimensionMm"], LIMITS["maxDimensionMm"])
    return shape.union(_cylinder(axis, u, v, start, start + h, d))


def _box_tool(p):
    c = p.get("center") or [0, 0, 0]
    s = p.get("size")
    if not isinstance(c, list) or len(c) != 3 or not isinstance(s, list) or len(s) != 3:
        raise FeatureError("center and size must be [x, y, z]")
    cx, cy, cz = (_num(c[i], "center", -LIMITS["maxDimensionMm"], LIMITS["maxDimensionMm"]) for i in range(3))
    sx, sy, sz = (_dim(s[i], "size") for i in range(3))
    return cq.Workplane("XY").box(sx, sy, sz).translate((cx, cy, cz))


def feat_box_add(shape, p):
    return shape.union(_box_tool(p))


def feat_box_cut(shape, p):
    return shape.cut(_box_tool(p))


def feat_sketch_extrude(shape, p):
    plane = _choice(p.get("plane", "XY"), "plane", PLANES)
    pts = _points(p.get("points"), "points")
    h = _dim(p.get("height"), "height")
    offset = _num(p.get("offset", 0.0), "offset", -LIMITS["maxDimensionMm"], LIMITS["maxDimensionMm"])
    mode = _choice(p.get("mode", "add"), "mode", ("add", "cut"))
    tool = cq.Workplane(plane).workplane(offset=offset).polyline(pts).close().extrude(h)
    return shape.union(tool) if mode == "add" else shape.cut(tool)


def _edges(shape, selection):
    sel = EDGE_SELECTORS[_choice(selection, "edges", EDGE_SELECTORS)]
    return shape.edges() if sel is None else shape.edges(sel)


def feat_fillet(shape, p):
    r = _dim(p.get("radius"), "radius")
    return _edges(shape, p.get("edges", "all")).fillet(r)


def feat_chamfer(shape, p):
    length = _dim(p.get("length"), "length")
    return _edges(shape, p.get("edges", "all")).chamfer(length)


def feat_shell(shape, p):
    t = _dim(p.get("thickness"), "thickness")
    open_face = _choice(p.get("openFace", "none"), "openFace", ("none",) + tuple(FACE_SELECTORS))
    if open_face == "none":
        return shape.shell(-t)
    return shape.faces(FACE_SELECTORS[open_face]).shell(-t)


def feat_cut_plane(shape, p):
    axis = _choice(p.get("axis", "z"), "axis", AXES)
    at = _num(p.get("at"), "at", -LIMITS["maxDimensionMm"], LIMITS["maxDimensionMm"])
    keep = _choice(p.get("keep", "below"), "keep", ("below", "above"))
    big = LIMITS["maxDimensionMm"] * 2
    half = cq.Workplane("XY").box(big, big, big)
    i = _axis_index(axis)
    offset = [0.0, 0.0, 0.0]
    offset[i] = at + (big / 2 if keep == "above" else -big / 2)
    return shape.intersect(half.translate(tuple(offset)))


def feat_scale(shape, p):
    if "factor" in p:
        f = _num(p.get("factor"), "factor", 0.001, 1000.0)
    else:
        axis = _choice(p.get("axis", "x"), "axis", AXES)
        target = _dim(p.get("target"), "target")
        current = _bbox(shape)["size"][_axis_index(axis)]
        if current <= 0:
            raise FeatureError("cannot scale a zero-size extent")
        f = target / current
    return _rest_on_bed(cq.Workplane("XY").newObject([shape.val().scale(f)]))


def feat_mirror(shape, p):
    plane = _choice(p.get("plane", "YZ"), "plane", PLANES)
    return _rest_on_bed(shape.mirror(plane))


def feat_rotate(shape, p):
    axis = _choice(p.get("axis", "z"), "axis", AXES)
    deg = _num(p.get("degrees"), "degrees", -360.0, 360.0)
    end = [0, 0, 0]
    end[_axis_index(axis)] = 1
    return _rest_on_bed(shape.rotate((0, 0, 0), tuple(end), deg))


def feat_translate(shape, p):
    d = [_num(p.get(k, 0.0), k, -LIMITS["maxDimensionMm"], LIMITS["maxDimensionMm"]) for k in ("dx", "dy", "dz")]
    return shape.translate(tuple(d))


FEATURES = {
    "hole": feat_hole, "boss": feat_boss, "box-add": feat_box_add, "box-cut": feat_box_cut,
    "sketch-extrude": feat_sketch_extrude, "fillet": feat_fillet, "chamfer": feat_chamfer, "shell": feat_shell,
    "cut-plane": feat_cut_plane, "scale": feat_scale, "mirror": feat_mirror, "rotate": feat_rotate,
    "translate": feat_translate,
}


# ── rebuild ────────────────────────────────────────────────────────────────────
def build(base, features):
    """Apply the base then every enabled feature in order. A refused feature is recorded and
    skipped; the returned shape is always the last valid one."""
    if not isinstance(base, dict):
        raise FeatureError("base must be an object")
    kind = _choice(base.get("kind"), "base.kind", BASES)
    shape = BASES[kind](base)
    if not _validity(shape):
        raise FeatureError(f"base {kind} produced an invalid solid")
    if not isinstance(features, list) or len(features) > LIMITS["maxFeatures"]:
        raise FeatureError(f"features must be a list of at most {LIMITS['maxFeatures']}")
    statuses = []
    for index, feature in enumerate(features):
        fid = feature.get("id") if isinstance(feature, dict) else None
        status = {"id": fid, "index": index, "ok": False}
        if not isinstance(feature, dict):
            status["error"] = "feature must be an object"
        elif feature.get("enabled", True) is False:
            status.update(ok=True, skipped=True)
        else:
            started = time.time()
            try:
                ftype = _choice(feature.get("type"), "feature.type", FEATURES)
                params = feature.get("params") or {}
                if not isinstance(params, dict):
                    raise FeatureError("feature.params must be an object")
                candidate = FEATURES[ftype](shape, params)
                if candidate.val().Volume() <= 0 or not _validity(candidate):
                    raise FeatureError("the kernel returned an empty or invalid solid")
                shape = candidate
                status.update(ok=True, ms=int((time.time() - started) * 1000))
            except FeatureError as err:
                status["error"] = str(err)
            except Exception as err:  # noqa: BLE001 -- OCCT/CadQuery raise plain exceptions
                status["error"] = f"kernel refused: {type(err).__name__}: {str(err)[:300]}"
        statuses.append(status)
    return shape, statuses


def report_for(shape, density_gcm3):
    solid = shape.val()
    bb = _bbox(shape)
    volume = solid.Volume()
    area = solid.Area()
    center = solid.Center()
    return {
        "extentsMm": bb, "volumeMm3": round(volume, 3), "surfaceAreaMm2": round(area, 3),
        "massG": round(volume / 1000.0 * density_gcm3, 3), "densityGcm3": density_gcm3,
        "centerOfMassMm": [round(center.x, 3), round(center.y, 3), round(center.z, 3)],
        "faces": shape.faces().size(), "edges": shape.edges().size(), "vertices": shape.vertices().size(),
        "valid": _validity(shape),
    }


STEP_FILE_NAME = re.compile(r"FILE_NAME\(.*?\);", re.S)
STEP_FILE_NAME_PINNED = ("FILE_NAME('cad-studio model','2000-01-01T00:00:00',('oshal'),('oshal'),"
                         "'Open CASCADE STEP processor','oshal cad-studio','Unknown');")
STEP_PRODUCT_COUNTER = re.compile(r"'Open CASCADE STEP translator [0-9.]+ \d+'")


def export_step(shape):
    path = os.path.join(tempfile.mkdtemp(), "model.step")
    cq.exporters.export(shape, path)
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    # The header carries the wall-clock time and the PRODUCT entity a per-session counter
    # ('Open CASCADE STEP translator 7.7 N'); pin both so equal models are equal bytes.
    text = STEP_FILE_NAME.sub(lambda _m: STEP_FILE_NAME_PINNED, text, count=1)
    text = STEP_PRODUCT_COUNTER.sub("'cad-studio part'", text)
    return text


def export_stl(shape, tolerance):
    path = os.path.join(tempfile.mkdtemp(), "model.stl")
    cq.exporters.export(shape, path, tolerance=tolerance, angularTolerance=0.1)
    with open(path, "rb") as fh:
        return fh.read()


def export_svg(shape, view):
    path = os.path.join(tempfile.mkdtemp(), f"{view}.svg")
    cq.exporters.export(shape, path, opt={"projectionDir": VIEW_DIRECTIONS[view], "showHidden": True,
                                          "width": 480, "height": 360, "marginLeft": 12, "marginTop": 12})
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def rebuild(args, with_exports):
    started = time.time()
    density = _num(args.get("densityGcm3", 1.24), "densityGcm3", 0.01, 30.0)
    shape, statuses = build(args.get("base"), args.get("features") or [])
    result = {"report": report_for(shape, density), "features": statuses, "exports": {}}
    if with_exports:
        wanted = set(args.get("exports") or ["step", "stl", "svg"])
        if "step" in wanted:
            result["exports"]["step"] = export_step(shape)
        if "stl" in wanted:
            tol = _num(args.get("stlToleranceMm", 0.05), "stlToleranceMm", 0.005, 1.0)
            result["exports"]["stl"] = base64.b64encode(export_stl(shape, tol)).decode("ascii")
        if "svg" in wanted:
            views = args.get("views") or ["front", "top", "right", "iso"]
            result["exports"]["svg"] = {v: export_svg(shape, _choice(v, "view", VIEW_DIRECTIONS)) for v in views}
    result["ms"] = int((time.time() - started) * 1000)
    return result


def hello():
    import OCP
    return {"protocol": PROTOCOL, "kernel": "OCCT", "cadquery": cq.__version__,
            "ocp": getattr(OCP, "__version__", "unknown"), "bases": sorted(BASES), "features": sorted(FEATURES),
            "edgeSelectors": sorted(EDGE_SELECTORS), "faceSelectors": ["none"] + sorted(FACE_SELECTORS), "limits": LIMITS}


def handle(request):
    cmd = request.get("cmd")
    args = request.get("args") or {}
    if cmd == "hello":
        return hello()
    if cmd == "rebuild":
        return rebuild(args, True)
    if cmd == "check":
        return rebuild(args, False)
    raise FeatureError(f"unknown command {cmd!r}")


def main():
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", newline="\n", write_through=True)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        rid = None
        try:
            request = json.loads(raw)
            rid = request.get("id")
            result = handle(request)
            out.write(json.dumps({"id": rid, "ok": True, "result": result}, allow_nan=False) + "\n")
        except FeatureError as err:
            out.write(json.dumps({"id": rid, "ok": False, "error": {"code": "refused", "message": str(err)}}) + "\n")
        except Exception as err:  # noqa: BLE001 -- the worker must answer every line
            out.write(json.dumps({"id": rid, "ok": False, "error": {"code": "engine_error", "message": f"{type(err).__name__}: {str(err)[:500]}"}}) + "\n")


if __name__ == "__main__":
    main()
