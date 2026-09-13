/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the model contract the routes, the tools and
 *                     |                             | the engine all agree on: the base kinds, the feature types and
 *                     |                             | every parameter's type and range, mirrored from engine/
 *                     |                             | cad_worker.py (a spec keeps them in step). Validation is
 *                     |                             | PER FEATURE and returns normalised copies: a bad parameter is
 *                     |                             | refused with the field named before an engine round-trip, so
 *                     |                             | an iterating agent gets a precise correction instead of a
 *                     |                             | kernel stack. `describeContract()` is what /capabilities
 *                     |                             | publishes, so a bot reads the exact rules the server enforces.
 */

import { randomUUID } from 'node:crypto';

export const BASE_KINDS = ['box', 'cylinder', 'sketch', 'contours', 'mesh'] as const;
export const FEATURE_TYPES = ['hole', 'boss', 'box-add', 'box-cut', 'sketch-extrude', 'fillet', 'chamfer', 'shell', 'cut-plane', 'scale', 'mirror', 'rotate', 'translate'] as const;
export const EDGE_SELECTORS = ['all', 'vertical', 'horizontal', 'top', 'bottom', 'parallel-x', 'parallel-y', 'parallel-z'] as const;
export const FACE_SELECTORS = ['none', 'top', 'bottom', 'front', 'back', 'left', 'right'] as const;
export const PLANES = ['XY', 'XZ', 'YZ'] as const;
export const AXES = ['x', 'y', 'z'] as const;
export const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'] as const;
export const LIMITS = Object.freeze({ maxFeatures: 200, maxPoints: 2000, maxDimensionMm: 2000, minDimensionMm: 0.01, maxMeshBase64Chars: 90 * 1024 * 1024 });

export type BaseKind = typeof BASE_KINDS[number];
export type FeatureType = typeof FEATURE_TYPES[number];

/** @description A refusal the caller can act on: the field and the rule it broke. */
export class ContractError extends Error {
  constructor(message: string, readonly field: string) { super(message); this.name = 'ContractError'; }
}

type ParamSpec =
  | { kind: 'dimension'; doc: string }
  | { kind: 'coordinate'; doc: string }
  | { kind: 'number'; min: number; max: number; doc: string }
  | { kind: 'enum'; values: readonly string[]; doc: string }
  | { kind: 'points'; doc: string }
  | { kind: 'vec3'; dimension: boolean; doc: string }
  | { kind: 'boolean'; doc: string };
interface TypeSpec { doc: string; required: Record<string, ParamSpec>; optional: Record<string, ParamSpec> }

const dim = (doc: string): ParamSpec => ({ kind: 'dimension', doc });
const coord = (doc: string): ParamSpec => ({ kind: 'coordinate', doc });
const axis = (doc: string): ParamSpec => ({ kind: 'enum', values: AXES, doc });

