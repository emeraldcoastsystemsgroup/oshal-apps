"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the spider-18's controller (ADR-202, lane L4):
    |                                           | ONE program that runs in the physics container during training
    |                                           | and on the robot's Raspberry Pi, a `hexapod`-kind node on the
    |                                           | swarm rail (the PX4 node's shape: a heartbeat with the device
    |                                           | credential, {id, command, args} envelopes at the command
    |                                           | endpoint, /health) in front of one of three bodies (fake, plant,
    |                                           | serial; embodied_hexapod_backends.py). The brief's commands:
    |                                           | hello, walk {vxMps, vyMps, yawRateRadS}, stop, pose {targetsRad},
    |                                           | flip, jump, sense (the state plus lidar), sit/land; plus tick
    |                                           | (one control period, lock-step), load and reset for the plant.
    |                                           | A fixed-rate loop plays the tripod gait (hexapod_gait.py), decides
    |                                           | `inverted` from accelMps2 alone (the body-frame gravity sign, with
    |                                           | hysteresis and a settling time: a knock is not a flip) and applies
    |                                           | the contract's mirror rule to every target it sends. flip plays a
    |                                           | keyframe push in the frame the body started in; jump goes to the
    |                                           | body (no_spring passes through). Standard library only.
2   | maintainer@emeraldcoastsystemsgroup.com   | The heartbeat telemetry keeps the NODE's inverted decision under
    |                                           | `inverted` and carries the body's truth as `bodyInverted`: the
    |                                           | state's key used to overwrite the decision, which on a serial
    |                                           | body (no truth, always false) hid the mirror rule from the fleet.
3   | maintainer@emeraldcoastsystemsgroup.com   | B30 gate: `load` takes `controller: policy:<file>` on the plant body
    |                                           | (the plant refuses an uncertified policy by name; the fake and serial
    |                                           | bodies refuse `policy_needs_plant`), and while the node walks on such
    |                                           | a body it sends the command and reports the policy's targets as `sent`.
4   | maintainer@emeraldcoastsystemsgroup.com   | B30: the brain for the Pi -- `load {controller: policy:<zip>}` on the
    |                                           | fake or serial body loads the policy's exported weights file
    |                                           | (hexapod_policy.NodePolicyPlayer, NumPy only; refused by name when
    |                                           | missing or uncertified) and the node then makes idle and walk
    |                                           | targets from the certified policy through the mirror rule it
    |                                           | decides; the plant body keeps the plant-side controller.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import signal
import socket
import sys
import threading
import time
from typing import Callable

