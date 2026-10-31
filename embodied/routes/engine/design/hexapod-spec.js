"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRIEF_MASSES = exports.SIGN_CONVENTION = exports.SPIDER_18 = exports.ACTUATOR_ORDER = exports.LEG_JOINTS = exports.LEG_IDS = void 0;
exports.invertedJointTargets = invertedJointTargets;
exports.mirrorLegRole = mirrorLegRole;
exports.actuatorIndex = actuatorIndex;
exports.hexapodFitById = hexapodFitById;
exports.allUpMassG = allUpMassG;
/** @description Legs in the canonical order: left side front to rear, then right side front to rear. */
exports.LEG_IDS = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
/** @description Joints in the canonical order, body outward. */
exports.LEG_JOINTS = ['coxa', 'femur', 'tibia'];
/**
 * @description The canonical 18-actuator order: `L1-coxa, L1-femur, L1-tibia, L2-coxa, … R3-tibia`. The MJCF
 * actuators, the plant's ctrl vector, the node's command arrays and the policy's action vector ALL use this order;
 * a lane that invents another order has broken the contract. Index = leg index * 3 + joint index.
 */
exports.ACTUATOR_ORDER = exports.LEG_IDS.flatMap((leg) => exports.LEG_JOINTS.map((joint) => `${leg}-${joint}`));
const SPRING_K = 5000;
const SPRING_STROKE_MM = 38;
/**
 * @description The spider-18 contract (ADR-202). Front legs point 45° forward-out, middle legs straight out, rear legs 45°
 * back-out — the classic hexapod stance that keeps the feet clear of each other through a tripod gait. The body is
 * symmetric top to bottom (two identical plates, the Pi bay centred, the LiDAR on the mid-plane) so that inverted the
 * machine is the same machine with its joint signs mirrored.
 */
exports.SPIDER_18 = Object.freeze({
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
    limits: Object.freeze({ coxaDeg: [-60, 60], femurDeg: [-120, 120], tibiaDeg: [-140, 140] }),
    servoRowId: 'sts3215-12v',
    servoCount: 18,
    boughtRowIds: Object.freeze(['pi5-8gb', 'pi5-active-cooler', 'ld19-lidar', 'bno055-imu', 'bus-servo-adapter', 'lipo-3s-2200', 'buck-5v-5a']),
    jumpOptions: Object.freeze(['legs-hop', 'latched-spring']),
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
exports.SIGN_CONVENTION = Object.freeze({
    coxa: 'positive = foot forward (+x body) on every leg',
    femur: 'positive = foot toward body -z (belly side)',
    tibia: 'positive = knee bends the foot further toward body -z',
    zeroPose: 'leg straight out horizontally along its neutral yaw',
});
/**
 * @description The inverted-walking rule. When the body is upside down the ground is at body +z, so every femur and
 * tibia target is negated; a coxa target is NOT, because forward is still forward. The leg ROLES mirror too (see
 * `mirrorLegRole`): the gait that drove L1 drives R1. Both halves of the rule are what the plant tests and the node
 * applies — one function, so they cannot drift.
 * @param targets - Eighteen targets in `ACTUATOR_ORDER`, as planned for the upright body.
 * @returns The same intent for the inverted body: coxa kept, femur and tibia negated, legs re-assigned L↔R.
 */
function invertedJointTargets(targets) {
    if (targets.length !== exports.ACTUATOR_ORDER.length)
        throw new Error(`expected ${exports.ACTUATOR_ORDER.length} targets, got ${targets.length}`);
    const out = new Array(targets.length);
    exports.LEG_IDS.forEach((leg, li) => {
        const from = exports.LEG_IDS.indexOf(mirrorLegRole(leg)) * 3;
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
function mirrorLegRole(leg) {
    return (leg[0] === 'L' ? 'R' : 'L') + leg.slice(1);
}
/**
 * @description The index of a joint in the canonical order.
 * @param leg - The leg.
 * @param joint - The joint.
 * @returns 0–17.
 */
function actuatorIndex(leg, joint) {
    return exports.LEG_IDS.indexOf(leg) * 3 + exports.LEG_JOINTS.indexOf(joint);
}
/**
 * @description The fit a query names, or null.
 * @param id - A fit id from a query string.
 * @returns The fit, or null when unknown.
 */
function hexapodFitById(id) {
    return id === undefined || id === 'spider-18' ? 'spider-18' : null;
}
/** @description The brief's mass estimates (core docs/research/spider-18-design-brief.md §1): 855 g in the body and 166 g per leg, 1851 g all up against the 1900 g target. Estimates, not measurements. */
exports.BRIEF_MASSES = Object.freeze({ bodyG: 855, coxaLinkG: 67, femurLinkG: 73, tibiaLinkG: 26 });
/**
 * @description All-up mass from a mass model (g).
 * @param m - The link masses.
 * @returns Body plus six legs.
 */
function allUpMassG(m) {
    return m.bodyG + 6 * (m.coxaLinkG + m.femurLinkG + m.tibiaLinkG);
}
//# sourceMappingURL=hexapod-spec.js.map