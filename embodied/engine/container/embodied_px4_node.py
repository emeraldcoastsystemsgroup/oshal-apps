"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the first real-node lane (BACKLOG B6, ADR-099):
    |                                           | a PX4 flight stack (the official SITL image, SIH physics) flown
    |                                           | over MAVLink as a `drone`-kind node on the swarm rail. The node
    |                                           | answers the same envelopes the plant does -- `load` takes the
    |                                           | scene (for sensing only), `step` streams the setpoint to PX4 in
    |                                           | OFFBOARD and reports the vehicle's own telemetry (never sleeping:
    |                                           | a real vehicle moves in wall time, the controller reads what it
    |                                           | does now), `sense` casts the MuJoCo rays from the reported pose,
    |                                           | `clone` is refused (one vehicle), `drop` lands. Phases map to
    |                                           | PX4: takeoff = offboard + arm + climb, landing = LAND, landed =
    |                                           | disarmed. A contact is the hull box overlapping a scene solid at
    |                                           | the reported pose. Frames: PX4 local NED at its boot position is
    |                                           | the pad; room x = east, y = north, z = up, yaw from +X.
2   | maintainer@emeraldcoastsystemsgroup.com   | One socket, one fixed port: PX4 learns its partner (address AND port)
    |                                           | from the first packet it hears and answers there for the rest of its
    |                                           | life, so the node sends and receives on a socket bound to
    |                                           | EMBODIED_PX4_LISTEN (14540) and a restarted node process keeps the
    |                                           | partner valid. COMMAND_ACK refusals and PX4's STATUSTEXT warnings are
    |                                           | logged (arming denials say why); a vehicle heard from never is
    |                                           | reported in the step (`telemetry`) and once in the log with the
    |                                           | remedy (recreate the vehicle beside the node). The link heartbeats
    |                                           | from the moment it exists (PX4 learns the node at boot, whichever
    |                                           | came up first) and resolves the vehicle's name again every ten beats.
3   | maintainer@emeraldcoastsystemsgroup.com   | The pad frame comes from the vehicle at rest: its NED position at load
    |                                           | is the pad and its heading is the room's +x (a SIH vehicle boots facing
    |                                           | north; the room's drone home faces +x), so belief and truth agree from
    |                                           | the first sweep. AUTOPILOT_VERSION via REQUEST_MESSAGE (520 is refused).
4   | maintainer@emeraldcoastsystemsgroup.com   | The setpoint's type mask leaves yaw in use (bit 10 clear): with yaw ignored
    |                                           | the vehicle kept its boot heading while the belief yawed toward each leg,
    |                                           | every sweep at altitude was placed 90 degrees off and the map filled with
    |                                           | phantom walls (found on PX4 SIH in the sandbox). The status names the session.