ENGINE_DIR = os.environ.get("EMBODIED_ENGINE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE_DIR)
sys.path.insert(0, os.path.join(ENGINE_DIR, "container"))

from embodied_engine_node import NodeRail, NodeServer, make_handler, read_device_credential  # noqa: E402
from embodied_hexapod_backends import FakeBackend, PlantBackend, SerialBackend, plant_refusal  # noqa: E402
from hexapod_bus import Calibration, FdPort, ServoBus  # noqa: E402
from hexapod_gait import KeyframePlayer, TripodGait, flip_keyframes, sit_targets, stance_targets  # noqa: E402
from hexapod_spec import ACTUATOR_COUNT, clamp_targets, inverted_joint_targets, validate_targets  # noqa: E402

PROTOCOL = 1
HEXAPOD_NODE_VERSION = "0.1.0"
HEXAPOD_KIND = "hexapod"
HEXAPOD_RUNTIME_FILES = ("hexapod_spec.py", "hexapod_gait.py", "hexapod_bus.py", "container/embodied_hexapod_backends.py", "container/embodied_hexapod_node.py",
                         "hexapod_gaits.py", "hexapod_policy.py")
#: Where the node finds a policy's exported weights file (`<zip stem>.weights.json`) for `load {controller: policy:<zip>}`.
POLICY_DIR = os.environ.get("EMBODIED_HEXAPOD_POLICY_DIR") or os.path.join(ENGINE_DIR, "policies")
DEFAULT_TICK_HZ = 50.0
DEFAULT_NODE_ID = "embodied-hexapod"
DEFAULT_NODE_PORT = 7416
DEFAULT_PLANT_ADDR = "127.0.0.1:7413"
DEFAULT_SERIAL_PORT = "/dev/ttyUSB0"
DEFAULT_SERIAL_BAUD = 1_000_000
INVERT_THRESHOLD_MPS2 = 3.0
INVERT_SETTLE_S = 0.3
SIT_S = 1.0
G_MPS2 = 9.81
COMMANDS = ("hello", "status", "walk", "stop", "pose", "flip", "jump", "sense", "sit", "land", "estop", "tick", "load", "reset")
TELEMETRY_KEYS = ("timeS", "fell")


def _log(msg: str) -> None:
    sys.stderr.write(f"[embodied-hexapod-node] {msg}\n")
    sys.stderr.flush()


def hexapod_build_hash(engine_dir: str = ENGINE_DIR) -> str:
    """@description sha256 over the node's runtime files (the bridge's recipe): what `hello` reports as buildHash.
    @param engine_dir The engine tree. @returns Hex digest."""
    digest = hashlib.sha256()
    for rel in HEXAPOD_RUNTIME_FILES:
        path = os.path.join(engine_dir, rel)
        digest.update(rel.encode("utf-8") + b"\0")
        if os.path.exists(path):
            with open(path, "rb") as fh:
                digest.update(fh.read().replace(b"\r\n", b"\n"))
        digest.update(b"\0")
    return digest.hexdigest()


class InvertedSwitch:
    """@description Decides `inverted` from the body-frame accelerometer alone: an accelerometer at rest reads +g on
    the axis pointing up, so body z at +g is upright and at -g inverted. Hysteresis (nothing changes between
    -threshold and +threshold) and a settling time (the new sign must hold for settle_s) keep a knock, a bounce or a
    mid-roll reading from flipping the mirror rule."""

    def __init__(self, threshold_mps2: float = INVERT_THRESHOLD_MPS2, settle_s: float = INVERT_SETTLE_S) -> None:
        self.threshold = threshold_mps2
        self.settle_s = settle_s
        self.inverted = False
        self.pending: bool | None = None
        self.pending_s = 0.0
        self.flips = 0
        self.accel_z: float | None = None

    def update(self, accel_z: float, dt: float) -> bool:
        """@description One reading. @param accel_z Body-frame z acceleration (m/s^2). @param dt Seconds since the last. @returns The decision."""
        self.accel_z = accel_z
        candidate = True if accel_z <= -self.threshold else False if accel_z >= self.threshold else None
        if candidate is None or candidate == self.inverted:
            self.pending, self.pending_s = None, 0.0
            return self.inverted
        if self.pending != candidate:
            self.pending, self.pending_s = candidate, 0.0
        self.pending_s += dt
        if self.pending_s >= self.settle_s:
            self.inverted, self.flips = candidate, self.flips + 1
            self.pending, self.pending_s = None, 0.0
        return self.inverted

    def settle_now(self, accel_z: float) -> bool:
        """@description Decide at once (after a reset, where the body was placed, not knocked). @param accel_z The reading. @returns The decision."""
        if abs(accel_z) >= self.threshold:
            self.inverted = accel_z < 0
        self.pending, self.pending_s = None, 0.0
        return self.inverted


def _finite(args: dict, key: str) -> float:
    value = args.get(key, 0.0)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"{key} must be a finite number")
    return float(value)


