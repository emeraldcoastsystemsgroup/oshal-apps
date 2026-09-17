/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-05 06:40:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guard for the Trends tab's series math over the COMPILED module: daily fold with cumulative P&L, the 50-grade rolling hit/breakeven window, the days-to-verdict projection, grouping, that the module loads with no framework at all (no @/ requires), that it is read-only, and that the compiled router really serves /trends through it.
 * 2026-09-16 00:00:00 | maintainer@emeraldcoastsystemsgroup.com     | The Paper · auto book is a BANKROLL: per-dollar return over the ask PLUS the taker fee, one sized fill per graded row, a zero-stake forward test that never moves, ruin that floors at broke, the configured start, the daily bankroll point, and trendSeries over a recording pool — the book walk is cross-strategy in grading order and is NOT windowed by the Trends window. Plus the structural checks that the compiled SQL reads stake_fraction, the router passes the configured start, and the surface prints the bankroll labelled PAPER.
 *
 * Dependency-free `node --test` suite (store-CI contract) over routes/kalshi-trends.js — the bytes
 * the running framework requires. The Trends tab is only as honest as this math: a wrong rolling
 * window or a projection that never reaches zero would show a strategy "almost proven" forever.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const trends = require(path.join(PKG, 'routes', 'kalshi-trends.js'));
const {
  ROLLING_WINDOW, MIN_GRADED_FOR_VERDICT, dailySeries, daysToVerdict, gradedPerDay, groupByStrategy, quadraticFee,
  DEFAULT_PAPER_BANKROLL, paperBankrollStart, stakeReturn, nextBankroll, bankrollWalk, bankrollReturn, trendSeries,
} = trends;

function row(over) {
  return Object.assign({ strategy: 'calibration', gradedAt: '2026-09-01T12:00:00.000Z', won: true, price: 0.5, pnl: 0.48, brier: 0.1, marketBrier: 0.2 }, over || {});
}

test('daily fold: one point per day, cumulative P&L carries across days, Brier is a running mean', () => {
  const days = dailySeries([
    row({ won: true, price: 0.5, pnl: 0.4825, brier: 0.04, marketBrier: 0.25 }),
    row({ won: false, price: 0.6, pnl: -0.6168, brier: 0.81, marketBrier: 0.36 }),
    row({ won: true, price: 0.9, pnl: 0.0937, brier: 0.01, marketBrier: 0.01 }),
    row({ gradedAt: '2026-09-02T12:00:00.000Z', won: false, price: 0.3, pnl: -0.3147, brier: 0.49, marketBrier: 0.09 }),
  ]);
  assert.equal(days.length, 2);
  assert.equal(days[0].day, '2026-09-01');
  assert.equal(days[0].n, 3);
  assert.equal(days[0].wins, 2);
  assert.ok(Math.abs(days[0].pnl - (0.4825 - 0.6168 + 0.0937)) < 1e-9);
  assert.ok(Math.abs(days[0].cumPnl - days[0].pnl) < 1e-9);
  assert.ok(Math.abs(days[0].brier - (0.04 + 0.81 + 0.01) / 3) < 1e-9);
  assert.equal(days[1].day, '2026-09-02');
  assert.equal(days[1].n, 1);
  assert.ok(Math.abs(days[1].cumPnl - (days[0].pnl - 0.3147)) < 1e-9);
  // Rolling values as of each day's LAST grade, over every grade so far (fewer than the window).
  assert.ok(Math.abs(days[0].rollingHit - 2 / 3) < 1e-9);
  assert.ok(Math.abs(days[1].rollingHit - 2 / 4) < 1e-9);
  const be = (0.5 + quadraticFee(0.5) + 0.6 + quadraticFee(0.6) + 0.9 + quadraticFee(0.9) + 0.3 + quadraticFee(0.3)) / 4;
  assert.ok(Math.abs(days[1].rollingBreakeven - be) < 1e-9);
});

