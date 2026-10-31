"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 lane L2 -- the spider-18 as a MuJoCo plant serving the brief's
    |                                           | 3.2 protocol: load (the generated MJCF), reset (upright, inverted or
    |                                           | random), step (eighteen targets for dt), jump (the latched spring:
    |                                           | crouch until the wound rod's tip rests on the floor, trip the latch),
    |                                           | state (the brief's state dict, key for key). The plant reads every
    |                                           | number it needs out of the model it was handed -- mounts, link
    |                                           | lengths, limits, the stand height, the rod -- so nothing from the
    |                                           | brief is restated here. The measured episodes (stance, a walk per
    |                                           | command, the inverted walk, the flip and recovery, the hop) are what
    |                                           | the check route and the training task both run, so a number the
    |                                           | route reports and a number the report carries are the same
    |                                           | measurement. `hexapod_op` is the bridge's dispatch for the whole
    |                                           | `hexapod.*` family: its own sessions and its own lock, the check
    |                                           | under a second lock so it never holds up a live plant. A refusal is
    |                                           | an exception CLASS named as its wire code, because the bridge
    |                                           | answers `type(error).__name__` as `error` and `str(error)` as `reason`.
2   | maintainer@emeraldcoastsystemsgroup.com   | B30 gate: a session may load `controller: policy:<file>` -- only through
    |                                           | tasks.hexapod_certify.load_certified (refused by name otherwise) --
    |                                           | and then `hexapod.step {command}` lets that policy shape the gait in
    |                                           | the container; `hexapod.certify` runs the gate under the check lock.
"""
from __future__ import annotations

import json
import math
import os
import sys
import threading
import time
from typing import Callable

import numpy as np

ENGINE_DIR = os.environ.get("EMBODIED_ENGINE_DIR") or os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ENGINE_DIR)

import mujoco  # noqa: E402

from hexapod_gaits import (  # noqa: E402
    ACTUATOR_ORDER, HOP_CROUCH_S, HOP_HOLD_S, HOP_PUSH_S, LEG_IDS, InversionDetector, LegGeometry, clamp_command, cpg_targets, crouch_foot,
    feet_to_targets, inverted_joint_targets, legs_hop_targets, stance_targets,
)

CONTROL_DT_S = 0.02
DEFAULT_SESSION = "hexapod"
POSES = ("upright", "inverted", "random")
#: A body is "fell" when it lies on its side: neither way up, |cos tilt| under this.
FELL_COS_TILT = 0.5
#: Reset settles the stance for this long (so contacts exist and the accelerometer reads g), then zeroes the clock.
SETTLE_S = 0.2
#: A seeded reset jitters the start targets by up to this (rad) and the random pose's position by RANDOM_XY_M.
JITTER_RAD = 0.02
RANDOM_XY_M = 0.05
# The spring jump: crouch for this long, hold, release, and report the state this long after the latch trips.
CROUCH_S = 0.6
CROUCH_HOLD_S = 0.2
RELEASE_S = 0.04
#: The crouch puts the body this much LOWER than "tip on the floor" so the tip carries the body before release (m).
CROUCH_PRESS_M = 0.002
#: Recovery after a flip: forward speed at half the command, held for this long, says the gait has recovered.
RECOVER_FRACTION = 0.5
RECOVER_HOLD_S = 0.5
#: The flip teleports the body this far above its stand height before it drops onto its back.
FLIP_DROP_M = 0.05
#: Tracking is scored after the gait's ramp-in.
TRACK_FROM_S = 1.0
STANCE_TOLERANCE_M = 0.01
HOP_TOTAL_S = HOP_CROUCH_S + HOP_HOLD_S + HOP_PUSH_S
WALK_COMMANDS = ({"vx": 0.15, "vy": 0.0, "yawRate": 0.0}, {"vx": 0.0, "vy": 0.1, "yawRate": 0.0}, {"vx": 0.0, "vy": 0.0, "yawRate": 0.5})


class HexapodRefused(Exception):
    """@description A refusal by name. Each refusal is a subclass whose class NAME is the wire code: the bridge writes
    `type(error).__name__` as `error` and `str(error)` as `reason`, so the name is the contract."""

    def __init__(self, because: str) -> None:
        super().__init__(because)
        self.because = because


_REFUSALS: dict[str, type] = {}


def refuse(code: str, because: str):
    """@description Raise the refusal named `code` with its reason. @param code The wire code (no_spring, not_wound, ...).
    @param because Why. @raises HexapodRefused always."""
    cls = _REFUSALS.get(code)
    if cls is None:
        cls = type(code, (HexapodRefused,), {"__doc__": f"@description The `{code}` refusal."})
        _REFUSALS[code] = cls
    raise cls(because)


def quat_mul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """@description Hamilton product of two (w, x, y, z) quaternions. @param a Left. @param b Right. @returns a*b."""
    out = np.zeros(4)
    mujoco.mju_mulQuat(out, a, b)
    return out


def quat_yaw(q: np.ndarray) -> float:
    """@description The heading of a body: the yaw of its x axis seen from above. @param q (w, x, y, z). @returns Radians."""
    w, x, y, z = (float(v) for v in q)
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def heading_frame(q: np.ndarray) -> np.ndarray:
    """@description The heading frame's axes as rows: x along the body's x seen from above, y to the LEFT seen from above
    (world z cross x), the same frame upright or inverted. @param q The body quaternion. @returns 2x3 (x row, y row)."""
    yaw = quat_yaw(q)
    return np.array([[math.cos(yaw), math.sin(yaw), 0.0], [-math.sin(yaw), math.cos(yaw), 0.0]])


class HexapodPlant:
    """@description One MuJoCo world with one spider: the physics and its servos, stepped by whoever holds it. Reads its
    geometry from the model; counts the mechanical energy the servos spend; knows which way up it is."""

    def __init__(self, mjcf: str, seed: int = 0) -> None:
        self.model = mujoco.MjModel.from_xml_string(mjcf)
        self.data = mujoco.MjData(self.model)
        self.seed = int(seed)
        self.rng = np.random.default_rng(self.seed)
        m = self.model
        missing = [n for n in ACTUATOR_ORDER if mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_ACTUATOR, n) < 0]
        if missing or m.nu != len(ACTUATOR_ORDER):
            refuse("bad_model", f"the model must carry exactly the eighteen actuators of ACTUATOR_ORDER; missing {missing}, nu={m.nu}")
        self.act_ids = [m.actuator(n).id for n in ACTUATOR_ORDER]
        self.jnt_ids = [m.joint(n).id for n in ACTUATOR_ORDER]
        self.qpos_adr = [int(m.jnt_qposadr[j]) for j in self.jnt_ids]
        self.dof_adr = [int(m.jnt_dofadr[j]) for j in self.jnt_ids]
        self.body = m.body("body").id
        free = m.joint("body-free").id
        self.free_qpos = int(m.jnt_qposadr[free])
        self.free_dof = int(m.jnt_dofadr[free])
        self.floor = m.geom("floor").id
        self.foot_geoms = [m.geom(f"{leg}-foot").id for leg in LEG_IDS]
        self.gyro_adr = int(m.sensor("gyro").adr)
        self.accel_adr = int(m.sensor("accel").adr)
        spring = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, "spring")
        self.spring_jnt = None if spring < 0 else spring
        self.spring_qpos = None if spring < 0 else int(m.jnt_qposadr[spring])
        self.spring_eq = None if spring < 0 else m.equality("spring-latch").id
        self.geo = self._geometry()
        self.substeps = max(1, int(round(CONTROL_DT_S / m.opt.timestep)))
        self.energy_j = 0.0
        self.peak_torque = np.zeros(len(ACTUATOR_ORDER))
        self.controller = None
        self.reset("upright")

    def _geometry(self) -> LegGeometry:
        """@description Read the gait's geometry out of the model: mounts and hinge signs, link lengths, the foot, the stand height, the body's half height, the limits."""
        m = self.model
        mounts, axis = {}, {}
        for leg in LEG_IDS:
            b = m.body(f"{leg}-coxa").id
            q = m.body_quat[b]
            mounts[leg] = (float(m.body_pos[b][0]), float(m.body_pos[b][1]), 2 * math.atan2(float(q[3]), float(q[0])))
            axis[leg] = float(np.sign(m.jnt_axis[m.joint(f"{leg}-coxa").id][2]))
        foot = m.geom("L1-foot").id
        return LegGeometry(
            mounts=mounts, coxa_axis_z=axis,
            coxa_m=float(m.body_pos[m.body("L1-femur").id][0]), femur_m=float(m.body_pos[m.body("L1-tibia").id][0]),
            foot_centre_m=float(m.geom_pos[foot][0]), foot_radius_m=float(m.geom_size[foot][0]),
            stand_height_m=float(m.numeric("standHeightM").data[0]), body_half_height_m=float(m.geom_size[m.geom("body-plates").id][2]),
            limits={name: (float(m.jnt_range[j][0]), float(m.jnt_range[j][1])) for name, j in zip(ACTUATOR_ORDER, self.jnt_ids)},
        )

    # -- what the bridge answers at load ---------------------------------------
    def info(self) -> dict:
        """@description The load reply: the actuators in order, the physics step and whether a spring is fitted."""
        return {"actuators": list(ACTUATOR_ORDER), "timestepS": float(self.model.opt.timestep), "hasSpring": self.spring_jnt is not None, "controller": self.controller_name()}

    def controller_name(self) -> str:
        """@description Who makes the targets: `targets` (whoever steps the plant) or `policy:<file>`. @returns The name."""
        return "targets" if self.controller is None else self.controller.name

    def set_controller(self, spec, report_dir: str | None) -> str:
        """@description `targets` (or nothing) keeps the plant on whoever steps it; `policy:<file>` plays a certified policy
        from the report directory, loaded only through the gate's door. @param spec The request's controller.
        @param report_dir Where policies and certificates live. @returns The controller's name.
        @raises bad_controller, policy_not_found, policy_not_certified by name."""
        text = (spec or "targets").strip() if isinstance(spec, str) else None
        if text is None or not text or text == "targets":
            self.controller = None
            return "targets"
        if not text.startswith("policy:") or not report_dir:
            refuse("bad_controller", "controller must be \"targets\" or \"policy:<file>\" on an engine with a report directory")
        from tasks.hexapod_certify import PolicyGait  # noqa: PLC0415 -- torch only when a policy plays
        self.controller = PolicyGait(os.path.join(report_dir, os.path.basename(text[len("policy:"):])))
        self.controller.reset(self.inverted())
        return self.controller.name

    # -- truth -----------------------------------------------------------------
    @property
    def body_quat(self) -> np.ndarray:
        return np.array(self.data.qpos[self.free_qpos + 3: self.free_qpos + 7])

    def up_cos(self) -> float:
        """@description Body z against world z: +1 upright, -1 inverted, 0 on its side. @returns cos of the tilt."""
        q = self.body_quat
        return float(1 - 2 * (q[1] * q[1] + q[2] * q[2]))

    def inverted(self) -> bool:
        """@description The plant's truth: body z points down. @returns True when inverted."""
        return self.up_cos() < 0.0

    def fell(self) -> bool:
        """@description On its side: neither way up. @returns True when |cos tilt| < FELL_COS_TILT."""
        return abs(self.up_cos()) < FELL_COS_TILT

    def floor_contacts(self) -> set:
        """@description The spider geoms touching the floor right now. @returns A set of geom ids."""
        out = set()
        for i in range(self.data.ncon):
            c = self.data.contact[i]
            if int(c.geom1) == self.floor:
                out.add(int(c.geom2))
            elif int(c.geom2) == self.floor:
                out.add(int(c.geom1))
        return out

    def foot_contacts(self) -> list[bool]:
        """@description Which feet are on the floor, in LEG_IDS order. @returns Six booleans."""
        touching = self.floor_contacts()
        return [g in touching for g in self.foot_geoms]

    def spring_state(self) -> dict | None:
        """@description The spring: energy stored (k q^2 / 2 from the model's stiffness and the rod's real position) and whether the latch holds. @returns The dict, or None without a spring."""
        if self.spring_jnt is None:
            return None
        q = float(self.data.qpos[self.spring_qpos])
        k = float(self.model.jnt_stiffness[self.spring_jnt])
        return {"storedJ": round(0.5 * k * q * q, 4), "latched": bool(self.data.eq_active[self.spring_eq])}

    def state(self) -> dict:
        """@description The brief's state dict, key for key (3.2). `inverted` is the plant's truth; the node decides it from `accelMps2` alone."""
        d = self.data
        s = self.free_qpos
        return {
            "timeS": round(float(d.time), 6),
            "bodyPosM": [round(float(v), 6) for v in d.qpos[s: s + 3]],
            "bodyQuatWXYZ": [round(float(v), 6) for v in d.qpos[s + 3: s + 7]],
            "bodyVelMps": [round(float(v), 6) for v in d.qvel[self.free_dof: self.free_dof + 3]],
            "gyroRadS": [round(float(v), 6) for v in d.sensordata[self.gyro_adr: self.gyro_adr + 3]],
            "accelMps2": [round(float(v), 6) for v in d.sensordata[self.accel_adr: self.accel_adr + 3]],
            "jointPosRad": [round(float(d.qpos[a]), 6) for a in self.qpos_adr],
            "jointVelRadS": [round(float(d.qvel[a]), 6) for a in self.dof_adr],
            "jointTorqueNm": [round(float(d.actuator_force[a]), 6) for a in self.act_ids],
            "footContact": self.foot_contacts(),
            "inverted": self.inverted(),
            "fell": self.fell(),
            "spring": self.spring_state(),
        }

    # -- commands --------------------------------------------------------------
    def reset(self, pose: str = "upright", seed: int | None = None) -> dict:
        """@description Put the spider in a pose at its stand height with the stance targets commanded, wind the spring,
        settle for SETTLE_S and zero the clock. `random` draws up or down, a heading and a small offset from the seed;
        any seeded reset jitters the start targets by JITTER_RAD. @param pose upright | inverted | random. @param seed
        Reseeds the plant's generator when given. @returns The state. @raises bad_pose for anything else."""
        if pose not in POSES:
            refuse("bad_pose", f"pose must be one of {POSES}, got {pose!r}")
        if seed is not None:
            self.seed = int(seed)
            self.rng = np.random.default_rng(self.seed)
        inverted = pose == "inverted" or (pose == "random" and bool(self.rng.integers(0, 2)))
        yaw = float(self.rng.uniform(-math.pi, math.pi)) if pose == "random" else 0.0
        xy = self.rng.uniform(-RANDOM_XY_M, RANDOM_XY_M, 2) if pose == "random" else np.zeros(2)
        targets = np.array(stance_targets(self.geo, inverted))
        if pose == "random" or seed:
            targets += self.rng.uniform(-JITTER_RAD, JITTER_RAD, len(targets))
        self._place(xy, self.geo.stand_height_m, yaw, inverted, targets)
        self._wind(inverted)
        self.energy_j = 0.0
        self.peak_torque[:] = 0.0
        self._advance(targets, SETTLE_S)
        self.data.time = 0.0
        self.energy_j = 0.0
        self.peak_torque[:] = 0.0
        if self.controller is not None:
            self.controller.reset(inverted)
        return self.state()

    def _place(self, xy: np.ndarray, z: float, yaw: float, inverted: bool, targets: np.ndarray) -> None:
        """@description Set the body's pose and the joints to the targets, every velocity zero."""
        mujoco.mj_resetData(self.model, self.data)
        d = self.data
        s = self.free_qpos
        d.qpos[s: s + 3] = [float(xy[0]), float(xy[1]), float(z)]
        q = np.array([math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2)])
        if inverted:
            q = quat_mul(q, np.array([0.0, 1.0, 0.0, 0.0]))
        d.qpos[s + 3: s + 7] = q
        for a, v in zip(self.qpos_adr, targets):
            d.qpos[a] = float(v)
        self._command(targets)
        mujoco.mj_forward(self.model, d)

    def _wind(self, inverted: bool) -> None:
        """@description Wind and latch the spring with the rod displaced AWAY from the ground side, so a release drives it at the floor."""
        if self.spring_jnt is None:
            return
        stroke = float(self.model.jnt_range[self.spring_jnt][1])
        q = -stroke if inverted else stroke
        self.data.qpos[self.spring_qpos] = q
        self.data.qvel[int(self.model.jnt_dofadr[self.spring_jnt])] = 0.0
        self.model.eq_data[self.spring_eq][0] = q
        self.data.eq_active[self.spring_eq] = 1
        mujoco.mj_forward(self.model, self.data)

    def wind(self) -> dict:
        """@description Wind the spring for the orientation the body is in NOW (the winding servo re-cocking the cam, done
        in one step here: the brief's 2-3 s of winding happen between jumps). A wound rod protrudes on the sky side, so a
        body that flips while wound stands on it until it is re-wound. @returns The state. @raises no_spring without one."""
        if self.spring_jnt is None:
            refuse("no_spring", "this model has no spring piston: it was generated with jump=legs-hop")
        self._wind(self.inverted())
        return self.state()

    def _command(self, targets) -> None:
        for act, v, name in zip(self.act_ids, targets, ACTUATOR_ORDER):
            self.data.ctrl[act] = self.geo.clamp(name, float(v))

    def _advance(self, targets, seconds: float) -> None:
        """@description Command the servos and run whole physics steps for `seconds`, counting the mechanical energy spent and the peak torque."""
        self._command(targets)
        dt = float(self.model.opt.timestep)
        for _ in range(max(1, int(round(seconds / dt)))):
            mujoco.mj_step(self.model, self.data)
            torque = np.array([self.data.actuator_force[a] for a in self.act_ids])
            omega = np.array([self.data.qvel[a] for a in self.dof_adr])
            self.energy_j += float(np.sum(np.abs(torque * omega))) * dt
            self.peak_torque = np.maximum(self.peak_torque, np.abs(torque))

    def step(self, targets, dt: float = CONTROL_DT_S) -> dict:
        """@description Command eighteen targets and advance dt. @param targets Radians in ACTUATOR_ORDER. @param dt Seconds,
        run as whole physics steps (at least one). @returns The state after dt. @raises bad_targets unless eighteen finite numbers."""
        try:
            arr = np.array(targets, dtype=float).reshape(-1)
        except (TypeError, ValueError):
            refuse("bad_targets", "targetsRad must be eighteen numbers")
        if arr.shape != (len(ACTUATOR_ORDER),) or not np.all(np.isfinite(arr)):
            refuse("bad_targets", f"targetsRad must be eighteen finite numbers in ACTUATOR_ORDER, got {arr.shape[0]}")
        if not (math.isfinite(dt) and dt > 0):
            refuse("bad_targets", f"dtS must be a positive number, got {dt!r}")
        self._advance(arr, float(dt))
        return self.state()

    def step_command(self, cmd, dt: float = CONTROL_DT_S) -> dict:
        """@description A body command for the plant's own controller (a certified policy): it makes the eighteen targets and
        the plant steps them. @param cmd {vx, vy, yawRate}. @param dt Seconds. @returns The state plus `targetsRad` and
        `controller` (its name, its inverted decision, its action). @raises no_controller on a plant stepped by targets."""
        if self.controller is None:
            refuse("no_controller", "this session has no policy controller: load it with controller \"policy:<file>\" or step targetsRad")
        if not isinstance(cmd, dict):
            refuse("bad_targets", "command must be {vx, vy, yawRate}")
        targets, info = self.controller.targets(self, self.state(), cmd)
        state = self.step(targets, dt)
        return {**state, "targetsRad": [round(float(v), 6) for v in targets], "controller": info}

    def crouch_targets(self) -> np.ndarray:
        """@description The crouch that rests the wound rod's ground-side tip on the floor: the body lowered to the tip's reach, read from the rod geom and the stroke."""
        m = self.model
        rod = m.geom("spring-rod").id
        tip_reach = float(m.geom_size[rod][1] + m.geom_size[rod][0]) - float(m.jnt_range[self.spring_jnt][1])
        foot_z = -(tip_reach - CROUCH_PRESS_M - self.geo.foot_radius_m)
        return np.array(feet_to_targets(self.geo, {leg: crouch_foot(self.geo, leg, foot_z) for leg in LEG_IDS}, self.inverted()))

    def jump(self) -> dict:
        """@description The latched-spring jump: ramp the legs into the crouch over CROUCH_S until the wound rod's tip
        carries the body, hold, trip the latch, and report the state RELEASE_S later (the caller steps on through the
        flight with its own targets). @returns The state. @raises no_spring on a legs-hop model, not_wound when the latch is already open."""
        if self.spring_jnt is None:
            refuse("no_spring", "this model has no spring piston: it was generated with jump=legs-hop")
        if not self.data.eq_active[self.spring_eq]:
            refuse("not_wound", "the latch is open: reset winds the spring again")
        start = np.array([self.data.ctrl[a] for a in self.act_ids])
        crouch = self.crouch_targets()
        steps = max(1, int(round(CROUCH_S / CONTROL_DT_S)))
        for i in range(1, steps + 1):
            self._advance(start + (crouch - start) * (i / steps), CONTROL_DT_S)
        self._advance(crouch, CROUCH_HOLD_S)
        self.data.eq_active[self.spring_eq] = 0
        self._advance(crouch, RELEASE_S)
        return self.state()

    def flip(self) -> dict:
        """@description Roll the body over where it stands: teleported FLIP_DROP_M above its stand height, upside down, the
        joints as they are, every velocity zero. What the inverted task does mid-episode. @returns The state."""
        d = self.data
        s = self.free_qpos
        yaw = quat_yaw(self.body_quat)
        q = quat_mul(np.array([math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2)]), np.array([0.0, 1.0, 0.0, 0.0]))
        if self.inverted():
            q = np.array([math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2)])
        d.qpos[s + 2] = self.geo.stand_height_m + FLIP_DROP_M
        d.qpos[s + 3: s + 7] = q
        d.qvel[:] = 0.0
        mujoco.mj_forward(self.model, d)
        return self.state()

    def heading_velocity(self) -> tuple[float, float, float]:
        """@description The body's velocity in the heading frame and its yaw rate seen from above. @returns (vx, vy, yaw rate)."""
        frame = heading_frame(self.body_quat)
        v = np.array(self.data.qvel[self.free_dof: self.free_dof + 3])
        rot = np.zeros(9)
        mujoco.mju_quat2Mat(rot, self.body_quat)
        omega_world = rot.reshape(3, 3) @ np.array(self.data.qvel[self.free_dof + 3: self.free_dof + 6])
        return float(frame[0] @ v), float(frame[1] @ v), float(omega_world[2])


