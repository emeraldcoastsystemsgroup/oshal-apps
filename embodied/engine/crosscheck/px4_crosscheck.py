"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the PX4 cross-check harness (BACKLOG B28): one
    |                                           | fixed, versioned manoeuvre (takeoff to 2 m, a 5 m leg north, a 90
    |                                           | degree yaw, a 10 s hover, LAND) flown in OFFBOARD through a PX4
    |                                           | flight stack, with LOCAL_POSITION_NED and ATTITUDE recorded on the
    |                                           | vehicle's own clock. The same harness flies both legs of the
    |                                           | comparison: `--backend sih` (PX4's SIH physics, the embodied PX4
    |                                           | node's vehicle) and `--backend external` (PX4 none_iris in lockstep
    |                                           | with an external simulator on TCP 4560, the PteroSim leg). The
    |                                           | vehicle is one declared file (f450-sih.params.json): its SIH values
    |                                           | are set by PARAM_SET on the SIH backend, its allocator geometry on
    |                                           | both, every value confirmed by the vehicle's PARAM_VALUE echo, and
    |                                           | the controller parameters read back from both stacks so the
    |                                           | divergence can refuse two runs flown by different controllers. The
    |                                           | MAVLink side is the node's own MavLink (one fixed-port socket,
    |                                           | heartbeat, telemetry reader), reused through pymavlink's message
    |                                           | hooks -- embodied_px4_node.py is not modified, so the engine build
    |                                           | hash does not move. A vehicle whose SYS_AUTOSTART is not the SITL
    |                                           | airframe the backend names is refused before anything is armed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import struct
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.dirname(HERE)
CONTAINER_DIR = os.path.join(ENGINE_DIR, "container")
DEFAULT_VEHICLE = os.path.join(HERE, "f450-sih.params.json")
TRAJECTORY_SCHEMA = "embodied.px4-crosscheck.trajectory/1"
VEHICLE_SCHEMA = "embodied.px4-crosscheck.vehicle/1"
BACKENDS = ("sih", "external")
OWN_SYSTEM = 245  # the node's MAVLink source system: our own messages are never telemetry
MAV_PARAM_TYPE_REAL32 = 9
INT_PARAM_TYPES = {1: ("<B", 1), 2: ("<b", 1), 3: ("<H", 2), 4: ("<h", 2), 5: ("<I", 4), 6: ("<i", 4)}  # PX4 encodes bytewise
PX4_MAIN_MODE_OFFBOARD = 6
MAV_LANDED_STATE_ON_GROUND = 1
MAV_CMD_SET_MESSAGE_INTERVAL = 511
MSG_LOCAL_POSITION_NED, MSG_ATTITUDE = 32, 30
TICK_S = 0.1  # the setpoint stream period: 10 Hz, as the node streams
TELEMETRY_HZ = 50.0
REST_WINDOW_S = 1.0
TIMEOUTS = {"vehicleS": 60.0, "paramS": 2.0, "paramTries": 3, "restS": 15.0, "engageS": 30.0,
            "segmentFactor": 4.0, "segmentSlackS": 20.0, "landS": 60.0}

# The manoeuvre, fixed and versioned: a change to any number here is a new manoeuvre (its hash moves and
# the divergence refuses to compare it with runs of the old one). Positions are metres about the rest
# pose in NED (up = -down); yaw is degrees about the rest heading, clockwise as NED yaw is.
MANOEUVRE = {
    "id": "takeoff-leg-yaw-hover-land",
    "version": 1,
    "frame": "NED about the rest pose; yaw about the rest heading",
    "segments": [
        {"name": "takeoff", "n": 0.0, "e": 0.0, "up": 2.0, "yawDeg": 0.0, "holdS": 8.0},
        {"name": "leg-north", "n": 5.0, "e": 0.0, "up": 2.0, "yawDeg": 0.0, "holdS": 8.0},
        {"name": "yaw-90", "n": 5.0, "e": 0.0, "up": 2.0, "yawDeg": 90.0, "holdS": 5.0},
        {"name": "hover", "n": 5.0, "e": 0.0, "up": 2.0, "yawDeg": 90.0, "holdS": 10.0},
    ],
    "land": {"command": "MAV_CMD_NAV_LAND"},
}


