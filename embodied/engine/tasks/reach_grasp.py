"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- ADR-152 D5 task 3 on the printed arm: the hold
    |                                           | check that measures what each servo really carries in the pose the
    |                                           | sizing calls worst and compares it with the design, the taught
    |                                           | pick-and-place run over seeded scenes (the deterministic baseline a
    |                                           | learned policy must beat), and the Gymnasium environment that
    |                                           | learning uses. The check reports what it measured and what the
    |                                           | design expected side by side; it never restates the design.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np

ENGINE_DIR = os.environ.get("EMBODIED_ENGINE_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE_DIR)

from embodied_arm import ARM_JOINTS, ArmPlant, GRIP_CLOSED_RAD, GRIP_OPEN_RAD, pick_and_place  # noqa: E402

TASK = "arm-grasp"
BASELINE = "taught pick-and-place"
DEFAULT_SEEDS = 3
#: Scenes: where a block may stand on the bench and where it is asked to go.
BLOCK_X = (0.20, 0.30)
BLOCK_Y = (-0.08, 0.08)
PLACE_X = (0.17, 0.26)
PLACE_Y = (-0.21, -0.12)
#: A joint holding more than this share of its continuous torque on average is working too hard.
DUTY_LIMIT = 1.0
#: How far the measured hold may sit from the design before the check calls them different.
HOLD_TOLERANCE = 0.15


def scene(seed: int) -> tuple[tuple[float, float], tuple[float, float]]:
    """@description The block and the target for a seed: the same seed always gives the same scene."""
    rng = np.random.default_rng(seed)
    return ((float(rng.uniform(*BLOCK_X)), float(rng.uniform(*BLOCK_Y))), (float(rng.uniform(*PLACE_X)), float(rng.uniform(*PLACE_Y))))


def hold_check(plant: ArmPlant, poses: list[list[float]], design_nm: list[float], usable_nm: list[float], payload_kg: float) -> list[dict]:
    """@description Hold the payload in each joint's worst pose and report what that joint's servo actually carried
    against what the sizing said it would, and against the torque the servo may hold continuously."""
    out = []
    for i, (pose, design, usable) in enumerate(zip(poses, design_nm, usable_nm)):
        q = np.array(pose, dtype=float)
        # A pose the arm cannot take -- a link through the bench -- is not a hold: say so instead of reporting the
        # torque of a servo fighting a contact.
        if plant.collides(q):
            out.append({"joint": f"j{i + 1}", "designNm": round(float(design), 3), "measuredNm": None, "usableNm": round(float(usable), 3),
                        "poseBlocked": True, "agreesWithDesign": False, "withinContinuous": False})
            continue
        measured = float(plant.hold(q, payload_kg)[i])
        agrees = abs(measured - design) <= max(0.05, HOLD_TOLERANCE * max(design, 1e-6))
        out.append({
            "joint": f"j{i + 1}", "designNm": round(float(design), 3), "measuredNm": round(measured, 3), "usableNm": round(float(usable), 3),
            "poseBlocked": False, "agreesWithDesign": bool(agrees), "withinContinuous": bool(measured <= usable),
        })
    return out


def run_baseline(plant: ArmPlant, speeds: list[float], seeds: int, payload_kg: float = 0.0) -> dict:
    """@description The taught pick-and-place over seeded scenes: what fraction it places, how long it takes and what
    the servos spent doing it."""
    episodes = []
    peak = np.zeros(len(ARM_JOINTS)); mean = np.zeros(len(ARM_JOINTS))
    for seed in range(seeds):
        block, place = scene(seed)
        plant.reset()
        plant.set_block(block[0], block[1])
        result = pick_and_place(plant, np.array(speeds, dtype=float), block, place, payload_kg)
        result["seed"] = seed
        result["blockM"] = [round(v, 3) for v in block]
        result["placeM"] = [round(v, 3) for v in place]
        episodes.append(result)
        peak = np.maximum(peak, np.array(result["peakTorqueNm"]))
        mean += np.array(result["meanTorqueNm"])
    n = max(1, len(episodes))
    return {
        "episodes": episodes, "successRate": round(sum(1 for e in episodes if e["success"]) / n, 3),
        "meanSeconds": round(sum(e["seconds"] for e in episodes) / n, 2),
        "peakTorqueNm": [round(float(v), 3) for v in peak], "meanTorqueNm": [round(float(v), 3) for v in (mean / n)],
    }


def arm_check(mjcf: str, worst_poses: list[list[float]], design_nm: list[float], usable_nm: list[float], speeds: list[float], payload_kg: float, seeds: int = DEFAULT_SEEDS) -> dict:
    """@description The whole check the tile asks for: the sizing held in physics, then the baseline task run.
    @returns A report with a verdict: does the arm hold what it was designed to, and does the taught task work."""
    started = time.monotonic()
    plant = ArmPlant(mjcf, 0)
    holds = hold_check(plant, worst_poses, design_nm, usable_nm, payload_kg)
    baseline = run_baseline(plant, speeds, seeds)
    duty = [m / u for m, u in zip(baseline["meanTorqueNm"], usable_nm)]
    return {
        "task": TASK, "baseline": BASELINE, "payloadKg": payload_kg, "seeds": seeds,
        "holds": holds, "run": baseline,
        "dutyOfContinuous": [round(float(v), 3) for v in duty],
        "verdict": {
            "holdsItsPayload": all(h["withinContinuous"] for h in holds),
            "physicsAgreesWithDesign": all(h["agreesWithDesign"] for h in holds),
            "taskSucceeds": baseline["successRate"] >= 1.0,
            "withinDutyCycle": all(v <= DUTY_LIMIT for v in duty),
        },
        "wallSeconds": round(time.monotonic() - started, 2),
    }


class ReachGraspEnv:
    """@description Task 3 as a Gymnasium environment: the policy commands small joint moves and the jaw, and is paid
    for closing on the block, lifting it and putting it on the target. The taught pick-and-place above is the baseline
    it must beat; nothing here is trained yet (BACKLOG B21)."""

    metadata = {"render_modes": []}

    def __init__(self, mjcf: str, seed: int = 0, control_hz: float = 20.0, max_seconds: float = 20.0) -> None:
        import gymnasium as gym  # imported here: the check and the baseline do not need it
        self.gym = gym
        self.plant = ArmPlant(mjcf, seed)
        self.dt = 1.0 / control_hz
        self.max_steps = int(max_seconds * control_hz)
        self.action_space = gym.spaces.Box(low=-1.0, high=1.0, shape=(7,), dtype=np.float32)
        self.observation_space = gym.spaces.Box(low=-np.inf, high=np.inf, shape=(22,), dtype=np.float32)
        self.seed = seed
        self.steps = 0
        self.place = (0.2, -0.15)

    def _obs(self) -> np.ndarray:
        tcp, _axis = self.plant.tcp_pose()
        block = self.plant.block_pose()
        grip = float(self.plant.data.qpos[self.plant.grip_qpos])
        qd = np.array([float(self.plant.data.qvel[a]) for a in self.plant.dof_adr])
        return np.concatenate([self.plant.q, qd, tcp, block, block - tcp, [grip]]).astype(np.float32)

    def reset(self, *, seed: int | None = None, options: dict | None = None) -> tuple[np.ndarray, dict]:
        if seed is not None:
            self.seed = seed
        block, place = scene(self.seed)
        self.place = place
        self.plant.reset()
        self.plant.set_block(block[0], block[1])
        self.steps = 0
        return self._obs(), {"blockM": block, "placeM": place}

    def step(self, action: np.ndarray) -> tuple[np.ndarray, float, bool, bool, dict]:
        act = np.clip(np.array(action, dtype=float), -1.0, 1.0)
        target = self.plant.q + act[:6] * 0.05
        grip = GRIP_CLOSED_RAD if act[6] < 0 else GRIP_OPEN_RAD
        self.plant.command(target, grip)
        self.plant.step(self.dt)
        self.steps += 1
        tcp, _axis = self.plant.tcp_pose()
        block = self.plant.block_pose()
        half = float(self.plant.model.geom_size[self.plant.block_geom][2])
        reach = float(np.linalg.norm(block - tcp))
        to_place = float(np.linalg.norm(block[:2] - np.array(self.place)))
        holding = self.plant.grasped()
        lifted = bool(holding and block[2] > half + 0.04)
        placed = bool(to_place < 0.03 and block[2] < half + 0.01 and not holding)
        reward = -reach - 0.1 * to_place + (0.5 if holding else 0.0) + (1.0 if lifted else 0.0) + (10.0 if placed else 0.0) - 0.01
        return self._obs(), float(reward), placed, self.steps >= self.max_steps, {"reachM": reach, "holding": holding, "lifted": lifted, "placed": placed}


def main() -> int:
    """@description Run the check from a shell in the container: `python engine/tasks/reach_grasp.py --mjcf <file>`."""
    ap = argparse.ArgumentParser(description="The printed arm's physics check: the sizing held, then the taught task.")
    ap.add_argument("--mjcf", required=True, help="the arm model, from GET /api/embodied/physics/arm/mjcf")
    ap.add_argument("--design", required=True, help="JSON: {worst: [[q…]…], designNm: [...], usableNm: [...], speeds: [...], payloadKg}")
    ap.add_argument("--seeds", type=int, default=DEFAULT_SEEDS)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    with open(args.mjcf, encoding="utf-8") as fh:
        mjcf = fh.read()
    with open(args.design, encoding="utf-8") as fh:
        design = json.load(fh)
    report = arm_check(mjcf, design["worst"], design["designNm"], design["usableNm"], design["speeds"], float(design["payloadKg"]), args.seeds)
    text = json.dumps(report, indent=2)
    if args.out:
        os.makedirs(args.out, exist_ok=True)
        with open(os.path.join(args.out, f"arm-check-{report['task']}.json"), "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
    print(text)
    return 0 if report["verdict"]["holdsItsPayload"] and report["verdict"]["taskSucceeds"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