/** The feature parameter table. Ranges are the engine's LIMITS; docs are what the bot reads. */
export const FEATURE_SPECS: Readonly<Record<FeatureType, TypeSpec>> = Object.freeze({
  'hole': { doc: 'Cylindrical hole. Through by default; give depth for a blind hole drilled from the + side of the axis.',
    required: { diameter: dim('hole diameter, mm') },
    optional: { axis: axis("hole axis (default 'z')"), x: coord('centre X, mm (ignored when axis is x)'), y: coord('centre Y, mm (ignored when axis is y)'), z: coord('centre Z, mm (ignored when axis is z)'), depth: dim('blind depth, mm'), through: { kind: 'boolean', doc: 'true = through (default when no depth)' } } },
  'boss': { doc: 'Add a cylinder (a boss or a pin) starting at `from` along the axis.',
    required: { diameter: dim('cylinder diameter, mm'), height: dim('cylinder height along the axis, mm') },
    optional: { axis: axis("cylinder axis (default 'z')"), x: coord('centre X, mm'), y: coord('centre Y, mm'), z: coord('centre Z, mm'), from: coord('start coordinate along the axis, mm (default 0)') } },
  'box-add': { doc: 'Union a box given by centre and size.', required: { size: { kind: 'vec3', dimension: true, doc: '[sizeX, sizeY, sizeZ] mm' } }, optional: { center: { kind: 'vec3', dimension: false, doc: '[x, y, z] centre, mm (default origin)' } } },
  'box-cut': { doc: 'Subtract a box given by centre and size (a pocket or a slot).', required: { size: { kind: 'vec3', dimension: true, doc: '[sizeX, sizeY, sizeZ] mm' } }, optional: { center: { kind: 'vec3', dimension: false, doc: '[x, y, z] centre, mm (default origin)' } } },
  'sketch-extrude': { doc: 'Extrude a closed polyline drawn on a plane (offset along its normal); add or cut.',
    required: { points: { kind: 'points', doc: '[[u, v], …] at least 3, mm, in the plane' }, height: dim('extrusion height, mm') },
    optional: { plane: { kind: 'enum', values: PLANES, doc: "sketch plane (default 'XY')" }, offset: coord('plane offset along its normal, mm'), mode: { kind: 'enum', values: ['add', 'cut'], doc: "'add' (default) or 'cut'" } } },
  'fillet': { doc: 'Round the selected edges.', required: { radius: dim('fillet radius, mm') }, optional: { edges: { kind: 'enum', values: EDGE_SELECTORS, doc: "which edges (default 'all')" } } },
  'chamfer': { doc: 'Bevel the selected edges.', required: { length: dim('chamfer length, mm') }, optional: { edges: { kind: 'enum', values: EDGE_SELECTORS, doc: "which edges (default 'all')" } } },
  'shell': { doc: 'Hollow the solid to a wall thickness, optionally opening one face.', required: { thickness: dim('wall thickness, mm') }, optional: { openFace: { kind: 'enum', values: FACE_SELECTORS, doc: "face to leave open (default 'none')" } } },
  'cut-plane': { doc: 'Keep only the material on one side of a plane perpendicular to an axis (flatten a bottom, trim a top).',
    required: { at: coord('plane position along the axis, mm') }, optional: { axis: axis("plane normal axis (default 'z')"), keep: { kind: 'enum', values: ['below', 'above'], doc: "side to keep (default 'below')" } } },
  'scale': { doc: 'Uniform scale by a factor, or to a target extent along one axis.', required: {}, optional: { factor: { kind: 'number', min: 0.001, max: 1000, doc: 'uniform factor' }, axis: axis("axis of the target extent (default 'x')"), target: dim('target extent along the axis, mm') } },
  'mirror': { doc: 'Mirror across a plane through the origin.', required: {}, optional: { plane: { kind: 'enum', values: PLANES, doc: "mirror plane (default 'YZ')" } } },
  'rotate': { doc: 'Rotate about an axis through the origin, then re-seat on the bed.', required: { degrees: { kind: 'number', min: -360, max: 360, doc: 'angle, degrees' } }, optional: { axis: axis("rotation axis (default 'z')") } },
  'translate': { doc: 'Move the solid.', required: {}, optional: { dx: coord('X shift, mm'), dy: coord('Y shift, mm'), dz: coord('Z shift, mm') } },
});

export interface CadFeature { id: string; type: FeatureType; params: Record<string, unknown>; enabled: boolean; label?: string }
export interface CadBase { kind: BaseKind; [key: string]: unknown }

function num(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ContractError(`${field} must be a finite number`, field);
  if (value < min || value > max) throw new ContractError(`${field} must be between ${min} and ${max}`, field);
  return value;
}
const dimension = (v: unknown, f: string) => num(v, f, LIMITS.minDimensionMm, LIMITS.maxDimensionMm);
const coordinate = (v: unknown, f: string) => num(v, f, -LIMITS.maxDimensionMm, LIMITS.maxDimensionMm);

