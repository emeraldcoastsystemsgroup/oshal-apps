/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — blade element momentum theory. The induction
 *                     |                             | state is found by BRACKETED BISECTION on the inflow angle, not
 *                     |                             | by fixed-point iteration on (a, a'). That is the difference
 *                     |                             | between a solver that converges and one that reports whatever
 *                     |                             | it happened to be holding when the iteration cap ran out: the
 *                     |                             | residual is negative as phi -> 0 and positive as phi -> pi/2,
 *                     |                             | so a sign change EXISTS in the bracket and bisection cannot
 *                     |                             | fail to find it. When no bracket has a sign change the element
 *                     |                             | is reported as NOT converged and logged at error — never
 *                     |                             | silently folded into the integral. The Glauert/Buhl correction
 *                     |                             | above a = 0.4 is likewise not optional: momentum theory is
 *                     |                             | simply invalid in the turbulent wake state, and the uncorrected
 *                     |                             | relation is what lets a BEMT print a Cp above the Betz limit.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Entry 1's bracket-existence claim is WITHDRAWN — it is false, and
 *                     |                             | believing it is what let two other defects hide behind it. The
 *                     |                             | residual does NOT go negative as phi -> 0: in the Buhl branch
 *                     |                             | a -> 1 - sin(phi)*sqrt(2/(sigma*Cn)), so sin(phi)/(1-a) tends to
 *                     |                             | the FINITE constant sqrt(sigma*Cn/2) and the limit is
 *                     |                             | sqrt(sigma*Cn/2) - 1/lambda_r, which is positive whenever
 *                     |                             | sigma*Cn/2 > 1/lambda_r^2. Measured on the reference rotor at
 *                     |                             | -15 deg collective, lambda = 13: the windmill residual is
 *                     |                             | +0.0085 .. +1.045 with ZERO sign changes over 4000 samples, so
 *                     |                             | the element has no BEM solution at all and non-convergence is
 *                     |                             | the right answer rather than a solver failure. What was wrong
 *                     |                             | was reporting it: `converged` was per-element and `allConverged`
 *                     |                             | per-solve, but cpCurve threw both away and returned bare
 *                     |                             | {lambda, cp} — a fabricated point that reads as ordinary
 *                     |                             | physics. CpCurvePoint now CARRIES the flag. And entry 1's
 *                     |                             | "never silently folded into the integral" was only half true:
 *                     |                             | a failed element contributes 0 to both sums, so it IS folded
 *                     |                             | in; what saves it is that the flag travels with the number.
 */

import { createChildLogger } from '@/shared/logger';
import type {
  BemtElementResult,
  BemtOptions,
  BemtResult,
  BladeSpec,
  BladeStation,
  CpCurvePoint,
  FlowCondition,
  NacaSpec,
} from '../model/rotor-types';
import { DEFAULT_SECTION_STATIONS } from './naca-section';
import { sectionPolar, sectionReynolds } from './section-polar';

const log = createChildLogger({ module: 'features/rotor-design/bemt-solver' });

/** @description The Betz limit, 16/27 — the ceiling on Cp for any rotor in open flow. */
export const BETZ_LIMIT = 16 / 27;

/** @description Default annular element count. 48 resolves the tip-loss roll-off without being slow. */
const DEFAULT_ELEMENT_COUNT = 48;

/** @description Axial induction above which momentum theory is replaced by the Buhl fit. */
const GLAUERT_INDUCTION_THRESHOLD = 0.4;

/**
 * @description `kappa` at which `a` reaches {@link GLAUERT_INDUCTION_THRESHOLD}: `a/(1−a)` at
 * a = 0.4 is exactly 2/3, so this is the switch point, not a tuned constant.
 */
const GLAUERT_KAPPA_THRESHOLD = 2 / 3;

/** @description Angular margin kept away from each bracket endpoint, radians. */
const BRACKET_MARGIN_RAD = 1e-6;

/** @description Bisection iterations. 200 takes a pi-wide bracket below float resolution. */
const MAX_BISECTIONS = 200;

/** @description Outer iterations reconciling section Reynolds with the converged relative speed. */
const MAX_REYNOLDS_PASSES = 8;

/** @description Relative change in Reynolds below which the outer loop is converged. */
const REYNOLDS_TOLERANCE = 2e-3;

/**
 * @description Relaxation applied to each Reynolds update. Under-relaxing damps the limit cycle
 * that appears when an element sits exactly on the stall boundary, where a 1 % move in Reynolds
 * moves the stall angle past the operating point and the two states alternate forever.
 */
const REYNOLDS_RELAXATION = 0.6;

/** @description Lower end of the guaranteed Reynolds bracket, as a multiple of the seed. */
const REYNOLDS_BRACKET_LOW = 0.01;

/** @description Upper end of the guaranteed Reynolds bracket, as a multiple of the seed. */
const REYNOLDS_BRACKET_HIGH = 100;

/**
 * @description Bisections of the log-Reynolds bracket. Four decades halved 30 times leaves a
 * relative width around 1e-8, far tighter than the drag correlations it feeds.
 */
const MAX_REYNOLDS_BISECTIONS = 30;

/** @description Floor on the Prandtl loss factor; F = 0 exactly at the tip and would divide by zero. */
const MIN_LOSS_FACTOR = 1e-4;

/** @description Floor on `kappa` in the momentum branch — a hard limit on negative induction. */
const MIN_KAPPA = -0.5;

/** @description Magnitude limit on `kappa'`, whose relation `a' = k/(1−k)` has a pole at 1. */
const MAX_TANGENTIAL_KAPPA = 0.9;

/** @description One annular element's geometry, already interpolated off the station table. */
interface ElementGeometry {
  /** Mid-span radius, metres. */
  radiusM: number;
  /** Chord, metres. */
  chordM: number;
  /** Total blade angle (twist plus collective pitch), radians. */
  betaRad: number;
  /** Section flown here. */
  section: NacaSpec;
  /** Radial width, metres. */
  widthM: number;
  /** Local solidity, `B c / (2 π r)`. */
  solidity: number;
}

/** @description Everything the residual needs that does not change between bisection steps. */
interface ResidualContext {
  /** Element geometry. */
  element: ElementGeometry;
  /** Blade count. */
  bladeCount: number;
  /** Tip radius, metres. */
  tipRadiusM: number;
  /** Hub radius, metres. */
  hubRadiusM: number;
  /** Local speed ratio, `Ω r / V`. */
  localSpeedRatio: number;
  /** Section Reynolds number for this pass. */
  reynolds: number;
  /** Blade aspect ratio, for the Viterna ceiling. */
  aspectRatio: number;
  /** Resolved options. */
  settings: Required<BemtOptions>;
}

/** @description One element's converged state, together with the context that produced it. */
interface ElementSolution {
  /** The residual context, carrying the Reynolds number the polar was evaluated at. */
  context: ResidualContext;
  /** The converged inflow angle and the induction state at it. */
  solution: { phi: number; state: ResidualState };
  /** Relative speed `W` implied by that state, m/s. */
  relativeSpeed: number;
  /** Section Reynolds number that relative speed implies — compared against the assumed one. */
  impliedReynolds: number;
}

/** @description The full state the residual computes on the way to its value. */
interface ResidualState {
  /** Residual value; a root of this is the converged inflow angle. */
  residual: number;
  /** Axial induction factor. */
  a: number;
  /** Tangential induction factor. */
  aPrime: number;
  /** Lift coefficient. */
  cl: number;
  /** Drag coefficient. */
  cd: number;
  /** Combined Prandtl loss factor. */
  lossFactor: number;
}

/**
 * @description Turn a Prandtl exponent into a loss factor: `F = (2/π) acos(exp(−f))`.
 * @param exponent - The `f` of the tip or hub form.
 * @returns The loss factor, 0 at the boundary and 1 far from it.
 */
function prandtlFactor(exponent: number): number {
  return (2 / Math.PI) * Math.acos(Math.min(1, Math.exp(-Math.max(exponent, 0))));
}

/**
 * @description Prandtl TIP loss factor, `f = (B/2)(R − r)/(r sin φ)`, `F = (2/π) acos(e^−f)`.
 * It accounts for the flow that spills round the tip instead of being turned by the blade, so it
 * goes to zero AT the tip and to one well inboard.
 * @param bladeCount - Number of blades.
 * @param radiusM - Element radius, metres.
 * @param tipRadiusM - Tip radius, metres.
 * @param sinPhi - Sine of the inflow angle.
 * @returns The tip loss factor, in [0, 1].
 */
export function prandtlTipLoss(
  bladeCount: number,
  radiusM: number,
  tipRadiusM: number,
  sinPhi: number,
): number {
  const s = Math.max(Math.abs(sinPhi), 1e-9);
  return prandtlFactor(((bladeCount / 2) * (tipRadiusM - radiusM)) / (radiusM * s));
}

/**
 * @description Prandtl HUB loss factor, `f = (B/2)(r − Rhub)/(Rhub sin φ)`, `F = (2/π) acos(e^−f)`.
 *
 * Note the denominator: `Rhub`, NOT `r`. That is not a transcription of the tip form with a
 * different numerator — dividing by `r` makes the exponent larger at every radius and so
 * UNDER-penalises the root, which is exactly where a printed blade carries its thick structural
 * sections and therefore exactly where an over-optimistic answer does the most damage.
 * @param bladeCount - Number of blades.
 * @param radiusM - Element radius, metres.
 * @param hubRadiusM - Hub radius, metres.
 * @param sinPhi - Sine of the inflow angle.
 * @returns The hub loss factor, in [0, 1].
 */
export function prandtlHubLoss(
  bladeCount: number,
  radiusM: number,
  hubRadiusM: number,
  sinPhi: number,
): number {
  const s = Math.max(Math.abs(sinPhi), 1e-9);
  return prandtlFactor(((bladeCount / 2) * (radiusM - hubRadiusM)) / (hubRadiusM * s));
}

/**
 * @description The combined Prandtl factor `F = F_tip · F_hub`, with either term switchable off so
 * the acceptance guards can measure what each one costs.
 * @param context - Residual context.
 * @param sinPhi - Sine of the inflow angle.
 * @returns The combined factor, floored at {@link MIN_LOSS_FACTOR} — F = 0 exactly at a boundary
 * and would divide by zero downstream.
 */
function prandtlLossFactor(context: ResidualContext, sinPhi: number): number {
  const r = context.element.radiusM;
  let factor = 1;
  if (context.settings.tipLossEnabled) {
    factor *= prandtlTipLoss(context.bladeCount, r, context.tipRadiusM, sinPhi);
  }
  if (context.settings.hubLossEnabled) {
    factor *= prandtlHubLoss(context.bladeCount, r, context.hubRadiusM, sinPhi);
  }
  return Math.max(factor, MIN_LOSS_FACTOR);
}

/**
 * @description Axial induction from the blade-element loading parameter `kappa`, with the
 * Glauert/Buhl empirical correction above a = 0.4.
 *
 * Below the threshold this is the momentum result `a = κ/(1+κ)`. Above it, momentum theory does
 * not describe the turbulent wake state at all, so Buhl's `C_T` fit (which carries the tip-loss
 * factor F through it) is matched to the blade-element thrust and the resulting quadratic is
 * solved. Skipping this is what allows an uncorrected BEMT to report a Cp above 16/27, which is a
 * physical impossibility and therefore a bug rather than an interesting result.
 * @param kappa - `σ Cn / (4 F sin²φ)`.
 * @param lossFactor - The combined Prandtl factor F.
 * @returns Axial induction factor.
 */
export function axialInduction(kappa: number, lossFactor: number): number {
  if (kappa <= GLAUERT_KAPPA_THRESHOLD) {
    const limited = Math.max(kappa, MIN_KAPPA);
    return limited / (1 + limited);
  }
  const f = lossFactor;
  const u = 2 * f * kappa;
  const g1 = u + f - 10 / 9;
  const g2 = Math.max(u + f * f - (4 * f) / 3, 0);
  const g3 = u + 2 * f - 25 / 9;
  if (Math.abs(g3) < 1e-9) return 1 - 1 / (2 * Math.sqrt(Math.max(g2, 1e-12)));
  return (g1 - Math.sqrt(g2)) / g3;
}

/**
 * @description Tangential induction from the tangential loading parameter, with the pole at
 * `kappa' = 1` fenced off.
 * @param kappaPrime - `σ Ct / (4 F sin φ cos φ)`.
 * @returns Tangential induction factor.
 */
function tangentialInduction(kappaPrime: number): number {
  const limited = Math.max(-MAX_TANGENTIAL_KAPPA, Math.min(MAX_TANGENTIAL_KAPPA, kappaPrime));
  return limited / (1 - limited);
}

/**
 * @description Evaluate the BEMT residual at one inflow angle, returning the whole state so the
 * caller does not have to recompute it once the root is found.
 *
 * The residual is `sin φ/(1−a) − cos φ/(λ_r(1+a'))`, i.e. the momentum and geometric statements of
 * the same inflow triangle subtracted from each other. It is a function of φ ALONE — a and a' are
 * derived from φ, never carried between iterations — which is what turns the classic coupled
 * fixed-point iteration into a one-dimensional root-find with a guaranteed bracket.
 * @param context - Residual context.
 * @param phi - Inflow angle, radians.
 * @returns The residual and the state behind it.
 */
function evaluateResidual(context: ResidualContext, phi: number): ResidualState {
  const { element, settings } = context;
  const alpha = phi - element.betaRad;
  const { cl, cd } = sectionPolar(element.section, alpha, context.reynolds, {
    aspectRatio: context.aspectRatio,
    stationsPerSurface: settings.panelStations,
    inviscidDrag: !settings.dragEnabled,
  });
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const normal = cl * cosPhi + cd * sinPhi;
  const tangential = cl * sinPhi - cd * cosPhi;
  const lossFactor = prandtlLossFactor(context, sinPhi);
  const kappa = (element.solidity * normal) / (4 * lossFactor * Math.max(sinPhi * sinPhi, 1e-12));
  const kappaPrime =
    (element.solidity * tangential) / (4 * lossFactor * clampAwayFromZero(sinPhi * cosPhi));
  const a = axialInduction(kappa, lossFactor);
  const aPrime = tangentialInduction(kappaPrime);
  const residual =
    sinPhi / clampAwayFromZero(1 - a) - cosPhi / (context.localSpeedRatio * clampAwayFromZero(1 + aPrime));
  return { residual, a, aPrime, cl, cd, lossFactor };
}

/**
 * @description Keep a denominator off zero without changing its sign — a sign flip here would
 * invent a root that the physics does not have.
 * @param value - The denominator.
 * @returns The value, or ±1e-9 when it is smaller than that.
 */
function clampAwayFromZero(value: number): number {
  if (Math.abs(value) >= 1e-9) return value;
  return value < 0 ? -1e-9 : 1e-9;
}

/**
 * @description The brackets searched for a sign change, in the order they are tried: the windmill
 * branch first, then the propeller-brake branch, then the negative-inflow branch. A rotor being
 * swept from λ = 0.5 to λ = 15 visits all three.
 *
 * None of them is GUARANTEED to contain a root — see the change log. A heavily loaded element at
 * high local speed ratio can have a strictly positive residual across the whole windmill bracket,
 * which is the physical statement that no inflow angle satisfies both the momentum and the
 * blade-element description of that annulus. That is why the search returns null rather than
 * asserting.
 * @returns Bracket endpoints, radians.
 */
function candidateBrackets(): Array<[number, number]> {
  const m = BRACKET_MARGIN_RAD;
  return [
    [m, Math.PI / 2 - m],
    [Math.PI / 2 + m, Math.PI - m],
    [-Math.PI / 2 + m, -m],
  ];
}

/**
 * @description Find the inflow angle by bisection on the first bracket that shows a sign change.
 *
 * There is NO existence guarantee here and callers must not skip the `converged` flag on the
 * strength of one: the windmill residual tends to `sqrt(σ Cn / 2) − 1/λ_r` as φ → 0, which is
 * positive for an ordinary loaded element at high local speed ratio, so the bracket can be
 * sign-definite end to end. A null return is a real physical state, not a numerical give-up.
 * @param context - Residual context.
 * @returns `{ phi, state }` on success, or null when NO bracket contains a sign change — which the
 * caller must surface as a non-convergence rather than substituting a plausible-looking number.
 */
function bisectInflowAngle(context: ResidualContext): { phi: number; state: ResidualState } | null {
  for (const [low, high] of candidateBrackets()) {
    let lo = low;
    let hi = high;
    let loValue = evaluateResidual(context, lo).residual;
    const hiValue = evaluateResidual(context, hi).residual;
    if (!Number.isFinite(loValue) || !Number.isFinite(hiValue) || loValue * hiValue > 0) continue;
    for (let i = 0; i < MAX_BISECTIONS && hi - lo > 1e-13; i += 1) {
      const mid = 0.5 * (lo + hi);
      const midValue = evaluateResidual(context, mid).residual;
      if (loValue * midValue <= 0) hi = mid;
      else {
        lo = mid;
        loValue = midValue;
      }
    }
    const phi = 0.5 * (lo + hi);
    return { phi, state: evaluateResidual(context, phi) };
  }
  return null;
}

/**
 * @description Solve one annular element, iterating the outer Reynolds loop until the section
 * Reynolds implied by the converged relative speed agrees with the one the polar was evaluated at.
 *
 * The outer loop exists because Reynolds depends on the induction and the induction depends
 * (through drag) on Reynolds. The coupling is weak, so under-relaxed substitution settles it in
 * two or three passes — but "weak" is not "always", and an element sitting exactly on the stall
 * boundary can limit-cycle. That is why there are TWO methods here and not one: the fast path may
 * give up, and {@link bisectReynolds} then closes the same loop on a bracket that provably
 * contains a root. Only when even that finds no sign change is the element reported as failed.
 * @param context - Residual context; its `reynolds` field is the starting guess.
 * @param flow - The inflow condition.
 * @returns The element result, or a loudly-logged non-converged record.
 */
function solveElement(context: ResidualContext, flow: FlowCondition): BemtElementResult {
  const relaxed = relaxReynolds(context, flow);
  const settled = relaxed ?? bisectReynolds(context, flow);
  if (!settled) return reportNoConvergence(context);
  return buildElementResult(settled, flow);
}

/**
 * @description Solve the inflow angle at one assumed section Reynolds number, and report the
 * Reynolds number the answer implies. The gap between the two is what the outer loop closes.
 * @param context - Residual context.
 * @param flow - The inflow condition.
 * @param reynolds - The Reynolds number to evaluate the polar at.
 * @returns The element solution, or null when no bracket contained a sign change.
 */
function inflowAtReynolds(
  context: ResidualContext,
  flow: FlowCondition,
  reynolds: number,
): ElementSolution | null {
  const working: ResidualContext = { ...context, reynolds };
  const solution = bisectInflowAngle(working);
  if (!solution) return null;
  const axial = flow.freeStreamMs * (1 - solution.state.a);
  const rotational = flow.rotationRadS * working.element.radiusM * (1 + solution.state.aPrime);
  const relativeSpeed = Math.hypot(axial, rotational);
  return {
    context: working,
    solution,
    relativeSpeed,
    impliedReynolds: sectionReynolds(relativeSpeed, working.element.chordM, flow.kinematicViscosityM2S),
  };
}

/**
 * @description Whether an element solution's assumed and implied Reynolds numbers agree.
 * @param candidate - A solution.
 * @returns True when the two agree to {@link REYNOLDS_TOLERANCE}, relative.
 */
function reynoldsAgrees(candidate: ElementSolution): boolean {
  const gap = Math.abs(candidate.impliedReynolds - candidate.context.reynolds);
  return gap <= REYNOLDS_TOLERANCE * Math.max(candidate.impliedReynolds, 1);
}

/**
 * @description FAST path for the outer Reynolds loop: under-relaxed successive substitution. It
 * settles in two or three passes for almost every element, because drag depends on Reynolds only
 * weakly. It is allowed to fail — an element sitting exactly on the stall boundary can limit-cycle
 * here, because a small move in Reynolds moves the stall angle past the operating point — and the
 * caller falls back to a method that cannot.
 * @param context - Residual context.
 * @param flow - The inflow condition.
 * @returns The settled solution, or null if it did not settle within {@link MAX_REYNOLDS_PASSES}.
 */
function relaxReynolds(context: ResidualContext, flow: FlowCondition): ElementSolution | null {
  let candidate = inflowAtReynolds(context, flow, context.reynolds);
  for (let pass = 0; pass < MAX_REYNOLDS_PASSES && candidate; pass += 1) {
    if (reynoldsAgrees(candidate)) return candidate;
    const next =
      candidate.context.reynolds +
      REYNOLDS_RELAXATION * (candidate.impliedReynolds - candidate.context.reynolds);
    candidate = inflowAtReynolds(context, flow, next);
  }
  return null;
}

/**
 * @description GUARANTEED path for the outer Reynolds loop: bisection, in LOG Reynolds, on
 * `impliedReynolds(Re) − Re`.
 *
 * The bracket is not a hope. At a Reynolds number far below the element's actual one the implied
 * value is far above it, so the residual is positive; at one far above, the implied value is far
 * below, so it is negative. A sign change therefore exists between them and bisection must find
 * it. Working in log space is what makes four decades of bracket cost thirty iterations instead of
 * thousands — and this path only ever runs for the handful of elements the fast path could not
 * settle, so its cost does not show up in a sweep.
 * @param context - Residual context.
 * @param flow - The inflow condition.
 * @returns The converged solution, or null when even this bracket has no sign change — which is a
 * genuine non-convergence and must be reported as one.
 */
function bisectReynolds(context: ResidualContext, flow: FlowCondition): ElementSolution | null {
  const seed = Math.max(context.reynolds, 1);
  let lowLog = Math.log(seed * REYNOLDS_BRACKET_LOW);
  let highLog = Math.log(seed * REYNOLDS_BRACKET_HIGH);
  const low = inflowAtReynolds(context, flow, Math.exp(lowLog));
  const high = inflowAtReynolds(context, flow, Math.exp(highLog));
  if (!low || !high) return null;
  let lowGap = low.impliedReynolds - low.context.reynolds;
  const highGap = high.impliedReynolds - high.context.reynolds;
  if (lowGap * highGap > 0) return null;
  let best = low;
  for (let i = 0; i < MAX_REYNOLDS_BISECTIONS; i += 1) {
    const midLog = 0.5 * (lowLog + highLog);
    const mid = inflowAtReynolds(context, flow, Math.exp(midLog));
    if (!mid) return null;
    best = mid;
    const midGap = mid.impliedReynolds - mid.context.reynolds;
    if (lowGap * midGap <= 0) highLog = midLog;
    else {
      lowLog = midLog;
      lowGap = midGap;
    }
  }
  return best;
}

/**
 * @description Log a failed element at ERROR and return the non-converged record. There is exactly
 * one place that builds this outcome and it always logs, so a silent partial answer is not
 * reachable.
 * @param context - Residual context at the point of failure.
 * @returns A non-converged element result.
 */
function reportNoConvergence(context: ResidualContext): BemtElementResult {
  log.error(
    {
      radiusM: context.element.radiusM,
      chordM: context.element.chordM,
      localSpeedRatio: context.localSpeedRatio,
      reynolds: context.reynolds,
    },
    'BEMT element did not converge — no bracket contained a sign change; result is NOT usable',
  );
  return emptyElement(context.element, context.reynolds);
}

/**
 * @description The result record for an element the solver could not close. Every aerodynamic
 * field is zero and `converged` is false, so an integral built over it is visibly wrong rather
 * than subtly optimistic.
 * @param element - Element geometry.
 * @param reynolds - The last Reynolds number tried.
 * @returns A non-converged element result.
 */
function emptyElement(element: ElementGeometry, reynolds: number): BemtElementResult {
  return {
    radiusM: element.radiusM,
    a: Number.NaN,
    aPrime: Number.NaN,
    phiDeg: Number.NaN,
    alphaDeg: Number.NaN,
    reynolds,
    cl: Number.NaN,
    cd: Number.NaN,
    dThrustN: 0,
    dTorqueNm: 0,
    converged: false,
  };
}

/**
 * @description Turn a converged element solution into thrust and torque:
 * `dT = ½ρW²Bc·Cn·dr` and `dQ = ½ρW²Bc·Ct·r·dr`.
 * @param settled - The converged element solution.
 * @param flow - The inflow condition.
 * @returns The element result, always with `converged: true` — a non-converged element never
 * reaches this function, which is why there is no flag to pass in.
 */
function buildElementResult(settled: ElementSolution, flow: FlowCondition): BemtElementResult {
  const { context, solution, relativeSpeed } = settled;
  const element = context.element;
  const { phi, state } = solution;
  const normal = state.cl * Math.cos(phi) + state.cd * Math.sin(phi);
  const tangential = state.cl * Math.sin(phi) - state.cd * Math.cos(phi);
  const dynamic = 0.5 * flow.densityKgM3 * relativeSpeed * relativeSpeed * context.bladeCount * element.chordM;
  return {
    radiusM: element.radiusM,
    a: state.a,
    aPrime: state.aPrime,
    phiDeg: (phi * 180) / Math.PI,
    alphaDeg: ((phi - element.betaRad) * 180) / Math.PI,
    reynolds: context.reynolds,
    cl: state.cl,
    cd: state.cd,
    dThrustN: dynamic * normal * element.widthM,
    dTorqueNm: dynamic * tangential * element.radiusM * element.widthM,
    converged: true,
  };
}

/**
 * @description Chord, twist and section at a radius fraction, linearly interpolated between the
 * two bracketing design stations. The SECTION is taken from the nearer station rather than blended
 * — a NACA 4412 and a NACA 4418 do not average into a meaningful aerofoil, and pretending they do
 * would put a section nobody drew into the middle of the blade.
 * @param stations - Design stations, sorted ascending by `radiusFrac`.
 * @param radiusFrac - Radius as a fraction of tip radius.
 * @returns Chord (m), twist (deg) and section at that radius.
 */
function interpolateStation(
  stations: ReadonlyArray<BladeStation>,
  radiusFrac: number,
): { chordM: number; twistDeg: number; section: NacaSpec } {
  const first = stations[0];
  const last = stations[stations.length - 1];
  if (radiusFrac <= first.radiusFrac) {
    return { chordM: first.chordM, twistDeg: first.twistDeg, section: first.section };
  }
  if (radiusFrac >= last.radiusFrac) {
    return { chordM: last.chordM, twistDeg: last.twistDeg, section: last.section };
  }
  let upper = 1;
  while (upper < stations.length - 1 && stations[upper].radiusFrac < radiusFrac) upper += 1;
  const lo = stations[upper - 1];
  const hi = stations[upper];
  const span = hi.radiusFrac - lo.radiusFrac;
  const t = span === 0 ? 0 : (radiusFrac - lo.radiusFrac) / span;
  return {
    chordM: lo.chordM + t * (hi.chordM - lo.chordM),
    twistDeg: lo.twistDeg + t * (hi.twistDeg - lo.twistDeg),
    section: t < 0.5 ? lo.section : hi.section,
  };
}

/**
 * @description Cut the blade into equal-width annular elements between hub and tip, evaluated at
 * their MID-span radii. Mid-span rather than edges is not a refinement: the Prandtl factors are
 * singular at exactly `r = R` and at exactly `r = Rhub`, so an element evaluated on a boundary
 * divides by zero.
 * @param blade - The blade.
 * @param count - Element count.
 * @returns Element geometry, hub to tip.
 * @throws RangeError when the blade is malformed (under two stations, hub outside the tip radius).
 */
function buildElements(blade: BladeSpec, count: number): ElementGeometry[] {
  if (blade.stations.length < 2) throw new RangeError('A blade needs at least 2 design stations');
  if (!(blade.hubRadiusM > 0 && blade.hubRadiusM < blade.tipRadiusM)) {
    throw new RangeError(`Blade needs 0 < hubRadius < tipRadius, received ${blade.hubRadiusM}/${blade.tipRadiusM}`);
  }
  const sorted = [...blade.stations].sort((a, b) => a.radiusFrac - b.radiusFrac);
  const width = (blade.tipRadiusM - blade.hubRadiusM) / count;
  const elements: ElementGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const radiusM = blade.hubRadiusM + (i + 0.5) * width;
    const station = interpolateStation(sorted, radiusM / blade.tipRadiusM);
    elements.push({
      radiusM,
      chordM: station.chordM,
      betaRad: ((station.twistDeg + blade.pitchDeg) * Math.PI) / 180,
      section: station.section,
      widthM: width,
      solidity: (blade.bladeCount * station.chordM) / (2 * Math.PI * radiusM),
    });
  }
  return elements;
}

