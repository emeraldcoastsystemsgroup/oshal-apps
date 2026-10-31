"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant -- the reach task and its gate on the REAL
    |                                           | engine (MuJoCo, Stable-Baselines3; runs itself, no pytest): the task
    |                                           | from the brief's numbers (a displacement of the payload, the time,
    |                                           | the load that must be the spec's payload); the observation's
    |                                           | channels; the PD baseline on the lift reaches 300 mm with 2 kg
    |                                           | inside the brief's 5 s under the row's continuous rating (the
    |                                           | numbers are printed, never asserted beyond the brief's bar); the
    |                                           | aggregate and the verdict's facets; a baseline-only report and a
    |                                           | tiny PPO run write plant-<project>-reach-seed<S>.json beside the
    |                                           | policy; the gate certifies through the rows' limits and the brief's
    |                                           | time, binds the certificate to the policy's sha256, the engine's
    |                                           | build hash and the spec digest, refuses by name, and the plant plays
    |                                           | a certified policy only -- not one certified on another plant.
"""
from __future__ import annotations

import copy
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

from embodied_hexapod import HexapodRefused  # noqa: E402
from embodied_plant import PlantSession, plant_op, spec_sha256  # noqa: E402
from tasks import hexapod_certify as C  # noqa: E402
from tasks import plant_reach as R  # noqa: E402

SPEC = os.path.join(HERE, "fixtures", "lift-1-spec.json")
TASK = os.path.join(HERE, "fixtures", "lift-1-task.json")
SEEDS = [100, 101]
MEASURED: dict = {}
_DIR: str | None = None


def lift() -> tuple[dict, dict]:
    with open(SPEC, encoding="utf-8") as fh:
        spec = json.load(fh)
    with open(TASK, encoding="utf-8") as fh:
        task = json.load(fh)
    return spec, task


def refused(fn, code: str) -> HexapodRefused:
    try:
        fn()
    except HexapodRefused as error:
        assert type(error).__name__ == code, (type(error).__name__, str(error))
        return error
    raise AssertionError(f"expected the refusal {code}")


def report_dir() -> str:
    """A report directory with the lift's baseline report and a tiny PPO policy (a few steps) and its report, made once."""
    global _DIR
    if _DIR is not None:
        return _DIR
    _DIR = tempfile.mkdtemp(prefix="plant-reach-")
    spec, task = lift()
    R.run_training(spec, task, "lift-1", 0, 0, _DIR, SEEDS)
    R.run_training(spec, task, "lift-1", 7, 64, _DIR, SEEDS)
    return _DIR


def test_the_task_comes_from_the_briefs_numbers_and_is_refused_by_name() -> None:
    spec, task = lift()
    plant = PlantSession(spec, 0)
    t = R.task_spec(task, plant)
    assert t["timeS"] == 5.0 and t["loadKg"] == 2.0 and t["deltaM"] == [0.0, 0.0, 0.3] and t["line"] == task["line"]
    assert abs(t["targetPosM"][2] - (plant.rest_payload[2] + 0.3)) < 1e-6 and t["targetPosM"][:2] == [0.0, 0.0]
    absolute = R.task_spec({"posM": [0, 0, 0.4], "timeS": 2}, plant)
    assert absolute["targetPosM"] == [0.0, 0.0, 0.4] and absolute["loadKg"] == 2.0
    refused(lambda: R.task_spec({"timeS": 5}, plant), "bad_task")
    refused(lambda: R.task_spec({"deltaM": [0, 0, 0.3], "timeS": 0}, plant), "bad_task")
    refused(lambda: R.task_spec({"deltaM": [0, 0, 0.3], "timeS": 5, "loadKg": 3}, plant), "bad_task")
    refused(lambda: R.task_spec("lift it", plant), "bad_task")
    no_payload = {k: v for k, v in spec.items() if k != "payload"}
    refused(lambda: R.task_spec(task, PlantSession(no_payload, 0)), "no_payload")


def test_the_observation_carries_every_channel_the_controller_rebuilds() -> None:
    spec, task = lift()
    env = R.PlantReachEnv(spec, task, 0)
    obs, _ = env.reset(seed=0)
    n = env.n_act
    assert obs.shape == (3 * n + 6 + 3 + n + 1,) and obs.dtype == np.float32
    state = env.state
    assert abs(obs[0] - state["jointPos"][0]) < 1e-6 and abs(obs[2 * n] - state["motorTorqueNm"][0] / env.limits[0]) < 1e-6
    assert abs(obs[3 * n + 5] - state["accelMps2"][2] / R.ACCEL_SCALE) < 1e-6, "the accelerometer's z"
    err = np.array(env.task["targetPosM"]) - np.array(state["payloadPosM"])
    assert abs(obs[3 * n + 6 + 2] - err[2] / R.ERR_SCALE) < 1e-6, "the payload error to the target"
    assert obs[-1] == 0.0, "the time fraction starts at zero"
    again = R.observation(state, np.zeros(n), err, 0.0, env.limits)
    assert np.array_equal(obs, again), "the plant's policy controller builds the same vector from the same state"
    assert env.action_space.shape == (n,) and float(env.reach[0]) == R.RESIDUAL_M, "a slide's residual reach is in metres"


def test_the_pd_baseline_lifts_the_load_inside_the_briefs_time_under_the_rows_rating() -> None:
    spec, task = lift()
    agg = R.evaluate(R.baseline_policy, spec, task, SEEDS)
    MEASURED["baseline"] = {k: v for k, v in agg.items() if k != "rows"}
    assert agg["episodes"] == len(SEEDS) and agg["reached"] == len(SEEDS), agg
    assert agg["reachedS"] is not None and agg["reachedS"] <= task["timeS"], "the brief's bar: 300 mm with 2 kg in 5 s"
    assert agg["finalErrorM"] <= R.TOLERANCE_M
    limit = spec["actuators"][0]["continuousNm"]
    assert agg["rmsTorqueMaxNm"] <= limit and agg["peakTorqueNm"] <= spec["actuators"][0]["stallNm"] + 1e-6, "under the row's continuous rating, never above its stall"
    assert agg["overRatingSteps"] == 0 and agg["rmsTorqueMaxActuator"] == "carriage-slide"
    row = agg["rows"][0]
    assert set(row) == {"reachedS", "reachedInTime", "finalErrorM", "rmsMotorTorqueNm", "peakMotorTorqueNm", "overRatingSteps", "energyJ", "seconds", "return"}
    assert abs(row["seconds"] - task["timeS"] * R.EPISODE_FACTOR) < 1e-6


def test_the_aggregate_and_the_verdict_facets() -> None:
    row = lambda reached, final, rms, peak: {"reachedS": reached, "reachedInTime": reached is not None and reached <= 5, "finalErrorM": final, "rmsMotorTorqueNm": {"j": rms}, "peakMotorTorqueNm": {"j": peak}, "overRatingSteps": 0, "energyJ": 1.0, "seconds": 7.5, "return": 1.0}
    base = R.aggregate([row(3.5, 0.0, 0.5, 1.4), row(3.6, 0.001, 0.6, 1.5)])
    assert base["reached"] == 2 and base["reachedS"] == 3.55 and base["rmsTorqueMaxNm"] == 0.6 and base["peakTorqueNm"] == 1.5 and base["rmsTorqueMaxActuator"] == "j"
    better = R.aggregate([row(3.0, 0.0, 0.5, 1.4), row(3.1, 0.0, 0.5, 1.4)])
    assert R.verdict(base, better) == {"facets": {"reached": True, "reachedS": True, "finalErrorM": True, "rmsTorqueMaxNm": True}, "beats": True}
    later = R.aggregate([row(4.0, 0.0, 0.5, 1.4), row(None, 0.02, 0.5, 1.4)])
    v = R.verdict(base, later)
    assert v["beats"] is False and v["facets"]["reached"] is False and v["facets"]["reachedS"] is False
    hotter = R.aggregate([row(3.0, 0.0, 0.7, 1.4), row(3.0, 0.0, 0.7, 1.4)])
    assert R.verdict(base, hotter)["facets"] == {"reached": True, "reachedS": True, "finalErrorM": True, "rmsTorqueMaxNm": False}
    assert R.report_file("lift-1", 3) == "plant-lift-1-reach-seed3.json" and R.policy_file("lift-1", 3) == "plant-lift-1-reach-ppo-seed3.zip"


def test_the_reports_are_written_beside_the_policy_in_the_hexapod_reports_shape() -> None:
    out = report_dir()
    spec, task = lift()
    with open(os.path.join(out, "plant-lift-1-reach-seed0.json"), encoding="utf-8") as fh:
        base = json.load(fh)
    assert base["task"] == "plant-reach" and base["project"] == "lift-1" and base["seed"] == 0 and base["timesteps"] == 0 and "policyFile" not in base
    assert base["specSha256"] == spec_sha256(spec) and base["spec"]["parts"][0]["id"] == "base" and base["taskSpec"]["timeS"] == 5
    assert base["evalSeeds"] == SEEDS and base["facets"] == list(R.FACETS) and base["baseline"]["episodes"] == 2 and base["ik"]["exact"] is True
    assert base["actuators"] == [{"joint": "carriage-slide", "continuousNm": 1.471, "stallNm": 2.942, "gearRatio": 40}]
    with open(os.path.join(out, "plant-lift-1-reach-seed7.json"), encoding="utf-8") as fh:
        trained = json.load(fh)
    assert trained["timesteps"] == 64 and trained["policyFile"] == "plant-lift-1-reach-ppo-seed7.zip" and os.path.isfile(os.path.join(out, trained["policyFile"]))
    assert set(trained["verdict"]) == set(R.FACETS) and isinstance(trained["policyBeatsBaseline"], bool) and trained["policy"]["episodes"] == 2
    assert trained["trainWallS"] > 0 and trained["sb3"] and trained["torch"]
    MEASURED["tinyPolicy"] = {k: v for k, v in trained["policy"].items() if k != "rows"} | {"beats": trained["policyBeatsBaseline"]}


def test_the_gate_certifies_through_the_rows_limits_and_the_briefs_time_and_refuses_by_name() -> None:
    out = report_dir()
    spec, _task = lift()
    cert = plant_op("plant.certify", {"file": "plant-lift-1-reach-seed7.json", "seeds": SEEDS}, out)
    MEASURED["certify"] = {k: cert[k] for k in ("ok", "checked", "refusedCount", "policyBeatsBaseline", "wallSeconds")}
    assert cert["task"] == "plant-certify" and cert["project"] == "lift-1" and cert["seed"] == 7 and cert["reportFile"] == "plant-lift-1-reach-seed7.json"
    assert cert["policySha256"] == C.policy_sha256(os.path.join(out, cert["policyFile"])) and cert["buildHash"] == C.engine_build_hash() and cert["specSha256"] == spec_sha256(spec)
    assert cert["limits"] == [{"joint": "carriage-slide", "continuousNm": 1.471, "stallNm": 2.942, "gearRatio": 40}] and cert["reachedWithinS"] == 5
    assert cert["unit"] == "control steps" and cert["checked"] == cert["policy"]["checked"] > 0 and cert["evalSeeds"] == SEEDS
    assert cert["ok"] == (cert["refusedCount"] == 0) and cert["refusedCount"] == len(cert["refused"])
    for side in ("baseline", "policy"):
        assert cert[side]["episodes"] == 2 and "rows" not in cert[side] and "rmsTorqueMaxNm" in cert[side]
    assert set(cert["verdict"]) == set(R.FACETS) and cert["policyBeatsBaseline"] == all(cert["verdict"].values())
    with open(C.certificate_path(os.path.join(out, cert["policyFile"])), encoding="utf-8") as fh:
        assert json.load(fh) == cert, "the certificate on disk is what the gate answered"
    # The same spec given with the request is accepted; another plant's is spec_mismatch.
    assert plant_op("plant.certify", {"file": "plant-lift-1-reach-seed7.json", "seeds": SEEDS[:1], "spec": spec}, out)["specSha256"] == cert["specSha256"]
    other = copy.deepcopy(spec); other["actuators"][0]["gearRatio"] = 41
    refused(lambda: plant_op("plant.certify", {"file": "plant-lift-1-reach-seed7.json", "spec": other}, out), "spec_mismatch")
    # A rating the lift cannot meet refuses by actuator; a time it cannot meet refuses by episode.
    tight = copy.deepcopy(spec); tight["actuators"][0]["continuousNm"] = 0.01
    with open(os.path.join(out, "plant-lift-1-reach-seed7.json"), encoding="utf-8") as fh:
        report = json.load(fh)
    hot = dict(report, spec=tight, specSha256=spec_sha256(tight), project="tight")
    with open(os.path.join(out, "plant-tight-reach-seed7.json"), "w", encoding="utf-8") as fh:
        json.dump(hot, fh)
    refusal = plant_op("plant.certify", {"file": "plant-tight-reach-seed7.json", "seeds": SEEDS[:1]}, out)
    assert refusal["ok"] is False and refusal["refused"][0]["actuator"] == "carriage-slide" and "above the continuous 0.010" in refusal["refused"][0]["reason"]
    rushed = dict(report, taskSpec=dict(report["taskSpec"], timeS=0.5), project="rushed")
    with open(os.path.join(out, "plant-rushed-reach-seed7.json"), "w", encoding="utf-8") as fh:
        json.dump(rushed, fh)
    late = plant_op("plant.certify", {"file": "plant-rushed-reach-seed7.json", "seeds": SEEDS[:1]}, out)
    assert late["ok"] is False and "did not reach the target within 0.5 s" in late["refused"][0]["reason"]
    refused(lambda: plant_op("plant.certify", {"file": "plant-lift-1-reach-seed7.json"}, None), "no_report_dir")
    refused(lambda: plant_op("plant.certify", {"file": "plant-nope.json"}, out), "report_not_found")
    refused(lambda: plant_op("plant.certify", {"file": "../plant-lift-1-reach-seed7.json"}, out), "report_not_found")
    refused(lambda: plant_op("plant.certify", {"file": "hexapod-walk-shape-seed1.json"}, out), "report_not_found")
    refused(lambda: plant_op("plant.certify", {"file": "plant-lift-1-reach-seed0.json"}, out), "no_policy")
    with open(os.path.join(out, "plant-lift-1-reach-seed8.json"), "w", encoding="utf-8") as fh:
        json.dump(dict(report, policyFile="plant-lift-1-reach-ppo-seed8.zip"), fh)
    refused(lambda: plant_op("plant.certify", {"file": "plant-lift-1-reach-seed8.json"}, out), "policy_not_found")
    with open(os.path.join(out, "plant-x-reach-seed1.json"), "w", encoding="utf-8") as fh:
        json.dump({"task": "hexapod-walk"}, fh)
    refused(lambda: plant_op("plant.certify", {"file": "plant-x-reach-seed1.json"}, out), "bad_task")


def test_the_plant_plays_a_certified_policy_only_and_only_on_its_own_plant() -> None:
    out = report_dir()
    spec, _task = lift()
    policy = "plant-lift-1-reach-ppo-seed7.zip"
    plant_op("plant.certify", {"file": "plant-lift-1-reach-seed7.json", "seeds": SEEDS[:1]}, out)
    cert_path = C.certificate_path(os.path.join(out, policy))
    with open(cert_path, encoding="utf-8") as fh:
        cert = json.load(fh)
    if not cert["ok"]:  # a 64-step policy may be refused on time; the door needs a passing certificate, so stamp one for the door's own checks
        cert.update({"ok": True, "refusedCount": 0, "refused": []})
        with open(cert_path, "w", encoding="utf-8") as fh:
            json.dump(cert, fh)
    load = plant_op("plant.load", {"spec": spec, "session": "c", "controller": f"policy:{policy}"}, out)
    assert load["controller"] == f"policy:{policy}"
    target = [0.0, 0.0, load["payload"]["restPosM"][2] + 0.3]
    st = plant_op("plant.step", {"session": "c", "command": {"payloadTargetM": target}}, out)
    assert st["controller"]["controller"] == f"policy:{policy}" and len(st["controller"]["action"]) == 1 and abs(st["timeS"] - 0.02) < 1e-9
    for _ in range(225):
        st = plant_op("plant.step", {"session": "c", "command": {"payloadTargetM": target}}, out)
    MEASURED["doorAfter4_5s"] = {"payloadZ": st["payloadPosM"][2], "targetZ": target[2]}
    refused(lambda: plant_op("plant.step", {"session": "c", "command": {"payloadTargetM": [0, 0]}}, out), "bad_targets")
    other = copy.deepcopy(spec); other["actuators"][0]["gearRatio"] = 41
    error = refused(lambda: plant_op("plant.load", {"spec": other, "session": "d", "controller": f"policy:{policy}"}, out), "policy_not_certified")
    assert "another plant" in str(error)
    with open(cert_path, "w", encoding="utf-8") as fh:
        json.dump(dict(cert, buildHash="0" * 64), fh)
    assert "another engine build" in str(refused(lambda: plant_op("plant.load", {"spec": spec, "session": "d", "controller": f"policy:{policy}"}, out), "policy_not_certified"))
    with open(cert_path, "w", encoding="utf-8") as fh:
        json.dump(dict(cert, ok=False, refusedCount=2), fh)
    refused(lambda: plant_op("plant.load", {"spec": spec, "session": "d", "controller": f"policy:{policy}"}, out), "policy_not_certified")
    refused(lambda: plant_op("plant.load", {"spec": spec, "session": "d", "controller": "policy:plant-nope.zip"}, out), "policy_not_found")
    refused(lambda: plant_op("plant.load", {"spec": spec, "session": "d", "controller": "pid"}, out), "bad_controller")
    assert plant_op("plant.drop", {"session": "c"}, out) == {"dropped": True}


def test_a_long_run_is_a_job_the_bridge_reports_and_a_second_one_on_the_same_file_is_busy() -> None:
    import time
    out = report_dir()
    spec, task = lift()
    started = plant_op("plant.train", {"spec": spec, "task": task, "project": "lift-1", "seed": 9, "timesteps": 64, "seeds": SEEDS[:1]}, out)
    assert started["started"] is True and started["file"] == "plant-lift-1-reach-seed9.json" and started["state"] == "running"
    refused(lambda: plant_op("plant.train", {"spec": spec, "task": task, "project": "lift-1", "seed": 9, "timesteps": 64}, out), "busy")
    for _ in range(600):
        job = next(j for j in plant_op("plant.jobs", {}, out)["jobs"] if j["file"] == started["file"])
        if job["state"] != "running":
            break
        time.sleep(0.1)
    assert job["state"] == "done" and job["policyFile"] == "plant-lift-1-reach-ppo-seed9.zip" and job["stepsDone"] == 64 and job["error"] is None, job
    assert os.path.isfile(os.path.join(out, job["file"])) and os.path.isfile(os.path.join(out, job["policyFile"]))
    failing = plant_op("plant.train", {"spec": spec, "task": {}, "project": "lift-1", "seed": 10, "timesteps": 64}, out)
    for _ in range(600):
        job = next(j for j in plant_op("plant.jobs", {}, out)["jobs"] if j["file"] == failing["file"])
        if job["state"] != "running":
            break
        time.sleep(0.1)
    assert job["state"] == "failed" and job["error"].startswith("bad_task:"), "a job carries its own failure by name"
    refused(lambda: plant_op("plant.train", {"spec": spec, "task": task, "project": "../x", "timesteps": 0}, out), "bad_spec")


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
    if _DIR:
        shutil.rmtree(_DIR, ignore_errors=True)
    print("MEASURED " + json.dumps(MEASURED))
    print(f"{len(names) - failures} passed, {failures} failed (mujoco {mujoco.__version__})")
    raise SystemExit(1 if failures else 0)
