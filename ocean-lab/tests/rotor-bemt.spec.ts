/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the acceptance gate for the blade element
 *                     |                             | momentum solver. The BETZ guard is the one that decides whether
 *                     |                             | any other number here means anything: with drag removed and a
 *                     |                             | high blade count an ideal rotor must walk UP to 16/27 and never
 *                     |                             | cross it, at any tip-speed ratio in the sweep. A BEMT that
 *                     |                             | breaks Betz has a broken high-induction correction and every
 *                     |                             | Cp it has ever printed is wrong. The remaining guards are
 *                     |                             | comparative and each isolates ONE term: drag must strictly
 *                     |                             | lower Cp, tip loss must strictly lower Cp and must hurt more
 *                     |                             | with fewer blades, and shrinking the rotor at fixed inflow must
 *                     |                             | measurably lower peak Cp — which is the low-Reynolds result the
 *                     |                             | whole slice exists to report rather than smooth away.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Three additions, and one claim above narrowed. GUARD 6 measured
 *                     |                             | convergence only through solveBemt — cpCurve returned bare
 *                     |                             | {lambda, cp}, so a swept curve could be integrated over a
 *                     |                             | partly unsolved blade with nothing in the returned data saying
 *                     |                             | so; that is now asserted on the POINT. The claim that the
 *                     |                             | inflow bracket always contains a root is false and there is now
 *                     |                             | a fixture that pins the counter-example. And "tip loss strictly
 *                     |                             | lowers Cp" is only true near and above the design point: deep
 *                     |                             | in stall it can RAISE Cp, for a traceable reason, and that
 *                     |                             | exception is pinned so nobody "fixes" it by moving the loss
 *                     |                             | factor into the load integral, where it does not belong.
 */

import { describe, expect, it } from 'vitest';
import {
  BETZ_LIMIT,
  axialInduction,
  betzOptimalBlade,
  bladeToMesh,
  cpCurve,
  prandtlHubLoss,
  prandtlTipLoss,
  referenceTidalFlow,
  referenceTidalRotor,
  scaleBlade,
  sectionRingLength,
  solveBemt,
  type BladeSpec,
  type CpCurvePoint,
  type FlowCondition,
} from '../src-routes/engine/rotor-design';
import {
  recomputeNormals,
  stlBinaryByteLength,
  toObj,
  toStlAscii,
  toStlBinary,
  validateMesh,
} from '../src-routes/engine/geometry';

/**
 * Every assertion in this file runs REAL BEMT solves — a sweep is dozens of rotor solves, each of
 * which is dozens of bracketed root-finds. That is minutes of arithmetic on a loaded machine, and
 * vitest's five-second default would turn these guards into a gate that goes red for reasons that
 * have nothing to do with the physics. A guard nobody trusts is a guard that does not exist, so
 * the budget here is deliberately generous and stated once.
 */
const SWEEP_TIMEOUT_MS = 180_000;

/** A full sweep, fine enough that a single-peak claim is a real claim. */
const LAMBDA_SWEEP: number[] = [];
for (let lambda = 0.5; lambda <= 12.001; lambda += 0.5) LAMBDA_SWEEP.push(Number(lambda.toFixed(2)));

/** The zero-drag, many-bladed ideal rotor the Betz guard is measured on. */
const idealRotor = (): BladeSpec =>
  betzOptimalBlade({
    tipRadiusM: 50,
    bladeCount: 60,
    designTipSpeedRatio: 7,
    hubRadiusFrac: 0.05,
    stationCount: 17,
  });

const peakOf = (curve: CpCurvePoint[]): CpCurvePoint =>
  curve.reduce((best, point) => (point.cp > best.cp ? point : best));

const atLambda = (blade: BladeSpec, flow: FlowCondition, lambda: number): FlowCondition => ({
  ...flow,
  rotationRadS: (lambda * flow.freeStreamMs) / blade.tipRadiusM,
});

describe('GUARD 1 — the Betz limit', () => {
  it('approaches 16/27 FROM BELOW with drag removed and never crosses it anywhere in the sweep', () => {
    const curve = cpCurve(idealRotor(), referenceTidalFlow(), LAMBDA_SWEEP, {
      dragEnabled: false,
      elementCount: 80,
    });
    const peak = peakOf(curve);
    expect(BETZ_LIMIT).toBeCloseTo(16 / 27, 15);
    for (const point of curve) expect(point.cp).toBeLessThan(BETZ_LIMIT);
    expect(peak.cp).toBeGreaterThan(0.55);
    expect(peak.cp / BETZ_LIMIT).toBeGreaterThan(0.93);
    expect(peak.lambda).toBeGreaterThan(5);
  }, SWEEP_TIMEOUT_MS);

  it('keeps the REAL rotor below Betz too — the limit is not a property of the ideal case', () => {
    const blade = referenceTidalRotor();
    for (const point of cpCurve(blade, referenceTidalFlow(), LAMBDA_SWEEP)) {
      expect(point.cp).toBeLessThan(BETZ_LIMIT);
    }
    for (const point of cpCurve(scaleBlade(blade, 10), referenceTidalFlow(), LAMBDA_SWEEP)) {
      expect(point.cp).toBeLessThan(BETZ_LIMIT);
    }
  }, SWEEP_TIMEOUT_MS);

  it('applies the Glauert/Buhl correction above a = 0.4 and joins the momentum branch exactly', () => {
    for (const lossFactor of [1, 0.8, 0.5, 0.2]) {
      const momentum = axialInduction((2 / 3) * (1 - 1e-12), lossFactor);
      const buhl = axialInduction((2 / 3) * (1 + 1e-12), lossFactor);
      expect(momentum).toBeCloseTo(0.4, 8);
      expect(buhl).toBeCloseTo(0.4, 8);
    }
    // Below the threshold it IS the momentum relation, exactly.
    expect(axialInduction(0.25, 1)).toBeCloseTo(0.25 / 1.25, 12);
    // Above it the correction bites: the naive relation is strictly more optimistic.
    for (const kappa of [1, 2, 5, 20, 200]) {
      expect(axialInduction(kappa, 1)).toBeLessThan(kappa / (1 + kappa));
      expect(axialInduction(kappa, 1)).toBeLessThan(1);
      expect(axialInduction(kappa, 1)).toBeGreaterThan(0.4);
    }
  }, SWEEP_TIMEOUT_MS);
});

