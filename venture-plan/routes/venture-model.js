"use strict";
/**
 * Venture engine — the pure composition root.
 *
 * ONE ENTRY POINT. `buildVentureModel` is the only function that assembles a
 * complete venture, and every document, gate, sensitivity sweep and inversion in
 * the package goes through it. Nothing else may recompute a figure its own way:
 * two paths to the same number is how a plan starts disagreeing with itself.
 *
 * THE DEPENDENCY ORDER IS ACYCLIC AND DELIBERATE:
 *
 *   BOM (at the run quantity) -> landed cost -> channel prices -> demand at those
 *   prices -> units sold -> schedule -> headcount -> financials -> break-even ->
 *   figures -> traceability -> posture
 *
 * Demand responds to price and price is set from cost, so the cycle is broken by
 * making the RUN QUANTITY an input rather than a result. Units SOLD is then
 * `min(demand, units built)` — a plan cannot sell what it did not make, and
 * demand above the run is a stockout, not revenue.
 *
 * PURITY IS A CONTRACT, NOT A STYLE PREFERENCE. No I/O, no `Date.now()`, no
 * `Math.random()`; the modelling date is a parameter. That is what makes the same
 * input produce byte-identical output, which is what makes the sensitivity sweep
 * and the break-even search meaningful — they rebuild this function thousands of
 * times and every difference in the result must come from the input they changed.
 *
 * `buildVentureModel` also never mutates its input; `rebuildWithAssumption`
 * structurally clones before it writes.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the acyclic composition of every engine, the assumption-binding mechanism that makes a ledger edit actually move the model, the fail-closed canPublish rule (any blocking issue or any unsourced figure), and the two rebuild helpers the sweep and the inversions drive.
 *
 * @module venture-model
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVentureCore = buildVentureCore;
exports.buildVentureModel = buildVentureModel;
exports.setAtPath = setAtPath;
exports.rebuildWithAssumption = rebuildWithAssumption;
exports.withAssumption = withAssumption;
exports.withLedger = withLedger;
exports.withRunQuantity = withRunQuantity;
exports.rebuildWithVolume = rebuildWithVolume;
exports.contributionPerUnitMicros = contributionPerUnitMicros;
exports.fixedCostsMicros = fixedCostsMicros;
const venture_assumptions_1 = require("./venture-assumptions");
const venture_bom_1 = require("./venture-bom");
const venture_channels_1 = require("./venture-channels");
const venture_demand_1 = require("./venture-demand");
const venture_figures_1 = require("./venture-figures");
const venture_financials_1 = require("./venture-financials");
const venture_headcount_1 = require("./venture-headcount");
const venture_issues_1 = require("./venture-issues");
const venture_landed_1 = require("./venture-landed");
const venture_schedule_1 = require("./venture-schedule");
const venture_primitives_1 = require("./venture-primitives");
/** Blended shelf price across the mix, used as the price demand responds to. */
function blendedShelfPrice(waterfalls, channels) {
    const shares = (0, venture_channels_1.normalisedShares)(channels);
    let total = 0;
    channels.forEach((c, i) => {
        const w = waterfalls.find((x) => x.channelId === c.id);
        if (w)
            total += w.shelfPriceMicros * (shares[i] ?? 0);
    });
    return (0, venture_primitives_1.roundHalfUp)(total);
}
/**
 * @description Build everything except the figure layer. Split out because the
 *   break-even search rebuilds this thousands of times and must not recurse back
 *   into the search that called it.
 * @param input - The model input.
 * @returns The core results and the issues every engine raised.
 */
function buildVentureCore(input) {
    const horizon = (0, venture_primitives_1.ymRange)(input.horizonStart, input.horizonMonths);
    const bom = (0, venture_bom_1.rollUpBom)(input.product.bom, input.runQtyUnits);
    const landed = (0, venture_landed_1.computeLandedCost)({
        ...input.landed, units: bom.runQtyUnits, exWorksUnitMicros: bom.recurringUnitMicros ?? 0,
    });
    const landedUnit = landed.buyerUnitMicros ?? 0;
    const waterfalls = input.channels.map((channel) => (0, venture_channels_1.forwardWaterfall)({
        channel, landedUnitMicros: landedUnit, pricing: input.pricing, onDate: input.onDate,
    }));
    const demand = (0, venture_demand_1.computeDemand)({
        scenarios: input.demand.scenarios, selected: input.demand.selected,
        priceMicros: blendedShelfPrice(waterfalls, input.channels), elasticity: input.demand.elasticity,
    });
    const unitsSold = Math.min(demand.units, bom.runQtyUnits);
    const schedule = (0, venture_schedule_1.buildCashSchedule)({
        bom, suppliers: (0, venture_bom_1.collectSuppliers)(input.product.bom), landed, season: input.season,
        toolingMonth: input.timing.toolingMonth, poMonth: input.timing.poMonth,
        transitWeeks: input.timing.transitWeeks, receivingWeeks: input.timing.receivingWeeks,
        channels: input.channels, waterfalls, unitsSold, unitsBuilt: bom.runQtyUnits, horizon,
    });
    const headcount = (0, venture_headcount_1.computeHeadcount)(input.roles, horizon);
    const financials = (0, venture_financials_1.computeFinancials)({
        horizon, events: schedule.events, unitsSoldByMonth: schedule.unitsSoldByMonth,
        unitsOnHandByMonth: schedule.unitsOnHandByMonth, landedUnitMicros: landedUnit,
        waterfalls, channels: input.channels, headcount,
        fixedOpexByMonth: input.fixedOpexByMonth, oneTimeToolingMicros: bom.oneTimeMicros,
        openingCashMicros: input.openingCashMicros,
        inventoryChargeByMonth: schedule.disposition.chargeByMonth,
        unitsBuilt: bom.runQtyUnits, landedBuyerTotalMicros: landed.buyerTotalMicros,
        purchaseRoundingMicros: bom.roundingResidualMicros,
    });
    return {
        input, horizon, bom, landed, waterfalls, demand, unitsSold, schedule, headcount, financials,
        issues: (0, venture_issues_1.mergeIssues)(bom.issues, landed.issues, ...waterfalls.map((w) => w.issues), demand.issues, schedule.issues, headcount.issues, financials.issues),
    };
}
/**
 * @description Build a complete venture model. PURE: same input, same bytes out.
 * @param input - The model input.
 * @returns Every engine result, the figure registry, the traceability report, the
 *   derived posture, and the fail-closed publish verdict.
 */
