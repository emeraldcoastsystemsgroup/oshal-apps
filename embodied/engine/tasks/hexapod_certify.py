"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 / B30 -- the spider-18's certification gate, the hexapod's own
    |                                           | shape of the drone's B19: a trained policy is replayed on the plant,
    |                                           | control step by control step, through the fall limit and the servo's
    |                                           | torque limits (the design's continuous torque for the RMS over an
    |                                           | episode, the model's stall torque for the peak), re-measured against
    |                                           | the CPG on the evaluation seeds, and -- for a walk policy -- rolled
    |                                           | over once to prove the mirror rule still carries it. The certificate
    |                                           | is written beside the policy, bound to the policy file's sha256 and
    |                                           | the engine's build hash. `load_certified` is the only door through
    |                                           | which the plant plays a policy and refuses by name without a passing,
    |                                           | matching certificate. `PolicyGait` is the plant's policy controller:
    |                                           | it observes exactly what the task showed the policy and shapes the
    |                                           | CPG; inference stays in the container (ADR-152 Q3).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from typing import Callable

import numpy as np

ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE_DIR)
sys.path.insert(0, os.path.join(ENGINE_DIR, "container"))
from embodied_hexapod import CONTROL_DT_S, HexapodPlant, refuse  # noqa: E402
from hexapod_gaits import ACTUATOR_ORDER, GaitShape, InversionDetector, clamp_command, cpg_targets  # noqa: E402
from tasks.hexapod_walk import EVAL_SEEDS, RECIPES, RESIDUAL_RAD, HexapodWalkEnv, aggregate, baseline_policy, observation, verdict  # noqa: E402

#: The certificate sits beside the policy it binds: `<policy>.certificate.json` (listed with the reports, task hexapod-certify).
CERT_SUFFIX = ".certificate.json"
#: The tasks a gait policy may be certified for; a jump policy has no gait to play.
CERTIFIABLE = ("walk", "inverted")
#: The first refusals the certificate lists in full.
MAX_REFUSALS_LISTED = 20
#: The roll a walk policy must survive: the inverted task's episode on this evaluation seed.
ROLL_SEED = EVAL_SEEDS[0]

Policy = Callable[[np.ndarray, HexapodWalkEnv], object]


def policy_sha256(path: str) -> str:
    """@description The policy file's digest, what a certificate binds to. @param path The zip. @returns Hex sha256."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def certificate_path(policy_path: str) -> str:
    """@description Where a policy's certificate lives. @param policy_path The zip. @returns The .certificate.json beside it."""
    stem = policy_path[:-4] if policy_path.endswith(".zip") else policy_path
    return stem + CERT_SUFFIX


def engine_build_hash() -> str:
    """@description The engine's build hash, the bridge's own function. @returns Hex sha256 over the runtime files."""
    from embodied_engine_bridge import build_hash  # noqa: PLC0415 -- the bridge imports this module lazily too
    return build_hash()


def torque_limits(plant: HexapodPlant, continuous_nm: float) -> dict:
    """@description The limits a replay is held to: the model's stall torque (its force range) for the peak, the design's
    continuous torque for the RMS over an episode. @param plant Any plant of the model. @param continuous_nm From the design.
    @returns {continuousNm, stallNm}. @raises bad_request when the continuous torque is not a positive number."""
    try:
        continuous = float(continuous_nm)
    except (TypeError, ValueError):
        continuous = float("nan")
    if not (continuous > 0.0 and np.isfinite(continuous)):
        refuse("bad_request", f"continuousNm must be a positive number of newton-metres, got {continuous_nm!r}")
    stall = float(np.max(np.abs(plant.model.actuator_forcerange[plant.act_ids])))
    return {"continuousNm": round(continuous, 4), "stallNm": round(stall, 4)}


def _episode(env: HexapodWalkEnv, policy: Policy, seed: int, limits: dict, refused: list) -> tuple[dict, np.ndarray, int]:
    """@description One replayed episode: every control step through the fall limit, the torque RMS and peak at the end.
    @returns The scored row, the per-actuator RMS torque, the steps run."""
    obs, _ = env.reset(seed=seed)
    sumsq = np.zeros(len(ACTUATOR_ORDER))
    total, steps, done = 0.0, 0, False
    while not done:
        obs, r, term, trunc, _info = env.step(policy(obs, env))
        total += r
        steps += 1
        sumsq += np.square(np.array(env.state["jointTorqueNm"], dtype=float))
        done = term or trunc
        if term:
            refused.append({"episode": seed, "step": steps, "reason": f"fell at {env.t:.2f} s"})
    rms = np.sqrt(sumsq / max(1, steps))
    for name, value in zip(ACTUATOR_ORDER, rms):
        if value > limits["continuousNm"]:
            refused.append({"episode": seed, "actuator": name, "reason": f"rms torque {value:.3f} Nm above the continuous {limits['continuousNm']:.3f} Nm"})
    peak = float(env.plant.peak_torque.max())
    if peak > limits["stallNm"] + 1e-6:
        refused.append({"episode": seed, "actuator": ACTUATOR_ORDER[int(env.plant.peak_torque.argmax())], "reason": f"peak torque {peak:.3f} Nm above the stall {limits['stallNm']:.3f} Nm"})
    return env.score(total), rms, steps


