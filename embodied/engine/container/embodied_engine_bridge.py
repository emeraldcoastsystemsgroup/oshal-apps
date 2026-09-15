"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the TCP front of the physics plant (stdlib
    |                                           | only): JSON lines on 7413, a hello with the protocol, the
    |                                           | MuJoCo version and the engine build hash before the first
    |                                           | request, sessions keyed by the caller's id (a rehearsal clone
    |                                           | is its own session, copied from its parent's state), one lock
    |                                           | around every plant call (MuJoCo data is not thread-safe), idle
    |                                           | sessions dropped after half an hour, and --selftest, which
    |                                           | loads the shipped fixture, flies to the mission altitude and
    |                                           | sweeps the ring -- what install-engine.sh proves before it
    |                                           | says the container is up. The CAD Studio bridge's shape.
2   | maintainer@emeraldcoastsystemsgroup.com   | load takes a controller ({kind:'pid'} or {kind:'policy', file, residual}); a clone keeps its parent's policy; reports lists the policy files beside the reports.
3   | maintainer@emeraldcoastsystemsgroup.com   | B20: the node-rail front (embodied_engine_node.py) starts beside the TCP server when the swarm service secret is set -- the same Sessions, one lock; it is a runtime file in the build hash.
4   | maintainer@emeraldcoastsystemsgroup.com   | B6: the PX4 node front (embodied_px4_node.py, EMBODIED_PX4_ADDR) starts beside the plant's rail; a runtime file in the build hash.
5   | maintainer@emeraldcoastsystemsgroup.com   | The arm check (ADR-152 D5 task 3) is an op of its own under its own
    |                                           | lock: it runs for seconds and must not hold up a drone world's steps.
    |                                           | The arm plant and its task join the runtime files in the build hash.
