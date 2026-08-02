"use strict";
/**
 * Venture engine — bill-of-materials roll-up with quantity price breaks, yield
 * loss, supplier minimums and tooling.
 *
 * FOUR RULES THAT DECIDE WHETHER THE NUMBER IS HONEST:
 *
 * 1. SCRAP DIVIDES, IT DOES NOT MULTIPLY. To ship one good unit at 2% scrap you
 *    must BUY 1/(1-0.02) = 1.0204, not 1.02. The difference looks tiny and it
 *    compounds up every level of the tree.
 *
 * 2. PRICE BANDS ARE SELECTED, NEVER INTERPOLATED. Vendors quote steps. Drawing a
 *    line between two breaks invents a price nobody offered. A quantity below the
 *    lowest quoted break or beyond a break's stated ceiling is priced at the
 *    nearest quoted band, flagged `outsideQuotedBands`, and surfaced as an issue
 *    so a human goes and gets a real quote.
 *
 * 3. MOQ OVERBUY IS A REAL COST AND IT IS NAMED. Buying 5,000 of a part whose
 *    minimum is 10,000 costs 10,000 parts. The 5,000 you never consume are
 *    reported as `moqOverbuyMicros` instead of quietly inflating a unit cost.
 *
 * 4. TOOLING IS NEVER FOLDED INTO UNIT COST. One-time spend is reported
 *    separately and amortised only into an explicitly-labelled
 *    `amortizedUnitMicros`, because a marginal cost and a sunk cost answer
 *    different questions and mixing them makes both wrong.
 *
 * Every node in the tree contributes a cost line, including assemblies. A purely
 * structural assembly declares a single zero-cost break — an assembly is not
 * implicitly free, it is explicitly free.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — recursive flatten with compounded scrap-adjusted quantity and cycle detection, band selection with below/in-band/above positions, MOQ raise with the overbuy costed and named, tooling by tool life, the strict recurring-vs-one-time split, the smallest honest run quantity, and the surfaced rounding residual.
 *
 * @module venture-bom
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectPriceBreak = selectPriceBreak;
exports.flattenBom = flattenBom;
exports.rollUpBom = rollUpBom;
exports.supplierPurchaseOrders = supplierPurchaseOrders;
exports.collectSuppliers = collectSuppliers;
exports.bomIsPublishable = bomIsPublishable;
const venture_issues_1 = require("./venture-issues");
const venture_primitives_1 = require("./venture-primitives");
/**
 * @description Select the quoted price band for a purchase quantity. Bands are
 *   SELECTED, never interpolated or extrapolated: the returned price is always a
 *   price the vendor actually quoted, and the position tells the caller whether
 *   the quantity was covered.
 * @param breaks - The quoted ladder; sorted here, so caller order is irrelevant.
 * @param purchaseQty - The quantity being bought.
 * @returns The applicable band (or null when the ladder is empty) and the position.
 */
function selectPriceBreak(breaks, purchaseQty) {
    if (!breaks.length)
        return { band: null, position: 'below' };
    const sorted = [...breaks].sort((a, b) => a.minQty - b.minQty);
    const lowest = sorted[0];
    if (purchaseQty < lowest.minQty)
        return { band: lowest, position: 'below' };
    let chosen = lowest;
    for (const b of sorted)
        if (purchaseQty >= b.minQty)
            chosen = b;
    const top = sorted[sorted.length - 1];
    if (chosen === top && typeof top.maxQty === 'number' && purchaseQty > top.maxQty) {
        return { band: top, position: 'above' };
    }
    return { band: chosen, position: 'in-band' };
}
/**
 * @description Flatten the product structure depth-first, compounding
 *   scrap-adjusted quantity down every level. A cycle throws rather than looping,
 *   because a self-referencing BOM is a data defect and an infinite roll-up is
 *   not a number.
 * @param root - The top assembly; its `qtyPerParent` is treated as per finished unit.
 * @returns Every node with its ancestry path and effective quantity per finished unit.
 */
