"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 spider-18: the printed leg parts and the latched-spring
 *                     |                             | jump parts as CAD Studio programs, plus the helpers every hexapod
 *                     |                             | part shares (the body parts live in hexapod-parts-body.ts): a
 *                     |                             | rotated-rectangle sketch for pockets the contract cannot rotate
 *                     |                             | as boxes, the root pivot a swinging link gets (two cheeks whose
 *                     |                             | bosses turn in the cradle's windows), the servo case pocket from
 *                     |                             | the servo row through the arm's pocketSize, and the mass estimate
 *                     |                             | from each program's NET volume (the material the program leaves)
 *                     |                             | through the arm's printedMassG. Every dimension that is the
 *                     |                             | servo's comes from the row; every leg length from SPIDER_18.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOUSING_BOLT_RADIUS_MM = exports.HOUSING_OD_MM = exports.HORN_THICKNESS_MM = exports.boxCm3 = exports.cylinderCm3 = exports.add = exports.cut = exports.WALL_FILL = exports.PLATE_FILL = exports.M25_MM = exports.M3_MM = exports.HORN_DEPTH_MM = exports.ROOT_BOSS_MM = exports.ROOT_WINDOW_MM = exports.SPLINE_CLEARANCE_MM = exports.WALL_MM = void 0;
exports.rotatedRect = rotatedRect;
exports.extrudeXY = extrudeXY;
exports.hole = hole;
exports.polygonAreaMm2 = polygonAreaMm2;
exports.printed = printed;
exports.rootPivot = rootPivot;
exports.rootPivotCm3 = rootPivotCm3;
exports.cheekInnerY = cheekInnerY;
exports.bracketArmInnerZ = bracketArmInnerZ;
exports.coxaBracket = coxaBracket;
exports.femur = femur;
exports.tibia = tibia;
exports.foot = foot;
exports.jumpGeometry = jumpGeometry;
exports.jumpModule = jumpModule;
exports.windDrumRadiusMm = windDrumRadiusMm;
exports.legParts = legParts;
const arm_parts_1 = require("./arm-parts");
const servos_1 = require("./servos");
/** Six 0.4 mm perimeters: the wall every pocket and strap is drawn with (mm). */
exports.WALL_MM = 2.4;
/** The arm's figure for the clearance hole an output spline or a horn boss turns in (mm). */
exports.SPLINE_CLEARANCE_MM = 12;
/** The window in a cradle wall that a swinging link's root boss turns in: the horn disc plus 3 mm (mm). */
exports.ROOT_WINDOW_MM = 26;
/** The boss on a swinging link's cheek that turns in that window (mm). */
exports.ROOT_BOSS_MM = 25.6;
/** The arm's horn-recess depth (mm). */
exports.HORN_DEPTH_MM = 2.6;
/** M3 clearance (mm). */
exports.M3_MM = 3.4;
/** M2.5 clearance (mm). */
exports.M25_MM = 2.8;
/** A 4 mm part printed with 0.6 mm skins and 20 % gyroid: the share of its envelope that is plastic. */
exports.PLATE_FILL = 0.44;
/** A part that is all 2.4 mm walls: the share of its net volume that is plastic. */
exports.WALL_FILL = 0.95;
/** The gap a cheek keeps from the cradle wall it swings beside (mm). */
const CHEEK_GAP_MM = 0.3;
/**
 * @description A rectangle rotated in the XY plane as the four corners a sketch feature takes.
 * @param cx - Centre x (mm). @param cy - Centre y (mm).
 * @param along - The side along the rectangle's own axis (mm). @param across - The side across it (mm).
 * @param angleRad - The rectangle's axis, counter-clockwise from +x.
 * @returns Four [x, y] corners, counter-clockwise.
 */
function rotatedRect(cx, cy, along, across, angleRad) {
    const ux = Math.cos(angleRad);
    const uy = Math.sin(angleRad);
    const vx = -uy;
    const vy = ux;
    const a = along / 2;
    const b = across / 2;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([su, sv]) => [r3(cx + su * a * ux + sv * b * vx), r3(cy + su * a * uy + sv * b * vy)]);
}
/**
 * @description A sketch on XY extruded +z from `offset` for `height`, added or cut.
 * @param id - Feature id. @param points - The closed polyline. @param offset - The sketch plane's z (mm).
 * @param height - Extrusion along +z (mm). @param mode - Add or cut. @param label - What it is.
 * @returns The feature.
 */
function extrudeXY(id, points, offset, height, mode, label) {
    return { id, type: 'sketch-extrude', params: { points, height, plane: 'XY', offset, mode }, label };
}
/**
 * @description A box pocket (cut).
 * @param id - Feature id. @param size - [x, y, z] (mm). @param center - [x, y, z] (mm). @param label - What it is.
 * @returns The feature.
 */
