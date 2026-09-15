/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — scan-to-map registration. A sweep is what the
 *                     |                             | sensor measured in its OWN frame; where the machine believes it was
 *                     |                             | when it measured is a guess that drifts. Registration pulls that
 *                     |                             | guess onto the map the machine has already built: each pass matches
 *                     |                             | the sweep's points to the nearest map anchor (the exact first hit
 *                     |                             | per occupied voxel, with the face normal it struck) and solves the
 *                     |                             | small rotation about z and translation that zero the POINT-TO-PLANE
 *                     |                             | residuals — along a wall only the normal component is information;
 *                     |                             | matching point to point there aliases the tangential slip and
 *                     |                             | dilutes the heading to nothing. Shrinking match radius, 4×4 normal
 *                     |                             | equations, fail-closed on too few matches, a singular system, or
 *                     |                             | a pose that will not settle. Deterministic; no library.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Planar mode for a single scan plane: solve x, y and yaw only (z
 *                     |                             | comes from a ranger), use only matches whose anchor normal is
 *                     |                             | mostly horizontal, and report `unobservable` (no information)
 *                     |                             | separately from `converged: false` (contradiction). Body sweeps
 *                     |                             | carry their sensor origin so several sensors on one drone can be
 *                     |                             | registered together and integrated each from its own origin.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Planar mode matches vertical-face anchors in the plane at any height (a wall seen from the pad is the wall seen at altitude) and measures residuals in the plane.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Convergence accepts a stable millimetre limit cycle (step ≤ 5 mm with residual ≤ 1 cm) as tracking; a contradiction is a pose that keeps moving.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | A match needs normal agreement (query · anchor ≥ 0.7): a floor return beside a wall was being scored against the wall plane and dragged planar registration off by centimetres. Optional per-pass `trace` for diagnosis.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | `PLANAR_REGISTER`: stride 1 and 100 matches for a single ring (with the normal gate the ring alone must carry the match count); floor and top returns are skipped before the lookup in planar mode.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | B14: WIDE_RADII and wideRegister — a lost drone re-sweeps with a 30 cm capture that tightens to the same 3 cm.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Observability (found building the recovery lane): a sweep whose x-y normals span one direction only (one wall face-on) cannot measure a shift along it — that component of the correction is dropped and `observable`/`weakAxisRad` say so (a 32 cm shift along a wall had been called tracking with the error intact). `coverage` (final-pass matches over usable points) is reported, not gated: a true pose in a half-mapped room leaves the unmapped part unmatched too.
 */

import type { Pose3Yaw } from '../drone/quad-model';
import type { LidarSweep, RayHit } from './raycast';
import { OCCUPIED, type VoxelMap } from '../world/voxel-map';

/** @description A sweep expressed in the sensor's body frame: what was measured, independent of where the machine thinks it was. */
export interface BodySweep {
  hits: Float32Array;
  normals: Float32Array;
  n: number;
  names: string[];
  paints: string[];
  misses: Float32Array;
  m: number;
  /** Where the rays left from, in the body frame (a depth camera under the body, a LiDAR on the mast). */
  origin: [number, number, number];
}

/** @description Registration tuning: the match radius per pass, the point stride, and what counts as a solved pose. */
export interface RegisterOptions {
  radii: readonly number[];
  stride: number;
  minMatched: number;
  settleM: number;
  /** `full`: x, y, z, yaw. `planar`: x, y, yaw with z held — for a sensor that sees only its own plane. */
  mode: 'full' | 'planar';
  /** Optional per-pass observer for tests and diagnosis. */
  trace?: (pass: { radius: number; matched: number; residualM: number; stepM: number; yawStepRad: number }) => void;
  /** The least weight (matched face normals squared along the weakest x-y direction, about a count of points seen from that side) that measures a shift along it; below it that component of the correction is not applied. */
  minObservability?: number;
}

