"use strict";
/**
 * Venture engine — the figure registry and the traceability report.
 *
 * THE FEATURE THAT MAKES THE WHOLE APP TRUSTWORTHY IS HERE. Every printable
 * number is registered as a `Figure` carrying an id, a formula, the assumption
 * ids it rests on, and the WEAKEST confidence in that chain. So for any figure a
 * document prints, the app can answer "where did this come from" mechanically —
 * by walking the graph, not by a person remembering to write a footnote.
 *
 * TWO CONSEQUENCES THAT ARE DELIBERATE:
 *
 *   1. `renderFigureTokens` THROWS on an unknown figure id. A document that names
 *      a number the engine did not compute fails loudly instead of printing an
 *      empty string, because a silently blank figure in a funding document is
 *      indistinguishable from a zero.
 *
 *   2. A figure whose chain reaches an assumption that is not in the ledger at all
 *      is UNSOURCED, and an unsourced figure turns `canPublish` false upstream.
 *      Not "flagged". Not "footnoted". The plan does not publish.
 *
 * `posture` and every count are DERIVED, never hand-typed — the anti-drift rule
 * that keeps a document honest across regenerations.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the Figure record with its formula and provenance chain, registry construction across every engine result, the traceability report with soft and unsourced figure lists, the derived posture, and token rendering that throws on an unknown figure id.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | Provenance no longer fails OPEN on an empty chain. Fourteen computed figures — revenue, net income, the cash trough, the funding requirement and break-even among them — carried no assumption references at all, and both classification branches test the references, so an empty array fell through both and was scored exactly like a fully-quoted number. Aggregate figures now INHERIT the references of everything they were built from, and a computed figure that still has none is unprovenanced rather than clean.
 *
 * @module venture-figures
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingFigureError = void 0;
exports.referenceGroups = referenceGroups;
exports.buildFigureRegistry = buildFigureRegistry;
exports.computeTraceability = computeTraceability;
exports.derivePosture = derivePosture;
exports.renderFigureTokens = renderFigureTokens;
exports.formatFigure = formatFigure;
exports.referencedFigureIds = referencedFigureIds;
const venture_assumptions_1 = require("./venture-assumptions");
const venture_primitives_1 = require("./venture-primitives");
/** Thrown when a document names a figure the engine never computed. */
class MissingFigureError extends Error {
    figureId;
    /**
     * @description Build the missing-figure error.
     * @param figureId - The unknown figure id the template asked for.
     */
    constructor(figureId) {
        super(`document references figure "${figureId}", which the engine did not compute`);
        this.figureId = figureId;
        this.name = 'MissingFigureError';
    }
}
exports.MissingFigureError = MissingFigureError;
/** Distinct, sorted union of several reference lists. */
function union(...lists) {
    const set = new Set();
    for (const l of lists)
        if (l)
            for (const r of l)
                if (r)
                    set.add(r);
    return [...set].sort();
}
/**
 * @description The reference sets an aggregate figure inherits from. A figure that
 *   is the sum of a whole model rests on every input that model rests on, and
 *   saying so is what lets a reader see that the funding number depends on a
 *   guessed sell-through rather than presenting it as if it depended on nothing.
 * @param s - The engine results.
 * @returns Named reference groups plus the union of all of them.
 */