def replay(policy: Policy, task: str, jump: str, recipe: str, seeds: list[int], limits: dict) -> dict:
    """@description Replay a policy through the gate on the task's own episodes: the fall limit every step, the torque limits
    per episode, the task's facets aggregated as the training report aggregates them. @param policy (obs, env) -> action.
    @param task walk | inverted. @param jump The option. @param recipe residual | shape. @param seeds Episode seeds.
    @param limits torque_limits(). @returns checked, refused, refusedCount, torque and the aggregate."""
    rows, refused, checked = [], [], 0
    rms_max = np.zeros(len(ACTUATOR_ORDER))
    peak = 0.0
    for seed in seeds:
        env = HexapodWalkEnv(task, jump, seed, recipe=recipe)
        row, rms, steps = _episode(env, policy, seed, limits, refused)
        rows.append(row)
        checked += steps
        rms_max = np.maximum(rms_max, rms)
        peak = max(peak, float(env.plant.peak_torque.max()))
    out = aggregate(rows, task)
    out.pop("rows", None)
    out.update({"checked": checked, "refused": refused[:MAX_REFUSALS_LISTED], "refusedCount": len(refused),
                "torque": {"rmsMaxNm": round(float(rms_max.max()), 4), "rmsMaxActuator": ACTUATOR_ORDER[int(rms_max.argmax())], "peakNm": round(peak, 4)}})
    return out


def _report(file: str, report_dir: str) -> tuple[dict, str, str]:
    """@description The training report a certification starts from, by name in the report directory. @returns (report, its path, the policy path)."""
    name = str(file or "")
    path = os.path.join(report_dir, name)
    if not name or name != os.path.basename(name) or not name.endswith(".json") or not os.path.isfile(path):
        refuse("report_not_found", f"no report {name!r} in the report directory (a report is named, never pathed)")
    with open(path, encoding="utf-8") as fh:
        report = json.load(fh)
    policy_file = report.get("policyFile")
    if not isinstance(policy_file, str) or not policy_file:
        refuse("no_policy", f"{name} carries no policyFile: a baseline-only or check report has nothing to certify")
    policy_path = os.path.join(report_dir, os.path.basename(policy_file))
    if not os.path.isfile(policy_path):
        refuse("policy_not_found", f"the report names {policy_file} but it is not beside it")
    return report, path, policy_path


def _task_of(report: dict) -> tuple[str, str, str]:
    """@description The task, jump option and recipe a report trained. @raises bad_task for a jump (or unknown) task or recipe."""
    task = str(report.get("task", "")).replace("hexapod-", "", 1)
    recipe = str(report.get("mode", "residual"))
    jump = str(report.get("jump", "legs-hop"))
    if task not in CERTIFIABLE:
        refuse("bad_task", f"only a {' or '.join(CERTIFIABLE)} policy plays a gait; this report is {report.get('task')!r}")
    if recipe not in RECIPES:
        refuse("bad_task", f"unknown recipe {recipe!r}: one of {RECIPES}")
    return task, jump, recipe


def _load_ppo(policy_path: str):
    from stable_baselines3 import PPO  # noqa: PLC0415 -- torch only when a policy is replayed or played
    model = PPO.load(policy_path, device="cpu")

    def policy(obs: np.ndarray, _env: HexapodWalkEnv) -> np.ndarray:
        action, _ = model.predict(obs, deterministic=True)
        return action
    return model, policy


