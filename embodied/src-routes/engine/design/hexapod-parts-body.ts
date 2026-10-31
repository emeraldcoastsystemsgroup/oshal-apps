/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 spider-18: the printed body parts as CAD Studio programs
 *                     |                             | — ONE plate program listed with qty 2 (the hexagon the brief
 *                     |                             | names, six coxa collars on the inner face with the servo case
 *                     |                             | pockets at SPIDER_18's mounts, the Pi bay, head, tail and spring
 *                     |                             | housing bolt patterns, the vents), the Pi bay (a vented frame
 *                     |                             | between the plates holding a Pi 5 and its active cooler on four
 *                     |                             | standoffs), the head (the LiDAR seat on the nose with the scan
 *                     |                             | plane on z = 0) and the tail battery tray. Where the bought parts
 *                     |                             | sit is COMPUTED from their footprints and the six coxa cases
 *                     |                             | (bodyLayout) and reported, not assumed: the 3S pack does not fit
 *                     |                             | between the plates beside a Pi 5 and six coxa servos on a 220 by
 *                     |                             | 140 plate, so it rides in a tail tray on the mid-plane.
 */

import type { CadFeatureProgram } from './airframe';
import { pocketSize } from './arm-parts';
import { HOUSING_BOLT_RADIUS_MM, HOUSING_OD_MM, M25_MM, M3_MM, PLATE_FILL, SPLINE_CLEARANCE_MM, WALL_FILL, WALL_MM, add, boxCm3, cut, cylinderCm3, extrudeXY, hole, polygonAreaMm2, printed, rotatedRect, type HexapodPrintedPart } from './hexapod-parts';
import { LEG_IDS, type CoxaMount, type HexapodLayout, type LegId } from './hexapod-spec';
import type { ServoSpec } from './servos';

/** The Raspberry Pi 5 board (mm): the published board outline and its 58 × 49 mounting pattern. */
export const PI5_BOARD_MM = Object.freeze({ long: 85, wide: 56, holesLong: 58, holesWide: 49 });
/** The LD19-class LiDAR (mm): the published footprint and height; the scan plane height above its base is a CLASS figure — measure the unit before printing the head, the seat follows it. */
export const LIDAR_MM = Object.freeze({ footprint: 38.6, height: 34.8, scanPlaneAboveBase: 24 });
/** The 3S 2200 pack envelope the catalog row names (mm). */
export const PACK_MM = Object.freeze({ long: 105, wide: 34, thick: 24 });
/** The hexagon's end chamfer: the plate's corners pull in this much from the full width at the nose and the stern (mm). */
const NOSE_CHAMFER_MM = 15;

/** @description Where the body's parts sit between the plates (mm, body frame: x forward, y left, z up from the mid-plane) — computed from the footprints, reported in the design document. */
export interface BodyLayout {
  /** The plate's hexagon corners, the brief's 220 × 140. */
  plateOutline: number[][];
  /** The plate's overall extents once the six coxa collars are on it. */
  plateExtentsMm: { x: number; y: number };
  /** The Pi bay: the Pi 5 rotated so its 85 mm side runs across the body, forward of the housing. */
  piBay: { xMm: number; yMm: number; outerX: number; outerY: number; interiorX: number; interiorY: number };
  /** The spring housing's axis (the latched-spring option) on the centreline behind the bay; a vent hole otherwise. */
  housing: { xMm: number; yMm: number };
  /** The head's tab between the plates at the nose; the LiDAR's optical centre is the layout's lidarNoseXMm. */
  headTab: { xMm: number; boltYMm: number };
  /** The tail tray's tab at the stern; the pack's centre. */
  tailTab: { xMm: number; boltYMm: number; packCentreXMm: number };
  /** The wind servo's strap holes (the latched-spring option), lying flat inboard of the rear coxa servos. */
  windServoBoltsMm: number[][];
  /** The coxa servo cases: centre and long-axis angle, each 10 mm along the plate edge from its spline. */
  coxaCases: Record<LegId, { xMm: number; yMm: number; angleRad: number }>;
}

