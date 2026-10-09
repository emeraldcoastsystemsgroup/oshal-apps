#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the Scene Studio engine's
#   |                                           | operations on one project: the project file map
#   |                                           | (validated both ways), a throwaway job directory per
#   |                                           | request, every Godot / Blender / MCP process started
#   |                                           | through sandbox_exec.py, the allowlisted tools of the
#   |                                           | two upstream MCP servers (godot-mcp, Blender Lab MCP)
#   |                                           | with the project path injected by the engine, a
#   |                                           | headless Godot run, a Cycles CPU preview render (a
#   |                                           | Godot scene goes through glTF into Blender), exports,
#   |                                           | and a Blender model imported into a Godot project.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.1.1: create_scene refuses a scenePath that already
#   |                                           | exists. godot-mcp silently replaces the file, so a
#   |                                           | create on main.tscn wiped the scene (found in the
#   |                                           | studio's first live test).
"""scene_ops -- what the Scene Studio engine does to one project (stdlib only).

A project travels as a FILE MAP: [{"path": "main.tscn", "data": "<base64>"}, ...]. The api owns the
files and their revisions; the engine is stateless. Each request materialises the map in a fresh job
directory, runs the job sandboxed, collects the regular files back (never following a symlink) and
answers with what changed. Nothing a job writes outlives the request.
"""
import base64
import binascii
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid

from mcp_client import McpError, McpSession, content_text

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.join(ENGINE_DIR, "scripts")

LIMITS = {
    "max_files": 4000,
    "max_file_bytes": 48 * 1024 * 1024,
    "max_total_bytes": 64 * 1024 * 1024,
    "max_path_chars": 240,
    "max_depth": 12,
    "max_text_bytes": 2 * 1024 * 1024,
}
_SEGMENT = re.compile(r"^[A-Za-z0-9 _.@()+,=~\[\]-]{1,120}$")
#: Derived state Godot rebuilds on its own; never part of a stored project.
_SKIP_PREFIXES = (".godot/editor/", ".godot/shader_cache/")
_SKIP_SUFFIXES = (".blend1", ".blend2")
_GODOT_ASSET = re.compile(r"\.(png|jpe?g|webp|svg|bmp|tga|exr|hdr|glb|gltf|obj|fbx|wav|ogg|mp3|ttf|otf)$", re.I)
_NAME = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_NODE_PATH = re.compile(r"^[A-Za-z0-9_/ -]{1,200}$")

GODOT_MAIN_SCENE = "main.tscn"
BLENDER_MAIN_FILE = "scene.blend"

#: The godot-mcp tools a request may call: whether the call changes the project, and which
#: arguments are project-relative file paths the engine validates before godot-mcp sees them.
GODOT_TOOLS = {
    "create_scene": {"mutates": True, "paths": ("scenePath",)},
    "add_node": {"mutates": True, "paths": ("scenePath",)},
    "load_sprite": {"mutates": True, "paths": ("scenePath", "texturePath")},
    "export_mesh_library": {"mutates": True, "paths": ("scenePath", "outputPath")},
    "save_scene": {"mutates": True, "paths": ("scenePath", "newPath")},
    "get_uid": {"mutates": False, "paths": ("filePath",)},
    "get_project_info": {"mutates": False, "paths": ()},
}
#: The Blender Lab MCP tools a request may call. `file` = the engine injects blend_file;
#: the live-session tools (screenshots, jump-to, viewport renders) need a GUI Blender and are left out.
BLENDER_TOOLS = {
    "execute_blender_code_for_cli": {"mutates": True, "file": True},
    "get_blendfile_summary_datablocks_for_cli": {"mutates": False, "file": True},
    "get_blendfile_summary_missing_files_for_cli": {"mutates": False, "file": True},
    "get_blendfile_summary_of_linked_libraries_for_cli": {"mutates": False, "file": True},
    "get_blendfile_summary_path_info_for_cli": {"mutates": False, "file": True},
    "get_blendfile_summary_usage_guess_for_cli": {"mutates": False, "file": True},
    "get_python_api_docs": {"mutates": False, "file": False},
    "search_api_docs": {"mutates": False, "file": False},
    "search_manual_docs": {"mutates": False, "file": False},
}
EXPORT_FORMATS = {
    "godot": {"zip": "application/zip"},
    "blender": {"glb": "model/gltf-binary", "fbx": "application/octet-stream", "obj": "text/plain",
                "stl": "model/stl", "zip": "application/zip"},
}
TEMPLATES = {"godot": ("3d", "2d", "empty"), "blender": ("default", "empty")}


