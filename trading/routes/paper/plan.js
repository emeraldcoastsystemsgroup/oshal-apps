/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: one paper autopilot tick as a pure function, in the legacy runAutopilot's order (reference only): mark the book to the kernel's latest prices, roll the trailing peaks, then protective exits (stop-loss / take-profit, trailing stop, cap trim), the short-timeframe breakdown, technical closes and relative-strength rotation, then conviction-sized entries unless the drawdown breaker has tripped. Every fill is simulated at the latest kernel price and only on a fresh quote; a name the archive cannot price is held at its last price and never traded. The result is the complete set of fills, decisions, positions, cash and equity the tick will write.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes. Rotation only benches a holding for a candidate the entry step could actually buy: an unheld candidate counts only with a fresh quote and without a short-timeframe breakdown (the same filter the entries apply), so a hot name with a stale quote no longer liquidates a holding into cash. Rotation is skipped while the drawdown breaker has halted entries, since no replacement buy can follow.
 *
 * @module paper/plan
 */
'use strict';

const { round, realizedVolPct } = require('./algorithms');
const D = require('./decide');
const { quoteFresh } = require('./market');

/** Exit priority when two rules fire on one name: the first listed wins. */
const EXIT_ORDER = ['stop_loss', 'take_profit', 'trailing_stop', 'breakdown', 'technical_sell', 'rotation', 'cap_trim'];

/**
 * @description Mark stored positions to the latest quotes.
 * @param {Array<object>} positions - Stored rows ({symbol, qty, avgCost, lastPrice, lastPriceAt, peak}).
 * @param {object} market - Snapshot from readMarket.
 * @param {Date} now - Tick instant.
 * @param {number} maxAge - Quote freshness bound in minutes.
 * @returns {Array<object>} Marked positions with currentPrice, priced and unrealizedPl.
 */
function markPositions(positions, market, now, maxAge) {
  return positions.filter((p) => p.qty > 0).map((p) => {
    const quote = market.quotes.get(p.symbol);
    const priced = quoteFresh(quote, now, maxAge);
    const currentPrice = priced ? quote.price : (Number(p.lastPrice) || p.avgCost);
    const lastPriceAt = priced ? quote.at : (p.lastPriceAt || null);
    return { ...p, priced, currentPrice, lastPriceAt, unrealizedPl: round((currentPrice - p.avgCost) * p.qty, 2) };
  });
}

/**
 * @description Score every priced name with the multi-timeframe fold.
 * @param {object} market - Snapshot from readMarket.
 * @param {object} params - Strategy parameter overrides.
 * @returns {Map<string, object>} Symbol → decision.
 */
function scan(market, params) {
  const out = new Map();
  for (const [symbol, closesByTf] of market.closes) {
    const quote = market.quotes.get(symbol);
    out.set(symbol, D.decideSymbol(symbol, closesByTf, quote ? quote.price : null, params));
  }
  return out;
}

/**
 * @description Whether an unheld scan decision could be bought this tick (the filter fillEntries applies
 * before sizing): a fresh quote and no short-timeframe breakdown.
 * @param {object} d - Scan decision.
 * @param {object} market - Snapshot from readMarket.
 * @param {Date} now - Tick instant.
 * @param {number} maxAge - Quote freshness bound in minutes.
 * @returns {boolean} True when the entry step may consider it.
 */
function tradeable(d, market, now, maxAge) {
  return !D.isShortTermBreakdown(d) && quoteFresh(market.quotes.get(d.symbol), now, maxAge);
}

/**
 * @description The rotation strength map: every priced holding's own score, plus only the unheld names the
 * entry step could actually buy, so a hot name with a stale quote never benches a holding. A holding with a
 * stale quote is left out entirely: it cannot be benched, and it is not a candidate either.
 * @param {Array<object>} marked - Marked positions.
 * @param {Map<string, object>} decisions - Scan decisions.
 * @param {{market:object, now:Date, maxAge:number}} ctx - Quote freshness inputs.
 * @returns {Map<string, {score:number, action:string}>} Symbol → strength.
 */
function rotationStrength(marked, decisions, ctx) {
  const held = new Set(marked.map((p) => p.symbol));
  const priced = new Set(marked.filter((p) => p.priced).map((p) => p.symbol));
  const out = new Map();
  for (const d of decisions.values()) {
    const keep = held.has(d.symbol) ? priced.has(d.symbol) : tradeable(d, ctx.market, ctx.now, ctx.maxAge);
    if (keep) out.set(d.symbol, { score: d.score, action: d.action });
  }
  return out;
}