class CrossCheckError(RuntimeError):
    """@description A run that cannot go on, named: the message starts with a stable code."""


def _log(msg: str) -> None:
    sys.stderr.write(f"[px4-crosscheck] {msg}\n")
    sys.stderr.flush()


def canonical_sha256(value: Any) -> str:
    """@description sha256 of a value's canonical JSON (sorted keys, no whitespace), so a hash names content, not layout.
    @param value Any JSON value. @returns Hex digest."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def manoeuvre_sha256() -> str:
    """@description The manoeuvre's identity. @returns Hex digest of MANOEUVRE."""
    return canonical_sha256(MANOEUVRE)


def derive_vehicle(inputs: dict) -> dict:
    """@description The SIH values and the allocator geometry that follow from the declared F450 inputs: a symmetric
    X quad (arm = wheelbase / 2 at 45 degrees), four rotor units at the arm tips plus a uniform central box for the
    inertia, per-rotor thrust from the thrust-to-weight, per-rotor torque from the moment coefficient. Rounded to
    six decimals, as the file stores them. @param inputs The file's `inputs`. @returns {'sih': {...}, 'allocation': {...}}."""
    lever = inputs["diagonalWheelbaseM"] / 2.0 * math.sin(math.pi / 4.0)
    mass, rotor = inputs["takeoffMassKg"], inputs["rotorUnitMassKg"]
    body = mass - 4.0 * rotor
    a, b, c = inputs["bodyBoxM"]
    ixx = 4.0 * rotor * lever ** 2 + body / 12.0 * (b * b + c * c)
    iyy = 4.0 * rotor * lever ** 2 + body / 12.0 * (a * a + c * c)
    izz = 4.0 * rotor * 2.0 * lever ** 2 + body / 12.0 * (a * a + b * b)
    thrust = inputs["thrustToWeight"] * mass * inputs["gravityMps2"] / 4.0
    r6 = lambda v: round(v, 6)  # noqa: E731 -- the file's precision
    sih = {"SIH_MASS": r6(mass), "SIH_IXX": r6(ixx), "SIH_IYY": r6(iyy), "SIH_IZZ": r6(izz), "SIH_T_MAX": r6(thrust),
           "SIH_Q_MAX": r6(inputs["torqueToThrustM"] * thrust), "SIH_L_ROLL": r6(lever), "SIH_L_PITCH": r6(lever)}
    signs = ((1, 1), (-1, -1), (1, -1), (-1, 1))  # PX4 quad-X numbering: front right, rear left, front left, rear right
    allocation = {}
    for i, (sx, sy) in enumerate(signs):
        allocation[f"CA_ROTOR{i}_PX"] = r6(sx * lever)
        allocation[f"CA_ROTOR{i}_PY"] = r6(sy * lever)
    return {"sih": sih, "allocation": allocation}


def load_vehicle(path: str = DEFAULT_VEHICLE) -> dict:
    """@description Read the declared vehicle file and hash its content (line endings normalised: a Windows checkout
    and a Linux one are the same vehicle). @param path The file. @returns The parsed file plus 'file' and 'sha256'."""
    with open(path, "rb") as fh:
        raw = fh.read().replace(b"\r\n", b"\n")
    vehicle = json.loads(raw.decode("utf-8"))
    if vehicle.get("schema") != VEHICLE_SCHEMA:
        raise ValueError(f"vehicle file {path}: schema must be {VEHICLE_SCHEMA}")
    return {**vehicle, "file": os.path.basename(path), "sha256": hashlib.sha256(raw).hexdigest()}


def param_plan(vehicle: dict, backend: str) -> list[tuple[str, float]]:
    """@description The PARAM_SETs a backend gets from the vehicle file: the SIH physics only where SIH flies, the
    allocator geometry on both (the same controller must see the same vehicle). Only REAL32 values are set; an
    integer or a non-number is refused. @param vehicle Loaded file. @param backend sih | external.
    @returns [(name, value)] in a stable order."""
    if backend not in BACKENDS:
        raise ValueError(f"unknown backend {backend!r}: one of {', '.join(BACKENDS)}")
    groups = (["sih"] if backend == "sih" else []) + ["allocation"]
    plan = []
    for group in groups:
        for name, value in sorted((vehicle.get(group) or {}).items()):
            if not isinstance(value, float):
                raise ValueError(f"{group}.{name}: only REAL32 parameters are set, and {value!r} is not a float")
            plan.append((name, value))
    return plan