const cut = (id, size, center, label) => ({ id, type: 'box-cut', params: { size, center }, label });
exports.cut = cut;
/**
 * @description A box added.
 * @param id - Feature id. @param size - [x, y, z] (mm). @param center - [x, y, z] (mm). @param label - What it is.
 * @returns The feature.
 */
const add = (id, size, center, label) => ({ id, type: 'box-add', params: { size, center }, label });
exports.add = add;
/**
 * @description A hole along an axis; `depth` makes it blind from the part's + face along that axis (CAD Studio's rule).
 * @param id - Feature id. @param axis - Hole axis. @param at - A point on the axis (the axis coordinate is ignored).
 * @param diameter - mm. @param label - What it is for. @param depth - Blind depth from the + face, or through.
 * @returns The feature.
 */
function hole(id, axis, at, diameter, label, depth) {
    return { id, type: 'hole', params: { diameter, axis, x: at[0], y: at[1], z: at[2], ...(depth === undefined ? {} : { depth }) }, label };
}
/**
 * @description The shoelace area of a polygon (mm²), always positive.
 * @param points - [x, y] corners in order.
 * @returns mm².
 */
function polygonAreaMm2(points) {
    let twice = 0;
    for (let i = 0; i < points.length; i += 1) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        twice += x1 * y2 - x2 * y1;
    }
    return Math.abs(twice) / 2;
}
/**
 * @description The volume of a cylinder (cm³).
 * @param diameter - mm. @param height - mm.
 * @returns cm³.
 */
const cylinderCm3 = (diameter, height) => (Math.PI * diameter * diameter * height) / 4000;
exports.cylinderCm3 = cylinderCm3;
/**
 * @description The volume of a box (cm³).
 * @param x - mm. @param y - mm. @param z - mm.
 * @returns cm³.
 */
const boxCm3 = (x, y, z) => (x * y * z) / 1000;
exports.boxCm3 = boxCm3;
/**
 * @description One printed part from its program and the net volume its builder computed: the mass is the arm's
 * printedMassG over that volume and the fill (the plastic share of it), an estimate the scale replaces at assembly.
 * @param o - Identity, link, material, print notes, the program, the net volume (cm³) and the fill.
 * @returns The part.
 */
function printed(o) {
    return {
        id: o.id, name: o.name, qty: o.qty, material: o.material, printNotes: o.printNotes,
        massEachG: Math.max(1, (0, arm_parts_1.printedMassG)(o.netCm3, o.fill)), link: o.link, ...(o.option ? { option: o.option } : {}), cad: o.cad,
    };
}
/**
 * @description The root pivot of a swinging link: the link's two cheeks stand outside the cradle that holds its servo,
 * each carrying a boss that turns in the cradle wall's window. The + boss takes the horn in a square recess, the − boss
 * is bored for the servo's rear boss (ream it to the boss measured on the servo in hand), and one centre screw runs through.
 * @param id - Feature id prefix. @param servo - The servo in the cradle. @param x - The axis x in the link's frame.
 * @param z - The axis z. @param cheekInnerY - Where the cheeks' inner faces stand (|y|).
 * @returns The features, in order.
 */
function rootPivot(id, servo, x, z, cheekInnerY) {
    const faceY = servo.bodyMm[2] / 2 + CHEEK_GAP_MM;
    const h = cheekInnerY - faceY;
    const recess = servo.hornDiscMm + 0.4;
    const bore = exports.SPLINE_CLEARANCE_MM + 0.5;
    return [
        { id: `${id}-boss-plus`, type: 'boss', params: { diameter: exports.ROOT_BOSS_MM, height: h, axis: 'y', x, z, from: faceY }, label: `${id}: boss turning in the cradle window, horn side` },
        { id: `${id}-boss-minus`, type: 'boss', params: { diameter: exports.ROOT_BOSS_MM, height: h, axis: 'y', x, z, from: -cheekInnerY }, label: `${id}: boss turning in the cradle window, rear side` },
        (0, exports.cut)(`${id}-horn`, [recess, exports.HORN_DEPTH_MM, recess], [x, faceY + exports.HORN_DEPTH_MM / 2, z], `${id}: horn disc recess (drill the horn's pilots through the horn itself)`),
        (0, exports.cut)(`${id}-bore`, [bore, h, bore], [x, -faceY - h / 2, z], `${id}: bore for the servo's rear boss — ream to the boss measured on the servo`),
        hole(`${id}-screw`, 'y', [x, 0, z], 3.2, `${id}: horn centre screw, through both cheeks`),
    ];
}
/**
 * @description The root pivot's net volume (cm³): two bosses less the recess and the bore.
 * @param servo - The servo in the cradle. @param cheekInnerY - Where the cheeks' inner faces stand (|y|).
 * @returns cm³.
 */
