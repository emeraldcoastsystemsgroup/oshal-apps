"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant -- the generic reach task for a plant built
    |                                           | from a design (embodied_plant.py): the target comes from the brief's
    |                                           | requirement line ("lifts 2 kg to 300 mm in 5 s" -> the payload's
    |                                           | rest position plus a displacement, the load, the time), the
    |                                           | baseline is a PD controller on the joint targets inverse
    |                                           | kinematics computes for that pose (exact for one joint), the
    |                                           | policy is a bounded PPO residual on those targets (the hexapod
    |                                           | recipe: the zero action IS the baseline), the reward is the
    |                                           | tracking error plus the torque excess over each drive's
    |                                           | continuous rating -- the rows' numbers out of the spec, never an
    |                                           | env literal -- and the report is the hexapod report's shape
    |                                           | (baseline beside policy, facets, verdict) at
    |                                           | plant-<project>-reach-seed<S>.json. The gate replays a policy
    |                                           | through the rows' limits and the task's time and writes
    |                                           | <policy>.certificate.json bound to the policy's sha256, the
    |                                           | engine's build hash and the spec's digest, reusing the hexapod
    |                                           | gate's functions by import. PolicyReach is the plant's
    |                                           | `policy:<file>` door for a command {payloadTargetM}.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from typing import Callable

import gymnasium as gym
import numpy as np
from gymnasium import spaces

ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE_DIR)
sys.path.insert(0, os.path.join(ENGINE_DIR, "container"))
from embodied_hexapod import refuse  # noqa: E402
from embodied_plant import CONTROL_DT_S, PlantSession, mesh_bytes, spec_sha256, validate_spec  # noqa: E402
from tasks.hexapod_certify import MAX_REFUSALS_LISTED, certificate_path, engine_build_hash, load_certified, policy_sha256  # noqa: E402
from tasks.hexapod_walk import EVAL_SEEDS  # noqa: E402

#: The residual's reach per actuator type: a policy may move a hinge target this far (rad) or a slide target this far (m).
RESIDUAL_RAD = float(os.environ.get("EMBODIED_PLANT_RESIDUAL_RAD", "0.15"))
RESIDUAL_M = float(os.environ.get("EMBODIED_PLANT_RESIDUAL_M", "0.05"))
#: An episode runs this many times the brief's time, so a late arrival is measured rather than cut.
EPISODE_FACTOR = float(os.environ.get("EMBODIED_PLANT_EPISODE_FACTOR", "1.5"))
#: The payload is "at" the target within this distance, held for HOLD_S.
TOLERANCE_M = float(os.environ.get("EMBODIED_PLANT_TOLERANCE_M", "0.005"))
HOLD_S = 0.25
#: Reward weights: tracking error (per metre), the torque excess over the continuous rating (per N·m of mean excess), the action change, the alive bonus.
W_TRACK = float(os.environ.get("EMBODIED_PLANT_W_TRACK", "4.0"))
W_TORQUE = float(os.environ.get("EMBODIED_PLANT_W_TORQUE", "1.0"))
W_SMOOTH = float(os.environ.get("EMBODIED_PLANT_W_SMOOTH", "0.05"))
W_ALIVE = 0.5
#: Observation scaling so every channel is of order one.
VEL_SCALE = 10.0
ACCEL_SCALE = 10.0
ERR_SCALE = 0.3
FACETS = ("reached", "reachedS", "finalErrorM", "rmsTorqueMaxNm")
REPORT_TASK = "plant-reach"


def _num(v, where: str) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        refuse("bad_task", f"{where} must be a number")
    if not math.isfinite(x):
        refuse("bad_task", f"{where} must be finite")
    return x


