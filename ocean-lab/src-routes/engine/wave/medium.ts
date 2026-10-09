/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 D7 in ocean-lab: a medium is a named record read from
 *                     |                             | this package's committed rows (medium-properties.json — the
 *                     |                             | same values embodied's row carries, pinned by the store's
 *                     |                             | contract check), and a force model asks for what it needs
 *                     |                             | instead of assuming seawater. Two refusals, both by name:
 *                     |                             | model_not_valid_in_medium when the model's declared envelope
 *                     |                             | excludes the medium, and medium_property_unavailable when a
 *                     |                             | property it needs is absent — a free surface in air above
 *                     |                             | all. An UNDECLARED model fails closed to this lab's default
 *                     |                             | medium, never permissive; a position outside the medium's
 *                     |                             | band is medium_outside_validity.
 */

import mediumRows from './medium-properties.json';
import envelopeRows from './force-model-envelopes.json';

/** @description The media this lab knows by id — embodied's committed rows, shared as data (ADR-160 D3). */
export type MediumId = 'vacuum' | 'air' | 'seawater';

/** @description The named refusals ADR-160 D7 makes part of the contract, plus the two a lookup can raise. */
export type MediumRefusalCode = 'model_not_valid_in_medium' | 'medium_property_unavailable' | 'medium_outside_validity' | 'unknown_medium';

/** @description A free surface: the plane a float heaves on, at a height above the medium's datum. */
export interface FreeSurface { kind: 'plane'; heightM: number; why: string }

/** @description The medium's own motion, as its row names it (a still field, or the sea-state heave). */
export interface MediumField { model: string; velocityMs: readonly number[] | null; why: string }

/** @description The coordinate band a medium answers over, and why it refuses outside it. */
export interface MediumValidity { coordinate: 'heightM'; minM: number; maxM: number; why: string }

/** @description A medium record (ADR-160 D7): the shared property values plus this lab's implementation of them. */
export interface Medium {
  id: MediumId;
  label: string;
  gravityMps2: readonly [number, number, number];
  densityKgM3: number;
  dynamicViscosityPaS: number;
  speedOfSoundMs: number | null;
  temperatureK: number | null;
  resolution: string;
  field: MediumField | null;
  freeSurface: FreeSurface | null;
  validity: MediumValidity;
}

/** @description What a force model declares: the properties it needs and the media it is valid in. */
export interface ForceModelEnvelope { id: string; label: string; requires: readonly string[]; validIn: readonly MediumId[]; why: string; declared: boolean }

interface MediumRow {
  id: MediumId; label: string;
  properties: { gravityMps2: number[]; densityKgM3: number; dynamicViscosityPaS: number; speedOfSoundMs: number | null; temperatureK: number | null };
  implementation: { resolution: string; field: MediumField | null; freeSurface: FreeSurface | null; validity: MediumValidity };
}
interface EnvelopeFile { schema: string; defaultMedium: MediumId; mediaKnown: MediumId[]; models: Record<string, { label: string; requires: string[]; validIn: MediumId[]; why: string }> }

const ROWS = (mediumRows as unknown as { media: Record<MediumId, MediumRow> }).media;
const ENVELOPES = envelopeRows as unknown as EnvelopeFile;

/** The schema the envelope rows are written against. */
export const FORCE_MODEL_ENVELOPES_SCHEMA: string = ENVELOPES.schema;
/** The medium an undeclared model is confined to. */
export const DEFAULT_MEDIUM: MediumId = ENVELOPES.defaultMedium;
/** The media this lab knows, in the order a chooser offers them. */
export const MEDIA_KNOWN: readonly MediumId[] = Object.freeze([...ENVELOPES.mediaKnown]);

/** @description A refusal raised BY NAME, in the shape aero-lab's MediumRefusal and embodied's MediumRefused send, so one refusal contract reads across labs. */
export class MediumRefusal extends Error {
  readonly code: MediumRefusalCode;
  readonly refusal: string;
  readonly mediumId: string;
  readonly model?: string;
  readonly property?: string;
  readonly because: string;

  constructor(init: { code: MediumRefusalCode; refusal: string; mediumId: string; because: string; model?: string; property?: string }) {
    super(`${init.refusal} — ${init.because}`);
    this.name = 'MediumRefusal';
    this.code = init.code;
    this.refusal = init.refusal;
    this.mediumId = init.mediumId;
    this.because = init.because;
    if (init.model) this.model = init.model;
    if (init.property) this.property = init.property;
  }

  /** @description The refusal as a plain object a route can send. @returns code, the named refusal, the medium, the model, the property and the reason. */
  toJSON(): Record<string, unknown> {
    return { error: this.code, refusal: this.refusal, medium: this.mediumId, model: this.model ?? null, property: this.property ?? null, because: this.because };
  }
}

/** @description Is this an id this lab knows a medium by? @param id - A medium id. @returns True for the three shared rows. */
export function isKnownMedium(id: string): id is MediumId {
  return (MEDIA_KNOWN as readonly string[]).includes(id);
}

