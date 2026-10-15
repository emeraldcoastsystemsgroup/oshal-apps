/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the native paper tick end to end (TRADE-01) through the package's real route handlers and router, over the in-memory SQL double and a recording prices-intent double: arming, a scheduled tick that buys, the same window again writing nothing, a later window stopping out a fallen holding, the not-armed refusal, the closed-market and price-failure no-ops, disarming, person B never seeing or moving person A's book, and the existing screen reads answering from the paper book only on the native host's railless paper book.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review regression guards: a disarm or a tighter re-arm that lands while a tick is reading prices makes that tick roll back (book_changed) instead of trading; re-arming an open book with a different startingCash is refused; /performance compares SPY over the book's own days, and says the benchmark is unavailable when the archive has no SPY (the real World universe has none).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqlDouble, createIntentDouble } = require('./support/paper-doubles');
const { paperHandlers, createTradingPaperRoutes } = require('../routes/trading-paper-routes');
const { screenRead, statusFields } = require('../routes/paper/screen');

const MON_1035 = new Date('2026-10-05T14:35:15Z');     // Monday 10:35 New York
const MON_1040 = new Date('2026-10-05T14:40:15Z');
const MON_0700 = new Date('2026-10-05T11:00:00Z');     // before the open
const ALICE = 'paper-alice';
const BOB = 'paper-bob';
const req = (sub, body = {}, headers = {}) => ({ oshalCallerSub: sub, body, headers });
const UNIVERSE = ['UPCO', 'DNCO', 'FLAT', 'GONE'];

/**
 * @description A host the tests can move through time: one shared store, one intent double, a settable clock.
 * @returns {object} {db, log, calls, market, handlers(now)}.
 */
function host() {
  const sql = createSqlDouble();
  const clock = { now: MON_1035 };
  const prices = createIntentDouble({
    UPCO: { price: 100, step: 0.005 },
    DNCO: { price: 50, step: -0.005 },
    FLAT: { price: 20, step: 0 },
    SPY: { price: 600, step: 0.001 },
  }, clock);
  const ctx = { pool: sql.pool, intent: prices.intent, newId: (() => { let n = 0; return () => `id-${(n += 1)}`; })() };
  return { ...sql, ...prices, clock, ctx, h: paperHandlers(ctx, () => clock.now) };
}

const armAlice = (t) => t.h.arm(req(ALICE, { universe: UNIVERSE, startingCash: 100000, maxShares: 500, maxNotional: 20000 }));

test('a person who has not armed is refused, and nothing is read or written', async () => {
  const t = host();
  const out = await t.h.tick(req(ALICE, {}, { 'x-oshal-trigger': 'schedule' }));
  assert.equal(out.status, 409);
  assert.equal(out.body.error, 'paper_not_armed');
  assert.equal(t.calls.length, 0, 'no price read before arming');
  assert.equal(t.db.ticks.length + t.db.orders.length, 0);
});

test('arming opens the book and the scheduled tick buys the uptrend at the kernel price', async () => {
  const t = host();
  const armed = await armAlice(t);
  assert.equal(armed.status, 200);
  assert.deepEqual(armed.body.schedule, { app: 'intelligent-trades', name: 'paper-autopilot', route: '/api/trading/paper/tick' });
  assert.equal(armed.body.account.cash, 100000);

  const out = await t.h.tick(req(ALICE, {}, { 'x-oshal-trigger': 'schedule', 'x-oshal-run-id': 'run-1' }));
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.trigger, 'schedule');
  assert.deepEqual(out.body.orders.map((o) => [o.symbol, o.side, o.fillPrice]), [['UPCO', 'buy', 100]]);
  const qty = out.body.orders[0].qty;
  assert.ok(qty > 0 && qty <= 500);
  assert.deepEqual(out.body.summary.missing, ['GONE'], 'a ticker the archive cannot price is reported, never priced');

  assert.deepEqual([...new Set(t.calls.map((c) => c.name))].sort(), ['prices.latest', 'prices.series']);
  assert.deepEqual(t.db.orders.map((o) => [o.user_sub, o.symbol, o.side, o.qty, o.fill_price, o.status]), [[ALICE, 'UPCO', 'buy', qty, 100, 'filled']]);
  assert.equal(t.db.decisions.length, 1);
  assert.equal(t.db.decisions[0].decision_id, t.db.orders[0].decision_id, 'every fill is bound to its decision');
  assert.match(t.db.decisions[0].rationale, /MTF score/);
  assert.deepEqual(t.db.positions.map((p) => [p.symbol, p.qty, p.avg_cost]), [['UPCO', qty, 100]]);
  assert.equal(t.db.account[0].cash, 100000 - qty * 100);
  assert.equal(t.db.account[0].last_tick_window, '2026-10-05T14:35:00.000Z');
  assert.deepEqual(t.db.equity.map((e) => [e.session_date, e.equity]), [['2026-10-05', 100000]]);
  assert.deepEqual(t.db.ticks.map((k) => [k.tick_window, k.trigger_kind, k.run_id, k.outcome]), [['2026-10-05T14:35:00.000Z', 'schedule', 'run-1', 'traded']]);
});