/** @description Capture range 15 cm; ten passes tightening to 3 cm; one point in six; at least 300 matches; settled when a pass moves the pose under 2 mm. */
export const DEFAULT_REGISTER: RegisterOptions = { radii: [0.15, 0.15, 0.12, 0.10, 0.08, 0.06, 0.05, 0.04, 0.03, 0.03], stride: 6, minMatched: 300, settleM: 0.002, mode: 'full', minObservability: 40 };

/** @description A single ring is a sparse sensor: every one of its ~450 points is used and 100 wall matches are enough to solve x, y and yaw. */
export const PLANAR_REGISTER: RegisterOptions = { ...DEFAULT_REGISTER, mode: 'planar', stride: 1, minMatched: 100 };

/** @description The recovery capture (B14): a lost belief may be off by up to 30 cm; the passes start twice as wide and tighten to the same 3 cm. */
export const WIDE_RADII: readonly number[] = [0.30, 0.30, 0.25, 0.20, 0.15, 0.12, 0.10, 0.08, 0.06, 0.05, 0.04, 0.03, 0.03];

/** @description A preset widened for recovery. @param base - The set's usual preset. @returns The same rules with the wide capture. */
export const wideRegister = (base: RegisterOptions): RegisterOptions => ({ ...base, radii: WIDE_RADII });

/** @description The outcome of a registration: the corrected pose and how far it moved. */
export interface Registration {
  pose: Pose3Yaw;
  correctionM: number;
  yawCorrectionRad: number;
  matched: number;
  residualM: number;
  iterations: number;
  converged: boolean;
  /** True when the sweep carried no information about the unknowns (too few usable matches, or a singular system) — dead reckoning stands, nothing contradicted it. */
  unobservable: boolean;
  /** The final pass's matches over the sweep's usable points — a statistic for the record, not a gate: in a half-mapped room a true pose leaves the unmapped part unmatched too. */
  coverage: number;
  /** False when the x-y normals span one direction only (one wall face-on): the shift along the weak axis was not measured and is left as dead reckoning; the rest of the correction is applied. */
  observable: boolean;
  /** The unmeasured direction in the world frame (radians from +X), when not observable. */
  weakAxisRad: number | null;
  /** The x-y normal spectrum's smaller eigenvalue over its larger (1 = faces seen evenly in both directions). */
  observabilityRatio: number;
}

/**
 * @description Express a sweep that was cast from a known true pose in the sensor's body frame.
 * @param sweep - Hits and misses in world coordinates, cast from somewhere on the body.
 * @param pose - The body pose the rays were really cast from (the sweep's origin may be offset from it).
 * @returns The same returns as body-frame vectors (normals rotated too), with the body-frame origin.
 */
export function toBodyFrame(sweep: LidarSweep, pose: Pose3Yaw): BodySweep {
  const c = Math.cos(pose.yaw); const s = Math.sin(pose.yaw);
  const into = (out: Float32Array, i: number, p: readonly number[]): void => {
    const dx = p[0] - pose.x; const dy = p[1] - pose.y;
    out[3 * i] = c * dx + s * dy; out[3 * i + 1] = -s * dx + c * dy; out[3 * i + 2] = p[2] - pose.z;
  };
  const hits = new Float32Array(sweep.hits.length * 3);
  const normals = new Float32Array(sweep.hits.length * 3);
  const names: string[] = []; const paints: string[] = [];
  sweep.hits.forEach((h, i) => {
    into(hits, i, h.point); names.push(h.name); paints.push(h.paint);
    normals[3 * i] = c * h.normal[0] + s * h.normal[1]; normals[3 * i + 1] = -s * h.normal[0] + c * h.normal[1]; normals[3 * i + 2] = h.normal[2];
  });
  const misses = new Float32Array(sweep.misses.length * 3);
  sweep.misses.forEach((p, i) => into(misses, i, p));
  const o = new Float32Array(3); into(o, 0, sweep.origin);
  return { hits, normals, n: sweep.hits.length, names, paints, misses, m: sweep.misses.length, origin: [o[0], o[1], o[2]] };
}