function buildVentureModel(input) {
    const core = buildVentureCore(input);
    const contribution = contributionPerUnitMicros(core);
    const breakEven = (0, venture_financials_1.computeBreakEven)((units) => buildVentureCore(withRunQuantity(input, units)).financials, { lowUnits: 0, highUnits: Math.max(1, core.bom.runQtyUnits) }, contribution, core.financials.totals.fixedCostsMicros, core.horizon.length);
    const figures = (0, venture_figures_1.buildFigureRegistry)({
        bom: core.bom, landed: core.landed, waterfalls: core.waterfalls, demand: core.demand,
        schedule: core.schedule, headcount: core.headcount, financials: core.financials,
        breakEven, ledger: input.ledger, seasonRefs: input.season.assumptionRefs,
    });
    const traceability = (0, venture_figures_1.computeTraceability)(figures, input.ledger);
    const issues = (0, venture_issues_1.mergeIssues)(core.issues, breakEven.issues, unsourcedIssues(input.ledger, figures, traceability));
    return {
        ...core, breakEven, figures, traceability, issues,
        posture: (0, venture_figures_1.derivePosture)(input.ledger),
        canPublish: !(0, venture_issues_1.hasBlocker)(issues) && traceability.unsourcedFigureIds.length === 0,
    };
}
/**
 * Turn unsourced figures into blocking issues so the reason is on the record. Two
 * shapes reach here and they are reported separately: a figure resting on an id
 * that is not in the ledger, and a computed figure resting on NOTHING — the second
 * of which used to be scored as clean and is the more dangerous of the two, because
 * it looks like a number somebody stood behind.
 */
function unsourcedIssues(ledger, figures, t) {
    if (!t.unsourcedFigureIds.length)
        return [];
    const orphans = t.unsourcedFigureIds.filter((id) => figures[id].assumptionRefs.length === 0);
    const missing = (0, venture_assumptions_1.unresolvedRefs)(ledger, t.unsourcedFigureIds.flatMap((id) => figures[id].assumptionRefs));
    const parts = [];
    if (missing.length)
        parts.push(`${t.unsourcedFigureIds.length - orphans.length} figure(s) rest on input(s) that are not registered as assumptions at all: ${missing.join(', ')}`);
    if (orphans.length)
        parts.push(`${orphans.length} computed figure(s) name no input at all: ${orphans.join(', ')}`);
    return [(0, venture_issues_1.issue)('unsourced-estimate', 'block', 'model:traceability', `${parts.join('; ')}. A number with no source is not an estimate, it is a placeholder, and the model will not publish while one is load-bearing.`, {
            unsourcedFigures: t.unsourcedFigureIds.length, orphanFigures: orphans.length,
            missingAssumptionIds: missing.join(','),
        })];
}
/** Structural clone that keeps the ledger identity but copies everything writable. */
function cloneInput(input) {
    return {
        ...input,
        ledger: { byId: { ...input.ledger.byId }, order: [...input.ledger.order] },
        bindings: input.bindings.map((b) => ({ ...b })),
        product: { name: input.product.name, bom: cloneComponent(input.product.bom) },
        landed: { ...input.landed, freight: { ...input.landed.freight }, duty: { ...input.landed.duty } },
        channels: input.channels.map((c) => ({ ...c, economics: { ...c.economics } })),
        demand: {
            scenarios: input.demand.scenarios.map((s) => ({ ...s })),
            selected: input.demand.selected,
            elasticity: input.demand.elasticity ? { ...input.demand.elasticity, supportRatio: { ...input.demand.elasticity.supportRatio } } : null,
        },
        season: { ...input.season, weeklySellThrough: [...input.season.weeklySellThrough] },
        timing: { ...input.timing },
        roles: input.roles.map((r) => ({ ...r })),
        fixedOpexByMonth: { ...input.fixedOpexByMonth },
    };
}
/** Deep-copy a BOM subtree so a rebuild can write into it without touching the original. */
function cloneComponent(c) {
    return {
        ...c,
        priceBreaks: c.priceBreaks.map((b) => ({ ...b })),
        supplier: { ...c.supplier, assumptionRefs: [...c.supplier.assumptionRefs] },
        children: c.children ? c.children.map(cloneComponent) : undefined,
    };
}
/**
 * @description Set a numeric field by dotted path. Array indices are numeric
 *   segments. Throws on a path that does not resolve, because a binding that
 *   silently writes nowhere is a sweep that reports no sensitivity for an input
 *   that matters.
 * @param root - The object to write into (already cloned).
 * @param path - Dotted path, e.g. `landed.duty.htsDutyBps`.
 * @param value - The value to write.
 * @returns Nothing; `root` is mutated in place.
 */
