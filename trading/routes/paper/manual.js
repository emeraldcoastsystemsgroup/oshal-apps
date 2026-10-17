/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Manual orders on the native paper book. "Buy a stock" on the paper book failed at Review (POST /decisions/manual answered 502 on an undeclared unique key, and POST /orders had no broker for the native paper book). previewManual prices a market order at the kernel's latest price, checks the book's own share/notional limits and its cash or holding, and records the decision; fillManual fills it once, during the regular session at a fresh price, in one transaction with the engine's own statements. Simulated fills only: nothing here reaches a broker.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | quoteManual: the ticket's GET /quote on the native paper book answers with the stored price its orders are priced at; Look up answered 503 market_data_not_configured, so Next stayed disabled and no paper order could be placed.
 *
 * @module paper/manual
 */
'use strict';

const store = require('./store');
const { quoteFresh, regularSession, etParts } = require('./market');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const refuse = (status, error, message) => ({ status, body: { error, message } });

/**
 * @description The latest stored price for one symbol.
 * @param {object} deps - {intent}.
 * @param {string} symbol - Ticker.
 * @returns {Promise<{price:number, at:string|null}|null>} The quote, or null when the archive has none.
 */
async function quoteOf(deps, symbol) {
  const answer = await deps.intent('prices.latest', { symbols: [symbol] });
  const row = ((answer && answer.prices) || []).find((p) => String(p.symbol).toUpperCase() === symbol);
  return row && Number(row.price) > 0 ? { price: Number(row.price), at: row.at || null } : null;
}

/**
 * @description The share count for a request: explicit shares, or whole shares of a dollar amount.
 * @param {object} input - {qty, notional}.
 * @param {number} price - Reference price.
 * @returns {number} Whole shares (0 when neither is usable).
 */
function sharesFor(input, price) {
  const qty = Number(input.qty);
  if (Number.isInteger(qty) && qty > 0) return qty;
  const notional = Number(input.notional);
  return notional > 0 && price > 0 ? Math.floor(notional / price) : 0;
}

/**
 * @description The book's own limits and the cash or holding the order needs; null when it fits.
 * @param {object} book - {config, account, positions}.
 * @param {string} symbol - Ticker.
 * @param {string} side - buy | sell.
 * @param {number} qty - Shares.
 * @param {number} price - Price.
 * @returns {object|null} A refusal, or null.
 */
function limitsRefusal(book, symbol, side, qty, price) {
  const { config, account, positions } = book;
  if (!(qty > 0)) return refuse(422, 'qty_required', 'Enter at least one whole share (or a dollar amount worth one).');
  if (config.maxShares != null && qty > config.maxShares) {
    return refuse(422, 'guardrail_max_shares', `The paper book allows at most ${config.maxShares} shares per order.`);
  }
  const notional = round2(qty * price);
  if (config.maxNotional != null && notional > config.maxNotional) {
    return refuse(422, 'guardrail_max_notional', `The paper book allows at most $${config.maxNotional} per order; this is $${notional}.`);
  }
  if (side === 'buy' && notional > account.cash) {
    return refuse(422, 'insufficient_cash', `The paper book has $${round2(account.cash)} to spend; this order needs $${notional}.`);
  }
  const held = positions.find((p) => p.symbol === symbol);
  if (side === 'sell' && (!held || held.qty < qty)) {
    return refuse(422, 'insufficient_position', `The paper book holds ${held ? held.qty : 0} ${symbol}; it cannot sell ${qty}.`);
  }
  return null;
}

/**
 * @description Load the person's paper book, or the refusal that it has not started.
 * @param {object} deps - {pool}.
 * @param {string} sub - Caller subject.
 * @returns {Promise<{book?:object, refusal?:object}>} The book or a refusal.
 */
async function loadBook(deps, sub) {
  const account = await store.loadAccount(deps.pool, sub);
  const config = account ? await store.loadConfig(deps.pool, sub) : null;
  if (!account || !config) return { refusal: refuse(409, 'paper_not_started', 'Start the paper book once (Start trading on the account page) before placing paper orders.') };
  return { book: { account, config, positions: await store.loadPositions(deps.pool, sub) } };
}

/**
 * @description Review a manual paper order and record its decision.
 * @param {object} deps - {pool, intent, newId}.
 * @param {string} sub - Caller subject.
 * @param {object} input - {symbol, side, qty, notional, orderType, fireAt, protect, rationale, now}.
 * @returns {Promise<{status:number, body:object}>} The decision payload or a refusal.
 */
async function previewManual(deps, sub, input) {
  const symbol = String(input.symbol || '').toUpperCase();
  const side = input.side === 'sell' ? 'sell' : 'buy';
  if ((input.orderType || 'market') !== 'market' || input.fireAt || input.protect) {
    return refuse(422, 'native_paper_market_only', 'The paper book fills market orders now; limit, stop, timed and protected orders are not available on it yet.');
  }
  const { book, refusal } = await loadBook(deps, sub);
  if (refusal) return refusal;
  const quote = await quoteOf(deps, symbol);
  if (!quote) return refuse(503, 'price_unavailable', `There is no stored price for ${symbol}, so the paper book cannot price this order.`);
  const qty = sharesFor(input, quote.price);
  const limited = limitsRefusal(book, symbol, side, qty, quote.price);
  if (limited) return limited;
  const decisionId = deps.newId();
  const rationale = String(input.rationale || '').trim() || `Operator paper ${side}: ${qty} ${symbol} at market.`;
  await store.recordManualDecision(deps.pool, sub, { decisionId, symbol, side, qty, refPrice: quote.price, quoteAt: quote.at,
    rationale, at: input.now.toISOString() });
  return { status: 200, body: { ok: true, decisionId, createdAt: input.now.toISOString(), book: 'paper', nativePaper: true,
    decision: { action: side, symbol, side, qty, orderType: 'market', timeInForce: 'day', rationale },
    refPrice: quote.price, estNotional: round2(qty * quote.price), requiresConfirm: false } };
}