/**
 * @description Place a body-frame sweep in the world at a (believed) pose — the sweep the map integrates.
 * @param body - The measured returns.
 * @param pose - Where the machine believes the body was.
 * @returns A world-frame sweep whose origin is the sensor's, not the body's.
 */
export function fromBodyFrame(body: BodySweep, pose: Pose3Yaw): LidarSweep {
  const c = Math.cos(pose.yaw); const s = Math.sin(pose.yaw);
  const place = (bx: number, by: number, bz: number): [number, number, number] => [pose.x + c * bx - s * by, pose.y + s * bx + c * by, pose.z + bz];
  const origin = place(body.origin[0], body.origin[1], body.origin[2]);
  const hits: RayHit[] = [];
  for (let i = 0; i < body.n; i += 1) {
    const point = place(body.hits[3 * i], body.hits[3 * i + 1], body.hits[3 * i + 2]);
    const normal: [number, number, number] = [c * body.normals[3 * i] - s * body.normals[3 * i + 1], s * body.normals[3 * i] + c * body.normals[3 * i + 1], body.normals[3 * i + 2]];
    hits.push({ t: Math.hypot(point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]), point, name: body.names[i], paint: body.paints[i], normal });
  }
  const misses: [number, number, number][] = [];
  for (let i = 0; i < body.m; i += 1) misses.push(place(body.misses[3 * i], body.misses[3 * i + 1], body.misses[3 * i + 2]));
  return { origin, hits, misses };
}

/**
 * @description Join several body sweeps (several sensors on one body) into one point set for registration.
 * The origin of the first is kept; integration should still use each sweep separately.
 * @param parts - Body sweeps in the same body frame.
 * @returns One body sweep.
 */
export function concatBody(parts: readonly BodySweep[]): BodySweep {
  const n = parts.reduce((a, p) => a + p.n, 0); const m = parts.reduce((a, p) => a + p.m, 0);
  const hits = new Float32Array(3 * n); const normals = new Float32Array(3 * n); const misses = new Float32Array(3 * m);
  const names: string[] = []; const paints: string[] = [];
  let hi = 0; let mi = 0;
  for (const p of parts) {
    hits.set(p.hits.subarray(0, 3 * p.n), 3 * hi); normals.set(p.normals.subarray(0, 3 * p.n), 3 * hi); hi += p.n;
    misses.set(p.misses.subarray(0, 3 * p.m), 3 * mi); mi += p.m;
    names.push(...p.names); paints.push(...p.paints);
  }
  return { hits, normals, n, names, paints, misses, m, origin: parts[0]?.origin ?? [0, 0, 0] };
}

/** @description One pass's normal equations for the unknowns (tx, ty, tz, θ) plus the match statistics. */
interface Pass { n: number; usable: number; ata: Float64Array; atb: Float64Array; rms: number }

/**
 * @description One matching pass: project the body points at the pose, match each to its nearest anchor,
 * and accumulate the point-to-plane normal equations. For a match (p, a, n̂): residual r = n̂·(p − a), and a
 * small motion (t, θ about z through the pose) changes p by t + θ·(ẑ × (p − o)), so the row is
 * J = [n̂x, n̂y, n̂z, n̂·(ẑ × (p − o))] with right-hand side −r. In planar mode a match whose anchor normal
 * is mostly vertical carries no information about x, y or yaw and is skipped.
 */
