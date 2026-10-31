"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant -- the plant generated from a design, on the
    |                                           | REAL MuJoCo (runs itself, no pytest): the lift's three parts carry
    |                                           | the spec's masses and the base's subtree mass is their sum plus the
    |                                           | payload; a fixed, a slide and a hinge joint are what the spec
    |                                           | declares; every actuator's force limit is stall x ratio, its
    |                                           | damping the torque-speed line and its continuous rating the row's;
    |                                           | the payload rides its part; an STL becomes a mesh geom; the base's
    |                                           | IMU reads g at rest; the sensors are in the state dict; inverse
    |                                           | kinematics is exact on one slide and on one hinge, converges on two
    |                                           | hinges, and the gravity sag is load over kp; a cycle, a part hung
    |                                           | from two joints, a loose part, an unknown part, a continuous
    |                                           | rating above the stall and a spec without the medium's gravity are
    |                                           | refused by name; the spec digest ignores mesh bytes; the bridge's
    |                                           | dispatch keeps sessions and refuses an unknown command.
"""
from __future__ import annotations

import copy
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
sys.path.insert(0, os.path.join(ENGINE, "container"))

import mujoco  # noqa: E402
import numpy as np  # noqa: E402

from embodied_hexapod import HexapodRefused  # noqa: E402
from embodied_plant import ARMATURE_AT_OUTPUT, SATURATION_ERROR, PlantSession, plant_mjcf, plant_op, spec_sha256, validate_spec  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "lift-1-spec.json")
MEASURED: dict = {}


def lift() -> dict:
    """The lift's spec fixture: three parts, a fixed column, a sliding carriage driven by the servo row through a stated ratio, a 2 kg payload."""
    with open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)


def refused(fn, code: str) -> HexapodRefused:
    try:
        fn()
    except HexapodRefused as error:
        assert type(error).__name__ == code, (type(error).__name__, str(error))
        return error
    raise AssertionError(f"expected the refusal {code}")


def box_stl(sx: float, sy: float, sz: float) -> bytes:
    """A closed binary STL box of the given size in METRES, seated on z = 0 and centred in x, y (CAD Studio's frame)."""
    x0, x1, y0, y1, z0, z1 = -sx / 2, sx / 2, -sy / 2, sy / 2, 0.0, sz
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    out = bytearray(b"\0" * 80 + struct.pack("<I", len(faces)))
    for a, b, c in faces:
        out += struct.pack("<3f", 0, 0, 0) + b"".join(struct.pack("<3f", *v[i]) for i in (a, b, c)) + b"\0\0"
    return bytes(out)


def test_the_parts_carry_the_specs_masses_and_the_joints_are_what_the_spec_declares() -> None:
    spec = lift()
    p = PlantSession(spec, 0)
    m = p.model
    for part in spec["parts"]:
        assert abs(float(m.body_mass[m.body(part["id"]).id]) - part["massKg"]) < 1e-9, part["id"]
    total = sum(x["massKg"] for x in spec["parts"]) + spec["payload"]["massKg"]
    assert abs(p.info()["massKg"] - total) < 1e-6, "the base's subtree mass is every part plus the payload"
    assert m.njnt == 1 and m.jnt_type[0] == mujoco.mjtJoint.mjJNT_SLIDE, "the fixed column adds no joint; the carriage slides"
    assert list(m.jnt_range[0]) == spec["joints"][1]["range"]
    assert m.body("column").parentid == m.body("base").id and m.body("carriage").parentid == m.body("column").id
    assert list(m.body_pos[m.body("column").id]) == spec["joints"][0]["originM"], "the child body sits at the joint's origin in the parent's frame"
    assert float(m.body_pos[m.body("payload").id][2]) == spec["parts"][2]["extentsM"][2], "the payload sits on top of its part by default"
    assert abs(float(m.body_mass[m.body("payload").id]) - spec["payload"]["massKg"]) < 1e-9
    assert list(m.opt.gravity) == spec["medium"]["gravityMps2"] and float(m.opt.timestep) == 0.002
    assert m.body("base").id == 1 and m.body_jntnum[1] == 0, "the base is ground: a static body"
    info = p.info()
    assert [j["type"] for j in info["joints"]] == ["fixed", "slide"] and info["parts"][0]["mesh"] is False and info["payload"]["restPosM"][2] > 0


