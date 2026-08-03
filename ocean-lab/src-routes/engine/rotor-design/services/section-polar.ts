/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the viscous section polar. Lift comes from
 *                     |                             | the panel method and is therefore SOLVED; drag comes from
 *                     |                             | correlations and is therefore an ESTIMATE, and every docstring
 *                     |                             | below says so, because a drag number quoted without that label
 *                     |                             | is how a rotor gets built to a Cp nobody can reproduce in the
 *                     |                             | water. The low-Reynolds penalty is deliberately NOT smoothed
 *                     |                             | away or clamped: a 150 mm blade at 1 m/s runs at Re ~ 7e4,
 *                     |                             | laminar separation dominates there, and the collapse in L/D is
 *                     |                             | the single most important thing this model has to report. A
 *                     |                             | model that hid it would make a printable rotor look like a
 *                     |                             | utility rotor, which is the exact error it exists to prevent.
 */

import { createChildLogger } from '@/shared/logger';
import type {
  NacaSpec,
  SectionCoefficients,
  SectionLiftLine,
  ViternaStallPoint,
} from '../model/rotor-types';
import { DEFAULT_SECTION_STATIONS, nacaSection } from './naca-section';
import { liftLineCl, panelLiftLine } from './panel-method';
import { viternaExtend } from './viterna';

const log = createChildLogger({ module: 'features/rotor-design/section-polar' });

/** @description Kinematic viscosity of seawater at coastal temperature and salinity, m²/s. */
export const SEAWATER_KINEMATIC_VISCOSITY_M2S = 1.05e-6;

/** @description Reynolds number at the centre of the laminar-to-turbulent transition. */
const TRANSITION_REYNOLDS = 5e5;

/** @description Width of the transition blend, in natural-log Reynolds units. */
const TRANSITION_WIDTH = 0.35;

/**
 * @description Reynolds number below which a laminar separation bubble starts costing real drag.
 * Above it the penalty is exactly zero — this is a low-Re effect, not a fudge factor.
 */
const BUBBLE_REYNOLDS = 2e5;

/** @description Scale of the laminar-separation drag penalty. */
const BUBBLE_COEFFICIENT = 0.0035;

/** @description How much worse a THICK section separates at low Re, per unit thickness fraction. */
const BUBBLE_THICKNESS_SENSITIVITY = 6;

/** @description Base pressure/form drag of an attached section, independent of Reynolds. */
const BASE_PRESSURE_DRAG = 0.002;

/** @description Growth of pressure drag with the square of thickness. */
const PRESSURE_THICKNESS_FACTOR = 0.02;

/** @description Width of the drag bucket: `k · (cl − cl_minDrag)²`. */
const LIFT_DRAG_FACTOR = 0.006;

/** @description Maximum lift a section can reach at very high Reynolds. */
const CL_MAX_ASYMPTOTE = 1.5;

/** @description Reynolds scale over which maximum lift builds. */
const CL_MAX_REYNOLDS_SCALE = 2e5;

/** @description Exponent of the maximum-lift Reynolds law. */
const CL_MAX_EXPONENT = 0.35;

/** @description Negative stall arrives earlier than positive stall on a cambered section. */
const NEGATIVE_STALL_FACTOR = 0.8;

/**
 * @description Floor on the magnitude of either stall angle, radians. It guards the Viterna
 * hand-over, which is singular at a zero stall angle; no real section stalls inside ±1.1°.
 */
const MIN_STALL_ANGLE_RAD = 0.02;

/** @description Nominal blade aspect ratio used when a caller asks for a polar with no blade in hand. */
export const NOMINAL_ASPECT_RATIO = 10;

/** @description Memo of characterised lift lines. Panelling a section is pure, so caching it is safe. */
const liftLineCache = new Map<string, SectionLiftLine>();