function rootPivotCm3(servo, cheekInnerY) {
    const h = cheekInnerY - servo.bodyMm[2] / 2 - CHEEK_GAP_MM;
    return 2 * (0, exports.cylinderCm3)(exports.ROOT_BOSS_MM, h) - (0, exports.boxCm3)(servo.hornDiscMm + 0.4, exports.HORN_DEPTH_MM, servo.hornDiscMm + 0.4) - (0, exports.boxCm3)(exports.SPLINE_CLEARANCE_MM + 0.5, h, exports.SPLINE_CLEARANCE_MM + 0.5);
}
/**
 * @description Where the cheeks of a swinging link stand: just outside a cradle wall of WALL_MM around the servo's height.
 * @param servo - The servo in the cradle.
 * @returns |y| of the cheeks' inner faces (mm).
 */
function cheekInnerY(servo) {
    return servo.bodyMm[2] / 2 + arm_parts_1.CRADLE_CLEARANCE_MM + exports.WALL_MM + CHEEK_GAP_MM;
}
/** The disc horn's thickness between the plate's outer face and a bracket arm (mm): the arm's horn-recess depth plus its clearance. */
exports.HORN_THICKNESS_MM = 3;
/**
 * @description How far a C-bracket's arms stand from the body mid-plane: the plate's outer face, then the horn (mm).
 * @param l - The layout.
 * @returns mm.
 */
function bracketArmInnerZ(l) {
    return l.plateGapMm / 2 + l.plateThicknessMm + exports.HORN_THICKNESS_MM;
}
const BRACKET_ARM_T = 4;
/**
 * @description The coxa bracket: a C around the body (two arms on the coxa servo's horn and rear boss, outside the
 * plates) whose two straps clamp the femur servo lying radially with its spline on the femur axis, 10 mm from the case
 * centre toward the body — so the case reaches outboard, away from the coxa servo, and nothing of the bracket stands
 * above or below the femur axis beyond the straps' own height: the femur swings through horizontal to either side.
 * Frame: x radial (outboard +), y tangential, z up; the coxa axis at x = −R0, the femur axis at x = coxaMm − R0.
 * @param l - The layout. @param s - The servo class.
 * @returns The bracket, qty 6.
 */
