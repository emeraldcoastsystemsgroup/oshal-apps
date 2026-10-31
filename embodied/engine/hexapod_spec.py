"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the Python twin of the spider-18 contract
    |                                           | (ADR-202, src-routes/engine/design/hexapod-spec.ts) for the
    |                                           | controller lane: the leg ids, the canonical 18-actuator order,
    |                                           | the brief's layout numbers, the joint limits, the mirror rule
    |                                           | (invertedJointTargets, ported 1:1 and proven equal to a fixture
    |                                           | the TypeScript function generated) and the clamp. Standard
    |                                           | library only, so it runs on the robot's Raspberry Pi as it is.
    |                                           | Every number here is the brief's, copied from the contract file;
    |                                           | tests/fixtures/hexapod-node-contract.json holds the same numbers
    |                                           | as the TypeScript emitted them and the node suite diffs the two.
"""
from __future__ import annotations

import math

LEG_IDS: tuple[str, ...] = ("L1", "L2", "L3", "R1", "R2", "R3")
LEG_JOINTS: tuple[str, ...] = ("coxa", "femur", "tibia")
ACTUATOR_ORDER: tuple[str, ...] = tuple(f"{leg}-{joint}" for leg in LEG_IDS for joint in LEG_JOINTS)
ACTUATOR_COUNT = len(ACTUATOR_ORDER)

# The brief's layout (mm): where each coxa yaw axis stands and the leg's neutral direction (degrees from +x, CCW from above).
COXA_MOUNTS: dict[str, tuple[float, float, float]] = {
    "L1": (80.0, 52.0, 45.0), "L2": (0.0, 68.0, 90.0), "L3": (-80.0, 52.0, 135.0),
    "R1": (80.0, -52.0, -45.0), "R2": (0.0, -68.0, -90.0), "R3": (-80.0, -52.0, -135.0),
}
COXA_MM = 45.0
FEMUR_MM = 80.0
TIBIA_MM = 120.0
FOOT_RADIUS_MM = 8.0
STAND_HEIGHT_MM = 90.0
LIDAR_NOSE_X_MM = 135.0

# Software joint limits in degrees about the sign convention (the geometry's limits, not the servo's).
LIMITS_DEG: dict[str, tuple[float, float]] = {"coxa": (-60.0, 60.0), "femur": (-120.0, 120.0), "tibia": (-140.0, 140.0)}
LIMITS_RAD: dict[str, tuple[float, float]] = {k: (math.radians(lo), math.radians(hi)) for k, (lo, hi) in LIMITS_DEG.items()}

# The latched-spring option: E = k s^2 / 2 (5000 N/m over 38 mm = 3.61 J), the one number every lane quotes.
SPRING_STIFFNESS_N_PER_M = 5000.0
SPRING_STROKE_MM = 38.0
SPRING_STORED_J = round(0.5 * SPRING_STIFFNESS_N_PER_M * (SPRING_STROKE_MM / 1000.0) ** 2 * 100) / 100

SIGN_CONVENTION = {
    "coxa": "positive = foot forward (+x body) on every leg",
    "femur": "positive = foot toward body -z (belly side)",
    "tibia": "positive = knee bends the foot further toward body -z",
    "zeroPose": "leg straight out horizontally along its neutral yaw",
}


def mirror_leg_role(leg: str) -> str:
    """@description The leg that plays this leg's role once the body is inverted: left and right swap, front stays front.
    @param leg A leg id. @returns Its mirror."""
    return ("R" if leg[0] == "L" else "L") + leg[1:]


def actuator_index(leg: str, joint: str) -> int:
    """@description The index of a joint in the canonical order. @param leg The leg. @param joint The joint. @returns 0-17."""
    return LEG_IDS.index(leg) * 3 + LEG_JOINTS.index(joint)


def joint_of_index(index: int) -> str:
    """@description The joint name (coxa, femur, tibia) an actuator index carries. @param index 0-17. @returns The joint."""
    return LEG_JOINTS[index % 3]


def inverted_joint_targets(targets) -> list[float]:
    """@description The inverted-walking rule, ported 1:1 from the contract's `invertedJointTargets`: when the body is
    upside down the ground is at body +z, so every femur and tibia target is negated; a coxa target is not (forward is
    still forward); and the leg roles mirror (the gait that drove L1 drives R1).
    @param targets Eighteen targets in ACTUATOR_ORDER, as planned for the upright body.
    @returns The same intent for the inverted body."""
    if len(targets) != ACTUATOR_COUNT:
        raise ValueError(f"expected {ACTUATOR_COUNT} targets, got {len(targets)}")
    out = [0.0] * ACTUATOR_COUNT
    for li, leg in enumerate(LEG_IDS):
        src = LEG_IDS.index(mirror_leg_role(leg)) * 3
        out[li * 3] = float(targets[src])
        out[li * 3 + 1] = -float(targets[src + 1])
        out[li * 3 + 2] = -float(targets[src + 2])
    return out


def clamp_targets(targets) -> list[float]:
    """@description Eighteen targets held inside the contract's joint limits (radians); a non-finite value is refused.
    @param targets Eighteen radians in ACTUATOR_ORDER. @returns The clamped copy."""
    if len(targets) != ACTUATOR_COUNT:
        raise ValueError(f"expected {ACTUATOR_COUNT} targets, got {len(targets)}")
    out = []
    for i, value in enumerate(targets):
        v = float(value)
        if not math.isfinite(v):
            raise ValueError(f"target {ACTUATOR_ORDER[i]} is not a finite number")
        lo, hi = LIMITS_RAD[joint_of_index(i)]
        out.append(min(hi, max(lo, v)))
    return out


def validate_targets(raw) -> list[float]:
    """@description Eighteen finite numbers from an envelope, or a refusal naming what is wrong (fail-closed before any
    servo moves). @param raw The `targetsRad` argument. @returns The targets as floats, unclamped."""
    if not isinstance(raw, (list, tuple)) or len(raw) != ACTUATOR_COUNT:
        raise ValueError(f"targetsRad must be a list of {ACTUATOR_COUNT} numbers in ACTUATOR_ORDER")
    out = []
    for i, value in enumerate(raw):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise ValueError(f"targetsRad[{i}] ({ACTUATOR_ORDER[i]}) is not a finite number")
        out.append(float(value))
    return out