# -- the measured episodes (the check and the task share them) ------------------------------------------------------
Residual = Callable[[dict, np.ndarray, float], np.ndarray]


def _finish_walk(plant: HexapodPlant, cmd: tuple, samples: list, start_xy: np.ndarray, seconds: float, fell: bool) -> dict:
    v = np.array(samples) if samples else np.zeros((1, 3))
    vel = v.mean(axis=0)
    track = float(np.sqrt(np.mean((v[:, 0] - cmd[0]) ** 2 + (v[:, 1] - cmd[1]) ** 2))) if samples else float("nan")
    end = np.array(plant.data.qpos[plant.free_qpos: plant.free_qpos + 2])
    distance = float(np.linalg.norm(end - start_xy))
    mass = float(plant.model.body_subtreemass[plant.body])
    g = float(abs(plant.model.opt.gravity[2]))
    cot = plant.energy_j / (mass * g * distance) if distance > 0.01 else None
    return {"command": {"vx": cmd[0], "vy": cmd[1], "yawRate": cmd[2]}, "measured": {"vxMps": round(float(vel[0]), 4), "vyMps": round(float(vel[1]), 4), "yawRateRadS": round(float(vel[2]), 4)},
            "trackingErrorMps": round(track, 4), "distanceM": round(distance, 4), "energyJ": round(plant.energy_j, 4),
            "costOfTransport": None if cot is None else round(cot, 3), "fell": fell, "seconds": round(seconds, 3), "peakTorqueNm": round(float(plant.peak_torque.max()), 3)}


