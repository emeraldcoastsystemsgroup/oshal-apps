"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 spider-18: the design object (brief section 3.4). Every
 *                     |                             | number is computed from the parts: the mass budget row by row
 *                     |                             | against the brief's 1900 g target, the link masses the plant's
 *                     |                             | inertia is built from, the worst stance load per joint type over
 *                     |                             | the poses the limits allow with the tripod foot load and the
 *                     |                             | arm's dynamic allowance against the servo row's continuous
 *                     |                             | torque, both jump options with the brief's figures labelled as
 *                     |                             | the brief's and feasibility left to the plant, the bought parts
 *                     |                             | from the catalog rows, the bill of materials. Nothing here is a
 *                     |                             | measurement.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOOT_FRICTION = void 0;
exports.worstStanceLoads = worstStanceLoads;
exports.buildHexapod = buildHexapod;
const mjcf_1 = require("../physics/mjcf");
const hexapod_parts_1 = require("./hexapod-parts");
const hexapod_parts_body_1 = require("./hexapod-parts-body");
const hexapod_spec_1 = require("./hexapod-spec");
const parts_catalog_1 = require("./parts-catalog");
const servos_1 = require("./servos");
const DEG = Math.PI / 180;
/** The design's assumption for a TPU foot on a dry floor: the largest horizontal push a foot transmits before it slips, as a share of its vertical load. To be measured. */
exports.FOOT_FRICTION = 0.6;
/** The brief's allowance for wiring, bus leads, straps and fasteners (g). */
const WIRING_ALLOWANCE_G = 40;
/** Feet on the ground in the tripod stance the loads are sized for. */
const TRIPOD_FEET = 3;
const ROLES = {
    'pi5-8gb': 'the node computer, in the vented bay between the plates',
    'pi5-active-cooler': 'the Pi\'s heat path, blowing through the plate vent',
    'ld19-lidar': 'the one eye: a 2-D ring in the nose, scan plane on the mid-plane',
    'bno055-imu': 'tells the controller which way is up; the inverted rule follows it',
    'bus-servo-adapter': 'the Pi\'s link to the eighteen-servo bus, on the pack\'s voltage',
    'lipo-3s-2200': 'the pack, on edge in the tail tray on the mid-plane',
    'buck-5v-5a': '5 V for the Pi 5 and the LiDAR',
    'die-spring-5n-mm': 'one each side of the piston collar: the cocked one drives the jump, the other re-centres the rod',
};
const bought = (id, name, qty, massEachG, role, approxUsdEach, source, option) => ({ id, name, qty, massEachG, role, approxUsdEach, source, ...(option ? { option } : {}) });
/** @description The bought parts: the servo row eighteen times, the catalog rows the spec names, the wiring allowance, and the jump option's spring pair and wind servo. */
function boughtParts(spec, s) {
    const list = [bought('servo', s.name, spec.servoCount, s.massG, 'every joint on one 12 V bus; the same row the printed arm uses', s.approxUsdEach, s.source)];
    for (const id of spec.boughtRowIds) {
        const row = (0, parts_catalog_1.boughtRow)(id);
        list.push(bought(id, row.name, 1, row.massG, ROLES[id] ?? '', row.approxUsd, row.source));
    }
    list.push(bought('wiring', 'Wiring, bus leads, straps, fasteners (allowance)', 1, WIRING_ALLOWANCE_G, 'the brief\'s allowance, not a measurement', 20, 'core docs/research/spider-18-design-brief.md section 1.2: a 40 g allowance'));
    const spring = (0, parts_catalog_1.boughtRow)('die-spring-5n-mm');
    list.push(bought('die-spring', spring.name, 2, spring.massG, ROLES['die-spring-5n-mm'], spring.approxUsd, spring.source, 'latched-spring'));
    list.push(bought('wind-servo', s.name, 1, s.massG, 'winds the drum and, past its detent, trips the latch (the spec\'s windServoRowId)', s.approxUsdEach, s.source, 'latched-spring'));
    return list;
}
/** @description The mass budget from the parts: base rows only in the total; each option's addition beside it. */
function massBudget(spec, printed, boughtList) {
    const rows = [];
    for (const p of printed.filter((x) => !x.option))
        rows.push({ id: p.id, name: p.name, kind: 'printed', qty: p.qty, eachG: p.massEachG, totalG: p.qty * p.massEachG, link: p.link });
    for (const b of boughtList.filter((x) => !x.option))
        rows.push({ id: b.id, name: b.name, kind: b.id === 'wiring' ? 'allowance' : 'bought', qty: b.qty, eachG: b.massEachG, totalG: b.qty * b.massEachG, link: 'body' });
    const printedG = rows.filter((r) => r.kind === 'printed').reduce((a, r) => a + r.totalG, 0);
    const boughtG = rows.filter((r) => r.kind !== 'printed').reduce((a, r) => a + r.totalG, 0);
    const totalG = printedG + boughtG;
    const optionAddedG = { 'legs-hop': 0, 'latched-spring': 0 };
    for (const opt of spec.jumpOptions) {
        optionAddedG[opt] = printed.filter((p) => p.option === opt).reduce((a, p) => a + p.qty * p.massEachG, 0) + boughtList.filter((b) => b.option === opt).reduce((a, b) => a + b.qty * b.massEachG, 0);
    }
    return { rows, totalG, targetG: spec.massTargetG, withinTarget: totalG <= spec.massTargetG, printedG, boughtG, briefTotalG: (0, hexapod_spec_1.allUpMassG)(hexapod_spec_1.BRIEF_MASSES), optionAddedG };
}
/** @description The link masses from the parts: body = plates, bay, head, tray, every bought part and the six coxa servos; each leg link = its printed part(s) plus the servo it carries. */
function linkMasses(printed, boughtList, s) {
    const each = (id) => printed.find((p) => p.id === id)?.massEachG ?? 0;
    const coxaLinkG = each('coxa-bracket') + s.massG;
    const femurLinkG = each('femur') + s.massG;
    const tibiaLinkG = each('tibia') + each('foot');
    const base = printed.filter((p) => !p.option && p.link === 'body').reduce((a, p) => a + p.qty * p.massEachG, 0) + boughtList.filter((b) => !b.option).reduce((a, b) => a + b.qty * b.massEachG, 0);
    return { bodyG: base - 12 * s.massG, coxaLinkG, femurLinkG, tibiaLinkG };
}
/** @description The three joint torques in one stance pose (N·m): the foot reaction at its lever less the links' own weight at theirs; the coxa sees the friction-limited push at the foot's reach. */
function stanceTorques(spec, m, footN, femurRad, kneeRad) {
    const f = spec.layout.femurMm / 1000;
    const t = spec.layout.tibiaMm / 1000;
    const rKnee = f * Math.cos(femurRad);
    const rFoot = rKnee + t * Math.cos(femurRad + kneeRad);
    const g = mjcf_1.G_MPS2;
    const femur = Math.abs(footN * rFoot - g * (m.femurPart * rKnee / 2 + m.servo * rKnee + m.tibiaPart * (rKnee + rFoot) / 2 + m.foot * rFoot));
    const tibia = Math.abs(footN * (rFoot - rKnee) - g * (m.tibiaPart * (rFoot - rKnee) / 2 + m.foot * (rFoot - rKnee)));
    const coxa = exports.FOOT_FRICTION * footN * (spec.layout.coxaMm / 1000 + rFoot);
    return { coxa, femur, tibia, footReachMm: spec.layout.coxaMm + rFoot * 1000 };
}
/**
 * @description The worst static load per joint type over the stance poses the limits allow: the foot on the ground at
 * the stand height, the femur swept a degree at a time through its limits, the knee on either branch that puts the foot
 * there within the tibia limits, the foot outboard of the femur axis. Three feet carry the all-up weight (tripod).
 * @param spec - The contract. @param printed - The parts (for the link masses). @param s - The servo. @param allUpG - What three feet carry.
 * @returns One entry per joint type, worst pose attached, with the requirement against the servo's continuous torque.
 */
