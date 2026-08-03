/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the inviscid section solution: a Hess-Smith
 *                     |                             | panel method (constant source strength per panel plus ONE
 *                     |                             | constant vortex strength shared by every panel, closed by the
 *                     |                             | Kutta condition at the trailing edge). The single shared vortex
 *                     |                             | is the whole reason this formulation is stable at 200 panels
 *                     |                             | with cosine spacing: the alternative — a vortex strength per
 *                     |                             | panel — puts a near-singular block in the matrix wherever two
 *                     |                             | panels are short and nearly collinear, which is precisely the
 *                     |                             | leading edge. The panel ordering is normalised INTERNALLY by
 *                     |                             | measuring the signed area rather than trusting the caller to
 *                     |                             | have wound the profile the textbook's way.
 */

import { createChildLogger } from '@/shared/logger';
import type { Point2D, Section2D } from '../../geometry';
import type { SectionLiftLine } from '../model/rotor-types';

const log = createChildLogger({ module: 'features/rotor-design/panel-method' });

/** @description Angle used as the second sample when characterising a lift line, radians. */
const LIFT_LINE_PROBE_RAD = 0.1;

/** @description Panel geometry precomputed once and reused for every angle of attack. */
interface PanelSet {
  /** Panel end nodes, `count + 1` of them; the last repeats the first. */
  nodes: Point2D[];
  /** Panel midpoints — the control points. */
  controls: Point2D[];
  /** Panel lengths. */
  lengths: number[];
  /** `sin θ` of each panel's inclination. */
  sines: number[];
  /** `cos θ` of each panel's inclination. */
  cosines: number[];
  /** Panel count. */
  count: number;
}

/**
 * @description Twice the signed area of a closed polygon (the shoelace sum). Positive means
 * counter-clockwise in the (x, y) plane.
 * @param points - Ring points, closing point NOT repeated.
 * @returns Twice the signed area.
 */
function signedArea2(points: ReadonlyArray<Point2D>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * @description Normalise a profile into the textbook panel ordering — trailing edge, along the
 * LOWER surface to the leading edge, back along the UPPER surface to the trailing edge — and cut
 * it into panels. That ordering is what makes the Kutta condition "first panel and last panel"
 * rather than "find the two panels at the trailing edge", and getting it by measuring the signed
 * area means a caller can hand over either handedness and still get the right sign of lift.
 * @param section - Closed profile, chord along +x, closing point not repeated.
 * @returns Panel geometry.
 * @throws RangeError when the profile has fewer than 4 points or contains a zero-length panel.
 */
function buildPanels(section: Section2D): PanelSet {
  if (section.points.length < 4) {
    throw new RangeError(`A panel solution needs at least 4 outline points, received ${section.points.length}`);
  }
  const ring = section.points.map((point) => ({ ...point }));
  const clockwise = signedArea2(ring) < 0 ? ring : ring.slice().reverse();
  let start = 0;
  for (let i = 1; i < clockwise.length; i += 1) if (clockwise[i].x > clockwise[start].x) start = i;
  const ordered = clockwise.slice(start).concat(clockwise.slice(0, start));
  const nodes = ordered.concat([{ ...ordered[0] }]);
  const count = nodes.length - 1;
  const controls: Point2D[] = [];
  const lengths: number[] = [];
  const sines: number[] = [];
  const cosines: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const dx = nodes[i + 1].x - nodes[i].x;
    const dy = nodes[i + 1].y - nodes[i].y;
    const length = Math.hypot(dx, dy);
    if (length === 0) throw new RangeError(`Panel ${i} has zero length; the profile repeats a point`);
    controls.push({ x: (nodes[i].x + nodes[i + 1].x) / 2, y: (nodes[i].y + nodes[i + 1].y) / 2 });
    lengths.push(length);
    sines.push(dy / length);
    cosines.push(dx / length);
  }
  return { nodes, controls, lengths, sines, cosines, count };
}

/**
 * @description Velocity at control point `i` from a unit-strength constant SOURCE sheet on panel
 * `j`, expressed in panel `j`'s own frame. The vortex result is the same pair rotated 90°, which
 * is why only one of them is derived here.
 * @param panels - Panel geometry.
 * @param i - Control-point index.
 * @param j - Influencing panel index.
 * @returns `{ along, across }` — components along and normal to panel `j`, divided by 2π.
 */