def walk_episode(plant: HexapodPlant, cmd: dict, seconds: float, pose: str = "upright", seed: int | None = None, residual: Residual | None = None) -> dict:
    """@description Walk one command from a reset for `seconds` on the tripod gait (the mirror rule when the body is
    inverted), optionally with a residual on the targets. Scores the heading-frame velocity against the command after
    the ramp-in, the distance covered, the energy the servos spent, and whether it fell.
    @param plant The plant. @param cmd {vx, vy, yawRate}. @param seconds Episode length. @param pose The reset pose.
    @param seed The reset seed. @param residual (state, cpg targets, t) -> targets, or None. @returns The measurements."""
    state = plant.reset(pose, seed)
    inverted = plant.inverted()
    start_xy = np.array(state["bodyPosM"][:2])
    c = clamp_command(cmd)
    samples: list[tuple[float, float, float]] = []
    t = 0.0
    fell = False
    while t < seconds:
        targets = np.array(cpg_targets(plant.geo, t, cmd, inverted))
        if residual is not None:
            targets = residual(state, targets, t)
        state = plant.step(targets, CONTROL_DT_S)
        t += CONTROL_DT_S
        if t >= TRACK_FROM_S:
            samples.append(plant.heading_velocity())
        if state["fell"]:
            fell = True
            break
    return _finish_walk(plant, c, samples, start_xy, t, fell)


