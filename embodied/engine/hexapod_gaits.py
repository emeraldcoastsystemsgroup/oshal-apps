"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 lane L2 -- the spider-18's deterministic baselines, MuJoCo-free
    |                                           | and NumPy only: the canonical actuator order and the inverted-walking
    |                                           | mirror rule ported 1:1 from hexapod-spec.ts (coxa kept, femur and
    |                                           | tibia negated, leg roles swapped left for right); the leg geometry the
    |                                           | plant READS from the loaded model (link lengths, mounts, limits --
    |                                           | never typed here); planar inverse kinematics per leg in the contract's
    |                                           | sign convention; the central-pattern-generator tripod gait that turns
    |                                           | a heading-frame command (vx, vy, yaw rate) into eighteen targets, the
    |                                           | inverted case being the same plan through the mirror rule; the
    |                                           | legs-hop sequence (crouch, then every femur and tibia extends together
    |                                           | at full speed); and the debounced inversion detector that decides
    |                                           | "inverted" from the accelerometer alone, as the node will have to.
2   | maintainer@emeraldcoastsystemsgroup.com   | B30: GaitShape - a stride scale per leg, a swing scale and a step-rate scale a policy may shape the CPG with; neutral is the gait byte for byte.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

LEG_IDS = ("L1", "L2", "L3", "R1", "R2", "R3")
LEG_JOINTS = ("coxa", "femur", "tibia")
#: The canonical 18-actuator order (hexapod-spec.ts ACTUATOR_ORDER): index = leg index * 3 + joint index.
ACTUATOR_ORDER = tuple(f"{leg}-{joint}" for leg in LEG_IDS for joint in LEG_JOINTS)
#: The tripod that leads: these three swing together, the other three half a cycle later.
TRIPOD_A = frozenset(("L1", "R2", "L3"))

# The gait's own choices (not the contract's): where the stance foot sits out from the femur axis -- the brief's
# worst-moment arm (0.14 m x 6.1 N) -- how high a swing lifts, the longest stride, and the step-rate band.
STANCE_RADIAL_M = 0.14
SWING_HEIGHT_M = 0.03
STRIDE_MAX_M = 0.06
STEP_HZ_MIN = 0.8
STEP_HZ_MAX = 2.5
V_MAX_MPS = 0.3
YAW_RATE_MAX_RADS = 1.0
#: A command slower than this is "stand still": the legs hold the stance instead of marching in place.
STILL_MPS = 0.01
# The legs-hop sequence: crouch the body low, hold, then push every leg to full extension, then the stance again.
HOP_CROUCH_S = 0.4
HOP_HOLD_S = 0.1
HOP_PUSH_S = 0.25
HOP_CROUCH_FOOT_Z_M = -0.03
#: A proper acceleration smaller than this (m/s^2) says nothing about which way is down (free fall, a hard landing).
INVERSION_ACCEL_MPS2 = 3.0
#: Consecutive agreeing samples before the detector changes its mind.
INVERSION_HOLD_SAMPLES = 5


def mirror_leg_role(leg: str) -> str:
    """@description The leg that plays this leg's role once the body is inverted: left and right swap, front stays front (hexapod-spec.ts mirrorLegRole).
    @param leg A leg id. @returns Its mirror."""
    return ("R" if leg[0] == "L" else "L") + leg[1:]


def actuator_index(leg: str, joint: str) -> int:
    """@description The index of a joint in the canonical order. @param leg The leg. @param joint The joint. @returns 0-17."""
    return LEG_IDS.index(leg) * 3 + LEG_JOINTS.index(joint)


def inverted_joint_targets(targets) -> list[float]:
    """@description The inverted-walking rule, ported 1:1 from hexapod-spec.ts invertedJointTargets: when the body is
    upside down the ground is at body +z, so every femur and tibia target is negated; a coxa target is NOT, because
    forward is still forward; and the leg roles mirror (the gait that drove L1 drives R1).
    @param targets Eighteen targets in ACTUATOR_ORDER, planned for the upright body.
    @returns The same intent for the inverted body. @raises ValueError on any other length."""
    if len(targets) != len(ACTUATOR_ORDER):
        raise ValueError(f"expected {len(ACTUATOR_ORDER)} targets, got {len(targets)}")
    out = [0.0] * len(ACTUATOR_ORDER)
    for li, leg in enumerate(LEG_IDS):
        src = LEG_IDS.index(mirror_leg_role(leg)) * 3
        out[li * 3] = float(targets[src])
        out[li * 3 + 1] = -float(targets[src + 1])
        out[li * 3 + 2] = -float(targets[src + 2])
    return out