function sourceInfluenceLocal(panels: PanelSet, i: number, j: number): { along: number; across: number } {
  const p = panels.controls[i];
  const a = panels.nodes[j];
  const b = panels.nodes[j + 1];
  if (i === j) return { along: 0, across: 0.5 };
  const r1 = Math.hypot(p.x - a.x, p.y - a.y);
  const r2 = Math.hypot(p.x - b.x, p.y - b.y);
  const cross = (p.x - a.x) * (p.y - b.y) - (p.y - a.y) * (p.x - b.x);
  const dot = (p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y);
  const beta = Math.atan2(cross, dot);
  return { along: Math.log(r1 / r2) / (2 * Math.PI), across: beta / (2 * Math.PI) };
}

/**
 * @description Influence coefficients: normal and tangential velocity at every control point from
 * a unit source on every panel, and from a unit vortex shared by ALL panels.
 * @param panels - Panel geometry.
 * @returns `{ sourceNormal, sourceTangent, vortexNormal, vortexTangent }`.
 */
function buildInfluence(panels: PanelSet): {
  sourceNormal: number[][];
  sourceTangent: number[][];
  vortexNormal: number[];
  vortexTangent: number[];
} {
  const n = panels.count;
  const sourceNormal = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const sourceTangent = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const vortexNormal = new Array<number>(n).fill(0);
  const vortexTangent = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const normal = { x: -panels.sines[i], y: panels.cosines[i] };
    const tangent = { x: panels.cosines[i], y: panels.sines[i] };
    for (let j = 0; j < n; j += 1) {
      const { along, across } = sourceInfluenceLocal(panels, i, j);
      const cj = panels.cosines[j];
      const sj = panels.sines[j];
      const sx = along * cj - across * sj;
      const sy = along * sj + across * cj;
      const vx = across * cj + along * sj;
      const vy = across * sj - along * cj;
      sourceNormal[i][j] = sx * normal.x + sy * normal.y;
      sourceTangent[i][j] = sx * tangent.x + sy * tangent.y;
      vortexNormal[i] += vx * normal.x + vy * normal.y;
      vortexTangent[i] += vx * tangent.x + vy * tangent.y;
    }
  }
  return { sourceNormal, sourceTangent, vortexNormal, vortexTangent };
}

/**
 * @description Solve `M x = b` for several right-hand sides by Gaussian elimination with partial
 * pivoting, sharing one elimination across all of them. Sharing matters: characterising a lift
 * line needs two angles of attack, and the matrix is identical for both.
 * @param matrix - Square coefficient matrix; consumed (copied internally).
 * @param rightSides - One column per right-hand side.
 * @returns One solution vector per right-hand side, in the same order.
 * @throws RangeError when the matrix is singular to working precision.
 */
function solveLinearSystem(matrix: number[][], rightSides: number[][]): number[][] {
  const n = matrix.length;
  const k = rightSides.length;
  const rows = matrix.map((row, i) => row.concat(rightSides.map((side) => side[i])));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    if (Math.abs(rows[pivot][col]) < 1e-14) throw new RangeError(`Panel system is singular at column ${col}`);
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let r = col + 1; r < n; r += 1) {
      const factor = rows[r][col] / rows[col][col];
      if (factor === 0) continue;
      for (let c = col; c < n + k; c += 1) rows[r][c] -= factor * rows[col][c];
    }
  }
  return rightSides.map((_, side) => {
    const x = new Array<number>(n).fill(0);
    for (let r = n - 1; r >= 0; r -= 1) {
      let sum = rows[r][n + side];
      for (let c = r + 1; c < n; c += 1) sum -= rows[r][c] * x[c];
      x[r] = sum / rows[r][r];
    }
    return x;
  });
}

/**
 * @description Assemble the `(N+1) × (N+1)` Hess-Smith system: N flow-tangency rows plus the Kutta
 * row, with the shared vortex strength as the last unknown.
 * @param panels - Panel geometry.
 * @param influence - Influence coefficients from {@link buildInfluence}.
 * @returns The system matrix. The right-hand side depends on the angle of attack and is built
 * separately by {@link kuttaRightSide}.
 */
function assembleSystem(panels: PanelSet, influence: ReturnType<typeof buildInfluence>): number[][] {
  const n = panels.count;
  const matrix = Array.from({ length: n + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) matrix[i][j] = influence.sourceNormal[i][j];
    matrix[i][n] = influence.vortexNormal[i];
  }
  for (let j = 0; j < n; j += 1) {
    matrix[n][j] = influence.sourceTangent[0][j] + influence.sourceTangent[n - 1][j];
  }
  matrix[n][n] = influence.vortexTangent[0] + influence.vortexTangent[n - 1];
  return matrix;
}

