"use strict";
/**
 * Trading book-read route builders (ADR-052) — the cheap, read-only surface routes: the HTML
 * surface, per-mode status, account/positions/quote reads, the equity-curve performance view, and
 * the realized P&L tally. No orders are placed and no LLM runs here. Registered FIRST by
 * trading-routes.ts, preserving the original registration order exactly.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-11 05:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Extracted from trading-routes.ts (1000-line cap decomposition): GET / + /ui + /status + /account + /positions + /quote + /performance + /realized. Handler code moved verbatim — zero behavior change.
 * 2026-07-15 10:45:00 | roger.murphy@emeraldcoastsystemsgroup.com   | /performance falls back to our recorded daily-equity series for a book with no broker equity-curve endpoint (LIVE/Schwab). Root cause of the operator's "dashboard tiles don't reflect Schwab": Schwab has no portfolioHistory, so /performance 503'd and loadPerfSummary() silently left the "Total return" + "vs S&P" KPI tiles as placeholders. Account/positions/equity tiles were always correct (Schwab-live); only the two curve-derived tiles were blank. Now built from oshal_trading_daily_equity (our own per-fire equity snapshot) + SPY closes, same payload shape. Paper is unchanged (Alpaca portfolioHistory path untouched).
 * 2026-07-19 16:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Trading engine extraction (ADR-085 pre-carve): import repoint only — ensureTradingSchema from app/trading-schema.ts (was ./trading-routes-schema, moved). Zero behavior change.
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carved out of OSHAL core into the trading app package (ADR-085 Wave 3). Relative kernel imports flip to @/ aliases (trading-routes-helpers + trading-schema stay kernel); apiDir now arrives from the entry's package surfaceDir (ctx.appPackageDir/tools) instead of the core src/api dir. Handler bodies byte-identical — zero behavior change.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Cash-account settlement (ADR-134 D8): GET /account also answers `settlement` (the kernel SettlementView — account type, settled vs unsettled cash, the settlement date in words, policy) so the ticket learns what is spendable from the one account read it already makes. Margin books get the view with no ledger read; the `account` field is byte-unchanged.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Surface expansion (ADR-136): GET /exposure - the account page's Allocation and Exits cards in ONE read. Allocation buckets the book by asset kind (Alpaca asset directory, `etp` attribute - the only SOURCED kind we have; 'unknown' when it is unconfigured, never guessed) and by SECTOR using the kernel's own sectorOf()/SECTOR map, i.e. the exact buckets the per-sector sizing cap enforces - no taxonomy is invented here, and a name outside the map lands in 'other' AND in `unclassified` rather than being assigned a sector. Headroom is computed the way sizeEntry does: maxSectorPct/100 x the CAPPED equity (capAccount, the real kernel function - not a mirror) minus the sector's pinned-lot-SUBTRACTED market value. Exits answers what is actually WORKING AT THE VENUE (reader.listOrders over a window, filtered by the kernel's IN_FLIGHT_STATUSES) and, separately and explicitly labelled, the autopilot's exit RULES computed by calling exitsToRun/trailingExits/rebalanceTrims themselves so the panel can never disagree with the engine; core holds (coreConfig) are marked exempt, and the whole rule set is marked inactive outside the regular session (computeExits runs ONLY the close-anchored dip rule off-hours) and under TRADING_HALT. Read-only: no order is placed and no peak is persisted. Every side read is a logged section that degrades to 'unavailable' rather than fabricating. Env: TRADING_EXPOSURE_ORDERS_DAYS (default 90), TRADING_EXPOSURE_WORKING_MAX (default 200).
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Exposure review round. (a) The trailing peak is the ENGINE's rolled-forward peak - nextPeaks(visible, storedPeaks), exactly what computeExits computes before it evaluates trailingExits - so a winner at a new high is priced off that high here too rather than off a stale stored peak; the roll is in memory only, savePeaks is still never called from a read route. (b) The per-sector cap denominator follows sizeEntry's own fallback (capped equity, or capped CASH when equity is zero), so a cash-only book stops reading as zero headroom where the engine would still size. (c) The asset-directory map is built from the HELD symbols instead of materialising all ~11k reference rows on every account-page paint, and availability is decided by the directory itself rather than by the map being empty (a flat book is not a failed read). (d) The card, not just the payload, now repeats every degraded section - see view-account.js SEQ 5.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Exposure review round 2. (a) The cap-TRIM base handed to exitRuleRows is the capped EQUITY, which is what the engine passes to rebalanceTrims - the equity-or-cash fallback is sizeEntry's rule for the per-sector denominator only, and applying it to trims too would have been a (zero-equity-only) divergence from the engine. (b) `exits.rules` is now null - not a computed list - whenever the protected-lot read failed, so the PAYLOAD enforces what the card already did: a consumer that reads `rules` without checking `sections` can no longer be handed stops computed over shares the autopilot may not touch. (c) The /exposure registration moves into registerExposureRoute so the already-oversized registerTradingBookReadRoutes block stops growing.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Two reads now agree with the engine's own cost. (1) GET /realized tallies closes priced by the engine (core engineRealizedForBook) instead of the stored venue-basis realized_pnl, which counts each wash-sale disallowed loss twice; the response says basis:'engine' and carries the venue's net alongside. (2) The exposure card's wouldFireNow runs the stop/take-profit check on the engine-costed position, exactly as computeExits does, so a stop the wash-sale veto suppresses is no longer shown as about to fire; trailing and trims still read the raw position, as the dispatch does.
 * 10 | maintainer@emeraldcoastsystemsgroup.com   | ADR-159 reaches the Exits card. The card printed a stop price and a take-profit for EVERY held name, including one the engine cannot account for from its own filled orders - for which it now emits no order at all - so the one row where the absence of protection actually mattered looked exactly like the fourteen where it did not. Each rule row now carries the kernel's `positionGovernance` for its symbol, read off the SAME costed array the card already builds (withEngineCostBasis over the pinned-subtracted positions), and a row the engine will not exit is marked inactive with no `wouldFireNow` computed - the same shape a core hold has had since SEQ 6. Nothing is re-derived here: a second answer to "is this unmanaged?" is precisely what would drift from the engine's. `exitsApply: null` (the ledger read failed) deliberately leaves the rules shown and carries the doubt in `governance` instead, because blanking a row on a failed read hides protection that is probably there; a failed PROTECTED-LOT read withholds the governance entirely, since `exits.rules` is already withheld for the same reason.
 *
 * @module trading-routes-book-read-builders
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXPOSURE_KIND_SOURCE = exports.EXPOSURE_SECTOR_SOURCE = void 0;
exports.performanceFromEquitySeries = performanceFromEquitySeries;
exports.exposureMix = exposureMix;
exports.exitRuleRows = exitRuleRows;
exports.workingVenueOrders = workingVenueOrders;
exports.registerTradingBookReadRoutes = registerTradingBookReadRoutes;
const logger_1 = require("@/shared/logger");
const trading_1 = require("@/features/trading");
// The exposure read reuses the ENGINE's own primitives rather than restating them: capAccount is the
// live-book sizing cap, IN_FLIGHT_STATUSES is the working-order set, coreConfig names the holds the
// autopilot never exits, and loadPeaks is the trailing-stop memory (read only - never persisted here).
const trading_dispatch_rail_1 = require("@/app/trading-dispatch-rail");
const trading_dispatch_core_1 = require("@/app/trading-dispatch-core");
const trading_peaks_store_1 = require("@/app/trading-peaks-store");
const trading_config_overrides_1 = require("@/app/trading-config-overrides");
const trading_pinned_lots_1 = require("@/app/trading-pinned-lots");
// The engine's own cost: the stop veto the dispatch applies, and realized P&L priced without the
// venue's wash-sale adjustment. The card and the tally read the same functions the engine does.
const trading_engine_cost_basis_1 = require("@/app/trading-engine-cost-basis");
const trading_position_governance_1 = require("@/app/trading-position-governance");
const trading_realized_1 = require("./trading-realized");
// ADR-134 PR3: every read resolves the BOOK (query.book, falling back to legacy ?mode= aliases via
// resolveBook) — with two live books both mode='live', an unconverted read would merge BOTH books'
// rows and the account switcher would switch nothing.
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const trading_accounts_routes_1 = require("./trading-accounts-routes");
const trading_schema_1 = require("@/app/trading-schema");
const trading_daily_equity_store_1 = require("@/app/trading-daily-equity-store");
const trading_settlement_1 = require("@/app/trading-settlement");
// Same module tag as the entry file so structured log output is unchanged by the split.
const logger = (0, logger_1.createChildLogger)({ module: 'trading-routes' });
/**
 * @description Build the /performance payload for a book with NO broker equity-curve endpoint (the
 *   LIVE Schwab book) from OUR recorded daily-equity series. This is the fix for the blank
 *   "Total return" / "vs S&P" KPI tiles in live mode: Schwab has no portfolioHistory, so the route
 *   used to 503 and the tiles silently stayed as placeholders. We snapshot real equity every fire,
 *   so we can draw the exact same curve ourselves. Returns null when nothing has been recorded yet
 *   (the caller then 503s, unchanged) so a brand-new book still degrades cleanly rather than lying.
 * @param series - Ascending recorded daily equity for this book (windowed to the period).
 * @param liveEquity - Current live equity (extends the curve to a NOW point and drives inception).
 * @param spyCloses - SPY daily closes over the same window (benchmark; may be empty).
 * @param spyNow - Latest SPY price (extends the benchmark to NOW; may be null).
 * @param inceptionBase - First-ever recorded equity for this book (the since-inception base).
 * @param period - Pass-through period label.
 * @param mode - Pass-through book.
 * @param nowT - Current epoch seconds (passed in — Date.now is banned in some contexts).
 * @returns The payload, or null when there is no recorded equity to build from.
 */
