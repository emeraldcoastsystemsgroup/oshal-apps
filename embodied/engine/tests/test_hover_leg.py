"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the hover-and-leg task: observation and
    |                                           | action shapes, the residual mode equal to the plant's own
    |                                           | controller at a zero correction, the baseline evaluation with
    |                                           | its 10 Hz flight path, and the mechanism that lets a trained
    |                                           | policy fly the plant (a tiny PPO trained here, saved, loaded
    |                                           | through set_controller, stepped, snapshot/restore exact). The
    |                                           | mechanism is proven here; the policy's QUALITY is the report's.
2   | maintainer@emeraldcoastsystemsgroup.com   | The residual bound override (EMBODIED_RESIDUAL_SCALE) is read at import and scales the correction.
3   | maintainer@emeraldcoastsystemsgroup.com   | The ctbr interface: the reference look-ahead and the rate-loop command mapping, the baseline tracking the ramp under thrust jitter, a tiny ctbr policy flying the plant through set_controller with snapshot/restore exact, an unknown interface refused.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
from embodied_worker import Plant  # noqa: E402
from tasks.hover_leg import HOLD_S, HOME, LEG, OBS_SIZE, RESIDUAL_SCALE, HoverLegEnv, baseline_policy, evaluate, motor_fractions, verdict  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "recon-mini.xml")


def test_shapes_and_targets() -> None:
    env = HoverLegEnv(seed=1)
    obs, _ = env.reset(seed=1)
    assert obs.shape == (OBS_SIZE,) and env.action_space.shape == (4,)
    assert np.allclose(obs[:3], 0.0, atol=1e-6), "spawned at the target: zero error"
    for _ in range(int(HOLD_S * 50) + 1):
        obs, _r, _t, _tr, info = env.step(env.baseline_action())
    assert np.allclose(env.target, HOME + LEG), "after the hold the target is the leg's end"
    assert info["t"] > HOLD_S


def test_residual_zero_equals_the_plants_controller() -> None:
    a = HoverLegEnv(seed=2, residual=True)
    b = HoverLegEnv(seed=2, residual=False)
    a.reset(seed=2)
    b.reset(seed=2)
    for _ in range(100):
        a.step(np.zeros(4))
        b.step(b.baseline_action())
    assert np.allclose(a.plant.data.qpos, b.plant.data.qpos, atol=1e-9), "a zero residual flies exactly the PID trajectory"
    u = motor_fractions(np.full(4, 0.5), np.array([1.0, -1.0, 0.0, 0.5]), True)
    assert np.allclose(u, [0.75, 0.25, 0.5, 0.625]), "a bounded correction of RESIDUAL_SCALE per unit action"
    assert RESIDUAL_SCALE == 0.25


def test_baseline_evaluation_reports_the_flight_path() -> None:
    r = evaluate(baseline_policy, [100, 101])
    assert r["crashRate"] == 0.0 and r["successRate"] == 1.0
    assert r["holdEndErrM"] < 0.03 and r["legEndErrM"] < 0.03
    assert len(r["trajectory"]) >= 70, "10 Hz over an 8 s episode"
    assert all(len(p) == 3 for p in r["trajectory"])
    assert np.allclose(r["targets"][1], HOME + LEG)
    end = np.array(r["trajectory"][-1])
    assert np.linalg.norm(end - (HOME + LEG)) < 0.05