/**
 * @description Fill in the option defaults once, so no downstream function has to repeat `?? true`
 * and risk two of them disagreeing.
 * @param options - Caller options.
 * @returns Fully resolved options.
 */
function resolveOptions(options: BemtOptions): Required<BemtOptions> {
  return {
    dragEnabled: options.dragEnabled ?? true,
    tipLossEnabled: options.tipLossEnabled ?? true,
    hubLossEnabled: options.hubLossEnabled ?? true,
    elementCount: options.elementCount ?? DEFAULT_ELEMENT_COUNT,
    panelStations: options.panelStations ?? DEFAULT_SECTION_STATIONS,
  };
}

/**
 * @description Solve blade element momentum theory for a rotor in an inflow: thrust, torque,
 * power, Cp, Ct and the full per-element state.
 *
 * `allConverged` is the field to read first. Every integral below it is a sum over elements, and a
 * non-converged element contributes zero — so a partially converged sweep reads as a rotor that
 * suddenly lost its inboard third, which is exactly how it should read. Do not average over it.
 * @param blade - The blade. See {@link BladeSpec}.
 * @param flow - The inflow condition. See {@link FlowCondition}.
 * @param options - Physics switches and discretisation. See {@link BemtOptions}.
 * @returns The whole-rotor result. See {@link BemtResult}.
 * @throws RangeError when the blade or the flow is malformed.
 */
