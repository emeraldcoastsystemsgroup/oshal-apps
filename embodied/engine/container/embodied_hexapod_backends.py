"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the three bodies behind the hexapod node
    |                                           | (ADR-202, lane L4), one interface: `fake` (a kinematic stand-in
    |                                           | that integrates the commanded velocity, slews the joints to their
    |                                           | targets, reports an inverted flag a test can set and a gravity
    |                                           | sign to match, and hops ballistically on jump); `plant` (dials
    |                                           | the package's JSON-lines engine bridge and speaks the brief's
    |                                           | hexapod.load / reset / step / jump / state protocol, every reply
    |                                           | unwrapped whether the plant answers flat or under `result`, every
    |                                           | refusal passed through with its code); `serial` (the Feetech bus
    |                                           | through hexapod_bus over any file-like port, the IMU a pluggable
    |                                           | callable, the latched-spring servo on the reserved id 19 wound
    |                                           | then tripped on jump). A body with no spring refuses jump with
    |                                           | `no_spring`, as the plant does. HARDWARE WAS NOT AVAILABLE: the
    |                                           | serial body is proven on a fake port only, and a serial body's
    |                                           | position is unknown (zeros, bodyPoseSource 'none'), its foot
    |                                           | contacts are the gait's plan, not a measurement.
2   | maintainer@emeraldcoastsystemsgroup.com   | B30 gate: the plant body may load `controller: policy:<file>` (the
    |                                           | plant refuses it by name unless certified) and then, while the node
    |                                           | walks, sends the body command instead of targets; the plant's own
    |                                           | certified policy makes the targets and the body reports them back.
    |                                           | The fake and serial bodies run the CPG only; `walking` is ignored.
"""
from __future__ import annotations

import json
import math
import os
import socket
import sys
import time

ENGINE_DIR = os.environ.get("EMBODIED_ENGINE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE_DIR)

from hexapod_bus import ADDR_PRESENT_LOAD, DEFAULT_SPEED_STEPS_PER_S, LATCH_SERVO_ID, SERVO_IDS, BusError, ServoBus, load_to_torque_nm, signed_load  # noqa: E402
from hexapod_spec import ACTUATOR_COUNT, ACTUATOR_ORDER, LEG_IDS, SPRING_STORED_J, STAND_HEIGHT_MM, clamp_targets  # noqa: E402

G_MPS2 = 9.81
PLANT_PROTOCOL = 1
PLANT_MAX_LINE = 64 * 1024 * 1024
HOP_HEIGHT_M = 0.19  # the brief's no-loss number for the latched spring (3.6 J on 1.9 kg); the fake hops exactly this, measuring nothing
FAKE_JOINT_RATE_RAD_S = 8.0
LATCH_REST_STEPS = 1024
LATCH_WOUND_STEPS = 3072
LATCH_TRIP_STEPS = 3584  # past the detent
LATCH_WIND_SPEED = 600  # steps/s: about 3.4 s for the wind, the brief's "2-3 s" order
LATCH_TRIP_SPEED = 3000
LATCH_WIND_S = 3.5
LATCH_TRIP_S = 0.4
_REFUSALS: dict[str, type] = {}


class PlantRefusal(Exception):
    """@description A refusal with a protocol code: the node's rail reports `error` as the class name, so each code is
    its own subclass (plant_refusal) and `no_spring` reaches the brain as `no_spring`."""

    code = "refused"


def plant_refusal(code: str, because: str) -> PlantRefusal:
    """@description The refusal exception for a code, its class named after the code. @param code The code. @param because Why. @returns The exception to raise."""
    cls = _REFUSALS.get(code)
    if cls is None:
        cls = type(code, (PlantRefusal,), {"code": code})
        _REFUSALS[code] = cls
    return cls(f"{code}: {because}")


def base_state(time_s: float = 0.0) -> dict:
    """@description The brief's state (section 3.2) with every key present and at rest. @param time_s The clock. @returns The dict."""
    return {"timeS": round(time_s, 4), "bodyPosM": [0.0, 0.0, STAND_HEIGHT_MM / 1000.0], "bodyQuatWXYZ": [1.0, 0.0, 0.0, 0.0], "bodyVelMps": [0.0, 0.0, 0.0],
            "gyroRadS": [0.0, 0.0, 0.0], "accelMps2": [0.0, 0.0, G_MPS2], "jointPosRad": [0.0] * ACTUATOR_COUNT, "jointVelRadS": [0.0] * ACTUATOR_COUNT,
            "jointTorqueNm": [0.0] * ACTUATOR_COUNT, "footContact": [True] * len(LEG_IDS), "inverted": False, "fell": False, "spring": None}


