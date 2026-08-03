/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the rotor-design barrel. Blade geometry,
 *                     |                             | section aerodynamics and BEMT are ONE slice: BEMT cannot be
 *                     |                             | evaluated without a section polar and a section polar has no
 *                     |                             | consumer without BEMT, so splitting them would need a
 *                     |                             | same-layer cross-import, which the layering rules forbid. All
 *                     |                             | the meshing and CAD export lives in @/shared/geometry, one
 *                     |                             | layer down, where a hull or a probe can reuse it.
 */

/**
 * @description Parametric rotor design: closed-form NACA 4-digit sections, an inviscid vortex
 * panel solution with a Viterna post-stall extension, a blade element momentum solver with
 * Prandtl tip/hub losses and the Glauert/Buhl high-induction correction, and the loft that turns a
 * blade into a printable solid.
 *
 * Import from '@/features/rotor-design' — never deep-import a sub-module.
 *
 * @module features/rotor-design
 */

export type {
  BemtElementResult,
  BemtOptions,
  BemtResult,
  BladeSpec,
  BladeStation,
  CpCurvePoint,
  FlowCondition,
  NacaSpec,
  SectionCoefficients,
  SectionLiftLine,
  ViternaStallPoint,
} from './model/rotor-types';

export {
  DEFAULT_SECTION_STATIONS,
  cosineStations,
  nacaCamber,
  nacaSection,
  nacaThickness,
  sectionRingLength,
} from './services/naca-section';

export { liftLineCl, panelLiftLine, panelSolveCl } from './services/panel-method';

export { viternaDragMax, viternaExtend } from './services/viterna';

export {
  NOMINAL_ASPECT_RATIO,
  SEAWATER_KINEMATIC_VISCOSITY_M2S,
  estimateSectionDrag,
  maxLiftCoefficient,
  sectionLiftLine,
  sectionPolar,
  sectionReynolds,
  skinFrictionCoefficient,
  type SectionPolarOptions,
} from './services/section-polar';

export {
  BETZ_LIMIT,
  axialInduction,
  cpCurve,
  prandtlHubLoss,
  prandtlTipLoss,
  solveBemt,
} from './services/bemt-solver';

export { PITCH_AXIS_CHORD_FRACTION, bladeToMesh } from './services/blade-mesh';

export {
  REFERENCE_DESIGN_LIFT_COEFFICIENT,
  REFERENCE_DESIGN_TIP_SPEED_RATIO,
  REFERENCE_TIP_RADIUS_M,
  SEAWATER_DENSITY_KGM3,
  betzOptimalBlade,
  referenceTidalFlow,
  referenceTidalRotor,
  scaleBlade,
  type BetzBladeOptions,
} from './services/rotor-presets';
