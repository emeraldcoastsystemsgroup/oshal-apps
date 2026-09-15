"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the printed arm as a MuJoCo plant (ADR-152 D5
    |                                           | task 3): the model generated from the arm's parts model, damped
    |                                           | least-squares inverse kinematics on the tool site, a hold test
    |                                           | that measures what each servo really carries in the pose the
    |                                           | sizing calls worst, and the taught pick-and-place that is the
    |                                           | baseline a learned policy must beat. Every number the plant
    |                                           | reports is measured in the simulation, never restated from the
    |                                           | design: the check is only worth something if the two can differ.
2   | maintainer@emeraldcoastsystemsgroup.com   | B22 (half a): RoomArmPlant -- the same arm standing in a ROOM, held
    |                                           | as a session and stepped by the caller instead of run to
    |                                           | completion here. The simulation that owns the world needs the
    |                                           | measurement every step to keep its guards honest, so `step`
    |                                           | returns the joints' REAL angles, what each servo exerted, the
    |                                           | scene solid a link is touching and whether the arm has settled
    |                                           | (inside tolerance AND stopped -- a joint still drifting under
    |                                           | gravity has not arrived). Snapshot/restore make the rehearsal
    |                                           | clone start where the live arm stands.
"""
from __future__ import annotations

import math
import os
import sys
import time
from typing import Callable

import numpy as np

ENGINE_DIR = os.environ.get("EMBODIED_ENGINE_DIR") or os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ENGINE_DIR)

import mujoco  # noqa: E402

ARM_JOINTS = ("j1", "j2", "j3", "j4", "j5", "j6")
GRIP_OPEN_RAD = 0.05
GRIP_CLOSED_RAD = -0.6
SETTLE_RAD = 0.01
SETTLE_SPEED_RADS = 0.05
# Trimming out the servos' sag: how many corrections, how large each may be, and how long each is given to settle.
TRIM_ROUNDS = 8
TRIM_MAX_RAD = 0.06
TRIM_SETTLE_S = 0.25
# A trim must cut the error by a fifth to earn another round, and the total trim never exceeds this.
TRIM_PROGRESS = 0.8
TRIM_LIMIT_RAD = 0.1
# How fast a commanded angle may pick up speed (rad/s²): the acceleration the arm is designed for.
PROFILE_ACCEL_RADS2 = 4.0
IK_DAMPING = 0.05
IK_ORIENTATION_WEIGHT = 0.6
IK_STEP_MAX_RAD = 0.2
# Elbow-down, elbow-up, reaching low and reaching high: the branches a six-axis arm's inverse kinematics has to be
# started on, since damped least squares only finds the one its seed is in.
IK_SEEDS = [
    np.array([0.0, 0.6, -1.2, 0.0, -1.0, 0.0]),
    np.array([0.0, 0.6, 1.2, 0.0, 1.0, 0.0]),
    np.array([0.0, -0.4, -2.0, 0.0, -0.7, 0.0]),
    np.array([0.0, 1.2, -2.2, 0.0, -0.5, 0.0]),
    np.array([0.0, 0.2, -0.6, 0.0, -1.6, 0.0]),
]


def _rotation_error(axis: np.ndarray, want: np.ndarray) -> np.ndarray:
    """@description The rotation that takes one unit axis onto another, as a vector along the rotation axis with the
    angle as its length. A plain cross product vanishes when the two are opposite -- exactly the pose the tool starts
    in, pointing up while the target wants it down -- so the angle is taken with atan2 and a perpendicular is chosen."""
    cross = np.cross(axis, want)
    s = float(np.linalg.norm(cross))
    angle = math.atan2(s, float(np.dot(axis, want)))
    if s < 1e-9:
        if angle < 1e-9:
            return np.zeros(3)
        perpendicular = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        cross = np.cross(axis, perpendicular)
        s = float(np.linalg.norm(cross))
    return cross / s * angle


class ArmPlant:
    """@description The printed arm in MuJoCo: joint servos, a gripper, a bench and a block, with the tool site the
    inverse kinematics drives. One plant, one arm; it is stepped by whoever holds it."""

    def __init__(self, mjcf: str, seed: int = 0) -> None:
        self.model = mujoco.MjModel.from_xml_string(mjcf)
        self.data = mujoco.MjData(self.model)
        self.rng = np.random.default_rng(seed)
        self.joint_ids = [self.model.joint(n).id for n in ARM_JOINTS]
        self.qpos_adr = [int(self.model.jnt_qposadr[i]) for i in self.joint_ids]
        self.dof_adr = [int(self.model.jnt_dofadr[i]) for i in self.joint_ids]
        self.act_ids = [self.model.actuator(n).id for n in ARM_JOINTS]
        self.grip_act = self.model.actuator("grip").id
        self.grip_qpos = int(self.model.jnt_qposadr[self.model.joint("grip").id])
        self.tcp = self.model.site("tcp").id
        self.payload_body = self.model.body("payload").id
        self.block_body = self.model.body("block").id
        self.block_qpos = int(self.model.jnt_qposadr[self.model.joint("block").id])
        self.block_geom = self.model.geom("block").id
        self.jaw_geoms = {self.model.geom("jaw-fixed").id, self.model.geom("jaw-moving").id}
        self.bench_geom = self.model.geom("bench").id
        self.arm_geoms = {self.model.geom(f"link{k}").id for k in range(1, 7)} | {self.model.geom("palm").id} | self.jaw_geoms
        self.scratch = mujoco.MjData(self.model)
        self.limits = [(float(self.model.jnt_range[i][0]), float(self.model.jnt_range[i][1])) for i in self.joint_ids]
        self.peak_torque = np.zeros(len(ARM_JOINTS))
        self.torque_sum = np.zeros(len(ARM_JOINTS))
        self.torque_samples = 0
        self.reset()

    # -- state ---------------------------------------------------------------
    @property
    def q(self) -> np.ndarray:
        return np.array([self.data.qpos[a] for a in self.qpos_adr])

    @property
    def torques(self) -> np.ndarray:
        """@description What each joint's servo is exerting right now (N·m)."""
        return np.array([float(self.data.actuator_force[a]) for a in self.act_ids])

    def tcp_pose(self) -> tuple[np.ndarray, np.ndarray]:
        """@description The tool point and the tool's axis (the site's z, pointing out of the jaws)."""
        mujoco.mj_forward(self.model, self.data)
        rot = self.data.site_xmat[self.tcp].reshape(3, 3)
        return np.array(self.data.site_xpos[self.tcp]), rot[:, 2]

    def block_pose(self) -> np.ndarray:
        return np.array(self.data.xpos[self.block_body])

    def grasped(self) -> bool:
        """@description True while both jaws touch the block."""
        touching = set()
        for i in range(self.data.ncon):
            c = self.data.contact[i]
            pair = {int(c.geom1), int(c.geom2)}
            if self.block_geom in pair:
                touching |= pair & self.jaw_geoms
        return len(touching) == 2

    # -- commands ------------------------------------------------------------
    def set_payload(self, kg: float) -> None:
        """@description Hang a mass on the tool point: what the arm is sized to carry."""
        self.model.body_mass[self.payload_body] = max(1e-6, float(kg))

    def set_block(self, x: float, y: float, yaw: float = 0.0) -> None:
        half = float(self.model.geom_size[self.block_geom][2])
        self.data.qpos[self.block_qpos: self.block_qpos + 3] = [x, y, half]
        self.data.qpos[self.block_qpos + 3: self.block_qpos + 7] = [math.cos(yaw / 2), 0, 0, math.sin(yaw / 2)]
        self.data.qvel[:] = 0.0
        mujoco.mj_forward(self.model, self.data)

    def reset(self, q: np.ndarray | None = None) -> None:
        mujoco.mj_resetData(self.model, self.data)
        start = np.array([0.0, 0.6, -1.2, 0.0, -1.0, 0.0]) if q is None else np.array(q, dtype=float)
        for a, v, (lo, hi) in zip(self.qpos_adr, start, self.limits):
            self.data.qpos[a] = min(hi, max(lo, float(v)))
        self.data.qpos[self.grip_qpos] = GRIP_OPEN_RAD
        self.data.ctrl[:] = 0.0
        for act, v in zip(self.act_ids, self.q):
            self.data.ctrl[act] = v
        self.data.ctrl[self.grip_act] = GRIP_OPEN_RAD
        self.peak_torque[:] = 0.0
        self.torque_sum[:] = 0.0
        self.torque_samples = 0
        mujoco.mj_forward(self.model, self.data)

    def command(self, q: np.ndarray, grip: float | None = None) -> None:
        for act, v, (lo, hi) in zip(self.act_ids, q, self.limits):
            self.data.ctrl[act] = min(hi, max(lo, float(v)))
        if grip is not None:
            self.data.ctrl[self.grip_act] = float(grip)

    def step(self, seconds: float) -> None:
        """@description Advance the simulation, remembering what each servo had to exert: the peak and the running mean."""
        for _ in range(max(1, int(round(seconds / self.model.opt.timestep)))):
            mujoco.mj_step(self.model, self.data)
            torque = np.abs(self.torques)
            self.peak_torque = np.maximum(self.peak_torque, torque)
            self.torque_sum += torque
            self.torque_samples += 1

    @property
    def mean_torque(self) -> np.ndarray:
        """@description The mean torque each servo has exerted since the last reset (N·m): what its duty cycle is judged on."""
        return self.torque_sum / max(1, self.torque_samples)

    # -- inverse kinematics --------------------------------------------------
    def ik(self, target: np.ndarray, tool_axis: np.ndarray | None = None, seed: np.ndarray | None = None, iterations: int = 300) -> tuple[np.ndarray, float]:
        """@description Damped least squares on the tool site from several seeds: joint angles that put the tool point on
        `target` with its axis along `tool_axis` (straight down by default), clamped to the joint limits. One seed is not
        enough -- a six-axis arm has elbow-up and elbow-down branches and a single seed walks into a joint limit and stops.
        @returns The best angles found and the position error left (m)."""
        seeds = [np.array(seed, dtype=float)] if seed is not None else IK_SEEDS + [self.q.copy()]
        best_q = seeds[0]; best_err = math.inf; best_clear = False
        for s in seeds:
            q, err = self._ik_from(target, tool_axis, s, iterations)
            clear = not self.collides(q)
            # A pose that reaches the point through the bench is not a solution: prefer a clear one at any error.
            if (clear and not best_clear) or (clear == best_clear and err < best_err):
                best_q, best_err, best_clear = q, err, clear
            if best_clear and best_err < 1e-3:
                break
        return best_q, (best_err if best_clear else math.inf)

    def _ik_from(self, target: np.ndarray, tool_axis: np.ndarray | None, seed: np.ndarray, iterations: int) -> tuple[np.ndarray, float]:
        want_axis = np.array([0.0, 0.0, -1.0]) if tool_axis is None else np.array(tool_axis, dtype=float)
        q = np.array(seed, dtype=float)
        scratch = mujoco.MjData(self.model)
        scratch.qpos[:] = self.data.qpos
        jacp = np.zeros((3, self.model.nv)); jacr = np.zeros((3, self.model.nv))
        error = math.inf
        for _ in range(iterations):
            for a, v in zip(self.qpos_adr, q):
                scratch.qpos[a] = v
            mujoco.mj_kinematics(self.model, scratch)
            mujoco.mj_comPos(self.model, scratch)
            pos = np.array(scratch.site_xpos[self.tcp])
            axis = scratch.site_xmat[self.tcp].reshape(3, 3)[:, 2]
            e_pos = target - pos
            e_rot = _rotation_error(axis, want_axis) * IK_ORIENTATION_WEIGHT
            error = float(np.linalg.norm(e_pos))
            if error < 1e-4 and float(np.linalg.norm(e_rot)) < 1e-3:
                break
            mujoco.mj_jacSite(self.model, scratch, jacp, jacr, self.tcp)
            jac = np.vstack([jacp[:, self.dof_adr], jacr[:, self.dof_adr] * IK_ORIENTATION_WEIGHT])
            e = np.concatenate([e_pos, e_rot])
            dq = jac.T @ np.linalg.solve(jac @ jac.T + (IK_DAMPING ** 2) * np.eye(6), e)
            dq = np.clip(dq, -IK_STEP_MAX_RAD, IK_STEP_MAX_RAD)
            q = np.array([min(hi, max(lo, v + d)) for v, d, (lo, hi) in zip(q, dq, self.limits)])
        return q, error

    def collides(self, q: np.ndarray) -> bool:
        """@description True when a configuration puts a link through the bench or into the block: the arm's own guard,
        the counterpart of the kinematic sim's configuration check. Jaws touching the block are the point, not a clash."""
        for a, v in zip(self.qpos_adr, q):
            self.scratch.qpos[a] = v
        mujoco.mj_forward(self.model, self.scratch)
        for i in range(self.scratch.ncon):
            c = self.scratch.contact[i]
            pair = {int(c.geom1), int(c.geom2)}
            if not (pair & self.arm_geoms):
                continue
            if self.block_geom in pair and (pair & self.jaw_geoms):
                continue
            if self.bench_geom in pair or self.block_geom in pair:
                return True
        return False

    # -- the tests the design is checked with --------------------------------
    def hold(self, q: np.ndarray, payload_kg: float, seconds: float = 1.0) -> np.ndarray:
        """@description Put the arm in a pose with the payload on the tool and let it hold: the mean torque each servo
        settles at (N·m). This is what the sizing table is checked against."""
        self.reset(q)
        self.set_payload(payload_kg)
        self.command(q)
        self.step(seconds * 0.7)
        samples = []
        for _ in range(max(1, int(round(seconds * 0.3 / self.model.opt.timestep)))):
            mujoco.mj_step(self.model, self.data)
            samples.append(np.abs(self.torques))
        return np.mean(np.array(samples), axis=0)

    def move_to(self, q_target: np.ndarray, speeds: np.ndarray, grip: float | None = None, timeout: float = 6.0) -> bool:
        """@description Ramp the commanded angles at the joints' commanded speeds, then trim the command until the joint
        sits where it was sent: a position servo holds a load by standing off it, so under gravity it settles short of
        its command by its torque over its gain (about a centimetre at this arm's tool). The node trims that out the way
        an operator would, and every trim is ramped too, so the servos never see a step.
        @returns True when every joint settled inside the tolerance before the timeout."""
        offset = np.zeros(len(ARM_JOINTS))
        deadline = timeout
        previous = math.inf
        for _ in range(TRIM_ROUNDS + 1):
            spent = self._ramp(np.array(q_target) + offset, speeds, grip, deadline)
            deadline -= spent
            self.step(TRIM_SETTLE_S)
            deadline -= TRIM_SETTLE_S
            error = np.array(q_target) - self.q
            worst = float(np.max(np.abs(error)))
            if worst < SETTLE_RAD:
                return True
            # Anti-wind-up: when a trim stops buying anything the joint is held by something — a jaw on the block, a
            # link on the bench — and more command is only more torque against it. Stop, and say the leg did not settle.
            if deadline <= 0 or worst > TRIM_PROGRESS * previous:
                break
            previous = worst
            offset = np.clip(offset + np.clip(error, -TRIM_MAX_RAD, TRIM_MAX_RAD), -TRIM_LIMIT_RAD, TRIM_LIMIT_RAD)
        return bool(float(np.max(np.abs(np.array(q_target) - self.q))) < SETTLE_RAD)

    def _ramp(self, command: np.ndarray, speeds: np.ndarray, grip: float | None, timeout: float) -> float:
        """@description Walk the command to a target on a trapezoidal profile: accelerate to the joint's commanded speed,
        cruise, and slow into the target. A command that jumps straight to full speed costs the servo its stall torque
        for the first tenth of a second — the profile keeps what it spends near what it is carrying.
        @returns The seconds it took."""
        dt = float(self.model.opt.timestep)
        cmd = np.array([float(self.data.ctrl[a]) for a in self.act_ids])
        speed = np.zeros(len(ARM_JOINTS))
        elapsed = 0.0
        while elapsed < timeout:
            delta = np.array(command) - cmd
            if float(np.max(np.abs(delta))) < 1e-6:
                break
            # Slow down in time to stop on the target, and never exceed the commanded speed.
            approach = np.sqrt(2 * PROFILE_ACCEL_RADS2 * np.abs(delta))
            speed = np.minimum(np.minimum(speed + PROFILE_ACCEL_RADS2 * dt, np.array(speeds)), approach)
            cmd = cmd + np.clip(delta, -speed * dt, speed * dt)
            self.command(cmd, grip)
            self.step(dt)
            elapsed += dt
        return elapsed