function coxaBracket(l, s) {
    const pocket = (0, arm_parts_1.pocketSize)(s, 'y', 'x');
    const strapInner = pocket[1] / 2;
    const sizeY = pocket[1] + 2 * exports.WALL_MM;
    const armZ = bracketArmInnerZ(l);
    const sizeZ = 2 * (armZ + BRACKET_ARM_T);
    const mid = sizeZ / 2;
    const caseCentreR = l.coxaMm + s.splineOffsetMm;
    const caseOutR = caseCentreR + pocket[0] / 2;
    const strapOutR = caseOutR + exports.WALL_MM;
    const armInR = -(s.hornDiscMm / 2 + 3);
    const postInR = 26;
    const postOutR = 32;
    const sizeX = strapOutR - armInR;
    const r0 = sizeX / 2 + armInR; // r = x + r0
    const x = (r) => r - r0;
    const strapHalfZ = pocket[2] / 2 + exports.WALL_MM;
    const hubW = s.hornDiscMm + 0.4 + 2 * exports.WALL_MM;
    const features = [
        (0, exports.cut)('body-gap', [postInR - armInR + 1, sizeY + 2, sizeZ - 2 * BRACKET_ARM_T], [x((postInR + armInR - 1) / 2), 0, mid], 'the body, its plates and the coxa horn pass between the arms'),
        (0, exports.cut)('between-straps', [strapOutR - postInR + 1, 2 * strapInner, sizeZ + 2], [x((strapOutR + postInR + 1) / 2), 0, mid], 'the femur servo lies between the straps'),
        (0, exports.cut)('strap-trim-top', [strapOutR - postOutR + 1, sizeY + 2, mid - strapHalfZ + 1], [x((strapOutR + postOutR + 1) / 2), 0, sizeZ - (mid - strapHalfZ - 1) / 2], 'the straps are only as tall as the servo outboard of the posts'),
        (0, exports.cut)('strap-trim-bottom', [strapOutR - postOutR + 1, sizeY + 2, mid - strapHalfZ + 1], [x((strapOutR + postOutR + 1) / 2), 0, (mid - strapHalfZ - 1) / 2], 'the straps are only as tall as the servo outboard of the posts'),
        (0, exports.add)('rib-low', [10, 2 * strapInner, exports.WALL_MM], [x(caseCentreR), 0, mid - pocket[2] / 2 - exports.WALL_MM / 2], 'rib under the case'),
        (0, exports.add)('rib-high', [10, 2 * strapInner, exports.WALL_MM], [x(caseCentreR), 0, mid + pocket[2] / 2 + exports.WALL_MM / 2], 'rib over the case (the same part either way up)'),
        hole('femur-window', 'y', [x(l.coxaMm), 0, mid], exports.ROOT_WINDOW_MM, 'the femur root bosses turn in these windows; the horn and the rear boss pass through'),
        (0, exports.cut)('coxa-horn-top', [s.hornDiscMm + 0.4, s.hornDiscMm + 0.4, exports.HORN_DEPTH_MM], [x(0), 0, sizeZ - BRACKET_ARM_T + exports.HORN_DEPTH_MM / 2], 'coxa horn recess, top arm inner face'),
        (0, exports.cut)('coxa-horn-bottom', [s.hornDiscMm + 0.4, s.hornDiscMm + 0.4, exports.HORN_DEPTH_MM], [x(0), 0, BRACKET_ARM_T - exports.HORN_DEPTH_MM / 2], 'coxa rear-boss bushing recess, bottom arm inner face (the same recess: the bracket is symmetric)'),
        hole('coxa-screw', 'z', [x(0), 0, 0], 3.2, 'coxa horn centre screw / rear pivot screw'),
        hole('arm-lightening', 'z', [x((postInR + s.hornDiscMm / 2) / 2 + 1), 0, 0], 10, 'both arms lightened at the neck, clear of the horn hub'),
        (0, exports.cut)('arm-trim-plus', [hubW / 2 - armInR + 1, sizeY / 2 - hubW / 2 + 1, sizeZ + 2], [x((hubW / 2 + armInR - 1) / 2), hubW / 2 + (sizeY / 2 - hubW / 2 + 1) / 2, mid], 'the arms are only as wide as the horn hub over the body; full width where they meet the posts'),
        (0, exports.cut)('arm-trim-minus', [hubW / 2 - armInR + 1, sizeY / 2 - hubW / 2 + 1, sizeZ + 2], [x((hubW / 2 + armInR - 1) / 2), -hubW / 2 - (sizeY / 2 - hubW / 2 + 1) / 2, mid], 'the arms are only as wide as the horn hub over the body; full width where they meet the posts'),
    ];
    const arms = 2 * ((0, exports.boxCm3)(postInR - armInR, sizeY, BRACKET_ARM_T) - (0, exports.boxCm3)(hubW / 2 - armInR, sizeY - hubW, BRACKET_ARM_T)) - 2 * (0, exports.cylinderCm3)(10, BRACKET_ARM_T);
    const posts = 2 * (0, exports.boxCm3)(postOutR - postInR, exports.WALL_MM, sizeZ - 2 * BRACKET_ARM_T);
    const straps = 2 * (0, exports.boxCm3)(strapOutR - postOutR, exports.WALL_MM, 2 * strapHalfZ) - 2 * (0, exports.cylinderCm3)(exports.ROOT_WINDOW_MM, exports.WALL_MM);
    const ribs = 2 * (0, exports.boxCm3)(10, 2 * strapInner, exports.WALL_MM);
    return printed({
        id: 'coxa-bracket', name: 'Coxa bracket (C around the body, femur servo straps)', qty: 6, material: 'PETG', link: 'coxa',
        printNotes: 'arms down on one face, 6 walls, solid; the femur servo drops between the straps from above and is held by the femur\'s own root bosses and a zip tie through the window lightening. Nothing of the bracket stands above or below the femur axis beyond the straps, so the femur swings through horizontal to the other side: inverted, the same leg.',
        cad: { base: { kind: 'box', sizeX, sizeY, sizeZ }, features }, netCm3: arms + posts + straps + ribs, fill: exports.WALL_FILL,
    });
}
const FEMUR_CHEEK_T = 3;
/**
 * @description The femur: two root cheeks outside the coxa bracket's straps (their bosses turn in the bracket's windows)
 * and, at the knee, the cradle that carries the tibia servo with its spline on the tibia axis. The cradle starts far
 * enough from the femur axis to clear the bracket's strap corner through the whole ±120° swing.
 * Frame: x along the femur (root axis at −femurMm/2, knee at +femurMm/2), y tangential, z the depth in the leg plane.
 * @param l - The layout. @param s - The servo class.
 * @returns The femur, qty 6.
 */
