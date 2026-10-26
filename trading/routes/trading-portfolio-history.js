"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.portfolioHistory = portfolioHistory;
const trading_portfolio_model_1 = require("./trading-portfolio-model");
const trading_portfolio_calendar_1 = require("./trading-portfolio-calendar");
const trading_portfolio_rotation_1 = require("./trading-portfolio-rotation");
async function portfolioHistory(ctx, connection, strategy, start, end, now = new Date()) {
    (0, trading_portfolio_calendar_1.validDay)(start);
    (0, trading_portfolio_calendar_1.validDay)(end);
    const latest = (0, trading_portfolio_calendar_1.lastCompletedSession)(now), nowMs = now.getTime();
    if (start >= end || end > latest || Date.parse(end) - Date.parse(start) > 370 * 86400000 || Date.parse(start) < nowMs - 700 * 86400000)
        throw new trading_portfolio_model_1.PortfolioError(422, 'window_invalid', 'Choose a completed historical window of at most one year within the available history.');
    const host = ctx;
    if (!host.intent)
        throw new trading_portfolio_model_1.PortfolioError(503, 'history_unavailable', 'Caller-authorized price history is unavailable.');
    const intent = host.intent;
    const symbols = [...new Set([...(0, trading_portfolio_rotation_1.portfolioStrategySymbols)(strategy), 'SPY'])], series = {};
    const earliestNeeded = Date.parse(start) - Math.ceil((0, trading_portfolio_rotation_1.portfolioWarmupSessions)(strategy) * 1.6 + 20) * 86400000;
    const ends = [nowMs];
    if (earliestNeeded < nowMs - 380 * 86400000)
        ends.push(nowMs - 350 * 86400000);
    const deadline = Date.now() + 90000;
    const readSymbol = async (symbol) => {
        const rows = new Map();
        for (const endMs of ends) {
            if (Date.now() > deadline)
                throw new trading_portfolio_model_1.PortfolioError(504, 'history_timeout', 'Historical reads exceeded their time budget. Narrow the asset universe and retry.');
            const answer = await intent('trading.bars', { symbol, timeframe: '1Day', connection, end: Math.floor(endMs) });
            if (answer.symbol !== symbol || answer.source !== 'schwab' || !Array.isArray(answer.bars) || answer.bars.length > 10000)
                throw new trading_portfolio_model_1.PortfolioError(502, 'history_invalid', `${symbol} history did not provide the expected source and symbol.`);
            for (const bar of answer.bars) {
                if ((0, trading_portfolio_model_1.measured)(bar.t) === null || (0, trading_portfolio_model_1.measured)(bar.c) === null || bar.c <= 0)
                    throw new trading_portfolio_model_1.PortfolioError(502, 'history_invalid', `${symbol} contains malformed daily prices.`);
                const date = new Date(bar.t * 1000).toISOString().slice(0, 10);
                if (date > latest)
                    continue;
                const old = rows.get(date);
                if (old !== undefined && old !== bar.c)
                    throw new trading_portfolio_model_1.PortfolioError(409, 'history_changed', `${symbol} history changed between reads. Retry the backtest.`);
                rows.set(date, bar.c);
            }
        }
        series[symbol] = [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close }));
    };
    for (let offset = 0; offset < symbols.length; offset += 2) {
        const results = await Promise.allSettled(symbols.slice(offset, offset + 2).map(readSymbol));
        const failed = results.find(r => r.status === 'rejected');
        if (failed)
            throw failed.reason;
    }
    return { series, source: 'schwab', readAt: now.toISOString(), lastCompletedSession: latest, priceBasis: 'provider daily closes; no total-return adjustment asserted' };
}
