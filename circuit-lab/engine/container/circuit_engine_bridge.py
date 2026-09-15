#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- serve the Circuit Lab
#   |                                           | worker's JSON-lines protocol over TCP inside the
#   |                                           | engine container (the cad-studio / aero-lab bridge
#   |                                           | shape): one connection owns one worker process, the
#   |                                           | first line is a hello naming the protocol and the
#   |                                           | build hash of the engine tree baked into the image,
#   |                                           | so a stale container is refused by the api before
#   |                                           | it solves anything; `--build-hash` prints the hash
#   |                                           | for the cross-implementation spec, `--selftest`
#   |                                           | solves an LED circuit and a motor + gear train
#   |                                           | through the real ngspice and checks the numbers.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | The firmware runner files join the build hash.
#   |                                           | The self-test also compiles and runs a blink
#   |                                           | sketch on the Uno and checks the LED toggles.
# 3 | maintainer@emeraldcoastsystemsgroup.com   | firmware/cosim.py joins the runtime files the engine build hash
#   |                                           | covers, so a change to the co-simulation forces a rebuild.
# 4 | maintainer@emeraldcoastsystemsgroup.com   | A failing self-test prints one compact line per request
#   |                                           | instead of json.dumps(...)[:3000], which truncated the
#   |                                           | first waveform mid-array: the installer showed invalid
#   |                                           | JSON and the failing request could not be read at all.
"""circuit_engine_bridge -- TCP front for circuit_worker.py (stdlib only)."""
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
RUNTIME_FILES = ("circuit_worker.py", "circuit_parts.py", "container/circuit_engine_bridge.py", "container/Dockerfile", "firmware/arduino_build.py", "firmware/avr8js_run.js", "firmware/cosim.py")
ENGINE_DIR = os.environ.get("CIRCUIT_LAB_ENGINE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_LINE_BYTES = 16 * 1024 * 1024
DEFAULT_PORT = 7413


def _log(msg: str) -> None:
    sys.stderr.write(f"[circuit-lab-engine-bridge] {msg}\n")
    sys.stderr.flush()


def build_hash(engine_dir: str) -> str:
    """@description sha256 over the runtime files, each prefixed by its relative name (CRLF folded).
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
    return [sys.executable, os.path.join(ENGINE_DIR, "circuit_worker.py")]


def _worker_env() -> dict:
    """Only what a numerical worker needs: no controller credentials ever reach it."""
    keep = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "PYTHONNOUSERSITE", "PYTHONDONTWRITEBYTECODE", "NGSPICE_BIN",
            "AVR8JS_DIR", "ARDUINO_CORE_LIB", "ARDUINO_CORE_DIR", "ARDUINO_VARIANT_DIR", "NODE_BIN")
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


BLINK_SKETCH = "void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(100); digitalWrite(13, LOW); delay(100); }\n"
BLINK_CIRCUIT = {"parts": [{"id": "MCU1", "type": "arduino", "props": {"sketch": BLINK_SKETCH}}, {"id": "R1", "type": "resistor", "props": {"ohms": 220}},
                           {"id": "D1", "type": "led"}, {"id": "GND", "type": "ground"}],
                 "wires": [{"id": "a", "from": {"part": "MCU1", "pin": "D13"}, "to": {"part": "R1", "pin": "a"}}, {"id": "b", "from": {"part": "R1", "pin": "b"}, "to": {"part": "D1", "pin": "a"}},
                           {"id": "c", "from": {"part": "D1", "pin": "k"}, "to": {"part": "GND", "pin": "gnd"}}, {"id": "g", "from": {"part": "MCU1", "pin": "GND"}, "to": {"part": "GND", "pin": "gnd"}}]}
LED_CIRCUIT = {"parts": [
    {"id": "B1", "type": "battery", "props": {"volts": 5, "internalOhms": 0}},
    {"id": "R1", "type": "resistor", "props": {"ohms": 1000}},
    {"id": "D1", "type": "led", "props": {"color": "red"}},
    {"id": "GND", "type": "ground"}],
    "wires": [
    {"id": "w1", "from": {"part": "B1", "pin": "+"}, "to": {"part": "R1", "pin": "a"}},
    {"id": "w2", "from": {"part": "R1", "pin": "b"}, "to": {"part": "D1", "pin": "a"}},
    {"id": "w3", "from": {"part": "D1", "pin": "k"}, "to": {"part": "GND", "pin": "gnd"}},
    {"id": "w4", "from": {"part": "B1", "pin": "-"}, "to": {"part": "GND", "pin": "gnd"}}]}

GEARBOX_CIRCUIT = {"parts": [
    {"id": "B1", "type": "battery", "props": {"volts": 12, "internalOhms": 0, "capacityMah": 2000}},
    {"id": "M1", "type": "motor", "props": {}},
    {"id": "G1", "type": "gear", "props": {"teeth": 20}},
    {"id": "G2", "type": "gear", "props": {"teeth": 60}},
    {"id": "L1", "type": "load", "props": {"inertiaGcm2": 50, "frictionMnm": 0, "viscousMnmPerKrpm": 0.1}},
    {"id": "GND", "type": "ground"}],
    "wires": [
    {"id": "w1", "from": {"part": "B1", "pin": "+"}, "to": {"part": "M1", "pin": "+"}},
    {"id": "w2", "from": {"part": "M1", "pin": "-"}, "to": {"part": "GND", "pin": "gnd"}},
    {"id": "w3", "from": {"part": "B1", "pin": "-"}, "to": {"part": "GND", "pin": "gnd"}},
    {"id": "s1", "from": {"part": "M1", "pin": "shaft"}, "to": {"part": "G1", "pin": "shaft"}},
    {"id": "m1", "from": {"part": "G1", "pin": "teeth"}, "to": {"part": "G2", "pin": "teeth"}},
    {"id": "s2", "from": {"part": "G2", "pin": "shaft"}, "to": {"part": "L1", "pin": "shaft"}}]}


def selftest() -> int:
    """@description Solve the LED circuit, the gearbox and a blink sketch through the real worker, ngspice, avr-gcc and avr8js;
    exit 0 only when every number holds."""
    proc = subprocess.Popen(_worker_cmd(), cwd=ENGINE_DIR, env=_worker_env(), stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    reqs = [{"id": 0, "cmd": "hello"},
            {"id": 1, "cmd": "simulate", "args": {"circuit": LED_CIRCUIT, "sim": {"stopSeconds": 0.01}}},
            {"id": 2, "cmd": "simulate", "args": {"circuit": GEARBOX_CIRCUIT, "sim": {"stopSeconds": 0.5, "stepSeconds": 0.0005}}},
            {"id": 3, "cmd": "simulate", "args": {"circuit": BLINK_CIRCUIT, "sim": {"stopSeconds": 0.5, "stepSeconds": 0.0005}}}]
    proc.stdin.write("".join(json.dumps(r) + "\n" for r in reqs).encode("utf-8"))
    proc.stdin.flush()
    proc.stdin.close()
    lines = [json.loads(l) for l in proc.stdout if l.strip()]
    proc.wait(timeout=180)
    ok = len(lines) == 4 and all(l.get("ok") for l in lines)
    if ok:
        led = next(r for r in lines[1]["result"]["readings"] if r["id"] == "D1")
        motor = next(r for r in lines[2]["result"]["readings"] if r["id"] == "M1")
        g2 = next(s for s in lines[2]["result"]["mechanism"]["shafts"] if "G2" in s["parts"])
        blink = lines[3]["result"]["waveforms"]["signals"]["i(D1)"]
        rises = sum(1 for k in range(1, len(blink)) if blink[k - 1] < 0.005 <= blink[k])
        checks = [
            lines[0]["result"]["ngspice"] is not None,
            2.9 < led["milliampsFinal"] < 3.4 and led["lit"] is True,
            2850 < motor["rpmFinal"] < 3000 and motor["stalled"] is False,
            abs(g2["ratio"] + 1 / 3) < 1e-9 and abs(g2["rpmFinal"] + motor["rpmFinal"] / 3) < 1.0,
            len(lines[2]["result"]["waveforms"]["time"]) > 100,
            lines[0]["result"].get("firmware") is True and rises >= 2,  # 100 ms on / 100 ms off for 0.5 s: at least two rising edges
        ]
        ok = all(checks)
        print(json.dumps({"selftest": ok, "ngspice": lines[0]["result"]["ngspice"], "ledMilliamps": led["milliampsFinal"], "motorRpm": motor["rpmFinal"],
                          "g2Rpm": g2["rpmFinal"], "blinkRisingEdges": rises, "ms": [l["result"]["ms"] for l in lines[1:]], "checks": checks}))
    else:
        # One compact line per request. The old form printed json.dumps(...)[:3000], which truncated
        # mid-array: the installer showed invalid JSON and the failing request was unreadable.
        summary = [{"id": l.get("id"), "ok": bool(l.get("ok")),
                    "error": (json.dumps(l.get("error"))[:400] if not l.get("ok") else None)} for l in lines[:4]]
        print(json.dumps({"selftest": False, "requests": len(lines), "results": summary}))
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Circuit Lab engine bridge")
    parser.add_argument("--host", default=os.environ.get("CIRCUIT_ENGINE_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("CIRCUIT_ENGINE_PORT", DEFAULT_PORT)))
    parser.add_argument("--max-connections", type=int, default=int(os.environ.get("CIRCUIT_ENGINE_SLOTS", "4")))
    parser.add_argument("--build-hash", action="store_true", help="print the engine build hash and exit")
    parser.add_argument("--selftest", action="store_true", help="solve two known circuits through the real ngspice")
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