function femur(l, s) {
    const pocket = (0, arm_parts_1.pocketSize)(s, 'y', 'x');
    const inner = cheekInnerY(s);
    const sizeY = 2 * (inner + FEMUR_CHEEK_T);
    const sizeZ = pocket[2] + 2 * exports.WALL_MM;
    const mid = sizeZ / 2;
    const root = -l.femurMm / 2;
    const knee = l.femurMm / 2;
    const caseCentre = knee - s.splineOffsetMm;
    const cradleIn = caseCentre - pocket[0] / 2 - exports.WALL_MM;
    const cradleOut = caseCentre + pocket[0] / 2 + exports.WALL_MM;
    const cheekBack = root - (s.hornDiscMm / 2 + 4);
    const sizeX = cradleOut - cheekBack;
    const x0 = sizeX / 2 + cheekBack; // x_cad = x - x0
    const cx = (v) => v - x0;
    const cradleHalfY = pocket[1] / 2 + exports.WALL_MM;
    const features = [
        (0, exports.cut)('root-gap', [cradleIn - cheekBack + 1, 2 * inner, sizeZ + 2], [cx((cradleIn + cheekBack - 1) / 2), 0, mid], 'the coxa bracket\'s straps and the femur servo sit between the cheeks'),
        (0, exports.cut)('cradle-trim-plus', [cradleOut - cradleIn + 1, sizeY / 2 - cradleHalfY + 1, sizeZ + 2], [cx((cradleOut + cradleIn + 1) / 2), cradleHalfY + (sizeY / 2 - cradleHalfY + 1) / 2, mid], 'the cradle is only as wide as the tibia servo and its walls'),
        (0, exports.cut)('cradle-trim-minus', [cradleOut - cradleIn + 1, sizeY / 2 - cradleHalfY + 1, sizeZ + 2], [cx((cradleOut + cradleIn + 1) / 2), -cradleHalfY - (sizeY / 2 - cradleHalfY + 1) / 2, mid], 'the cradle is only as wide as the tibia servo and its walls'),
        (0, exports.cut)('tip-pocket', [pocket[0], pocket[1], pocket[2] + 10], [cx(caseCentre), 0, exports.WALL_MM + (pocket[2] + 10) / 2], 'tibia servo case pocket, open on the +z face: the servo drops in and the tibia\'s root bosses keep it'),
        hole('tip-window', 'y', [cx(knee), 0, mid], exports.ROOT_WINDOW_MM, 'the tibia root bosses turn in these windows'),
        (0, exports.cut)('floor-window', [30, 20, exports.WALL_MM + 1], [cx(caseCentre - 5), 0, (exports.WALL_MM - 1) / 2], 'floor opened under the case: the servo rests on the rim'),
        ...rootPivot('root', s, cx(root), mid, inner),
    ];
    const cheeks = 2 * (0, exports.boxCm3)(cradleIn - cheekBack, FEMUR_CHEEK_T, sizeZ);
    const cradle = (0, exports.boxCm3)(cradleOut - cradleIn, 2 * cradleHalfY, sizeZ) - (0, exports.boxCm3)(pocket[0], pocket[1], sizeZ - exports.WALL_MM) - (0, exports.boxCm3)(30, 20, exports.WALL_MM) - 2 * (0, exports.cylinderCm3)(exports.ROOT_WINDOW_MM, exports.WALL_MM);
    return printed({
        id: 'femur', name: 'Femur (root cheeks, tibia servo cradle at the knee)', qty: 6, material: 'PETG', link: 'femur',
        printNotes: 'on its side (a cheek on the bed), 6 walls, 20 % gyroid in the cradle walls; the tibia servo drops into the knee cradle from the +z face',
        cad: { base: { kind: 'box', sizeX, sizeY, sizeZ }, features }, netCm3: cheeks + cradle + rootPivotCm3(s, inner), fill: exports.WALL_FILL,
    });
}
const TIBIA_CHEEK_T = 3;
const TIBIA_SHAFT_W = 16;
const TIBIA_SHAFT_D = 14;
const FOOT_CAP_MM = 16;
const PEG_MM = 6;
/** The shaft starts this far from the knee axis so it clears the femur cradle's corner through ±140°. */
const SHAFT_START_MM = 26;
/**
 * @description The tibia: two root cheeks outside the femur's knee cradle, then a hollow shaft symmetric about its own
 * axis so the foot works on either side, ending in the peg the TPU foot cap presses on. The cap's apex is the contact
 * point tibiaMm from the knee axis.
 * Frame: x along the tibia (knee axis toward −x), y tangential, z depth.
 * @param l - The layout. @param s - The servo class.
 * @returns The tibia, qty 6.
 */