def flip_recover_episode(plant: HexapodPlant, cmd: dict, before_s: float = 1.5, after_s: float = 6.0, seed: int | None = None, residual: Residual | None = None) -> dict:
    """@description Walk upright, get rolled over, and recover: the inversion detector reads the accelerometer only, the
    gait switches through the mirror rule when it says so, and recovery is the moment forward speed is back at
    RECOVER_FRACTION of the command for RECOVER_HOLD_S. @param plant The plant. @param cmd The command. @param before_s
    Seconds before the flip. @param after_s Seconds allowed after it. @param seed The reset seed. @param residual As
    walk_episode. @returns detectS and recoverS (None when it never happened), whether it fell, the speed at the end."""
    state = plant.reset("upright", seed)
    detector = InversionDetector(False)
    vx_cmd = clamp_command(cmd)[0]
    window = max(1, int(round(RECOVER_HOLD_S / CONTROL_DT_S)))
    t, flipped_at, detect_s, recover_s, fell = 0.0, None, None, None, False
    recent: list[float] = []
    while t < before_s + after_s:
        if flipped_at is None and t >= before_s:
            state = plant.flip()
            flipped_at = t
        was = detector.inverted
        detector.update(state["accelMps2"])
        if flipped_at is not None and detect_s is None and detector.inverted:
            detect_s = t - flipped_at
        if detector.inverted != was and state["spring"] and state["spring"]["latched"]:
            plant.wind()  # the wound rod props a flipped body on its sky-side end until the cam is re-cocked
        targets = np.array(cpg_targets(plant.geo, t, cmd, detector.inverted))
        if residual is not None:
            targets = residual(state, targets, t)
        state = plant.step(targets, CONTROL_DT_S)
        t += CONTROL_DT_S
        if flipped_at is not None and recover_s is None:
            recent = (recent + [plant.heading_velocity()[0]])[-window:]
            # The gait's speed ripples within a cycle, so recovery is judged on the mean over RECOVER_HOLD_S, not a sample.
            if len(recent) == window and float(np.mean(recent)) >= RECOVER_FRACTION * vx_cmd:
                recover_s = round(t - RECOVER_HOLD_S - flipped_at, 3)
        if state["fell"] and flipped_at is not None and t - flipped_at > 1.0:
            fell = True
            break
    return {"command": cmd, "flippedAtS": flipped_at, "detectS": None if detect_s is None else round(detect_s, 3), "recoverS": recover_s, "fell": fell,
            "invertedAtEnd": plant.inverted(), "vxEndMps": round(plant.heading_velocity()[0], 4), "energyJ": round(plant.energy_j, 4)}