def task_spec(task, plant: PlantSession) -> dict:
    """@description The task as the env runs it: the payload target in the world frame (the rest position plus `deltaM`,
    or `posM` as given), the time the brief allows and the load the brief names (it must be the spec's payload).
    @param task {deltaM | posM, timeS, loadKg?, line?}. @param plant The plant (its payload's rest position).
    @returns {targetPosM, deltaM, timeS, loadKg, line}. @raises bad_task, no_payload by name."""
    if not isinstance(task, dict):
        refuse("bad_task", "task must be {deltaM | posM, timeS, loadKg?}")
    if plant.rest_payload is None:
        refuse("no_payload", "the reach task moves the payload: the spec has none")
    rest = np.array(plant.rest_payload)
    if task.get("posM") is not None:
        target = np.array([_num(v, "task.posM") for v in task["posM"]])
    elif task.get("deltaM") is not None:
        target = rest + np.array([_num(v, "task.deltaM") for v in task["deltaM"]])
    else:
        refuse("bad_task", "task needs deltaM (a displacement of the payload from rest) or posM (a world position)")
    if target.shape != (3,):
        refuse("bad_task", "task.posM / deltaM must be three numbers")
    time_s = _num(task.get("timeS"), "task.timeS")
    if time_s <= 0:
        refuse("bad_task", "task.timeS must be positive")
    load = task.get("loadKg")
    if load is not None and abs(_num(load, "task.loadKg") - plant.spec["payload"]["massKg"]) > 1e-9:
        refuse("bad_task", f"task.loadKg {load} is not the spec's payload mass {plant.spec['payload']['massKg']} kg: the mechanism's payload is the brief's load")
    return {"targetPosM": [round(float(v), 6) for v in target], "deltaM": [round(float(v), 6) for v in (target - rest)], "timeS": time_s, "loadKg": plant.spec["payload"]["massKg"], "line": task.get("line")}


def observation(state: dict, prev_action: np.ndarray, error: np.ndarray, t_fraction: float, limits: np.ndarray) -> np.ndarray:
    """@description What the policy sees: joint positions, velocities, each drive's motor torque over its continuous rating,
    the gyro and accelerometer, the payload's error to the target, its previous action and the episode's time fraction.
    The plant's policy controller builds it from the same state dict. @returns The float32 vector."""
    return np.concatenate([
        np.array(state["jointPos"], dtype=float), np.array(state["jointVel"], dtype=float) / VEL_SCALE, np.array(state["motorTorqueNm"], dtype=float) / limits,
        np.array(state["gyroRadS"], dtype=float) / VEL_SCALE, np.array(state["accelMps2"], dtype=float) / ACCEL_SCALE,
        np.asarray(error, dtype=float) / ERR_SCALE, np.asarray(prev_action, dtype=float), np.array([t_fraction], dtype=float),
    ]).astype(np.float32)