function points(value: unknown, field: string): number[][] {
  if (!Array.isArray(value) || value.length < 3 || value.length > LIMITS.maxPoints) throw new ContractError(`${field} must list 3..${LIMITS.maxPoints} [u, v] points`, field);
  return value.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) throw new ContractError(`${field}[${i}] must be [u, v]`, field);
    return [coordinate(p[0], `${field}[${i}][0]`), coordinate(p[1], `${field}[${i}][1]`)];
  });
}
function vec3(value: unknown, field: string, asDimension: boolean): number[] {
  if (!Array.isArray(value) || value.length !== 3) throw new ContractError(`${field} must be [x, y, z]`, field);
  return value.map((v, i) => (asDimension ? dimension(v, `${field}[${i}]`) : coordinate(v, `${field}[${i}]`)));
}
function param(spec: ParamSpec, value: unknown, field: string): unknown {
  switch (spec.kind) {
    case 'dimension': return dimension(value, field);
    case 'coordinate': return coordinate(value, field);
    case 'number': return num(value, field, spec.min, spec.max);
    case 'enum': if (typeof value !== 'string' || !spec.values.includes(value)) throw new ContractError(`${field} must be one of ${spec.values.join(', ')}`, field); return value;
    case 'points': return points(value, field);
    case 'vec3': return vec3(value, field, spec.dimension);
    case 'boolean': if (typeof value !== 'boolean') throw new ContractError(`${field} must be true or false`, field); return value;
    default: throw new ContractError(`${field} has an unknown spec`, field);
  }
}

/**
 * @description Validate and normalise one feature. Unknown parameters are refused (a typo is a
 * silent no-op otherwise, which is the worst failure for an agent that believes it edited the model).
 * @param input - Raw feature (from a route body or a tool call).
 * @param existingId - Keep this id when updating; a new feature gets a fresh UUID.
 * @returns The normalised feature.
 */
export function validateFeature(input: unknown, existingId?: string): CadFeature {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContractError('feature must be an object', 'feature');
  const raw = input as Record<string, unknown>;
  const type = raw.type;
  if (typeof type !== 'string' || !(FEATURE_TYPES as readonly string[]).includes(type)) throw new ContractError(`feature.type must be one of ${FEATURE_TYPES.join(', ')}`, 'type');
  const spec = FEATURE_SPECS[type as FeatureType];
  const params = raw.params;
  if (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) throw new ContractError('feature.params must be an object', 'params');
  const source = (params ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(spec.required)) {
    if (source[name] === undefined) throw new ContractError(`${type}.params.${name} is required (${p.doc})`, `params.${name}`);
    out[name] = param(p, source[name], `${type}.params.${name}`);
  }
  for (const [name, p] of Object.entries(spec.optional)) if (source[name] !== undefined) out[name] = param(p, source[name], `${type}.params.${name}`);
  const known = new Set([...Object.keys(spec.required), ...Object.keys(spec.optional)]);
  for (const name of Object.keys(source)) if (!known.has(name)) throw new ContractError(`${type}.params.${name} is not a parameter of ${type} (known: ${[...known].join(', ')})`, `params.${name}`);
  if (type === 'scale' && out.factor === undefined && out.target === undefined) throw new ContractError('scale needs factor or target', 'params');
  if (type === 'hole' && out.depth !== undefined && out.through === true) throw new ContractError('hole cannot be both through and blind', 'params.through');
  const enabled = raw.enabled === undefined ? true : raw.enabled;
  if (typeof enabled !== 'boolean') throw new ContractError('feature.enabled must be true or false', 'enabled');
  const label = raw.label === undefined ? undefined : String(raw.label).slice(0, 120);
  const id = existingId ?? (typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : randomUUID());
  return { id, type: type as FeatureType, params: out, enabled, ...(label ? { label } : {}) };
}

/**
 * @description Validate and normalise a base.
 * @param input - Raw base.
 * @returns The normalised base.
 */
