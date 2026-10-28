"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePortfolioStrategy = normalizePortfolioStrategy;
exports.simulatePortfolio = simulatePortfolio;
exports.portfolioNextTargets = portfolioNextTargets;
/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Validate monthly signal history through its actual decision cutoff while retaining latest assessment dates and complete required prior history.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Add fixed calendar-month defensive research without changing version1 models; retain decision dates and fallback coverage.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Freeze next-session targets using the same allocation/trend/momentum rules over complete completed-session history.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reproducible native portfolio research: prior-session signals, explicit trading/financing costs, retirement leverage refusal, benchmark and drawdown over verified daily-price coverage.
 */
const trading_portfolio_model_1 = require("./trading-portfolio-model");
const trading_portfolio_calendar_1 = require("./trading-portfolio-calendar");
const trading_portfolio_rotation_1 = require("./trading-portfolio-rotation");
const fail = (code, message) => { throw new trading_portfolio_model_1.PortfolioError(422, code, message); };
const DAY = 86400000;
function numberIn(value, low, high, name, integer = false) {
    const n = (0, trading_portfolio_model_1.measured)(value);
    if (n === null || n < low || n > high || (integer && !Number.isInteger(n)))
        return fail('strategy_invalid', `${name} must be ${integer ? 'an integer ' : ''}between ${low} and ${high}.`);
    return n;
}
/** Each supported field has an explicit model meaning; unknown knobs cannot silently disappear. */
function normalizePortfolioStrategy(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return fail('strategy_invalid', 'A strategy configuration is required.');
    const c = raw;
    const keys = ['modelVersion', 'kind', 'assets', 'lookbackSessions', 'rebalanceSessions', 'topN', 'grossExposurePct',
        'transactionCostBps', 'marginAprPct', 'maintenancePct', 'fractionalShares'];
    if (Object.keys(c).some(key => !keys.includes(key)) || ![1, 2].includes(Number(c.modelVersion)) || typeof c.modelVersion !== 'number')
        return fail('strategy_invalid', 'Use the supported portfolio model fields; unsupported strategy knobs cannot be ignored.');
    if (!(c.modelVersion === 1 ? ['allocation', 'trend', 'momentum'] : ['monthly-trend', 'quarterly-rotation']).includes(String(c.kind)))
        return fail('strategy_invalid', 'Choose a supported model and its matching version.');
    if (!Array.isArray(c.assets) || c.assets.length < 1 || c.assets.length > 20)
        return fail('strategy_invalid', 'Select one to twenty assets.');
    const assets = c.assets.map(rawAsset => {
        const a = rawAsset;
        if (!a || typeof a !== 'object' || Object.keys(a).some(key => !['symbol', 'weightPct'].includes(key))
            || typeof a.symbol !== 'string' || !/^[A-Z][A-Z0-9./-]{0,15}$/.test(a.symbol))
            return fail('strategy_invalid', 'Use valid uppercase equity/fund symbols.');
        return { symbol: a.symbol, weightPct: numberIn(a.weightPct, 0.01, 100, 'Asset weight') };
    });
    if (new Set(assets.map(a => a.symbol)).size !== assets.length)
        return fail('strategy_invalid', 'Assets must have distinct symbols.');
    if (assets.reduce((sum, a) => sum + a.weightPct, 0) > 100.000001)
        return fail('strategy_invalid', 'Asset weights may total at most 100%; the remainder stays in cash.');
    if (typeof c.fractionalShares !== 'boolean')
        return fail('strategy_invalid', 'Choose whole or fractional share modeling.');
    const grossExposurePct = numberIn(c.grossExposurePct, 0, 200, 'Gross exposure');
    const normalized = { modelVersion: c.modelVersion, kind: c.kind, assets,
        lookbackSessions: numberIn(c.lookbackSessions, 20, 252, 'Lookback sessions', true),
        rebalanceSessions: numberIn(c.rebalanceSessions, 1, 63, 'Rebalance sessions', true),
        topN: numberIn(c.topN, 1, assets.length, 'Top asset count', true), grossExposurePct,
        transactionCostBps: numberIn(c.transactionCostBps, 0, 100, 'One-way trading cost in basis points'),
        marginAprPct: grossExposurePct > 100 ? numberIn(c.marginAprPct, 0, 100, 'Assumed margin APR') : null,
        maintenancePct: grossExposurePct > 100 ? numberIn(c.maintenancePct, 25, 100, 'Assumed maintenance equity percentage') : null,
        fractionalShares: c.fractionalShares };
    if (c.modelVersion === 2 && (c.marginAprPct !== null || c.maintenancePct !== null))
        return fail('strategy_invalid', 'Monthly defensive models cannot contain borrowing assumptions.');
    (0, trading_portfolio_rotation_1.validateMonthlyRotation)(normalized);
    return normalized;
}
function date(value) {
    const t = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value + 'T00:00:00Z') : NaN;
    if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== value)
        return fail('window_invalid', 'Use valid calendar dates in YYYY-MM-DD format.');
    return t;
}
function priceMap(rows, symbol) {
    if (!Array.isArray(rows) || rows.length > 2000)
        return fail('price_data_invalid', `${symbol} has missing or excessive daily history.`);
    const out = new Map();
    for (const row of rows) {
        date(row.date);
        if ((0, trading_portfolio_model_1.measured)(row.close) === null || row.close <= 0 || out.has(row.date))
            return fail('price_data_invalid', `${symbol} has invalid or duplicate daily prices.`);
        out.set(row.date, row.close);
    }
    return out;
}
function prepare(strategy, input) {
    const start = date(input.startDate), end = date(input.endDate);
    if (start >= end || end - start > 370 * DAY)
        return fail('window_invalid', 'Select a historical window of at most one year.');
    numberIn(input.startingCapital, 100, 1000000000, 'Starting capital');
    if (strategy.grossExposurePct > 100 && input.leverageAllowed !== true)
        return fail('retirement_or_cash_leverage_refused', 'Borrowing scenarios require a confirmed taxable margin account.');
    const symbols = [...new Set([...(0, trading_portfolio_rotation_1.portfolioStrategySymbols)(strategy), 'SPY'])];
    const maps = new Map(symbols.map(symbol => [symbol, priceMap(input.series[symbol], symbol)]));
    const available = [...maps.get('SPY').keys()].sort();
    const earliest = available[0];
    if (!earliest || earliest > input.startDate)
        return fail('insufficient_history', 'Benchmark history does not cover the requested start.');
    const calendar = (0, trading_portfolio_calendar_1.sessionDates)(earliest < '2024-01-01' ? '2024-01-01' : earliest, input.endDate);
    const sessions = (0, trading_portfolio_calendar_1.sessionDates)(input.startDate, input.endDate);
    if (sessions.length < 60)
        return fail('insufficient_history', 'At least 60 actual benchmark sessions are required in the selected window.');
    const first = calendar.indexOf(sessions[0]);
    const warmup = (0, trading_portfolio_rotation_1.portfolioWarmupSessions)(strategy);
    if (first < warmup)
        return fail('insufficient_history', 'History does not cover the strategy warmup before the selected window.');
    const required = calendar.slice(first - warmup, calendar.indexOf(sessions[sessions.length - 1]) + 1);
    for (const [symbol, prices] of maps)
        if (required.some(day => !prices.has(day)))
            return fail('incomplete_history', `${symbol} is missing an actual session; the model does not manufacture prices or drop holdings.`);
    return { maps, calendar, sessions, first };
}
/** Signals only inspect sessions strictly before the session whose close supplies a simulated fill. */
function targets(strategy, maps, calendar, index) {
    if (strategy.modelVersion === 2)
        return (0, trading_portfolio_rotation_1.monthlyRotationTargets)(strategy, maps, calendar, index).targets;
    if (strategy.kind === 'allocation')
        return strategy.assets;
    const prior = calendar[index - 1], base = calendar[index - strategy.lookbackSessions];
    const scored = strategy.assets.map(asset => {
        const history = calendar.slice(index - strategy.lookbackSessions, index).map(day => maps.get(asset.symbol).get(day));
        const last = maps.get(asset.symbol).get(prior);
        return { ...asset, score: last / maps.get(asset.symbol).get(base) - 1, aboveTrend: last >= history.reduce((a, b) => a + b, 0) / history.length };
    });
    if (strategy.kind === 'trend')
        return scored.filter(asset => asset.aboveTrend);
    const chosen = scored.filter(asset => asset.score > 0).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol)).slice(0, strategy.topN);
    const weight = chosen.length ? strategy.assets.reduce((sum, a) => sum + a.weightPct, 0) / chosen.length : 0;
    return chosen.map(asset => ({ symbol: asset.symbol, weightPct: weight }));
}
function previousSession(sessions, offset) { return sessions[Math.max(0, offset - 1)]; }
function marked(book, prices) {
    const gross = [...book.qty].reduce((sum, [symbol, qty]) => sum + Math.abs(qty * prices.get(symbol)), 0);
    return { gross, equity: book.cash + gross };
}
/** Sell first; fees are real cash debits in the model, and unlevered buys stay cash-funded. */
function rebalance(book, prices, weights, s) {
    const equity = Math.max(0, marked(book, prices).equity), fees = s.transactionCostBps / 10000;
    const desired = new Map();
    for (const target of weights) {
        const qty = equity * s.grossExposurePct / 100 * target.weightPct / 100 / prices.get(target.symbol);
        desired.set(target.symbol, s.fractionalShares ? qty : Math.floor(qty));
    }
    const trades = [...new Set([...book.qty.keys(), ...desired.keys()])].map(symbol => ({ symbol,
        qty: (desired.get(symbol) ?? 0) - (book.qty.get(symbol) ?? 0) })).sort((a, b) => a.qty - b.qty);
    for (const trade of trades) {
        const price = prices.get(trade.symbol);
        const affordable = Math.max(0, book.cash) / (price * (1 + fees));
        const qty = trade.qty <= 0 || s.grossExposurePct > 100 ? trade.qty
            : Math.min(trade.qty, s.fractionalShares ? affordable : Math.floor(affordable));
        if (Math.abs(qty) < 1e-9)
            continue;
        const cost = Math.abs(qty * price) * fees;
        book.cash -= qty * price + cost;
        book.fees += cost;
        book.trades++;
        book.qty.set(trade.symbol, (book.qty.get(trade.symbol) ?? 0) + qty);
    }
}
function metrics(curve, startingCapital) {
    let peak = startingCapital, maxDrawdownPct = 0, previous = startingCapital;
    const returns = curve.map(point => {
        peak = Math.max(peak, point.equity);
        maxDrawdownPct = Math.max(maxDrawdownPct, (peak - point.equity) / peak * 100);
        const change = previous > 0 ? point.equity / previous - 1 : null;
        previous = point.equity;
        return change;
    }).filter((r) => r !== null);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
    return { totalReturnPct: (curve[curve.length - 1].equity / startingCapital - 1) * 100, maxDrawdownPct,
        sharpeZeroRiskFree: variance > 0 ? mean / Math.sqrt(variance) * Math.sqrt(252) : null };
}
/** Research only: a stored result is never an instruction to a broker or an account arming action. */
function simulatePortfolio(raw, input) {
    const s = normalizePortfolioStrategy(raw), data = prepare(s, input);
    const book = { cash: input.startingCapital, qty: new Map(), fees: 0, interest: 0, trades: 0 };
    const benchmark = { cash: input.startingCapital, qty: new Map(), fees: 0, interest: 0, trades: 0 };
    const curve = [];
    const rebalances = [];
    let maintenanceTriggered = false, previousDay = data.sessions[0];
    for (const [offset, day] of data.sessions.entries()) {
        const prices = new Map([...data.maps].map(([symbol, p]) => [symbol, p.get(day)]));
        const interest = Math.max(0, -book.cash) * (s.marginAprPct ?? 0) / 100 * (date(day) - date(previousDay)) / DAY / 365;
        book.cash -= interest;
        book.interest += interest;
        previousDay = day;
        const mark = marked(book, prices);
        if (mark.equity <= 0 || (mark.gross > 0 && s.maintenancePct !== null && mark.equity / mark.gross * 100 < s.maintenancePct)) {
            rebalance(book, prices, [], s);
            maintenanceTriggered = true;
        }
        const due = offset === 0 || (s.modelVersion === 2 ? day.slice(0, 7) !== previousSession(data.sessions, offset).slice(0, 7) : offset % s.rebalanceSessions === 0);
        if (!maintenanceTriggered && due) {
            const weights = targets(s, data.maps, data.calendar, data.first + offset);
            rebalance(book, prices, weights, s);
            rebalances.push({ fillDate: day, decisionAsOf: s.modelVersion === 2 ? (0, trading_portfolio_rotation_1.monthlyRotationTargets)(s, data.maps, data.calendar, data.first + offset).decisionAsOf : data.calendar[data.first + offset - 1], targets: weights });
        }
        if (offset === 0)
            rebalance(benchmark, prices, [{ symbol: 'SPY', weightPct: 100 }], { ...s, grossExposurePct: 100 });
        const now = marked(book, prices);
        if (![now.equity, now.gross, book.cash].every(Number.isFinite))
            return fail('simulation_invalid', 'The simulation produced nonfinite balances.');
        curve.push({ date: day, equity: now.equity, cash: book.cash, gross: now.gross, benchmark: marked(benchmark, prices).equity });
    }
    const stats = metrics(curve, input.startingCapital), base = metrics(curve.map(p => ({ date: p.date, equity: p.benchmark })), input.startingCapital);
    return { model: s.modelVersion === 2 ? 'portfolio-monthly-v2' : 'portfolio-daily-v1', researchOnly: true, realOrdersPlaced: 0, config: s,
        window: { requestedStart: input.startDate, requestedEnd: input.endDate, firstSession: data.sessions[0], lastSession: data.sessions[data.sessions.length - 1], sessions: data.sessions.length },
        startingCapital: input.startingCapital, metrics: { ...stats, benchmarkReturnPct: base.totalReturnPct, excessPriceReturnPct: stats.totalReturnPct - base.totalReturnPct },
        costs: { transactionCostBps: s.transactionCostBps, tradingUsd: book.fees, financingUsd: book.interest, marginAprPct: s.marginAprPct, calendarDayFinancing: true },
        trades: book.trades, maintenanceTriggered, curve, rebalances,
        assumptions: ['Historical daily price returns from a fresh cash allocation, not actual account performance; dividends, distributions, taxes and contributions are excluded.',
            s.modelVersion === 2 ? 'Signals use ten completed calendar month-end closes; quarterly rotation ranks63-session returns against BIL. Initial allocation uses the last completed month; later trades occur on the first session of each month. Weekly monitoring does not execute protective exits.' : 'Signals use prior-session data; simulated fills use the next session close.',
            'Trading costs, share rounding, margin APR and maintenance percentage are explicit model assumptions.',
            'Broker product eligibility, security-specific margin rules and execution availability are not established by this simulation. Universe selection can introduce survivorship bias; historical simulation is not an untouched out-of-sample test.'] };
}
/**
 * @description Freeze the next daily rebalance targets from completed history, using the same
 * allocation/trend/momentum rules as the historical model. No fill-session price enters a signal.
 * @param raw Saved immutable strategy configuration.
 * @param series Caller-authorized daily prices.
 * @param latest Last independently completed NYSE session.
 * @returns Targets and the precise completed signal date; missing warmup/session data refuses.
 */
