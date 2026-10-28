"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMonthlyRotation = validateMonthlyRotation;
exports.portfolioStrategySymbols = portfolioStrategySymbols;
exports.portfolioWarmupSessions = portfolioWarmupSessions;
exports.portfolioSignalHistoryEnd = portfolioSignalHistoryEnd;
exports.monthlyRotationTargets = monthlyRotationTargets;
/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Derive the exact completed monthly signal cutoff for the next exchange session; current-month candles do not enter that signal.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Calendar-month defensive research targets with complete month-end warmup, quarterly relative strength and explicit Treasury-bill vacancies. No execution.
 */
const trading_portfolio_model_1 = require("./trading-portfolio-model");
const trading_portfolio_calendar_1 = require("./trading-portfolio-calendar");
/** Version2 has fixed, named rules; legacy session-count knobs cannot change its meaning. */
function validateMonthlyRotation(s) {
    if (s.modelVersion !== 2)
        return;
    const equal = 100 / s.assets.length;
    if (!['monthly-trend', 'quarterly-rotation'].includes(s.kind) || s.lookbackSessions !== 63 || s.rebalanceSessions !== 20 || s.grossExposurePct !== 100 || s.marginAprPct !== null || s.maintenancePct !== null || s.assets.some(a => a.symbol === 'BIL') || Math.abs(s.assets.reduce((n, a) => n + a.weightPct, 0) - 100) > 1e-6
        || (s.kind === 'monthly-trend' ? s.topN !== s.assets.length : s.topN !== 3 || s.assets.length < 3 || s.assets.some(a => Math.abs(a.weightPct - equal) > 1e-6)))
        throw new trading_portfolio_model_1.PortfolioError(422, 'strategy_invalid', 'Monthly models use fixed10-month trend,63-session quarterly ranking, monthly trading,100% cash-funded exposure and BIL vacancies. Use canonical preset fields; BIL is the separate defensive fund.');
}
/** All data and quote consumers include the fallback instrument, even when its target is zero. */
function portfolioStrategySymbols(s) {
    return [...new Set([...s.assets.map(a => a.symbol), ...(s.modelVersion === 2 ? ['BIL'] : [])])];
}
function portfolioWarmupSessions(s) {
    return s.modelVersion === 2 ? 252 : s.kind === 'allocation' ? 0 : s.lookbackSessions;
}
function nextSession(day) {
    const end = new Date(Date.parse(day + 'T00:00:00Z') + 10 * 86400000).toISOString().slice(0, 10);
    const next = (0, trading_portfolio_calendar_1.sessionDates)(day, end).find(d => d > day);
    if (!next)
        throw new trading_portfolio_model_1.PortfolioError(422, 'insufficient_history', 'The next session is outside the supported calendar.');
    return next;
}
/** Historical evidence ends at the last completed month used by the next-session model. */
function portfolioSignalHistoryEnd(s, latest) {
    if (s.modelVersion !== 2)
        return latest;
    const month = nextSession(latest).slice(0, 7), start = new Date(Date.parse(latest + 'T00:00:00Z') - 40 * 86400000).toISOString().slice(0, 10);
    const end = (0, trading_portfolio_calendar_1.sessionDates)(start, latest).filter(d => d.slice(0, 7) < month).at(-1);
    if (!end)
        throw new trading_portfolio_model_1.PortfolioError(422, 'insufficient_history', 'The completed monthly signal cutoff is unavailable.');
    return end;
}
/** Exclude an unfinished month, including when the latest price is an intra-month Friday. */
function monthlyRotationTargets(s, maps, calendar, index) {
    const fill = calendar[index] ?? nextSession(calendar[index - 1]), month = fill.slice(0, 7), ends = new Map();
    for (const day of calendar.slice(0, index))
        if (day.slice(0, 7) < month)
            ends.set(day.slice(0, 7), day);
    const monthEnds = [...ends.values()].slice(-10), signal = monthEnds.at(-1);
    if (monthEnds.length !== 10 || !signal)
        throw new trading_portfolio_model_1.PortfolioError(422, 'insufficient_history', 'Ten completed calendar month-end closes are required.');
    const j = calendar.indexOf(signal), base = calendar[j - 63];
    if (!base)
        throw new trading_portfolio_model_1.PortfolioError(422, 'insufficient_history', 'The completed monthly signal lacks its quarterly return warmup.');
    const close = (symbol, day) => {
        const n = maps.get(symbol)?.get(day);
        if (n === undefined)
            throw new trading_portfolio_model_1.PortfolioError(422, 'incomplete_history', `${symbol} lacks a required monthly/quarterly signal close.`);
        return n;
    };
    const defensiveReturn = close('BIL', signal) / close('BIL', base) - 1;
    const scored = s.assets.map(a => {
        const last = close(a.symbol, signal), average = monthEnds.reduce((n, d) => n + close(a.symbol, d), 0) / 10;
        return { ...a, eligible: last > average, score: last / close(a.symbol, base) - 1 };
    });
    let weights;
    if (s.kind === 'monthly-trend')
        weights = scored.filter(a => a.eligible).map(({ symbol, weightPct }) => ({ symbol, weightPct }));
    else
        weights = scored.filter(a => a.eligible && a.score > defensiveReturn).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol)).slice(0, 3).map(a => ({ symbol: a.symbol, weightPct: 100 / 3 }));
    const fallback = Math.max(0, 100 - weights.reduce((n, a) => n + a.weightPct, 0));
    if (fallback > 1e-7)
        weights.push({ symbol: 'BIL', weightPct: fallback });
    return { targets: weights, decisionAsOf: signal, monthEnds, rebalanceCadence: 'calendar-monthly', initialAllocationUsesLastCompletedMonth: true };
}
