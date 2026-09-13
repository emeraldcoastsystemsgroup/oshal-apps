#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- serve the CAD Studio
#   |                                           | worker's JSON-lines protocol over TCP inside the
#   |                                           | engine container (the aero-lab bridge shape): one
#   |                                           | connection owns one worker process, the first line
#   |                                           | is a hello naming the protocol and the build hash of
#   |                                           | the engine tree baked into the image, so a stale
#   |                                           | container is refused by the api before it computes
#   |                                           | anything; `--build-hash` prints the hash for the
#   |                                           | cross-implementation spec, `--selftest` rebuilds a
#   |                                           | bracket with a hole and a fillet through the real
#   |                                           | kernel and checks the numbers.
"""cad_engine_bridge -- TCP front for cad_worker.py (stdlib only)."""
import argparse
import hashlib
import json
import os
import signal
import socket
import subprocess
import sys
import threading

PROTOCOL = 1
#: Everything the Dockerfile bakes that changes the engine's answers (mirrored by
#: src-routes/engine-build-hash.ts -- a spec keeps them in step).
RUNTIME_FILES = ("cad_worker.py", "container/cad_engine_bridge.py", "requirements.txt", "requirements-lock.txt")
ENGINE_DIR = os.environ.get("CAD_STUDIO_ENGINE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_LINE_BYTES = 96 * 1024 * 1024
DEFAULT_PORT = 7412


def _log(msg: str) -> None:
    sys.stderr.write(f"[cad-engine-bridge] {msg}\n")
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
    return [sys.executable, os.path.join(ENGINE_DIR, "cad_worker.py")]


def _worker_env() -> dict:
    """Only what a numerical worker needs: no controller credentials ever reach it."""
    keep = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "PYTHONNOUSERSITE", "PYTHONDONTWRITEBYTECODE")
    env = {k: os.environ[k] for k in keep if k in os.environ}
    env["PYTHONUNBUFFERED"] = "1"
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
        self.proc = subprocess.Popen(_worker_cmd(), cwd=ENGINE_DIR, env=_worker_env(),
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


def selftest() -> int:
    """@description Rebuild a bracket with a through-hole and a fillet through the real
    worker and check the numbers; exit 0 only when every check holds."""
    proc = subprocess.Popen(_worker_cmd(), cwd=ENGINE_DIR, env=_worker_env(), stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    features = [
        {"id": "hole1", "type": "hole", "params": {"axis": "z", "x": 10, "y": 0, "diameter": 6}},
        {"id": "fillet1", "type": "fillet", "params": {"edges": "parallel-y", "radius": 2}},
        {"id": "bad", "type": "fillet", "params": {"edges": "all", "radius": 500}},
    ]
    base = {"kind": "contours", "size": {"x": 60, "y": 40, "z": 30}, "views": {
        "front": [[-30, 0], [30, 0], [30, 10], [-20, 10], [-20, 30], [-30, 30]],
        "top": [[-30, -20], [30, -20], [30, 20], [-30, 20]],
        "right": [[-20, 0], [20, 0], [20, 30], [-20, 30]]}}
    req = {"id": 1, "cmd": "rebuild", "args": {"base": base, "features": features, "exports": ["step", "stl", "svg"], "views": ["front", "iso"]}}
    proc.stdin.write((json.dumps({"id": 0, "cmd": "hello"}) + "\n" + json.dumps(req) + "\n").encode("utf-8"))
    proc.stdin.flush()
    proc.stdin.close()
    lines = [json.loads(l) for l in proc.stdout if l.strip()]
    proc.wait(timeout=120)
    ok = len(lines) == 2 and lines[0].get("ok") and lines[1].get("ok")
    if ok:
        res = lines[1]["result"]
        vol = res["report"]["volumeMm3"]
        size = res["report"]["extentsMm"]["size"]
        statuses = [f["ok"] for f in res["features"]]
        checks = [
            abs(size[0] - 60) < 0.01 and abs(size[1] - 40) < 0.01 and abs(size[2] - 30) < 0.01,
            30000 < vol < 32000,  # 32000 mm3 bracket minus a 6 mm hole through 10 mm minus the fillet
            statuses == [True, True, False],
            res["report"]["valid"] is True,
            res["exports"]["step"].startswith("ISO-10303-21"),
            len(res["exports"]["stl"]) > 1000,
            "<svg" in res["exports"]["svg"]["front"],
        ]
        ok = all(checks)
        print(json.dumps({"selftest": ok, "kernel": lines[0]["result"]["cadquery"], "volumeMm3": vol, "size": size,
                          "features": res["features"], "ms": res["ms"], "checks": checks}))
    else:
        print(json.dumps({"selftest": False, "lines": lines[:2]}))
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="CAD Studio engine bridge")
    parser.add_argument("--host", default=os.environ.get("CAD_ENGINE_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("CAD_ENGINE_PORT", DEFAULT_PORT)))
    parser.add_argument("--max-connections", type=int, default=int(os.environ.get("CAD_ENGINE_SLOTS", "4")))
    parser.add_argument("--build-hash", action="store_true", help="print the engine build hash and exit")
    parser.add_argument("--selftest", action="store_true", help="rebuild a known part through the real kernel")
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