function portfolioNextTargets(raw, series, latest) {
    const config = normalizePortfolioStrategy(raw), symbols = [...new Set([...(0, trading_portfolio_rotation_1.portfolioStrategySymbols)(config), 'SPY'])];
    const maps = new Map(symbols.map(symbol => [symbol, priceMap(series[symbol], symbol)]));
    const earliest = [...maps.get('SPY').keys()].sort()[0];
    if (!earliest || earliest > latest)
        return fail('insufficient_history', 'No completed signal history is available.');
    const calendar = (0, trading_portfolio_calendar_1.sessionDates)(earliest < '2024-01-01' ? '2024-01-01' : earliest, latest);
    if (calendar.at(-1) !== latest)
        return fail('signal_session_invalid', 'The signal date must be a completed NYSE session.');
    const needed = Math.max(1, (0, trading_portfolio_rotation_1.portfolioWarmupSessions)(config));
    if (calendar.length < needed)
        return fail('insufficient_history', 'The next rebalance lacks its complete signal warmup.');
    const evidenceThrough = (0, trading_portfolio_rotation_1.portfolioSignalHistoryEnd)(config, latest);
    for (const [symbol, prices] of maps)
        if (calendar.slice(-needed).filter(day => day <= evidenceThrough).some(day => !prices.has(day)))
            return fail('incomplete_history', `${symbol} is missing a required completed signal session.`);
    const monthly = config.modelVersion === 2 ? (0, trading_portfolio_rotation_1.monthlyRotationTargets)(config, maps, calendar, calendar.length) : null;
    return { signalAsOf: latest, decisionAsOf: monthly?.decisionAsOf ?? latest, rebalanceCadence: monthly?.rebalanceCadence ?? 'session-count', model: config.modelVersion === 2 ? 'portfolio-monthly-v2' : 'portfolio-daily-v1', targets: monthly?.targets ?? targets(config, maps, calendar, calendar.length) };
}