def decode_param(value: float, ptype: int) -> float | int:
    """@description A PARAM_VALUE's value as PX4 meant it: REAL32 as is, integer types from the float's bytes.
    @param value param_value. @param ptype param_type. @returns The number."""
    if ptype in INT_PARAM_TYPES:
        fmt, size = INT_PARAM_TYPES[ptype]
        return struct.unpack(fmt, struct.pack("<f", value)[:size])[0]
    return float(value)


def _param_name(raw: Any) -> str:
    if isinstance(raw, bytes):
        raw = raw.decode("ascii", "replace")
    return str(raw).rstrip("\x00")


class Recorder:
    """@description Everything the vehicle says, on the vehicle's clock: position, attitude, parameter values and
    warnings. Fed by a pymavlink message hook (or a test double) from the link's reader thread."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.samples: list[dict] = []
        self.attitude: list[dict] = []
        self.params: dict[str, float | int] = {}
        self.statustext: list[dict] = []
        self.latest_ms: int | None = None

    def on_message(self, msg: Any) -> None:
        """@description Record one message; our own and non-increasing samples are dropped. @param msg A MAVLink message."""
        if msg.get_srcSystem() == OWN_SYSTEM:
            return
        kind = msg.get_type()
        with self.lock:
            if kind == "LOCAL_POSITION_NED":
                self._position(msg)
            elif kind == "ATTITUDE":
                self._attitude(msg)
            elif kind == "PARAM_VALUE":
                self.params[_param_name(msg.param_id)] = decode_param(msg.param_value, int(msg.param_type))
            elif kind == "STATUSTEXT":
                self.statustext.append({"t": self.vehicle_time_locked(), "severity": int(msg.severity), "text": _param_name(msg.text)})

    def _position(self, msg: Any) -> None:
        t = int(msg.time_boot_ms) / 1000.0
        if self.samples and t <= self.samples[-1]["t"]:
            return
        self.samples.append({"t": t, "n": float(msg.x), "e": float(msg.y), "d": float(msg.z),
                             "vn": float(msg.vx), "ve": float(msg.vy), "vd": float(msg.vz)})
        self.latest_ms = max(self.latest_ms or 0, int(msg.time_boot_ms))

    def _attitude(self, msg: Any) -> None:
        t = int(msg.time_boot_ms) / 1000.0
        if self.attitude and t <= self.attitude[-1]["t"]:
            return
        self.attitude.append({"t": t, "roll": float(msg.roll), "pitch": float(msg.pitch), "yaw": float(msg.yaw)})
        self.latest_ms = max(self.latest_ms or 0, int(msg.time_boot_ms))

    def vehicle_time_locked(self) -> float | None:
        return None if self.latest_ms is None else self.latest_ms / 1000.0

    def vehicle_time(self) -> float | None:
        """@description The vehicle's clock (time since its boot, the simulator's time in lockstep). @returns Seconds or None."""
        with self.lock:
            return self.vehicle_time_locked()

    def forget(self, name: str) -> None:
        """@description Drop a parameter's recorded value so only a fresh PARAM_VALUE confirms it. @param name Parameter."""
        with self.lock:
            self.params.pop(name, None)

    def param(self, name: str) -> float | int | None:
        """@description The last value the vehicle reported for a parameter. @param name Parameter. @returns Value or None."""
        with self.lock:
            return self.params.get(name)