class OpError(Exception):
    """A refused or failed operation. `code`: refused | engine_error | engine_timeout."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Config:
    """Where the engine's programs live; the container defaults, overridable for a host checkout."""

    def __init__(self, env=None):
        env = os.environ if env is None else env
        self.python = env.get("SCENE_STUDIO_PYTHON") or sys.executable
        self.sandbox = env.get("SCENE_STUDIO_SANDBOX") or os.path.join(ENGINE_DIR, "sandbox_exec.py")
        self.node = env.get("SCENE_STUDIO_NODE") or "/usr/local/bin/node"
        self.godot_mcp = env.get("SCENE_STUDIO_GODOT_MCP") or "/opt/godot-mcp/build/index.js"
        self.godot = env.get("SCENE_STUDIO_GODOT") or "/opt/scene-studio/bin/godot-headless"
        self.blender = env.get("SCENE_STUDIO_BLENDER") or "/opt/scene-studio/bin/blender"
        self.blender_mcp = env.get("SCENE_STUDIO_BLENDER_MCP") or "/opt/blender-mcp/venv/bin/blender-mcp"
        self.job_root = env.get("SCENE_STUDIO_JOB_ROOT") or "/tmp/jobs"
        self.threads = _int_env(env, "SCENE_STUDIO_THREADS", 4, 1, 64)
        self.path = env.get("SCENE_STUDIO_JOB_PATH") or "/opt/scene-studio/bin:/usr/local/bin:/usr/bin:/bin"


def _int_env(env, key, default, lo, hi):
    try:
        value = int(env.get(key, default))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, value))


# ── File maps ────────────────────────────────────────────────────────────────

def validate_path(raw):
    """@description Accept a project-relative POSIX path, or refuse it.
    A leading res:// (Godot's project scheme) is accepted and dropped.
    @returns The normalised path. @throws OpError(refused)."""
    if not isinstance(raw, str):
        raise OpError("refused", "a file path must be a string")
    path = raw[6:] if raw.startswith("res://") else raw
    if not path or len(path) > LIMITS["max_path_chars"]:
        raise OpError("refused", f"file path must be 1-{LIMITS['max_path_chars']} characters")
    if path.startswith("/") or "\\" in path or "\0" in path:
        raise OpError("refused", f"file path {raw!r} must be relative, with forward slashes")
    segments = path.split("/")
    if len(segments) > LIMITS["max_depth"]:
        raise OpError("refused", f"file path {raw!r} is nested too deep")
    for segment in segments:
        if segment in ("", ".", "..") or not _SEGMENT.match(segment):
            raise OpError("refused", f"file path {raw!r} has an unsafe segment {segment!r}")
    return path


