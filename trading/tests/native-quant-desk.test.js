/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Price reads are paced so the desk cannot crowd out the watcher on Schwab's shared request limit.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A strong rank far below its high carries a caution, and the market condition measures the falling leaders SPY hides.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guards from the first run on real prices: a signal resting on a few eventual winners is Promising, never Holds up; 2022 means the months held in 2022; a result does not depend on read order; the list is led by the best evidence; one bad candle retries a shorter window.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger asked whether anything assesses stocks and finds winners, and nothing did. Guards the Quant desk: factors cannot see the future, the history test's fixed verdict rule, the forward record, the bounded pipeline against a real disposable PostgreSQL, owner isolation, no order path and no authority change.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { Pool, Client } = createRequire(path.resolve(__dirname, '../../scripts/toolchain/package.json'))('pg');
const yaml = createRequire(path.resolve(__dirname, '../../scripts/toolchain/package.json'))('js-yaml');
const { factorsAt, monthlyRows, digestBars, currentFactors, addComposite, PRICE_SIGNALS, MONTH_COLUMNS } = require('../routes/quant/factors');
const { historyTest, verdictFor, compound, maxDrawdown, marketTiming, withoutBiggestWinners, leadingSignal, signalSeries, crossSections } = require('../routes/quant/history');
const { makeCohort, gradeCohort, horizonRecord, forwardBoard, independentWindows } = require('../routes/quant/scoreboard');
const { buildToday, FUNDS } = require('../routes/quant/rank');
const desk = require('../routes/quant/desk');
const { quantHandlers, createTradingQuantRoutes, QUANT_SCHEDULE } = require('../routes/quant/routes');
const { seeded, weekdays, candles } = require('./support/native-quant-doubles');
const root = path.resolve(__dirname, '..');

const SESSION = '2026-10-29', NOW = Date.parse('2026-10-29T22:30:00Z');

/** A rising series with enough days for every factor. */
function rising(n = 300) { return Array.from({ length: n }, (_, i) => 100 * 1.001 ** i); }

test('a factor dated at a session is computed from that session and earlier, and is exact', () => {
  const c = rising(), f = factorsAt(c, 299);
  assert.ok(Math.abs(f.mom12 - (c[278] / c[47] - 1)) < 1e-12, '12 months back to one month back');
  assert.ok(Math.abs(f.rev1 - (c[299] / c[278] - 1)) < 1e-12);
  assert.equal(f.trend, 3, 'above both averages, and the 50-day above the 200-day');
  assert.equal(f.fromHigh, 0, 'a new high');
  assert.equal(factorsAt(c, 251), null, 'under a year of history has no factor');
  const later = [...c]; for (let i = 280; i < later.length; i += 1) later[i] *= 3;
  assert.deepEqual(factorsAt(later, 279), factorsAt(c, 279), 'later prices cannot change an earlier factor');
});

test('a history row cannot see the future: factors stop at the signal, the return starts the session after', () => {
  const dates = weekdays(SESSION, 700), c = dates.map((_, i) => 100 * 1.0005 ** i);
  const rows = monthlyRows(dates, c), col = Object.fromEntries(MONTH_COLUMNS.map((n, i) => [n, i]));
  const row = rows[3], signal = dates.indexOf(row[col.date]);
  assert.ok(dates[signal].slice(0, 7) !== dates[signal + 1].slice(0, 7), 'the signal is the last session of its month');
  const shocked = [...c]; for (let i = signal + 1; i < shocked.length; i += 1) shocked[i] *= 1.5;
  const after = monthlyRows(dates, shocked)[3];
  assert.deepEqual(after.slice(1, col.fwd), row.slice(1, col.fwd), 'prices after the signal never change its factors');
  const entryMoved = [...c]; entryMoved[signal] *= 1.2;
  assert.equal(monthlyRows(dates, entryMoved)[3][col.fwd], row[col.fwd], "the signal day's own close is not the entry price");
  assert.equal(rows.at(-1)[col.fwd], null, 'the newest month has no outcome yet');
  const glitch = [...c]; for (let i = signal + 3; i < glitch.length; i += 1) glitch[i] /= 5;
  assert.equal(monthlyRows(dates, glitch)[3][col.fwd], null, 'a one-day 80% move is a data problem, not a return');
});

