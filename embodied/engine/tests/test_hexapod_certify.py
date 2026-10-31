"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 / B30 -- the spider-18 certification gate on the REAL engine
    |                                           | (MuJoCo, Stable-Baselines3; runs itself, no pytest): a tiny PPO policy
    |                                           | trained here is certified through hexapod.certify -- the certificate
    |                                           | is written beside the policy with the zip's sha256 and the engine's
    |                                           | build hash, the control steps are counted, the torque RMS and peak
    |                                           | are measured, the verdict is re-measured and the roll is replayed; a
    |                                           | continuous torque set below what any gait needs refuses by actuator;
    |                                           | the refusals by name (report_not_found, no_policy, policy_not_found,
    |                                           | bad_task, bad_request, no_report_dir); the plant refuses
    |                                           | `controller: policy:<file>` without a passing certificate, after the
    |                                           | zip changes and on another engine build, and plays a certified one
    |                                           | from `hexapod.step {command}` in both orientations.
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

from embodied_hexapod import HexapodRefused, hexapod_op  # noqa: E402
from tasks import hexapod_certify as C  # noqa: E402
from tasks.hexapod_walk import HexapodWalkEnv  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "spider-18-legs-hop.xml")
#: The design's continuous torque for the STS3215 row (hexapod-design.ts usableNm); the route passes it, the test states it.
CONTINUOUS_NM = 1.47
SEEDS = [100, 101]
MEASURED: dict = {}
_DIR: str | None = None


def report_dir() -> str:
    """A report directory with one tiny walk policy (shape recipe, a few PPO steps) and its training report, made once."""
    global _DIR
    if _DIR is not None:
        return _DIR
    _DIR = tempfile.mkdtemp(prefix="hexapod-certify-")
    from stable_baselines3 import PPO
    env = HexapodWalkEnv("walk", "legs-hop", 7, recipe="shape")
    model = PPO("MlpPolicy", env, seed=7, n_steps=16, batch_size=8, n_epochs=1, verbose=0, device="cpu")
    model.learn(total_timesteps=16)
    model.save(os.path.join(_DIR, "hexapod-walk-ppo-shape-seed7.zip"))
    with open(os.path.join(_DIR, "hexapod-walk-shape-seed7.json"), "w", encoding="utf-8") as fh:
        json.dump({"task": "hexapod-walk", "mode": "shape", "jump": "legs-hop", "seed": 7, "policyFile": "hexapod-walk-ppo-shape-seed7.zip", "policyBeatsBaseline": False}, fh)
    with open(os.path.join(_DIR, "hexapod-check-legs-hop-seed0.json"), "w", encoding="utf-8") as fh:
        json.dump({"task": "hexapod-check", "seed": 0}, fh)
    with open(os.path.join(_DIR, "hexapod-jump-legs-hop-seed1.json"), "w", encoding="utf-8") as fh:
        json.dump({"task": "hexapod-jump", "mode": "residual", "jump": "legs-hop", "seed": 1, "policyFile": "hexapod-walk-ppo-shape-seed7.zip"}, fh)
    return _DIR


def refused(fn, code: str) -> HexapodRefused:
    try:
        fn()
    except HexapodRefused as error:
        assert type(error).__name__ == code, (type(error).__name__, str(error))
        return error
    raise AssertionError(f"expected the refusal {code}")


def _xml() -> str:
    with open(FIXTURE, encoding="utf-8") as fh:
        return fh.read()