describe('GUARD 2 — the Cp(lambda) curve has a single peak', () => {
  const singlePeaked = (curve: CpCurvePoint[]): void => {
    const index = curve.indexOf(peakOf(curve));
    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThan(curve.length - 1);
    for (let i = 1; i <= index; i += 1) expect(curve[i].cp).toBeGreaterThan(curve[i - 1].cp);
    for (let i = index + 1; i < curve.length; i += 1) expect(curve[i].cp).toBeLessThan(curve[i - 1].cp);
  };

  it('rises, peaks and falls for the ideal rotor', () => {
    singlePeaked(
      cpCurve(idealRotor(), referenceTidalFlow(), LAMBDA_SWEEP, { dragEnabled: false, elementCount: 80 }),
    );
  }, SWEEP_TIMEOUT_MS);

  it('rises, peaks and falls for the printable reference rotor', () => {
    singlePeaked(cpCurve(referenceTidalRotor(), referenceTidalFlow(), LAMBDA_SWEEP));
  }, SWEEP_TIMEOUT_MS);

  it('rises, peaks and falls for the same geometry at utility scale', () => {
    singlePeaked(cpCurve(scaleBlade(referenceTidalRotor(), 10), referenceTidalFlow(), LAMBDA_SWEEP));
  }, SWEEP_TIMEOUT_MS);
});

describe('GUARD 3 — drag strictly lowers Cp', () => {
  it('lowers Cp at EVERY tip-speed ratio in the sweep, for both rotor sizes', () => {
    const flow = referenceTidalFlow();
    for (const blade of [referenceTidalRotor(), scaleBlade(referenceTidalRotor(), 10)]) {
      const withDrag = cpCurve(blade, flow, LAMBDA_SWEEP);
      const without = cpCurve(blade, flow, LAMBDA_SWEEP, { dragEnabled: false });
      for (let i = 0; i < LAMBDA_SWEEP.length; i += 1) {
        expect(without[i].cp).toBeGreaterThan(withDrag[i].cp);
      }
    }
  }, SWEEP_TIMEOUT_MS);

  it('costs more at high tip-speed ratio, where the drag vector points further round the circle', () => {
    const blade = scaleBlade(referenceTidalRotor(), 10);
    const flow = referenceTidalFlow();
    const cost = (lambda: number): number =>
      cpCurve(blade, flow, [lambda], { dragEnabled: false })[0].cp - cpCurve(blade, flow, [lambda])[0].cp;
    expect(cost(10)).toBeGreaterThan(cost(3));
  }, SWEEP_TIMEOUT_MS);
});

