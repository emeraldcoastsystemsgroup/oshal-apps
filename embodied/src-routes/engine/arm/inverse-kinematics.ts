/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — numerical inverse kinematics: damped least
 *                     |                             | squares (Levenberg–Marquardt) over a finite-difference Jacobian,
 *                     |                             | full 6-D error (position + rotation vector), joint limits
 *                     |                             | clamped every step, a fixed seed list, and a reach pre-check
 *                     |                             | that fails fast. No randomness: same target, same seed, same
 *                     |                             | answer, every time.
 */

import { fromPose, multiply, position, rotationInverse, rotationVector, type Mat4 } from '../math/transform';
import { distance, norm, type Pose6 } from '../math/vec';
import { clampToLimits, forwardKinematics, maxReach, shoulderPoint, type ArmSpec } from './arm-model';

/** @description Solver output. `q` is the best configuration found even when `ok` is false. */
export interface IkResult {
  ok: boolean;
  q: number[];
  iterations: number;
  positionError: number;
  orientationError: number;
  reason?: 'out_of_reach' | 'no_convergence';
}

/** @description Solver tunables; the defaults are what the planner uses. */
export interface IkOptions {
  maxIterations?: number;
  positionTolerance?: number;
  orientationTolerance?: number;
  orientationWeight?: number;
  /** Extra seeds tried after the caller's when it does not converge. */
  seeds?: readonly (readonly number[])[];
}

const DEFAULTS: Required<Omit<IkOptions, 'seeds'>> = {
  maxIterations: 150,
  positionTolerance: 1e-4,
  orientationTolerance: 1e-3,
  orientationWeight: 0.25,
};

/** @description Fallback seeds: elbow-up (forearm pointing down, small wrist fold) first, then elbow-down and flipped wrists. */
const FALLBACK_SEEDS: readonly (readonly number[])[] = [
  [0, 1.4, -2.8, 0, -1.2, 0],
  [0, 1.0, -2.4, 0, -1.6, 0],
  [0, 1.1, -2.5, 0, -0.2, 0],
  [0, 1.1, -2.5, 0, 1.4, 0],
  [0, 0.8, -2.0, 0, 0.0, 0],
  [0, 0.9, 2.7, 0, 1.1, -1.6],
  [0, 1.2, 2.8, 0, 0.7, -1.8],
  [0, 0.9, 2.7, 0, -1.1, 1.5],
  [0, 0.6, -1.2, 0, -1.0, 0],
  [0, -0.6, 1.2, 0, 1.0, 0],
  [0, 1.2, -2.0, 0, -2.3, 0],
  [0, 0.3, -0.6, 0, -2.8, 0],
];

/** @description The 6-vector error between target and current tool frames. */
function poseError(target: Mat4, current: Mat4, w: number): number[] {
  const pt = position(target);
  const pc = position(current);
  const rv = rotationVector(multiply(target, rotationInverse(current)));
  return [pt[0] - pc[0], pt[1] - pc[1], pt[2] - pc[2], w * rv[0], w * rv[1], w * rv[2]];
}

/** @description Finite-difference Jacobian of the pose error with respect to each joint. */
function jacobian(spec: ArmSpec, q: number[], target: Mat4, base: number[], w: number): number[][] {
  const h = 1e-6;
  const cols = q.map((_, j) => {
    const qj = q.slice();
    qj[j] += h;
    const e = poseError(target, forwardKinematics(spec, qj).tcp, w);
    // d(error)/dq = (e(q+h) − e(q)) / h ; the solver wants −d(error)/dq = d(pose)/dq.
    return e.map((v, i) => -(v - base[i]) / h);
  });
  return Array.from({ length: 6 }, (_, i) => cols.map((c) => c[i]));
}

/** @description Solve (JᵀJ + λI)·Δ = Jᵀe by Gaussian elimination with partial pivoting. */
function solveDamped(J: number[][], e: number[], lambda: number): number[] {
  const n = J[0].length;
  const A = Array.from({ length: n }, (_, r) => Array.from({ length: n + 1 }, (_, c) => {
    if (c === n) return J.reduce((s, row, k) => s + row[r] * e[k], 0);
    return J.reduce((s, row) => s + row[r] * row[c], 0) + (r === c ? lambda : 0);
  }));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    const p = A[col][col] || 1e-12;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = A[r][col] / p;
      for (let c = col; c <= n; c += 1) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row, r) => row[n] / (row[r] || 1e-12));
}