class CrossCheckRun:
    """@description One flight of the manoeuvre on one backend. `link` is the node's MavLink with param_set,
    param_request and attach (open_px4_link), or a test double with the same surface; `wait` and `wall` are the
    clock, injectable so a double can run the whole flight in simulated time."""

    def __init__(self, link: Any, recorder: Recorder, vehicle: dict, backend: str, simulator: str,
                 wait: Callable[[float], None] = time.sleep, wall: Callable[[], float] = time.monotonic, timeouts: dict | None = None) -> None:
        self.link, self.rec, self.vehicle, self.backend, self.simulator = link, recorder, vehicle, backend, simulator
        self.wait, self.wall = wait, wall
        self.timeouts = {**TIMEOUTS, **(timeouts or {})}
        self.plan = param_plan(vehicle, backend)
        self.events: list[dict] = []
        self.applied: dict[str, float] = {}
        self.controller: dict[str, float | int] = {}
        self.sih_unset: dict[str, float | int] = {}
        self.rest: dict | None = None
        self.autostart: int | None = None
        link.attach(recorder.on_message)

    # -- the flight --------------------------------------------------------------------------------------------
    def run(self) -> dict:
        """@description Fly the whole manoeuvre and return the trajectory document; a failure is recorded in it
        (complete false, the error's code) and a vehicle left armed is sent LAND. @returns The trajectory."""
        started = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        error = None
        try:
            self._wait_for(lambda: self.link.vehicle_seen is not None, self.timeouts["vehicleS"], "no_vehicle: no heartbeat from the flight stack")
            self._check_sitl()
            self._apply_parameters()
            self._read_back()
            self._request_telemetry()
            self._capture_rest()
            self._engage()
            for segment in MANOEUVRE["segments"]:
                self._fly(segment)
            self._land()
        except CrossCheckError as failure:
            error = str(failure)
            _log(f"run stopped: {error}")
            if self.link.armed:
                self.link.land()
                self._event("abort-land")
        return self._document(started, error)

    def _event(self, event: str, **extra: Any) -> None:
        self.events.append({"t": self.rec.vehicle_time(), "event": event, **extra})

    def _wait_for(self, done: Callable[[], bool], timeout_s: float, failure: str, step_s: float = 0.02) -> None:
        deadline = self.wall() + timeout_s
        while not done():
            if self.wall() >= deadline:
                raise CrossCheckError(failure)
            self.wait(step_s)

    def _check_sitl(self) -> None:
        """@description Refuse anything that is not the SITL airframe this backend names, before a single PARAM_SET."""
        expected = int(self.vehicle["sitlAirframes"][self.backend])
        values = self._read_params(["SYS_AUTOSTART"])
        self.autostart = int(values["SYS_AUTOSTART"])
        if self.autostart != expected:
            raise CrossCheckError(f"not_a_sitl_vehicle: SYS_AUTOSTART {self.autostart} is not the {self.backend} SITL airframe {expected}")

    def _apply_parameters(self) -> None:
        for name, value in self.plan:
            for attempt in range(int(self.timeouts["paramTries"])):
                self.rec.forget(name)
                self.link.param_set(name, value)
                try:
                    self._wait_for(lambda: self.rec.param(name) is not None, self.timeouts["paramS"], "")
                except CrossCheckError:
                    continue
                if math.isclose(float(self.rec.param(name)), value, rel_tol=1e-6, abs_tol=1e-7):
                    self.applied[name] = float(self.rec.param(name))
                    break
            else:
                raise CrossCheckError(f"param_not_confirmed: {name} was never echoed back as {value}")
        _log(f"{len(self.applied)} vehicle parameters set and confirmed on the {self.backend} backend")

    def _read_params(self, names: list[str]) -> dict:
        missing = list(names)
        for _attempt in range(int(self.timeouts["paramTries"])):
            for name in missing:
                self.rec.forget(name)
                self.link.param_request(name)
            try:
                self._wait_for(lambda: all(self.rec.param(n) is not None for n in missing), self.timeouts["paramS"], "")
            except CrossCheckError:
                pass
            missing = [n for n in missing if self.rec.param(n) is None]
            if not missing:
                return {n: self.rec.param(n) for n in names}
        raise CrossCheckError(f"param_not_answered: {', '.join(missing)}")

    def _read_back(self) -> None:
        self.controller = self._read_params(list(self.vehicle["readBack"]["controller"]))
        if self.backend == "sih":
            self.sih_unset = self._read_params(list(self.vehicle["readBack"]["sihUnset"]))

    def _request_telemetry(self) -> None:
        self.link.request_streams()
        for msg_id in (MSG_LOCAL_POSITION_NED, MSG_ATTITUDE):
            self.link.command(MAV_CMD_SET_MESSAGE_INTERVAL, msg_id, 1e6 / TELEMETRY_HZ)
        self._wait_for(lambda: bool(self.rec.samples) and bool(self.rec.attitude), self.timeouts["restS"], "no_telemetry: no LOCAL_POSITION_NED/ATTITUDE")

    def _capture_rest(self) -> None:
        """@description The rest pose: the mean position and the circular-mean heading over the last second at rest."""
        first = self.rec.vehicle_time()
        self._wait_for(lambda: self.rec.vehicle_time() - first >= REST_WINDOW_S, self.timeouts["restS"], "no_rest: the vehicle clock did not advance")
        now = self.rec.vehicle_time()
        with self.rec.lock:
            pos = [s for s in self.rec.samples if s["t"] >= now - REST_WINDOW_S]
            att = [s for s in self.rec.attitude if s["t"] >= now - REST_WINDOW_S]
        mean = lambda key: sum(s[key] for s in pos) / len(pos)  # noqa: E731
        yaw = math.atan2(sum(math.sin(s["yaw"]) for s in att), sum(math.cos(s["yaw"]) for s in att))
        self.rest = {"n": mean("n"), "e": mean("e"), "d": mean("d"), "yaw": yaw}
        _log(f"rest pose NED ({self.rest['n']:.3f}, {self.rest['e']:.3f}, {self.rest['d']:.3f}) heading {math.degrees(yaw):.1f} deg")

    def _setpoint(self, segment: dict) -> tuple[float, float, float, float]:
        r = self.rest
        return (r["n"] + segment["n"], r["e"] + segment["e"], r["d"] - segment["up"], r["yaw"] + math.radians(segment["yawDeg"]))

    def _offboard(self) -> bool:
        return self.link.custom_mode >> 16 == PX4_MAIN_MODE_OFFBOARD

    def _engage(self) -> None:
        """@description Stream the rest setpoint, then OFFBOARD and arm (asked again each second) until both hold."""
        ground = self._setpoint({"n": 0.0, "e": 0.0, "up": 0.0, "yawDeg": 0.0})
        for _ in range(int(round(1.0 / TICK_S))):  # PX4 wants a setpoint stream before it accepts OFFBOARD
            self.link.setpoint(*ground)
            self.wait(TICK_S)
        deadline, ticks = self.wall() + self.timeouts["engageS"], 0
        while not (self._offboard() and self.link.armed):
            if self.wall() >= deadline:
                raise CrossCheckError(f"engage_timeout: offboard={self._offboard()} armed={self.link.armed}")
            if ticks % int(round(1.0 / TICK_S)) == 0:
                if not self._offboard():
                    self.link.set_offboard()
                if not self.link.armed:
                    self.link.arm(True)
            self.link.setpoint(*ground)
            self.wait(TICK_S)
            ticks += 1
        self._event("offboard-armed")

    def _fly(self, segment: dict) -> None:
        """@description Hold one segment's setpoint for its duration ON THE VEHICLE'S CLOCK: a lockstep simulator slower
        than real time gets the same simulated seconds, not the same wall seconds."""
        target = self._setpoint(segment)
        self._event("segment", name=segment["name"])
        start = self.rec.vehicle_time()
        deadline = self.wall() + segment["holdS"] * self.timeouts["segmentFactor"] + self.timeouts["segmentSlackS"]
        while self.rec.vehicle_time() - start < segment["holdS"]:
            if not self.link.armed:
                raise CrossCheckError(f"disarmed_in_flight: during {segment['name']}")
            if not self._offboard():
                raise CrossCheckError(f"left_offboard: during {segment['name']}")
            if self.wall() >= deadline:
                raise CrossCheckError(f"segment_timeout: {segment['name']} (the vehicle clock stalled)")
            self.link.setpoint(*target)
            self.wait(TICK_S)

    def _land(self) -> None:
        self._event("land")
        self.link.land()
        self._wait_for(lambda: self.link.landed_state == MAV_LANDED_STATE_ON_GROUND and not self.link.armed, self.timeouts["landS"],
                       "land_timeout: the vehicle did not report landed and disarmed", step_s=TICK_S)
        self._event("landed")

    def _document(self, started: str, error: str | None) -> dict:
        with self.rec.lock:
            samples, attitude, statustext = list(self.rec.samples), list(self.rec.attitude), list(self.rec.statustext)
        vehicle = {"vehicle": self.vehicle.get("vehicle"), "revision": self.vehicle.get("revision"), "file": self.vehicle.get("file"),
                   "sha256": self.vehicle.get("sha256"), "applied": self.applied,
                   "confirmed": len(self.applied) == len(self.plan) and bool(self.plan), "sihUnset": self.sih_unset}
        return {"schema": TRAJECTORY_SCHEMA, "simulator": self.simulator, "backend": self.backend, "complete": error is None,
                "error": error, "startedAtUtc": started, "manoeuvre": {**MANOEUVRE, "sha256": manoeuvre_sha256()},
                "vehicle": vehicle, "controller": self.controller,
                "px4": {"version": getattr(self.link, "autopilot_version", None), "sysAutostart": self.autostart},
                "rest": self.rest, "events": self.events, "samples": samples, "attitude": attitude, "statustext": statustext}