test('a digest drops an unfinished bar and keeps what scoring needs', () => {
  const dates = weekdays('2026-10-30', 400), bars = candles(dates, () => 0.001);
  const digest = digestBars('ABC', bars, SESSION);
  assert.equal(digest.asOf, SESSION, 'a bar after the last completed session is not used');
  assert.equal(digest.recent.c.length, 320);
  assert.equal(digest.sessions, 399);
  assert.equal(currentFactors(digest, SESSION).excluded, null);
  assert.equal(currentFactors(digest, '2026-10-30').excluded, 'no-price-for-session');
  assert.equal(currentFactors(digestBars('NEW', candles(weekdays(SESSION, 100), () => 0.001), SESSION), SESSION).excluded, 'too-new');
});

test('the composite is the equal blend of its four parts, chosen in advance', () => {
  const rows = addComposite([
    { symbol: 'BEST', factors: { mom12: 0.9, vsMa200: 0.5, fromHigh: 0, vol: 0.1 } },
    { symbol: 'MID', factors: { mom12: 0.2, vsMa200: 0.1, fromHigh: -0.1, vol: 0.3 } },
    { symbol: 'WORST', factors: { mom12: -0.5, vsMa200: -0.3, fromHigh: -0.5, vol: 0.9 } },
    { symbol: 'GAP', factors: { mom12: null, vsMa200: 0.1, fromHigh: -0.1, vol: 0.3 } },
  ]);
  assert.equal(rows[0].factors.composite, 100);
  assert.equal(rows[2].factors.composite, 0);
  assert.equal(rows[3].factors.composite, null, 'a missing part means no composite, never a guess');
});

/** A market whose stocks keep their own drift (momentum persists) or drift at random each month (no edge). */
function market({ persistent, symbols = 60, sessions = 2400 }) {
  const dates = weekdays(SESSION, sessions), digests = [];
  const spyRandom = seeded(7);
  digests.push(digestBars('SPY', candles(dates, () => 0.0004 + (spyRandom() - 0.5) * 0.01), SESSION));
  for (let s = 0; s < symbols; s += 1) {
    const random = seeded(1000 + s);
    const monthlyDrift = new Map();
    const skill = (s / symbols - 0.5) * 0.004;
    const bars = candles(dates, (i) => {
      const month = dates[i].slice(0, 7);
      if (!monthlyDrift.has(month)) monthlyDrift.set(month, (random() - 0.5) * 0.004);
      return 0.0004 + (persistent ? skill : monthlyDrift.get(month)) + (random() - 0.5) * 0.012;
    });
    digests.push(digestBars(`S${s}`, bars, SESSION));
  }
  return digests;
}