function referenceGroups(s) {
    const bom = union(s.bom.assumptionRefs);
    const landed = union(s.bom.assumptionRefs, s.landed.assumptionRefs);
    const channel = union(...s.waterfalls.map((w) => w.assumptionRefs));
    const demand = union(s.demand.assumptionRefs);
    const season = union(s.seasonRefs);
    const org = union(s.headcount.assumptionRefs);
    return { bom, landed, channel, demand, season, org, all: union(landed, channel, demand, season, org) };
}
/** Build one figure, resolving its confidence from the ledger. */
function fig(ledger, id, label, value, unit, kind, formula, refs) {
    if (value === null || !Number.isFinite(value))
        return null;
    const known = refs.map((r) => ledger.byId[r]?.confidence).filter((c) => Boolean(c));
    return { id, label, value, unit, kind, formula, assumptionRefs: [...refs].sort(), confidence: (0, venture_assumptions_1.weakestConfidence)(known) };
}
/** BOM and landed-cost figures. */
function costFigures(s) {
    const L = s.ledger;
    const bomRefs = s.bom.assumptionRefs;
    const landedRefs = [...new Set([...bomRefs, ...s.landed.assumptionRefs])].sort();
    return [
        fig(L, 'bom.runRecurringMicros', 'Recurring BOM spend for the run', s.bom.runRecurringMicros, 'micros', 'computed', 'sum of extended line costs', bomRefs),
        fig(L, 'bom.oneTimeMicros', 'Tooling and NRE for the run', s.bom.oneTimeMicros, 'micros', 'computed', 'sum of tooling x tools required', bomRefs),
        fig(L, 'bom.recurringUnitMicros', 'BOM cost per unit', s.bom.recurringUnitMicros, 'micros', 'computed', 'runRecurringMicros / runQtyUnits', bomRefs),
        fig(L, 'bom.amortizedUnitMicros', 'Tooling amortised per unit', s.bom.amortizedUnitMicros, 'micros', 'computed', 'oneTimeMicros / runQtyUnits', bomRefs),
        fig(L, 'bom.fullyLoadedUnitMicros', 'Fully loaded factory cost per unit', s.bom.fullyLoadedUnitMicros, 'micros', 'computed', 'recurringUnitMicros + amortizedUnitMicros', bomRefs),
        fig(L, 'bom.moqConstrainedRunUnits', 'Smallest run no supplier minimum inflates', s.bom.moqConstrainedRunUnits, 'units', 'computed', 'max over components of ceil(moq / effectiveQtyPerUnit)', bomRefs),
        fig(L, 'bom.lineCount', 'BOM lines', s.bom.lines.length, 'count', 'count', 'length of the flattened BOM', []),
        fig(L, 'landed.buyerUnitMicros', 'Landed cost per unit', s.landed.buyerUnitMicros, 'micros', 'computed', 'buyerTotalMicros / units', landedRefs),
        fig(L, 'landed.buyerTotalMicros', 'Landed cost of the run', s.landed.buyerTotalMicros, 'micros', 'computed', 'sum of buyer-paid legs', landedRefs),
        fig(L, 'landed.customsValueMicros', 'Declared customs value', s.landed.customsValueMicros, 'micros', 'computed', 'goods plus the legs the declared basis includes', landedRefs),
        fig(L, 'landed.containers', 'Containers shipped', s.landed.containers, 'count', 'computed', 'ceil(units / unitsPerContainer)', s.landed.assumptionRefs),
        fig(L, 'landed.containerFillRatio', 'Container fill', s.landed.containerFillRatio, 'ratio', 'computed', 'units / (containers x unitsPerContainer)', s.landed.assumptionRefs),
        fig(L, 'landed.effectiveDutyBps', 'Effective duty and government fee rate', s.landed.effectiveDutyBps, 'bps', 'computed', 'duty-like charges / customs value', s.landed.assumptionRefs),
    ];
}
/** Per-channel and demand figures. */
function marketFigures(s) {
    const L = s.ledger;
    const out = [
        fig(L, 'demand.units', 'Units the selected scenario supports', s.demand.units, 'units', 'computed', 'baseline x (price / reference)^elasticity', s.demand.assumptionRefs),
        fig(L, 'demand.priceMicros', 'Blended shelf price', s.demand.priceMicros, 'micros', 'computed', 'volume-weighted shelf price across the mix', s.demand.assumptionRefs),
    ];
    for (const w of s.waterfalls) {
        const refs = w.assumptionRefs;
        out.push(fig(L, `channel.${w.channelId}.shelfPriceMicros`, `${w.channelId}: shelf price`, w.shelfPriceMicros, 'micros', 'computed', 'as priced', refs), fig(L, `channel.${w.channelId}.wholesaleMicros`, `${w.channelId}: wholesale price`, w.wholesaleMicros, 'micros', 'computed', 'shelf x (1 - retailer margin) x (1 - distributor margin)', refs), fig(L, `channel.${w.channelId}.netWholesaleMicros`, `${w.channelId}: net wholesale after allowances`, w.netWholesaleMicros, 'micros', 'computed', 'wholesale - every allowance', refs), fig(L, `channel.${w.channelId}.totalFeeMicros`, `${w.channelId}: channel deductions per unit`, w.totalFeeMicros, 'micros', 'computed', 'sum of the fee stack at this price', refs), fig(L, `channel.${w.channelId}.contributionPerUnitMicros`, `${w.channelId}: contribution per unit`, w.contributionPerUnitMicros, 'micros', 'computed', 'gross revenue - fees - landed cost', refs), fig(L, `channel.${w.channelId}.contributionBps`, `${w.channelId}: contribution rate`, w.contributionBps, 'bps', 'computed', 'contribution / gross revenue', refs));
    }
    return out;
}
/** Schedule, headcount, financial and break-even figures. */
function planFigures(s) {
    const L = s.ledger;
    const g = referenceGroups(s);
    // A total rests on everything that fed it. These unions are what make the
    // provenance chain of a headline number real: the funding requirement genuinely
    // does depend on the sell-through guess, and the reader has to be able to see it.
    const scheduleRefs = union(g.bom, g.season);
    const stockRefs = union(g.bom, g.landed, g.season, g.demand);
    const salesRefs = union(g.channel, g.demand, g.season);
    return [
        fig(L, 'schedule.criticalPathWeeks', 'Critical path, order to shelf', s.schedule.criticalPath.totalWeeks, 'weeks', 'computed', 'longest qualification + lead + transit + receiving', scheduleRefs),
        fig(L, 'schedule.weeksLate', 'Weeks late to the window', s.schedule.criticalPath.weeksLate, 'weeks', 'computed', 'goods available month - window open month', scheduleRefs),
        fig(L, 'schedule.unsoldAtWindowEnd', 'Units unsold when the window closes', s.schedule.unsoldAtWindowEnd, 'units', 'computed', 'units built - units sold', union(g.demand, g.channel)),
        fig(L, 'schedule.postSeasonMicros', 'Value of unsold stock after the season', s.schedule.postSeasonMicros, 'micros', 'computed', 'liquidation recovery, or carrying cost if held', stockRefs),
        fig(L, 'schedule.writeDownPerUnitMicros', 'Cost of one unit that does not sell', s.schedule.disposition.writeDownPerUnitMicros, 'micros', 'computed', 'landed cost less liquidation recovery, or the holding cost of carrying it', union(g.landed, g.season)),
        // A plan with no roles has no headcount figure — not a zero. `$0 of headcount`
        // reads as a costed answer; the honest statement is that the plan pays nobody,
        // which the org document says in prose. Emitting the figure anyway would mean
        // emitting a computed number resting on no input at all, which is the failure
        // this module exists to prevent.
        fig(L, 'headcount.totalMicros', 'Fully loaded headcount cost', g.org.length ? s.headcount.totalMicros : null, 'micros', 'computed', 'sum of monthly loaded cost across the horizon', g.org),
        fig(L, 'headcount.peakFte', 'Peak full-time equivalents', g.org.length ? s.headcount.peakFte : null, 'count', 'computed', 'max monthly FTE', g.org),
        fig(L, 'financials.revenueMicros', 'Revenue across the horizon', s.financials.totals.revenueMicros, 'micros', 'computed', 'sum of monthly revenue', salesRefs),
        fig(L, 'financials.inventoryWriteDownMicros', 'Cost of stock that did not sell', s.financials.totals.inventoryWriteDownMicros, 'micros', 'computed', 'unsold units x (landed cost - liquidation recovery), or the holding cost of carrying them', stockRefs),
        fig(L, 'financials.netIncomeMicros', 'Net income across the horizon', s.financials.totals.netIncomeMicros, 'micros', 'computed', 'cumulative net income at the horizon end', g.all),
        fig(L, 'financials.contributionMicros', 'Contribution across the horizon', s.financials.totals.contributionMicros, 'micros', 'computed', 'contribution per unit x units sold', union(g.landed, g.channel, g.demand)),
        fig(L, 'financials.fixedCostsMicros', 'Fixed costs across the horizon', s.financials.totals.fixedCostsMicros, 'micros', 'computed', 'contribution - net income - the cost of unsold stock', union(g.org, g.bom)),
        fig(L, 'financials.peakCashTroughMicros', 'Deepest cash position', s.financials.peakCash.troughMicros, 'micros', 'computed', 'min cumulative cash', g.all),
        fig(L, 'financials.fundingRequiredMicros', 'Funding required before revenue', s.financials.peakCash.fundingRequiredMicros, 'micros', 'computed', 'max(0, -trough)', g.all),
        fig(L, 'financials.monthsUnderwater', 'Months the cash position is negative', s.financials.peakCash.monthsUnderwater, 'months', 'computed', 'count of months with cumulative cash below zero', g.all),
        fig(L, 'financials.reconciliationResidualMicros', 'Unexplained gap between profit and cash', s.financials.reconciliation.residualMicros, 'micros', 'computed', 'cumulative cash - (net income - receivables - inventory + payables - non-cash credits)', g.all),
        fig(L, 'breakEven.units', 'Break-even run size', s.breakEven.units, 'units', 'computed', 'smallest RUN whose cumulative net income is non-negative — a manufacturing quantity, not a sell-through rate', g.all),
        fig(L, 'breakEven.contributionPerUnitMicros', 'Contribution per unit at plan volume', s.breakEven.contributionPerUnitMicros, 'micros', 'computed', 'blended across the channel mix', union(g.landed, g.channel)),
        fig(L, 'ledger.total', 'Registered assumptions', s.ledger.order.length, 'count', 'count', 'ledger size', []),
        fig(L, 'ledger.softMoneyCount', 'Money assumptions nobody has quoted', (0, venture_assumptions_1.ledgerStats)(s.ledger).softMoneyIds.length, 'count', 'count', 'model-authored or guessed money assumptions', []),
    ];
}
/**
 * @description Build the registry of every printable number in a model. This is
 *   what makes "every figure is traceable" a mechanism rather than a promise: a
 *   number that is not registered here cannot appear in a document at all.
 * @param s - The engine results.
 * @returns The registry, keyed by figure id.
 */