test('the rolling window is the last 50 grades, not the whole history', () => {
  assert.equal(ROLLING_WINDOW, 50);
  const rows = [];
  for (let i = 0; i < 60; i++) {
    // 10 early wins, then 50 losses: the window must show 0% at the end, not 10/60.
    rows.push(row({ gradedAt: `2026-08-${String(1 + Math.floor(i / 3)).padStart(2, '0')}T12:00:00.000Z`, won: i < 10, price: 0.5, pnl: i < 10 ? 0.48 : -0.52 }));
  }
  const days = dailySeries(rows);
  assert.equal(days[days.length - 1].rollingHit, 0);
  assert.ok(Math.abs(days[days.length - 1].rollingBreakeven - (0.5 + quadraticFee(0.5))) < 1e-12);
  assert.ok(Math.abs(days[days.length - 1].cumPnl - (10 * 0.48 - 50 * 0.52)) < 1e-9);
});

test('null Brier samples leave the running mean alone instead of poisoning it', () => {
  const days = dailySeries([row({ brier: null, marketBrier: null }), row({ brier: 0.2, marketBrier: 0.1 }), row({ brier: null, marketBrier: null })]);
  assert.equal(days[0].brier, 0.2);
  assert.equal(days[0].marketBrier, 0.1);
});

test('days-to-verdict: zero at the threshold, projected from the pace, null with no pace', () => {
  assert.equal(MIN_GRADED_FOR_VERDICT, 30);
  assert.equal(daysToVerdict(30, 3), 0);
  assert.equal(daysToVerdict(45, 3), 0);
  assert.equal(daysToVerdict(5, 2.5), 10);
  assert.equal(daysToVerdict(29, 0.5), 2);
  assert.equal(daysToVerdict(5, null), null);
  assert.equal(daysToVerdict(5, 0), null);
});

test('grading pace never divides by less than one day, and needs a first prediction', () => {
  const now = Date.parse('2026-09-05T12:00:00.000Z');
  assert.equal(gradedPerDay(10, '2026-09-05T11:00:00.000Z', now), 10);            // an hour old -> per 1 day
  assert.ok(Math.abs(gradedPerDay(20, '2026-08-26T12:00:00.000Z', now) - 2) < 1e-12); // 10 days -> 2/day
  assert.equal(gradedPerDay(0, '2026-08-26T12:00:00.000Z', now), null);
  assert.equal(gradedPerDay(10, null, now), null);
});

test('grouping keeps each strategy in input order', () => {
  const g = groupByStrategy([row({ strategy: 'b', price: 0.1 }), row({ strategy: 'a' }), row({ strategy: 'b', price: 0.2 })]);
  assert.deepEqual([...g.keys()], ['b', 'a']);
  assert.deepEqual(g.get('b').map((r) => r.price), [0.1, 0.2]);
});

test('the compiled trends module stands alone (no framework requires) and only reads', () => {
  const src = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-trends.js'), 'utf8');
  assert.doesNotMatch(src, /require\("@\//, 'kalshi-trends must not depend on the framework — it loads under plain node');
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/);
  assert.match(src, /FROM kalshi_predictions/);
  assert.match(src, /FROM kalshi_orders/);
});

test('the compiled router serves GET /trends through trendSeries, caller-scoped, with a bounded window', () => {
  const routes = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-routes.js'), 'utf8');
  const i = routes.indexOf("router.get('/trends'");
  assert.ok(i >= 0, 'GET /trends must be mounted');
  const handler = routes.slice(i, i + 900);
  assert.match(handler, /callerSub\)\(req\)/);
  assert.match(handler, /trendSeries\)\(pool/);
  assert.match(handler, /Math\.min\(365/);
});

test('the surface has a Trends tab whose panel and elements exist', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'kalshi.html'), 'utf8');
  assert.ok(html.includes('data-tab="trends"'));
  assert.ok(html.includes('data-panel="trends"'));
  for (const id of ['tr-window', 'tr-books', 'tr-kpis', 'tr-pnl-plot', 'tr-pnl-legend', 'tr-pnl-table', 'tr-hit-plot', 'tr-hit-table']) {
    assert.ok(html.includes(`id="${id}"`), `missing element #${id}`);
  }
  // Every chart has its table twin, and a legend exists for the multi-series line chart.
  assert.match(html, /data-toggle="tr-pnl"/);
  assert.match(html, /data-toggle="tr-hit"/);
  // Categorical hues are assigned by a fixed strategy->slot map, never cycled or generated.
  assert.match(html, /SERIES_SLOT = \{/);
  assert.match(html, /--series-other/);
});