def test_every_actuator_is_limited_by_the_rows_numbers_through_the_stated_ratio() -> None:
    spec = lift()
    p = PlantSession(spec, 0)
    a = p.info()["actuators"][0]
    row = spec["actuators"][0]
    assert a["forceLimit"] == row["stallNm"] * row["gearRatio"] and a["unit"] == "N"
    assert abs(a["noLoadSpeed"] - row["noLoadRadS"] / row["gearRatio"]) < 1e-12 and a["speedUnit"] == "m/s"
    assert abs(a["kp"] - a["forceLimit"] / SATURATION_ERROR) < 1e-9 and abs(a["damping"] - a["forceLimit"] / a["noLoadSpeed"]) < 1e-9
    assert a["continuousNm"] == row["continuousNm"] and a["row"] == row["row"]
    m = p.model
    assert list(m.actuator_forcerange[0]) == [-a["forceLimit"], a["forceLimit"]] and m.actuator_forcelimited[0]
    assert abs(float(m.dof_damping[0]) - a["damping"]) < 1e-9 and abs(float(m.dof_armature[0]) - ARMATURE_AT_OUTPUT * row["gearRatio"] ** 2) < 1e-9
    assert float(m.actuator_gainprm[0][0]) == a["kp"], "a position servo with kp = limit over the saturation error"
    bad = lift(); bad["actuators"][0]["continuousNm"] = bad["actuators"][0]["stallNm"] + 1
    assert "above the stall" in str(refused(lambda: validate_spec(bad), "bad_spec"))
    bad = lift(); bad["actuators"][0]["joint"] = "column-mount"
    assert "fixed" in str(refused(lambda: validate_spec(bad), "bad_spec"))
    bad = lift(); del bad["actuators"][0]["stallNm"]
    assert "stallNm" in str(refused(lambda: validate_spec(bad), "bad_spec"))


def test_a_hinge_chain_and_an_stl_part_build_too() -> None:
    spec = {"name": "arm-2", "medium": {"id": "air", "gravityMps2": [0, 0, -9.81]}, "base": "base",
            "parts": [{"id": "base", "massKg": 1.0, "extentsM": [0.1, 0.1, 0.05], "meshStl": __import__("base64").b64encode(box_stl(0.1, 0.1, 0.05)).decode()},
                      {"id": "upper", "massKg": 0.2, "extentsM": [0.2, 0.03, 0.03]}, {"id": "fore", "massKg": 0.1, "extentsM": [0.15, 0.02, 0.02]}],
            "joints": [{"id": "shoulder", "parent": "base", "child": "upper", "type": "hinge", "axis": [0, 1, 0], "range": [-1.5, 1.5], "originM": [0, 0, 0.05]},
                       {"id": "elbow", "parent": "upper", "child": "fore", "type": "hinge", "axis": [0, 1, 0], "range": [-2.0, 2.0], "originM": [0.2, 0, 0]}],
            "actuators": [{"joint": "shoulder", "stallNm": 2.942, "noLoadRadS": 4.7166, "gearRatio": 2, "continuousNm": 1.471}, {"joint": "elbow", "stallNm": 2.942, "noLoadRadS": 4.7166, "gearRatio": 1, "continuousNm": 1.471}],
            "payload": {"massKg": 0.05, "attachedTo": "fore", "atM": [0.15, 0, 0]}}
    p = PlantSession(spec, 0)
    m = p.model
    assert m.geom("base").type == mujoco.mjtGeom.mjGEOM_MESH and m.nmesh == 1, "the STL is a mesh geom"
    assert abs(float(m.body_mass[m.body("base").id]) - 1.0) < 1e-9, "the mesh carries the kernel's mass"
    assert [m.jnt_type[j] for j in range(m.njnt)] == [mujoco.mjtJoint.mjJNT_HINGE] * 2
    assert m.actuator_forcerange[0][1] == 2.942 * 2 and p.info()["actuators"][0]["unit"] == "N·m"
    assert p.rest_payload is not None and abs(p.rest_payload[0] - 0.35) < 2e-3, "at rest the arm points along +x"
    ik = p.ik_targets([0.25, 0.0, 0.25])
    assert ik["exact"] is False and ik["residualM"] < 1e-3, ik
    MEASURED["armIk"] = ik
    xml, assets = plant_mjcf(validate_spec(spec))
    assert "base.stl" in assets and '<mesh name="base" file="base.stl"/>' in xml
    bad = copy.deepcopy(spec); bad["parts"][0]["meshStl"] = "not base64!"
    refused(lambda: validate_spec(bad), "bad_spec")