function buildFigureRegistry(s) {
    const registry = {};
    for (const f of [...costFigures(s), ...marketFigures(s), ...planFigures(s)]) {
        if (f)
            registry[f.id] = f;
    }
    return registry;
}
/**
 * @description The generated provenance report. `softFigureIds` are the numbers
 *   that rest on a guess; `unsourcedFigureIds` are the ones that rest on nothing
 *   at all, and those turn `canPublish` false.
 * @param figures - The figure registry.
 * @param ledger - The assumption ledger.
 * @returns Counts, the soft and unsourced figure lists, and the ledger statistics.
 */
function computeTraceability(figures, ledger) {
    const stats = (0, venture_assumptions_1.ledgerStats)(ledger);
    const soft = new Set(stats.softMoneyIds);
    const softFigureIds = [];
    const unsourcedFigureIds = [];
    let computedFigures = 0;
    let assumptionFigures = 0;
    for (const id of Object.keys(figures).sort()) {
        const f = figures[id];
        if (f.kind === 'computed')
            computedFigures += 1;
        if (f.kind === 'assumption')
            assumptionFigures += 1;
        // AN EMPTY CHAIN IS NOT A CLEAN CHAIN. Both tests below are `.some()` over the
        // reference list, so a computed figure with NO references used to fall through
        // both and be scored exactly like a fully-quoted one — which is how the funding
        // requirement, net income and break-even came to be treated as grounded numbers
        // while resting on nothing the reader could inspect. A computed figure that
        // cannot name a single input it depends on is unprovenanced, and that blocks.
        if (f.kind === 'computed' && f.assumptionRefs.length === 0)
            unsourcedFigureIds.push(id);
        else if (f.assumptionRefs.some((r) => !ledger.byId[r]))
            unsourcedFigureIds.push(id);
        else if (f.assumptionRefs.some((r) => soft.has(r)) || f.confidence === 'estimated' || f.confidence === 'guessed')
            softFigureIds.push(id);
    }
    return {
        totalFigures: Object.keys(figures).length,
        computedFigures, assumptionFigures, softFigureIds, unsourcedFigureIds, ledger: stats,
    };
}
/**
 * @description Derive the model's posture from the ledger. `quoted` requires that
 *   EVERY money assumption is quoted or observed — one estimated cost line is
 *   enough to make the whole model an estimate, because a plan is only as
 *   committed as its weakest cost.
 * @param ledger - The assumption ledger.
 * @returns `actual`, `quoted` or `estimate`.
 */
