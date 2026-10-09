/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the wave slice's public surface: the medium
 *                     |                             | contract (rows, envelopes, the named refusals), the
 *                     |                             | wave-propulsion model and the sea-state year.
 */

export {
  DEFAULT_MEDIUM,
  FORCE_MODEL_ENVELOPES_SCHEMA,
  MEDIA_KNOWN,
  MediumRefusal,
  envelopeFor,
  gravityMagnitude,
  isKnownMedium,
  kinematicViscosityM2S,
  listEnvelopes,
  listMedia,
  mediumById,
  requireMediumProperties,
  requireModelValidIn,
  requireWithinValidity,
  type ForceModelEnvelope,
  type FreeSurface,
  type Medium,
  type MediumField,
  type MediumId,
  type MediumRefusalCode,
  type MediumValidity,
} from './medium';

export {
  ITTC_REYNOLDS_FLOOR,
  PHASE_SAMPLES,
  WAVE_ENGINE,
  balancedHeaveMs,
  cycleMeanThrustN,
  equilibrium,
  heaveBudgetsN,
  heaveVelocity,
  ittcFrictionCoefficient,
  kinematicCeilingMs,
  peakHeaveMs,
  resistanceN,
  theodorsenMagnitude,
  wingForces,
  type Equilibrium,
  type Fluid,
  type SeaState,
  type WaveVehicle,
  type WettedComponent,
  type WingForces,
} from './wave-propulsion';

export { evaluateSeaStates, kmPerDay, knots, type SeaStateEvaluation, type SeaStateRow, type Site } from './sea-state';