/* ── The Paper · auto book is a BANKROLL ────────────────────────────────────────────────────
   Money is the number people believe, so this half of the suite pins the arithmetic that turns
   a ledger of one-contract grades into a sized paper curve. COST is the ask PLUS Kalshi's taker
   fee, because that is what leaves the bankroll; dividing by the bare ask would make every loss
   look smaller than it was. */

const COST_AT_HALF = 0.5 + quadraticFee(0.5);      // 0.5175
const WIN_AT_HALF = 0.4825;                        // $1 payout − 0.50 ask − 0.0175 fee
const RET_WIN = WIN_AT_HALF / COST_AT_HALF;        // ≈ +0.9324 per dollar staked

test('return per dollar staked is P&L over the ASK PLUS FEE, and a total loss is exactly −1', () => {
  assert.ok(Math.abs(stakeReturn(0.5, WIN_AT_HALF) - RET_WIN) < 1e-12);
  assert.ok(Math.abs(stakeReturn(0.5, -COST_AT_HALF) + 1) < 1e-12);
  // A bare-ask denominator would answer −1.035 here; the fee belongs in the cost, not the loss.
  assert.ok(Math.abs(stakeReturn(0.5, -COST_AT_HALF) - (-COST_AT_HALF / 0.5)) > 1e-3);
  // Nothing to divide by is zero return, never Infinity or NaN.
  assert.equal(stakeReturn(0, 1), 0);
  assert.equal(stakeReturn(Number.NaN, 1), 0);
});

test('a zero-stake forward test never moves the bankroll, and ruin floors at broke', () => {
  assert.equal(nextBankroll(1000, 0, 0.5, WIN_AT_HALF), 1000);
  assert.equal(nextBankroll(1000, undefined, 0.5, WIN_AT_HALF), 1000);
  // A fraction above 1 is clamped to the whole bankroll; a catastrophic loss stops at zero.
  assert.equal(nextBankroll(1000, 5, 0.5, -COST_AT_HALF), 0);
  assert.equal(nextBankroll(0, 0.5, 0.5, WIN_AT_HALF), 0);
  assert.equal(nextBankroll(-5, 0.5, 0.5, WIN_AT_HALF), 0);
  assert.ok(Math.abs(nextBankroll(1000, 0.1, 0.5, WIN_AT_HALF) - 1000 * (1 + 0.1 * RET_WIN)) < 1e-9);
});

test('the walk COMPOUNDS in order and counts how many rows actually staked', () => {
  const walk = bankrollWalk([
    { price: 0.5, pnl: WIN_AT_HALF, stakeFraction: 0.1 },
    { price: 0.5, pnl: -COST_AT_HALF, stakeFraction: 0.2 },
    { price: 0.5, pnl: WIN_AT_HALF, stakeFraction: 0 },
  ], 1000);
  const expected = 1000 * (1 + 0.1 * RET_WIN) * (1 - 0.2);
  assert.ok(Math.abs(walk.bankroll - expected) < 1e-9);
  assert.equal(walk.sized, 2, 'the zero-stake row is not a sized fill');
  assert.equal(walk.start, 1000);
  // An unusable start falls back to the shipped default rather than producing a zero book.
  assert.equal(bankrollWalk([], 0).start, DEFAULT_PAPER_BANKROLL);
  assert.equal(bankrollReturn(1000, 1250), 0.25);
  assert.equal(bankrollReturn(0, 1250), null);
});

test('the starting bankroll is deployment CONFIG, with the shipped default as the fallback', () => {
  assert.equal(paperBankrollStart({}), DEFAULT_PAPER_BANKROLL);
  assert.equal(paperBankrollStart({ KALSHI_PAPER_BANKROLL_START: '2500' }), 2500);
  assert.equal(paperBankrollStart({ KALSHI_PAPER_BANKROLL_START: 'lots' }), DEFAULT_PAPER_BANKROLL);
  assert.equal(paperBankrollStart({ KALSHI_PAPER_BANKROLL_START: '-5' }), DEFAULT_PAPER_BANKROLL);
});