function matchPass(map: VoxelMap, body: BodySweep, pose: Pose3Yaw, radius: number, opts: RegisterOptions): Pass {
  const c = Math.cos(pose.yaw); const s = Math.sin(pose.yaw);
  const ata = new Float64Array(16); const atb = new Float64Array(4);
  let n = 0; let sq = 0; let usable = 0;
  const row = new Float64Array(4);
  for (let i = 0; i < body.n; i += opts.stride) {
    // In the plane only points from vertical faces carry information; a floor or top return is skipped before the lookup.
    if (opts.mode === 'planar' && Math.abs(body.normals[3 * i + 2]) > 0.5) continue;
    usable += 1;
    const bx = body.hits[3 * i]; const by = body.hits[3 * i + 1]; const bz = body.hits[3 * i + 2];
    const px = pose.x + c * bx - s * by; const py = pose.y + s * bx + c * by; const pz = pose.z + bz;
    const a = opts.mode === 'planar' ? map.nearestWallAnchor([px, py, pz], radius) : map.nearestAnchor([px, py, pz], radius);
    if (!a) continue;
    // The point must be from the same kind of face as the anchor: a floor return 10 cm from a wall is not 10 cm
    // off the wall's plane, it is the floor. Rotate the query normal by the pose yaw and require agreement.
    const qx = c * body.normals[3 * i] - s * body.normals[3 * i + 1]; const qy = s * body.normals[3 * i] + c * body.normals[3 * i + 1]; const qz = body.normals[3 * i + 2];
    if (qx * a.n[0] + qy * a.n[1] + qz * a.n[2] < 0.7) continue;
    const r = opts.mode === 'planar' ? a.n[0] * (px - a.p[0]) + a.n[1] * (py - a.p[1]) : a.n[0] * (px - a.p[0]) + a.n[1] * (py - a.p[1]) + a.n[2] * (pz - a.p[2]);
    row[0] = a.n[0]; row[1] = a.n[1]; row[2] = a.n[2]; row[3] = a.n[0] * -(py - pose.y) + a.n[1] * (px - pose.x);
    for (let u = 0; u < 4; u += 1) { atb[u] += -r * row[u]; for (let v = 0; v < 4; v += 1) ata[4 * u + v] += row[u] * row[v]; }
    n += 1; sq += r * r;
  }
  return { n, usable, ata, atb, rms: n ? Math.sqrt(sq / n) : Number.POSITIVE_INFINITY };
}

/** @description Solve a small dense system by Gaussian elimination with partial pivoting; null when (near) singular — an unobservable direction. */
function solveSmall(a: Float64Array, b: Float64Array, idx: readonly number[]): number[] | null {
  const k = idx.length;
  const m = idx.map((r) => [...idx.map((col) => a[4 * r + col]), b[r]]);
  for (let col = 0; col < k; col += 1) {
    let piv = col;
    for (let r = col + 1; r < k; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-9) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < k; r += 1) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let q = col; q <= k; q += 1) m[r][q] -= f * m[col][q];
    }
  }
  return m.map((rowv, i) => rowv[k] / rowv[i]);
}

/**
 * @description Register a body-frame sweep against the map: starting from the believed pose, match and
 * correct until the pose settles. Fails closed — a contradiction (enough matches, no settling) is
 * `converged: false`; no information (too few usable matches, singular system) is `unobservable`, and the
 * caller keeps dead reckoning for that.
 * @param map - The map built so far (its anchors are the reference).
 * @param body - The measured sweep.
 * @param guess - The believed pose at the time of the sweep (in planar mode its z is held).
 * @param opts - Tuning and mode.
 * @returns The corrected pose and the fit statistics.
 */