describe('GUARD 4 — Prandtl tip loss strictly lowers Cp, and more so with fewer blades', () => {
  const relativeCost = (bladeCount: number): number => {
    const blade = betzOptimalBlade({ tipRadiusM: 10, bladeCount, designTipSpeedRatio: 6 });
    const flow = referenceTidalFlow();
    const withLoss = cpCurve(blade, flow, [6])[0].cp;
    const without = cpCurve(blade, flow, [6], { tipLossEnabled: false })[0].cp;
    expect(without).toBeGreaterThan(withLoss);
    return (without - withLoss) / without;
  };

  it('costs a three-bladed rotor several times what it costs a twelve-bladed one', () => {
    const three = relativeCost(3);
    const twelve = relativeCost(12);
    expect(three).toBeGreaterThan(twelve);
    expect(three).toBeGreaterThan(0.05);
    expect(three / twelve).toBeGreaterThan(2);
  }, SWEEP_TIMEOUT_MS);

  it('costs more with two blades than with three — the trend continues, it is not a two-point fluke', () => {
    expect(relativeCost(2)).toBeGreaterThan(relativeCost(3));
  }, SWEEP_TIMEOUT_MS);

  it('uses the RIGHT denominator in each Prandtl term — hub divides by Rhub, tip divides by r', () => {
    const factor = (f: number): number => (2 / Math.PI) * Math.acos(Math.exp(-f));
    expect(prandtlTipLoss(3, 8, 10, 0.3)).toBeCloseTo(factor((1.5 * (10 - 8)) / (8 * 0.3)), 12);
    expect(prandtlHubLoss(3, 8, 2, 0.3)).toBeCloseTo(factor((1.5 * (8 - 2)) / (2 * 0.3)), 12);
    // Dividing the hub term by r instead of Rhub would make the exponent SMALLER here and so the
    // factor LARGER — i.e. it would under-penalise the root. Pin the difference, not just the form.
    expect(prandtlHubLoss(3, 8, 2, 0.3)).not.toBeCloseTo(factor((1.5 * (8 - 2)) / (8 * 0.3)), 6);
    expect(prandtlTipLoss(3, 10, 10, 0.3)).toBeCloseTo(0, 12);
    expect(prandtlHubLoss(3, 2, 2, 0.3)).toBeCloseTo(0, 12);
    expect(prandtlTipLoss(3, 1, 10, 0.3)).toBeCloseTo(1, 6);
  }, SWEEP_TIMEOUT_MS);

  it('does NOT lower Cp deep in stall — and the exception has a traceable cause', () => {
    // The honest statement of this guard. "Tip loss strictly lowers Cp" holds near and above the
    // design point, which is the range anybody designs in, and the tests above measure it there.
    // It is NOT true everywhere, and pretending otherwise invites the wrong fix: the loss factor F
    // belongs in the INDUCTION relations (kappa = sigma*Cn/(4 F sin^2 phi)) and nowhere else —
    // the blade element loads are computed from the LOCAL relative velocity at the blade, so
    // multiplying them by F as well would double-count the correction.
    //
    // What actually happens at lambda = 2 on a two-bladed rotor: the whole blade is 20-30 degrees
    // past stall, i.e. on the Viterna branch where dCl/dalpha is NEGATIVE. Tip loss raises the
    // axial induction near the tip, which LOWERS the angle of attack, which on that branch RAISES
    // Cl. More lift outboard is more torque, so Cp goes up.
    const blade = betzOptimalBlade({ tipRadiusM: 10, bladeCount: 2, designTipSpeedRatio: 4 });
    const flow = referenceTidalFlow();
    const at = (tipLossEnabled: boolean) =>
      solveBemt(blade, atLambda(blade, flow, 2), { hubLossEnabled: false, tipLossEnabled });
    const on = at(true);
    const off = at(false);
    expect(on.allConverged).toBe(true);
    expect(off.allConverged).toBe(true);
    expect(on.cp).toBeGreaterThan(off.cp);

    const outboard = (result: typeof on) => result.elements[Math.floor(result.elements.length * 0.8)];
    const withLoss = outboard(on);
    const without = outboard(off);
    // The mechanism, asserted rather than asserted-about: more induction, less alpha, more lift.
    expect(withLoss.a).toBeGreaterThan(without.a);
    expect(withLoss.alphaDeg).toBeLessThan(without.alphaDeg);
    expect(withLoss.alphaDeg).toBeGreaterThan(15);
    expect(withLoss.cl).toBeGreaterThan(without.cl);
  }, SWEEP_TIMEOUT_MS);

  it('lowers Cp when the hub loss is switched on as well', () => {
    const blade = betzOptimalBlade({ tipRadiusM: 10, bladeCount: 3, designTipSpeedRatio: 6 });
    const flow = referenceTidalFlow();
    const both = cpCurve(blade, flow, [6])[0].cp;
    const tipOnly = cpCurve(blade, flow, [6], { hubLossEnabled: false })[0].cp;
    expect(tipOnly).toBeGreaterThan(both);
  }, SWEEP_TIMEOUT_MS);
});

describe('GUARD 5 — the low-Reynolds penalty is visible, not smoothed away', () => {
  it('drops peak Cp measurably when the SAME geometry is scaled down to a printable size', () => {
    const flow = referenceTidalFlow();
    const printable = referenceTidalRotor();
    const utility = scaleBlade(printable, 10);
    const printablePeak = peakOf(cpCurve(printable, flow, LAMBDA_SWEEP));
    const utilityPeak = peakOf(cpCurve(utility, flow, LAMBDA_SWEEP));
    expect(utilityPeak.cp).toBeGreaterThan(printablePeak.cp);
    expect((utilityPeak.cp - printablePeak.cp) / utilityPeak.cp).toBeGreaterThan(0.15);
    expect(printablePeak.cp).toBeLessThan(0.4);
    expect(utilityPeak.cp).toBeGreaterThan(0.4);
  }, SWEEP_TIMEOUT_MS);

  it('falls MONOTONICALLY once the sections are below the transition Reynolds', () => {
    // Deliberately NOT tested across the transition: between roughly Re 3e5 and 1e6 the boundary
    // layer turns turbulent and skin friction genuinely RISES, so peak Cp dips before recovering.
    // That non-monotonicity is a real feature of the friction model, and asserting it away would
    // be exactly the kind of smoothing this guard exists to prevent. Below transition — which is
    // the whole printable range — the fall is clean and it is all laminar separation.
    const flow = referenceTidalFlow();
    const base = referenceTidalRotor();
    const peaks = [0.6, 0.3, 0.15, 0.075].map(
      (radius) => peakOf(cpCurve(scaleBlade(base, radius), flow, LAMBDA_SWEEP)).cp,
    );
    for (let i = 1; i < peaks.length; i += 1) expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    expect(peaks[peaks.length - 1]).toBeLessThan(0.5 * peaks[0]);
  }, SWEEP_TIMEOUT_MS);

  it('traces the drop to section Reynolds and L/D, not to a change in the inflow triangle', () => {
    const flow = referenceTidalFlow();
    const printable = referenceTidalRotor();
    const utility = scaleBlade(printable, 10);
    const small = solveBemt(printable, flow);
    const big = solveBemt(utility, atLambda(utility, flow, 5));
    const at75 = (blade: BladeSpec, result: ReturnType<typeof solveBemt>) =>
      result.elements.find((element) => element.radiusM >= 0.75 * blade.tipRadiusM)!;
    const smallSection = at75(printable, small);
    const bigSection = at75(utility, big);
    // Same dimensionless blade, same tip-speed ratio: the sections fly at the same lift.
    expect(smallSection.cl).toBeCloseTo(bigSection.cl, 1);
    // Everything that differs is Reynolds.
    expect(bigSection.reynolds / smallSection.reynolds).toBeGreaterThan(50);
    expect(smallSection.reynolds).toBeLessThan(1e5);
    expect(bigSection.reynolds).toBeGreaterThan(1e6);
    expect(smallSection.cd).toBeGreaterThan(2.5 * bigSection.cd);
    expect(smallSection.cl / smallSection.cd).toBeLessThan(25);
    expect(bigSection.cl / bigSection.cd).toBeGreaterThan(50);
  }, SWEEP_TIMEOUT_MS);
});

