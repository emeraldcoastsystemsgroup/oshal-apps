/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: unit guards for the native paper engine's decision rules (TRADE-01): the ensemble and multi-timeframe fold, the regime gate, the breakdown signature, stop-loss / take-profit, the trailing stop, the cap trim, rotation, conviction sizing within the person's guardrails, the drawdown breaker, the session clock and the tick planner's handling of stale quotes. Plain node:test; nothing outside the package is imported.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review regression guards: short timeframes alone (no 1Week regime) hold with the regime reported missing; every declared timeframe is reachable through readMarket from the kernel's bounded windows (the dead 3Month view); the NYSE early closes end the session at 13:00; rotation never benches a holding for a stale-quoted candidate, and never while the drawdown breaker halts entries.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../routes/paper/algorithms');
const D = require('../routes/paper/decide');
const M = require('../routes/paper/market');
const { planTick } = require('../routes/paper/plan');
const { trend } = require('./support/paper-doubles');

const tfs = (step, last = 100) => ({ '5Min': trend(last, step / 10, 80), '1Hour': trend(last, step / 3, 60), '1Day': trend(last, step, 150), '1Week': trend(last, step * 5, 30) });
const pos = (symbol, qty, avgCost, currentPrice, extra = {}) => ({ symbol, qty, avgCost, currentPrice, priced: true, unrealizedPl: (currentPrice - avgCost) * qty, ...extra });

test('the ensemble is deterministic and a steady climb votes buy on every algorithm that fires', () => {
  const closes = trend(100, 0.005, 120);
  const a = A.ensemble(A.scoreSymbol('UP', closes));
  const b = A.ensemble(A.scoreSymbol('UP', closes));
  assert.deepEqual(a, b);
  assert.equal(a.action, 'buy');
  assert.ok(a.votes.every((v) => v.dir === 'up'), JSON.stringify(a.votes));
  assert.equal(A.ensemble([]).action, 'hold');
});

test('the multi-timeframe fold buys an aligned uptrend, sells an aligned downtrend and holds without history', () => {
  const up = D.decideSymbol('UP', tfs(0.005), 100);
  assert.equal(up.action, 'buy');
  assert.ok(up.regime > 0 && up.score > 0.2, up.rationale);
  const down = D.decideSymbol('DN', tfs(-0.005), 100);
  assert.equal(down.action, 'sell');
  const thin = D.decideSymbol('NEW', { '1Day': trend(100, 0.01, 10) }, 100);
  assert.equal(thin.action, 'hold');
  assert.equal(thin.perTimeframe.length, 0);
  assert.match(thin.rationale, /4 timeframe\(s\) without enough history/);
  assert.equal(thin.regime, null);
});

test('without a 1Week regime the short timeframes alone never trade, and the regime is reported missing, not 0', () => {
  const short = { '5Min': trend(100, 0.002, 80), '1Hour': trend(100, 0.002, 60) };
  const up = D.decideSymbol('AAA', short, 100);
  assert.ok(up.score > 0.2, `the short timeframes alone are bullish (${up.score})`);
  assert.equal(up.action, 'hold', up.rationale);
  assert.equal(up.regime, null);
  assert.match(up.rationale, /regime missing/);
  const down = D.decideSymbol('BBB', { '5Min': trend(100, -0.002, 80), '1Hour': trend(100, -0.002, 60), '1Day': trend(100, -0.005, 150) }, 100);
  assert.ok(down.score < -0.2, String(down.score));
  assert.equal(down.action, 'hold', 'a technical sell needs the regime too');
  const withRegime = D.decideSymbol('AAA', { ...short, '1Week': trend(100, 0.01, 30) }, 100);
  assert.equal(withRegime.action, 'buy', withRegime.rationale);
});

