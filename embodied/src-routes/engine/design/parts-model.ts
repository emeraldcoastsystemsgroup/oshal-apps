/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the recon drone as ONE machine-readable parts
 *                     |                             | model: two fits (the printed 2-D set, the 3-D set held in
 *                     |                             | reserve), printed parts with their CAD programs and masses, the
 *                     |                             | electronics with masses and approximate prices, the mass budget
 *                     |                             | summed from them, the propulsion sizing at that mass, the print
 *                     |                             | rules. The sim's sensor poses come from the SAME sensor set the
 *                     |                             | fit names, so a number lives in one place. The design document's
 *                     |                             | tables are generated from here (`design-markdown`).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | fitForSensorSet: the fit a sensor set flies on, so the simulation's body radius and clearance come from the parts model.
 */

import { DRONE_SENSOR_SETS, type DroneSensorSet, type DroneSensorSetId } from '../drone/sensor-set';
import { arm, batteryTray, centrePlate, guardSegment, landingFoot, landingPad, layoutFor, mast, tofMount, type AirframeLayout, type CadProgram } from './airframe';
import { sizeHover, tipSpeedMps, type HoverSizing } from './propulsion';

/** @description The two ways to fit the one airframe. */
export type DroneFit = 'recon-mini' | 'recon-3d';

/** @description A printed part: what to print, how, how many, what it weighs, and the CAD program that makes it. */
export interface PrintedPart {
  id: string;
  name: string;
  qty: number;
  material: string;
  printNotes: string;
  massEachG: number;
  cad: CadProgram;
}

/** @description A bought part. Prices are approximate 2026 street prices and say so. */
export interface BoughtPart {
  id: string;
  name: string;
  qty: number;
  massEachG: number;
  role: string;
  approxUsdEach: number;
}

/** @description How a fit differs: props, battery, motors, sensing. */
export interface FitSpec {
  id: DroneFit;
  label: string;
  sensorSet: DroneSensorSetId;
  propIn: number;
  cells: number;
  mAh: number;
  batteryG: number;
  motor: BoughtPart;
  hoverRpm: number;
  sensing: BoughtPart[];
}

const common: BoughtPart[] = [
  { id: 'esc', name: '4-in-1 ESC, 35–45 A, BLHeli_32 / AM32', qty: 1, massEachG: 15, role: 'one board, bidirectional DShot for rpm telemetry', approxUsdEach: 45 },
  { id: 'fc', name: 'H7-class flight controller running ArduPilot Copter', qty: 1, massEachG: 10, role: 'rangefinders, optical flow, MAVLink companion, geofence and battery failsafes are stock', approxUsdEach: 75 },
  { id: 'pi', name: 'Raspberry Pi Zero 2 W', qty: 1, massEachG: 11, role: 'the drone-node client only; the map, registration and plans run in the swarm', approxUsdEach: 18 },
  { id: 'flow', name: 'PMW3901 optical flow', qty: 1, massEachG: 3, role: 'the dead reckoning the drift budget models', approxUsdEach: 20 },
  { id: 'padcam', name: 'Pi Camera Module 3, pointed down', qty: 1, massEachG: 4, role: 'AprilTag on the pad → the pad fix', approxUsdEach: 25 },
  { id: 'rc', name: 'ELRS receiver, buzzer, LED', qty: 1, massEachG: 8, role: 'the manual kill switch — the hardware e-stop this class needs', approxUsdEach: 25 },
  { id: 'wiring', name: 'Wiring, straps, fasteners, power module with current sense', qty: 1, massEachG: 50, role: '', approxUsdEach: 30 },
];

/** @description The two fits. */
export const DRONE_FITS: Record<DroneFit, FitSpec> = {
  'recon-mini': {
    id: 'recon-mini', label: 'Recon-mini — the drone we print first: 2-D ring + downward ToF depth camera', sensorSet: 'recon-mini',
    propIn: 6, cells: 4, mAh: 1500, batteryG: 175, hoverRpm: 9000,
    motor: { id: 'motor', name: '2306 brushless, 1700–1900 KV', qty: 4, massEachG: 30, role: '~1 kg peak thrust each on a 6-inch prop', approxUsdEach: 18 },
    sensing: [
      { id: 'lidar2d', name: 'LDRobot LD19 / D500 class 2-D LiDAR', qty: 1, massEachG: 47, role: '12 m, 360°, ~4500 points/s, UART', approxUsdEach: 90 },
      { id: 'tof', name: 'Arducam ToF class depth camera', qty: 1, massEachG: 20, role: '0.15–4 m, 240 × 180; the height map from 1.9 m', approxUsdEach: 60 },
      { id: 'rangers', name: 'TFmini-S class rangers (zenith, nadir)', qty: 2, massEachG: 5, role: 'the climb column and the altitude hold', approxUsdEach: 40 },
    ],
  },
  'recon-3d': {
    id: 'recon-3d', label: 'Recon-3D — the same frame with the 3-D LiDAR we would buy, held in reserve', sensorSet: 'recon-3d',
    propIn: 7, cells: 6, mAh: 2200, batteryG: 330, hoverRpm: 7500,
    motor: { id: 'motor', name: '2807 brushless, 1300 KV', qty: 4, massEachG: 45, role: 'a 7-inch prop on 6S for a 1.3 kg machine', approxUsdEach: 28 },
    sensing: [
      { id: 'lidar3d', name: 'Livox Mid-360 class 3-D LiDAR', qty: 1, massEachG: 265, role: '360° × 59°, 40 m; the sensor set the sim assumed through 0.4.0', approxUsdEach: 1000 },
      { id: 'zenith', name: 'TFmini-S class ranger (zenith)', qty: 1, massEachG: 5, role: 'the climb column', approxUsdEach: 40 },
    ],
  },
};