test('a second tick in the same window writes nothing (idempotent per window)', async () => {
  const t = host();
  await armAlice(t);
  await t.h.tick(req(ALICE));
  const before = JSON.stringify(t.db);
  const again = await t.h.tick(req(ALICE, {}, { 'x-oshal-trigger': 'schedule' }));
  assert.equal(again.status, 200);
  assert.equal(again.body.skipped, 'already_ticked');
  assert.equal(JSON.stringify(t.db), before);
});

test('a racing tick that lost the window claim rolls back every write', async () => {
  const t = host();
  await armAlice(t);
  // Another run already claimed this window but this run read the book before it committed.
  t.db.ticks.push({ user_sub: ALICE, tick_window: '2026-10-05T14:35:00.000Z', trigger_kind: 'schedule', run_id: 'other', outcome: 'no_trade', order_count: 0, equity: 100000, summary: '{}', created_at: MON_1035.toISOString() });
  const before = JSON.stringify({ ...t.db, ticks: [] });
  const out = await t.h.tick(req(ALICE));
  assert.equal(out.body.skipped, 'already_ticked');
  assert.equal(JSON.stringify({ ...t.db, ticks: [] }), before);
  assert.ok(t.log.some((l) => l.text === 'ROLLBACK'));
});

test('a later window stops out a holding that fell past the posture\'s stop', async () => {
  const t = host();
  await armAlice(t);
  const first = await t.h.tick(req(ALICE));
  const qty = first.body.orders[0].qty;
  t.market.UPCO.price = 88;            // -12% against a 9% balanced stop
  t.market.UPCO.dayPrice = 100;        // the daily trend is still up, so only the stop can sell it
  t.clock.now = MON_1040;
  const out = await t.h.tick(req(ALICE, {}, { 'x-oshal-trigger': 'schedule' }));
  assert.equal(out.status, 200);
  const sell = out.body.orders.find((o) => o.side === 'sell');
  assert.deepEqual([sell.symbol, sell.qty, sell.fillPrice, sell.reason], ['UPCO', qty, 88, 'stop_loss']);
  assert.equal(sell.realizedPl, Math.round((88 - 100) * qty * 100) / 100);
  assert.equal(t.db.positions.filter((p) => p.symbol === 'UPCO').length, 0);
  assert.equal(t.db.account[0].realized_pl, sell.realizedPl);
});

test('outside the session, or when the price service fails, the tick trades nothing and writes nothing', async () => {
  const t = host();
  await armAlice(t);
  t.clock.now = MON_0700;
  const closed = await t.h.tick(req(ALICE));
  assert.deepEqual([closed.status, closed.body.skipped], [200, 'market_closed']);
  assert.equal(t.calls.length, 0);

  const failing = createIntentDouble({}, { now: MON_1035, fail: true });
  const h = paperHandlers({ pool: t.pool, intent: failing.intent }, () => MON_1035);
  const down = await h.tick(req(ALICE));
  assert.deepEqual([down.status, down.body.error], [503, 'prices_unavailable']);

  const none = await paperHandlers({ pool: t.pool }, () => MON_1035).tick(req(ALICE));
  assert.deepEqual([none.status, none.body.error], [503, 'prices_unavailable']);
  assert.equal(t.db.ticks.length + t.db.orders.length + t.db.positions.length, 0);
});

test('disarming makes the next scheduled tick refuse; positions stay', async () => {
  const t = host();
  await armAlice(t);
  await t.h.tick(req(ALICE));
  const out = await t.h.disarm(req(ALICE));
  assert.deepEqual([out.body.armed, out.body.changed], [false, true]);
  t.clock.now = MON_1040;
  assert.equal((await t.h.tick(req(ALICE, {}, { 'x-oshal-trigger': 'schedule' }))).status, 409);
  assert.equal(t.db.positions.length, 1);
  const rearmed = await t.h.arm(req(ALICE, {}));
  assert.equal(rearmed.body.config.maxShares, 500, 're-arming keeps the guardrails it does not name');
  assert.equal(rearmed.body.account.cash, t.db.account[0].cash, 're-arming keeps the cash');
});

