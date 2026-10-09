/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 D8 — the portable-object shape: what a thing authored
 *                     |                             | in one lab carries so another lab can place, weigh and collide
 *                     |                             | it without knowing how it was made, and NOTHING else. Five
 *                     |                             | blocks: identity and provenance; geometry (a CAD Studio program,
 *                     |                             | a mesh only as the fallback); mass properties, each value with
 *                     |                             | its own provenance (a value nobody knows is null and says so);
 *                     |                             | an attachment frame in CAD Studio's world frame with named
 *                     |                             | points; and the force model's declared medium requirements and
 *                     |                             | valid media, or null. The shape is a CONTRACT shared as data
 *                     |                             | and text, never an imported runtime (D3):
 *                     |                             | scripts/check-adr160-contract.mjs compares PORTABLE_OBJECT_SCHEMA
 *                     |                             | and PORTABLE_OBJECT_KEYS across every lab that declares them,
 *                     |                             | checks every committed emitted fixture against them, and reads
 *                     |                             | CAD Studio's own worldFrame text to hold CAD_STUDIO_WORLD_FRAME.
 */

import type { CadProgram } from './explorer-part-programs';
import type { Mat3, Vec3 } from './mass-properties';

/** The portable-object schema id every emitting lab declares identically (D8). */
export const PORTABLE_OBJECT_SCHEMA = 'oshal.portable-object/1';

/** The top-level keys of a portable object, in order: the five D8 blocks after the schema, and nothing more. */
export const PORTABLE_OBJECT_KEYS = ['schema', 'identity', 'geometry', 'massProperties', 'attachmentFrame', 'forceModel'] as const;

/** CAD Studio's world frame, word for word as its contract publishes it (cad-studio/src-routes/feature-contract.ts `worldFrame`). */
export const CAD_STUDIO_WORLD_FRAME = 'right-handed, Z up, millimetres; the footprint is centred on X = Y = 0, the part rests on Z = 0, the front faces −Y';

/** Where a value came from. `unknown` is the only source a null value may carry. */
export const PROVENANCE_SOURCES = ['published', 'measured', 'computed', 'estimate', 'reconstructed', 'assumed', 'unknown'] as const;

/** @description One provenance source. */
export type ProvenanceSource = typeof PROVENANCE_SOURCES[number];

/** @description Where one value came from, in words a reader can check. */
export interface Provenance { source: ProvenanceSource; basis: string }

/** @description A named point on the object: where it is in the object's own frame, the axis it offers (or null), and why it is there. */
export interface AttachmentPoint { name: string; positionMm: Vec3; axis: Vec3 | null; why: string }

/** @description The object's frame: CAD Studio's convention, what the origin and each axis are on THIS object, and its named points. */
export interface AttachmentFrame {
  convention: string;
  origin: string;
  axes: { x: string; y: string; z: string };
  points: AttachmentPoint[];
}

/** @description A force model as the receiving lab may read it: what it needs from a medium and where it is valid — never its internals. */
export interface PortableForceModel { id: string; label: string; requires: string[]; validIn: string[]; declared: boolean }