test('the history test finds a real persistent edge, does not invent one, and counts its costs', () => {
  const edge = historyTest(market({ persistent: true }), new Date(NOW).toISOString());
  const momentum = edge.signals.find((s) => s.id === 'momentum');
  assert.equal(momentum.verdict, 'Holds up', JSON.stringify(momentum));
  assert.ok(momentum.annual > momentum.listAnnual, 'beats the same list');
  assert.ok(momentum.months > 80);
  const none = historyTest(market({ persistent: false }), new Date(NOW).toISOString());
  const noEdge = none.signals.find((s) => s.id === 'momentum');
  assert.notEqual(noEdge.verdict, 'Holds up', JSON.stringify(noEdge));
  const short = historyTest(market({ persistent: true, sessions: 800 }), new Date(NOW).toISOString());
  assert.equal(short.signals.find((s) => s.id === 'momentum').verdict, 'Too little history');
  assert.match(edge.limits.join(' '), /today's companies/);
  assert.match(edge.limits.join(' '), /dividends/);
  const spy = new Map([['2020-01', { fwd: 0.01, vsMa200: 0.05 }], ['2020-02', { fwd: 0.02, vsMa200: -0.05 }], ['2020-03', { fwd: -0.2, vsMa200: -0.1 }], ['2020-04', { fwd: 0.1, vsMa200: 0.02 }]]);
  const timing = marketTiming(spy);
  assert.equal(timing.months, 4);
  assert.ok(Math.abs(timing.inMarketPct - 50) < 1e-9, 'in the market only when above its average');
  assert.ok(timing.maxDrawdown > timing.spyMaxDrawdown, 'the rule sidestepped the fall it could see coming');
});

test('a signal resting on a few eventual winners is never called proven, and results do not depend on read order', () => {
  const dates = weekdays(SESSION, 2400), digests = [];
  const spyRandom = seeded(7);
  digests.push(digestBars('SPY', candles(dates, () => 0.0004 + (spyRandom() - 0.5) * 0.01), SESSION));
  for (let s = 0; s < 60; s += 1) {
    const random = seeded(2000 + s), winner = s < 12;
    digests.push(digestBars(`N${s}`, candles(dates, () => 0.0004 + (winner ? 0.0035 : 0) + (random() - 0.5) * 0.012), SESSION));
  }
  const removed = withoutBiggestWinners(digests);
  assert.equal(removed.length, 49, 'the top fifth of 60 is gone and SPY stays');
  assert.ok(removed.some((d) => d.symbol === 'SPY'));
  assert.ok(!removed.some((d) => /^N(0|1|2|3|4|5|6|7|8|9|10|11)$/.test(d.symbol)), 'the planted winners are the ones removed');
  const result = historyTest(digests, new Date(NOW).toISOString()), momentum = result.signals.find((s) => s.id === 'momentum');
  assert.equal(momentum.verdict, 'Promising', JSON.stringify(momentum));
  assert.ok(momentum.withoutWinners.annual < momentum.annual, 'the harsher number is reported next to the flattering one');
  assert.equal(result.curveSignal.id, leadingSignal(result.signals).id, 'the chart follows the leading signal');
  assert.ok(result.curve.at(-1)[3] < result.curve.at(-1)[1], 'and draws it with and without the winners');
  const shuffled = [...digests].reverse();
  const again = historyTest(shuffled, new Date(NOW).toISOString());
  assert.deepEqual(again.signals, result.signals, 'the same records in another order give the same answer');
  assert.equal(leadingSignal([{ id: 'a', verdict: 'Fails', t: 5 }, { id: 'b', verdict: 'Promising', t: 2 }, { id: 'c', verdict: 'Promising', t: 3 }]).id, 'c', 'the list is led by verdict, then strength');
});

test('the 2022 row is the months held in 2022', () => {
  const months = new Map(), spy = new Map();
  for (const month of ['2021-11', '2021-12', '2022-01', '2022-11', '2022-12']) {
    spy.set(month, { fwd: month === '2021-11' || month === '2022-12' ? 0.5 : -0.1, vsMa200: 1 });
    months.set(month, Array.from({ length: 40 }, (_, i) => ({ symbol: `S${i}`, factors: { mom12: i, mom6: i, mom3: i, rev1: i, vsMa200: i, trend: 3, fromHigh: -i / 100, vol: 0.2 }, fwd: spy.get(month).fwd })));
  }
  const series = signalSeries(months, spy).get('momentum'), row = marketTiming(spy);
  assert.equal(series.length, 5);
  assert.equal(row.stress.year2022.months, 3, 'signals from December 2021 to November 2022 are held in 2022');
  assert.ok(Math.abs(row.stress.year2022.spy - (0.9 ** 3 - 1)) < 1e-3, 'the months either side are not counted');
  assert.ok(crossSections([]).size === 0);
});

test('the verdict rule and the arithmetic behind it', () => {
  const ok = { months: 60, mean: 0.01, t: 2.5, firstHalf: 0.01, secondHalf: 0.01 };
  assert.equal(verdictFor(ok), 'Holds up');
  assert.equal(verdictFor({ ...ok, t: 1.9 }), 'Mixed');
  assert.equal(verdictFor({ ...ok, secondHalf: -0.01 }), 'Mixed', 'one good half is not enough');
  assert.equal(verdictFor({ ...ok, mean: -0.001 }), 'Fails');
  assert.equal(verdictFor({ ...ok, months: 35 }), 'Too little history');
  assert.equal(verdictFor(ok, { mean: 0.01, t: 2.1 }), 'Holds up', 'passes with and without the biggest winners');
  assert.equal(verdictFor(ok, { mean: 0.01, t: 1.5 }), 'Promising', 'beats the list only with its winners in');
  assert.equal(verdictFor(ok, { mean: -0.01, t: -1 }), 'Promising');
  assert.equal(verdictFor({ ...ok, t: 1 }, { mean: 0.01, t: 3 }), 'Mixed', 'the harsher test cannot rescue a weak result');
  assert.ok(Math.abs(compound([0.1, -0.1]) - -0.01) < 1e-12);
  assert.ok(Math.abs(maxDrawdown([0.1, -0.5, 0.2]) - -0.5) < 1e-12);
});

/** Scored rows for the forward record. */
function rowsOf(symbols) {
  return symbols.map((symbol, i) => ({ symbol, f: { composite: 100 - i, mom12: 1 - i / 10, vsMa200: 1 - i / 10, fromHigh: -i / 100, vol: 0.1 + i / 100, rev1: i / 10 }, fund: i === 0 ? { revenueYoYPct: 20, netMarginPct: 10 } : i === 1 ? { revenueYoYPct: 50, netMarginPct: -5 } : null, congress: i === 1 ? { buyers: 2, latest: '2026-10-01' } : null }));
}

test('every pick is recorded before its outcome, entered the next session and graded once', () => {
  const sessions = weekdays('2026-12-30', 60), session = sessions[0];
  const cohort = makeCohort(session, rowsOf(['AAA', 'BBB', 'CCC']));
  assert.deepEqual(cohort.picks.composite, ['AAA', 'BBB', 'CCC']);
  assert.deepEqual(cohort.picks['quality-growth'], ['AAA'], 'losing money is not profitable growth');
  assert.deepEqual(cohort.picks.congress, ['BBB']);
  assert.deepEqual(cohort.graded, {}, 'nothing is known when the pick is made');
  const closes = new Map(['SPY', 'AAA', 'BBB', 'CCC'].map((s) => [s, new Map(sessions.map((d, i) => [d, 100 + i * (s === 'AAA' ? 2 : s === 'SPY' ? 1 : 0.5)]))]));
  assert.equal(gradeCohort(cohort, closes, sessions.slice(0, 6)), false, 'five sessions after entry has not arrived');
  assert.equal(gradeCohort(cohort, closes, sessions.slice(0, 7)), true);
  assert.equal(cohort.graded[5].from, sessions[1], 'entered the session after the pick, not at the close it was scored on');
  assert.equal(cohort.graded[5].to, sessions[6]);
  const expected = (100 + 6 * 2) / (100 + 1 * 2) - 1;
  assert.ok(Math.abs(cohort.graded[5].signals.composite.picks[0][1] - expected) < 1e-3);
  assert.equal(cohort.graded[5].signals.composite.beat, 1, 'only AAA beat SPY');
  const frozen = JSON.stringify(cohort.graded[5]);
  closes.get('AAA').set(sessions[6], 1);
  gradeCohort(cohort, closes, sessions);
  assert.equal(JSON.stringify(cohort.graded[5]), frozen, 'a recorded grade never changes');
  assert.ok(cohort.graded[21], 'a later horizon is graded when it arrives');
});

test('overlapping windows are not counted twice, and a verdict waits for enough of them', () => {
  const sessions = weekdays('2027-11-30', 400), cohorts = [];
  const closes = new Map(['SPY', 'AAA'].map((s) => [s, new Map(sessions.map((d, i) => [d, 100 + i * (s === 'AAA' ? 1 : 0.1)]))]));
  for (let i = 0; i < 300; i += 1) {
    const cohort = { session: sessions[i], picks: { composite: ['AAA'] }, list: ['AAA', 'SPY'], graded: {} };
    gradeCohort(cohort, closes, sessions);
    cohorts.push(cohort);
  }
  const windows = independentWindows(cohorts, 21, 'composite');
  assert.equal(windows.length, 14, 'one every 22 sessions, not one a day');
  for (let i = 1; i < windows.length; i += 1) assert.ok(windows[i].grade.from > windows[i - 1].grade.to);
  const record = horizonRecord(cohorts, 21, 'composite');
  assert.ok(record.windows >= 12);
  assert.notEqual(record.verdict, 'Not enough yet');
  assert.equal(horizonRecord(cohorts.slice(0, 100), 21, 'composite').verdict, 'Not enough yet');
  const board = forwardBoard(cohorts, new Date(NOW).toISOString());
  assert.equal(board.signals.find((s) => s.id === 'composite').horizons.length, 3);
  assert.ok(board.latest.best.length);
  assert.ok(board.signals.some((s) => s.id === 'congress'), 'signals with no history are judged by the forward record');
});

test("today's list ranks companies with reasons, says where holdings sit, and never ranks a fund", () => {
  const dates = weekdays(SESSION, 400);
  const digests = ['SPY', 'AAA', 'BBB', 'CCC', 'QQQ'].map((s, i) => digestBars(s, candles(dates, () => (s === 'AAA' ? 0.002 : s === 'BBB' ? -0.001 : 0.0005 + i * 0.00001)), SESSION));
  const today = buildToday({
    session: SESSION, at: new Date(NOW).toISOString(), digests, noData: ['GONE'],
    funds: new Map([['AAA', { revenueYoYPct: 12, netMarginPct: 25 }], ['BBB', { revenueYoYPct: -3, netMarginPct: -8 }]]),
    congress: new Map([['AAA', { symbol: 'AAA', buyers: 2, latest: '2026-10-01' }]]),
    earnings: new Map([['AAA', '2026-11-05']]),
    holdings: new Map([['BBB', { symbol: 'BBB', marketValue: 5000, accounts: ['…1234'] }], ['BIL', { symbol: 'BIL', marketValue: 9000, accounts: ['…1234'] }]]),
  });
  assert.deepEqual(today.rows.map((r) => r.symbol), ['AAA', 'CCC', 'BBB'], 'funds and SPY are not ranked');
  assert.equal(today.rankBy, 'composite', 'the fixed blend is the fallback');
  assert.equal(buildToday({ session: SESSION, at: 'x', digests, rankBy: 'reversal', funds: new Map(), congress: new Map(), earnings: new Map(), holdings: new Map() }).rows[0].symbol, 'BBB', 'ranks by the chosen signal: the biggest recent loser leads a reversal list');
  const [aaa] = today.rows;
  assert.equal(aaa.rank, 1);
  assert.ok(aaa.reasons.some((r) => /12 months before last month/.test(r)));
  assert.ok(aaa.reasons.some((r) => /revenue up 12%, net margin 25%/.test(r)));
  assert.ok(aaa.reasons.some((r) => /Bought by 2 members of Congress/.test(r)));
  assert.ok(aaa.cautions.includes('Earnings 2026-11-05.'));
  const bbb = today.rows.find((r) => r.symbol === 'BBB');
  assert.ok(bbb.cautions.includes('Lost money in its latest annual filing.'));
  assert.ok(bbb.cautions.some((c) => /downtrend/.test(c)));
  assert.equal(bbb.held, true);
  assert.deepEqual(today.holdings.map((h) => [h.symbol, h.status, h.rank]), [['BIL', 'fund', null], ['BBB', 'ranked', 3]]);
  assert.equal(today.market.label, 'Uptrend');
  assert.ok(today.market.listOneDay != null && today.market.fell5PctShare === 0);
  const fallen = (i, n) => (i > n - 30 ? -0.02 : 0.004);
  const leadersDown = ['SPY', 'L1', 'L2', 'L3'].map((s) => digestBars(s, candles(dates, s === 'SPY' ? () => 0.0005 : (i) => fallen(i, dates.length)), SESSION));
  const hit = buildToday({ session: SESSION, at: 'x', digests: leadersDown, rankBy: 'momentum', funds: new Map(), congress: new Map(), earnings: new Map(), holdings: new Map() });
  assert.equal(hit.market.label, 'Uptrend, but its leaders are falling hard', 'SPY can sit near its high while what led it collapses');
  assert.ok(hit.market.leadersFromHigh <= -0.2);
  assert.ok(hit.rows[0].cautions.some((c) => /below its 52-week high: the 12-month figure is older than this fall/.test(c)), 'a strong rank does not hide the fall');
  assert.deepEqual(today.leftOut['no-data'], ['GONE']);
  assert.ok(FUNDS.has('BIL'));
  assert.equal(JSON.stringify(today).match(/\b(BUY|SELL|winner)\b/i), null, 'a ranking is never an instruction');
});

/** A real disposable database with the desk's migration applied. */
async function database(t) {
  const dsn = process.env.OSHAL_TEST_POSTGRES;
  assert.ok(dsn, 'OSHAL_TEST_POSTGRES must name an explicitly disposable PostgreSQL fixture.');
  const base = new URL(dsn);
  assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname) && ['35689', '32768'].includes(base.port), 'Require the declared disposable PostgreSQL fixture');
  const admin = new Client({ connectionString: dsn }); await admin.connect();
  const name = 'quant_' + randomUUID().replaceAll('-', ''); await admin.query('CREATE DATABASE ' + name); base.pathname = '/' + name;
  const pool = new Pool({ connectionString: base.toString() });
  t.after(async () => { await pool.end(); await admin.query('DROP DATABASE ' + name); await admin.end(); });
  for (const file of ['001-trading-watchlist.sql', '012-native-quant-desk.sql']) await pool.query(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'));
  return pool;
}