export function solveBemt(blade: BladeSpec, flow: FlowCondition, options: BemtOptions = {}): BemtResult {
  if (!(flow.freeStreamMs > 0)) throw new RangeError(`BEMT needs a positive free stream, received ${flow.freeStreamMs}`);
  const settings = resolveOptions(options);
  const elements = buildElements(blade, settings.elementCount);
  const meanChord = elements.reduce((sum, e) => sum + e.chordM, 0) / elements.length;
  const aspectRatio = blade.tipRadiusM / Math.max(meanChord, 1e-9);
  const results = elements.map((element) => {
    const localSpeedRatio = (flow.rotationRadS * element.radiusM) / flow.freeStreamMs;
    const seed = Math.hypot(flow.freeStreamMs, flow.rotationRadS * element.radiusM);
    const context: ResidualContext = {
      element,
      bladeCount: blade.bladeCount,
      tipRadiusM: blade.tipRadiusM,
      hubRadiusM: blade.hubRadiusM,
      localSpeedRatio: Math.max(localSpeedRatio, 1e-6),
      reynolds: sectionReynolds(seed, element.chordM, flow.kinematicViscosityM2S),
      aspectRatio,
      settings,
    };
    return solveElement(context, flow);
  });
  return integrateRotor(blade, flow, results);
}

