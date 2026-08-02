"use strict";
/**
 * Venture engine — critical path, the season, and the cash event calendar.
 *
 * THIS IS THE MODULE THAT KILLS SEASONAL VENTURES, and it is meant to. For a
 * product that sells in a three-week window:
 *
 *   - The factory is paid a deposit at order and the balance at bill of lading,
 *     both MONTHS before the first unit sells.
 *   - Freight and duty are paid at arrival, still before the season.
 *   - A trade customer pays 60-90 days AFTER the season.
 *   - Anything unsold on 1 November is worth a fraction of what it cost.
 *
 * An annual profit-and-loss statement hides every one of those facts. It shows a
 * profitable year for a company that ran out of money in August. So the schedule
 * emits SIGNED, DATED cash events and the financial engine adds them up in order,
 * which is the only way the peak cash requirement — the cheque the operator has to
 * write before any revenue exists — becomes visible.
 *
 * THE MISSED WINDOW IS A BLOCK, NOT A WARNING. If the critical path lands the
 * goods after the window opens, the plan does not have a timing risk, it has a
 * product that arrives after the customers went home.
 *
 * Pure: no I/O, no clock, no randomness. Resolution is one calendar month.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the qualification-plus-lead critical path with the latest honest PO month and the blocking missed-window verdict, per-supplier deposit and balance timing, freight and duty at arrival, weekly sell-through normalised onto months, per-channel remittance lag, and the carry-versus-liquidate treatment of unsold stock.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | Import cash events are now derived from the buyer-paid legs of the landed stack rather than from a hand-maintained key list — marine insurance and warehouse-in were in landed cost and therefore in cost of sales, but left the bank in no cash event at all, and under EXW the origin legs leaked the same way. Unsold stock now produces an InventoryDisposition (the write-down or the holding cost, by month, and the month the stock leaves the balance sheet) so the profit statement can charge it and the inventory position can be relieved when it is liquidated. Cash events carry the month the obligation was INCURRED as well as the month it is paid, which is what lets accounts payable mean something.
 *
 * @module venture-schedule
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeCriticalPath = computeCriticalPath;
exports.normalisedSellThrough = normalisedSellThrough;
exports.unitsByMonth = unitsByMonth;
exports.buyerPaidLogisticsMicros = buyerPaidLogisticsMicros;
exports.buildCashSchedule = buildCashSchedule;
exports.inventoryByMonth = inventoryByMonth;
exports.netCashInMonth = netCashInMonth;
exports.cashByKindThrough = cashByKindThrough;
exports.cashByKindAfter = cashByKindAfter;
exports.windowEndMonthOf = windowEndMonthOf;
const venture_bom_1 = require("./venture-bom");
const venture_channels_1 = require("./venture-channels");
const venture_issues_1 = require("./venture-issues");
const venture_primitives_1 = require("./venture-primitives");
/**
 * @description The timing verdict: how long the longest-lead component takes to
 *   qualify, make, ship and receive, when a purchase order therefore has to be
 *   placed, and whether the goods reach the shelf before the window opens.
 * @param bom - The roll-up (carries the longest lead path).
 * @param poMonth - The month the production order is placed.
 * @param transitWeeks - Ocean transit.
 * @param receivingWeeks - Port to distribution centre, put-away, ready to ship.
 * @param season - The selling window.
 * @returns The critical path, with a BLOCKING issue when the window is missed.
 */
function computeCriticalPath(bom, poMonth, transitWeeks, receivingWeeks, season) {
    const transit = Math.max(0, transitWeeks);
    const receiving = Math.max(0, receivingWeeks);
    const totalWeeks = bom.longestLeadWeeks + transit + receiving;
    const goodsAvailableMonth = (0, venture_primitives_1.ymAddWeeksCeil)(poMonth, totalWeeks);
    const latestPoMonth = (0, venture_primitives_1.ymAdd)(season.sellWindowStart, -Math.ceil(totalWeeks / venture_primitives_1.WEEKS_PER_MONTH));
    const monthsLate = (0, venture_primitives_1.ymDiff)(goodsAvailableMonth, season.sellWindowStart);
    const weeksLate = monthsLate > 0 ? (0, venture_primitives_1.roundHalfUp)(monthsLate * venture_primitives_1.WEEKS_PER_MONTH) : 0;
    const issues = [];
    if (weeksLate > 0) {
        issues.push((0, venture_issues_1.issue)('critical-path-misses-window', 'block', 'schedule:critical-path', `Goods are ready in ${goodsAvailableMonth} but the selling window opens in ${season.sellWindowStart}. "${bom.longestLeadComponentId}" drives a ${bom.longestLeadWeeks}-week qualification and lead time; the order had to be placed by ${latestPoMonth}. This is not a timing risk, it is a product that arrives after the season.`, { goodsAvailableMonth, windowOpens: season.sellWindowStart, weeksLate, latestPoMonth, drivingComponentId: bom.longestLeadComponentId }));
    }
    return { totalWeeks, drivingComponentId: bom.longestLeadComponentId, latestPoMonth, goodsAvailableMonth, weeksLate, issues };
}
/**
 * @description Normalise a weekly sell-through curve to sum to 1 across the
 *   window, surfacing the residual rather than silently rescaling.
 * @param season - The season profile.
 * @returns The normalised weekly shares and any issue raised.
 */