def decode_files(files):
    """@description Validate and decode a request's file map.
    @returns {path: bytes}. @throws OpError(refused) on any bad entry or a size limit."""
    if not isinstance(files, list):
        raise OpError("refused", "files must be a list of {path, data}")
    if len(files) > LIMITS["max_files"]:
        raise OpError("refused", f"a project holds at most {LIMITS['max_files']} files")
    out = {}
    total = 0
    for entry in files:
        if not isinstance(entry, dict):
            raise OpError("refused", "each file must be an object {path, data}")
        path = validate_path(entry.get("path"))
        if path in out:
            raise OpError("refused", f"duplicate file path {path!r}")
        try:
            data = base64.b64decode(str(entry.get("data", "")), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise OpError("refused", f"file {path!r} is not valid base64") from exc
        if len(data) > LIMITS["max_file_bytes"]:
            raise OpError("refused", f"file {path!r} is over {LIMITS['max_file_bytes'] // (1024 * 1024)} MB")
        total += len(data)
        if total > LIMITS["max_total_bytes"]:
            raise OpError("refused", f"project is over {LIMITS['max_total_bytes'] // (1024 * 1024)} MB")
        out[path] = data
    return out


def encode_files(files):
    """@description {path: bytes} -> the wire file map, sorted by path."""
    return [{"path": p, "data": base64.b64encode(files[p]).decode("ascii")} for p in sorted(files)]


def materialize(files, root):
    """@description Write a decoded file map under root (which must be empty)."""
    for path, data in files.items():
        target = os.path.join(root, *path.split("/"))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as fh:
            fh.write(data)


def _skipped(rel):
    return rel.startswith(_SKIP_PREFIXES) or rel.endswith(_SKIP_SUFFIXES)


def collect(root):
    """@description Read a project tree back: regular files only, no symlink is ever followed.
    @returns {path: bytes}. @throws OpError(engine_error) when the job grew past a limit."""
    out = {}
    total = 0
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))]
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if _skipped(rel) or os.path.islink(full) or not os.path.isfile(full):
                continue
            try:
                rel = validate_path(rel)
            except OpError:
                continue  # a name the store would refuse is not carried back
            size = os.path.getsize(full)
            total += size
            if size > LIMITS["max_file_bytes"] or total > LIMITS["max_total_bytes"] or len(out) >= LIMITS["max_files"]:
                raise OpError("engine_error", f"the job left a project over the limits ({rel})")
            with open(full, "rb") as fh:
                out[rel] = fh.read()
    return out


def diff(before, after):
    """@description What changed between two file maps. @returns {added, modified, deleted}."""
    added = sorted(p for p in after if p not in before)
    deleted = sorted(p for p in before if p not in after)
    modified = sorted(p for p in after if p in before and
                      hashlib.sha256(after[p]).digest() != hashlib.sha256(before[p]).digest())
    return {"added": added, "modified": modified, "deleted": deleted}


def _changed(delta):
    return bool(delta["added"] or delta["modified"] or delta["deleted"])


# ── Jobs ─────────────────────────────────────────────────────────────────────

class _Capture:
    """Read one stream to EOF, keeping at most `cap` bytes (the rest is counted, not kept)."""

    def __init__(self, stream, cap):
        self.buf = bytearray()
        self.dropped = 0
        self.cap = cap
        self.thread = threading.Thread(target=self._run, args=(stream,), daemon=True)
        self.thread.start()

    def _run(self, stream):
        try:
            for chunk in iter(lambda: stream.read(65536), b""):
                room = self.cap - len(self.buf)
                if room > 0:
                    self.buf.extend(chunk[:room])
                self.dropped += max(0, len(chunk) - max(room, 0))
        except (OSError, ValueError):
            pass

    def text(self):
        self.thread.join(timeout=5)
        out = bytes(self.buf).decode("utf-8", "replace")
        return out + (f"\n... [{self.dropped} more bytes cut]" if self.dropped else "")