"""
from __future__ import annotations

import math
import os
import sys
import threading
import time
from typing import Any

import numpy as np

ENGINE_DIR = os.environ.get("EMBODIED_ENGINE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE_DIR)

import mujoco  # noqa: E402

from embodied_worker import PROTOCOL, Plant  # noqa: E402

DEFAULT_PX4_ADDR = "embodied-px4:14580"
DEFAULT_PX4_LISTEN = 14540
SETPOINT_HZ = 10.0
HEARTBEAT_HZ = 1.0
SILENT_HEARTBEATS = 5  # heartbeats sent before a vehicle never heard from is called out
REST_WAIT_S = 2.0  # how long a load waits for the vehicle's resting pose before assuming the default frame
SETTLE_M = 0.06
SETTLE_SPEED = 0.15
LAND_SETTLE_M = 0.10
PX4_MAIN_MODE_OFFBOARD = 6
MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1
MAV_LANDED_STATE_ON_GROUND = 1
MAV_LANDED_STATE_IN_AIR = 2
TYPE_MASK_POSITION = 0b0000_1011_1111_1000  # ignore velocity, acceleration, force and yaw rate: position AND yaw are used (bit 10 clear)


def _log(msg: str) -> None:
    sys.stderr.write(f"[embodied-px4-node] {msg}\n")
    sys.stderr.flush()


def room_from_ned(home: np.ndarray, n: float, e: float, d: float, psi0: float = math.pi / 2, origin=(0.0, 0.0, 0.0)) -> np.ndarray:
    """@description PX4 local NED -> room: the pad is `home`, the vehicle's resting heading `psi0` (NED yaw) is the room's +x,
    its resting position `origin` is the pad, and up is -down. The default psi0 keeps east = +x, north = +y."""
    n, e, d = n - origin[0], e - origin[1], d - origin[2]
    c, s_ = math.cos(psi0), math.sin(psi0)
    return home + np.array([n * c + e * s_, n * s_ - e * c, -d])


def ned_from_room(home: np.ndarray, p: np.ndarray, psi0: float = math.pi / 2, origin=(0.0, 0.0, 0.0)) -> tuple[float, float, float]:
    """@description Room -> PX4 local NED, the inverse of room_from_ned."""
    x, y, z = float(p[0] - home[0]), float(p[1] - home[1]), float(p[2] - home[2])
    c, s_ = math.cos(psi0), math.sin(psi0)
    return (x * c + y * s_ + origin[0], x * s_ - y * c + origin[1], -z + origin[2])


def _wrap(a: float) -> float:
    return math.atan2(math.sin(a), math.cos(a))


def yaw_room_from_ned(yaw_ned: float, psi0: float = math.pi / 2) -> float:
    """@description NED yaw (clockwise from north) -> room yaw (counter-clockwise from +x): the resting heading is 0."""
    return _wrap(psi0 - yaw_ned)


def yaw_ned_from_room(yaw_room: float, psi0: float = math.pi / 2) -> float:
    """@description Room yaw -> NED yaw, the inverse of yaw_room_from_ned (its own inverse)."""
    return _wrap(psi0 - yaw_room)


class MavLink:
    """@description The MAVLink side of the node: one pymavlink connection, our heartbeat, the latest telemetry, the commands.
    Everything a test double replaces lives here."""

    def __init__(self, addr: str, listen_port: int = DEFAULT_PX4_LISTEN) -> None:
        from pymavlink import mavutil  # imported only when a PX4 node runs: the plain plant needs no pymavlink
        self.mavutil = mavutil
        host, port = addr.rsplit(":", 1)
        # PX4 learns its partner -- address and port -- from the first packet it hears on a link and answers there from then
        # on. One socket does both directions, bound to a fixed port so a restarted node process is still that partner.
        self.conn = mavutil.mavlink_connection(f"udpout:{host}:{port}", source_system=245, source_component=191)
        self.conn.port.bind(("0.0.0.0", int(listen_port)))
        self.mav = self.conn.mav
        self.lock = threading.Lock()
        self.position: np.ndarray | None = None  # NED
        self.velocity: np.ndarray | None = None  # NED
        self.yaw_ned: float = 0.0
        self.armed = False
        self.custom_mode = 0
        self.landed_state: int | None = None
        self.autopilot_version: str | None = None
        self.vehicle_seen: float | None = None
        self.last_ack: tuple[int, int] | None = None  # (command, result) of the latest COMMAND_ACK
        self.stop = threading.Event()
        self.telemetry_count = 0
        self.host, self.port = host, int(port)
        self.reader = threading.Thread(target=self._read_loop, name="px4-read", daemon=True)
        self.reader.start()
        self.beater = threading.Thread(target=self._heartbeat_loop, name="px4-hb", daemon=True)
        self.beater.start()

    def _heartbeat_loop(self) -> None:
        """@description Our heartbeat from the moment the link exists, so the vehicle learns this node as its partner at boot,
        whichever came up first. Every tenth beat the vehicle's name is resolved again: a recreated vehicle container may
        carry a new address. A vehicle never heard from is called out once, with the remedy."""
        sent = 0
        while not self.stop.is_set():
            try:
                if sent % 10 == 0:
                    self.conn.resolved_destination_addr = None
                    self.conn.destination_addr = (self.host, self.port)
                self.heartbeat()
                sent += 1
            except Exception as error:  # a dropped link is reported by the step, not here
                _log(f"heartbeat send failed: {error}")
            if sent == SILENT_HEARTBEATS and self.vehicle_seen is None:
                _log(f"no telemetry after {sent} heartbeats: the vehicle answers the partner it learned first -- recreate it beside this node (install-engine.sh --with-px4 does)")
            self.stop.wait(1.0 / HEARTBEAT_HZ)

    def _read_loop(self) -> None:
        while not self.stop.is_set():
            try:
                msg = self.conn.recv_match(blocking=True, timeout=0.5)
            except Exception as error:  # a closed socket ends the loop; anything else is logged once per second at most
                if self.stop.is_set():
                    return
                _log(f"read failed: {error}")
                time.sleep(1.0)
                continue
            if msg is None:
                continue
            self.telemetry_count += 1
            if self.telemetry_count == 1:
                _log(f"first message from the vehicle: {msg.get_type()} (system {msg.get_srcSystem()})")
            t = msg.get_type()
            with self.lock:
                if t == "HEARTBEAT" and msg.get_srcSystem() != 245:
                    self.vehicle_seen = time.monotonic()
                    self.armed = bool(msg.base_mode & 128)
                    self.custom_mode = int(msg.custom_mode)
                elif t == "LOCAL_POSITION_NED":
                    self.position = np.array([msg.x, msg.y, msg.z], dtype=float)
                    self.velocity = np.array([msg.vx, msg.vy, msg.vz], dtype=float)
                elif t == "ATTITUDE":
                    self.yaw_ned = float(msg.yaw)
                elif t == "EXTENDED_SYS_STATE":
                    self.landed_state = int(msg.landed_state)
                elif t == "AUTOPILOT_VERSION":
                    v = int(msg.flight_sw_version)
                    self.autopilot_version = f"{(v >> 24) & 255}.{(v >> 16) & 255}.{(v >> 8) & 255}"
                elif t == "COMMAND_ACK":
                    self.last_ack = (int(msg.command), int(msg.result))
                    if msg.result != 0:
                        _log(f"command {msg.command} refused by the vehicle: MAV_RESULT {msg.result}")
                elif t == "STATUSTEXT" and int(msg.severity) <= 4:  # emergency .. warning: arming denials, failsafes, mode refusals
                    _log(f"vehicle says: {msg.text}")

    def heartbeat(self) -> None:
        self.mav.heartbeat_send(self.mavutil.mavlink.MAV_TYPE_ONBOARD_CONTROLLER, self.mavutil.mavlink.MAV_AUTOPILOT_INVALID, 0, 0, 0)

    def request_streams(self) -> None:
        """@description Ask for the messages the node reads, at the rates it needs (SET_MESSAGE_INTERVAL, microseconds)."""
        for msg_id, hz in ((32, 20.0), (30, 10.0), (245, 5.0)):  # LOCAL_POSITION_NED, ATTITUDE, EXTENDED_SYS_STATE
            self.command(511, msg_id, 1e6 / hz)
        self.command(512, 148)  # REQUEST_MESSAGE AUTOPILOT_VERSION (520 is refused as unsupported by recent PX4)

    def command(self, cmd: int, p1: float = 0, p2: float = 0, p3: float = 0, p4: float = 0, p5: float = 0, p6: float = 0, p7: float = 0) -> None:
        self.mav.command_long_send(self.conn.target_system or 1, self.conn.target_component or 1, cmd, 0, p1, p2, p3, p4, p5, p6, p7)

    def set_offboard(self) -> None:
        self.mav.set_mode_send(self.conn.target_system or 1, MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, PX4_MAIN_MODE_OFFBOARD << 16)

    def arm(self, on: bool) -> None:
        self.command(400, 1.0 if on else 0.0)

    def land(self) -> None:
        self.command(21)

    def setpoint(self, n: float, e: float, d: float, yaw_ned: float) -> None:
        self.mav.set_position_target_local_ned_send(0, self.conn.target_system or 1, self.conn.target_component or 1, self.mavutil.mavlink.MAV_FRAME_LOCAL_NED,
                                                    TYPE_MASK_POSITION, n, e, d, 0, 0, 0, 0, 0, 0, yaw_ned, 0)

    def close(self) -> None:
        self.stop.set()
        try:
            self.conn.close()
        except Exception:  # a closed link is closed
            pass


class Px4Vehicle:
    """@description One PX4 vehicle as the sim's drone: the scene for sensing and contacts, the link for flight."""

    def __init__(self, link: MavLink, mjcf: str, home: np.ndarray | None = None) -> None:
        self.link = link
        self.plant = Plant(mjcf, 0)  # kinematic use only: the body is placed at the reported pose for rays and contacts
        # The pad is where the generated model rests its body: PX4's local origin is the same spot on the floor.
        q = self.plant.data.qpos
        self.home = np.array(home if home is not None else [float(q[0]), float(q[1]), 0.0], dtype=float)
        # The vehicle at rest IS the pad: its resting NED position is the room origin and its heading the room's +x. Wait
        # briefly for telemetry; a vehicle never heard from keeps the default frame (east = +x) and says so.
        deadline = time.monotonic() + REST_WAIT_S
        while time.monotonic() < deadline and self.link.position is None:
            time.sleep(0.05)
        with self.link.lock:
            rest = self.link.position
            self.psi0 = float(self.link.yaw_ned) if rest is not None else math.pi / 2
            self.origin = tuple(float(v) for v in rest) if rest is not None else (0.0, 0.0, 0.0)
        if rest is None:
            _log("no position from the vehicle at load: the pad frame assumes east = +x and NED origin = pad")
        else:
            _log(f"vehicle at rest: NED ({self.origin[0]:.3f}, {self.origin[1]:.3f}, {self.origin[2]:.3f}) heading {math.degrees(self.psi0):.1f} deg = room +x from the pad ({self.home[0]:.2f}, {self.home[1]:.2f})")
        self.phase = "landed"
        self.setpoint_room: np.ndarray | None = None
        self.yaw_room = 0.0
        self.streaming = threading.Event()
        self.stop = threading.Event()
        self.last_contact: str | None = None
        self.steps = 0
        self.threads = [threading.Thread(target=self._stream_loop, name="px4-stream", daemon=True)]
        for t in self.threads:
            t.start()
        self.link.request_streams()

    # -- background ----------------------------------------------------------
    def _stream_loop(self) -> None:
        """@description OFFBOARD needs a setpoint stream before and while it is engaged: the current setpoint at SETPOINT_HZ."""
        while not self.stop.is_set():
            if self.streaming.is_set():
                self._send_setpoint()
            self.stop.wait(1.0 / SETPOINT_HZ)

    def _send_setpoint(self) -> None:
        if self.setpoint_room is None:
            return
        n, e, d = ned_from_room(self.home, self.setpoint_room, self.psi0, self.origin)
        try:
            self.link.setpoint(n, e, d, yaw_ned_from_room(self.yaw_room, self.psi0))
        except Exception as error:
            _log(f"setpoint send failed: {error}")

    # -- state ---------------------------------------------------------------
    def pose(self) -> dict:
        with self.link.lock:
            p = self.link.position
            v = self.link.velocity
            yaw_ned = self.link.yaw_ned
        if p is None:
            room = self.home.copy()
            speed = 0.0
        else:
            room = room_from_ned(self.home, p[0], p[1], p[2], self.psi0, self.origin)
            speed = float(np.linalg.norm(v)) if v is not None else 0.0
        return {"x": round(float(room[0]), 5), "y": round(float(room[1]), 5), "z": round(float(room[2]), 5), "yaw": round(yaw_room_from_ned(yaw_ned, self.psi0), 6),
                "tiltRad": 0.0, "speed": round(speed, 4)}

    def _place(self, pose: dict) -> None:
        d = self.plant.data
        d.qpos[0:3] = [pose["x"], pose["y"], pose["z"] + self.plant.rest_z]
        half = pose["yaw"] / 2.0
        d.qpos[3:7] = [math.cos(half), 0.0, 0.0, math.sin(half)]
        d.qvel[:] = 0.0
        mujoco.mj_forward(self.plant.model, d)

    def _contact(self, pose: dict) -> str | None:
        self._place(pose)
        hit = self.plant._scene_contact()
        if hit == "floor" and self.phase in ("landed", "takeoff", "landing"):
            return None
        return hit

    # -- the node's ops -------------------------------------------------------
    def step(self, setpoint: dict, phase: str, dt: float) -> dict:
        """@description Command the phase and the setpoint, then report what the vehicle does now: no sleeping, the vehicle moves in wall time."""
        self.steps += 1
        sp = np.array([setpoint["x"], setpoint["y"], setpoint["z"]], dtype=float)
        self.yaw_room = float(setpoint.get("yaw", 0.0))
        armed = self.link.armed
        if phase == "landed":
            self.streaming.clear()
            if armed:
                self.link.arm(False)
        elif phase in ("takeoff", "hover", "moving"):
            self.setpoint_room = sp
            self._send_setpoint()  # a changed setpoint goes out now; the stream keeps repeating it
            if not self.streaming.is_set():
                self.streaming.set()
                time.sleep(3.0 / SETPOINT_HZ)  # PX4 wants a few setpoints before it accepts OFFBOARD
            if self.link.custom_mode >> 16 != PX4_MAIN_MODE_OFFBOARD:
                self.link.set_offboard()
            if not armed:
                self.link.arm(True)
        elif phase == "landing":
            if self.phase != "landing":
                self.streaming.clear()
                self.link.land()
        self.phase = phase
        pose = self.pose()
        contact = self._contact(pose)
        self.last_contact = contact
        room = np.array([pose["x"], pose["y"], pose["z"]])
        if phase == "landing":
            landed = self.link.landed_state == MAV_LANDED_STATE_ON_GROUND or (pose["z"] < LAND_SETTLE_M and not self.link.armed)
            settled = bool(landed)
        elif phase == "landed":
            settled = not self.link.armed
        else:
            settled = bool(np.linalg.norm(room - sp) < SETTLE_M and pose["speed"] < SETTLE_SPEED)
        return {**pose, "contact": contact, "settled": settled, "motorsN": [], "time": round(time.monotonic(), 3), "controller": "px4",
                "armed": self.link.armed, "offboard": self.link.custom_mode >> 16 == PX4_MAIN_MODE_OFFBOARD, "landedState": self.link.landed_state,
                "telemetry": self.link.vehicle_seen is not None}

    def sense(self, spec: dict) -> dict:
        self._place(self.pose())
        return self.plant.sense(spec)

    def drop(self) -> None:
        self.stop.set()
        if self.link.armed:
            try:
                self.streaming.clear()
                self.link.land()
            except Exception:
                pass
        for t in self.threads:
            t.join(2)


