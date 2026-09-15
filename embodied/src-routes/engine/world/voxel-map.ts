/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the machine's world as a 3-D occupancy map:
 *                     |                             | every voxel unknown, free or occupied, at 5 cm over the room.
 *                     |                             | A sensor ray carves free space along its length (Amanatides–
 *                     |                             | Woo traversal) and marks the voxel it stopped in occupied; a
 *                     |                             | ray that saw nothing carves out to its range. Unknown is never
 *                     |                             | assumed free: the navigation grid, the arm keep-out and the
 *                     |                             | drone fence all treat it as blocked. Nothing here reads the
 *                     |                             | ground truth; only rays write to it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Registration anchors: the exact first hit point per occupied voxel (`anchors`, `anchorCount`, `nearestAnchor`), dropped when the voxel is carved free; marked boxes and panels carry no anchor because nothing sensed them.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Anchors carry the struck face normal (`MapAnchor`); `integrateRay` takes the hit normal.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Flight grid: occupied columns in the band inflate by the body clearance (15 cm) and cells beside unknown air at the altitude (10 cm) are not flyable; `unknownGrid` can dilate so frontiers are still found from the inset flyable set.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | A hit is nudged into its solid along the FACE NORMAL (the ray direction only when no normal is known): along the ray, a grazing top-face hit near an edge lands in the air column beside the solid and grows a phantom column that inflates into the aisle.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | `integrateSweeps`: several sensors read at one moment count as one scan.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | A 2-D index of vertical-face anchors (`nearestWallAnchor`) so planar registration matches a wall at any height.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | `topUnknownGrid`: the columns a downward camera has not yet seen.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | The height map takes a hit as a TOP only when the struck face points up: a depth camera looking obliquely at a cabinet side no longer writes a phantom top (which the ranger altitude hold then believed).
 * 10 | maintainer@emeraldcoastsystemsgroup.com   | `topSeen` per column: a downward return above the surface cap (a fridge top) still counts as seen, so the tops frontier stops pointing at the fridge forever.
 * 11 | maintainer@emeraldcoastsystemsgroup.com   | Tops come from downward rays again (a small object is found through its sides); the altitude hold is what guards against a partial top, not the height map.
 * 12 | maintainer@emeraldcoastsystemsgroup.com   | `topWithClearance`: a top counts only with known free air directly above it.
 * 13 | maintainer@emeraldcoastsystemsgroup.com   | The "air voxel a ray stopped in" is found by stepping 2 mm OUT of the struck face, not by flooring the hit point: a face on a voxel boundary floored into the solid and marked a voxel INSIDE walls and counter fronts free — the source of phantom tops with "clearance".
 * 14 | maintainer@emeraldcoastsystemsgroup.com   | flightGrid takes a separate vertical clearance: a quad is wide and flat, so the band of layers it must keep clear is its height plus the margin, not its half-width (B18).
 */

import type { LidarSweep } from '../sense/raycast';
import type { Vec3 } from '../math/vec';
import type { Grid } from './occupancy-grid';

/** @description Voxel states. */
export const UNKNOWN = 0;
export const FREE = 1;
export const OCCUPIED = 2;
/** @description Hits above this height never count toward the height map (ceilings, upper walls). */
export const SURFACE_Z_CAP = 1.6;

/** @description A registration anchor: the exact surface point that first occupied a voxel, and the outward normal of the face it lies on. */
export interface MapAnchor {
  p: Vec3;
  n: Vec3;
}

/** @description Room bounds the map covers. */
export interface MapBounds {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
}

/** @description Summary counts. */
export interface MapStats {
  voxels: number;
  free: number;
  occupied: number;
  unknown: number;
  knownFraction: number;
  scans: number;
}