class HexapodController:
    """@description The node's brain-facing half: the modes (idle, walk, pose, flip, sit), the gait, the switch, the
    body. `handle` answers the rail's ops under one lock; `tick` is one control period, run by the paced loop or by a
    lock-step caller. `plants` is what the rail counts as sessions: the one body."""

    def __init__(self, backend, tick_hz: float = DEFAULT_TICK_HZ, build_hash: str | None = None, on_state: Callable[[dict], None] | None = None) -> None:
        self.backend = backend
        self.dt = 1.0 / float(tick_hz)
        self.tick_hz = float(tick_hz)
        self.build_hash = build_hash or hexapod_build_hash()
        self.on_state = on_state
        self.gait = TripodGait()
        self.switch = InvertedSwitch()
        self.mode = "idle"
        self.command = (0.0, 0.0, 0.0)
        self.held: list[float] = stance_targets()
        self.held_raw = False
        self.player: KeyframePlayer | None = None
        self.player_mirrored = False
        self.brain = None  # a NodePolicyPlayer once a certified policy is loaded on this body
        self.policy_dir = POLICY_DIR
        self.flip_info: dict | None = None
        self.sent: list[float] = list(self.held)
        self.lock = threading.RLock()
        self.ticks = 0
        self.plants = {"body": backend}
        self.last_state: dict = backend.state()
        self.stop_event = threading.Event()
        self.loop_thread: threading.Thread | None = None

    # -- identity ---------------------------------------------------------------
    def hello(self) -> dict:
        """@description What the heartbeat and `hello` carry: protocol, engine, version, build hash, backend, kind."""
        return {"protocol": PROTOCOL, "engine": f"hexapod-{self.backend.name}", "version": HEXAPOD_NODE_VERSION, "buildHash": self.build_hash,
                "backend": self.backend.name, "kind": HEXAPOD_KIND, "tickHz": self.tick_hz, "hasSpring": bool(self.backend.has_spring)}

    def status(self) -> dict:
        """@description The node's own view: mode, the switch's decision, whether the mirror is applied, the command, the clock."""
        return {"mode": self.mode, "inverted": self.switch.inverted, "mirrored": self._mirrored(), "accelZ": self.switch.accel_z, "flips": self.switch.flips,
                "command": {"vxMps": self.command[0], "vyMps": self.command[1], "yawRateRadS": self.command[2]}, "tickHz": self.tick_hz, "ticks": self.ticks,
                "backend": self.backend.name, "relaxed": bool(getattr(self.backend, "relaxed", False)), "flip": self.flip_info}

    def _mirrored(self) -> bool:
        if self.mode == "flip":
            return self.player_mirrored
        if self.mode in ("pose", "estop") and self.held_raw:
            return False
        return self.switch.inverted

    # -- the control period ------------------------------------------------------
    def _planned(self, dt: float) -> list[float]:
        """@description This tick's targets in the body's upright frame (before the mirror), by mode."""
        if self.mode in ("idle", "walk"):
            return self.gait.tick(dt)
        if self.mode in ("flip", "sit") and self.player is not None:
            frame = self.player.tick(dt)
            if frame is not None:
                return frame
            self._sequence_done()
        if self.mode in ("sit", "pose", "estop"):
            return self.held
        return self.gait.tick(dt)

    def _sequence_done(self) -> None:
        if self.mode == "flip":
            self.mode, self.flip_info = "idle", None
        elif self.mode == "sit":
            self.backend.relax()
        self.player = None

    def tick(self, dt: float | None = None) -> dict:
        """@description One control period: plan, mirror, send to the body, read the body, update the switch.
        @param dt Seconds (the node's period by default). @returns The state after the tick, with `node`."""
        dt = self.dt if dt is None else float(dt)
        with self.lock:
            self.switch.update(float(self.last_state["accelMps2"][2]), dt)  # decide from the latest reading, then plan: sent and inverted agree
            if self.brain is not None and self.mode in ("idle", "walk"):
                targets = self.brain.targets(self.last_state, self.command if self.mode == "walk" else (0.0, 0.0, 0.0), self.switch.inverted, dt)
            else:
                planned = self._planned(dt)
                targets = inverted_joint_targets(planned) if self._mirrored() else list(planned)
            self.sent = clamp_targets(targets)
            stance = list(self.gait.stance) if self.mode in ("idle", "walk") else [True] * 6
            state = self.backend.apply(self.sent, dt, self.command if self.mode == "walk" else (0.0, 0.0, 0.0), stance, walking=self.mode == "walk")
            played = getattr(self.backend, "last_targets", None)
            if played is not None:
                self.sent = clamp_targets(played)  # the plant's certified policy made this tick's targets
            self.ticks += 1
            self.last_state = state
            out = {**state, "node": self.status()}
        if self.on_state is not None:
            self.on_state(out)
        return out

    # -- the paced loop ------------------------------------------------------------
    def start_loop(self) -> None:
        """@description Tick at the node's rate in wall time (the body moves in real time)."""
        if self.loop_thread is not None:
            return
        self.loop_thread = threading.Thread(target=self._loop, name="hexapod-loop", daemon=True)
        self.loop_thread.start()

    def _loop(self) -> None:
        next_at = time.monotonic()
        while not self.stop_event.is_set():
            try:
                self.tick()
            except Exception as error:  # the loop survives a body fault and says so; the next tick retries
                _log(f"tick failed: {type(error).__name__}: {error}")
                self.stop_event.wait(0.5)
            next_at += self.dt
            self.stop_event.wait(max(0.0, next_at - time.monotonic()))

    def stop_loop(self) -> None:
        self.stop_event.set()
        if self.loop_thread is not None:
            self.loop_thread.join(2)
            self.loop_thread = None

    # -- the ops ----------------------------------------------------------------------
    def _engage(self) -> None:
        if getattr(self.backend, "relaxed", False):
            self.backend.engage()

    def _reply(self, state: dict | None = None, **extra) -> dict:
        return {**(state or self.last_state), "node": self.status(), **extra}

    def op_walk(self, args: dict) -> dict:
        if self.mode == "flip":
            raise plant_refusal("busy", "a flip is in progress; wait for it to finish")
        vx, vy, wz = _finite(args, "vxMps"), _finite(args, "vyMps"), _finite(args, "yawRateRadS")
        self._engage()
        self.command = (vx, vy, wz)
        self.gait.set_command(vx, vy, wz)
        self.mode, self.player = "walk", None
        return self._reply(**({"controller": self.brain.name} if self.brain is not None else {}))

    def op_stop(self, args: dict) -> dict:
        self.command = (0.0, 0.0, 0.0)
        self.gait.set_command(0.0, 0.0, 0.0)
        if self.mode != "flip":
            self.mode, self.player, self.flip_info = "idle", None, None
        return self._reply()

    def op_pose(self, args: dict) -> dict:
        if self.mode == "flip":
            raise plant_refusal("busy", "a flip is in progress; wait for it to finish")
        targets = clamp_targets(validate_targets(args.get("targetsRad")))
        self._engage()
        self.command = (0.0, 0.0, 0.0)
        self.gait.set_command(0.0, 0.0, 0.0)
        self.held, self.held_raw, self.mode, self.player = targets, bool(args.get("raw", False)), "pose", None
        return self._reply()

    def op_flip(self, args: dict) -> dict:
        side = str(args.get("side", "right"))
        frames = flip_keyframes(side)
        if self.mode == "flip":
            raise plant_refusal("busy", "a flip is already in progress")
        self._engage()
        self.command = (0.0, 0.0, 0.0)
        self.gait.set_command(0.0, 0.0, 0.0)
        self.player_mirrored = self.switch.inverted
        start = list(self.last_state.get("jointPosRad") or self.sent)
        self.player = KeyframePlayer(frames, inverted_joint_targets(start) if self.player_mirrored else start)
        self.flip_info = {"side": side, "durationS": round(self.player.total_s, 3), "keyframes": len(frames), "fromInverted": self.player_mirrored}
        self.mode = "flip"
        return self._reply(flip=self.flip_info)

    def op_jump(self, args: dict) -> dict:
        if self.mode == "flip":
            raise plant_refusal("busy", "a flip is in progress; wait for it to finish")
        self._engage()
        state = self.backend.jump()
        self.last_state = state
        return self._reply(state, jumped=True)

    def op_sense(self, args: dict) -> dict:
        state = self.backend.state()
        self.last_state = state
        lidar = self.backend.lidar()
        source = self.backend.name if lidar is not None else "none"
        return self._reply(state, lidar=lidar if lidar is not None else {"anglesRad": [], "rangesM": []}, lidarSource=source)

    def op_sit(self, args: dict) -> dict:
        if self.mode == "flip":
            raise plant_refusal("busy", "a flip is in progress; wait for it to finish")
        self.command = (0.0, 0.0, 0.0)
        self.gait.set_command(0.0, 0.0, 0.0)
        self.held, self.held_raw = sit_targets(), False
        start = list(self.last_state.get("jointPosRad") or self.sent)
        self.player = KeyframePlayer([(SIT_S, self.held)], inverted_joint_targets(start) if self.switch.inverted else start)
        self.mode = "sit"
        return self._reply()

    def op_estop(self, args: dict) -> dict:
        """@description The act that removes authority: hold the joints where they are, torque off, the gait and any
        flip abandoned. Never refused. The next walk, pose, flip or jump engages the servos again."""
        self.command = (0.0, 0.0, 0.0)
        self.gait.set_command(0.0, 0.0, 0.0)
        self.held = clamp_targets(list(self.last_state.get("jointPosRad") or self.sent))
        self.held_raw = True
        self.mode, self.player, self.flip_info = "estop", None, None
        self.backend.relax()
        return self._reply(estopped=True)

    def op_tick(self, args: dict) -> dict:
        dt = _finite(args, "dtS") if "dtS" in args else self.dt
        if dt <= 0 or dt > 1.0:
            raise ValueError("dtS must be in (0, 1]")
        return self.tick(dt)

    def _load_brain(self, controller: str):
        """@description The exported weights file for `policy:<zip>` from the policy directory, through the player's checks.
        @param controller The request's controller. @returns The player. @raises bad_controller, policy_not_found, policy_not_certified."""
        from hexapod_policy import NodePolicyPlayer, PolicyRefused, weights_path  # noqa: PLC0415 -- NumPy only when a brain is loaded
        text = str(controller).strip()
        if not text.startswith("policy:") or os.path.basename(text) != text:
            raise plant_refusal("bad_controller", "controller must be \"policy:<zip>\", a file name in the node's policy directory")
        path = os.path.join(self.policy_dir, weights_path(text[len("policy:"):]))
        try:
            return NodePolicyPlayer(path)
        except PolicyRefused as error:
            raise plant_refusal(type(error).__name__, str(error)) from error

    def op_load(self, args: dict) -> dict:
        controller = args.get("controller")
        if self.backend.name == "serial" and controller is None:
            raise plant_refusal("cannot_load", "this node is a body, not a simulator; load takes a controller here")
        seed = int(args.get("seed", 1))
        if controller is not None and self.backend.name != "plant":
            self.brain = self._load_brain(str(controller))
            reply = self.op_reset(args)
            return {**reply, "loaded": {"controller": self.brain.name, "runtime": "node", "policySha256": self.brain.policy_sha256, "certifiedTask": self.brain.certificate.get("certifiedTask")}}
        if self.backend.name == "plant":
            mjcf = args.get("mjcf")
            if not mjcf and args.get("mjcfFile"):
                with open(str(args["mjcfFile"]), "r", encoding="utf-8") as fh:
                    mjcf = fh.read()
            if not isinstance(mjcf, str) or not mjcf.strip():
                raise ValueError("load needs mjcf (the spider's MJCF text) or mjcfFile")
            loaded = self.backend.load(mjcf, seed, None if controller is None else str(controller))
            state = self.backend.reset(str(args.get("pose", "upright")), seed)
            self.switch.settle_now(float(state["accelMps2"][2]))
            self.last_state = state
            return self._reply(state, loaded=loaded)
        return self.op_reset(args)

    def op_reset(self, args: dict) -> dict:
        state = self.backend.reset(str(args.get("pose", "upright")), int(args.get("seed", 1)))
        self.switch.settle_now(float(state["accelMps2"][2]))
        self.mode, self.player, self.flip_info, self.command = "idle", None, None, (0.0, 0.0, 0.0)
        self.gait.set_command(0.0, 0.0, 0.0)
        if self.brain is not None:
            self.brain.reset()
        self.last_state = state
        return self._reply(state)

    def handle(self, req: dict) -> dict:
        """@description One op under the lock (the rail's `{"op": ..., **args}` shape). @param req The request. @returns The reply payload."""
        op = req.get("op")
        if op not in COMMANDS:
            raise ValueError(f"unknown command {op!r}; the hexapod answers {', '.join(COMMANDS)}")
        args = {k: v for k, v in req.items() if k != "op"}
        with self.lock:
            if op == "hello":
                return self.hello()
            if op == "status":
                return {**self.hello(), **self.status(), "sessions": len(self.plants)}
            handler = getattr(self, f"op_{'sit' if op == 'land' else op}")
            return handler(args)

    def close(self) -> None:
        self.stop_loop()
        self.backend.close()