test('person B never sees or moves person A\'s paper book', async () => {
  const t = host();
  await armAlice(t);
  await t.h.tick(req(ALICE));
  const status = await t.h.status(req(BOB));
  assert.deepEqual([status.body.armed, status.body.config, status.body.account, status.body.positions.length], [false, null, null, 0]);
  assert.equal((await t.h.orders(req(BOB))).body.orders.length, 0);
  assert.equal((await t.h.decisions(req(BOB))).body.decisions.length, 0);
  assert.equal((await t.h.tick(req(BOB))).status, 409, 'B cannot run a tick on a book B never armed');
  assert.equal(await screenRead(t.ctx, BOB, { kind: 'paper' }, false, 'ledger'), null);
  for (const table of ['config', 'account', 'positions', 'orders', 'decisions', 'ticks', 'equity']) {
    assert.ok(t.db[table].every((r) => r.user_sub === ALICE), table);
  }
  assert.ok(t.log.filter((l) => l.values.length).every((l) => l.values.includes(ALICE) || l.values.includes(BOB)), 'every statement is bound to the caller');
});

test('the existing screen reads answer from the paper book only on the native host\'s railless paper book', async () => {
  const t = host();
  assert.deepEqual(await statusFields(t.ctx, ALICE, 'default', false), { nativePaper: { available: true, armed: false, opened: false,
    schedule: { app: 'intelligent-trades', name: 'paper-autopilot', route: '/api/trading/paper/tick' }, config: null } });
  assert.equal(await screenRead(t.ctx, ALICE, 'default', false, 'account'), null, 'no paper account yet: the route keeps its 409');
  await armAlice(t);
  await t.h.tick(req(ALICE));
  const status = await statusFields(t.ctx, ALICE, 'default', false);
  assert.deepEqual([status.bookConfigured, status.bookEnabled, status.nativePaper.armed], [true, true, true]);

  const account = await screenRead(t.ctx, ALICE, 'default', false, 'account');
  assert.equal(account.source, 'native-paper');
  assert.equal(account.account.cash, t.db.account[0].cash);
  const ledger = await screenRead(t.ctx, ALICE, { kind: 'paper' }, false, 'ledger');
  assert.deepEqual(ledger.positions.map((p) => [p.symbol, p.qty, p.avgEntryPrice]), [['UPCO', t.db.positions[0].qty, 100]]);
  assert.equal(ledger.orders[0].status, 'filled');
  assert.equal(ledger.governance.UPCO.exitsApply, true);
  const journal = await screenRead(t.ctx, ALICE, null, false, 'journal');
  assert.match(journal.trades[0].rationale, /MTF score/);
  const positions = await screenRead(t.ctx, ALICE, null, false, 'positions');
  assert.equal(positions.positions[0].marketValue, t.db.positions[0].qty * 100);
  const orders = await screenRead(t.ctx, ALICE, null, false, 'orders');
  assert.equal(orders.orders[0].broker, 'native-paper');
  const realized = await screenRead(t.ctx, ALICE, null, false, 'realized', { now: MON_1035 });
  assert.deepEqual([realized.today.trades, realized.last30d.winRatePct], [0, null]);
  const perf = await screenRead(t.ctx, ALICE, null, false, 'performance', { period: '1M', now: MON_1035 });
  assert.equal(perf.summary.equity, 100000);
  assert.ok(perf.spy.length > 0, 'SPY is read through the same prices intent');

  assert.equal(await screenRead(t.ctx, ALICE, { kind: 'live' }, false, 'account'), null, 'a live book never answers from paper');
  assert.equal(await screenRead(t.ctx, ALICE, { kind: 'paper' }, true, 'account'), null, 'a connected broker rail keeps the broker answer');
  assert.equal(await screenRead({ pool: t.pool }, ALICE, { kind: 'paper' }, false, 'account'), null, 'a host without kernel prices keeps its answer');
  assert.deepEqual(await statusFields({ pool: t.pool }, ALICE, { kind: 'paper' }, false), {});
});

test('the router mounts the paper surface and refuses a caller with no admitted identity', async () => {
  const t = host();
  const routes = [];
  const router = { get: (p, fn) => routes.push(['GET', p, fn]), post: (p, fn) => routes.push(['POST', p, fn]) };
  createTradingPaperRoutes(t.ctx, () => router);
  assert.deepEqual(routes.map(([m, p]) => `${m} ${p}`), ['GET /', 'POST /arm', 'POST /disarm', 'POST /tick', 'GET /orders', 'GET /decisions']);
  const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
  const tick = routes.find(([, p]) => p === '/tick')[2];
  const anon = res();
  await tick({ headers: { 'x-oshal-user-sub': ALICE }, body: {} }, anon);
  assert.deepEqual([anon.code, anon.body.error], [401, 'not_authenticated'], 'a header never names the caller');
  const arm = routes.find(([, p]) => p === '/arm')[2];
  const bad = res();
  await arm(req(ALICE, { posture: 'yolo' }), bad);
  assert.deepEqual([bad.code, bad.body.error], [400, 'invalid_paper_config']);
});

