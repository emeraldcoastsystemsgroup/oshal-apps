"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-----------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the TCP front of
  |                                           | the aero-lab engine container. The api
  |                                           | container is Alpine (musl) and casadi, which
  |                                           | AeroSandbox imports, publishes glibc-only
  |                                           | wheels, so the engine runs in its own
  |                                           | python:3.11-slim container built locally by
  |                                           | ../install-engine.sh. One connection owns one
  |                                           | engine worker; a hello names the baked build
  |                                           | hash; exports ride back inline.

aero_engine_bridge -- serve the frozen aero-lab JSON-lines protocol over TCP.

The Node adapter cannot spawn a process inside another container, so this
bridge does it on the adapter's behalf, keeping the adapter's semantics:

  * one TCP connection == one engine worker process (aero_lab_worker.py),
    spawned lazily on the first forwarded command and killed when the
    connection closes -- closing the socket IS the adapter's kill, so
    timeout -> kill -> restart and the idle shutdown carry over unchanged;
  * the first line on every connection is a hello naming the protocol version
    and the build hash of the engine tree baked into this image, so the
    adapter can refuse to report numbers from a container built from a
    different engine than the package now ships;
  * `export` requests get a bridge-owned workDir (the client's path is never
    used), and the finished files ride back inline as base64 so the api can
    serve downloads without sharing a filesystem with this container.

