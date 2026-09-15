/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the differential-drive base with its lift:
 *                     |                             | unicycle integration, a turn–drive–align controller with
 *                     |                             | acceleration limits, and the speed ceiling that depends on the
 *                     |                             | lift (0.8 m/s stowed, 0.3 m/s raised — the hardware design's
 *                     |                             | dead-stop energy rule, enforced here so the planner cannot
 *                     |                             | bypass it).
 */

import { clamp, distance2, wrapAngle } from '../math/vec';

/** @description The base's kinematic state. Heading in radians from +X. */
export interface BaseState {
  x: number;
  y: number;
  yaw: number;
  /** Forward speed (m/s). */
  v: number;
  /** Turn rate (rad/s). */
  w: number;
  /** Lift carriage height above the floor (m). */
  liftZ: number;
}

/** @description Motion limits the node enforces regardless of what the planner asks. */
export interface BaseLimits {
  vStowed: number;
  vLifted: number;
  wMax: number;
  accel: number;
  decel: number;
  liftMin: number;
  liftMax: number;
  liftSpeed: number;
}

/** @description The hardware design's limits. */
export const DEFAULT_BASE_LIMITS: BaseLimits = {
  vStowed: 0.8,
  vLifted: 0.3,
  wMax: 0.8,
  accel: 0.6,
  decel: 1.5,
  liftMin: 0.30,
  liftMax: 1.00,
  liftSpeed: 0.04,
};

/** @description A goal pose for the drive controller. */
export interface DriveGoal {
  x: number;
  y: number;
  yaw: number;
}

/** @description The controller's phase, for telemetry. */
export type DrivePhase = 'turn' | 'drive' | 'align' | 'done';

/** @description True when the carriage is at its bottom stop (within 1 cm). */
export const isStowed = (s: BaseState, limits: BaseLimits): boolean => s.liftZ <= limits.liftMin + 0.01;

/** @description The forward speed ceiling for the current lift height. */
export const speedLimit = (s: BaseState, limits: BaseLimits): number => (isStowed(s, limits) ? limits.vStowed : limits.vLifted);

/**
 * @description Advance the unicycle model one step with the given commanded speeds, which are
 * clamped to the limits first. Heading integrates at the midpoint for a smoother arc.
 * @param s - Current state.
 * @param v - Commanded forward speed.
 * @param w - Commanded turn rate.
 * @param dt - Step (s).
 * @param limits - Motion limits.
 * @returns The next state.
 */
export function integrateUnicycle(s: BaseState, v: number, w: number, dt: number, limits: BaseLimits): BaseState {
  const vMax = speedLimit(s, limits);
  const vc = clamp(v, -vMax, vMax);
  const wc = clamp(w, -limits.wMax, limits.wMax);
  const yawMid = s.yaw + wc * dt * 0.5;
  return {
    ...s,
    x: s.x + vc * Math.cos(yawMid) * dt,
    y: s.y + vc * Math.sin(yawMid) * dt,
    yaw: wrapAngle(s.yaw + wc * dt),
    v: vc,
    w: wc,
  };
}

/** @description Ramp a speed toward a target by at most accel·dt (decel·dt when slowing). */
function ramp(current: number, target: number, limits: BaseLimits, dt: number): number {
  const slowing = Math.abs(target) < Math.abs(current);
  const step = (slowing ? limits.decel : limits.accel) * dt;
  const delta = target - current;
  return Math.abs(delta) <= step ? target : current + Math.sign(delta) * step;
}

/**
 * @description One step of the turn–drive–align controller toward a goal pose.
 *
 * Turn in place until the heading points at the goal, drive with a deceleration profile so the
 * base arrives at rest, then turn to the goal heading. Tolerances: 2 cm position, 1° heading.
 * @param s - Current state.
 * @param goal - Goal pose.
 * @param limits - Motion limits.
 * @param dt - Step (s).
 * @returns The next state, the controller phase, and whether the goal is reached.
 */
export function driveStep(s: BaseState, goal: DriveGoal, limits: BaseLimits, dt: number): { next: BaseState; phase: DrivePhase; done: boolean } {
  const dist = distance2(s, goal);
  const headingToGoal = Math.atan2(goal.y - s.y, goal.x - s.x);
  const headingErr = wrapAngle(headingToGoal - s.yaw);
  const yawErr = wrapAngle(goal.yaw - s.yaw);
  const turnRate = (err: number): number => clamp(2.0 * err, -limits.wMax, limits.wMax);
  if (dist > 0.02) {
    if (Math.abs(headingErr) > 0.05) {
      const next = integrateUnicycle(s, ramp(s.v, 0, limits, dt), turnRate(headingErr), dt, limits);
      return { next, phase: 'turn', done: false };
    }
    const vMax = speedLimit(s, limits);
    const vTarget = Math.min(vMax, Math.sqrt(2 * limits.decel * dist), dist / dt);
    const next = integrateUnicycle(s, ramp(s.v, vTarget, limits, dt), turnRate(headingErr), dt, limits);
    return { next, phase: 'drive', done: false };
  }
  if (Math.abs(yawErr) > 0.0175) {
    const next = integrateUnicycle(s, 0, turnRate(yawErr), dt, limits);
    return { next, phase: 'align', done: false };
  }
  return { next: { ...s, v: 0, w: 0 }, phase: 'done', done: true };
}

/**
 * @description Move the lift toward a target height at its rated speed, clamped to travel.
 * @param s - Current state.
 * @param targetZ - Desired carriage height (m).
 * @param limits - Motion limits.
 * @param dt - Step (s).
 * @returns Next state and arrival flag.
 */
export function liftStep(s: BaseState, targetZ: number, limits: BaseLimits, dt: number): { next: BaseState; done: boolean } {
  const target = clamp(targetZ, limits.liftMin, limits.liftMax);
  const delta = target - s.liftZ;
  const step = limits.liftSpeed * dt;
  if (Math.abs(delta) <= step) return { next: { ...s, liftZ: target }, done: true };
  return { next: { ...s, liftZ: s.liftZ + Math.sign(delta) * step }, done: false };
}
