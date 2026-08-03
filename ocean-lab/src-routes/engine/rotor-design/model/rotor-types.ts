/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the rotor-design vocabulary. Blade geometry,
 *                     |                             | section aerodynamics and blade-element momentum theory are ONE
 *                     |                             | slice on purpose: BEMT cannot be evaluated without a section
 *                     |                             | polar, and a section polar has no consumer without BEMT, so
 *                     |                             | splitting them would put a same-layer cross-import between two
 *                     |                             | halves of a single physical model — which the layering rules
 *                     |                             | forbid and which is how two copies of a stall model end up
 *                     |                             | disagreeing about where the blade stalls.
 */

/**
 * @description A NACA 4-digit section, stated as FRACTIONS rather than the digits themselves.
 * "NACA 4412" is `{ maxCamber: 0.04, camberPos: 0.4, thickness: 0.12 }`. Fractions rather than
 * digits because the closed-form thickness and camber laws consume fractions, and because a
 * designer optimising a blade wants to sweep 11.5 % thickness without asking whether the name
 * "NACA 441.5" means anything.
 */
export interface NacaSpec {
  /** Maximum camber as a fraction of chord (the first digit / 100). 0 gives a symmetric section. */
  maxCamber: number;
  /** Chordwise position of maximum camber as a fraction of chord (the second digit / 10). */
  camberPos: number;
  /** Maximum thickness as a fraction of chord (the last two digits / 100). */
  thickness: number;
}

/**
 * @description One spanwise design station. `radiusFrac` rather than an absolute radius so a blade
 * definition survives being scaled: the whole point of the low-Reynolds study is to take ONE
 * planform down from utility size to something that fits on a print bed, and a station table keyed
 * in metres would have to be regenerated for every size.
 */
export interface BladeStation {
  /** Radius as a fraction of the tip radius, 0..1. Stations are sorted by this on ingest. */
  radiusFrac: number;
  /** Chord at this station, metres. */
  chordM: number;
  /** Local geometric twist (chord line to rotor plane), degrees. Positive is nose-into-wind. */
  twistDeg: number;
  /** The aerofoil flown at this station. */
  section: NacaSpec;
}

/** @description A complete rotor blade: planform, twist schedule, sections and collective pitch. */
export interface BladeSpec {
  /** Tip radius, metres. */
  tipRadiusM: number;
  /** Hub (blade root) radius, metres. Nothing inboard of this produces torque. */
  hubRadiusM: number;
  /** Number of blades. */
  bladeCount: number;
  /** Design stations, at least two. Order is not required; the solver sorts them. */
  stations: BladeStation[];
  /** Collective pitch added to every station's twist, degrees. */
  pitchDeg: number;
}

/** @description The inflow the rotor is being evaluated in. */
export interface FlowCondition {
  /** Free-stream speed, m/s. */
  freeStreamMs: number;
  /** Rotational speed, rad/s. {@link cpCurve} overrides this from each tip-speed ratio. */
  rotationRadS: number;
  /** Fluid density, kg/m³. Seawater is ~1025. */
  densityKgM3: number;
  /** Kinematic viscosity, m²/s. Seawater is ~1.05e-6. This is what sets section Reynolds. */
  kinematicViscosityM2S: number;
}

/**
 * @description Lift and drag coefficients for a section at one angle of attack and Reynolds
 * number. `cd` is always an ESTIMATE — see {@link estimateSectionDrag}.
 */
export interface SectionCoefficients {
  /** Lift coefficient. */
  cl: number;
  /** Drag coefficient — a correlation-based estimate, never a solved boundary layer. */
  cd: number;
}

/**
 * @description The inviscid lift line of a section, as produced by the vortex panel method.
 *
 * The panel system's matrix does not depend on the angle of attack — only the right-hand side
 * does, and it depends on it as `cos α` and `sin α`. So the inviscid solution is EXACTLY
 * `Cl(α) = cosCoefficient · cos α + sinCoefficient · sin α`, and two panel solves characterise the
 * section for every angle. That is not an approximation; it is the linearity of the system, and it
 * is what makes it affordable to call a panel method from inside a BEMT root-find.
 */
export interface SectionLiftLine {
  /** `A` in `Cl(α) = A cos α + B sin α`. Numerically equal to `Cl(0)`. */
  cosCoefficient: number;
  /** `B` in `Cl(α) = A cos α + B sin α`. Numerically equal to `dCl/dα` at α = 0, per RADIAN. */
  sinCoefficient: number;
  /** Angle of attack at which the inviscid lift vanishes, radians. Negative for a cambered section. */
  zeroLiftAlphaRad: number;
  /** `dCl/dα` at α = 0, per radian. Thin-aerofoil theory says 2π; a real section runs slightly above. */
  liftSlopePerRad: number;
}