class Px4Sessions:
    """@description The one vehicle behind the node: `load` binds a scene to it, `clone` is refused, one lock around every op."""

    def __init__(self, addr: str, link_factory=None) -> None:
        self.addr = addr
        self.link_factory = link_factory or MavLink
        self.link: Any = None
        self.vehicle: Px4Vehicle | None = None
        self.session: str | None = None
        self.lock = threading.Lock()
        self.plants: dict[str, Any] = {}  # the rail counts sessions here

    def connect(self) -> None:
        if self.link is None:
            self.link = self.link_factory(self.addr)

    def hello(self) -> dict:
        self.connect()
        return {"protocol": PROTOCOL, "engine": "px4-sih", "version": self.link.autopilot_version or "unknown", "buildHash": "px4"}

    def handle(self, req: dict) -> dict:
        op = req.get("op")
        with self.lock:
            self.connect()
            if op == "status":
                return {"sessions": 1 if self.vehicle else 0, "session": self.session, "vehicleSeen": self.link.vehicle_seen is not None, "armed": self.link.armed, **self.hello()}
            if op == "load":
                if self.vehicle is not None and self.link.armed:
                    raise ValueError("cannot_load: the vehicle is flying another world — land it first")
                if self.vehicle is not None:
                    self.vehicle.drop()
                self.vehicle = Px4Vehicle(self.link, str(req["mjcf"]), np.array(req["home"], dtype=float) if req.get("home") else None)
                self.session = str(req["session"])
                self.plants = {self.session: self.vehicle}
                return {"session": self.session, "bodies": 1, "geoms": int(self.vehicle.plant.model.ngeom), "actuators": 0, "timestep": 0.0,
                        "massKg": float(self.vehicle.plant.controller.mass), "restZ": 0.0, "controller": {"kind": "px4"}}
            if op == "clone":
                raise ValueError("cannot_clone: one vehicle, one body")
            if op == "drop":
                if self.vehicle is not None and str(req["session"]) == self.session:
                    self.vehicle.drop()
                    self.vehicle = None
                    self.session = None
                    self.plants = {}
                return {"dropped": True}
            if op == "reports":
                return {"dir": "", "reports": [], "policies": []}
            vehicle = self._vehicle(str(req.get("session")))
            if op == "step":
                return vehicle.step(req["setpoint"], str(req.get("phase", "hover")), float(req.get("dt", 0.05)))
            if op == "sense":
                return vehicle.sense(req.get("spec") or {})
            raise ValueError(f"unknown op {op!r}")

    def _vehicle(self, session: str) -> Px4Vehicle:
        if self.vehicle is None or session != self.session:
            raise KeyError(f"no session {session!r}: load it first")
        return self.vehicle