function derivePosture(ledger) {
    const money = ledger.order.map((id) => ledger.byId[id]).filter((a) => a.unit === 'micros');
    if (!money.length)
        return 'estimate';
    if (money.every((a) => a.confidence === 'observed'))
        return 'actual';
    if (money.every((a) => a.confidence === 'quoted' || a.confidence === 'observed'))
        return 'quoted';
    return 'estimate';
}
const TOKEN_RE = /\{\{fig:([A-Za-z0-9_.\-]+)(?:\|([a-z]+))?\}\}/g;
/**
 * @description Render `{{fig:id}}` and `{{fig:id|format}}` tokens against a
 *   registry. An unknown id THROWS: a document may not print a number the engine
 *   did not compute, and a blank where a figure should be is indistinguishable
 *   from a zero.
 * @param template - The document template text.
 * @param figures - The figure registry.
 * @returns The rendered text.
 */
function renderFigureTokens(template, figures) {
    return template.replace(TOKEN_RE, (_match, id, format) => {
        const f = figures[id];
        if (!f)
            throw new MissingFigureError(id);
        return formatFigure(f, format);
    });
}
/**
 * @description Format one figure for a document. The presentation boundary — the
 *   only other place the rounding policy applies.
 * @param f - The figure.
 * @param format - `usd` (default for money), `cents`, `pct`, `bps` or `raw`.
 * @returns The formatted string.
 */
function formatFigure(f, format) {
    const mode = format ?? (f.unit === 'micros' ? 'usd' : f.unit === 'bps' ? 'pct' : 'raw');
    if (mode === 'usd')
        return (0, venture_primitives_1.formatUsd)(f.value);
    if (mode === 'cents')
        return String((0, venture_primitives_1.microsToCents)(f.value));
    if (mode === 'pct')
        return `${(f.value / 100).toFixed(2)}%`;
    if (mode === 'bps')
        return `${f.value} bps`;
    return String(f.value);
}
/**
 * @description Every figure id a template references, without rendering it —
 *   used to validate a document specification before any numbers exist.
 * @param template - The document template text.
 * @returns The distinct figure ids referenced, sorted.
 */
function referencedFigureIds(template) {
    const ids = new Set();
    for (const m of template.matchAll(TOKEN_RE))
        ids.add(m[1]);
    return [...ids].sort();
}
//# sourceMappingURL=venture-figures.js.map