/**
 * @description Section Reynolds number, `W · c / ν`. Stated as its own function because every
 * low-Re conclusion in this slice traces back to this one line, and a caller checking a surprising
 * result should be able to reproduce the number without reading the solver.
 * @param relativeSpeedMs - Speed of the section through the fluid, m/s (the RESULTANT `W`, not the
 * free stream — a blade element sees mostly rotational speed).
 * @param chordM - Section chord, metres.
 * @param kinematicViscosityM2S - Kinematic viscosity, m²/s.
 * @returns Reynolds number. Zero when the section is not moving.
 * @throws RangeError when chord or viscosity is not positive.
 */
export function sectionReynolds(
  relativeSpeedMs: number,
  chordM: number,
  kinematicViscosityM2S = SEAWATER_KINEMATIC_VISCOSITY_M2S,
): number {
  if (!(chordM > 0)) throw new RangeError(`Section Reynolds needs a positive chord, received ${chordM}`);
  if (!(kinematicViscosityM2S > 0)) {
    throw new RangeError(`Section Reynolds needs a positive viscosity, received ${kinematicViscosityM2S}`);
  }
  return (Math.abs(relativeSpeedMs) * chordM) / kinematicViscosityM2S;
}

/**
 * @description Flat-plate skin-friction coefficient, blended from Blasius (laminar) to the
 * Prandtl-Schlichting power law (turbulent) across the transition Reynolds. The blend is logistic
 * in log-Reynolds rather than a hard switch so that a solver differentiating through it — which
 * a bisection effectively does — does not see a step.
 *
 * This is an ESTIMATE. A flat plate is not an aerofoil and the correlation knows nothing about the
 * pressure gradient that actually decides where transition happens.
 * @param reynolds - Section Reynolds number.
 * @returns One-sided skin-friction coefficient.
 */
export function skinFrictionCoefficient(reynolds: number): number {
  const re = Math.max(reynolds, 1e3);
  const laminar = 1.328 / Math.sqrt(re);
  const turbulent = 0.455 / Math.log10(re) ** 2.58;
  const weight = 1 / (1 + Math.exp(-(Math.log(re) - Math.log(TRANSITION_REYNOLDS)) / TRANSITION_WIDTH));
  return (1 - weight) * laminar + weight * turbulent;
}

/**
 * @description ESTIMATED section drag coefficient. This is a correlation stack, not a solved
 * boundary layer, and it must never be presented as one:
 *
 * 1. flat-plate skin friction at section Reynolds, doubled for two wetted surfaces;
 * 2. multiplied by a Hoerner thickness form factor, `1 + 2(t/c) + 60(t/c)⁴`;
 * 3. plus a pressure/form term that grows with thickness squared;
 * 4. plus a drag bucket, quadratic in the departure from the minimum-drag lift coefficient;
 * 5. plus a laminar-separation-bubble penalty below Re ≈ 2e5, worse for thicker sections.
 *
 * Term 5 is the one that matters for a printable rotor and it is deliberately not clamped. A
 * 12 %-thick 4-digit section at Re 7e4 is being flown far outside what it was drawn for, its L/D
 * really does fall to the low twenties, and the whole point of the model is to say so.
 * @param thickness - Maximum thickness as a fraction of chord.
 * @param reynolds - Section Reynolds number.
 * @param cl - Lift coefficient the section is working at.
 * @param clMinDrag - Lift coefficient at the bottom of the drag bucket.
 * @returns Estimated drag coefficient.
 */
export function estimateSectionDrag(
  thickness: number,
  reynolds: number,
  cl: number,
  clMinDrag: number,
): number {
  const formFactor = 1 + 2 * thickness + 60 * thickness ** 4;
  const friction = 2 * skinFrictionCoefficient(reynolds) * formFactor;
  const pressure = BASE_PRESSURE_DRAG + PRESSURE_THICKNESS_FACTOR * thickness * thickness;
  const bucket = LIFT_DRAG_FACTOR * (cl - clMinDrag) ** 2;
  const excess = Math.max(0, (BUBBLE_REYNOLDS / Math.max(reynolds, 1e3)) ** 1.5 - 1);
  const bubble = BUBBLE_COEFFICIENT * (1 + BUBBLE_THICKNESS_SENSITIVITY * thickness) * excess;
  return friction + pressure + bucket + bubble;
}