/**
 * @description Sum the element loads into rotor thrust, torque, power and the two coefficients.
 * @param blade - The blade.
 * @param flow - The inflow condition.
 * @param elements - Per-element results.
 * @returns The whole-rotor result.
 */
function integrateRotor(blade: BladeSpec, flow: FlowCondition, elements: BemtElementResult[]): BemtResult {
  const thrustN = elements.reduce((sum, e) => sum + e.dThrustN, 0);
  const torqueNm = elements.reduce((sum, e) => sum + e.dTorqueNm, 0);
  const powerW = flow.rotationRadS * torqueNm;
  const sweptArea = Math.PI * blade.tipRadiusM * blade.tipRadiusM;
  const dynamic = 0.5 * flow.densityKgM3 * sweptArea;
  const allConverged = elements.every((e) => e.converged);
  const result: BemtResult = {
    thrustN,
    torqueNm,
    powerW,
    cp: powerW / (dynamic * flow.freeStreamMs ** 3),
    ct: thrustN / (dynamic * flow.freeStreamMs ** 2),
    tipSpeedRatio: (flow.rotationRadS * blade.tipRadiusM) / flow.freeStreamMs,
    elements,
    allConverged,
  };
  if (!allConverged) {
    log.error(
      { failed: elements.filter((e) => !e.converged).length, total: elements.length },
      'BEMT solve did not converge on every element — the integrated result is NOT usable',
    );
  }
  return result;
}

