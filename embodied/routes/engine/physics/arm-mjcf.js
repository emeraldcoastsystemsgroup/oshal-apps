"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the printed arm in MuJoCo, generated from the
 *                     |                             | arm's parts model (ADR-152 D1/D5 task 3): the body chain follows
 *                     |                             | the joint table exactly (each body's joint turns about its own z,
 *                     |                             | the next body sits at (a, 0, d) turned by the twist), each link's
 *                     |                             | mass is where the sizing puts it so the physics can check the
 *                     |                             | sizing, each joint is a position servo limited to its drive's
 *                     |                             | stall torque with the gearbox's reflected inertia, the gripper
 *                     |                             | is the printed one (a fixed jaw and a jaw swinging on the grip
 *                     |                             | servo, its squeeze limited), on a bench with a block to pick.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | B22: the arm's body chain, self-collision exclusions, actuators and the radian preamble are exported helpers (`armChainLines`, `armExcludes`, `armActuatorLines`, `ARM_PREAMBLE`) so the bench model and the room model are the SAME arm — a second hand-written chain is how the check and the world drift into two different arms. The base cylinder's radius and half-height are named (`ARM_BASE_RADIUS_M`, `ARM_BASE_HALF_M`): the room model has to know the footprint the arm stands on.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARM_GEOM_DEFAULT = exports.ARM_PREAMBLE = exports.ARM_BASE_HALF_M = exports.ARM_BASE_RADIUS_M = exports.BLOCK_MASS_KG = exports.BLOCK_HALF_M = exports.GRIP_TORQUE_NM = exports.SERVO_ARMATURE_KGM2 = exports.SATURATION_ERROR_RAD = exports.ARM_TIMESTEP_S = void 0;
exports.armPlant = armPlant;
exports.armChainLines = armChainLines;
exports.armExcludes = armExcludes;
exports.armActuatorLines = armActuatorLines;
exports.armMjcf = armMjcf;
const arm_design_1 = require("../design/arm-design");
/** Physics step (s). */
exports.ARM_TIMESTEP_S = 0.002;
/** A servo reaches its stall torque at this position error (rad): the proportional gain of the modelled servo. */
exports.SATURATION_ERROR_RAD = 0.05;
/** The reflected rotor inertia of one 1:345 servo at its output (kg·m²), times the belt ratio squared. An estimate. */
exports.SERVO_ARMATURE_KGM2 = 0.01;
/** The torque the node lets the gripper squeeze with (N·m): its torque-limit register, not its stall. A 50 g block
 * with rubber pads needs a quarter of a newton to hold; this is about three newtons at the jaw, and the squeeze reacts
 * back through the arm, so a larger limit saturates the base servo on contact. */
exports.GRIP_TORQUE_NM = 0.15;
/** The block the baseline picks: a 30 mm cube of 50 g. */
exports.BLOCK_HALF_M = 0.015;
exports.BLOCK_MASS_KG = 0.05;
/** @description The printed base's radius (m) — the footprint the arm stands on, and what a room's solids must clear. */
exports.ARM_BASE_RADIUS_M = 0.06;
/** @description Half the base's height (m): the shoulder frame sits on top of it. */
exports.ARM_BASE_HALF_M = 0.026;
const LINK_RADIUS_M = 0.017;
/** How far back from the tool point the gripper's own body stops: the jaws occupy this zone. */
const GRIPPER_JAW_ZONE_M = 0.05;
const f = (v) => (Math.abs(v) < 1e-12 ? '0' : Number(v.toFixed(6)).toString());
/**
 * @description The arm's plant numbers for a fit.
 * @param fit - The arm fit.
 * @returns Joints (range, torques, gains), masses, joint table, gripper, the sizing's worst poses.
 */