test('every timeframe the fold weighs is reachable from the kernel\'s bounded price windows', async () => {
  const now = new Date('2026-10-05T14:35:15Z');
  // The double serves the windows readMarket asks for, capped at the kernel's own bounds (day <= 365, raw <= 400).
  const { createIntentDouble } = require('./support/paper-doubles');
  const prices = createIntentDouble({ AAA: { price: 100, step: 0.005 } }, { now });
  const market = await M.readMarket(prices.intent, ['AAA']);
  const d = D.decideSymbol('AAA', market.closes.get('AAA'), 100);
  assert.deepEqual(d.perTimeframe.map((v) => v.timeframe), D.TF_WEIGHTS.map((w) => w.tf), d.rationale);
  for (const call of prices.calls.filter((c) => c.name === 'prices.series' && c.input.interval === 'day')) assert.ok(call.input.days <= 365);
  assert.ok(Math.abs(D.TF_WEIGHTS.reduce((s, w) => s + w.weight, 0) - 1) < 1e-9, 'the weights sum to 1');
  assert.ok(D.HIGHER_TFS.every((tf) => D.TF_WEIGHTS.some((w) => w.tf === tf)), 'the regime timeframe is one the fold weighs');
});

test('the regime gate vetoes a buy when the weekly trend leans against it', () => {
  const closes = { ...tfs(0.006), '1Week': trend(100, -0.03, 30) };
  const d = D.decideSymbol('X', closes, 100);
  assert.ok(d.regime < -0.05, String(d.regime));
  assert.notEqual(d.action, 'buy');
});

test('a breakdown needs both short timeframes decisively bearish', () => {
  const d = { perTimeframe: [{ timeframe: '5Min', action: 'sell', score: -0.5 }, { timeframe: '1Hour', action: 'sell', score: -0.4 }] };
  assert.equal(D.isShortTermBreakdown(d), true);
  assert.equal(D.isShortTermBreakdown({ perTimeframe: [d.perTimeframe[0]] }), false);
  assert.equal(D.isShortTermBreakdown({ perTimeframe: [d.perTimeframe[0], { timeframe: '1Hour', action: 'sell', score: -0.1 }] }), false);
});

test('stop-loss and take-profit fire on the position\'s own cost and never on an unpriced position', () => {
  const policy = D.riskPolicy('balanced');
  const exits = D.exitsToRun([pos('LOSS', 10, 100, 90), pos('WIN', 10, 100, 121), pos('MID', 10, 100, 104), pos('STALE', 10, 100, 50, { priced: false })], policy);
  assert.deepEqual(exits.map((e) => [e.symbol, e.reason]), [['LOSS', 'stop_loss'], ['WIN', 'take_profit']]);
});

test('the trailing stop arms past its gain and fires on a volatility-scaled giveback from the peak', () => {
  const policy = D.riskPolicy('balanced');   // arm 8%, giveback 4%
  const p = pos('TR', 5, 100, 111);
  assert.deepEqual(D.trailingExits([p], { TR: 116 }, policy).map((e) => e.reason), ['trailing_stop']);
  assert.equal(D.trailingExits([p], { TR: 113 }, policy).length, 0, 'giveback below 4%');
  assert.equal(D.trailingExits([p], { TR: 116 }, policy, { TR: 6 }).length, 0, 'a volatile name gets 3x the room');
  assert.deepEqual(D.nextPeaks([p], { TR: 105 }), { TR: 111 });
});

test('a cap trim sells only the excess and never flattens', () => {
  const policy = D.riskPolicy('balanced');   // 5% per name
  const trims = D.rebalanceTrims([pos('BIG', 100, 50, 100)], 100000, policy);
  assert.deepEqual(trims.map((t) => [t.symbol, t.qty, t.reason]), [['BIG', 50, 'cap_trim']]);
  assert.equal(D.rebalanceTrims([pos('ONE', 1, 50, 100000)], 100000, policy)[0], undefined);
});

test('rotation benches a cold holding only for a much hotter unheld buy', () => {
  const policy = D.riskPolicy('balanced');
  const strength = new Map([['COLD', { score: -0.1, action: 'hold' }], ['HOT', { score: 0.6, action: 'buy' }]]);
  assert.deepEqual(D.rotationBenches([pos('COLD', 3, 10, 10)], strength, policy).map((e) => e.symbol), ['COLD']);
  strength.set('HOT', { score: 0.25, action: 'buy' });
  assert.equal(D.rotationBenches([pos('COLD', 3, 10, 10)], strength, policy).length, 0);
});