/** @description The case's long axis for a coxa mount: tangential, rearward along the plate edge (the spline at the case's forward end). */
function caseAxis(m: CoxaMount): { ux: number; uy: number } {
  const psi = (m.neutralYawDeg * Math.PI) / 180;
  const tx = -Math.sin(psi); const ty = Math.cos(psi);
  return tx < 0 ? { ux: tx, uy: ty } : { ux: -tx, uy: -ty };
}

/**
 * @description The plate's hexagon: the brief's length and width, the corners pulled in at both ends.
 * @param l - The layout.
 * @returns Six [x, y] corners, counter-clockwise.
 */
export function plateOutline(l: HexapodLayout): number[][] {
  const hx = l.bodyLengthMm / 2; const hy = l.bodyWidthMm / 2; const c = hy - NOSE_CHAMFER_MM;
  return [[hx, c], [0, hy], [-hx, c], [-hx, -c], [0, -hy], [hx, -c]];
}

/**
 * @description The body layout for a hexapod layout and its servo: every position below is derived here once.
 * @param l - The layout. @param s - The coxa servo.
 * @returns The positions.
 */
export function bodyLayout(l: HexapodLayout, s: ServoSpec): BodyLayout {
  const pocket = pocketSize(s, 'z', 'x');
  const collarAlong = pocket[0] + 2 * WALL_MM; const collarAcross = pocket[1] + 2 * WALL_MM;
  const coxaCases = {} as BodyLayout['coxaCases'];
  let minX = -l.bodyLengthMm / 2; let maxX = l.bodyLengthMm / 2; let minY = -l.bodyWidthMm / 2; let maxY = l.bodyWidthMm / 2;
  for (const leg of LEG_IDS) {
    const m = l.coxaMounts[leg]; const a = caseAxis(m);
    const cx = m.xMm + s.splineOffsetMm * a.ux; const cy = m.yMm + s.splineOffsetMm * a.uy;
    coxaCases[leg] = { xMm: Math.round(cx * 10) / 10, yMm: Math.round(cy * 10) / 10, angleRad: Math.atan2(a.uy, a.ux) };
    for (const [px, py] of rotatedRect(cx, cy, collarAlong, collarAcross, coxaCases[leg].angleRad)) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
  }
  const interiorX = PI5_BOARD_MM.wide + 1; const interiorY = PI5_BOARD_MM.long + 1;
  const housingX = -(HOUSING_OD_MM / 2 + 6);
  const bayX = housingX + HOUSING_OD_MM / 2 + 6 + (interiorX + 2 * WALL_MM) / 2 + 1;
  return {
    plateOutline: plateOutline(l),
    plateExtentsMm: { x: Math.round((maxX - minX) * 10) / 10, y: Math.round((maxY - minY) * 10) / 10 },
    piBay: { xMm: Math.round(bayX * 10) / 10, yMm: 0, outerX: interiorX + 2 * WALL_MM, outerY: interiorY + 2 * WALL_MM, interiorX, interiorY },
    housing: { xMm: housingX, yMm: 0 },
    headTab: { xMm: l.bodyLengthMm / 2 - 7, boltYMm: 10 },
    tailTab: { xMm: -l.bodyLengthMm / 2 + 7, boltYMm: 8, packCentreXMm: -l.bodyLengthMm / 2 - 2 - PACK_MM.long / 2 },
    windServoBoltsMm: [[-52, 16], [-52, -16], [-74, 16], [-74, -16]],
    coxaCases,
  };
}