/**
 * @description The point at which a section is handed over to the Viterna post-stall extension.
 * Continuity is a property of the Viterna coefficients, not of a blend: evaluated at
 * `alphaStallRad` the extension reproduces `clStall` and `cdStall` exactly.
 */
export interface ViternaStallPoint {
  /** Positive stall angle, radians. Must be strictly inside (0, π/2). */
  alphaStallRad: number;
  /** Lift coefficient at stall. */
  clStall: number;
  /** Drag coefficient at stall. */
  cdStall: number;
  /** Blade aspect ratio (tip radius / mean chord) — it sets the flat-plate drag ceiling. */
  aspectRatio: number;
}

/** @description Everything the solver worked out for one annular blade element. */
export interface BemtElementResult {
  /** Element mid-span radius, metres. */
  radiusM: number;
  /** Axial induction factor. */
  a: number;
  /** Tangential induction factor. */
  aPrime: number;
  /** Inflow angle (relative wind to rotor plane), degrees. */
  phiDeg: number;
  /** Angle of attack, degrees. */
  alphaDeg: number;
  /** Section Reynolds number, `W · c / ν`. */
  reynolds: number;
  /** Section lift coefficient at the converged state. */
  cl: number;
  /** Section drag coefficient at the converged state — an estimate. */
  cd: number;
  /** Thrust contributed by this element, newtons (all blades). */
  dThrustN: number;
  /** Torque contributed by this element, newton-metres (all blades). */
  dTorqueNm: number;
  /** Whether the induction root-find bracketed and converged. False means the numbers are unusable. */
  converged: boolean;
}

/** @description The whole-rotor result. `allConverged` false invalidates every derived figure. */
export interface BemtResult {
  /** Rotor thrust, newtons. */
  thrustN: number;
  /** Rotor torque, newton-metres. */
  torqueNm: number;
  /** Shaft power, watts (`Ω · Q`). */
  powerW: number;
  /** Power coefficient, `P / (½ ρ π R² V³)`. Betz caps this at 16/27. */
  cp: number;
  /** Thrust coefficient, `T / (½ ρ π R² V²)`. */
  ct: number;
  /** Tip-speed ratio, `Ω R / V`. */
  tipSpeedRatio: number;
  /** Per-element detail, hub to tip. */
  elements: BemtElementResult[];
  /** True only when EVERY element converged. Report this; never average over a failed element. */
  allConverged: boolean;
}

/**
 * @description Physics switches for {@link solveBemt}. These exist because the acceptance guards
 * are comparative — "drag strictly lowers Cp", "tip loss strictly lowers Cp and more so with fewer
 * blades", "the zero-drag limit approaches Betz from below" — and each of those is a statement
 * about the SAME geometry with one term removed. Defaults are all-physics-on.
 */
export interface BemtOptions {
  /** Include section drag. False forces `cd = 0` — the ideal-rotor limit. Default true. */
  dragEnabled?: boolean;
  /** Include the Prandtl tip-loss factor. Default true. */
  tipLossEnabled?: boolean;
  /** Include the Prandtl hub-loss factor. Default true. */
  hubLossEnabled?: boolean;
  /** Number of annular elements between hub and tip. Default 48. */
  elementCount?: number;
  /** Chordwise stations per surface used when panelling a section. Default 80. */
  panelStations?: number;
}

/**
 * @description One point on a Cp(λ) curve.
 *
 * `allConverged` is part of the POINT, not of some out-of-band log line, and reading `cp` without
 * it is a bug. A non-converged element contributes exactly zero thrust and zero torque, so the
 * integral behind `cp` is taken over a rotor that is missing however many elements failed — and
 * because the failed elements drop out rather than blowing up, the fabricated point looks
 * physically ordinary. A real sweep of the reference rotor at −15° collective reads
 * cp = −0.688 at λ = 12 then −0.068 at λ = 14, which is not a recovery: it is two thirds of the
 * blade falling out of the integral.
 */
export interface CpCurvePoint {
  /** Tip-speed ratio. */
  lambda: number;
  /** Power coefficient at that tip-speed ratio. Meaningless unless `allConverged` holds. */
  cp: number;
  /** True only when every annular element converged at this tip-speed ratio. */
  allConverged: boolean;
  /** How many elements failed to converge here. 0 when `allConverged`. */
  failedElements: number;
  /** How many elements the solve was discretised into — the denominator of `failedElements`. */
  elementCount: number;
}