class Job:
    """One request's throwaway directory and the sandboxed processes it runs."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.dir = os.path.join(cfg.job_root, uuid.uuid4().hex)
        self.project = os.path.join(self.dir, "project")
        self.home = os.path.join(self.dir, "home")
        self.tmp = os.path.join(self.dir, "tmp")
        self.out = os.path.join(self.dir, "out")
        for d in (self.project, self.home, self.tmp, self.out):
            os.makedirs(d, mode=0o700, exist_ok=True)

    def env(self):
        """@description The whole environment a job sees: nothing from the bridge's own."""
        return {
            "PATH": self.cfg.path,
            "HOME": self.home,
            "TMPDIR": self.tmp,
            "XDG_CONFIG_HOME": os.path.join(self.home, ".config"),
            "XDG_DATA_HOME": os.path.join(self.home, ".local", "share"),
            "XDG_CACHE_HOME": os.path.join(self.home, ".cache"),
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "GODOT_PATH": self.cfg.godot,
            "BLENDER_PATH": self.cfg.blender,
            "BLENDER_MCP_HOST": "127.0.0.1",
            "BLENDER_MCP_PORT": "9876",
            "SCENE_STUDIO_THREADS": str(self.cfg.threads),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONNOUSERSITE": "1",
            "PYTHONUNBUFFERED": "1",
        }

    def sandboxed(self, argv, cpu_seconds):
        return [self.cfg.python, self.cfg.sandbox, "--cpu-seconds", str(int(cpu_seconds)), "--file-mb", "256", "--", *argv]

    def run(self, argv, timeout, cpu_seconds=None, output_cap=1024 * 1024):
        """@description Run one sandboxed command to completion or the wall-clock timeout.
        @returns {code, stdout, stderr, ms}. @throws OpError(engine_timeout) on timeout."""
        started = time.monotonic()
        proc = subprocess.Popen(self.sandboxed(argv, cpu_seconds or max(60, timeout * self.cfg.threads)),
                                env=self.env(), cwd=self.dir, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, start_new_session=True, close_fds=True)
        out = _Capture(proc.stdout, output_cap)
        err = _Capture(proc.stderr, output_cap)
        try:
            code = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_group(proc)
            raise OpError("engine_timeout", f"{os.path.basename(argv[0])} did not finish within {timeout:.0f}s")
        finally:
            _kill_group(proc)
        return {"code": code, "stdout": out.text(), "stderr": err.text(), "ms": int((time.monotonic() - started) * 1000)}

    def mcp(self, server):
        """@description Start one upstream MCP server, sandboxed, with this job's environment."""
        if server == "godot":
            argv = [self.cfg.node, self.cfg.godot_mcp]
        elif server == "blender":
            argv = [self.cfg.blender_mcp]
        else:
            raise OpError("refused", f"unknown MCP server {server!r}")
        return McpSession(self.sandboxed(argv, cpu_seconds=900), self.env(), self.dir)

    def cleanup(self):
        shutil.rmtree(self.dir, ignore_errors=True)


def _kill_group(proc):
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def _require_kind(req):
    kind = req.get("kind")
    if kind not in ("godot", "blender"):
        raise OpError("refused", "kind must be 'godot' or 'blender'")
    return kind


def _bounded_int(req, key, default, lo, hi):
    value = req.get(key, default)
    if not isinstance(value, int) or isinstance(value, bool) or not lo <= value <= hi:
        raise OpError("refused", f"{key} must be an integer from {lo} to {hi}")
    return value


def _tail(text, limit=6000):
    return text if len(text) <= limit else "..." + text[-limit:]


def _script(name):
    return os.path.join(SCRIPTS_DIR, name)


def _run_ok(job, argv, timeout, what):
    res = job.run(argv, timeout)
    if res["code"] != 0:
        raise OpError("engine_error", f"{what} failed (exit {res['code']}): {_tail(res['stderr'] or res['stdout'])}")
    return res


def _blender_script(job, blend, script, args, timeout, what):
    argv = [job.cfg.blender, "--background"]
    argv += [blend] if blend else ["--factory-startup"]
    argv += ["--python", _script(script), "--", *args]
    res = _run_ok(job, argv, timeout, what)
    marker = "__SCENE_STUDIO__"
    for line in reversed(res["stdout"].splitlines()):
        if line.startswith(marker):
            return json.loads(line[len(marker):])
    raise OpError("engine_error", f"{what} produced no result: {_tail(res['stdout'] + res['stderr'])}")


def _godot_import(job):
    """Run Godot's importer when an asset in the project has no .import sidecar yet."""
    missing = []
    for dirpath, _dirs, files in os.walk(job.project):
        if os.path.relpath(dirpath, job.project).split(os.sep)[0] == ".godot":
            continue
        for name in files:
            if _GODOT_ASSET.search(name) and not os.path.exists(os.path.join(dirpath, name + ".import")):
                missing.append(name)
    if missing:
        _run_ok(job, [job.cfg.godot, "--path", job.project, "--import"], 180, "Godot asset import")


# ── Operations ───────────────────────────────────────────────────────────────