/** A synthetic Schwab, Congress feed and calendar, with a clock that moves when work is done. */
function world({ configured = true, symbols, spyFails = false } = {}) {
  const dates = weekdays(SESSION, 2400), calls = [], clock = { now: NOW };
  const bars = new Map();
  const barsFor = (symbol) => { if (!bars.has(symbol)) { const r = seeded(symbol.split('').reduce((s, c) => s + c.charCodeAt(0), 0) * 31); bars.set(symbol, candles(dates, () => 0.0005 + (r() - 0.5) * 0.015)); } return bars.get(symbol); };
  const intent = async (name, input) => {
    calls.push({ name, input });
    clock.now += 2000;
    if (name === 'trading.config') return { configured };
    if (name === 'trading.accounts') return { accounts: [{ accountMasked: '…1234', positions: [{ symbol: 'ZZZ', marketValue: 4000 }, { symbol: 'BIL', marketValue: 9000 }, { symbol: 'DUST', marketValue: 3 }] }] };
    if (name === 'feeds.congress_trades') return { source: 'world_congress_trades', trades: input.chamber === 'House' ? [{ ticker: 'CONG', chamber: 'House', direction: 'buy', representative: 'A Member', disclosureDate: '2026-10-10', transactionDate: '2026-10-01', transactionType: 'Purchase', amount: '$1,001 - $15,000', ptrLink: 'https://disclosures-clerk.house.gov/x.pdf', description: 'Common Stock', assetDescription: 'CONG Common Stock' }] : [] };
    if (name === 'feeds.events') return input.entity === 'world:ticker:zzz' ? [{ eventType: 'earnings', scheduledAt: '2026-11-05T21:00:00Z' }] : [];
    if (name === 'trading.bars') {
      if (input.symbol === 'OLDBAD' && input.historyDays > 400) throw new Error('invalid: invalid candle value');
      if (input.symbol !== 'OLDBAD') assert.equal(input.historyDays, desk.HISTORY_DAYS, 'asks for the long history');
      if (spyFails && input.symbol === 'SPY') throw new Error('extended daily history must be 400 to 4000 whole calendar days');
      if (input.symbol === 'GONE') throw new Error('no such instrument');
      return { source: 'schwab', symbol: input.symbol, bars: barsFor(input.symbol) };
    }
    throw new Error('Unexpected intent ' + name);
  };
  const sec = { reads: 0 };
  const overrides = { pauses: [], pause: async (ms) => { overrides.pauses.push(ms); if (ms > 0) clock.now += ms; }, time: () => clock.now, secTickers: async () => ({ 0: { ticker: 'ZZZ', cik_str: 1 }, 1: { ticker: 'AAPL', cik_str: 2 } }), readSec: async (cik, symbol) => { sec.reads += 1; clock.now += 1000; return { symbol, revenueYoYPct: 10, netMarginPct: 20, period: { end: '2025-12-31' } }; } };
  return { calls, clock, intent, sec, overrides, symbols };
}

