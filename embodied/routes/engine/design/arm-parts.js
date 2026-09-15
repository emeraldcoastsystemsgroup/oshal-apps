"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the printed arm's parts as CAD Studio programs:
 *                     |                             | the base with the turntable bearing seat, the turntable, the
 *                     |                             | shoulder bracket (one or two servo cheeks), the upper arm and
 *                     |                             | forearm links, the elbow and wrist brackets, the gripper body,
 *                     |                             | the moving jaw and its pads. Every pocket is the servo's case
 *                     |                             | plus a clearance and every hub is its horn disc, read from the
 *                     |                             | servo spec — one number, one place. Masses are estimates from
 *                     |                             | each part's envelope and fill, replaced by the scale at assembly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRADLE_CLEARANCE_MM = void 0;
exports.pocketSize = pocketSize;
exports.printedMassG = printedMassG;
exports.armPrintedParts = armPrintedParts;
/** Clearance around a servo case in its pocket (mm). */
exports.CRADLE_CLEARANCE_MM = 0.3;
/** A cradle's wall around the pocket (mm). */
const CRADLE_WALL_MM = 3;
const M3 = 3.4;
const SPLINE_HOLE_MM = 12;
const HORN_DEPTH_MM = 2.6;
/** PETG. */
const DENSITY_G_CM3 = 1.27;
const IDX = { x: 0, y: 1, z: 2 };
/** @description The size of the pocket that takes a servo with its spline along one axis and its length along another. */
function pocketSize(servo, splineAxis, lengthAxis) {
    const [L, W, H] = servo.bodyMm;
    const c = 2 * exports.CRADLE_CLEARANCE_MM;
    const size = [W + c, W + c, W + c];
    size[IDX[splineAxis]] = H + c;
    size[IDX[lengthAxis]] = L + c;
    return size;
}
/**
 * @description A servo cradle: the case pocket and the spline hole. `spline` is a point on the output axis at the case
 * centre's position along that axis; the case centre sits `splineOffsetMm` from it along the length axis, toward
 * `-lengthAxis` (sign +1) or `+lengthAxis` (−1). A blind spline hole is drilled from the + face along the spline axis.
 */
function cradle(id, servo, spline, splineAxis, lengthAxis, through = true, sign = 1) {
    const centre = [...spline];
    centre[IDX[lengthAxis]] -= sign * servo.splineOffsetMm;
    const hole = { id: `${id}-spline`, type: 'hole', params: { diameter: SPLINE_HOLE_MM, axis: splineAxis, x: spline[0], y: spline[1], z: spline[2], ...(through ? {} : { depth: servo.bodyMm[2] }) }, label: `${id}: output spline clearance` };
    return [{ id: `${id}-pocket`, type: 'box-cut', params: { size: pocketSize(servo, splineAxis, lengthAxis), center: centre }, label: `${id}: servo case pocket` }, hole];
}
/** @description A hub on the + face along an axis: the recess the supplied horn disc sits in and its centre screw. */
function hubPlus(id, servo, at, axis) {
    return [
        { id: `${id}-horn`, type: 'hole', params: { diameter: servo.hornDiscMm + 0.4, axis, x: at[0], y: at[1], z: at[2], depth: HORN_DEPTH_MM }, label: `${id}: horn disc recess (drill the horn's pilots through the horn itself)` },
        { id: `${id}-screw`, type: 'hole', params: { diameter: 3.2, axis, x: at[0], y: at[1], z: at[2] }, label: `${id}: horn centre screw` },
    ];
}
/** @description A hub on the − face: a square recess over the horn disc (a blind hole is drilled only from the + side). */
function hubMinus(id, servo, at, axis, faceCoord) {
    const size = [servo.hornDiscMm + 0.4, servo.hornDiscMm + 0.4, servo.hornDiscMm + 0.4];
    size[IDX[axis]] = HORN_DEPTH_MM;
    const centre = [...at];
    centre[IDX[axis]] = faceCoord + HORN_DEPTH_MM / 2;
    return { id: `${id}-horn-minus`, type: 'box-cut', params: { size, center: centre }, label: `${id}: second horn recess, − face` };
}
const bolt = (id, axis, x, y, z, label, diameter = M3) => ({ id, type: 'hole', params: { diameter, axis, x, y, z }, label });
/**
 * @description A printed part's mass from its envelope and fill: an estimate the scale replaces at assembly.
 * @param envelopeCm3 - The part's envelope volume (cm³).
 * @param fill - The printed share of the envelope (walls + infill − pockets).
 * @returns Grams, rounded.
 */
