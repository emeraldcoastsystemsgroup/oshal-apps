"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — marine slice barrel: tidal harmonic
 *                     |                             | current model + closed-loop power budget for a
 *                     |                             | persistent current-harvesting node.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Unchanged surface after the @/shared/energy extraction — the
 *                     |                             | budget engine moved out from under these names, deliberately
 *                     |                             | without touching one of them. That this list did not move is
 *                     |                             | the evidence the refactor was behaviour-preserving.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.turbinePowerW = exports.totalDrawW = exports.simulatePowerBudget = exports.recommendStorageWh = exports.SEAWATER_DENSITY_KGM3 = exports.DEFAULT_DURATION_HOURS = exports.BETZ_LIMIT = exports.peakSpeedMs = exports.longestSlackHours = exports.currentSpeedAt = exports.constituent = exports.STRONG_CHANNEL_SITE = exports.STANDARD_CONSTITUENT_PERIODS_H = exports.SINUSOID_MEAN_CUBE_FACTOR = exports.MODERATE_INLET_SITE = void 0;
var tidal_current_1 = require("./services/tidal-current");
Object.defineProperty(exports, "MODERATE_INLET_SITE", { enumerable: true, get: function () { return tidal_current_1.MODERATE_INLET_SITE; } });
Object.defineProperty(exports, "SINUSOID_MEAN_CUBE_FACTOR", { enumerable: true, get: function () { return tidal_current_1.SINUSOID_MEAN_CUBE_FACTOR; } });
Object.defineProperty(exports, "STANDARD_CONSTITUENT_PERIODS_H", { enumerable: true, get: function () { return tidal_current_1.STANDARD_CONSTITUENT_PERIODS_H; } });
Object.defineProperty(exports, "STRONG_CHANNEL_SITE", { enumerable: true, get: function () { return tidal_current_1.STRONG_CHANNEL_SITE; } });
Object.defineProperty(exports, "constituent", { enumerable: true, get: function () { return tidal_current_1.constituent; } });
Object.defineProperty(exports, "currentSpeedAt", { enumerable: true, get: function () { return tidal_current_1.currentSpeedAt; } });
Object.defineProperty(exports, "longestSlackHours", { enumerable: true, get: function () { return tidal_current_1.longestSlackHours; } });
Object.defineProperty(exports, "peakSpeedMs", { enumerable: true, get: function () { return tidal_current_1.peakSpeedMs; } });
var power_budget_1 = require("./services/power-budget");
Object.defineProperty(exports, "BETZ_LIMIT", { enumerable: true, get: function () { return power_budget_1.BETZ_LIMIT; } });
Object.defineProperty(exports, "DEFAULT_DURATION_HOURS", { enumerable: true, get: function () { return power_budget_1.DEFAULT_DURATION_HOURS; } });
Object.defineProperty(exports, "SEAWATER_DENSITY_KGM3", { enumerable: true, get: function () { return power_budget_1.SEAWATER_DENSITY_KGM3; } });
Object.defineProperty(exports, "recommendStorageWh", { enumerable: true, get: function () { return power_budget_1.recommendStorageWh; } });
Object.defineProperty(exports, "simulatePowerBudget", { enumerable: true, get: function () { return power_budget_1.simulatePowerBudget; } });
Object.defineProperty(exports, "totalDrawW", { enumerable: true, get: function () { return power_budget_1.totalDrawW; } });
Object.defineProperty(exports, "turbinePowerW", { enumerable: true, get: function () { return power_budget_1.turbinePowerW; } });
