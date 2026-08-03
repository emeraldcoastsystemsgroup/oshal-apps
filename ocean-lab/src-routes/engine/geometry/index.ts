/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the barrel. This slice sits in shared/ rather
 *                     |                             | than inside a design feature precisely so that a rotor slice and
 *                     |                             | a future hull or probe slice can both build on it without a
 *                     |                             | same-layer cross-import, which the layering rules forbid and
 *                     |                             | which is how two copies of a loft end up disagreeing.
 */

/**
 * @description Domain-free geometry: section placement, lofted solids, a printability validator,
 * and the CAD/print exporters (STL binary + ASCII, OBJ, OpenSCAD, DXF R12). Nothing here knows
 * what the geometry MEANS — a chord, a station and a bore are all just a placed section — which
 * is what lets a second design domain reuse it instead of forking it.
 *
 * Import from '.' — never deep-import a sub-module.
 *
 * @module shared/geometry
 */

export type {
  DxfSection,
  LoftOptions,
  MeshBounds,
  MeshValidation,
  MeshValidationOptions,
  OpenScadOptions,
  Point2D,
  Section2D,
  SectionPlacement,
  Triangle,
  TriMesh,
  Vec3,
} from './geometry-types';

export {
  ZERO_VEC3,
  addVec,
  crossVec,
  dotVec,
  normalizeVec,
  resolveTriangle,
  scaleVec,
  subVec,
  triangleArea,
  triangleCross,
  triangleNormal,
  vec3,
  vecLength,
} from './vector-math';

export {
  DEFAULT_DECIMALS,
  DEFAULT_SIGNIFICANT_DIGITS,
  assertFinite,
  formatFixed,
  formatFloat,
} from './format-number';

export { DEFAULT_WELD_EPSILON, loftSections, placeSection } from './mesh-loft';

export { ringNormal, triangulateRing } from './polygon-triangulate';

export { validateMesh } from './mesh-validate';

export {
  flipWinding,
  meshBounds,
  meshDiagonal,
  meshSurfaceArea,
  meshVolume,
  recomputeNormals,
} from './mesh-metrics';

export {
  STL_FACET_BYTES,
  STL_HEADER_BYTES,
  sanitizeSolidName,
  stlBinaryByteLength,
  toStlAscii,
  toStlBinary,
} from './export-stl';

export { toObj } from './export-obj';

export { formatScadValue, toOpenScad, toScadIdentifier } from './export-openscad';

export { DXF_R12_VERSION, toDxfLayerName, toDxfR12 } from './export-dxf';