export function validateBase(input: unknown): CadBase {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContractError('base must be an object', 'base');
  const raw = input as Record<string, unknown>;
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(BASE_KINDS as readonly string[]).includes(kind)) throw new ContractError(`base.kind must be one of ${BASE_KINDS.join(', ')}`, 'base.kind');
  const k = kind as BaseKind;
  switch (k) {
    case 'box': return { kind: k, sizeX: dimension(raw.sizeX, 'base.sizeX'), sizeY: dimension(raw.sizeY, 'base.sizeY'), sizeZ: dimension(raw.sizeZ, 'base.sizeZ') };
    case 'cylinder': return { kind: k, diameter: dimension(raw.diameter, 'base.diameter'), height: dimension(raw.height, 'base.height') };
    case 'sketch': {
      const plane = raw.plane === undefined ? 'XY' : raw.plane;
      if (typeof plane !== 'string' || !(PLANES as readonly string[]).includes(plane)) throw new ContractError(`base.plane must be one of ${PLANES.join(', ')}`, 'base.plane');
      return { kind: k, plane, points: points(raw.points, 'base.points'), height: dimension(raw.height, 'base.height') };
    }
    case 'contours': {
      const views = raw.views;
      if (!views || typeof views !== 'object' || Array.isArray(views)) throw new ContractError('base.views must map front/top/right to outlines', 'base.views');
      const out: Record<string, number[][]> = {};
      for (const [name, outline] of Object.entries(views as Record<string, unknown>)) {
        if (!['front', 'top', 'right'].includes(name)) throw new ContractError(`base.views.${name} is not one of front, top, right`, `base.views.${name}`);
        out[name] = points(outline, `base.views.${name}`);
      }
      if (!Object.keys(out).length) throw new ContractError('base.views needs at least one outline', 'base.views');
      const size = (raw.size && typeof raw.size === 'object' ? raw.size : {}) as Record<string, unknown>;
      return { kind: k, views: out, size: { x: dimension(size.x ?? 1, 'base.size.x'), y: dimension(size.y ?? 1, 'base.size.y'), z: dimension(size.z ?? 1, 'base.size.z') } };
    }
    case 'mesh': {
      const stl = raw.stl;
      if (typeof stl !== 'string' || !stl || stl.length > LIMITS.maxMeshBase64Chars || !/^[A-Za-z0-9+/=\s]+$/.test(stl.slice(0, 4096))) throw new ContractError('base.stl must be a base64 STL under the size limit', 'base.stl');
      return { kind: k, stl };
    }
    default: throw new ContractError('unsupported base', 'base.kind');
  }
}

/**
 * @description Validate a whole feature list (order preserved).
 * @param input - Raw list.
 * @returns Normalised features.
 */
export function validateFeatureList(input: unknown): CadFeature[] {
  if (!Array.isArray(input)) throw new ContractError('features must be a list', 'features');
  if (input.length > LIMITS.maxFeatures) throw new ContractError(`at most ${LIMITS.maxFeatures} features`, 'features');
  const seen = new Set<string>();
  return input.map((f) => {
    const feature = validateFeature(f);
    if (seen.has(feature.id)) throw new ContractError(`duplicate feature id ${feature.id}`, 'features');
    seen.add(feature.id);
    return feature;
  });
}

/** @description The contract as data — published by /capabilities so a bot reads the real rules. */
export function describeContract(): Record<string, unknown> {
  const features = Object.fromEntries(Object.entries(FEATURE_SPECS).map(([type, spec]) => [type, {
    doc: spec.doc,
    required: Object.fromEntries(Object.entries(spec.required).map(([n, p]) => [n, p.doc])),
    optional: Object.fromEntries(Object.entries(spec.optional).map(([n, p]) => [n, p.doc])),
  }]));
  return {
    worldFrame: 'right-handed, Z up, millimetres; the footprint is centred on X = Y = 0, the part rests on Z = 0, the front faces −Y',
    bases: { box: 'sizeX, sizeY, sizeZ', cylinder: 'diameter, height', sketch: 'plane, points [[u,v]…], height', contours: 'views {front|top|right: [[u,v]…]} in mm, size {x,y,z} — the scan bridge (intersection of extruded outlines)', mesh: 'stl (base64) sewn into a solid' },
    features, edgeSelectors: EDGE_SELECTORS, faceSelectors: FACE_SELECTORS, planes: PLANES, axes: AXES, views: VIEWS, limits: LIMITS,
    rules: ['features apply in list order; a refused feature is reported with its reason and skipped, the model stays buildable', 'every parameter is checked before the kernel runs; unknown parameters are refused', 'same base + same list = same STEP/STL bytes'],
  };
}

/** @description The JSON schema a tool call must satisfy to add or update a feature. */
export const FEATURE_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    type: { type: 'string', enum: [...FEATURE_TYPES], description: 'feature type' },
    params: { type: 'object', description: 'parameters for the type — read cad-capabilities for the exact names and units (mm)' },
    label: { type: 'string', description: 'optional short label' },
    enabled: { type: 'boolean', description: 'default true' },
  },
  required: ['type', 'params'],
});
