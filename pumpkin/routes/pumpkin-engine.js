"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:38:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: public barrel for the pumpkin prop feature slice (types, built-in presets + normalizer, per-user preset store, reply parser). Consumed by src/app/routes/pumpkin-routes.ts.
 * 2026-07-24 07:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Export the saved-responses store (PumpkinResponseService + normalizer) for the one-tap replay playlist.
 * 2026-08-01 12:00:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Export the swarm-control surface of the room registry: resolveSpeakTargets (headless room resolution that refuses rather than guesses), the now-exported roomSlug (three surfaces derive that pairing key independently, so exactly one definition may exist), the TTL/idle constants the route and its guards assert against, and the PumpkinRoomListener transport type whose `false` return is what makes dead-listener pruning possible.
 * 2026-08-01 22:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Export the device-link builder (buildPumpkinLinks / resolvePublicOrigin / pumpkinQrTargetUrl / readQrTarget) behind the new GET /links + GET /qr routes — the two endpoints the README documented and the control surface has been calling since Design C, but which no router ever registered.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePublicOrigin = exports.readQrTarget = exports.pumpkinQrTargetUrl = exports.buildPumpkinLinks = exports.ROOM_MAX_IDLE_MS = exports.ROOM_TTL_MS = exports.roomSlug = exports.resolveSpeakTargets = exports.pumpkinRooms = exports.PumpkinRoomRegistry = exports.parsePumpkinReply = exports.MAX_UNPINNED_RESPONSES = exports.MAX_SAVED_SAY = exports.responseDedupeKey = exports.normalizeSavedResponse = exports.PumpkinResponseService = exports.PumpkinPresetService = exports.normalizePreset = exports.builtinPreset = exports.BUILTIN_PRESET_NAMES = exports.BUILTIN_PRESETS = void 0;
var pumpkin_engine_presets_1 = require("./pumpkin-engine-presets");
Object.defineProperty(exports, "BUILTIN_PRESETS", { enumerable: true, get: function () { return pumpkin_engine_presets_1.BUILTIN_PRESETS; } });
Object.defineProperty(exports, "BUILTIN_PRESET_NAMES", { enumerable: true, get: function () { return pumpkin_engine_presets_1.BUILTIN_PRESET_NAMES; } });
Object.defineProperty(exports, "builtinPreset", { enumerable: true, get: function () { return pumpkin_engine_presets_1.builtinPreset; } });
Object.defineProperty(exports, "normalizePreset", { enumerable: true, get: function () { return pumpkin_engine_presets_1.normalizePreset; } });
var pumpkin_engine_preset_service_1 = require("./pumpkin-engine-preset-service");
Object.defineProperty(exports, "PumpkinPresetService", { enumerable: true, get: function () { return pumpkin_engine_preset_service_1.PumpkinPresetService; } });
var pumpkin_engine_response_store_1 = require("./pumpkin-engine-response-store");
Object.defineProperty(exports, "PumpkinResponseService", { enumerable: true, get: function () { return pumpkin_engine_response_store_1.PumpkinResponseService; } });
Object.defineProperty(exports, "normalizeSavedResponse", { enumerable: true, get: function () { return pumpkin_engine_response_store_1.normalizeSavedResponse; } });
Object.defineProperty(exports, "responseDedupeKey", { enumerable: true, get: function () { return pumpkin_engine_response_store_1.responseDedupeKey; } });
Object.defineProperty(exports, "MAX_SAVED_SAY", { enumerable: true, get: function () { return pumpkin_engine_response_store_1.MAX_SAVED_SAY; } });
Object.defineProperty(exports, "MAX_UNPINNED_RESPONSES", { enumerable: true, get: function () { return pumpkin_engine_response_store_1.MAX_UNPINNED_RESPONSES; } });
var pumpkin_engine_reply_1 = require("./pumpkin-engine-reply");
Object.defineProperty(exports, "parsePumpkinReply", { enumerable: true, get: function () { return pumpkin_engine_reply_1.parsePumpkinReply; } });
var pumpkin_engine_room_registry_1 = require("./pumpkin-engine-room-registry");
Object.defineProperty(exports, "PumpkinRoomRegistry", { enumerable: true, get: function () { return pumpkin_engine_room_registry_1.PumpkinRoomRegistry; } });
Object.defineProperty(exports, "pumpkinRooms", { enumerable: true, get: function () { return pumpkin_engine_room_registry_1.pumpkinRooms; } });
Object.defineProperty(exports, "resolveSpeakTargets", { enumerable: true, get: function () { return pumpkin_engine_room_registry_1.resolveSpeakTargets; } });
Object.defineProperty(exports, "roomSlug", { enumerable: true, get: function () { return pumpkin_engine_room_registry_1.roomSlug; } });
Object.defineProperty(exports, "ROOM_TTL_MS", { enumerable: true, get: function () { return pumpkin_engine_room_registry_1.ROOM_TTL_MS; } });
Object.defineProperty(exports, "ROOM_MAX_IDLE_MS", { enumerable: true, get: function () { return pumpkin_engine_room_registry_1.ROOM_MAX_IDLE_MS; } });
var pumpkin_engine_links_1 = require("./pumpkin-engine-links");
Object.defineProperty(exports, "buildPumpkinLinks", { enumerable: true, get: function () { return pumpkin_engine_links_1.buildPumpkinLinks; } });
Object.defineProperty(exports, "pumpkinQrTargetUrl", { enumerable: true, get: function () { return pumpkin_engine_links_1.pumpkinQrTargetUrl; } });
Object.defineProperty(exports, "readQrTarget", { enumerable: true, get: function () { return pumpkin_engine_links_1.readQrTarget; } });
Object.defineProperty(exports, "resolvePublicOrigin", { enumerable: true, get: function () { return pumpkin_engine_links_1.resolvePublicOrigin; } });
//# sourceMappingURL=pumpkin-engine.js.map