test('every daily point carries the bankroll after that day, flat when nothing was staked', () => {
  const sized = dailySeries([
    row({ gradedAt: '2026-09-01T12:00:00.000Z', won: true, price: 0.5, pnl: WIN_AT_HALF, stakeFraction: 0.1 }),
    row({ gradedAt: '2026-09-02T12:00:00.000Z', won: false, price: 0.5, pnl: -COST_AT_HALF, stakeFraction: 0.2 }),
  ], 1000);
  assert.ok(Math.abs(sized[0].bankroll - 1000 * (1 + 0.1 * RET_WIN)) < 1e-9);
  assert.ok(Math.abs(sized[1].bankroll - sized[0].bankroll * 0.8) < 1e-9);
  // Zero-stake rows (the pre-registered forward tests) leave a flat line, not a missing one.
  const flat = dailySeries([
    row({ gradedAt: '2026-09-01T12:00:00.000Z', won: true, price: 0.5, pnl: WIN_AT_HALF, stakeFraction: 0 }),
    row({ gradedAt: '2026-09-02T12:00:00.000Z', won: false, price: 0.5, pnl: -COST_AT_HALF, stakeFraction: 0 }),
  ], 1000);
  assert.equal(flat[0].bankroll, 1000);
  assert.equal(flat[1].bankroll, 1000);
  // The P&L-per-contract curve is untouched by any of this — it is still the sum of grades.
  assert.ok(Math.abs(flat[1].cumPnl - (WIN_AT_HALF - COST_AT_HALF)) < 1e-9);
});

/** A pool that answers each of trendSeries' SELECTs by matching the query it was actually given. */
function ledgerPool(graded) {
  const asked = [];
  return {
    asked,
    query: async (text, params) => {
      asked.push({ text, params });
      if (/count\(DISTINCT strategy\)/.test(text)) {
        return { rows: [{ strategies: 2, predictions: graded.length, graded: graded.length, pnl: 0 }] };
      }
      if (/FROM kalshi_orders/.test(text)) return { rows: [] };
      if (/GROUP BY strategy/.test(text)) {
        return { rows: [...new Set(graded.map((g) => g.strategy))].map((strategy) => ({
          strategy, pending: 0, graded: graded.filter((g) => g.strategy === strategy).length,
          first_at: '2026-09-01T00:00:00.000Z',
        })) };
      }
      const rows = graded.map((g) => ({
        strategy: g.strategy, graded_at: g.gradedAt, won: g.pnl > 0, price: g.price,
        pnl: g.pnl, brier: null, market_brier: null, stake_fraction: g.stakeFraction,
      }));
      // The per-strategy series is ordered by strategy; the BOOK walk is ordered by grade time.
      if (/ORDER BY strategy, graded_at, id/.test(text)) {
        return { rows: rows.slice().sort((a, b) => a.strategy.localeCompare(b.strategy) || (a.graded_at < b.graded_at ? -1 : 1)) };
      }
      return { rows: rows.slice().sort((a, b) => (a.graded_at < b.graded_at ? -1 : 1)) };
    },
  };
}