/** @description The share of a rectangle's area outside a convex polygon, by sampling (the ears stand partly off the hexagon). */
function fractionOutside(rect: number[][], polygon: number[][]): number {
  const inside = (x: number, y: number): boolean => {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const [a, b, c] = rect; const n = 12; let out = 0;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const u = (i + 0.5) / n; const v = (j + 0.5) / n;
    const x = a[0] + (b[0] - a[0]) * u + (c[0] - b[0]) * v; const y = a[1] + (b[1] - a[1]) * u + (c[1] - b[1]) * v;
    if (!inside(x, y)) out += 1;
  }
  return out / (n * n);
}

/**
 * @description The body plate: ONE program, printed twice. The hexagon as a sketch-extrude; at each coxa mount a collar on
 * the inner face whose pocket is the coxa servo's case (its spline on the mount, the case lying along the plate edge) —
 * the two collars, one per plate, hold the 35 mm case across the 45 mm gap; the spline hole; the Pi bay standoff bolts
 * and the vent over the cooler; the head and tail tab bolts; the spring housing hole with its three bolts; the wind
 * servo's strap holes; two lightening windows. Mounted collar-to-collar the two copies are the same plate, so the body is
 * the same upside down.
 * @param l - The layout. @param s - The coxa servo. @param b - The body layout.
 * @returns The plate, qty 2.
 */
export function plate(l: HexapodLayout, s: ServoSpec, b: BodyLayout): HexapodPrintedPart {
  const t = l.plateThicknessMm;
  const collarH = (l.plateGapMm - s.bodyMm[2]) / 2;
  const pocket = pocketSize(s, 'z', 'x');
  const outline = b.plateOutline;
  const features: CadFeatureProgram[] = [{ id: 'corners', type: 'fillet', params: { radius: 6, edges: 'vertical' }, label: 'rounded corners' }];
  let earCm3 = 0; let collarCm3 = 0;
  for (const leg of LEG_IDS) {
    const m = l.coxaMounts[leg]; const c = b.coxaCases[leg];
    const collar = rotatedRect(c.xMm, c.yMm, pocket[0] + 2 * WALL_MM, pocket[1] + 2 * WALL_MM, c.angleRad);
    const pock = rotatedRect(c.xMm, c.yMm, pocket[0], pocket[1], c.angleRad);
    features.push(extrudeXY(`collar-${leg}`, collar, 0, t + collarH, 'add', `${leg} coxa collar on the inner face (and the ear where it stands off the hexagon)`));
    features.push(extrudeXY(`pocket-${leg}`, pock, t, collarH + 1, 'cut', `${leg} coxa servo case pocket, ${collarH} mm deep: the other plate's collar takes the other end of the case`));
    features.push(hole(`spline-${leg}`, 'z', [m.xMm, m.yMm, 0], SPLINE_CLEARANCE_MM, `${leg} coxa spline (top plate) / rear boss bushing (bottom plate)`));
    const collarArea = polygonAreaMm2(collar);
    earCm3 += (collarArea * fractionOutside(collar, outline) * t) / 1000;
    collarCm3 += ((collarArea - polygonAreaMm2(pock)) * collarH - (Math.PI * SPLINE_CLEARANCE_MM ** 2 * collarH) / 4) / 1000;
  }
  const bay = b.piBay;
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy], i) => features.push(hole(`bay-${i}`, 'z', [bay.xMm + sx * (bay.outerX / 2 - 3), sy * (bay.outerY / 2 - 3), 0], M3_MM, 'Pi bay standoff bolt')));
  features.push(cut('cooler-vent', [40, 50, t + 2], [bay.xMm, 0, t / 2], 'vent over the Pi 5 active cooler (the same window under it on the other plate)'));
  features.push(hole('head-a', 'z', [b.headTab.xMm, b.headTab.boltYMm, 0], M3_MM, 'head tab bolt'), hole('head-b', 'z', [b.headTab.xMm, -b.headTab.boltYMm, 0], M3_MM, 'head tab bolt'));
  features.push(hole('tail-a', 'z', [b.tailTab.xMm, b.tailTab.boltYMm, 0], M3_MM, 'tail tray tab bolt'), hole('tail-b', 'z', [b.tailTab.xMm, -b.tailTab.boltYMm, 0], M3_MM, 'tail tray tab bolt'));
  features.push(hole('housing', 'z', [b.housing.xMm, b.housing.yMm, 0], HOUSING_OD_MM + 1, 'the spring housing passes through (latched-spring option); a vent otherwise'));
  [90, 210, 330].forEach((deg, i) => features.push(hole(`housing-bolt-${i}`, 'z', [b.housing.xMm + HOUSING_BOLT_RADIUS_MM * Math.cos((deg * Math.PI) / 180), b.housing.yMm + HOUSING_BOLT_RADIUS_MM * Math.sin((deg * Math.PI) / 180), 0], M3_MM, 'spring housing flange bolt')));
  b.windServoBoltsMm.forEach(([x, y], i) => features.push(hole(`wind-${i}`, 'z', [x, y, 0], M3_MM, 'wind servo strap (latched-spring option)')));
  features.push(cut('window-a', [30, 20, t + 2], [-55, 30, t / 2], 'lightening window'), cut('window-b', [30, 20, t + 2], [-55, -30, t / 2], 'lightening window'));
  const holes = (4 + 2 + 2 + 3 + 4) * cylinderCm3(M3_MM, t) + cylinderCm3(HOUSING_OD_MM + 1, t);
  const plateCm3 = (polygonAreaMm2(outline) * t) / 1000 + earCm3 - boxCm3(40, 50, t) - 2 * boxCm3(30, 20, t) - 6 * cylinderCm3(SPLINE_CLEARANCE_MM, t) - holes;
  return printed({
    id: 'plate', name: 'Body plate (one program, top and bottom)', qty: 2, material: 'PETG', link: 'body',
    printNotes: 'collars up, 3 skins, 20 % gyroid; print two, mount them collar to collar — the top plate is the bottom plate turned over. Measure the coxa servo before printing: the pocket is its case plus 0.3 mm a side.',
    cad: { base: { kind: 'sketch', plane: 'XY', points: outline, height: t }, features },
    netCm3: plateCm3 * PLATE_FILL + collarCm3 * WALL_FILL, fill: 1,
  });
}

