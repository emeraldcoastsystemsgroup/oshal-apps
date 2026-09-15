/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the indoor mini drone as a kinematic point
 *                     |                             | with a mode machine (landed → takeoff → hover ↔ moving →
 *                     |                             | landing), an indoor fence (room bounds, ceiling, a floor when
 *                     |                             | moving, keep-out boxes around furniture with a margin), and a
 *                     |                             | segment clearance test the planner uses before every goto.
 *                     |                             | Battery drains while airborne. No wind, no noise: deterministic.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Cruise altitude 1.9 m — the frontier exploration flies one layer under the ceiling so the LiDAR sees the room tops.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Odometry: `OdometryModel` (deterministic per-metre drift), `DroneLimits.odometry`, `Pose3Yaw`, and `propagateTruth` — the autopilot flies its BELIEF onto the target and the TRUTH is what deviates; inverting the body-frame error model gives where the drone really went.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | A drone already outside the fence (a physics plant overshoots a climb past the fence ceiling by centimetres) has its path judged from the nearest point inside the fence, provided that point is within FENCE_BACKOUT_M; where it is cannot be refused, where it goes still is.
 */

import { add, distance, norm, scale, sub, type Vec3 } from '../math/vec';

/** @description An axis-aligned box in the world frame. */
export interface Box3 {
  min: Vec3;
  max: Vec3;
  name?: string;
}

/** @description Drone flight modes. */
export type DroneMode = 'landed' | 'takeoff' | 'hover' | 'moving' | 'landing';

/** @description The drone's state. */
export interface DroneState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  mode: DroneMode;
  /** 0..1 */
  battery: number;
  target: Vec3 | null;
  /** Where the drone left the ground; landing returns here when no target is set. */
  home: Vec3;
}

/**
 * @description Deterministic dead-reckoning error, per metre flown in the body frame: a scale error along
 * the track, a sideways bias, a vertical bias, and a heading bias. No randomness — the same flight drifts
 * the same way every time, which is what makes a rehearsal mean something.
 */
export interface OdometryModel {
  alongPerM: number;
  crossPerM: number;
  upPerM: number;
  yawRadPerM: number;
}

/** @description 2 % along track, 0.5 % sideways, 0.5 % vertical, 0.57° of heading per metre — an indoor IMU/flow estimate without a fix. */
export const DEFAULT_ODOMETRY: OdometryModel = { alongPerM: 0.02, crossPerM: 0.005, upPerM: 0.005, yawRadPerM: 0.01 };