export function registerSweep(map: VoxelMap, body: BodySweep, guess: Pose3Yaw, opts: RegisterOptions = DEFAULT_REGISTER): Registration {
  const unknowns = opts.mode === 'planar' ? [0, 1, 3] : [0, 1, 2, 3];
  let pose: Pose3Yaw = { ...guess };
  let matched = 0; let residual = Number.POSITIVE_INFINITY; let iterations = 0; let lastStep = Number.POSITIVE_INFINITY; let singular = false;
  let last: Pass | null = null;
  for (const radius of opts.radii) {
    iterations += 1;
    const pass = matchPass(map, body, pose, radius, opts);
    matched = pass.n; residual = pass.rms; last = pass;
    if (pass.n < opts.minMatched) break;
    const x = solveSmall(pass.ata, pass.atb, unknowns);
    if (!x) { singular = true; break; }
    const d = [0, 0, 0, 0]; unknowns.forEach((u, i) => { d[u] = x[i]; });
    lastStep = Math.hypot(d[0], d[1], d[2]);
    pose = { x: pose.x + d[0], y: pose.y + d[1], z: pose.z + d[2], yaw: pose.yaw + d[3] };
    if (opts.trace) opts.trace({ radius, matched: pass.n, residualM: pass.rms, stepM: lastStep, yawStepRad: d[3] });
  }
  const unobservable = singular || matched < opts.minMatched;
  const coverage = last && last.usable > 0 ? matched / last.usable : 0;
  // Settled, or stable: a few matches flipping between two anchors each pass is a millimetre limit cycle, not a contradiction.
  const settled = lastStep <= opts.settleM || (lastStep <= 0.005 && residual <= 0.01);
  const converged = !unobservable && settled;
  const spectrum = last ? xySpectrum(last.ata) : { ratio: 0, small: 0, weakAxisRad: null };
  const observable = spectrum.small >= (opts.minObservability ?? 40);
  if (converged && !observable && spectrum.weakAxisRad !== null) {
    // Drop the component of the correction along the unmeasured direction: dead reckoning stands there.
    const wx = Math.cos(spectrum.weakAxisRad); const wy = Math.sin(spectrum.weakAxisRad);
    const along = (pose.x - guess.x) * wx + (pose.y - guess.y) * wy;
    pose = { ...pose, x: pose.x - along * wx, y: pose.y - along * wy };
  }
  return {
    pose: converged ? pose : { ...guess },
    correctionM: converged ? Math.hypot(pose.x - guess.x, pose.y - guess.y, pose.z - guess.z) : 0,
    yawCorrectionRad: converged ? pose.yaw - guess.yaw : 0,
    matched, residualM: residual, iterations, converged, unobservable, coverage, observable, weakAxisRad: observable ? null : spectrum.weakAxisRad, observabilityRatio: spectrum.ratio,
  };
}

/** @description The x-y part of the normal spectrum: how evenly the matched face normals span the plane. @returns The eigenvalue ratio (0 = one direction only) and the weak direction. */
function xySpectrum(ata: Float64Array): { ratio: number; small: number; weakAxisRad: number | null } {
  const a = ata[0]; const b = ata[1]; const d = ata[5];
  const tr = a + d; const disc = Math.sqrt(Math.max(0, (a - d) * (a - d) + 4 * b * b));
  const big = (tr + disc) / 2; const small = Math.max(0, (tr - disc) / 2);
  if (big <= 1e-9) return { ratio: 0, small: 0, weakAxisRad: null };
  const vx = Math.abs(b) > 1e-12 ? b : (small - d); const vy = Math.abs(b) > 1e-12 ? small - a : b;
  const weak = Math.abs(vx) + Math.abs(vy) > 1e-12 ? Math.atan2(vy, vx) : (a >= d ? Math.PI / 2 : 0);
  return { ratio: small / big, small, weakAxisRad: weak };
}

/** @description The global search a lost drone runs (B14): how far and how finely to look around the belief, how many points score a pose, what a fix must reach and how clearly it must beat the runner-up. */
export interface RelocalizeOptions { searchM: number; stepM: number; yawSearchRad: number; yawStepRad: number; sample: number; minScore: number; uniqueness: number }
const RELOC_INWARD_M = 0.02;
export const DEFAULT_RELOCALIZE: RelocalizeOptions = { searchM: 0.6, stepM: 0.05, yawSearchRad: 0.35, yawStepRad: 0.035, sample: 300, minScore: 0.5, uniqueness: 0.85 };

/** @description What the global search found: the best pose and its score, the best clearly elsewhere, whether the best stood alone, and the registration refined from it. */
export interface Relocalization { best: { pose: Pose3Yaw; score: number }; second: { pose: Pose3Yaw; score: number } | null; unique: boolean; registration: Registration; accepted: boolean }