def op_new_project(cfg, req):
    """@description A new project's starting files. @returns {files}."""
    kind = _require_kind(req)
    template = req.get("template") or TEMPLATES[kind][0]
    if template not in TEMPLATES[kind]:
        raise OpError("refused", f"template must be one of {', '.join(TEMPLATES[kind])}")
    title = str(req.get("title") or "Untitled").replace('"', "'")[:80]
    if kind == "godot":
        return {"files": encode_files(_godot_template(template, title))}
    job = Job(cfg)
    try:
        blend = os.path.join(job.project, BLENDER_MAIN_FILE)
        _blender_script(job, None, "blender_new.py", ["--template", template, "--out", blend], 90, "Creating the Blender file")
        return {"files": encode_files(collect(job.project))}
    finally:
        job.cleanup()


def _godot_template(template, title):
    project = (
        "; Engine configuration file.\n; Written by OSHAL Scene Studio.\n\nconfig_version=5\n\n"
        f"[application]\n\nconfig/name=\"{title}\"\nrun/main_scene=\"res://{GODOT_MAIN_SCENE}\"\n"
        "config/features=PackedStringArray(\"4.7\", \"GL Compatibility\")\n\n"
        "[rendering]\n\nrenderer/rendering_method=\"gl_compatibility\"\n"
        "renderer/rendering_method.mobile=\"gl_compatibility\"\n"
    )
    if template == "2d":
        scene = ('[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n\n'
                 '[node name="Camera2D" type="Camera2D" parent="."]\n')
    elif template == "empty":
        scene = '[gd_scene format=3]\n\n[node name="Main" type="Node3D"]\n'
    else:
        scene = (
            '[gd_scene load_steps=3 format=3]\n\n'
            '[sub_resource type="PlaneMesh" id="PlaneMesh_ground"]\nsize = Vector2(20, 20)\n\n'
            '[sub_resource type="StandardMaterial3D" id="Material_ground"]\nalbedo_color = Color(0.36, 0.48, 0.36, 1)\n\n'
            '[node name="Main" type="Node3D"]\n\n'
            '[node name="Ground" type="MeshInstance3D" parent="."]\n'
            'mesh = SubResource("PlaneMesh_ground")\nsurface_material_override/0 = SubResource("Material_ground")\n\n'
            '[node name="Sun" type="DirectionalLight3D" parent="."]\n'
            'transform = Transform3D(1, 0, 0, 0, 0.5, 0.866025, 0, -0.866025, 0.5, 0, 8, 0)\n\n'
            '[node name="Camera" type="Camera3D" parent="."]\n'
            'transform = Transform3D(1, 0, 0, 0, 0.906308, 0.422618, 0, -0.422618, 0.906308, 0, 4, 9)\n'
        )
    return {"project.godot": project.encode("utf-8"), GODOT_MAIN_SCENE: scene.encode("utf-8")}


def op_tools(cfg, _req):
    """@description The allowlisted tools of both MCP servers, as the servers describe them,
    minus the arguments the engine injects. @returns {godot: [...], blender: [...], servers}."""
    out = {"servers": {}}
    for server, allow, injected in (("godot", GODOT_TOOLS, ("projectPath",)), ("blender", BLENDER_TOOLS, ("blend_file",))):
        job = Job(cfg)
        session = job.mcp(server)
        try:
            info = session.initialize(60)
            tools = session.list_tools(60)
        except McpError as exc:
            raise OpError("engine_error", f"{server} MCP server did not start: {exc}") from exc
        finally:
            session.close()
            job.cleanup()
        out["servers"][server] = info.get("serverInfo") or {}
        out[server] = [_strip_tool(t, injected) for t in tools if t.get("name") in allow]
    return out


def _strip_tool(tool, injected):
    schema = json.loads(json.dumps(tool.get("inputSchema") or {"type": "object", "properties": {}}))
    props = schema.get("properties") or {}
    for key in injected:
        props.pop(key, None)
    if isinstance(schema.get("required"), list):
        schema["required"] = [k for k in schema["required"] if k not in injected]
    return {"name": tool.get("name"), "description": tool.get("description", ""), "inputSchema": schema}