def test_the_base_imu_reads_g_and_the_state_carries_every_sense() -> None:
    p = PlantSession(lift(), 0)
    st = p.state()
    assert set(st) == {"timeS", "jointPos", "jointVel", "jointForce", "motorTorqueNm", "targets", "gyroRadS", "accelMps2", "payloadPosM", "payloadVelMps", "energyJ"}
    assert abs(st["accelMps2"][2] - 9.81) < 1e-6 and all(abs(v) < 1e-9 for v in st["gyroRadS"]), "the IMU on the static base reads g, no rotation"
    assert st["timeS"] == 0.0 and len(st["jointPos"]) == 1 and st["payloadPosM"][2] > 0.1
    assert abs(st["motorTorqueNm"][0]) < 0.05, "at rest the carriage sits on the slide's lower stop, which carries the load: the drive holds nothing"
    held = p.spec["payload"]["massKg"] + p.spec["parts"]["carriage"]["massKg"]
    lifted = p.step(p.ik_targets([0.0, 0.0, p.rest_payload[2] + 0.1])["pdTargets"], 3.0)
    assert abs(lifted["motorTorqueNm"][0] * p.actuators[0]["gearRatio"] - held * 9.81) < 0.5, "off the stop the drive holds the carriage and the payload against gravity"
    assert abs(lifted["payloadPosM"][2] - (p.rest_payload[2] + 0.1)) < 0.002, "and it holds them ON the target, not load / kp below it"
    MEASURED["holdNm"] = lifted["motorTorqueNm"][0]
    p.reset()
    st = p.state()
    assert [s["name"] for s in p.senses()] == ["joints", "imu", "payload"] and p.senses()[0]["rateHz"] == 50.0
    after = p.step([0.1])
    assert abs(after["timeS"] - 0.02) < 1e-9 and after["jointPos"][0] > st["jointPos"][0]
    refused(lambda: p.step([0.1, 0.2]), "bad_targets")
    refused(lambda: p.step([0.1], -1), "bad_targets")
    refused(lambda: p.step_command({"payloadTargetM": [0, 0, 0.3]}), "no_controller")


