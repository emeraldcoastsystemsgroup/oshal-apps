"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the PX4 node without a flight stack (B6): the
    |                                           | frame mapping between PX4's local NED and the room, and the vehicle's
    |                                           | phase machine against a link double that moves a vehicle toward the
    |                                           | streamed setpoint at 1 m/s -- takeoff arms and engages OFFBOARD,
    |                                           | hover settles within the tolerance, landing sends LAND and settles
    |                                           | on the ground, a pose inside the island is a contact, sensing casts
    |                                           | the ring from the reported pose, clone is refused (one vehicle), a
    |                                           | second load while armed is refused, drop lands. The real stack is
    |                                           | proven in the sandbox recipe, not here.
2   | maintainer@emeraldcoastsystemsgroup.com   | The link over a real local UDP seam: a stand-in vehicle answers the
    |                                           | address it heard the node from (as PX4 does) -- the node hears it on
    |                                           | its one fixed-port socket, learns the target system, records the
    |                                           | COMMAND_ACK and the version.
3   | maintainer@emeraldcoastsystemsgroup.com   | The pad frame from the vehicle at rest: a vehicle facing north and
    |                                           | resting off its NED origin reports the pad at load, flies room +x
    |                                           | as north, and yaw 0 as its resting heading.
4   | maintainer@emeraldcoastsystemsgroup.com   | The setpoint on the wire commands yaw (type mask bit 10 clear) and position.
"""
from __future__ import annotations

import math
import os
import sys
import threading
import time

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
sys.path.insert(0, os.path.join(ENGINE, "container"))
from embodied_px4_node import PX4_MAIN_MODE_OFFBOARD, MAV_LANDED_STATE_IN_AIR, MAV_LANDED_STATE_ON_GROUND, MavLink, Px4Sessions, ned_from_room, room_from_ned, yaw_ned_from_room, yaw_room_from_ned  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "recon-mini.xml")
HOME = np.array([0.6, 0.6, 0.0])


class FakeLink:
    """A vehicle that obeys: arms on command, enters OFFBOARD when asked with a stream, flies toward the streamed setpoint at 1 m/s per advance, lands on LAND."""

    def __init__(self, addr: str = "fake") -> None:
        self.addr = addr
        self.lock = threading.Lock()
        self.position = np.zeros(3)  # NED
        self.velocity = np.zeros(3)
        self.yaw_ned = math.pi / 2.0  # facing east
        self.armed = False
        self.custom_mode = 0
        self.landed_state = MAV_LANDED_STATE_ON_GROUND
        self.autopilot_version = "1.16.0"
        self.vehicle_seen = 1.0
        self.sent: list[tuple] = []
        self.target_ned: np.ndarray | None = None
        self.landing = False

    def heartbeat(self) -> None:
        self.sent.append(("heartbeat",))

    def request_streams(self) -> None:
        self.sent.append(("streams",))

    def set_offboard(self) -> None:
        self.custom_mode = PX4_MAIN_MODE_OFFBOARD << 16
        self.sent.append(("offboard",))

    def arm(self, on: bool) -> None:
        self.armed = on
        self.sent.append(("arm", on))

    def land(self) -> None:
        self.landing = True
        self.custom_mode = 4 << 16
        self.sent.append(("land",))

    def setpoint(self, n: float, e: float, d: float, yaw_ned: float) -> None:
        self.target_ned = np.array([n, e, d])
        self.yaw_ned = yaw_ned
        self.sent.append(("setpoint", n, e, d))

    def close(self) -> None:
        pass

    def advance(self, dt: float) -> None:
        """The vehicle's own motion: toward the setpoint at 1 m/s while armed in OFFBOARD; straight down while landing."""
        with self.lock:
            if self.landing:
                self.position[2] = min(0.0, self.position[2] + 0.5 * dt)
                if self.position[2] >= -0.02:
                    self.position[2] = 0.0
                    self.landed_state = MAV_LANDED_STATE_ON_GROUND
                    self.armed = False
                    self.landing = False
                return
            if not self.armed or self.custom_mode >> 16 != PX4_MAIN_MODE_OFFBOARD or self.target_ned is None:
                return
            delta = self.target_ned - self.position
            dist = float(np.linalg.norm(delta))
            step = min(dist, 1.0 * dt)
            self.position = self.position + (delta / dist * step if dist > 1e-9 else 0.0)
            self.velocity = delta / dist * min(1.0, dist / dt) if dist > 1e-9 else np.zeros(3)
            self.landed_state = MAV_LANDED_STATE_IN_AIR if self.position[2] < -0.05 else MAV_LANDED_STATE_ON_GROUND