def test_a_trained_policy_flies_the_plant(tmp_path) -> None:
    pytest.importorskip("stable_baselines3")
    from stable_baselines3 import PPO
    env = HoverLegEnv(seed=0, residual=True)
    model = PPO("MlpPolicy", env, seed=0, n_steps=256, batch_size=64, verbose=0, device="cpu")
    model.learn(total_timesteps=512)
    file = "hover-leg-ppo-residual-test.zip"
    model.save(str(tmp_path / file))
    with open(FIXTURE, encoding="utf-8") as fh:
        plant = Plant(fh.read(), seed=4)
    assert plant.set_controller({"kind": "pid"}, str(tmp_path)) == {"kind": "pid"}
    with pytest.raises(FileNotFoundError):
        plant.set_controller({"kind": "policy", "file": "../nope.zip"}, str(tmp_path))
    set_ = plant.set_controller({"kind": "policy", "file": file, "residual": True}, str(tmp_path))
    assert set_ == {"kind": "policy", "file": file, "residual": True, "interface": "motors"}
    r = None
    for _ in range(120):
        r = plant.step({"x": 0.6, "y": 0.6, "z": 2.075, "yaw": 0.0}, "takeoff", 0.05)
    assert r["controller"] == f"policy:{file}"
    assert r["contact"] is None and abs(r["z"] - 2.075) < 0.3, "a barely trained residual policy still flies near the PID's hover"
    snap = plant.snapshot()
    assert snap["policy"]["count"] > 0
    after = plant.step({"x": 0.6, "y": 0.6, "z": 2.075, "yaw": 0.0}, "hover", 0.05)
    plant.restore(snap)
    again = plant.step({"x": 0.6, "y": 0.6, "z": 2.075, "yaw": 0.0}, "hover", 0.05)
    assert json.dumps(after) == json.dumps(again), "restore replays the policy's state too"


def test_verdict_needs_every_facet() -> None:
    base = {"meanErrM": 0.125, "holdEndErrM": 0.006, "legEndErrM": 0.006, "crashRate": 0.0}
    faster_but_sloppier = {"meanErrM": 0.100, "holdEndErrM": 0.018, "legEndErrM": 0.020, "crashRate": 0.0}
    v = verdict(base, faster_but_sloppier)
    assert v["facets"] == {"meanError": True, "endpoints": False, "crashes": True} and not v["beats"], "reaching the leg sooner but settling worse is not a win"
    better = {"meanErrM": 0.110, "holdEndErrM": 0.005, "legEndErrM": 0.006, "crashRate": 0.0}
    assert verdict(base, better)["beats"]
    crashy = dict(better, crashRate=0.1)
    assert not verdict(base, crashy)["beats"]


def test_the_residual_bound_can_be_overridden_for_an_experiment(monkeypatch):
    import importlib
    import tasks.hover_leg as hl
    monkeypatch.setenv("EMBODIED_RESIDUAL_SCALE", "0.1")
    importlib.reload(hl)
    try:
        assert hl.RESIDUAL_SCALE == 0.1
        assert hl.motor_fractions(np.full(4, 0.5), np.ones(4), residual=True).tolist() == [0.6] * 4
    finally:
        monkeypatch.delenv("EMBODIED_RESIDUAL_SCALE")
        importlib.reload(hl)
        assert hl.RESIDUAL_SCALE == 0.25


def test_ctbr_interface_commands_the_rate_loop_and_sees_the_reference_ahead() -> None:
    from tasks.hover_leg import CTBR_HORIZON, CTBR_LOOKAHEAD_S, OBS_SIZE_CTBR, OMEGA_MAX, V_REF, ctbr_command, observation_ctbr, reference, reference_velocity
    env = HoverLegEnv(seed=3, interface="ctbr")
    obs, _ = env.reset(seed=3)
    assert obs.shape == (OBS_SIZE_CTBR,) and OBS_SIZE_CTBR == 3 * CTBR_HORIZON + 19
    assert np.allclose(obs[: 3 * CTBR_HORIZON], 0.0, atol=1e-6), "at home during the hold every reference point ahead is where the body is"
    # The reference ramps at the autopilot's pace after the hold and the look-ahead is extrapolated from the setpoint's velocity.
    assert np.allclose(reference(HOLD_S - 0.1), HOME) and np.allclose(reference_velocity(HOLD_S + 0.5), [V_REF, 0, 0])
    assert np.allclose(reference(HOLD_S + 0.7), HOME + [0.7, 0, 0], atol=1e-9) and np.allclose(reference(HOLD_S + 5), HOME + LEG)
    ahead = observation_ctbr(HOME, np.zeros(3), np.eye(3), np.zeros(3), HOME + [0.2, 0, 0], np.array([V_REF, 0, 0]), np.zeros(4))
    assert np.allclose(ahead[0:3], [0.2 + V_REF * CTBR_LOOKAHEAD_S, 0, 0]) and np.allclose(ahead[27:30], [0.2 + V_REF * CTBR_LOOKAHEAD_S * 10, 0, 0])
    # The action maps to a collective thrust and body rates; the plant's rate loop makes a roll-rate command a motor differential.
    c = env.plant.controller
    collective, omega_cmd = ctbr_command(np.array([0.0, 0.5, 0.0, 0.0]), c)
    assert abs(collective - 0.5 * len(c.rotors) * c.f_max) < 1e-9 and np.allclose(omega_cmd, [0.5 * OMEGA_MAX[0], 0, 0])
    level = c.rate_motors(collective, np.zeros(3), np.zeros(3))
    assert np.allclose(level, level[0]), "no rate demand at rest: four equal motors"
    rolled = c.rate_motors(collective, omega_cmd, np.zeros(3))
    assert not np.allclose(rolled, rolled[0]) and abs(rolled.sum() - level.sum()) < 1e-6, "a roll-rate demand is a differential that keeps the collective"