def test_inverse_kinematics_is_exact_on_one_joint_and_the_gravity_sag_is_load_over_kp() -> None:
    p = PlantSession(lift(), 0)
    rest = p.rest_payload[2]
    ik = p.ik_targets([0.0, 0.0, rest + 0.3])
    assert ik["exact"] is True and abs(ik["targets"][0] - 0.3) < 1e-3 and ik["residualM"] < 1e-6, ik
    held = (p.spec["payload"]["massKg"] + p.spec["parts"]["carriage"]["massKg"]) * 9.81
    assert abs(ik["gravitySag"][0] - held / p.actuators[0]["kp"]) < 1e-4, "the sag is the static load over kp"
    assert abs(ik["pdTargets"][0] - (ik["targets"][0] + ik["gravitySag"][0])) < 1e-9
    assert p.state()["timeS"] == 0.0 and abs(p.state()["jointPos"][0]) < 1e-3, "inverse kinematics never moves the plant"
    MEASURED["liftIk"] = ik
    hinge = {"name": "crane", "medium": {"id": "air", "gravityMps2": [0, 0, -9.81]}, "base": "base",
             "parts": [{"id": "base", "massKg": 1.0, "extentsM": [0.1, 0.1, 0.05]}, {"id": "boom", "massKg": 0.2, "extentsM": [0.3, 0.02, 0.02]}],
             "joints": [{"id": "pivot", "parent": "base", "child": "boom", "type": "hinge", "axis": [0, 1, 0], "range": [-1.2, 1.2], "originM": [0, 0, 0.05]}],
             "actuators": [{"joint": "pivot", "stallNm": 2.942, "noLoadRadS": 4.7166, "gearRatio": 3, "continuousNm": 1.471}],
             "payload": {"massKg": 0.1, "attachedTo": "boom", "atM": [0.3, 0, 0]}}
    c = PlantSession(hinge, 0)
    anchor = np.array([0.0, 0.0, 0.05])
    r = c._site_at(c.rest_targets.copy()) - anchor  # the sensor at the payload's centre of mass, at q = 0 (the settled rest sags a little under gravity)
    c.reset()
    angle = -0.5  # a positive hinge about +y drops the tip; -0.5 rad raises it
    rotated = anchor + np.array([r[0] * math.cos(angle) + r[2] * math.sin(angle), 0.0, -r[0] * math.sin(angle) + r[2] * math.cos(angle)])
    up = c.ik_targets(list(rotated))
    assert up["exact"] is True and abs(up["targets"][0] - angle) < 1e-6 and up["residualM"] < 1e-6, up
    no_payload = {k: v for k, v in hinge.items() if k != "payload"}
    refused(lambda: PlantSession(no_payload, 0).ik_targets([0, 0, 0]), "no_payload")


def test_a_cycle_a_double_parent_a_loose_part_and_a_missing_medium_are_refused_by_name() -> None:
    spec = lift()
    loop = copy.deepcopy(spec); loop["joints"].append({"id": "back", "parent": "carriage", "child": "base", "type": "fixed"})
    assert "the base" in str(refused(lambda: validate_spec(loop), "cycle"))
    twice = copy.deepcopy(spec); twice["joints"].append({"id": "again", "parent": "base", "child": "carriage", "type": "fixed"})
    assert "two joints" in str(refused(lambda: validate_spec(twice), "cycle"))
    ring = copy.deepcopy(spec); ring["parts"].append({"id": "a", "massKg": 0.1, "extentsM": [0.1, 0.1, 0.1]}); ring["parts"].append({"id": "b", "massKg": 0.1, "extentsM": [0.1, 0.1, 0.1]})
    ring["joints"] += [{"id": "ab", "parent": "a", "child": "b", "type": "fixed"}, {"id": "ba", "parent": "b", "child": "a", "type": "fixed"}]
    assert "never reach the base" in str(refused(lambda: validate_spec(ring), "cycle"))
    loose = copy.deepcopy(spec); loose["parts"].append({"id": "spare", "massKg": 0.1, "extentsM": [0.1, 0.1, 0.1]})
    assert "spare" in str(refused(lambda: validate_spec(loose), "bad_spec"))
    unknown = copy.deepcopy(spec); unknown["joints"][1]["child"] = "sled"
    assert "sled" in str(refused(lambda: validate_spec(unknown), "unknown_part"))
    nobase = copy.deepcopy(spec); nobase["base"] = "floor"
    refused(lambda: validate_spec(nobase), "unknown_part")
    nomedium = copy.deepcopy(spec); del nomedium["medium"]
    assert "medium" in str(refused(lambda: validate_spec(nomedium), "bad_spec"))
    nopayload_part = copy.deepcopy(spec); nopayload_part["payload"]["attachedTo"] = "hook"
    refused(lambda: validate_spec(nopayload_part), "bad_spec")
    for bad in ({"parts": []}, {**spec, "joints": "x"}, {**spec, "parts": [dict(spec["parts"][0], extentsM=[0, 1, 1])] + spec["parts"][1:]}):
        refused(lambda b=bad: validate_spec(b), "bad_spec")