function printedMassG(envelopeCm3, fill) {
    return Math.round(envelopeCm3 * fill * DENSITY_G_CM3);
}
const boxCm3 = (x, y, z) => (x * y * z) / 1000;
const cylCm3 = (d, h) => (Math.PI * d * d * h) / 4000;
/** @description The base: bench bolts, the base-yaw servo standing in its cradle, the 6807 bearing seat above it. */
function base(l, s) {
    const h = l.baseHeightMm;
    const seat = 8;
    // The case stands under the bearing seat, its centre half a case below the seat floor; the spline is on the axis.
    const caseOnAxis = [0, 0, h - seat - s.bodyMm[2] / 2 - exports.CRADLE_CLEARANCE_MM];
    const features = [
        { id: 'edge', type: 'chamfer', params: { length: 1, edges: 'top' } },
        { id: 'bearing-seat', type: 'hole', params: { diameter: 47.3, axis: 'z', x: 0, y: 0, depth: seat }, label: '6807 bearing seat (47 mm OD, 7 mm wide)' },
        ...cradle('j1', s, caseOnAxis, 'z', 'x'),
    ];
    const r = l.baseDiameterMm / 2 - 10;
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy], i) => features.push(bolt(`bench-${i}`, 'z', (sx * r) / Math.SQRT2, (sy * r) / Math.SQRT2, 0, 'M4 bench bolt', 4.5)));
    features.push({ id: 'cable', type: 'box-cut', params: { size: [16, 18, 10], center: [l.baseDiameterMm / 2 - 6, 0, 5] }, label: 'servo bus lead exit' });
    return { id: 'base', name: 'Base with bearing seat and base-yaw cradle', qty: 1, material: 'PETG', printNotes: 'flat, 4 walls, 30 % gyroid; bolt it to the bench before powering the arm', massEachG: printedMassG(cylCm3(l.baseDiameterMm, h), 0.35), link: 0, cad: { base: { kind: 'cylinder', diameter: l.baseDiameterMm, height: h }, features } };
}
/** @description The turntable: the boss that runs in the bearing, the base-yaw hub, the shoulder bracket's bolts. */
function turntable(l, s) {
    const t = l.turntableMm;
    const boss = 8;
    const features = [
        { id: 'edge', type: 'chamfer', params: { length: 1, edges: 'top' } },
        { id: 'bearing-boss', type: 'boss', params: { diameter: 34.9, height: boss, axis: 'z', x: 0, y: 0, from: t }, label: 'runs in the 6807 inner ring (35 mm)' },
        ...hubPlus('j1', s, [0, 0, t + boss], 'z'),
    ];
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy], i) => features.push(bolt(`bracket-${i}`, 'z', sx * 10, sy * 20, 0, 'shoulder bracket bolt')));
    return { id: 'turntable', name: 'Turntable', qty: 1, material: 'PETG', printNotes: 'boss up, 4 walls, 40 % gyroid; flip it at assembly so the boss enters the bearing', massEachG: printedMassG(cylCm3(l.turntableDiameterMm, t) + cylCm3(34.9, boss), 0.45), link: 1, cad: { base: { kind: 'cylinder', diameter: l.turntableDiameterMm, height: t }, features } };
}
/** @description The shoulder bracket: a U whose cheeks cradle the shoulder servo(s); with one servo the far cheek seats a 608 bearing. */
function shoulderBracket(l, s, servos) {
    const gap = l.linkWidthMm + 3;
    const cheek = s.bodyMm[2] + 2 * exports.CRADLE_CLEARANCE_MM + 2 * CRADLE_WALL_MM;
    const sizeX = gap + 2 * cheek;
    const sizeY = 60;
    const floor = 14;
    const axisZ = l.shoulderMm - l.baseHeightMm - l.turntableMm;
    const sizeZ = axisZ + 16;
    const xServo = gap / 2 + CRADLE_WALL_MM + (s.bodyMm[2] + 2 * exports.CRADLE_CLEARANCE_MM) / 2;
    const features = [
        { id: 'edges', type: 'fillet', params: { radius: 4, edges: 'vertical' } },
        { id: 'gap', type: 'box-cut', params: { size: [gap, sizeY + 2, sizeZ - floor], center: [0, 0, floor + (sizeZ - floor) / 2] }, label: 'the upper arm swings between the cheeks' },
    ];
    // The first servo sits in the −x cheek; the second (if any) in the +x cheek, else the +x cheek seats the idler bearing.
    features.push(...cradle('j2-a', s, [-xServo, 0, axisZ], 'x', 'z'));
    if (servos === 2)
        features.push({ id: 'j2-b-pocket', type: 'box-cut', params: { size: pocketSize(s, 'x', 'z'), center: [xServo, 0, axisZ - s.splineOffsetMm] }, label: 'j2-b: second shoulder servo pocket' });
    else
        features.push({ id: 'idler-seat', type: 'hole', params: { diameter: 22.2, axis: 'x', y: 0, z: axisZ, depth: 7 }, label: '608 bearing seat for the 8 mm idler shaft' });
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy], i) => features.push(bolt(`turntable-${i}`, 'z', sx * 10, sy * 20, 0, 'to the turntable')));
    const envelope = boxCm3(sizeX, sizeY, sizeZ) - boxCm3(gap, sizeY, sizeZ - floor);
    return { id: 'shoulder-bracket', name: `Shoulder bracket (${servos} servo${servos === 2 ? 's' : ''})`, qty: 1, material: 'PETG', printNotes: 'floor down, 4 walls, 35 % gyroid; press the servos in from the outer faces', massEachG: printedMassG(envelope, 0.4), link: 1, cad: { base: { kind: 'box', sizeX, sizeY, sizeZ }, features } };
}
/** @description The upper arm: a box from the shoulder axis to the elbow axis, the shoulder hub(s) at the root, the elbow cradle at the tip. */
function upperArm(l, s, o) {
    const w = l.linkWidthMm;
    const h = l.linkHeightMm;
    const sizeX = o.lengthMm + 2 * 22;
    const root = -o.lengthMm / 2;
    const tip = o.lengthMm / 2;
    const features = [{ id: 'edges', type: 'fillet', params: { radius: 3, edges: 'parallel-x' } }];
    if (o.tipSpline) {
        const block = pocketSize(s, o.tipSpline, 'x').map((v) => v + 2 * CRADLE_WALL_MM);
        features.push({ id: 'tip-block', type: 'box-add', params: { size: block, center: [tip - s.splineOffsetMm, 0, h / 2] }, label: 'cradle block for the next joint' });
    }
    features.push({ id: 'lightening', type: 'box-cut', params: { size: [Math.max(10, o.lengthMm - 70), w - 2 * l.wallMm, h - 2 * l.wallMm], center: [0, 0, h / 2] }, label: 'hollow middle, closed ends' });
    features.push(...hubPlus('root', s, [root, 0, h / 2], 'y'));
    if (o.rootHubs === 2)
        features.push(hubMinus('root', s, [root, 0, h / 2], 'y', -w / 2));
    if (o.tipSpline)
        features.push(...cradle('tip', s, [tip, 0, h / 2], o.tipSpline, 'x'));
    const envelope = boxCm3(sizeX, w, h) + (o.tipSpline ? boxCm3(...pocketSize(s, o.tipSpline, 'x').map((v) => v + 2 * CRADLE_WALL_MM)) * 0.5 : 0);
    return { id: o.id, name: o.name, qty: 1, material: 'PETG', printNotes: o.printNotes, massEachG: printedMassG(envelope, 0.3), link: o.link, cad: { base: { kind: 'box', sizeX, sizeY: w, sizeZ: h }, features } };
}
/**
 * @description The forearm: rolled by the servo in the elbow bracket, so its hub is on the +x end face (the roll axis), and
 * the wrist-pitch cradle is at the −x end with its case reaching back into the link.
 */