/**
 * @description Collect this tick's exits, one per symbol, in priority order.
 * @param {Array<object>} marked - Marked positions.
 * @param {Object<string, number>} peaks - Rolled peaks.
 * @param {Map<string, object>} decisions - Scan decisions.
 * @param {object} policy - Risk policy.
 * @param {number} equity - Book equity.
 * @param {{vol:Object<string, number>, halted:boolean, market:object, now:Date, maxAge:number}} ctx - Daily volatility per
 *   symbol, whether the drawdown breaker halted entries (no rotation then), and the quote freshness inputs.
 * @returns {Array<object>} Exits ({symbol, qty, reason, pnlPct}).
 */
function collectExits(marked, peaks, decisions, policy, equity, ctx) {
  const { vol } = ctx;
  const priced = marked.filter((p) => p.priced);
  const breakdown = priced.filter((p) => decisions.has(p.symbol) && D.isShortTermBreakdown(decisions.get(p.symbol)))
    .map((p) => ({ symbol: p.symbol, qty: p.qty, reason: 'breakdown', pnlPct: D.pnlPctOf(p) }));
  const technical = priced.filter((p) => decisions.has(p.symbol) && decisions.get(p.symbol).action === 'sell')
    .map((p) => ({ symbol: p.symbol, qty: p.qty, reason: 'technical_sell', pnlPct: D.pnlPctOf(p) }));
  const rotation = ctx.halted ? [] : D.rotationBenches(priced, rotationStrength(marked, decisions, ctx), policy);
  const all = [...D.exitsToRun(priced, policy), ...D.trailingExits(priced, peaks, policy, vol), ...breakdown, ...technical,
    ...rotation, ...D.rebalanceTrims(priced, equity, policy)];
  all.sort((a, b) => EXIT_ORDER.indexOf(a.reason) - EXIT_ORDER.indexOf(b.reason));
  const bySym = new Map();
  for (const e of all) if (!bySym.has(e.symbol)) bySym.set(e.symbol, e);
  return [...bySym.values()];
}

/**
 * @description The decision record a fill carries.
 * @param {object|undefined} d - The scan decision for the name (may be absent for a held, unscanned name).
 * @param {string} symbol - Ticker.
 * @param {'buy'|'sell'} action - What the engine did.
 * @param {string} reason - The rule that fired.
 * @param {string} rationale - One sentence on why.
 * @returns {object} The decision record.
 */
function decisionRecord(d, symbol, action, reason, rationale) {
  return { symbol, action, reason, score: d ? d.score : null, confidence: d ? d.confidence : null, regime: d ? d.regime : null,
    rationale, perTimeframe: d ? d.perTimeframe : [] };
}

/**
 * @description Apply exits to the book: simulated sells at the latest price.
 * @param {object} book - Mutable {cash, positions: Map}.
 * @param {Array<object>} exits - Exits to fill.
 * @param {Map<string, object>} decisions - Scan decisions.
 * @returns {Array<object>} The sell fills.
 */
function fillExits(book, exits, decisions) {
  const fills = [];
  for (const e of exits) {
    const p = book.positions.get(e.symbol);
    if (!p || !(e.qty > 0)) continue;
    const qty = Math.min(e.qty, p.qty);
    const price = p.currentPrice;
    const realizedPl = round((price - p.avgCost) * qty, 2);
    book.cash = round(book.cash + qty * price, 2);
    p.qty -= qty;
    p.unrealizedPl = round((p.currentPrice - p.avgCost) * p.qty, 2);
    if (p.qty <= 0) book.positions.delete(e.symbol);
    const rationale = `${e.reason.replace('_', ' ')} at ${e.pnlPct.toFixed(2)}% on cost ${p.avgCost.toFixed(2)}`;
    fills.push({ symbol: e.symbol, side: 'sell', qty, price, notional: round(qty * price, 2), reason: e.reason, realizedPl, quoteAt: p.lastPriceAt,
      decision: decisionRecord(decisions.get(e.symbol), e.symbol, 'sell', e.reason, rationale) });
  }
  return fills;
}

/**
 * @description Apply conviction-sized entries: simulated buys at the latest price.
 * @param {object} book - Mutable {cash, positions: Map}.
 * @param {Map<string, object>} decisions - Scan decisions.
 * @param {object} ctx - {policy, guardrails, equity, exiting:Set, market, now, maxAge, maxOrders, vol}.
 * @returns {{fills:Array<object>, blocked:Array<{symbol:string, why:string}>}} Buy fills and declined candidates.
 */