function flattenBom(root) {
    const out = [];
    const walk = (node, parentQty, path, seen) => {
        if (seen.has(node.id)) {
            throw new RangeError(`BOM cycle: component "${node.id}" appears inside its own subtree (${path.join(' > ')})`);
        }
        const scrap = Number.isFinite(node.scrapRateRatio) ? Math.min(0.95, Math.max(0, node.scrapRateRatio)) : 0;
        const qty = Number.isFinite(node.qtyPerParent) ? Math.max(0, node.qtyPerParent) : 0;
        const effective = (0, venture_primitives_1.assertRepresentable)((parentQty * qty) / (1 - scrap), 'flattenBom');
        const nextPath = [...path, node.id];
        out.push({ component: node, path: nextPath, effectiveQtyPerUnit: effective });
        const nextSeen = new Set(seen);
        nextSeen.add(node.id);
        for (const child of node.children ?? [])
            walk(child, effective, nextPath, nextSeen);
    };
    walk(root, 1, [], new Set());
    return out;
}
/**
 * @description The conditions one costed line raises: no quoted price at all, a
 *   quantity outside the quoted ladder, an unqualified supplier, and a minimum
 *   that forces pieces nobody consumes. Split from the arithmetic so each stays
 *   readable, and because these sentences are what a reader acts on.
 * @param c - The component.
 * @param band - The selected price band, or null when the ladder is empty.
 * @param position - Where the purchase quantity sat against the ladder.
 * @param qty - Purchase quantity, needed quantity, minimum and the overbuy cost.
 * @returns The issues raised by this line.
 */
function lineIssues(c, band, position, qty) {
    const issues = [];
    const where = `bom:${c.id}`;
    if (!band) {
        issues.push((0, venture_issues_1.issue)('below-lowest-price-break', 'block', where, `"${c.name}" has no quoted price at any quantity, so its cost cannot be computed.`, { componentId: c.id }));
    }
    else if (position === 'below') {
        issues.push((0, venture_issues_1.issue)('below-lowest-price-break', 'warn', where, `"${c.name}" buys ${qty.purchaseQty} but the lowest quoted break starts at ${band.minQty}; priced at that break, which understates a small-run price.`, { componentId: c.id, purchaseQty: qty.purchaseQty, lowestBreakQty: band.minQty }));
    }
    else if (position === 'above') {
        issues.push((0, venture_issues_1.issue)('above-highest-price-break', 'warn', where, `"${c.name}" buys ${qty.purchaseQty}, beyond the ${band.maxQty} the vendor quoted; priced at the top band, which is deliberately conservative and needs a real quote.`, { componentId: c.id, purchaseQty: qty.purchaseQty, quotedTo: band.maxQty ?? 0 }));
    }
    if (!c.supplier.qualified) {
        issues.push((0, venture_issues_1.issue)('supplier-unqualified', 'warn', where, `"${c.name}" is costed against ${c.supplier.name}, which has not been qualified; the price and the lead time are both provisional.`, { componentId: c.id, supplierId: c.supplier.supplierId }));
    }
    if (qty.overbuyQty > 0) {
        issues.push((0, venture_issues_1.issue)('moq-overbuy', 'warn', where, `"${c.name}" needs ${qty.needed} but the minimum is ${qty.moq}; ${qty.overbuyQty} pieces are bought and never consumed.`, { componentId: c.id, overbuyQty: qty.overbuyQty, overbuyMicros: qty.overbuyMicros }));
    }
    return issues;
}
/**
 * @description Cost one flattened node against a run quantity: purchase quantity
 *   with discrete rounding and the supplier minimum applied, band selection, the
 *   extended cost, the named MOQ overbuy and the tooling count.
 * @param node - A flattened BOM node.
 * @param runQtyUnits - Finished units in this production run.
 * @returns The costed line plus any issues the line raised.
 */