def op_mcp_call(cfg, req):
    """@description Call one allowlisted tool of godot-mcp or the Blender Lab MCP on the project.
    @returns {text, isError, changed, delta, files?}."""
    server = req.get("server")
    tool = req.get("tool")
    table = GODOT_TOOLS if server == "godot" else BLENDER_TOOLS if server == "blender" else None
    if table is None:
        raise OpError("refused", "server must be 'godot' or 'blender'")
    spec = table.get(tool)
    if spec is None:
        raise OpError("refused", f"{server} tool {tool!r} is not one Scene Studio runs (allowed: {', '.join(sorted(table))})")
    args = req.get("arguments") or {}
    if not isinstance(args, dict):
        raise OpError("refused", "arguments must be an object")
    timeout = _bounded_int(req, "timeoutSec", 120, 5, 300)
    files = decode_files(req.get("files") or [])
    job = Job(cfg)
    try:
        materialize(files, job.project)
        args = _shape_arguments(server, tool, spec, dict(args), job, req)
        if server == "godot":
            _godot_import(job)
        session = job.mcp(server)
        try:
            session.initialize(60)
            result = session.call_tool(tool, args, timeout)
        except McpError as exc:
            raise OpError("engine_timeout" if exc.code == "timeout" else "engine_error", f"{server} {tool}: {exc}") from exc
        finally:
            session.close()
        text, is_error = content_text(result)
        reply = {"text": text, "isError": is_error, "changed": False, "delta": {"added": [], "modified": [], "deleted": []}}
        if spec["mutates"] and not is_error:
            after = collect(job.project)
            delta = diff(files, after)
            reply["delta"] = delta
            if _changed(delta):
                reply["changed"] = True
                reply["files"] = encode_files(after)
        return reply
    finally:
        job.cleanup()


def _shape_arguments(server, tool, spec, args, job, req):
    """Inject the project location and validate every caller-supplied project path."""
    if server == "godot":
        if "projectPath" in args:
            raise OpError("refused", "projectPath is set by Scene Studio, not the caller")
        if not os.path.exists(os.path.join(job.project, "project.godot")):
            raise OpError("refused", "this is not a Godot project (no project.godot)")
        for key in spec["paths"]:
            if key in args and args[key] is not None:
                args[key] = validate_path(args[key])
        scene = args.get("scenePath")
        if tool == "create_scene" and isinstance(scene, str) and os.path.exists(os.path.join(job.project, *scene.split("/"))):
            raise OpError("refused", f"{scene} already exists; create_scene would replace it. Delete it first or choose another path")
        args["projectPath"] = job.project
        return args
    if "blend_file" in args:
        raise OpError("refused", "blend_file is set by Scene Studio, not the caller")
    if spec["file"]:
        rel = validate_path(req.get("file") or BLENDER_MAIN_FILE)
        if not rel.endswith(".blend") or not os.path.isfile(os.path.join(job.project, rel)):
            raise OpError("refused", f"{rel} is not a .blend file in this project")
        args["blend_file"] = os.path.join(job.project, rel)
        if tool == "execute_blender_code_for_cli":
            code = args.get("code")
            if not isinstance(code, str) or not code.strip():
                raise OpError("refused", "code must be a non-empty string")
            if req.get("save", True):
                args["code"] = code + _save_snippet(args["blend_file"])
    return args


def _save_snippet(path):
    return (
        "\n\n# Scene Studio: keep what the code above built.\n"
        "import bpy as _scene_studio_bpy\n"
        "_scene_studio_bpy.context.preferences.filepaths.save_version = 0\n"
        f"_scene_studio_bpy.ops.wm.save_as_mainfile(filepath={path!r}, compress=True)\n"
    )


def op_godot_run(cfg, req):
    """@description Run a Godot project headless for a few seconds through godot-mcp
    (run_project, get_debug_output, stop_project). Read-only: nothing it writes is kept.
    @returns {output, errors, seconds}."""
    seconds = _bounded_int(req, "seconds", 5, 1, 30)
    scene = req.get("scene")
    files = decode_files(req.get("files") or [])
    job = Job(cfg)
    try:
        materialize(files, job.project)
        if not os.path.exists(os.path.join(job.project, "project.godot")):
            raise OpError("refused", "this is not a Godot project (no project.godot)")
        args = {"projectPath": job.project}
        if scene:
            args["scene"] = validate_path(scene)
        _godot_import(job)
        session = job.mcp("godot")
        try:
            session.initialize(60)
            started = session.call_tool("run_project", args, 60)
            text, is_error = content_text(started)
            if is_error:
                raise OpError("engine_error", f"run_project: {text}")
            time.sleep(seconds)
            output_text, _ = content_text(session.call_tool("get_debug_output", {}, 30))
            session.call_tool("stop_project", {}, 30)
        except McpError as exc:
            raise OpError("engine_error", f"godot run: {exc}") from exc
        finally:
            session.close()
        try:
            parsed = json.loads(output_text)
        except ValueError:
            parsed = {"output": [output_text], "errors": []}
        return {"output": _bounded_lines(parsed.get("output")), "errors": _bounded_lines(parsed.get("errors")), "seconds": seconds}
    finally:
        job.cleanup()