function normalisedSellThrough(season) {
    const weeks = Math.max(1, Math.trunc(season.sellWindowWeeks));
    const raw = Array.from({ length: weeks }, (_, i) => Math.max(0, season.weeklySellThrough[i] ?? 0));
    const sum = raw.reduce((a, b) => a + b, 0);
    if (sum === 0)
        return { weekly: raw.map(() => 1 / weeks), issues: [] };
    const issues = [];
    if (Math.abs(sum - 1) > 1e-9) {
        issues.push((0, venture_issues_1.issue)('sell-through-renormalised', 'info', 'schedule:season', `The weekly sell-through curve sums to ${sum.toFixed(4)} rather than 1; it is normalised and the residual is reported.`, { declaredSum: (0, venture_primitives_1.roundHalfUp)(sum * 10000) / 10000 }));
    }
    return { weekly: raw.map((r) => r / sum), issues };
}
/**
 * @description Spread the season's unit volume across calendar months using the
 *   weekly curve.
 * @param season - The season profile.
 * @param unitsSold - Units sold across the whole window.
 * @returns Units by month plus any normalisation issue.
 */
function unitsByMonth(season, unitsSold) {
    const { weekly, issues } = normalisedSellThrough(season);
    const perWeek = (0, venture_primitives_1.allocateMicros)(Math.max(0, Math.trunc(unitsSold)), weekly);
    const byMonth = {};
    perWeek.forEach((units, i) => {
        const month = (0, venture_primitives_1.ymAdd)(season.sellWindowStart, Math.floor(i / venture_primitives_1.WEEKS_PER_MONTH));
        byMonth[month] = (byMonth[month] ?? 0) + units;
    });
    return { byMonth, issues };
}
/** Purchase-order deposit and balance events, one pair per supplier. */
function purchaseOrderEvents(input) {
    const events = [];
    for (const po of (0, venture_bom_1.supplierPurchaseOrders)(input.bom, input.suppliers)) {
        const shipMonth = (0, venture_primitives_1.ymAddWeeksCeil)(input.poMonth, Math.max(0, po.supplier.qualificationWeeks) + Math.max(0, po.supplier.leadTimeWeeks));
        events.push({
            month: input.poMonth, kind: 'po-deposit', amountMicros: -po.depositMicros,
            note: `${po.supplier.name} deposit (${po.supplier.depositBps} bps of the order) — paid before anything is made`,
            assumptionRefs: po.supplier.assumptionRefs, incurredMonth: input.poMonth,
        });
        events.push({
            month: (0, venture_primitives_1.ymAdd)(shipMonth, (0, venture_primitives_1.monthsForDays)(po.supplier.balanceNetDays)), kind: 'po-balance',
            amountMicros: -po.balanceMicros,
            note: `${po.supplier.name} balance, net ${po.supplier.balanceNetDays} from shipment`,
            assumptionRefs: po.supplier.assumptionRefs, incurredMonth: shipMonth,
        });
    }
    return events;
}
/**
 * Legs that fall due before the goods reach the port of entry. Everything else the
 * buyer pays falls due at arrival — including anything added to the landed stack
 * later, because the split below is a partition of the buyer-paid legs rather than
 * a list of the ones somebody remembered.
 */
const PRE_ARRIVAL_LEGS = new Set(['originInland', 'exportClearance', 'oceanFreight', 'marineInsurance']);
/**
 * Freight and duty events, DERIVED from the buyer-paid legs of the landed stack.
 *
 * A hand-maintained key list is how marine insurance and warehouse-in came to be
 * inside cost of goods and inside no cash event at all: money the model spent that
 * never left the bank, understating the one figure this package calls the cheque
 * somebody has to write. Filtering on `paidBy` instead means a leg cannot enter
 * landed cost without a matching outflow, and the guard suite asserts the two
 * totals are equal.
 */