def pick_and_place(plant: ArmPlant, speeds: np.ndarray, block_xy: tuple[float, float], place_xy: tuple[float, float], payload_kg: float = 0.0,
                   log: Callable[[str], None] | None = None) -> dict:
    """@description The taught pick-and-place: open, reach above the block, descend, close, lift, carry, place, open,
    retreat. The deterministic baseline ADR-152 D5 task 3 compares a learned policy with.
    @param plant - The arm. @param speeds - Commanded joint speeds (rad/s). @param block_xy - Where the block is.
    @param place_xy - Where it goes. @param payload_kg - Extra mass on the tool (0: the block is the load).
    @returns What happened: each leg, whether the block ended on the target, the seconds and the peak torques."""
    say = log or (lambda _m: None)
    plant.set_payload(payload_kg)
    half = float(plant.model.geom_size[plant.block_geom][2])
    started = time.monotonic()
    legs: list[dict] = []

    def go(name: str, target: np.ndarray, grip: float, timeout: float = 6.0) -> bool:
        q, err = plant.ik(target)
        if err > 0.01:
            legs.append({"leg": name, "reached": False, "ikErrorM": round(err, 4)})
            say(f"{name}: the arm cannot reach {np.round(target, 3)} (inverse kinematics left {err * 1000:.0f} mm)")
            return False
        ok = plant.move_to(q, speeds, grip, timeout)
        pos, _axis = plant.tcp_pose()
        legs.append({"leg": name, "reached": bool(ok), "errorM": round(float(np.linalg.norm(pos - target)), 4)})
        say(f"{name}: {'settled' if ok else 'did not settle'} {np.round(pos, 3)}")
        return ok

    above_block = np.array([block_xy[0], block_xy[1], half + 0.10])
    at_block = np.array([block_xy[0], block_xy[1], half])
    above_place = np.array([place_xy[0], place_xy[1], half + 0.10])
    at_place = np.array([place_xy[0], place_xy[1], half + 0.004])
    go("approach", above_block, GRIP_OPEN_RAD)
    go("descend", at_block, GRIP_OPEN_RAD, 4.0)
    plant.command(plant.q, GRIP_CLOSED_RAD)
    plant.step(0.4)
    grasped = plant.grasped()
    say(f"close: {'holding' if grasped else 'nothing between the jaws'}")
    go("lift", above_block, GRIP_CLOSED_RAD, 4.0)
    carried = bool(plant.block_pose()[2] > half + 0.04)
    go("carry", above_place, GRIP_CLOSED_RAD)
    go("place", at_place, GRIP_CLOSED_RAD, 4.0)
    plant.command(plant.q, GRIP_OPEN_RAD)
    plant.step(0.3)
    go("retreat", above_place, GRIP_OPEN_RAD, 4.0)
    plant.step(0.3)
    block = plant.block_pose()
    placed = bool(np.linalg.norm(block[:2] - np.array(place_xy)) < 0.03 and block[2] < half + 0.01)
    return {
        "success": bool(grasped and carried and placed), "grasped": grasped, "carried": carried, "placed": placed,
        "blockEndM": [round(float(v), 4) for v in block], "seconds": round(time.monotonic() - started, 2),
        "peakTorqueNm": [round(float(v), 3) for v in plant.peak_torque], "meanTorqueNm": [round(float(v), 3) for v in plant.mean_torque], "legs": legs,
    }