/**
 * @description The Pi bay: a vented frame the height of the gap, open to both plates, with four standoff blocks on the
 * Pi 5's mounting pattern at the height that centres the board-plus-cooler stack on the mid-plane, a port window on the
 * USB/Ethernet end and the IMU's two holes on the other end wall.
 * @param l - The layout. @param b - The body layout.
 * @returns The bay.
 */
export function piBay(l: HexapodLayout, b: BodyLayout): HexapodPrintedPart {
  const bay = b.piBay; const h = l.plateGapMm;
  const boardZ = h / 2 - 15; const standoff = 4;
  const hx = PI5_BOARD_MM.holesWide / 2; const hy = PI5_BOARD_MM.holesLong / 2;
  const features: CadFeatureProgram[] = [
    { id: 'edges', type: 'fillet', params: { radius: 3, edges: 'vertical' } },
    cut('cavity', [bay.interiorX, bay.interiorY, h + 2], [0, 0, h / 2], 'the Pi 5 and its cooler, the 85 mm side across the body'),
  ];
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy], i) => {
    features.push(add(`standoff-${i}`, [8, 8, standoff], [sx * (bay.interiorX / 2 - 4), sy * hy, boardZ - standoff / 2], 'standoff block on the Pi 5 mounting pattern'));
    features.push(hole(`pi-${i}`, 'z', [sx * hx, sy * hy, 0], M25_MM, 'Pi 5 mounting screw'));
  });
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy], i) => features.push(cut(`vent-${i}`, [WALL_MM + 0.6, 30, 25], [sx * (bay.outerX / 2 - WALL_MM / 2), sy * 20, boardZ + 15], 'side vent')));
  features.push(cut('ports', [45, WALL_MM + 0.6, 25], [0, -(bay.outerY / 2 - WALL_MM / 2), boardZ + 15], 'USB and Ethernet window'));
  features.push(hole('imu-a', 'y', [10, 0, boardZ + 16], M25_MM, 'IMU breakout screw, far end wall'), hole('imu-b', 'y', [-10, 0, boardZ + 16], M25_MM, 'IMU breakout screw, far end wall'));
  const walls = boxCm3(bay.outerX, bay.outerY, h) - boxCm3(bay.interiorX, bay.interiorY, h);
  const net = walls + 4 * boxCm3(8, 8, standoff) - 4 * boxCm3(WALL_MM, 30, 25) - boxCm3(45, WALL_MM, 25);
  return printed({
    id: 'pi-bay', name: 'Pi bay (vented frame between the plates)', qty: 1, material: 'PETG', link: 'body',
    printNotes: 'upright, 6 walls, solid; the board drops onto the standoffs with the cooler toward the vented plate — either plate, the stack is centred',
    cad: { base: { kind: 'box', sizeX: bay.outerX, sizeY: bay.outerY, sizeZ: h }, features }, netCm3: net, fill: WALL_FILL,
  });
}

