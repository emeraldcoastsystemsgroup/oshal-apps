/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the printed airframe as CAD Studio PROGRAMS: each
 *                     |                             | part is a base (box / cylinder / sketch) plus an ordered feature
 *                     |                             | list in CAD Studio's contract (holes, pockets, bosses, fillets,
 *                     |                             | shells), in CAD Studio's frame (millimetres, Z up, footprint
 *                     |                             | centred, Z from 0). The real kernel (OCCT) turns them into STEP
 *                     |                             | and STL; this module never triangulates anything itself.
 *                     |                             | Geometry follows the recon-drone hardware design §4.
 */

/** @description One feature in CAD Studio's contract — `type` and `params` are what its validator checks. */
export interface CadFeatureProgram {
  id: string;
  type: 'hole' | 'boss' | 'box-add' | 'box-cut' | 'sketch-extrude' | 'fillet' | 'chamfer' | 'shell' | 'cut-plane' | 'scale' | 'mirror' | 'rotate' | 'translate';
  params: Record<string, unknown>;
  label?: string;
}

/** @description A CAD Studio base: what the feature list starts from. */
export type CadBaseProgram =
  | { kind: 'box'; sizeX: number; sizeY: number; sizeZ: number }
  | { kind: 'cylinder'; diameter: number; height: number }
  | { kind: 'sketch'; plane: 'XY' | 'XZ' | 'YZ'; points: number[][]; height: number };

/** @description A whole part for CAD Studio: `POST /api/cad-studio/models` takes exactly this plus a title. */
export interface CadProgram {
  base: CadBaseProgram;
  features: CadFeatureProgram[];
}

/** @description The frame's driving dimensions, all millimetres. */
export interface AirframeLayout {
  /** Motor to diagonal motor. */
  wheelbaseMm: number;
  /** Centre of the plate to the motor axis. */
  armMm: number;
  /** The square centre plate. */
  plateMm: number;
  plateThicknessMm: number;
  armSectionMm: number;
  propDiameterMm: number;
  /** Clearance between adjacent prop tips. */
  propClearanceMm: number;
  mastMm: number;
  mastDiameterMm: number;
}

const M3_CLEARANCE = 3.4;

/**
 * @description Lay out an X-quad for a prop diameter: adjacent tips a set distance apart, arms to suit.
 * @param propIn - Prop diameter in inches.
 * @param mastMm - Sensor mast height.
 * @param tipGapMm - Required gap between adjacent prop tips.
 * @returns The layout.
 */
export function layoutFor(propIn: number, mastMm: number, tipGapMm = 30): AirframeLayout {
  const propDiameterMm = propIn * 25.4;
  // Adjacent motors sit wheelbase / √2 apart; their props must clear by tipGapMm.
  const wheelbaseMm = Math.ceil(((propDiameterMm + tipGapMm) * Math.SQRT2) / 10) * 10;
  const plateMm = 110;
  return {
    wheelbaseMm, armMm: wheelbaseMm / 2, plateMm, plateThicknessMm: 4, armSectionMm: 14, propDiameterMm,
    propClearanceMm: Math.round(wheelbaseMm / Math.SQRT2 - propDiameterMm), mastMm, mastDiameterMm: 24,
  };
}

const hole = (id: string, x: number, y: number, diameter = M3_CLEARANCE, label?: string): CadFeatureProgram => ({ id, type: 'hole', params: { diameter, x, y, axis: 'z' }, ...(label ? { label } : {}) });

/** @description The centre plate: stack holes on the 30.5 and 20 mm patterns, two M3 holes per corner diagonal for each arm, rounded corners. */
export function centrePlate(l: AirframeLayout): CadProgram {
  const features: CadFeatureProgram[] = [];
  const s305 = 30.5 / 2; const s20 = 20 / 2;
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy], i) => {
    features.push(hole(`stack305-${i}`, sx * s305, sy * s305, 3.2, 'flight controller stack 30.5 mm'));
    features.push(hole(`stack20-${i}`, sx * s20, sy * s20, 2.2, 'companion stack 20 mm'));
  });
  // Two holes on each diagonal fix the arm at 45°: at 52 and 62 mm from the centre.
  const r1 = 52 / Math.SQRT2; const r2 = 62 / Math.SQRT2;
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy], i) => {
    features.push(hole(`arm-${i}-in`, sx * r1, sy * r1, M3_CLEARANCE, `arm ${i} root, inner`));
    features.push(hole(`arm-${i}-out`, sx * r2, sy * r2, M3_CLEARANCE, `arm ${i} root, outer`));
  });
  features.push({ id: 'corners', type: 'fillet', params: { radius: 8, edges: 'vertical' }, label: 'rounded corners' });
  return { base: { kind: 'box', sizeX: l.plateMm, sizeY: l.plateMm, sizeZ: l.plateThicknessMm }, features };
}