def test_the_spec_digest_names_the_plant_not_the_mesh_bytes() -> None:
    a = lift()
    b = copy.deepcopy(a); b["parts"][0]["meshStl"] = __import__("base64").b64encode(box_stl(0.2, 0.2, 0.01)).decode()
    c = copy.deepcopy(b)
    assert spec_sha256(a) != spec_sha256(b), "a mesh is part of the plant"
    assert spec_sha256(b) == spec_sha256(c)
    d = copy.deepcopy(a); d["actuators"][0]["gearRatio"] = 41
    assert spec_sha256(a) != spec_sha256(d)
    e = copy.deepcopy(a)
    e["parts"][0]["source"] = {"modelId": "m-1", "route": "/api/cad-studio/models", "readAt": "2026-10-31T00:00:00Z", "revision": 1}
    e["actuators"][0]["row"] = {**e["actuators"][0]["row"], "route": "/api/embodied/build/catalog", "readAt": "2026-10-31T00:00:01Z", "name": "the row's label"}
    assert spec_sha256(e) == spec_sha256(a), "where and when a part or a row was read is not part of the plant"
    f = copy.deepcopy(e); f["parts"][0]["massKg"] += 0.001
    assert spec_sha256(f) != spec_sha256(a), "a mass is"


def test_the_bridge_dispatch_keeps_sessions_and_refuses_by_name() -> None:
    spec = lift()
    load = plant_op("plant.load", {"spec": spec, "session": "t"})
    assert load["session"] == "t" and load["controller"] == "targets" and load["actuators"][0]["joint"] == "carriage-slide"
    st = plant_op("plant.state", {"session": "t"})
    assert st["timeS"] == 0.0 and st["info"]["name"] == "lift-1"
    ik = plant_op("plant.ik", {"session": "t", "targetPosM": [0, 0, load["payload"]["restPosM"][2] + 0.1]})
    assert abs(ik["targets"][0] - 0.1) < 1e-3
    stepped = plant_op("plant.step", {"session": "t", "targets": ik["pdTargets"], "dtS": 2.5})
    assert abs(stepped["timeS"] - 2.5) < 1e-9 and abs(stepped["payloadPosM"][2] - (load["payload"]["restPosM"][2] + 0.1)) < 0.002, stepped["payloadPosM"]
    reset = plant_op("plant.reset", {"session": "t", "seed": 3})
    assert reset["timeS"] == 0.0
    refused(lambda: plant_op("plant.state", {"session": "nope"}), "no_session")
    refused(lambda: plant_op("plant.fly", {"session": "t"}), "unknown_command")
    refused(lambda: plant_op("plant.load", {"spec": {"parts": []}, "session": "u"}), "bad_spec")
    refused(lambda: plant_op("plant.load", {"spec": spec, "session": "u", "controller": "policy:x.zip"}, None), "bad_controller")
    refused(lambda: plant_op("plant.train", {"spec": spec, "task": {}, "project": "lift-1"}, None), "no_report_dir")
    assert plant_op("plant.drop", {"session": "t"}) == {"dropped": True} and plant_op("plant.drop", {"session": "t"}) == {"dropped": False}


if __name__ == "__main__":  # the shipped engine image has no pytest; see README "Build and test"
    import traceback

    names = sorted(name for name, value in list(globals().items()) if name.startswith("test_") and callable(value))
    if not names:
        print("FAIL: no test_* function was discovered in this module", file=sys.stderr)
        raise SystemExit(2)
    failures = 0
    for name in names:
        try:
            globals()[name]()
        except BaseException:  # a runner reports every failure shape, assertions included
            failures += 1
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            print(f"PASS {name}")
    print("MEASURED " + json.dumps(MEASURED))
    print(f"{len(names) - failures} passed, {failures} failed (mujoco {mujoco.__version__})")
    raise SystemExit(1 if failures else 0)
