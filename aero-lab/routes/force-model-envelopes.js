"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediumRefusal = exports.MEDIA_KNOWN = exports.DEFAULT_MEDIUM = exports.FORCE_MODEL_ENVELOPES_SCHEMA = void 0;
exports.isKnownMedium = isKnownMedium;
exports.envelopeFor = envelopeFor;
exports.listEnvelopes = listEnvelopes;
exports.requireModelValidIn = requireModelValidIn;
exports.requireMediumProperties = requireMediumProperties;
const force_model_envelopes_json_1 = __importDefault(require("./force-model-envelopes.json"));
const FILE = force_model_envelopes_json_1.default;
/** The schema the envelope rows are written against. */
exports.FORCE_MODEL_ENVELOPES_SCHEMA = FILE.schema;
/** The medium an undeclared model is confined to. */
exports.DEFAULT_MEDIUM = FILE.defaultMedium;
/** The media this lab knows by id, in the order a chooser should offer them. */
exports.MEDIA_KNOWN = Object.freeze([...FILE.mediaKnown]);
/** @description A refusal raised BY NAME, carrying the same shape embodied's MediumRefused sends, so a caller reads one refusal contract across labs. */
class MediumRefusal extends Error {
    code;
    /** The named refusal exactly as D7 writes it, e.g. `model_not_valid_in_medium: aeropolar, seawater`. */
    refusal;
    mediumId;
    model;
    property;
    because;
    constructor(init) {
        super(`${init.refusal} — ${init.because}`);
        this.name = 'MediumRefusal';
        this.code = init.code;
        this.refusal = init.refusal;
        this.mediumId = init.mediumId;
        this.because = init.because;
        if (init.model)
            this.model = init.model;
        if (init.property)
            this.property = init.property;
    }
    /** @description The refusal as a plain object a route can send. @returns code, the named refusal, the medium, and the reason. */
    toJSON() {
        return { error: this.code, refusal: this.refusal, medium: this.mediumId, model: this.model ?? null, property: this.property ?? null, because: this.because };
    }
}
exports.MediumRefusal = MediumRefusal;
/** @description Is this an id this lab knows a medium by? @param id - a medium id. @returns True for the three shared rows. */
function isKnownMedium(id) {
    return exports.MEDIA_KNOWN.includes(id);
}
/**
 * @description The envelope a model is held to. A declared model gets its author's row; an UNDECLARED
 * model gets the fail-closed envelope — the default medium only — because an author who has not said
 * where a model is valid has not said it is valid anywhere else.
 * @param modelId - The force model.
 * @returns The envelope, with `declared` saying which kind it is.
 */
function envelopeFor(modelId) {
    const row = FILE.models[modelId];
    if (row)
        return { id: modelId, label: row.label, requires: [...row.requires], validIn: [...row.validIn], why: row.why, declared: true };
    return {
        id: modelId,
        label: `${modelId} (undeclared)`,
        requires: [],
        validIn: [exports.DEFAULT_MEDIUM],
        why: `no validity envelope is declared for "${modelId}" in force-model-envelopes.json, so it is confined to this lab's default medium (${exports.DEFAULT_MEDIUM}) and refuses every other medium by name — an undeclared envelope fails closed, never permissive (ADR-160 D7)`,
        declared: false,
    };
}
/** @description Every declared envelope, for a status route or a chooser. @returns The rows in file order. */
function listEnvelopes() {
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
function requireModelValidIn(modelId, mediumId) {
    if (!isKnownMedium(mediumId)) {
        throw new MediumRefusal({ code: 'unknown_medium', refusal: `unknown_medium: ${mediumId}`, mediumId, model: modelId, because: `this lab knows media by these ids and substitutes none of them for another: ${exports.MEDIA_KNOWN.join(', ')}` });
    }
    const envelope = envelopeFor(modelId);
    if (envelope.validIn.includes(mediumId))
        return envelope;
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
function requireMediumProperties(modelId, medium) {
    const envelope = requireModelValidIn(modelId, medium.id);
    const got = {};
    for (const property of envelope.requires) {
        const value = medium[property];
        if (value === undefined || value === null) {
            throw new MediumRefusal({ code: 'medium_property_unavailable', refusal: `medium_property_unavailable: ${property}`, mediumId: medium.id, model: modelId, property, because: `${modelId} requires ${property} and the ${medium.id} record carries none — a refusal, never a quiet zero or a default (ADR-160 D7)` });
        }
        got[property] = value;
    }
    return got;
}