def start_px4_node(env: dict | None = None):
    """@description Join the rail as the PX4 vehicle when EMBODIED_PX4_ADDR is set: its own node id, endpoint and port beside
    the plant's. @returns The NodeRail, or None when no PX4 address is configured."""
    from embodied_engine_node import NodeRail, NodeServer, make_handler  # noqa: E402
    env = os.environ if env is None else env
    addr = (env.get("EMBODIED_PX4_ADDR") or "").strip()
    if not addr:
        return None
    secret = (env.get("SWARM_SERVICE_SECRET") or "").strip()
    if not secret:
        _log("PX4 node disabled: SWARM_SERVICE_SECRET is not set")
        return None
    sessions = Px4Sessions(addr, lambda a: MavLink(a, int(env.get("EMBODIED_PX4_LISTEN") or DEFAULT_PX4_LISTEN)))
    node_id = (env.get("EMBODIED_PX4_NODE_ID") or "embodied-px4").strip()
    host = (env.get("EMBODIED_NODE_HOST") or "0.0.0.0").strip()
    port = int(env.get("EMBODIED_PX4_NODE_PORT") or 7415)
    api_url = (env.get("OSHAL_API_URL") or "http://oshal-api:5000").strip()
    rail = NodeRail(sessions, sessions.hello, node_id, "drone", "", api_url, secret, (env.get("EMBODIED_NODE_OWNER_SUB") or "").strip() or None)
    server = NodeServer((host, port), make_handler(rail))
    bound = server.server_address[1]
    rail.endpoint_url = (env.get("EMBODIED_PX4_NODE_ENDPOINT") or f"http://embodied-engine:{bound}").rstrip("/")
    rail.server = server
    rail.threads = [threading.Thread(target=server.serve_forever, name="px4-node-http", daemon=True), threading.Thread(target=rail.heartbeat_loop, name="px4-node-heartbeat", daemon=True)]
    for t in rail.threads:
        t.start()
    _log(f"PX4 node up: {node_id} at {rail.endpoint_url}, vehicle at {addr}, heartbeating to {api_url}")
    return rail
