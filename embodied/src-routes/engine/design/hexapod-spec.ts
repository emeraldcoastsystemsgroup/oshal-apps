/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202: the spider-18 contract. The hexapod every lane builds from (design, plant, controller,
 *   |                                           | electrical, studio) as numbers in ONE place with the reasoning beside them: the leg layout, the
 *   |                                           | joint sign convention, the canonical 18-actuator order, the inverted-walking mirror rule and
 *   |                                           | the two jump options. Nothing here is measured; every value is the design brief's
 *   |                                           | (core docs/research/spider-18-design-brief.md) and says so.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 B29: the mass target re-based from the brief's estimate (1900) to the parts model (2100 = 2019 computed + 4 % print tolerance), reasoning beside the field.
 */

/** @description The hexapod fits this package designs. One for now: eighteen STS3215-class bus servos, a Raspberry Pi 5 in the body, a 2-D LiDAR in the nose. */
export type HexapodFit = 'spider-18';

/** @description A leg, front to rear on each side. L1/R1 are the front pair, L3/R3 the rear. */
export type LegId = 'L1' | 'L2' | 'L3' | 'R1' | 'R2' | 'R3';

/** @description A leg's three joints, body outward: coxa (yaw, in the body), femur (pitch), tibia (pitch). */
export type LegJoint = 'coxa' | 'femur' | 'tibia';

/** @description Legs in the canonical order: left side front to rear, then right side front to rear. */
export const LEG_IDS: readonly LegId[] = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];

/** @description Joints in the canonical order, body outward. */
export const LEG_JOINTS: readonly LegJoint[] = ['coxa', 'femur', 'tibia'];

/**
 * @description The canonical 18-actuator order: `L1-coxa, L1-femur, L1-tibia, L2-coxa, … R3-tibia`. The MJCF
 * actuators, the plant's ctrl vector, the node's command arrays and the policy's action vector ALL use this order;
 * a lane that invents another order has broken the contract. Index = leg index * 3 + joint index.
 */
export const ACTUATOR_ORDER: readonly string[] = LEG_IDS.flatMap((leg) => LEG_JOINTS.map((joint) => `${leg}-${joint}`));

/** @description Where a coxa servo's yaw axis stands on the body plate and which way the leg points at coxa = 0. */
export interface CoxaMount {
  /** Along the body, forward positive (mm from the body centre). */
  xMm: number;
  /** Across the body, left positive (mm from the body centre). */
  yMm: number;
  /** The leg's neutral direction: degrees from +x (forward), counter-clockwise seen from above. */
  neutralYawDeg: number;
}

/** @description The driving dimensions, all millimetres. The brief's numbers, not a measurement. */
export interface HexapodLayout {
  /** The two identical plates: a hexagonal outline this long along x … */
  bodyLengthMm: number;
  /** … and this wide across y at the middle legs. */
  bodyWidthMm: number;
  plateThicknessMm: number;
  /** Inner face to inner face: the Pi 5 with its active cooler and the six coxa servos live between the plates. */
  plateGapMm: number;
  coxaMounts: Record<LegId, CoxaMount>;
  /** Coxa yaw axis to femur pitch axis. */
  coxaMm: number;
  /** Femur pitch axis to tibia pitch axis. */
  femurMm: number;
  /** Tibia pitch axis to the foot's contact point. */
  tibiaMm: number;
  footRadiusMm: number;
  /** Body mid-plane above the ground in the stance the gait starts from; the same number inverted. */
  standHeightMm: number;
  /** The LiDAR's optical centre along +x: a nose beyond the front coxa pair so the legs occlude as little as possible. */
  lidarNoseXMm: number;
  /** The LiDAR scan plane sits ON the body mid-plane (z = 0) so flipping the body keeps the plane at the same height. */
  lidarPlaneZMm: 0;
}

/** @description Software joint limits in degrees about the sign convention below. The STS3215 turns 360°; these are the geometry's limits, not the servo's. */
export interface HexapodJointLimits {
  coxaDeg: readonly [number, number];
  femurDeg: readonly [number, number];
  tibiaDeg: readonly [number, number];
}

/** @description How the spider jumps. `legs-hop`: every leg extends together, servos only, a small hop. `latched-spring`: a central double-ended piston wound by a servo over a cam and released by a latch — a real jump, in either orientation. */
export type JumpOption = 'legs-hop' | 'latched-spring';

