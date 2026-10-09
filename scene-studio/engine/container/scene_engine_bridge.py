#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the Scene Studio engine's
#   |                                           | TCP front (the cad-studio bridge shape): the first
#   |                                           | line is a hello naming the protocol and the build
#   |                                           | hash of the engine tree baked into the image, then
#   |                                           | JSON-lines requests, each answered by id. Jobs run
#   |                                           | one at a time; inside the container every job is
#   |                                           | followed by a scrub (leftover processes killed,
#   |                                           | /tmp and /dev/shm emptied) so nothing one person's
#   |                                           | code leaves behind meets the next request. The
#   |                                           | bridge proves the sandbox at start and refuses to
#   |                                           | serve when a sandboxed job could open an IP socket.
"""scene_engine_bridge -- TCP front for scene_ops.py (stdlib only)."""
import argparse
import base64
import hashlib
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback

ENGINE_DIR = os.environ.get("SCENE_STUDIO_ENGINE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE_DIR)

import scene_ops  # noqa: E402  (the engine dir is on the path only from here)
from scene_ops import OpError  # noqa: E402

PROTOCOL = 1
#: Everything the image bakes that changes the engine's answers (mirrored by
#: src-routes/engine-build-hash.ts -- a spec keeps the two in step).
RUNTIME_FILES = (
    "container/Dockerfile",
    "container/scene_engine_bridge.py",
    "mcp_client.py",
    "sandbox_exec.py",
    "scene_ops.py",
    "requirements-lock.txt",
    "scripts/blender_export.py",
    "scripts/blender_new.py",
    "scripts/blender_render.py",
    "scripts/godot_export_glb.gd",
    "scripts/godot_instance_model.gd",
)
MAX_LINE_BYTES = 200 * 1024 * 1024
DEFAULT_PORT = 7414
VERSIONS_FILE = os.environ.get("SCENE_STUDIO_VERSIONS") or "/opt/scene-studio/versions.json"
JOB_LOCK = threading.Lock()
_STATE = {"tools": None, "tools_error": None, "sandbox": None}

_PROBE = (
    "import json, socket\n"
    "r = {}\n"
    "for name, fam in (('inet', socket.AF_INET), ('inet6', socket.AF_INET6)):\n"
    "    try:\n"
    "        socket.socket(fam, socket.SOCK_STREAM).close(); r[name] = 'open'\n"
    "    except OSError as e:\n"
    "        r[name] = 'refused'\n"
    "a, b = socket.socketpair(); a.send(b'k'); r['unix'] = 'ok' if b.recv(1) == b'k' else 'broken'\n"
    "print(json.dumps(r))\n"
)


def _log(msg):
    sys.stderr.write(f"[scene-engine-bridge] {msg}\n")
    sys.stderr.flush()


def build_hash(engine_dir):
    """@description sha256 over the runtime files, each prefixed by its relative name; CRLF folded to LF.
    @param engine_dir The engine tree root. @returns Hex digest."""
    digest = hashlib.sha256()
    for rel in RUNTIME_FILES:
        path = os.path.join(engine_dir, rel)
        digest.update(rel.encode("utf-8") + b"\0")
        if os.path.exists(path):
            with open(path, "rb") as fh:
                digest.update(fh.read().replace(b"\r\n", b"\n"))
        digest.update(b"\0")
    return digest.hexdigest()


def read_versions():
    try:
        with open(VERSIONS_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def probe_sandbox(cfg):
    """@description Run the probe through the real launcher: IP sockets must be refused, AF_UNIX must work.
    @returns {ok, inet, inet6, unix} or {ok: False, reason}."""
    job = scene_ops.Job(cfg)
    try:
        res = job.run([cfg.python, "-c", _PROBE], 30)
        found = json.loads(res["stdout"].strip().splitlines()[-1]) if res["code"] == 0 else {}
    except (OpError, ValueError, IndexError) as exc:
        return {"ok": False, "reason": f"probe did not run: {exc}"}
    finally:
        job.cleanup()
    ok = found.get("inet") == "refused" and found.get("inet6") == "refused" and found.get("unix") == "ok"
    return {"ok": ok, **found} if found else {"ok": False, "reason": "probe printed nothing"}


def scrub_enabled():
    """Only inside the engine container (marked by the image, PID 1 = the compose init) -- never on a host."""
    if os.environ.get("SCENE_STUDIO_CONTAINER") != "1" or os.getpid() == 1:
        return False
    try:
        with open("/proc/1/comm", "r", encoding="utf-8") as fh:
            return fh.read().strip() in ("docker-init", "tini")
    except OSError:
        return False


def _proc_stat(pid):
    """(state, ppid) of a live process, or None."""
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8", errors="replace") as fh:
            fields = fh.read().rsplit(")", 1)[1].split()
        return fields[0], int(fields[1])
    except (OSError, IndexError, ValueError):
        return None


def scrub_victims(me, table):
    """@description Which processes a scrub kills, from {pid: (state, ppid)}.
    Spared: PID 1, this bridge, and everything entered from OUTSIDE the container (`docker exec`
    shows parent 0 inside the PID namespace, which no job can arrange) with its descendants.
    Everything else -- every job process, and any orphan a job left re-parented to PID 1 -- dies.
    Zombies are already dead. @returns Sorted pids."""
    children = {}
    for pid, (_state, ppid) in table.items():
        children.setdefault(ppid, []).append(pid)
    spared = {1, me}
    stack = [pid for pid, (_state, ppid) in table.items() if ppid == 0 and pid != 1]
    while stack:
        pid = stack.pop()
        if pid in spared and pid not in (1, me):
            continue
        spared.add(pid)
        stack.extend(child for child in children.get(pid, []) if child != me)
    return sorted(pid for pid, (state, _ppid) in table.items() if pid not in spared and state not in ("Z", "X"))


def _process_table():
    table = {}
    for name in os.listdir("/proc"):
        if name.isdigit():
            stat = _proc_stat(int(name))
            if stat is not None:
                table[int(name)] = stat
    return table


def scrub():
    """@description Kill every job process (see scrub_victims), then empty /tmp and /dev/shm.
    A process that will not die makes the bridge exit, so the container restarts clean."""
    me = os.getpid()
    for _round in range(40):
        victims = scrub_victims(me, _process_table())
        if not victims:
            break
        for pid in victims:
            try:
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        time.sleep(0.05)
    else:
        _log("leftover job processes would not die -- exiting so the container restarts clean")
        os._exit(70)
    for root in ("/tmp", "/dev/shm"):
        try:
            entries = os.listdir(root)
        except OSError:
            continue
        for name in entries:
            path = os.path.join(root, name)
            try:
                if os.path.isdir(path) and not os.path.islink(path):
                    import shutil
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    os.unlink(path)
            except OSError:
                pass


def after_job():
    if scrub_enabled():
        scrub()


def capabilities(cfg):
    """@description Versions, the allowlisted MCP tools (listed once from the servers), limits, sandbox."""
    with JOB_LOCK:
        if _STATE["tools"] is None:
            try:
                _STATE["tools"] = scene_ops.op_tools(cfg, {})
                _STATE["tools_error"] = None
            except OpError as exc:
                _STATE["tools_error"] = str(exc)
            finally:
                after_job()
    return {
        "versions": read_versions(),
        "tools": _STATE["tools"],
        "toolsError": _STATE["tools_error"],
        "limits": scene_ops.LIMITS,
        "exports": scene_ops.EXPORT_FORMATS,
        "templates": scene_ops.TEMPLATES,
        "sandbox": _STATE["sandbox"],
    }


def handle(req, cfg):
    """@description Run one request. @returns The op's result. @throws OpError."""
    op = req.get("op")
    if op == "ping":
        return {"pong": True}
    if op == "capabilities":
        return capabilities(cfg)
    fn = scene_ops.OPS.get(op)
    if fn is None:
        raise OpError("refused", f"unknown op {op!r}")
    with JOB_LOCK:
        try:
            return fn(cfg, req)
        finally:
            after_job()


class Session:
    """One client connection; requests are answered in order."""

    def __init__(self, conn, hello, cfg):
        self.conn = conn
        self.hello = hello
        self.cfg = cfg

    def send(self, obj):
        self.conn.sendall((json.dumps(obj, allow_nan=False) + "\n").encode("utf-8"))

    def serve(self):
        self.send(self.hello)
        reader = self.conn.makefile("rb")
        while True:
            line = reader.readline(MAX_LINE_BYTES + 1)
            if not line:
                return
            if len(line) > MAX_LINE_BYTES:
                self.send({"id": None, "ok": False, "error": {"code": "refused", "message": "request line too long"}})
                return
            if line.strip():
                self.send(self.answer(line))

    def answer(self, raw):
        try:
            req = json.loads(raw)
        except ValueError:
            return {"id": None, "ok": False, "error": {"code": "refused", "message": "unparseable request line"}}
        if not isinstance(req, dict):
            return {"id": None, "ok": False, "error": {"code": "refused", "message": "request must be a JSON object"}}
        rid = req.get("id")
        started = time.monotonic()
        try:
            result = handle(req, self.cfg)
            _log(f"op={req.get('op')} ok ms={int((time.monotonic() - started) * 1000)}")
            return {"id": rid, "ok": True, "result": result}
        except OpError as exc:
            _log(f"op={req.get('op')} {exc.code}: {str(exc)[:300]}")
            return {"id": rid, "ok": False, "error": {"code": exc.code, "message": str(exc)}}
        except Exception as exc:  # noqa: BLE001 -- the connection must outlive one bad request
            _log(f"op={req.get('op')} crashed: {traceback.format_exc()}")
            return {"id": rid, "ok": False, "error": {"code": "engine_error", "message": f"engine error: {exc}"}}


def _run_session(conn, hello, cfg, slots):
    try:
        Session(conn, hello, cfg).serve()
    except OSError:
        pass
    finally:
        try:
            conn.close()
        except OSError:
            pass
        slots.release()


def serve(host, port, max_connections):
    """@description Prove the sandbox, then accept connections (each on its own thread)."""
    cfg = scene_ops.Config()
    sandbox = probe_sandbox(cfg)
    _STATE["sandbox"] = sandbox
    if not sandbox.get("ok"):
        _log(f"REFUSING TO SERVE: the job sandbox is not in force: {sandbox}")
        return 1
    if scrub_enabled():
        scrub()
    engine_hash = build_hash(ENGINE_DIR)
    hello = {"bridge": {"protocol": PROTOCOL, "buildHash": engine_hash, "python": sys.version.split()[0], "port": port}}
    slots = threading.BoundedSemaphore(max_connections)
    server = socket.create_server((host, port), reuse_port=False)
    _log(f"listening on {host}:{port} build={engine_hash[:12]} sandbox={sandbox} scrub={scrub_enabled()}")
    while True:
        conn, _addr = server.accept()
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        if not slots.acquire(blocking=False):
            try:
                conn.sendall((json.dumps({"id": None, "ok": False, "error": {"code": "engine_busy", "message": "engine has no free connection slot"}}) + "\n").encode("utf-8"))
            except OSError:
                pass
            conn.close()
            continue
        threading.Thread(target=_run_session, args=(conn, hello, cfg, slots), daemon=True).start()


def _glb_meshes(data):
    """Mesh count in a binary glTF (its JSON chunk), or -1 when it is not one."""
    if len(data) < 20 or data[:4] != b"glTF":
        return -1
    length = int.from_bytes(data[12:16], "little")
    try:
        return len(json.loads(data[20:20 + length]).get("meshes") or [])
    except ValueError:
        return -1


class _Client:
    """A JSON-lines client of a running bridge (what the api's engine client speaks)."""

    def __init__(self, host, port, timeout):
        self.sock = socket.create_connection((host, port), timeout=10)
        self.sock.settimeout(timeout)
        self.reader = self.sock.makefile("rb")
        self.hello = json.loads(self.reader.readline(MAX_LINE_BYTES + 1))
        self.next_id = 1

    def call(self, op, **fields):
        rid = self.next_id
        self.next_id += 1
        self.sock.sendall((json.dumps({"id": rid, "op": op, **fields}) + "\n").encode("utf-8"))
        reply = json.loads(self.reader.readline(MAX_LINE_BYTES + 1))
        if reply.get("id") != rid:
            raise RuntimeError(f"answer for {reply.get('id')} while waiting for {rid}")
        if not reply.get("ok"):
            raise RuntimeError(f"{op}: {reply.get('error')}")
        return reply["result"]


class _Checks:
    """The self-test's running record: every check printed as it lands."""

    def __init__(self):
        self.items = []

    def check(self, name, ok, detail=""):
        self.items.append({"check": name, "ok": bool(ok), "detail": detail})
        print(json.dumps(self.items[-1], default=str), flush=True)

    def step(self, name, fn):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 -- a failed step is a failed check, not a crash
            self.check(name, False, f"{type(exc).__name__}: {exc}")
            return None


def _file_text(files, name):
    return next((base64.b64decode(f["data"]).decode("utf-8", "replace") for f in files if f["path"] == name), "")


def _selftest_capabilities(client, checks):
    bridge = client.hello.get("bridge") or {}
    checks.check("hello names this engine tree", bridge.get("buildHash") == build_hash(ENGINE_DIR) and bridge.get("protocol") == PROTOCOL)
    caps = checks.step("capabilities", lambda: client.call("capabilities"))
    if not caps:
        return
    tools = caps.get("tools") or {}
    checks.check("sandbox refuses IP sockets, allows AF_UNIX", (caps.get("sandbox") or {}).get("ok"), caps.get("sandbox"))
    checks.check("godot-mcp tools listed", len(tools.get("godot") or []) == len(scene_ops.GODOT_TOOLS), [t["name"] for t in tools.get("godot") or []])
    checks.check("Blender Lab MCP tools listed", len(tools.get("blender") or []) == len(scene_ops.BLENDER_TOOLS), [t["name"] for t in tools.get("blender") or []])
    checks.check("versions reported", bool((caps.get("versions") or {}).get("godot")), caps.get("versions"))


def _selftest_godot(client, checks):
    """godot-mcp edits a new Godot project; the result is previewed and run. @returns The files, or None."""
    godot = checks.step("godot new_project", lambda: client.call("new_project", kind="godot", template="3d", title="Selftest"))
    if not godot:
        return None
    files = godot["files"]
    added = checks.step("godot add_node", lambda: client.call("mcp_call", server="godot", tool="add_node", files=files, arguments={
        "scenePath": "main.tscn", "parentNodePath": "root", "nodeType": "OmniLight3D", "nodeName": "Probe"}))
    if added:
        checks.check("godot-mcp add_node changed the scene", added["changed"] and "main.tscn" in added["delta"]["modified"], added["text"][-200:])
        files = added.get("files") or files
        checks.check("the scene holds the new node", 'name="Probe"' in _file_text(files, "main.tscn"))
    preview = checks.step("godot preview", lambda: client.call("preview", kind="godot", files=files, width=320, height=180, samples=8))
    if preview:
        png = base64.b64decode(preview["png"])
        checks.check("godot preview rendered", png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 2000, preview["info"])
        checks.check("godot scene exported to glTF with meshes", _glb_meshes(base64.b64decode(preview["glb"])) >= 1)
        checks.check("godot scene exported to STL for the orbit view", len(base64.b64decode(preview["stl"])) > 84)
    ran = checks.step("godot run", lambda: client.call("godot_run", files=files, seconds=2))
    if ran:
        checks.check("godot project ran headless", any("Godot Engine" in line for line in ran["output"]), ran["output"][:2])
    return files


def _selftest_blender(client, checks, port):
    """The Blender Lab MCP edits a new Blender project; user code is shown to have no network. @returns The files, or None."""
    blender = checks.step("blender new_project", lambda: client.call("new_project", kind="blender", template="default"))
    if not blender:
        return None
    files = blender["files"]
    probe = ("import socket\ntry:\n    socket.create_connection(('127.0.0.1', %d), 3)\n    result = {'net': 'OPEN'}\n"
             "except OSError as exc:\n    result = {'net': type(exc).__name__, 'errno': exc.errno}\n" % port)
    net = checks.step("user code network probe", lambda: _blender_code(client, files, probe, save=False))
    if net:
        checks.check("code a person writes cannot open a network connection", '"PermissionError"' in net["text"] and not net["changed"], net["text"][:200])
    code = ("import bpy\nbpy.ops.mesh.primitive_uv_sphere_add(radius=0.8, location=(2.5, 0, 0.8))\n"
            "bpy.context.active_object.name = 'SelftestSphere'\nresult = {'objects': len(bpy.data.objects)}\n")
    edited = checks.step("blender execute code", lambda: _blender_code(client, files, code, save=True))
    if edited:
        checks.check("Blender Lab MCP code ran and saved", edited["changed"] and not edited["isError"], edited["text"][-200:])
        files = edited.get("files") or files
    summary = checks.step("blender summary", lambda: client.call("mcp_call", server="blender", tool="get_blendfile_summary_datablocks_for_cli", files=files, arguments={}))
    if summary:
        checks.check("Blender Lab MCP summarised the saved file", '"objects": 4' in summary["text"], summary["text"][:160])
    names = checks.step("blender read back", lambda: _blender_code(client, files, "import bpy\nresult = {'names': sorted(o.name for o in bpy.data.objects)}\n", save=False))
    if names:
        checks.check("the saved file holds the sphere; a read-only call changes nothing", "SelftestSphere" in names["text"] and not names["changed"], names["text"][:160])
    return files


def _blender_code(client, files, code, save):
    return client.call("mcp_call", server="blender", tool="execute_blender_code_for_cli", files=files, save=save, arguments={"code": code})


def _selftest_outputs(client, checks, godot_files, blender_files):
    """Preview and export the Blender model, then import it into the Godot project."""
    preview = checks.step("blender preview", lambda: client.call("preview", kind="blender", files=blender_files, width=320, height=180, samples=8))
    if preview:
        checks.check("blender preview rendered", base64.b64decode(preview["png"])[:4] == b"\x89PNG", preview["info"])
        checks.check("blender scene exported to STL for the orbit view", len(base64.b64decode(preview["stl"])) > 84)
    exported = checks.step("blender export", lambda: client.call("export", kind="blender", format="glb", files=blender_files))
    if exported:
        checks.check("blender exported glTF", _glb_meshes(base64.b64decode(exported["data"])) >= 2)
    if godot_files is None:
        return
    imported = checks.step("import model", lambda: client.call("import_model", name="selftest_model", fromFiles=blender_files, files=godot_files,
                                                               instance={"scenePath": "main.tscn", "nodeName": "Imported"}))
    if imported:
        paths = [f["path"] for f in imported["files"]]
        checks.check("model imported into the Godot project", "models/selftest_model.glb" in paths and "Imported" in _file_text(imported["files"], "main.tscn"))


def selftest(host, port):
    """@description Prove a RUNNING bridge end to end over its own TCP protocol: the hello names this
    engine tree; the sandbox probe passed; both MCP servers list their tools; code a person writes
    cannot open a network connection; a Godot project edited by godot-mcp is previewed and run; a
    Blender project edited by the Blender Lab MCP is read back, previewed and exported; and the model
    is imported into the Godot project. @returns 0 when every check holds."""
    checks = _Checks()
    client = checks.step("connect", lambda: _Client(host, port, 600))
    if client is not None:
        _selftest_capabilities(client, checks)
        godot_files = _selftest_godot(client, checks)
        blender_files = _selftest_blender(client, checks, port)
        if blender_files is not None:
            _selftest_outputs(client, checks, godot_files, blender_files)
    failed = [c["check"] for c in checks.items if not c["ok"]]
    print(json.dumps({"selftest": "pass" if not failed else "fail", "checks": len(checks.items), "failed": failed}), flush=True)
    return 0 if not failed else 1


def main(argv):
    parser = argparse.ArgumentParser(description="Scene Studio engine bridge")
    parser.add_argument("--host", default=os.environ.get("SCENE_STUDIO_BRIDGE_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SCENE_STUDIO_BRIDGE_PORT", DEFAULT_PORT)))
    parser.add_argument("--max-connections", type=int, default=8)
    parser.add_argument("--build-hash", action="store_true", help="print the engine build hash and exit")
    parser.add_argument("--selftest", action="store_true", help="prove the RUNNING bridge end to end over TCP and exit")
    args = parser.parse_args(argv)
    if args.build_hash:
        print(build_hash(ENGINE_DIR))
        return 0
    if args.selftest:
        return selftest("127.0.0.1" if args.host == "0.0.0.0" else args.host, args.port)
    return serve(args.host, args.port, args.max_connections)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