describe('GUARD 6 — the induction solver converges, or says so loudly', () => {
  it('converges on EVERY element at EVERY tip-speed ratio across the full sweep', () => {
    const flow = referenceTidalFlow();
    const blades = [referenceTidalRotor(), scaleBlade(referenceTidalRotor(), 10)];
    for (const blade of blades) {
      for (const lambda of LAMBDA_SWEEP) {
        const result = solveBemt(blade, atLambda(blade, flow, lambda));
        expect(result.allConverged).toBe(true);
        for (const element of result.elements) {
          expect(element.converged).toBe(true);
          expect(Number.isFinite(element.a)).toBe(true);
          expect(Number.isFinite(element.aPrime)).toBe(true);
          expect(Number.isFinite(element.dThrustN)).toBe(true);
          expect(element.a).toBeLessThan(1);
        }
      }
    }
  }, SWEEP_TIMEOUT_MS);

  it('converges for the ideal 60-bladed rotor with drag removed as well', () => {
    const blade = idealRotor();
    const flow = referenceTidalFlow();
    for (const lambda of LAMBDA_SWEEP) {
      const result = solveBemt(blade, atLambda(blade, flow, lambda), {
        dragEnabled: false,
        elementCount: 80,
      });
      expect(result.allConverged).toBe(true);
    }
  }, SWEEP_TIMEOUT_MS);

  it('returns a LOUD non-answer, not a partial one, when no bracket contains a root', () => {
    const blade = referenceTidalRotor();
    // At an absurd tip-speed ratio the geometric branch never crosses the momentum branch: the
    // residual has the same sign at both ends of every bracket. There is no inflow angle to find,
    // and the solver must say so rather than integrate whatever iterate it last held.
    const result = solveBemt(blade, { ...referenceTidalFlow(), rotationRadS: 1e9 / blade.tipRadiusM });
    expect(result.allConverged).toBe(false);
    expect(result.elements.some((element) => !element.converged)).toBe(true);
    for (const element of result.elements.filter((e) => !e.converged)) {
      expect(Number.isNaN(element.a)).toBe(true);
      expect(Number.isNaN(element.cl)).toBe(true);
      expect(element.dThrustN).toBe(0);
      expect(element.dTorqueNm).toBe(0);
    }
  }, SWEEP_TIMEOUT_MS);

  it('has NO guaranteed bracket — an ordinary blade at an ordinary lambda can have no root', () => {
    // The solver's own change log used to claim the residual is negative as phi -> 0 and positive
    // as phi -> pi/2, so a sign change always exists. It does not. In the Buhl branch
    // a -> 1 - sin(phi)*sqrt(2/(sigma*Cn)), so sin(phi)/(1-a) tends to the FINITE constant
    // sqrt(sigma*Cn/2) and the windmill residual tends to sqrt(sigma*Cn/2) - 1/lambda_r, which is
    // positive whenever sigma*Cn/2 > 1/lambda_r^2. Sampled over the whole bracket at 4000 points
    // for the elements below, the residual never changes sign: there is no inflow angle to find,
    // and reporting the element as failed is the CORRECT answer rather than a numerical give-up.
    // This fixture exists so nobody reinstates the guarantee and skips the `converged` check.
    const blade = { ...referenceTidalRotor(), pitchDeg: -15 };
    const flow = referenceTidalFlow();
    const failing = solveBemt(blade, atLambda(blade, flow, 13), { elementCount: 24 });
    expect(failing.allConverged).toBe(false);
    const failed = failing.elements.filter((element) => !element.converged);
    expect(failed.length).toBeGreaterThan(1);
    for (const element of failed) {
      expect(Number.isNaN(element.a)).toBe(true);
      expect(element.dThrustN).toBe(0);
      expect(element.dTorqueNm).toBe(0);
      // Mid-span, not a tip artefact: these are elements with real chord and real solidity.
      expect(element.radiusM).toBeGreaterThan(blade.hubRadiusM);
      expect(element.radiusM).toBeLessThan(blade.tipRadiusM);
    }
    // The same blade at its design tip-speed ratio solves completely, so the failure above is a
    // property of the OPERATING POINT, not of a malformed blade.
    expect(solveBemt(blade, atLambda(blade, flow, 5), { elementCount: 24 }).allConverged).toBe(true);
  }, SWEEP_TIMEOUT_MS);

  it('carries convergence on every Cp(lambda) POINT, not only on a full solve', () => {
    // The failure this pins is invisible in the number: a failed element contributes zero to both
    // integrals, so the curve keeps a perfectly ordinary shape while the blade behind it loses
    // elements. Without a flag ON THE POINT a caller holding only the sweep cannot tell.
    const blade = { ...referenceTidalRotor(), pitchDeg: -15 };
    const flow = referenceTidalFlow();
    const lambdas = [11, 12, 13, 14, 15, 16];
    const curve = cpCurve(blade, flow, lambdas, { elementCount: 24 });
    expect(curve.map((point) => point.lambda)).toEqual(lambdas);

    const broken = curve.filter((point) => !point.allConverged);
    expect(broken.length).toBeGreaterThan(0);
    for (const point of broken) {
      expect(point.failedElements).toBeGreaterThan(0);
      expect(point.elementCount).toBe(24);
      // Asserted against an independent direct solve at the same operating point, so the flag
      // cannot be satisfied by hard-coding it.
      const direct = solveBemt(blade, atLambda(blade, flow, point.lambda), { elementCount: 24 });
      expect(direct.allConverged).toBe(false);
      expect(point.failedElements).toBe(direct.elements.filter((element) => !element.converged).length);
      expect(point.cp).toBeCloseTo(direct.cp, 12);
    }

    // The fabricated "recovery": Cp RISES from lambda 12 to lambda 14 purely because more of the
    // blade dropped out of the integral. That is the shape a caller must not be able to plot blind.
    const at = (lambda: number): CpCurvePoint => curve.find((point) => point.lambda === lambda)!;
    expect(at(14).cp).toBeGreaterThan(at(12).cp);
    expect(at(14).failedElements).toBeGreaterThan(at(12).failedElements);

    // ...and a healthy sweep says so on every point, so the flag is not simply always false.
    for (const point of cpCurve(referenceTidalRotor(), flow, [3, 5, 7], { elementCount: 24 })) {
      expect(point.allConverged).toBe(true);
      expect(point.failedElements).toBe(0);
      expect(point.elementCount).toBe(24);
    }
  }, SWEEP_TIMEOUT_MS);

  it('extracts exactly zero power from a stopped rotor, and still converges saying so', () => {
    const result = solveBemt(referenceTidalRotor(), { ...referenceTidalFlow(), rotationRadS: 0 });
    expect(result.allConverged).toBe(true);
    expect(result.tipSpeedRatio).toBe(0);
    expect(result.powerW).toBe(0);
    expect(result.cp).toBe(0);
  }, SWEEP_TIMEOUT_MS);

  it('keeps allConverged an AND over the elements, and the integrals a sum over them', () => {
    const blade = referenceTidalRotor();
    const result = solveBemt(blade, referenceTidalFlow());
    expect(result.allConverged).toBe(result.elements.every((element) => element.converged));
    expect(result.thrustN).toBeCloseTo(
      result.elements.reduce((sum, element) => sum + element.dThrustN, 0),
      9,
    );
    expect(result.powerW).toBeCloseTo(referenceTidalFlow().rotationRadS * result.torqueNm, 9);
  }, SWEEP_TIMEOUT_MS);
});

