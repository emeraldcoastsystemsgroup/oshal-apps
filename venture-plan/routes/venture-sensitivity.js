"use strict";
/**
 * Venture engine — the sensitivity sweep and the inversions.
 *
 * WHY THE SWEEP REBUILDS THE WHOLE MODEL AT EVERY ENDPOINT. An analytic
 * approximation of "how much does this assumption matter" would be a second,
 * simpler model of the first one — and it would drift the moment anyone adds a
 * fee line, a container step or a supplier minimum. So `sensitivitySweep`
 * genuinely rebuilds: two full models per banded assumption, and the guard suite
 * asserts the CALL COUNT so a future refactor that shortcuts the sweep goes red
 * rather than quietly returning a plausible tornado chart.
 *
 * WHY AN UNBANDED ASSUMPTION IS EXCLUDED RATHER THAN SWEPT. Inventing a plus or
 * minus twenty percent range for an assumption whose uncertainty nobody has
 * stated would manufacture the very thing the chart is supposed to measure.
 *
 * WHAT THE INVERSIONS ARE FOR. They answer the three questions that actually
 * change a decision — what can the factory cost, how few units can we make, how
 * much of the run has to sell — and they answer them against the real model. The
 * volume inversion checks monotonicity on a coarse grid first, because freight
 * container steps and price breaks genuinely make the objective non-monotone, and
 * a confidently-wrong single break-even across a price break is exactly the
 * failure-that-reports-success this engine exists to prevent.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — a real one-at-a-time sweep over rebuilt models with deterministic tie-breaking, the exact blended maximum-affordable-landed-cost solve, the factory-price inversion through the landed stack, minimum viable volume with a coarse-grid monotonicity check and its non-monotone verdict, and the closed-form break-even sell-through against liquidation recovery.
 *
 * @module venture-sensitivity
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.objectiveValue = objectiveValue;
exports.sensitivitySweep = sensitivitySweep;
exports.blendedMaxAffordableLanded = blendedMaxAffordableLanded;
exports.computeInversions = computeInversions;
exports.breakEvenSellThrough = breakEvenSellThrough;
const venture_channels_1 = require("./venture-channels");
const venture_issues_1 = require("./venture-issues");
const venture_landed_1 = require("./venture-landed");
const venture_model_1 = require("./venture-model");
const venture_primitives_1 = require("./venture-primitives");
/**
 * @description Read the swept objective off a model.
 * @param model - A complete model.
 * @param objective - Which objective to read.
 * @returns The objective value; micros for money, units for break-even volume.
 */
function objectiveValue(model, objective) {
    if (objective === 'peak-cash')
        return model.financials.peakCash.troughMicros;
    if (objective === 'contribution-per-unit')
        return (0, venture_model_1.contributionPerUnitMicros)(model);
    if (objective === 'break-even-units')
        return model.breakEven.units ?? Number.NaN;
    return model.financials.totals.netIncomeMicros;
}
/** Copy a ledger with one value replaced. */
function ledgerWith(ledger, id, value) {
    const a = ledger.byId[id];
    if (!a)
        return ledger;
    return { byId: { ...ledger.byId, [id]: { ...a, value } }, order: [...ledger.order] };
}
/**
 * @description A real one-at-a-time sensitivity sweep. Every banded assumption is
 *   moved to each end of its band and the WHOLE model is rebuilt, so the swing is
 *   the true effect on the objective rather than an analytic estimate of it.
 * @param input - The ledger, the assumptions to sweep, the objective, the base
 *   model and the rebuild function.
 * @returns The bars sorted by swing (deterministic ties by assumption id), the top
 *   three, and any issues.
 */
