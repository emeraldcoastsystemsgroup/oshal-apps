"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the physics plant behind the embodied
    |                                           | package (ADR-152 D2/D3): MuJoCo loads the MJCF the TypeScript
    |                                           | engine generates from the parts model, a cascaded position/
    |                                           | attitude controller flies the drone toward the setpoint the
    |                                           | kinematic autopilot commands, a seeded gust model disturbs it,
    |                                           | and the sensors (ring, zenith cone, depth camera, nadir ranger)
    |                                           | are batched ray casts from the drone's TRUE pose with the same
    |                                           | ray geometry the kinematic raycaster uses. The TypeScript engine
    |                                           | stays the authority: it keeps the belief, the map, registration
    |                                           | and every guard; this module is the plant and its sensors.
2   | maintainer@emeraldcoastsystemsgroup.com   | A trained policy can fly the plant (PolicyController): loaded from the report directory through set_controller, it observes what the task showed it every 20 ms and commands motor fractions, absolute or as a bounded correction on the cascaded controller; snapshot/restore carry its state; the step result names the controller.
3   | maintainer@emeraldcoastsystemsgroup.com   | The ctbr interface (B19): Controller.rate_motors closes the plant's own rate loop on a collective thrust and body-rate command every physics step; PolicyController carries an `interface` (motors | ctbr), observes the reference look-ahead from the setpoint and its feed-forward velocity exactly as the task did, and holds a ctbr command for one control period; set_controller takes and returns `interface`.
4   | maintainer@emeraldcoastsystemsgroup.com   | Hit points carry the pose's precision (5 decimals, not 4): a sweep is
    |                                           | expressed relative to the reported pose, and a vertical ray from a body
    |                                           | resting off the voxel grid landed a hair beside the belief's column
    |                                           | (the climb was refused on a PX4 vehicle a centimetre off its pad).