describe('rotor integration and presets', () => {
  it('reports the reference rotor at its design point with a coherent set of numbers', () => {
    const blade = referenceTidalRotor();
    const flow = referenceTidalFlow();
    const result = solveBemt(blade, flow);
    expect(result.tipSpeedRatio).toBeCloseTo(5, 9);
    expect(result.allConverged).toBe(true);
    expect(result.cp).toBeGreaterThan(0.25);
    expect(result.cp).toBeLessThan(BETZ_LIMIT);
    expect(result.ct).toBeGreaterThan(0);
    expect(result.ct).toBeLessThan(1);
    const swept = Math.PI * blade.tipRadiusM ** 2;
    expect(result.cp).toBeCloseTo(result.powerW / (0.5 * flow.densityKgM3 * swept * flow.freeStreamMs ** 3), 9);
    expect(result.ct).toBeCloseTo(result.thrustN / (0.5 * flow.densityKgM3 * swept * flow.freeStreamMs ** 2), 9);
  }, SWEEP_TIMEOUT_MS);

  it('normalises Cp by the CUBE of the free stream and Ct by its square', () => {
    const blade = referenceTidalRotor();
    const flow = { ...referenceTidalFlow(), freeStreamMs: 2, rotationRadS: (5 * 2) / blade.tipRadiusM };
    expect(flow.freeStreamMs).not.toBe(1);
    const result = solveBemt(blade, flow);
    const swept = Math.PI * blade.tipRadiusM ** 2;
    expect(result.tipSpeedRatio).toBeCloseTo(5, 9);
    expect(result.cp).toBeCloseTo(result.powerW / (0.5 * flow.densityKgM3 * swept * flow.freeStreamMs ** 3), 12);
    expect(result.ct).toBeCloseTo(result.thrustN / (0.5 * flow.densityKgM3 * swept * flow.freeStreamMs ** 2), 12);
    // Density is a pure scale on the loads and must cancel out of the coefficients entirely.
    const denser = solveBemt(blade, { ...flow, densityKgM3: 2 * flow.densityKgM3 });
    expect(denser.powerW).toBeCloseTo(2 * result.powerW, 9);
    expect(denser.thrustN).toBeCloseTo(2 * result.thrustN, 9);
    expect(denser.cp).toBeCloseTo(result.cp, 12);
    expect(denser.ct).toBeCloseTo(result.ct, 12);
  }, SWEEP_TIMEOUT_MS);

  it('evaluates elements at annulus MID-spans, strictly inside both Prandtl singularities', () => {
    const blade = referenceTidalRotor();
    const result = solveBemt(blade, referenceTidalFlow(), { elementCount: 10 });
    const width = (blade.tipRadiusM - blade.hubRadiusM) / 10;
    expect(result.elements).toHaveLength(10);
    result.elements.forEach((element, index) => {
      expect(element.radiusM).toBeCloseTo(blade.hubRadiusM + (index + 0.5) * width, 12);
      expect(element.radiusM).toBeGreaterThan(blade.hubRadiusM);
      expect(element.radiusM).toBeLessThan(blade.tipRadiusM);
    });
  }, SWEEP_TIMEOUT_MS);

  it('interpolates chord and twist between design stations instead of holding the root value', () => {
    const blade = referenceTidalRotor();
    const result = solveBemt(blade, referenceTidalFlow(), { elementCount: 24 });
    const first = result.elements[0];
    const last = result.elements[result.elements.length - 1];
    // The blade twists down and tapers out, so the inflow angle must fall along the span.
    expect(last.phiDeg).toBeLessThan(first.phiDeg);
    for (let i = 1; i < result.elements.length; i += 1) {
      expect(result.elements[i].phiDeg).toBeLessThan(result.elements[i - 1].phiDeg);
    }
    // Reynolds RISES outboard even though the chord shrinks — rotational speed wins.
    expect(last.reynolds).toBeGreaterThan(first.reynolds);
  }, SWEEP_TIMEOUT_MS);

  it('applies collective pitch as a real change in blade angle, not a decorative field', () => {
    const flow = referenceTidalFlow();
    const base = scaleBlade(referenceTidalRotor(), 10);
    const alphaAt = (pitchDeg: number): number => {
      const blade = { ...base, pitchDeg };
      const result = solveBemt(blade, atLambda(blade, flow, 5));
      expect(result.allConverged).toBe(true);
      return result.elements.find((element) => element.radiusM >= 0.75 * blade.tipRadiusM)!.alphaDeg;
    };
    // beta = twist + pitch and alpha = phi - beta, so pitching up must take angle of attack OFF
    // every element, monotonically.
    let previous = alphaAt(-6);
    for (const pitchDeg of [-3, 0, 3, 6, 15]) {
      const current = alphaAt(pitchDeg);
      expect(current).toBeLessThan(previous);
      previous = current;
    }
    const peakAt = (pitchDeg: number): number => peakOf(cpCurve({ ...base, pitchDeg }, flow, LAMBDA_SWEEP)).cp;
    const neutral = peakAt(0);
    // The blade is Betz-optimal at zero collective, so pitching either way costs power...
    expect(peakAt(3)).toBeLessThan(neutral);
    expect(peakAt(-3)).toBeLessThan(neutral);
    // ...and feathering it stops the rotor extracting anything worth having.
    expect(peakAt(60)).toBeLessThan(0.05);
  }, SWEEP_TIMEOUT_MS);

  it('generates a Betz-optimal blade that twists DOWN and tapers OUT along the span', () => {
    const blade = betzOptimalBlade({ tipRadiusM: 1, bladeCount: 3, designTipSpeedRatio: 6 });
    for (let i = 1; i < blade.stations.length; i += 1) {
      expect(blade.stations[i].twistDeg).toBeLessThan(blade.stations[i - 1].twistDeg);
      expect(blade.stations[i].chordM).toBeLessThan(blade.stations[i - 1].chordM);
      expect(blade.stations[i].section.thickness).toBeLessThanOrEqual(blade.stations[i - 1].section.thickness);
    }
    expect(blade.hubRadiusM).toBeCloseTo(0.25, 12);
    expect(blade.stations[blade.stations.length - 1].radiusFrac).toBeCloseTo(1, 12);
  }, SWEEP_TIMEOUT_MS);

  it('refuses malformed designs instead of producing a blade nobody can build', () => {
    expect(() => betzOptimalBlade({ tipRadiusM: 0, bladeCount: 3, designTipSpeedRatio: 6 })).toThrow(RangeError);
    expect(() => betzOptimalBlade({ tipRadiusM: 1, bladeCount: 0, designTipSpeedRatio: 6 })).toThrow(RangeError);
    expect(() => betzOptimalBlade({ tipRadiusM: 1, bladeCount: 3, designTipSpeedRatio: 0 })).toThrow(RangeError);
    expect(() =>
      betzOptimalBlade({ tipRadiusM: 1, bladeCount: 3, designTipSpeedRatio: 6, hubRadiusFrac: 1 }),
    ).toThrow(RangeError);
    expect(() => scaleBlade(referenceTidalRotor(), 0)).toThrow(RangeError);
    expect(() => solveBemt(referenceTidalRotor(), { ...referenceTidalFlow(), freeStreamMs: 0 })).toThrow(RangeError);
    expect(() => cpCurve(referenceTidalRotor(), referenceTidalFlow(), [0])).toThrow(RangeError);
  }, SWEEP_TIMEOUT_MS);

  it('scales a blade without changing anything dimensionless about it', () => {
    const base = referenceTidalRotor();
    const scaled = scaleBlade(base, 10);
    expect(scaled.hubRadiusM / scaled.tipRadiusM).toBeCloseTo(base.hubRadiusM / base.tipRadiusM, 12);
    for (let i = 0; i < base.stations.length; i += 1) {
      expect(scaled.stations[i].twistDeg).toBeCloseTo(base.stations[i].twistDeg, 12);
      expect(scaled.stations[i].chordM / scaled.tipRadiusM).toBeCloseTo(
        base.stations[i].chordM / base.tipRadiusM,
        12,
      );
    }
    expect(base.tipRadiusM).toBeCloseTo(0.15, 12);
  }, SWEEP_TIMEOUT_MS);
});