/** @description The D8 portable object. */
export interface PortableObject {
  schema: typeof PORTABLE_OBJECT_SCHEMA;
  identity: {
    lab: string; kind: string; partId: string; name: string;
    engine: { id: string; version: string };
    designVectorFingerprint: string | null;
    provenance: Provenance;
  };
  geometry: { form: 'cad-program'; units: 'mm'; program: CadProgram };
  massProperties: {
    mass: { valueKg: number | null; provenance: Provenance };
    centreOfMass: { valueMm: Vec3 | null; provenance: Provenance };
    inertia: { aboutCentreOfMassKgMm2: Mat3 | null; provenance: Provenance };
  };
  attachmentFrame: AttachmentFrame;
  forceModel: PortableForceModel | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(finite);
const mat3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(vec3);

/** @description Problems with one provenance block, named by where it sits. */
function provenanceProblems(p: unknown, at: string, value: unknown): string[] {
  if (!isObj(p)) return [`${at}.provenance is missing`];
  const out: string[] = [];
  if (!(PROVENANCE_SOURCES as readonly string[]).includes(String(p.source))) out.push(`${at}.provenance.source must be one of ${PROVENANCE_SOURCES.join(', ')}`);
  if (typeof p.basis !== 'string' || p.basis.length < 8) out.push(`${at}.provenance.basis must say where the value came from`);
  if (value === null && p.source !== 'unknown') out.push(`${at} is null, so its provenance must be 'unknown'`);
  if (value !== null && p.source === 'unknown') out.push(`${at} has a value, so its provenance cannot be 'unknown'`);
  return out;
}

/** @description Problems with the mass-properties block: each value typed, each with provenance. */
function massProblems(m: unknown): string[] {
  if (!isObj(m) || !isObj(m.mass) || !isObj(m.centreOfMass) || !isObj(m.inertia)) return ['massProperties must carry mass, centreOfMass and inertia'];
  const mass = m.mass.valueKg; const com = m.centreOfMass.valueMm; const inertia = m.inertia.aboutCentreOfMassKgMm2;
  const out = [
    ...provenanceProblems(m.mass.provenance, 'massProperties.mass', mass ?? null),
    ...provenanceProblems(m.centreOfMass.provenance, 'massProperties.centreOfMass', com ?? null),
    ...provenanceProblems(m.inertia.provenance, 'massProperties.inertia', inertia ?? null),
  ];
  if (mass !== null && !(finite(mass) && mass > 0)) out.push('massProperties.mass.valueKg must be a positive number or null');
  if (com !== null && !vec3(com)) out.push('massProperties.centreOfMass.valueMm must be [x, y, z] or null');
  if (inertia !== null && !mat3(inertia)) out.push('massProperties.inertia.aboutCentreOfMassKgMm2 must be a 3 x 3 matrix or null');
  if (inertia !== null && mass === null) out.push('an inertia tensor needs a mass');
  return out;
}

/** @description Problems with the attachment frame: CAD Studio's convention, what the origin and axes are, and well-formed named points. */
function frameProblems(f: unknown): string[] {
  if (!isObj(f)) return ['attachmentFrame is missing'];
  const out: string[] = [];
  if (f.convention !== CAD_STUDIO_WORLD_FRAME) out.push("attachmentFrame.convention must be CAD Studio's world frame, word for word");
  if (typeof f.origin !== 'string' || !f.origin) out.push('attachmentFrame.origin must say where the origin is on this object');
  if (!isObj(f.axes) || !['x', 'y', 'z'].every((k) => typeof (f.axes as Obj)[k] === 'string')) out.push('attachmentFrame.axes must name x, y and z');
  if (!Array.isArray(f.points)) return [...out, 'attachmentFrame.points must be a list (it may be empty)'];
  const names = new Set<string>();
  f.points.forEach((p: unknown, i: number) => {
    if (!isObj(p) || typeof p.name !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(p.name)) { out.push(`attachmentFrame.points[${i}].name must be a lowercase id`); return; }
    if (names.has(p.name)) out.push(`attachmentFrame.points[${i}].name ${p.name} repeats`);
    names.add(p.name);
    if (!vec3(p.positionMm)) out.push(`attachmentFrame.points[${i}].positionMm must be [x, y, z]`);
    if (p.axis !== null && !vec3(p.axis)) out.push(`attachmentFrame.points[${i}].axis must be [x, y, z] or null`);
    if (typeof p.why !== 'string' || !p.why) out.push(`attachmentFrame.points[${i}].why must say why the point is there`);
  });
  return out;
}

/** @description Problems with the identity and geometry blocks. */
function identityGeometryProblems(o: Obj): string[] {
  const out: string[] = [];
  const id = o.identity;
  if (!isObj(id) || !['lab', 'kind', 'partId', 'name'].every((k) => typeof id[k] === 'string' && id[k])) out.push('identity must name the lab, the kind, the part id and the part');
  else {
    if (!isObj(id.engine) || typeof id.engine.id !== 'string' || typeof id.engine.version !== 'string') out.push('identity.engine must carry the authoring engine id and version');
    if (id.designVectorFingerprint !== null && !/^[0-9a-f]{64}$/.test(String(id.designVectorFingerprint))) out.push('identity.designVectorFingerprint must be a sha256 or null (an object with no design vector)');
    out.push(...provenanceProblems(id.provenance, 'identity', id.designVectorFingerprint));
  }
  const g = o.geometry;
  if (!isObj(g) || g.form !== 'cad-program' || g.units !== 'mm' || !isObj(g.program) || !isObj(g.program.base) || !Array.isArray(g.program.features)) out.push("geometry must be {form: 'cad-program', units: 'mm', program: {base, features}}");
  return out;
}

/** @description Problems with the force-model block: null, or a declared requirement set and valid media. */
function forceModelProblems(f: unknown): string[] {
  if (f === null) return [];
  if (!isObj(f) || typeof f.id !== 'string' || !Array.isArray(f.requires) || !Array.isArray(f.validIn) || typeof f.declared !== 'boolean') return ['forceModel must be null or {id, label, requires, validIn, declared}'];
  return f.validIn.length ? [] : ['forceModel.validIn must name at least one medium'];
}

/**
 * @description Every way a value fails to be a D8 portable object. A receiving lab may accept exactly this and
 * must require nothing more; an emitter must emit exactly this and nothing more.
 * @param value - Anything. @returns The problems; empty when it is a portable object.
 */
export function portableObjectProblems(value: unknown): string[] {
  if (!isObj(value)) return ['a portable object must be an object'];
  const keys = Object.keys(value);
  if (JSON.stringify(keys) !== JSON.stringify(PORTABLE_OBJECT_KEYS)) return [`keys must be exactly ${PORTABLE_OBJECT_KEYS.join(', ')} in that order; found ${keys.join(', ')}`];
  if (value.schema !== PORTABLE_OBJECT_SCHEMA) return [`schema must be ${PORTABLE_OBJECT_SCHEMA}`];
  return [...identityGeometryProblems(value), ...massProblems(value.massProperties), ...frameProblems(value.attachmentFrame), ...forceModelProblems(value.forceModel)];
}