function costLine(node, runQtyUnits) {
    const { component: c } = node;
    const raw = (0, venture_primitives_1.assertRepresentable)(node.effectiveQtyPerUnit * runQtyUnits, 'costLine');
    const needed = c.discrete ? Math.ceil(raw) : raw;
    const moq = Number.isFinite(c.supplier.moqUnits) ? Math.max(0, c.supplier.moqUnits) : 0;
    const purchaseQty = Math.max(needed, moq);
    const { band, position } = selectPriceBreak(c.priceBreaks, purchaseQty);
    const unitCost = band ? band.unitCostMicros : 0;
    const overbuyQty = Math.max(0, purchaseQty - needed);
    const moqOverbuyMicros = (0, venture_primitives_1.scaleMicros)(unitCost, overbuyQty);
    const issues = lineIssues(c, band, position, { purchaseQty, needed, moq, overbuyQty, overbuyMicros: moqOverbuyMicros });
    const tooling = c.toolingMicros ?? 0;
    const life = c.toolingLifeUnits && c.toolingLifeUnits > 0 ? c.toolingLifeUnits : Infinity;
    const toolsRequired = tooling > 0 ? Math.max(1, Math.ceil(purchaseQty / life)) : 0;
    const line = {
        componentId: c.id,
        path: node.path,
        name: c.name,
        supplierId: c.supplier.supplierId,
        effectiveQtyPerUnit: node.effectiveQtyPerUnit,
        purchaseQtyRaw: raw,
        purchaseQty,
        selectedBreak: band,
        bandUnitCostMicros: unitCost,
        extendedMicros: (0, venture_primitives_1.scaleMicros)(unitCost, purchaseQty),
        outsideQuotedBands: position !== 'in-band',
        moqOverbuyMicros,
        toolsRequired,
        oneTimeMicros: (0, venture_primitives_1.scaleMicros)(tooling, toolsRequired),
        assumptionRefs: [...new Set([...(band ? [band.assumptionRef] : []), ...c.supplier.assumptionRefs])].sort(),
    };
    return { line, issues };
}
/**
 * @description Roll up the whole BOM for one production run.
 * @param root - The top assembly.
 * @param runQtyUnits - Finished units in this run; zero yields null per-unit figures.
 * @returns Costed lines, the recurring/one-time split, per-unit figures, the
 *   smallest honest run quantity, the longest lead path and every issue raised.
 */
function rollUpBom(root, runQtyUnits) {
    const units = Number.isFinite(runQtyUnits) ? Math.max(0, Math.trunc(runQtyUnits)) : 0;
    const issues = [];
    let nodes;
    try {
        nodes = flattenBom(root);
    }
    catch (e) {
        return cycleRollup(root, units, e instanceof Error ? e.message : String(e));
    }
    if (units === 0) {
        issues.push((0, venture_issues_1.issue)('zero-volume', 'warn', 'bom', 'Run quantity is zero, so no per-unit cost exists.', { runQtyUnits: 0 }));
    }
    const lines = [];
    for (const node of nodes) {
        const costed = costLine(node, units);
        lines.push(costed.line);
        issues.push(...costed.issues);
    }
    const runRecurringMicros = (0, venture_primitives_1.addMicros)(...lines.map((l) => l.extendedMicros));
    const oneTimeMicros = (0, venture_primitives_1.addMicros)(...lines.map((l) => l.oneTimeMicros));
    const recurringUnitMicros = units === 0 ? null : (0, venture_primitives_1.divMicros)(runRecurringMicros, units);
    const amortizedUnitMicros = units === 0 ? null : (0, venture_primitives_1.divMicros)(oneTimeMicros, units);
    const fullyLoadedUnitMicros = recurringUnitMicros === null || amortizedUnitMicros === null
        ? null
        : (0, venture_primitives_1.addMicros)(recurringUnitMicros, amortizedUnitMicros);
    const roundingResidualMicros = recurringUnitMicros === null
        ? 0
        : (0, venture_primitives_1.subMicros)(runRecurringMicros, (0, venture_primitives_1.scaleMicros)(recurringUnitMicros, units));
    if (roundingResidualMicros !== 0) {
        issues.push((0, venture_issues_1.issue)('rounding-residual', 'info', 'bom', 'The per-unit recurring cost does not multiply back to the run total exactly; the residual is reported rather than absorbed.', { residualMicros: roundingResidualMicros }));
    }
    const lead = longestLead(nodes);
    return {
        runQtyUnits: units,
        lines,
        runRecurringMicros,
        oneTimeMicros,
        recurringUnitMicros,
        amortizedUnitMicros,
        fullyLoadedUnitMicros,
        roundingResidualMicros,
        moqConstrainedRunUnits: smallestHonestRun(nodes),
        longestLeadWeeks: lead.weeks,
        longestLeadComponentId: lead.componentId,
        issues,
        assumptionRefs: [...new Set(lines.flatMap((l) => l.assumptionRefs))].sort(),
    };
}
/**
 * @description The empty roll-up returned when the product structure will not
 *   flatten. A self-referencing BOM has no cost, so nothing is reported except
 *   the blocking reason.
 * @param root - The top assembly.
 * @param units - The requested run quantity, echoed back.
 * @param message - The cycle description from the flatten attempt.
 * @returns A roll-up carrying only the blocking issue.
 */
