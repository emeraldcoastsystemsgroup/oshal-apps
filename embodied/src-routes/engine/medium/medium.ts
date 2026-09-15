/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-160 D7 slice S1 — a medium is a named record, not a property of the lab you happen to be in. Three implementations (vacuum, air, seawater) built over ONE committed data row per medium (medium-properties.json), so this package answers "what is seawater" with the same values ocean-lab and aero-lab do rather than minting a third. A force model declares the properties it needs and the media it is valid in, and gets two refusals BY NAME instead of a confidently wrong number: medium_property_unavailable when the medium does not carry what the model needs, and model_not_valid_in_medium when every property is present and the model still declines. A medium also refuses outside its own validity band rather than extrapolating.
 */

import properties from './medium-properties.json';
import type { Vec3 } from '../math/vec';

/** The media this package implements. A medium this lab cannot answer for is never silently substituted. */
export type MediumId = 'vacuum' | 'air' | 'seawater';

/** The property names a force model may declare a requirement on. */
export type MediumProperty =
  | 'gravityMps2'
  | 'densityKgM3'
  | 'dynamicViscosityPaS'
  | 'kinematicViscosityM2S'
  | 'speedOfSoundMs'
  | 'temperatureK'
  | 'field'
  | 'freeSurface';

/** @description What a medium's own motion is doing at one point in space and time: the velocity, and its analytic gradient (dV_i/dx_j, m/s per m) where the model has one. */
export interface MediumFieldSample {
  velocityMs: Vec3;
  /** Row i is dV_i/dx_j. A still field's gradient is identically zero, which is a statement, not a missing value. */
  gradientPerS: readonly (readonly [number, number, number])[];
}

/** @description The medium's own motion — wind in air, wave and current in water. This lab carries only a named still field; the resolving implementations live in aero-lab and ocean-lab and D3 forbids importing them. */
export interface MediumField {
  /** What kind of field this is, by name. `still` means zero velocity and zero gradient everywhere, said out loud. */
  model: string;
  why: string;
  sample(x: number, y: number, z: number, t: number): MediumFieldSample;
}

/** @description A free surface as a plane: the height of the interface and the normal pointing out of the medium. `null` on every medium this lab implements — nothing here models one. */
export interface FreeSurface {
  heightM: number;
  normal: Vec3;
}

/** @description The coordinate band a medium can answer over, and why that is the band. Outside it the medium refuses rather than extrapolating. */
export interface MediumValidity {
  coordinate: 'heightM';
  minM: number;
  maxM: number;
  why: string;
}

/** @description A medium: a first-class thing a person chooses, carrying everything ADR-160 D7 requires a medium to carry. Property values come from the committed data row; what this lab can ANSWER (its field, its free surface, its validity band) is this implementation's own. */
export interface Medium {
  id: MediumId;
  label: string;
  summary: string;
  /** A vector, so zero-g and a tilted bench are expressible without a second concept. */
  gravityMps2: Vec3;
  densityKgM3: number;
  /** Dynamic, because that is what an atmosphere model produces. Kinematic is derived — see {@link kinematicViscosityM2S}. */
  dynamicViscosityPaS: number;
  /** Present when the medium can answer, `null` otherwise. Never defaulted. */
  speedOfSoundMs: number | null;
  /** Present when the medium can answer, `null` otherwise. Never defaulted. */
  temperatureK: number | null;
  field: MediumField | null;
  freeSurface: FreeSurface | null;
  validity: MediumValidity;
  /** How this lab answers: `constant`, or `constant-at-reference-station`. */
  resolution: string;
  /** Where every property value came from, value by value. */
  provenance: Readonly<Record<string, string>>;
}

/** The refusals ADR-160 D7 promotes from a property of one module to a requirement of the contract. */
export type MediumRefusalCode = 'medium_property_unavailable' | 'model_not_valid_in_medium' | 'medium_outside_validity';

/** @description A refusal raised BY NAME. Zero thrust and undefined thrust are different answers, and so are "it floats" and "this lab cannot say whether it floats". */
export class MediumRefused extends Error {
  readonly code: MediumRefusalCode;
  /** The named refusal exactly as D7 writes it, e.g. `medium_property_unavailable: freeSurface`. */
  readonly refusal: string;
  readonly mediumId: MediumId;
  readonly property?: MediumProperty;
  readonly model?: string;
  /** Why this is a refusal and not a number. */
  readonly because: string;

  constructor(init: { code: MediumRefusalCode; refusal: string; mediumId: MediumId; because: string; property?: MediumProperty; model?: string }) {
    super(`${init.refusal} — ${init.because}`);
    this.name = 'MediumRefused';
    this.code = init.code;
    this.refusal = init.refusal;
    this.mediumId = init.mediumId;
    this.because = init.because;
    if (init.property) this.property = init.property;
    if (init.model) this.model = init.model;
  }