"""
from __future__ import annotations

import math
import os
import re
import sys
from dataclasses import dataclass, field

import mujoco
import numpy as np

PROTOCOL = 1

# Controller gains for a 0.5-1.3 kg quad (position loop ~0.3 Hz, attitude loop ~3 Hz).
KP_POS = 4.0
KV_VEL = 6.0
V_MAX = 1.5
K_ROT = 1.0
K_YAW = 0.25
K_OMEGA_RATIO = 1.6  # K_omega = ratio * sqrt(K * I)
MAX_TILT_RAD = 0.6
# A quad yaws slowly: the reaction torque is small, so the yaw setpoint is slewed and yaw never robs roll, pitch or thrust of motor range.
YAW_RATE_MAX = 2.5
YAW_AUTHORITY_FRACTION = 0.5
# Gust: an Ornstein-Uhlenbeck force in the horizontal plane, seeded per session.
GUST_TAU_S = 1.0
GUST_SIGMA_N = 0.15

_SUFFIX = re.compile(r"\.\d+$")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # tasks.hover_leg, for the policy's observation


def face_normal(rel: np.ndarray, half: np.ndarray) -> np.ndarray:
    """@description Outward unit normal of the box face nearest a point (the kinematic raycaster's rule).
    @param rel Hit point relative to the box centre. @param half Half sizes. @returns A unit axis vector."""
    best = math.inf
    axis = 0
    sign = -1.0
    for a in range(3):
        d0 = abs(rel[a] + half[a])
        d1 = abs(rel[a] - half[a])
        if d0 < best:
            best, axis, sign = d0, a, -1.0
        if d1 < best:
            best, axis, sign = d1, a, 1.0
    n = np.zeros(3)
    n[axis] = sign
    return n


def quat_to_mat(q: np.ndarray) -> np.ndarray:
    """@description Rotation matrix of a MuJoCo (w, x, y, z) quaternion. @param q The quaternion. @returns 3x3."""
    m = np.zeros(9)
    mujoco.mju_quat2Mat(m, q)
    return m.reshape(3, 3)


def rot_y(theta: float) -> np.ndarray:
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])


def vee(m: np.ndarray) -> np.ndarray:
    return np.array([m[2, 1], m[0, 2], m[1, 0]])


@dataclass
class Controller:
    """@description Cascaded position -> attitude -> motor mixing, with the mixing matrix inverted once."""
    mass: float
    inertia: np.ndarray
    rotors: np.ndarray  # n x 2 body positions
    spins: np.ndarray  # +1 / -1
    yaw_k: float
    f_max: float
    gravity: float
    k_omega: np.ndarray = field(init=False)
    mix_inv: np.ndarray = field(init=False)

    def __post_init__(self) -> None:
        gains = np.array([K_ROT, K_ROT, K_YAW])
        self.k_omega = K_OMEGA_RATIO * np.sqrt(gains * self.inertia)
        rows = [np.ones(len(self.rotors)), self.rotors[:, 1], -self.rotors[:, 0], self.spins * self.yaw_k]
        self.mix_inv = np.linalg.pinv(np.array(rows))
        self.max_yaw_torque = YAW_AUTHORITY_FRACTION * len(self.rotors) * self.f_max * self.yaw_k if self.yaw_k > 0 else 0.0

    def motors(self, pos: np.ndarray, vel: np.ndarray, rot: np.ndarray, omega_body: np.ndarray, setpoint: np.ndarray, yaw: float, v_ff: np.ndarray) -> np.ndarray:
        """@description Motor thrusts (N) that drive the body toward the setpoint at the commanded yaw; `v_ff` is the setpoint's own velocity, fed forward as a real autopilot does so a moving setpoint is tracked with a small lag rather than a proportional one."""
        err = setpoint - pos
        v_des = np.clip(KP_POS * err + v_ff, -V_MAX, V_MAX)
        a_des = KV_VEL * (v_des - vel) + np.array([0.0, 0.0, self.gravity])
        f_des = self.mass * a_des
        thrust = float(np.linalg.norm(f_des))
        if thrust < 1e-6:
            return np.zeros(len(self.rotors))
        z_des = f_des / thrust
        # Limit the tilt so a large position error never flips the body.
        tilt = math.acos(max(-1.0, min(1.0, z_des[2])))
        if tilt > MAX_TILT_RAD:
            horiz = z_des[:2] / max(1e-9, np.linalg.norm(z_des[:2]))
            z_des = np.array([horiz[0] * math.sin(MAX_TILT_RAD), horiz[1] * math.sin(MAX_TILT_RAD), math.cos(MAX_TILT_RAD)])
        x_c = np.array([math.cos(yaw), math.sin(yaw), 0.0])
        y_des = np.cross(z_des, x_c)
        y_des /= max(1e-9, np.linalg.norm(y_des))
        x_des = np.cross(y_des, z_des)
        r_des = np.column_stack([x_des, y_des, z_des])
        e_rot = 0.5 * vee(r_des.T @ rot - rot.T @ r_des)
        gains = np.array([K_ROT, K_ROT, K_YAW])
        torque = -gains * e_rot - self.k_omega * omega_body + np.cross(omega_body, self.inertia * omega_body)
        torque[2] = float(np.clip(torque[2], -self.max_yaw_torque, self.max_yaw_torque))
        collective = thrust * max(0.0, float(rot[:, 2] @ z_des))
        return self.mix(collective, torque)

    def rate_motors(self, collective: float, omega_cmd: np.ndarray, omega_body: np.ndarray) -> np.ndarray:
        """@description Motor thrusts (N) for a collective thrust and body-rate setpoints: the same rate loop the cascade closes (damping gain on the rate error, gyroscopic feed-forward, yaw torque capped), then the mixer."""
        torque = self.k_omega * (omega_cmd - omega_body) + np.cross(omega_body, self.inertia * omega_body)
        torque[2] = float(np.clip(torque[2], -self.max_yaw_torque, self.max_yaw_torque))
        return self.mix(float(np.clip(collective, 0.0, len(self.rotors) * self.f_max)), torque)

    def mix(self, collective: float, torque: np.ndarray) -> np.ndarray:
        """@description Motor thrusts for a collective and a torque, yaw last: when yaw would push a motor past its range the yaw share is scaled down so roll, pitch and thrust keep theirs."""
        base = self.mix_inv @ np.array([collective, torque[0], torque[1], 0.0])
        yaw = self.mix_inv @ np.array([0.0, 0.0, 0.0, torque[2]])
        scale = 1.0
        for i in range(len(base)):
            if yaw[i] > 1e-9:
                scale = min(scale, max(0.0, (self.f_max - base[i]) / yaw[i]))
            elif yaw[i] < -1e-9:
                scale = min(scale, max(0.0, base[i] / -yaw[i]))
        return np.clip(base + scale * yaw, 0.0, self.f_max)


class PolicyController:
    """@description A trained policy flying the plant: every control period it observes exactly what the task showed it and commands
    motor fractions, absolute or as a bounded correction on the plant's own controller. Inference stays in this container (ADR-152 Q3)."""

    def __init__(self, file: str, residual: bool, substeps: int, interface: str = "motors") -> None:
        from stable_baselines3 import PPO  # imported only when a policy flies: the plain plant needs no torch
        self.model = PPO.load(file, device="cpu")
        self.file = os.path.basename(file)
        self.residual = residual and interface == "motors"
        self.interface = interface
        self.substeps = max(1, substeps)
        self.prev_action = np.zeros(4)
        self.held = np.zeros(4)
        self.held_cmd: tuple[float, np.ndarray] | None = None
        self.count = 0

    def fractions(self, pid_fraction: np.ndarray, pos: np.ndarray, vel: np.ndarray, rot: np.ndarray, omega: np.ndarray, target: np.ndarray) -> np.ndarray:
        from tasks.hover_leg import motor_fractions, observation
        if self.count % self.substeps == 0:
            action, _ = self.model.predict(observation(pos, vel, rot, omega, target, self.prev_action), deterministic=True)
            self.prev_action = np.clip(np.asarray(action, dtype=float), -1.0, 1.0)
            self.held = motor_fractions(pid_fraction, self.prev_action, self.residual)
        self.count += 1
        return self.held

    def forces(self, pid: np.ndarray, pos: np.ndarray, vel: np.ndarray, rot: np.ndarray, omega: np.ndarray, target: np.ndarray, v_ff: np.ndarray, controller: Controller) -> np.ndarray:
        """@description Motor forces (N) this physics step: on ctbr the policy is asked once per control period for a collective and body rates and the rate loop is closed every step; on motors/residual the held fractions of the period."""
        if self.interface != "ctbr":
            return self.fractions(pid / controller.f_max, pos, vel, rot, omega, target) * controller.f_max
        from tasks.hover_leg import ctbr_command, observation_ctbr
        if self.count % self.substeps == 0 or self.held_cmd is None:
            action, _ = self.model.predict(observation_ctbr(pos, vel, rot, omega, target, v_ff, self.prev_action), deterministic=True)
            self.prev_action = np.clip(np.asarray(action, dtype=float), -1.0, 1.0)
            self.held_cmd = ctbr_command(self.prev_action, controller)
        self.count += 1
        return controller.rate_motors(self.held_cmd[0], self.held_cmd[1], omega)

    def state(self) -> dict:
        return {"prev_action": self.prev_action.copy(), "held": self.held.copy(), "count": self.count, "held_cmd": None if self.held_cmd is None else (self.held_cmd[0], self.held_cmd[1].copy())}

    def restore(self, s: dict) -> None:
        self.prev_action = s["prev_action"].copy()
        self.held = s["held"].copy()
        self.count = s["count"]
        hc = s.get("held_cmd")
        self.held_cmd = None if hc is None else (hc[0], hc[1].copy())


class Plant:
    """@description One MuJoCo world with one drone: the physics, its controller, its gust and its sensors."""

    def __init__(self, mjcf: str, seed: int = 0) -> None:
        self.model = mujoco.MjModel.from_xml_string(mjcf)
        self.data = mujoco.MjData(self.model)
        self.body = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, "drone")
        if self.body < 0:
            raise ValueError("the MJCF has no body named drone")
        self.sites = {name: mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_SITE, name) for name in ("ring", "zenith", "nadir", "depth-camera")}
        rotors = []
        spins = []
        for a in range(self.model.nu):
            site = self.model.actuator_trnid[a][0]
            rotors.append(self.model.site_pos[site][:2].copy())
            spins.append(1.0 if self.model.actuator_gear[a][5] >= 0 else -1.0)
        gear = float(abs(self.model.actuator_gear[0][5])) if self.model.nu else 0.0
        self.f_max = float(self.model.actuator_ctrlrange[0][1]) if self.model.nu else 0.0
        self.controller = Controller(mass=float(self.model.body_subtreemass[self.body]), inertia=self.model.body_inertia[self.body].copy(),
                                     rotors=np.array(rotors), spins=np.array(spins), yaw_k=gear, f_max=self.f_max, gravity=float(-self.model.opt.gravity[2]))
        self.rng = np.random.default_rng(seed)
        self.gust = np.zeros(2)
        self.prev_target: np.ndarray | None = None
        self.yaw_cmd = 0.0
        self.policy: PolicyController | None = None
        self.steps = 0
        self.last_contact: str | None = None
        self.geom_names = [self._name(g) for g in range(self.model.ngeom)]
        hull = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_GEOM, "drone-hull")
        # Where the body origin sits when the hull rests on the floor: the kinematic sim's pad plate.
        self.rest_z = float(self.model.geom_size[hull][2] - self.model.geom_pos[hull][2]) if hull >= 0 else 0.0
        mujoco.mj_forward(self.model, self.data)

    def set_controller(self, spec: dict | None, report_dir: str) -> dict:
        """@description Choose what flies the plant: the cascaded controller (default) or a trained policy from the report directory.
        @param spec None or {kind: 'pid'} or {kind: 'policy', file, residual}. @param report_dir Where policies live; the file name is taken bare (no paths).
        @returns What was set."""
        kind = (spec or {}).get("kind", "pid")
        if kind == "pid":
            self.policy = None
            return {"kind": "pid"}
        if kind != "policy":
            raise ValueError(f"unknown controller kind {kind!r}")
        file = os.path.basename(str(spec.get("file", "")))
        path = os.path.join(report_dir, file)
        if not file or not os.path.exists(path):
            raise FileNotFoundError(f"no policy file {file!r} in the report directory")
        substeps = max(1, int(round(0.02 / self.model.opt.timestep)))
        interface = str(spec.get("interface", "motors"))
        if interface not in ("motors", "ctbr"):
            raise ValueError(f"unknown policy interface {interface!r}")
        self.policy = PolicyController(path, bool(spec.get("residual", True)), substeps, interface)
        return {"kind": "policy", "file": file, "residual": self.policy.residual, "interface": interface}

    def _name(self, geom: int) -> str:
        raw = mujoco.mj_id2name(self.model, mujoco.mjtObj.mjOBJ_GEOM, geom) or f"geom-{geom}"
        return _SUFFIX.sub("", raw)

    # -- state ---------------------------------------------------------------
    def pose(self) -> dict:
        q = self.data.qpos[3:7]
        rot = quat_to_mat(q)
        yaw = math.atan2(rot[1, 0], rot[0, 0])
        p = self.data.qpos[0:3]
        v = self.data.qvel[0:3]
        return {"x": round(float(p[0]), 5), "y": round(float(p[1]), 5), "z": round(float(p[2]), 5), "yaw": round(float(yaw), 6),
                "tiltRad": round(float(math.acos(max(-1.0, min(1.0, rot[2, 2])))), 5), "speed": round(float(np.linalg.norm(v)), 4)}

    def snapshot(self) -> dict:
        return {"qpos": self.data.qpos.copy(), "qvel": self.data.qvel.copy(), "ctrl": self.data.ctrl.copy(), "act": self.data.act.copy(),
                "time": self.data.time, "gust": self.gust.copy(), "rng": self.rng.bit_generator.state, "steps": self.steps, "contact": self.last_contact,
                "prev_target": None if self.prev_target is None else self.prev_target.copy(), "yaw_cmd": self.yaw_cmd,
                "policy": self.policy.state() if self.policy else None}

    def restore(self, s: dict) -> None:
        self.data.qpos[:] = s["qpos"]
        self.data.qvel[:] = s["qvel"]
        self.data.ctrl[:] = s["ctrl"]
        self.data.act[:] = s["act"]
        self.data.time = s["time"]
        self.gust = s["gust"].copy()
        self.rng.bit_generator.state = s["rng"]
        self.steps = s["steps"]
        self.last_contact = s["contact"]
        self.prev_target = None if s["prev_target"] is None else s["prev_target"].copy()
        self.yaw_cmd = s["yaw_cmd"]
        if self.policy and s.get("policy"):
            self.policy.restore(s["policy"])
        mujoco.mj_forward(self.model, self.data)

    # -- flight --------------------------------------------------------------
    def step(self, setpoint: dict, phase: str, dt: float) -> dict:
        """@description Fly toward the setpoint for dt seconds; report the true pose, whether the controller has settled on the
        setpoint, and any contact with the scene. `phase` is the kinematic sim's mode: motors are off when `landed`; the floor is
        not a strike while landed, taking off or landing (the hull rests on it); a landing has settled once the hull is down."""
        n = max(1, int(round(dt / self.model.opt.timestep)))
        target = np.array([setpoint["x"], setpoint["y"], setpoint["z"]], dtype=float)
        yaw = float(setpoint.get("yaw", 0.0))
        landed = phase == "landed"
        floor_ok = phase in ("landed", "takeoff", "landing")
        v_ff = np.zeros(3) if self.prev_target is None or landed else np.clip((target - self.prev_target) / dt, -V_MAX, V_MAX)
        self.prev_target = target.copy()
        contact = None
        h = self.model.opt.timestep
        for _ in range(n):
            self._gust_step(h)
            self.data.xfrc_applied[self.body][:2] = self.gust if not landed else 0.0
            if landed:
                self.data.ctrl[:] = 0.0
                self.yaw_cmd = self.pose()["yaw"]
            else:
                d_yaw = math.atan2(math.sin(yaw - self.yaw_cmd), math.cos(yaw - self.yaw_cmd))
                self.yaw_cmd += max(-YAW_RATE_MAX * h, min(YAW_RATE_MAX * h, d_yaw))
                rot = quat_to_mat(self.data.qpos[3:7])
                pos, vel, omega = self.data.qpos[0:3].copy(), self.data.qvel[0:3].copy(), self.data.qvel[3:6].copy()
                pid = self.controller.motors(pos, vel, rot, omega, target, self.yaw_cmd, v_ff)
                self.data.ctrl[:] = pid if self.policy is None else self.policy.forces(pid, pos, vel, rot, omega, target, v_ff, self.controller)
            mujoco.mj_step(self.model, self.data)
            self.steps += 1
            hit = self._scene_contact()
            if hit and not (floor_ok and hit == "floor"):
                contact = hit
        self.last_contact = contact
        pose = self.pose()
        p = self.data.qpos[0:3]
        err_xy = math.hypot(p[0] - target[0], p[1] - target[1])
        yaw_ok = abs(math.atan2(math.sin(yaw - pose["yaw"]), math.cos(yaw - pose["yaw"]))) < 0.1
        if phase == "landing":
            settled = err_xy < 0.05 and p[2] <= target[2] + self.rest_z + 0.02 and pose["speed"] < 0.2
        else:
            settled = landed or (err_xy < 0.05 and abs(p[2] - target[2]) < 0.05 and pose["speed"] < 0.15 and yaw_ok)
        return {**pose, "contact": contact, "settled": bool(settled), "motorsN": [round(float(c), 4) for c in self.data.ctrl], "time": round(float(self.data.time), 4),
                "controller": "pid" if self.policy is None else f"policy:{self.policy.file}"}

    def _gust_step(self, dt: float) -> None:
        noise = self.rng.standard_normal(2)
        self.gust += (-self.gust / GUST_TAU_S) * dt + GUST_SIGMA_N * math.sqrt(dt) * noise

    def _scene_contact(self) -> str | None:
        for i in range(self.data.ncon):
            c = self.data.contact[i]
            b1 = self.model.geom_bodyid[c.geom1]
            b2 = self.model.geom_bodyid[c.geom2]
            if b1 == self.body and b2 != self.body:
                return self.geom_names[c.geom2]
            if b2 == self.body and b1 != self.body:
                return self.geom_names[c.geom1]
        return None

    # -- sensing -------------------------------------------------------------
    def _cast(self, origin: np.ndarray, dirs: np.ndarray, max_range: float) -> dict:
        nray = len(dirs)
        geomid = np.zeros(nray, dtype=np.int32)
        dist = np.zeros(nray, dtype=np.float64)
        mujoco.mj_multiRay(self.model, self.data, origin.astype(np.float64), dirs.reshape(-1).astype(np.float64), None, 1, self.body, geomid, dist, nray, max_range)
        p: list[float] = []
        n: list[float] = []
        t: list[float] = []
        ids: list[int] = []
        misses: list[float] = []
        for i in range(nray):
            g = int(geomid[i])
            d = float(dist[i])
            if g < 0 or d < 0 or d > max_range:
                misses.extend((origin + dirs[i] * max_range).tolist())
                continue
            hit = origin + dirs[i] * d
            normal = face_normal(hit - self.data.geom_xpos[g], self.model.geom_size[g])
            p.extend(round(c, 5) for c in hit.tolist())  # the same precision as the pose: a ray from the body maps onto it exactly
            n.extend(int(c) for c in normal.tolist())
            t.append(round(d, 4))
            ids.append(g)
        return {"origin": [round(c, 5) for c in origin.tolist()], "p": p, "n": n, "t": t, "geom": ids, "misses": [round(c, 3) for c in misses]}

    def _site_world(self, name: str) -> np.ndarray:
        return self.data.site_xpos[self.sites[name]].copy()

    def sense(self, spec: dict) -> dict:
        """@description Every sensor frame at the true pose. `spec` carries the ring, zenith, depth-camera and nadir geometry the kinematic sim uses."""
        rot = quat_to_mat(self.data.qpos[3:7])
        out: dict = {"names": self.geom_names, "truth": self.pose()}
        ring = spec.get("ring")
        if ring:
            dirs = []
            for el_deg in ring["elevationsDeg"]:
                el = math.radians(el_deg)
                for a in range(ring["azimuthCount"]):
                    az = 2 * math.pi * a / ring["azimuthCount"]
                    dirs.append([math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)])
            out["ring"] = self._cast(self._site_world("ring"), np.array(dirs) @ rot.T, float(ring["maxRange"]))
        zen = spec.get("zenith")
        if zen:
            el = math.radians(90 - zen["coneDeg"])
            dirs = [[0.0, 0.0, 1.0]] + [[math.cos(el) * math.cos(2 * math.pi * a / zen["rays"]), math.cos(el) * math.sin(2 * math.pi * a / zen["rays"]), math.sin(el)] for a in range(zen["rays"])]
            out["zenith"] = self._cast(self._site_world("zenith"), np.array(dirs) @ rot.T, float(zen["maxRange"]))
        depth = spec.get("depth")
        if depth:
            out["depth"] = self._cast(self._site_world("depth-camera"), self._depth_dirs(depth, rot), float(depth["maxRange"]))
        nadir = spec.get("nadir")
        if nadir:
            out["nadir"] = self._cast(self._site_world("nadir"), np.array([[0.0, 0.0, -1.0]]), float(nadir["maxRange"]))
        return out

    @staticmethod
    def _depth_dirs(d: dict, rot: np.ndarray) -> np.ndarray:
        """@description The depth camera's ray directions exactly as renderDepthPicture forms them: pixel centres through the pinhole, camera z forward, mounted looking down by `pitch`, then the body's true rotation."""
        stride = int(d["stride"])
        width = int(d["width"]) // stride
        height = int(d["height"]) // stride
        u = (np.arange(width) + 0.5) * stride
        v = (np.arange(height) + 0.5) * stride
        uu, vv = np.meshgrid(u, v)
        cam = np.stack([(uu - d["cx"]) / d["fx"], (vv - d["cy"]) / d["fy"], np.ones_like(uu)], axis=-1).reshape(-1, 3)
        body = np.stack([cam[:, 2], -cam[:, 0], -cam[:, 1]], axis=-1)
        world = body @ (rot @ rot_y(-float(d["pitch"]))).T
        return world / np.linalg.norm(world, axis=1, keepdims=True)


def hello(build_hash: str) -> dict:
    return {"protocol": PROTOCOL, "engine": "mujoco", "version": mujoco.__version__, "buildHash": build_hash}