describe('the blade as a printable solid', () => {
  it('lofts into a WATERTIGHT, outward-facing, genus-0 mesh', () => {
    const mesh = bladeToMesh(referenceTidalRotor(), 60);
    const verdict = validateMesh(mesh);
    expect(verdict.watertight).toBe(true);
    expect(verdict.openEdges).toBe(0);
    expect(verdict.boundaryEdges).toBe(0);
    expect(verdict.nonManifoldEdges).toBe(0);
    expect(verdict.degenerate).toBe(0);
    expect(verdict.consistentWinding).toBe(true);
    expect(verdict.outwardFacing).toBe(true);
    expect(verdict.eulerCharacteristic).toBe(2);
    expect(verdict.valid).toBe(true);
  }, SWEEP_TIMEOUT_MS);

  it('stays watertight across section densities and a pitched blade', () => {
    for (const points of [24, 40, 80]) {
      expect(validateMesh(bladeToMesh(referenceTidalRotor(), points)).valid).toBe(true);
    }
    expect(validateMesh(bladeToMesh({ ...referenceTidalRotor(), pitchDeg: 8 }, 40)).valid).toBe(true);
    const symmetric = betzOptimalBlade({
      tipRadiusM: 0.15,
      bladeCount: 3,
      designTipSpeedRatio: 5,
      maxCamber: 0,
      camberPos: 0,
    });
    expect(validateMesh(bladeToMesh(symmetric, 40)).valid).toBe(true);
  }, SWEEP_TIMEOUT_MS);

  it('exports a binary STL of exactly 84 + 50n bytes', () => {
    const mesh = bladeToMesh(referenceTidalRotor(), 60);
    const stl = toStlBinary(mesh);
    expect(stl.byteLength).toBe(stlBinaryByteLength(mesh.triangles.length));
    expect(stl.byteLength).toBe(84 + 50 * mesh.triangles.length);
    const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    expect(view.getUint32(80, true)).toBe(mesh.triangles.length);
  }, SWEEP_TIMEOUT_MS);

  it('places the blade along the span with the right overall size', () => {
    const blade = referenceTidalRotor();
    const mesh = bladeToMesh(blade, 40);
    const zs = mesh.vertices.map((vertex) => vertex.z);
    expect(Math.min(...zs)).toBeCloseTo(blade.hubRadiusM, 6);
    expect(Math.max(...zs)).toBeCloseTo(blade.tipRadiusM, 6);
    const chords = mesh.vertices.map((vertex) => Math.hypot(vertex.x, vertex.y));
    expect(Math.max(...chords)).toBeLessThan(blade.stations[0].chordM);
  }, SWEEP_TIMEOUT_MS);

  it('rotates each section NOSE-UP about the QUARTER-CHORD by its blade angle', () => {
    const blade = referenceTidalRotor();
    const points = 40;
    const mesh = bladeToMesh(blade, points);
    // Vertex 0 is the root section's trailing edge; the mid-ring vertex is its leading edge.
    const trailing = mesh.vertices[0];
    const leading = mesh.vertices[sectionRingLength(points) / 2];
    const angle = (blade.stations[0].twistDeg * Math.PI) / 180;
    const chord = blade.stations[0].chordM;
    expect(angle).toBeGreaterThan(0);
    // Nose-up: the leading edge rises above the pitch axis, the trailing edge drops below it.
    expect(leading.y).toBeGreaterThan(0);
    expect(trailing.y).toBeLessThan(0);
    // And the pivot really is the quarter-chord: the trailing edge is 0.75c from it, not 1.0c.
    expect(trailing.x).toBeCloseTo(0.75 * chord * Math.cos(angle), 9);
    expect(trailing.y).toBeCloseTo(-0.75 * chord * Math.sin(angle), 9);
    expect(leading.x).toBeCloseTo(-0.25 * chord * Math.cos(angle), 9);
    expect(leading.y).toBeCloseTo(0.25 * chord * Math.sin(angle), 9);
    // Collective pitch adds to the station twist rather than replacing it.
    expect(bladeToMesh({ ...blade, pitchDeg: 10 }, points).vertices[0].y).toBeLessThan(trailing.y);
  }, SWEEP_TIMEOUT_MS);

  it('caps a HIGH-CAMBER blade with facets that face out — the concave-section case', () => {
    // NACA 6409: 6 % camber against 9 % thickness, which is legal input and gives the section a
    // CONCAVE lower surface. A cap fanned from the ring centroid emits facets wound backwards
    // there, and nothing in validateMesh can see it: the edges are still shared exactly twice, the
    // winding census still agrees, and the signed-volume sum telescopes to the right total. So the
    // assertion has to be on the FACET NORMALS, measured here.
    const section = { maxCamber: 0.06, camberPos: 0.4, thickness: 0.09 };
    const cambered: BladeSpec = {
      tipRadiusM: 0.15,
      hubRadiusM: 0.03,
      bladeCount: 3,
      pitchDeg: 0,
      stations: [
        { radiusFrac: 0.2, chordM: 0.03, twistDeg: 0, section },
        { radiusFrac: 0.6, chordM: 0.02, twistDeg: 0, section },
        { radiusFrac: 1.0, chordM: 0.012, twistDeg: 0, section },
      ],
    };
    const mesh = bladeToMesh(cambered, 40);
    expect(validateMesh(mesh).valid).toBe(true);

    const normals = recomputeNormals(mesh);
    const caps = mesh.triangles
      .map((triangle, index) => ({ z: mesh.vertices[triangle[0]].z, triangle, normal: normals[index] }))
      // A cap facet is one whose three corners share a span station; a strip facet never does.
      .filter(({ triangle }) => new Set(triangle.map((i) => mesh.vertices[i].z)).size === 1);
    const ringLength = sectionRingLength(40);
    expect(caps).toHaveLength(2 * (ringLength - 2));
    for (const cap of caps) {
      const outward = cap.z <= cambered.hubRadiusM ? -1 : 1;
      expect(Math.sign(cap.normal.z), `cap facet at z=${cap.z} must face ${outward > 0 ? '+Z' : '-Z'}`).toBe(outward);
      expect(Math.abs(cap.normal.z)).toBeCloseTo(1, 9);
    }
  }, SWEEP_TIMEOUT_MS);

  it('exports a FINE-CHORD blade without welding two vertices into one', () => {
    // Millimetre-scale chords at high chordwise resolution put adjacent outline points well under
    // a micron apart. The mesh is fine; it is the TEXT formats that used to quantise them onto the
    // same grid point and emit zero-area facets — a defect invisible to validateMesh, which runs
    // on the un-quantised doubles the file was written from.
    const fine: BladeSpec = {
      tipRadiusM: 0.15,
      hubRadiusM: 0.03,
      bladeCount: 3,
      pitchDeg: 0,
      stations: [
        { radiusFrac: 0.2, chordM: 0.02, twistDeg: 0, section: { maxCamber: 0.04, camberPos: 0.4, thickness: 0.14 } },
        { radiusFrac: 0.6, chordM: 0.014, twistDeg: 0, section: { maxCamber: 0.04, camberPos: 0.4, thickness: 0.12 } },
        { radiusFrac: 1.0, chordM: 0.008, twistDeg: 0, section: { maxCamber: 0.04, camberPos: 0.4, thickness: 0.1 } },
      ],
    };
    const mesh = bladeToMesh(fine, 200);
    expect(validateMesh(mesh).valid).toBe(true);

    const vertexLines = toObj(mesh).split('\n').filter((line) => line.startsWith('v '));
    expect(vertexLines).toHaveLength(mesh.vertices.length);
    expect(new Set(vertexLines).size).toBe(mesh.vertices.length);

    // Re-parse the emitted STL text and measure the facets the FILE describes.
    const corners: number[][] = [];
    let zeroArea = 0;
    for (const line of toStlAscii(mesh).split('\n')) {
      const match = line.trim().match(/^vertex (\S+) (\S+) (\S+)$/);
      if (!match) continue;
      corners.push([Number(match[1]), Number(match[2]), Number(match[3])]);
      if (corners.length < 3) continue;
      const [a, b, c] = corners;
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (Math.hypot(cross[0], cross[1], cross[2]) === 0) zeroArea += 1;
      corners.length = 0;
    }
    expect(zeroArea).toBe(0);
  }, SWEEP_TIMEOUT_MS);

  it('refuses a blade it cannot loft', () => {
    const blade = referenceTidalRotor();
    expect(() => bladeToMesh({ ...blade, stations: [blade.stations[0]] })).toThrow(RangeError);
    expect(() =>
      bladeToMesh({ ...blade, stations: blade.stations.map((s) => ({ ...s, chordM: 0 })) }),
    ).toThrow(RangeError);
  }, SWEEP_TIMEOUT_MS);
});