function performanceFromEquitySeries(series, liveEquity, spyCloses, spyNow, inceptionBase, period, mode, nowT) {
    const r2 = (n) => Math.round(n * 100) / 100;
    const pts = series.filter((p) => p.equity > 0);
    if (!pts.length)
        return null;
    const windowBase = pts[0].equity;
    // DAILY portfolio % vs the window's first recorded close (ET-close epoch). Built BEFORE the live
    // NOW point so the SPY benchmark aligns to real trading days, not the synthetic NOW — then both
    // series get the NOW point appended separately (mirrors the Alpaca portfolioHistory path).
    const daily = pts.map((p) => ({ t: Math.floor(Date.parse(p.etDay + 'T20:00:00Z') / 1000), pct: (p.equity / windowBase - 1) * 100 }));
    // SPY aligned to the SAME daily window (tail index), normalized to the first close OF THAT WINDOW.
    // The base MUST be cl[0] (first of the slice), NOT spyCloses[0]: we usually have more SPY closes
    // than recorded equity days (only ~9 live-equity days exist), so normalizing to spyCloses[0] would
    // measure SPY over ~23 days while the portfolio spans ~9 — an apples-to-oranges vs-S&P.
    const n = Math.min(spyCloses.length, daily.length);
    const cl = n > 0 ? spyCloses.slice(-n) : [];
    const spyBase = cl.length ? cl[0] : 0;
    const spy = spyBase > 0
        ? cl.map((c, i) => ({ t: daily[daily.length - n + i].t, pct: (c / spyBase - 1) * 100 }))
        : [];
    // Extend BOTH lines to a live NOW point: portfolio via live equity, SPY via its latest price.
    const portfolio = [...daily];
    if (liveEquity > 0 && (!portfolio.length || nowT > portfolio[portfolio.length - 1].t)) {
        portfolio.push({ t: nowT, pct: (liveEquity / windowBase - 1) * 100 });
    }
    if (spyBase > 0 && spyNow && spyNow > 0 && spy.length && nowT > spy[spy.length - 1].t) {
        spy.push({ t: nowT, pct: (spyNow / spyBase - 1) * 100 });
    }
    const endPct = portfolio.length ? portfolio[portfolio.length - 1].pct : 0;
    const spyPct = spy.length ? spy[spy.length - 1].pct : 0;
    const inceptionReturnPct = (inceptionBase > 0 && liveEquity > 0) ? (liveEquity / inceptionBase - 1) * 100 : endPct;
    return {
        mode, period, portfolio, spy,
        summary: {
            totalReturnPct: r2(endPct), spyReturnPct: r2(spyPct), vsSpyPct: r2(endPct - spyPct), baseValue: windowBase,
            inceptionReturnPct: r2(inceptionReturnPct), equity: r2(liveEquity), inceptionBase: r2(inceptionBase),
        },
    };
}
/* -- ADR-136 exposure: the Allocation + Exits cards on the account page ----------------------- */
/**
 * @description Where the sector buckets come from, in words, so the card states its own provenance
 *   instead of leaving the reader to assume the surface invented a taxonomy.
 */
