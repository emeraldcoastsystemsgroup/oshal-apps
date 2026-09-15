"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — propulsion sizing for the printed recon drone by
 *                     |                             | momentum theory: hover power from disc loading, electrical power
 *                     |                             | through a figure of merit and a drive efficiency, hover time from
 *                     |                             | the usable battery energy, thrust targets per motor, tip speed.
 *                     |                             | Every number the hardware design quotes comes from here; the
 *                     |                             | figure of merit is the placeholder aero-lab's propeller curves
 *                     |                             | replace.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SIZING_ASSUMPTIONS = void 0;
exports.sizeHover = sizeHover;
exports.tipSpeedMps = tipSpeedMps;
exports.DEFAULT_SIZING_ASSUMPTIONS = { figureOfMerit: 0.60, driveEfficiency: 0.75, usableFraction: 0.80, nominalVPerCell: 3.7, airDensity: 1.225 };
const G = 9.81;
const INCH = 0.0254;
/**
 * @description Momentum-theory hover: `P_ideal = W^1.5 / sqrt(2 ρ A)`, `P_electrical = P_ideal / (FM · η)`,
 * hover time = usable energy / electrical power.
 * @param input - Prop size, all-up mass, battery.
 * @param a - Assumptions (defaults are the design document's placeholders).
 * @returns The sizing.
 */
function sizeHover(input, a = exports.DEFAULT_SIZING_ASSUMPTIONS) {
    const discAreaM2 = 4 * Math.PI * ((input.propIn * INCH) / 2) ** 2;
    const weightN = (input.auwG / 1000) * G;
    const pIdealW = weightN ** 1.5 / Math.sqrt(2 * a.airDensity * discAreaM2);
    const pElectricalW = pIdealW / (a.figureOfMerit * a.driveEfficiency);
    const energyWh = (input.cells * a.nominalVPerCell * input.mAh) / 1000;
    return {
        propIn: input.propIn, auwG: input.auwG, cells: input.cells, mAh: input.mAh,
        discAreaM2, discLoadingNm2: weightN / discAreaM2, pIdealW, pElectricalW, energyWh,
        hoverMin: ((a.usableFraction * energyWh) / pElectricalW) * 60,
        thrustPerMotorHoverG: input.auwG / 4,
        thrustPerMotorTw2G: (input.auwG * 2) / 4,
    };
}
/**
 * @description Blade tip speed at an rpm — keep it under ~75 m/s in an occupied room.
 * @param propIn - Prop diameter in inches.
 * @param rpm - Shaft speed.
 * @returns Metres per second.
 */
function tipSpeedMps(propIn, rpm) {
    return (Math.PI * propIn * INCH * rpm) / 60;
}
//# sourceMappingURL=propulsion.js.map