def test_frames_map_ned_to_the_room_and_back():
    home = np.array([0.6, 0.6, 0.0])
    p = room_from_ned(home, 2.0, 1.0, -1.5)
    assert np.allclose(p, [1.6, 2.6, 1.5]), "north is +y, east is +x, down is -z"
    assert np.allclose(ned_from_room(home, p), [2.0, 1.0, -1.5])
    assert abs(yaw_room_from_ned(0.0) - math.pi / 2) < 1e-9, "facing north is +90 deg in the room"
    assert abs(yaw_room_from_ned(math.pi / 2)) < 1e-9, "facing east is 0 in the room"
    for y in (-3.0, -1.0, 0.0, 0.7, 2.5):
        assert abs(math.atan2(math.sin(yaw_ned_from_room(yaw_room_from_ned(y)) - y), math.cos(yaw_ned_from_room(yaw_room_from_ned(y)) - y))) < 1e-9
    # A vehicle resting facing north (psi0 = 0) 0.1 m north of its NED origin, 5 cm up: the room's +x is north.
    p = room_from_ned(home, 1.1, 0.0, -0.55, 0.0, (0.1, 0.0, -0.05))
    assert np.allclose(p, [1.6, 0.6, 0.5]), "a metre north of the rest is a metre of room +x from the pad, half a metre up"
    assert np.allclose(ned_from_room(home, p, 0.0, (0.1, 0.0, -0.05)), [1.1, 0.0, -0.55])
    assert abs(yaw_room_from_ned(0.0, 0.0)) < 1e-9 and abs(yaw_room_from_ned(-math.pi / 2, 0.0) - math.pi / 2) < 1e-9, "turning left of the rest heading is +yaw in the room"


def _sessions() -> tuple[Px4Sessions, FakeLink]:
    fake = FakeLink()
    sessions = Px4Sessions("fake:0", lambda addr: fake)
    with open(FIXTURE, encoding="utf-8") as fh:
        mjcf = fh.read()
    r = sessions.handle({"op": "load", "session": "w1", "mjcf": mjcf})
    assert r["session"] == "w1" and r["controller"] == {"kind": "px4"}
    return sessions, fake


def test_takeoff_hover_and_landing_follow_the_flight_stack():
    sessions, fake = _sessions()
    vehicle = sessions.vehicle
    assert np.allclose(vehicle.home, HOME), "the pad is where the generated model rests"
    sp = {"x": 0.6, "y": 0.6, "z": 2.075, "yaw": 0.0}
    r = sessions.handle({"op": "step", "session": "w1", "setpoint": sp, "phase": "takeoff", "dt": 0.05})
    assert fake.armed and fake.custom_mode >> 16 == PX4_MAIN_MODE_OFFBOARD and ("offboard",) in fake.sent and ("arm", True) in fake.sent
    assert r["settled"] is False and r["controller"] == "px4" and abs(r["z"]) < 1e-6
    for _ in range(60):
        fake.advance(0.05)
    r = sessions.handle({"op": "step", "session": "w1", "setpoint": sp, "phase": "takeoff", "dt": 0.05})
    assert abs(r["z"] - 2.075) < 0.06 and r["settled"] is True, r
    assert abs(r["x"] - 0.6) < 1e-6 and abs(r["y"] - 0.6) < 1e-6 and abs(r["yaw"]) < 1e-6
    leg = {"x": 2.0, "y": 0.6, "z": 2.075, "yaw": 0.0}
    r = sessions.handle({"op": "step", "session": "w1", "setpoint": leg, "phase": "moving", "dt": 0.05})
    assert r["settled"] is False
    for _ in range(40):
        fake.advance(0.05)
    r = sessions.handle({"op": "step", "session": "w1", "setpoint": leg, "phase": "moving", "dt": 0.05})
    assert abs(r["x"] - 2.0) < 0.06 and r["settled"] is True and r["contact"] is None
    r = sessions.handle({"op": "step", "session": "w1", "setpoint": leg, "phase": "landing", "dt": 0.05})
    assert ("land",) in fake.sent and r["settled"] is False
    for _ in range(120):
        fake.advance(0.05)
    r = sessions.handle({"op": "step", "session": "w1", "setpoint": leg, "phase": "landing", "dt": 0.05})
    assert r["settled"] is True and r["landedState"] == MAV_LANDED_STATE_ON_GROUND and not fake.armed
    r = sessions.handle({"op": "step", "session": "w1", "setpoint": leg, "phase": "landed", "dt": 0.05})
    assert r["settled"] is True
    assert sessions.handle({"op": "status"})["engine"] == "px4-sih"


