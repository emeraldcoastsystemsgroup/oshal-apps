/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Manual orders on the native paper book (routes/paper/manual.js) over the in-memory SQL double and the recording price double: a reviewed market buy is filled once during the session at the latest price (cash, position, order, equity), a second fill is a duplicate, a sell realizes P&L and closes the holding, and the book's limits, cash, holding, market hours, order types and other people's decisions refuse in words with nothing written; through the shipped routes Review and Place reach the paper engine, never a broker. Simulated fills only.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The shipped-route case also drives the ticket's Look up (GET /quote): on the native paper book it answers with the stored price, and a symbol with none says no_quote.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqlDouble, createIntentDouble } = require('./support/paper-doubles');
const { paperHandlers } = require('../routes/trading-paper-routes');
const { previewManual, fillManual } = require('../routes/paper/manual');

const MON_1035 = new Date('2026-10-05T14:35:15Z');   // Monday 10:35 New York
const MON_2200 = new Date('2026-10-06T02:00:00Z');   // Monday 22:00 New York, after the close
const ALICE = 'manual-alice';
const BOB = 'manual-bob';
const req = (sub, body = {}) => ({ oshalCallerSub: sub, body, headers: {} });

function host() {
  const sql = createSqlDouble();
  const clock = { now: MON_1035 };
  const prices = createIntentDouble({ UPCO: { price: 100, step: 0 }, FLAT: { price: 20, step: 0 } }, clock);
  let n = 0;
  const deps = { pool: sql.pool, intent: prices.intent, newId: () => `m-${(n += 1)}` };
  return { ...sql, ...prices, clock, deps, h: paperHandlers(deps, () => clock.now) };
}
const buy = (t, input = {}) => previewManual(t.deps, ALICE, { symbol: 'UPCO', side: 'buy', qty: 10, now: t.clock.now, ...input });

test('a reviewed market buy fills once at the latest price and moves cash, holding, order and equity', async () => {
  const t = host();
  await t.h.arm(req(ALICE, { startingCash: 100000, maxShares: 500, maxNotional: 20000 }));
  const review = await buy(t);
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.deepEqual([review.body.decision.qty, review.body.refPrice, review.body.estNotional, review.body.requiresConfirm], [10, 100, 1000, false]);
  assert.equal(t.db.orders.length, 0, 'review writes no order');
  const placed = await fillManual(t.deps, ALICE, review.body.decisionId, MON_1035);
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  assert.deepEqual([placed.body.order.status, placed.body.order.filledQty, placed.body.order.filledAvgPrice, placed.body.order.broker], ['filled', 10, 100, 'native-paper']);
  const account = t.db.account.find((a) => a.user_sub === ALICE);
  assert.equal(account.cash, 99000);
  assert.equal(account.equity, 100000);
  const pos = t.db.positions.find((p) => p.user_sub === ALICE && p.symbol === 'UPCO');
  assert.deepEqual([pos.qty, pos.avg_cost], [10, 100]);
  assert.equal(t.db.orders.filter((o) => o.decision_id === review.body.decisionId).length, 1);
  const again = await fillManual(t.deps, ALICE, review.body.decisionId, MON_1035);
  assert.deepEqual([again.status, again.body.error], [409, 'duplicate']);
  assert.equal(t.db.orders.length, 1, 'a duplicate writes nothing');
});

test('a sell realizes P&L and closes the holding', async () => {
  const t = host();
  await t.h.arm(req(ALICE, { startingCash: 100000, maxShares: 500, maxNotional: 20000 }));
  await fillManual(t.deps, ALICE, (await buy(t)).body.decisionId, MON_1035);
  t.market.UPCO.price = 110;
  const review = await previewManual(t.deps, ALICE, { symbol: 'UPCO', side: 'sell', qty: 10, now: MON_1035 });
  const sold = await fillManual(t.deps, ALICE, review.body.decisionId, MON_1035);
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.equal(sold.body.order.realizedPl, 100);
  assert.equal(t.db.positions.filter((p) => p.user_sub === ALICE).length, 0, 'the holding closed');
  const account = t.db.account.find((a) => a.user_sub === ALICE);
  assert.deepEqual([account.cash, account.realized_pl], [100100, 100]);
});