test('the pipeline resumes across bounded passes against real PostgreSQL, publishes, and keeps owners apart', async (t) => {
  const pool = await database(t), w = world();
  for (const symbol of ['GONE', 'OLDBAD']) await pool.query('INSERT INTO oshal_trading_watchlist (user_sub, symbol, added_at) VALUES ($1,$2,now())', ['alice', symbol]);
  const h = quantHandlers({ pool, intent: w.intent }, w.overrides);
  assert.equal((await h.today('alice', { query: {} })).body.ready, false, 'nothing published before the first run');
  const first = (await h.run('alice')).body;
  assert.equal(first.status, 'working');
  const paced = w.calls.filter((c) => c.name === 'trading.bars').length;
  assert.ok(paced / (desk.PASS_BUDGET_MS / 60000) <= 120, 'a pass stays inside the request limit the watcher shares');
  assert.equal(desk.READ_SPACING_MS, 800, 'at most 75 reads a minute');
  assert.equal(w.calls.find((c) => c.name === 'trading.bars').input.symbol, 'SPY', 'SPY is read first');
  assert.ok(first.progress.read > 0 && first.progress.read < first.progress.total, 'one pass stops at its time budget');
  assert.ok(w.clock.now - NOW <= desk.PASS_BUDGET_MS + 15000, 'a pass stays well inside the 60-second call limit');
  let out = first;
  for (let i = 0; i < 40 && out.status !== 'done'; i += 1) { out = (await h.run('alice')).body; w.clock.now += 300000; }
  assert.equal(out.status, 'done', JSON.stringify(out));
  const reads = w.calls.filter((c) => c.name === 'trading.bars').length;
  assert.equal((await h.run('alice')).body.status, 'done');
  assert.equal(w.calls.filter((c) => c.name === 'trading.bars').length, reads, 'finished work is not repeated');
  const stored = await require('../routes/quant/store').getRecord(pool, 'alice', 'state', 'current');
  await require('../routes/quant/store').putRecord(pool, 'alice', 'state', 'current', { ...stored, engine: desk.ENGINE - 1 });
  w.clock.now += 60000;
  assert.equal((await h.run('alice')).body.status, 'done', 'a changed engine republishes');
  assert.equal(w.calls.filter((c) => c.name === 'trading.bars').length, reads, 'from the stored prices, without reading them again');
  assert.notEqual((await require('../routes/quant/store').getRecord(pool, 'alice', 'state', 'current')).publishedAt, stored.publishedAt);
  const today = (await h.today('alice', { query: {} })).body;
  assert.equal(today.ready, true);
  assert.ok(today.rankBy, 'names the signal it is ranked by');
  assert.equal(today.session, SESSION);
  assert.ok(today.scored > 100, 'a broad list');
  assert.ok(!today.rows.some((r) => FUNDS.has(r.symbol)));
  assert.ok(today.leftOut['no-data'].includes('GONE'), 'a name with no data is reported, not hidden');
  assert.ok(today.rows.some((r) => r.symbol === 'OLDBAD'), 'one unusable old candle retries a shorter window instead of losing the name');
  const held = Object.fromEntries(today.holdings.map((h2) => [h2.symbol, h2]));
  assert.equal(held.ZZZ.status, 'ranked');
  assert.equal(held.BIL.status, 'fund');
  assert.equal(held.DUST, undefined, 'dust is left out');
  assert.equal(today.rows.find((r) => r.symbol === 'ZZZ').earnings, '2026-11-05');
  assert.ok(today.rows.find((r) => r.symbol === 'ZZZ').fund, 'SEC filings reach the list');
  assert.ok(w.sec.reads >= 2);
  const board = (await h.scoreboard('alice', { query: {} })).body;
  assert.equal(board.history.signals.length, PRICE_SIGNALS.length);
  assert.equal(board.forward.cohorts, 1);
  assert.equal(board.forward.graded[5], 0, 'no pick can be graded the night it is made');
  const brief = (await h.today('alice', { query: { view: 'brief' } })).body;
  assert.equal(brief.top.length, 20);
  assert.ok(brief.rankedBy && brief.rankedBy.verdict, 'the concierge can say what the ranking is worth');
  assert.ok(JSON.stringify(brief).length < 60 * 1024, 'fits the concierge reply limit');
  assert.ok(JSON.stringify((await h.scoreboard('alice', { query: { view: 'brief' } })).body).length < 60 * 1024, 'fits the concierge reply limit');
  assert.equal((await h.today('bob', { query: {} })).body.ready, false, 'another owner sees nothing');
  assert.equal((await h.status('bob')).body.progress, null);
  const symbol = (await h.symbol('alice', { params: { symbol: 'zzz' } })).body;
  assert.equal(symbol.row.symbol, 'ZZZ');
  assert.equal((await h.symbol('alice', { params: { symbol: 'not a ticker' } })).status, 400);
  assert.equal(w.calls.filter((c) => !['trading.config', 'trading.accounts', 'trading.bars', 'feeds.congress_trades', 'feeds.events'].includes(c.name)).length, 0, 'read-only intents only');
});