class RoomArmPlant:
    """@description The printed arm standing in a ROOM (B22 half a): the same joints and gripper the bench model has,
    but the world around it is the scene's own solids, so a contact is a contact with the furniture that is really
    there. It is stepped by whoever holds it at the caller's own step, never run to completion here -- the simulation
    that owns the world decides when a leg is over, and it needs the measurement every step to keep its guards honest."""

    def __init__(self, mjcf: str, seed: int = 0) -> None:
        self.model = mujoco.MjModel.from_xml_string(mjcf)
        self.data = mujoco.MjData(self.model)
        self.seed = int(seed)
        self.steps = 0
        self.joint_ids = [self.model.joint(n).id for n in ARM_JOINTS]
        self.qpos_adr = [int(self.model.jnt_qposadr[i]) for i in self.joint_ids]
        self.act_ids = [self.model.actuator(n).id for n in ARM_JOINTS]
        self.grip_act = self.model.actuator("grip").id
        self.grip_qpos = int(self.model.jnt_qposadr[self.model.joint("grip").id])
        self.limits = [(float(self.model.jnt_range[i][0]), float(self.model.jnt_range[i][1])) for i in self.joint_ids]
        self.arm_geoms = {self.model.geom(f"link{k}").id for k in range(1, 7)}
        self.arm_geoms |= {self.model.geom("palm").id, self.model.geom("jaw-fixed").id, self.model.geom("jaw-moving").id}
        for a, (lo, hi) in zip(self.qpos_adr, self.limits):
            self.data.qpos[a] = min(hi, max(lo, 0.0))
        self.data.qpos[self.grip_qpos] = GRIP_OPEN_RAD
        for act, a in zip(self.act_ids, self.qpos_adr):
            self.data.ctrl[act] = float(self.data.qpos[a])
        self.data.ctrl[self.grip_act] = GRIP_OPEN_RAD
        mujoco.mj_forward(self.model, self.data)

    @property
    def q(self) -> list[float]:
        """@description The joint angles the arm really holds (rad)."""
        return [float(self.data.qpos[a]) for a in self.qpos_adr]

    @property
    def torques(self) -> list[float]:
        """@description What each servo is exerting right now (N.m) -- the sizing's own units, so a saturation shows."""
        return [float(self.data.actuator_force[a]) for a in self.act_ids]

    def contact(self) -> str | None:
        """@description The first scene geom an arm link is touching, by name, or None. A contact between two arm parts
        is excluded in the model, so anything here is the arm against the room."""
        for i in range(self.data.ncon):
            c = self.data.contact[i]
            pair = {int(c.geom1), int(c.geom2)}
            other = pair - self.arm_geoms
            if pair & self.arm_geoms and other:
                name = self.model.geom(int(next(iter(other)))).name or "unnamed"
                return name.split(".")[0]
        return None

    def step(self, q_target: list[float], grip: float, dt: float) -> dict:
        """@description Command the servos and advance the physics by the caller's step.
        @param q_target The commanded joint angles (rad). @param grip The commanded jaw hinge angle (rad).
        @param dt The caller's step (s) -- run as whole model timesteps, at least one.
        @returns What the joints really did, what the servos exerted, what the arm touched and whether it has settled."""
        for act, v, (lo, hi) in zip(self.act_ids, q_target, self.limits):
            self.data.ctrl[act] = min(hi, max(lo, float(v)))
        self.data.ctrl[self.grip_act] = float(grip)
        for _ in range(max(1, int(round(float(dt) / self.model.opt.timestep)))):
            mujoco.mj_step(self.model, self.data)
        self.steps += 1
        q = self.q
        error = max(abs(a - float(b)) for a, b in zip(q, q_target)) if q_target else 0.0
        speed = max(abs(float(self.data.qvel[int(self.model.jnt_dofadr[i])])) for i in self.joint_ids)
        return {
            "q": [round(v, 6) for v in q],
            "torqueNm": [round(v, 4) for v in self.torques],
            "grip": round(float(self.data.qpos[self.grip_qpos]), 5),
            "contact": self.contact(),
            # A position servo stands off its command by its load over its gain: settled is "inside tolerance AND no
            # longer moving", never "the ramp finished". A joint still drifting under gravity has not arrived.
            "settled": bool(error < SETTLE_RAD and speed < SETTLE_SPEED_RADS),
        }

    def snapshot(self) -> dict:
        """@description Everything a clone needs: the state vector and what is commanded."""
        return {"qpos": self.data.qpos.copy(), "qvel": self.data.qvel.copy(), "ctrl": self.data.ctrl.copy(), "time": float(self.data.time)}

    def restore(self, s: dict) -> None:
        """@description Put a snapshot back into this plant -- how a rehearsal copy starts where the live one stands."""
        self.data.qpos[:] = s["qpos"]
        self.data.qvel[:] = s["qvel"]
        self.data.ctrl[:] = s["ctrl"]
        self.data.time = s["time"]
        mujoco.mj_forward(self.model, self.data)