def test_ctbr_baseline_tracks_the_ramp_under_thrust_jitter() -> None:
    from tasks.hover_leg import THRUST_JITTER
    assert THRUST_JITTER == 0.1
    r = evaluate(baseline_policy, [100, 101, 102], interface="ctbr")
    assert r["crashRate"] == 0.0
    assert r["holdEndErrM"] < 0.06 and r["legEndErrM"] < 0.06, f"the controller with feed-forward stays within centimetres of the ramp under +-10 % thrust: {r['holdEndErrM']:.3f} / {r['legEndErrM']:.3f}"
    assert r["meanErrM"] < 0.08, r["meanErrM"]
    gains = [HoverLegEnv(seed=s, interface="ctbr") for s in (100, 101)]
    for g, s in zip(gains, (100, 101)):
        g.reset(seed=s)
    assert gains[0].thrust_gain != gains[1].thrust_gain and all(abs(g.thrust_gain - 1.0) <= THRUST_JITTER for g in gains), "every episode draws its own thrust gain from its seed"


def test_a_ctbr_policy_flies_the_plant_through_its_rate_loop(tmp_path) -> None:
    pytest.importorskip("stable_baselines3")
    from stable_baselines3 import PPO
    env = HoverLegEnv(seed=5, interface="ctbr")
    model = PPO("MlpPolicy", env, n_steps=64, batch_size=32, seed=5, verbose=0, device="cpu")
    model.learn(total_timesteps=128)
    model.save(str(tmp_path / "tiny-ctbr.zip"))
    with open(FIXTURE, encoding="utf-8") as fh:
        mjcf = fh.read()
    plant = Plant(mjcf, seed=5)
    assert plant.set_controller({"kind": "policy", "file": "tiny-ctbr.zip", "interface": "ctbr"}, str(tmp_path)) == {"kind": "policy", "file": "tiny-ctbr.zip", "residual": False, "interface": "ctbr"}
    assert plant.policy is not None and plant.policy.interface == "ctbr"
    for _ in range(5):
        r = plant.step({"x": 0.6, "y": 0.6, "z": 2.075, "yaw": 0.0}, "takeoff", 0.2)
    assert r["controller"] == "policy:tiny-ctbr.zip"
    assert plant.policy.held_cmd is not None and plant.policy.count > 0, "the policy was asked for a command and the rate loop ran"
    snap = plant.snapshot()
    a = plant.step({"x": 0.6, "y": 0.6, "z": 2.075, "yaw": 0.0}, "hover", 0.2)
    plant.restore(snap)
    b = plant.step({"x": 0.6, "y": 0.6, "z": 2.075, "yaw": 0.0}, "hover", 0.2)
    assert a == b, "snapshot/restore replays a ctbr policy exactly"
    with pytest.raises(ValueError):
        plant.set_controller({"kind": "policy", "file": "tiny-ctbr.zip", "interface": "teleport"}, str(tmp_path))
