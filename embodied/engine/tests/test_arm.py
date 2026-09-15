"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the printed arm's plant against the shipped
    |                                           | model (ADR-152 D5 task 3): the joints and the tool point are where
    |                                           | the design put them, inverse kinematics reaches a pose over the
    |                                           | bench and refuses one that reaches through it, a servo holding the
    |                                           | payload in the worst pose carries what the design said it would,
    |                                           | a move trims out the servos' sag, the taught pick-and-place places
    |                                           | the block, the whole check returns its four verdicts, and the
    |                                           | learning environment resets and steps the same way twice.
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
sys.path.insert(0, os.path.join(ENGINE, "tasks"))
from embodied_arm import ARM_JOINTS, ArmPlant, GRIP_CLOSED_RAD, pick_and_place  # noqa: E402
from reach_grasp import ReachGraspEnv, arm_check, scene  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "desk-6-arm.xml")
#: The design's figures for this fixture (embodied/routes/engine/design/arm-design.js, fit desk-6).
PAYLOAD_KG = 0.15
STRETCHED = [0.0, 0.0, -math.pi / 2, 0.0, 0.0, 0.0]
SHOULDER_HOLD_NM = 2.04
CONTINUOUS_NM = [1.471, 2.942, 1.471, 1.471, 1.471, 1.471]
SPEEDS = [1.887, 0.943, 1.887, 1.887, 1.887, 1.887]


@pytest.fixture
def plant() -> ArmPlant:
    with open(FIXTURE, encoding="utf-8") as fh:
        return ArmPlant(fh.read(), seed=0)


