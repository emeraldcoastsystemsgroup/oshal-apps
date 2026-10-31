"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LATCH_SOLREF_S = exports.SPRING_DAMPING_NSM = exports.SPRING_TIP_M = exports.SPRING_ROD_RADIUS_M = exports.SPRING_ROD_KG = exports.FOOT_FRICTION = exports.LATCH_SOLIMP = exports.ANKLE_M = exports.SHIN_RADIUS_M = exports.LEG_RADIUS_M = void 0;
exports.hexapodBodyInertia = hexapodBodyInertia;
exports.hexapodPlant = hexapodPlant;
exports.hexapodLegLines = hexapodLegLines;
exports.hexapodSpringLines = hexapodSpringLines;
exports.hexapodActuatorLines = hexapodActuatorLines;
exports.jumpOptionById = jumpOptionById;
exports.hexapodMjcf = hexapodMjcf;
const hexapod_spec_1 = require("../design/hexapod-spec");
const parts_catalog_1 = require("../design/parts-catalog");
const servos_1 = require("../design/servos");
const medium_1 = require("../medium/medium");
const mjcf_1 = require("./mjcf");
const arm_mjcf_1 = require("./arm-mjcf");
/** @description A leg link's capsule radius (m): the STS3215 case is 24.7 mm wide, so a link is about that thick. */
exports.LEG_RADIUS_M = 0.012;
/** @description The shin's radius (m): the tibia thins to this over its last ANKLE_M so that the FOOT sphere, not a link's
 * rounded end, is the lowest point in every leg pose — a 12 mm end cap around an 8 mm foot touched the floor first and the
 * feet reported no contact while the body stood 4 mm high. */
exports.SHIN_RADIUS_M = 0.006;
/** @description How far back from the foot sphere's centre the tibia thins to the shin (m). */
exports.ANKLE_M = 0.03;
/** @description The latch's impedance (solimp): near-rigid, so the wound rod holds its stroke under the spring's full force
 * (measured: 0.07 mm of sag and 3.597 J held of the contract's 3.61, against 3.2 mm and 3.03 J at MuJoCo's default). */
