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
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 D8 (S5a): `turbinePowerW` takes the medium's density from
 *                     |                             | its caller instead of multiplying by the module constant at the
 *                     |                             | point of use, and the unit config carries it. The constant stays
 *                     |                             | declared here as the DEFAULT (the seawater row), pinned by the
 *                     |                             | store's cross-package drift guard (scripts/check-medium-
 *                     |                             | properties.mjs) against embodied's committed medium row and this
 *                     |                             | package's second declaration in rotor-presets.ts. A zero or
 *                     |                             | negative density is refused, never a quiet zero harvest.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalDrawW = exports.DEFAULT_DURATION_HOURS = exports.BETZ_LIMIT = exports.SEAWATER_DENSITY_KGM3 = void 0;
exports.turbinePowerW = turbinePowerW;
exports.simulatePowerBudget = simulatePowerBudget;
exports.recommendStorageWh = recommendStorageWh;
const energy_1 = require("../../energy");
const tidal_current_1 = require("./tidal-current");
/**
 * @description Density of seawater at typical coastal temperature/salinity, kg/m³ — the DEFAULT
 * medium of the marine budget, not an assumption baked into the cube law. The same value is
 * declared in rotor-design/services/rotor-presets.ts and in embodied's committed medium row;
 * scripts/check-medium-properties.mjs fails the store when any of the three disagree (ADR-160 S5).
 */
exports.SEAWATER_DENSITY_KGM3 = 1025;
/** @description Betz limit — the theoretical ceiling on Cp for any open-flow rotor, 16/27. */
exports.BETZ_LIMIT = 16 / 27;
var energy_2 = require("../../energy");
Object.defineProperty(exports, "DEFAULT_DURATION_HOURS", { enumerable: true, get: function () { return energy_2.DEFAULT_DURATION_HOURS; } });
Object.defineProperty(exports, "totalDrawW", { enumerable: true, get: function () { return energy_2.totalDrawW; } });
/**
 * @description Electrical power a rotor extracts from a flow: P = ½·ρ·A·|v|³·Cp·η, zero below
 * cut-in, clamped at rated. The cube is why cut-in dominates the design — halving the flow
 * speed cuts power by 8×, so a site spends most of its time producing almost nothing. The
 * density ρ is the CALLER's medium (ADR-160 D8): this function no longer assumes seawater at the
 * point of use; it defaults to the seawater row when no medium is named.
 * @param turbine - Harvester model.
 * @param speedMs - Signed flow speed, m/s (sign ignored — a rotor harvests either direction).
 * @param densityKgM3 - Density of the medium the rotor harvests from, kg/m³. Default: the
 * seawater row, {@link SEAWATER_DENSITY_KGM3}.
 * @returns Electrical power, W.
 * @throws RangeError when the density is not a finite positive number — a medium with no mass
 * harvests nothing, and that is a refusal to state, not a zero to return.
 */
function turbinePowerW(turbine, speedMs, densityKgM3 = exports.SEAWATER_DENSITY_KGM3) {
    if (!Number.isFinite(densityKgM3) || densityKgM3 <= 0) {
        throw new RangeError(`turbinePowerW: densityKgM3 must be a finite positive number (received ${densityKgM3})`);
    }
    const v = Math.abs(speedMs);
    if (v < turbine.cutInSpeedMs)
        return 0;
    const raw = 0.5 * densityKgM3 * turbine.sweptAreaM2 * v ** 3 * turbine.powerCoefficient * turbine.drivetrainEfficiency;
    return Math.min(raw, turbine.ratedPowerW);
}
/**
 * @description Collapse a marine design onto the generic energy design the shared core consumes.
 * This adapter IS the marine slice's entire contribution to the budget: the site harmonics and
 * the rotor's cube law compose into one `(t) => watts` closure, and everything downstream — the
 * store model, the verdict, the search — is domain-free. The medium's density is read from the
 * config ONCE here and handed to the cube law, so the budget integrates in the fluid the caller
 * named (the seawater row when it named none).
 * @param config - Site, harvester, loads and store, and optionally the medium's density.
 * @returns The same design expressed as a harvest sampler plus loads and store.
 */
function toEnergyDesign(config) {
    const densityKgM3 = config.densityKgM3 ?? exports.SEAWATER_DENSITY_KGM3;
    return {
        label: config.site.name,
        harvestAt: (t) => turbinePowerW(config.turbine, (0, tidal_current_1.currentSpeedAt)(config.site, t), densityKgM3),
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