test('sizing scales with conviction and is clipped by the person\'s max shares, max notional and cash', () => {
  const policy = D.riskPolicy('balanced');
  const account = { equity: 100000, cash: 100000 };
  const guard = { maxShares: 100, maxNotional: 1e9 };
  assert.deepEqual(D.sizeEntry({ symbol: 'AAPL', price: 100, confidence: 1 }, account, [], policy, guard), { qty: 50, notional: 5000 });
  assert.equal(D.sizeEntry({ symbol: 'AAPL', price: 100, confidence: 1 }, account, [], policy, { maxShares: 7, maxNotional: 1e9 }).qty, 7);
  assert.equal(D.sizeEntry({ symbol: 'AAPL', price: 100, confidence: 1 }, account, [], policy, { maxShares: 100, maxNotional: 1234 }).qty, 12);
  assert.equal(D.sizeEntry({ symbol: 'AAPL', price: 100, confidence: 1 }, { equity: 100000, cash: 250 }, [], policy, guard).qty, 2);
  assert.match(D.sizeEntry({ symbol: 'AAPL', price: 100, confidence: 1 }, { equity: 100000, cash: 50 }, [], policy, guard).blocked, /insufficient cash/);
  assert.match(D.sizeEntry({ symbol: 'AAPL', price: 100, confidence: 1 }, account, [pos('AAPL', 1, 100, 100)], policy, guard).blocked, /already holding/);
  const sector = Array.from({ length: 5 }, (_, i) => pos(['MSFT', 'NVDA', 'AMD', 'ORCL', 'CRM'][i], 44, 100, 100));
  assert.match(D.sizeEntry({ symbol: 'AAPL', price: 100, confidence: 1 }, account, sector, policy, guard).blocked, /sector cap/);
});

test('the drawdown breaker halts entries at the posture\'s limit', () => {
  const policy = D.riskPolicy('balanced');   // 12%
  assert.equal(D.drawdownHalted(87000, 100000, policy), true);
  assert.equal(D.drawdownHalted(90000, 100000, policy), false);
  assert.equal(D.drawdownHalted(1, 0, policy), false);
});

test('the session clock follows New York regular hours and the tick window is five minutes', () => {
  assert.equal(M.regularSession(new Date('2026-10-05T14:35:00Z')), true);   // Mon 10:35 EDT
  assert.equal(M.regularSession(new Date('2026-10-05T13:25:00Z')), false);  // 09:25 EDT
  assert.equal(M.regularSession(new Date('2026-10-05T20:00:00Z')), false);  // 16:00 EDT
  assert.equal(M.regularSession(new Date('2026-10-10T15:00:00Z')), false);  // Saturday
  assert.equal(M.tickWindow(new Date('2026-10-05T14:37:59Z')), '2026-10-05T14:35:00.000Z');
  assert.deepEqual(M.resample([{ bucket: '2026-10-05T00:00', price: 1 }, { bucket: '2026-10-06T00:00', price: 2 }, { bucket: '2026-10-12T00:00', price: 3 }], M.weekKey), [2, 3]);
});

test('the NYSE early closes end the session at 13:00 New York', () => {
  assert.equal(M.regularSession(new Date('2026-11-27T17:55:00Z')), true);   // Fri after Thanksgiving 12:55 EST
  assert.equal(M.regularSession(new Date('2026-11-27T18:15:00Z')), false);  // 13:15 EST: closed
  assert.equal(M.regularSession(new Date('2026-12-24T18:10:00Z')), false);  // Thu Dec 24 13:10 EST
  assert.equal(M.regularSession(new Date('2026-12-23T18:10:00Z')), true);   // an ordinary Wednesday
  assert.equal(M.regularSession(new Date('2025-07-03T17:30:00Z')), false);  // Thu Jul 3 2025 13:30 EDT
  assert.equal(M.regularSession(new Date('2025-11-28T18:15:00Z')), false);  // Fri after Thanksgiving 2025
  assert.equal(M.earlyClose('2026-07-03'), false, 'on a Friday July 3 is the observed holiday, not a half day');
  assert.equal(M.earlyClose('2026-11-26'), false, 'Thanksgiving itself is a full holiday');
});