test('the desk stops plainly without Schwab or SPY, and the nightly job respects off', async (t) => {
  const pool = await database(t);
  const off = world({ configured: false }), h = quantHandlers({ pool, intent: off.intent }, off.overrides);
  const none = (await h.run('alice')).body;
  assert.equal(none.status, 'needs-schwab');
  assert.match(none.message, /Connect Schwab/);
  assert.equal(off.calls.some((c) => c.name === 'trading.bars'), false);
  assert.equal((await h.tick('alice')).body.status, 'off', 'the nightly job does nothing until the person turns the desk on');
  assert.equal((await h.settings('alice', { body: { enabled: 'yes' } })).status, 400);
  assert.equal((await h.settings('alice', { body: { enabled: true } })).body.enabled, true);
  assert.equal((await h.status('alice')).body.enabled, true);
  assert.equal((await h.status('bob')).body.enabled, false, "one owner's setting is not another's");
  assert.equal((await h.tick('alice')).body.status, 'needs-schwab', 'on, it tries');
  const broken = world({ spyFails: true }), g = quantHandlers({ pool, intent: broken.intent }, broken.overrides);
  await assert.rejects(g.run('carol'), (e) => e.status === 502 && e.code === 'quant_prices_unavailable' && /SPY/.test(e.message));
  const retry = (await g.status('carol')).body.progress;
  assert.equal(retry.read, 0, 'nothing is marked read, so the next pass retries');
});