class PlantReachEnv(gym.Env):
    """@description The plant reaching the brief's target with a learned residual on the PD baseline. Observation: joint
    positions and velocities, motor torques over their ratings, the IMU, the payload error, the previous action, the
    time fraction. Action (one per actuator): a correction in [-1, 1] scaled by the residual reach and added to the
    inverse-kinematics targets, so the zero action IS the baseline. Reward per step: the alive bonus minus the tracking
    error, the torque excess over the continuous ratings and the action change."""

    metadata = {"render_modes": []}

    def __init__(self, spec, task, seed: int = 0) -> None:
        super().__init__()
        self.plant = PlantSession(spec, seed)
        self.task = task_spec(task, self.plant)
        self.base_seed, self.episode = int(seed), 0
        n = len(self.plant.actuators)
        self.n_act = n
        self.reach = np.array([RESIDUAL_RAD if a["type"] == "hinge" else RESIDUAL_M for a in self.plant.actuators])
        self.limits = np.array([a["continuousNm"] for a in self.plant.actuators])
        self.stalls = np.array([a["stallNm"] for a in self.plant.actuators])
        self.ik = self.plant.ik_targets(self.task["targetPosM"])
        self.base_targets = np.array(self.ik["pdTargets"])
        self.target = np.array(self.task["targetPosM"])
        self.observation_space = spaces.Box(low=-np.inf, high=np.inf, shape=(3 * n + 6 + 3 + n + 1,), dtype=np.float32)
        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(n,), dtype=np.float32)
        self.prev_action = np.zeros(n)
        self.state: dict = {}
        self.t = 0.0
        self._clear_measurements()

    def _clear_measurements(self) -> None:
        self.reached_s: float | None = None
        self.in_tolerance_since: float | None = None
        self.sumsq = np.zeros(self.n_act)
        self.steps = 0
        self.peak = np.zeros(self.n_act)
        self.excess_steps = 0

    @property
    def episode_length_s(self) -> float:
        """@description How long an episode may run: the brief's time times EPISODE_FACTOR."""
        return self.task["timeS"] * EPISODE_FACTOR

    def error(self) -> np.ndarray:
        """@description The payload's offset from the target, in the world frame. @returns [dx, dy, dz]."""
        return self.target - np.array(self.state["payloadPosM"])

    def _obs(self) -> np.ndarray:
        return observation(self.state, self.prev_action, self.error(), min(1.0, self.t / self.episode_length_s), self.limits)

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        episode_seed = (seed if seed is not None else self.base_seed) + self.episode
        self.episode += 1
        self.state = self.plant.reset(episode_seed)
        self.t = 0.0
        self.prev_action = np.zeros(self.n_act)
        self._clear_measurements()
        return self._obs(), {}

    def _measure(self) -> None:
        """@description What the score needs from this step: the first moment the payload is within tolerance and stays for HOLD_S, the torque RMS and peak."""
        dist = float(np.linalg.norm(self.error()))
        if dist <= TOLERANCE_M:
            if self.in_tolerance_since is None:
                self.in_tolerance_since = self.t
            if self.reached_s is None and self.t - self.in_tolerance_since >= HOLD_S - 1e-9:
                self.reached_s = round(self.in_tolerance_since, 3)
        else:
            self.in_tolerance_since = None
        torque = np.abs(np.array(self.state["motorTorqueNm"], dtype=float))
        self.sumsq += torque * torque
        self.steps += 1
        self.peak = np.maximum(self.peak, torque)
        if np.any(torque > self.limits):
            self.excess_steps += 1

    def _reward(self, a: np.ndarray) -> float:
        smooth = W_SMOOTH * float(np.linalg.norm(a - self.prev_action)) / math.sqrt(self.n_act)
        track = float(np.linalg.norm(self.error()))
        excess = float(np.mean(np.maximum(0.0, np.abs(np.array(self.state["motorTorqueNm"], dtype=float)) - self.limits)))
        return W_ALIVE - W_TRACK * track - W_TORQUE * excess - smooth

    def step(self, action):
        a = np.zeros(self.n_act) if action is None else np.clip(np.asarray(action, dtype=float).reshape(-1), -1.0, 1.0)
        targets = self.base_targets + self.reach * a
        self.state = self.plant.step(targets, CONTROL_DT_S)
        self.t += CONTROL_DT_S
        self._measure()
        reward = self._reward(a)
        self.prev_action = a
        truncated = self.t >= self.episode_length_s - 1e-9
        return self._obs(), float(reward), False, bool(truncated), {"t": self.t, "reachedS": self.reached_s}

    def score(self, total_return: float) -> dict:
        """@description The episode's measurements: when the payload reached the target, the final error, each drive's RMS
        and peak motor torque, the energy, whether any drive ran above its rating. @param total_return The summed reward."""
        rms = np.sqrt(self.sumsq / max(1, self.steps))
        names = [a["joint"] for a in self.plant.actuators]
        return {"reachedS": self.reached_s, "reachedInTime": bool(self.reached_s is not None and self.reached_s <= self.task["timeS"]),
                "finalErrorM": round(float(np.linalg.norm(self.error())), 6), "rmsMotorTorqueNm": dict(zip(names, [round(float(v), 4) for v in rms])),
                "peakMotorTorqueNm": dict(zip(names, [round(float(v), 4) for v in self.peak])), "overRatingSteps": int(self.excess_steps),
                "energyJ": round(self.plant.energy_j, 4), "seconds": round(self.t, 3), "return": round(float(total_return), 3)}


Policy = Callable[[np.ndarray, PlantReachEnv], object]


def baseline_policy(_obs: np.ndarray, env: PlantReachEnv) -> np.ndarray:
    """@description The zero action: the PD baseline on the inverse-kinematics targets exactly. @returns Zeros."""
    return np.zeros(env.n_act)


def _mean(rows: list[dict], key: str):
    vals = [r[key] for r in rows if r.get(key) is not None]
    return None if not vals else round(float(np.mean(vals)), 4)