def _yaw_roll_quat(yaw: float, inverted: bool) -> list[float]:
    """@description A body quaternion (w, x, y, z) from a yaw and the roll-by-pi an inverted body carries."""
    cy, sy = math.cos(yaw / 2.0), math.sin(yaw / 2.0)
    if not inverted:
        return [cy, 0.0, 0.0, sy]
    # q = q_yaw * q_roll(pi); q_roll(pi) = (0, 1, 0, 0)
    return [0.0, cy, sy, 0.0]


class FakeBackend:
    """@description The kinematic stand-in: no physics, no container. The body moves at the commanded velocity, the
    joints slew to their targets, `inverted` is whatever a test sets (the gravity sign follows it unless a transient is
    injected), a jump is a ballistic hop of the brief's height."""

    name = "fake"

    def __init__(self, has_spring: bool = True, start: list[float] | None = None) -> None:
        self.has_spring = has_spring
        self.time = 0.0
        self.pos = [0.0, 0.0, STAND_HEIGHT_MM / 1000.0]
        self.rest_z = self.pos[2]
        self.yaw = 0.0
        self.vel = [0.0, 0.0, 0.0]
        self.yaw_rate = 0.0
        self.joints = list(start) if start else [0.0] * ACTUATOR_COUNT
        self.joint_vel = [0.0] * ACTUATOR_COUNT
        self.inverted = False
        self.fell = False
        self.relaxed = False
        self.accel_pulse: list[float] | None = None
        self.accel_pulse_ticks = 0
        self.hop_vz = 0.0
        self.jumps = 0
        self.stance = [True] * len(LEG_IDS)
        self.applied = 0

    def pulse_accel(self, accel: list[float], ticks: int) -> None:
        """@description Inject an accelerometer transient for `ticks` applies (a knock, a bounce). @param accel The reading. @param ticks How many ticks."""
        self.accel_pulse, self.accel_pulse_ticks = list(accel), int(ticks)

    def _accel(self) -> list[float]:
        if self.accel_pulse_ticks > 0 and self.accel_pulse is not None:
            self.accel_pulse_ticks -= 1
            return list(self.accel_pulse)
        return [0.0, 0.0, -G_MPS2 if self.inverted else G_MPS2]

    def apply(self, targets, dt: float, body_cmd=(0.0, 0.0, 0.0), stance=None, walking: bool = False) -> dict:
        """@description Slew the joints toward the targets and move the body by the command for dt. @returns The state."""
        targets = clamp_targets(targets)
        step = FAKE_JOINT_RATE_RAD_S * dt
        for i, t in enumerate(targets):
            delta = max(-step, min(step, t - self.joints[i]))
            self.joint_vel[i] = delta / dt if dt > 0 else 0.0
            self.joints[i] += delta
        vx, vy, wz = (0.0, 0.0, 0.0) if self.relaxed else (float(body_cmd[0]), float(body_cmd[1]), float(body_cmd[2]))
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        self.vel = [vx * c - vy * s, vx * s + vy * c, self.hop_vz]
        self.pos[0] += self.vel[0] * dt
        self.pos[1] += self.vel[1] * dt
        self.yaw_rate = wz
        self.yaw = math.atan2(math.sin(self.yaw + wz * dt), math.cos(self.yaw + wz * dt))
        if self.hop_vz != 0.0 or self.pos[2] > self.rest_z:
            self.pos[2] += self.hop_vz * dt - 0.5 * G_MPS2 * dt * dt  # exact for a constant acceleration: no Euler overshoot
            self.hop_vz -= G_MPS2 * dt
            if self.pos[2] <= self.rest_z:
                self.pos[2], self.hop_vz = self.rest_z, 0.0
        if stance is not None:
            self.stance = list(stance)
        self.time += dt
        self.applied += 1
        return self.state()

    def state(self) -> dict:
        st = base_state(self.time)
        airborne = self.pos[2] > self.rest_z + 1e-9
        st.update({"bodyPosM": [round(v, 6) for v in self.pos], "bodyQuatWXYZ": _yaw_roll_quat(self.yaw, self.inverted), "bodyVelMps": [round(v, 6) for v in self.vel],
                   "gyroRadS": [0.0, 0.0, self.yaw_rate], "accelMps2": self._accel(), "jointPosRad": list(self.joints), "jointVelRadS": list(self.joint_vel),
                   "footContact": [False] * len(LEG_IDS) if airborne else list(self.stance), "inverted": self.inverted, "fell": self.fell,
                   "spring": {"storedJ": SPRING_STORED_J, "latched": False} if self.has_spring else None})
        return st

    def jump(self) -> dict:
        """@description A ballistic hop of the brief's no-loss height, or the no_spring refusal. @returns The state."""
        if not self.has_spring:
            raise plant_refusal("no_spring", "this body has no latched spring (legs-hop only)")
        self.hop_vz = math.sqrt(2.0 * G_MPS2 * HOP_HEIGHT_M)
        self.jumps += 1
        return self.state()

    def reset(self, pose: str = "upright", seed: int = 0) -> dict:
        self.pos, self.vel, self.yaw, self.hop_vz = [0.0, 0.0, self.rest_z], [0.0, 0.0, 0.0], 0.0, 0.0
        self.inverted = pose == "inverted"
        self.fell = False
        return self.state()

    def lidar(self) -> dict | None:
        return None

    def relax(self) -> None:
        self.relaxed = True

    def engage(self) -> None:
        self.relaxed = False

    def close(self) -> None:
        return None