6   | maintainer@emeraldcoastsystemsgroup.com   | B22 (half a): arm sessions beside the drone plants, under the SAME
    |                                           | lock and the same idle sweep -- arm-load (a room model), arm-step
    |                                           | (command the servos, advance the caller's step, report what the
    |                                           | joints really did), arm-clone (a rehearsal copy from the live
    |                                           | arm's state) and arm-drop. `status` counts them.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import socket
import socketserver
import sys
import threading
import time
import traceback

ENGINE_DIR = os.environ.get("EMBODIED_ENGINE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE_DIR)
sys.path.insert(0, os.path.join(ENGINE_DIR, "container"))

import mujoco  # noqa: E402
import numpy as np  # noqa: E402

from embodied_worker import PROTOCOL, Plant, PolicyController, hello  # noqa: E402
from embodied_engine_node import start_node_rail  # noqa: E402
from embodied_px4_node import start_px4_node  # noqa: E402

RUNTIME_FILES = ("embodied_worker.py", "container/embodied_engine_bridge.py", "requirements.txt", "requirements-lock.txt", "tasks/hover_leg.py",
                 "container/embodied_engine_node.py", "container/embodied_px4_node.py", "embodied_arm.py", "tasks/reach_grasp.py")
DEFAULT_PORT = 7413
MAX_LINE_BYTES = 64 * 1024 * 1024
IDLE_DROP_S = 1800.0
SELFTEST_FIXTURE = os.path.join(ENGINE_DIR, "tests", "fixtures", "recon-mini.xml")
REPORT_DIR = os.environ.get("EMBODIED_REPORT_DIR", "/tmp/embodied-reports")


def read_reports() -> list:
    """@description Every training report the tasks wrote to the report directory, newest first; unreadable files are named, not hidden."""
    out = []
    for path in sorted(glob.glob(os.path.join(REPORT_DIR, "*.json")), key=os.path.getmtime, reverse=True):
        try:
            with open(path, encoding="utf-8") as fh:
                out.append({"file": os.path.basename(path), "report": json.load(fh)})
        except (OSError, ValueError) as error:
            out.append({"file": os.path.basename(path), "error": str(error)})
    return out


def _log(msg: str) -> None:
    sys.stderr.write(f"[embodied-engine-bridge] {msg}\n")
    sys.stderr.flush()


def build_hash(engine_dir: str = ENGINE_DIR) -> str:
    """@description sha256 over the runtime files, each prefixed by its relative name, line endings normalised.
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


class Sessions:
    """@description The plants alive in this process, one per caller session, under one lock."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.plants: dict[str, Plant] = {}
        self.arms: dict = {}
        self.touched: dict[str, float] = {}

    def sweep(self) -> None:
        now = time.monotonic()
        for key in [k for k, t in self.touched.items() if now - t > IDLE_DROP_S]:
            self.plants.pop(key, None)
            self.arms.pop(key, None)
            self.touched.pop(key, None)

    def arm(self, key: str):
        """@description The arm plant of a session, or a refusal naming the session. Touching it keeps it alive."""
        arm = self.arms.get(key)
        if arm is None:
            raise KeyError(f"no arm session {key!r}: load it first")
        self.touched[key] = time.monotonic()
        return arm

    def get(self, key: str) -> Plant:
        plant = self.plants.get(key)
        if plant is None:
            raise KeyError(f"no session {key!r}: load it first")
        self.touched[key] = time.monotonic()
        return plant

    def handle(self, req: dict) -> dict:
        op = req.get("op")
        if op == "arm-check":
            return arm_check_op(req)
        with self.lock:
            self.sweep()
            if op == "status":
                return {"sessions": len(self.plants), "armSessions": len(self.arms), "steps": sum(p.steps for p in self.plants.values()), **hello(build_hash())}
            if op == "load":
                session = str(req["session"])
                plant = Plant(str(req["mjcf"]), int(req.get("seed", 0)))
                controller = plant.set_controller(req.get("controller"), REPORT_DIR)
                self.plants[session] = plant
                self.touched[session] = time.monotonic()
                return {"session": session, "bodies": int(plant.model.nbody), "geoms": int(plant.model.ngeom), "actuators": int(plant.model.nu),
                        "timestep": float(plant.model.opt.timestep), "massKg": float(plant.controller.mass), "restZ": plant.rest_z, "controller": controller}
            if op == "clone":
                parent = self.get(str(req["from"]))
                session = str(req["session"])
                child = Plant.__new__(Plant)
                child.__dict__.update(parent.__dict__)
                child.data = mujoco.MjData(parent.model)  # the model is shared read-only; the data, gust and rng are the child's own
                child.rng = np.random.default_rng(0)
                child.gust = parent.gust.copy()
                if parent.policy is not None:
                    child.policy = PolicyController(os.path.join(REPORT_DIR, parent.policy.file), parent.policy.residual, parent.policy.substeps)
                child.restore(parent.snapshot())
                self.plants[session] = child
                self.touched[session] = time.monotonic()
                return {"session": session}
            if op == "drop":
                self.plants.pop(str(req["session"]), None)
                self.touched.pop(str(req["session"]), None)
                return {"dropped": True}
            if op == "reports":
                return {"dir": REPORT_DIR, "reports": read_reports(), "policies": sorted(os.path.basename(p) for p in glob.glob(os.path.join(REPORT_DIR, "*.zip")))}
            if op == "step":
                return self.get(str(req["session"])).step(req["setpoint"], str(req.get("phase", "hover")), float(req["dt"]))
            if op == "sense":
                return self.get(str(req["session"])).sense(req.get("spec") or {})
            if op == "arm-load":
                from embodied_arm import RoomArmPlant
                session = str(req["session"])
                arm = RoomArmPlant(str(req["mjcf"]), int(req.get("seed", 0)))
                self.arms[session] = arm
                self.touched[session] = time.monotonic()
                return {"session": session, "bodies": int(arm.model.nbody), "geoms": int(arm.model.ngeom),
                        "actuators": int(arm.model.nu), "timestep": float(arm.model.opt.timestep), "joints": len(arm.joint_ids)}
            if op == "arm-step":
                return self.arm(str(req["session"])).step(list(req["q"]), float(req.get("grip", 0.05)), float(req["dt"]))
            if op == "arm-clone":
                from embodied_arm import RoomArmPlant
                parent = self.arm(str(req["from"]))
                session = str(req["session"])
                child = RoomArmPlant.__new__(RoomArmPlant)
                child.__dict__.update(parent.__dict__)
                child.data = mujoco.MjData(parent.model)  # the model is shared read-only; the state is the child's own
                child.steps = 0
                child.restore(parent.snapshot())
                self.arms[session] = child
                self.touched[session] = time.monotonic()
                return {"session": session}
            if op == "arm-drop":
                self.arms.pop(str(req["session"]), None)
                self.touched.pop(str(req["session"]), None)
                return {"dropped": True}
            raise ValueError(f"unknown op {op!r}")


ARM_LOCK = threading.Lock()


def arm_check_op(req: dict) -> dict:
    """@description The printed arm's physics check (ADR-152 D5 task 3): hold the payload in each joint's worst pose and
    run the taught pick-and-place. It takes seconds, so it runs under its OWN lock — a drone world stepping on this
    container must not wait behind it — and the task module is imported only when a check is asked for."""
    from tasks.reach_grasp import arm_check  # noqa: PLC0415 -- the plant and the rail must not pay for the task module
    with ARM_LOCK:
        return arm_check(str(req["mjcf"]), list(req["worst"]), list(req["designNm"]), list(req["usableNm"]), list(req["speeds"]),
                         float(req["payloadKg"]), int(req.get("seeds", 3)))


SESSIONS = Sessions()


class Handler(socketserver.StreamRequestHandler):
    """@description One client connection: hello, then request lines answered in order."""

    def handle(self) -> None:
        self.wfile.write((json.dumps(hello(build_hash())) + "\n").encode("utf-8"))
        self.wfile.flush()
        while True:
            line = self.rfile.readline(MAX_LINE_BYTES)
            if not line:
                return
            try:
                req = json.loads(line)
                result = SESSIONS.handle(req)
                reply = {"id": req.get("id"), "ok": True, "result": result}
            except Exception as error:  # every failure is answered, never swallowed
                rid = None
                try:
                    rid = json.loads(line).get("id")
                except Exception:
                    pass
                _log(f"request failed: {error}\n{traceback.format_exc()}")
                reply = {"id": rid, "ok": False, "error": type(error).__name__, "reason": str(error)}
            self.wfile.write((json.dumps(reply) + "\n").encode("utf-8"))
            self.wfile.flush()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def selftest() -> int:
    """@description Load the shipped fixture, rest on the pad, fly to the mission altitude, sweep the ring. Exit 0 only when every number is right."""
    with open(SELFTEST_FIXTURE, encoding="utf-8") as fh:
        plant = Plant(fh.read(), seed=7)
    rest = plant.step({"x": 0.6, "y": 0.6, "z": 0.0, "yaw": 0.0}, "landed", 1.0)
    assert abs(rest["z"] - plant.rest_z) < 0.002, f"rest z {rest['z']} vs {plant.rest_z}"
    for _ in range(6):
        r = plant.step({"x": 0.6, "y": 0.6, "z": 2.075, "yaw": 0.0}, "hover", 1.0)
    assert abs(r["z"] - 2.075) < 0.05 and abs(r["x"] - 0.6) < 0.06 and abs(r["y"] - 0.6) < 0.06, f"hover at {r}"
    assert r["settled"], "the controller settled on the setpoint"
    frames = plant.sense({"ring": {"azimuthCount": 450, "elevationsDeg": [0], "maxRange": 12}, "nadir": {"maxRange": 8}})
    assert len(frames["ring"]["t"]) == 450, "every ring ray hits a wall"
    assert abs(frames["nadir"]["t"][0] - (r["z"] - 0.02)) < 0.03, f"nadir {frames['nadir']['t']}"
    print(json.dumps({"selftest": "ok", "hover": r, "ringHits": len(frames["ring"]["t"]), **hello(build_hash())}))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="embodied physics engine bridge")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.environ.get("EMBODIED_ENGINE_PORT", DEFAULT_PORT)))
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    _log(f"engine {ENGINE_DIR} build {build_hash()[:12]} listening on {args.host}:{args.port}")
    start_node_rail(SESSIONS, lambda: hello(build_hash()))
    start_px4_node()
    with Server((args.host, args.port), Handler) as server:
        server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
