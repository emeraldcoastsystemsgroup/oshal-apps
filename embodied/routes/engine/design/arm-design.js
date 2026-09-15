"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the arm we print (ADR-151 "the hands", ADR-152 D1:
 *                     |                             | one parts model, three consumers). A desk-class six-axis arm on
 *                     |                             | serial-bus servos, the same Denavit–Hartenberg pattern as the
 *                     |                             | sim-6 so the sim's kinematics and inverse kinematics serve it
 *                     |                             | unchanged. Every number comes from the parts model: link masses
 *                     |                             | from the printed parts and the servos they carry, the gravity
 *                     |                             | torque at every joint over a pose search, the drive each joint
 *                     |                             | is given (one or two servos, direct or through a belt), the
 *                     |                             | commanded speeds, the mass budget, the bill of materials and the
 *                     |                             | tool's repeatability budget from the servo's measured backlash.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BENCH_CLEARANCE_M = exports.ARM_FITS = exports.ALPHA_DESIGN_RADS2 = void 0;
exports.armSpecFor = armSpecFor;
exports.gravityTorques = gravityTorques;
exports.aboveTheBench = aboveTheBench;
exports.worstLoads = worstLoads;
exports.buildArm = buildArm;
exports.buildArmFrom = buildArmFrom;
exports.repeatabilityBudget = repeatabilityBudget;
exports.armFitById = armFitById;
const arm_model_1 = require("../arm/arm-model");
const mjcf_1 = require("../physics/mjcf");
const transform_1 = require("../math/transform");
const arm_parts_1 = require("./arm-parts");
const servos_1 = require("./servos");
/** The angular acceleration a vertical-axis joint is sized to deliver with the arm stretched (rad/s²). */
exports.ALPHA_DESIGN_RADS2 = 4;
const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;
exports.ARM_FITS = {
    'desk-6': {
        id: 'desk-6',
        label: 'Desk-6 — the arm we print first: six axes on 12 V serial-bus servos, 0.415 m reach, 0.15 kg payload, bolted to a bench',
        // 160 / 160 mm links: the longest pair whose shoulder two direct servos still hold with margin (the sizing table
        // in the design document shows 180 / 180 needing a belt stage at this payload).
        layout: { shoulderMm: 110, upperArmMm: 160, forearmMm: 160, toolMm: 95, baseDiameterMm: 120, baseHeightMm: 52, turntableDiameterMm: 104, turntableMm: 10, linkWidthMm: 34, linkHeightMm: 34, wallMm: 2.4, jawOpeningMm: 45 },
        servo: servos_1.STS3215_12V,
        payloadKg: 0.15,
        // The elbow's zero has the forearm square to the upper arm, so its straight pose is −90°: the limits are a fold of
        // 150° either side of straight, which is what lets the tool reach down over the bench on the elbow-up branch.
        // The wrist pitch needs ±135° for the same reason — with less, a tool pointing straight down is out of reach.
        limits: [[-150 * DEG, 150 * DEG], [-100 * DEG, 100 * DEG], [-240 * DEG, 60 * DEG], [-150 * DEG, 150 * DEG], [-135 * DEG, 135 * DEG], [-170 * DEG, 170 * DEG]],
    },
};
const JOINT_NAMES = ['base yaw', 'shoulder pitch', 'elbow pitch', 'forearm roll', 'wrist pitch', 'tool roll'];
/**
 * @description The sim-6's Denavit–Hartenberg pattern with this arm's lengths, masses, limits and speeds.
 * @param fit - The fit. @param linkMassesKg - Mass carried by each joint. @param speeds - Commanded speed per joint (rad/s).
 * @returns The arm spec; the payload is not part of it (toolMass 0).
 */