def aggregate(rows: list[dict], _task: str = REPORT_TASK) -> dict:
    """@description The facets over scored episodes, as a report carries them: reached counted, the rest averaged, the
    torque RMS as the worst drive over every episode; `rows` kept. @param rows env.score() rows. @returns The aggregate."""
    worst, worst_name, peak = 0.0, None, 0.0
    for r in rows:
        for name, v in r["rmsMotorTorqueNm"].items():
            if v > worst:
                worst, worst_name = v, name
        peak = max(peak, max(r["peakMotorTorqueNm"].values()) if r["peakMotorTorqueNm"] else 0.0)
    return {"episodes": len(rows), "meanReturn": _mean(rows, "return"), "reached": int(sum(r["reachedInTime"] for r in rows)), "reachedS": _mean(rows, "reachedS"),
            "finalErrorM": _mean(rows, "finalErrorM"), "rmsTorqueMaxNm": round(worst, 4), "rmsTorqueMaxActuator": worst_name, "peakTorqueNm": round(peak, 4),
            "overRatingSteps": int(sum(r["overRatingSteps"] for r in rows)), "energyJ": _mean(rows, "energyJ"), "rows": rows}


def _no_higher(p, b) -> bool:
    return p is not None and (b is None or p <= b)


def verdict(baseline: dict, policy: dict) -> dict:
    """@description The facets a policy must ALL win: no fewer episodes reached in time, a time to target no later, a
    final error no larger, a worst RMS motor torque no higher. @returns facets and beats."""
    facets = {"reached": bool(policy["reached"] >= baseline["reached"]), "reachedS": _no_higher(policy["reachedS"], baseline["reachedS"]),
              "finalErrorM": _no_higher(policy["finalErrorM"], baseline["finalErrorM"]), "rmsTorqueMaxNm": bool(policy["rmsTorqueMaxNm"] <= baseline["rmsTorqueMaxNm"])}
    return {"facets": facets, "beats": all(facets.values())}


def evaluate(policy: Policy, spec, task, seeds: list[int]) -> dict:
    """@description One episode per seed, scored, then aggregated. @param policy (obs, env) -> action. @returns The aggregate."""
    rows = []
    for seed in seeds:
        env = PlantReachEnv(spec, task, seed)
        obs, _ = env.reset(seed=seed)
        total, done = 0.0, False
        while not done:
            obs, r, term, trunc, _info = env.step(policy(obs, env))
            total += r
            done = term or trunc
        rows.append(env.score(total))
    return aggregate(rows)


def report_file(project: str, seed: int) -> str:
    """@description The report's file name: plant-<project>-reach-seed<S>.json. @returns The name."""
    return f"plant-{project}-reach-seed{int(seed)}.json"


def policy_file(project: str, seed: int) -> str:
    """@description The policy's file name beside the report. @returns The name."""
    return f"plant-{project}-reach-ppo-seed{int(seed)}.zip"


def spec_for_report(spec: dict) -> dict:
    """@description The spec as a report embeds it: every mesh replaced by its sha256 (the bytes stay with the caller). @returns The copy."""
    out = dict(spec)
    parts = []
    for p in spec.get("parts", []):
        q = {k: v for k, v in p.items() if k not in ("meshStl", "meshPath")}
        b = mesh_bytes(p, "parts")
        if b is not None:
            q["meshSha256"] = hashlib.sha256(b).hexdigest()
        parts.append(q)
    out["parts"] = parts
    return out


def _spec_for_replay(report: dict, spec) -> dict:
    """@description The spec a gate replays: the request's (its digest must be the report's) or the report's own (which must carry no mesh digest without bytes)."""
    if spec is not None:
        if spec_sha256(spec) != report.get("specSha256"):
            refuse("spec_mismatch", "the spec given is not the plant the report was trained on (its digest differs)")
        return spec
    embedded = report.get("spec")
    if not isinstance(embedded, dict):
        refuse("bad_request", "the report carries no spec: pass the plant spec with the request")
    if any(isinstance(p, dict) and p.get("meshSha256") for p in embedded.get("parts", [])):
        refuse("mesh_missing", "the report's spec carries mesh digests only: pass the spec with the STL bytes to replay it")
    return embedded


def _load_ppo(policy_path: str):
    from stable_baselines3 import PPO  # noqa: PLC0415
    model = PPO.load(policy_path, device="cpu")

    def policy(obs: np.ndarray, _env: PlantReachEnv) -> np.ndarray:
        action, _ = model.predict(obs, deterministic=True)
        return action
    return model, policy


def _progress_callback(progress: Callable[[int], None] | None):
    if progress is None:
        return None
    from stable_baselines3.common.callbacks import BaseCallback  # noqa: PLC0415

    class Progress(BaseCallback):
        def _on_step(self) -> bool:
            progress(self.num_timesteps)
            return True
    return Progress()