/**
 * @description The head: the LiDAR seat on the nose. The square seat holds the unit's base so that its scan plane lies on
 * the body mid-plane (z = 0); the seat walls stop well below the scan window, so the ring sees 360° except where the legs
 * are; a tab at the back sits between the plates on two bolts. Frame: x forward, the LiDAR's optical centre at x = 0.
 * @param l - The layout. @param b - The body layout.
 * @returns The head.
 */
export function head(l: HexapodLayout, b: BodyLayout): HexapodPrintedPart {
  const floor = 2.5; const windowBelow = 6;
  const sizeZ = LIDAR_MM.scanPlaneAboveBase + floor - windowBelow;
  const midZ = LIDAR_MM.scanPlaneAboveBase + floor;
  const seat = LIDAR_MM.footprint + 1;
  const sizeX = seat + 2 * WALL_MM; const sizeY = seat + 2 * WALL_MM;
  const tabX = -(sizeX / 2 + 7);
  const tabBolt = b.headTab.boltYMm;
  const features: CadFeatureProgram[] = [
    { id: 'edges', type: 'fillet', params: { radius: 4, edges: 'vertical' } },
    add('tab', [14, 40, l.plateGapMm], [tabX, 0, midZ], 'tab between the plates at the nose'),
    cut('seat', [seat, seat, sizeZ - floor + 1], [0, 0, floor + (sizeZ - floor + 1) / 2], `LiDAR base seat: the base sits ${LIDAR_MM.scanPlaneAboveBase} mm (class figure, measure it) below the mid-plane, so the scan plane is z = 0`),
    hole('cable', 'z', [0, -14, 0], 8, 'LiDAR cable'),
    hole('tab-a', 'z', [tabX, tabBolt, 0], M3_MM, 'to the plates'), hole('tab-b', 'z', [tabX, -tabBolt, 0], M3_MM, 'to the plates'),
  ];
  const net = (boxCm3(sizeX, sizeY, sizeZ) - boxCm3(seat, seat, sizeZ - floor) - cylinderCm3(8, floor)) * WALL_FILL + boxCm3(14, 40, l.plateGapMm) * 0.4;
  return printed({
    id: 'head', name: 'Head (LiDAR seat on the nose)', qty: 1, material: 'PETG', link: 'body',
    printNotes: 'seat up, 6 walls, 20 % gyroid in the tab; drill the LiDAR\'s four screws through the unit\'s own base as a template; the optical centre sits at x = ' + l.lidarNoseXMm + ' on the mid-plane',
    cad: { base: { kind: 'box', sizeX, sizeY, sizeZ }, features }, netCm3: net, fill: 1,
  });
}