exports.EXPOSURE_SECTOR_SOURCE = "the engine's own sector map (sectorOf) - the same buckets the per-sector sizing cap enforces";
/**
 * @description The asset-kind taxonomy's real provenance - Alpaca's asset directory, which answers for
 *   a Schwab book too because it is a reference list, NOT that venue's own data.
 */
exports.EXPOSURE_KIND_SOURCE = 'Alpaca US-equity asset directory (`etp` attribute) - unavailable without the Alpaca paper keys';
/** Cents rounding for every money/percentage figure the exposure payload reports - one helper so a
 *  card never shows a different precision for the same number depending on which builder made it. */
const r2c = (n) => Math.round(n * 100) / 100;
/**
 * @description Bucket the book by asset kind and by SECTOR. The sector taxonomy is the kernel's own
 *   `sectorOf` - the buckets the per-sector cap enforces - so the card can never disagree with the
 *   sizing rule; a name the map does not carry lands in 'other' AND in `unclassified` rather than
 *   being assigned a guessed sector. Headroom mirrors sizeEntry exactly: maxSectorPct% of the CAPPED
 *   equity minus the sector's already-deployed (pinned-subtracted) market value.
 * @param visible - Positions as the autopilot sees them (protected-lot shares already subtracted).
 * @param pinned - Symbol to protected-lot quantity (reported per row, never merged into the value).
 * @param account - The raw broker account snapshot (equity/cash denominators).
 * @param capBase - The base the ENGINE sizes from: capAccount's equity, or its CASH when equity is
 *   zero (portfolio.sizeEntry's own fallback) - the per-sector cap denominator.
 * @param policy - Active risk policy (supplies maxSectorPct).
 * @param tilt - TRADING_SECTOR_TILT multipliers by sector (1.0 when untilted).
 * @param kindOf - Symbol to 'stock' | 'etf' | 'unknown', from the asset directory.
 * @returns The Allocation payload, both lists sorted by value.
 */
function exposureMix(visible, pinned, account, capBase, policy, tilt, kindOf) {
    const equity = account.equity > 0 ? account.equity : account.cash;
    const pctE = (v) => (equity > 0 ? r2c((v / equity) * 100) : 0);
    const kinds = new Map();
    const sectors = new Map();
    const unclassified = [];
    for (const p of visible) {
        if (!(p.qty > 0))
            continue;
        const symbol = p.symbol.toUpperCase();
        const value = Math.max(0, p.marketValue);
        const kind = kindOf(symbol);
        kinds.set(kind, (kinds.get(kind) || 0) + value);
        const sector = (0, trading_1.sectorOf)(symbol);
        if (sector === 'other')
            unclassified.push(symbol);
        sectors.set(sector, [...(sectors.get(sector) || []), { symbol, value: r2c(value), pinnedQty: pinned.get(symbol) || 0 }]);
    }
    kinds.set('cash', (kinds.get('cash') || 0) + Math.max(0, account.cash));
    const byKind = [...kinds.entries()].map(([kind, value]) => ({ kind, value: r2c(value), pctOfEquity: pctE(value) }))
        .sort((a, b) => b.value - a.value);
    const bySector = [...sectors.entries()].map(([sector, symbols]) => sectorRow(sector, symbols, capBase, policy, tilt, pctE))
        .sort((a, b) => b.value - a.value);
    return { byKind, bySector, unclassified: [...new Set(unclassified)].sort() };
}
/**
 * @description One sector row: value, both percentages, the cap and the headroom left under it.
 * @param sector - Bucket name from sectorOf.
 * @param symbols - Its member rows.
 * @param capBase - The cap denominator sizeEntry uses (capped equity, or capped cash when equity is 0).
 * @param policy - Active risk policy.
 * @param tilt - Sector tilt multipliers.
 * @param pctE - Percent-of-equity formatter bound to the account's equity.
 * @returns The sector row.
 */
function sectorRow(sector, symbols, capBase, policy, tilt, pctE) {
    const value = symbols.reduce((s, r) => s + r.value, 0);
    return {
        sector, value: r2c(value), pctOfEquity: pctE(value),
        pctOfCapEquity: capBase > 0 ? r2c((value / capBase) * 100) : 0,
        capPct: policy.maxSectorPct,
        headroom: r2c((policy.maxSectorPct / 100) * capBase - value),
        tilt: tilt.get(sector) ?? 1,
        symbols: symbols.sort((a, b) => b.value - a.value),
    };
}
/**
 * @description The autopilot's exit RULES for each held name, computed by calling the engine's own
 *   exit functions on that one position, over the same rolled-forward peaks (nextPeaks) it uses - so a
 *   price shown here is the price the engine would act on.
 *   `ruleActive` is false for a core hold (dispatch filters every exit whose symbol is in coreConfig)
 *   and false whenever the stop/take-profit/trailing/trim set is not the set in force right now
 *   (off-hours computeExits runs ONLY the close-anchored dip rule; TRADING_HALT runs nothing).
 * @param visible - Pinned-subtracted positions.
 * @param policy - Active risk policy.
 * @param peaks - Trailing peaks rolled forward the way the engine rolls them (nextPeaks); read-only.
 * @param capEquity - The CAPPED EQUITY, which is exactly what the dispatch hands rebalanceTrims
 *   (computeExits -> rebalanceTrims(positions, account.equity, policy) over the capped account). It is
 *   deliberately NOT the per-sector denominator: sizeEntry's equity-or-cash fallback is that rule's own,
 *   and reusing it here would make a zero-equity book trim on a base the engine never trims on.
 * @param coreSymbols - Core holds, exempt from every autopilot exit.
 * @param rulesRunNow - True only when the full regular-session exit set is the one in force.
 * @param engineCost - The engine's own cost per symbol (withEngineCostBasis); the stop decision reads it,
 *   exactly as computeExits does, so a stop the wash-sale veto suppresses is not shown as about to fire.
 * @param governance - The engine's posture per symbol (ADR-159). A holding the engine cannot account
 *   for gets NO exit at all, so its rules are marked inactive and no `wouldFireNow` is computed:
 *   printing a stop price for a stop the engine will never fire is the exact thing the mark exists
 *   to stop. `exitsApply: null` (nobody could look) leaves the rules shown and carries the doubt in
 *   `governance` instead, because blanking a row on a failed read would hide protection that is
 *   probably there.
 * @returns One row per held name.
 */