def test_the_gate_writes_a_certificate_bound_to_the_policy_and_the_engine_build() -> None:
    out = report_dir()
    cert = hexapod_op("hexapod.certify", {"file": "hexapod-walk-shape-seed7.json", "continuousNm": CONTINUOUS_NM, "seeds": SEEDS}, out)
    MEASURED["certify"] = {k: cert[k] for k in ("ok", "checked", "refusedCount", "policyBeatsBaseline", "wallSeconds")} | {"torque": cert["policy"]["torque"], "baselineRefused": cert["baseline"]["refusedCount"], "baselineTorque": cert["baseline"]["torque"]}
    assert cert["task"] == "hexapod-certify" and cert["seed"] == 7 and cert["certifiedTask"] == "walk" and cert["mode"] == "shape"
    assert cert["policyFile"] == "hexapod-walk-ppo-shape-seed7.zip" and cert["reportFile"] == "hexapod-walk-shape-seed7.json"
    assert cert["policySha256"] == C.policy_sha256(os.path.join(out, cert["policyFile"])) and cert["buildHash"] == C.engine_build_hash()
    assert cert["limits"] == {"continuousNm": CONTINUOUS_NM, "stallNm": cert["limits"]["stallNm"]} and cert["limits"]["stallNm"] > CONTINUOUS_NM
    assert cert["unit"] == "control steps" and cert["evalSeeds"] == SEEDS
    assert cert["checked"] == cert["policy"]["checked"] + cert["roll"]["checked"] > 0, "every control step of the policy's episodes and the roll is counted"
    assert isinstance(cert["ok"], bool) and isinstance(cert["policyBeatsBaseline"], bool) and cert["refusedCount"] == len(cert["refused"]) or cert["refusedCount"] > C.MAX_REFUSALS_LISTED
    for side in ("baseline", "policy"):
        agg = cert[side]
        assert agg["episodes"] == len(SEEDS) and "rows" not in agg and set(agg["torque"]) == {"rmsMaxNm", "rmsMaxActuator", "peakNm"}
        assert 0.0 < agg["torque"]["rmsMaxNm"] <= agg["torque"]["peakNm"] <= cert["limits"]["stallNm"] + 1e-6, agg["torque"]
    assert set(cert["verdict"]) == {"falls", "trackingError", "costOfTransport"} and cert["policyBeatsBaseline"] == all(cert["verdict"].values())
    assert cert["roll"]["episodes"] == 1 and "recovered" in cert["roll"] and "recoverS" in cert["roll"]
    assert cert["ok"] == (cert["refusedCount"] == 0 and cert["roll"]["recovered"] == 1), "ok is the safety verdict alone: no refusal and the roll recovered"
    for r in cert["refused"]:
        assert "episode" in r and "reason" in r and ("actuator" in r or "step" in r or r.get("roll")), r
    with open(C.certificate_path(os.path.join(out, cert["policyFile"])), encoding="utf-8") as fh:
        assert json.load(fh) == cert, "the certificate on disk is what the gate answered"


def test_a_continuous_torque_below_what_any_gait_needs_refuses_by_actuator() -> None:
    out = report_dir()
    cert = hexapod_op("hexapod.certify", {"file": "hexapod-walk-shape-seed7.json", "continuousNm": 0.001, "seeds": SEEDS[:1]}, out)
    assert cert["ok"] is False and cert["refusedCount"] >= 1
    torque = [r for r in cert["refused"] if "rms torque" in r["reason"]]
    assert torque and torque[0]["actuator"] in cert["policy"]["torque"]["rmsMaxActuator"] or torque[0]["actuator"], torque[:2]
    assert "above the continuous 0.001" in torque[0]["reason"]
    assert C.read_certificate(os.path.join(out, cert["policyFile"]))["ok"] is False, "the refusing certificate replaces the earlier one"


def test_the_gate_refuses_by_name() -> None:
    out = report_dir()
    refused(lambda: hexapod_op("hexapod.certify", {"file": "hexapod-walk-shape-seed7.json", "continuousNm": CONTINUOUS_NM}, None), "no_report_dir")
    refused(lambda: hexapod_op("hexapod.certify", {"file": "hexapod-nope.json", "continuousNm": CONTINUOUS_NM}, out), "report_not_found")
    refused(lambda: hexapod_op("hexapod.certify", {"file": "../hexapod-walk-shape-seed7.json", "continuousNm": CONTINUOUS_NM}, out), "report_not_found")
    refused(lambda: hexapod_op("hexapod.certify", {"file": "hexapod-check-legs-hop-seed0.json", "continuousNm": CONTINUOUS_NM}, out), "no_policy")
    refused(lambda: hexapod_op("hexapod.certify", {"file": "hexapod-jump-legs-hop-seed1.json", "continuousNm": CONTINUOUS_NM}, out), "bad_task")
    refused(lambda: hexapod_op("hexapod.certify", {"file": "hexapod-walk-shape-seed7.json"}, out), "bad_request")
    refused(lambda: hexapod_op("hexapod.certify", {"file": "hexapod-walk-shape-seed7.json", "continuousNm": -1}, out), "bad_request")
    with open(os.path.join(out, "hexapod-walk-shape-seed8.json"), "w", encoding="utf-8") as fh:
        json.dump({"task": "hexapod-walk", "mode": "shape", "seed": 8, "policyFile": "hexapod-walk-ppo-shape-seed8.zip"}, fh)
    refused(lambda: hexapod_op("hexapod.certify", {"file": "hexapod-walk-shape-seed8.json", "continuousNm": CONTINUOUS_NM}, out), "policy_not_found")