class PlantBackend:
    """@description The plant over the package's JSON-lines bridge: the hello line first (protocol checked), then one
    request line per call, each carrying BOTH `cmd` (the brief's key) and `op` (the bridge's dispatcher key) so either
    reading of the contract answers. A reply is taken flat or from `result`; a refusal raises PlantRefusal(code)."""

    name = "plant"

    def __init__(self, host: str, port: int, timeout_s: float = 15.0, connect=socket.create_connection) -> None:
        self.sock = connect((host, port), timeout=timeout_s)
        self.sock.settimeout(timeout_s)
        self.rfile = self.sock.makefile("rb")
        self.endpoint = f"{host}:{port}"
        self.hello = self._read_line()
        if self.hello.get("protocol") != PLANT_PROTOCOL:
            raise plant_refusal("protocol_mismatch", f"the plant speaks protocol {self.hello.get('protocol')!r}, this node {PLANT_PROTOCOL}")
        self.next_id = 1
        self.actuators: list[str] | None = None
        self.has_spring = False
        self.timestep_s: float | None = None
        self.last: dict | None = None
        self.loaded = False
        self.relaxed = False
        self.controller = "targets"
        self.last_targets: list[float] | None = None

    def _read_line(self) -> dict:
        line = self.rfile.readline(PLANT_MAX_LINE)
        if not line:
            raise plant_refusal("plant_closed", "the plant closed the connection")
        parsed = json.loads(line)
        if not isinstance(parsed, dict):
            raise plant_refusal("plant_protocol", "the plant sent a non-object line")
        return parsed

    def call(self, cmd: str, **args) -> dict:
        """@description One request, its reply unwrapped: the payload is `result` when the bridge wrapped it, else the
        reply itself; `ok: false` raises the plant's code with its `because` (or `reason`). @param cmd The command. @returns The payload."""
        rid = self.next_id
        self.next_id += 1
        self.sock.sendall((json.dumps({"id": rid, "cmd": cmd, "op": cmd, **args}) + "\n").encode("utf-8"))
        reply = self._read_line()
        if reply.get("id") not in (None, rid):
            raise plant_refusal("plant_protocol", f"the plant answered request {reply.get('id')!r} to request {rid}")
        if reply.get("ok") is False:
            code = str(reply.get("error") or "refused")
            raise plant_refusal(code, str(reply.get("because") or reply.get("reason") or code))
        payload = reply.get("result") if isinstance(reply.get("result"), dict) else reply
        return {k: v for k, v in payload.items() if k not in ("id", "ok")}

    def load(self, mjcf: str, seed: int = 1, controller: str | None = None) -> dict:
        """@description hexapod.load: the model's actuators must be the contract's order, or the node refuses to drive it.
        @param mjcf The spider's MJCF. @param seed The plant's seed. @param controller `policy:<file>` for a certified policy
        in the plant's report directory (the plant refuses an uncertified one by name), or None. @returns The load reply."""
        extra = {} if controller is None else {"controller": str(controller)}
        reply = self.call("hexapod.load", mjcf=mjcf, seed=int(seed), **extra)
        self.controller = str(reply.get("controller") or "targets")
        actuators = reply.get("actuators")
        if list(actuators or []) != list(ACTUATOR_ORDER):
            raise plant_refusal("actuator_order", f"the plant's actuators {actuators!r} are not ACTUATOR_ORDER")
        self.actuators = list(actuators)
        self.has_spring = bool(reply.get("hasSpring"))
        self.timestep_s = float(reply["timestepS"]) if reply.get("timestepS") is not None else None
        self.loaded = True
        return reply

    def _state(self, reply: dict) -> dict:
        st = base_state()
        st.update(reply)
        self.last = st
        return st

    def reset(self, pose: str = "upright", seed: int = 1) -> dict:
        return self._state(self.call("hexapod.reset", pose=pose, seed=int(seed)))

    def apply(self, targets, dt: float, body_cmd=(0.0, 0.0, 0.0), stance=None, walking: bool = False) -> dict:
        """@description hexapod.step with the clamped targets for dt -- or, walking on a plant that plays a certified policy,
        with the body command, the policy's targets coming back in `last_targets`. @returns The state after dt."""
        if not self.loaded:
            raise plant_refusal("not_loaded", "load the spider's MJCF first (EMBODIED_HEXAPOD_MJCF_FILE or the load command)")
        if walking and self.controller.startswith("policy:"):
            reply = self.call("hexapod.step", command={"vx": float(body_cmd[0]), "vy": float(body_cmd[1]), "yawRate": float(body_cmd[2])}, dtS=float(dt))
            sent = reply.pop("targetsRad", None)
            reply.pop("controller", None)
            self.last_targets = None if sent is None else [float(v) for v in sent]
            return self._state(reply)
        self.last_targets = None
        return self._state(self.call("hexapod.step", targetsRad=clamp_targets(targets), dtS=float(dt)))

    def state(self) -> dict:
        if not self.loaded:
            return base_state()
        return self._state(self.call("hexapod.state"))

    def jump(self) -> dict:
        """@description hexapod.jump; a `no_spring` refusal passes through untouched. @returns The state."""
        return self._state(self.call("hexapod.jump"))

    def lidar(self) -> dict | None:
        """@description The plant's LiDAR if its state carries one (`lidar: {anglesRad, rangesM}`); the brief's state has no such field, so this is None unless the plant lane adds it."""
        lidar = (self.last or {}).get("lidar")
        return lidar if isinstance(lidar, dict) and "anglesRad" in lidar and "rangesM" in lidar else None

    def relax(self) -> None:
        self.relaxed = True  # the plant has no torque switch: the node keeps sending the sit targets

    def engage(self) -> None:
        self.relaxed = False

    def close(self) -> None:
        try:
            self.rfile.close()
            self.sock.close()
        except OSError:
            pass