/**
 * @description The tail battery tray: the 3S pack on edge, on the mid-plane, in a channel behind the stern, held by two
 * straps; its tab sits between the plates on two bolts, so the tray is the same either way up. The pack counterweights
 * the LiDAR head.
 * @param l - The layout. @param b - The body layout.
 * @returns The tray.
 */
export function batteryTray(l: HexapodLayout, b: BodyLayout): HexapodPrintedPart {
  const gap = l.plateGapMm;
  const inner = { x: PACK_MM.long + 0.4, y: PACK_MM.thick + 0.6, z: PACK_MM.wide };
  const body = { x: inner.x + 2 * WALL_MM, y: inner.y + 2 * WALL_MM + 0.2, z: inner.z + 2 * 2 };
  const bodyCx = -(7 + body.x / 2 - 2);
  const chanCx = bodyCx - 0.2;
  const midZ = gap / 2;
  const features: CadFeatureProgram[] = [
    add('channel-body', [body.x, body.y, body.z], [bodyCx, 0, midZ], 'the channel body behind the stern'),
    cut('channel', [inner.x, inner.y, inner.z], [chanCx, 0, midZ], 'the pack, on edge, centred on the mid-plane'),
    cut('opening', [inner.x, 4, inner.z], [chanCx, inner.y / 2 + 1.5, midZ], 'the pack slides in from this side'),
    cut('slot-a', [4, 4, inner.z + 2], [chanCx + 25, -(inner.y / 2 + 1.3), midZ], 'strap slot'), cut('slot-b', [4, 4, inner.z + 2], [chanCx - 25, -(inner.y / 2 + 1.3), midZ], 'strap slot'),
    cut('window-a', [40, 20, 3], [chanCx + 25, 0, midZ - inner.z / 2 - 1], 'lightening'), cut('window-b', [40, 20, 3], [chanCx - 25, 0, midZ - inner.z / 2 - 1], 'lightening'),
    cut('window-c', [40, 20, 3], [chanCx + 25, 0, midZ + inner.z / 2 + 1], 'lightening'), cut('window-d', [40, 20, 3], [chanCx - 25, 0, midZ + inner.z / 2 + 1], 'lightening'),
    cut('window-e', [40, 4, 20], [chanCx, -(inner.y / 2 + 1.3), midZ], 'lightening, strap side'),
    hole('tab-a', 'z', [0, b.tailTab.boltYMm, 0], M3_MM, 'to the plates'), hole('tab-b', 'z', [0, -b.tailTab.boltYMm, 0], M3_MM, 'to the plates'),
  ];
  const tab = boxCm3(14, 28, gap);
  const walls = boxCm3(body.x, body.y, body.z) - boxCm3(inner.x, inner.y, inner.z) - boxCm3(inner.x, WALL_MM, inner.z) - 4 * boxCm3(40, 20, 2) - boxCm3(40, WALL_MM, 20);
  return printed({
    id: 'battery-tray', name: 'Tail battery tray (pack on edge, on the mid-plane)', qty: 1, material: 'PETG', link: 'body',
    printNotes: 'tab down, 6 walls, 20 % gyroid in the tab; two hook-and-loop straps through the slots hold the pack either way up',
    cad: { base: { kind: 'box', sizeX: 14, sizeY: 28, sizeZ: gap }, features }, netCm3: tab * 0.4 + walls, fill: WALL_FILL,
  });
}

/**
 * @description The body's printed parts for a layout and the coxa servo.
 * @param l - The layout. @param s - The servo class. @param b - The body layout.
 * @returns Plate (qty 2), Pi bay, head, battery tray.
 */
export function bodyParts(l: HexapodLayout, s: ServoSpec, b: BodyLayout): HexapodPrintedPart[] {
  return [plate(l, s, b), piBay(l, b), head(l, b), batteryTray(l, b)];
}
