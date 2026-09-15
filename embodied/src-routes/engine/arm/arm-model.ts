/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the simulated six-degree-of-freedom arm as a
 *                     |                             | Denavit–Hartenberg table (the "sim-6": shoulder yaw, shoulder
 *                     |                             | pitch, elbow, spherical wrist, tool offset), its joint limits,
 *                     |                             | speeds and link masses, forward kinematics, and the arm's own
 *                     |                             | centre of mass — which feeds the base's tip budget. The table is
 *                     |                             | this package's own; it is not a vendor's published model.
 */

import { dhTransform, identity, multiply, position, toPose, type Mat4 } from '../math/transform';
import { add, scale, type Pose6, type Vec3 } from '../math/vec';

/** @description One revolute joint's Denavit–Hartenberg row plus its limits and link mass. */
export interface DhJoint {
  /** Link offset along the previous z (m). */
  d: number;
  /** Link length along the new x (m). */
  a: number;
  /** Link twist about the new x (rad). */
  alpha: number;
  /** Lower joint limit (rad). */
  min: number;
  /** Upper joint limit (rad). */
  max: number;
  /** Maximum joint speed (rad/s) the node will command. */
  maxSpeed: number;
  /** Mass of the link this joint carries (kg), lumped at the link's midpoint. */
  linkMass: number;
}

/** @description A complete arm description. */
export interface ArmSpec {
  id: string;
  joints: DhJoint[];
  /** Gripper + force sensor + wrist camera, lumped at the tool centre point (kg). */
  toolMass: number;
}

const HALF_PI = Math.PI / 2;

/**
 * @description The sim-6 arm. At q = 0 the tool centre point sits at (0.35, 0, 0.70) in the arm
 * base frame with the tool axis pointing +z; the wrist is spherical (joints 4–6 intersect).
 * Reach from the shoulder is a2 + d4 + d6 = 0.75 m. Masses total 12.2 kg + 1.4 kg tool, the
 * figures the hardware design budgets for the arm assembly.
 */
export const SIM_ARM_6: ArmSpec = {
  id: 'sim-6',
  joints: [
    { d: 0.30, a: 0, alpha: HALF_PI, min: -Math.PI, max: Math.PI, maxSpeed: 1.0, linkMass: 2.8 },
    { d: 0, a: 0.35, alpha: 0, min: -2.2, max: 2.2, maxSpeed: 1.0, linkMass: 3.4 },
    { d: 0, a: 0, alpha: -HALF_PI, min: -3.3, max: 3.3, maxSpeed: 1.2, linkMass: 2.2 },
    { d: 0.30, a: 0, alpha: HALF_PI, min: -Math.PI, max: Math.PI, maxSpeed: 1.5, linkMass: 1.6 },
    { d: 0, a: 0, alpha: -HALF_PI, min: -3.05, max: 3.05, maxSpeed: 1.5, linkMass: 1.3 },
    { d: 0.10, a: 0, alpha: 0, min: -Math.PI, max: Math.PI, maxSpeed: 2.0, linkMass: 0.9 },
  ],
  toolMass: 1.4,
};

/** @description The folded travelling configuration: elbow tucked, tool near the column. */
export const STOW_Q: readonly number[] = [0, 1.9, -2.4, 0, -1.2, 0];
/** @description A neutral working configuration the planner seeds inverse kinematics from. */
export const READY_Q: readonly number[] = [0, 0.6, -1.2, 0, -1.0, 0];

/** @description Forward-kinematics output: every frame after its joint, plus the tool frame. */
export interface ArmKinematics {
  /** frames[i] is the transform of frame i (after joint i), i = 0..5; all in the arm base frame. */
  frames: Mat4[];
  /** The tool centre point transform (= frames[5]). */
  tcp: Mat4;
}

/**
 * @description Forward kinematics by composing the DH link transforms.
 * @param spec - The arm.
 * @param q - Joint angles (rad), one per joint.
 * @returns Every intermediate frame and the tool frame.
 */
