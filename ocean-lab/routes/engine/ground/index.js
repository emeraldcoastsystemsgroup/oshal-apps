"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — ground slice barrel: the soil thermal wave
 *                     |                             | model + the TEG resistance network + a closed-loop budget
 *                     |                             | for a subterranean thermal-harvesting node. The budget
 *                     |                             | engine itself is @/shared/energy; this slice supplies only
 *                     |                             | the physics that turns a depth pair into watts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tegPowerW = exports.simulateGroundBudget = exports.recommendGroundStorageWh = exports.matchedModuleResistanceKW = exports.longestHarvestGapHours = exports.groundHarvestW = exports.DEFAULT_GROUND_DURATION_HOURS = exports.soilTempC = exports.junctionDeltaTK = exports.dampingDepthM = exports.WET_CLAY_SOIL = exports.DRY_SAND_SOIL = exports.DIURNAL_PERIOD_S = exports.DEFAULT_SOIL = exports.DEFAULT_GEOTHERMAL_GRADIENT_KM = exports.ANNUAL_PERIOD_S = void 0;
var soil_thermal_1 = require("./services/soil-thermal");
Object.defineProperty(exports, "ANNUAL_PERIOD_S", { enumerable: true, get: function () { return soil_thermal_1.ANNUAL_PERIOD_S; } });
Object.defineProperty(exports, "DEFAULT_GEOTHERMAL_GRADIENT_KM", { enumerable: true, get: function () { return soil_thermal_1.DEFAULT_GEOTHERMAL_GRADIENT_KM; } });
Object.defineProperty(exports, "DEFAULT_SOIL", { enumerable: true, get: function () { return soil_thermal_1.DEFAULT_SOIL; } });
Object.defineProperty(exports, "DIURNAL_PERIOD_S", { enumerable: true, get: function () { return soil_thermal_1.DIURNAL_PERIOD_S; } });
Object.defineProperty(exports, "DRY_SAND_SOIL", { enumerable: true, get: function () { return soil_thermal_1.DRY_SAND_SOIL; } });
Object.defineProperty(exports, "WET_CLAY_SOIL", { enumerable: true, get: function () { return soil_thermal_1.WET_CLAY_SOIL; } });
Object.defineProperty(exports, "dampingDepthM", { enumerable: true, get: function () { return soil_thermal_1.dampingDepthM; } });
Object.defineProperty(exports, "junctionDeltaTK", { enumerable: true, get: function () { return soil_thermal_1.junctionDeltaTK; } });
Object.defineProperty(exports, "soilTempC", { enumerable: true, get: function () { return soil_thermal_1.soilTempC; } });
var teg_harvester_1 = require("./services/teg-harvester");
Object.defineProperty(exports, "DEFAULT_GROUND_DURATION_HOURS", { enumerable: true, get: function () { return teg_harvester_1.DEFAULT_GROUND_DURATION_HOURS; } });
Object.defineProperty(exports, "groundHarvestW", { enumerable: true, get: function () { return teg_harvester_1.groundHarvestW; } });
Object.defineProperty(exports, "longestHarvestGapHours", { enumerable: true, get: function () { return teg_harvester_1.longestHarvestGapHours; } });
Object.defineProperty(exports, "matchedModuleResistanceKW", { enumerable: true, get: function () { return teg_harvester_1.matchedModuleResistanceKW; } });
Object.defineProperty(exports, "recommendGroundStorageWh", { enumerable: true, get: function () { return teg_harvester_1.recommendGroundStorageWh; } });
Object.defineProperty(exports, "simulateGroundBudget", { enumerable: true, get: function () { return teg_harvester_1.simulateGroundBudget; } });
Object.defineProperty(exports, "tegPowerW", { enumerable: true, get: function () { return teg_harvester_1.tegPowerW; } });
