"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — barrel for the harvest-agnostic energy
 *                     |                             | budget extracted from the marine slice, so a second harvest
 *                     |                             | domain reuses the engine through one seam (HarvestSampler)
 *                     |                             | instead of forking its arithmetic.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.longestGapHours = exports.totalDrawW = exports.simulateEnergyBudget = exports.recommendStorageWh = exports.DEFAULT_DURATION_HOURS = void 0;
/**
 * @description Closed-loop energy budgeting for persistent, self-powered nodes: integrate a
 * harvest sampler against a load set and a store, and decide whether the design actually closes.
 * Domain-free by construction — the only environmental coupling is {@link HarvestSampler}.
 * Import from '.' — never deep-import sub-modules directly.
 *
 * @module shared/energy
 */
var energy_budget_1 = require("./energy-budget");
Object.defineProperty(exports, "DEFAULT_DURATION_HOURS", { enumerable: true, get: function () { return energy_budget_1.DEFAULT_DURATION_HOURS; } });
Object.defineProperty(exports, "recommendStorageWh", { enumerable: true, get: function () { return energy_budget_1.recommendStorageWh; } });
Object.defineProperty(exports, "simulateEnergyBudget", { enumerable: true, get: function () { return energy_budget_1.simulateEnergyBudget; } });
Object.defineProperty(exports, "totalDrawW", { enumerable: true, get: function () { return energy_budget_1.totalDrawW; } });
var harvest_gap_1 = require("./harvest-gap");
Object.defineProperty(exports, "longestGapHours", { enumerable: true, get: function () { return harvest_gap_1.longestGapHours; } });