/**
 * @description Maximum lift coefficient a section can reach at a given Reynolds number. Falls with
 * Reynolds because the boundary layer that has to survive the adverse gradient over the rear of
 * the section gets thinner and less energetic — the same physics as the bubble penalty, showing up
 * in lift instead of drag.
 * @param reynolds - Section Reynolds number.
 * @returns Maximum lift coefficient.
 */
export function maxLiftCoefficient(reynolds: number): number {
  const re = Math.max(reynolds, 1e3);
  return CL_MAX_ASYMPTOTE * (re / (re + CL_MAX_REYNOLDS_SCALE)) ** CL_MAX_EXPONENT;
}

/**
 * @description The section's inviscid lift line, panelled once and memoised. Pure in its inputs,
 * so the cache cannot go stale; it exists because a BEMT sweep asks for the same handful of
 * sections tens of thousands of times and a dense factorisation each time would dominate runtime.
 * @param spec - The section. See {@link NacaSpec}.
 * @param stationsPerSurface - Chordwise stations per surface used to panel it.
 * @returns The characterised lift line.
 */
export function sectionLiftLine(spec: NacaSpec, stationsPerSurface = DEFAULT_SECTION_STATIONS): SectionLiftLine {
  const key = `${spec.maxCamber}:${spec.camberPos}:${spec.thickness}:${stationsPerSurface}`;
  const cached = liftLineCache.get(key);
  if (cached) return cached;
  const line = panelLiftLine(nacaSection(spec, stationsPerSurface));
  liftLineCache.set(key, line);
  log.debug({ spec, stationsPerSurface, line }, 'panelled and cached a section lift line');
  return line;
}

/** @description Optional inputs to {@link sectionPolar} that a bare section cannot know. */
export interface SectionPolarOptions {
  /** Blade aspect ratio, for the Viterna flat-plate ceiling. Default {@link NOMINAL_ASPECT_RATIO}. */
  aspectRatio?: number;
  /** Chordwise stations per surface when panelling. Default {@link DEFAULT_SECTION_STATIONS}. */
  stationsPerSurface?: number;
  /** Force `cd = 0` — the ideal-rotor limit used by the Betz acceptance guard. Default false. */
  inviscidDrag?: boolean;
}

/**
 * @description The two angles at which a section hands over from attached flow to Viterna. They
 * are not symmetric about zero on a cambered section: the same boundary layer that lets a cambered
 * section reach cl = 1.4 nose-up gives out sooner nose-down.
 * @param line - The section's inviscid lift line.
 * @param reynolds - Section Reynolds number.
 * @returns `{ positive, negative }` stall angles, radians.
 */
function stallAngles(line: SectionLiftLine, reynolds: number): { positive: number; negative: number } {
  const clMax = maxLiftCoefficient(reynolds);
  const slope = Math.max(line.liftSlopePerRad, 1e-3);
  return {
    positive: Math.max(line.zeroLiftAlphaRad + clMax / slope, MIN_STALL_ANGLE_RAD),
    negative: Math.min(line.zeroLiftAlphaRad - (NEGATIVE_STALL_FACTOR * clMax) / slope, -MIN_STALL_ANGLE_RAD),
  };
}

/**
 * @description Section lift and drag at an angle of attack and Reynolds number, over the FULL
 * ±180° range.
 *
 * Attached flow uses the panelled lift line, so `cl` there is a solved inviscid result with a
 * viscous stall ceiling applied on top of it. Past stall the Viterna extension takes over, and it
 * is stitched on at the stall point itself so the curve is continuous — the BEMT bisection walks
 * across that join constantly and a jump there would put a spurious root either side of it.
 *
 * `cd` is ALWAYS an estimate. See {@link estimateSectionDrag}.
 * @param spec - The section. See {@link NacaSpec}.
 * @param alphaRad - Angle of attack, radians; wrapped into [−π, π].
 * @param reynolds - Section Reynolds number.
 * @param options - Aspect ratio, panelling density, and the ideal-rotor drag switch.
 * @returns `{ cl, cd }`.
 */