def test_the_model_is_the_arm_the_design_describes(plant: ArmPlant) -> None:
    assert len(plant.joint_ids) == 6 and plant.model.nu == 7, "six joints and the gripper, each with a servo"
    elbow_lo, elbow_hi = plant.limits[2]
    assert abs(elbow_lo + math.radians(240)) < 1e-6 and abs(elbow_hi - math.radians(60)) < 1e-6, "limits are radians, not degrees"
    plant.reset([0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    tcp, axis = plant.tcp_pose()
    assert np.allclose(tcp, [0.16, 0.0, 0.365], atol=1e-3), "at zero the upper arm lies along +x and the forearm and tool stand up"
    assert axis[2] > 0.99, "and the tool points up"


def test_inverse_kinematics_reaches_over_the_bench_and_refuses_through_it(plant: ArmPlant) -> None:
    target = np.array([0.25, 0.0, 0.015])
    q, err = plant.ik(target)
    assert err < 1e-3, f"the tool reaches the block ({err * 1000:.1f} mm short)"
    assert not plant.collides(q), "and the pose it found is clear of the bench"
    for v, (lo, hi) in zip(q, plant.limits):
        assert lo - 1e-9 <= v <= hi + 1e-9
    # The elbow-down branch reaches the same point with the elbow through the bench: the guard refuses it.
    through = np.array([0.0, -0.67, -0.22, 0.0, -2.25, 0.0])
    assert plant.collides(through), "a pose that puts a link through the bench is not a pose"


def test_a_servo_holding_the_payload_carries_what_the_design_said(plant: ArmPlant) -> None:
    torques = plant.hold(np.array(STRETCHED), PAYLOAD_KG)
    assert abs(torques[1] - SHOULDER_HOLD_NM) < 0.15 * SHOULDER_HOLD_NM, f"the shoulder carries {torques[1]:.2f} N·m; the design says {SHOULDER_HOLD_NM}"
    assert torques[1] <= CONTINUOUS_NM[1], "and that is inside what the servo pair may hold continuously"
    assert torques[0] < 0.05, "gravity cannot turn the base yaw"
    heavier = plant.hold(np.array(STRETCHED), PAYLOAD_KG * 2)
    assert heavier[1] > torques[1] + 0.3, "twice the payload is felt at the shoulder"


def test_a_move_trims_out_the_servos_sag(plant: ArmPlant) -> None:
    target = np.array([0.24, 0.05, 0.12])
    q, err = plant.ik(target)
    assert err < 1e-3
    assert plant.move_to(q, np.array(SPEEDS)), "the arm settles on the commanded angles"
    tcp, axis = plant.tcp_pose()
    assert float(np.linalg.norm(tcp - target)) < 0.008, f"the tool is within 8 mm of where it was sent ({tcp})"
    assert axis[2] < -0.97, "and it is still pointing down"


def test_the_taught_pick_and_place_places_the_block(plant: ArmPlant) -> None:
    block, place = scene(0)
    plant.set_block(block[0], block[1])
    result = pick_and_place(plant, np.array(SPEEDS), block, place)
    assert result["grasped"] and result["carried"] and result["placed"], result["legs"]
    assert result["success"] is True
    assert float(np.linalg.norm(np.array(result["blockEndM"][:2]) - np.array(place))) < 0.03, "the block ends on the target"
    for i, peak in enumerate(result["peakTorqueNm"]):
        assert peak <= 5.9, f"j{i + 1} never exceeds what its drive can exert"
    assert all(m < c for m, c in zip(result["meanTorqueNm"], CONTINUOUS_NM)), "and on average every servo stays inside its continuous torque"


def test_the_check_reports_its_four_verdicts() -> None:
    with open(FIXTURE, encoding="utf-8") as fh:
        mjcf = fh.read()
    worst = [[0.0] * 6, STRETCHED, [0.0, math.radians(45), math.radians(45), 0.0, 0.0, 0.0],
             [0.0, math.radians(-15), math.radians(-75), math.radians(90), math.radians(90), 0.0],
             [0.0, math.radians(-27), math.radians(-18), 0.0, math.radians(-45), 0.0],
             [0.0, math.radians(35), math.radians(-116), math.radians(90), math.radians(-105), 0.0]]
    design = [0.0, SHOULDER_HOLD_NM, 0.96, 0.206, 0.206, 0.0]
    report = arm_check(mjcf, worst, design, CONTINUOUS_NM, SPEEDS, PAYLOAD_KG, seeds=1)
    assert report["task"] == "arm-grasp" and report["seeds"] == 1
    assert report["verdict"]["holdsItsPayload"] is True
    assert report["verdict"]["physicsAgreesWithDesign"] is True, report["holds"]
    assert report["verdict"]["taskSucceeds"] is True, report["run"]["episodes"]
    assert report["verdict"]["withinDutyCycle"] is True, report["dutyOfContinuous"]
    assert len(report["holds"]) == len(ARM_JOINTS) and all(h["poseBlocked"] is False for h in report["holds"])
    # The check measures; it does not restate. A design figure that is wrong is reported as a disagreement.
    wrong = arm_check(mjcf, worst, [0.0, 9.0, 0.96, 0.206, 0.206, 0.0], CONTINUOUS_NM, SPEEDS, PAYLOAD_KG, seeds=1)
    assert wrong["verdict"]["physicsAgreesWithDesign"] is False


def test_the_learning_environment_resets_and_steps_the_same_way_twice() -> None:
    with open(FIXTURE, encoding="utf-8") as fh:
        mjcf = fh.read()
    env = ReachGraspEnv(mjcf, seed=2)
    first, info = env.reset()
    assert first.shape == (22,) and env.action_space.shape == (7,)
    assert info["blockM"] == scene(2)[0]
    action = np.zeros(7, dtype=np.float32); action[6] = -1.0  # hold still, close the jaw
    obs, reward, done, truncated, step_info = env.step(action)
    assert obs.shape == (22,) and isinstance(reward, float) and done is False and truncated is False
    assert step_info["reachM"] > 0
    again = ReachGraspEnv(mjcf, seed=2)
    second, _info = again.reset()
    assert np.allclose(first, second), "the same seed is the same scene"
    obs2, reward2, _d, _t, _i = again.step(action)
    assert np.allclose(obs, obs2) and abs(reward - reward2) < 1e-9, "and the same action is the same step"
    assert float(np.array(env.plant.data.ctrl[env.plant.grip_act])) == pytest.approx(GRIP_CLOSED_RAD)