Stdlib only: this file runs under the image venv as the server, and under any
python3 for `--build-hash` (the cross-implementation spec).
"""

import argparse
import base64
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time

PROTOCOL = 1

#: Everything the Dockerfile bakes into the image (mirrored by ../.dockerignore
#: and src-routes/engine-build-hash.ts -- a spec keeps the three in step).
RUNTIME_FILES = ("aero_lab_worker.py", "service.py", "export_build_files.py",
                 "HYBRID_common.py", "HYBRID_piecewise.py", "requirements.txt",
                 "requirements-lock.txt")
RUNTIME_TREES = ("aerosim", "container")
SKIP_DIRS = frozenset({"__pycache__"})
SKIP_SUFFIXES = (".pyc",)

ENGINE_DIR = os.environ.get(
    "AERO_LAB_ENGINE_DIR",
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK_ROOT = os.environ.get("AERO_ENGINE_WORK_DIR", "/tmp/aero-lab-work")
MAX_LINE_BYTES = 4 * 1024 * 1024
EXPORT_MAX_BYTES = 64 * 1024 * 1024
EXPORT_ID_RE = re.compile(r"^exp-[0-9a-f]{12}$")
#: Non-secret OS/runtime essentials only -- the same set the Node adapter forwards
#: to a local worker (WORKER_ENV_ALLOWLIST in src-routes/engine-adapter.ts).
WORKER_ENV_PASSTHROUGH = ("PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT",
                          "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TZ")

#: The routes' DEFAULT_DESIGN (src-routes/aero-lab-routes.ts, the R7 sweep
#: winner rounded for readability). The container self-test flies it; a spec
#: asserts the two stay identical.
SELFTEST_DESIGN = {
    "area_m2": 0.9, "aspect_ratio": 12.0, "taper_ratio": 0.57,
    "twist_root_deg": 2.0, "twist_tip_deg": -0.93, "extra_CD0": 0.0059,
    "battery_mass_kg": 2.04, "pack_Wh_per_kg": 441.8,
    "cell_eff": 0.29, "pv_density": 0.296, "pv_packing": 0.9,
    "prop_max_W": 2102.7, "prop_diameter_m": 0.498,
    "payload_W": 4.57, "payload_mass_kg": 0.244,
    "altitude_m": 163.7, "latitude_deg": -10.4, "day_of_year": 90,
    "fus_over_floor": 1.01,
    "buoyancy_fraction": 0.0,
}


def _log(msg: str) -> None:
    """@description Log one line to stderr (the container log).
    @param msg The message.
    @returns None."""
    print(f"[aero-engine-bridge] {msg}", file=sys.stderr, flush=True)


def build_files(engine_dir: str) -> list:
    """@description List every file the image bakes in, as sorted relative
        POSIX paths. Caches are skipped so a local run never changes the hash.
    @param engine_dir The package's engine/ directory.
    @returns Sorted relative paths."""
    out = [name for name in RUNTIME_FILES
           if os.path.isfile(os.path.join(engine_dir, name))]
    for tree in RUNTIME_TREES:
        for dirpath, dirnames, filenames in os.walk(os.path.join(engine_dir, tree)):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                if fn.endswith(SKIP_SUFFIXES):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn), engine_dir)
                out.append(rel.replace(os.sep, "/"))
    return sorted(out)


def build_hash(engine_dir: str) -> str:
    """@description Content hash of the baked engine tree. CRLF is folded to LF
        so a Windows checkout and the deployed Linux copy of the same commit
        agree; the adapter computes the identical hash over the package.
    @param engine_dir The package's engine/ directory.
    @returns 64-hex sha256."""
    h = hashlib.sha256()
    for rel in build_files(engine_dir):
        with open(os.path.join(engine_dir, rel), "rb") as fh:
            data = fh.read().replace(b"\r\n", b"\n")
        digest = hashlib.sha256(data).hexdigest()
        h.update(rel.encode("utf-8") + b"\0" + digest.encode("ascii") + b"\n")
    return h.hexdigest()


def _worker_cmd() -> list:
    """@description The engine worker command. AERO_ENGINE_WORKER_CMD (a JSON
        array) lets the transport spec substitute its protocol double.
    @returns argv list."""
    raw = os.environ.get("AERO_ENGINE_WORKER_CMD", "").strip()
    if raw:
        cmd = json.loads(raw)
        if isinstance(cmd, list) and cmd and all(isinstance(c, str) for c in cmd):
            return cmd
        raise SystemExit("AERO_ENGINE_WORKER_CMD must be a JSON array of strings")
    return [sys.executable, "-u", os.path.join(ENGINE_DIR, "aero_lab_worker.py")]


def _worker_env() -> dict:
    """@description Minimal worker environment: runtime essentials plus writable
        cache dirs under /tmp (the container root filesystem is read-only).
    @returns Environment dict."""
    env = {k: os.environ[k] for k in WORKER_ENV_PASSTHROUGH if k in os.environ}
    env.update({
        "AERO_LAB_ENGINE_DIR": ENGINE_DIR,
        "HOME": "/tmp",
        "MPLCONFIGDIR": "/tmp/matplotlib",
        "XDG_CACHE_HOME": "/tmp/.cache",
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUNBUFFERED": "1",
    })
    return env


def _error_line(req_id, code: str, message: str) -> dict:
    """@description Build one frozen-protocol error response.
    @param req_id The request id (None when unknown).
    @param code Frozen error code.
    @param message Honest explanation.
    @returns Response dict."""
    return {"id": req_id, "ok": False, "error": {"code": code, "message": message}}


def _pack_export(msg: dict, work_dir: str) -> dict:
    """@description Inline an export's files (base64) into its response and
        delete them from the bridge workDir. Names must be bare file names.
    @param msg The worker's ok response to an export request.
    @param work_dir The session workDir the export was written under.
    @returns The response to send (an error response on any violation)."""
    result = msg.get("result") or {}
    export_id = str(result.get("exportId") or "")
    names = result.get("files")
    if not EXPORT_ID_RE.match(export_id) or not isinstance(names, list):
        return msg
    src = os.path.join(work_dir, "exports", export_id)
    packed, total = [], 0
    try:
        for name in (str(n) for n in names):
            if os.path.basename(name) != name or name in ("", ".", ".."):
                return _error_line(msg.get("id"), "engine_error",
                                   f"export named a file outside its directory: {name!r}")
            with open(os.path.join(src, name), "rb") as fh:
                data = fh.read()
            total += len(data)
            if total > EXPORT_MAX_BYTES:
                return _error_line(msg.get("id"), "engine_error",
                                   f"export exceeds the {EXPORT_MAX_BYTES >> 20} MiB transfer cap")
            packed.append({"name": name, "b64": base64.b64encode(data).decode("ascii")})
    except OSError as exc:
        return _error_line(msg.get("id"), "engine_error", f"export file unreadable: {exc}")
    finally:
        shutil.rmtree(src, ignore_errors=True)
    result["bridgeFiles"] = packed
    return msg


class Session:
    """One client connection and the engine worker it owns."""

    def __init__(self, conn: socket.socket, hello: dict):
        self.conn = conn
        self.hello = hello
        self.send_lock = threading.Lock()
        self.pending_lock = threading.Lock()
        self.pending = {}
        self.proc = None
        self.closed = False
        os.makedirs(WORK_ROOT, exist_ok=True)
        self.work_dir = tempfile.mkdtemp(prefix="session-", dir=WORK_ROOT)

    def send(self, obj: dict) -> None:
        """@description Write one protocol line to the client.
        @param obj Response (or hello) object."""
        self.send_raw((json.dumps(obj, allow_nan=False) + "\n").encode("utf-8"))

    def send_raw(self, data: bytes) -> None:
        """@description Write bytes to the client; a dead client ends the session.
        @param data One or more complete protocol lines."""
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
                    self.send(_error_line(None, "invalid_design", "request line too long"))
                    break
                if line.strip():
                    self.forward(line)
        except OSError:
            pass
        finally:
            self.close()

    def forward(self, raw: bytes) -> None:
        """@description Parse one request, pin export's workDir, hand it to the worker.
        @param raw One request line."""
        try:
            req = json.loads(raw)
        except ValueError:
            self.send(_error_line(None, "invalid_design", "unparseable request line"))
            return
        if not isinstance(req, dict):
            self.send(_error_line(None, "invalid_design", "request must be a JSON object"))
            return
        req_id, cmd = req.get("id"), req.get("cmd")
        args = dict(req.get("args")) if isinstance(req.get("args"), dict) else {}
        if cmd == "export":
            args["workDir"] = self.work_dir
        with self.pending_lock:
            self.pending[req_id] = cmd
        proc = self.ensure_worker()
        line = json.dumps({"id": req_id, "cmd": cmd, "args": args}) + "\n"
        try:
            proc.stdin.write(line.encode("utf-8"))
            proc.stdin.flush()
        except (OSError, ValueError) as exc:
            _log(f"worker stdin write failed: {exc}")
            self.send(_error_line(req_id, "engine_error", f"engine write failed: {exc}"))

    def ensure_worker(self) -> subprocess.Popen:
        """@description Spawn the session's worker on first use.
        @returns The live worker process."""
        if self.proc is not None and self.proc.poll() is None:
            return self.proc
        self.proc = subprocess.Popen(
            _worker_cmd(), cwd=ENGINE_DIR, env=_worker_env(),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, start_new_session=True)
        _log(f"worker started pid={self.proc.pid}")
        threading.Thread(target=self.pump, args=(self.proc,), daemon=True).start()
        return self.proc

    def pump(self, proc: subprocess.Popen) -> None:
        """@description Relay worker stdout to the client; a worker that exits
            takes the connection with it, so the adapter sees the crash.
        @param proc The worker this pump belongs to."""
        for line in proc.stdout:
            self.relay(line)
        if not self.closed:
            _log(f"worker pid={proc.pid} exited (code {proc.wait()}) -- closing session")
            self.close()

    def relay(self, line: bytes) -> None:
        """@description Forward one worker line, inlining export files first.
        @param line One worker stdout line."""
        try:
            msg = json.loads(line)
        except ValueError:
            self.send_raw(line)  # the adapter drops non-JSON lines itself
            return
        req_id = msg.get("id") if isinstance(msg, dict) else None
        with self.pending_lock:
            cmd = self.pending.pop(req_id, None)
        if cmd == "export" and msg.get("ok"):
            self.send(_pack_export(msg, self.work_dir))
        else:
            self.send_raw(line if line.endswith(b"\n") else line + b"\n")

    def close(self) -> None:
        """@description End the session: drop the client, kill the worker
            (immediately when it is mid-command), remove the workDir."""
        if self.closed:
            return
        self.closed = True
        try:
            self.conn.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.conn.close()
        self.stop_worker()
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def stop_worker(self) -> None:
        """@description Stop the worker process group; SIGKILL at once when busy."""
        proc = self.proc
        if proc is None or proc.poll() is not None:
            return
        with self.pending_lock:
            busy = bool(self.pending)
        try:
            proc.stdin.close()
        except OSError:
            pass
        if not busy:
            try:
                proc.wait(timeout=2)
                return
            except subprocess.TimeoutExpired:
                pass
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (OSError, AttributeError):
            proc.kill()
        _log(f"worker pid={proc.pid} killed")


def serve(host: str, port: int, max_connections: int) -> None:
    """@description Accept connections forever, one Session thread each, bounded.
    @param host Bind address.
    @param port TCP port.
    @param max_connections Concurrent session cap (each owns a CPU-bound worker)."""
    engine_hash = build_hash(ENGINE_DIR)
    hello = {"bridge": {"protocol": PROTOCOL, "buildHash": engine_hash,
                        "python": platform.python_version()}}
    slots = threading.BoundedSemaphore(max_connections)
    srv = socket.create_server((host, port))
    _log(f"listening on {host}:{port} build={engine_hash[:12]} "
         f"python={platform.python_version()} max_connections={max_connections}")
    while True:
        conn, _addr = srv.accept()
        if not slots.acquire(blocking=False):
            try:
                conn.sendall((json.dumps(_error_line(
                    None, "engine_busy", "engine container is at its connection limit")) + "\n").encode())
            finally:
                conn.close()
            continue
        threading.Thread(target=_run_session, args=(conn, hello, slots), daemon=True).start()


def _run_session(conn: socket.socket, hello: dict, slots: threading.BoundedSemaphore) -> None:
    """@description Thread body: serve one session, then free its slot.
    @param conn Accepted client socket.
    @param hello The hello payload.
    @param slots Connection-cap semaphore."""
    try:
        Session(conn, hello).serve()
    except Exception as exc:  # noqa: BLE001 - one session must never kill the server
        _log(f"session failed: {exc!r}")
    finally:
        slots.release()


def _call(fh, sock: socket.socket, req: dict, timeout_s: float) -> dict:
    """@description Self-test helper: send one request, read its response.
    @param fh Socket read file.
    @param sock The socket.
    @param req Request object.
    @param timeout_s Read timeout.
    @returns The response object."""
    sock.settimeout(timeout_s)
    sock.sendall((json.dumps(req) + "\n").encode("utf-8"))
    return json.loads(fh.readline())


def selftest(host: str, port: int) -> int:
    """@description Install-time acceptance through the REAL bridge and engine:
        hello names this image's build, capabilities report polar + evaluate
        live, and the R7 default design flies a 24 h cycle with a closed mass
        ledger. Prints the evidence; non-zero on any failure.
    @param host Bridge host.
    @param port Bridge port.
    @returns Process exit code."""
    with socket.create_connection((host, port), timeout=30) as sock:
        fh = sock.makefile("rb")
        hello = json.loads(fh.readline()).get("bridge") or {}
        if hello.get("buildHash") != build_hash(ENGINE_DIR):
            print(f"FAIL: bridge build {hello.get('buildHash')} != baked tree", file=sys.stderr)
            return 1
        caps = _call(fh, sock, {"id": "st-1", "cmd": "capabilities", "args": {}}, 120)
        flags = (caps.get("result") or {}).get("capabilities") or {}
        print(f"python {hello.get('python')} build {hello.get('buildHash', '')[:12]} caps {json.dumps(flags)}")
        if not caps.get("ok") or not flags.get("polar") or not flags.get("evaluate"):
            print(f"FAIL: capabilities {json.dumps(caps)[:600]}", file=sys.stderr)
            return 1
        t0 = time.monotonic()
        ev = _call(fh, sock, {"id": "st-2", "cmd": "evaluate",
                              "args": {"design": SELFTEST_DESIGN}}, 600)
        if not ev.get("ok"):
            print(f"FAIL: evaluate {json.dumps(ev)[:600]}", file=sys.stderr)
            return 1
        res = ev["result"]
        ledger = sum(row["kg"] for row in res["build"]["massBreakdown"])
        if abs(ledger - res["build"]["massAllUpKg"]) > 1e-3:
            print(f"FAIL: mass ledger {ledger} != all-up {res['build']['massAllUpKg']}", file=sys.stderr)
            return 1
        print(f"evaluate (R7 default) closed={res['closed']} "
              f"admissible={res['verdict']['admissible']} "
              f"minSoc={res['energy']['minSoc']:.4f} usable={res['energy']['usable']:.4f} "
              f"allUp={res['build']['massAllUpKg']:.3f}kg in {time.monotonic() - t0:.1f}s")
    return 0


def main() -> int:
    """@description CLI: serve (default), --build-hash DIR, --selftest-design,
        or --selftest.
    @returns Process exit code."""
    ap = argparse.ArgumentParser(description="aero-lab engine container bridge")
    ap.add_argument("--build-hash", metavar="ENGINE_DIR")
    ap.add_argument("--selftest-design", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--host", default=os.environ.get("AERO_ENGINE_BIND", "0.0.0.0"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("AERO_ENGINE_PORT", "7411")))
    ap.add_argument("--max-connections", type=int,
                    default=int(os.environ.get("AERO_ENGINE_MAX_CONNECTIONS", "2")))
    a = ap.parse_args()
    if a.build_hash:
        print(build_hash(a.build_hash))
        return 0
    if a.selftest_design:
        print(json.dumps(SELFTEST_DESIGN, sort_keys=True))
        return 0
    if a.selftest:
        return selftest("127.0.0.1" if a.host == "0.0.0.0" else a.host, a.port)
    serve(a.host, a.port, a.max_connections)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
