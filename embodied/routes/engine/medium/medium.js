"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-160 D7 slice S1 — a medium is a named record, not a property of the lab you happen to be in. Three implementations (vacuum, air, seawater) built over ONE committed data row per medium (medium-properties.json), so this package answers "what is seawater" with the same values ocean-lab and aero-lab do rather than minting a third. A force model declares the properties it needs and the media it is valid in, and gets two refusals BY NAME instead of a confidently wrong number: medium_property_unavailable when the medium does not carry what the model needs, and model_not_valid_in_medium when every property is present and the model still declines. A medium also refuses outside its own validity band rather than extrapolating.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEDIUM_IDS = exports.MEDIUM_PROPERTIES_SCHEMA = exports.EARTH_SURFACE_GRAVITY_MPS2 = exports.MediumRefused = void 0;
exports.mediumById = mediumById;
exports.allMedia = allMedia;
exports.requireProperty = requireProperty;
exports.kinematicViscosityM2S = kinematicViscosityM2S;
exports.requireModelValidIn = requireModelValidIn;
exports.satisfy = satisfy;
exports.requireWithinValidity = requireWithinValidity;
exports.mediumView = mediumView;
const medium_properties_json_1 = __importDefault(require("./medium-properties.json"));
/** @description A refusal raised BY NAME. Zero thrust and undefined thrust are different answers, and so are "it floats" and "this lab cannot say whether it floats". */
class MediumRefused extends Error {
    code;
    /** The named refusal exactly as D7 writes it, e.g. `medium_property_unavailable: freeSurface`. */
    refusal;
    mediumId;
    property;
    model;
    /** Why this is a refusal and not a number. */
    because;
    constructor(init) {
        super(`${init.refusal} — ${init.because}`);
        this.name = 'MediumRefused';
        this.code = init.code;
        this.refusal = init.refusal;
        this.mediumId = init.mediumId;
        this.because = init.because;
        if (init.property)
            this.property = init.property;
        if (init.model)
            this.model = init.model;
    }
    /** @description The refusal as a plain object a route can send. @returns code, the named refusal, the medium, and the reason. */
    toJSON() {
        return { error: this.code, refusal: this.refusal, medium: this.mediumId, property: this.property ?? null, model: this.model ?? null, because: this.because };
    }
}
exports.MediumRefused = MediumRefused;
/** Earth-surface gravity, from the committed data row. The one number this package writes into an MJCF `<option>`. */
exports.EARTH_SURFACE_GRAVITY_MPS2 = medium_properties_json_1.default.earthSurfaceGravityMps2;
/** The schema the committed property rows are written against. */
exports.MEDIUM_PROPERTIES_SCHEMA = medium_properties_json_1.default.schema;
const STILL = { velocityMs: [0, 0, 0], gradientPerS: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] };
/** @description A field that is still everywhere, said by name. @param model - what to call it. @param why - why this lab carries no resolving field. @returns The field. */
function stillField(model, why) {
    return { model, why, sample: () => STILL };
}
const RAW = medium_properties_json_1.default;
/** @description Build one medium from its committed data row: the property values come from the row, the answer machine is this lab's. @param raw - the row. @returns The medium. */
function fromRow(raw) {
    const g = raw.properties.gravityMps2;
    const impl = raw.implementation;
    return {
        id: raw.id,
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
const MEDIA = Object.freeze({
    vacuum: fromRow(RAW.media.vacuum),
    air: fromRow(RAW.media.air),
    seawater: fromRow(RAW.media.seawater),
});
/** Every medium this package implements, in the order a chooser should offer them. */
exports.MEDIUM_IDS = ['vacuum', 'air', 'seawater'];
/** @description The medium a caller named. @param id - the medium id. @returns The medium, or `null` when this lab does not implement it — a medium is never silently substituted. */
function mediumById(id) {
    return exports.MEDIUM_IDS.includes(id) ? MEDIA[id] : null;
}
/** @description Every medium, for a chooser or a status route. @returns The three media. */
function allMedia() {
    return exports.MEDIUM_IDS.map((id) => MEDIA[id]);
}
/** @description Raise the named property refusal. @param m - the medium. @param property - what was asked for. @param because - why it is not available. @returns never. */
function refuseProperty(m, property, because) {
    throw new MediumRefused({ code: 'medium_property_unavailable', refusal: `medium_property_unavailable: ${property}`, mediumId: m.id, property, because });
}
/** @description Ask a medium for a property it must carry. A medium that does not carry it refuses BY NAME rather than answering a quiet zero or a default.
 * @param m - the medium. @param property - the property the model requires. @returns The value, never null.
 * @throws MediumRefused `medium_property_unavailable: <property>`. */
function requireProperty(m, property) {
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
function kinematicViscosityM2S(m) {
    if (m.densityKgM3 <= 0) {
        refuseProperty(m, 'kinematicViscosityM2S', `${m.label} has zero density, so mu/rho is 0/0 — undefined, not zero`);
    }
    return m.dynamicViscosityPaS / m.densityKgM3;
}
/** @description Check a model's validity envelope BEFORE any property is read, so a model that declines a medium outright says so rather than tripping over a missing property first.
 * @param model - the force model. @param m - the medium. @returns nothing.
 * @throws MediumRefused `model_not_valid_in_medium: <model>, <medium>`. */
function requireModelValidIn(model, m) {
    if (model.validIn.includes(m.id))
        return;
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
function satisfy(model, m) {
    requireModelValidIn(model, m);
    const got = {};
    for (const property of model.requires)
        got[property] = requireProperty(m, property);
    return got;
}
/** @description A medium answers only over its own band. Outside it this raises rather than extrapolating — the behaviour D7 promotes from the atmosphere to every medium.
 * @param m - the medium. @param heightM - height above the medium's datum, positive up. @returns nothing.
 * @throws MediumRefused `medium_outside_validity: heightM=<value>`. */
function requireWithinValidity(m, heightM) {
    const v = m.validity;
    if (Number.isFinite(heightM) && heightM >= v.minM && heightM <= v.maxM)
        return;
    throw new MediumRefused({
        code: 'medium_outside_validity',
        refusal: `medium_outside_validity: ${v.coordinate}=${heightM}`,
        mediumId: m.id,
        because: `${m.label} answers over ${v.coordinate} [${v.minM}, ${v.maxM}] m. ${v.why}`,
    });
}
/** @description A medium as plain data for a route or a chooser: everything a caller needs to pick one and to read what it can answer. @param m - the medium. @returns The record, JSON-safe. */
function mediumView(m) {
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
//# sourceMappingURL=medium.js.map