def hop_episode(plant: HexapodPlant, jump: str, seed: int | None = None, after_s: float = 1.5, residual: Residual | None = None) -> dict:
    """@description One jump and its landing. `legs-hop`: the crouch-and-extend sequence on the servos. `latched-spring`:
    the plant's own jump (crouch, trip the latch), then the stance to land on. hopHeightM is the body centre's PEAK
    above the stand height (what an observer sees against the standing machine; negative when it never gets that
    high); ballisticRiseM is the rise after lift-off, the first control step with no spider geom on the floor.
    @param plant The plant. @param jump legs-hop | latched-spring. @param seed The reset seed. @param after_s Seconds
    after the push. @param residual As walk_episode. @returns The measurements."""
    state = plant.reset("upright", seed)
    inverted = plant.inverted()
    stance = np.array(stance_targets(plant.geo, inverted))
    stored = state["spring"]["storedJ"] if state["spring"] else None
    if jump == "latched-spring":
        state = plant.jump()
    z0 = float(state["bodyPosM"][2])
    t, liftoff_z, peak, airborne, lifted_at = 0.0, None, z0, 0.0, None
    total = after_s if jump == "latched-spring" else HOP_TOTAL_S + after_s
    while t < total:
        targets = stance if jump == "latched-spring" else np.array(legs_hop_targets(plant.geo, t, inverted))
        if residual is not None:
            targets = residual(state, targets, t)
        state = plant.step(targets, CONTROL_DT_S)
        t += CONTROL_DT_S
        z = float(state["bodyPosM"][2])
        if not plant.floor_contacts():
            airborne += CONTROL_DT_S
            if liftoff_z is None:
                liftoff_z, lifted_at = z, t
        peak = max(peak, z)
    return {"jump": jump, "hopHeightM": round(peak - plant.geo.stand_height_m, 4), "ballisticRiseM": round(0.0 if liftoff_z is None else peak - liftoff_z, 4),
            "liftoffAtS": lifted_at, "liftoffZM": None if liftoff_z is None else round(liftoff_z, 4),
            "bodyPeakM": round(peak, 4), "airborneS": round(airborne, 3), "landedUpright": bool(not state["fell"] and plant.inverted() == inverted),
            "springStoredJBeforeRelease": stored, "energyJ": round(plant.energy_j, 4), "peakTorqueNm": round(float(plant.peak_torque.max()), 3)}