def open_px4_link(addr: str, listen_port: int) -> Any:
    """@description The node's own MavLink -- one socket bound to a fixed port, our heartbeat, the telemetry reader --
    given the two parameter calls and the message tap the cross-check needs. Imported here rather than at module
    load: the node module imports MuJoCo for sensing, which the harness logic and its tests never need.
    @param addr PX4's offboard address host:port. @param listen_port Our fixed port. @returns The link."""
    sys.path.insert(0, ENGINE_DIR)
    sys.path.insert(0, CONTAINER_DIR)
    from embodied_px4_node import MavLink  # noqa: E402 -- reused as shipped

    class CrossCheckLink(MavLink):
        # Addressed as the node addresses its commands: PX4 drops a PARAM_SET or PARAM_REQUEST_READ whose target is not
        # its own system, and pymavlink's target stays 0 until it has decided which heartbeat is the vehicle's.
        def param_set(self, name: str, value: float) -> None:
            self.mav.param_set_send(self.conn.target_system or 1, self.conn.target_component or 1, name.encode("ascii"), float(value), MAV_PARAM_TYPE_REAL32)

        def param_request(self, name: str) -> None:
            self.mav.param_request_read_send(self.conn.target_system or 1, self.conn.target_component or 1, name.encode("ascii"), -1)

        def attach(self, hook: Callable[[Any], None]) -> None:
            self.conn.message_hooks.append(lambda _conn, msg: hook(msg))

    return CrossCheckLink(addr, listen_port)