exports.LATCH_SOLIMP = '0.999 0.9999 0.001 0.5 2';
/** @description The TPU foot cap's friction triple (slide, spin, roll): rubber-like on a dry floor. */
exports.FOOT_FRICTION = '1.0 0.005 0.0001';
/** @description The spring rod's mass (kg): an ESTIMATE until the design lane's spring parts carry a figure. */
exports.SPRING_ROD_KG = 0.04;
/** @description The spring rod's radius (m): a printed piston rod through the body centre. */
exports.SPRING_ROD_RADIUS_M = 0.006;
/** @description How far the LATCHED rod's ground-side end protrudes below the plate (m): the crouch puts this tip on the floor before the latch trips. */
exports.SPRING_TIP_M = 0.01;
/** @description The slide's own damping (N·s/m): a little, so the released rod does not ring forever at the stroke's end. */
exports.SPRING_DAMPING_NSM = 0.5;
/** @description The latch's constraint time constant (s): twice the physics step, as stiff as MuJoCo's reference solver allows. */
exports.LATCH_SOLREF_S = 2 * mjcf_1.MJCF_TIMESTEP_S;
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
function hexapodBodyInertia(spec, masses, servoMassKg) {
    const L = spec.layout.bodyLengthMm / 1000;
    const W = spec.layout.bodyWidthMm / 1000;
    const H = (spec.layout.plateGapMm + 2 * spec.layout.plateThicknessMm) / 1000;
    const massKg = masses.bodyG / 1000;
    const box = Math.max(0, massKg - 6 * servoMassKg);
    let ixx = (box * (W * W + H * H)) / 12;
    let iyy = (box * (L * L + H * H)) / 12;
    let izz = (box * (L * L + W * W)) / 12;
    for (const leg of hexapod_spec_1.LEG_IDS) {
        const x = spec.layout.coxaMounts[leg].xMm / 1000;
        const y = spec.layout.coxaMounts[leg].yMm / 1000;
        ixx += servoMassKg * y * y;
        iyy += servoMassKg * x * x;
        izz += servoMassKg * (x * x + y * y);
    }
    return { massKg, ixx, iyy, izz, halfM: [L / 2, W / 2, H / 2] };
}
/** @description The hinge axis of a joint: coxa about -z on the left and +z on the right (positive = foot forward everywhere), femur and tibia about the leg's lateral +y (positive = foot toward body -z). */
function jointAxis(leg, joint) {
    if (joint !== 'coxa')
        return [0, 1, 0];
    return leg[0] === 'L' ? [0, 0, -1] : [0, 0, 1];
}
/** @description A joint's software range in radians, from the contract's degree limits. */
function jointRange(spec, joint) {
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
function hexapodPlant(spec = hexapod_spec_1.SPIDER_18, masses = hexapod_spec_1.BRIEF_MASSES) {
    const servo = (0, servos_1.servoSpecFrom)((0, parts_catalog_1.servoRow)(spec.servoRowId));
    const joints = hexapod_spec_1.LEG_IDS.flatMap((leg) => hexapod_spec_1.LEG_JOINTS.map((joint) => ({
        name: `${leg}-${joint}`, leg, joint, axis: jointAxis(leg, joint), range: jointRange(spec, joint),
        stallNm: servo.stallNm, kp: servo.stallNm / arm_mjcf_1.SATURATION_ERROR_RAD, damping: servo.stallNm / servo.noLoadRadS, armature: arm_mjcf_1.SERVO_ARMATURE_KGM2,
    })));
    const lay = spec.layout;
    const body = hexapodBodyInertia(spec, masses, servo.massG / 1000);
    const strokeM = spec.spring.strokeMm / 1000;
    return {
        fit: spec.fit, timestepS: mjcf_1.MJCF_TIMESTEP_S, servo, joints,
        legs: hexapod_spec_1.LEG_IDS.map((id) => ({ id, mount: lay.coxaMounts[id], coxaAxisZ: id[0] === 'L' ? -1 : 1 })),
        links: { coxaM: lay.coxaMm / 1000, femurM: lay.femurMm / 1000, tibiaM: lay.tibiaMm / 1000, footCentreM: (lay.tibiaMm - lay.footRadiusMm) / 1000, footRadiusM: lay.footRadiusMm / 1000 },
        massesKg: { coxa: masses.coxaLinkG / 1000, femur: masses.femurLinkG / 1000, tibia: masses.tibiaLinkG / 1000 },
        body, standHeightM: lay.standHeightMm / 1000, lidar: { xM: lay.lidarNoseXMm / 1000, zM: lay.lidarPlaneZMm / 1000 },
        spring: { stiffnessNPerM: spec.spring.stiffnessNPerM, strokeM, storedJ: spec.spring.storedJ, rodHalfM: body.halfM[2] + exports.SPRING_TIP_M + strokeM, rodKg: exports.SPRING_ROD_KG },
        allUpKg: masses.bodyG / 1000 + 6 * (masses.coxaLinkG + masses.femurLinkG + masses.tibiaLinkG) / 1000,
    };
}
/** @description A quaternion (w x y z) for a yaw about z. */
const rz = (yawRad) => `${(0, mjcf_1.mjcfNumber)(Math.cos(yawRad / 2))} 0 0 ${(0, mjcf_1.mjcfNumber)(Math.sin(yawRad / 2))}`;
/** @description One joint element from its plant row. */
function jointLine(j) {
    return `<joint name="${j.name}" type="hinge" axis="${(0, mjcf_1.mjcfVec3)(j.axis)}" range="${(0, mjcf_1.mjcfNumber)(j.range[0])} ${(0, mjcf_1.mjcfNumber)(j.range[1])}" armature="${(0, mjcf_1.mjcfNumber)(j.armature)}" damping="${(0, mjcf_1.mjcfNumber)(j.damping)}"/>`;
}
/**
 * @description One leg's body chain: coxa (yaw in the body), femur and tibia (pitch about the leg's lateral axis), a
 * capsule per link carrying the mass model's figure, the foot sphere at the tibia's end with the TPU friction.
 * @param p - The plant specification.
 * @param leg - Which leg.
 * @param indent - The indentation the coxa body starts at.
 * @returns The lines, already closed.
 */
function hexapodLegLines(p, leg, indent) {
    const at = indent;
    const { mount } = p.legs.find((l) => l.id === leg);
    const j = (joint) => p.joints.find((x) => x.leg === leg && x.joint === joint);
    const { coxaM, femurM, footCentreM, footRadiusM } = p.links;
    return [
        `${at}<body name="${leg}-coxa" pos="${(0, mjcf_1.mjcfNumber)(mount.xMm / 1000)} ${(0, mjcf_1.mjcfNumber)(mount.yMm / 1000)} 0" quat="${rz(mount.neutralYawDeg * DEG)}">`,
        `${at}  ${jointLine(j('coxa'))}`,
        `${at}  <geom name="${leg}-coxa" class="spider" type="capsule" fromto="0 0 0 ${(0, mjcf_1.mjcfNumber)(coxaM)} 0 0" size="${(0, mjcf_1.mjcfNumber)(exports.LEG_RADIUS_M)}" mass="${(0, mjcf_1.mjcfNumber)(p.massesKg.coxa)}"/>`,
        `${at}  <body name="${leg}-femur" pos="${(0, mjcf_1.mjcfNumber)(coxaM)} 0 0">`,
        `${at}    ${jointLine(j('femur'))}`,
        `${at}    <geom name="${leg}-femur" class="spider" type="capsule" fromto="0 0 0 ${(0, mjcf_1.mjcfNumber)(femurM)} 0 0" size="${(0, mjcf_1.mjcfNumber)(exports.LEG_RADIUS_M)}" mass="${(0, mjcf_1.mjcfNumber)(p.massesKg.femur)}"/>`,
        `${at}    <body name="${leg}-tibia" pos="${(0, mjcf_1.mjcfNumber)(femurM)} 0 0">`,
        `${at}      ${jointLine(j('tibia'))}`,
        `${at}      <geom name="${leg}-tibia" class="spider" type="capsule" fromto="0 0 0 ${(0, mjcf_1.mjcfNumber)(footCentreM - exports.ANKLE_M)} 0 0" size="${(0, mjcf_1.mjcfNumber)(exports.LEG_RADIUS_M)}" mass="${(0, mjcf_1.mjcfNumber)(p.massesKg.tibia)}"/>`,
        `${at}      <geom name="${leg}-shin" class="spider" type="capsule" fromto="${(0, mjcf_1.mjcfNumber)(footCentreM - exports.ANKLE_M)} 0 0 ${(0, mjcf_1.mjcfNumber)(footCentreM - footRadiusM)} 0 0" size="${(0, mjcf_1.mjcfNumber)(exports.SHIN_RADIUS_M)}" mass="0.000001"/>`,
        `${at}      <geom name="${leg}-foot" class="foot" type="sphere" pos="${(0, mjcf_1.mjcfNumber)(footCentreM)} 0 0" size="${(0, mjcf_1.mjcfNumber)(footRadiusM)}" mass="0.000001"/>`,
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
function hexapodSpringLines(p, indent) {
    const s = p.spring;
    return {
        body: [
            `${indent}<body name="spring-rod" pos="0 0 0">`,
            `${indent}  <joint name="spring" type="slide" axis="0 0 1" range="${(0, mjcf_1.mjcfNumber)(-s.strokeM)} ${(0, mjcf_1.mjcfNumber)(s.strokeM)}" stiffness="${(0, mjcf_1.mjcfNumber)(s.stiffnessNPerM)}" springref="0" damping="${(0, mjcf_1.mjcfNumber)(exports.SPRING_DAMPING_NSM)}"/>`,
            `${indent}  <geom name="spring-rod" class="spider" type="capsule" fromto="0 0 ${(0, mjcf_1.mjcfNumber)(-s.rodHalfM)} 0 0 ${(0, mjcf_1.mjcfNumber)(s.rodHalfM)}" size="${(0, mjcf_1.mjcfNumber)(exports.SPRING_ROD_RADIUS_M)}" mass="${(0, mjcf_1.mjcfNumber)(s.rodKg)}"/>`,
            `${indent}</body>`,
        ],
        equality: [`    <joint name="spring-latch" joint1="spring" polycoef="${(0, mjcf_1.mjcfNumber)(s.strokeM)} 0 0 0 0" active="true" solref="${(0, mjcf_1.mjcfNumber)(exports.LATCH_SOLREF_S)} 1" solimp="${exports.LATCH_SOLIMP}"/>`],
    };
}
/**
 * @description One position actuator per joint in `ACTUATOR_ORDER`, force-limited to the servo's stall torque so a
 * joint asked for more saturates in the physics instead of being given torque the hardware has not got.
 * @param p - The plant specification.
 * @returns `<position/>` elements, eighteen of them.
 */
function hexapodActuatorLines(p) {
    return hexapod_spec_1.ACTUATOR_ORDER.map((name) => {
        const j = p.joints.find((x) => x.name === name);
        return `    <position name="${j.name}" joint="${j.name}" kp="${(0, mjcf_1.mjcfNumber)(j.kp)}" forcelimited="true" forcerange="${(0, mjcf_1.mjcfNumber)(-j.stallNm)} ${(0, mjcf_1.mjcfNumber)(j.stallNm)}" ctrlrange="${(0, mjcf_1.mjcfNumber)(j.range[0])} ${(0, mjcf_1.mjcfNumber)(j.range[1])}"/>`;
    });
}
/** @description The model's own comment: what it is, which medium, and the modelling choices a reader must know. */
function modelComment(p, m, jump) {
    const lines = [
        `  <!-- ADR-202 spider-18: six legs of three STS3215-class position servos each, from the contract hexapod-spec.ts.`,
        `       MEDIUM: ${m.id} (${m.label}); the plant takes ONLY gravity from it (ADR-160 D7): no density, no viscosity.`,
        `       Body: the two plates as one box of the body mass (${(0, mjcf_1.mjcfNumber)(p.body.massKg)} kg), inertia from the layout (six coxa-servo`,
        `       lumps at the mounts, the rest a uniform box). Self-collision is OFF (spider geoms collide with the floor only).`,
        `       Legs: capsules carrying the mass model's link masses; the tibia thins to a shin over its last ${(0, mjcf_1.mjcfNumber)(exports.ANKLE_M)} m so the`,
        `       foot sphere is the lowest point of the leg in every pose and a foot contact is a FOOT contact.`,
        `       Signs: coxa + = foot forward on every leg (left hinge -z, right +z); femur/tibia + = foot toward body -z.`,
        `       Servos: kp = stall / ${arm_mjcf_1.SATURATION_ERROR_RAD} rad, damping = stall / no-load speed, armature = the arm's estimate.`,
    ];
    if (jump === 'latched-spring') {
        lines.push(`       JUMP latched-spring: a double-ended rod on a slide joint along body z (k = ${(0, mjcf_1.mjcfNumber)(p.spring.stiffnessNPerM)} N/m, stroke`, `       ${(0, mjcf_1.mjcfNumber)(p.spring.strokeM)} m, ${(0, mjcf_1.mjcfNumber)(p.spring.storedJ)} J wound) held by the "spring-latch" equality. Wound, the ground-side end sits`, `       ${(0, mjcf_1.mjcfNumber)(exports.SPRING_TIP_M)} m below the plate; the plant crouches the legs until that tip rests on the floor, then releases the`, `       latch and the spring pushes the body up. The winding servo and its cam are not modelled: winding is instantaneous`, `       on reset (the brief's 2-3 s wind happens between jumps, not during one).`);
    }
    else {
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
function jumpOptionById(id) {
    if (id === undefined || id === null || id === '')
        return 'legs-hop';
    return hexapod_spec_1.SPIDER_18.jumpOptions.includes(String(id)) ? id : null;
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
function hexapodMjcf(spec = hexapod_spec_1.SPIDER_18, masses = hexapod_spec_1.BRIEF_MASSES, options = {}) {
    const m = options.medium ?? (0, medium_1.mediumById)('air');
    (0, medium_1.requireModelValidIn)(mjcf_1.RIGID_BODY_PLANT, m);
    const jump = options.jump ?? 'legs-hop';
    const p = hexapodPlant(spec, masses);
    const spring = jump === 'latched-spring' ? hexapodSpringLines(p, '      ') : null;
    const lines = [
        `<mujoco model="embodied-hexapod-${spec.fit}-${jump}">`,
        ...modelComment(p, m, jump),
        '  <compiler angle="radian" autolimits="true"/>',
        `  <option timestep="${(0, mjcf_1.mjcfNumber)(p.timestepS)}" gravity="${(0, mjcf_1.mjcfVec3)(m.gravityMps2)}" integrator="implicitfast"/>`,
        '  <default>',
        '    <default class="floor"><geom contype="1" conaffinity="1" friction="0.8 0.005 0.0001" rgba="0.6 0.6 0.55 1"/></default>',
        '    <default class="spider"><geom contype="1" conaffinity="0" friction="0.8 0.005 0.0001" rgba="0.2 0.25 0.3 1"/></default>',
        `    <default class="foot"><geom contype="1" conaffinity="0" friction="${exports.FOOT_FRICTION}" rgba="0.9 0.5 0.1 1"/></default>`,
        '  </default>',
        '  <custom>',
        `    <numeric name="standHeightM" data="${(0, mjcf_1.mjcfNumber)(p.standHeightM)}"/>`,
        '  </custom>',
        '  <worldbody>',
        '    <geom name="floor" class="floor" type="plane" size="5 5 0.1"/>',
        '    <light pos="0 0 2" dir="0 0 -1"/>',
        `    <body name="body" pos="0 0 ${(0, mjcf_1.mjcfNumber)(p.standHeightM)}" quat="1 0 0 0">`,
        '      <freejoint name="body-free"/>',
        `      <inertial pos="0 0 0" mass="${(0, mjcf_1.mjcfNumber)(p.body.massKg)}" diaginertia="${(0, mjcf_1.mjcfNumber)(p.body.ixx)} ${(0, mjcf_1.mjcfNumber)(p.body.iyy)} ${(0, mjcf_1.mjcfNumber)(p.body.izz)}"/>`,
        `      <geom name="body-plates" class="spider" type="box" size="${(0, mjcf_1.mjcfVec3)(p.body.halfM)}"/>`,
        '      <site name="imu" pos="0 0 0" size="0.004" rgba="1 0 0 1"/>',
        `      <site name="lidar" pos="${(0, mjcf_1.mjcfNumber)(p.lidar.xM)} 0 ${(0, mjcf_1.mjcfNumber)(p.lidar.zM)}" size="0.004" rgba="0 1 0 1"/>`,
        ...hexapod_spec_1.LEG_IDS.flatMap((leg) => hexapodLegLines(p, leg, '      ')),
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
//# sourceMappingURL=hexapod-mjcf.js.map