def train(spec, task, project: str, seed: int, timesteps: int, out_dir: str, progress, report: dict) -> None:
    """@description PPO on the residual (Stable-Baselines3, CPU), the policy saved beside the report and scored on the same seeds as the baseline."""
    import stable_baselines3  # noqa: PLC0415
    import torch  # noqa: PLC0415
    from stable_baselines3 import PPO  # noqa: PLC0415
    torch.manual_seed(seed)
    env = PlantReachEnv(spec, task, seed)
    t0 = time.time()
    model = PPO("MlpPolicy", env, seed=seed, n_steps=512, batch_size=64, learning_rate=3e-4, gamma=0.99, verbose=0, device="cpu")
    model.learn(total_timesteps=timesteps, callback=_progress_callback(progress))
    file = policy_file(project, seed)
    model.save(os.path.join(out_dir, file))

    def policy(obs: np.ndarray, _env: PlantReachEnv) -> np.ndarray:
        action, _ = model.predict(obs, deterministic=True)
        return action
    report.update({"timesteps": timesteps, "trainWallS": round(time.time() - t0, 1), "policyFile": file, "sb3": stable_baselines3.__version__, "torch": torch.__version__,
                   "policy": evaluate(policy, spec, task, report["evalSeeds"])})
    v = verdict(report["baseline"], report["policy"])
    report["verdict"] = v["facets"]
    report["policyBeatsBaseline"] = v["beats"]