class HexapodRail(NodeRail):
    """@description The rail with the hexapod's telemetry: the latest state's position and the switch's decision ride in
    the heartbeat; flips, jumps, sits and loads are events."""

    def command(self, envelope: dict) -> dict:
        op = envelope.get("command") if isinstance(envelope, dict) else None
        args = envelope.get("args") if isinstance(envelope, dict) else None
        if not isinstance(op, str) or not isinstance(args, dict):
            raise ValueError("an envelope is {id, command, args}")
        result = self.sessions.handle({"op": op, **args})
        if op in ("flip", "jump", "sit", "land", "estop", "load", "reset"):
            self.event(op, json.dumps(result.get("flip") or {"ok": True})[:300])
        self.note_state(result)
        return result

    def note_state(self, state: dict) -> None:
        """@description Keep a compact telemetry from a state (also called by the loop). @param state A reply with bodyPosM."""
        if not isinstance(state, dict) or "bodyPosM" not in state:
            return
        node = state.get("node") or {}
        with self.lock:
            self.telemetry = {"mode": node.get("mode"), "inverted": node.get("inverted"), "mirrored": node.get("mirrored"), "bodyInverted": state.get("inverted"),
                              "x": state["bodyPosM"][0], "y": state["bodyPosM"][1], "z": state["bodyPosM"][2], **{k: state[k] for k in TELEMETRY_KEYS if k in state}}