function worstStanceLoads(spec, printed, s, allUpG) {
    const each = (id) => (printed.find((p) => p.id === id)?.massEachG ?? 0) / 1000;
    const m = { femurPart: each('femur'), tibiaPart: each('tibia'), foot: each('foot'), servo: s.massG / 1000 };
    const footN = (allUpG / 1000) * mjcf_1.G_MPS2 / TRIPOD_FEET;
    const h = spec.layout.standHeightMm;
    const f = spec.layout.femurMm;
    const t = spec.layout.tibiaMm;
    const best = { coxa: { nm: 0, pose: { femurDeg: 0, tibiaDeg: 0, footReachMm: 0, bodyHeightMm: h, feetOnGround: TRIPOD_FEET } }, femur: { nm: 0, pose: { femurDeg: 0, tibiaDeg: 0, footReachMm: 0, bodyHeightMm: h, feetOnGround: TRIPOD_FEET } }, tibia: { nm: 0, pose: { femurDeg: 0, tibiaDeg: 0, footReachMm: 0, bodyHeightMm: h, feetOnGround: TRIPOD_FEET } } };
    const [tibMin, tibMax] = spec.limits.tibiaDeg;
    for (let fd = spec.limits.femurDeg[0]; fd <= spec.limits.femurDeg[1]; fd += 1) {
        const femurRad = fd * DEG;
        const v = (h - f * Math.sin(femurRad)) / t;
        if (Math.abs(v) > 1 || f * Math.sin(femurRad) > h)
            continue;
        for (const phi of [Math.asin(v), Math.PI - Math.asin(v)]) {
            let knee = phi - femurRad;
            while (knee > Math.PI)
                knee -= 2 * Math.PI;
            while (knee <= -Math.PI)
                knee += 2 * Math.PI;
            const td = knee / DEG;
            if (td < tibMin - 1e-9 || td > tibMax + 1e-9)
                continue;
            const tau = stanceTorques(spec, m, footN, femurRad, knee);
            if (tau.footReachMm < spec.layout.coxaMm)
                continue;
            const pose = { femurDeg: fd, tibiaDeg: Math.round(td * 10) / 10, footReachMm: Math.round(tau.footReachMm * 10) / 10, bodyHeightMm: h, feetOnGround: TRIPOD_FEET };
            for (const j of ['coxa', 'femur', 'tibia'])
                if (tau[j] > best[j].nm)
                    best[j] = { nm: tau[j], pose };
        }
    }
    const usableNm = s.stallNm * servos_1.CONTINUOUS_FRACTION;
    const because = {
        coxa: `the friction-limited push a foot transmits (${exports.FOOT_FRICTION} of its ${footN.toFixed(2)} N share, a design assumption to be measured) at the foot's horizontal reach from the yaw axis; gravity turns no vertical axis`,
        femur: `the tripod foot share (${footN.toFixed(2)} N) at the foot's horizontal lever from the femur axis, less the femur, tibia servo, tibia and foot weights at theirs; the leg stretched toward horizontal is the worst`,
        tibia: `the foot share at its lever from the knee, less the tibia and foot weights; the tibia nearest horizontal with the foot on the ground is the worst`,
    };
    return ['coxa', 'femur', 'tibia'].map((joint) => {
        const staticNm = Math.round(best[joint].nm * 1000) / 1000;
        const nm = Math.round(staticNm * servos_1.DYNAMIC_ALLOWANCE * 1000) / 1000;
        return { joint, staticNm, nm, usableNm: Math.round(usableNm * 1000) / 1000, stallNm: Math.round(s.stallNm * 1000) / 1000, withinContinuous: nm <= usableNm, margin: Math.round((usableNm / nm) * 100) / 100, pose: best[joint].pose, because: because[joint] };
    });
}
/** @description The two jump options with the design's numbers; feasibility belongs to the plant. */
function jumpOptions(spec, s, allUpG, budget) {
    const g = (0, hexapod_parts_1.jumpGeometry)(spec.layout, spec.spring);
    const peakW = (s.stallNm * s.noLoadRadS) / 4;
    const m = allUpG / 1000;
    const liftJ = m * mjcf_1.G_MPS2 * 0.05;
    const withSpring = allUpG + budget.optionAddedG['latched-spring'];
    const drum = (0, hexapod_parts_1.windDrumRadiusMm)(s, spec.spring);
    const turns = spec.spring.strokeMm / (2 * Math.PI * drum);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return [
        {
            option: 'legs-hop', feasible: 'to be measured by the plant',
            numbers: { pitchServos: 12, peakMechanicalWPerServo: r3(peakW), pushW: r3(12 * peakW), allUpG, liftEnergy5cmJ: r3(liftJ), pushTimeAt5cmS: r3(liftJ / (12 * peakW)) },
            because: `every femur and tibia servo extends together: twelve servos at their peak mechanical power (stall torque × no-load speed / 4, computed from the row) give ${(12 * peakW).toFixed(1)} W; lifting ${allUpG} g 5 cm needs ${liftJ.toFixed(2)} J. The brief calls a few centimetres plausible; the plant measures the hop height (hexapod_walk.py --task jump --jump legs-hop), nobody asserts it.`,
        },
        {
            option: 'latched-spring', feasible: 'to be measured by the plant',
            numbers: {
                storedJ: spec.spring.storedJ, springCount: 2, addedMassG: budget.optionAddedG['latched-spring'], allUpWithOptionG: withSpring,
                losslessHeightM: r3(spec.spring.storedJ / ((withSpring / 1000) * mjcf_1.G_MPS2)), briefLosslessHeightM: r3(spec.spring.storedJ / ((spec.massTargetG / 1000) * mjcf_1.G_MPS2)),
                windDrumRadiusMm: drum, windTurns: r3(turns), windSeconds: r3((turns * 2 * Math.PI) / (s.noLoadRadS * servos_1.SPEED_FRACTION)),
                housingLengthMm: g.housingLengthMm, rodLengthMm: g.rodLengthMm, rodEndAtRestMm: g.rodEndAtRestMm, crouchHeightMm: g.crouchHeightMm,
            },
            because: `a pogo through the body centre: two springs either side of the piston collar in a housing through both plates, so winding the collar away from the ground and releasing drives the rod into the ground in either orientation. The spec's spring stores ${spec.spring.storedJ} J (the brief's ${Math.round((spec.spring.storedJ / ((spec.massTargetG / 1000) * mjcf_1.G_MPS2)) * 100)} cm with no losses at the target mass; ${Math.round((spec.spring.storedJ / ((withSpring / 1000) * mjcf_1.G_MPS2)) * 100)} cm at the design's ${withSpring} g with the module). The wind servo's continuous torque sets the drum radius (${drum} mm), ${turns.toFixed(2)} turns in about ${((turns * 2 * Math.PI) / (s.noLoadRadS * servos_1.SPEED_FRACTION)).toFixed(1)} s at the commanded speed. The body crouches to ${g.crouchHeightMm} mm so the whole stroke pushes against the ground. What of the stored energy becomes height is the plant's to measure (hexapod_walk.py --task jump --jump latched-spring).`,
        },
    ];
}
const PRINT_RULES = [
    'Measure the servo you bought before printing: the case, the spline offset and the horn disc in the row sts3215-12v drive every pocket, collar, window and recess.',
    'Print one coxa bracket and one femur first and fit a servo: the femur root bosses must turn freely in the bracket windows and the femur must swing through horizontal to the other side with nothing touching.',
    'PETG for every structural part, TPU for the feet and the piston feet. No PLA: the leg brackets hold a warm servo under load.',
    'Weigh every part as it comes off the bed; the budget is a budget, not a measurement, and the plant reads the weighed figures at integration.',
    'Measure the LiDAR before printing the head: the seat depth puts its scan plane on the body mid-plane.',
    'Drill every horn\'s pilots through the horn itself into its printed recess.',
];
/**
 * @description The complete hexapod for a fit, every number derived from the parts and the contract; memoised per fit.
 * @param fitId - Which fit (one for now).
 * @returns The design.
 */