export function sectionPolar(
  spec: NacaSpec,
  alphaRad: number,
  reynolds: number,
  options: SectionPolarOptions = {},
): SectionCoefficients {
  const line = sectionLiftLine(spec, options.stationsPerSurface ?? DEFAULT_SECTION_STATIONS);
  const aspectRatio = options.aspectRatio ?? NOMINAL_ASPECT_RATIO;
  const clMinDrag = liftLineCl(line, 0);
  const alpha = Math.atan2(Math.sin(alphaRad), Math.cos(alphaRad));
  const { positive, negative } = stallAngles(line, reynolds);
  let coefficients: SectionCoefficients;
  if (alpha <= positive && alpha >= negative) {
    const cl = liftLineCl(line, alpha);
    coefficients = { cl, cd: estimateSectionDrag(spec.thickness, reynolds, cl, clMinDrag) };
  } else {
    const stallAngle = alpha > positive ? positive : negative;
    coefficients = stalledCoefficients(spec, line, alpha, reynolds, aspectRatio, stallAngle, clMinDrag);
  }
  return options.inviscidDrag ? { cl: coefficients.cl, cd: 0 } : coefficients;
}

/**
 * @description Build the Viterna hand-over point for whichever side of the polar `alpha` fell off,
 * evaluating the attached-flow model exactly at the stall angle so the join is continuous.
 * @param spec - The section.
 * @param line - Its inviscid lift line.
 * @param reynolds - Section Reynolds number.
 * @param aspectRatio - Blade aspect ratio.
 * @param stallAngle - The stall angle on the relevant side, signed.
 * @param clMinDrag - Bottom of the drag bucket.
 * @returns A stall point with a POSITIVE angle and correspondingly mirrored lift, ready for
 * {@link viternaExtend}.
 */
function handoverPoint(
  spec: NacaSpec,
  line: SectionLiftLine,
  reynolds: number,
  aspectRatio: number,
  stallAngle: number,
  clMinDrag: number,
): ViternaStallPoint {
  const clStall = liftLineCl(line, stallAngle);
  const cdStall = estimateSectionDrag(spec.thickness, reynolds, clStall, clMinDrag);
  const sign = stallAngle >= 0 ? 1 : -1;
  return {
    alphaStallRad: Math.max(Math.abs(stallAngle), 1e-3),
    clStall: sign * clStall,
    cdStall,
    aspectRatio,
  };
}

/**
 * @description Post-stall lift and drag, by mirroring onto the positive-angle Viterna branch.
 * Drag here is a coarser ESTIMATE than the attached-flow correlation — a separated section is a
 * bluff body and its drag is set by wake geometry, not by a boundary layer.
 * @param spec - The section.
 * @param line - Its inviscid lift line.
 * @param alpha - Angle of attack, radians, already wrapped and known to be past stall.
 * @param reynolds - Section Reynolds number.
 * @param aspectRatio - Blade aspect ratio.
 * @param stallAngle - The signed stall angle on the side `alpha` fell off.
 * @param clMinDrag - Bottom of the drag bucket.
 * @returns `{ cl, cd }` on the post-stall branch.
 */
function stalledCoefficients(
  spec: NacaSpec,
  line: SectionLiftLine,
  alpha: number,
  reynolds: number,
  aspectRatio: number,
  stallAngle: number,
  clMinDrag: number,
): SectionCoefficients {
  const point = handoverPoint(spec, line, reynolds, aspectRatio, stallAngle, clMinDrag);
  const sign = stallAngle >= 0 ? 1 : -1;
  const mirrored = viternaExtend(point, sign * alpha);
  return { cl: sign * mirrored.cl, cd: mirrored.cd };
}