function exitRuleRows(visible, policy, peaks, capEquity, coreSymbols, rulesRunNow, engineCost = new Map(), governance = {}) {
    return visible.filter((p) => p.qty > 0).map((p) => {
        const symbol = p.symbol.toUpperCase();
        const coreHold = coreSymbols.has(symbol);
        const posture = governance[symbol];
        const ruleActive = rulesRunNow && !coreHold && posture?.exitsApply !== false;
        const peak = peaks.get(symbol) ?? p.avgEntryPrice;
        const currentPrice = p.currentPrice ?? null;
        const gainPct = currentPrice != null && p.avgEntryPrice > 0 ? ((currentPrice - p.avgEntryPrice) / p.avgEntryPrice) * 100 : 0;
        const trailArmed = p.avgEntryPrice > 0 && currentPrice != null && gainPct >= policy.trailArmPct;
        const trims = ruleActive ? (0, trading_1.rebalanceTrims)([p], capEquity, policy) : [];
        return {
            symbol, qty: p.qty, avgEntryPrice: r2c(p.avgEntryPrice), currentPrice,
            stopPx: r2c(p.avgEntryPrice * (1 - policy.stopLossPct / 100)),
            takeProfitPx: r2c(p.avgEntryPrice * (1 + policy.takeProfitPct / 100)),
            peak: r2c(peak), trailArmed,
            trailStopPx: trailArmed ? r2c(peak * (1 - policy.trailGivebackPct / 100)) : null,
            trimQty: trims.length ? trims[0].qty : 0,
            wouldFireNow: ruleActive ? firstExitReason(p, policy, peaks, capEquity, engineCost.get(symbol)) : null,
            coreHold, ruleActive,
            ...(posture ? { governance: posture } : {}),
        };
    });
}
/**
 * @description The reason the ENGINE would give for exiting this one position right now, taken from
 *   the engine's own functions in the dispatch's own priority order (a full exit beats a trim).
 * @param p - The position.
 * @param policy - Active risk policy.
 * @param peaks - Stored trailing peaks.
 * @param capEquity - Cap-trim base.
 * @param engineAvgCost - The engine's own cost, when its ledger covers the position: only the stop/take-profit
 *   check reads it (the dispatch passes costed positions to exitsToRun and raw ones to trailing and trims).
 * @returns The exit reason, or null when nothing fires.
 */
function firstExitReason(p, policy, peaks, capEquity, engineAvgCost) {
    const costed = engineAvgCost === undefined ? p : { ...p, engineAvgCost };
    const fired = [...(0, trading_1.exitsToRun)([costed], policy), ...(0, trading_1.trailingExits)([p], peaks, policy), ...(0, trading_1.rebalanceTrims)([p], capEquity, policy)];
    return fired.length ? fired[0].reason : null;
}
/**
 * @description The orders the VENUE still has working, from the venue's own order record - the only
 *   authority on what is actually resting at the broker. Non-terminal statuses are the kernel's
 *   IN_FLIGHT_STATUSES (imported, never restated). Origin is claimed ONLY where the data proves it:
 *   an order id the protected-lot ledger recorded, or the `lot-` request-id convention; everything
 *   else is reported 'unattributed' rather than guessed at.
 * @param orders - Orders the venue returned for the window.
 * @param lotOrderIds - Exit order ids the protected-lot ledger recorded.
 * @param max - Row ceiling (TRADING_EXPOSURE_WORKING_MAX).
 * @returns Working rows, newest first.
 */
function workingVenueOrders(orders, lotOrderIds, max) {
    return orders
        .filter((o) => trading_dispatch_rail_1.IN_FLIGHT_STATUSES.includes(String(o.status)))
        .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))
        .slice(0, Math.max(1, max))
        .map((o) => ({
        orderId: String(o.id || ''), symbol: String(o.symbol || '').toUpperCase(),
        side: String(o.side), type: String(o.type), qty: Number(o.qty || 0), filledQty: Number(o.filledQty || 0),
        limitPrice: o.limitPrice ?? null, stopPrice: o.stopPrice ?? null, trailPercent: o.trailPercent ?? null,
        status: String(o.status), submittedAt: o.submittedAt ?? null,
        origin: (lotOrderIds.has(String(o.id)) || (0, trading_pinned_lots_1.isLotOrderClientId)(o.clientOrderId)) ? 'protected-lot' : 'unattributed',
    }));
}
/**
 * @description Run one optional side read. A failure downgrades exactly ONE section to 'unavailable'
 *   and is logged at error - it never fabricates a value and never fails the whole card.
 * @param name - Section name reported to the client.
 * @param bookRef - Book label for the log line.
 * @param run - The read.
 * @param fallback - The empty value used when it fails.
 * @param sections - Section-status map to stamp.
 * @returns The value, or the fallback.
 */
async function exposureSection(name, bookRef, run, fallback, sections) {
    try {
        const v = await run();
        sections[name] = 'ok';
        return v;
    }
    catch (err) {
        logger.error({ err, book: bookRef, section: name }, 'exposure side read failed - section reported unavailable');
        sections[name] = 'unavailable';
        return fallback;
    }
}
/**
 * @description Gather every input the exposure payload needs. Account and positions are REQUIRED (a
 *   throw becomes the route's 502 - an empty book and a failed read must never look alike); every
 *   other read is a degradable section.
 * @param ctx - App context (pool).
 * @param sub - Caller sub.
 * @param book - The resolved book.
 * @param broker - The book's bound READER (never an order-placing adapter).
 * @returns The inputs plus per-section availability.
 */