function cycleRollup(root, units, message) {
    return {
        runQtyUnits: units, lines: [], runRecurringMicros: 0, oneTimeMicros: 0,
        recurringUnitMicros: null, amortizedUnitMicros: null, fullyLoadedUnitMicros: null,
        roundingResidualMicros: 0, moqConstrainedRunUnits: 0, longestLeadWeeks: 0, longestLeadComponentId: '',
        issues: [(0, venture_issues_1.issue)('bom-cycle', 'block', `bom:${root.id}`, message, { componentId: root.id })],
        assumptionRefs: [],
    };
}
/**
 * @description The smallest run quantity at which no supplier minimum forces an
 *   overbuy — the smallest honest first order.
 * @param nodes - The flattened BOM.
 * @returns Finished units, 0 when no component carries a minimum.
 */
function smallestHonestRun(nodes) {
    let worst = 0;
    for (const n of nodes) {
        const moq = n.component.supplier.moqUnits;
        if (!(moq > 0) || !(n.effectiveQtyPerUnit > 0))
            continue;
        worst = Math.max(worst, Math.ceil(moq / n.effectiveQtyPerUnit));
    }
    return worst;
}
/**
 * @description The component whose qualification plus lead time is longest — the
 *   one that decides when a purchase order has to be placed.
 * @param nodes - The flattened BOM.
 * @returns The driving component id and its total weeks.
 */
function longestLead(nodes) {
    let componentId = '';
    let weeks = 0;
    for (const n of nodes) {
        const total = Math.max(0, n.component.supplier.qualificationWeeks) + Math.max(0, n.component.supplier.leadTimeWeeks);
        if (total > weeks || (total === weeks && componentId === '')) {
            weeks = total;
            componentId = n.component.id;
        }
    }
    return { componentId, weeks };
}
/**
 * @description Group the roll-up's recurring spend by supplier, with the deposit
 *   split the cash schedule needs. Deposits are basis points of the PO value, so
 *   the split is exact rather than a percentage of a rounded total.
 * @param rollup - A completed roll-up.
 * @param suppliers - Supplier terms keyed by id (from the BOM tree).
 * @returns One entry per supplier with the PO value, deposit and balance.
 */
function supplierPurchaseOrders(rollup, suppliers) {
    const byId = new Map();
    for (const l of rollup.lines)
        byId.set(l.supplierId, (0, venture_primitives_1.addMicros)(byId.get(l.supplierId) ?? 0, l.extendedMicros));
    const out = [];
    for (const [supplierId, poValueMicros] of [...byId.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const supplier = suppliers[supplierId];
        if (!supplier)
            continue;
        const depositMicros = (0, venture_primitives_1.applyBps)(poValueMicros, Math.max(0, Math.min(10000, supplier.depositBps)));
        out.push({ supplier, poValueMicros, depositMicros, balanceMicros: (0, venture_primitives_1.subMicros)(poValueMicros, depositMicros) });
    }
    return out;
}
/**
 * @description Index every supplier in a BOM tree by id, for the cash schedule.
 * @param root - The top assembly.
 * @returns Supplier terms keyed by supplier id.
 */
function collectSuppliers(root) {
    const out = {};
    for (const n of flattenBom(root))
        out[n.component.supplier.supplierId] = n.component.supplier;
    return out;
}
/**
 * @description Whether a roll-up is safe to build a plan on.
 * @param rollup - A completed roll-up.
 * @returns True when no roll-up issue blocks.
 */
function bomIsPublishable(rollup) {
    return !(0, venture_issues_1.hasBlocker)(rollup.issues);
}
//# sourceMappingURL=venture-bom.js.map