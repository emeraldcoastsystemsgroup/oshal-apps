#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- slice an STL into a printer-ready
#   |                                           | Bambu Lab `.gcode.3mf` with the OrcaSlicer CLI and the
#   |                                           | vendor's own system profiles. JSON lines on stdin/stdout
#   |                                           | (the cad-studio worker shape). Two CLI behaviours are
#   |                                           | corrected here, each found on a real P2S: the CLI does not
#   |                                           | resolve a system profile's `inherits` chain (it silently
#   |                                           | falls back to defaults -- bed 45 C, no brim, wrong cooling),
#   |                                           | so the chain is merged first; and its .gcode.3mf leaves
#   |                                           | printer_model_id blank, first_layer_time uninitialised and
#   |                                           | the plate previews missing although _rels/.rels links them,
#   |                                           | so the archive is finished before it is returned.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes: a filament named exactly (no ` @` suffix, e.g.
#   |                                           | "Generic PLA") is selectable; a BBL profile whose `inherits`
#   |                                           | names an OrcaFilamentLibrary parent resolves (the library is
#   |                                           | consulted only for parents, and a library parent's own ancestors
#   |                                           | are resolved within the library, as OrcaSlicer does); the
#   |                                           | slicer's timeout is shorter than the api client's so the worker
#   |                                           | always answers (and cleans up) first.
"""slicer_worker -- STL -> Bambu .gcode.3mf through OrcaSlicer (stdlib + Pillow)."""
import base64
import glob
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

PROTOCOL = 1
ORCA_DIR = os.environ.get("ORCA_SLICER_DIR", "/opt/orcaslicer")
PROFILES = os.path.join(ORCA_DIR, "resources", "profiles", "BBL")
LIBRARY = os.path.join(ORCA_DIR, "resources", "profiles", "OrcaFilamentLibrary")
PLATES = ("Cool Plate", "Engineering Plate", "High Temp Plate", "Textured PEI Plate", "Textured Cool Plate", "Supertack Plate")
NOZZLES = ("0.2", "0.4", "0.6", "0.8")
MAX_STL_BYTES = 64 * 1024 * 1024
# Below the api client's 600 s ceiling, so a slow slice is answered (and cleaned up) by the worker.
SLICE_TIMEOUT_S = int(os.environ.get("SCAN_TO_PRINT_SLICE_TIMEOUT_S", "540"))


class Refused(Exception):
    """A request the worker will not run (bad input), as opposed to an engine failure."""


def load_index(profiles_dir=PROFILES):
    """@description Every vendor profile by (kind, name), plus printer models by model id.
    @param profiles_dir The BBL profile tree. @returns (index, models)."""
    index, models = {}, {}
    for kind in ("machine", "process", "filament"):
        for path in glob.glob(os.path.join(profiles_dir, kind, "**", "*.json"), recursive=True):
            try:
                with open(path, encoding="utf-8") as fh:
                    data = json.load(fh)
            except (OSError, ValueError):
                continue
            if "name" not in data:
                continue
            index[(kind, data["name"])] = data
            if kind == "machine" and data.get("model_id"):
                models[data["model_id"]] = data
    return index, models


def flatten(index, kind, name, depth=0, library=None):
    """@description Merge a profile with every ancestor named by `inherits`, child keys winning.
    A parent missing from `index` is looked up in `library` (OrcaFilamentLibrary), and that parent's
    own ancestors are then resolved within the library.
    @returns A self-contained profile dict. @raises Refused for an unknown name or a loop."""
    if depth > 16:
        raise Refused(f"{kind} profile chain for '{name}' is too deep")
    data = index.get((kind, name))
    if data is None and library is not None and depth > 0:
        data = library.get((kind, name))
        if data is not None:
            index = library
    if data is None:
        raise Refused(f"no {kind} profile named '{name}'")
    merged = flatten(index, kind, data["inherits"], depth + 1, library) if data.get("inherits") else {}
    merged.update({k: v for k, v in data.items() if k != "inherits"})
    return merged


def pick_filament(index, machine_name, filament):
    """@description The filament profile named `<filament>` or `<filament> @...` that lists this machine as
    compatible (the exact name sorts first, so it wins)."""
    prefix = f"{filament} @"
    for (kind, name), data in sorted(index.items()):
        if kind == "filament" and (name == filament or name.startswith(prefix)) and machine_name in (data.get("compatible_printers") or []):
            return name
    raise Refused(f"no '{filament}' profile is compatible with {machine_name}")


