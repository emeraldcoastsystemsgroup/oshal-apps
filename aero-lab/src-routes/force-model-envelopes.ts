/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 D7 (S4): this lab's force models declare the medium
 *                     |                             | properties they require and the media they are valid in, as
 *                     |                             | DATA (force-model-envelopes.json) rather than as a permissive
 *                     |                             | default. aeropolar, aerosurface and solar are air-only, each
 *                     |                             | with the reason a refusal quotes back. An UNDECLARED model
 *                     |                             | fails closed: valid in the lab's default medium, refused by
 *                     |                             | name everywhere else. Two refusals exist and both are named:
 *                     |                             | model_not_valid_in_medium and medium_property_unavailable.
 */

import envelopes from './force-model-envelopes.json';

/** The media this lab knows by id — embodied's committed rows, shared as data (ADR-160 D3). */
export type MediumId = 'vacuum' | 'air' | 'seawater';

/** The refusals ADR-160 D7 promotes from a property of one module to a requirement of the contract. */
export type MediumRefusalCode = 'model_not_valid_in_medium' | 'medium_property_unavailable' | 'unknown_medium';

/** @description What a force model asks for rather than assumes, and whether its author actually declared it. */
export interface ForceModelEnvelope {
  id: string;
  label: string;
  requires: readonly string[];
  validIn: readonly MediumId[];
  /** The sentence a refusal quotes back. */
  why: string;
  /** False when the model has no entry in the data file and the envelope is the fail-closed default. */
  declared: boolean;
}

/** @description A medium record a caller posts AS DATA — the shape embodied's `mediumView` publishes. Only the id and the property bag are read here. */
export interface PostedMedium {
  id: string;
  [property: string]: unknown;
}

/** The data file, typed exactly as written. */
interface EnvelopeFile {
  schema: string;
  lab: string;
  defaultMedium: MediumId;
  mediaKnown: MediumId[];
  models: Record<string, { label: string; requires: string[]; validIn: MediumId[]; why: string }>;
}

const FILE = envelopes as unknown as EnvelopeFile;

/** The schema the envelope rows are written against. */
export const FORCE_MODEL_ENVELOPES_SCHEMA: string = FILE.schema;

/** The medium an undeclared model is confined to. */
export const DEFAULT_MEDIUM: MediumId = FILE.defaultMedium;

/** The media this lab knows by id, in the order a chooser should offer them. */
export const MEDIA_KNOWN: readonly MediumId[] = Object.freeze([...FILE.mediaKnown]);

/** @description A refusal raised BY NAME, carrying the same shape embodied's MediumRefused sends, so a caller reads one refusal contract across labs. */
export class MediumRefusal extends Error {
  readonly code: MediumRefusalCode;
  /** The named refusal exactly as D7 writes it, e.g. `model_not_valid_in_medium: aeropolar, seawater`. */
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

  /** @description The refusal as a plain object a route can send. @returns code, the named refusal, the medium, and the reason. */
  toJSON(): Record<string, unknown> {
    return { error: this.code, refusal: this.refusal, medium: this.mediumId, model: this.model ?? null, property: this.property ?? null, because: this.because };
  }
}

/** @description Is this an id this lab knows a medium by? @param id - a medium id. @returns True for the three shared rows. */
export function isKnownMedium(id: string): id is MediumId {
  return (MEDIA_KNOWN as readonly string[]).includes(id);
}

/**
 * @description The envelope a model is held to. A declared model gets its author's row; an UNDECLARED
 * model gets the fail-closed envelope — the default medium only — because an author who has not said
 * where a model is valid has not said it is valid anywhere else.
 * @param modelId - The force model.
 * @returns The envelope, with `declared` saying which kind it is.
 */
export function envelopeFor(modelId: string): ForceModelEnvelope {
  const row = FILE.models[modelId];
  if (row) return { id: modelId, label: row.label, requires: [...row.requires], validIn: [...row.validIn], why: row.why, declared: true };
  return {
    id: modelId,
    label: `${modelId} (undeclared)`,
    requires: [],
    validIn: [DEFAULT_MEDIUM],
    why: `no validity envelope is declared for "${modelId}" in force-model-envelopes.json, so it is confined to this lab's default medium (${DEFAULT_MEDIUM}) and refuses every other medium by name — an undeclared envelope fails closed, never permissive (ADR-160 D7)`,
    declared: false,
  };
}

/** @description Every declared envelope, for a status route or a chooser. @returns The rows in file order. */
export function listEnvelopes(): ForceModelEnvelope[] {
  return Object.keys(FILE.models).map(envelopeFor);
}

/**
 * @description Hold a model to its envelope BEFORE any property is read, so a model that declines a
 * medium outright says so rather than tripping over a missing property first.
 * @param modelId - The force model.
 * @param mediumId - The medium a caller wants to run it in.
 * @returns The envelope that admitted the medium.
 * @throws MediumRefusal `unknown_medium` for an id this lab does not know, `model_not_valid_in_medium: <model>, <medium>` otherwise.
 */
export function requireModelValidIn(modelId: string, mediumId: string): ForceModelEnvelope {
  if (!isKnownMedium(mediumId)) {
    throw new MediumRefusal({ code: 'unknown_medium', refusal: `unknown_medium: ${mediumId}`, mediumId, model: modelId, because: `this lab knows media by these ids and substitutes none of them for another: ${MEDIA_KNOWN.join(', ')}` });
  }
  const envelope = envelopeFor(modelId);
  if (envelope.validIn.includes(mediumId)) return envelope;
  throw new MediumRefusal({ code: 'model_not_valid_in_medium', refusal: `model_not_valid_in_medium: ${modelId}, ${mediumId}`, mediumId, model: modelId, because: envelope.why });
}

/**
 * @description The whole contract against a medium record posted as data: the envelope first, then every
 * property the model declared it needs must be present and non-null on the record.
 * @param modelId - The force model.
 * @param medium - The medium record, as embodied's media route publishes it.
 * @returns The required properties by name.
 * @throws MediumRefusal — `model_not_valid_in_medium` or `medium_property_unavailable: <property>`.
 */
export function requireMediumProperties(modelId: string, medium: PostedMedium): Record<string, unknown> {
  const envelope = requireModelValidIn(modelId, medium.id);
  const got: Record<string, unknown> = {};
  for (const property of envelope.requires) {
    const value = medium[property];
    if (value === undefined || value === null) {
      throw new MediumRefusal({ code: 'medium_property_unavailable', refusal: `medium_property_unavailable: ${property}`, mediumId: medium.id, model: modelId, property, because: `${modelId} requires ${property} and the ${medium.id} record carries none — a refusal, never a quiet zero or a default (ADR-160 D7)` });
    }
    got[property] = value;
  }
  return got;
}