def certify_policy(file: str, report_dir: str | None, continuous_nm: float, seeds: list[int] | None = None, roll: bool = True) -> dict:
    """@description The gate: replay the report's policy and the CPG on the evaluation seeds through the fall and torque
    limits, re-measure the verdict, roll a walk policy over once, and write the certificate beside the policy, bound to the
    policy's sha256 and the engine's build hash. `ok` is the safety verdict (no refusal, the roll survived);
    `policyBeatsBaseline` is reported beside it, never folded in. @param file The training report's file name.
    @param report_dir The report directory. @param continuous_nm The design's continuous torque. @param seeds The
    evaluation seeds (EVAL_SEEDS). @param roll Whether a walk policy is rolled over. @returns The certificate."""
    if not report_dir:
        refuse("no_report_dir", "the engine has no report directory to certify from")
    started = time.monotonic()
    report, report_path, policy_path = _report(file, report_dir)
    task, jump, recipe = _task_of(report)
    seeds = [int(s) for s in (seeds or EVAL_SEEDS)]
    probe = HexapodWalkEnv(task, jump, seeds[0], recipe=recipe)
    limits = torque_limits(probe.plant, continuous_nm)
    _model, policy = _load_ppo(policy_path)
    baseline = replay(baseline_policy, task, jump, recipe, seeds, limits)
    learned = replay(policy, task, jump, recipe, seeds, limits)
    v = verdict(task, baseline, learned)
    rolled = replay(policy, "inverted", jump, recipe, [ROLL_SEED], limits) if (roll and task == "walk") else None
    roll_ok = rolled is None or (rolled["refusedCount"] == 0 and rolled["recovered"] == 1)
    refused = list(learned["refused"]) + ([] if rolled is None else [{**r, "roll": True} for r in rolled["refused"]])
    if rolled is not None and rolled["recovered"] != 1:
        refused.append({"episode": ROLL_SEED, "roll": True, "reason": "did not recover forward speed after the roll"})
    cert = {"task": "hexapod-certify", "seed": report.get("seed"), "reportFile": os.path.basename(report_path), "policyFile": os.path.basename(policy_path),
            "policySha256": policy_sha256(policy_path), "buildHash": engine_build_hash(), "mode": recipe, "jump": jump, "certifiedTask": task, "evalSeeds": seeds,
            "limits": limits, "unit": "control steps", "checked": learned["checked"] + (0 if rolled is None else rolled["checked"]),
            "refused": refused[:MAX_REFUSALS_LISTED], "refusedCount": len(refused), "ok": len(refused) == 0 and roll_ok,
            "baseline": baseline, "policy": learned, "verdict": v["facets"], "policyBeatsBaseline": v["beats"], "roll": rolled,
            "certifiedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "wallSeconds": round(time.monotonic() - started, 2)}
    with open(certificate_path(policy_path), "w", encoding="utf-8") as fh:
        json.dump(cert, fh, indent=2)
    return cert


def read_certificate(policy_path: str) -> dict | None:
    """@description The certificate beside a policy, or None. @param policy_path The zip. @returns The dict or None."""
    path = certificate_path(policy_path)
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_certified(policy_path: str):
    """@description The only door to a playing policy: the zip must exist and its certificate must be ok, carry the zip's
    current sha256 and this engine's build hash. @param policy_path The zip. @returns (model, certificate).
    @raises policy_not_found, policy_not_certified by name with the reason."""
    if not os.path.isfile(policy_path):
        refuse("policy_not_found", f"no policy {os.path.basename(policy_path)} in the report directory")
    cert = read_certificate(policy_path)
    name = os.path.basename(policy_path)
    if cert is None:
        refuse("policy_not_certified", f"{name} has no certificate -- POST /physics/hexapod/certify first")
    if cert.get("ok") is not True:
        refuse("policy_not_certified", f"{name}'s certificate refused it ({cert.get('refusedCount')} refusals)")
    if cert.get("policySha256") != policy_sha256(policy_path):
        refuse("policy_not_certified", f"{name} changed since it was certified")
    if cert.get("buildHash") != engine_build_hash():
        refuse("policy_not_certified", f"{name} was certified on another engine build; certify again")
    model, _policy = _load_ppo(policy_path)
    return model, cert


class PolicyGait:
    """@description The plant's policy controller (the hexapod's `policy:<file>`): each control period it observes exactly what
    the task showed the policy -- joints, gyro, accelerometer, its own previous action, the command -- and shapes the CPG
    (or corrects its targets, by recipe), through the mirror rule when its own detector says inverted."""

    def __init__(self, policy_path: str) -> None:
        self.model, self.certificate = load_certified(policy_path)
        self.file = os.path.basename(policy_path)
        self.recipe = str(self.certificate.get("mode", "shape"))
        self.n_act = GaitShape.SIZE if self.recipe == "shape" else len(ACTUATOR_ORDER)
        self.reset(False)

    @property
    def name(self) -> str:
        """@description The controller as the load reply names it. @returns policy:<file>."""
        return f"policy:{self.file}"

    def reset(self, inverted: bool) -> None:
        """@description A new episode: the gait clock, the previous action and the detector start over. @param inverted The pose's truth."""
        self.t = 0.0
        self.prev_action = np.zeros(self.n_act)
        self.detector = InversionDetector(bool(inverted))

    def targets(self, plant: HexapodPlant, state: dict, cmd: dict) -> tuple[np.ndarray, dict]:
        """@description The eighteen targets for this control period. @param plant The plant (its geometry). @param state Its
        state now. @param cmd {vx, vy, yawRate}. @returns (targets, {inverted, action})."""
        self.detector.update(state["accelMps2"])
        c = clamp_command(cmd)
        action, _ = self.model.predict(observation(state, self.prev_action, c), deterministic=True)
        a = np.clip(np.asarray(action, dtype=float).reshape(-1), -1.0, 1.0)
        if self.recipe == "shape":
            targets = np.array(cpg_targets(plant.geo, self.t, cmd, self.detector.inverted, GaitShape.from_action(a)))
        else:
            targets = np.array(cpg_targets(plant.geo, self.t, cmd, self.detector.inverted)) + RESIDUAL_RAD * a
        self.prev_action = a
        self.t += CONTROL_DT_S
        return targets, {"controller": self.name, "inverted": self.detector.inverted, "action": [round(float(x), 4) for x in a]}