@dataclass(frozen=True)
class LegGeometry:
    """@description What the gait needs to know about the machine, read from the loaded model by the plant (never typed
    from the brief): the coxa mounts (x, y, neutral yaw) and each coxa hinge's z sign, the link lengths, the foot, the
    stand height, the body's half height and the joint limits by actuator name."""

    mounts: dict
    coxa_axis_z: dict
    coxa_m: float
    femur_m: float
    foot_centre_m: float
    foot_radius_m: float
    stand_height_m: float
    body_half_height_m: float
    limits: dict

    def clamp(self, name: str, value: float) -> float:
        """@description A target inside its joint's software range. @param name The actuator. @param value Radians. @returns Clamped."""
        lo, hi = self.limits[name]
        return min(hi, max(lo, float(value)))


def leg_ik(geo: LegGeometry, r: float, z: float) -> tuple[float, float]:
    """@description Planar two-link inverse kinematics from the femur axis to the foot sphere's centre, knee bent toward
    body -z, in the contract's signs: femur positive drops the foot toward -z, tibia positive bends it further.
    @param geo The geometry. @param r Horizontal distance out along the leg from the femur axis (m). @param z Height of
    the foot centre relative to the femur axis, body +z up (m). @returns (femur, tibia) radians; an unreachable point
    is stretched to the reach."""
    lf, lt = geo.femur_m, geo.foot_centre_m
    d = (r * r + z * z - lf * lf - lt * lt) / (2 * lf * lt)
    tibia = math.acos(max(-1.0, min(1.0, d)))
    femur = math.atan2(-z, r) - math.atan2(lt * math.sin(tibia), lf + lt * math.cos(tibia))
    return femur, tibia


def leg_fk(geo: LegGeometry, femur: float, tibia: float) -> tuple[float, float]:
    """@description The forward map of leg_ik: (r, z) of the foot centre from the femur axis. @param geo The geometry.
    @param femur Radians. @param tibia Radians. @returns (r, z) in metres."""
    r = geo.femur_m * math.cos(femur) + geo.foot_centre_m * math.cos(femur + tibia)
    z = -(geo.femur_m * math.sin(femur) + geo.foot_centre_m * math.sin(femur + tibia))
    return r, z


def foot_to_joints(geo: LegGeometry, leg: str, foot: np.ndarray) -> tuple[float, float, float]:
    """@description Joint targets that put a leg's foot centre at a point in the UPRIGHT body frame.
    @param geo The geometry. @param leg The leg. @param foot (x, y, z) in the body frame (m).
    @returns (coxa, femur, tibia) radians, each inside its limit."""
    mx, my, yaw = geo.mounts[leg]
    dx, dy = float(foot[0]) - mx, float(foot[1]) - my
    xl = math.cos(yaw) * dx + math.sin(yaw) * dy
    yl = -math.sin(yaw) * dx + math.cos(yaw) * dy
    # A -z hinge turns the leg by -q, so the geometric angle is the joint angle times the axis sign.
    coxa = geo.coxa_axis_z[leg] * math.atan2(yl, xl)
    femur, tibia = leg_ik(geo, math.hypot(xl, yl) - geo.coxa_m, float(foot[2]))
    return (geo.clamp(f"{leg}-coxa", coxa), geo.clamp(f"{leg}-femur", femur), geo.clamp(f"{leg}-tibia", tibia))


def stance_foot(geo: LegGeometry, leg: str) -> np.ndarray:
    """@description Where a leg's foot centre rests in the stance: out along the neutral yaw, STANCE_RADIAL_M beyond the
    femur axis, the foot radius above the floor with the body at its stand height. @param geo The geometry.
    @param leg The leg. @returns (x, y, z) in the upright body frame."""
    mx, my, yaw = geo.mounts[leg]
    rho = geo.coxa_m + STANCE_RADIAL_M
    return np.array([mx + rho * math.cos(yaw), my + rho * math.sin(yaw), -(geo.stand_height_m - geo.foot_radius_m)])


def feet_to_targets(geo: LegGeometry, feet: dict, inverted: bool = False) -> list[float]:
    """@description Eighteen targets from six foot points planned in the upright frame; inverted, the SAME plan through
    the mirror rule. @param geo The geometry. @param feet Leg id to (x, y, z). @param inverted Apply the rule.
    @returns Targets in ACTUATOR_ORDER."""
    out: list[float] = []
    for leg in LEG_IDS:
        out.extend(foot_to_joints(geo, leg, feet[leg]))
    return inverted_joint_targets(out) if inverted else out