  /** @description The refusal as a plain object a route can send. @returns code, the named refusal, the medium, and the reason. */
  toJSON(): Record<string, unknown> {
    return { error: this.code, refusal: this.refusal, medium: this.mediumId, property: this.property ?? null, model: this.model ?? null, because: this.because };
  }
}

/** Earth-surface gravity, from the committed data row. The one number this package writes into an MJCF `<option>`. */
export const EARTH_SURFACE_GRAVITY_MPS2: number = (properties as { earthSurfaceGravityMps2: number }).earthSurfaceGravityMps2;

/** The schema the committed property rows are written against. */
export const MEDIUM_PROPERTIES_SCHEMA: string = (properties as { schema: string }).schema;

const STILL: MediumFieldSample = { velocityMs: [0, 0, 0], gradientPerS: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] };

/** @description A field that is still everywhere, said by name. @param model - what to call it. @param why - why this lab carries no resolving field. @returns The field. */
function stillField(model: string, why: string): MediumField {
  return { model, why, sample: () => STILL };
}

/** The committed row exactly as `medium-properties.json` writes it: values, then what this lab can answer. */
interface RawRow {
  id: string;
  label: string;
  summary: string;
  properties: { gravityMps2: number[]; densityKgM3: number; dynamicViscosityPaS: number; speedOfSoundMs: number | null; temperatureK: number | null };
  implementation: {
    resolution: string;
    field: { model: string; why: string } | null;
    freeSurface: null;
    validity: { coordinate: string; minM: number; maxM: number; why: string };
  };
  provenance: Record<string, string>;
}

const RAW = properties as unknown as { schema: string; earthSurfaceGravityMps2: number; media: Record<MediumId, RawRow> };

/** @description Build one medium from its committed data row: the property values come from the row, the answer machine is this lab's. @param raw - the row. @returns The medium. */
function fromRow(raw: RawRow): Medium {
  const g = raw.properties.gravityMps2;
  const impl = raw.implementation;
  return {
    id: raw.id as MediumId,
    label: raw.label,
    summary: raw.summary,
    gravityMps2: [g[0], g[1], g[2]],
    densityKgM3: raw.properties.densityKgM3,
    dynamicViscosityPaS: raw.properties.dynamicViscosityPaS,
    speedOfSoundMs: raw.properties.speedOfSoundMs,
    temperatureK: raw.properties.temperatureK,
    field: impl.field ? stillField(impl.field.model, impl.field.why) : null,
    freeSurface: null,
    validity: { coordinate: 'heightM', minM: impl.validity.minM, maxM: impl.validity.maxM, why: impl.validity.why },
    resolution: impl.resolution,
    provenance: Object.freeze({ ...raw.provenance }),
  };
}

const MEDIA: Readonly<Record<MediumId, Medium>> = Object.freeze({
  vacuum: fromRow(RAW.media.vacuum),
  air: fromRow(RAW.media.air),
  seawater: fromRow(RAW.media.seawater),
});

/** Every medium this package implements, in the order a chooser should offer them. */
export const MEDIUM_IDS: readonly MediumId[] = ['vacuum', 'air', 'seawater'];

/** @description The medium a caller named. @param id - the medium id. @returns The medium, or `null` when this lab does not implement it — a medium is never silently substituted. */
export function mediumById(id: string): Medium | null {
  return (MEDIUM_IDS as readonly string[]).includes(id) ? MEDIA[id as MediumId] : null;
}

/** @description Every medium, for a chooser or a status route. @returns The three media. */
export function allMedia(): readonly Medium[] {
  return MEDIUM_IDS.map((id) => MEDIA[id]);
}

/** @description Raise the named property refusal. @param m - the medium. @param property - what was asked for. @param because - why it is not available. @returns never. */
function refuseProperty(m: Medium, property: MediumProperty, because: string): never {
  throw new MediumRefused({ code: 'medium_property_unavailable', refusal: `medium_property_unavailable: ${property}`, mediumId: m.id, property, because });
}

/** @description Ask a medium for a property it must carry. A medium that does not carry it refuses BY NAME rather than answering a quiet zero or a default.
 * @param m - the medium. @param property - the property the model requires. @returns The value, never null.
 * @throws MediumRefused `medium_property_unavailable: <property>`. */