/** @description The latched-spring option's sizing. E = k s² / 2: 5000 N/m over 38 mm stores 3.6 J, enough to lift 1.9 kg about 19 cm with no losses. */
export interface JumpSpringSpec {
  stiffnessNPerM: number;
  strokeMm: number;
  /** Stored energy at full stroke (J), derived, kept here so every lane quotes one number. */
  storedJ: number;
  /** The servo that winds the cam and the one that trips the latch; the same row as the legs. */
  windServoRowId: string;
}

/** @description Everything a lane needs to build the spider: fit, layout, limits, the part rows by id, the jump options and the mass target. */
export interface HexapodSpec {
  fit: HexapodFit;
  layout: HexapodLayout;
  limits: HexapodJointLimits;
  /** The owned servo row (parts-catalog.json `servos`) every joint uses. */
  servoRowId: string;
  servoCount: 18;
  /** Bought-part row ids the design lane owns in parts-catalog.json; the brief gives each one's figures and source. */
  boughtRowIds: readonly string[];
  jumpOptions: readonly JumpOption[];
  spring: JumpSpringSpec;
  /** The all-up target the mass budget is held to (g). Re-based 2026-10-30 on the parts model: the brief's 1851 g estimate
   * undercounted the leg parts (2.4 mm PETG walls around 55 g servos come to 77 g a leg, not 56), the design computes 2019 g,
   * and at that mass every joint sits inside the servo's continuous torque (margins 1.03-1.47) and the plant stands, walks,
   * walks inverted, recovers and jumps. 2100 g is the computed mass plus a 4 % print tolerance - a budget the scale can
   * check, never a fill factor edited to fit. */
  massTargetG: number;
}

const SPRING_K = 5000;
const SPRING_STROKE_MM = 38;

/**
 * @description The spider-18 contract (ADR-202). Front legs point 45° forward-out, middle legs straight out, rear legs 45°
 * back-out — the classic hexapod stance that keeps the feet clear of each other through a tripod gait. The body is
 * symmetric top to bottom (two identical plates, the Pi bay centred, the LiDAR on the mid-plane) so that inverted the
 * machine is the same machine with its joint signs mirrored.
 */
export const SPIDER_18: HexapodSpec = Object.freeze({
  fit: 'spider-18',
  layout: Object.freeze({
    bodyLengthMm: 220,
    bodyWidthMm: 140,
    plateThicknessMm: 4,
    plateGapMm: 45,
    coxaMounts: Object.freeze({
      L1: { xMm: 80, yMm: 52, neutralYawDeg: 45 },
      L2: { xMm: 0, yMm: 68, neutralYawDeg: 90 },
      L3: { xMm: -80, yMm: 52, neutralYawDeg: 135 },
      R1: { xMm: 80, yMm: -52, neutralYawDeg: -45 },
      R2: { xMm: 0, yMm: -68, neutralYawDeg: -90 },
      R3: { xMm: -80, yMm: -52, neutralYawDeg: -135 },
    }),
    coxaMm: 45,
    femurMm: 80,
    tibiaMm: 120,
    footRadiusMm: 8,
    standHeightMm: 90,
    lidarNoseXMm: 135,
    lidarPlaneZMm: 0,
  }),
  limits: Object.freeze({ coxaDeg: [-60, 60] as const, femurDeg: [-120, 120] as const, tibiaDeg: [-140, 140] as const }),
  servoRowId: 'sts3215-12v',
  servoCount: 18,
  boughtRowIds: Object.freeze(['pi5-8gb', 'pi5-active-cooler', 'ld19-lidar', 'bno055-imu', 'bus-servo-adapter', 'lipo-3s-2200', 'buck-5v-5a']),
  jumpOptions: Object.freeze(['legs-hop', 'latched-spring'] as const),
  spring: Object.freeze({
    stiffnessNPerM: SPRING_K,
    strokeMm: SPRING_STROKE_MM,
    storedJ: Math.round(0.5 * SPRING_K * (SPRING_STROKE_MM / 1000) ** 2 * 100) / 100,
    windServoRowId: 'sts3215-12v',
  }),
  massTargetG: 2100,
});