def stance_episode(plant: HexapodPlant, seconds: float = 1.0, seed: int | None = None) -> dict:
    """@description Stand still from a reset and report where the body settles against the model's stand height.
    @param plant The plant. @param seconds How long. @param seed The reset seed. @returns Height, speed, torques, settled."""
    plant.reset("upright", seed)
    targets = np.array(stance_targets(plant.geo, False))
    heights = []
    t = 0.0
    while t < seconds:
        state = plant.step(targets, CONTROL_DT_S)
        t += CONTROL_DT_S
        if t >= seconds * 0.8:
            heights.append(state["bodyPosM"][2])
    speed = float(np.linalg.norm(state["bodyVelMps"]))
    height = float(np.mean(heights))
    return {"settledHeightM": round(height, 4), "standHeightM": plant.geo.stand_height_m, "errorM": round(height - plant.geo.stand_height_m, 4),
            "settled": bool(abs(height - plant.geo.stand_height_m) < STANCE_TOLERANCE_M and speed < 0.02), "speedMps": round(speed, 4),
            "meanTorqueNm": [round(float(v), 4) for v in np.abs([state["jointTorqueNm"]]).mean(axis=0)], "peakTorqueNm": round(float(plant.peak_torque.max()), 3)}


# -- the check the route runs ---------------------------------------------------------------------------------------
def _mean(rows: list[dict], key: str):
    vals = [r[key] for r in rows if r.get(key) is not None]
    return None if not vals else round(float(np.mean(vals)), 4)


