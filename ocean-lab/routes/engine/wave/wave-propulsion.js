"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the wave-propulsion model, WRITTEN rather than
 *                     |                             | carved: no copy existed in any repository, only its governing
 *                     |                             | math in the ambient-energy vessel report (core
 *                     |                             | docs/research/ambient-energy-vessel-report.pdf, "2 — The math")
 *                     |                             | and the explorer design study. This file is that math, term
 *                     |                             | for term: the heave w(t) = A*omega*cos(omega*t) the float
 *                     |                             | forces on the sub; the inclined-flow thrust
 *                     |                             | T = q[CL(alpha) sin(theta) - CD(alpha) cos(theta)] with
 *                     |                             | alpha = max(0, theta - beta_stop); the vertical balance
 *                     |                             | n*Fz <= (B_float - W_sub) up and <= W_sub down that slows the
 *                     |                             | heave; Theodorsen's lift deficiency through R.T. Jones'
 *                     |                             | rational approximation; the ITTC-57 friction line with one
 *                     |                             | form factor; and the closure T_mean(U) = D(U) solved under the
 *                     |                             | kinematic ceiling U_max = w_heave / tan(beta_stop). CL and CD
 *                     |                             | are ocean-lab's existing section polar (panel-method lift,
 *                     |                             | correlation drag); rho, nu and g come from the MEDIUM passed
 *                     |                             | in, never a constant here. Pure and deterministic: no clock,
 *                     |                             | no randomness, no I/O.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ITTC_REYNOLDS_FLOOR = exports.PHASE_SAMPLES = exports.WAVE_ENGINE = void 0;
exports.heaveVelocity = heaveVelocity;
exports.peakHeaveMs = peakHeaveMs;
exports.kinematicCeilingMs = kinematicCeilingMs;
exports.theodorsenMagnitude = theodorsenMagnitude;
exports.wingForces = wingForces;
exports.heaveBudgetsN = heaveBudgetsN;
exports.balancedHeaveMs = balancedHeaveMs;
exports.cycleMeanThrustN = cycleMeanThrustN;
exports.ittcFrictionCoefficient = ittcFrictionCoefficient;
exports.resistanceN = resistanceN;
exports.equilibrium = equilibrium;
const section_polar_1 = require("../rotor-design/services/section-polar");
/** @description The engine's identity, carried on every run it answers (ADR-160 D5). Bump the version when a number it produces can change. */
exports.WAVE_ENGINE = Object.freeze({ id: 'ocean-lab.wave-propulsion', version: '1.0.0' });
/** @description Samples per wave cycle for the cycle-mean thrust: the midpoint rule over one period. */
exports.PHASE_SAMPLES = 72;
/** @description Floor on the Reynolds number the ITTC-57 line is evaluated at. The line diverges at Re = 100 and was fitted to ship hulls far above this; below it the coefficient is HELD at its Re = 1e3 value rather than run toward infinity. */
exports.ITTC_REYNOLDS_FLOOR = 1e3;
/** @description The heave velocity the float forces on the sub: w(t) = A*omega*cos(omega*t), A = H/2, omega = 2*pi/T. @param sea - The sea state. @param phaseRad - omega*t. @returns m/s, positive up. */
function heaveVelocity(sea, phaseRad) {
    const omega = (2 * Math.PI) / sea.periodS;
    return (sea.heightM / 2) * omega * Math.cos(phaseRad);
}
/** @description Peak heave, w_max = pi*H/T — steepness, not height. @param sea - The sea state. @returns m/s. */
function peakHeaveMs(sea) {
    return (Math.PI * sea.heightM) / sea.periodS;
}
/** @description The governing limit, U_max = w_heave / tan(beta_stop): past it theta falls below the stop, the wing weathervanes flat and lift vanishes. @param heaveMs - Heave speed. @param stopAngleRad - The mechanical stop. @returns m/s. */
function kinematicCeilingMs(heaveMs, stopAngleRad) {
    return Math.abs(heaveMs) / Math.tan(stopAngleRad);
}
/** @description |C(k)|, Theodorsen's lift deficiency by R.T. Jones' rational approximation C(k) = 1 - 0.165/(1 - 0.0455i/k) - 0.335/(1 - 0.3i/k). @param k - Reduced frequency omega*c/(2V). @returns The magnitude, in (0.5, 1]; exactly 1 at k = 0 (steady). */
function theodorsenMagnitude(k) {
    if (!(k > 0))
        return 1;
    const pole = (weight, b) => {
        const x = b / k;
        const d = 1 + x * x;
        return [weight / d, (weight * x) / d];
    };
    const [r1, i1] = pole(0.165, 0.0455);
    const [r2, i2] = pole(0.335, 0.3);
    return Math.hypot(1 - r1 - r2, -(i1 + i2));
}
/**
 * @description One wing at one instant: flow inclined at theta = atan(|w|/U), angle of attack
 * alpha = max(0, theta - beta_stop), lift reduced by |C(k)|. When theta is at or below the stop the
 * wing weathervanes flat: lift is EXACTLY zero (not the panel method's 1e-15) and profile drag remains.
 * @param v - The vehicle. @param fluid - The fluid. @param forwardMs - U. @param heaveMs - |w| (sign is irrelevant: the wing flips to its opposite stop). @param omega - 2*pi/T, for the reduced frequency.
 * @returns The forces, in newtons, on one wing.
 */