export function requireProperty(m: Medium, property: MediumProperty): number | Vec3 | MediumField | FreeSurface {
  switch (property) {
    case 'gravityMps2': return m.gravityMps2;
    case 'densityKgM3': return m.densityKgM3;
    case 'dynamicViscosityPaS': return m.dynamicViscosityPaS;
    case 'kinematicViscosityM2S': return kinematicViscosityM2S(m);
    case 'speedOfSoundMs':
      return m.speedOfSoundMs ?? refuseProperty(m, property, `${m.label} carries no speed of sound; D7 forbids defaulting a property a medium cannot answer`);
    case 'temperatureK':
      return m.temperatureK ?? refuseProperty(m, property, `${m.label} carries no temperature; D7 forbids defaulting a property a medium cannot answer`);
    case 'field':
      return m.field ?? refuseProperty(m, property, `${m.label} has no field: there is nothing in it to move`);
    case 'freeSurface':
    default:
      return m.freeSurface ?? refuseProperty(m, 'freeSurface', `${m.label} carries no free surface in this package — nothing here models one. A model that needs an interface to work against gets this refusal, not a zero: undefined and zero are different answers`);
  }
}

/** @description Kinematic viscosity, DERIVED as mu/rho so it is never stored twice (D7). A medium with no mass has no kinematic viscosity at all.
 * @param m - the medium. @returns nu in m^2/s.
 * @throws MediumRefused `medium_property_unavailable: kinematicViscosityM2S` when the density is zero. */
export function kinematicViscosityM2S(m: Medium): number {
  if (m.densityKgM3 <= 0) {
    refuseProperty(m, 'kinematicViscosityM2S', `${m.label} has zero density, so mu/rho is 0/0 — undefined, not zero`);
  }
  return m.dynamicViscosityPaS / m.densityKgM3;
}

/** @description What a force model asks for rather than assumes: the properties it requires, and the media its author declares it valid in. The envelope is declared by the model author, never inferred by the caller. */
export interface ForceModel {
  id: string;
  label: string;
  requires: readonly MediumProperty[];
  validIn: readonly MediumId[];
  /** Why the envelope is what it is — the sentence a refusal quotes back. */
  envelopeWhy: string;
}

/** @description Check a model's validity envelope BEFORE any property is read, so a model that declines a medium outright says so rather than tripping over a missing property first.
 * @param model - the force model. @param m - the medium. @returns nothing.
 * @throws MediumRefused `model_not_valid_in_medium: <model>, <medium>`. */
export function requireModelValidIn(model: ForceModel, m: Medium): void {
  if (model.validIn.includes(m.id)) return;
  throw new MediumRefused({
    code: 'model_not_valid_in_medium',
    refusal: `model_not_valid_in_medium: ${model.id}, ${m.id}`,
    mediumId: m.id,
    model: model.id,
    because: model.envelopeWhy,
  });
}

/** @description The whole contract in one call: the envelope first, then every property the model declared it needs.
 * @param model - the force model. @param m - the medium. @returns The required properties by name.
 * @throws MediumRefused — `model_not_valid_in_medium` or `medium_property_unavailable`. */
export function satisfy(model: ForceModel, m: Medium): Record<string, unknown> {
  requireModelValidIn(model, m);
  const got: Record<string, unknown> = {};
  for (const property of model.requires) got[property] = requireProperty(m, property);
  return got;
}

/** @description A medium answers only over its own band. Outside it this raises rather than extrapolating — the behaviour D7 promotes from the atmosphere to every medium.
 * @param m - the medium. @param heightM - height above the medium's datum, positive up. @returns nothing.
 * @throws MediumRefused `medium_outside_validity: heightM=<value>`. */
export function requireWithinValidity(m: Medium, heightM: number): void {
  const v = m.validity;
  if (Number.isFinite(heightM) && heightM >= v.minM && heightM <= v.maxM) return;
  throw new MediumRefused({
    code: 'medium_outside_validity',
    refusal: `medium_outside_validity: ${v.coordinate}=${heightM}`,
    mediumId: m.id,
    because: `${m.label} answers over ${v.coordinate} [${v.minM}, ${v.maxM}] m. ${v.why}`,
  });
}

/** @description A medium as plain data for a route or a chooser: everything a caller needs to pick one and to read what it can answer. @param m - the medium. @returns The record, JSON-safe. */
export function mediumView(m: Medium): Record<string, unknown> {
  return {
    id: m.id,
    label: m.label,
    summary: m.summary,
    gravityMps2: m.gravityMps2,
    densityKgM3: m.densityKgM3,
    dynamicViscosityPaS: m.dynamicViscosityPaS,
    kinematicViscosityM2S: m.densityKgM3 > 0 ? m.dynamicViscosityPaS / m.densityKgM3 : null,
    speedOfSoundMs: m.speedOfSoundMs,
    temperatureK: m.temperatureK,
    field: m.field ? { model: m.field.model, why: m.field.why } : null,
    freeSurface: m.freeSurface,
    validity: m.validity,
    resolution: m.resolution,
    provenance: m.provenance,
  };
}