function buildHexapod(fitId) {
    const cached = CACHE.get(fitId);
    if (cached)
        return cached;
    const spec = hexapod_spec_1.SPIDER_18;
    const s = servos_1.STS3215_12V;
    const body = (0, hexapod_parts_body_1.bodyLayout)(spec.layout, s);
    const printed = [...(0, hexapod_parts_body_1.bodyParts)(spec.layout, s, body), ...(0, hexapod_parts_1.legParts)(spec.layout, s), ...(0, hexapod_parts_1.jumpModule)(spec.layout, s, spec.spring, 'latched-spring')];
    const boughtList = boughtParts(spec, s);
    const budget = massBudget(spec, printed, boughtList);
    const masses = linkMasses(printed, boughtList, s);
    const joints = worstStanceLoads(spec, printed, s, budget.totalG);
    const jump = jumpOptions(spec, s, budget.totalG, budget);
    const bom = bomRows(printed, boughtList);
    const approxUsd = Math.round(boughtList.filter((b) => !b.option).reduce((a, b) => a + b.qty * b.approxUsdEach, 0));
    const approxUsdWithSpring = Math.round(boughtList.reduce((a, b) => a + b.qty * b.approxUsdEach, 0));
    const design = {
        fit: fitId, spec, servo: s, body, masses, massBudget: budget, joints, printed, bought: boughtList, bom, jump, approxUsd, approxUsdWithSpring,
        assumptions: [
            `foot friction ${exports.FOOT_FRICTION} (TPU on a dry floor) sizes the coxa; to be measured`,
            `printed masses are each program's net volume times its fill (plates ${hexapod_parts_1.PLATE_FILL} for 3 skins and 20 % gyroid; walls solid), through the arm's printedMassG; the scale replaces them`,
            `the LiDAR scan plane stands ${hexapod_parts_body_1.LIDAR_MM.scanPlaneAboveBase} mm above its base (class figure); the head's seat depth follows the measured unit`,
            'the pack rides in the tail: a 3S 2200 pack does not fit between the plates beside a Pi 5 and six coxa servos on a 220 × 140 plate (computed from the footprints)',
        ],
        printRules: PRINT_RULES,
    };
    CACHE.set(fitId, design);
    return design;
}
/** @description The bill of materials: every printed part and every bought part, the jump module's rows flagged with their option. */
function bomRows(printed, boughtList) {
    const rows = printed.map((p) => ({ id: p.id, kind: 'printed', name: p.name, qty: p.qty, massEachG: p.massEachG, totalG: p.qty * p.massEachG, approxUsdEach: 0, approxUsdTotal: 0, detail: p.material, ...(p.option ? { option: p.option } : {}) }));
    for (const b of boughtList)
        rows.push({ id: b.id, kind: b.id === 'wiring' ? 'allowance' : 'bought', name: b.name, qty: b.qty, massEachG: b.massEachG, totalG: b.qty * b.massEachG, approxUsdEach: b.approxUsdEach, approxUsdTotal: b.qty * b.approxUsdEach, detail: b.source, ...(b.option ? { option: b.option } : {}) });
    return rows;
}
const CACHE = new Map();
//# sourceMappingURL=hexapod-design.js.map