function tibia(l, s) {
    const inner = cheekInnerY(s);
    const sizeY = 2 * (inner + TIBIA_CHEEK_T);
    const sizeZ = exports.ROOT_BOSS_MM + 2 * exports.WALL_MM;
    const mid = sizeZ / 2;
    const back = -(s.hornDiscMm / 2 + 4);
    const shaftEnd = l.tibiaMm - FOOT_CAP_MM;
    const pegEnd = shaftEnd + FOOT_CAP_MM / 2;
    const sizeX = pegEnd - back;
    const x0 = sizeX / 2 + back; // knee axis at cx(0)
    const cx = (v) => v - x0;
    const trimY = sizeY / 2 - TIBIA_SHAFT_W / 2 + 1;
    const trimZ = (sizeZ - TIBIA_SHAFT_D) / 2 + 1;
    const hollowLen = shaftEnd - SHAFT_START_MM - 2 * exports.WALL_MM - 4;
    const features = [
        (0, exports.cut)('root-gap', [SHAFT_START_MM - back + 1, 2 * inner, sizeZ + 2], [cx((SHAFT_START_MM + back - 1) / 2), 0, mid], 'the femur cradle sits between the cheeks'),
        (0, exports.cut)('shaft-trim-plus', [pegEnd - SHAFT_START_MM + 1, trimY, sizeZ + 2], [cx((pegEnd + SHAFT_START_MM + 1) / 2), TIBIA_SHAFT_W / 2 + trimY / 2, mid], 'the shaft is narrower than the cheeks'),
        (0, exports.cut)('shaft-trim-minus', [pegEnd - SHAFT_START_MM + 1, trimY, sizeZ + 2], [cx((pegEnd + SHAFT_START_MM + 1) / 2), -TIBIA_SHAFT_W / 2 - trimY / 2, mid], 'the shaft is narrower than the cheeks'),
        (0, exports.cut)('shaft-trim-top', [pegEnd - SHAFT_START_MM + 1, sizeY + 2, trimZ], [cx((pegEnd + SHAFT_START_MM + 1) / 2), 0, sizeZ - (trimZ - 1) / 2 + 0.5], 'the shaft is shallower than the cheeks, centred: the same tibia either way up'),
        (0, exports.cut)('shaft-trim-bottom', [pegEnd - SHAFT_START_MM + 1, sizeY + 2, trimZ], [cx((pegEnd + SHAFT_START_MM + 1) / 2), 0, (trimZ - 1) / 2 - 0.5], 'the shaft is shallower than the cheeks, centred'),
        (0, exports.cut)('hollow', [hollowLen, TIBIA_SHAFT_W - 2 * exports.WALL_MM, TIBIA_SHAFT_D - 2 * exports.WALL_MM], [cx(SHAFT_START_MM + exports.WALL_MM + 2 + hollowLen / 2), 0, mid], 'hollow shaft, closed ends'),
        (0, exports.cut)('end-trim', [pegEnd - shaftEnd + 1, sizeY + 2, sizeZ + 2], [cx((pegEnd + shaftEnd + 1) / 2), 0, mid], 'the shaft ends where the foot cap begins'),
        { id: 'peg', type: 'boss', params: { diameter: PEG_MM, height: FOOT_CAP_MM / 2, axis: 'x', y: 0, z: mid, from: cx(shaftEnd) }, label: 'the peg the foot cap presses on' },
        ...rootPivot('root', s, cx(0), mid, inner),
    ];
    const cheeks = 2 * (0, exports.boxCm3)(SHAFT_START_MM - back, TIBIA_CHEEK_T, sizeZ);
    const shaft = (0, exports.boxCm3)(shaftEnd - SHAFT_START_MM, TIBIA_SHAFT_W, TIBIA_SHAFT_D) - (0, exports.boxCm3)(hollowLen, TIBIA_SHAFT_W - 2 * exports.WALL_MM, TIBIA_SHAFT_D - 2 * exports.WALL_MM) + (0, exports.cylinderCm3)(PEG_MM, FOOT_CAP_MM / 2);
    return printed({
        id: 'tibia', name: 'Tibia (symmetric shaft, foot peg)', qty: 6, material: 'PETG', link: 'tibia',
        printNotes: 'on its side, 6 walls, 20 % gyroid; symmetric about its axis, so the foot is the same foot when the leg is swung to the other side',
        cad: { base: { kind: 'box', sizeX, sizeY, sizeZ }, features }, netCm3: cheeks + shaft + rootPivotCm3(s, inner), fill: exports.WALL_FILL,
    });
}
/**
 * @description The foot: a TPU cap pressed on the tibia's peg, rounded so the contact point is on the tibia axis either way up.
 * @param l - The layout.
 * @returns The foot, qty 6.
 */
function foot(l) {
    const d = 2 * l.footRadiusMm;
    return printed({
        id: 'foot', name: 'Foot cap', qty: 6, material: 'TPU 95A', link: 'tibia',
        printNotes: 'bore up, 100 % infill; press on the tibia peg with a drop of CA',
        cad: { base: { kind: 'cylinder', diameter: d, height: FOOT_CAP_MM }, features: [
                hole('bore', 'z', [0, 0, 0], PEG_MM + 0.4, 'the tibia peg', FOOT_CAP_MM / 2),
                { id: 'round', type: 'fillet', params: { radius: l.footRadiusMm - 2, edges: 'bottom' }, label: 'the contact dome' },
            ] },
        netCm3: (0, exports.cylinderCm3)(d, FOOT_CAP_MM) - (0, exports.cylinderCm3)(PEG_MM + 0.4, FOOT_CAP_MM / 2), fill: 1,
    });
}
/** The spring housing's bore around the die spring's outside diameter (mm). */
const SPRING_OD_MM = 20;
const HOUSING_BORE_MM = SPRING_OD_MM + 2;
/** The housing tube's outside diameter: the plate carries a hole one millimetre larger (mm). */
exports.HOUSING_OD_MM = HOUSING_BORE_MM + 2 * 2.5;
const PISTON_ROD_MM = 8;
/** The housing flanges' bolt circle (mm) — the plate carries the same three holes around the housing hole. */
exports.HOUSING_BOLT_RADIUS_MM = 18;
const FLANGE_MM = 3;
/**
 * @description The pogo geometry for a layout and a spring.
 * @param l - The layout. @param spring - The spring.
 * @returns The lengths.
 */