def resolve(index, models, spec, library=None):
    """@description Turn a slice request into the three merged profiles the CLI loads.
    @param spec {modelId|printerModel, nozzle, filament, plate}. @returns dict of profiles + names."""
    model = models.get(spec.get("modelId") or "") or next(
        (m for m in models.values() if m.get("name") == spec.get("printerModel")), None)
    if model is None:
        raise Refused(f"unknown Bambu Lab printer model {spec.get('modelId') or spec.get('printerModel')!r}")
    nozzle = str(spec.get("nozzle") or "0.4")
    if nozzle not in NOZZLES:
        raise Refused(f"nozzle must be one of {', '.join(NOZZLES)}")
    plate = spec.get("plate") or model.get("default_bed_type") or "Textured PEI Plate"
    if plate not in PLATES:
        raise Refused(f"plate must be one of {', '.join(PLATES)}")
    machine_name = f"{model['name']} {nozzle} nozzle"
    machine = flatten(index, "machine", machine_name)
    process_name = machine.get("default_print_profile")
    if not process_name:
        raise Refused(f"{machine_name} names no default print profile")
    filament_name = pick_filament(index, machine_name, spec.get("filament") or "Bambu PLA Basic")
    process = flatten(index, "process", process_name)
    process["curr_bed_type"] = plate
    return {"model": model, "machine": machine, "process": process,
            "filament": flatten(index, "filament", filament_name, library=library), "plate": plate, "nozzle": nozzle,
            "names": {"machine": machine_name, "process": process_name, "filament": filament_name}}