def main(argv: list[str] | None = None) -> int:
    """@description CLI: fly the manoeuvre once and write the trajectory. @param argv Arguments.
    @returns 0 when the run completed, 1 when it stopped (the file still records how far it got)."""
    parser = argparse.ArgumentParser(description="Fly the PX4 cross-check manoeuvre and record the trajectory.")
    parser.add_argument("--backend", choices=BACKENDS, required=True)
    parser.add_argument("--simulator", help="label for this leg, e.g. px4-sih or pterosim-f450")
    parser.add_argument("--px4", default=os.environ.get("EMBODIED_PX4_ADDR") or "embodied-px4:14580", help="PX4's offboard MAVLink address")
    parser.add_argument("--listen", type=int, default=int(os.environ.get("EMBODIED_PX4_LISTEN") or 14540), help="our fixed MAVLink port")
    parser.add_argument("--vehicle", default=DEFAULT_VEHICLE)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    vehicle = load_vehicle(args.vehicle)
    link = open_px4_link(args.px4, args.listen)
    try:
        document = CrossCheckRun(link, Recorder(), vehicle, args.backend, args.simulator or f"px4-{args.backend}").run()
    finally:
        link.close()
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(document, fh, indent=1)
        fh.write("\n")
    summary = {k: document[k] for k in ("simulator", "backend", "complete", "error")}
    summary.update({"samples": len(document["samples"]), "px4": document["px4"], "vehicleSha256": document["vehicle"]["sha256"],
                    "manoeuvreSha256": document["manoeuvre"]["sha256"]})
    sys.stdout.write(json.dumps(summary, sort_keys=True) + "\n")
    return 0 if document["complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