def stance_targets(geo: LegGeometry, inverted: bool = False) -> list[float]:
    """@description The resting stance as targets. @param geo The geometry. @param inverted Through the mirror rule. @returns Eighteen targets."""
    return feet_to_targets(geo, {leg: stance_foot(geo, leg) for leg in LEG_IDS}, inverted)


def clamp_command(cmd: dict) -> tuple[float, float, float]:
    """@description A command inside the gait's envelope. @param cmd {vx, vy, yawRate} (m/s, m/s, rad/s), missing keys zero.
    @returns (vx, vy, yaw rate)."""
    vx = max(-V_MAX_MPS, min(V_MAX_MPS, float(cmd.get("vx", 0.0))))
    vy = max(-V_MAX_MPS, min(V_MAX_MPS, float(cmd.get("vy", 0.0))))
    w = max(-YAW_RATE_MAX_RADS, min(YAW_RATE_MAX_RADS, float(cmd.get("yawRate", 0.0))))
    return vx, vy, w


def leg_ground_velocity(geo: LegGeometry, leg: str, cmd: tuple[float, float, float]) -> np.ndarray:
    """@description The velocity of the ground relative to the body at a leg's stance foot: -(v + omega x p).
    @param geo The geometry. @param leg The leg. @param cmd (vx, vy, yaw rate). @returns (vx, vy, 0) in the body frame."""
    p = stance_foot(geo, leg)
    vx, vy, w = cmd
    return -np.array([vx - w * p[1], vy + w * p[0], 0.0])


def step_frequency(geo: LegGeometry, cmd: tuple[float, float, float]) -> float:
    """@description The step rate for a command: fast enough that no leg's stride exceeds STRIDE_MAX_M, inside the band.
    @param geo The geometry. @param cmd The command. @returns Hz, or 0 when the command is "stand still"."""
    fastest = max(float(np.linalg.norm(leg_ground_velocity(geo, leg, cmd))) for leg in LEG_IDS)
    if fastest < STILL_MPS:
        return 0.0
    return max(STEP_HZ_MIN, min(STEP_HZ_MAX, fastest / (2 * STRIDE_MAX_M)))


class GaitShape:
    """@description What a policy may shape on the CPG (ADR-202 B30, the drone's B19 lesson applied): a stride scale per
    leg, one swing-height scale and one step-rate scale. `neutral()` is the gait exactly; `from_action` maps an action in
    [-1, 1]^8 onto the bands below, so a zero action is the baseline."""

    STRIDE_BAND = (0.5, 1.5)
    SWING_BAND = (0.5, 1.5)
    HZ_BAND = (0.7, 1.3)
    SIZE = 8

    def __init__(self, stride_scale, swing_scale: float = 1.0, hz_scale: float = 1.0) -> None:
        self.stride_scale = [float(x) for x in stride_scale]
        self.swing_scale = float(swing_scale)
        self.hz_scale = float(hz_scale)

    @classmethod
    def neutral(cls) -> "GaitShape":
        """@description The gait as the plant runs it. @returns Scales of one."""
        return cls([1.0] * len(LEG_IDS), 1.0, 1.0)

    @classmethod
    def from_action(cls, action) -> "GaitShape":
        """@description An action in [-1, 1]^8 onto the bands: six stride scales (LEG_IDS order), the swing scale, the
        step-rate scale. @param action Eight numbers; clipped. @returns The shape."""
        a = [max(-1.0, min(1.0, float(x))) for x in action]
        if len(a) != cls.SIZE:
            raise ValueError(f"a gait shape action has {cls.SIZE} numbers, got {len(a)}")
        def band(x: float, lo_hi) -> float:
            lo, hi = lo_hi
            return lo + (x + 1.0) * 0.5 * (hi - lo)
        return cls([band(x, cls.STRIDE_BAND) for x in a[:6]], band(a[6], cls.SWING_BAND), band(a[7], cls.HZ_BAND))


