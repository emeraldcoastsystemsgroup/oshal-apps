"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — marine slice W1: closed-loop power
 *                     |                             | budget over a full spring/neap beat. "Perpetual" is
 *                     |                             | decided by SIMULATION (never browned out AND closed the
 *                     |                             | run no worse charged than it started), because a mean-
 *                     |                             | power budget passes designs that die at the first neap.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Rebuilt on the extracted @/shared/energy core. Everything
 *                     |                             | below is now either genuinely tidal (the cube law, seawater
 *                     |                             | density) or the adapter that turns a site + rotor into a
 *                     |                             | HarvestSampler. The integration arithmetic moved verbatim;
 *                     |                             | this slice's public signatures did not move at all.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Docstrings re-stated against the core's corrected closure
 *                     |                             | test: "ends at or above its starting charge" was a clause
 *                     |                             | the top clamp made unsatisfiable, and the store search no
 *                     |                             | longer silently starts every trial full.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalDrawW = exports.DEFAULT_DURATION_HOURS = exports.BETZ_LIMIT = exports.SEAWATER_DENSITY_KGM3 = void 0;
exports.turbinePowerW = turbinePowerW;
exports.simulatePowerBudget = simulatePowerBudget;
exports.recommendStorageWh = recommendStorageWh;
const energy_1 = require("../../energy");
const tidal_current_1 = require("./tidal-current");
/** @description Density of seawater at typical coastal temperature/salinity, kg/m³. */
exports.SEAWATER_DENSITY_KGM3 = 1025;
/** @description Betz limit — the theoretical ceiling on Cp for any open-flow rotor, 16/27. */
exports.BETZ_LIMIT = 16 / 27;
var energy_2 = require("../../energy");
Object.defineProperty(exports, "DEFAULT_DURATION_HOURS", { enumerable: true, get: function () { return energy_2.DEFAULT_DURATION_HOURS; } });
Object.defineProperty(exports, "totalDrawW", { enumerable: true, get: function () { return energy_2.totalDrawW; } });
/**
 * @description Electrical power a rotor extracts from a flow: P = ½·ρ·A·|v|³·Cp·η, zero below
 * cut-in, clamped at rated. The cube is why cut-in dominates the design — halving the flow
 * speed cuts power by 8×, so a site spends most of its time producing almost nothing.
 * @param turbine - Harvester model.
 * @param speedMs - Signed flow speed, m/s (sign ignored — a rotor harvests either direction).
 * @returns Electrical power, W.
 */
function turbinePowerW(turbine, speedMs) {
    const v = Math.abs(speedMs);
    if (v < turbine.cutInSpeedMs)
        return 0;
    const raw = 0.5 * exports.SEAWATER_DENSITY_KGM3 * turbine.sweptAreaM2 * v ** 3 * turbine.powerCoefficient * turbine.drivetrainEfficiency;
    return Math.min(raw, turbine.ratedPowerW);
}
/**
 * @description Collapse a marine design onto the generic energy design the shared core consumes.
 * This adapter IS the marine slice's entire contribution to the budget: the site harmonics and
 * the rotor's cube law compose into one `(t) => watts` closure, and everything downstream — the
 * store model, the verdict, the search — is domain-free.
 * @param config - Site, harvester, loads and store.
 * @returns The same design expressed as a harvest sampler plus loads and store.
 */
function toEnergyDesign(config) {
    return {
        label: config.site.name,
        harvestAt: (t) => turbinePowerW(config.turbine, (0, tidal_current_1.currentSpeedAt)(config.site, t)),
        loads: config.loads,
        storage: config.storage,
    };
}
/**
 * @description Simulate a persistent marine node's energy over a full spring/neap beat and
 * return whether the design actually closes. This is the honest form of "it runs forever":
 * the run must never brown out AND must end in net energy surplus after charging losses, so a
 * design that merely drains slowly is correctly rejected. Delegates the integration to the shared core and
 * re-attaches the two marine facts the core cannot know: the site name and the flow speed
 * behind each retained sample.
 * @param config - Site, harvester, loads and store.
 * @param options - Span, step and sampling.
 * @returns Verdict plus the retained timeseries.
 */
function simulatePowerBudget(config, options = {}) {
    const core = (0, energy_1.simulateEnergyBudget)(toEnergyDesign(config), options);
    return {
        verdict: { ...core.verdict, siteName: config.site.name },
        samples: core.samples.map((s) => ({ ...s, currentMs: (0, tidal_current_1.currentSpeedAt)(config.site, s.tHours * 3600) })),
    };
}
/**
 * @description Smallest store, in Wh, that makes a design perpetual — the answer to "how big
 * does the battery have to be". Binary search over capacity, each trial run from the design's OWN
 * starting state of charge. Returns null when the harvest itself is short once charging losses are
 * paid (`netEnergyWh` below zero, which no store size can move), or when the design still browns
 * out at `maxCapacityWh`.
 * @param config - Unit design; its `storage.capacityWh` is overridden per trial.
 * @param options - Passed through to the simulation. Use ≥ 720 h.
 * @param maxCapacityWh - Upper bound for the search, Wh. Default 100 kWh. Stated explicitly here
 * so a reader of the marine API still sees the bound the search actually runs with.
 * @returns Minimum viable capacity in Wh, or null if the design can never close.
 */
function recommendStorageWh(config, options = {}, maxCapacityWh = 100_000) {
    return (0, energy_1.recommendStorageWh)(toEnergyDesign(config), options, maxCapacityWh);
}