class SerialBackend:
    """@description The robot: eighteen bus servos through hexapod_bus, the orientation from a pluggable `imu` callable
    returning {accelMps2, gyroRadS, quatWXYZ} (a BNO055 reader on the Pi, a fake here; None = no IMU, the node then
    never decides inverted), the latch servo on id 19 for a spring body."""

    name = "serial"

    def __init__(self, bus: ServoBus, imu=None, has_spring: bool = False, sleep=time.sleep, speed_steps_per_s: int = DEFAULT_SPEED_STEPS_PER_S, read_loads: bool = True) -> None:
        self.bus = bus
        self.imu = imu
        self.has_spring = has_spring
        self.sleep = sleep
        self.speed = speed_steps_per_s
        self.read_loads = read_loads
        self.time = 0.0
        self.joints = [0.0] * ACTUATOR_COUNT
        self.joint_vel = [0.0] * ACTUATOR_COUNT
        self.loads = [0] * ACTUATOR_COUNT
        self.stance = [True] * len(LEG_IDS)
        self.relaxed = True
        self.read_errors = 0
        self.last_imu: dict | None = None
        self.jumps = 0

    def engage(self) -> None:
        self.bus.torque(SERVO_IDS, True)
        self.relaxed = False

    def relax(self) -> None:
        self.bus.torque(SERVO_IDS, False)
        self.relaxed = True

    def _read_back(self, dt: float) -> None:
        for i, sid in enumerate(SERVO_IDS):
            try:
                rad = self.bus.read_position_rad(sid)
                self.joint_vel[i] = (rad - self.joints[i]) / dt if dt > 0 else 0.0
                self.joints[i] = rad
                if self.read_loads:
                    self.loads[i] = self.bus.read_u16(sid, ADDR_PRESENT_LOAD)
            except BusError:
                self.read_errors += 1

    def apply(self, targets, dt: float, body_cmd=(0.0, 0.0, 0.0), stance=None, walking: bool = False) -> dict:
        """@description One sync write of all eighteen goals (unless relaxed), then the positions and loads read back. @returns The state."""
        if not self.relaxed:
            self.bus.sync_write_targets(targets, self.speed)
        self._read_back(dt)
        if stance is not None:
            self.stance = list(stance)
        self.time += dt
        return self.state()

    def state(self) -> dict:
        st = base_state(self.time)
        sample = self.imu() if self.imu is not None else None
        self.last_imu = sample if isinstance(sample, dict) else None
        st.update({"bodyPosM": [0.0, 0.0, 0.0], "bodyPoseSource": "none", "jointPosRad": list(self.joints), "jointVelRadS": list(self.joint_vel),
                   "jointTorqueNm": [load_to_torque_nm(raw) for raw in self.loads], "jointLoadRaw": [signed_load(raw) for raw in self.loads],
                   "footContact": list(self.stance), "footContactSource": "gait", "imu": self.last_imu is not None,
                   "spring": {"storedJ": SPRING_STORED_J, "latched": False} if self.has_spring else None})
        if self.last_imu is not None:
            st["accelMps2"] = [float(v) for v in self.last_imu.get("accelMps2", st["accelMps2"])]
            st["gyroRadS"] = [float(v) for v in self.last_imu.get("gyroRadS", st["gyroRadS"])]
            st["bodyQuatWXYZ"] = [float(v) for v in self.last_imu.get("quatWXYZ", st["bodyQuatWXYZ"])]
        return st

    def jump(self) -> dict:
        """@description Wind the cam on the latch servo, then push it past the detent to trip, then return it to rest.
        Blocks for the wind (the legs hold their last goals meanwhile). @returns The state."""
        if not self.has_spring:
            raise plant_refusal("no_spring", "this body has no latched spring (EMBODIED_HEXAPOD_SPRING=0)")
        self.bus.write_goal(LATCH_SERVO_ID, LATCH_WOUND_STEPS, LATCH_WIND_SPEED)
        self.sleep(LATCH_WIND_S)
        self.bus.write_goal(LATCH_SERVO_ID, LATCH_TRIP_STEPS, LATCH_TRIP_SPEED)
        self.sleep(LATCH_TRIP_S)
        self.bus.write_goal(LATCH_SERVO_ID, LATCH_REST_STEPS, LATCH_WIND_SPEED)
        self.jumps += 1
        return self.state()

    def reset(self, pose: str = "upright", seed: int = 0) -> dict:
        return self.state()

    def lidar(self) -> dict | None:
        return None  # the serial LiDAR reader (LD19 over its own UART) is not part of this lane

    def close(self) -> None:
        close = getattr(self.bus.port, "close", None)
        if callable(close):
            close()