def cpg_targets(geo: LegGeometry, t: float, cmd: dict, inverted: bool = False, shape: "GaitShape | None" = None) -> list[float]:
    """@description The tripod gait at time t for a heading-frame command: tripod A (L1, R2, L3) in stance for the first
    half of each cycle while B swings, then the reverse. A stance foot is carried backward at the ground's velocity
    relative to the body; a swing foot returns along the same line lifted on a half sine. The stride ramps in over the
    first cycle so the first step is not a jump. Inverted, the same plan goes through the mirror rule.
    @param geo The geometry. @param t Seconds since the gait began. @param cmd {vx, vy, yawRate}: x forward, y to the
    left seen from above, yaw counter-clockwise seen from above -- in both orientations.
    @param inverted Whether the body is upside down. @param shape What a policy shapes (B30); None is the gait exactly.
    @returns Eighteen targets in ACTUATOR_ORDER."""
    c = clamp_command(cmd)
    hz = step_frequency(geo, c)
    if hz == 0.0:
        return stance_targets(geo, inverted)
    sh = shape or GaitShape.neutral()
    hz = min(STEP_HZ_MAX, max(STEP_HZ_MIN, hz * sh.hz_scale))
    half_period = 0.5 / hz
    ramp = min(1.0, t * hz)
    feet = {}
    for li, leg in enumerate(LEG_IDS):
        phase = (t * hz + (0.0 if leg in TRIPOD_A else 0.5)) % 1.0
        stride = leg_ground_velocity(geo, leg, c) * half_period * ramp * sh.stride_scale[li]
        p0 = stance_foot(geo, leg)
        if phase < 0.5:
            s = phase / 0.5
            feet[leg] = p0 + stride * (s - 0.5)
        else:
            s = (phase - 0.5) / 0.5
            feet[leg] = p0 + stride * (0.5 - s) + np.array([0.0, 0.0, SWING_HEIGHT_M * sh.swing_scale * math.sin(math.pi * s)])
    return feet_to_targets(geo, feet, inverted)


def legs_hop_targets(geo: LegGeometry, t: float, inverted: bool = False) -> list[float]:
    """@description The servos-only jump: crouch for HOP_CROUCH_S (feet drawn up to HOP_CROUCH_FOOT_Z_M), hold, then
    every femur and tibia drives to the leg's full vertical extension at once, then the stance to land on.
    @param geo The geometry. @param t Seconds since the hop began. @param inverted Through the mirror rule.
    @returns Eighteen targets."""
    reach = geo.femur_m + geo.foot_centre_m
    if t < HOP_CROUCH_S:
        s = t / HOP_CROUCH_S
        feet = {leg: stance_foot(geo, leg) * (1 - s) + crouch_foot(geo, leg) * s for leg in LEG_IDS}
    elif t < HOP_CROUCH_S + HOP_HOLD_S:
        feet = {leg: crouch_foot(geo, leg) for leg in LEG_IDS}
    elif t < HOP_CROUCH_S + HOP_HOLD_S + HOP_PUSH_S:
        feet = {}
        for leg in LEG_IDS:
            mx, my, yaw = geo.mounts[leg]
            feet[leg] = np.array([mx + geo.coxa_m * math.cos(yaw), my + geo.coxa_m * math.sin(yaw), -reach])
    else:
        return stance_targets(geo, inverted)
    return feet_to_targets(geo, feet, inverted)


def crouch_foot(geo: LegGeometry, leg: str, foot_z: float = HOP_CROUCH_FOOT_Z_M) -> np.ndarray:
    """@description A leg's foot in a crouch: the stance point with the body lowered so the foot sits at foot_z (body frame).
    @param geo The geometry. @param leg The leg. @param foot_z Foot centre height in the body frame (m). @returns (x, y, z)."""
    p = stance_foot(geo, leg).copy()
    p[2] = foot_z
    return p


class InversionDetector:
    """@description Decides "inverted" from the accelerometer alone, as the node must: the proper acceleration along body
    z is +g upright and -g inverted at rest; a reading too small to tell (free fall) keeps the last answer, and a change
    needs INVERSION_HOLD_SAMPLES agreeing samples so one bounce does not flip the gait."""

    def __init__(self, inverted: bool = False) -> None:
        self.inverted = inverted
        self.candidate = inverted
        self.agree = 0

    def update(self, accel_mps2) -> bool:
        """@description Feed one accelerometer sample (body frame). @param accel_mps2 (ax, ay, az). @returns The current decision."""
        az = float(accel_mps2[2])
        if abs(az) < INVERSION_ACCEL_MPS2:
            return self.inverted
        seen = az < 0.0
        if seen == self.candidate:
            self.agree += 1
        else:
            self.candidate = seen
            self.agree = 1
        if seen != self.inverted and self.agree >= INVERSION_HOLD_SAMPLES:
            self.inverted = seen
        return self.inverted