function jumpGeometry(l, spring) {
    const housingLengthMm = l.plateGapMm + 2 * spring.strokeMm;
    const rodLengthMm = housingLengthMm + spring.strokeMm;
    const rodEndAtRestMm = rodLengthMm / 2;
    return { housingLengthMm, rodLengthMm, rodEndAtRestMm, rodEndCockedMm: rodEndAtRestMm - spring.strokeMm, crouchHeightMm: rodEndAtRestMm - spring.strokeMm + 2 };
}
/** @description The housing: a tube through both plates, flanged on their inner faces, the two springs and the collar in its bore. */
function springHousing(l, spring, option) {
    const g = jumpGeometry(l, spring);
    const housingMid = g.housingLengthMm / 2;
    const flangeD = 2 * exports.HOUSING_BOLT_RADIUS_MM + 8;
    const bolts = [90, 210, 330].map((deg, i) => hole(`bolt-${i}`, 'z', [exports.HOUSING_BOLT_RADIUS_MM * Math.cos((deg * Math.PI) / 180), exports.HOUSING_BOLT_RADIUS_MM * Math.sin((deg * Math.PI) / 180), 0], exports.M3_MM, 'to the plates, through both flanges'));
    return printed({
        id: 'spring-housing', name: 'Spring housing (through both plates, flanged on their inner faces)', qty: 1, material: 'PETG', link: 'jump', option,
        printNotes: 'upright, 6 walls, solid; the tube passes through the plates\' housing holes and each flange bolts to a plate from inside the gap',
        cad: { base: { kind: 'cylinder', diameter: exports.HOUSING_OD_MM, height: g.housingLengthMm }, features: [
                { id: 'flange-low', type: 'boss', params: { diameter: flangeD, height: FLANGE_MM, axis: 'z', x: 0, y: 0, from: housingMid - l.plateGapMm / 2 }, label: 'flange on one plate\'s inner face' },
                { id: 'flange-high', type: 'boss', params: { diameter: flangeD, height: FLANGE_MM, axis: 'z', x: 0, y: 0, from: housingMid + l.plateGapMm / 2 - FLANGE_MM }, label: 'flange on the other plate\'s inner face' },
                hole('bore', 'z', [0, 0, 0], HOUSING_BORE_MM, 'the two springs and the collar run here'),
                ...bolts,
            ] },
        netCm3: (0, exports.cylinderCm3)(exports.HOUSING_OD_MM, g.housingLengthMm) - (0, exports.cylinderCm3)(HOUSING_BORE_MM, g.housingLengthMm) + 2 * ((0, exports.cylinderCm3)(flangeD, FLANGE_MM) - (0, exports.cylinderCm3)(exports.HOUSING_OD_MM, FLANGE_MM)), fill: exports.WALL_FILL,
    });
}
/** @description The piston: one rod through the body with the collar both springs seat on, a latch groove and a cord eye. */
function piston(l, spring, option) {
    const g = jumpGeometry(l, spring);
    return printed({
        id: 'piston', name: 'Piston (double-ended rod with the spring collar)', qty: 1, material: 'PETG (or an 8 mm carbon tube with printed ends)', link: 'jump', option,
        printNotes: 'on its side, solid; the collar is both springs\' seat and what the latch holds',
        cad: { base: { kind: 'cylinder', diameter: PISTON_ROD_MM, height: g.rodLengthMm }, features: [
                { id: 'collar', type: 'boss', params: { diameter: HOUSING_BORE_MM - 1, height: 6, axis: 'z', x: 0, y: 0, from: g.rodLengthMm / 2 - 3 }, label: 'spring seat and latch collar' },
                (0, exports.cut)('latch-groove', [3, 12, 2], [PISTON_ROD_MM / 2 - 0.5, 0, g.rodLengthMm / 2 + 8], 'the latch pawl drops in here at full wind'),
                hole('cord-eye', 'x', [0, 0, g.rodLengthMm - 6], 2.5, 'the winding cord'),
            ] },
        netCm3: (0, exports.cylinderCm3)(PISTON_ROD_MM, g.rodLengthMm) + (0, exports.cylinderCm3)(HOUSING_BORE_MM - 1, 6) - (0, exports.cylinderCm3)(PISTON_ROD_MM, 6), fill: 1,
    });
}
/** @description The winding drum on the wind servo's horn, at the cord radius the servo's continuous torque holds at full stroke. */
function windingDrum(s, spring, option) {
    const cordRadius = windDrumRadiusMm(s, spring);
    return printed({
        id: 'cam', name: 'Winding drum on the wind servo horn', qty: 1, material: 'PETG', link: 'jump', option,
        printNotes: 'flange down, solid; the cord radius is what the servo\'s continuous torque winds the spring at full stroke with',
        cad: { base: { kind: 'cylinder', diameter: s.hornDiscMm + 12, height: 3 }, features: [
                { id: 'drum', type: 'boss', params: { diameter: 2 * cordRadius, height: 10, axis: 'z', x: 0, y: 0, from: 3 }, label: `cord drum, radius ${cordRadius} mm` },
                (0, exports.cut)('horn', [s.hornDiscMm + 0.4, s.hornDiscMm + 0.4, exports.HORN_DEPTH_MM], [0, 0, exports.HORN_DEPTH_MM / 2], 'horn recess, bottom face'),
                hole('screw', 'z', [0, 0, 0], 3.2, 'horn centre screw'),
                hole('cord', 'x', [0, 0, 8], 2.5, 'cord anchor through the drum'),
            ] },
        netCm3: (0, exports.cylinderCm3)(s.hornDiscMm + 12, 3) + (0, exports.cylinderCm3)(2 * cordRadius, 10), fill: 1,
    });
}
/** @description The latch pawl: holds the collar's groove at full wind, tripped by the wind servo past its detent. */
function latchPawl(option) {
    return printed({
        id: 'latch', name: 'Latch pawl', qty: 1, material: 'PETG', link: 'jump', option,
        printNotes: 'flat, solid; pivots on an M3, tripped by the wind servo past its detent',
        cad: { base: { kind: 'box', sizeX: 30, sizeY: 10, sizeZ: 6 }, features: [
                hole('pivot', 'z', [-11, 0, 0], exports.M3_MM, 'pivot'),
                hole('link', 'z', [11, 0, 0], 2.5, 'trip link'),
                { id: 'edge', type: 'chamfer', params: { length: 1, edges: 'top' } },
            ] },
        netCm3: (0, exports.boxCm3)(30, 10, 6), fill: 1,
    });
}
/** @description A piston foot: the TPU dome on each end of the rod. */
function pistonFoot(option) {
    return printed({
        id: 'piston-foot', name: 'Piston foot', qty: 2, material: 'TPU 95A', link: 'jump', option,
        printNotes: 'bore up, 100 % infill; one on each end of the rod',
        cad: { base: { kind: 'cylinder', diameter: 20, height: 14 }, features: [
                hole('bore', 'z', [0, 0, 0], PISTON_ROD_MM + 0.4, 'the rod end', 8),
                { id: 'round', type: 'fillet', params: { radius: 6, edges: 'bottom' }, label: 'the striking dome' },
            ] },
        netCm3: (0, exports.cylinderCm3)(20, 14) - (0, exports.cylinderCm3)(PISTON_ROD_MM + 0.4, 8), fill: 1,
    });
}
/**
 * @description The latched-spring jump module: a pogo through the body centre. The housing tube passes through both
 * plates and is bolted to their inner faces by two flanges; two die springs sit either side of the piston's collar, so
 * winding the collar away from the ground compresses the spring on the far side and the release drives the rod's
 * ground-side end down — the same action with the body inverted, because the module is symmetric about the mid-plane.
 * @param l - The layout. @param s - The wind servo. @param spring - The spring. @param option - The option the parts belong to.
 * @returns Housing, piston, drum, latch, two piston feet.
 */
function jumpModule(l, s, spring, option) {
    return [springHousing(l, spring, option), piston(l, spring, option), windingDrum(s, spring, option), latchPawl(option), pistonFoot(option)];
}
/**
 * @description The winding drum's cord radius (mm): the radius at which the wind servo's continuous torque equals the
 * spring's force at full stroke, rounded down to a tenth — larger and the servo stalls before the latch.
 * @param s - The wind servo. @param spring - The spring.
 * @returns Millimetres.
 */
function windDrumRadiusMm(s, spring) {
    const forceN = spring.stiffnessNPerM * (spring.strokeMm / 1000);
    return Math.floor(((s.stallNm * servos_1.CONTINUOUS_FRACTION) / forceN) * 10000) / 10;
}
/**
 * @description The six-of-each leg parts for a layout and a servo.
 * @param l - The layout. @param s - The servo class.
 * @returns Coxa bracket, femur, tibia, foot.
 */
function legParts(l, s) {
    return [coxaBracket(l, s), femur(l, s), tibia(l, s), foot(l)];
}
//# sourceMappingURL=hexapod-parts.js.map