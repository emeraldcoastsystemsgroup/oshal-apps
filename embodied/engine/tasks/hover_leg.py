"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the first training task (ADR-152 D5.1):
    |                                           | hold position at the mission altitude, then fly one leg, on the
    |                                           | printed drone under the gust model. A Gymnasium environment over
    |                                           | the same plant the simulation flies (same MJCF, same rays, same
    |                                           | contacts), the plant's own cascaded controller as the baseline
    |                                           | every policy is scored against, and one evaluation for both so
    |                                           | the comparison is like for like. Seeded and deterministic.
2   | maintainer@emeraldcoastsystemsgroup.com   | Residual mode (the action corrects the plant's own controller, bounded), the observation builder and motor-fraction mapping shared with the plant's policy controller, and the first episode's flight path in every evaluation for the certification gate.
3   | maintainer@emeraldcoastsystemsgroup.com   | EMBODIED_RESIDUAL_SCALE overrides the residual bound for a training experiment (B19's win); the default stays 0.25 and the report records the value.
4   | maintainer@emeraldcoastsystemsgroup.com   | The `ctbr` interface (B19, the SimpleFlight recipe on this plant): the policy commands collective thrust and body rates, the plant's own rate loop and mixer turn them into motor forces every physics step; the observation is a look-ahead of the reference (ten points 50 ms apart, extrapolated from the setpoint and its velocity exactly as the plant can), velocity, attitude, rates and the last action; the reference ramps to the leg's end at the autopilot's pace so the baseline (the PID with the same feed-forward) and the policy track the same thing; a smoothness penalty on the action change; the motors' thrust jittered per episode so a policy cannot memorise one plant. The `motors` and `residual` interfaces are unchanged.
"""
from __future__ import annotations

import math
import os
import sys
from typing import Callable

import gymnasium as gym
import numpy as np
from gymnasium import spaces

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from embodied_worker import Controller, Plant, quat_to_mat  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tests", "fixtures", "recon-mini.xml")
HOME = np.array([0.6, 0.6, 2.075])
LEG = np.array([1.4, 0.0, 0.0])
CONTROL_HZ = 50
HOLD_S = 3.0
EPISODE_S = 8.0
SUCCESS_M = 0.05
# Residual mode: the policy's action is a correction on top of the plant's own controller, in motor-fraction units.
# EMBODIED_RESIDUAL_SCALE overrides the bound for a training experiment; every report records the value it trained with,
# and a plant flying that policy must run with the same value (the worker shares this constant).
RESIDUAL_SCALE = float(os.environ.get("EMBODIED_RESIDUAL_SCALE", "0.25"))
OBS_SIZE = 22

# The ctbr interface: collective thrust and body rates (SimpleFlight's mid-level action space), a look-ahead of the
# reference, a smoothness penalty, thrust jitter. The reference ramps at the autopilot's pace (the sim's setpoint speed).
INTERFACES = ("motors", "ctbr")
CTBR_HORIZON = 10
CTBR_LOOKAHEAD_S = 0.05
OMEGA_MAX = np.array([3.0, 3.0, 1.5])  # rad/s of roll, pitch, yaw rate per unit action
V_REF = 1.0  # m/s, the sim autopilot's setpoint ramp
OBS_SIZE_CTBR = 3 * CTBR_HORIZON + 3 + 9 + 3 + 4  # 49
SMOOTH_LAMBDA = float(os.environ.get("EMBODIED_SMOOTH_LAMBDA", "0.2"))
THRUST_JITTER = float(os.environ.get("EMBODIED_THRUST_JITTER", "0.1"))


def observation(pos: np.ndarray, vel: np.ndarray, rot: np.ndarray, omega: np.ndarray, target: np.ndarray, prev_action: np.ndarray) -> np.ndarray:
    """@description The policy's observation, built the same way in the task and in the plant that later flies with the policy:
    position error (3), velocity (3), rotation matrix (9), body rates (3), previous action (4)."""
    return np.concatenate([target - pos, vel, rot.reshape(-1), omega, prev_action]).astype(np.float32)


def observation_ctbr(pos: np.ndarray, vel: np.ndarray, rot: np.ndarray, omega: np.ndarray, target: np.ndarray, v_target: np.ndarray, prev_action: np.ndarray) -> np.ndarray:
    """@description The ctbr observation: the next CTBR_HORIZON reference points relative to the body, CTBR_LOOKAHEAD_S apart,
    extrapolated from the setpoint along its velocity — exactly what the plant knows in flight (a setpoint and its ramp) —
    then velocity (3), rotation matrix (9), body rates (3) and the previous action (4)."""
    ahead = [target + v_target * (k * CTBR_LOOKAHEAD_S) - pos for k in range(1, CTBR_HORIZON + 1)]
    return np.concatenate([np.concatenate(ahead), vel, rot.reshape(-1), omega, prev_action]).astype(np.float32)


def motor_fractions(pid_fraction: np.ndarray, action: np.ndarray, residual: bool) -> np.ndarray:
    """@description Motor fractions [0, 1] from an action in [-1, 1]: absolute, or the controller's fractions plus a bounded correction."""
    a = np.clip(np.asarray(action, dtype=float), -1.0, 1.0)
    u = pid_fraction + RESIDUAL_SCALE * a if residual else (a + 1.0) / 2.0
    return np.clip(u, 0.0, 1.0)


def ctbr_command(action: np.ndarray, controller: Controller) -> tuple[float, np.ndarray]:
    """@description A ctbr action in [-1, 1]^4 as the plant's low-level command: collective thrust (N, of the motors' total) and body-rate setpoints (rad/s)."""
    a = np.clip(np.asarray(action, dtype=float), -1.0, 1.0)
    collective = float((a[0] + 1.0) / 2.0) * len(controller.rotors) * controller.f_max
    return collective, a[1:4] * OMEGA_MAX


def reference(t: float) -> np.ndarray:
    """@description Where the reference is at time t: home through the hold, then ramping to the leg's end at V_REF."""
    if t < HOLD_S:
        return HOME.copy()
    length = float(np.linalg.norm(LEG))
    return HOME + LEG * min(1.0, (t - HOLD_S) * V_REF / length)


def reference_velocity(t: float) -> np.ndarray:
    """@description The reference's own velocity at time t (zero while holding and once the leg's end is reached)."""
    length = float(np.linalg.norm(LEG))
    if t < HOLD_S or (t - HOLD_S) * V_REF >= length:
        return np.zeros(3)
    return LEG / length * V_REF


class HoverLegEnv(gym.Env):
    """@description Observation: position error (3), velocity (3), rotation matrix (9), body rates (3), previous action (4) — or,
    on the ctbr interface, the reference look-ahead instead of the error (49 values). Action: four motor thrust fractions in
    [-1, 1] (mapped to [0, f_max]), a bounded correction on the controller (residual), or collective thrust and body rates
    (ctbr). Reward per step: closeness to the target, minus body-rate and action-change penalties, plus a bonus inside the
    success radius; a contact with the scene, a tilt past 70 degrees or a 2.5 m error ends the episode. The target is HOME
    for HOLD_S seconds, then HOME + LEG (a step for motors/residual; a ramp at V_REF for ctbr)."""

    metadata = {"render_modes": []}

    def __init__(self, mjcf_path: str = FIXTURE, seed: int = 0, residual: bool = False, interface: str = "motors") -> None:
        super().__init__()
        if interface not in INTERFACES:
            raise ValueError(f"unknown interface {interface!r}: one of {INTERFACES}")
        with open(mjcf_path, encoding="utf-8") as fh:
            self.mjcf = fh.read()
        self.base_seed = seed
        self.residual = residual and interface == "motors"
        self.interface = interface
        self.episode = 0
        self.plant = Plant(self.mjcf, seed)
        self.substeps = max(1, int(round(1.0 / CONTROL_HZ / self.plant.model.opt.timestep)))
        self.observation_space = spaces.Box(low=-np.inf, high=np.inf, shape=(OBS_SIZE_CTBR if interface == "ctbr" else OBS_SIZE,), dtype=np.float32)
        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(4,), dtype=np.float32)
        self.prev_action = np.zeros(4)
        self.t = 0.0
        self.target = HOME.copy()
        self.thrust_gain = 1.0
        self.errors: list[float] = []

    # -- helpers ---------------------------------------------------------------
    def _state(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        d = self.plant.data
        return d.qpos[0:3].copy(), d.qvel[0:3].copy(), quat_to_mat(d.qpos[3:7]), d.qvel[3:6].copy()

    def _obs(self) -> np.ndarray:
        pos, vel, rot, omega = self._state()
        if self.interface == "ctbr":
            return observation_ctbr(pos, vel, rot, omega, self.target, reference_velocity(self.t), self.prev_action)
        return observation(pos, vel, rot, omega, self.target, self.prev_action)

    def _place(self, pos: np.ndarray) -> None:
        d = self.plant.data
        d.qpos[:] = 0.0
        d.qvel[:] = 0.0
        d.qpos[0:3] = pos
        d.qpos[3] = 1.0
        d.ctrl[:] = 0.0
        import mujoco  # local import keeps the module's public surface plant-only
        mujoco.mj_forward(self.plant.model, d)

    def pid_forces(self) -> np.ndarray:
        """@description The plant's cascaded controller right now, as motor forces (N): with the reference's feed-forward on ctbr, none on the step target."""
        pos, vel, rot, omega = self._state()
        v_ff = reference_velocity(self.t) if self.interface == "ctbr" else np.zeros(3)
        return self.plant.controller.motors(pos, vel, rot, omega, self.target, 0.0, v_ff)

    def pid_fraction(self) -> np.ndarray:
        """@description The plant's cascaded controller right now, as motor fractions."""
        return self.pid_forces() / self.plant.f_max

    def baseline_action(self):
        """@description The plant's cascaded controller as an action in this env's units: the reference every policy must beat.
        In residual mode the baseline is the zero correction; on ctbr it is None — the controller's forces applied directly."""
        if self.interface == "ctbr":
            return None
        if self.residual:
            return np.zeros(4)
        return np.clip(2.0 * self.pid_fraction() - 1.0, -1.0, 1.0)

    # -- gym -------------------------------------------------------------------
    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        episode_seed = (seed if seed is not None else self.base_seed) + self.episode
        self.episode += 1
        self.plant = Plant(self.mjcf, episode_seed)
        self._place(HOME)
        self.t = 0.0
        self.target = HOME.copy()
        self.prev_action = np.zeros(4)
        # The thrust coefficient a real motor set has is never the drawing's: on ctbr every episode flies a plant whose motors
        # deliver a little more or less than commanded, drawn from the episode's seed so both the baseline and the policy meet it.
        self.thrust_gain = 1.0 + (np.random.default_rng(episode_seed).uniform(-THRUST_JITTER, THRUST_JITTER) if self.interface == "ctbr" else 0.0)
        self.errors = []
        return self._obs(), {}

    def _forces(self, action, omega: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """@description The motor forces for an action (or the controller when None), and the action as remembered for the smoothness term."""
        if action is None:
            return self.pid_forces(), self.prev_action
        a = np.clip(np.asarray(action, dtype=float), -1.0, 1.0)
        if self.interface == "ctbr":
            collective, omega_cmd = ctbr_command(a, self.plant.controller)
            return self.plant.controller.rate_motors(collective, omega_cmd, omega), a
        return motor_fractions(self.pid_fraction() if self.residual else np.zeros(4), a, self.residual) * self.plant.f_max, a

    def step(self, action):
        pos0, _v0, _r0, omega0 = self._state()
        forces, a = self._forces(action, omega0)
        contact = None
        import mujoco
        held = None if action is None or self.interface != "ctbr" else ctbr_command(a, self.plant.controller)
        for _ in range(self.substeps):
            if held is not None:
                # The rate loop closes every physics step on the held command, as the plant's own controller does.
                forces = self.plant.controller.rate_motors(held[0], held[1], self.plant.data.qvel[3:6].copy())
            self.plant.data.ctrl[:] = np.clip(forces * self.thrust_gain, 0.0, self.plant.f_max)
            self.plant._gust_step(self.plant.model.opt.timestep)
            self.plant.data.xfrc_applied[self.plant.body][:2] = self.plant.gust
            mujoco.mj_step(self.plant.model, self.plant.data)
            hit = self.plant._scene_contact()
            if hit:
                contact = hit
        self.t += self.substeps * self.plant.model.opt.timestep
        self.target = reference(self.t) if self.interface == "ctbr" else (HOME + LEG if self.t >= HOLD_S else HOME.copy())
        pos, _vel, rot, omega = self._state()
        err = float(np.linalg.norm(self.target - pos))
        tilt = math.acos(max(-1.0, min(1.0, rot[2, 2])))
        self.errors.append(err)
        smooth = SMOOTH_LAMBDA if self.interface == "ctbr" else 0.02
        reward = 1.0 - min(1.0, err) - 0.05 * float(np.linalg.norm(omega)) - smooth * float(np.linalg.norm(a - self.prev_action))
        if err < SUCCESS_M:
            reward += 0.5
        terminated = contact is not None or err > 2.5 or tilt > 1.2 or pos[2] < 0.1
        if terminated:
            reward -= 5.0
        truncated = self.t >= EPISODE_S
        self.prev_action = a
        return self._obs(), float(reward), bool(terminated), bool(truncated), {"err": err, "contact": contact, "t": self.t}


def evaluate(policy: Callable[[np.ndarray, HoverLegEnv], object], seeds: list[int], residual: bool = False, interface: str = "motors") -> dict:
    """@description Run one episode per seed and score it: mean error, error at the end of the hold and of the leg, crash rate,
    return — and the first episode's flight path at 10 Hz, which the kinematic sim replays through its guards (the certification gate)."""
    ends_hold: list[float] = []
    ends_leg: list[float] = []
    means: list[float] = []
    crashes = 0
    returns: list[float] = []
    trajectory: list[list[float]] = []
    for seed in seeds:
        env = HoverLegEnv(seed=seed, residual=residual, interface=interface)
        obs, _ = env.reset(seed=seed)
        total = 0.0
        hold_err = None
        done = False
        tick = 0
        while not done:
            obs, r, term, trunc, info = env.step(policy(obs, env))
            total += r
            tick += 1
            if seed == seeds[0] and tick % 5 == 0:
                trajectory.append([round(float(v), 4) for v in env.plant.data.qpos[0:3]])
            if hold_err is None and info["t"] >= HOLD_S:
                hold_err = env.errors[-2] if len(env.errors) > 1 else info["err"]
            done = term or trunc
            if term:
                crashes += 1
        ends_hold.append(hold_err if hold_err is not None else float("nan"))
        ends_leg.append(env.errors[-1])
        means.append(float(np.mean(env.errors)))
        returns.append(total)
    return {"episodes": len(seeds), "meanErrM": float(np.nanmean(means)), "holdEndErrM": float(np.nanmean(ends_hold)),
            "legEndErrM": float(np.nanmean(ends_leg)), "crashRate": crashes / len(seeds), "meanReturn": float(np.mean(returns)),
            "successRate": float(np.mean([e < SUCCESS_M for e in ends_leg])), "trajectory": trajectory,
            "targets": [[float(v) for v in HOME], [float(v) for v in HOME + LEG]]}


def baseline_policy(_obs: np.ndarray, env: HoverLegEnv):
    return env.baseline_action()


def verdict(baseline: dict, policy: dict) -> dict:
    """@description Three facets a policy must ALL win to beat the plant's controller: a lower mean error over the episode, endpoints
    (end of the hold, end of the leg) no worse, and no more crashes. A policy that reaches the leg sooner but settles worse loses."""
    facets = {"meanError": bool(policy["meanErrM"] < baseline["meanErrM"]),
              "endpoints": bool(policy["holdEndErrM"] <= baseline["holdEndErrM"] and policy["legEndErrM"] <= baseline["legEndErrM"]),
              "crashes": bool(policy["crashRate"] <= baseline["crashRate"])}
    return {"facets": facets, "beats": all(facets.values())}