async function readExposureInputs(ctx, sub, book, broker) {
    const sections = {};
    const days = Math.max(1, Number(process.env.TRADING_EXPOSURE_ORDERS_DAYS) || 90);
    const [account, positions] = await Promise.all([broker.getAccount(), broker.getPositions()]);
    // Only the held names are ever looked up and the directory is ~11k rows: filter as the map is
    // built rather than materialising the whole reference list on every account-page paint.
    const held = new Set(positions.map((p) => p.symbol.toUpperCase()));
    const [pinned, lots, peaks, override, orders, directory] = await Promise.all([
        exposureSection('pinnedLots', book.ref, () => (0, trading_pinned_lots_1.pinnedQtyBySymbol)(ctx.pool, sub, book.bookId), new Map(), sections),
        exposureSection('protectedLots', book.ref, () => (0, trading_pinned_lots_1.listPinnedLots)(ctx.pool, sub, { bookId: book.bookId, status: ['pending_fill', 'open', 'exits_placed'] }), [], sections),
        exposureSection('peaks', book.ref, () => (0, trading_peaks_store_1.loadPeaks)(ctx.pool, sub, book), new Map(), sections),
        exposureSection('strategy', book.ref, () => (0, trading_config_overrides_1.getActiveOverride)(ctx.pool, sub, book.bookId), null, sections),
        exposureSection('workingOrders', book.ref, () => broker.listOrders(new Date(Date.now() - days * 86400000).toISOString(), new Date().toISOString()), null, sections),
        exposureSection('assetKinds', book.ref, () => (0, trading_1.assetDirectory)(), [], sections),
    ]);
    const kinds = new Map();
    for (const a of directory) {
        const sym = a.symbol.toUpperCase();
        if (held.has(sym))
            kinds.set(sym, a.kind);
    }
    // Availability is the DIRECTORY's, not the map's: an empty map on a flat book is not a failed read.
    if (!directory.length)
        sections.assetKinds = 'unavailable';
    // Costed exactly where computeExits costs them: after the pinned-lot subtraction. withEngineCostBasis
    // never throws - a failed ledger read leaves every position uncosted, which is the engine's fallback too.
    const costed = await (0, trading_engine_cost_basis_1.withEngineCostBasis)(ctx, sub, book, (0, trading_pinned_lots_1.subtractPinnedLots)(positions, pinned));
    const engineCost = new Map();
    for (const p of costed)
        if (p.engineAvgCost !== undefined)
            engineCost.set(p.symbol.toUpperCase(), p.engineAvgCost);
    // ADR-159 - read off the SAME costed array, so the card's answer for a holding is the engine's
    // own and not a second computation. A pinned-lot read failure already downgraded that section,
    // and `costed` is then built over unsubtracted positions, so the governance is withheld with it:
    // `{}` reads as NOT KNOWN on the card rather than as a claim the engine manages the book.
    const governance = sections.pinnedLots === 'unavailable'
        ? {} : (0, trading_position_governance_1.positionGovernanceBySymbol)(costed, (0, trading_dispatch_core_1.coreConfig)(override));
    return { account, positions, pinned, lots: lots, peaks, override, orders, kinds, engineCost, governance, sections };
}
/**
 * @description Shape the /exposure response from the gathered inputs. Pure apart from the session
 *   read, which decides whether the autopilot's exit rules are the set in force right now.
 * @param book - The resolved book.
 * @param inp - The gathered inputs.
 * @returns The response body. Two fields are deliberately NULLABLE, and null means 'not computable'
 *   rather than 'nothing there': `exits.working` when the venue order read failed, and `exits.rules`
 *   when the protected-lot read failed (rules over an unverified book would be drawn across shares the
 *   autopilot may not sell). `sections` names which read it was in both cases.
 */