def _check_model(entry: dict, seeds: int) -> dict:
    """@description Every measurement for one generated model over `seeds` seeded resets."""
    jump = str(entry.get("jump", "legs-hop"))
    plant = HexapodPlant(str(entry["mjcf"]), 0)
    seed_list = list(range(seeds))
    stance = [stance_episode(plant, 1.0, s) for s in seed_list]
    walks = []
    for cmd in WALK_COMMANDS:
        rows = [walk_episode(plant, cmd, 5.0, "upright", s) for s in seed_list]
        walks.append({"command": cmd, "measured": {k: _mean([r["measured"] for r in rows], k) for k in ("vxMps", "vyMps", "yawRateRadS")},
                      "trackingErrorMps": _mean(rows, "trackingErrorMps"), "costOfTransport": _mean(rows, "costOfTransport"), "falls": sum(r["fell"] for r in rows), "distanceM": _mean(rows, "distanceM")})
    inv_rows = [walk_episode(plant, WALK_COMMANDS[0], 5.0, "inverted", s) for s in seed_list]
    flip_rows = [flip_recover_episode(plant, WALK_COMMANDS[0], seed=s) for s in seed_list]
    hop_rows = [hop_episode(plant, jump, s) for s in seed_list]
    return {
        "jump": jump, "hasSpring": plant.spring_jnt is not None,
        "stance": {"settledHeightM": _mean(stance, "settledHeightM"), "standHeightM": plant.geo.stand_height_m, "settled": all(r["settled"] for r in stance), "peakTorqueNm": _mean(stance, "peakTorqueNm")},
        "walk": walks,
        "inverted": {"command": WALK_COMMANDS[0], "vxMps": _mean([r["measured"] for r in inv_rows], "vxMps"), "trackingErrorMps": _mean(inv_rows, "trackingErrorMps"), "falls": sum(r["fell"] for r in inv_rows),
                     "recover": {"detectS": _mean(flip_rows, "detectS"), "recoverS": _mean(flip_rows, "recoverS"), "recovered": sum(r["recoverS"] is not None for r in flip_rows), "falls": sum(r["fell"] for r in flip_rows)}},
        "hop": {"jump": jump, "hopHeightM": _mean(hop_rows, "hopHeightM"), "ballisticRiseM": _mean(hop_rows, "ballisticRiseM"), "bodyPeakM": _mean(hop_rows, "bodyPeakM"),
                "airborneS": _mean(hop_rows, "airborneS"), "landedUpright": sum(r["landedUpright"] for r in hop_rows), "springStoredJBeforeRelease": _mean(hop_rows, "springStoredJBeforeRelease")},
    }


def _verdict(r: dict, seeds: int) -> dict:
    forward = r["walk"][0]
    return {
        "standsAtStandHeight": bool(r["stance"]["settled"]),
        "walksForward": bool(forward["falls"] == 0 and (forward["measured"]["vxMps"] or 0) > 0.5 * forward["command"]["vx"]),
        "invertedWalksForward": bool(r["inverted"]["falls"] == 0 and (r["inverted"]["vxMps"] or 0) > 0.5 * r["inverted"]["command"]["vx"]),
        "recoversFromFlip": bool(r["inverted"]["recover"]["recovered"] == seeds),
        "leavesTheFloor": bool((r["hop"]["airborneS"] or 0) > 0),
    }


def check_report_file(jump: str) -> str:
    """@description The file a check writes for one model: `hexapod-check-<jump>-seed0.json`, the hexapod-* shape the Spider
    Design Studio lists; the check's resets start at seed 0. @param jump The option. @returns The file name."""
    return f"hexapod-check-{jump}-seed0.json"