/** @description One arm: a box section, two root holes 10 mm apart matching the plate diagonal, a 16 × 16 motor pattern at the tip, a 1 mm chamfer. */
export function arm(l: AirframeLayout): CadProgram {
  const length = l.armMm + 12; // past the plate corner to the motor axis plus the mount
  const half = length / 2;
  const rootIn = -half + 8; const rootOut = rootIn + 10;
  const motorX = half - 12;
  const features: CadFeatureProgram[] = [
    hole('root-in', rootIn, 0, M3_CLEARANCE, 'root to plate, inner'),
    hole('root-out', rootOut, 0, M3_CLEARANCE, 'root to plate, outer'),
  ];
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy], i) => features.push(hole(`motor-${i}`, motorX + sx * 8, sy * 8, 3.2, 'motor 16 × 16')));
  features.push({ id: 'shaft', type: 'hole', params: { diameter: 6, x: motorX, y: 0, axis: 'z' }, label: 'motor shaft / bell clearance' });
  features.push({ id: 'edges', type: 'chamfer', params: { length: 1, edges: 'all' } });
  return { base: { kind: 'box', sizeX: length, sizeY: l.armSectionMm, sizeZ: l.armSectionMm }, features };
}

/** @description A prop-guard quarter ring, 3 mm wall, 12 mm tall, with two struts that bolt to the arm. */
export function guardSegment(l: AirframeLayout): CadProgram {
  const rIn = l.propDiameterMm / 2 + 9; const rOut = rIn + 3;
  const pts: number[][] = [];
  const n = 24;
  for (let i = 0; i <= n; i += 1) { const a = (Math.PI / 2) * (i / n); pts.push([rOut * Math.cos(a), rOut * Math.sin(a)]); }
  for (let i = n; i >= 0; i -= 1) { const a = (Math.PI / 2) * (i / n); pts.push([rIn * Math.cos(a), rIn * Math.sin(a)]); }
  const dedup = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01);
  const features: CadFeatureProgram[] = [
    { id: 'strut-a', type: 'box-add', params: { size: [rIn, 4, 12], center: [rIn / 2, 2, 6] }, label: 'strut to the arm, along x' },
    { id: 'strut-b', type: 'box-add', params: { size: [4, rIn, 12], center: [2, rIn / 2, 6] }, label: 'strut to the arm, along y' },
    hole('bolt-a', rIn - 20, 2, M3_CLEARANCE, 'bolt to arm'),
    hole('bolt-b', 2, rIn - 20, M3_CLEARANCE, 'bolt to arm'),
  ];
  return { base: { kind: 'sketch', plane: 'XY', points: dedup, height: 12 }, features };
}

/** @description The sensor mast: a hollow tube with the LiDAR seat on top. */
export function mast(l: AirframeLayout): CadProgram {
  return {
    base: { kind: 'cylinder', diameter: l.mastDiameterMm, height: l.mastMm },
    features: [
      { id: 'seat', type: 'boss', params: { diameter: 40, height: 3, axis: 'z', x: 0, y: 0, from: l.mastMm }, label: 'LiDAR seat' },
      { id: 'hollow', type: 'shell', params: { thickness: 2, openFace: 'bottom' }, label: 'cable way' },
      ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy], i) => hole(`seat-${i}`, sx * 12, sy * 12, 2.2, 'LiDAR screws M2')),
    ],
  };
}

/** @description The nadir bracket: a window for the ToF lens, holes for the flow sensor, two bolts to the bottom plate. */
export function tofMount(): CadProgram {
  return {
    base: { kind: 'box', sizeX: 50, sizeY: 60, sizeZ: 8 },
    features: [
      { id: 'window', type: 'box-cut', params: { size: [30, 40, 8], center: [0, 0, 4] }, label: 'lens window' },
      hole('flow-a', 20, 22, 2.2, 'flow sensor'), hole('flow-b', -20, 22, 2.2, 'flow sensor'),
      hole('bolt-a', 0, 27, M3_CLEARANCE, 'to the bottom plate'), hole('bolt-b', 0, -27, M3_CLEARANCE, 'to the bottom plate'),
    ],
  };
}

/** @description The battery tray: a channel for a 4S 1500 pack and two strap slots. */
export function batteryTray(): CadProgram {
  return {
    base: { kind: 'box', sizeX: 90, sizeY: 46, sizeZ: 12 },
    features: [
      { id: 'channel', type: 'box-cut', params: { size: [80, 36, 10], center: [0, 0, 7] }, label: 'battery channel' },
      { id: 'slot-a', type: 'box-cut', params: { size: [4, 46, 12], center: [-30, 0, 6] }, label: 'strap slot' },
      { id: 'slot-b', type: 'box-cut', params: { size: [4, 46, 12], center: [30, 0, 6] }, label: 'strap slot' },
    ],
  };
}

/** @description A landing foot: a short post with a rounded bottom. */
export function landingFoot(): CadProgram {
  return { base: { kind: 'cylinder', diameter: 12, height: 25 }, features: [{ id: 'round', type: 'fillet', params: { radius: 3, edges: 'bottom' } }] };
}

/** @description The landing pad: a plate with a recess for the printed AprilTag and an alignment ridge along one edge. */
export function landingPad(): CadProgram {
  return {
    base: { kind: 'box', sizeX: 200, sizeY: 200, sizeZ: 20 },
    features: [
      { id: 'recess', type: 'box-cut', params: { size: [100, 100, 2], center: [0, 0, 19] }, label: 'AprilTag 36h11 recess' },
      { id: 'ridge', type: 'box-add', params: { size: [200, 8, 5], center: [0, 96, 22.5] }, label: 'alignment ridge' },
      ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy], i) => hole(`screw-${i}`, sx * 90, sy * 90, 4.5, 'floor screw')),
    ],
  };
}
