"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the wave slice's public surface: the medium
 *                     |                             | contract (rows, envelopes, the named refusals), the
 *                     |                             | wave-propulsion model and the sea-state year.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.knots = exports.kmPerDay = exports.evaluateSeaStates = exports.wingForces = exports.theodorsenMagnitude = exports.resistanceN = exports.peakHeaveMs = exports.kinematicCeilingMs = exports.ittcFrictionCoefficient = exports.heaveVelocity = exports.heaveBudgetsN = exports.equilibrium = exports.cycleMeanThrustN = exports.balancedHeaveMs = exports.WAVE_ENGINE = exports.PHASE_SAMPLES = exports.ITTC_REYNOLDS_FLOOR = exports.requireWithinValidity = exports.requireModelValidIn = exports.requireMediumProperties = exports.mediumById = exports.listMedia = exports.listEnvelopes = exports.kinematicViscosityM2S = exports.isKnownMedium = exports.gravityMagnitude = exports.envelopeFor = exports.MediumRefusal = exports.MEDIA_KNOWN = exports.FORCE_MODEL_ENVELOPES_SCHEMA = exports.DEFAULT_MEDIUM = void 0;
var medium_1 = require("./medium");
Object.defineProperty(exports, "DEFAULT_MEDIUM", { enumerable: true, get: function () { return medium_1.DEFAULT_MEDIUM; } });
Object.defineProperty(exports, "FORCE_MODEL_ENVELOPES_SCHEMA", { enumerable: true, get: function () { return medium_1.FORCE_MODEL_ENVELOPES_SCHEMA; } });
Object.defineProperty(exports, "MEDIA_KNOWN", { enumerable: true, get: function () { return medium_1.MEDIA_KNOWN; } });
Object.defineProperty(exports, "MediumRefusal", { enumerable: true, get: function () { return medium_1.MediumRefusal; } });
Object.defineProperty(exports, "envelopeFor", { enumerable: true, get: function () { return medium_1.envelopeFor; } });
Object.defineProperty(exports, "gravityMagnitude", { enumerable: true, get: function () { return medium_1.gravityMagnitude; } });
Object.defineProperty(exports, "isKnownMedium", { enumerable: true, get: function () { return medium_1.isKnownMedium; } });
Object.defineProperty(exports, "kinematicViscosityM2S", { enumerable: true, get: function () { return medium_1.kinematicViscosityM2S; } });
Object.defineProperty(exports, "listEnvelopes", { enumerable: true, get: function () { return medium_1.listEnvelopes; } });
Object.defineProperty(exports, "listMedia", { enumerable: true, get: function () { return medium_1.listMedia; } });
Object.defineProperty(exports, "mediumById", { enumerable: true, get: function () { return medium_1.mediumById; } });
Object.defineProperty(exports, "requireMediumProperties", { enumerable: true, get: function () { return medium_1.requireMediumProperties; } });
Object.defineProperty(exports, "requireModelValidIn", { enumerable: true, get: function () { return medium_1.requireModelValidIn; } });
Object.defineProperty(exports, "requireWithinValidity", { enumerable: true, get: function () { return medium_1.requireWithinValidity; } });
var wave_propulsion_1 = require("./wave-propulsion");
Object.defineProperty(exports, "ITTC_REYNOLDS_FLOOR", { enumerable: true, get: function () { return wave_propulsion_1.ITTC_REYNOLDS_FLOOR; } });
Object.defineProperty(exports, "PHASE_SAMPLES", { enumerable: true, get: function () { return wave_propulsion_1.PHASE_SAMPLES; } });
Object.defineProperty(exports, "WAVE_ENGINE", { enumerable: true, get: function () { return wave_propulsion_1.WAVE_ENGINE; } });
Object.defineProperty(exports, "balancedHeaveMs", { enumerable: true, get: function () { return wave_propulsion_1.balancedHeaveMs; } });
Object.defineProperty(exports, "cycleMeanThrustN", { enumerable: true, get: function () { return wave_propulsion_1.cycleMeanThrustN; } });
Object.defineProperty(exports, "equilibrium", { enumerable: true, get: function () { return wave_propulsion_1.equilibrium; } });
Object.defineProperty(exports, "heaveBudgetsN", { enumerable: true, get: function () { return wave_propulsion_1.heaveBudgetsN; } });
Object.defineProperty(exports, "heaveVelocity", { enumerable: true, get: function () { return wave_propulsion_1.heaveVelocity; } });
Object.defineProperty(exports, "ittcFrictionCoefficient", { enumerable: true, get: function () { return wave_propulsion_1.ittcFrictionCoefficient; } });
Object.defineProperty(exports, "kinematicCeilingMs", { enumerable: true, get: function () { return wave_propulsion_1.kinematicCeilingMs; } });
Object.defineProperty(exports, "peakHeaveMs", { enumerable: true, get: function () { return wave_propulsion_1.peakHeaveMs; } });
Object.defineProperty(exports, "resistanceN", { enumerable: true, get: function () { return wave_propulsion_1.resistanceN; } });
Object.defineProperty(exports, "theodorsenMagnitude", { enumerable: true, get: function () { return wave_propulsion_1.theodorsenMagnitude; } });
Object.defineProperty(exports, "wingForces", { enumerable: true, get: function () { return wave_propulsion_1.wingForces; } });
var sea_state_1 = require("./sea-state");
Object.defineProperty(exports, "evaluateSeaStates", { enumerable: true, get: function () { return sea_state_1.evaluateSeaStates; } });
Object.defineProperty(exports, "kmPerDay", { enumerable: true, get: function () { return sea_state_1.kmPerDay; } });
Object.defineProperty(exports, "knots", { enumerable: true, get: function () { return sea_state_1.knots; } });