/**
 * @description A host whose first prices.latest read waits until released, so a request can land mid-tick.
 * @returns {object} The host plus hold() → a release function.
 */
function heldHost() {
  const t = host();
  let gate = null;
  const intent = async (name, input) => {
    if (gate && name === 'prices.latest') { const g = gate; gate = null; await g.promise; }
    return t.intent(name, input);
  };
  const hold = () => { let release; const promise = new Promise((r) => { release = r; }); gate = { promise }; return release; };
  const ctx = { ...t.ctx, intent };
  return { ...t, ctx, hold, h: paperHandlers(ctx, () => t.clock.now) };
}

test('a disarm, or a tighter re-arm, that lands while a tick is reading prices makes that tick write nothing', async () => {
  for (const change of ['disarm', 'rearm']) {
    const t = heldHost();
    await armAlice(t);
    const release = t.hold();
    const inFlight = t.h.tick(req(ALICE, {}, { 'x-oshal-trigger': 'schedule' }));
    await new Promise((r) => setImmediate(r));
    const answered = change === 'disarm' ? await t.h.disarm(req(ALICE)) : await t.h.arm(req(ALICE, { maxShares: 1 }));
    assert.equal(answered.status, 200);
    release();
    const out = await inFlight;
    assert.deepEqual([out.status, out.body.skipped], [200, 'book_changed'], `${change}: ${JSON.stringify(out.body)}`);
    assert.equal(t.db.orders.length + t.db.positions.length + t.db.ticks.length, 0, `${change}: nothing traded`);
    assert.equal(t.db.account[0].cash, 100000);
  }
});

test('re-arming an open book with a different startingCash is refused; leaving it out keeps the account\'s own', async () => {
  const t = host();
  await armAlice(t);
  await assert.rejects(t.h.arm(req(ALICE, { startingCash: 5000 })), (err) => err.status === 409 && err.code === 'paper_book_open');
  assert.equal(t.db.config[0].starting_cash, 100000, 'the refused re-arm stored nothing');
  const same = await t.h.arm(req(ALICE, { startingCash: 100000, posture: 'conservative' }));
  assert.deepEqual([same.body.config.startingCash, same.body.config.posture, same.body.account.cash], [100000, 'conservative', 100000]);
  const bare = await t.h.arm(req(ALICE, {}));
  assert.equal(bare.body.config.startingCash, bare.body.account.startingCash);
});

test('/performance compares SPY over the book\'s own days, and says so when the archive has no SPY', async () => {
  const t = host();
  await armAlice(t);
  t.market.UPCO.step = 0;                 // nothing to buy: equity stays flat
  t.market.SPY.step = 0.002;              // SPY up 0.2% a day over the whole period
  await t.h.tick(req(ALICE));
  const young = await screenRead(t.ctx, ALICE, null, false, 'performance', { period: '1M', now: MON_1035 });
  assert.equal(young.summary.totalReturnPct, 0);
  assert.equal(young.summary.spyReturnPct, 0, 'a book armed today is compared with SPY from today, not over the month');
  assert.equal(young.summary.vsSpyPct, 0);
  assert.equal(young.summary.benchmark.baseDate, '2026-10-05');

  // Two sessions later SPY is measured from the book's first snapshot close.
  t.db.equity.unshift({ user_sub: ALICE, session_date: '2026-10-01', equity: 100000, cash: 100000, recorded_at: '2026-10-01T20:00:00Z' });
  const older = await screenRead(t.ctx, ALICE, null, false, 'performance', { period: '1M', now: MON_1035 });
  const spy = t.market.SPY.price;
  const expected = Math.round(((spy / (spy / 1.002 ** 4)) - 1) * 10000) / 100;
  assert.equal(older.summary.spyReturnPct, expected);

  delete t.market.SPY;                    // the real World universe carries no SPY
  const none = await screenRead(t.ctx, ALICE, null, false, 'performance', { period: '1M', now: MON_1035 });
  assert.deepEqual(none.spy, []);
  assert.deepEqual([none.summary.spyReturnPct, none.summary.vsSpyPct, none.summary.benchmark.available], [null, null, false]);
  assert.match(none.summary.benchmark.reason, /no SPY/);
});