function armPlant(fit) {
    const d = (0, arm_design_1.buildArm)(fit);
    const joints = d.joints.map((j, i) => {
        const out = j.drive?.output;
        const stallNm = out?.stallNm ?? d.fit.servo.stallNm;
        const servos = j.drive?.cfg.servos ?? 1;
        const ratio = j.drive?.cfg.ratio ?? 1;
        const armature = exports.SERVO_ARMATURE_KGM2 * servos * ratio * ratio;
        const kp = stallNm / exports.SATURATION_ERROR_RAD;
        // A motor's torque falls in a line from stall at rest to nothing at its no-load speed: that slope IS the joint's
        // damping. An invented damping ratio instead makes the servo fight itself — at a tenth of the no-load speed the
        // elbow was already at its stall torque with nothing to carry.
        const damping = (d.fit.servo.stallNm * servos * ratio * ratio) / d.fit.servo.noLoadRadS;
        return { name: `j${i + 1}`, range: [d.spec.joints[i].min, d.spec.joints[i].max], stallNm, usableNm: out?.usableNm ?? stallNm / 2, kp, armature, damping };
    });
    return {
        fit, joints, linkMassesKg: d.linkMassesKg, payloadKg: d.fit.payloadKg,
        dh: d.spec.joints.map((j) => [j.d, j.a, j.alpha]),
        jawOpeningM: d.fit.layout.jawOpeningMm / 1000, gripTorqueNm: exports.GRIP_TORQUE_NM,
        worst: (0, arm_design_1.worstLoads)(d.spec, d.fit.payloadKg).torque,
    };
}
/** @description A quaternion (w x y z) for a rotation about x. */
const rx = (alpha) => `${f(Math.cos(alpha / 2))} ${f(Math.sin(alpha / 2))} 0 0`;
/** @description Link k's geometry: a capsule over its segment carrying its mass at the midpoint, or a sphere when the segment is empty. */
function linkGeom(k, d, a, massKg) {
    if (Math.hypot(a, d) < 1e-9)
        return `<geom name="link${k}" type="sphere" size="${f(LINK_RADIUS_M + 0.004)}" mass="${f(massKg)}" rgba="0.85 0.55 0.2 1"/>`;
    if (k < 6)
        return `<geom name="link${k}" type="capsule" fromto="0 0 0 ${f(a)} 0 ${f(d)}" size="${f(LINK_RADIUS_M)}" mass="${f(massKg)}" rgba="0.85 0.55 0.2 1"/>`;
    // The gripper: its mass is lumped where the sizing lumps it (the segment's middle) but the shape that can strike
    // anything stops above the jaws — the jaws below it are the parts that touch the object.
    return [
        `<geom name="link6-mass" type="capsule" fromto="0 0 0 ${f(a)} 0 ${f(d)}" size="${f(LINK_RADIUS_M)}" mass="${f(massKg)}" contype="0" conaffinity="0" rgba="0.85 0.55 0.2 0.35"/>`,
        `<geom name="link6" type="capsule" fromto="0 0 0 ${f(a * (1 - GRIPPER_JAW_ZONE_M / Math.max(1e-6, Math.hypot(a, d))))} 0 ${f(d - GRIPPER_JAW_ZONE_M)}" size="${f(LINK_RADIUS_M)}" mass="0.000001" rgba="0.85 0.55 0.2 1"/>`,
    ].join('\n      ');
}
/** @description The gripper in the tool-roll body: fixed jaw, swinging jaw, the tool point, the payload mount. */
function gripper(p, toolM) {
    const half = p.jawOpeningM / 2;
    return [
        `<geom name="palm" type="box" pos="0 0 ${f(toolM - 0.058)}" size="0.03 0.02 0.012" mass="0.001" rgba="0.3 0.3 0.3 1"/>`,
        // The jaws end AT the tool point, never past it: a jaw tip below the tool point digs into the bench the moment the
        // tool is sent to an object standing on it.
        `<geom name="jaw-fixed" type="box" pos="${f(-half - 0.004)} 0 ${f(toolM - 0.025)}" size="0.004 0.008 0.025" mass="0.001" friction="1.2 0.02 0.001" condim="4" rgba="0.2 0.2 0.2 1"/>`,
        `<body name="jaw" pos="${f(half + 0.004)} 0 ${f(toolM - 0.055)}">`,
        `  <joint name="grip" type="hinge" axis="0 1 0" range="-0.6 0.05" damping="0.05" armature="${f(exports.SERVO_ARMATURE_KGM2)}"/>`,
        `  <geom name="jaw-moving" type="box" pos="0 0 0.0275" size="0.004 0.008 0.0275" mass="0.001" friction="1.2 0.02 0.001" condim="4" rgba="0.2 0.2 0.2 1"/>`,
        '</body>',
        `<site name="tcp" pos="0 0 ${f(toolM)}" size="0.004" rgba="1 0 0 1"/>`,
        `<body name="payload" pos="0 0 ${f(toolM)}"><geom name="payload" type="sphere" size="0.005" mass="0.000001" contype="0" conaffinity="0" rgba="0 0 1 0.3"/></body>`,
    ];
}
/**
 * @description The MJCF for the arm on its bench with a block: what the engine container loads for the arm check.
 * @param fit - The arm fit.
 * @returns MJCF XML.
 */
/** @description The compiler/option/default header every arm model shares. RADIANS are declared explicitly: MuJoCo reads
 * angles as DEGREES unless a model says otherwise, and an arm whose limits are read as degrees has no reachable workspace. */
exports.ARM_PREAMBLE = [
    '  <compiler angle="radian" autolimits="true"/>',
    `  <option timestep="${exports.ARM_TIMESTEP_S}" integrator="implicitfast" gravity="0 0 -9.81"/>`,
];
/** @description The arm's own geom defaults. MJCF allows exactly ONE top-level `<default>`, so a model that adds a class nests it here. */
exports.ARM_GEOM_DEFAULT = '<geom contype="1" conaffinity="1" friction="0.8 0.01 0.001"/>';
/**
 * @description The arm's body chain and gripper as MJCF lines, from the base frame outward. Shared by the bench model
 * (the sizing check) and the room model (the arm standing in a scene) so the two can never drift into different arms.
 * @param p - The plant specification for a fit.
 * @param indent - The indentation the first body starts at.
 * @returns The lines, already closed.
 */