function importEvents(input, arrivalMonth) {
    const buyerLegs = input.landed.legs.filter((l) => l.paidBy === 'buyer' && l.key !== 'exWorks');
    const total = (keep) => buyerLegs.filter(keep).reduce((a, l) => (0, venture_primitives_1.addMicros)(a, l.totalMicros), 0);
    const preArrival = total((l) => PRE_ARRIVAL_LEGS.has(l.key));
    const atArrival = total((l) => !PRE_ARRIVAL_LEGS.has(l.key));
    const named = (keep) => buyerLegs.filter(keep).filter((l) => l.totalMicros !== 0).map((l) => l.key).join(', ') || 'none';
    const events = [];
    if (preArrival) {
        events.push({
            month: arrivalMonth, kind: 'freight', amountMicros: -preArrival,
            note: `Freight and pre-arrival charges (${named((l) => PRE_ARRIVAL_LEGS.has(l.key))}) — due on the goods reaching the port of entry`,
            assumptionRefs: input.landed.assumptionRefs, incurredMonth: arrivalMonth,
        });
    }
    if (atArrival) {
        events.push({
            month: arrivalMonth, kind: 'duty-and-fees', amountMicros: -atArrival,
            note: `Duty, government fees, clearance, drayage and receiving (${named((l) => !PRE_ARRIVAL_LEGS.has(l.key))}) — payable to release and put away the goods`,
            assumptionRefs: input.landed.assumptionRefs, incurredMonth: arrivalMonth,
        });
    }
    return events;
}
/**
 * @description Total the landed legs the buyer actually pays, excluding the goods
 *   themselves — the figure the import cash events must equal. Exported so the
 *   financial engine can assert the identity rather than trust it.
 * @param landed - A computed landed cost.
 * @returns Micros the buyer pays to get the goods from the factory gate to the shelf.
 */
function buyerPaidLogisticsMicros(landed) {
    return landed.legs
        .filter((l) => l.paidBy === 'buyer' && l.key !== 'exWorks')
        .reduce((a, l) => (0, venture_primitives_1.addMicros)(a, l.totalMicros), 0);
}
/** Revenue remittance events, per channel, lagged by that channel's terms. */
function revenueEvents(input, soldByMonth) {
    const shares = (0, venture_channels_1.normalisedShares)(input.channels);
    const events = [];
    for (const [month, units] of Object.entries(soldByMonth)) {
        // Split the month's units across the mix with the largest-remainder allocator
        // rather than by rounding each share independently: rounding each share leaves
        // the per-channel units not summing to the month's units, and the profit
        // statement (which blends) then disagrees with the cash statement (which does
        // not) by a stray unit of revenue a month.
        const perChannel = (0, venture_primitives_1.allocateMicros)(units, shares);
        input.channels.forEach((c, i) => {
            const w = input.waterfalls.find((x) => x.channelId === c.id);
            if (!w)
                return;
            const channelUnits = perChannel[i] ?? 0;
            if (channelUnits === 0)
                return;
            const cashPerUnit = (0, venture_channels_1.channelCashPerUnitMicros)(w);
            const lagMonths = (0, venture_primitives_1.monthsForDays)((0, venture_channels_1.channelPaymentNetDays)(c));
            events.push({
                month: (0, venture_primitives_1.ymAdd)(month, lagMonths),
                kind: c.economics.kind === 'big-box' || c.economics.kind === 'distributor' ? 'retailer-payment' : 'channel-remittance',
                amountMicros: (0, venture_primitives_1.scaleMicros)(cashPerUnit, channelUnits),
                note: `${c.label}: ${channelUnits} units sold in ${month}, cash ${lagMonths ? `${lagMonths} month(s) later` : 'in month'}`,
                assumptionRefs: c.assumptionRefs, incurredMonth: month,
            });
        });
    }
    return events.sort((a, b) => (0, venture_primitives_1.ymCompare)(a.month, b.month) || (a.note < b.note ? -1 : 1));
}
/**
 * What happens to stock that did not sell: carried at a cost, or dumped for a
 * fraction. Returns the cash events AND the profit-statement charge, because the
 * two are the same fact and deriving them twice is how the plan came to report a
 * profit that grew with the size of the over-build.
 */