function fillEntries(book, decisions, ctx) {
  const fills = []; const blocked = [];
  const candidates = [...decisions.values()]
    .filter((d) => d.action === 'buy' && !book.positions.has(d.symbol) && !ctx.exiting.has(d.symbol) && tradeable(d, ctx.market, ctx.now, ctx.maxAge))
    .sort((a, b) => b.confidence - a.confidence || (a.symbol < b.symbol ? -1 : 1));
  for (const d of candidates) {
    if (fills.length >= ctx.maxOrders) break;
    const sized = D.sizeEntry({ symbol: d.symbol, price: d.price, confidence: d.confidence, volPct: ctx.vol[d.symbol] },
      { equity: ctx.equity, cash: book.cash }, [...book.positions.values()], ctx.policy, ctx.guardrails);
    if (!(sized.qty > 0)) { blocked.push({ symbol: d.symbol, why: sized.blocked }); continue; }
    book.cash = round(book.cash - sized.qty * d.price, 2);
    book.positions.set(d.symbol, { symbol: d.symbol, qty: sized.qty, avgCost: d.price, currentPrice: d.price, priced: true,
      lastPriceAt: ctx.market.quotes.get(d.symbol).at, unrealizedPl: 0, peak: d.price, openedAt: ctx.now.toISOString() });
    fills.push({ symbol: d.symbol, side: 'buy', qty: sized.qty, price: d.price, notional: round(sized.qty * d.price, 2), reason: 'entry',
      realizedPl: null, quoteAt: ctx.market.quotes.get(d.symbol).at, decision: decisionRecord(d, d.symbol, 'buy', 'entry', d.rationale) });
  }
  return { fills, blocked };
}

/**
 * @description Plan one paper tick end to end. Pure: the caller supplies the stored book, the market
 * snapshot and the instant, and writes what comes back.
 * @param {object} input - {config, account:{cash, highWater}, positions, market, now}.
 * @returns {object} {fills, positions, cash, equity, highWater, summary}.
 */
function planTick(input) {
  const { config, account, market, now } = input;
  const policy = D.riskPolicy(config.posture);
  const maxAge = config.maxQuoteAgeMinutes;
  const marked = markPositions(input.positions, market, now, maxAge);
  const peaks = D.nextPeaks(marked, Object.fromEntries(marked.map((p) => [p.symbol, p.peak])));
  const equity0 = round(account.cash + marked.reduce((s, p) => s + p.qty * p.currentPrice, 0), 2);
  const decisions = scan(market, config.strategyParams);
  const vol = {};
  for (const [sym, tfs] of market.closes) { const v = realizedVolPct(tfs['1Day'] || []); if (v != null) vol[sym] = v; }
  const halted = D.drawdownHalted(equity0, Math.max(account.highWater || 0, equity0), policy);
  const exits = collectExits(marked, peaks, decisions, policy, equity0, { vol, halted, market, now, maxAge });
  const book = { cash: account.cash, positions: new Map(marked.map((p) => [p.symbol, { ...p, peak: peaks[p.symbol] }])) };
  const sells = fillExits(book, exits, decisions);
  const entries = halted ? { fills: [], blocked: [] } : fillEntries(book, decisions, {
    policy, guardrails: { maxShares: config.maxShares, maxNotional: config.maxNotional }, equity: equity0,
    exiting: new Set(exits.map((e) => e.symbol)), market, now, maxAge, maxOrders: config.maxOrdersPerTick, vol,
  });
  const positions = [...book.positions.values()];
  const equity = round(book.cash + positions.reduce((s, p) => s + p.qty * p.currentPrice, 0), 2);
  const calls = [...decisions.values()].filter((d) => d.action !== 'hold').sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  return {
    fills: [...sells, ...entries.fills], positions, cash: book.cash, equity, highWater: Math.max(account.highWater || 0, equity0, equity),
    summary: { posture: policy.posture, scanned: decisions.size, priced: marked.filter((p) => p.priced).length, held: marked.length,
      buys: entries.fills.length, sells: sells.length, halted, blocked: entries.blocked.slice(0, 10), missing: market.missing,
      calls: calls.slice(0, 10).map((d) => ({ symbol: d.symbol, action: d.action, score: d.score, confidence: d.confidence })) },
  };
}

module.exports = { planTick, markPositions, collectExits, EXIT_ORDER };
