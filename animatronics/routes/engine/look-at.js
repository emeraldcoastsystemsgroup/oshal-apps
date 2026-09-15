"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — LOOK_AT: a bearing (azimuth right-positive,
 *                     |                             | elevation up-positive, degrees, in the prop's forward frame)
 *                     |                             | is split between the eye gimbal and the neck the way a
 *                     |                             | tracking eye does it — the eyes take their share first and
 *                     |                             | move fast, the neck takes the rest and follows slower, and
 *                     |                             | whatever neither can reach is reported as the residual, never
 *                     |                             | silently clamped away. The result is an ordinary `together`
 *                     |                             | scenario the compiler and the rehearsal treat like any other.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookAt = lookAt;
const rig_contract_1 = require("./rig-contract");
const rig_contract_2 = require("./rig-contract");
const clamp = (ch, deg) => (ch ? Math.min(ch.maxDeg, Math.max(ch.minDeg, deg)) : 0);
const r2 = (v) => Math.round(v * 100) / 100;
/** Split one angle between a fast axis and a slow axis; returns [fast, slow, residual]. */
function split(total, fast, slow, share) {
    if (!fast && !slow)
        return [0, 0, total];
    if (!slow) {
        const f = clamp(fast, total);
        return [f, 0, total - f];
    }
    if (!fast) {
        const s = clamp(slow, total);
        return [0, s, total - s];
    }
    let f = clamp(fast, total * share);
    let s = clamp(slow, total - f);
    f = clamp(fast, total - s);
    s = clamp(slow, total - f);
    return [f, s, total - f - s];
}
/**
 * @description Build the pose and steps that point the rig at a bearing.
 * @param rig - The rig (needs an eye-gimbal and/or a neck mechanism).
 * @param bearing - {azDeg, elDeg}.
 * @param opts - Tuning.
 * @returns The look-at result.
 */
function lookAt(rig, bearing, opts = {}) {
    const az = Number(bearing.azDeg);
    const el = Number(bearing.elDeg);
    if (!Number.isFinite(az) || Math.abs(az) > 180)
        throw new rig_contract_1.ContractError('azDeg must be a number within ±180', 'azDeg');
    if (!Number.isFinite(el) || Math.abs(el) > 90)
        throw new rig_contract_1.ContractError('elDeg must be a number within ±90', 'elDeg');
    const share = opts.eyeShare === undefined ? 0.6 : Number(opts.eyeShare);
    if (!Number.isFinite(share) || share < 0 || share > 1)
        throw new rig_contract_1.ContractError('eyeShare must be 0…1', 'eyeShare');
    const eyes = rig.mechanisms.find((m) => m.kind === 'eye-gimbal');
    const neck = rig.mechanisms.find((m) => m.kind === 'neck');
    if (!eyes && !neck)
        throw new rig_contract_1.ContractError('the rig has no eye-gimbal and no neck to look with', 'rig.mechanisms');
    const axes = (0, rig_contract_2.axisMap)(rig);
    const eyePan = eyes ? axes.get(`${eyes.id}.pan`) : undefined;
    const eyeTilt = eyes ? axes.get(`${eyes.id}.tilt`) : undefined;
    const neckYaw = neck ? axes.get(`${neck.id}.yaw`) : undefined;
    const neckPitch = neck ? axes.get(`${neck.id}.pitch`) : undefined;
    const [pan, yaw, resAz] = split(az, eyePan, neckYaw, share);
    const [tilt, pitch, resEl] = split(el, eyeTilt, neckPitch, share);
    const pose = {};
    const eyeAxes = {};
    const neckAxes = {};
    if (eyes) {
        eyeAxes[`${eyes.id}.pan`] = r2(pan);
        if (eyeTilt)
            eyeAxes[`${eyes.id}.tilt`] = r2(tilt);
    }
    if (neck) {
        neckAxes[`${neck.id}.yaw`] = r2(yaw);
        if (neckPitch)
            neckAxes[`${neck.id}.pitch`] = r2(pitch);
    }
    Object.assign(pose, eyeAxes, neckAxes);
    const easeName = opts.ease ?? 'in-out';
    const children = [];
    if (Object.keys(eyeAxes).length)
        children.push({ kind: 'move', axes: eyeAxes, ms: opts.eyeMs ?? 120, ease: easeName });
    if (Object.keys(neckAxes).length)
        children.push({ kind: 'move', axes: neckAxes, ms: opts.neckMs ?? 350, ease: easeName });
    const steps = children.length > 1 ? [{ kind: 'together', steps: children }] : children;
    const residual = { az: r2(resAz), el: r2(resEl) };
    return { pose, steps, residualDeg: residual, reachable: Math.abs(residual.az) < 0.5 && Math.abs(residual.el) < 0.5, used: { eyes: eyes?.id, neck: neck?.id } };
}