def make_backend(env: dict):
    """@description The body the environment names: EMBODIED_HEXAPOD_BACKEND = fake | plant | serial, with each one's
    settings. @param env Environment. @returns The backend, or None when no backend is configured."""
    name = (env.get("EMBODIED_HEXAPOD_BACKEND") or "").strip().lower()
    spring = (env.get("EMBODIED_HEXAPOD_SPRING") or "1").strip() not in ("0", "false", "no")
    if not name:
        return None
    if name == "fake":
        return FakeBackend(has_spring=spring)
    if name == "plant":
        addr = (env.get("EMBODIED_HEXAPOD_PLANT_ADDR") or DEFAULT_PLANT_ADDR).strip()
        host, port = addr.rsplit(":", 1)
        return PlantBackend(host, int(port))
    if name == "serial":
        path = (env.get("EMBODIED_HEXAPOD_SERIAL_PORT") or DEFAULT_SERIAL_PORT).strip()
        baud = int(env.get("EMBODIED_HEXAPOD_SERIAL_BAUD") or DEFAULT_SERIAL_BAUD)
        calibration = Calibration.from_json(env["EMBODIED_HEXAPOD_CALIBRATION"]) if env.get("EMBODIED_HEXAPOD_CALIBRATION") else Calibration()
        imu = (lambda: {"accelMps2": [0.0, 0.0, G_MPS2], "gyroRadS": [0.0, 0.0, 0.0], "quatWXYZ": [1.0, 0.0, 0.0, 0.0]}) if env.get("EMBODIED_HEXAPOD_IMU") == "fake" else None
        backend = SerialBackend(ServoBus(FdPort.open(path, baud), calibration), imu=imu, has_spring=spring)
        found = backend.bus.scan()
        _log(f"serial bus {path} at {baud} baud: {len(found)} of {ACTUATOR_COUNT} leg servos answer ({found})" + ("" if imu else "; no IMU reader: inverted stays false"))
        return backend
    raise ValueError(f"EMBODIED_HEXAPOD_BACKEND {name!r} is not fake, plant or serial")