function postSeasonEvents(input, unsold, windowEndMonth) {
    const policy = input.season.postSeasonPolicy === 'liquidate' ? 'liquidate' : 'carry';
    const landedUnit = input.landed.buyerUnitMicros ?? 0;
    const left = Math.max(0, unsold);
    const stockValueMicros = (0, venture_primitives_1.scaleMicros)(landedUnit, left);
    const carryMonths = input.horizon.filter((m) => (0, venture_primitives_1.ymCompare)(m, windowEndMonth) > 0);
    if (policy === 'liquidate') {
        const disposedMonth = (0, venture_primitives_1.ymAdd)(windowEndMonth, 1);
        const recoveryPerUnit = (0, venture_primitives_1.applyBps)(landedUnit, Math.max(0, input.season.liquidationRecoveryBps));
        const writeDownPerUnitMicros = (0, venture_primitives_1.subMicros)(landedUnit, recoveryPerUnit);
        const recoveryMicros = (0, venture_primitives_1.scaleMicros)(recoveryPerUnit, left);
        const writeDown = (0, venture_primitives_1.scaleMicros)(writeDownPerUnitMicros, left);
        const disposition = {
            policy, unitsUnsold: left, stockValueMicros, recoveryMicros, writeDownPerUnitMicros,
            chargeByMonth: left > 0 ? { [disposedMonth]: writeDown } : {},
            totalChargeMicros: writeDown, disposedMonth: left > 0 ? disposedMonth : null,
        };
        if (left <= 0)
            return { events: [], postSeasonMicros: 0, disposition };
        return {
            events: [{
                    month: disposedMonth, kind: 'liquidation', amountMicros: recoveryMicros,
                    note: `${left} unsold units dumped at ${input.season.liquidationRecoveryBps} bps of landed cost — a write-down of ${writeDown} micros`,
                    assumptionRefs: input.season.assumptionRefs, incurredMonth: disposedMonth,
                }],
            postSeasonMicros: recoveryMicros,
            disposition,
        };
    }
    const monthlyPerUnit = (0, venture_primitives_1.applyBps)(landedUnit, Math.max(0, input.season.carryHoldingBpsPerMonth));
    const monthly = (0, venture_primitives_1.scaleMicros)(monthlyPerUnit, left);
    const chargeByMonth = {};
    if (left > 0)
        for (const m of carryMonths)
            chargeByMonth[m] = monthly;
    const disposition = {
        policy, unitsUnsold: left, stockValueMicros, recoveryMicros: 0,
        writeDownPerUnitMicros: (0, venture_primitives_1.scaleMicros)(monthlyPerUnit, carryMonths.length),
        chargeByMonth, totalChargeMicros: left > 0 ? (0, venture_primitives_1.scaleMicros)(monthly, carryMonths.length) : 0,
        disposedMonth: null,
    };
    if (left <= 0)
        return { events: [], postSeasonMicros: 0, disposition };
    return {
        events: carryMonths.map((m) => ({
            month: m, kind: 'holding-cost', amountMicros: -monthly,
            note: `Holding ${left} unsold units at ${input.season.carryHoldingBpsPerMonth} bps of landed value per month`,
            assumptionRefs: input.season.assumptionRefs, incurredMonth: m,
        })),
        postSeasonMicros: -(0, venture_primitives_1.scaleMicros)(monthly, carryMonths.length),
        disposition,
    };
}
/**
 * @description Build the dated cash calendar for one production run and one
 *   season: tooling, per-supplier deposits and balances, freight and duty at
 *   arrival, remittances lagged by each channel's terms, and the treatment of
 *   unsold stock.
 * @param input - The run, the landed cost, the channels and the season.
 * @returns The critical path, every dated cash event, the inventory position by
 *   month, what is left at the end of the window and what it is worth.
 */