/** @description The occupancy map. */
export class VoxelMap {
  readonly res: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly cells: Uint8Array;
  /**
   * Continuous height map: per column, the highest hit at or below {@link SURFACE_Z_CAP} — the
   * 2.5-D view a 2 cm plate survives in when a 5 cm voxel cannot resolve it. −Infinity = no hit.
   */
  readonly topZ: Float32Array;
  /** The exact hit point that first made each occupied voxel occupied — the reference scan-to-map registration matches against. Keyed by voxel index. */
  readonly anchors = new Map<number, MapAnchor>();
  /** Per column: has any downward-looking return landed here at all (even above the surface cap)? A downward camera has "seen" the fridge top even though it is no work surface. */
  readonly topSeen: Uint8Array;
  scans = 0;
  /** Bumped on every write, so derived grids can cache. */
  version = 0;

  constructor(readonly bounds: MapBounds, res = 0.05) {
    this.res = res;
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / res);
    this.ny = Math.ceil((bounds.maxY - bounds.minY) / res);
    this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / res);
    this.cells = new Uint8Array(this.nx * this.ny * this.nz);
    this.topZ = new Float32Array(this.nx * this.ny).fill(Number.NEGATIVE_INFINITY);
    this.topSeen = new Uint8Array(this.nx * this.ny);
  }

  /** @description A deep copy. */
  clone(): VoxelMap {
    const m = new VoxelMap(this.bounds, this.res);
    m.cells.set(this.cells);
    m.topZ.set(this.topZ);
    m.topSeen.set(this.topSeen);
    for (const [k, v] of this.anchors) m.anchors.set(k, v);
    m.scans = this.scans;
    m.version = this.version;
    return m;
  }

  /** @description Column index of a world point, or −1 outside the map. */
  column(x: number, y: number): number {
    const i = Math.floor((x - this.bounds.minX) / this.res); const j = Math.floor((y - this.bounds.minY) / this.res);
    return i >= 0 && j >= 0 && i < this.nx && j < this.ny ? j * this.nx + i : -1;
  }

  /** @description Flat index of a voxel. */
  index(i: number, j: number, k: number): number { return (k * this.ny + j) * this.nx + i; }

  /** @description Is a voxel index inside the map? */
  inside(i: number, j: number, k: number): boolean { return i >= 0 && j >= 0 && k >= 0 && i < this.nx && j < this.ny && k < this.nz; }

  /** @description Voxel indices of a world point (may be outside). */
  toCell(p: Vec3): [number, number, number] {
    return [Math.floor((p[0] - this.bounds.minX) / this.res), Math.floor((p[1] - this.bounds.minY) / this.res), Math.floor((p[2] - this.bounds.minZ) / this.res)];
  }

  /** @description World centre of a voxel. */
  /** @description The z at the centre of the voxel layer containing `z` — where a single scan plane should fly. */
  voxelCentreZ(z: number): number {
    return this.bounds.minZ + (Math.floor((z - this.bounds.minZ) / this.res) + 0.5) * this.res;
  }

  toWorld(i: number, j: number, k: number): Vec3 {
    return [this.bounds.minX + (i + 0.5) * this.res, this.bounds.minY + (j + 0.5) * this.res, this.bounds.minZ + (k + 0.5) * this.res];
  }

  /** @description State at a world point; points outside the map read as OCCUPIED (the walls). */
  stateAt(p: Vec3): number {
    const [i, j, k] = this.toCell(p);
    if (!this.inside(i, j, k)) return OCCUPIED;
    return this.cells[this.index(i, j, k)];
  }

  private set(i: number, j: number, k: number, state: number): void {
    if (!this.inside(i, j, k)) return;
    const idx = this.index(i, j, k);
    if (this.cells[idx] !== state) { if (this.cells[idx] === OCCUPIED) this.anchors.delete(idx); this.cells[idx] = state; this.version += 1; }
  }

  /** @description How many registration anchors the map holds (one per sensed occupied voxel). */
  get anchorCount(): number { return this.anchors.size; }

  private wallIndex: { version: number; cells: Map<number, MapAnchor[]> } | null = null;

  /** @description Anchors on vertical faces, bucketed by column — a wall is the same wall at any height, which is what a single scan plane needs. */
  private wallAnchors(): Map<number, MapAnchor[]> {
    if (this.wallIndex && this.wallIndex.version === this.version) return this.wallIndex.cells;
    const cells = new Map<number, MapAnchor[]>();
    for (const a of this.anchors.values()) {
      if (Math.abs(a.n[2]) > 0.5) continue;
      const col = this.column(a.p[0], a.p[1]);
      if (col < 0) continue;
      const list = cells.get(col); if (list) list.push(a); else cells.set(col, [a]);
    }
    this.wallIndex = { version: this.version, cells };
    return cells;
  }

  /**
   * @description The nearest vertical-face anchor to a point IN THE PLANE, ignoring height — for a ring that
   * only sees its own layer, the walls it sees are the walls every other sweep saw.
   * @param p - The query point (its z is ignored).
   * @param radius - The horizontal search radius in metres.
   * @returns The anchor, or null.
   */
  nearestWallAnchor(p: Vec3, radius: number): MapAnchor | null {
    const walls = this.wallAnchors();
    const i0 = Math.floor((p[0] - this.bounds.minX) / this.res); const j0 = Math.floor((p[1] - this.bounds.minY) / this.res);
    const r = Math.ceil(radius / this.res);
    let best: MapAnchor | null = null; let bestD = radius * radius;
    for (let j = j0 - r; j <= j0 + r; j += 1) for (let i = i0 - r; i <= i0 + r; i += 1) {
      if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
      const list = walls.get(j * this.nx + i); if (!list) continue;
      for (const a of list) { const dd = (a.p[0] - p[0]) ** 2 + (a.p[1] - p[1]) ** 2; if (dd < bestD) { bestD = dd; best = a; } }
    }
    return best;
  }

  /**
   * @description The nearest anchor to a point within a radius, searched over the voxel neighbourhood
   * the radius spans. Anchors are exact surface points, so matching to them carries no grid bias.
   * @param p - The query point.
   * @param radius - The search radius in metres.
   * @returns The anchor point, or null when none lies within the radius.
   */
  nearestAnchor(p: Vec3, radius: number): MapAnchor | null {
    const [i0, j0, k0] = this.toCell(p);
    const r = Math.ceil(radius / this.res);
    let best: MapAnchor | null = null; let bestD = radius * radius;
    for (let k = k0 - r; k <= k0 + r; k += 1) for (let j = j0 - r; j <= j0 + r; j += 1) for (let i = i0 - r; i <= i0 + r; i += 1) {
      if (!this.inside(i, j, k)) continue;
      const a = this.anchors.get(this.index(i, j, k));
      if (!a) continue;
      const dd = (a.p[0] - p[0]) ** 2 + (a.p[1] - p[1]) ** 2 + (a.p[2] - p[2]) ** 2;
      if (dd < bestD) { bestD = dd; best = a; }
    }
    return best;
  }

  /**
   * @description Integrate one ray: carve FREE from the origin to the end point, and mark the end
   * voxel OCCUPIED when the ray hit something. Voxel traversal is exact (Amanatides–Woo).
   * @param origin - Ray start.
   * @param end - Where the ray stopped (the hit, or the max-range point).
   * @param hit - Whether `end` is a surface.
   */
  integrateRay(origin: Vec3, end: Vec3, hit: boolean, normal?: Vec3): void {
    const [ci, cj, ck] = this.toCell(origin);
    const [ei, ej, ek] = this.toCell(end);
    const dx = end[0] - origin[0]; const dy = end[1] - origin[1]; const dz = end[2] - origin[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) { if (hit) this.set(ei, ej, ek, OCCUPIED); return; }
    let i = ci; let j = cj; let k = ck;
    const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0; const stepJ = dy > 0 ? 1 : dy < 0 ? -1 : 0; const stepK = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const bound = (c: number, o: number, d: number, min: number, step: number): number => (step === 0 ? Number.POSITIVE_INFINITY : ((min + (c + (step > 0 ? 1 : 0)) * this.res) - o) / d);
    let tMaxX = bound(i, origin[0], dx, this.bounds.minX, stepI); let tMaxY = bound(j, origin[1], dy, this.bounds.minY, stepJ); let tMaxZ = bound(k, origin[2], dz, this.bounds.minZ, stepK);
    const tDeltaX = stepI ? Math.abs(this.res / dx) : Number.POSITIVE_INFINITY; const tDeltaY = stepJ ? Math.abs(this.res / dy) : Number.POSITIVE_INFINITY; const tDeltaZ = stepK ? Math.abs(this.res / dz) : Number.POSITIVE_INFINITY;
    let guard = 0;
    while (!(i === ei && j === ej && k === ek) && guard < 4000) {
      if (this.inside(i, j, k)) { const idx = this.index(i, j, k); if (this.cells[idx] !== FREE) { if (this.cells[idx] === OCCUPIED) this.anchors.delete(idx); this.cells[idx] = FREE; this.version += 1; } }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) { i += stepI; tMaxX += tDeltaX; } else if (tMaxY < tMaxZ) { j += stepJ; tMaxY += tDeltaY; } else { k += stepK; tMaxZ += tDeltaZ; }
      guard += 1;
      if (tMaxX > 1 && tMaxY > 1 && tMaxZ > 1 && !(i === ei && j === ej && k === ek)) break;
    }
    if (hit) {
      // A hit lies exactly on a face; step 2 mm along the ray so it is recorded INSIDE the solid it
      // struck, not in the air column in front of it (which would paint phantom walls of "objects").
      // Step INTO the solid along the face normal when the hit carries one; along the ray otherwise. A grazing hit
      // on a counter's top near its front edge, nudged along the ray, lands in the air column in front of the
      // counter and grows a phantom column there that inflates into the rover's aisle.
      const into: Vec3 = normal
        ? [end[0] - normal[0] * 0.002, end[1] - normal[1] * 0.002, end[2] - normal[2] * 0.002]
        : [end[0] + (dx / len) * 0.002, end[1] + (dy / len) * 0.002, end[2] + (dz / len) * 0.002];
      const [hi, hj, hk] = this.toCell(into);
      // The air touching the face was traversed and is known free — but the hit point lies ON the face, and a
      // face on a voxel boundary (a wall at x = 5.00, a counter front at y = 3.40) floors into the SOLID's cell.
      // Step 2 mm OUT of the solid (along the normal, else back along the ray) to name the air voxel.
      const air: Vec3 = normal
        ? [end[0] + normal[0] * 0.002, end[1] + normal[1] * 0.002, end[2] + normal[2] * 0.002]
        : [end[0] - (dx / len) * 0.002, end[1] - (dy / len) * 0.002, end[2] - (dz / len) * 0.002];
      const [ai, aj, ak] = this.toCell(air);
      if (!(hi === ai && hj === aj && hk === ak) && this.inside(ai, aj, ak) && this.cells[this.index(ai, aj, ak)] !== OCCUPIED) this.set(ai, aj, ak, FREE);
      this.set(hi, hj, hk, OCCUPIED);
      if (normal && this.inside(hi, hj, hk)) { const ai = this.index(hi, hj, hk); if (!this.anchors.has(ai)) this.anchors.set(ai, { p: [end[0], end[1], end[2]], n: normal }); }
      // A top is a face whose normal points up. With a normal in hand that is the test; without one, only a ray
      // travelling downward can be reading a top face (a depth camera's oblique ray on a cabinet SIDE is not a top).
      const col = this.column(into[0], into[1]);
      // A downward ray reading a side at height z still says the column is occupied up to z — a small object seen
      // obliquely is found through its sides. The altitude hold gates against a partial top, so this is safe again.
      const isTop = dz / len < -0.15;
      if (isTop && col >= 0) this.topSeen[col] = 1;
      if (isTop && col >= 0 && into[2] <= SURFACE_Z_CAP && into[2] > this.topZ[col]) { this.topZ[col] = into[2]; this.version += 1; }
    } else this.set(ei, ej, ek, FREE);
  }

  /** @description Integrate a whole sweep and count it as one scan. */
  integrateSweep(sweep: LidarSweep): void {
    this.integrateSweeps([sweep]);
  }

  /** @description Integrate the sweeps of several sensors taken at one moment (a ring, a depth camera, a ranger) as ONE scan. */
  integrateSweeps(sweeps: readonly LidarSweep[]): void {
    for (const sweep of sweeps) {
      for (const h of sweep.hits) this.integrateRay(sweep.origin, h.point, true, h.normal);
      for (const m of sweep.misses) this.integrateRay(sweep.origin, m, false);
    }
    this.scans += 1;
    this.version += 1;
  }

  /**
   * @description Mark every voxel inside a box FREE and drop the height map over its footprint
   * to `restZ` (an object the gripper lifted away leaves the surface under it).
   */
  clearBox(min: Vec3, max: Vec3, restZ: number): void {
    const [i0, j0, k0] = this.toCell(min); const [i1, j1, k1] = this.toCell(max);
    for (let k = k0; k <= k1; k += 1) for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) this.set(i, j, k, FREE);
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) if (i >= 0 && j >= 0 && i < this.nx && j < this.ny) this.topZ[j * this.nx + i] = Math.min(this.topZ[j * this.nx + i], restZ);
    this.version += 1;
  }

  /** @description Mark every voxel inside a box OCCUPIED and raise the height map over its footprint to its top (something the machine itself put there or moved). */
  markBox(min: Vec3, max: Vec3): void {
    const [i0, j0, k0] = this.toCell(min); const [i1, j1, k1] = this.toCell([max[0] - 1e-6, max[1] - 1e-6, max[2] - 1e-6]);
    for (let k = k0; k <= k1; k += 1) for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) this.set(i, j, k, OCCUPIED);
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) if (i >= 0 && j >= 0 && i < this.nx && j < this.ny && max[2] <= SURFACE_Z_CAP) this.topZ[j * this.nx + i] = Math.max(this.topZ[j * this.nx + i], max[2] - 0.002);
    this.version += 1;
  }

  /**
   * @description Set every voxel whose centre lies inside an upright rectangular panel (a door):
   * `along` from the hinge in direction `dir` within [0, width], `across` along `normal` within
   * [0, thickness], height from the floor. Exact to half a voxel, unlike a slice's bounding box.
   */
  markPanel(hinge: [number, number], dir: [number, number], normal: [number, number], width: number, thickness: number, height: number, state: number): void {
    const corners = [[0, 0], [width, 0], [0, thickness], [width, thickness]].map(([a, c]) => [hinge[0] + a * dir[0] + c * normal[0], hinge[1] + a * dir[1] + c * normal[1]]);
    const [i0, j0] = this.toCell([Math.min(...corners.map((p) => p[0])) - this.res, Math.min(...corners.map((p) => p[1])) - this.res, 0]);
    const [i1, j1] = this.toCell([Math.max(...corners.map((p) => p[0])) + this.res, Math.max(...corners.map((p) => p[1])) + this.res, 0]);
    const kTop = Math.min(this.nz - 1, Math.floor((height - this.bounds.minZ) / this.res));
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) {
      if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
      const cx = this.bounds.minX + (i + 0.5) * this.res - hinge[0]; const cy = this.bounds.minY + (j + 0.5) * this.res - hinge[1];
      const along = cx * dir[0] + cy * dir[1]; const across = cx * normal[0] + cy * normal[1];
      if (along < -this.res / 2 || along > width + this.res / 2 || across < -this.res / 2 || across > thickness + this.res / 2) continue;
      for (let k = 0; k <= kTop; k += 1) this.set(i, j, k, state);
    }
    this.version += 1;
  }

  /** @description A grid marking the columns whose voxel at an altitude is UNKNOWN (for frontier search). */
  unknownGrid(alt: number, dilate = 0): Grid {
    const k = Math.min(this.nz - 1, Math.max(0, Math.floor((alt - this.bounds.minZ) / this.res)));
    const raw = new Uint8Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j += 1) for (let i = 0; i < this.nx; i += 1) if (this.cells[this.index(i, j, k)] === UNKNOWN) raw[j * this.nx + i] = 1;
    return { res: this.res, width: this.nx, height: this.ny, originX: this.bounds.minX, originY: this.bounds.minY, cells: dilate > 0 ? this.dilate(raw, Math.ceil(dilate / this.res)) : raw };
  }

  /**
   * @description A column's top only if the air directly above it is KNOWN free — a true top face was hit by a ray
   * that came down through that air. A downward ray that read a cabinet's SIDE leaves unknown or solid above its
   * height and is not a top anything should stand on or hover over.
   * @param col - Column index.
   * @returns The top height, or NaN.
   */
  topWithClearance(col: number): number {
    const z = this.topZ[col];
    if (!Number.isFinite(z)) return Number.NaN;
    const i = col % this.nx; const j = Math.floor(col / this.nx);
    const k = Math.floor((z - this.bounds.minZ) / this.res);
    return k + 1 < this.nz && this.cells[this.index(i, j, k + 1)] === FREE ? z : Number.NaN;
  }

  /** @description Columns whose top has never been read by a downward ray — what a drone with a downward camera still has to fly over. */
  topUnknownGrid(dilate = 0): Grid {
    const raw = new Uint8Array(this.nx * this.ny);
    for (let c = 0; c < raw.length; c += 1) if (!this.topSeen[c]) raw[c] = 1;
    return { res: this.res, width: this.nx, height: this.ny, originX: this.bounds.minX, originY: this.bounds.minY, cells: dilate > 0 ? this.dilate(raw, Math.ceil(dilate / this.res)) : raw };
  }

  /** @description Grow every marked cell by a disc of `r` cells (Euclidean). */
  private dilate(raw: Uint8Array, r: number): Uint8Array {
    const cells = new Uint8Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j += 1) for (let i = 0; i < this.nx; i += 1) {
      if (!raw[j * this.nx + i]) continue;
      for (let dj = -r; dj <= r; dj += 1) for (let di = -r; di <= r; di += 1) {
        if (di * di + dj * dj > r * r) continue;
        const ii = i + di; const jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < this.nx && jj < this.ny) cells[jj * this.nx + ii] = 1;
      }
    }
    return cells;
  }

  /** @description Counts. */
  stats(): MapStats {
    let free = 0; let occupied = 0;
    for (let n = 0; n < this.cells.length; n += 1) { const v = this.cells[n]; if (v === FREE) free += 1; else if (v === OCCUPIED) occupied += 1; }
    const unknown = this.cells.length - free - occupied;
    return { voxels: this.cells.length, free, occupied, unknown, knownFraction: (free + occupied) / this.cells.length, scans: this.scans };
  }

  /** @description Every occupied voxel as [i, j, k] triples (for drawing). */
  occupiedList(): number[][] {
    const out: number[][] = [];
    for (let k = 0; k < this.nz; k += 1) for (let j = 0; j < this.ny; j += 1) for (let i = 0; i < this.nx; i += 1) if (this.cells[this.index(i, j, k)] === OCCUPIED) out.push([i, j, k]);
    return out;
  }

  /**
   * @description The 2-D navigation grid for the base: a column is blocked when any voxel in the
   * machine's height band is OCCUPIED, or when too little of the band is known free; blocked
   * columns are inflated by the base half-width plus a margin. Unknown ground is not driven on.
   * @param zMin - Bottom of the band (above the floor voxel).
   * @param zMax - Top of the band (the machine's height).
   * @param inflate - Inflation radius (m).
   * @param minKnownFraction - How much of the band must be known free.
   * @returns A grid in the same shape the A* planner reads.
   */
  navGrid(zMin = 0.10, zMax = 1.6, inflate = 0.325, minKnownFraction = 0.25): Grid {
    const k0 = Math.max(0, Math.floor((zMin - this.bounds.minZ) / this.res));
    const k1 = Math.min(this.nz - 1, Math.floor((zMax - this.bounds.minZ) / this.res));
    const raw = new Uint8Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j += 1) {
      for (let i = 0; i < this.nx; i += 1) {
        let occ = false; let known = 0;
        for (let k = k0; k <= k1; k += 1) { const v = this.cells[this.index(i, j, k)]; if (v === OCCUPIED) { occ = true; break; } if (v === FREE) known += 1; }
        if (occ || known / (k1 - k0 + 1) < minKnownFraction) raw[j * this.nx + i] = 1;
      }
    }
    const r = Math.ceil(inflate / this.res);
    const cells = new Uint8Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j += 1) for (let i = 0; i < this.nx; i += 1) {
      if (!raw[j * this.nx + i]) continue;
      for (let dj = -r; dj <= r; dj += 1) for (let di = -r; di <= r; di += 1) {
        if (di * di + dj * dj > r * r) continue;
        const ii = i + di; const jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < this.nx && jj < this.ny) cells[jj * this.nx + ii] = 1;
      }
    }
    return { res: this.res, width: this.nx, height: this.ny, originX: this.bounds.minX, originY: this.bounds.minY, cells };
  }

  /**
   * @description The drone's flight layer at an altitude: a cell is flyable when the voxel at the
   * altitude is known free and nothing occupied lies within `clearance` above or below it.
   * @param alt - Flight altitude.
   * @param clearance - Vertical clearance each way.
   * @returns A grid (1 = not flyable).
   */
  /**
   * @description Where the drone may fly at an altitude: the cell is known free at the altitude, nothing
   * occupied within `clearance` vertically in any column within `clearance` horizontally (the body plus
   * a margin for drift), and nothing UNKNOWN at the altitude within `knownRing` — the drone does not
   * pass beside air it has never seen.
   */
  flightGrid(alt: number, clearance = 0.15, knownRing = 0.10, clearanceZ = clearance): Grid {
    const kAlt = Math.min(this.nz - 1, Math.max(0, Math.floor((alt - this.bounds.minZ) / this.res)));
    const k0 = Math.max(0, Math.floor((alt - clearanceZ - this.bounds.minZ) / this.res));
    const k1 = Math.min(this.nz - 1, Math.floor((alt + clearanceZ - this.bounds.minZ) / this.res));
    const occ = new Uint8Array(this.nx * this.ny); const unk = new Uint8Array(this.nx * this.ny); const notFree = new Uint8Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j += 1) for (let i = 0; i < this.nx; i += 1) {
      const at = this.cells[this.index(i, j, kAlt)];
      if (at !== FREE) notFree[j * this.nx + i] = 1;
      if (at === UNKNOWN) unk[j * this.nx + i] = 1;
      for (let k = k0; k <= k1; k += 1) if (this.cells[this.index(i, j, k)] === OCCUPIED) { occ[j * this.nx + i] = 1; break; }
    }
    const occWide = this.dilate(occ, Math.ceil(clearance / this.res));
    const unkNear = this.dilate(unk, Math.ceil(knownRing / this.res));
    const cells = new Uint8Array(this.nx * this.ny);
    for (let c = 0; c < cells.length; c += 1) if (notFree[c] || occWide[c] || unkNear[c]) cells[c] = 1;
    return { res: this.res, width: this.nx, height: this.ny, originX: this.bounds.minX, originY: this.bounds.minY, cells };
  }
}
