/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 lane L2: the spider-18 in MuJoCo, generated from the contract
 *                     |                             | (`SPIDER_18`) plus a mass model (`BRIEF_MASSES` by default) and never
 *                     |                             | from a number typed here. The body is the two plates as one box
 *                     |                             | carrying the body mass, its inertia estimated from the layout (six
 *                     |                             | coxa-servo lumps at the mounts, the rest a uniform box). Six legs
 *                     |                             | hang from the coxa mounts: the coxa hinge turns about -z on the left
 *                     |                             | and +z on the right so a positive target is "foot forward" on every
 *                     |                             | leg (brief 3.1), femur and tibia turn about the leg's lateral axis
 *                     |                             | with positive dropping the foot toward body -z (SIGN_CONVENTION).
 *                     |                             | Every joint is a position servo limited to the row's stall torque
 *                     |                             | with the torque-speed damping the arm learned (stall over no-load
 *                     |                             | speed) and the arm's reflected-inertia estimate. An IMU site at the
 *                     |                             | body centre carries a gyro, an accelerometer and a frame quaternion;
 *                     |                             | a LiDAR site sits on the nose at z = 0. Gravity is the air medium
 *                     |                             | row's (ADR-160 D7), never a literal. The `latched-spring` option adds
 *                     |                             | the central double-ended piston on a stiff slide joint held by an
 *                     |                             | equality latch the plant releases (the modelling choice is written
 *                     |                             | in the model's own comment).
 */

import {
  ACTUATOR_ORDER, BRIEF_MASSES, LEG_IDS, LEG_JOINTS, SPIDER_18,
  type CoxaMount, type HexapodMasses, type HexapodSpec, type JumpOption, type LegId, type LegJoint,
} from '../design/hexapod-spec';
import { servoRow } from '../design/parts-catalog';
import { servoSpecFrom, type ServoSpec } from '../design/servos';
import { mediumById, requireModelValidIn, type Medium } from '../medium/medium';
import { mjcfNumber as f, mjcfVec3 as v3, MJCF_TIMESTEP_S, RIGID_BODY_PLANT } from './mjcf';
import { SATURATION_ERROR_RAD, SERVO_ARMATURE_KGM2 } from './arm-mjcf';

/** @description A leg link's capsule radius (m): the STS3215 case is 24.7 mm wide, so a link is about that thick. */
export const LEG_RADIUS_M = 0.012;
/** @description The shin's radius (m): the tibia thins to this over its last ANKLE_M so that the FOOT sphere, not a link's
 * rounded end, is the lowest point in every leg pose — a 12 mm end cap around an 8 mm foot touched the floor first and the
 * feet reported no contact while the body stood 4 mm high. */
export const SHIN_RADIUS_M = 0.006;
/** @description How far back from the foot sphere's centre the tibia thins to the shin (m). */
export const ANKLE_M = 0.03;
/** @description The latch's impedance (solimp): near-rigid, so the wound rod holds its stroke under the spring's full force
 * (measured: 0.07 mm of sag and 3.597 J held of the contract's 3.61, against 3.2 mm and 3.03 J at MuJoCo's default). */
export const LATCH_SOLIMP = '0.999 0.9999 0.001 0.5 2';
/** @description The TPU foot cap's friction triple (slide, spin, roll): rubber-like on a dry floor. */
export const FOOT_FRICTION = '1.0 0.005 0.0001';
/** @description The spring rod's mass (kg): an ESTIMATE until the design lane's spring parts carry a figure. */
export const SPRING_ROD_KG = 0.04;
/** @description The spring rod's radius (m): a printed piston rod through the body centre. */
export const SPRING_ROD_RADIUS_M = 0.006;
/** @description How far the LATCHED rod's ground-side end protrudes below the plate (m): the crouch puts this tip on the floor before the latch trips. */
export const SPRING_TIP_M = 0.01;
/** @description The slide's own damping (N·s/m): a little, so the released rod does not ring forever at the stroke's end. */
export const SPRING_DAMPING_NSM = 0.5;
/** @description The latch's constraint time constant (s): twice the physics step, as stiff as MuJoCo's reference solver allows. */
export const LATCH_SOLREF_S = 2 * MJCF_TIMESTEP_S;

/** @description What the generator may be told beyond the spec and the masses. */
export interface HexapodMjcfOptions {
  /** How the spider jumps; `legs-hop` (servos only) by default. */
  jump?: JumpOption;
  /** The medium the scene runs in; air by default (the spider walks on a floor, in air). */
  medium?: Medium;
}

/** @description One actuator in the model: the joint it drives and the servo numbers it is limited by. */
export interface HexapodJointPlant {
  name: string;
  leg: LegId;
  joint: LegJoint;
  /** The hinge axis in the parent body's frame. */
  axis: readonly [number, number, number];
  /** Software range (rad), from the contract's degree limits. */
  range: readonly [number, number];
  stallNm: number;
  kp: number;
  /** Stall over no-load speed: the torque-speed slope of the servo, the damping the arm learned. */
  damping: number;
  armature: number;
}

/** @description The body as one solid: mass and principal inertias about its centre, an estimate from the layout. */
export interface HexapodBodyInertia {
  massKg: number;
  ixx: number;
  iyy: number;
  izz: number;
  /** Half sizes of the plate envelope (m): length, width, plate gap plus both plates. */
  halfM: readonly [number, number, number];
}

/** @description The spring piston as the model carries it, from `SPIDER_18.spring` plus the estimates named above. */
export interface HexapodSpringPlant {
  stiffnessNPerM: number;
  strokeM: number;
  storedJ: number;
  /** Half the rod's length (m): centre to either end, so the latched ground-side end protrudes SPRING_TIP_M below the plate. */
  rodHalfM: number;
  rodKg: number;
}

/** @description The numbers the physics spider is built from, all read from the contract, the servo row and the mass model. */
export interface HexapodPlantSpec {
  fit: HexapodSpec['fit'];
  timestepS: number;
  servo: ServoSpec;
  joints: HexapodJointPlant[];
  legs: { id: LegId; mount: CoxaMount; coxaAxisZ: 1 | -1 }[];
  /** Link lengths (m): coxa axis to femur axis, femur axis to tibia axis, tibia axis to the foot sphere's CENTRE, and the foot radius. */
  links: { coxaM: number; femurM: number; tibiaM: number; footCentreM: number; footRadiusM: number };
  /** Link masses (kg) from the mass model. */
  massesKg: { coxa: number; femur: number; tibia: number };
  body: HexapodBodyInertia;
  standHeightM: number;
  lidar: { xM: number; zM: number };
  spring: HexapodSpringPlant;
  allUpKg: number;
}

const DEG = Math.PI / 180;

/**
 * @description The body's inertia estimated from the layout: the six coxa servos as point lumps at their mounts (they
 * live in the body, between the plates) and everything else as a uniform box of the plate envelope. An estimate, and
 * it travels as one; the design lane's parts model is what replaces it.
 * @param spec - The contract.
 * @param masses - The mass model.
 * @param servoMassKg - One coxa servo's mass (kg), from its row.
 * @returns Mass, principal inertias and the box's half sizes.
 */
export function hexapodBodyInertia(spec: HexapodSpec, masses: HexapodMasses, servoMassKg: number): HexapodBodyInertia {
  const L = spec.layout.bodyLengthMm / 1000;
  const W = spec.layout.bodyWidthMm / 1000;
  const H = (spec.layout.plateGapMm + 2 * spec.layout.plateThicknessMm) / 1000;
  const massKg = masses.bodyG / 1000;
  const box = Math.max(0, massKg - 6 * servoMassKg);
  let ixx = (box * (W * W + H * H)) / 12;
  let iyy = (box * (L * L + H * H)) / 12;
  let izz = (box * (L * L + W * W)) / 12;
  for (const leg of LEG_IDS) {
    const x = spec.layout.coxaMounts[leg].xMm / 1000;
    const y = spec.layout.coxaMounts[leg].yMm / 1000;
    ixx += servoMassKg * y * y;
    iyy += servoMassKg * x * x;
    izz += servoMassKg * (x * x + y * y);
  }
  return { massKg, ixx, iyy, izz, halfM: [L / 2, W / 2, H / 2] };
}

/** @description The hinge axis of a joint: coxa about -z on the left and +z on the right (positive = foot forward everywhere), femur and tibia about the leg's lateral +y (positive = foot toward body -z). */
function jointAxis(leg: LegId, joint: LegJoint): readonly [number, number, number] {
  if (joint !== 'coxa') return [0, 1, 0];
  return leg[0] === 'L' ? [0, 0, -1] : [0, 0, 1];
}

/** @description A joint's software range in radians, from the contract's degree limits. */
function jointRange(spec: HexapodSpec, joint: LegJoint): readonly [number, number] {
  const deg = joint === 'coxa' ? spec.limits.coxaDeg : joint === 'femur' ? spec.limits.femurDeg : spec.limits.tibiaDeg;
  return [deg[0] * DEG, deg[1] * DEG];
}

/**
 * @description The plant numbers for a spec and a mass model: eighteen position servos in `ACTUATOR_ORDER`, each
 * limited to the row's stall torque, with kp = stall / saturation error and damping = stall / no-load speed (the
 * torque-speed rule the arm learned) and the arm's reflected-inertia estimate; the link lengths and masses; the body
 * inertia; the spring piston.
 * @param spec - The contract (`SPIDER_18`).
 * @param masses - The mass model; the brief's estimates by default.
 * @returns The plant specification.
 */
export function hexapodPlant(spec: HexapodSpec = SPIDER_18, masses: HexapodMasses = BRIEF_MASSES): HexapodPlantSpec {
  const servo = servoSpecFrom(servoRow(spec.servoRowId));
  const joints: HexapodJointPlant[] = LEG_IDS.flatMap((leg) => LEG_JOINTS.map((joint) => ({
    name: `${leg}-${joint}`, leg, joint, axis: jointAxis(leg, joint), range: jointRange(spec, joint),
    stallNm: servo.stallNm, kp: servo.stallNm / SATURATION_ERROR_RAD, damping: servo.stallNm / servo.noLoadRadS, armature: SERVO_ARMATURE_KGM2,
  })));
  const lay = spec.layout;
  const body = hexapodBodyInertia(spec, masses, servo.massG / 1000);
  const strokeM = spec.spring.strokeMm / 1000;
  return {
    fit: spec.fit, timestepS: MJCF_TIMESTEP_S, servo, joints,
    legs: LEG_IDS.map((id) => ({ id, mount: lay.coxaMounts[id], coxaAxisZ: id[0] === 'L' ? -1 : 1 })),
    links: { coxaM: lay.coxaMm / 1000, femurM: lay.femurMm / 1000, tibiaM: lay.tibiaMm / 1000, footCentreM: (lay.tibiaMm - lay.footRadiusMm) / 1000, footRadiusM: lay.footRadiusMm / 1000 },
    massesKg: { coxa: masses.coxaLinkG / 1000, femur: masses.femurLinkG / 1000, tibia: masses.tibiaLinkG / 1000 },
    body, standHeightM: lay.standHeightMm / 1000, lidar: { xM: lay.lidarNoseXMm / 1000, zM: lay.lidarPlaneZMm / 1000 },
    spring: { stiffnessNPerM: spec.spring.stiffnessNPerM, strokeM, storedJ: spec.spring.storedJ, rodHalfM: body.halfM[2] + SPRING_TIP_M + strokeM, rodKg: SPRING_ROD_KG },
    allUpKg: masses.bodyG / 1000 + 6 * (masses.coxaLinkG + masses.femurLinkG + masses.tibiaLinkG) / 1000,
  };
}

/** @description A quaternion (w x y z) for a yaw about z. */
const rz = (yawRad: number): string => `${f(Math.cos(yawRad / 2))} 0 0 ${f(Math.sin(yawRad / 2))}`;

/** @description One joint element from its plant row. */
function jointLine(j: HexapodJointPlant): string {
  return `<joint name="${j.name}" type="hinge" axis="${v3(j.axis)}" range="${f(j.range[0])} ${f(j.range[1])}" armature="${f(j.armature)}" damping="${f(j.damping)}"/>`;
}

/**
 * @description One leg's body chain: coxa (yaw in the body), femur and tibia (pitch about the leg's lateral axis), a
 * capsule per link carrying the mass model's figure, the foot sphere at the tibia's end with the TPU friction.
 * @param p - The plant specification.
 * @param leg - Which leg.
 * @param indent - The indentation the coxa body starts at.
 * @returns The lines, already closed.
 */
export function hexapodLegLines(p: HexapodPlantSpec, leg: LegId, indent: string): string[] {
  const at = indent;
  const { mount } = p.legs.find((l) => l.id === leg) as { mount: CoxaMount };
  const j = (joint: LegJoint): HexapodJointPlant => p.joints.find((x) => x.leg === leg && x.joint === joint) as HexapodJointPlant;
  const { coxaM, femurM, footCentreM, footRadiusM } = p.links;
  return [
    `${at}<body name="${leg}-coxa" pos="${f(mount.xMm / 1000)} ${f(mount.yMm / 1000)} 0" quat="${rz(mount.neutralYawDeg * DEG)}">`,
    `${at}  ${jointLine(j('coxa'))}`,
    `${at}  <geom name="${leg}-coxa" class="spider" type="capsule" fromto="0 0 0 ${f(coxaM)} 0 0" size="${f(LEG_RADIUS_M)}" mass="${f(p.massesKg.coxa)}"/>`,
    `${at}  <body name="${leg}-femur" pos="${f(coxaM)} 0 0">`,
    `${at}    ${jointLine(j('femur'))}`,
    `${at}    <geom name="${leg}-femur" class="spider" type="capsule" fromto="0 0 0 ${f(femurM)} 0 0" size="${f(LEG_RADIUS_M)}" mass="${f(p.massesKg.femur)}"/>`,
    `${at}    <body name="${leg}-tibia" pos="${f(femurM)} 0 0">`,
    `${at}      ${jointLine(j('tibia'))}`,
    `${at}      <geom name="${leg}-tibia" class="spider" type="capsule" fromto="0 0 0 ${f(footCentreM - ANKLE_M)} 0 0" size="${f(LEG_RADIUS_M)}" mass="${f(p.massesKg.tibia)}"/>`,
    `${at}      <geom name="${leg}-shin" class="spider" type="capsule" fromto="${f(footCentreM - ANKLE_M)} 0 0 ${f(footCentreM - footRadiusM)} 0 0" size="${f(SHIN_RADIUS_M)}" mass="0.000001"/>`,
    `${at}      <geom name="${leg}-foot" class="foot" type="sphere" pos="${f(footCentreM)} 0 0" size="${f(footRadiusM)}" mass="0.000001"/>`,
    `${at}    </body>`,
    `${at}  </body>`,
    `${at}</body>`,
  ];
}

/**
 * @description The spring piston (the `latched-spring` option): a rod through the body centre on a slide joint along
 * body z with the contract's stiffness, its stroke as the joint range, and an equality latch holding it wound at
 * +stroke (the upright winding; the plant flips the sign when it winds inverted and releases it on `jump`).
 * @param p - The plant specification.
 * @param indent - The indentation the rod body starts at.
 * @returns The rod body lines (worldbody) and the latch lines (equality section).
 */
export function hexapodSpringLines(p: HexapodPlantSpec, indent: string): { body: string[]; equality: string[] } {
  const s = p.spring;
  return {
    body: [
      `${indent}<body name="spring-rod" pos="0 0 0">`,
      `${indent}  <joint name="spring" type="slide" axis="0 0 1" range="${f(-s.strokeM)} ${f(s.strokeM)}" stiffness="${f(s.stiffnessNPerM)}" springref="0" damping="${f(SPRING_DAMPING_NSM)}"/>`,
      `${indent}  <geom name="spring-rod" class="spider" type="capsule" fromto="0 0 ${f(-s.rodHalfM)} 0 0 ${f(s.rodHalfM)}" size="${f(SPRING_ROD_RADIUS_M)}" mass="${f(s.rodKg)}"/>`,
      `${indent}</body>`,
    ],
    equality: [`    <joint name="spring-latch" joint1="spring" polycoef="${f(s.strokeM)} 0 0 0 0" active="true" solref="${f(LATCH_SOLREF_S)} 1" solimp="${LATCH_SOLIMP}"/>`],
  };
}

/**
 * @description One position actuator per joint in `ACTUATOR_ORDER`, force-limited to the servo's stall torque so a
 * joint asked for more saturates in the physics instead of being given torque the hardware has not got.
 * @param p - The plant specification.
 * @returns `<position/>` elements, eighteen of them.
 */
export function hexapodActuatorLines(p: HexapodPlantSpec): string[] {
  return ACTUATOR_ORDER.map((name) => {
    const j = p.joints.find((x) => x.name === name) as HexapodJointPlant;
    return `    <position name="${j.name}" joint="${j.name}" kp="${f(j.kp)}" forcelimited="true" forcerange="${f(-j.stallNm)} ${f(j.stallNm)}" ctrlrange="${f(j.range[0])} ${f(j.range[1])}"/>`;
  });
}

/** @description The model's own comment: what it is, which medium, and the modelling choices a reader must know. */
function modelComment(p: HexapodPlantSpec, m: Medium, jump: JumpOption): string[] {
  const lines = [
    `  <!-- ADR-202 spider-18: six legs of three STS3215-class position servos each, from the contract hexapod-spec.ts.`,
    `       MEDIUM: ${m.id} (${m.label}); the plant takes ONLY gravity from it (ADR-160 D7): no density, no viscosity.`,
    `       Body: the two plates as one box of the body mass (${f(p.body.massKg)} kg), inertia from the layout (six coxa-servo`,
    `       lumps at the mounts, the rest a uniform box). Self-collision is OFF (spider geoms collide with the floor only).`,
    `       Legs: capsules carrying the mass model's link masses; the tibia thins to a shin over its last ${f(ANKLE_M)} m so the`,
    `       foot sphere is the lowest point of the leg in every pose and a foot contact is a FOOT contact.`,
    `       Signs: coxa + = foot forward on every leg (left hinge -z, right +z); femur/tibia + = foot toward body -z.`,
    `       Servos: kp = stall / ${SATURATION_ERROR_RAD} rad, damping = stall / no-load speed, armature = the arm's estimate.`,
  ];
  if (jump === 'latched-spring') {
    lines.push(`       JUMP latched-spring: a double-ended rod on a slide joint along body z (k = ${f(p.spring.stiffnessNPerM)} N/m, stroke`,
      `       ${f(p.spring.strokeM)} m, ${f(p.spring.storedJ)} J wound) held by the "spring-latch" equality. Wound, the ground-side end sits`,
      `       ${f(SPRING_TIP_M)} m below the plate; the plant crouches the legs until that tip rests on the floor, then releases the`,
      `       latch and the spring pushes the body up. The winding servo and its cam are not modelled: winding is instantaneous`,
      `       on reset (the brief's 2-3 s wind happens between jumps, not during one).`);
  } else {
    lines.push('       JUMP legs-hop: no mechanism; every femur and tibia extends together at full speed (hexapod_gaits.legs_hop).');
  }
  lines.push('  -->');
  return lines;
}

/**
 * @description Which jump option a query names: `legs-hop` when absent.
 * @param id - A jump option id from a query string or a body.
 * @returns The option, or null when unknown.
 */
export function jumpOptionById(id: unknown): JumpOption | null {
  if (id === undefined || id === null || id === '') return 'legs-hop';
  return (SPIDER_18.jumpOptions as readonly string[]).includes(String(id)) ? (id as JumpOption) : null;
}

/**
 * @description The spider-18 as MuJoCo XML: a floor, the body at its stand height on a free joint, six legs, the IMU
 * and LiDAR sites, eighteen position servos, the sensors, and under `latched-spring` the piston and its latch. The
 * `<custom>` block carries the stand height so the plant reads the contract's number from the model it was handed
 * rather than restating it.
 * @param spec - The contract (`SPIDER_18`).
 * @param masses - The mass model; the brief's estimates by default.
 * @param options - The jump option and the medium (air by default).
 * @returns MJCF XML.
 * @throws MediumRefused `model_not_valid_in_medium: rigid-body-plant, <medium>` for a medium the plant declines.
 */
export function hexapodMjcf(spec: HexapodSpec = SPIDER_18, masses: HexapodMasses = BRIEF_MASSES, options: HexapodMjcfOptions = {}): string {
  const m = options.medium ?? (mediumById('air') as Medium);
  requireModelValidIn(RIGID_BODY_PLANT, m);
  const jump = options.jump ?? 'legs-hop';
  const p = hexapodPlant(spec, masses);
  const spring = jump === 'latched-spring' ? hexapodSpringLines(p, '      ') : null;
  const lines: string[] = [
    `<mujoco model="embodied-hexapod-${spec.fit}-${jump}">`,
    ...modelComment(p, m, jump),
    '  <compiler angle="radian" autolimits="true"/>',
    `  <option timestep="${f(p.timestepS)}" gravity="${v3(m.gravityMps2)}" integrator="implicitfast"/>`,
    '  <default>',
    '    <default class="floor"><geom contype="1" conaffinity="1" friction="0.8 0.005 0.0001" rgba="0.6 0.6 0.55 1"/></default>',
    '    <default class="spider"><geom contype="1" conaffinity="0" friction="0.8 0.005 0.0001" rgba="0.2 0.25 0.3 1"/></default>',
    `    <default class="foot"><geom contype="1" conaffinity="0" friction="${FOOT_FRICTION}" rgba="0.9 0.5 0.1 1"/></default>`,
    '  </default>',
    '  <custom>',
    `    <numeric name="standHeightM" data="${f(p.standHeightM)}"/>`,
    '  </custom>',
    '  <worldbody>',
    '    <geom name="floor" class="floor" type="plane" size="5 5 0.1"/>',
    '    <light pos="0 0 2" dir="0 0 -1"/>',
    `    <body name="body" pos="0 0 ${f(p.standHeightM)}" quat="1 0 0 0">`,
    '      <freejoint name="body-free"/>',
    `      <inertial pos="0 0 0" mass="${f(p.body.massKg)}" diaginertia="${f(p.body.ixx)} ${f(p.body.iyy)} ${f(p.body.izz)}"/>`,
    `      <geom name="body-plates" class="spider" type="box" size="${v3(p.body.halfM)}"/>`,
    '      <site name="imu" pos="0 0 0" size="0.004" rgba="1 0 0 1"/>',
    `      <site name="lidar" pos="${f(p.lidar.xM)} 0 ${f(p.lidar.zM)}" size="0.004" rgba="0 1 0 1"/>`,
    ...LEG_IDS.flatMap((leg) => hexapodLegLines(p, leg, '      ')),
    ...(spring ? spring.body : []),
    '    </body>',
    '  </worldbody>',
    '  <actuator>',
    ...hexapodActuatorLines(p),
    '  </actuator>',
    ...(spring ? ['  <equality>', ...spring.equality, '  </equality>'] : []),
    '  <sensor>',
    '    <gyro name="gyro" site="imu"/>',
    '    <accelerometer name="accel" site="imu"/>',
    '    <framequat name="imu-quat" objtype="site" objname="imu"/>',
    '  </sensor>',
    '</mujoco>',
  ];
  return lines.join('\n') + '\n';
}