function forearm(l, s, lengthMm) {
    const w = l.linkWidthMm;
    const h = l.linkHeightMm;
    const sizeX = lengthMm + 2 * 22;
    const wrist = -lengthMm / 2;
    const block = pocketSize(s, 'y', 'x').map((v) => v + 2 * CRADLE_WALL_MM);
    const features = [
        { id: 'edges', type: 'fillet', params: { radius: 3, edges: 'parallel-x' } },
        { id: 'wrist-block', type: 'box-add', params: { size: block, center: [wrist + s.splineOffsetMm, 0, h / 2] }, label: 'cradle block for the wrist pitch' },
        { id: 'lightening', type: 'box-cut', params: { size: [Math.max(10, lengthMm - 70), w - 2 * l.wallMm, h - 2 * l.wallMm], center: [0, 0, h / 2] }, label: 'hollow middle, closed ends' },
        ...hubPlus('roll', s, [sizeX / 2, 0, h / 2], 'x'),
        ...cradle('wrist', s, [wrist, 0, h / 2], 'y', 'x', true, -1),
    ];
    return { id: 'forearm', name: 'Forearm', qty: 1, material: 'PETG', printNotes: 'on its side, 4 walls, 25 % gyroid; the wrist-pitch servo presses into the end block', massEachG: printedMassG(boxCm3(sizeX, w, h) + boxCm3(...block) * 0.5, 0.3), link: 4, cad: { base: { kind: 'box', sizeX, sizeY: w, sizeZ: h }, features } };
}
/** @description A bracket: the previous joint's hub on its +y face, the next joint's cradle with its spline out of the +x face. */
function bracket(l, s, o) {
    const pocket = pocketSize(s, 'x', 'y');
    const sizeX = pocket[0] + 2 * CRADLE_WALL_MM + 12;
    const sizeY = pocket[1] + 2 * CRADLE_WALL_MM;
    const sizeZ = pocket[2] + 2 * CRADLE_WALL_MM;
    const caseX = sizeX / 2 - CRADLE_WALL_MM - pocket[0] / 2;
    const features = [
        { id: 'edges', type: 'fillet', params: { radius: 2, edges: 'parallel-x' } },
        ...cradle('next', s, [caseX, s.splineOffsetMm, sizeZ / 2], 'x', 'y', false),
        ...hubPlus('prev', s, [-sizeX / 2 + 12, 0, sizeZ / 2], 'y'),
    ];
    return { id: o.id, name: o.name, qty: 1, material: 'PETG', printNotes: 'cradle opening up, 4 walls, 40 % gyroid', massEachG: printedMassG(boxCm3(sizeX, sizeY, sizeZ), 0.35), link: o.link, cad: { base: { kind: 'box', sizeX, sizeY, sizeZ }, features } };
}
/** Where the jaws close, in the gripper body's frame (mm): on the tool-roll axis, so the tool point is on it too. */
const JAW_PLANE_Y_MM = 14.6;
const GRIP_PIVOT_X_MM = 20;
const JAW_LENGTH_MM = 50;
/**
 * @description The gripper body: the tool-roll hub under the jaw plane, the gripper servo lying beside that plane with
 * its spline across it (the moving jaw swings in the plane that holds the roll axis), the slot the jaw swings in, and
 * the fixed jaw rising on the far side of the opening.
 */
