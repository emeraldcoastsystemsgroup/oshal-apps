"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planSymbols = planSymbols;
exports.readPlanQuotes = readPlanQuotes;
const trading_portfolio_model_1 = require("./trading-portfolio-model");
const trading_portfolio_plan_1 = require("./trading-portfolio-plan");
const trading_portfolio_rotation_1 = require("./trading-portfolio-rotation");
/** Every held instrument participates in the preview, including names outside the saved strategy. */
function planSymbols(account, config) {
    if (!Array.isArray(account.positions) || account.positions.length > 200)
        throw new trading_portfolio_model_1.PortfolioError(422, 'plan_holdings_incomplete', 'A preview requires all reported holdings together, up to 200 positions. None are omitted.');
    const symbols = [...new Set([...(0, trading_portfolio_rotation_1.portfolioStrategySymbols)(config).map(trading_portfolio_plan_1.canonicalPlanSymbol), ...account.positions.map(p => (0, trading_portfolio_plan_1.canonicalPlanSymbol)(p.symbol))])].sort();
    if (symbols.length > 200)
        throw new trading_portfolio_model_1.PortfolioError(422, 'plan_quote_limit', 'The complete preview exceeds 200 unique instruments. No partial preview is produced.');
    return symbols;
}
/** Read groups of fifty through the existing intent; no URL, owner or credential can come from a request. */
async function readPlanQuotes(ctx, connection, symbols) {
    const host = ctx;
    if (!host.intent)
        throw new trading_portfolio_model_1.PortfolioError(503, 'plan_quotes_unavailable', 'The current caller has no native quote service.');
    const intent = host.intent, quotes = [], deadline = Date.now() + 45000;
    for (let offset = 0; offset < symbols.length; offset += 50) {
        if (Date.now() > deadline)
            throw new trading_portfolio_model_1.PortfolioError(504, 'plan_quote_timeout', 'Quote reads exceeded the preview time budget. No incomplete preview was stored.');
        const requested = symbols.slice(offset, offset + 50), answer = await intent('trading.quotes', { connection, symbols: requested });
        if (answer?.source !== 'schwab' || !Array.isArray(answer.quotes) || answer.quotes.length !== requested.length)
            throw new trading_portfolio_model_1.PortfolioError(502, 'plan_quotes_incomplete', 'Schwab did not return the complete quote roster. No holding is dropped.');
        const seen = new Set();
        for (const q of answer.quotes) {
            const symbol = (0, trading_portfolio_plan_1.canonicalPlanSymbol)(q?.symbol);
            if (!requested.includes(symbol) || seen.has(symbol))
                throw new trading_portfolio_model_1.PortfolioError(502, 'plan_quotes_invalid', 'The quote response contains a different or duplicated instrument.');
            seen.add(symbol);
            quotes.push({ symbol, tradePrice: q.tradePrice, tradeAt: q.tradeAt, source: q.source, delayed: q.delayed });
        }
    }
    return { connection, quotes, source: 'schwab', readAt: new Date().toISOString() };
}