/** @description The whole design for a fit: layout, parts, budget, sizing. */
export interface DroneDesign {
  fit: FitSpec;
  sensorSet: DroneSensorSet;
  layout: AirframeLayout;
  parts: PrintedPart[];
  bought: BoughtPart[];
  massBudget: { printedG: number; boughtG: number; batteryG: number; allUpG: number };
  sizing: HoverSizing;
  tipSpeedMps: number;
  approxUsd: number;
  printRules: string[];
}

/** @description The printed parts for a layout — masses are design estimates, replaced by the scale at assembly. */
function printedParts(l: AirframeLayout, fit: FitSpec): PrintedPart[] {
  const mastMass = Math.round(10 + l.mastMm * 0.3);
  return [
    { id: 'centre-plate', name: 'Centre plate (top and bottom)', qty: 2, material: 'PETG or PA-CF', printNotes: 'flat, 6 walls, 40 % gyroid', massEachG: 38, cad: centrePlate(l) },
    { id: 'arm', name: 'Arm with integral motor mount', qty: 4, material: 'PA-CF (PETG acceptable)', printNotes: 'flat, solid infill, 0.2 mm layers', massEachG: fit.propIn >= 7 ? 18 : 15, cad: arm(l) },
    { id: 'guard', name: 'Prop guard quarter ring', qty: 4, material: 'TPU 95A or PETG', printNotes: 'mandatory indoors; sits above the prop plane as well as around it', massEachG: fit.propIn >= 7 ? 13 : 11.25, cad: guardSegment(l) },
    { id: 'mast', name: 'Sensor mast', qty: 1, material: 'PETG', printNotes: 'vertical, 4 walls; the seat at 0.12 mm layers', massEachG: mastMass, cad: mast(l) },
    { id: 'tof-mount', name: 'ToF camera and flow mount', qty: 1, material: 'PETG', printNotes: 'nadir bracket under the bottom plate', massEachG: 12, cad: tofMount() },
    { id: 'battery-tray', name: 'Battery tray', qty: 1, material: 'PETG', printNotes: 'two strap slots', massEachG: 18, cad: batteryTray() },
    { id: 'foot', name: 'Landing foot', qty: 4, material: 'TPU', printNotes: 'on the arm underside', massEachG: 3, cad: landingFoot() },
    { id: 'pad', name: 'Landing pad', qty: 1, material: 'PETG', printNotes: 'the AprilTag printed on paper under a clear insert; not flown', massEachG: 380, cad: landingPad() },
  ];
}

const PRINT_RULES = [
  '0.2 mm layers everywhere except the mast top (0.12 mm for the LiDAR seat).',
  'No PLA: it creeps under a strapped battery in a warm room and snaps at the arm root.',
  'Weigh every part as it comes off the bed and write the figure on it; the budget is a budget, not a measurement.',
  'Every structural part fits a 220 × 220 mm bed.',
];

/**
 * @description The complete design for a fit, every number derived from the parts model.
 * @param fitId - Which fit.
 * @returns The design.
 */
export function buildDrone(fitId: DroneFit): DroneDesign {
  const fit = DRONE_FITS[fitId];
  const sensorSet = DRONE_SENSOR_SETS[fit.sensorSet];
  const layout = layoutFor(fit.propIn, Math.max(40, Math.round(sensorSet.mastM * 1000)));
  const parts = printedParts(layout, fit);
  const props: BoughtPart = { id: 'props', name: `${fit.propIn} in two-blade props (printed ~${fit.propIn >= 7 ? 9 : 7} g each; commercial ~5 g)`, qty: 4, massEachG: fit.propIn >= 7 ? 9 : 7, role: 'aero-lab designs the printed blade', approxUsdEach: 3 };
  const bought = [fit.motor, props, ...common, ...fit.sensing];
  const printedG = parts.filter((p) => p.id !== 'pad').reduce((a, p) => a + p.qty * p.massEachG, 0);
  const boughtG = bought.reduce((a, p) => a + p.qty * p.massEachG, 0);
  const allUpG = Math.round(printedG + boughtG + fit.batteryG);
  const sizing = sizeHover({ propIn: fit.propIn, auwG: allUpG, cells: fit.cells, mAh: fit.mAh });
  const battery: BoughtPart = { id: 'battery', name: `${fit.cells}S ${fit.mAh} mAh LiPo`, qty: 1, massEachG: fit.batteryG, role: '', approxUsdEach: fit.cells >= 6 ? 45 : 30 };
  const approxUsd = Math.round([...bought, battery].reduce((a, p) => a + p.qty * p.approxUsdEach, 0));
  return { fit, sensorSet, layout, parts, bought: [...bought, battery], massBudget: { printedG, boughtG, batteryG: fit.batteryG, allUpG }, sizing, tipSpeedMps: tipSpeedMps(fit.propIn, fit.hoverRpm), approxUsd, printRules: PRINT_RULES };
}

/**
 * @description Resolve a fit id, or null.
 * @param id - A fit id or undefined.
 * @returns The fit id when known.
 */
/** @description The fit that carries a sensor set: the printed frame for the 2-D ring, the reserve frame for the 3-D LiDAR. Every guard reads its hull from here (ADR-152 D1: a number lives in one place). */
export function fitForSensorSet(sensorSet: DroneSensorSetId): DroneFit {
  return (Object.values(DRONE_FITS).find((f) => f.sensorSet === sensorSet) ?? DRONE_FITS['recon-mini']).id;
}

export function fitById(id: string | undefined): DroneFit | null {
  return id === 'recon-mini' || id === 'recon-3d' ? id : null;
}