/**
 * @description The joint sign convention, stated once. Zero pose: every leg straight out horizontally along its neutral
 * yaw, femur and tibia in line. Coxa positive swings the foot FORWARD (toward body +x) on every leg — left and right
 * alike, so the MJCF puts the left legs' coxa hinge on −z and the right legs' on +z. Femur positive drops the foot toward
 * body −z (the belly side, the ground when upright). Tibia positive bends the knee so the foot goes further toward
 * body −z. Radians everywhere outside this file's degree limits.
 */
export const SIGN_CONVENTION = Object.freeze({
  coxa: 'positive = foot forward (+x body) on every leg',
  femur: 'positive = foot toward body -z (belly side)',
  tibia: 'positive = knee bends the foot further toward body -z',
  zeroPose: 'leg straight out horizontally along its neutral yaw',
});

/** @description A full set of joint targets in the canonical order, radians. */
export type JointTargetsRad = readonly number[];

/**
 * @description The inverted-walking rule. When the body is upside down the ground is at body +z, so every femur and
 * tibia target is negated; a coxa target is NOT, because forward is still forward. The leg ROLES mirror too (see
 * `mirrorLegRole`): the gait that drove L1 drives R1. Both halves of the rule are what the plant tests and the node
 * applies — one function, so they cannot drift.
 * @param targets - Eighteen targets in `ACTUATOR_ORDER`, as planned for the upright body.
 * @returns The same intent for the inverted body: coxa kept, femur and tibia negated, legs re-assigned L↔R.
 */
export function invertedJointTargets(targets: JointTargetsRad): number[] {
  if (targets.length !== ACTUATOR_ORDER.length) throw new Error(`expected ${ACTUATOR_ORDER.length} targets, got ${targets.length}`);
  const out = new Array<number>(targets.length);
  LEG_IDS.forEach((leg, li) => {
    const from = LEG_IDS.indexOf(mirrorLegRole(leg)) * 3;
    out[li * 3] = targets[from];
    out[li * 3 + 1] = -targets[from + 1];
    out[li * 3 + 2] = -targets[from + 2];
  });
  return out;
}

/**
 * @description The leg that plays this leg's role once the body is inverted: left and right swap, front stays front.
 * @param leg - A leg id.
 * @returns Its mirror.
 */
export function mirrorLegRole(leg: LegId): LegId {
  return (leg[0] === 'L' ? 'R' : 'L') + leg.slice(1) as LegId;
}

/**
 * @description The index of a joint in the canonical order.
 * @param leg - The leg.
 * @param joint - The joint.
 * @returns 0–17.
 */
export function actuatorIndex(leg: LegId, joint: LegJoint): number {
  return LEG_IDS.indexOf(leg) * 3 + LEG_JOINTS.indexOf(joint);
}

/**
 * @description The fit a query names, or null.
 * @param id - A fit id from a query string.
 * @returns The fit, or null when unknown.
 */
export function hexapodFitById(id: string | undefined): HexapodFit | null {
  return id === undefined || id === 'spider-18' ? 'spider-18' : null;
}

/** @description The link masses the plant's inertia is built from until the design lane's parts model replaces them (ADR-152 D1: a number lives in one place — these are the brief's estimates and the design's figures supersede them at integration). */
export interface HexapodMasses {
  /** Both plates, the Pi 5 and cooler, battery, adapter, buck, wiring, bay, tray, head, LiDAR, IMU and the six coxa servos that live in the body (g). */
  bodyG: number;
  /** The coxa bracket and the femur servo it carries (g). */
  coxaLinkG: number;
  /** The femur part and the tibia servo it carries (g). */
  femurLinkG: number;
  /** The tibia part and its foot (g). */
  tibiaLinkG: number;
}

/** @description The brief's mass estimates (core docs/research/spider-18-design-brief.md §1): 855 g in the body and 166 g per leg, 1851 g all up against the 1900 g target. Estimates, not measurements. */
export const BRIEF_MASSES: HexapodMasses = Object.freeze({ bodyG: 855, coxaLinkG: 67, femurLinkG: 73, tibiaLinkG: 26 });

/**
 * @description All-up mass from a mass model (g).
 * @param m - The link masses.
 * @returns Body plus six legs.
 */
export function allUpMassG(m: HexapodMasses): number {
  return m.bodyG + 6 * (m.coxaLinkG + m.femurLinkG + m.tibiaLinkG);
}