/** @description The medium record for an id, built from the committed row. @param id - A medium id. @returns The medium. @throws MediumRefusal unknown_medium. */
export function mediumById(id: string): Medium {
  if (!isKnownMedium(id) || !ROWS[id]) {
    throw new MediumRefusal({ code: 'unknown_medium', refusal: `unknown_medium: ${id}`, mediumId: id, because: `this lab knows media by these ids and substitutes none of them for another: ${MEDIA_KNOWN.join(', ')}` });
  }
  const row = ROWS[id];
  const g = row.properties.gravityMps2;
  return {
    id: row.id, label: row.label, gravityMps2: [g[0], g[1], g[2]],
    densityKgM3: row.properties.densityKgM3, dynamicViscosityPaS: row.properties.dynamicViscosityPaS,
    speedOfSoundMs: row.properties.speedOfSoundMs, temperatureK: row.properties.temperatureK,
    resolution: row.implementation.resolution, field: row.implementation.field, freeSurface: row.implementation.freeSurface, validity: row.implementation.validity,
  };
}

/** @description Every medium this lab knows, as records. @returns The media in chooser order. */
export function listMedia(): Medium[] {
  return MEDIA_KNOWN.map(mediumById);
}

/** @description The envelope a model is held to: its author's row, or the FAIL-CLOSED default (this lab's default medium only) when none is declared.
 * @param modelId - The force model. @returns The envelope, with `declared` saying which kind it is. */
export function envelopeFor(modelId: string): ForceModelEnvelope {
  const row = ENVELOPES.models[modelId];
  if (row) return { id: modelId, label: row.label, requires: [...row.requires], validIn: [...row.validIn], why: row.why, declared: true };
  return {
    id: modelId, label: `${modelId} (undeclared)`, requires: [], validIn: [DEFAULT_MEDIUM], declared: false,
    why: `no validity envelope is declared for "${modelId}" in force-model-envelopes.json, so it is confined to this lab's default medium (${DEFAULT_MEDIUM}) and refuses every other medium by name — an undeclared envelope fails closed, never permissive (ADR-160 D7)`,
  };
}

/** @description Every declared envelope. @returns The rows in file order. */
export function listEnvelopes(): ForceModelEnvelope[] {
  return Object.keys(ENVELOPES.models).map(envelopeFor);
}

/** @description Hold a model to its envelope BEFORE any property is read.
 * @param modelId - The force model. @param medium - The medium a caller wants to run it in.
 * @returns The envelope that admitted the medium. @throws MediumRefusal model_not_valid_in_medium. */
export function requireModelValidIn(modelId: string, medium: Medium): ForceModelEnvelope {
  const envelope = envelopeFor(modelId);
  if (envelope.validIn.includes(medium.id)) return envelope;
  throw new MediumRefusal({ code: 'model_not_valid_in_medium', refusal: `model_not_valid_in_medium: ${modelId}, ${medium.id}`, mediumId: medium.id, model: modelId, because: envelope.why });
}

/** @description Is one named property present on a medium? Density and viscosity are present when positive; a vector, a plane or a field when non-null. */
function carries(medium: Medium, property: string): boolean {
  const value = (medium as unknown as Record<string, unknown>)[property];
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return true;
}

/** @description The whole contract: the envelope first, then every property the model declared it needs, in the order it declared them.
 * @param modelId - The force model. @param medium - The medium.
 * @returns The envelope. @throws MediumRefusal — model_not_valid_in_medium, or medium_property_unavailable naming the first missing property. */
export function requireMediumProperties(modelId: string, medium: Medium): ForceModelEnvelope {
  const envelope = requireModelValidIn(modelId, medium);
  for (const property of envelope.requires) {
    if (carries(medium, property)) continue;
    throw new MediumRefusal({
      code: 'medium_property_unavailable', refusal: `medium_property_unavailable: ${property}`, mediumId: medium.id, model: modelId, property,
      because: `${modelId} requires ${property} and the ${medium.id} record carries none — a refusal, never a quiet zero or a default (ADR-160 D7)`,
    });
  }
  return envelope;
}

/** @description Refuse a position outside the band the medium answers over. @param medium - The medium. @param heightM - Height above its datum, m (negative is below). @returns Nothing. @throws MediumRefusal medium_outside_validity. */
export function requireWithinValidity(medium: Medium, heightM: number): void {
  const v = medium.validity;
  if (Number.isFinite(heightM) && heightM >= v.minM && heightM <= v.maxM) return;
  throw new MediumRefusal({ code: 'medium_outside_validity', refusal: `medium_outside_validity: ${medium.id}, ${heightM} m`, mediumId: medium.id, because: `the ${medium.id} row answers over [${v.minM}, ${v.maxM}] m: ${v.why}` });
}

/** @description |g|, the magnitude of the medium's gravity vector. @param medium - The medium. @returns m/s^2. */
export function gravityMagnitude(medium: Medium): number {
  const g = medium.gravityMps2;
  return Math.hypot(g[0], g[1], g[2]);
}

/** @description Kinematic viscosity, DERIVED as mu/rho (D7). @param medium - The medium. @returns m^2/s. @throws MediumRefusal medium_property_unavailable when the density is zero (0/0 is not zero). */
export function kinematicViscosityM2S(medium: Medium): number {
  if (!(medium.densityKgM3 > 0)) {
    throw new MediumRefusal({ code: 'medium_property_unavailable', refusal: 'medium_property_unavailable: kinematicViscosityM2S', mediumId: medium.id, property: 'kinematicViscosityM2S', because: `mu/rho is undefined in ${medium.id}: its density is zero` });
  }
  return medium.dynamicViscosityPaS / medium.densityKgM3;
}