def test_contacts_and_sensing_come_from_the_scene_at_the_reported_pose():
    sessions, fake = _sessions()
    sp = {"x": 0.6, "y": 0.6, "z": 2.075, "yaw": 0.0}
    sessions.handle({"op": "step", "session": "w1", "setpoint": sp, "phase": "takeoff", "dt": 0.05})
    for _ in range(60):
        fake.advance(0.05)
    frames = sessions.handle({"op": "sense", "session": "w1", "spec": {"ring": {"azimuthCount": 450, "elevationsDeg": [0], "maxRange": 12}, "nadir": {"maxRange": 8}}})
    assert len(frames["ring"]["t"]) == 450 and abs(frames["nadir"]["t"][0] - 2.075) < 0.08, "the ring sees the walls, the nadir the floor, from where the vehicle says it is"
    # Report a pose inside the island: the hull overlaps it and the node says so; the flight stack itself would not know.
    with fake.lock:
        fake.position = np.array([2.4 - 0.6, 2.0 - 0.6, -0.6])  # NED: north = y - home, east = x - home, down = -z
    r = sessions.handle({"op": "step", "session": "w1", "setpoint": {"x": 2.0, "y": 2.4, "z": 0.6, "yaw": 0.0}, "phase": "moving", "dt": 0.05})
    assert r["contact"] == "island", r


def test_one_vehicle_only():
    sessions, fake = _sessions()
    with pytest.raises(ValueError, match="cannot_clone"):
        sessions.handle({"op": "clone", "session": "w2", "from": "w1"})
    sp = {"x": 0.6, "y": 0.6, "z": 2.075, "yaw": 0.0}
    sessions.handle({"op": "step", "session": "w1", "setpoint": sp, "phase": "takeoff", "dt": 0.05})
    with open(FIXTURE, encoding="utf-8") as fh:
        mjcf = fh.read()
    with pytest.raises(ValueError, match="cannot_load"):
        sessions.handle({"op": "load", "session": "w2", "mjcf": mjcf})
    with pytest.raises(KeyError):
        sessions.handle({"op": "step", "session": "w9", "setpoint": sp, "phase": "hover", "dt": 0.05})
    assert sessions.handle({"op": "drop", "session": "w1"}) == {"dropped": True}
    assert ("land",) in fake.sent and sessions.vehicle is None
    assert sessions.handle({"op": "load", "session": "w2", "mjcf": mjcf})["session"] == "w2", "after a drop the vehicle can take a new world"


