"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the spider-18's gait player (ADR-202, lane L4):
    |                                           | each leg's inverse kinematics from the contract's coxa/femur/tibia
    |                                           | lengths and coxa mounts in the contract's sign convention, a
    |                                           | tripod central-pattern generator that turns a body velocity
    |                                           | command (vx, vy, yaw rate) into eighteen joint targets at a fixed
    |                                           | tick (two tripods half a cycle apart; a stance foot moves against
    |                                           | the body's motion, a swing foot lifts and returns), the stance and
    |                                           | sit poses, a keyframe player, and the flip sequence: a slow push
    |                                           | with one side's legs while the other side folds over, so the body
    |                                           | rolls onto its other face. Standard library only (the Pi runs it).
    |                                           | The numbers that are not the brief's (cycle time, lift, stride cap,
    |                                           | the stance reach, the flip keyframes) are this lane's starting
    |                                           | choices for the plant to measure, stated as such.
"""
from __future__ import annotations

import math

from hexapod_spec import (ACTUATOR_COUNT, COXA_MM, COXA_MOUNTS, FEMUR_MM, LEG_IDS, STAND_HEIGHT_MM, TIBIA_MM, clamp_targets)

# The lane's starting choices (the plant lane measures and may supersede them).
CYCLE_S = 0.8  # one full gait cycle: each tripod swings for half of it
STANCE_S = CYCLE_S / 2.0
LIFT_MM = 30.0
HALF_STRIDE_CAP_MM = 40.0
REACH_MM = 115.0  # horizontal distance from the femur axis to the foot in the stance (160 mm from the coxa yaw axis)
LIFT_FULL_AT_MM = 20.0  # a stride this long (or longer) gets the full lift; shorter ones lift proportionally
TRIPOD_A: frozenset[str] = frozenset(("L1", "L3", "R2"))  # swings in the first half of the cycle; the rest in the second
EPS_MM = 1e-6
SIT_POSE = (0.0, math.radians(-50.0), math.radians(120.0))  # per leg: feet toward body +z, tibia folded back: the body rests on the ground
FLIP_CROUCH = (0.0, 0.0, math.radians(110.0))
FLIP_PUSH_1 = (0.0, math.radians(70.0), math.radians(20.0))
FLIP_PUSH_2 = (0.0, math.radians(100.0), 0.0)
FLIP_FOLD_1 = (0.0, math.radians(-60.0), math.radians(-100.0))
FLIP_FOLD_2 = (0.0, math.radians(-30.0), math.radians(-90.0))
FLIP_DURATIONS_S = (0.6, 1.5, 0.8, 0.7)


def _wrap(a: float) -> float:
    return math.atan2(math.sin(a), math.cos(a))


def default_foot(leg: str) -> tuple[float, float, float]:
    """@description Where a leg's foot stands in the body frame (mm) in the stance the gait starts from: REACH_MM beyond
    the coxa link along the neutral yaw, STAND_HEIGHT_MM below the mid-plane. @param leg The leg. @returns (x, y, z)."""
    mx, my, yaw_deg = COXA_MOUNTS[leg]
    yaw = math.radians(yaw_deg)
    reach = COXA_MM + REACH_MM
    return (mx + reach * math.cos(yaw), my + reach * math.sin(yaw), -STAND_HEIGHT_MM)


def leg_ik(leg: str, foot: tuple[float, float, float]) -> tuple[float, float, float]:
    """@description A leg's three joint angles for a foot position in the body frame (mm), in the contract's sign
    convention: coxa positive swings the foot forward on either side, femur positive drops it toward -z, tibia positive
    bends the knee further toward -z; the knee is kept above the femur-to-foot line. A foot beyond reach is pulled onto
    the reach circle rather than refused: the gait never emits a NaN.
    @param leg The leg. @param foot (x, y, z) mm. @returns (coxa, femur, tibia) radians, unclamped."""
    mx, my, yaw_deg = COXA_MOUNTS[leg]
    dx, dy, dz = foot[0] - mx, foot[1] - my, foot[2]
    d_yaw = _wrap(math.atan2(dy, dx) - math.radians(yaw_deg))
    coxa = -d_yaw if leg[0] == "L" else d_yaw
    r = math.hypot(dx, dy) - COXA_MM
    dist = math.hypot(r, dz)
    dist = min(FEMUR_MM + TIBIA_MM - EPS_MM, max(abs(FEMUR_MM - TIBIA_MM) + EPS_MM, dist))
    gamma = math.atan2(dz, r)
    beta = math.acos(max(-1.0, min(1.0, (FEMUR_MM ** 2 + dist ** 2 - TIBIA_MM ** 2) / (2.0 * FEMUR_MM * dist))))
    knee = math.acos(max(-1.0, min(1.0, (FEMUR_MM ** 2 + TIBIA_MM ** 2 - dist ** 2) / (2.0 * FEMUR_MM * TIBIA_MM))))
    return (coxa, -(gamma + beta), math.pi - knee)


def leg_fk(leg: str, coxa: float, femur: float, tibia: float) -> tuple[float, float, float]:
    """@description The foot position (mm, body frame) the joint angles put a leg's foot at: the inverse of leg_ik, for
    proving it. @param leg The leg. @param coxa @param femur @param tibia Radians. @returns (x, y, z)."""
    mx, my, yaw_deg = COXA_MOUNTS[leg]
    u = COXA_MM + FEMUR_MM * math.cos(femur) + TIBIA_MM * math.cos(femur + tibia)
    w = -FEMUR_MM * math.sin(femur) - TIBIA_MM * math.sin(femur + tibia)
    yaw = math.radians(yaw_deg) + (-coxa if leg[0] == "L" else coxa)
    return (mx + u * math.cos(yaw), my + u * math.sin(yaw), w)


def pose_targets(per_leg) -> list[float]:
    """@description Eighteen targets from one (coxa, femur, tibia) triple for every leg, or a per-leg map.
    @param per_leg A triple, or {leg: triple}. @returns The targets in ACTUATOR_ORDER, clamped."""
    out: list[float] = []
    for leg in LEG_IDS:
        triple = per_leg[leg] if isinstance(per_leg, dict) else per_leg
        out.extend(float(v) for v in triple)
    return clamp_targets(out)


def stance_targets() -> list[float]:
    """@description The stance every command starts from: each foot at its default position. @returns Eighteen targets."""
    return clamp_targets([v for leg in LEG_IDS for v in leg_ik(leg, default_foot(leg))])


def sit_targets() -> list[float]:
    """@description Legs folded so the body rests on the ground (the servos are relaxed after reaching it). @returns Eighteen targets."""
    return pose_targets(SIT_POSE)


def flip_keyframes(side: str = "right") -> list[tuple[float, list[float]]]:
    """@description The flip: crouch, then the pushing side's legs extend slowly toward the ground while the other side
    folds over the body, then the push goes over centre, then the stance (which the mirror rule turns into the inverted
    stance once the switch sees the body upside down). Planned in the body's CURRENT frame; the node mirrors the frames
    when the body starts inverted. @param side The side that pushes: 'right' (the body rolls over its left) or 'left'.
    @returns (duration s, targets) keyframes."""
    if side not in ("left", "right"):
        raise ValueError("flip side must be 'left' or 'right'")
    push = "R" if side == "right" else "L"
    frames = [(FLIP_DURATIONS_S[0], pose_targets(FLIP_CROUCH))]
    for duration, push_pose, fold_pose in ((FLIP_DURATIONS_S[1], FLIP_PUSH_1, FLIP_FOLD_1), (FLIP_DURATIONS_S[2], FLIP_PUSH_2, FLIP_FOLD_2)):
        frames.append((duration, pose_targets({leg: (push_pose if leg[0] == push else fold_pose) for leg in LEG_IDS})))
    frames.append((FLIP_DURATIONS_S[3], stance_targets()))
    return frames


class KeyframePlayer:
    """@description Plays keyframes by linear interpolation from wherever the joints are: `tick` returns the targets for
    this tick, and None once the last frame has been reached."""

    def __init__(self, frames: list[tuple[float, list[float]]], start: list[float]) -> None:
        if not frames:
            raise ValueError("a keyframe sequence needs at least one frame")
        self.frames = frames
        self.origin = list(start)
        self.index = 0
        self.elapsed = 0.0
        self.last = list(start)

    @property
    def done(self) -> bool:
        return self.index >= len(self.frames)

    @property
    def total_s(self) -> float:
        return sum(d for d, _ in self.frames)

    def tick(self, dt: float) -> list[float] | None:
        """@description Advance by dt and return this tick's targets, or None when the sequence has finished.
        @param dt Seconds. @returns Eighteen targets or None."""
        if self.done:
            return None
        duration, target = self.frames[self.index]
        self.elapsed += dt
        alpha = 1.0 if duration <= 0 else min(1.0, self.elapsed / duration)
        self.last = [o + (t - o) * alpha for o, t in zip(self.origin, target)]
        if alpha >= 1.0:
            self.origin = list(target)
            self.index += 1
            self.elapsed = 0.0
        return list(self.last)


class TripodGait:
    """@description The tripod central-pattern generator: a phase that advances while a command is non-zero, two
    tripods half a cycle apart, each foot's offset from its default position computed from the command, and the
    joint targets by inverse kinematics every tick."""

    def __init__(self) -> None:
        self.phase = 0.0
        self.vx_mmps = 0.0
        self.vy_mmps = 0.0
        self.yaw_rate = 0.0
        self.stance: list[bool] = [True] * len(LEG_IDS)
        self.ticks = 0

    def set_command(self, vx_mps: float, vy_mps: float, yaw_rate_rad_s: float) -> None:
        """@description The body velocity to walk at (body frame: +x forward, +y left, yaw CCW from above).
        @param vx_mps @param vy_mps Metres per second. @param yaw_rate_rad_s Radians per second."""
        self.vx_mmps = float(vx_mps) * 1000.0
        self.vy_mmps = float(vy_mps) * 1000.0
        self.yaw_rate = float(yaw_rate_rad_s)

    @property
    def moving(self) -> bool:
        return math.hypot(self.vx_mmps, self.vy_mmps) > 1e-6 or abs(self.yaw_rate) > 1e-6

    def stride(self, foot: tuple[float, float, float]) -> tuple[float, float]:
        """@description The stance stroke of a foot (mm): the body's motion at that foot, reversed, over the stance time,
        capped so the foot stays in its workspace. @param foot The foot's default position. @returns (sx, sy)."""
        sx = -(self.vx_mmps - self.yaw_rate * foot[1]) * STANCE_S
        sy = -(self.vy_mmps + self.yaw_rate * foot[0]) * STANCE_S
        n = math.hypot(sx, sy)
        if n > 2.0 * HALF_STRIDE_CAP_MM:
            sx, sy = sx * 2.0 * HALF_STRIDE_CAP_MM / n, sy * 2.0 * HALF_STRIDE_CAP_MM / n
        return (sx, sy)

    def foot_offset(self, leg: str, foot: tuple[float, float, float]) -> tuple[float, float, float, bool]:
        """@description A leg's offset from its default foot position at the current phase.
        @param leg The leg. @param foot Its default position. @returns (dx, dy, dz, in stance)."""
        if not self.moving:
            return (0.0, 0.0, 0.0, True)
        p = (self.phase + (0.0 if leg in TRIPOD_A else 0.5)) % 1.0
        sx, sy = self.stride(foot)
        lift = LIFT_MM * min(1.0, math.hypot(sx, sy) / LIFT_FULL_AT_MM)
        if p < 0.5:
            q = p / 0.5  # swing: back from the end of the stroke to its start, lifted
            return (sx * (0.5 - q), sy * (0.5 - q), lift * math.sin(math.pi * q), False)
        q = (p - 0.5) / 0.5  # stance: the foot moves against the body
        return (sx * (q - 0.5), sy * (q - 0.5), 0.0, True)

    def tick(self, dt: float) -> list[float]:
        """@description Advance the pattern by dt and return the eighteen joint targets. @param dt Seconds. @returns Targets, clamped."""
        if self.moving:
            self.phase = (self.phase + dt / CYCLE_S) % 1.0
        self.ticks += 1
        targets: list[float] = []
        for li, leg in enumerate(LEG_IDS):
            foot = default_foot(leg)
            dx, dy, dz, in_stance = self.foot_offset(leg, foot)
            self.stance[li] = in_stance
            targets.extend(leg_ik(leg, (foot[0] + dx, foot[1] + dy, foot[2] + dz)))
        assert len(targets) == ACTUATOR_COUNT
        return clamp_targets(targets)