def check_report(r: dict, seeds: int, wall_s: float) -> dict:
    """@description One model's check as a report file: the training report's facet keys under `baseline` (the gait is the
    baseline; there is no policy, so the studio shows "no verdict"), the verdict, and the whole measurement under `models`.
    @param r The model's check. @param seeds How many seeded resets. @param wall_s Wall seconds. @returns The report."""
    forward = r["walk"][0]
    return {"task": "hexapod-check", "jump": r["jump"], "seed": 0, "seeds": seeds, "mujoco": mujoco.__version__, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "baseline": {"trackingErrorMps": forward["trackingErrorMps"], "costOfTransport": forward["costOfTransport"], "falls": int(sum(w["falls"] for w in r["walk"]) + r["inverted"]["falls"]),
                         "recoverS": r["inverted"]["recover"]["recoverS"], "hopHeightM": r["hop"]["hopHeightM"], "landedUpright": bool(r["hop"]["landedUpright"] == seeds)},
            "verdict": r["verdict"], "wallSeconds": wall_s, "models": [r]}


def hexapod_check(models: list, seeds: int, out_dir: str | None = None) -> dict:
    """@description The check the route asks for: for each generated model (one per jump option), the stance, a walk per
    command, the inverted walk, the flip and recovery, and the hop, each over `seeds` seeded resets. Every number is
    measured in the simulation; the only brief figure carried is the stand height, read from the model itself. With
    `out_dir` each model's check is also written there as a hexapod-* report the studio's Train poster lists.
    @param models [{jump, mjcf}]. @param seeds 1-5. @param out_dir The report directory, or None to write nothing.
    @returns The report with a verdict per model and the files written."""
    if not models:
        refuse("bad_request", "models must list at least one {jump, mjcf}")
    seeds = max(1, min(5, int(seeds)))
    started = time.monotonic()
    out = [_check_model(entry, seeds) for entry in models]
    files = []
    for r in out:
        r["verdict"] = _verdict(r, seeds)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
            path = os.path.join(out_dir, check_report_file(r["jump"]))
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(check_report(r, seeds, round(time.monotonic() - started, 2)), fh, indent=2)
            files.append(os.path.basename(path))
    return {"task": "hexapod-check", "seeds": seeds, "models": out, "wallSeconds": round(time.monotonic() - started, 2), "reportFiles": files}


# -- the bridge's dispatch ------------------------------------------------------------------------------------------
_SESSIONS: dict[str, HexapodPlant] = {}
_LOCK = threading.Lock()
_CHECK_LOCK = threading.Lock()


def hexapod_op(op: str, req: dict, report_dir: str | None = None) -> dict:
    """@description Serve one `hexapod.*` request (brief 3.2): load, reset, step, jump, wind, state, drop, check, and the
    B30 gate `certify`. Sessions are keyed by an optional `session` (DEFAULT_SESSION otherwise) under this module's own
    lock; check and certify run under their own, so a long one never holds a live plant. @param op The command.
    @param req The request. @param report_dir Where a check writes its hexapod-* report and the gate reads policies, or
    None. @returns The result the bridge wraps. @raises HexapodRefused by name."""
    if op == "hexapod.check":
        with _CHECK_LOCK:
            return hexapod_check(list(req.get("models") or []), int(req.get("seeds", 1)), report_dir)
    if op == "hexapod.certify":
        from tasks.hexapod_certify import certify_policy  # noqa: PLC0415 -- torch only when a policy is replayed
        with _CHECK_LOCK:
            seeds = req.get("seeds")
            return certify_policy(req.get("file"), report_dir, req.get("continuousNm"), list(seeds) if isinstance(seeds, list) and seeds else None)
    with _LOCK:
        session = str(req.get("session", DEFAULT_SESSION))
        if op == "hexapod.load":
            if not isinstance(req.get("mjcf"), str) or not req["mjcf"].strip():
                refuse("bad_request", "hexapod.load needs the generated mjcf")
            plant = HexapodPlant(req["mjcf"], int(req.get("seed", 0)))
            plant.set_controller(req.get("controller"), report_dir)
            _SESSIONS[session] = plant
            return {**plant.info(), "session": session}
        if op == "hexapod.drop":
            return {"dropped": _SESSIONS.pop(session, None) is not None}
        plant = _SESSIONS.get(session)
        if plant is None:
            refuse("no_session", f"no hexapod session {session!r}: hexapod.load first")
        return _session_op(op, req, plant)


def _session_op(op: str, req: dict, plant: HexapodPlant) -> dict:
    """@description One op on a loaded session. @param op The command. @param req The request. @param plant The session's plant. @returns The result."""
    if op == "hexapod.reset":
        return plant.reset(str(req.get("pose", "upright")), req.get("seed"))
    if op == "hexapod.step":
        if "targetsRad" not in req and "command" in req:
            return plant.step_command(req.get("command"), float(req.get("dtS", CONTROL_DT_S)))
        return plant.step(req.get("targetsRad"), float(req.get("dtS", CONTROL_DT_S)))
    if op == "hexapod.jump":
        return plant.jump()
    if op == "hexapod.wind":
        return plant.wind()
    if op == "hexapod.state":
        return plant.state()
    refuse("unknown_command", f"unknown hexapod command {op!r}")
    return {}