def run_training(spec, task, project: str, seed: int, timesteps: int, out_dir: str, seeds: list[int] | None = None, progress: Callable[[int], None] | None = None) -> dict:
    """@description Score the baseline on the evaluation seeds, train for `timesteps` (0: baseline only), write the report
    and return it. @param spec The plant spec. @param task The reach task. @param project The product (names the report).
    @param seed The run's seed. @param timesteps PPO steps. @param out_dir The report directory. @param seeds Evaluation
    seeds (EVAL_SEEDS). @param progress Called with the steps done. @returns The report."""
    import mujoco  # noqa: PLC0415
    validate_spec(spec)
    probe = PlantReachEnv(spec, task, seed)
    eval_seeds = [int(s) for s in (seeds or EVAL_SEEDS)]
    os.makedirs(out_dir, exist_ok=True)
    report: dict = {"task": REPORT_TASK, "project": project, "seed": int(seed), "specSha256": spec_sha256(spec), "spec": spec_for_report(spec), "taskSpec": probe.task,
                    "ik": probe.ik, "actuators": [{"joint": a["joint"], "continuousNm": a["continuousNm"], "stallNm": a["stallNm"], "gearRatio": a["gearRatio"]} for a in probe.plant.actuators],
                    "timesteps": 0, "residual": {"hingeRad": RESIDUAL_RAD, "slideM": RESIDUAL_M}, "toleranceM": TOLERANCE_M, "episodeS": probe.episode_length_s, "weights": {"track": W_TRACK, "torque": W_TORQUE, "smooth": W_SMOOTH},
                    "evalSeeds": eval_seeds, "facets": list(FACETS), "mujoco": mujoco.__version__, "obsSize": int(probe.observation_space.shape[0]), "actionSize": probe.n_act,
                    "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "baseline": evaluate(baseline_policy, spec, task, eval_seeds)}
    if timesteps > 0:
        train(spec, task, project, seed, timesteps, out_dir, progress, report)
    report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(os.path.join(out_dir, report_file(project, seed)), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    return report


# -- the gate -------------------------------------------------------------------------------------------------------
def _report(file: str, report_dir: str) -> tuple[dict, str, str]:
    name = str(file or "")
    path = os.path.join(report_dir, name)
    if not name or name != os.path.basename(name) or not name.startswith("plant-") or not name.endswith(".json") or not os.path.isfile(path):
        refuse("report_not_found", f"no plant report {name!r} in the report directory (a report is named, never pathed)")
    with open(path, encoding="utf-8") as fh:
        report = json.load(fh)
    if report.get("task") != REPORT_TASK:
        refuse("bad_task", f"{name} is a {report.get('task')!r} report, not a {REPORT_TASK} one")
    policy = report.get("policyFile")
    if not isinstance(policy, str) or not policy:
        refuse("no_policy", f"{name} carries no policyFile: a baseline-only report has nothing to certify")
    policy_path = os.path.join(report_dir, os.path.basename(policy))
    if not os.path.isfile(policy_path):
        refuse("policy_not_found", f"the report names {policy} but it is not beside it")
    return report, path, policy_path


def _episode(env: PlantReachEnv, policy: Policy, seed: int, refused: list) -> tuple[dict, int]:
    obs, _ = env.reset(seed=seed)
    total, steps, done = 0.0, 0, False
    while not done:
        obs, r, term, trunc, _info = env.step(policy(obs, env))
        total += r
        steps += 1
        done = term or trunc
    row = env.score(total)
    for name, v in row["rmsMotorTorqueNm"].items():
        limit = next(a["continuousNm"] for a in env.plant.actuators if a["joint"] == name)
        if v > limit:
            refused.append({"episode": seed, "actuator": name, "reason": f"rms motor torque {v:.3f} Nm above the continuous {limit:.3f} Nm"})
    for name, v in row["peakMotorTorqueNm"].items():
        stall = next(a["stallNm"] for a in env.plant.actuators if a["joint"] == name)
        if v > stall + 1e-6:
            refused.append({"episode": seed, "actuator": name, "reason": f"peak motor torque {v:.3f} Nm above the stall {stall:.3f} Nm"})
    if not row["reachedInTime"]:
        when = "never within the episode" if row["reachedS"] is None else f"reached at {row['reachedS']} s"
        refused.append({"episode": seed, "step": steps, "reason": f"did not reach the target within {env.task['timeS']} s ({when}, final error {row['finalErrorM']:.4f} m)"})
    return row, steps


def replay(policy: Policy, spec, task, seeds: list[int]) -> dict:
    """@description Replay a policy through the gate: every episode through the rows' torque limits and the brief's time. @returns The aggregate with checked, refused, refusedCount."""
    rows, refused, checked = [], [], 0
    for seed in seeds:
        env = PlantReachEnv(spec, task, seed)
        row, steps = _episode(env, policy, seed, refused)
        rows.append(row)
        checked += steps
    out = aggregate(rows)
    out.pop("rows", None)
    out.update({"checked": checked, "refused": refused[:MAX_REFUSALS_LISTED], "refusedCount": len(refused)})
    return out


def certify_policy(file: str, report_dir: str | None, spec=None, seeds: list[int] | None = None) -> dict:
    """@description The gate: replay the report's policy and the PD baseline on the evaluation seeds through each drive's
    continuous and stall rating (the rows' numbers in the spec) and the brief's time, re-measure the verdict, and write the
    certificate beside the policy bound to the policy's sha256, the engine's build hash and the spec's digest.
    @param file The report's file name. @param report_dir The report directory. @param spec The plant spec (needed when
    the report's spec carries meshes). @param seeds Evaluation seeds. @returns The certificate."""
    if not report_dir:
        refuse("no_report_dir", "the engine has no report directory to certify from")
    started = time.monotonic()
    report, report_path, policy_path = _report(file, report_dir)
    spec = _spec_for_replay(report, spec)
    task = report.get("taskSpec") or {}
    task = {"posM": task.get("targetPosM"), "timeS": task.get("timeS"), "loadKg": task.get("loadKg"), "line": task.get("line")}
    seeds = [int(s) for s in (seeds or report.get("evalSeeds") or EVAL_SEEDS)]
    _model, policy = _load_ppo(policy_path)
    baseline = replay(baseline_policy, spec, task, seeds)
    learned = replay(policy, spec, task, seeds)
    v = verdict(baseline, learned)
    probe = PlantSession(spec)
    cert = {"task": "plant-certify", "project": report.get("project"), "seed": report.get("seed"), "reportFile": os.path.basename(report_path), "policyFile": os.path.basename(policy_path),
            "policySha256": policy_sha256(policy_path), "buildHash": engine_build_hash(), "specSha256": report.get("specSha256"), "evalSeeds": seeds,
            "limits": [{"joint": a["joint"], "continuousNm": a["continuousNm"], "stallNm": a["stallNm"], "gearRatio": a["gearRatio"]} for a in probe.actuators], "reachedWithinS": task["timeS"],
            "unit": "control steps", "checked": learned["checked"], "refused": learned["refused"], "refusedCount": learned["refusedCount"], "ok": learned["refusedCount"] == 0,
            "baseline": baseline, "policy": learned, "verdict": v["facets"], "policyBeatsBaseline": v["beats"],
            "certifiedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "wallSeconds": round(time.monotonic() - started, 2)}
    with open(certificate_path(policy_path), "w", encoding="utf-8") as fh:
        json.dump(cert, fh, indent=2)
    return cert


class PolicyReach:
    """@description The plant's policy controller (`policy:<file>`): a command {payloadTargetM} becomes the inverse-kinematics
    targets plus the certified policy's residual, from the observation the task showed it. Inference stays in the container."""

    def __init__(self, policy_path: str, plant: PlantSession) -> None:
        self.model, self.certificate = load_certified(policy_path)
        if self.certificate.get("specSha256") != plant.spec_sha256:
            refuse("policy_not_certified", f"{os.path.basename(policy_path)} was certified on another plant (spec digest differs); certify it on this one")
        self.file = os.path.basename(policy_path)
        self.plant = plant
        self.limits = np.array([a["continuousNm"] for a in plant.actuators])
        self.reach = np.array([RESIDUAL_RAD if a["type"] == "hinge" else RESIDUAL_M for a in plant.actuators])
        self.time_s = float(self.certificate.get("reachedWithinS") or 1.0)
        self.reset()

    @property
    def name(self) -> str:
        """@description The controller as the load reply names it. @returns policy:<file>."""
        return f"policy:{self.file}"

    def reset(self) -> None:
        """@description A new command sequence: the clock, the previous action and the cached inverse kinematics start over."""
        self.t = 0.0
        self.prev_action = np.zeros(len(self.plant.actuators))
        self.cached: tuple[tuple, np.ndarray] | None = None

    def targets(self, plant: PlantSession, state: dict, cmd: dict) -> tuple[np.ndarray, dict]:
        """@description The targets for this control period. @param cmd {payloadTargetM: [x, y, z]}. @returns (targets, {controller, action, ik})."""
        target = cmd.get("payloadTargetM")
        try:
            key = tuple(float(v) for v in target)
        except (TypeError, ValueError):
            refuse("bad_targets", "command must be {payloadTargetM: [x, y, z]}")
        if len(key) != 3:
            refuse("bad_targets", "command.payloadTargetM must be three numbers")
        if self.cached is None or self.cached[0] != key:
            self.cached = (key, np.array(plant.ik_targets(list(key))["pdTargets"]))
            self.t = 0.0
        error = np.array(key) - np.array(state["payloadPosM"])
        action, _ = self.model.predict(observation(state, self.prev_action, error, min(1.0, self.t / (self.time_s * EPISODE_FACTOR)), self.limits), deterministic=True)
        a = np.clip(np.asarray(action, dtype=float).reshape(-1), -1.0, 1.0)
        self.prev_action = a
        self.t += CONTROL_DT_S
        return self.cached[1] + self.reach * a, {"controller": self.name, "action": [round(float(x), 4) for x in a], "baseTargets": [round(float(x), 6) for x in self.cached[1]]}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """@description The command line: a spec file, a task file (or the brief's deltaM/timeS), the project, steps, seed, the report directory."""
    parser = argparse.ArgumentParser(description="train and evaluate a reach policy on a plant built from a design")
    parser.add_argument("--spec", required=True, help="the plant spec (JSON file)")
    parser.add_argument("--task", required=True, help="the reach task (JSON file: {deltaM | posM, timeS, loadKg?})")
    parser.add_argument("--project", required=True, help="the product id the report is named by")
    parser.add_argument("--timesteps", type=int, default=0, help="PPO steps; 0 scores the baseline only")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", default=os.environ.get("EMBODIED_REPORT_DIR", "/tmp/embodied-reports"))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """@description Run the task from the command line and print the report without its rows. @returns 0."""
    args = parse_args(argv)
    with open(args.spec, encoding="utf-8") as fh:
        spec = json.load(fh)
    with open(args.task, encoding="utf-8") as fh:
        task = json.load(fh)
    report = run_training(spec, task, args.project, args.seed, args.timesteps, args.out)
    view = {k: v for k, v in report.items() if k not in ("baseline", "policy", "spec")}
    view["baseline"] = {k: v for k, v in report["baseline"].items() if k != "rows"}
    view["policy"] = None if "policy" not in report else {k: v for k, v in report["policy"].items() if k != "rows"}
    print(json.dumps(view, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