export function forwardKinematics(spec: ArmSpec, q: readonly number[]): ArmKinematics {
  if (q.length !== spec.joints.length) throw new RangeError(`expected ${spec.joints.length} joint angles, got ${q.length}`);
  const frames: Mat4[] = [];
  let t = identity();
  spec.joints.forEach((j, i) => {
    t = multiply(t, dhTransform(q[i], j.d, j.a, j.alpha));
    frames.push(t);
  });
  return { frames, tcp: frames[frames.length - 1] };
}

/** @description The tool pose for a joint configuration. */
export function tcpPose(spec: ArmSpec, q: readonly number[]): Pose6 {
  return toPose(forwardKinematics(spec, q).tcp);
}

/**
 * @description The origin of every frame, starting with the arm base, for drawing and collision
 * checks: a polyline through the joints.
 * @param spec - The arm.
 * @param q - Joint angles.
 * @returns Base origin followed by each frame origin (7 points for a 6-joint arm).
 */
export function jointOrigins(spec: ArmSpec, q: readonly number[]): Vec3[] {
  const { frames } = forwardKinematics(spec, q);
  return [[0, 0, 0], ...frames.map(position)];
}

/**
 * @description The arm's total mass and centre of mass in the arm base frame. Each link is
 * lumped at the midpoint of its segment; the tool mass sits at the tool centre point.
 * @param spec - The arm.
 * @param q - Joint angles.
 * @returns Total mass (kg) and centre of mass (m).
 */
export function armCenterOfMass(spec: ArmSpec, q: readonly number[]): { mass: number; com: Vec3 } {
  const origins = jointOrigins(spec, q);
  let mass = 0;
  let weighted: Vec3 = [0, 0, 0];
  spec.joints.forEach((j, i) => {
    const mid = scale(add(origins[i], origins[i + 1]), 0.5);
    weighted = add(weighted, scale(mid, j.linkMass));
    mass += j.linkMass;
  });
  weighted = add(weighted, scale(origins[origins.length - 1], spec.toolMass));
  mass += spec.toolMass;
  return { mass, com: scale(weighted, 1 / mass) };
}

/** @description Joint angles clamped into their limits. */
export function clampToLimits(spec: ArmSpec, q: readonly number[]): number[] {
  return spec.joints.map((j, i) => Math.min(j.max, Math.max(j.min, q[i])));
}

/** @description True when every joint angle is inside its limits (inclusive, 1e-9 slack). */
export function withinLimits(spec: ArmSpec, q: readonly number[]): boolean {
  return spec.joints.every((j, i) => q[i] >= j.min - 1e-9 && q[i] <= j.max + 1e-9);
}

/** @description The shoulder point (frame-1 origin at q = 0) the reach envelope is measured from. */
export const shoulderPoint = (spec: ArmSpec): Vec3 => [0, 0, spec.joints[0].d];

/** @description Maximum distance from the shoulder the tool centre point can ever reach. */
export function maxReach(spec: ArmSpec): number {
  return spec.joints.slice(1).reduce((sum, j) => sum + Math.abs(j.a) + Math.abs(j.d), 0);
}

/**
 * @description Move every joint toward a target by at most its speed × dt. Returns the new angles
 * and whether the target was reached this step.
 * @param spec - The arm.
 * @param q - Current angles.
 * @param target - Target angles.
 * @param dt - Step (s).
 * @returns Next angles and arrival flag.
 */
export function stepJoints(spec: ArmSpec, q: readonly number[], target: readonly number[], dt: number): { q: number[]; arrived: boolean } {
  let arrived = true;
  const next = spec.joints.map((j, i) => {
    const delta = target[i] - q[i];
    const step = j.maxSpeed * dt;
    if (Math.abs(delta) <= step) return target[i];
    arrived = false;
    return q[i] + Math.sign(delta) * step;
  });
  return { q: next, arrived };
}