/**
 * @description Sweep Cp against tip-speed ratio, deriving the rotational speed from each λ rather
 * than reading it off the flow condition. That is what makes a Cp(λ) curve comparable between two
 * rotors of different SIZE at the same inflow — which is the whole low-Reynolds experiment.
 *
 * Every point carries its own `allConverged`, and a plotter that ignores it is drawing fiction.
 * The failure is invisible otherwise: a non-converged element contributes zero to both integrals,
 * so a curve that has quietly lost half its blade keeps rising and falling like a real one. The
 * sweep also logs every non-converged point at ERROR with the λ that produced it.
 * @param blade - The blade.
 * @param flow - The inflow condition; its `rotationRadS` is overridden per point.
 * @param lambdaValues - Tip-speed ratios to evaluate, any order.
 * @param options - Physics switches; passed through to {@link solveBemt}.
 * @returns One {@link CpCurvePoint} per input value, in input order, each carrying whether the
 * solve behind it actually closed.
 * @throws RangeError when a tip-speed ratio is not positive.
 */
export function cpCurve(
  blade: BladeSpec,
  flow: FlowCondition,
  lambdaValues: ReadonlyArray<number>,
  options: BemtOptions = {},
): CpCurvePoint[] {
  const points = lambdaValues.map((lambda) => {
    if (!(lambda > 0)) throw new RangeError(`Tip-speed ratio must be positive, received ${lambda}`);
    const rotationRadS = (lambda * flow.freeStreamMs) / blade.tipRadiusM;
    const result = solveBemt(blade, { ...flow, rotationRadS }, options);
    return {
      lambda,
      cp: result.cp,
      allConverged: result.allConverged,
      failedElements: result.elements.filter((element) => !element.converged).length,
      elementCount: result.elements.length,
    };
  });
  const failed = points.filter((point) => !point.allConverged);
  if (failed.length > 0) {
    log.error(
      { failedPoints: failed.map((point) => ({ lambda: point.lambda, failedElements: point.failedElements })), total: points.length },
      'Cp(λ) sweep contains points integrated over a partly unsolved blade — read allConverged before plotting cp',
    );
  }
  return points;
}
