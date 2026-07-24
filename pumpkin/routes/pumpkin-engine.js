"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:38:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: public barrel for the pumpkin prop feature slice (types, built-in presets + normalizer, per-user preset store, reply parser). Consumed by src/app/routes/pumpkin-routes.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pumpkinRooms = exports.PumpkinRoomRegistry = exports.parsePumpkinReply = exports.PumpkinPresetService = exports.normalizePreset = exports.builtinPreset = exports.BUILTIN_PRESET_NAMES = exports.BUILTIN_PRESETS = void 0;
var pumpkin_engine_presets_1 = require("./pumpkin-engine-presets");
Object.defineProperty(exports, "BUILTIN_PRESETS", { enumerable: true, get: function () { return pumpkin_engine_presets_1.BUILTIN_PRESETS; } });
Object.defineProperty(exports, "BUILTIN_PRESET_NAMES", { enumerable: true, get: function () { return pumpkin_engine_presets_1.BUILTIN_PRESET_NAMES; } });
Object.defineProperty(exports, "builtinPreset", { enumerable: true, get: function () { return pumpkin_engine_presets_1.builtinPreset; } });
Object.defineProperty(exports, "normalizePreset", { enumerable: true, get: function () { return pumpkin_engine_presets_1.normalizePreset; } });
var pumpkin_engine_preset_service_1 = require("./pumpkin-engine-preset-service");
Object.defineProperty(exports, "PumpkinPresetService", { enumerable: true, get: function () { return pumpkin_engine_preset_service_1.PumpkinPresetService; } });
var pumpkin_engine_reply_1 = require("./pumpkin-engine-reply");
Object.defineProperty(exports, "parsePumpkinReply", { enumerable: true, get: function () { return pumpkin_engine_reply_1.parsePumpkinReply; } });
var pumpkin_engine_room_registry_1 = require("./pumpkin-engine-room-registry");
Object.defineProperty(exports, "PumpkinRoomRegistry", { enumerable: true, get: function () { return pumpkin_engine_room_registry_1.PumpkinRoomRegistry; } });
Object.defineProperty(exports, "pumpkinRooms", { enumerable: true, get: function () { return pumpkin_engine_room_registry_1.pumpkinRooms; } });
//# sourceMappingURL=pumpkin-engine.js.map