/** @description A position with a heading — the shape shared by the believed and the true drone pose. */
export interface Pose3Yaw {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** @description Flight limits. */
export interface DroneLimits {
  maxSpeed: number;
  climbSpeed: number;
  /** Altitude takeoff climbs to and goto is clamped above when moving. */
  cruiseAlt: number;
  minMovingAlt: number;
  /** Battery fraction per second airborne. */
  drainPerSecond: number;
  /** Below this fraction new flights are refused. */
  minBatteryToFly: number;
  /** How the drone's dead-reckoned pose drifts from the truth; `null` = an exact (unrealistic) pose. */
  odometry: OdometryModel | null;
}

/** @description Indoor mini-drone defaults. */
export const DEFAULT_DRONE_LIMITS: DroneLimits = {
  maxSpeed: 1.0,
  climbSpeed: 0.5,
  cruiseAlt: 1.9,
  minMovingAlt: 0.4,
  drainPerSecond: 1 / 900,
  minBatteryToFly: 0.15,
  odometry: DEFAULT_ODOMETRY,
};

/** @description The indoor fence. */
export interface Fence {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  ceiling: number;
  keepOut: Box3[];
  /** Margin added around every keep-out box (m). */
  margin: number;
}

/** @description A landed drone at a point, fully charged. */
export function landedDrone(at: Vec3, yaw = 0): DroneState {
  return { x: at[0], y: at[1], z: at[2], yaw, mode: 'landed', battery: 1, target: null, home: at };
}

/** @description True when a point is inside a box expanded by a margin. */
export function insideBox(p: Vec3, b: Box3, margin = 0): boolean {
  return p[0] >= b.min[0] - margin && p[0] <= b.max[0] + margin
    && p[1] >= b.min[1] - margin && p[1] <= b.max[1] + margin
    && p[2] >= b.min[2] - margin && p[2] <= b.max[2] + margin;
}

/**
 * @description Is a point legal for the drone to occupy while airborne?
 * @param p - The point.
 * @param fence - The fence.
 * @param limits - Flight limits (for the moving floor).
 * @returns ok, or the reason.
 */
export function insideFence(p: Vec3, fence: Fence, limits: DroneLimits): { ok: boolean; reason?: string } {
  if (p[0] < fence.minX || p[0] > fence.maxX || p[1] < fence.minY || p[1] > fence.maxY) return { ok: false, reason: 'outside room' };
  if (p[2] > fence.ceiling) return { ok: false, reason: 'above ceiling' };
  if (p[2] < limits.minMovingAlt) return { ok: false, reason: 'below minimum altitude' };
  const hit = fence.keepOut.find((b) => insideBox(p, b, fence.margin));
  if (hit) return { ok: false, reason: `inside keep-out ${hit.name ?? 'box'}` };
  return { ok: true };
}

/**
 * @description Is the straight segment a→b clear of the fence? Sampled every 5 cm, endpoints included.
 * @param a - Start.
 * @param b - End.
 * @param fence - The fence.
 * @param limits - Flight limits.
 * @returns ok, or the first reason found.
 */
export function segmentClear(a: Vec3, b: Vec3, fence: Fence, limits: DroneLimits): { ok: boolean; reason?: string } {
  const len = distance(a, b);
  const n = Math.max(1, Math.ceil(len / 0.05));
  for (let i = 0; i <= n; i += 1) {
    const p = add(a, scale(sub(b, a), i / n));
    const r = insideFence(p, fence, limits);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/** @description Command a takeoff to cruise altitude. Refused unless landed with enough battery. */
export function takeoff(s: DroneState, limits: DroneLimits): DroneState {
  if (s.mode !== 'landed') throw new Error('takeoff requires a landed drone');
  if (s.battery < limits.minBatteryToFly) throw new Error('battery too low to fly');
  return { ...s, mode: 'takeoff', target: [s.x, s.y, limits.cruiseAlt], home: [s.x, s.y, s.z] };
}

/** @description Command a move to a point. Refused unless airborne and the point is legal. */
/** How far a drone that finds itself outside the fence (a physics overshoot past the ceiling) may fly to get back inside it. */
export const FENCE_BACKOUT_M = 0.3;

export function gotoPoint(s: DroneState, target: Vec3, fence: Fence, limits: DroneLimits): DroneState {
  if (s.mode !== 'hover' && s.mode !== 'moving') throw new Error('goto requires an airborne drone');
  const legal = insideFence(target, fence, limits);
  if (!legal.ok) throw new Error(`goto refused: ${legal.reason}`);
  const from: Vec3 = [s.x, s.y, s.z];
  // Where the drone already is cannot be refused — it is there. A real plant overshoots a climb by a few centimetres
  // past the fence ceiling: the path is judged from the nearest point inside the fence, and only when that is within
  // FENCE_BACKOUT_M of where the drone is.
  const start = clampIntoFence(from, fence, limits);
  if (distance(start, from) > FENCE_BACKOUT_M) throw new Error(`goto refused: ${insideFence(from, fence, limits).reason ?? 'outside the fence'} by more than ${FENCE_BACKOUT_M} m`);
  const path = segmentClear(start, target, fence, limits);
  if (!path.ok) throw new Error(`goto refused: path ${path.reason}`);
  return { ...s, mode: 'moving', target };
}

/** @description The nearest point to `p` inside the room box, under the ceiling and above the minimum moving altitude. */
export function clampIntoFence(p: Vec3, fence: Fence, limits: DroneLimits): Vec3 {
  return [Math.min(fence.maxX, Math.max(fence.minX, p[0])), Math.min(fence.maxY, Math.max(fence.minY, p[1])), Math.min(fence.ceiling, Math.max(limits.minMovingAlt, p[2]))];
}

/** @description Command a landing straight down from the current position. */
export function land(s: DroneState): DroneState {
  if (s.mode === 'landed') return s;
  return { ...s, mode: 'landing', target: [s.x, s.y, s.home[2]] };
}

/** @description Move toward a target at a speed; returns the new position and whether it arrived. */
function approach(p: Vec3, target: Vec3, speed: number, dt: number): { p: Vec3; arrived: boolean } {
  const d = sub(target, p);
  const len = norm(d);
  const step = speed * dt;
  if (len <= step) return { p: target, arrived: true };
  return { p: add(p, scale(d, step / len)), arrived: false };
}

/**
 * @description Advance the drone one step.
 * @param s - Current state.
 * @param limits - Flight limits.
 * @param dt - Step (s).
 * @returns The next state.
 */
export function droneStep(s: DroneState, limits: DroneLimits, dt: number): DroneState {
  if (s.mode === 'landed') return s;
  const battery = Math.max(0, s.battery - limits.drainPerSecond * dt);
  const here: Vec3 = [s.x, s.y, s.z];
  if (!s.target) return { ...s, battery, mode: 'hover' };
  const speed = s.mode === 'takeoff' || s.mode === 'landing' ? limits.climbSpeed : limits.maxSpeed;
  const { p, arrived } = approach(here, s.target, speed, dt);
  const yaw = s.mode === 'moving' && !arrived ? Math.atan2(s.target[1] - s.y, s.target[0] - s.x) : s.yaw;
  if (!arrived) return { ...s, x: p[0], y: p[1], z: p[2], yaw, battery };
  if (s.mode === 'landing') return { ...s, x: p[0], y: p[1], z: p[2], battery, mode: 'landed', target: null };
  return { ...s, x: p[0], y: p[1], z: p[2], yaw, battery, mode: 'hover', target: null };
}

/**
 * @description Where the drone REALLY went when its autopilot flew its believed pose from `before` to
 * `after`. The autopilot closes its loop on its own estimate, so the belief lands exactly on the target
 * and the truth is what deviates: the believed body-frame displacement is the true one scaled by
 * (1 + along) plus the sideways and vertical biases, and the believed heading gains `yawRadPerM` per
 * metre on the true heading. Inverting that (two fixed-point passes; the biases are small) gives the
 * true displacement, rotated into the world by the TRUE heading.
 * @param truth - The true pose before the move.
 * @param before - The believed pose before the move.
 * @param after - The believed pose after the move.
 * @param odo - The odometry model; `null` keeps truth and belief identical.
 * @returns The true pose after the move.
 */
export function propagateTruth(truth: Pose3Yaw, before: Pose3Yaw, after: Pose3Yaw, odo: OdometryModel | null): Pose3Yaw {
  const dyaw = after.yaw - before.yaw;
  const d: Vec3 = [after.x - before.x, after.y - before.y, after.z - before.z];
  if (!odo || norm(d) < 1e-12) return { x: truth.x + d[0], y: truth.y + d[1], z: truth.z + d[2], yaw: truth.yaw + dyaw };
  const c = Math.cos(before.yaw); const s = Math.sin(before.yaw);
  const b: Vec3 = [c * d[0] + s * d[1], -s * d[0] + c * d[1], d[2]];
  const k = 1 + odo.alongPerM;
  let t: Vec3 = [b[0] / k, b[1] / k, b[2] / k];
  for (let pass = 0; pass < 2; pass += 1) {
    const h = Math.hypot(t[0], t[1]); const n = norm(t);
    t = [b[0] / k, (b[1] - odo.crossPerM * h) / k, (b[2] - odo.upPerM * n) / k];
  }
  const tc = Math.cos(truth.yaw); const ts = Math.sin(truth.yaw);
  return { x: truth.x + tc * t[0] - ts * t[1], y: truth.y + ts * t[0] + tc * t[1], z: truth.z + t[2], yaw: truth.yaw + dyaw - odo.yawRadPerM * norm(t) };
}