/**
 * @description The book after one fill: cash, equity, the position and whether it closed.
 * @param {object} book - {account, positions}.
 * @param {object} fill - {symbol, side, qty, price, quoteAt}.
 * @param {string} at - ISO instant.
 * @returns {object} {cash, equity, position, closed, realizedPl}.
 */
function applyFill(book, fill, at) {
  const held = book.positions.find((p) => p.symbol === fill.symbol);
  const notional = round2(fill.qty * fill.price);
  const before = held ? held.qty : 0;
  const qty = fill.side === 'buy' ? before + fill.qty : before - fill.qty;
  const avgCost = fill.side === 'buy' ? (before * (held ? held.avgCost : 0) + fill.qty * fill.price) / qty : held.avgCost;
  const realizedPl = fill.side === 'sell' ? round2((fill.price - held.avgCost) * fill.qty) : null;
  const cash = round2(book.account.cash + (fill.side === 'buy' ? -notional : notional));
  const others = book.positions.filter((p) => p.symbol !== fill.symbol)
    .reduce((s, p) => s + p.qty * (p.lastPrice != null ? p.lastPrice : p.avgCost), 0);
  return { cash, equity: round2(cash + others + qty * fill.price), closed: qty === 0, realizedPl, notional,
    position: { symbol: fill.symbol, qty, avgCost: Math.round(avgCost * 10000) / 10000, price: fill.price, lastPriceAt: fill.quoteAt,
      peak: held ? held.peak : null, openedAt: held ? held.openedAt : at } };
}

/**
 * @description Fill a recorded manual paper decision once, during the regular session at a fresh price.
 * @param {object} deps - {pool, intent, newId}.
 * @param {string} sub - Caller subject.
 * @param {string} decisionId - The decision from previewManual.
 * @param {Date} now - Instant.
 * @returns {Promise<{status:number, body:object}|null>} The order or a refusal; null when it is not a manual paper decision.
 */
async function fillManual(deps, sub, decisionId, now) {
  const decision = await store.loadDecision(deps.pool, sub, decisionId);
  if (!decision || !decision.manual) return null;
  const done = await store.orderForDecision(deps.pool, sub, decisionId);
  if (done) return refuse(409, 'duplicate', 'This paper order was already filled for this decision.');
  if (!regularSession(now)) return refuse(409, 'market_closed', 'Paper orders fill during the regular session (9:30 a.m.–4:00 p.m. ET). Place it then.');
  const { book, refusal } = await loadBook(deps, sub);
  if (refusal) return refusal;
  const quote = await quoteOf(deps, decision.symbol);
  if (!quote || !quoteFresh(quote, now, book.config.maxQuoteAgeMinutes || 20)) {
    return refuse(409, 'stale_price', `The stored ${decision.symbol} price is not recent enough to fill a paper order; try again in a minute.`);
  }
  const limited = limitsRefusal(book, decision.symbol, decision.side, decision.qty, quote.price);
  if (limited) return limited;
  const at = now.toISOString();
  const fill = { symbol: decision.symbol, side: decision.side, qty: decision.qty, price: quote.price, quoteAt: quote.at };
  const next = applyFill(book, fill, at);
  const orderId = deps.newId();
  const written = await store.writeManualFill(deps.pool, sub, { orderId, decisionId, account: book.account, cash: next.cash, equity: next.equity,
    position: next.position, closed: next.closed, sessionDate: etParts(now).date, at,
    fill: { ...fill, notional: next.notional, realizedPl: next.realizedPl } });
  if (!written.written) return refuse(409, 'book_changed', 'The paper book changed while this order was placed; review it again.');
  return { status: 200, body: { ok: true, order: { orderId, decisionId, status: 'filled', symbol: fill.symbol, side: fill.side, qty: fill.qty,
    filledQty: fill.qty, filledAvgPrice: fill.price, notional: next.notional, realizedPl: next.realizedPl, broker: 'native-paper', submittedAt: at } } };
}

/**
 * @description The ticket's quote on the native paper book: the price its orders are priced at.
 * @param {object} deps - {intent}.
 * @param {string} symbol - Upper-case ticker.
 * @param {string} bookRef - The book reference the route answers with.
 * @returns {Promise<{status:number, body:object}>} The quote, or 404 when the archive has no price.
 */
async function quoteManual(deps, symbol, bookRef) {
  const quote = await quoteOf(deps, symbol);
  if (!quote) return refuse(404, 'no_quote', `There is no stored price for ${symbol}.`);
  return { status: 200, body: { symbol, price: quote.price, book: bookRef, asOf: quote.at, source: 'native-paper' } };
}

module.exports = { previewManual, fillManual, quoteManual };