function armChainLines(p, indent) {
    const lines = [];
    const open = [];
    let at = indent;
    p.dh.forEach(([d, a, alpha], i) => {
        const prev = i === 0 ? null : p.dh[i - 1];
        const pos = prev ? `${f(prev[1])} 0 ${f(prev[0])}` : '0 0 0';
        const quat = prev ? rx(prev[2]) : '1 0 0 0';
        const j = p.joints[i];
        lines.push(`${at}<body name="link${i + 1}" pos="${pos}" quat="${quat}">`);
        lines.push(`${at}  <joint name="${j.name}" type="hinge" axis="0 0 1" range="${f(j.range[0])} ${f(j.range[1])}" armature="${f(j.armature)}" damping="${f(j.damping)}"/>`);
        lines.push(`${at}  ${linkGeom(i + 1, d, a, p.linkMassesKg[i])}`);
        open.push(at);
        at += '  ';
    });
    // The tool frame sits at (a6, 0, d6) in link6: the gripper lives there, its jaws closing across the roll axis.
    for (const g of gripper(p, p.dh[5][0]))
        lines.push(`${at}${g}`);
    while (open.length)
        lines.push(`${open.pop()}</body>`);
    return lines;
}
/**
 * @description The self-collision exclusions. The arm's links are lumped capsules that overlap around the zero-length
 * wrist and elbow frames: they are not allowed to collide with each other, only with whatever else is in the world.
 * @returns `<exclude/>` elements.
 */
function armExcludes() {
    const bodies = ['link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'jaw'];
    const out = ['<exclude body1="world" body2="link1"/>'];
    for (let i = 0; i < bodies.length; i += 1)
        for (let k = i + 1; k < bodies.length; k += 1)
            out.push(`<exclude body1="${bodies[i]}" body2="${bodies[k]}"/>`);
    return out;
}
/**
 * @description One position actuator per joint plus the grip, each force-limited to the servo's own stall torque, so a
 * joint the model asks too much of saturates in the physics instead of being given torque the hardware has not got.
 * @param p - The plant specification.
 * @returns `<position/>` elements.
 */
function armActuatorLines(p) {
    const out = p.joints.map((j) => `    <position name="${j.name}" joint="${j.name}" kp="${f(j.kp)}" forcelimited="true" forcerange="${f(-j.stallNm)} ${f(j.stallNm)}" ctrlrange="${f(j.range[0])} ${f(j.range[1])}"/>`);
    out.push(`    <position name="grip" joint="grip" kp="${f(p.gripTorqueNm / 0.1)}" forcelimited="true" forcerange="${f(-p.gripTorqueNm)} ${f(p.gripTorqueNm)}" ctrlrange="-0.6 0.05"/>`);
    return out;
}
/**
 * @description The MJCF for the arm on its bench with a block: what the engine container loads for the arm check.
 * @param fit - The arm fit.
 * @returns MJCF XML.
 */
function armMjcf(fit) {
    const p = armPlant(fit);
    const lines = [
        `<mujoco model="embodied-arm-${fit}">`,
        ...exports.ARM_PREAMBLE,
        `  <default>${exports.ARM_GEOM_DEFAULT}</default>`,
        '  <worldbody>',
        '    <geom name="bench" type="plane" size="1 1 0.1" rgba="0.6 0.6 0.55 1"/>',
        '    <light pos="0 0 2" dir="0 0 -1"/>',
        `    <geom name="base" type="cylinder" pos="0 0 ${f(exports.ARM_BASE_HALF_M)}" size="${f(exports.ARM_BASE_RADIUS_M)} ${f(exports.ARM_BASE_HALF_M)}" contype="0" conaffinity="0" rgba="0.4 0.4 0.4 1"/>`,
        `    <body name="block" pos="0.25 0 ${f(exports.BLOCK_HALF_M)}"><freejoint name="block"/><geom name="block" type="box" size="${f(exports.BLOCK_HALF_M)} ${f(exports.BLOCK_HALF_M)} ${f(exports.BLOCK_HALF_M)}" mass="${f(exports.BLOCK_MASS_KG)}" friction="1.0 0.02 0.001" condim="4" rgba="0.1 0.5 0.9 1"/></body>`,
        '    <site name="place" pos="0.2 -0.15 0.001" size="0.02 0.02 0.001" type="box" rgba="0 1 0 0.4"/>',
        ...armChainLines(p, '    '),
        '  </worldbody>',
        `  <contact>${armExcludes().join('')}</contact>`,
        '  <actuator>',
        ...armActuatorLines(p),
        '  </actuator>',
        '</mujoco>',
    ];
    return lines.join('\n') + '\n';
}
//# sourceMappingURL=arm-mjcf.js.map