test('the router refuses a caller with no admitted identity and a header never names one', async () => {
  const routes = [], router = { get: (p, fn) => routes.push(['GET', p, fn]), post: (p, fn) => routes.push(['POST', p, fn]) };
  createTradingQuantRoutes({ pool: null, intent: null }, () => router);
  assert.deepEqual(routes.map(([m, p]) => `${m} ${p}`), ['GET /status', 'GET /today', 'GET /symbol/:symbol', 'GET /scoreboard', 'POST /settings', 'POST /run', 'POST /tick']);
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await routes.find(([, p]) => p === '/run')[2]({ headers: { 'x-oshal-user-sub': 'alice' }, body: {} }, res);
  assert.deepEqual([res.code, res.body.error], [401, 'not_authenticated']);
});

test('the desk has no order path and changes no authority', () => {
  const dir = path.join(root, 'routes/quant'), intents = new Set();
  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/intent\(\s*['"]([^'"]+)['"]/g)) intents.add(m[1]);
    assert.doesNotMatch(src, /trading\.orders|require\(['"][^'"]*(live\/|trading-native-management|trading-manual-order)/, file);
  }
  assert.deepEqual([...intents].sort(), ['feeds.events', 'trading.accounts', 'trading.bars', 'trading.config']);
  const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
  assert.ok(!manifest.routes.some((r) => /quant/.test(r.module + r.mountPath)), 'a new manifest route would suspend every person schedule');
  const schedule = manifest.schedules.find((s) => s.id === QUANT_SCHEDULE.name);
  assert.equal(schedule.route, QUANT_SCHEDULE.route);
  assert.equal(schedule.runsAs, 'user');
  assert.ok(schedule.timeoutSeconds <= 60, 'the kernel ends a package call at 60 seconds');
  assert.ok(manifest.migrations.includes('migrations/012-native-quant-desk.sql'));
  for (const file of ['routes/live/management.js', 'routes/live/automation.js', 'routes/trading-native-management.js']) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /quant\/|quant-desk/i, file);
});