def start_hexapod_node(env: dict | None = None, controller: HexapodController | None = None):
    """@description Join the rail as the spider when EMBODIED_HEXAPOD_BACKEND is set: its own node id, endpoint, port and
    device credential (EMBODIED_HEXAPOD_NODE_TOKEN or _FILE) beside the plant's; the paced loop starts unless
    EMBODIED_HEXAPOD_PACED=0 (lock-step through `tick`). @returns The HexapodRail (with `.controller`), or None."""
    env = os.environ if env is None else env
    if controller is None:
        backend = make_backend(env)
        if backend is None:
            return None
        controller = HexapodController(backend, float(env.get("EMBODIED_HEXAPOD_TICK_HZ") or DEFAULT_TICK_HZ))
        if backend.name == "plant" and env.get("EMBODIED_HEXAPOD_MJCF_FILE"):
            controller.handle({"op": "load", "mjcfFile": env["EMBODIED_HEXAPOD_MJCF_FILE"], "seed": int(env.get("EMBODIED_HEXAPOD_SEED") or 1)})
    node_id = (env.get("EMBODIED_HEXAPOD_NODE_ID") or DEFAULT_NODE_ID).strip()
    host = (env.get("EMBODIED_NODE_HOST") or "0.0.0.0").strip()
    port = int(env.get("EMBODIED_HEXAPOD_NODE_PORT") or DEFAULT_NODE_PORT)
    api_url = (env.get("OSHAL_API_URL") or "http://oshal-api:5000").strip()
    credential = read_device_credential(env, "EMBODIED_HEXAPOD_NODE_TOKEN")
    if not credential:
        _log(f"hexapod node disabled: no device credential for {node_id} (enroll it once: POST /api/join/enroll {{\"clientId\": \"{node_id}\"}} while signed in, then set EMBODIED_HEXAPOD_NODE_TOKEN_FILE)")
        controller.close()
        return None
    rail = HexapodRail(controller, controller.hello, node_id, HEXAPOD_KIND, "", api_url, credential)
    controller.on_state = rail.note_state
    server = NodeServer((host, port), make_handler(rail))
    bound = server.server_address[1]
    reach = socket.gethostname() if host in ("0.0.0.0", "", "::") else host
    rail.endpoint_url = (env.get("EMBODIED_HEXAPOD_NODE_ENDPOINT") or f"http://{reach}:{bound}").rstrip("/")
    rail.server = server
    rail.controller = controller
    rail.threads = [threading.Thread(target=server.serve_forever, name="hexapod-node-http", daemon=True), threading.Thread(target=rail.heartbeat_loop, name="hexapod-node-heartbeat", daemon=True)]
    for t in rail.threads:
        t.start()
    if (env.get("EMBODIED_HEXAPOD_PACED") or "1").strip() not in ("0", "false", "no"):
        controller.start_loop()
    _log(f"hexapod node up: {node_id} at {rail.endpoint_url} ({controller.backend.name} body, {controller.tick_hz:g} Hz), heartbeating to {api_url}")
    return rail