function armSpecFor(fit, linkMassesKg, speeds) {
    const l = fit.layout;
    const rows = [[l.shoulderMm / 1000, 0, HALF_PI], [0, l.upperArmMm / 1000, 0], [0, 0, -HALF_PI], [l.forearmMm / 1000, 0, HALF_PI], [0, 0, -HALF_PI], [l.toolMm / 1000, 0, 0]];
    return {
        id: fit.id,
        joints: rows.map(([d, a, alpha], i) => ({ d, a, alpha, min: fit.limits[i][0], max: fit.limits[i][1], maxSpeed: speeds[i], linkMass: linkMassesKg[i] })),
        toolMass: 0,
    };
}
/** @description Every point mass of the arm in a configuration: each link at its segment's midpoint, the payload at the tool. */
function pointMasses(spec, q, payloadKg) {
    const { frames } = (0, arm_model_1.forwardKinematics)(spec, q);
    const origins = [[0, 0, 0], ...frames.map(transform_1.position)];
    const axes = [[0, 0, 1], ...frames.map((f) => [f[2], f[6], f[10]])];
    const masses = spec.joints.map((j, i) => ({ k: i + 1, m: j.linkMass, p: [(origins[i][0] + origins[i + 1][0]) / 2, (origins[i][1] + origins[i + 1][1]) / 2, (origins[i][2] + origins[i + 1][2]) / 2] }));
    masses.push({ k: 6, m: payloadKg, p: origins[6] });
    return { origins, axes, masses };
}
/**
 * @description The gravity torque each joint's servo must hold in a configuration (N·m), payload at the tool.
 * @param spec - The arm. @param q - Joint angles. @param payloadKg - Held mass.
 * @returns Six torques about the joint axes.
 */
function gravityTorques(spec, q, payloadKg) {
    const { origins, axes, masses } = pointMasses(spec, q, payloadKg);
    return spec.joints.map((_, i) => {
        const o = origins[i];
        const z = axes[i];
        let tau = 0;
        for (const pm of masses) {
            if (pm.k < i + 1)
                continue;
            const r = [pm.p[0] - o[0], pm.p[1] - o[1], pm.p[2] - o[2]];
            // (r × F)·z with F = (0, 0, −m g): r × F = (−r_y m g, r_x m g, 0).
            tau += (-r[1] * pm.m * mjcf_1.G_MPS2) * z[0] + (r[0] * pm.m * mjcf_1.G_MPS2) * z[1];
        }
        return tau;
    });
}
/** The arm is bolted to a bench: no part of it may be sized in a pose that has it reaching through the bench top. The
 * clearance is the links' own radius plus a margin — an endpoint above the bench with the link below it is still a
 * pose the arm cannot take, and the physics check refuses it. */
exports.BENCH_CLEARANCE_M = 0.035;
/** @description True when every joint frame, every link's middle and the tool sit above the bench in a configuration. */
function aboveTheBench(spec, q) {
    const { frames } = (0, arm_model_1.forwardKinematics)(spec, q);
    const origins = [[0, 0, 0], ...frames.map(transform_1.position)];
    for (let i = 1; i < origins.length; i += 1) {
        if (origins[i][2] < exports.BENCH_CLEARANCE_M)
            return false;
        if ((origins[i][2] + origins[i - 1][2]) / 2 < exports.BENCH_CLEARANCE_M)
            return false;
    }
    return true;
}
/** @description The moment of inertia of every point mass about a vertical axis through the base (kg·m²). */
function verticalInertia(spec, q, payloadKg) {
    return pointMasses(spec, q, payloadKg).masses.reduce((a, pm) => a + pm.m * (pm.p[0] * pm.p[0] + pm.p[1] * pm.p[1]), 0);
}
/**
 * @description The worst gravity torque at every joint over the configurations the limits allow: a 15° grid over the
 * joints that move mass against gravity (J2, J3, J5 and the forearm roll's quarter turns), refined a degree at a time.
 * @param spec - The arm. @param payloadKg - Held mass.
 * @returns Per joint: the torque magnitude and the pose; plus the largest vertical inertia (the stretched arm).
 */