test('the Paper · auto BOOK walks every strategy together in grading order, not strategy by strategy', async () => {
  // a wins, b loses, a wins — interleaved in time, so the book compounds differently from either.
  const graded = [
    { strategy: 'a', gradedAt: '2026-09-01T12:00:00.000Z', price: 0.5, pnl: WIN_AT_HALF, stakeFraction: 0.1 },
    { strategy: 'b', gradedAt: '2026-09-02T12:00:00.000Z', price: 0.5, pnl: -COST_AT_HALF, stakeFraction: 0.2 },
    { strategy: 'a', gradedAt: '2026-09-03T12:00:00.000Z', price: 0.5, pnl: WIN_AT_HALF, stakeFraction: 0.1 },
  ];
  const p = ledgerPool(graded);
  const out = await trendSeries(p, { sinceDays: null, nowMs: Date.parse('2026-09-04T00:00:00.000Z'), bankrollStart: 1000 });

  const book = 1000 * (1 + 0.1 * RET_WIN) * (1 - 0.2) * (1 + 0.1 * RET_WIN);
  assert.ok(Math.abs(out.books.paperAuto.bankroll - book) < 1e-9, 'the book is the chronological cross-strategy walk');
  assert.equal(out.books.paperAuto.bankrollStart, 1000);
  assert.equal(out.books.paperAuto.sized, 3);
  assert.ok(Math.abs(out.books.paperAuto.bankrollReturn - (book - 1000) / 1000) < 1e-12);
  assert.match(out.books.paperAuto.note, /PAPER/, 'a sized curve reads as money — the note must say paper');
  assert.equal(out.bankrollStart, 1000);

  const a = out.strategies.find((s) => s.strategy === 'a');
  const b = out.strategies.find((s) => s.strategy === 'b');
  assert.ok(Math.abs(a.bankroll - 1000 * (1 + 0.1 * RET_WIN) * (1 + 0.1 * RET_WIN)) < 1e-9);
  assert.ok(Math.abs(b.bankroll - 800) < 1e-9);
  assert.equal(a.sizedGraded, 2);
  assert.notEqual(Math.round(a.bankroll * 100), Math.round(out.books.paperAuto.bankroll * 100));
  // Real · auto is still the unbuilt book, and it still states its gate.
  assert.equal(out.books.liveAuto.built, false);
  assert.match(out.books.liveAuto.note, /PROVEN/);
});

test('the book bankroll is NOT windowed — picking "last 30 days" must not restart the book', async () => {
  const p = ledgerPool([
    { strategy: 'a', gradedAt: '2026-09-01T12:00:00.000Z', price: 0.5, pnl: WIN_AT_HALF, stakeFraction: 0.1 },
  ]);
  await trendSeries(p, { sinceDays: 30, nowMs: Date.parse('2026-09-04T00:00:00.000Z'), bankrollStart: 1000 });
  const bookQuery = p.asked.find((q) => /ORDER BY graded_at, id/.test(q.text));
  assert.ok(bookQuery, 'the book walk must have its own chronological read');
  assert.doesNotMatch(bookQuery.text, /days'\)::interval/, 'the book read must ignore the Trends window');
  assert.match(bookQuery.text, /stake_fraction/);
  const windowed = p.asked.find((q) => /ORDER BY strategy, graded_at, id/.test(q.text));
  assert.match(windowed.text, /days'\)::interval/, 'the per-strategy series IS windowed');
  assert.deepEqual(windowed.params, ['30']);
});

test('the compiled trends SQL reads the recorded stake, and the router passes the configured start', () => {
  const src = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-trends.js'), 'utf8');
  assert.match(src, /stake_fraction/, 'a sized book cannot be built without the recorded stake');
  const routes = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-routes.js'), 'utf8');
  const i = routes.indexOf("router.get('/trends'");
  const handler = routes.slice(i, i + 900);
  assert.match(handler, /bankrollStart: \(0, kalshi_trends_1\.paperBankrollStart\)\(\)/);
});

test('the surface prints the BANKROLL on the Paper · auto tile and curve, labelled paper', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'kalshi.html'), 'utf8');
  for (const id of ['tr-bank-plot', 'tr-bank-legend', 'tr-bank-table', 'tr-bank-tip']) {
    assert.ok(html.includes(`id="${id}"`), `missing element #${id}`);
  }
  assert.match(html, /data-toggle="tr-bank"/, 'every chart has its table twin');
  // The tile's big number is the bankroll, not the one-contract sum it used to be.
  assert.match(html, /bookTile\('Paper \\u00b7 auto', 'on', money\(pa\.bankroll\)/);
  assert.match(html, /PAPER bankroll from/);
  // "must stay labelled paper everywhere — a sized curve reads as money" (the backlog entry).
  assert.match(html, /<b>Paper bankroll<\/b> <span class="meta">&mdash; PAPER MONEY, never an order/);
  assert.match(html, /Paper bankroll — sized, paper money, no order placed/);
});
