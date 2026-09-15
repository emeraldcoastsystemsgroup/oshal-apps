/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The corridor a chain lives on: a polyline in a local east /
 *                     |                             | north / up frame with the base at its first point, arc-length
 *                     |                             | parameterised so every drone is one number (metres from the
 *                     |                             | base along the corridor) and a slot is a point on it. The
 *                     |                             | validator refuses a non-finite point, a corridor under two
 *                     |                             | points, a base off the origin, or a zero-length leg.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | BRANCHES (backlog B5): a tree's work points. The path is the
 *                     |                             | trunk from the base to the fork (its last point); each
 *                     |                             | branch is a polyline continuing from the fork to one work
 *                     |                             | point, so every drone on a tree is still one number on one
 *                     |                             | lane (trunk + its branch). Two to four branches, legs of a
 *                     |                             | metre or more from the fork on, every lane inside the
 *                     |                             | corridor limits; each refusal names the point.
 */

import { SpecError } from './spec-error';

/** @description A point in the local frame: x east, y north, z up, metres. */
export interface Pt {
  x: number;
  y: number;
  z: number;
}

/** @description Euclidean distance between two points, metres. */
export function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** @description Total corridor length, metres. */
export function pathLength(pts: Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += distance(pts[i - 1], pts[i]);
  return total;
}

/**
 * @description The point `s` metres along the corridor from the base (clamped to its ends).
 * @param pts - The corridor.
 * @param s - Arc length from the base.
 * @returns The point.
 */
export function pointAt(pts: Pt[], s: number): Pt {
  if (s <= 0) return { ...pts[0] };
  let remaining = s;
  for (let i = 1; i < pts.length; i += 1) {
    const leg = distance(pts[i - 1], pts[i]);
    if (remaining <= leg) {
      const f = leg === 0 ? 0 : remaining / leg;
      const a = pts[i - 1];
      const b = pts[i];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
    }
    remaining -= leg;
  }
  return { ...pts[pts.length - 1] };
}

/** @description The largest corridor the planner accepts, metres. */
export const MAX_PATH_LENGTH_M = 50_000;

/** @description The most points a corridor may carry. */
export const MAX_PATH_POINTS = 64;

/**
 * @description Validate a corridor from untrusted input. The base is the first point and must be the
 * origin — every plan is expressed relative to the ground station.
 * @param input - Candidate points.
 * @returns The typed corridor.
 */
export function validatePath(input: unknown): Pt[] {
  if (!Array.isArray(input) || input.length < 2) throw new SpecError('path', 'path needs at least two points (base and the work point)');
  if (input.length > MAX_PATH_POINTS) throw new SpecError('path', `path may carry at most ${MAX_PATH_POINTS} points`);
  const pts: Pt[] = input.map((raw, i) => readPoint(raw, `path[${i}]`, 'path'));
  if (pts[0].x !== 0 || pts[0].y !== 0) throw new SpecError('path[0]', 'the first path point is the base and must be at x = 0, y = 0');
  for (let i = 1; i < pts.length; i += 1) if (distance(pts[i - 1], pts[i]) < 1) throw new SpecError(`path[${i}]`, 'path legs must be at least one metre');
  if (pathLength(pts) > MAX_PATH_LENGTH_M) throw new SpecError('path', `path is longer than ${MAX_PATH_LENGTH_M} m`);
  return pts;
}

/** One corridor point from untrusted input, refused naming its field. */
function readPoint(raw: unknown, field: string, noun: string): Pt {
  const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pt = { x: Number(p.x), y: Number(p.y), z: Number(p.z ?? 0) };
  if (![pt.x, pt.y, pt.z].every(Number.isFinite)) throw new SpecError(field, `every ${noun} point needs finite x, y (and optional z)`);
  if (Math.abs(pt.x) > MAX_PATH_LENGTH_M || Math.abs(pt.y) > MAX_PATH_LENGTH_M || Math.abs(pt.z) > 1000) throw new SpecError(field, `${noun} point is out of range`);
  return pt;
}

/** @description The fewest and the most branches a tree carries. */
export const BRANCH_LIMITS = { min: 2, max: 4 } as const;

/**
 * @description Validate a tree's branches from untrusted input. Each branch continues from the fork
 * — the trunk's last point, never repeated — to its work point, so trunk + branch is one lane a drone
 * is a single arc length on.
 * @param input - Candidate branches (absent: a single chain).
 * @param trunk - The validated trunk (base → fork).
 * @returns The branches' points after the fork, or [] for a chain.
 */
export function validateBranches(input: unknown, trunk: Pt[]): Pt[][] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new SpecError('branches', 'branches must be a list of polylines, each continuing from the end of path (the fork) to a work point');
  if (input.length < BRANCH_LIMITS.min) throw new SpecError('branches', 'a tree needs at least two branches: with one work point the corridor is the path itself');
  if (input.length > BRANCH_LIMITS.max) throw new SpecError('branches', `a tree may carry at most ${BRANCH_LIMITS.max} branches`);
  return input.map((raw, b) => {
    const field = `branches[${b}]`;
    if (!Array.isArray(raw) || raw.length < 1) throw new SpecError(field, `${field} needs at least one point: the work point it ends at`);
    if (trunk.length + raw.length > MAX_PATH_POINTS) throw new SpecError(field, `the trunk and ${field} together may carry at most ${MAX_PATH_POINTS} points`);
    const pts = raw.map((p, i) => readPoint(p, `${field}[${i}]`, 'branch'));
    const lane = [...trunk, ...pts];
    for (let i = trunk.length; i < lane.length; i += 1) if (distance(lane[i - 1], lane[i]) < 1) throw new SpecError(`${field}[${i - trunk.length}]`, 'branch legs must be at least one metre (the first leg starts at the fork)');
    if (pathLength(lane) > MAX_PATH_LENGTH_M) throw new SpecError(field, `the trunk and ${field} together are longer than ${MAX_PATH_LENGTH_M} m`);
    return pts;
  });
}

/**
 * @description Every lane of a corridor: lane 0 is the trunk, lane i is the trunk continued along branch i.
 * @param trunk - The trunk (the whole corridor for a chain).
 * @param branches - The branches after the fork ([] for a chain).
 * @returns The lanes' polylines.
 */
export function lanePaths(trunk: Pt[], branches: Pt[][]): Pt[][] {
  return [trunk, ...branches.map((b) => [...trunk, ...b])];
}