function buildCashSchedule(input) {
    const criticalPath = computeCriticalPath(input.bom, input.poMonth, input.transitWeeks, input.receivingWeeks, input.season);
    const issues = [...criticalPath.issues];
    const arrivalMonth = (0, venture_primitives_1.ymAddWeeksCeil)(input.poMonth, input.bom.longestLeadWeeks + Math.max(0, input.transitWeeks));
    const sold = Math.max(0, Math.trunc(input.unitsSold));
    const built = Math.max(0, Math.trunc(input.unitsBuilt));
    if (sold > built) {
        issues.push((0, venture_issues_1.issue)('oversold-inventory', 'block', 'schedule:inventory', `The plan sells ${sold} units from a run of ${built}. Demand above what was built is not revenue, it is a stockout.`, { unitsSold: sold, unitsBuilt: built }));
    }
    const sellable = Math.min(sold, built);
    const { byMonth: unitsSoldByMonth, issues: curveIssues } = unitsByMonth(input.season, sellable);
    issues.push(...curveIssues);
    const windowEndMonth = (0, venture_primitives_1.ymAdd)(input.season.sellWindowStart, Math.max(0, Math.ceil(input.season.sellWindowWeeks / venture_primitives_1.WEEKS_PER_MONTH) - 1));
    const unsoldAtWindowEnd = Math.max(0, built - sellable);
    const post = postSeasonEvents(input, unsoldAtWindowEnd, windowEndMonth);
    const events = [
        ...(input.bom.oneTimeMicros ? [{
                month: input.toolingMonth, kind: 'tooling', amountMicros: -input.bom.oneTimeMicros,
                note: 'Tooling and non-recurring engineering — spent before a single unit exists',
                assumptionRefs: input.bom.assumptionRefs, incurredMonth: input.toolingMonth,
            }] : []),
        ...purchaseOrderEvents(input),
        ...importEvents(input, arrivalMonth),
        ...revenueEvents(input, unitsSoldByMonth),
        ...post.events,
    ];
    return {
        criticalPath, events, unitsSoldByMonth,
        unitsOnHandByMonth: inventoryByMonth(input.horizon, criticalPath.goodsAvailableMonth, built, unitsSoldByMonth, post.disposition.disposedMonth),
        unsoldAtWindowEnd, postSeasonMicros: post.postSeasonMicros, disposition: post.disposition, issues,
    };
}
/**
 * @description Units on hand at the end of each month: nothing until the goods
 *   arrive, then the run less everything sold to date — and NOTHING from the month
 *   the leftovers are liquidated, because stock the cash statement has already sold
 *   cannot still be an asset. Carrying it in both places for the rest of the
 *   horizon is a balance sheet that double-counts the same 750 units.
 * @param horizon - The months to report, ascending.
 * @param availableMonth - The month the goods become sellable.
 * @param built - Units in the run.
 * @param soldByMonth - Units sold per month.
 * @param disposedMonth - The month unsold stock is liquidated, or null when carried.
 * @returns Closing inventory units by month.
 */
function inventoryByMonth(horizon, availableMonth, built, soldByMonth, disposedMonth = null) {
    const out = {};
    let cumulativeSold = 0;
    for (const m of horizon) {
        cumulativeSold += soldByMonth[m] ?? 0;
        const disposed = disposedMonth !== null && (0, venture_primitives_1.ymCompare)(m, disposedMonth) >= 0;
        out[m] = (0, venture_primitives_1.ymCompare)(m, availableMonth) < 0 || disposed ? 0 : Math.max(0, built - cumulativeSold);
    }
    return out;
}
/**
 * @description Sum the signed cash events falling in one month.
 * @param events - All cash events.
 * @param month - The month to total.
 * @returns The net signed amount in micros.
 */
function netCashInMonth(events, month) {
    return (0, venture_primitives_1.addMicros)(...events.filter((e) => e.month === month).map((e) => e.amountMicros));
}
/**
 * @description Total outflow across a set of event kinds — used by the working
 *   capital calculation to separate what has been paid from what has been incurred.
 * @param events - All cash events.
 * @param kinds - The kinds to include.
 * @param upToMonth - Inclusive cut-off month.
 * @returns The signed total in micros.
 */
function cashByKindThrough(events, kinds, upToMonth) {
    const set = new Set(kinds);
    return (0, venture_primitives_1.addMicros)(...events.filter((e) => set.has(e.kind) && (0, venture_primitives_1.ymCompare)(e.month, upToMonth) <= 0).map((e) => e.amountMicros));
}
/**
 * @description Cash events that have not yet fallen due as of a month — the basis
 *   for the accounts-payable position.
 * @param events - All cash events.
 * @param kinds - The kinds to include.
 * @param afterMonth - Events strictly after this month are counted.
 * @returns The signed total still outstanding, in micros.
 */
function cashByKindAfter(events, kinds, afterMonth) {
    const set = new Set(kinds);
    return (0, venture_primitives_1.addMicros)(...events.filter((e) => set.has(e.kind) && (0, venture_primitives_1.ymCompare)(e.month, afterMonth) > 0).map((e) => e.amountMicros));
}
/**
 * @description The last month of the selling window.
 * @param season - The season profile.
 * @returns The month key the window closes in.
 */
function windowEndMonthOf(season) {
    return (0, venture_primitives_1.ymAdd)(season.sellWindowStart, Math.max(0, Math.ceil(season.sellWindowWeeks / venture_primitives_1.WEEKS_PER_MONTH) - 1));
}
//# sourceMappingURL=venture-schedule.js.map