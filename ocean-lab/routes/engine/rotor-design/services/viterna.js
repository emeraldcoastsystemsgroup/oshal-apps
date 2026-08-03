"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the Viterna post-stall extension to ±180°.
 *                     |                             | This is not a nicety for exotic operating points: a BEMT
 *                     |                             | induction solve brackets the inflow angle over the whole of
 *                     |                             | (0, π/2], and at start-up or low tip-speed ratio the bracket
 *                     |                             | genuinely contains angles of attack of 40–90°. Without a polar
 *                     |                             | defined there the residual has no sign change, the bisection
 *                     |                             | has nothing to converge on, and the solver either diverges or
 *                     |                             | quietly returns the last iterate as if it were an answer. The
 *                     |                             | coefficients are derived FROM the stall point, so the extension
 *                     |                             | reproduces cl and cd there exactly — continuity is a property
 *                     |                             | of the construction, not of a blend applied afterwards.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.viternaDragMax = viternaDragMax;
exports.viternaExtend = viternaExtend;
/** @description Aspect ratio above which the flat-plate drag ceiling stops growing. */
const AR_CEILING = 50;
/** @description Flat-plate drag ceiling for a very high aspect ratio blade. */
const CD_MAX_LIMIT = 2.01;
/**
 * @description Lift retained by a fully separated section in REVERSED flow, as a fraction of the
 * forward-flow value. Negative because the section is flying backwards; 0.7 is Viterna's own
 * value and the one AeroDyn and QBlade both carry.
 */
const REVERSED_FLOW_LIFT_FACTOR = -0.7;
/**
 * @description Maximum drag coefficient of a fully stalled blade element — the flat-plate limit.
 * It rises with aspect ratio because a long thin plate sheds a two-dimensional wake while a
 * stubby one lets flow spill round the tip.
 * @param aspectRatio - Blade aspect ratio (tip radius / mean chord).
 * @returns `1.11 + 0.018·AR`, capped at 2.01 for AR above 50.
 */
function viternaDragMax(aspectRatio) {
    if (!(aspectRatio > 0))
        throw new RangeError(`Viterna needs a positive aspect ratio, received ${aspectRatio}`);
    return aspectRatio > AR_CEILING ? CD_MAX_LIMIT : 1.11 + 0.018 * aspectRatio;
}
/**
 * @description Derive the Viterna coefficients from a stall point. Evaluated at the stall angle
 * the resulting curves return `clStall` and `cdStall` identically — that is worth checking by hand
 * once, because it is the only thing keeping the polar continuous where the solver crosses it.
 * @param stall - The hand-over point. See {@link ViternaStallPoint}.
 * @returns The four coefficients.
 * @throws RangeError when the stall angle is not strictly inside (0, π/2).
 */
function viternaCoefficients(stall) {
    const { alphaStallRad: as, clStall, cdStall } = stall;
    if (!(as > 0 && as < Math.PI / 2)) {
        throw new RangeError(`Viterna needs 0 < alphaStall < pi/2, received ${as}`);
    }
    const cdMax = viternaDragMax(stall.aspectRatio);
    const sin = Math.sin(as);
    const cos = Math.cos(as);
    return {
        a1: cdMax / 2,
        a2: ((clStall - cdMax * sin * cos) * sin) / (cos * cos),
        b1: cdMax,
        b2: (cdStall - cdMax * sin * sin) / cos,
    };
}
/**
 * @description The Viterna curves themselves, valid for `alphaStall ≤ α ≤ π/2`.
 * @param c - Coefficients from {@link viternaCoefficients}.
 * @param alphaRad - Angle of attack in the valid band, radians.
 * @returns Section coefficients.
 */
function viternaBranch(c, alphaRad) {
    const sin = Math.sin(alphaRad);
    const cos = Math.cos(alphaRad);
    return {
        cl: c.a1 * Math.sin(2 * alphaRad) + (c.a2 * cos * cos) / sin,
        cd: c.b1 * sin * sin + c.b2 * cos,
    };
}
/**
 * @description Coefficients on the reversed-flow side, `π/2 < α ≤ π − alphaStall`. The section is
 * flying backwards: drag mirrors the forward branch, lift mirrors it and flips sign, reduced by
 * {@link REVERSED_FLOW_LIFT_FACTOR} because a reversed aerofoil is a poor lifting shape.
 * @param c - Viterna coefficients.
 * @param alphaRad - Angle of attack, radians.
 * @returns Section coefficients.
 */
function reversedBranch(c, alphaRad) {
    const mirrored = viternaBranch(c, Math.PI - alphaRad);
    return { cl: REVERSED_FLOW_LIFT_FACTOR * mirrored.cl, cd: mirrored.cd };
}
/**
 * @description The last sliver, `π − alphaStall < α ≤ π`. The Viterna lift form has a `1/sin α`
 * factor and is therefore singular at α = π, so lift is tapered linearly to zero at exactly
 * reversed flow and drag is held at its value entering the sliver. This is the standard treatment
 * and it is a genuine approximation over an angle band a BEMT solve visits only at a stopped rotor.
 * @param c - Viterna coefficients.
 * @param alphaRad - Angle of attack, radians.
 * @param alphaStallRad - The stall angle, which also sets the sliver's width.
 * @returns Section coefficients.
 */
function tailBranch(c, alphaRad, alphaStallRad) {
    const edge = reversedBranch(c, Math.PI - alphaStallRad);
    const fraction = (Math.PI - alphaRad) / alphaStallRad;
    return { cl: edge.cl * fraction, cd: edge.cd };
}
/**
 * @description Post-stall section coefficients anywhere in `alphaStall ≤ |α| ≤ π`, by Viterna's
 * flat-plate extension.
 *
 * The function is ODD in lift and EVEN in drag about α = 0: a fully separated section has lost the
 * memory of its camber, so the negative-α side is the positive side mirrored. A cambered section
 * stalls at a different NEGATIVE angle than it does positive, which is a fact about where the
 * hand-over happens, not about the shape of the curve past it — {@link sectionPolar} owns that
 * asymmetry by handing over at two different angles, and this function stays a pure mirror.
 * @param stall - The hand-over point, stated with a POSITIVE stall angle. See {@link ViternaStallPoint}.
 * @param alphaRad - Angle of attack, radians, wrapped into [−π, π] by the caller or here.
 * @returns Section coefficients.
 * @throws RangeError when `|α| < alphaStallRad` — the attached-flow region belongs to the panel
 * solution and silently extrapolating into it would hide a caller's mistake.
 */
function viternaExtend(stall, alphaRad) {
    const wrapped = Math.atan2(Math.sin(alphaRad), Math.cos(alphaRad));
    const magnitude = Math.abs(wrapped);
    if (magnitude < stall.alphaStallRad) {
        throw new RangeError(`viternaExtend is defined for |alpha| >= alphaStall (${stall.alphaStallRad}); received ${wrapped}`);
    }
    const c = viternaCoefficients(stall);
    let forward;
    if (magnitude <= Math.PI / 2)
        forward = viternaBranch(c, magnitude);
    else if (magnitude <= Math.PI - stall.alphaStallRad)
        forward = reversedBranch(c, magnitude);
    else
        forward = tailBranch(c, magnitude, stall.alphaStallRad);
    return wrapped >= 0 ? forward : { cl: -forward.cl, cd: forward.cd };
}
