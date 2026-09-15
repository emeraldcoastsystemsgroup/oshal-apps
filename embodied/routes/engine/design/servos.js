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
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DRIVE_OPTIONS = exports.BELT_EFFICIENCY = exports.SPEED_FRACTION = exports.BACKLASH_DEG = exports.DYNAMIC_ALLOWANCE = exports.CONTINUOUS_FRACTION = exports.STS3215_12V = void 0;
exports.driveOutput = driveOutput;
exports.chooseDrive = chooseDrive;
const KGCM_TO_NM = 0.0980665;
/**
 * @description The 12 V STS3215: the default joint actuator of the open SO-ARM100/101 arms. Rated 30 kg·cm stall,
 * 0.222 s per 60° at 12 V, 55 g, a 1:345 metal gearbox and a 12-bit magnetic encoder over 360° with a multi-turn
 * mode, case 45.2 × 24.7 × 35 mm. The spline offset and the horn disc are NOT in the vendor listings found: they are
 * measured on the servo in hand and changed here before the pockets are printed (one number, one place).
 */
exports.STS3215_12V = {
    id: 'sts3215-12v',
    name: 'Feetech STS3215 class serial-bus servo, 12 V, 1:345 metal gearbox',
    stallNm: 30 * KGCM_TO_NM,
    noLoadRadS: (Math.PI / 3) / 0.222,
    massG: 55,
    bodyMm: [45.2, 24.7, 35],
    splineOffsetMm: 10,
    hornDiscMm: 23,
    encoder: '12-bit magnetic (4096 steps per turn), 0–360° plus a multi-turn mode',
    approxUsdEach: 20,
    source: 'rated figures and case: feetechrc.com STS3215 12 V product page (https://www.feetechrc.com/525603.html); continuous duty: robonine.com bench test (https://robonine.com/testing-of-feetech-sts3215-servomotor-backlash-repeatability-and-torque/) — stable at 15 kg·cm for 10 min, overload protection after a few cycles at 20 kg·cm, backlash about 0.87°',
};
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