def write_profiles(resolved, work):
    """@description Write the merged profiles for the CLI; returns their paths in load order."""
    paths = []
    for tag in ("machine", "process", "filament"):
        data = dict(resolved[tag])
        data.pop("instantiation", None)
        data["from"] = "system"
        path = os.path.join(work, f"{tag}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        paths.append(path)
    return paths


def run_orca(stl_path, resolved, work, out_name):
    """@description Slice one STL with the CLI (argv, no shell). @returns the archive path."""
    machine, process, filament = write_profiles(resolved, work)
    cmd = [os.path.join(ORCA_DIR, "bin", "orca-slicer"), "--arrange", "1", "--orient", "0",
           "--load-settings", f"{machine};{process}", "--load-filaments", filament,
           "--slice", "0", "--outputdir", work, "--export-3mf", out_name, stl_path]
    env = {k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR", "LANG") if k in os.environ}
    env["LC_ALL"] = "C"
    proc = subprocess.run(cmd, cwd=work, env=env, capture_output=True, timeout=SLICE_TIMEOUT_S)
    result_path = os.path.join(work, "result.json")
    result = {}
    if os.path.exists(result_path):
        with open(result_path, encoding="utf-8") as fh:
            result = json.load(fh)
    out = os.path.join(work, out_name)
    if proc.returncode != 0 or result.get("return_code") != 0 or not os.path.exists(out):
        tail = (proc.stderr or b"").decode("utf-8", "replace").strip().splitlines()[-6:]
        raise RuntimeError(f"OrcaSlicer failed (exit {proc.returncode}): {result.get('error_string') or ' | '.join(tail)}")
    return out


def _shade(points, triangles, rotate, size, color, shaded):
    """Painter's-algorithm orthographic drawing of a mesh; returns PNG bytes."""
    from PIL import Image, ImageDraw
    pts = [rotate(p) for p in points]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    span = max(max(xs) - min(xs), max(ys) - min(ys)) or 1.0
    scale, cx, cy = size * 0.86 / span, (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for tri in sorted(triangles, key=lambda t: sum(pts[i][2] for i in t)):
        a, b, c = (pts[i] for i in tri)
        u = [b[k] - a[k] for k in range(3)]
        w = [c[k] - a[k] for k in range(3)]
        n = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
        length = math.sqrt(sum(x * x for x in n)) or 1.0
        light = 0.35 + 0.65 * abs(n[2] / length) if shaded else 1.0
        fill = tuple(min(255, int(ch * light)) for ch in color) + (255,)
        draw.polygon([(size / 2 + (p[0] - cx) * scale, size / 2 - (p[1] - cy) * scale) for p in (a, b, c)], fill=fill)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def _iso(p):
    """Turn 45 degrees about Z, then tilt the top toward the viewer."""
    c, s = math.cos(math.radians(45)), math.sin(math.radians(45))
    x, y, z = p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]
    ct, st = math.cos(math.radians(55)), math.sin(math.radians(55))
    return (x, y * ct + z * st, -y * st + z * ct)


def previews(mesh_xml, color_hex):
    """@description The five plate images a Bambu Studio export carries, drawn from the archive's mesh."""
    from PIL import Image
    points = [tuple(map(float, m)) for m in re.findall(r'<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"', mesh_xml)]
    triangles = [tuple(map(int, m)) for m in re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', mesh_xml)]
    if not points or not triangles:
        raise RuntimeError("the sliced archive carries no mesh to draw previews from")
    color = tuple(int(color_hex[i:i + 2], 16) for i in (1, 3, 5))
    iso = _shade(points, triangles, _iso, 512, color, True)
    small = io.BytesIO()
    Image.open(io.BytesIO(iso)).resize((128, 128), Image.LANCZOS).save(small, "PNG")
    return {"Metadata/plate_1.png": iso, "Metadata/plate_1_small.png": small.getvalue(),
            "Metadata/plate_no_light_1.png": iso, "Metadata/top_1.png": _shade(points, triangles, lambda p: p, 512, color, True),
            "Metadata/pick_1.png": _shade(points, triangles, lambda p: p, 512, color, False)}


PREVIEW_KEYS = ('    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>\n'
                '    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_1.png"/>\n'
                '    <metadata key="top_file" value="Metadata/top_1.png"/>\n'
                '    <metadata key="pick_file" value="Metadata/pick_1.png"/>')


def _seconds(text):
    """'1h 2m 3s' / '5m 13s' / '40s' -> seconds."""
    total = 0
    for value, unit in re.findall(r"(\d+)\s*([dhms])", text or ""):
        total += int(value) * {"d": 86400, "h": 3600, "m": 60, "s": 1}[unit]
    return total


def finish_archive(path, model_id):
    """@description Repair the CLI's archive (model id, first-layer time, previews) in place.
    @returns The estimate the printer will show: print seconds, first-layer seconds, grams."""
    with zipfile.ZipFile(path) as src:
        files = {i.filename: src.read(i.filename) for i in src.infolist()}
    gcode = files["Metadata/plate_1.gcode"].decode("utf-8", "replace")
    first = _seconds((re.search(r"first layer printing time \(normal mode\) = ([^\n]+)", gcode) or [None, ""])[1])
    total = _seconds((re.search(r"total estimated time: ([^\n;]+)", gcode) or [None, ""])[1])
    info = files["Metadata/slice_info.config"].decode("utf-8")
    info = re.sub(r'(key="printer_model_id" value=")[^"]*"', rf'\g<1>{model_id}"', info)
    info = re.sub(r'(key="first_layer_time" value=")[^"]*"', rf'\g<1>{first}"', info)
    files["Metadata/slice_info.config"] = info.encode("utf-8")
    color = (re.search(r'color="(#[0-9A-Fa-f]{6})', info) or [None, "#F2754E"])[1]
    mesh = "".join(v.decode("utf-8", "replace") for k, v in files.items() if k.startswith("3D/Objects/") and k.endswith(".model"))
    files.update(previews(mesh, color))
    settings = files["Metadata/model_settings.config"].decode("utf-8")
    anchor = '<metadata key="gcode_file" value="Metadata/plate_1.gcode"/>'
    if "thumbnail_file" not in settings and anchor in settings:
        files["Metadata/model_settings.config"] = settings.replace(anchor, anchor + "\n" + PREVIEW_KEYS).encode("utf-8")
    md5 = hashlib.md5(files["Metadata/plate_1.gcode"]).hexdigest().upper()
    if files.get("Metadata/plate_1.gcode.md5", b"").decode().strip().upper() != md5:
        raise RuntimeError("the sliced G-code does not match its own checksum")
    with zipfile.ZipFile(path + ".part", "w", zipfile.ZIP_DEFLATED) as out:
        for name, data in files.items():
            out.writestr(name, data)
    os.replace(path + ".part", path)
    grams = re.search(r'key="weight" value="([0-9.]+)"', info)
    return {"printSeconds": total, "firstLayerSeconds": first, "filamentGrams": float(grams.group(1)) if grams else None}


def _first(value):
    """A profile value that may be a one-element list -> its first element (or None)."""
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _safe_stem(name):
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.splitext(os.path.basename(str(name or "part")))[0]).strip("-.")
    return (stem or "part")[:80]


def cmd_slice(args, state):
    """@description args {stl: base64, name, modelId|printerModel, nozzle, filament, plate}."""
    raw = base64.b64decode(args.get("stl") or "", validate=True)
    if not raw or len(raw) > MAX_STL_BYTES:
        raise Refused(f"stl must be 1 byte .. {MAX_STL_BYTES} bytes")
    resolved = resolve(state["index"], state["models"], args, state.get("library"))
    stem = _safe_stem(args.get("name"))
    work = tempfile.mkdtemp(prefix="slice-")
    try:
        stl_path = os.path.join(work, f"{stem}.stl")
        with open(stl_path, "wb") as fh:
            fh.write(raw)
        started = time.time()
        out = run_orca(stl_path, resolved, work, f"{stem}.gcode.3mf")
        estimate = finish_archive(out, resolved["model"]["model_id"])
        with open(out, "rb") as fh:
            archive = fh.read()
        return {"fileName": f"{stem}.gcode.3mf", "archive": base64.b64encode(archive).decode("ascii"),
                "bytes": len(archive), "estimate": estimate, "ms": int((time.time() - started) * 1000),
                "profile": {"modelId": resolved["model"]["model_id"], "printerModel": resolved["model"]["name"],
                            "nozzle": resolved["nozzle"], "plate": resolved["plate"],
                            "filamentType": _first(resolved["filament"].get("filament_type")), **resolved["names"]}}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def cmd_profiles(_args, state):
    """@description The printer models, nozzles, plates and per-model filament names this engine slices for."""
    out = []
    for model_id, model in sorted(state["models"].items(), key=lambda kv: kv[1]["name"]):
        machines = [f"{model['name']} {n} nozzle" for n in NOZZLES if ("machine", f"{model['name']} {n} nozzle") in state["index"]]
        default_machine = f"{model['name']} 0.4 nozzle"
        filaments = sorted({name.split(" @")[0] for (kind, name), d in state["index"].items()
                            if kind == "filament" and default_machine in (d.get("compatible_printers") or [])})
        out.append({"modelId": model_id, "printerModel": model["name"], "defaultPlate": model.get("default_bed_type"),
                    "nozzles": [m.split()[-2] for m in machines], "filaments": filaments})
    return {"printers": out, "plates": list(PLATES)}


def cmd_hello(_args, state):
    return {"protocol": PROTOCOL, "orcaSlicer": state["version"], "printerModels": len(state["models"])}


COMMANDS = {"hello": cmd_hello, "profiles": cmd_profiles, "slice": cmd_slice}


def orca_version():
    try:
        with open(os.path.join(PROFILES, "..", "BBL.json"), encoding="utf-8") as fh:
            profiles = json.load(fh).get("version")
    except (OSError, ValueError):
        profiles = None
    return {"profiles": profiles, "dir": ORCA_DIR}


def handle(line, state):
    """@description One request line -> one response dict (never raises)."""
    try:
        req = json.loads(line)
        req_id = req.get("id")
    except (ValueError, AttributeError):
        return {"id": None, "ok": False, "error": {"code": "refused", "message": "unparseable request line"}}
    fn = COMMANDS.get(req.get("cmd"))
    if fn is None:
        return {"id": req_id, "ok": False, "error": {"code": "refused", "message": f"unknown command {req.get('cmd')!r}"}}
    try:
        return {"id": req_id, "ok": True, "result": fn(req.get("args") or {}, state)}
    except (Refused, ValueError) as exc:
        return {"id": req_id, "ok": False, "error": {"code": "refused", "message": str(exc)}}
    except Exception as exc:  # noqa: BLE001 -- every failure becomes a response line, never a dead worker
        sys.stderr.write(f"[slicer-worker] {req.get('cmd')} failed: {exc!r}\n")
        return {"id": req_id, "ok": False, "error": {"code": "engine_error", "message": str(exc)}}


def main():
    index, models = load_index()
    library, _ = load_index(LIBRARY)
    state = {"index": index, "models": models, "library": library, "version": orca_version()}
    for line in sys.stdin:
        if line.strip():
            sys.stdout.write(json.dumps(handle(line, state)) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