async function shapeExposure(book, inp) {
    const override = inp.override;
    const policy = (0, trading_1.riskPolicy)(book.kind, (0, trading_config_overrides_1.policyOverrideOf)(override));
    const capped = (0, trading_dispatch_rail_1.capAccount)(inp.account, book);
    const visible = (0, trading_pinned_lots_1.subtractPinnedLots)(inp.positions, inp.pinned);
    // The engine evaluates trailingExits against nextPeaks(positions, storedPeaks) - the peak rolled
    // forward to today's price - so the card must roll it too or it prices a new high off a stale peak.
    // In memory only: savePeaks belongs to the fire, never to a read route.
    const peaks = (0, trading_1.nextPeaks)(visible, inp.peaks);
    // sizeEntry's own denominator: the capped equity, or the capped CASH when equity is zero.
    const capBase = capped.equity > 0 ? capped.equity : capped.cash;
    const core = (0, trading_dispatch_core_1.coreConfig)(override);
    const session = await (0, trading_1.tradableSessionDetailed)();
    const rulesRunNow = session.session === 'regular';
    const lotOrderIds = new Set(inp.lots.flatMap((l) => Object.entries((l.exits || {}))
        .filter(([k, v]) => k.endsWith('OrderId') && v != null).map(([, v]) => String(v))));
    return {
        mode: book.kind, book: book.ref, asOf: new Date().toISOString(),
        basis: {
            equity: r2c(inp.account.equity), cash: r2c(inp.account.cash),
            deployed: r2c(visible.reduce((s, p) => s + Math.max(0, p.marketValue), 0)),
            capEquity: r2c(capped.equity), capBase: r2c(capBase), capped: capped.equity < inp.account.equity,
        },
        policy: {
            posture: policy.posture,
            source: override ? 'strategy:' + String(override.strategyName || '') : 'env',
            maxPerNamePct: policy.maxPerNamePct, maxSectorPct: policy.maxSectorPct,
            stopLossPct: policy.stopLossPct, takeProfitPct: policy.takeProfitPct,
            trailArmPct: policy.trailArmPct, trailGivebackPct: policy.trailGivebackPct,
        },
        engine: {
            session: session.session, reason: session.reason, blind: session.blind, rulesRunNow,
            offHoursDipPct: Number(process.env.TRADING_EXT_DIP_SELL_PCT || 0.5),
            coreHolds: core.symbols,
            universeCount: trading_1.DEFAULT_UNIVERSE.length,
            universeClassified: trading_1.DEFAULT_UNIVERSE.filter((sym) => (0, trading_1.sectorOf)(sym) !== 'other').length,
        },
        sources: { sector: exports.EXPOSURE_SECTOR_SOURCE, assetKind: exports.EXPOSURE_KIND_SOURCE },
        mix: exposureMix(visible, inp.pinned, inp.account, capBase, policy, (0, trading_1.sectorTiltConfig)(), (sym) => inp.kinds.get(sym) || 'unknown'),
        exits: {
            working: inp.orders ? workingVenueOrders(inp.orders, lotOrderIds, Number(process.env.TRADING_EXPOSURE_WORKING_MAX) || 200) : null,
            // The pins decide WHICH shares the autopilot may act on, and their failure fallback is a NO-OP
            // subtraction - so a rule computed over `visible` would be a stop drawn over ring-fenced shares.
            // The engine's own answer to that read failing is to skip the fire; the payload's is to withhold
            // (null = 'not computable', the same shape `working` already uses for the venue read), so a
            // non-browser consumer reading `rules` without checking `sections` cannot be misled either.
            // The trim base is the CAPPED EQUITY - what dispatch hands rebalanceTrims - not the sector base.
            rules: inp.sections.pinnedLots === 'ok'
                ? exitRuleRows(visible, policy, peaks, capped.equity, new Set(core.symbols), rulesRunNow, inp.engineCost, inp.governance)
                : null,
        },
        sections: inp.sections,
    };
}
/**
 * @description Register the one /exposure read on the book router. It is deliberately its own
 *   function rather than another block inside registerTradingBookReadRoutes, which is already many
 *   times over the 50-line rule. The handler is byte-parallel to the /account and /positions reads
 *   beside it: the same callerSub 401, the same routeBook resolution, the same book-bound READER
 *   (never an order-placing adapter), the same 503 when that book's broker is not connected and the
 *   same 502 when a REQUIRED read throws - so it inherits the mount's auth posture, adding none.
 * @param router - The trading router being composed by createTradingRoutes.
 * @param ctx - App context (Postgres pool for the per-user stores the side reads use).
 * @returns Nothing - the route is registered on the passed router.
 */