function wingForces(v, fluid, forwardMs, heaveMs, omega) {
    const w = Math.abs(heaveMs);
    const speed = Math.hypot(forwardMs, w);
    const thetaRad = Math.atan2(w, forwardMs);
    const alphaRad = Math.max(0, thetaRad - v.stopAngleRad);
    if (speed === 0)
        return { thetaRad, alphaRad, reynolds: 0, cl: 0, cd: 0, liftDeficiency: 1, liftThrustN: 0, profileDragN: 0, thrustN: 0, normalN: 0 };
    const reynolds = (speed * v.wingChordM) / fluid.kinematicViscosityM2S;
    const polar = (0, section_polar_1.sectionPolar)(v.section, alphaRad, reynolds, { aspectRatio: v.wingSpanM / v.wingChordM });
    const liftDeficiency = theodorsenMagnitude((omega * v.wingChordM) / (2 * speed));
    const cl = alphaRad > 0 ? polar.cl * liftDeficiency : 0;
    const q = 0.5 * fluid.densityKgM3 * speed * speed * v.wingSpanM * v.wingChordM;
    const liftThrustN = q * cl * Math.sin(thetaRad);
    const profileDragN = q * polar.cd * Math.cos(thetaRad);
    return {
        thetaRad, alphaRad, reynolds, cl, cd: polar.cd, liftDeficiency,
        liftThrustN, profileDragN, thrustN: liftThrustN - profileDragN,
        normalN: q * (cl * Math.cos(thetaRad) + polar.cd * Math.sin(thetaRad)),
    };
}
/** @description The float's buoyancy and the ballast: the two budgets the vertical balance holds the wings to. @param v - The vehicle. @param fluid - The fluid. @returns Newtons available on the upstroke and on the downstroke. */
function heaveBudgetsN(v, fluid) {
    const buoyancyN = fluid.densityKgM3 * fluid.gravityMps2 * v.floatDisplacementM3;
    return { upN: Math.max(0, buoyancyN - v.subNetWeightN), downN: v.subNetWeightN };
}
/**
 * @description The vertical balance: the wings' force normal to the flow resists the heave, and when
 * n*Fz exceeds the budget (the float's reserve up, only ballast down) the sub heaves slower than the
 * wave. Returns the largest heave at or below the forced one that the budget carries (bisection; Fz
 * grows with heave at a fixed forward speed).
 * @param v - The vehicle. @param fluid - The fluid. @param forwardMs - U. @param forcedMs - The wave's heave w(t), signed. @param omega - 2*pi/T.
 * @returns The heave magnitude the sub actually follows, m/s.
 */