def _passing_certificate(out: str, policy: str, **override) -> None:
    path = os.path.join(out, policy)
    cert = {"ok": True, "policySha256": C.policy_sha256(path), "buildHash": C.engine_build_hash(), "mode": "shape", "refusedCount": 0}
    cert.update(override)
    with open(C.certificate_path(path), "w", encoding="utf-8") as fh:
        json.dump(cert, fh)


def test_the_plant_plays_a_certified_policy_only() -> None:
    out = report_dir()
    policy = "hexapod-walk-ppo-shape-seed7.zip"
    mjcf = _xml()
    refused(lambda: hexapod_op("hexapod.load", {"mjcf": mjcf, "session": "c", "controller": "policy:nope.zip"}, out), "policy_not_found")
    refused(lambda: hexapod_op("hexapod.load", {"mjcf": mjcf, "session": "c", "controller": "pid"}, out), "bad_controller")
    refused(lambda: hexapod_op("hexapod.load", {"mjcf": mjcf, "session": "c", "controller": f"policy:{policy}"}, None), "bad_controller")
    _passing_certificate(out, policy, ok=False, refusedCount=3)
    refused(lambda: hexapod_op("hexapod.load", {"mjcf": mjcf, "session": "c", "controller": f"policy:{policy}"}, out), "policy_not_certified")
    _passing_certificate(out, policy, buildHash="0" * 64)
    error = refused(lambda: hexapod_op("hexapod.load", {"mjcf": mjcf, "session": "c", "controller": f"policy:{policy}"}, out), "policy_not_certified")
    assert "another engine build" in str(error)
    _passing_certificate(out, policy)
    load = hexapod_op("hexapod.load", {"mjcf": mjcf, "session": "c", "controller": f"policy:{policy}"}, out)
    assert load["controller"] == f"policy:{policy}" and load["actuators"][0] == "L1-coxa"
    plain = hexapod_op("hexapod.load", {"mjcf": mjcf, "session": "p"}, out)
    assert plain["controller"] == "targets"
    refused(lambda: hexapod_op("hexapod.step", {"session": "p", "command": {"vx": 0.1, "vy": 0.0, "yawRate": 0.0}}), "no_controller")
    st = hexapod_op("hexapod.step", {"session": "c", "command": {"vx": 0.15, "vy": 0.0, "yawRate": 0.0}})
    assert len(st["targetsRad"]) == 18 and st["controller"]["controller"] == f"policy:{policy}" and st["controller"]["inverted"] is False and len(st["controller"]["action"]) == 8
    assert abs(st["timeS"] - 0.02) < 1e-9 and "jointPosRad" in st
    for _ in range(25):
        st = hexapod_op("hexapod.step", {"session": "c", "command": {"vx": 0.15, "vy": 0.0, "yawRate": 0.0}})
    assert st["fell"] is False
    plain_step = hexapod_op("hexapod.step", {"session": "c", "targetsRad": st["targetsRad"], "dtS": 0.02})
    assert "targetsRad" not in plain_step, "a targets step on a policy session is the brief's state exactly"
    down = hexapod_op("hexapod.reset", {"session": "c", "pose": "inverted"})
    assert down["inverted"] is True
    st = hexapod_op("hexapod.step", {"session": "c", "command": {"vx": 0.15, "vy": 0.0, "yawRate": 0.0}})
    assert st["controller"]["inverted"] is True, "after an inverted reset the policy's detector starts inverted and the mirror rule applies"
    with open(os.path.join(out, policy), "ab") as fh:
        fh.write(b"\n")
    error = refused(lambda: hexapod_op("hexapod.load", {"mjcf": mjcf, "session": "c", "controller": f"policy:{policy}"}, out), "policy_not_certified")
    assert "changed since" in str(error)
    assert hexapod_op("hexapod.drop", {"session": "c"}) == {"dropped": True} and hexapod_op("hexapod.drop", {"session": "p"}) == {"dropped": True}


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