function registerExposureRoute(router, ctx) {
    /** GET /exposure?book= - the account page's Allocation (asset kind + sector mix against the engine's
     *  own per-sector cap) and Exits (what is WORKING AT THE VENUE, plus the autopilot's exit RULES,
     *  labelled apart) in one read. Read-only: no order is placed and no peak is persisted. */
    router.get('/exposure', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const book = await (0, trading_accounts_routes_1.routeBook)(ctx, sub, req);
            const broker = (0, trading_1.getBrokerReader)(book.kind, sub, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined);
            if (!broker.configured()) {
                res.status(503).json({ error: 'broker_not_configured' });
                return;
            }
            res.json(await shapeExposure(book, await readExposureInputs(ctx, sub, book, broker)));
        }
        catch (err) {
            logger.error({ err }, 'trading exposure failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/**
 * @description Registers the read-only book routes (surface pages, status, account, positions,
 * quote, performance, realized P&L, ledger header) on the trading router. Auth is enforced at the
 * mount (`/api/trading` sits behind serviceSecretOr(requiresAuth) in server.ts) plus each
 * handler's own callerSub 401 check — unchanged from the pre-split file.
 * @param router - The trading router being composed by createTradingRoutes.
 * @param ctx - App context (Postgres pool for the per-user, per-mode stores).
 * @param apiDir - Directory holding the HTML surface.
 * @returns Nothing — routes are registered on the passed router.
 */
function registerTradingBookReadRoutes(router, ctx, apiDir) {
    const round2 = (n) => Math.round(n * 100) / 100;
    router.get('/', (0, trading_routes_helpers_1.servePage)(apiDir, 'trading.html'));
    router.get('/ui', (0, trading_routes_helpers_1.servePage)(apiDir, 'trading.html'));
    /** GET /status — per-mode broker config, live gate, and counts. Drives the surface. */
    router.get('/status', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const book = await (0, trading_accounts_routes_1.routeBook)(ctx, sub, req);
            const mode = book.kind;
            let paperConfigured = false, liveConfigured = false, bookConfigured = false;
            try {
                paperConfigured = (0, trading_1.getBrokerReader)('paper', sub).configured();
            }
            catch { /* provider unset */ }
            // Reader (not gated): report whether the LIVE rail is wired regardless of the live-enable switch.
            try {
                liveConfigured = (0, trading_1.getBrokerReader)('live', sub).configured();
            }
            catch { /* rail unset */ }
            // bookConfigured = whether THIS book's own bound reader is wired (surface-audit 2026-09-03):
            // a b-book's Schwab connection can be healthy while the legacy-rail liveConfigured is false,
            // and vice-versa — the hub's broker-not-connected gate must key on the selected book, not the
            // env rail. The SPA prefers this field.
            try {
                bookConfigured = (0, trading_1.getBrokerReader)(mode, sub, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined).configured();
            }
            catch { /* rail unset */ }
            const counts = (await ctx.pool.query(`SELECT
           (SELECT COUNT(*)::int FROM oshal_trading_signals  WHERE user_sub=$1 AND book_id=$2) AS signals,
           (SELECT COUNT(*)::int FROM oshal_trading_decisions WHERE user_sub=$1 AND book_id=$2) AS decisions,
           (SELECT COUNT(*)::int FROM oshal_trading_orders    WHERE user_sub=$1 AND book_id=$2) AS orders`, [sub, book.bookId])).rows[0];
            res.json({
                provider: process.env.BROKER_PROVIDER || 'alpaca',
                mode, book: book.ref, bookEnabled: book.enabled, liveEnabled: (0, trading_1.liveTradingEnabled)(),
                paperConfigured, liveConfigured, bookConfigured,
                guardrails: (0, trading_routes_helpers_1.guardrails)(),
                counts: { signals: counts?.signals || 0, decisions: counts?.decisions || 0, orders: counts?.orders || 0 },
            });
        }
        catch (err) {
            logger.error({ err }, 'trading status failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /account?mode= — the broker account snapshot (cash, buying power, equity) + the settlement view (ADR-134 D8). */
    router.get('/account', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const book = await (0, trading_accounts_routes_1.routeBook)(ctx, sub, req);
            const mode = book.kind;
            const broker = (0, trading_1.getBrokerReader)(mode, sub, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined);
            if (!broker.configured()) {
                res.status(503).json({ error: 'broker_not_configured', message: `Set the ${mode} broker keys (e.g. ALPACA_${mode.toUpperCase()}_KEY_ID / _SECRET_KEY).` });
                return;
            }
            const account = await broker.getAccount();
            // Settled vs unsettled cash for the ticket: the ledger is consulted only where the guard applies
            // (a cash-type book under an armed policy); margin/paper books get the view with no extra read.
            const sells = (0, trading_settlement_1.settlementApplies)(book)
                ? await (0, trading_settlement_1.unsettledLedgerSells)(ctx.pool, sub, book).catch((err) => { logger.error({ err, book: book.ref }, 'settlement ledger read failed — venue figures only'); return []; })
                : [];
            res.json({ mode, book: book.ref, account, settlement: (0, trading_settlement_1.buildSettlementView)(account, book, sells) });
        }
        catch (err) {
            logger.error({ err }, 'trading account failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /positions?mode= — open positions for the active book. */
    router.get('/positions', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const book = await (0, trading_accounts_routes_1.routeBook)(ctx, sub, req);
            const mode = book.kind;
            const broker = (0, trading_1.getBrokerReader)(mode, sub, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined);
            if (!broker.configured()) {
                res.status(503).json({ error: 'broker_not_configured' });
                return;
            }
            res.json({ mode, book: book.ref, positions: await broker.getPositions() });
        }
        catch (err) {
            logger.error({ err }, 'trading positions failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /quote?symbol=&mode= — latest price from the ACTIVE book's data source (Schwab live feed
     *  for the live book, Alpaca IEX for paper). The live data stream, one symbol — proves data is flowing. */
    router.get('/quote', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const symbol = String(req.query.symbol || '').trim().toUpperCase();
        if (!symbol) {
            res.status(400).json({ error: 'symbol_required', message: 'symbol is required.' });
            return;
        }
        try {
            const mode = (await (0, trading_accounts_routes_1.routeBook)(ctx, sub, req)).kind;
            const md = (0, trading_1.getMarketData)(mode, sub);
            if (!md.configured()) {
                res.status(503).json({ error: 'market_data_not_configured', source: md.kind });
                return;
            }
            const price = await md.latestPrice(symbol);
            res.json({ mode, source: md.kind, symbol, price });
        }
        catch (err) {
            logger.error({ err }, 'trading quote failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /performance?mode=&period=1W|1M|3M|1Y — account equity curve vs SPY (the "me vs market" view). */
    router.get('/performance', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const book = await (0, trading_accounts_routes_1.routeBook)(ctx, sub, req);
            const mode = book.kind;
            const broker = (0, trading_1.getBrokerReader)(mode, sub, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined);
            if (!broker.configured()) {
                res.status(503).json({ error: 'broker_not_configured' });
                return;
            }
            const periodReq = String(req.query.period || '1M').toUpperCase();
            // period → (Alpaca period code, resolution, SPY daily bars to fetch).
            const MAP = {
                '1W': { p: '1W', tf: '1D', n: 6, days: 9 }, '1M': { p: '1M', tf: '1D', n: 23, days: 33 },
                '3M': { p: '3M', tf: '1D', n: 65, days: 95 }, '1Y': { p: '1A', tf: '1D', n: 252, days: 370 },
            };
            const sel = MAP[periodReq] || MAP['1M'];
            // LIVE (Schwab) has no broker equity-curve endpoint, so the Alpaca portfolioHistory path below
            // 503'd and the "Total return" / "vs S&P" KPI tiles silently stayed blank. Build the same
            // response from OUR recorded daily-equity series instead — the actual fix for the missing tiles.
            if (!broker.portfolioHistory) {
                const [series, acct, spyCloses, spyNow] = await Promise.all([
                    (0, trading_daily_equity_store_1.loadDailyEquitySeries)(ctx.pool, sub, book, sel.days),
                    broker.getAccount().catch(() => null),
                    (0, trading_1.dailyCloses)('SPY', sel.n).catch(() => []),
                    (0, trading_1.latestPrice)('SPY').catch(() => null),
                ]);
                const allTime = await (0, trading_daily_equity_store_1.loadDailyEquitySeries)(ctx.pool, sub, book, 0).catch(() => series);
                const inceptionBase = allTime.length ? allTime[0].equity : (series[0]?.equity ?? 0);
                const liveEquity = Number(acct?.equity || 0) || (series.length ? series[series.length - 1].equity : 0);
                const payload = performanceFromEquitySeries(series, liveEquity, spyCloses, spyNow, inceptionBase, periodReq, mode, Math.floor(Date.now() / 1000));
                if (!payload) {
                    res.status(503).json({ error: 'broker_not_configured' });
                    return;
                }
                res.json(payload);
                return;
            }
            const hist = await broker.portfolioHistory(sel.p, sel.tf);
            // Build cumulative-% portfolio series (skip leading nulls Alpaca pads weekends with).
            const port = [];
            for (let i = 0; i < hist.t.length; i++) {
                const e = hist.equity[i];
                if (e == null || !(e > 0))
                    continue;
                port.push({ t: hist.t[i], pct: Number(hist.plPct[i] || 0) * 100 });
            }
            // SPY benchmark over the same span, normalized to % from its first close; aligned by index (tail).
            let spy = [];
            let spyBase = 0;
            try {
                const closes = await (0, trading_1.dailyCloses)('SPY', sel.n).catch(() => []);
                if (closes.length > 1) {
                    const n = Math.min(closes.length, port.length || closes.length);
                    const cl = closes.slice(-n);
                    const tx = port.slice(-n).map((p) => p.t);
                    spyBase = cl[0];
                    if (spyBase > 0)
                        spy = cl.map((c, i) => ({ t: tx[i] || 0, pct: (c / spyBase - 1) * 100 }));
                }
            }
            catch { /* SPY optional — chart still shows the portfolio line */ }
            // Live account read: drives the since-inception KPI AND extends both chart lines to NOW.
            let liveEquity = 0;
            let inceptionBase = hist.baseValue;
            try {
                const [acct, allHist] = await Promise.all([
                    broker.getAccount(),
                    broker.portfolioHistory('all', '1D').catch(() => null),
                ]);
                liveEquity = Number(acct.equity || 0);
                if (allHist && allHist.baseValue > 0)
                    inceptionBase = allHist.baseValue;
            }
            catch { /* fall back to the period series if the live/all-time read fails */ }
            // The daily portfolio-history series lags by a session (its last bar is the prior
            // close), so the chart never showed today's ACTUAL move — the "missing actuals".
            // Extend both lines to a live NOW point (portfolio: live equity vs the window base;
            // SPY: latest trade vs the window's first close) so the chart reflects real current
            // performance against the index instead of stopping at yesterday's close.
            const nowT = Math.floor(Date.now() / 1000);
            if (liveEquity > 0 && hist.baseValue > 0 && (!port.length || nowT > port[port.length - 1].t)) {
                port.push({ t: nowT, pct: (liveEquity / hist.baseValue - 1) * 100 });
            }
            if (spy.length && spyBase > 0 && nowT > spy[spy.length - 1].t) {
                const spyNow = await (0, trading_1.latestPrice)('SPY').catch(() => null);
                if (spyNow && spyNow > 0)
                    spy.push({ t: nowT, pct: (spyNow / spyBase - 1) * 100 });
            }
            // Chart-summary figures reflect the (now-extended) curve end, so the "you" number
            // under the chart matches where the line actually finishes.
            const endPct = port.length ? port[port.length - 1].pct : 0;
            const spyPct = spy.length ? spy[spy.length - 1].pct : 0;
            // True since-inception total return (KPI): live equity vs the all-time base —
            // period-independent, so the "Total return" card does not change with the 1W/1M/
            // 3M/1Y toggle. Falls back to the period end if the live read failed.
            const inceptionReturnPct = (inceptionBase > 0 && liveEquity > 0)
                ? (liveEquity / inceptionBase - 1) * 100 : endPct;
            res.json({
                mode, period: periodReq, portfolio: port, spy,
                summary: {
                    totalReturnPct: round2(endPct), spyReturnPct: round2(spyPct), vsSpyPct: round2(endPct - spyPct),
                    baseValue: hist.baseValue,
                    inceptionReturnPct: round2(inceptionReturnPct), equity: round2(liveEquity), inceptionBase: round2(inceptionBase),
                },
            });
        }
        catch (err) {
            logger.error({ err }, 'trading performance failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /realized?mode= — realized P&L tally (per-sale): today + 30d win/loss record. */
    router.get('/realized', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const book = await (0, trading_accounts_routes_1.routeBook)(ctx, sub, req);
            const mode = book.kind;
            // Closes are priced on the ENGINE's own cost: the stored realized_pnl uses the venue's wash-sale-
            // adjusted average and counts each disallowed loss twice. The venue's net rides along, labelled.
            const closes = (await ctx.pool.query(`SELECT order_id::text AS order_id, upper(symbol) AS symbol, realized_pnl,
                (created_at::date = CURRENT_DATE) AS today
           FROM oshal_trading_orders
          WHERE user_sub=$1 AND book_id=$2 AND side='sell' AND status='filled'
            AND created_at >= now() - interval '30 days'`, [sub, book.bookId])).rows;
            const sales = closes.length
                ? await (0, trading_engine_cost_basis_1.engineRealizedForBook)(ctx, sub, book.bookId, [...new Set(closes.map((c) => c.symbol))])
                : new Map();
            const engine = (c) => sales.get(c.order_id)?.realizedPnl ?? null;
            const venueNet = (list) => Math.round(list.reduce((s, c) => s + Number(c.realized_pnl ?? 0), 0) * 100) / 100;
            const todays = closes.filter((c) => c.today);
            const today = (0, trading_realized_1.tallyRealized)(todays.map(engine));
            const d30 = (0, trading_realized_1.tallyRealized)(closes.map(engine));
            const winRate = (r) => r.trades ? Math.round((r.wins / r.trades) * 100) : null;
            res.json({
                mode, basis: 'engine',
                today: { ...today, winRatePct: winRate(today) },
                last30d: { ...d30, winRatePct: winRate(d30) },
                venueNet: { today: venueNet(todays), last30d: venueNet(closes) },
            });
        }
        catch (err) {
            logger.error({ err }, 'trading realized failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /transactions?mode=&days=&symbol= — settled trade executions the VENUE recorded (read-only).
     *  The authority for reconciling closes done outside the engine. 503 on a rail without a
     *  transactions endpoint (e.g. Alpaca paper). */
    router.get('/transactions', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const book = await (0, trading_accounts_routes_1.routeBook)(ctx, sub, req);
            const mode = book.kind;
            const broker = (0, trading_1.getBrokerReader)(mode, sub, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined);
            if (!broker.configured() || !broker.getTransactions) {
                res.status(503).json({ error: 'transactions_not_supported' });
                return;
            }
            const days = Math.min(365, Math.max(1, Number(req.query.days) || 90));
            const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
            const txns = await broker.getTransactions(new Date(Date.now() - days * 86400000).toISOString(), new Date().toISOString(), symbol);
            res.json({ mode, days, symbol: symbol || null, count: txns.length, transactions: txns });
        }
        catch (err) {
            logger.error({ err }, 'trading transactions failed');
            res.status(502).json({ error: err.message });
        }
    });
    // Its own function: the registration block above is already far over the 50-line rule, and a new
    // read has no business making that worse. Same router, same mount, same auth posture.
    registerExposureRoute(router, ctx);
}
//# sourceMappingURL=trading-routes-book-read-builders.js.map