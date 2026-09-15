"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the kinematic servo rehearsal: each channel
 *                     |                             | tracks its commanded angle no faster than its rated speed
 *                     |                             | (a hobby servo's `s per 60°` becomes maxDegPerS), so a move
 *                     |                             | the servo cannot follow shows up as LAG before a single
 *                     |                             | pulse is sent. The report says, per channel, the peak lag,
 *                     |                             | how many frames it saturated, whether it settled, and the
 *                     |                             | verdict is three facets — followed, settled, no refusals —
 *                     |                             | all required. No load, no inertia: what is not modelled is
 *                     |                             | listed in ARCHITECTURE §what-is-not-modelled.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETTLE_TOLERANCE_DEG = exports.FOLLOW_TOLERANCE_DEG = void 0;
exports.rehearse = rehearse;
const rig_contract_1 = require("./rig-contract");
/** @description Lag above this many degrees counts as "the servo could not follow". */
exports.FOLLOW_TOLERANCE_DEG = 5;
/** @description Settled when within this many degrees of the final command. */
exports.SETTLE_TOLERANCE_DEG = 1;
/**
 * @description Rehearse a compiled stream on rate-limited servos.
 * @param rig - The rig (speeds per channel).
 * @param compiled - The compiled stream.
 * @param startAngles - Where each servo actually is when the stream starts (defaults to frame 0's command).
 * @returns The report.
 */
function rehearse(rig, compiled, startAngles) {
    const n = rig.channels.length;
    const stepMax = rig.channels.map((c) => c.maxDegPerS * (rig_contract_1.FRAME_MS / 1000));
    let pos = startAngles && startAngles.length === n ? startAngles.slice() : compiled.angles[0].slice();
    const actual = [];
    const maxLag = new Array(n).fill(0);
    const saturated = new Array(n).fill(0);
    const travel = new Array(n).fill(0);
    const lastChange = new Array(n).fill(0);
    const settledAt = new Array(n).fill(-1);
    for (let f = 0; f < compiled.angles.length; f += 1) {
        const cmd = compiled.angles[f];
        const next = pos.map((p, i) => {
            const delta = cmd[i] - p;
            const step = Math.sign(delta) * Math.min(Math.abs(delta), stepMax[i]);
            if (Math.abs(delta) > stepMax[i] + 1e-9)
                saturated[i] += 1;
            travel[i] += Math.abs(step);
            return p + step;
        });
        next.forEach((p, i) => {
            const lag = Math.abs(cmd[i] - p);
            maxLag[i] = Math.max(maxLag[i], lag);
            if (f > 0 && Math.abs(cmd[i] - compiled.angles[f - 1][i]) > 1e-9) {
                lastChange[i] = f;
                settledAt[i] = -1;
            }
            if (settledAt[i] < 0 && lag <= exports.SETTLE_TOLERANCE_DEG)
                settledAt[i] = f;
        });
        pos = next;
        actual.push(next.map((p) => Math.round(p * 100) / 100));
    }
    const channels = rig.channels.map((c, i) => ({
        id: c.id, output: c.channel, maxDegPerS: c.maxDegPerS, demandDegPerS: compiled.demandDegPerS[i],
        maxLagDeg: Math.round(maxLag[i] * 100) / 100, saturatedFrames: saturated[i],
        settled: settledAt[i] >= 0, settleMs: settledAt[i] >= 0 ? Math.max(0, (settledAt[i] - lastChange[i]) * rig_contract_1.FRAME_MS) : -1,
        travelDeg: Math.round(travel[i]),
    }));
    const reasons = [];
    const followed = channels.every((c) => c.maxLagDeg <= exports.FOLLOW_TOLERANCE_DEG);
    const settled = channels.every((c) => c.settled);
    for (const c of channels) {
        if (c.maxLagDeg > exports.FOLLOW_TOLERANCE_DEG)
            reasons.push(`${c.id} lags ${c.maxLagDeg}° (asked ${c.demandDegPerS}°/s, rated ${c.maxDegPerS}°/s)`);
        if (!c.settled)
            reasons.push(`${c.id} never settles within ${exports.SETTLE_TOLERANCE_DEG}°`);
    }
    return { durationMs: compiled.durationMs, frames: compiled.angles.length, channels, actual, verdict: { followed, settled, ok: followed && settled, reasons } };
}