test('the concierge reads the desk, gives the evidence and never calls a rank an instruction', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
  const tools = new Map(manifest.tools.map((tool) => [tool.name, tool]));
  const declared = { trading_quant_today: 'GET /api/trading/quant/today?view=brief', trading_quant_symbol: 'GET /api/trading/quant/symbol/{input.symbol}', trading_quant_scoreboard: 'GET /api/trading/quant/scoreboard?view=brief', trading_quant_settings: 'POST /api/trading/quant/settings', trading_quant_run: 'POST /api/trading/quant/run' };
  const persona = yaml.load(fs.readFileSync(path.join(root, 'personas/trading-analyst.yaml'), 'utf8'));
  for (const [name, endpoint] of Object.entries(declared)) {
    assert.equal(tools.get(name).executor.apiEndpoint, endpoint);
    assert.equal(tools.get(name).requiresApproval, false);
    assert.equal(persona.authorizations[name], 'auto', name);
    for (const key of ['subject', 'owner', 'tenant', 'user']) assert.equal(tools.get(name).inputSchema.properties[key], undefined, name);
  }
  const p = persona.perspective;
  assert.match(p, /read\s+trading_quant_scoreboard before you describe what a signal is worth/);
  assert.match(p, /"Not enough yet" and "Fails" are answers/);
  assert.match(p, /A rank is research, never a buy or sell instruction and never a promise/);
  assert.match(p, /Do not call a stock a winner/);
});