function worstLoads(spec, payloadKg) {
    const lim = spec.joints.map((j) => [j.min, j.max]);
    const grid = (i, step) => { const out = []; for (let v = lim[i][0]; v <= lim[i][1] + 1e-9; v += step)
        out.push(v); return out; };
    const best = spec.joints.map(() => ({ nm: 0, q: [0, 0, 0, 0, 0, 0] }));
    let inertia = 0;
    const consider = (q) => {
        if (!aboveTheBench(spec, q))
            return;
        gravityTorques(spec, q, payloadKg).forEach((t, i) => { if (Math.abs(t) > best[i].nm)
            best[i] = { nm: Math.abs(t), q: [...q] }; });
        inertia = Math.max(inertia, verticalInertia(spec, q, payloadKg));
    };
    for (const q2 of grid(1, 15 * DEG))
        for (const q3 of grid(2, 15 * DEG))
            for (const q4 of [0, HALF_PI, -HALF_PI])
                for (const q5 of grid(4, 15 * DEG))
                    consider([0, q2, q3, q4, q5, 0]);
    // Refine each joint's own worst pose, one coordinate at a time.
    best.forEach((b, i) => {
        let q = [...b.q];
        for (let round = 0; round < 3; round += 1)
            for (const c of [1, 2, 3, 4]) {
                for (let dv = -15; dv <= 15; dv += 1) {
                    const cand = [...q];
                    cand[c] = Math.min(lim[c][1], Math.max(lim[c][0], q[c] + dv * DEG));
                    if (!aboveTheBench(spec, cand))
                        continue;
                    const t = Math.abs(gravityTorques(spec, cand, payloadKg)[i]);
                    if (t > best[i].nm) {
                        best[i] = { nm: t, q: cand };
                    }
                }
                q = [...best[i].q];
            }
    });
    return { torque: best, inertiaKgM2: inertia };
}
const bought = (id, name, qty, massEachG, role, approxUsdEach) => ({ id, name, qty, massEachG, role, approxUsdEach });
/** @description Where the servos sit: the link each one rotates with (the base-yaw servo is in the fixed base). */
function servoLinks(shoulderServos) {
    // J1 in the base (0); J2 in the shoulder bracket (1); J3 at the upper-arm tip (2); J4 in the elbow bracket (3);
    // J5 at the forearm's wrist end — on the wrist-pitch axis, lumped with link 5 where it has no lever about J5; J6 in
    // the wrist bracket (5); the gripper servo in the gripper body (6).
    return [0, ...Array(shoulderServos).fill(1), 2, 3, 5, 5, 6];
}
/** @description Link masses (kg) from the printed parts, the servos and any belt hardware. */
function linkMasses(parts, servo, shoulderServos, beltJoints) {
    const g = [0, 0, 0, 0, 0, 0, 0];
    for (const p of parts)
        g[p.link] += p.qty * p.massEachG;
    for (const k of servoLinks(shoulderServos))
        g[k] += servo.massG;
    for (const j of beltJoints)
        g[j] += BELT_KIT_G;
    return g.slice(1).map((v) => v / 1000);
}
/** Pulleys, belt, two 608 bearings and a shaft for one belt stage (g). */
const BELT_KIT_G = 45;
/** @description The bought parts for the arm as designed. */
function boughtParts(fit, servoCount, shoulderServos, beltJoints) {
    const s = fit.servo;
    const list = [
        bought('servo', s.name, servoCount, s.massG, 'every joint and the gripper on one serial bus; 12-bit magnetic encoder feedback per joint', s.approxUsdEach),
        bought('bearing-6807', '6807ZZ thin-section ball bearing, 35 × 47 × 7 mm', 1, 22, 'carries the turntable so the base-yaw servo turns it without bending loads', 6),
    ];
    if (shoulderServos === 1)
        list.push(bought('idler', '608ZZ bearing + 8 × 40 mm shaft', 1, 28, 'the shoulder\'s far pivot', 3));
    if (beltJoints.length)
        list.push(bought('belt-kit', 'GT2 belt stage: 20T and 40T/60T pulleys, closed 6 mm belt, two 608ZZ, 8 mm shaft', beltJoints.length, BELT_KIT_G, `the reduction at joint${beltJoints.length > 1 ? 's' : ''} ${beltJoints.map((j) => `J${j}`).join(', ')}`, 12));
    list.push(bought('bus', 'serial-bus servo adapter (USB to TTL half-duplex)', 1, 10, 'the node computer\'s link to the servo bus', 12), bought('node', 'Raspberry Pi Zero 2 W', 1, 11, 'the arm-node client only; plans, maps and guards run in the swarm', 18), bought('psu', '12 V 10 A supply', 1, 0, 'off the arm; headroom for the shoulder and elbow at their continuous limit', 20), bought('estop', 'latching mushroom e-stop, ≥ 10 A DC, in the 12 V servo feed', 1, 0, 'the hardware e-stop a kinetic (class 2) node needs: it cuts servo power, not software', 12), bought('hardware', 'M2/M3 screws, M4 bench bolts, zip ties, bus extension leads', 1, 30, '', 12));
    return list;
}
const PRINT_RULES = [
    'Measure the servo you bought before printing: the case (length × width × height), the spline offset from the case centre and the horn disc diameter go into the servo spec, and every pocket and hub follows them. The spline offset and horn figures here are measured, not published.',
    'Print one cradle first (the elbow bracket) and test-fit a servo: the pockets are the case plus 0.3 mm per side.',
    'PETG for every structural part, TPU for the jaw pads. No PLA in the shoulder: it creeps under a held load in a warm room.',
    'Weigh every part as it comes off the bed; the budget is a budget, not a measurement.',
    'Drill each horn\'s pilot holes through the horn itself as a template, into its printed recess.',
];
/**
 * @description The complete arm for a fit, every number derived from the parts model; memoised per catalogued fit.
 * @param fitId - Which fit.
 * @returns The design, with any joint no drive can hold listed in `undersized`.
 */
