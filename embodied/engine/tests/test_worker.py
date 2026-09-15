"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the plant against the shipped fixture (the
    |                                           | MJCF the TypeScript generator emits for the kitchen and the
    |                                           | printed drone): it rests on its pad plate, climbs to the mission
    |                                           | altitude and holds it under the gust model, tracks and settles on
    |                                           | a leg, senses the walls at the ranges the room dictates and the
    |                                           | floor under its nadir ranger, reports a real contact when flown
    |                                           | into the island and none while resting, and is deterministic for
    |                                           | a seed (two plants, one trajectory) with clone/restore exact.
2   | maintainer@emeraldcoastsystemsgroup.com   | A body resting off the voxel grid: the zenith ray's hit and origin carry
    |                                           | exactly the reported pose's x and y, so the sweep maps onto the belief.

"""
from __future__ import annotations

import json
import math
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from embodied_worker import Plant  # noqa: E402
import mujoco  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "recon-mini.xml")
HOME = (0.6, 0.6)
CRUISE = 2.075
SPEC = {
    "ring": {"azimuthCount": 450, "elevationsDeg": [0], "maxRange": 12},
    "zenith": {"rays": 8, "coneDeg": 10, "maxRange": 4},
    "depth": {"fx": 640 / (2 * math.tan(math.radians(35))), "fy": 480 / (2 * math.tan(math.radians(25))), "cx": 320, "cy": 240,
              "width": 640, "height": 480, "stride": 4, "maxRange": 4, "pitch": -math.pi / 2 + 1e-3},
    "nadir": {"maxRange": 8},
}


@pytest.fixture
def plant() -> Plant:
    with open(FIXTURE, encoding="utf-8") as fh:
        return Plant(fh.read(), seed=3)


def fly(plant: Plant, x: float, y: float, z: float, seconds: float, phase: str = "hover") -> dict:
    r = {}
    for _ in range(int(seconds / 0.05)):
        r = plant.step({"x": x, "y": y, "z": z, "yaw": 0.0}, phase, 0.05)
    return r


def test_rests_on_the_pad_plate(plant: Plant) -> None:
    r = plant.step({"x": HOME[0], "y": HOME[1], "z": 0.0, "yaw": 0.0}, "landed", 1.0)
    assert abs(r["z"] - plant.rest_z) < 0.002
    assert abs(plant.rest_z - 0.03) < 1e-6, "the printed drone's pad plate is 3 cm"
    assert r["contact"] is None, "resting on the floor is not a strike"
    assert r["settled"]
    assert all(m == 0 for m in r["motorsN"])


def test_climbs_to_the_mission_altitude_and_holds_it(plant: Plant) -> None:
    r = fly(plant, HOME[0], HOME[1], CRUISE, 8.0, "takeoff")
    assert abs(r["z"] - CRUISE) < 0.05 and abs(r["x"] - HOME[0]) < 0.06 and abs(r["y"] - HOME[1]) < 0.06, r
    assert r["tiltRad"] < math.radians(5)
    assert r["settled"]
    hover = plant.controller.mass * plant.controller.gravity / 4
    assert all(abs(m - hover) < 0.15 * hover for m in r["motorsN"]), "every motor near the hover thrust"
    worst = 0.0
    for _ in range(100):
        r = plant.step({"x": HOME[0], "y": HOME[1], "z": CRUISE, "yaw": 0.0}, "hover", 0.05)
        worst = max(worst, math.hypot(r["x"] - HOME[0], r["y"] - HOME[1], r["z"] - CRUISE))
    assert worst < 0.08, f"held within 8 cm under the gust model, worst {worst:.3f}"


def test_tracks_a_leg_and_reports_settled_only_when_there(plant: Plant) -> None:
    fly(plant, HOME[0], HOME[1], CRUISE, 6.0, "takeoff")
    x = HOME[0]
    lag = 0.0
    while x < 2.0:
        x = min(2.0, x + 0.05)
        r = plant.step({"x": x, "y": HOME[1], "z": CRUISE, "yaw": 0.0}, "moving", 0.05)
        lag = max(lag, x - r["x"])
    assert 0.02 < lag < 0.25, f"a 1 m/s ramp is tracked with a real but small lag (velocity feed-forward), {lag:.3f} m"
    assert not r["settled"], "the plant has not settled the moment the setpoint stops"
    r = fly(plant, 2.0, HOME[1], CRUISE, 3.0)
    assert r["settled"] and math.hypot(r["x"] - 2.0, r["y"] - HOME[1], r["z"] - CRUISE) < 0.05


def test_senses_the_room_from_the_pad_and_from_altitude(plant: Plant) -> None:
    plant.step({"x": HOME[0], "y": HOME[1], "z": 0.0, "yaw": 0.0}, "landed", 0.5)
    s = plant.sense(SPEC)
    ring = s["ring"]
    assert len(ring["t"]) == 450 and len(ring["misses"]) == 0
    names = {s["names"][g] for g in ring["geom"]}
    assert {"wall-west", "wall-south"} <= names
    # Azimuth pi (index 225) points at the west wall 0.6 m away; azimuth 3pi/2 (index 337) at the south wall.
    assert abs(ring["t"][225] - HOME[0]) < 0.002
    assert abs(ring["t"][337] - HOME[1]) < 0.01
    assert ring["n"][225 * 3: 225 * 3 + 3] == [1, 0, 0], "the west wall's outward normal points +x"
    assert abs(s["nadir"]["t"][0] - (plant.rest_z - 0.02)) < 0.002, "on the pad the nadir ranger reads the plate's worth of air"
    assert len(s["zenith"]["t"]) == 9 and abs(s["zenith"]["t"][0] - (2.3 - plant.rest_z)) < 0.002
    fly(plant, HOME[0], HOME[1], CRUISE, 6.0, "takeoff")
    s = plant.sense(SPEC)
    assert abs(s["nadir"]["t"][0] - (s["truth"]["z"] - 0.02)) < 0.002
    depth = s["depth"]
    assert len(depth["t"]) + len(depth["misses"]) // 3 == 160 * 120, "one ray per rendered pixel"
    assert all(n == 1 for n in depth["n"][2::3][:50]), "straight down over the floor every normal is +z"
    assert len(s["ring"]["t"]) == 450 and {s["names"][g] for g in s["ring"]["geom"]} <= {"wall-west", "wall-south", "wall-east", "wall-north"}, "at 2.075 m the ring sees walls only"


def test_a_flight_into_the_island_is_a_contact(plant: Plant) -> None:
    fly(plant, HOME[0], HOME[1], 0.5, 5.0, "takeoff")
    r = fly(plant, 2.4, 2.0, 0.5, 6.0, "moving")
    assert r["contact"] == "island"


def test_deterministic_for_a_seed_and_clone_exact() -> None:
    with open(FIXTURE, encoding="utf-8") as fh:
        xml = fh.read()
    a, b = Plant(xml, seed=11), Plant(xml, seed=11)
    ra = fly(a, HOME[0], HOME[1], CRUISE, 4.0, "takeoff")
    rb = fly(b, HOME[0], HOME[1], CRUISE, 4.0, "takeoff")
    assert json.dumps(ra) == json.dumps(rb)
    snap = a.snapshot()
    after = fly(a, 1.5, HOME[1], CRUISE, 2.0, "moving")
    a.restore(snap)
    again = fly(a, 1.5, HOME[1], CRUISE, 2.0, "moving")
    assert json.dumps(after) == json.dumps(again), "a restored plant replays the same flight"
    c = Plant(xml, seed=99)
    rc = fly(c, HOME[0], HOME[1], CRUISE, 4.0, "takeoff")
    assert json.dumps(rc) != json.dumps(ra), "a different seed is a different gust"


def test_rays_from_the_body_carry_the_reported_pose_exactly(plant: Plant) -> None:
    """A vehicle rests where its own estimate says -- off the grid. The sweep is expressed relative to the pose the frames
    report, so a ray cast from the body must map onto that pose to the last digit or its column lands beside the belief."""
    d = plant.data
    d.qpos[0:3] = [0.59121, 0.57155, plant.rest_z + 0.04172]
    d.qpos[3:7] = [1.0, 0.0, 0.0, 0.0]
    d.qvel[:] = 0.0
    mujoco.mj_forward(plant.model, d)
    s = plant.sense(SPEC)
    truth = s["truth"]
    zen = s["zenith"]
    assert zen["origin"][0] == truth["x"] and zen["origin"][1] == truth["y"], "the zenith ranger sits on the body's reference"
    assert zen["p"][0] == truth["x"] and zen["p"][1] == truth["y"], "the vertical ray's hit is exactly above the reported pose"
    assert abs(zen["p"][2] - 2.3) < 0.01, "and it is the ceiling"
