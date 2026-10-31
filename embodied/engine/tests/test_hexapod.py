"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 lane L2 -- the spider-18 plant on the REAL engine (MuJoCo and
    |                                           | NumPy only, runs itself: the engine image has no pytest). The
    |                                           | generated fixtures load with the eighteen actuators of
    |                                           | ACTUATOR_ORDER and the hinge signs of the contract; the spider stands
    |                                           | and settles near the stand height; the CPG walks it forward three
    |                                           | seconds without a fall; reset inverted, the mirror rule walks it
    |                                           | forward too (the brief's hypothesis, measured here); the mirror rule
    |                                           | equals the TypeScript fixture; legs-hop measures a hop height and
    |                                           | latched-spring stores the contract's energy and lifts the body (both
    |                                           | measured, no minimum asserted on the hop); the state dict has
    |                                           | exactly the brief's keys; the bridge dispatches hexapod.* by op or
    |                                           | cmd and refuses jump by name on a model without a spring.
2   | maintainer@emeraldcoastsystemsgroup.com   | B30: the gait-shape case - neutral is the gait exactly, a stride or swing scale moves only what it names.
"""
from __future__ import annotations

import json
import math
import os
import sys

import mujoco
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
sys.path.insert(0, os.path.join(ENGINE, "container"))

from embodied_hexapod import (  # noqa: E402
    HexapodPlant, HexapodRefused, WALK_COMMANDS, flip_recover_episode, hexapod_op, hop_episode, stance_episode, walk_episode,
)
from hexapod_gaits import ACTUATOR_ORDER, LEG_IDS, inverted_joint_targets, mirror_leg_role  # noqa: E402

FIXTURES = {jump: os.path.join(HERE, "fixtures", f"spider-18-{jump}.xml") for jump in ("legs-hop", "latched-spring")}
MIRROR_FIXTURE = os.path.join(HERE, "fixtures", "spider-18-mirror.json")
BRIEF_STATE_KEYS = {"timeS", "bodyPosM", "bodyQuatWXYZ", "bodyVelMps", "gyroRadS", "accelMps2", "jointPosRad", "jointVelRadS", "jointTorqueNm", "footContact", "inverted", "fell", "spring"}
#: The stance may settle this far from the model's stand height (the servos sag under the body's weight).
STANCE_TOLERANCE_M = 0.01
#: Stored energy may be this far under k s^2 / 2 (the latch's compliance).
SPRING_TOLERANCE = 0.02

MEASURED: dict = {}


def _xml(jump: str) -> str:
    with open(FIXTURES[jump], encoding="utf-8") as fh:
        return fh.read()


def _plant(jump: str = "legs-hop") -> HexapodPlant:
    return HexapodPlant(_xml(jump), 0)


def test_the_fixtures_load_with_the_eighteen_actuators_in_order_and_the_contract_hinge_signs() -> None:
    for jump in FIXTURES:
        plant = _plant(jump)
        info = plant.info()
        assert info["actuators"] == list(ACTUATOR_ORDER), info["actuators"]
        assert plant.model.nu == 18 and info["hasSpring"] == (jump == "latched-spring")
        for i, name in enumerate(ACTUATOR_ORDER):
            assert plant.model.actuator(i).name == name, f"actuator {i} is {plant.model.actuator(i).name}, not {name}"
        for leg in LEG_IDS:
            axis = plant.model.jnt_axis[plant.model.joint(f"{leg}-coxa").id]
            assert axis[2] == (-1.0 if leg[0] == "L" else 1.0), f"{leg} coxa hinge {axis}"
            for joint in ("femur", "tibia"):
                assert list(plant.model.jnt_axis[plant.model.joint(f"{leg}-{joint}").id]) == [0.0, 1.0, 0.0]
        assert plant.model.opt.gravity[2] < 0 and plant.model.opt.density == 0.0 and plant.model.opt.viscosity == 0.0


def test_the_spider_stands_and_settles_near_the_stand_height() -> None:
    r = stance_episode(_plant(), 1.0, 0)
    MEASURED["stance"] = r
    assert abs(r["errorM"]) < STANCE_TOLERANCE_M, r
    assert r["settled"], r
    assert r["peakTorqueNm"] < 2.94, r  # under the row's stall: standing is not a stall event


def test_the_cpg_walks_forward_three_seconds_without_a_fall() -> None:
    r = walk_episode(_plant(), WALK_COMMANDS[0], 3.0, "upright", 0)
    MEASURED["walk"] = r
    assert not r["fell"], r
    assert r["measured"]["vxMps"] > 0.5 * WALK_COMMANDS[0]["vx"], r
    assert r["distanceM"] > 0.2, r


def test_reset_inverted_is_inverted_and_the_mirrored_gait_walks_forward() -> None:
    plant = _plant()
    state = plant.reset("inverted", 0)
    assert state["inverted"] is True and state["accelMps2"][2] < 0, state
    assert all(state["footContact"]), state["footContact"]
    r = walk_episode(plant, WALK_COMMANDS[0], 3.0, "inverted", 0)
    MEASURED["inverted"] = r
    # The brief's hypothesis (1.4): the same gait through the mirror rule walks the inverted body forward. Measured, not assumed.
    assert not r["fell"], r
    assert r["measured"]["vxMps"] > 0.5 * WALK_COMMANDS[0]["vx"], r
    assert plant.inverted(), "it is still inverted at the end"


def test_a_rolled_body_is_detected_from_the_accelerometer_and_recovers() -> None:
    r = flip_recover_episode(_plant(), WALK_COMMANDS[0], seed=0)
    MEASURED["flip"] = r
    assert r["detectS"] is not None and r["recoverS"] is not None, r
    assert r["invertedAtEnd"] and not r["fell"], r


def test_the_mirror_rule_equals_the_typescript_fixture() -> None:
    with open(MIRROR_FIXTURE, encoding="utf-8") as fh:
        fx = json.load(fh)
    assert fx["actuatorOrder"] == list(ACTUATOR_ORDER)
    assert fx["mirror"] == {leg: mirror_leg_role(leg) for leg in LEG_IDS}
    assert len(fx["cases"]) >= 3
    for case in fx["cases"]:
        got = inverted_joint_targets(case["targets"])
        assert np.allclose(got, case["expected"], atol=1e-9), (case["name"], got)
    try:
        inverted_joint_targets([0.0] * 17)
        raise AssertionError("seventeen targets were accepted")
    except ValueError:
        pass


def test_legs_hop_measures_a_hop_height() -> None:
    r = hop_episode(_plant("legs-hop"), "legs-hop", 0)
    MEASURED["legs-hop"] = r
    for key in ("hopHeightM", "ballisticRiseM", "airborneS", "landedUpright", "bodyPeakM"):
        assert key in r, key
    assert math.isfinite(r["hopHeightM"]) and r["springStoredJBeforeRelease"] is None
    # No minimum is asserted: the brief says a few centimetres is plausible and the plant measures it.


def test_latched_spring_stores_the_contract_energy_and_the_release_lifts_the_body() -> None:
    plant = _plant("latched-spring")
    state = plant.reset("upright", 0)
    m = plant.model
    k = float(m.jnt_stiffness[m.joint("spring").id])
    stroke = float(m.jnt_range[m.joint("spring").id][1])
    contract_j = 0.5 * k * stroke * stroke
    MEASURED["spring"] = {"storedJ": state["spring"]["storedJ"], "contractJ": round(contract_j, 4), "latched": state["spring"]["latched"]}
    assert state["spring"]["latched"] is True
    assert abs(state["spring"]["storedJ"] - contract_j) <= SPRING_TOLERANCE * contract_j, MEASURED["spring"]
    r = hop_episode(plant, "latched-spring", 0)
    MEASURED["latched-spring"] = r
    assert r["airborneS"] > 0 and r["bodyPeakM"] > plant.geo.stand_height_m, r
    assert plant.state()["spring"]["latched"] is False, "the latch tripped"


def test_the_state_dict_has_exactly_the_briefs_keys() -> None:
    for jump in FIXTURES:
        state = _plant(jump).state()
        assert set(state) == BRIEF_STATE_KEYS, set(state) ^ BRIEF_STATE_KEYS
        for key, n in (("bodyPosM", 3), ("bodyQuatWXYZ", 4), ("bodyVelMps", 3), ("gyroRadS", 3), ("accelMps2", 3), ("jointPosRad", 18), ("jointVelRadS", 18), ("jointTorqueNm", 18), ("footContact", 6)):
            assert len(state[key]) == n, (key, len(state[key]))
        assert isinstance(state["inverted"], bool) and isinstance(state["fell"], bool) and all(isinstance(c, bool) for c in state["footContact"])
        if jump == "legs-hop":
            assert state["spring"] is None
        else:
            assert set(state["spring"]) == {"storedJ", "latched"}


def test_the_bridge_dispatches_hexapod_ops_by_op_or_cmd_and_refuses_by_name() -> None:
    from embodied_engine_bridge import Sessions
    sessions = Sessions()
    load = sessions.handle({"cmd": "hexapod.load", "mjcf": _xml("legs-hop"), "seed": 1, "session": "t"})
    assert load["actuators"] == list(ACTUATOR_ORDER) and load["hasSpring"] is False
    st = sessions.handle({"op": "hexapod.step", "session": "t", "targetsRad": st_targets(load), "dtS": 0.02})
    assert set(st) == BRIEF_STATE_KEYS and abs(st["timeS"] - 0.02) < 1e-9
    try:
        hexapod_op("hexapod.jump", {"session": "t"})
        raise AssertionError("jump on a legs-hop model was accepted")
    except HexapodRefused as error:
        assert type(error).__name__ == "no_spring", type(error).__name__
    try:
        hexapod_op("hexapod.step", {"session": "t", "targetsRad": [0.0] * 17})
        raise AssertionError("seventeen targets were accepted")
    except HexapodRefused as error:
        assert type(error).__name__ == "bad_targets"
    assert sessions.handle({"op": "hexapod.drop", "session": "t"}) == {"dropped": True}
    try:
        hexapod_op("hexapod.state", {"session": "t"})
        raise AssertionError("a dropped session answered")
    except HexapodRefused as error:
        assert type(error).__name__ == "no_session"


def st_targets(load: dict) -> list[float]:
    """@description Eighteen zero targets, one per actuator the load reply named. @param load The load reply. @returns Zeros."""
    return [0.0] * len(load["actuators"])


def test_the_check_writes_a_hexapod_report_the_studio_lists(tmp_dir: str | None = None) -> None:
    import tempfile
    out = tmp_dir or tempfile.mkdtemp(prefix="hexapod-check-")
    report = hexapod_op("hexapod.check", {"models": [{"jump": "legs-hop", "mjcf": _xml("legs-hop")}], "seeds": 1}, out)
    MEASURED["check"] = {k: v for k, v in report["models"][0].items() if k in ("stance", "verdict", "hop")}
    assert report["reportFiles"] == ["hexapod-check-legs-hop-seed0.json"], report["reportFiles"]
    with open(os.path.join(out, report["reportFiles"][0]), encoding="utf-8") as fh:
        written = json.load(fh)
    assert written["task"] == "hexapod-check" and written["seed"] == 0 and set(written["baseline"]) >= {"trackingErrorMps", "costOfTransport", "falls", "recoverS", "hopHeightM", "landedUpright"}
    assert written["verdict"] == report["models"][0]["verdict"]


def test_the_neutral_gait_shape_is_the_gait_exactly_and_a_shaped_one_moves_the_feet() -> None:
    """B30: GaitShape.neutral() and from_action(zeros) reproduce cpg_targets byte for byte; a stride scale of 1.5 on L1 changes
    L1's targets and nobody else's; the swing scale changes a swinging leg; the step-rate scale stays inside the band."""
    from hexapod_gaits import GaitShape, LEG_IDS, cpg_targets
    with open(FIXTURES["legs-hop"], encoding="utf-8") as fh:
        geo = HexapodPlant(fh.read(), 0).geo
    cmd = {"vx": 0.15, "vy": 0.0, "yawRate": 0.0}
    for t in (0.3, 0.9, 1.7):
        plain = cpg_targets(geo, t, cmd)
        assert cpg_targets(geo, t, cmd, False, GaitShape.neutral()) == plain
        assert cpg_targets(geo, t, cmd, False, GaitShape.from_action([0.0] * GaitShape.SIZE)) == plain
        stride = GaitShape([1.5] + [1.0] * 5, 1.0, 1.0)
        shaped = cpg_targets(geo, t, cmd, False, stride)
        assert shaped[0:3] != plain[0:3] and shaped[3:] == plain[3:], (t, shaped[0:3], plain[0:3])
        swung = cpg_targets(geo, t, cmd, False, GaitShape([1.0] * 6, 1.5, 1.0))
        assert swung != plain
    fast = GaitShape.from_action([0.0] * 7 + [1.0])
    assert abs(fast.hz_scale - GaitShape.HZ_BAND[1]) < 1e-12 and len(LEG_IDS) == 6


def test_a_walk_episode_can_be_rolled_over_and_the_gait_carries_it_inverted() -> None:
    """B31: with roll_fraction 1 every walk episode is rolled over at a drawn moment after FLIP_AT_S; the roll passes through
    the fall grace, the detector switches the gait through the mirror rule, and the row says when it rolled and that it
    ended inverted without a fall. roll_fraction 0 never rolls."""
    from tasks.hexapod_walk import FLIP_AT_S, ROLL_WINDOW_S, HexapodWalkEnv, baseline_policy
    env = HexapodWalkEnv("walk", "legs-hop", 3, recipe="shape", roll_fraction=1.0)
    obs, _ = env.reset(seed=3)
    assert env.flip_at is not None and FLIP_AT_S <= env.flip_at < FLIP_AT_S + ROLL_WINDOW_S, env.flip_at
    total, done = 0.0, False
    while not done:
        obs, r, term, trunc, _ = env.step(baseline_policy(obs, env))
        total += r
        done = term or trunc
    row = env.score(total)
    assert row["falls"] == 0 and row["invertedAtEnd"] is True and abs(row["rolledAtS"] - env.flip_at) < 0.021, row
    assert env.detector.inverted is True, "the detector read the roll from the accelerometer"
    MEASURED["rolledWalk"] = {k: row[k] for k in ("rolledAtS", "trackingErrorMps", "costOfTransport", "falls")}
    plain = HexapodWalkEnv("walk", "legs-hop", 3, recipe="shape", roll_fraction=0.0)
    plain.reset(seed=3)
    assert plain.flip_at is None


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