def selftest() -> int:
    """@description The fake body walked for two seconds of ticks: it must move forward, the switch must stay upright. Exit 0 only then."""
    controller = HexapodController(FakeBackend(), build_hash=hexapod_build_hash())
    controller.handle({"op": "walk", "vxMps": 0.1, "vyMps": 0.0, "yawRateRadS": 0.0})
    state = controller.last_state
    for _ in range(int(2.0 * DEFAULT_TICK_HZ)):
        state = controller.tick()
    assert 0.15 < state["bodyPosM"][0] < 0.25, f"walked {state['bodyPosM'][0]} m in 2 s at 0.1 m/s"
    assert state["node"]["inverted"] is False and state["node"]["mode"] == "walk"
    print(json.dumps({"selftest": "ok", "walkedM": round(state["bodyPosM"][0], 4), **controller.hello()}))
    return 0


def _env_from_args(args: argparse.Namespace) -> dict:
    env = dict(os.environ)
    for key, value in (("EMBODIED_HEXAPOD_BACKEND", args.backend), ("EMBODIED_HEXAPOD_NODE_ID", args.node_id), ("EMBODIED_HEXAPOD_NODE_PORT", args.port),
                       ("OSHAL_API_URL", args.api_url), ("EMBODIED_HEXAPOD_NODE_TOKEN_FILE", args.token_file), ("EMBODIED_HEXAPOD_NODE_ENDPOINT", args.endpoint),
                       ("EMBODIED_HEXAPOD_PLANT_ADDR", args.plant_addr), ("EMBODIED_HEXAPOD_SERIAL_PORT", args.serial_port), ("EMBODIED_HEXAPOD_CALIBRATION", args.calibration),
                       ("EMBODIED_HEXAPOD_MJCF_FILE", args.mjcf), ("EMBODIED_HEXAPOD_TICK_HZ", args.tick_hz), ("EMBODIED_HEXAPOD_SPRING", args.spring)):
        if value is not None:
            env[key] = str(value)
    return env


def main() -> int:
    parser = argparse.ArgumentParser(description="the spider-18 controller node (fake | plant | serial)")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--backend", choices=("fake", "plant", "serial"))
    parser.add_argument("--node-id")
    parser.add_argument("--port", type=int)
    parser.add_argument("--api-url")
    parser.add_argument("--token-file")
    parser.add_argument("--endpoint")
    parser.add_argument("--plant-addr")
    parser.add_argument("--serial-port")
    parser.add_argument("--calibration")
    parser.add_argument("--mjcf")
    parser.add_argument("--tick-hz", type=float)
    parser.add_argument("--spring", choices=("0", "1"))
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    rail = start_hexapod_node(_env_from_args(args))
    if rail is None:
        _log("nothing to run: set --backend (or EMBODIED_HEXAPOD_BACKEND) and a device credential")
        return 2
    done = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: done.set())
    done.wait()
    rail.controller.close()
    rail.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