/**
 * @description Relocalise a sweep whose belief may be wrong by more than a capture radius: score every pose on a grid
 * around the belief by the fraction of sampled returns that land in an occupied voxel of the map, refine the best by the
 * usual registration, and accept only a fix that scores enough, stands clearly above the best pose elsewhere, refines to a
 * converged and observable registration, and stays inside the search window. A sweep is not a fiducial: an ambiguous
 * room (the same wall spacing twice) is reported as ambiguous, not resolved by luck.
 * @param map - The map. @param body - The sweep in the body frame. @param guess - The belief. @param opts - Registration rules. @param ropts - Search rules.
 * @returns The search outcome.
 */
export function relocalize(map: VoxelMap, body: BodySweep, guess: Pose3Yaw, opts: RegisterOptions = DEFAULT_REGISTER, ropts: RelocalizeOptions = DEFAULT_RELOCALIZE): Relocalization {
  // Score with returns from vertical faces only (floor, ceiling and tops say nothing about x, y or yaw), spread evenly
  // around the body by direction: a dense camera view of one face must not outvote the ring's sparse returns from the
  // walls that actually pin the pose down.
  const bins = 72; const perBin = Math.max(1, Math.ceil(ropts.sample / bins));
  const buckets: number[][] = Array.from({ length: bins }, () => []);
  for (let i = 0; i < body.n; i += 1) {
    if (Math.abs(body.normals[3 * i + 2]) > 0.5) continue;
    const az = Math.atan2(body.hits[3 * i + 1], body.hits[3 * i]);
    const b = Math.min(bins - 1, Math.floor(((az + Math.PI) / (2 * Math.PI)) * bins));
    if (buckets[b].length < perBin) buckets[b].push(i);
  }
  const pts = buckets.flat();
  // A return scores when the point just inside the face it struck (2 cm along the inward normal) lies in an occupied voxel
  // of the map; a point carried outside the map by a wrong pose scores nothing (the map reads its outside as wall).
  const score = (p: Pose3Yaw): number => {
    if (!pts.length) return 0;
    const c = Math.cos(p.yaw); const s = Math.sin(p.yaw); let hit = 0;
    for (const i of pts) {
      const bx = body.hits[3 * i] - RELOC_INWARD_M * body.normals[3 * i]; const by = body.hits[3 * i + 1] - RELOC_INWARD_M * body.normals[3 * i + 1]; const bz = body.hits[3 * i + 2] - RELOC_INWARD_M * body.normals[3 * i + 2];
      const q: [number, number, number] = [p.x + c * bx - s * by, p.y + s * bx + c * by, p.z + bz];
      const [ci, cj, ck] = map.toCell(q);
      if (map.inside(ci, cj, ck) && map.stateAt(q) === OCCUPIED) hit += 1;
    }
    return hit / pts.length;
  };
  const cells: { pose: Pose3Yaw; score: number }[] = [];
  const n = Math.round(ropts.searchM / ropts.stepM); const m = Math.round(ropts.yawSearchRad / ropts.yawStepRad);
  for (let ix = -n; ix <= n; ix += 1) for (let iy = -n; iy <= n; iy += 1) for (let iw = -m; iw <= m; iw += 1) {
    const pose = { x: guess.x + ix * ropts.stepM, y: guess.y + iy * ropts.stepM, z: guess.z, yaw: guess.yaw + iw * ropts.yawStepRad };
    cells.push({ pose, score: score(pose) });
  }
  cells.sort((a, b) => b.score - a.score);
  const best = cells[0];
  const apart = (p: Pose3Yaw): boolean => Math.hypot(p.x - best.pose.x, p.y - best.pose.y) > 2 * ropts.stepM || Math.abs(p.yaw - best.pose.yaw) > 2 * ropts.yawStepRad;
  const second = cells.find((c) => apart(c.pose)) ?? null;
  const unique = best.score >= ropts.minScore && (second === null || second.score < ropts.uniqueness * best.score);
  const registration = registerSweep(map, body, best.pose, opts);
  const moved = Math.hypot(registration.pose.x - guess.x, registration.pose.y - guess.y);
  const accepted = unique && registration.converged && registration.observable && moved <= ropts.searchM + ropts.stepM;
  return { best, second, unique, registration, accepted };
}
