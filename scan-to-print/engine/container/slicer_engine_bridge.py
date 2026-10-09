#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- serve the slicer worker's
#   |                                           | JSON-lines protocol over TCP inside the engine container
#   |                                           | (the cad-studio bridge shape, BUILDING-EXTENSIONS section 7):
#   |                                           | one connection owns one worker process, the first line is a
#   |                                           | hello naming the protocol and the build hash of the engine
#   |                                           | tree baked into the image, so a stale container is refused by
#   |                                           | the api before it slices anything; `--build-hash` prints the
#   |                                           | hash for the cross-implementation spec, `--selftest` slices a
#   |                                           | 20 mm cube for a P2S through the real OrcaSlicer and checks
#   |                                           | the archive a printer would receive.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | Each session's worker gets its own temporary directory (TMPDIR),
#   |                                           | removed when the session closes, whether the worker finished, was
#   |                                           | killed (the client left, a timeout, a recreate) or died: the
#   |                                           | worker's own cleanup never runs after SIGKILL, and /tmp is a
#   |                                           | tmpfs counted against the container's memory. The self-test also
#   |                                           | resolves every filament the engine lists for every printer model
#   |                                           | against the profile tree actually in the image.
"""slicer_engine_bridge -- TCP front for slicer_worker.py (stdlib only)."""
import argparse
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading

PROTOCOL = 1
#: Everything the Dockerfile bakes that changes the engine's answers (mirrored by
#: src-routes/printing/slicer-engine.ts -- a spec keeps them in step).
RUNTIME_FILES = ("slicer_worker.py", "container/slicer_engine_bridge.py", "container/Dockerfile", "orcaslicer-lock.txt")
ENGINE_DIR = os.environ.get("SCAN_TO_PRINT_ENGINE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_LINE_BYTES = 96 * 1024 * 1024
DEFAULT_PORT = 7414


def _log(msg: str) -> None:
    sys.stderr.write(f"[slicer-engine-bridge] {msg}\n")
    sys.stderr.flush()


def build_hash(engine_dir: str) -> str:
    """@description sha256 over the runtime files, each prefixed by its relative name.
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


def _worker_cmd() -> list:
    return [sys.executable, os.path.join(ENGINE_DIR, "slicer_worker.py")]


def _worker_env(tmpdir=None) -> dict:
    """Only what the slicer worker needs: no controller credentials ever reach it. A session's
    worker gets its own TMPDIR so everything it writes is removed with the session."""
    keep = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "PYTHONNOUSERSITE", "PYTHONDONTWRITEBYTECODE", "ORCA_SLICER_DIR", "SCAN_TO_PRINT_SLICE_TIMEOUT_S")
    env = {k: os.environ[k] for k in keep if k in os.environ}
    env["PYTHONUNBUFFERED"] = "1"
    if tmpdir:
        env["TMPDIR"] = tmpdir
    return env


def _error_line(req_id, code: str, message: str) -> dict:
    return {"id": req_id, "ok": False, "error": {"code": code, "message": message}}


class Session:
    """One client connection and the worker it owns."""

    def __init__(self, conn: socket.socket, hello: dict):
        self.conn = conn
        self.hello = hello
        self.send_lock = threading.Lock()
        self.proc = None
        self.closed = False
        self.tmpdir = None

    def send(self, obj: dict) -> None:
        self.send_raw((json.dumps(obj, allow_nan=False) + "\n").encode("utf-8"))

    def send_raw(self, data: bytes) -> None:
        try:
            with self.send_lock:
                self.conn.sendall(data)
        except OSError:
            self.close()

    def serve(self) -> None:
        """@description Hello, then forward request lines until the client leaves."""
        self.send(self.hello)
        reader = self.conn.makefile("rb")
        try:
            while not self.closed:
                line = reader.readline(MAX_LINE_BYTES + 1)
                if not line:
                    break
                if len(line) > MAX_LINE_BYTES:
                    self.send(_error_line(None, "refused", "request line too long"))
                    break
                if line.strip():
                    self.forward(line)
        except OSError:
            pass
        finally:
            self.close()

    def forward(self, raw: bytes) -> None:
        try:
            req = json.loads(raw)
        except ValueError:
            self.send(_error_line(None, "refused", "unparseable request line"))
            return
        if not isinstance(req, dict):
            self.send(_error_line(None, "refused", "request must be a JSON object"))
            return
        proc = self.ensure_worker()
        try:
            proc.stdin.write(raw if raw.endswith(b"\n") else raw + b"\n")
            proc.stdin.flush()
        except (OSError, ValueError) as exc:
            _log(f"worker stdin write failed: {exc}")
            self.send(_error_line(req.get("id"), "engine_error", f"engine write failed: {exc}"))

    def ensure_worker(self) -> subprocess.Popen:
        if self.proc is not None and self.proc.poll() is None:
            return self.proc
        self.tmpdir = self.tmpdir or tempfile.mkdtemp(prefix="session-")
        self.proc = subprocess.Popen(_worker_cmd(), cwd=ENGINE_DIR, env=_worker_env(self.tmpdir),
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, start_new_session=True)
        _log(f"worker started pid={self.proc.pid}")
        threading.Thread(target=self.pump, args=(self.proc,), daemon=True).start()
        return self.proc

    def pump(self, proc: subprocess.Popen) -> None:
        """Relay worker stdout; a worker that exits takes the connection with it."""
        for line in proc.stdout:
            self.send_raw(line if line.endswith(b"\n") else line + b"\n")
        if not self.closed:
            _log(f"worker pid={proc.pid} exited (code {proc.wait()}) -- closing session")
            self.close()

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.conn.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.conn.close()
        self.stop_worker()
        if self.tmpdir:
            shutil.rmtree(self.tmpdir, ignore_errors=True)

    def stop_worker(self) -> None:
        proc = self.proc
        if proc is None or proc.poll() is not None:
            return
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


def _run_session(conn: socket.socket, hello: dict, slots: threading.BoundedSemaphore) -> None:
    try:
        Session(conn, hello).serve()
    finally:
        slots.release()


def serve(host: str, port: int, max_connections: int) -> None:
    """@description Accept loop: one thread + one worker per connection, bounded by slots."""
    engine_hash = build_hash(ENGINE_DIR)
    hello = {"bridge": {"protocol": PROTOCOL, "buildHash": engine_hash, "python": sys.version.split()[0], "port": port}}
    slots = threading.BoundedSemaphore(max_connections)
    server = socket.create_server((host, port), reuse_port=False)
    _log(f"listening on {host}:{port} build={engine_hash[:12]} slots={max_connections}")
    while True:
        conn, _addr = server.accept()
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        if not slots.acquire(blocking=False):
            try:
                conn.sendall((json.dumps(_error_line(None, "engine_busy", "engine container has no free worker slot")) + "\n").encode("utf-8"))
            except OSError:
                pass
            conn.close()
            continue
        threading.Thread(target=_run_session, args=(conn, hello, slots), daemon=True).start()


def _cube_stl(size: float) -> bytes:
    """An ASCII STL of an axis-aligned cube, 12 facets, for the self-test."""
    v = [(x, y, z) for x in (0, size) for y in (0, size) for z in (0, size)]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    lines = ["solid cube"]
    for a, b, c, d in quads:
        for tri in ((a, b, c), (a, c, d)):
            lines.append("facet normal 0 0 0\nouter loop")
            lines.extend("vertex %g %g %g" % v[i] for i in tri)
            lines.append("endloop\nendfacet")
    lines.append("endsolid cube")
    return "\n".join(lines).encode("ascii")


def _all_filaments_resolve() -> dict:
    """Every filament the engine offers, for every printer model (0.4 nozzle), must resolve to a
    complete profile in the tree baked into this image."""
    sys.path.insert(0, ENGINE_DIR)
    import slicer_worker as worker  # noqa: E402 -- the worker module from this image's engine tree
    index, models = worker.load_index()
    library, _ = worker.load_index(worker.LIBRARY)
    state = {"index": index, "models": models, "library": library, "version": {}}
    total, failed, first = 0, 0, None
    for printer in worker.cmd_profiles({}, state)["printers"]:
        for filament in printer["filaments"]:
            total += 1
            try:
                worker.resolve(index, models, {"modelId": printer["modelId"], "nozzle": "0.4", "filament": filament}, library)
            except Exception as exc:  # noqa: BLE001 -- counted and reported, the self-test fails on any
                failed += 1
                first = first or f"{printer['printerModel']} / {filament}: {exc}"
    return {"checked": total, "failed": failed, "firstFailure": first}


def selftest() -> int:
    """@description Slice a 20 mm cube for a Bambu Lab P2S through the real worker and check the
    archive a printer would receive; exit 0 only when every check holds."""
    import base64
    import io
    import zipfile
    proc = subprocess.Popen(_worker_cmd(), cwd=ENGINE_DIR, env=_worker_env(), stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    req = {"id": 1, "cmd": "slice", "args": {"stl": base64.b64encode(_cube_stl(20)).decode(), "name": "selftest-cube",
                                              "modelId": "N7", "nozzle": "0.4", "filament": "Bambu PLA Basic", "plate": "Textured PEI Plate"}}
    proc.stdin.write((json.dumps({"id": 0, "cmd": "hello"}) + "\n" + json.dumps(req) + "\n").encode("utf-8"))
    proc.stdin.flush()
    proc.stdin.close()
    lines = [json.loads(l) for l in proc.stdout if l.strip()]
    proc.wait(timeout=600)
    ok = len(lines) == 2 and lines[0].get("ok") and lines[1].get("ok")
    if not ok:
        print(json.dumps({"selftest": False, "lines": lines[:2]}))
        return 1
    res = lines[1]["result"]
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(res["archive"]))) as z:
        names = set(z.namelist())
        info = z.read("Metadata/slice_info.config").decode()
        gcode = z.read("Metadata/plate_1.gcode").decode("utf-8", "replace")
    resolvable = _all_filaments_resolve()
    checks = [
        resolvable["failed"] == 0,
        "Metadata/plate_1.gcode" in names and "Metadata/plate_1.png" in names and "Metadata/plate_1_small.png" in names,
        'key="printer_model_id" value="N7"' in info,
        "; curr_bed_type = Textured PEI Plate" in gcode,
        "; printer_model = Bambu Lab P2S" in gcode,
        res["estimate"]["printSeconds"] > 60 and res["estimate"]["firstLayerSeconds"] > 0,
        (res["estimate"]["filamentGrams"] or 0) > 1,
    ]
    print(json.dumps({"selftest": all(checks), "orcaSlicer": lines[0]["result"]["orcaSlicer"], "profiles": resolvable, "estimate": res["estimate"],
                      "bytes": res["bytes"], "ms": res["ms"], "checks": checks}))
    return 0 if all(checks) else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan to Print slicer engine bridge")
    parser.add_argument("--host", default=os.environ.get("SLICER_ENGINE_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SLICER_ENGINE_PORT", DEFAULT_PORT)))
    parser.add_argument("--max-connections", type=int, default=int(os.environ.get("SLICER_ENGINE_SLOTS", "2")))
    parser.add_argument("--build-hash", action="store_true", help="print the engine build hash and exit")
    parser.add_argument("--selftest", action="store_true", help="slice a known part through the real slicer")
    args = parser.parse_args()
    if args.build_hash:
        print(build_hash(ENGINE_DIR))
        return 0
    if args.selftest:
        return selftest()
    serve(args.host, args.port, args.max_connections)
    return 0


if __name__ == "__main__":
    sys.exit(main())
