/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the 2-D navigation grid: obstacle footprints
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | lineClear/simplifyPath gain a supercover mode (every cell the segment crosses) for flight legs: the physics lane caught a simplified flight leg clipping a cell corner Bresenham had skipped, which the point-by-point guard then refused. The rover's routes keep Bresenham.
 *                     |                             | rasterised at 5 cm and inflated by the base's half-width plus a
 *                     |                             | margin, A* with octile heuristic and a fully deterministic
 *                     |                             | tie-break (f, then h, then insertion order), and a line-of-
 *                     |                             | sight simplifier so the base drives a few straight legs rather
 *                     |                             | than a staircase of cells.
 */

import type { Box3 } from '../drone/quad-model';

/** @description The grid. `cells[y*width + x]` is 1 when blocked. */
export interface Grid {
  res: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  cells: Uint8Array;
}

/** @description A planar point. */
export interface Point2 {
  x: number;
  y: number;
}

/**
 * @description Rasterise a room and its obstacles. Every obstacle footprint is inflated so the
 * base's centre may occupy any free cell; the room walls are inflated the same way.
 * @param room - Room bounds.
 * @param obstacles - Solids (their XY footprint is what matters).
 * @param inflate - Inflation radius (m) — the hardware design's base half-width 0.275 + 0.05.
 * @param res - Cell size (m).
 * @returns The grid.
 */
export function buildGrid(room: { minX: number; maxX: number; minY: number; maxY: number }, obstacles: readonly Box3[], inflate = 0.325, res = 0.05): Grid {
  const width = Math.ceil((room.maxX - room.minX) / res);
  const height = Math.ceil((room.maxY - room.minY) / res);
  const cells = new Uint8Array(width * height);
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const x = room.minX + (i + 0.5) * res;
      const y = room.minY + (j + 0.5) * res;
      const nearWall = x - room.minX < inflate || room.maxX - x < inflate || y - room.minY < inflate || room.maxY - y < inflate;
      const hit = obstacles.some((b) => x >= b.min[0] - inflate && x <= b.max[0] + inflate && y >= b.min[1] - inflate && y <= b.max[1] + inflate);
      if (nearWall || hit) cells[j * width + i] = 1;
    }
  }
  return { res, width, height, originX: room.minX, originY: room.minY, cells };
}

/** @description World → cell indices (clamped into the grid). */
export function worldToCell(g: Grid, p: Point2): { i: number; j: number } {
  const i = Math.min(g.width - 1, Math.max(0, Math.floor((p.x - g.originX) / g.res)));
  const j = Math.min(g.height - 1, Math.max(0, Math.floor((p.y - g.originY) / g.res)));
  return { i, j };
}

/** @description Cell → world centre. */
export const cellToWorld = (g: Grid, i: number, j: number): Point2 => ({ x: g.originX + (i + 0.5) * g.res, y: g.originY + (j + 0.5) * g.res });

/** @description Is a world point in a free cell? */
export function isFree(g: Grid, p: Point2): boolean {
  if (p.x < g.originX || p.y < g.originY || p.x >= g.originX + g.width * g.res || p.y >= g.originY + g.height * g.res) return false;
  const { i, j } = worldToCell(g, p);
  return g.cells[j * g.width + i] === 0;
}

/**
 * @description True when every cell on the segment is free. Bresenham (one cell per step) for the rover's routes, whose
 * planner threads diagonally between cells; a supercover traversal (every cell the line crosses) for flight legs, whose
 * point-by-point guard refuses a simplified leg that clips the corner of a cell Bresenham skipped.
 */
export function lineClear(g: Grid, a: Point2, b: Point2, supercover = false): boolean {
  if (!supercover) return lineClearBresenham(g, a, b);
  const ax = (a.x - g.originX) / g.res; const ay = (a.y - g.originY) / g.res;
  const bx = (b.x - g.originX) / g.res; const by = (b.y - g.originY) / g.res;
  const end = worldToCell(g, b);
  let i = Math.min(g.width - 1, Math.max(0, Math.floor(ax))); let j = Math.min(g.height - 1, Math.max(0, Math.floor(ay)));
  const dx = bx - ax; const dy = by - ay;
  const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0; const stepJ = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  let tMaxX = stepI === 0 ? Number.POSITIVE_INFINITY : ((i + (stepI > 0 ? 1 : 0)) - ax) / dx;
  let tMaxY = stepJ === 0 ? Number.POSITIVE_INFINITY : ((j + (stepJ > 0 ? 1 : 0)) - ay) / dy;
  const tDeltaX = stepI === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dx); const tDeltaY = stepJ === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dy);
  for (let guard = 0; guard < g.width + g.height + 2; guard += 1) {
    if (i < 0 || j < 0 || i >= g.width || j >= g.height || g.cells[j * g.width + i] !== 0) return false;
    if (i === end.i && j === end.j) return true;
    if (tMaxX < tMaxY) { i += stepI; tMaxX += tDeltaX; } else if (tMaxY < tMaxX) { j += stepJ; tMaxY += tDeltaY; } else {
      // Exactly through a corner (a diagonal step between cell centres): the route planner's own diagonal moves, kept as they are.
      i += stepI; j += stepJ; tMaxX += tDeltaX; tMaxY += tDeltaY;
    }
  }
  return false;
}