function balancedHeaveMs(v, fluid, forwardMs, forcedMs, omega) {
    const budgets = heaveBudgetsN(v, fluid);
    const budget = forcedMs > 0 ? budgets.upN : budgets.downN;
    const loads = (w) => v.wingCount * wingForces(v, fluid, forwardMs, w, omega).normalN > budget;
    const forced = Math.abs(forcedMs);
    if (!loads(forced))
        return forced;
    let lo = 0;
    let hi = forced;
    for (let i = 0; i < 40; i += 1) {
        const mid = (lo + hi) / 2;
        if (loads(mid))
            hi = mid;
        else
            lo = mid;
    }
    return lo;
}
/** @description T_mean(U): all n wings' thrust averaged over one wave cycle, each instant at the heave the vertical balance allows. Both halves push. @param v - The vehicle. @param fluid - The fluid. @param sea - The sea state. @param forwardMs - U. @returns Newtons. */
function cycleMeanThrustN(v, fluid, sea, forwardMs) {
    const omega = (2 * Math.PI) / sea.periodS;
    let sum = 0;
    for (let i = 0; i < exports.PHASE_SAMPLES; i += 1) {
        const forced = heaveVelocity(sea, ((i + 0.5) / exports.PHASE_SAMPLES) * 2 * Math.PI);
        const heave = balancedHeaveMs(v, fluid, forwardMs, forced, omega);
        sum += v.wingCount * wingForces(v, fluid, forwardMs, heave, omega).thrustN;
    }
    return sum / exports.PHASE_SAMPLES;
}
/** @description The ITTC-57 friction line, CF = 0.075 / (log10(Re) - 2)^2, held at ITTC_REYNOLDS_FLOOR below it. @param reynolds - Re over the component's streamwise length. @returns CF. */
function ittcFrictionCoefficient(reynolds) {
    const re = Math.max(reynolds, exports.ITTC_REYNOLDS_FLOOR);
    return 0.075 / (Math.log10(re) - 2) ** 2;
}
/** @description The report's closure as written, D(U) = 1/2 rho U^2 * S_wet * (CF(Re_L) * k_form + C_R): one wetted area (the float, the sub and the tether summed), one friction line at Re_L = U*L/nu, one form factor. The wings' own drag is already in the thrust term, so it is not charged twice. C_R(Fr) is NOT modelled (see the engine's notModelled list). @param v - The vehicle. @param fluid - The fluid. @param forwardMs - U. @returns Newtons. */
function resistanceN(v, fluid, forwardMs) {
    const wettedM2 = v.wetted.reduce((sum, part) => sum + part.areaM2, 0);
    const cf = ittcFrictionCoefficient((forwardMs * v.frictionLengthM) / fluid.kinematicViscosityM2S);
    return 0.5 * fluid.densityKgM3 * forwardMs * forwardMs * wettedM2 * cf * v.formFactor;
}
/** @description Speeds below this are the model's own zero: thrust at the smallest speed probed does not exceed drag. */
const SPEED_FLOOR_MS = 1e-6;
/**
 * @description Solve T_mean(U) = D(U) for U by bisection on [SPEED_FLOOR_MS, U_max(w_max)]. Zero when
 * thrust never exceeds drag (the wing makes no net thrust in this sea); the ceiling itself is never
 * exceeded, because past it every wing is flat and only drag remains.
 * @param v - The vehicle. @param fluid - The fluid. @param sea - The sea state.
 * @returns The equilibrium speed, the kinematic ceiling at the peak heave, and the thrust at rest.
 */
function equilibrium(v, fluid, sea) {
    const peak = peakHeaveMs(sea);
    const ceilingMs = kinematicCeilingMs(peak, v.stopAngleRad);
    const net = (u) => cycleMeanThrustN(v, fluid, sea, u) - resistanceN(v, fluid, u);
    const thrustAtRestN = cycleMeanThrustN(v, fluid, sea, SPEED_FLOOR_MS);
    if (!(ceilingMs > SPEED_FLOOR_MS) || net(SPEED_FLOOR_MS) <= 0)
        return { speedMs: 0, ceilingMs, peakHeaveMs: peak, thrustAtRestN };
    let lo = SPEED_FLOOR_MS;
    let hi = ceilingMs;
    for (let i = 0; i < 60; i += 1) {
        const mid = (lo + hi) / 2;
        if (net(mid) > 0)
            lo = mid;
        else
            hi = mid;
    }
    return { speedMs: lo, ceilingMs, peakHeaveMs: peak, thrustAtRestN };
}
