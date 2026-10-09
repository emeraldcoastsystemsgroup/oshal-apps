"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the serial-bus servo the printed arm is built
 *                     |                             | around and the rules that size a joint drive from it: the rated
 *                     |                             | stall torque, the continuous fraction a bench test showed the
 *                     |                             | servo sustains, the dynamic allowance on a static hold, the
 *                     |                             | commanded-speed fraction, and the drive options (one or two
 *                     |                             | servos, direct or through a printed belt reduction) a joint is
 *                     |                             | given — the first that holds its load with margin.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | STS3215_12V is BUILT from this package's owned row
 *                     |                             | `sts3215-12v` in parts-catalog.json (identity, mass, price,
 *                     |                             | source and the joint-drive block) instead of a literal here,
 *                     |                             | so the servo is described once as data another package can
 *                     |                             | read (ADR-152 D1). servoSpecFrom is the one translation from
 *                     |                             | the row's published units (kg*cm, s per 60 deg) into the N*m
 *                     |                             | and rad/s the joint sizing works in. No number moved.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DRIVE_OPTIONS = exports.BELT_EFFICIENCY = exports.SPEED_FRACTION = exports.BACKLASH_DEG = exports.DYNAMIC_ALLOWANCE = exports.CONTINUOUS_FRACTION = exports.STS3215_12V = void 0;
exports.servoSpecFrom = servoSpecFrom;
exports.driveOutput = driveOutput;
exports.chooseDrive = chooseDrive;
const parts_catalog_1 = require("./parts-catalog");
const KGCM_TO_NM = 0.0980665;
/**
 * @description A servo class as a joint is sized from it, built from its owned row: the rated stall in N*m and the
 * no-load speed in rad/s are translated here, once, from the kg*cm and seconds per 60 degrees the row publishes.
 * @param row - The owned servo row (parts-catalog.json).
 * @returns The servo class.
 */
function servoSpecFrom(row) {
    const d = row.jointDrive;
    return {
        id: row.id,
        name: row.name,
        stallNm: d.stallKgCm * KGCM_TO_NM,
        noLoadRadS: (Math.PI / 3) / d.secondsPer60,
        massG: row.massG,
        bodyMm: [d.bodyMm[0], d.bodyMm[1], d.bodyMm[2]],
        splineOffsetMm: d.splineOffsetMm,
        hornDiscMm: d.hornDiscMm,
        encoder: d.encoder,
        approxUsdEach: row.approxUsd,
        source: row.source,
    };
}
/**
 * @description The 12 V STS3215: the default joint actuator of the open SO-ARM100/101 arms. Rated 30 kg·cm stall,
 * 0.222 s per 60° at 12 V, 55 g, a 1:345 metal gearbox and a 12-bit magnetic encoder over 360° with a multi-turn
 * mode, case 45.2 × 24.7 × 35 mm. The spline offset and the horn disc are NOT in the vendor listings found: they are
 * measured on the servo in hand and changed in its row before the pockets are printed (one number, one place). Every
 * figure is read from the row `sts3215-12v` in parts-catalog.json; a missing row fails the load.
 */
exports.STS3215_12V = servoSpecFrom((0, parts_catalog_1.servoRow)('sts3215-12v'));
/** The share of the rated stall a servo may hold continuously: the bench test ran stable at half its rating. */
exports.CONTINUOUS_FRACTION = 0.5;
/** A static hold is multiplied by this before it is compared: the torque to accelerate the same load. */
exports.DYNAMIC_ALLOWANCE = 1.3;
/** Measured backlash at the output (deg): what the tool's repeatability budget is built from. */
exports.BACKLASH_DEG = 0.87;
/** The share of the no-load speed the node commands: speed falls with load and the loop needs headroom. */
exports.SPEED_FRACTION = 0.4;
/** A printed GT2 belt stage loses about a tenth of its torque. */
exports.BELT_EFFICIENCY = 0.9;
/** @description The drive options in the order a joint is offered them: the simplest that holds wins. */
exports.DRIVE_OPTIONS = [
    { servos: 1, ratio: 1, label: 'one servo, direct on the joint' },
    { servos: 2, ratio: 1, label: 'two servos in parallel, direct, commanded together' },
    { servos: 1, ratio: 2, label: 'one servo through a 2:1 printed belt (multi-turn mode; homes on a printed hard stop)' },
    { servos: 2, ratio: 2, label: 'two servos through a 2:1 printed belt (multi-turn mode; homes on a printed hard stop)' },
    { servos: 1, ratio: 3, label: 'one servo through a 3:1 printed belt (multi-turn mode; homes on a printed hard stop)' },
    { servos: 2, ratio: 3, label: 'two servos through a 3:1 printed belt (multi-turn mode; homes on a printed hard stop)' },
];
/**
 * @description The torque and speed a drive gives the joint.
 * @param servo - The servo class.
 * @param cfg - The drive.
 * @returns Stall, continuous (usable) torque and the commanded speed at the joint.
 */
function driveOutput(servo, cfg) {
    const efficiency = cfg.ratio === 1 ? 1 : exports.BELT_EFFICIENCY;
    const stallNm = servo.stallNm * cfg.servos * cfg.ratio * efficiency;
    return { stallNm, usableNm: stallNm * exports.CONTINUOUS_FRACTION, commandedRadS: (servo.noLoadRadS * exports.SPEED_FRACTION) / cfg.ratio };
}
/**
 * @description The first drive option whose continuous torque covers the requirement, or null when none does.
 * @param servo - The servo class.
 * @param requiredNm - The joint's requirement (N·m): its worst static hold × the dynamic allowance, plus the torque to
 *   accelerate the stretched arm about a vertical axis.
 * @param options - The drives this joint can take (two servos need two cheeks: only the shoulder has them).
 * @returns The choice, or null (the design says the joint is undersized).
 */
function chooseDrive(servo, requiredNm, options = exports.DRIVE_OPTIONS) {
    for (const cfg of options) {
        const output = driveOutput(servo, cfg);
        // A joint with nothing to hold (a roll axis with its load on the axis) is reported at the cap, not at infinity.
        if (output.usableNm >= requiredNm)
            return { cfg, output, requiredNm, margin: Math.min(99, requiredNm > 0 ? output.usableNm / requiredNm : 99) };
    }
    return null;
}
//# sourceMappingURL=servos.js.map