function setAtPath(root, path, value) {
    const parts = path.split('.');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
        const next = node[parts[i]];
        if (next === null || typeof next !== 'object') {
            throw new RangeError(`assumption binding path "${path}" does not resolve at segment "${parts[i]}"`);
        }
        node = next;
    }
    const leaf = parts[parts.length - 1];
    if (!(leaf in node))
        throw new RangeError(`assumption binding path "${path}" has no field "${leaf}"`);
    node[leaf] = value;
}
/**
 * @description Rebuild the model with one assumption moved to a new value. The
 *   binding table is what makes this REAL: the ledger entry changes AND every
 *   model field bound to it changes, so the sweep measures the effect of the
 *   assumption rather than the effect of editing a record nothing reads.
 * @param input - The base model input.
 * @param assumptionId - The assumption to move.
 * @param value - The new value, in the assumption's own unit.
 * @returns A complete model built on the modified input.
 */
function rebuildWithAssumption(input, assumptionId, value) {
    return buildVentureModel(withAssumption(input, assumptionId, value));
}
/**
 * @description Apply one assumption value to a copy of the input, through both
 *   the ledger and every field bound to it.
 * @param input - The base model input.
 * @param assumptionId - The assumption to move.
 * @param value - The new value.
 * @returns A new input; the original is untouched.
 */
function withAssumption(input, assumptionId, value) {
    const next = cloneInput(input);
    const existing = next.ledger.byId[assumptionId];
    if (existing)
        next.ledger.byId[assumptionId] = { ...existing, value };
    for (const b of next.bindings)
        if (b.assumptionId === assumptionId)
            setAtPath(next, b.path, value);
    return next;
}
/**
 * @description Apply the whole ledger back onto the model input through the
 *   bindings — used when a caller edits several assumptions at once.
 * @param input - The base model input.
 * @param ledger - The edited ledger.
 * @returns A new input carrying every bound value; the original is untouched.
 */
function withLedger(input, ledger) {
    const next = cloneInput(input);
    next.ledger = { byId: { ...ledger.byId }, order: [...ledger.order] };
    for (const b of next.bindings) {
        const a = ledger.byId[b.assumptionId];
        if (a)
            setAtPath(next, b.path, a.value);
    }
    return next;
}
/**
 * @description Copy the input with a different production run quantity — the
 *   lever the break-even search and the minimum-viable-volume inversion pull.
 * @param input - The base model input.
 * @param runQtyUnits - The candidate run quantity.
 * @returns A new input; the original is untouched.
 */
function withRunQuantity(input, runQtyUnits) {
    return { ...input, runQtyUnits: Math.max(0, Math.trunc(runQtyUnits)) };
}
/**
 * @description Rebuild the whole model at a different run quantity.
 * @param input - The base model input.
 * @param runQtyUnits - The candidate run quantity.
 * @returns A complete model at that volume.
 */
function rebuildWithVolume(input, runQtyUnits) {
    return buildVentureModel(withRunQuantity(input, runQtyUnits));
}
/**
 * @description Blended contribution per unit at the model's own volume — the
 *   figure the inversions and the break-even cross-check both key off.
 * @param model - A built core or complete model.
 * @returns Micros per unit; zero when nothing is sold.
 */
function contributionPerUnitMicros(model) {
    if (model.unitsSold <= 0)
        return 0;
    return (0, venture_primitives_1.roundHalfUp)(model.financials.totals.contributionMicros / model.unitsSold);
}
/**
 * @description Total fixed cost over the horizon: headcount, fixed opex and
 *   tooling. Reported so a reader can see what the break-even volume is carrying.
 * @param model - A built core or complete model.
 * @returns Micros.
 */
function fixedCostsMicros(model) {
    const opex = Object.values(model.input.fixedOpexByMonth).reduce((a, b) => (0, venture_primitives_1.addMicros)(a, b), 0);
    return (0, venture_primitives_1.addMicros)(model.headcount.totalMicros, opex, model.bom.oneTimeMicros);
}
//# sourceMappingURL=venture-model.js.map