/**
 * @description The right-hand side for one angle of attack: minus the free-stream normal component
 * on each panel, and minus the summed free-stream tangential components on the two trailing-edge
 * panels for the Kutta row.
 * @param panels - Panel geometry.
 * @param alphaRad - Angle of attack, radians.
 * @returns The `N+1` right-hand-side entries.
 */
function kuttaRightSide(panels: PanelSet, alphaRad: number): number[] {
  const n = panels.count;
  const ux = Math.cos(alphaRad);
  const uy = Math.sin(alphaRad);
  const side = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i += 1) side[i] = -(ux * -panels.sines[i] + uy * panels.cosines[i]);
  const first = ux * panels.cosines[0] + uy * panels.sines[0];
  const last = ux * panels.cosines[n - 1] + uy * panels.sines[n - 1];
  side[n] = -(first + last);
  return side;
}

/**
 * @description Lift coefficient of a section at one angle of attack, from the inviscid panel
 * solution. `Cl = 2 Γ / (V c)` with `Γ = γ · Σ l`, chord taken as 1 because the profile is
 * normalised — so this is a pure section coefficient, independent of the blade it sits on.
 *
 * There is no viscosity anywhere in this function: it will happily report Cl = 3 at 25°, which no
 * real section reaches. {@link sectionPolar} is what applies stall.
 * @param section - Closed profile, chord along +x, closing point not repeated.
 * @param alphaRad - Angle of attack, radians.
 * @returns Inviscid lift coefficient.
 * @throws RangeError when the profile is degenerate or the system is singular.
 */
export function panelSolveCl(section: Section2D, alphaRad: number): number {
  const panels = buildPanels(section);
  const influence = buildInfluence(panels);
  const matrix = assembleSystem(panels, influence);
  const [solution] = solveLinearSystem(matrix, [kuttaRightSide(panels, alphaRad)]);
  const gamma = solution[panels.count];
  const perimeter = panels.lengths.reduce((sum, length) => sum + length, 0);
  return 2 * gamma * perimeter;
}

/**
 * @description Characterise a section's inviscid lift line with TWO panel solves.
 *
 * The Hess-Smith matrix does not depend on the angle of attack — only the right-hand side does,
 * and it does so through `cos α` and `sin α`. The solution is therefore exactly linear in that
 * pair, so `Cl(α) = A cos α + B sin α` holds for EVERY α once A and B are known. This is the
 * function that makes it affordable to put a panel method inside a BEMT root-find; without it the
 * solver would be running a dense factorisation per element per bisection step.
 * @param section - Closed profile, chord along +x, closing point not repeated.
 * @returns The lift line. See {@link SectionLiftLine}.
 * @throws RangeError when the profile is degenerate or the system is singular.
 */
export function panelLiftLine(section: Section2D): SectionLiftLine {
  const panels = buildPanels(section);
  const influence = buildInfluence(panels);
  const matrix = assembleSystem(panels, influence);
  const solutions = solveLinearSystem(matrix, [
    kuttaRightSide(panels, 0),
    kuttaRightSide(panels, LIFT_LINE_PROBE_RAD),
  ]);
  const perimeter = panels.lengths.reduce((sum, length) => sum + length, 0);
  const clZero = 2 * solutions[0][panels.count] * perimeter;
  const clProbe = 2 * solutions[1][panels.count] * perimeter;
  const cosCoefficient = clZero;
  const sinCoefficient =
    (clProbe - cosCoefficient * Math.cos(LIFT_LINE_PROBE_RAD)) / Math.sin(LIFT_LINE_PROBE_RAD);
  const line: SectionLiftLine = {
    cosCoefficient,
    sinCoefficient,
    zeroLiftAlphaRad: Math.atan2(-cosCoefficient, sinCoefficient),
    liftSlopePerRad: sinCoefficient,
  };
  log.debug({ panels: panels.count, ...line }, 'characterised section inviscid lift line');
  return line;
}

/**
 * @description Evaluate a characterised lift line at an angle of attack. Exact for the inviscid
 * problem — this is not an interpolation of the two probe solves, it is the closed form they
 * determine.
 * @param line - A lift line from {@link panelLiftLine}.
 * @param alphaRad - Angle of attack, radians.
 * @returns Inviscid lift coefficient.
 */
export function liftLineCl(line: SectionLiftLine, alphaRad: number): number {
  return line.cosCoefficient * Math.cos(alphaRad) + line.sinCoefficient * Math.sin(alphaRad);
}