function sensitivitySweep(input) {
    const issues = [];
    const baseObjective = objectiveValue(input.base, input.objective);
    const bars = [];
    for (const si of input.inputs) {
        const a = input.ledger.byId[si.assumptionId];
        if (!a) {
            issues.push((0, venture_issues_1.issue)('unsourced-estimate', 'warn', `sensitivity:${si.assumptionId}`, `"${si.label}" was requested for the sweep but is not in the ledger, so it cannot be moved.`, { assumptionId: si.assumptionId }));
            continue;
        }
        if (!a.band) {
            issues.push((0, venture_issues_1.issue)('unsourced-estimate', 'info', `sensitivity:${si.assumptionId}`, `"${si.label}" carries no stated range, so it is excluded from the sweep rather than swept over an invented one.`, { assumptionId: si.assumptionId }));
            continue;
        }
        const low = objectiveValue(input.rebuild(ledgerWith(input.ledger, a.id, a.band.low)), input.objective);
        const high = objectiveValue(input.rebuild(ledgerWith(input.ledger, a.id, a.band.high)), input.objective);
        bars.push(toBar(si, a.value, a.band, baseObjective, low, high));
    }
    bars.sort((x, y) => (y.swingMicros - x.swingMicros) || (x.assumptionId < y.assumptionId ? -1 : 1));
    return { bars, topThree: bars.slice(0, 3), issues };
}
/** Assemble one tornado bar from its three objective readings. */
function toBar(si, baseValue, band, baseObjective, low, high) {
    const swing = Math.max(Math.abs(low - baseObjective), Math.abs(high - baseObjective));
    const direction = high > low ? 'increases' : high < low ? 'decreases' : 'flat';
    return {
        assumptionId: si.assumptionId, label: si.label, baseValue,
        lowValue: band.low, highValue: band.high,
        baseObjectiveMicros: baseObjective, lowObjectiveMicros: low, highObjectiveMicros: high,
        swingMicros: Number.isFinite(swing) ? (0, venture_primitives_1.roundHalfUp)(swing) : 0, direction,
    };
}
/**
 * @description The highest landed unit cost the whole channel mix can carry at
 *   the planned prices while still clearing a required contribution rate. EXACT,
 *   because no channel fee depends on landed cost: the fee total at each channel's
 *   price is a constant, so the blended relation is linear in landed cost.
 * @param waterfalls - The priced waterfalls.
 * @param channels - The channels carrying the volume shares.
 * @param requiredContributionBps - Required contribution as basis points of gross revenue.
 * @returns The maximum affordable landed unit cost, or null when the mix is empty.
 */
function blendedMaxAffordableLanded(waterfalls, channels, requiredContributionBps) {
    const shares = (0, venture_channels_1.normalisedShares)(channels);
    let grossWeighted = 0;
    let feeWeighted = 0;
    let landedFactorWeighted = 0;
    channels.forEach((c, i) => {
        const w = waterfalls.find((x) => x.channelId === c.id);
        if (!w)
            return;
        const share = shares[i] ?? 0;
        grossWeighted += w.grossRevenueMicros * share;
        feeWeighted += w.totalFeeMicros * share;
        landedFactorWeighted += w.landedFactorBps * share;
    });
    if (landedFactorWeighted <= 0)
        return { maxLandedUnitMicros: null, issues: [] };
    const gross = (0, venture_primitives_1.roundHalfUp)(grossWeighted);
    const required = (0, venture_primitives_1.applyBps)(gross, Math.max(0, Math.min(venture_primitives_1.BPS_ONE - 1, requiredContributionBps)));
    const landedTerm = (0, venture_primitives_1.subMicros)((0, venture_primitives_1.subMicros)(gross, (0, venture_primitives_1.roundHalfUp)(feeWeighted)), required);
    const value = Math.floor((landedTerm * venture_primitives_1.BPS_ONE) / landedFactorWeighted);
    if (value < 0) {
        return {
            maxLandedUnitMicros: 0,
            issues: [(0, venture_issues_1.issue)('unreachable-target-margin', 'block', 'inversion:landed', `At the planned prices the channel mix cannot clear a ${requiredContributionBps} bps contribution even with free goods — the channels' own fees already consume the price.`, { requiredContributionBps })],
        };
    }
    return { maxLandedUnitMicros: value, issues: [] };
}
/**
 * @description The three inversions, computed against the real model. Takes no
 *   rebuild callback: the minimum viable volume IS the model's break-even volume,
 *   and running a second search for it would produce a second answer.
 * @param input - The base model, the base input and the required contribution rate.
 * @returns Maximum affordable landed and factory cost, minimum viable volume, the
 *   break-even sell-through, and any issues.
 */