function buildArm(fitId) {
    const cached = CACHE.get(fitId);
    if (cached)
        return cached;
    const design = buildArmFrom(exports.ARM_FITS[fitId]);
    CACHE.set(fitId, design);
    return design;
}
/**
 * @description The design for any fit specification, catalogued or not: what the sizing table sweeps.
 * @param fit - The fit specification.
 * @returns The design.
 */
function buildArmFrom(fit) {
    const s = fit.servo;
    let shoulderServos = 1;
    let beltJoints = [];
    let design = null;
    for (let round = 0; round < 3; round += 1) {
        const parts = (0, arm_parts_1.armPrintedParts)(fit.layout, s, shoulderServos);
        const masses = linkMasses(parts, s, shoulderServos, beltJoints);
        const provisional = armSpecFor(fit, masses, fit.limits.map(() => 1));
        const loads = worstLoads(provisional, fit.payloadKg);
        const joints = loads.torque.map((t, i) => {
            const inertialNm = i === 0 ? loads.inertiaKgM2 * exports.ALPHA_DESIGN_RADS2 : 0;
            const requiredNm = t.nm * servos_1.DYNAMIC_ALLOWANCE + inertialNm;
            return { joint: i + 1, name: JOINT_NAMES[i], gravityNm: t.nm, worstQ: t.q, inertialNm, requiredNm, drive: (0, servos_1.chooseDrive)(s, requiredNm, i === 1 ? servos_1.DRIVE_OPTIONS : servos_1.DRIVE_OPTIONS.filter((o) => o.servos === 1)) };
        });
        const nextShoulder = joints[1].drive?.cfg.servos ?? 1;
        const nextBelts = joints.filter((j) => (j.drive?.cfg.ratio ?? 1) > 1).map((j) => j.joint);
        const speeds = joints.map((j) => j.drive?.output.commandedRadS ?? s.noLoadRadS * 0.4);
        const spec = armSpecFor(fit, masses, speeds);
        const servoCount = 5 + shoulderServos + 1;
        const boughtList = boughtParts(fit, servoCount, shoulderServos, beltJoints);
        const printedG = parts.filter((p) => p.link > 0).reduce((a, p) => a + p.qty * p.massEachG, 0);
        const servosG = (servoCount - 1) * s.massG;
        design = {
            fit, parts, bought: boughtList, joints, spec, linkMassesKg: masses,
            massBudget: { printedG, servosG, movingG: Math.round(masses.reduce((a, m) => a + m, 0) * 1000), payloadG: Math.round(fit.payloadKg * 1000) },
            reachM: (0, arm_model_1.maxReach)(spec), repeatability: repeatabilityBudget(spec), servoCount,
            approxUsd: Math.round(boughtList.reduce((a, b) => a + b.qty * b.approxUsdEach, 0)),
            undersized: joints.filter((j) => !j.drive).map((j) => `J${j.joint} ${j.name} needs ${j.requiredNm.toFixed(2)} N·m continuous; no drive option holds it`),
            printRules: PRINT_RULES,
        };
        if (nextShoulder === shoulderServos && nextBelts.join() === beltJoints.join())
            break;
        shoulderServos = nextShoulder;
        beltJoints = nextBelts;
    }
    return design;
}
const CACHE = new Map();
/**
 * @description The tool's repeatability budget from the servo's measured backlash: each pitch and yaw joint's play
 * times its lever to the tool in the stretched pose, stacked worst case and as a root sum of squares.
 * @param spec - The arm. @returns Millimetres.
 */
function repeatabilityBudget(spec) {
    const b = servos_1.BACKLASH_DEG * DEG;
    const upper = spec.joints[1].a;
    const fore = spec.joints[3].d;
    const tool = spec.joints[5].d;
    // Base yaw and shoulder swing the whole reach; the elbow the forearm and tool; the wrist pitch the tool; the rolls none.
    const levers = [upper + fore + tool, upper + fore + tool, fore + tool, 0, tool, 0];
    return { worstMm: Math.round(levers.reduce((a, l) => a + b * l, 0) * 10000) / 10, rssMm: Math.round(Math.sqrt(levers.reduce((a, l) => a + (b * l) ** 2, 0)) * 10000) / 10 };
}
/** @description Resolve an arm fit id, or null. */
function armFitById(id) {
    return id === 'desk-6' ? id : null;
}
//# sourceMappingURL=arm-design.js.map