function gripperBody(l, s) {
    const pocket = pocketSize(s, 'y', 'x');
    const sizeX = 72;
    const sizeY = 60;
    const floor = 6;
    const sizeZ = floor + pocket[2] + CRADLE_WALL_MM;
    const caseY = -sizeY / 2 + CRADLE_WALL_MM + pocket[1] / 2;
    const slotY = caseY + pocket[1] / 2 + 6;
    const features = [
        { id: 'edges', type: 'fillet', params: { radius: 2, edges: 'vertical' } },
        { id: 'jaw-slot', type: 'box-cut', params: { size: [sizeX - 2 * CRADLE_WALL_MM, 12, sizeZ - floor], center: [0, slotY, floor + (sizeZ - floor) / 2 + 0.5] }, label: 'the moving jaw swings in this slot' },
        { id: 'fixed-jaw', type: 'box-add', params: { size: [8, 12, JAW_LENGTH_MM], center: [-l.jawOpeningMm / 2 - 4, JAW_PLANE_Y_MM, sizeZ + JAW_LENGTH_MM / 2 - 8] }, label: 'fixed jaw, in the jaw plane' },
        { id: 'grip-pocket', type: 'box-cut', params: { size: pocket, center: [GRIP_PIVOT_X_MM - s.splineOffsetMm, caseY, floor + pocket[2] / 2] }, label: 'grip: servo case pocket' },
        { id: 'grip-spline', type: 'hole', params: { diameter: SPLINE_HOLE_MM, axis: 'y', x: GRIP_PIVOT_X_MM, z: floor + pocket[2] / 2, depth: sizeY / 2 - caseY }, label: 'grip: output spline into the jaw slot' },
        { id: 'tool-hub-horn', type: 'box-cut', params: { size: [s.hornDiscMm + 0.4, s.hornDiscMm + 0.4, HORN_DEPTH_MM], center: [0, JAW_PLANE_Y_MM, HORN_DEPTH_MM / 2] }, label: 'tool-roll horn recess on the bottom face, under the jaw plane' },
        bolt('tool-hub-screw', 'z', 0, JAW_PLANE_Y_MM, 0, 'tool-roll horn centre screw'),
    ];
    return { id: 'gripper-body', name: 'Gripper body with fixed jaw', qty: 1, material: 'PETG', printNotes: 'hub face down, 4 walls, 40 % gyroid', massEachG: printedMassG(boxCm3(sizeX, sizeY, sizeZ) + boxCm3(8, 12, JAW_LENGTH_MM), 0.35), link: 6, cad: { base: { kind: 'box', sizeX, sizeY, sizeZ }, features } };
}
/** @description The moving jaw: a lever on the gripper servo's horn whose tip closes on the fixed jaw. */
function movingJaw(l, s) {
    const len = JAW_LENGTH_MM + 20;
    const features = [
        { id: 'edges', type: 'fillet', params: { radius: 2, edges: 'vertical' } },
        ...hubPlus('grip', s, [-len / 2 + 14, 0, 10], 'z'),
        { id: 'pad-slot', type: 'box-cut', params: { size: [16, 3, 10], center: [len / 2 - 10, 5, 5] }, label: 'TPU pad slot on the gripping face' },
    ];
    return { id: 'moving-jaw', name: 'Moving jaw', qty: 1, material: 'PETG', printNotes: 'flat, solid infill', massEachG: printedMassG(boxCm3(len, 26, 10), 0.6), link: 6, cad: { base: { kind: 'box', sizeX: len, sizeY: 26, sizeZ: 10 }, features } };
}
/** @description A jaw pad: TPU, pressed into the jaw's slot, the surface that holds the object. */
function jawPad() {
    return { id: 'jaw-pad', name: 'Jaw pad', qty: 2, material: 'TPU 95A', printNotes: 'flat, 100 % infill; ribbed face out', massEachG: 3, link: 6, cad: { base: { kind: 'box', sizeX: 3, sizeY: 16, sizeZ: 20 }, features: [{ id: 'ribs', type: 'box-cut', params: { size: [1, 16, 2], center: [1.5, 0, 10] }, label: 'grip rib' }] } };
}
/**
 * @description Every printed part for a layout, a servo and the shoulder's servo count.
 * @param l - The layout.
 * @param s - The servo class.
 * @param shoulderServos - One or two servos at the shoulder (the drive sizing decides).
 * @returns The parts, link by link.
 */
function armPrintedParts(l, s, shoulderServos) {
    const elbowBlock = 30;
    const wristBlock = 30;
    return [
        base(l, s),
        turntable(l, s),
        shoulderBracket(l, s, shoulderServos),
        upperArm(l, s, { id: 'upper-arm', name: 'Upper arm', lengthMm: l.upperArmMm, rootHubs: shoulderServos, tipSpline: 'y', link: 2, printNotes: 'on its side, 4 walls, 25 % gyroid; the elbow servo presses into the tip block' }),
        bracket(l, s, { id: 'elbow-bracket', name: 'Elbow bracket (forearm-roll cradle)', link: 3 }),
        forearm(l, s, l.forearmMm - elbowBlock - wristBlock),
        bracket(l, s, { id: 'wrist-bracket', name: 'Wrist bracket (tool-roll cradle)', link: 5 }),
        gripperBody(l, s),
        movingJaw(l, s),
        jawPad(),
    ];
}
//# sourceMappingURL=arm-parts.js.map