def _free_port() -> int:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_link_hears_the_vehicle_on_its_fixed_port():
    """A stand-in vehicle bound like PX4's onboard link answers whoever spoke first, at the port it heard them from."""
    from pymavlink import mavutil
    vehicle_port, node_port = _free_port(), _free_port()
    vehicle = mavutil.mavlink_connection(f"udpin:127.0.0.1:{vehicle_port}", source_system=1, source_component=1)
    link = MavLink(f"127.0.0.1:{vehicle_port}", listen_port=node_port)
    try:
        assert link.conn.port.getsockname()[1] == node_port, "the node's one socket is bound to the fixed port"
        link.heartbeat()
        first = vehicle.recv_match(type="HEARTBEAT", blocking=True, timeout=5)
        assert first is not None and first.get_srcSystem() == 245
        partner = next(iter(vehicle.clients))
        assert partner[1] == node_port, "the vehicle learned the node's fixed port as its partner"
        vehicle.mav.heartbeat_send(2, 12, 128 | 1, PX4_MAIN_MODE_OFFBOARD << 16, 4)
        vehicle.mav.command_ack_send(400, 4)  # MAV_RESULT_FAILED for arm
        vehicle.mav.autopilot_version_send(0, (1 << 24) | (16 << 16), 0, 0, 0, bytes(8), bytes(8), bytes(8), 0, 0, 0, bytes(18))
        vehicle.mav.local_position_ned_send(0, 1.0, 2.0, -1.5, 0, 0, 0)
        deadline = time.time() + 5
        while time.time() < deadline and (link.position is None or link.last_ack is None or link.autopilot_version is None):
            time.sleep(0.05)
        assert link.armed and link.custom_mode >> 16 == PX4_MAIN_MODE_OFFBOARD and link.vehicle_seen is not None
        assert link.last_ack == (400, 4) and link.autopilot_version == "1.16.0"
        assert np.allclose(link.position, [1.0, 2.0, -1.5])
        assert link.conn.target_system == 1, "commands go to the system that heartbeats"
        link.setpoint(1.0, 2.0, -1.5, 0.3)
        sp = vehicle.recv_match(type="SET_POSITION_TARGET_LOCAL_NED", blocking=True, timeout=5)
        assert sp is not None and sp.coordinate_frame == 1 and abs(sp.x - 1.0) < 1e-6 and abs(sp.z + 1.5) < 1e-6 and abs(sp.yaw - 0.3) < 1e-6
        assert sp.type_mask & 0x400 == 0 and sp.type_mask & 0x800, "yaw is commanded, yaw rate is not; with yaw ignored the vehicle keeps its boot heading and every sweep lands rotated"
        assert sp.type_mask & 0b111 == 0 and sp.type_mask & 0b111000, "position used, velocity ignored"
    finally:
        link.close()
        vehicle.close()


def test_the_pad_frame_comes_from_the_vehicle_at_rest():
    fake = FakeLink()
    fake.yaw_ned = 0.0  # facing north, as a SIH vehicle boots
    fake.position = np.array([0.2, -0.3, -0.06])  # resting off its EKF origin, 6 cm "up"
    sessions = Px4Sessions("fake:0", lambda addr: fake)
    with open(FIXTURE, encoding="utf-8") as fh:
        sessions.handle({"op": "load", "session": "w1", "mjcf": fh.read()})
    v = sessions.vehicle
    assert abs(v.psi0) < 1e-9 and np.allclose(v.origin, [0.2, -0.3, -0.06])
    at_rest = sessions.handle({"op": "step", "session": "w1", "setpoint": {"x": 0.6, "y": 0.6, "z": 0.0, "yaw": 0.0}, "phase": "landed", "dt": 0.05})
    assert abs(at_rest["x"] - 0.6) < 1e-6 and abs(at_rest["y"] - 0.6) < 1e-6 and abs(at_rest["z"]) < 1e-6 and abs(at_rest["yaw"]) < 1e-6, "at load the vehicle IS the pad"
    leg = {"x": 1.6, "y": 0.6, "z": 1.0, "yaw": 0.0}
    sessions.handle({"op": "step", "session": "w1", "setpoint": leg, "phase": "takeoff", "dt": 0.05})
    assert np.allclose(fake.target_ned, [1.2, -0.3, -1.06]), "a metre of room +x is a metre north of the rest, a metre up"
    for _ in range(60):
        fake.advance(0.05)
    r = sessions.handle({"op": "step", "session": "w1", "setpoint": leg, "phase": "moving", "dt": 0.05})
    assert abs(r["x"] - 1.6) < 0.06 and abs(r["y"] - 0.6) < 0.06 and abs(r["z"] - 1.0) < 0.06 and r["settled"], r