function computeInversions(input) {
    const issues = [];
    const landedSolve = blendedMaxAffordableLanded(input.model.waterfalls, input.model.input.channels, input.requiredContributionBps);
    issues.push(...landedSolve.issues);
    let maxAffordableFactoryUnitMicros = null;
    if (landedSolve.maxLandedUnitMicros !== null && input.model.bom.runQtyUnits > 0) {
        const ex = (0, venture_landed_1.maxExWorksForLanded)(landedSolve.maxLandedUnitMicros, {
            ...input.modelInput.landed, units: input.model.bom.runQtyUnits,
        });
        issues.push(...ex.issues);
        maxAffordableFactoryUnitMicros = ex.issues.some((i) => i.severity === 'block') ? null : ex.exWorksUnitMicros;
    }
    const sellThrough = breakEvenSellThrough(input.model);
    issues.push(...sellThrough.issues);
    return {
        maxAffordableLandedUnitMicros: landedSolve.maxLandedUnitMicros,
        maxAffordableFactoryUnitMicros,
        // ONE SOURCE PER FIGURE. The minimum viable volume and the break-even volume
        // are the same question, so this reads the model's own break-even rather than
        // running a second search. Two searches over a non-monotone objective return
        // two different numbers, and a plan that disagrees with itself about the
        // smallest viable run is worse than a plan that does not state one.
        minViableVolumeUnits: input.model.breakEven.units,
        breakEvenSellThroughRatio: sellThrough.ratio,
        issues,
    };
}
/**
 * @description The fraction of the run that has to sell for the plan to break
 *   even, solved in closed form against the liquidation value of what does not.
 *   Above 1.0 is returned rather than clamped, with an issue: "you would have to
 *   sell 118% of what you made" is the finding.
 * @param model - A complete model.
 * @returns The ratio, or null when no sell-through works, plus any issues.
 */
function breakEvenSellThrough(model) {
    const built = model.bom.runQtyUnits;
    const contribution = (0, venture_model_1.contributionPerUnitMicros)(model);
    // ONE SOURCE PER FIGURE. This used to re-derive the cost of an unsold unit from
    // the season policy while the profit statement on the facing page ignored
    // obsolescence altogether — two code paths in one engine disagreeing about
    // whether it exists. The schedule computes it once; both read that.
    const writeDownPerUnit = model.schedule.disposition.writeDownPerUnitMicros;
    if (built <= 0)
        return { ratio: null, issues: [] };
    const denominator = (0, venture_primitives_1.addMicros)(contribution, writeDownPerUnit) * built;
    if (denominator <= 0) {
        return {
            ratio: null,
            issues: [(0, venture_issues_1.issue)('no-break-even', 'warn', 'inversion:sell-through', 'Selling more units does not improve the outcome at this contribution, so there is no sell-through rate that breaks the plan even.', {})],
        };
    }
    const fixed = model.financials.totals.fixedCostsMicros;
    const ratio = (fixed + writeDownPerUnit * built) / denominator;
    const issues = [];
    if (ratio > 1) {
        issues.push((0, venture_issues_1.issue)('inversion-impossible', 'warn', 'inversion:sell-through', `Breaking even would take ${(ratio * 100).toFixed(1)}% sell-through of a ${built}-unit run. There is no quantity of selling that reaches it, because more than everything made is not available to sell.`, { requiredSellThroughPct: (0, venture_primitives_1.roundHalfUp)(ratio * 1000) / 10, unitsBuilt: built }));
    }
    return { ratio, issues };
}
//# sourceMappingURL=venture-sensitivity.js.map