def _bounded_lines(lines, max_lines=400, max_chars=60000):
    out, used = [], 0
    for line in lines or []:
        text = str(line)
        if len(out) >= max_lines or used + len(text) > max_chars:
            out.append("... [more output cut]")
            break
        out.append(text)
        used += len(text)
    return out


def op_preview(cfg, req):
    """@description Render a still of the project on the CPU (Cycles) and export it to glTF and STL
    (the STL feeds the browser's orbit viewer). A Godot scene goes through glTF (exported by Godot
    itself) into Blender. Read-only. @returns {png, glb, stl, info} (glb/stl "" when not written)."""
    kind = _require_kind(req)
    width = _bounded_int(req, "width", 960, 64, 1920)
    height = _bounded_int(req, "height", 540, 64, 1080)
    samples = _bounded_int(req, "samples", 32, 1, 256)
    files = decode_files(req.get("files") or [])
    job = Job(cfg)
    try:
        materialize(files, job.project)
        glb = os.path.join(job.out, "preview.glb")
        png = os.path.join(job.out, "preview.png")
        stl = os.path.join(job.out, "preview.stl")
        render_args = ["--out", png, "--width", str(width), "--height", str(height), "--samples", str(samples),
                       "--threads", str(cfg.threads), "--export-stl", stl]
        if kind == "godot":
            scene = validate_path(req.get("scene") or _godot_main_scene(job.project))
            _godot_import(job)
            _godot_export_glb(job, scene, glb)
            info = _blender_script(job, None, "blender_render.py", ["--glb", glb, *render_args], 240, "Rendering the preview")
            info["scene"] = scene
        else:
            blend = _blend_path(job, req)
            info = _blender_script(job, blend, "blender_render.py", ["--export-glb", glb, *render_args], 240, "Rendering the preview")
        return {"png": _b64_file(png), "glb": _b64_file(glb), "stl": _b64_file(stl), "info": info}
    finally:
        job.cleanup()


def _b64_file(path):
    """A file's bytes as base64, or "" when the step did not write it."""
    if not os.path.isfile(path):
        return ""
    with open(path, "rb") as fh:
        return base64.b64encode(fh.read()).decode("ascii")


def _godot_main_scene(project):
    """The project's run/main_scene, or main.tscn."""
    path = os.path.join(project, "project.godot")
    if not os.path.isfile(path):
        raise OpError("refused", "this is not a Godot project (no project.godot)")
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            match = re.match(r'\s*run/main_scene\s*=\s*"res://([^"]+)"', line)
            if match:
                return match.group(1)
    return GODOT_MAIN_SCENE


def _godot_export_glb(job, scene, out):
    if not os.path.isfile(os.path.join(job.project, scene)):
        raise OpError("refused", f"scene {scene} is not in this project")
    res = job.run([job.cfg.godot, "--path", job.project, "--script", _script("godot_export_glb.gd"), "--",
                   "res://" + scene, out], 120)
    if res["code"] != 0 or not os.path.isfile(out):
        raise OpError("engine_error", f"Godot could not export {scene} to glTF: {_tail(res['stderr'] + res['stdout'])}")


def _blend_path(job, req):
    rel = validate_path(req.get("file") or BLENDER_MAIN_FILE)
    path = os.path.join(job.project, rel)
    if not rel.endswith(".blend") or not os.path.isfile(path):
        raise OpError("refused", f"{rel} is not a .blend file in this project")
    return path