test('limits, cash, holding, order types, market hours and other people refuse in words with nothing written', async () => {
  const t = host();
  assert.equal((await buy(t)).body.error, 'paper_not_started', 'a person who never started the book');
  await t.h.arm(req(ALICE, { startingCash: 1500, maxShares: 50, maxNotional: 20000 }));
  for (const [input, error] of [
    [{ qty: 60 }, 'guardrail_max_shares'],
    [{ qty: 20 }, 'insufficient_cash'],
    [{ qty: 0 }, 'qty_required'],
    [{ orderType: 'limit' }, 'native_paper_market_only'],
    [{ fireAt: '2026-10-06T14:00:00Z' }, 'native_paper_market_only'],
    [{ protect: true }, 'native_paper_market_only'],
    [{ side: 'sell', qty: 1 }, 'insufficient_position'],
    [{ symbol: 'NONE' }, 'price_unavailable'],
  ]) {
    const answer = await buy(t, input);
    assert.equal(answer.body.error, error, JSON.stringify(input));
    assert.ok(answer.status >= 400 && answer.body.message.length > 20, error);
  }
  const review = await buy(t, { qty: 5 });
  assert.equal((await fillManual(t.deps, ALICE, review.body.decisionId, MON_2200)).body.error, 'market_closed');
  assert.equal(await fillManual(t.deps, BOB, review.body.decisionId, MON_1035), null, "another person cannot fill Alice's decision");
  assert.equal(await fillManual(t.deps, ALICE, 'not-a-decision', MON_1035), null);
  assert.equal(t.db.orders.length, 0);
  assert.equal(t.db.decisions.filter((d) => d.reason === 'manual').length, 1, 'only the valid review recorded a decision');
});

test('through the shipped routes, Look up, Review and Place on the native paper book reach the paper engine, never a broker', async () => {
  const { standIns, loadShipped, nativeLandingPool } = require('./support/native-landing-host');
  const t = host();
  await t.h.arm(req(ALICE, { startingCash: 100000, maxShares: 500, maxNotional: 20000 }));
  const routes = new Map();
  const gets = new Map();
  const router = { get: (p, fn) => gets.set(p, fn), post: (p, fn) => routes.set(p, fn), patch() {}, delete() {}, use() {} };
  const ctx = { pool: nativeLandingPool({ pool: t.pool }), intent: t.intent };
  loadShipped(standIns({}), (load) => {
    load('trading-manual-order-routes.js').registerTradingManualOrderRoutes(router, ctx);
    load('trading-routes-order-flow-builders.js').registerTradingOrderFlowRoutes(router, ctx, async () => { throw new Error('the broker path must not run'); });
  });
  const post = async (p, body) => {
    const out = { code: 200, body: null };
    const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } };
    await routes.get(p)({ oshalCallerSub: ALICE, userSub: ALICE, query: { book: 'paper' }, params: {}, headers: {}, body }, res);
    return out;
  };
  const get = async (p, query) => {
    const out = { code: 200, body: null };
    const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } };
    await gets.get(p)({ oshalCallerSub: ALICE, userSub: ALICE, query: { book: 'paper', ...query }, params: {}, headers: {} }, res);
    return out;
  };
  // The ticket's Look up: the stored price its orders are priced at (it answered 503 market_data_not_configured).
  const quote = await get('/quote', { symbol: 'UPCO' });
  assert.equal(quote.code, 200, JSON.stringify(quote.body));
  assert.deepEqual([quote.body.symbol, quote.body.price, quote.body.source], ['UPCO', 100, 'native-paper']);
  assert.equal((await get('/quote', { symbol: 'NONE' })).body.error, 'no_quote');
  const review = await post('/decisions/manual', { symbol: 'UPCO', side: 'buy', qty: 3, orderType: 'market', timeInForce: 'day' });
  assert.equal(review.code, 200, JSON.stringify(review.body));
  assert.equal(review.body.nativePaper, true);
  assert.equal(review.body.decision.qty, 3);
  const placed = await post('/orders', { decisionId: review.body.decisionId, requestId: 'tkt-1' });
  const outcome = placed.code === 200 ? placed.body.order.status : placed.body.error;
  assert.ok(['filled', 'market_closed', 'stale_price'].includes(outcome), JSON.stringify(placed.body));
});
