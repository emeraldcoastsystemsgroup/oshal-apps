"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the supply budget the servo projects keep
 *                     |                             | re-learning: idle, moving and stall current per servo from
 *                     |                             | the catalog, summed against the rig's actuator supply. The
 *                     |                             | peak is counted per FRAME (only the servos that move in that
 *                     |                             | frame draw moving current), stall is the all-at-once worst
 *                     |                             | case, and a USB port (5 V / 0.5 A) with more than one servo
 *                     |                             | is refused outright — logic power and actuator power are
 *                     |                             | separate rails. A servo outside its voltage range refuses
 *                     |                             | too. Verdicts: ok | warn (peak > 80 %) | refuse.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOVING_THRESHOLD_DEG = void 0;
exports.budgetPower = budgetPower;
const r3 = (v) => Math.round(v * 1000) / 1000;
/** @description Angle change per frame below which a servo is counted as holding, not moving. */
exports.MOVING_THRESHOLD_DEG = 0.05;
/**
 * @description Budget a rig's supply against a compiled stream (or against idle only, when none is given).
 * @param rig - The rig.
 * @param rows - Catalog rows by model id.
 * @param compiled - The stream whose motion is budgeted; omitted = idle and stall only.
 * @returns The report.
 */
function budgetPower(rig, rows, compiled) {
    const reasons = [];
    const channels = rig.channels.map((c) => {
        const row = rows.get(c.model);
        if (!row) {
            reasons.push(`${c.id}: model ${c.model} is not in the servo catalog`);
            return { id: c.id, model: c.model, idleMa: 0, movingMa: 0, stallMa: 0, volts: [0, 0] };
        }
        if (rig.supply.volts < row.voltsMin || rig.supply.volts > row.voltsMax)
            reasons.push(`${c.id}: ${row.name} takes ${row.voltsMin}–${row.voltsMax} V, the supply is ${rig.supply.volts} V`);
        return { id: c.id, model: c.model, idleMa: row.idleMa, movingMa: row.movingMa, stallMa: row.stallMa, volts: [row.voltsMin, row.voltsMax] };
    });
    const idleA = r3(channels.reduce((a, c) => a + c.idleMa, 0) / 1000);
    const stallA = r3(channels.reduce((a, c) => a + c.stallMa, 0) / 1000);
    let peakMovingA = idleA;
    let peakMovingFrame = 0;
    let peakMovingChannels = [];
    if (compiled) {
        for (let f = 1; f < compiled.angles.length; f += 1) {
            const moving = channels.filter((_, i) => Math.abs(compiled.angles[f][i] - compiled.angles[f - 1][i]) > exports.MOVING_THRESHOLD_DEG);
            const a = channels.reduce((sum, c) => sum + (moving.includes(c) ? c.movingMa : c.idleMa), 0) / 1000;
            if (a > peakMovingA) {
                peakMovingA = a;
                peakMovingFrame = f;
                peakMovingChannels = moving.map((c) => c.id);
            }
        }
    }
    else if (channels.length) {
        peakMovingA = channels.reduce((a, c) => a + c.movingMa, 0) / 1000;
        peakMovingChannels = channels.map((c) => c.id);
    }
    peakMovingA = r3(peakMovingA);
    const headroom = rig.supply.amps > 0 ? r3(1 - peakMovingA / rig.supply.amps) : 0;
    let verdict = 'ok';
    if (rig.supply.source === 'usb' && rig.channels.length > 1) {
        verdict = 'refuse';
        reasons.push('a USB port is not an actuator supply: give the servos their own 5–6 V rail and share only ground');
    }
    if (peakMovingA > rig.supply.amps) {
        verdict = 'refuse';
        reasons.push(`peak draw ${peakMovingA} A exceeds the ${rig.supply.amps} A supply (frame ${peakMovingFrame}: ${peakMovingChannels.join(', ')})`);
    }
    else if (peakMovingA > 0.8 * rig.supply.amps && verdict === 'ok') {
        verdict = 'warn';
        reasons.push(`peak draw ${peakMovingA} A is over 80 % of the ${rig.supply.amps} A supply`);
    }
    const notes = [];
    if (stallA > rig.supply.amps)
        notes.push(`all servos stalled would draw ${stallA} A — a jammed mechanism will brown the ${rig.supply.amps} A rail out; fuse the servo rail and keep the logic supply separate`);
    if (reasons.some((r) => /takes .* V|not in the servo catalog/.test(r)))
        verdict = 'refuse';
    return { supply: { ...rig.supply }, idleA, peakMovingA, peakMovingFrame, peakMovingChannels, stallA, headroom, verdict, reasons, notes, channels };
}
