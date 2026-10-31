"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 lane L2 -- the spider-18's Gymnasium task and PPO recipe
    |                                           | (brief 3.5). One environment, three tasks: `walk` (a heading-frame
    |                                           | command drawn from the episode's seed, scored on tracking, cost of
    |                                           | transport and falls), `inverted` (walk, get rolled over at 1.5 s,
    |                                           | recover on the accelerometer-only detector and the mirror rule; the
    |                                           | extra facet is recoverS) and `jump` (legs-hop or the latched spring,
    |                                           | scored on hop height and landing upright). The observation is joint
    |                                           | pos/vel, gyro, accel, the previous action and the command; the
    |                                           | action is a bounded residual on the CPG targets, so the zero action
    |                                           | IS the baseline and the policy must beat it on every facet. The
    |                                           | report is the hover report's shape (baseline beside policy, facets,
    |                                           | verdict) at <out>/hexapod-<task>-seed<S>.json, the file name the
    |                                           | Spider Design Studio lists. Deterministic for a seed; CPU only.
2   | maintainer@emeraldcoastsystemsgroup.com   | B30: the shape recipe (--recipe shape: six stride scales, a swing scale, a step-rate scale on the CPG), --envs parallel environments, reports named by recipe.
3   | maintainer@emeraldcoastsystemsgroup.com   | B30: the energy weight reads EMBODIED_HEXAPOD_W_ENERGY (default 0.002) so a run can trade tracking for cost of transport without a code change.
4   | maintainer@emeraldcoastsystemsgroup.com   | B30: EMBODIED_HEXAPOD_REWARD=cot charges energy per metre of commanded progress (W_COT), the currency the verdict measures; the report names the reward it ran.
5   | maintainer@emeraldcoastsystemsgroup.com   | B30 (inverted): EMBODIED_HEXAPOD_W_RECOVER charges every step between the roll and recovery, so a policy is paid to recover sooner; the report names it.
6   | maintainer@emeraldcoastsystemsgroup.com   | B30 gate: `observation` and `aggregate` are module functions, so the plant's policy controller observes exactly what the task showed the policy and the certification gate aggregates a replay exactly as a report does.
7   | maintainer@emeraldcoastsystemsgroup.com   | B31: EMBODIED_HEXAPOD_W_TORQUE charges every newton-metre an actuator spends above EMBODIED_HEXAPOD_TORQUE_LIMIT_NM (the design's continuous torque, stated by the run, never a literal here), so a policy can learn a gait the certification gate's torque limit admits; the report names both.
8   | maintainer@emeraldcoastsystemsgroup.com   | B31: EMBODIED_HEXAPOD_ROLL_FRACTION rolls that fraction of the walk task's episodes over at a drawn moment, so a walk policy trains on the roll the gate replays (both orientations, every command) instead of meeting it for the first time at certification; the report names it.
Usage:
    python tasks/hexapod_walk.py --task walk --timesteps 20000 --seed 0 --out /tmp/embodied-reports
    python tasks/hexapod_walk.py --task inverted --baseline-only
    python tasks/hexapod_walk.py --task jump --jump latched-spring --timesteps 200000 --seed 0
"""
from __future__ import annotations

import argparse
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
from embodied_hexapod import CONTROL_DT_S, RECOVER_FRACTION, RECOVER_HOLD_S, TRACK_FROM_S, HexapodPlant  # noqa: E402
from hexapod_gaits import ACTUATOR_ORDER, HOP_CROUCH_S, HOP_HOLD_S, HOP_PUSH_S, GaitShape, InversionDetector, clamp_command, cpg_targets, legs_hop_targets, stance_targets  # noqa: E402

TASKS = ("walk", "inverted", "jump")
JUMPS = ("legs-hop", "latched-spring")
FIXTURES = {jump: os.path.join(ENGINE_DIR, "tests", "fixtures", f"spider-18-{jump}.xml") for jump in JUMPS}
N_ACT = len(ACTUATOR_ORDER)
#: The residual's reach (rad): a policy may move any target this far from the gait's, never further.
RESIDUAL_RAD = float(os.environ.get("EMBODIED_HEXAPOD_RESIDUAL_RAD", "0.15"))
#: joint pos (18), joint vel (18), gyro (3), accel (3), previous action (18), command (3).
RECIPES = ("residual", "shape")
OBS_SIZE = 3 * N_ACT + 9
#: Observation scaling so every channel is of order one: rad/s and m/s^2 are divided by these.
VEL_SCALE = 10.0
ACCEL_SCALE = 10.0
EPISODE_S = {"walk": 5.0, "inverted": 7.5}
#: The jump episode runs the hop and this long after it.
AFTER_HOP_S = 1.5
FLIP_AT_S = 1.5
#: In the inverted task a fall counts once the rolled body has had this long to land; the roll itself is not a fall.
FLIP_GRACE_S = 1.0
# The command envelope a walk episode draws from (heading frame): forward, a little sideways, a little yaw.
WALK_VX_MPS = (0.05, 0.25)
WALK_VY_MPS = (-0.05, 0.05)
WALK_YAW_RADS = (-0.3, 0.3)
INVERTED_CMD = {"vx": 0.15, "vy": 0.0, "yawRate": 0.0}
STILL_CMD = {"vx": 0.0, "vy": 0.0, "yawRate": 0.0}
EVAL_SEEDS = list(range(100, 105))
# Reward weights: tracking error and yaw-rate error against the command, an alive bonus, the energy and the action change
# penalties, the fall penalty, and for the jump the reward for every new centimetre of peak height.
W_TRACK = 4.0
W_YAW = 0.5
W_ALIVE = 0.5
W_ENERGY = float(os.environ.get("EMBODIED_HEXAPOD_W_ENERGY", "0.002"))
#: B30: `EMBODIED_HEXAPOD_REWARD=cot` charges energy per metre of commanded progress instead of per joule, so a policy that
#: buys tracking with longer strides pays for it in the currency the verdict measures (cost of transport).
REWARD = os.environ.get("EMBODIED_HEXAPOD_REWARD", "energy")
W_COT = float(os.environ.get("EMBODIED_HEXAPOD_W_COT", "0.02"))
COT_FLOOR_M = 0.002
#: B30 (inverted): every control step between the roll and recovery costs W_RECOVER x dt, so a policy that recovers
#: sooner is paid for it; 0 leaves the reward as it was.
W_RECOVER = float(os.environ.get("EMBODIED_HEXAPOD_W_RECOVER", "0"))
#: B31: the per-step charge on torque above the continuous limit (mean over the actuators of max(0, |torque| - limit), in N*m);
#: 0 by default. The limit is the design's usable torque (GET /build/hexapod joints[].usableNm), stated by the run that sets a weight.
W_TORQUE = float(os.environ.get("EMBODIED_HEXAPOD_W_TORQUE", "0"))
#: B31: the fraction of walk episodes rolled over at a moment drawn from [FLIP_AT_S, FLIP_AT_S + ROLL_WINDOW_S); 0 keeps every walk upright.
ROLL_FRACTION = float(os.environ.get("EMBODIED_HEXAPOD_ROLL_FRACTION", "0"))
ROLL_WINDOW_S = 1.0
TORQUE_LIMIT_NM = float(os.environ.get("EMBODIED_HEXAPOD_TORQUE_LIMIT_NM", "nan"))
if W_TORQUE > 0 and not (TORQUE_LIMIT_NM > 0):
    raise SystemExit("EMBODIED_HEXAPOD_W_TORQUE needs EMBODIED_HEXAPOD_TORQUE_LIMIT_NM: the design's continuous torque (GET /build/hexapod joints[].usableNm)")
W_SMOOTH = 0.05
W_FALL = 5.0
W_HEIGHT = 20.0
FACETS = {"walk": ("trackingErrorMps", "costOfTransport", "falls"), "inverted": ("trackingErrorMps", "costOfTransport", "falls", "recoverS"), "jump": ("falls", "hopHeightM", "landedUpright")}


def _mean(rows: list[dict], key: str):
    vals = [r[key] for r in rows if r.get(key) is not None and not (isinstance(r[key], float) and math.isnan(r[key]))]
    return None if not vals else round(float(np.mean(vals)), 4)


def observation(state: dict, prev_action: np.ndarray, cmd_tuple: tuple[float, float, float]) -> np.ndarray:
    """@description What the policy sees: joint positions and velocities in ACTUATOR_ORDER, the gyro, the accelerometer,
    its previous action and the command -- the plant's policy controller builds it from the same state dict.
    @param state The brief's state dict. @param prev_action The last action. @param cmd_tuple (vx, vy, yaw rate), clamped.
    @returns The float32 vector."""
    return np.concatenate([
        np.array(state["jointPosRad"]), np.array(state["jointVelRadS"]) / VEL_SCALE, np.array(state["gyroRadS"]) / VEL_SCALE,
        np.array(state["accelMps2"]) / ACCEL_SCALE, np.asarray(prev_action, dtype=float), np.array(cmd_tuple, dtype=float),
    ]).astype(np.float32)


class HexapodWalkEnv(gym.Env):
    """@description The spider-18 on the tripod gait with a learned residual. Observation (63): joint positions and
    velocities in ACTUATOR_ORDER, the gyro, the accelerometer, the previous action and the command (vx, vy, yaw rate).
    Action (18): a correction in [-1, 1] scaled by RESIDUAL_RAD and added to the gait's targets. Reward per step: the
    alive bonus minus the heading-frame tracking error, the yaw-rate error, the energy spent and the action change; a
    fall ends the episode at a penalty. `walk` draws its command from the episode's seed; `inverted` walks the fixed
    command and is rolled over at FLIP_AT_S; `jump` runs the hop and rewards every new centimetre of peak height."""

    metadata = {"render_modes": []}

    def __init__(self, task: str = "walk", jump: str = "legs-hop", seed: int = 0, mjcf_path: str | None = None, recipe: str = "residual", roll_fraction: float | None = None) -> None:
        super().__init__()
        if recipe not in RECIPES:
            raise ValueError(f"unknown recipe {recipe!r}: one of {RECIPES}")
        self.recipe = recipe
        self.roll_fraction = min(1.0, max(0.0, ROLL_FRACTION if roll_fraction is None else float(roll_fraction)))
        self.flip_at: float | None = None
        self.n_act = GaitShape.SIZE if recipe == "shape" else N_ACT
        if task not in TASKS:
            raise ValueError(f"unknown task {task!r}: one of {TASKS}")
        if jump not in JUMPS:
            raise ValueError(f"unknown jump {jump!r}: one of {JUMPS}")
        with open(mjcf_path or FIXTURES[jump], encoding="utf-8") as fh:
            self.mjcf = fh.read()
        self.task, self.jump, self.base_seed, self.episode = task, jump, int(seed), 0
        self.plant = HexapodPlant(self.mjcf, seed)
        self.observation_space = spaces.Box(low=-np.inf, high=np.inf, shape=(2 * N_ACT + 9 + self.n_act,), dtype=np.float32)
        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(self.n_act,), dtype=np.float32)
        self.cmd = dict(STILL_CMD)
        self.cmd_tuple = (0.0, 0.0, 0.0)
        self.prev_action = np.zeros(self.n_act)
        self.state: dict = {}
        self.t = 0.0
        self.detector = InversionDetector(False)
        self._clear_measurements()

    def _clear_measurements(self) -> None:
        self.samples: list[tuple[float, float, float]] = []
        self.recent: list[float] = []
        self.flipped_at: float | None = None
        self.detect_s: float | None = None
        self.recover_s: float | None = None
        self.fell = False
        self.peak_z = 0.0
        self.airborne_s = 0.0
        self.start_xy = np.zeros(2)
        self.energy_step = 0.0

    @property
    def episode_length_s(self) -> float:
        """@description How long an episode may run: the task's length, or the hop plus AFTER_HOP_S."""
        if self.task != "jump":
            return EPISODE_S[self.task]
        return AFTER_HOP_S + (HOP_CROUCH_S + HOP_HOLD_S + HOP_PUSH_S if self.jump == "legs-hop" else 0.0)

    def _draw_command(self, rng: np.random.Generator) -> dict:
        if self.task == "walk":
            return {"vx": float(rng.uniform(*WALK_VX_MPS)), "vy": float(rng.uniform(*WALK_VY_MPS)), "yawRate": float(rng.uniform(*WALK_YAW_RADS))}
        return dict(INVERTED_CMD if self.task == "inverted" else STILL_CMD)

    def _obs(self) -> np.ndarray:
        return observation(self.state, self.prev_action, self.cmd_tuple)

    @property
    def shape(self) -> "GaitShape | None":
        """@description The gait shape the last action asked for (recipe shape), else None: the gait exactly."""
        return GaitShape.from_action(self.prev_action) if self.recipe == "shape" else None

    def baseline_targets(self) -> np.ndarray:
        """@description The gait's targets right now: the CPG for the command (through the mirror rule when the detector says
        inverted), the legs-hop sequence, or the stance the spring jump lands on. @returns Eighteen targets."""
        geo = self.plant.geo
        if self.task == "jump":
            return np.array(legs_hop_targets(geo, self.t, False) if self.jump == "legs-hop" else stance_targets(geo, False))
        return np.array(cpg_targets(geo, self.t, self.cmd, self.detector.inverted, self.shape))

    # -- gym -------------------------------------------------------------------
    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        episode_seed = (seed if seed is not None else self.base_seed) + self.episode
        self.episode += 1
        rng = np.random.default_rng(episode_seed)
        self.cmd = self._draw_command(rng)
        self.cmd_tuple = clamp_command(self.cmd)
        self.flip_at = FLIP_AT_S if self.task == "inverted" else (float(FLIP_AT_S + rng.uniform(0.0, ROLL_WINDOW_S)) if self.task == "walk" and rng.uniform() < self.roll_fraction else None)
        self.state = self.plant.reset("upright", episode_seed)
        if self.task == "jump" and self.jump == "latched-spring":
            self.state = self.plant.jump()  # the plant's own crouch and release; the policy acts from the flight on
        self.t = 0.0
        self.prev_action = np.zeros(self.n_act)
        self.detector = InversionDetector(False)
        self._clear_measurements()
        self.start_xy = np.array(self.state["bodyPosM"][:2])
        self.peak_z = float(self.state["bodyPosM"][2])
        return self._obs(), {}

    def _before_step(self) -> None:
        """@description The inverted task's roll at FLIP_AT_S, then the detector's reading of the accelerometer and the re-wind a flipped spring needs."""
        if self.flip_at is not None and self.flipped_at is None and self.t >= self.flip_at:
            self.state = self.plant.flip()
            self.flipped_at = self.t
        was = self.detector.inverted
        self.detector.update(self.state["accelMps2"])
        if self.flipped_at is not None and self.detect_s is None and self.detector.inverted:
            self.detect_s = self.t - self.flipped_at
        if self.detector.inverted != was and self.state["spring"] and self.state["spring"]["latched"]:
            self.plant.wind()

    def _measure(self) -> None:
        """@description What the score needs from this step: the heading-frame velocity after the ramp-in, the recovery window, the peak height and the air time."""
        vx, vy, yaw = self.plant.heading_velocity()
        if self.t >= TRACK_FROM_S:
            self.samples.append((vx, vy, yaw))
        if self.flipped_at is not None and self.recover_s is None:
            window = max(1, int(round(RECOVER_HOLD_S / CONTROL_DT_S)))
            self.recent = (self.recent + [vx])[-window:]
            if len(self.recent) == window and float(np.mean(self.recent)) >= RECOVER_FRACTION * self.cmd_tuple[0]:
                self.recover_s = round(self.t - RECOVER_HOLD_S - self.flipped_at, 3)
        z = float(self.state["bodyPosM"][2])
        self.peak_z = max(self.peak_z, z)
        if not self.plant.floor_contacts():
            self.airborne_s += CONTROL_DT_S

    def _reward(self, a: np.ndarray, peak_before: float) -> float:
        vx, vy, yaw = self.plant.heading_velocity()
        smooth = W_SMOOTH * float(np.linalg.norm(a - self.prev_action)) / math.sqrt(self.n_act)
        if self.task == "jump":
            return W_HEIGHT * max(0.0, self.peak_z - peak_before) - smooth
        track = math.hypot(vx - self.cmd_tuple[0], vy - self.cmd_tuple[1])
        energy = W_ENERGY * self.energy_step
        if REWARD == "cot":
            progress = max(COT_FLOOR_M, math.hypot(self.cmd_tuple[0], self.cmd_tuple[1]) * CONTROL_DT_S)
            energy = W_COT * self.energy_step / progress * CONTROL_DT_S
        waiting = W_RECOVER * CONTROL_DT_S if (self.task == "inverted" and self.flipped_at is not None and self.recover_s is None) else 0.0
        over = W_TORQUE * float(np.mean(np.maximum(0.0, np.abs(np.array(self.state["jointTorqueNm"])) - TORQUE_LIMIT_NM))) if W_TORQUE > 0 else 0.0
        return W_ALIVE - W_TRACK * track - W_YAW * abs(yaw - self.cmd_tuple[2]) - energy - smooth - waiting - over

    def _terminated(self) -> bool:
        if not self.state["fell"]:
            return False
        if self.flipped_at is not None:
            return self.t - self.flipped_at > FLIP_GRACE_S  # the roll itself passes through "on its side"; a fall is after the grace
        return True

    def step(self, action):
        a = np.zeros(self.n_act) if action is None else np.clip(np.asarray(action, dtype=float).reshape(-1), -1.0, 1.0)
        self._before_step()
        if self.recipe == "shape":
            self.prev_action = a
            targets = self.baseline_targets()
        else:
            targets = self.baseline_targets() + RESIDUAL_RAD * a
        energy_before = self.plant.energy_j
        peak_before = self.peak_z
        self.state = self.plant.step(targets, CONTROL_DT_S)
        self.energy_step = self.plant.energy_j - energy_before
        self.t += CONTROL_DT_S
        self._measure()
        reward = self._reward(a, peak_before)
        terminated = self._terminated()
        if terminated:
            self.fell = True
            reward -= W_FALL
        truncated = self.t >= self.episode_length_s
        if self.task == "jump" and (terminated or truncated):
            reward += 1.0 if self.landed_upright() else -W_FALL
        self.prev_action = a
        return self._obs(), float(reward), bool(terminated), bool(truncated), {"t": self.t, "fell": self.fell, "inverted": self.plant.inverted()}

    def landed_upright(self) -> bool:
        """@description The jump's landing: not on its side, and the way up it started. @returns True when it landed upright."""
        return bool(not self.state["fell"] and not self.plant.inverted())

    def score(self, total_return: float) -> dict:
        """@description The episode's measurements: the heading-frame tracking error after the ramp-in, the distance,
        the energy, the cost of transport, the fall, and the task's own facets (detectS/recoverS, hopHeightM/landedUpright).
        @param total_return The summed reward. @returns The row."""
        v = np.array(self.samples) if self.samples else np.zeros((1, 3))
        c = self.cmd_tuple
        track = float(np.sqrt(np.mean((v[:, 0] - c[0]) ** 2 + (v[:, 1] - c[1]) ** 2))) if self.samples else None
        end = np.array(self.plant.data.qpos[self.plant.free_qpos: self.plant.free_qpos + 2])
        distance = float(np.linalg.norm(end - self.start_xy))
        mass = float(self.plant.model.body_subtreemass[self.plant.body])
        g = float(abs(self.plant.model.opt.gravity[2]))
        cot = self.plant.energy_j / (mass * g * distance) if distance > 0.01 else None
        row = {"command": dict(self.cmd), "measured": {"vxMps": round(float(v[:, 0].mean()), 4), "vyMps": round(float(v[:, 1].mean()), 4), "yawRateRadS": round(float(v[:, 2].mean()), 4)},
               "trackingErrorMps": None if track is None else round(track, 4), "costOfTransport": None if cot is None else round(cot, 3), "falls": int(self.fell),
               "distanceM": round(distance, 4), "energyJ": round(self.plant.energy_j, 4), "seconds": round(self.t, 3), "return": round(float(total_return), 3)}
        if self.task == "inverted":
            row.update({"flippedAtS": self.flipped_at, "detectS": None if self.detect_s is None else round(self.detect_s, 3), "recoverS": self.recover_s, "invertedAtEnd": self.plant.inverted()})
        elif self.flipped_at is not None:
            row.update({"rolledAtS": round(self.flipped_at, 3), "invertedAtEnd": self.plant.inverted()})
        if self.task == "jump":
            row.update({"jump": self.jump, "hopHeightM": round(self.peak_z - self.plant.geo.stand_height_m, 4), "bodyPeakM": round(self.peak_z, 4),
                        "airborneS": round(self.airborne_s, 3), "landedUpright": self.landed_upright()})
        return row


Policy = Callable[[np.ndarray, HexapodWalkEnv], object]


def baseline_policy(_obs: np.ndarray, env: HexapodWalkEnv) -> np.ndarray:
    """@description The zero action: the gait exactly as the plant's episodes run it (a zero residual, or the neutral shape). @returns Zeros."""
    return np.zeros(env.n_act)


def evaluate(policy: Policy, seeds: list[int], task: str, jump: str, recipe: str = "residual") -> dict:
    """@description One episode per seed, scored, then the facets averaged (falls summed; recovered and landed counted).
    @param policy (obs, env) -> action. @param seeds Episode seeds. @param task walk | inverted | jump. @param jump The option.
    @returns The aggregate with every episode's row under `episodes`."""
    rows = []
    for seed in seeds:
        env = HexapodWalkEnv(task, jump, seed, recipe=recipe)
        obs, _ = env.reset(seed=seed)
        total, done = 0.0, False
        while not done:
            obs, r, term, trunc, _info = env.step(policy(obs, env))
            total += r
            done = term or trunc
        rows.append(env.score(total))
    return aggregate(rows, task)


def aggregate(rows: list[dict], task: str) -> dict:
    """@description The facets over scored episodes, as a report carries them: falls summed, recovered and landed counted,
    the rest averaged; `rows` kept. @param rows env.score() rows. @param task walk | inverted | jump. @returns The aggregate."""
    out = {"episodes": len(rows), "meanReturn": _mean(rows, "return"), "falls": int(sum(r["falls"] for r in rows)), "distanceM": _mean(rows, "distanceM"), "energyJ": _mean(rows, "energyJ")}
    if task != "jump":
        out.update({"trackingErrorMps": _mean(rows, "trackingErrorMps"), "costOfTransport": _mean(rows, "costOfTransport")})
    if task == "inverted":
        out.update({"detectS": _mean(rows, "detectS"), "recoverS": _mean(rows, "recoverS"), "recovered": int(sum(r["recoverS"] is not None for r in rows))})
    if task == "jump":
        out.update({"hopHeightM": _mean(rows, "hopHeightM"), "bodyPeakM": _mean(rows, "bodyPeakM"), "airborneS": _mean(rows, "airborneS"),
                    "landedUprightCount": int(sum(r["landedUpright"] for r in rows)), "landedUpright": bool(all(r["landedUpright"] for r in rows))})
    out["rows"] = rows
    return out


def _lower(p, b) -> bool:
    return p is not None and b is not None and p < b


def _no_higher(p, b) -> bool:
    return p is not None and (b is None or p <= b)


def verdict(task: str, baseline: dict, policy: dict) -> dict:
    """@description The facets a policy must ALL win: walk -- a lower tracking error, a cost of transport no higher, no more
    falls; inverted -- those and a recovery no slower with no fewer recoveries; jump -- a higher hop, no fewer upright
    landings, no more falls. @param task The task. @param baseline Its aggregate. @param policy Its aggregate. @returns facets and beats."""
    facets = {"falls": bool(policy["falls"] <= baseline["falls"])}
    if task in ("walk", "inverted"):
        facets["trackingError"] = _lower(policy["trackingErrorMps"], baseline["trackingErrorMps"])
        facets["costOfTransport"] = _no_higher(policy["costOfTransport"], baseline["costOfTransport"])
    if task == "inverted":
        facets["recovery"] = bool(policy["recovered"] >= baseline["recovered"] and _no_higher(policy["recoverS"], baseline["recoverS"]))
    if task == "jump":
        facets["hopHeight"] = bool(policy["hopHeightM"] is not None and baseline["hopHeightM"] is not None and policy["hopHeightM"] > baseline["hopHeightM"])
        facets["landedUpright"] = bool(policy["landedUprightCount"] >= baseline["landedUprightCount"])
    return {"facets": facets, "beats": all(facets.values())}


def report_file(task: str, seed: int, jump: str = "legs-hop", recipe: str = "residual") -> str:
    """@description The report's file name (brief 3.5: hexapod-<task>-seed<S>.json, the shape the Spider Design Studio
    lists); the jump task names its option too, so the two options' reports do not overwrite each other.
    @param task The task. @param seed The seed. @param jump The option. @returns The name."""
    tag = "" if recipe == "residual" else f"-{recipe}"
    return f"hexapod-{task}-{jump}{tag}-seed{seed}.json" if task == "jump" else f"hexapod-{task}{tag}-seed{seed}.json"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """@description The command line (brief 3.5). @param argv Arguments, or the process's. @returns The namespace."""
    parser = argparse.ArgumentParser(description="train and evaluate the spider-18 residual policy")
    parser.add_argument("--task", default="walk", choices=TASKS)
    parser.add_argument("--jump", default="legs-hop", choices=JUMPS)
    parser.add_argument("--timesteps", type=int, default=200_000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", default=os.environ.get("EMBODIED_REPORT_DIR", "/tmp/embodied-reports"))
    parser.add_argument("--baseline-only", action="store_true", help="score the gait alone and stop")
    parser.add_argument("--recipe", default="residual", choices=RECIPES, help="residual: 18 joint corrections on the CPG; shape: 6 stride scales, a swing scale and a step-rate scale on the CPG (B30)")
    parser.add_argument("--envs", type=int, default=1, help="parallel environments for PPO (SubprocVecEnv when above 1)")
    return parser.parse_args(argv)


def training_env(args: argparse.Namespace):
    """@description The environment PPO learns in: one HexapodWalkEnv, or `--envs` of them in subprocesses, each on its own
    seed (B30: eight parallel environments were part of what let the drone's policy win). @param args The command line.
    @returns A gym env or a SubprocVecEnv."""
    if args.envs <= 1:
        return HexapodWalkEnv(args.task, args.jump, args.seed, recipe=args.recipe)
    from stable_baselines3.common.vec_env import SubprocVecEnv

    def make(i: int):
        return lambda: HexapodWalkEnv(args.task, args.jump, args.seed * 1000 + i, recipe=args.recipe)
    return SubprocVecEnv([make(i) for i in range(args.envs)], start_method="forkserver")


def train(args: argparse.Namespace, report: dict) -> None:
    """@description PPO on the residual (Stable-Baselines3, CPU), the policy saved beside the report and scored on the same seeds as the baseline.
    @param args The command line. @param report The report being built; policy, verdict and the files are added."""
    import stable_baselines3
    import torch
    from stable_baselines3 import PPO
    torch.manual_seed(args.seed)
    env = training_env(args)
    t0 = time.time()
    model = PPO("MlpPolicy", env, seed=args.seed, n_steps=2048, batch_size=64 if args.envs == 1 else 256, learning_rate=3e-4, gamma=0.99, verbose=0, device="cpu")
    model.learn(total_timesteps=args.timesteps)
    policy_file = os.path.splitext(report_file(args.task, args.seed, args.jump, args.recipe))[0].replace(f"hexapod-{args.task}", f"hexapod-{args.task}-ppo", 1) + ".zip"
    policy_path = os.path.join(args.out, policy_file)
    model.save(policy_path)

    def policy(obs: np.ndarray, _env: HexapodWalkEnv) -> np.ndarray:
        action, _ = model.predict(obs, deterministic=True)
        return action

    report.update({"timesteps": args.timesteps, "trainWallS": round(time.time() - t0, 1), "policyPath": policy_path, "policyFile": policy_file,
                   "sb3": stable_baselines3.__version__, "torch": torch.__version__, "envs": args.envs, "policy": evaluate(policy, EVAL_SEEDS, args.task, args.jump, args.recipe)})
    v = verdict(args.task, report["baseline"], report["policy"])
    report["verdict"] = v["facets"]
    report["policyBeatsBaseline"] = v["beats"]


def main(argv: list[str] | None = None) -> int:
    """@description Score the baseline, train unless --baseline-only, write the report, print it. @param argv Arguments. @returns 0."""
    args = parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    import mujoco
    report: dict = {"task": f"hexapod-{args.task}", "mode": args.recipe, "reward": REWARD, "wCot": W_COT if REWARD == "cot" else None, "wRecover": W_RECOVER, "wTorque": W_TORQUE, "torqueLimitNm": TORQUE_LIMIT_NM if W_TORQUE > 0 else None, "rollFraction": ROLL_FRACTION, "jump": args.jump, "seed": args.seed, "timesteps": 0, "residualRad": RESIDUAL_RAD,
                    "evalSeeds": EVAL_SEEDS, "facets": list(FACETS[args.task]), "mujoco": mujoco.__version__, "obsSize": OBS_SIZE, "actionSize": N_ACT,
                    "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "baseline": evaluate(baseline_policy, EVAL_SEEDS, args.task, args.jump, args.recipe)}
    if not args.baseline_only:
        train(args, report)
    report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    path = os.path.join(args.out, report_file(args.task, args.seed, args.jump, args.recipe))
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps({k: v for k, v in report.items() if k not in ("baseline", "policy")} | {"baseline": {k: v for k, v in report["baseline"].items() if k != "rows"},
                      "policy": None if "policy" not in report else {k: v for k, v in report["policy"].items() if k != "rows"}, "file": path}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
