/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the vehicle record's public surface: the explorer
 *                     |                             | kind with its limit rows and design vector, the committed seed,
 *                     |                             | the stage function and the run fingerprints.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3: the parts model and its CAD Studio part programs,
 *                     |                             | the mass properties, the D8 portable-object shape, the
 *                     |                             | displacement budget with the explorer's parts gate, and the
 *                     |                             | generated design document.
 */

import explorerSeedFile from './explorer-seed.json';
import type { ExplorerVector } from './explorer-kind';

export {
  EXPLORER_KIND,
  MODELLED_STOP_FLOOR_DEG,
  NOT_MODELLED,
  assertKindDeclared,
  deriveWaveVehicle,
  evaluateExplorer,
  nacaSpec,
  validateExplorerVector,
  type ExplorerEvaluation,
  type ExplorerGeometry,
  type ExplorerVector,
  type LimitRow,
  type VehicleKind,
} from './explorer-kind';

export {
  EVALUATION_PLANT,
  FABRICABLE_SENTENCE,
  STAGES,
  designVectorFingerprint,
  stageOf,
  type PartsGate,
  type PartsGateResult,
  type RunLike,
  type Stage,
  type StageView,
} from './stage';

export {
  EXPLORER_DRAWINGS,
  SECTION_STATIONS,
  floatProfile,
  floatProgram,
  foilSection,
  rudderProgram,
  spindleBladeProgram,
  subBodyProgram,
  subProfile,
  tetherProgram,
  wingProgram,
  wingStations,
  type CadBaseProgram,
  type CadFeatureProgram,
  type CadProgram,
  type PartGeometry,
} from './explorer-part-programs';

export {
  cylinderMassProperties,
  loftMassProperties,
  loftVolumeAboveMm3,
  polygonMoments,
  revolveShellMassProperties,
  revolveVolumeMm3,
  type LoftSection,
  type Mat3,
  type MassProperties,
  type Vec3,
} from './mass-properties';

export {
  CAD_STUDIO_WORLD_FRAME,
  PORTABLE_OBJECT_KEYS,
  PORTABLE_OBJECT_SCHEMA,
  PROVENANCE_SOURCES,
  portableObjectProblems,
  type AttachmentFrame,
  type AttachmentPoint,
  type PortableForceModel,
  type PortableObject,
  type Provenance,
} from './portable-object';

export {
  CAD_STUDIO_MAX_DIMENSION_MM,
  EXPLORER_PARTS_ENGINE,
  buildExplorerParts,
  explorerBoughtCatalog,
  radiusAt,
  type BoughtCatalog,
  type BoughtCatalogRow,
  type BoughtPart,
  type Carrier,
  type ExplorerPartsModel,
  type PrintedPart,
} from './explorer-parts';

export { displacementBudget, explorerPartsGate, type DisplacementBudget, type ExplorerPartsGate, type SizingRun } from './displacement-budget';

export { describeProgram, explorerDesignMarkdown } from './explorer-design-markdown';

export {
  RUN_RESULT_SCHEMA,
  SHA256_HEX,
  VERSION,
  displayabilityProblems,
  hashEngineTree,
  readPackageVersion,
  routesEngineBuildHash,
  type EngineFingerprints,
} from './run-fingerprint';

/** @description The committed explorer seed (D4): the design study's inputs as a vector, each with its provenance, and the dated record it replays. */
export interface ExplorerSeed {
  schema: string;
  kind: string;
  name: string;
  study: Record<string, string>;
  designVector: ExplorerVector;
  provenance: Record<string, { source: 'published' | 'reconstructed' | 'assumed'; basis: string }>;
}

/** @description The seed, exactly as committed. Callers get a deep copy so no request can mutate the fixture. @returns The seed. */
export function explorerSeed(): ExplorerSeed {
  return JSON.parse(JSON.stringify(explorerSeedFile)) as ExplorerSeed;
}