/** @description One Levenberg–Marquardt descent from a seed. */
function descend(spec: ArmSpec, target: Mat4, seed: readonly number[], o: Required<Omit<IkOptions, 'seeds'>>): IkResult {
  let q = clampToLimits(spec, seed);
  let lambda = 0.01;
  let e = poseError(target, forwardKinematics(spec, q).tcp, o.orientationWeight);
  let cost = norm([e[0], e[1], e[2]]) + norm([e[3], e[4], e[5]]);
  for (let it = 1; it <= o.maxIterations; it += 1) {
    const pErr = norm([e[0], e[1], e[2]]);
    const rErr = norm([e[3], e[4], e[5]]) / o.orientationWeight;
    if (pErr < o.positionTolerance && rErr < o.orientationTolerance) return { ok: true, q, iterations: it - 1, positionError: pErr, orientationError: rErr };
    const J = jacobian(spec, q, target, e, o.orientationWeight);
    const delta = solveDamped(J, e, lambda).map((d) => Math.max(-0.3, Math.min(0.3, d)));
    const candidate = clampToLimits(spec, q.map((v, i) => v + delta[i]));
    const eNew = poseError(target, forwardKinematics(spec, candidate).tcp, o.orientationWeight);
    const costNew = norm([eNew[0], eNew[1], eNew[2]]) + norm([eNew[3], eNew[4], eNew[5]]);
    if (costNew < cost) { q = candidate; e = eNew; cost = costNew; lambda = Math.max(1e-6, lambda * 0.5); } else lambda = Math.min(1e3, lambda * 4);
  }
  const pErr = norm([e[0], e[1], e[2]]);
  const rErr = norm([e[3], e[4], e[5]]) / o.orientationWeight;
  return { ok: false, q, iterations: o.maxIterations, positionError: pErr, orientationError: rErr, reason: 'no_convergence' };
}

/**
 * @description Every distinct converged solution from the caller's seed and the fallback seeds,
 * so a caller can choose among configurations (for example the one clear of obstacles), plus the
 * best failure when none converged. Fails fast beyond the reach envelope.
 * @param spec - The arm.
 * @param target - Desired tool pose (arm base frame), as a Pose6 or a transform.
 * @param seed - Starting configuration.
 * @param opts - Tolerances and extra seeds.
 * @returns Distinct solutions (possibly empty) and the best failure.
 */
export function ikSolutions(spec: ArmSpec, target: Pose6 | Mat4, seed: readonly number[], opts: IkOptions = {}): { solutions: IkResult[]; bestFailure: IkResult | null } {
  const T = Array.isArray(target) ? target : fromPose(target as Pose6);
  const o = { ...DEFAULTS, ...opts };
  const reach = distance(position(T), shoulderPoint(spec));
  if (reach > maxReach(spec) - 1e-6) {
    return { solutions: [], bestFailure: { ok: false, q: clampToLimits(spec, seed), iterations: 0, positionError: reach - maxReach(spec), orientationError: Math.PI, reason: 'out_of_reach' } };
  }
  const solutions: IkResult[] = [];
  let bestFailure: IkResult | null = null;
  for (const s of [seed, ...(opts.seeds ?? []), ...FALLBACK_SEEDS]) {
    const r = descend(spec, T, s, o);
    if (!r.ok) { if (!bestFailure || r.positionError + r.orientationError < bestFailure.positionError + bestFailure.orientationError) bestFailure = r; continue; }
    if (!solutions.some((k) => k.q.every((v, i) => Math.abs(v - r.q[i]) < 1e-3))) solutions.push(r);
  }
  return { solutions, bestFailure };
}

/**
 * @description Solve for joint angles that put the tool centre point at `target`. Fails fast when
 * the target lies beyond the arm's reach envelope; otherwise descends from the caller's seed and
 * then each fixed fallback seed, returning the first converged solution or the best failure.
 * @param spec - The arm.
 * @param target - Desired tool pose (arm base frame), as a Pose6 or a transform.
 * @param seed - Starting configuration (usually the current one, for the nearest solution).
 * @param opts - Tolerances and extra seeds.
 * @returns The result; `ok` false carries a `reason`.
 */
export function solveIk(spec: ArmSpec, target: Pose6 | Mat4, seed: readonly number[], opts: IkOptions = {}): IkResult {
  const T = Array.isArray(target) ? target : fromPose(target as Pose6);
  const o = { ...DEFAULTS, ...opts };
  const reach = distance(position(T), shoulderPoint(spec));
  if (reach > maxReach(spec) - 1e-6) {
    return { ok: false, q: clampToLimits(spec, seed), iterations: 0, positionError: reach - maxReach(spec), orientationError: Math.PI, reason: 'out_of_reach' };
  }
  const seeds = [seed, ...(opts.seeds ?? []), ...FALLBACK_SEEDS];
  let best: IkResult | null = null;
  for (const s of seeds) {
    const r = descend(spec, T, s, o);
    if (r.ok) return r;
    if (!best || r.positionError + r.orientationError < best.positionError + best.orientationError) best = r;
  }
  return best as IkResult;
}