/**
 * @description Plan one tick with the scan stubbed to fixed decisions (the rotation rules, isolated from the algorithms).
 * @param {Object<string, {action:string, score:number, at:string}>} names - Symbol → decision and quote instant.
 * @param {{cash:number, highWater:number}} account - Book.
 * @param {Date} now - Tick instant.
 * @returns {object} The plan.
 */
function stubbedPlan(names, account, now) {
  const real = D.decideSymbol;
  D.decideSymbol = (symbol, closes, price) => ({ symbol, price, action: names[symbol].action, score: names[symbol].score,
    confidence: Math.abs(names[symbol].score), regime: 0.3, perTimeframe: [], rationale: 'stub' });
  try {
    const market = { quotes: new Map(Object.entries(names).map(([s, n]) => [s, { price: s === 'HELD' ? 100 : 50, at: n.at }])),
      closes: new Map(Object.keys(names).map((s) => [s, {}])), missing: [] };
    const config = { posture: 'balanced', maxShares: 100, maxNotional: 1e9, maxOrdersPerTick: 8, maxQuoteAgeMinutes: 20 };
    return planTick({ config, account, positions: [{ symbol: 'HELD', qty: 50, avgCost: 100, lastPrice: 100, peak: 100 }], market, now });
  } finally {
    D.decideSymbol = real;
  }
}

test('rotation never benches a holding for a candidate it could not buy, nor while the drawdown breaker halts entries', () => {
  const now = new Date('2026-10-05T14:35:15Z');
  const fresh = new Date(now.getTime() - 60000).toISOString();
  const stale = new Date(now.getTime() - 90 * 60000).toISOString();
  const fills = (plan) => plan.fills.map((f) => [f.symbol, f.side, f.reason]);
  const book = { cash: 95000, highWater: 100000 };
  assert.deepEqual(fills(stubbedPlan({ HELD: { action: 'hold', score: 0, at: fresh }, HOT: { action: 'buy', score: 0.6, at: stale } }, book, now)), [],
    'a hot candidate with a stale quote leaves the holding alone');
  assert.deepEqual(fills(stubbedPlan({ HELD: { action: 'hold', score: 0, at: fresh }, HOT: { action: 'buy', score: 0.6, at: fresh } }, book, now)),
    [['HELD', 'sell', 'rotation'], ['HOT', 'buy', 'entry']], 'a fresh candidate still rotates in');
  const halted = stubbedPlan({ HELD: { action: 'hold', score: 0, at: fresh }, HOT: { action: 'buy', score: 0.6, at: fresh } }, { cash: 95000, highWater: 120000 }, now);
  assert.equal(halted.summary.halted, true);
  assert.deepEqual(fills(halted), [], 'no rotation when no entry can follow');
});

test('the planner never trades on a stale quote and prices every fill at the latest kernel price', () => {
  const now = new Date('2026-10-05T14:35:00Z');
  const fresh = new Date(now.getTime() - 60000).toISOString();
  const stale = new Date(now.getTime() - 3 * 3600000).toISOString();
  const market = {
    quotes: new Map([['UP', { price: 100, at: fresh }], ['OLD', { price: 50, at: stale }], ['HELD', { price: 80, at: stale }]]),
    closes: new Map([['UP', tfs(0.005)], ['OLD', tfs(0.005, 50)], ['HELD', tfs(-0.005, 80)]]), missing: [],
  };
  const config = { posture: 'balanced', maxShares: 100, maxNotional: 1e9, maxOrdersPerTick: 8, maxQuoteAgeMinutes: 20 };
  const plan = planTick({ config, account: { cash: 100000, highWater: 100000 }, positions: [{ symbol: 'HELD', qty: 10, avgCost: 100, lastPrice: 95, peak: 100 }], market, now });
  assert.deepEqual(plan.fills.map((f) => [f.symbol, f.side, f.price]), [['UP', 'buy', 100]]);
  const held = plan.positions.find((p) => p.symbol === 'HELD');
  assert.equal(held.qty, 10, 'a stale held name is neither stopped out nor sold');
  assert.equal(held.currentPrice, 95, 'and is valued at its last recorded price, not the stale quote');
  assert.equal(plan.cash, 100000 - plan.fills[0].qty * 100);
});