function lineClearBresenham(g: Grid, a: Point2, b: Point2): boolean {
  const ca = worldToCell(g, a);
  const cb = worldToCell(g, b);
  let { i: x0, j: y0 } = ca;
  const { i: x1, j: y1 } = cb;
  const dx = Math.abs(x1 - x0); const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (g.cells[y0 * g.width + x0] !== 0) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

/** @description A binary heap ordered by (f, h, seq) — deterministic for equal costs. */
class OpenSet {
  private items: { f: number; h: number; seq: number; idx: number }[] = [];
  private seq = 0;

  push(idx: number, f: number, h: number): void {
    this.items.push({ f, h, seq: this.seq, idx });
    this.seq += 1;
    let k = this.items.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (!this.less(k, parent)) break;
      [this.items[k], this.items[parent]] = [this.items[parent], this.items[k]];
      k = parent;
    }
  }

  pop(): number | undefined {
    if (!this.items.length) return undefined;
    const top = this.items[0];
    const last = this.items.pop() as { idx: number; f: number; h: number; seq: number };
    if (this.items.length) { this.items[0] = last; this.sink(0); }
    return top.idx;
  }

  get size(): number { return this.items.length; }

  private less(a: number, b: number): boolean {
    const A = this.items[a]; const B = this.items[b];
    return A.f < B.f || (A.f === B.f && (A.h < B.h || (A.h === B.h && A.seq < B.seq)));
  }

  private sink(k: number): void {
    for (;;) {
      const l = 2 * k + 1; const r = l + 1;
      let m = k;
      if (l < this.items.length && this.less(l, m)) m = l;
      if (r < this.items.length && this.less(r, m)) m = r;
      if (m === k) return;
      [this.items[k], this.items[m]] = [this.items[m], this.items[k]];
      k = m;
    }
  }
}

const NEIGHBOURS: readonly [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/**
 * @description A* from start to goal over free cells (8-connected; diagonal moves are refused
 * when either orthogonal neighbour is blocked, so the path never cuts a corner).
 * @param g - The grid.
 * @param start - Start point (must be free).
 * @param goal - Goal point (must be free).
 * @returns Cell-centre waypoints from start to goal inclusive, or null when unreachable.
 */
export function planPath(g: Grid, start: Point2, goal: Point2): Point2[] | null {
  if (!isFree(g, start) || !isFree(g, goal)) return null;
  const s = worldToCell(g, start); const t = worldToCell(g, goal);
  const sIdx = s.j * g.width + s.i; const tIdx = t.j * g.width + t.i;
  const gCost = new Float64Array(g.cells.length).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(g.cells.length).fill(-1);
  const closed = new Uint8Array(g.cells.length);
  const heuristic = (idx: number): number => {
    const dx = Math.abs((idx % g.width) - t.i); const dy = Math.abs(Math.floor(idx / g.width) - t.j);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new OpenSet();
  gCost[sIdx] = 0;
  open.push(sIdx, heuristic(sIdx), heuristic(sIdx));
  while (open.size) {
    const cur = open.pop() as number;
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === tIdx) return reconstruct(g, parent, cur, start, goal);
    expand(g, cur, gCost, parent, closed, open, heuristic);
  }
  return null;
}

/** @description Push every admissible neighbour of a cell. */
function expand(g: Grid, cur: number, gCost: Float64Array, parent: Int32Array, closed: Uint8Array, open: OpenSet, heuristic: (i: number) => number): void {
  const ci = cur % g.width; const cj = Math.floor(cur / g.width);
  for (const [di, dj, cost] of NEIGHBOURS) {
    const ni = ci + di; const nj = cj + dj;
    if (ni < 0 || nj < 0 || ni >= g.width || nj >= g.height) continue;
    const nIdx = nj * g.width + ni;
    if (g.cells[nIdx] || closed[nIdx]) continue;
    if (di && dj && (g.cells[cj * g.width + ni] || g.cells[nj * g.width + ci])) continue;
    const tentative = gCost[cur] + cost;
    if (tentative < gCost[nIdx]) {
      gCost[nIdx] = tentative;
      parent[nIdx] = cur;
      const h = heuristic(nIdx);
      open.push(nIdx, tentative + h, h);
    }
  }
}

/** @description Walk parents back to the start, replacing the end cells with the exact points. */
function reconstruct(g: Grid, parent: Int32Array, goalIdx: number, start: Point2, goal: Point2): Point2[] {
  const cells: number[] = [];
  for (let c = goalIdx; c !== -1; c = parent[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => cellToWorld(g, c % g.width, Math.floor(c / g.width)));
  pts[0] = { x: start.x, y: start.y };
  pts[pts.length - 1] = { x: goal.x, y: goal.y };
  return pts;
}

/**
 * @description Greedy line-of-sight simplification: from each kept point, skip to the farthest
 * later point the straight segment reaches without crossing a blocked cell.
 * @param g - The grid.
 * @param path - A cell path.
 * @returns The waypoints the base actually drives.
 */
export function simplifyPath(g: Grid, path: readonly Point2[], supercover = false): Point2[] {
  if (path.length <= 2) return path.slice();
  const out: Point2[] = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !lineClear(g, path[i], path[j], supercover)) j -= 1;
    out.push(path[j]);
    i = j;
  }
  return out;
}
