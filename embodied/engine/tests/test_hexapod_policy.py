"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 / B30 -- the Pi policy runtime proven on the REAL engine (runs
    |                                           | itself, no pytest): the certified seed-1 policy exports through the
    |                                           | gate's door with its NumPy actor within 1e-5 of the torch one; the
    |                                           | runtime's observation builder equals the task's; the node-side player
    |                                           | and the plant-side controller make the same targets on the same
    |                                           | plant states, step for step; the geometry fixture equals the plant's;
    |                                           | an uncertified policy is refused by name.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
sys.path.insert(0, os.path.join(ENGINE, "container"))

import mujoco  # noqa: E402
import numpy as np  # noqa: E402

from embodied_hexapod import CONTROL_DT_S, HexapodPlant  # noqa: E402
from hexapod_policy import NodePolicyPlayer, NumpyPolicy, PolicyRefused, export_policy, geometry_from_dict, geometry_to_dict, observation, weights_path  # noqa: E402

CERTIFIED = os.path.join(ENGINE, "policies")
POLICY = "hexapod-walk-ppo-shape-seed1.zip"
FIXTURE = os.path.join(HERE, "fixtures", "spider-18-legs-hop.xml")
GEOMETRY = os.path.join(HERE, "fixtures", "spider-18-geometry.json")
MEASURED: dict = {}


def _plant() -> HexapodPlant:
    with open(FIXTURE, encoding="utf-8") as fh:
        return HexapodPlant(fh.read(), 0)


def refused(fn, code: str):
    """The runtime's own refusals and the plant's (export goes through the gate's door) are both classes named as their code."""
    from embodied_hexapod import HexapodRefused
    try:
        fn()
    except (PolicyRefused, HexapodRefused) as error:
        assert type(error).__name__ == code, (type(error).__name__, str(error))
        return error
    raise AssertionError(f"expected the refusal {code}")


def _workdir() -> str:
    """A copy of the certified policy, its certificate and its report (the gate's door reads the certificate beside the zip)."""
    out = tempfile.mkdtemp(prefix="hexapod-policy-")
    for name in (POLICY, POLICY[:-4] + ".certificate.json", "hexapod-walk-shape-seed1.json"):
        shutil.copy(os.path.join(CERTIFIED, name), out)
    return out


def test_the_certified_policy_exports_within_tolerance_and_the_file_plays_back_the_torch_actions() -> None:
    out = _workdir()
    try:
        plant = _plant()
        doc = export_policy(os.path.join(out, POLICY), plant.geo)
        MEASURED["parity"] = doc["parity"]
        assert doc["parity"]["maxAbsDiff"] <= doc["parity"]["tolerance"] and doc["obsSize"] == 53 and doc["actSize"] == 8 and doc["recipe"] == "shape"
        assert [(len(l["w"]), len(l["w"][0]), l["act"]) for l in doc["layers"]] == [(64, 53, "tanh"), (64, 64, "tanh"), (8, 64, None)]
        assert doc["certificate"]["ok"] is True and doc["certificate"]["certifiedTask"] == "walk"
        with open(weights_path(os.path.join(out, POLICY)), encoding="utf-8") as fh:
            written = json.load(fh)
        assert written == doc
        from stable_baselines3 import PPO
        model = PPO.load(os.path.join(out, POLICY), device="cpu")
        numpy_policy = NumpyPolicy.from_doc(written)
        rng = np.random.default_rng(7)
        for _ in range(64):
            obs = rng.standard_normal(53).astype(np.float32)
            torch_action, _ = model.predict(obs, deterministic=True)
            assert np.max(np.abs(np.asarray(torch_action, dtype=float) - numpy_policy.act(obs))) < 1e-5
        shipped = os.path.join(CERTIFIED, weights_path(POLICY))
        with open(shipped, encoding="utf-8") as fh:
            committed = json.load(fh)
        assert committed["layers"] == doc["layers"] and committed["policySha256"] == doc["policySha256"] and committed["geometry"] == doc["geometry"], "the committed weights file is this export"
    finally:
        shutil.rmtree(out, ignore_errors=True)


def test_the_runtimes_observation_equals_the_tasks() -> None:
    from tasks.hexapod_walk import observation as task_observation
    rng = np.random.default_rng(3)
    for _ in range(20):
        state = {"jointPosRad": rng.standard_normal(18).tolist(), "jointVelRadS": rng.standard_normal(18).tolist(), "gyroRadS": rng.standard_normal(3).tolist(), "accelMps2": rng.standard_normal(3).tolist()}
        prev = rng.uniform(-1, 1, 8)
        cmd = (float(rng.uniform(0, 0.25)), float(rng.uniform(-0.05, 0.05)), float(rng.uniform(-0.3, 0.3)))
        assert np.array_equal(observation(state, prev, cmd), task_observation(state, prev, cmd))


def test_the_node_side_player_and_the_plant_side_controller_make_the_same_targets() -> None:
    from tasks.hexapod_certify import PolicyGait
    out = _workdir()
    try:
        plant = _plant()
        export_policy(os.path.join(out, POLICY), plant.geo)
        plant_side = PolicyGait(os.path.join(out, POLICY))
        node_side = NodePolicyPlayer(weights_path(os.path.join(out, POLICY)))
        assert node_side.name == f"policy:{POLICY}" and node_side.certificate["ok"] is True
        cmd = {"vx": 0.15, "vy": 0.02, "yawRate": 0.1}
        state = plant.reset("upright", 0)
        plant_side.reset(False)
        worst = 0.0
        for _ in range(60):
            tp, info = plant_side.targets(plant, state, cmd)
            tn = node_side.targets(state, cmd, info["inverted"], CONTROL_DT_S)
            worst = max(worst, float(np.max(np.abs(np.array(tp) - np.array(tn)))))
            state = plant.step(tp, CONTROL_DT_S)
        MEASURED["nodeVsPlantMaxDiff"] = worst
        assert worst < 1e-6, worst
        assert state["fell"] is False
    finally:
        shutil.rmtree(out, ignore_errors=True)


def test_the_geometry_fixture_is_the_plants_and_an_uncertified_policy_is_refused() -> None:
    plant = _plant()
    with open(GEOMETRY, encoding="utf-8") as fh:
        fixture = json.load(fh)["geometry"]
    assert fixture == geometry_to_dict(plant.geo), "tests/fixtures/spider-18-geometry.json drifted from the plant"
    assert geometry_from_dict(fixture) == plant.geo
    out = tempfile.mkdtemp(prefix="hexapod-policy-")
    try:
        shutil.copy(os.path.join(CERTIFIED, POLICY), out)
        refused(lambda: export_policy(os.path.join(out, POLICY), plant.geo), "policy_not_certified")
        refused(lambda: NodePolicyPlayer(os.path.join(out, "nope.weights.json")), "policy_not_found")
        with open(os.path.join(out, "bad.weights.json"), "w", encoding="utf-8") as fh:
            json.dump({"certificate": {"ok": False}, "layers": []}, fh)
        refused(lambda: NodePolicyPlayer(os.path.join(out, "bad.weights.json")), "policy_not_certified")
    finally:
        shutil.rmtree(out, ignore_errors=True)


if __name__ == "__main__":  # the shipped engine image has no pytest; see README "Build and test"
    import traceback

    names = sorted(name for name, value in list(globals().items()) if name.startswith("test_") and callable(value))
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