def op_export(cfg, req):
    """@description One downloadable export of the project. Read-only.
    @returns {name, contentType, data}."""
    kind = _require_kind(req)
    fmt = req.get("format")
    if fmt not in EXPORT_FORMATS[kind]:
        raise OpError("refused", f"a {kind} project exports as {', '.join(EXPORT_FORMATS[kind])}")
    files = decode_files(req.get("files") or [])
    job = Job(cfg)
    try:
        materialize(files, job.project)
        out = os.path.join(job.out, f"export.{fmt}")
        if fmt == "zip":
            _zip_project(job.project, out)
        else:
            _blender_script(job, _blend_path(job, req), "blender_export.py", ["--format", fmt, "--out", out], 180, f"Exporting {fmt}")
        with open(out, "rb") as fh:
            data = fh.read()
        return {"name": f"export.{fmt}", "contentType": EXPORT_FORMATS[kind][fmt], "data": base64.b64encode(data).decode("ascii")}
    finally:
        job.cleanup()


def _zip_project(project, out):
    import zipfile
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel, data in sorted(collect(project).items()):
            if rel.startswith(".godot/"):
                continue  # derived: Godot re-imports on open
            zf.writestr(rel, data)


def op_import_model(cfg, req):
    """@description Export a Blender project's scene to glTF into a Godot project's models/
    folder, import it, and optionally instance it into a scene.
    @returns {files, changed, delta, resPath}."""
    name = req.get("name")
    if not isinstance(name, str) or not _NAME.match(name):
        raise OpError("refused", "name must be 1-64 letters, digits, '-' or '_'")
    source = decode_files(req.get("fromFiles") or [])
    target = decode_files(req.get("files") or [])
    instance = req.get("instance")
    job = Job(cfg)
    try:
        materialize(target, job.project)
        if not os.path.exists(os.path.join(job.project, "project.godot")):
            raise OpError("refused", "the target is not a Godot project (no project.godot)")
        src_dir = os.path.join(job.dir, "source")
        os.makedirs(src_dir, mode=0o700)
        materialize(source, src_dir)
        blend = os.path.join(src_dir, BLENDER_MAIN_FILE)
        if not os.path.isfile(blend):
            raise OpError("refused", f"the source is not a Blender project (no {BLENDER_MAIN_FILE})")
        rel = f"models/{name}.glb"
        os.makedirs(os.path.join(job.project, "models"), exist_ok=True)
        _blender_script(job, blend, "blender_export.py", ["--format", "glb", "--out", os.path.join(job.project, *rel.split("/"))],
                        180, "Exporting the model")
        _godot_import(job)
        if instance:
            _instance_model(job, instance, "res://" + rel)
        after = collect(job.project)
        delta = diff(target, after)
        return {"files": encode_files(after), "changed": _changed(delta), "delta": delta, "resPath": "res://" + rel}
    finally:
        job.cleanup()


def _instance_model(job, instance, res_path):
    if not isinstance(instance, dict):
        raise OpError("refused", "instance must be {scenePath, nodeName, parentNodePath?}")
    scene = validate_path(instance.get("scenePath") or _godot_main_scene(job.project))
    node = instance.get("nodeName") or "Model"
    parent = instance.get("parentNodePath") or "."
    if not isinstance(node, str) or not _NAME.match(node):
        raise OpError("refused", "nodeName must be 1-64 letters, digits, '-' or '_'")
    if not isinstance(parent, str) or (parent != "." and not _NODE_PATH.match(parent)):
        raise OpError("refused", "parentNodePath must be '.' or a node path like 'World/Props'")
    if not os.path.isfile(os.path.join(job.project, scene)):
        raise OpError("refused", f"scene {scene} is not in this project")
    res = job.run([job.cfg.godot, "--path", job.project, "--script", _script("godot_instance_model.gd"), "--",
                   "res://" + scene, parent, node, res_path], 120)
    if res["code"] != 0:
        raise OpError("engine_error", f"Godot could not add the model to {scene}: {_tail(res['stderr'] + res['stdout'])}")


OPS = {
    "new_project": op_new_project,
    "tools": op_tools,
    "mcp_call": op_mcp_call,
    "godot_run": op_godot_run,
    "preview": op_preview,
    "export": op_export,
    "import_model": op_import_model,
}
