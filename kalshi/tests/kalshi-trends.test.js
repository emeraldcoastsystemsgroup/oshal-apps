/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-05 06:40:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guard for the Trends tab's series math over the COMPILED module: daily fold with cumulative P&L, the 50-grade rolling hit/breakeven window, the days-to-verdict projection, grouping, that the module loads with no framework at all (no @/ requires), that it is read-only, and that the compiled router really serves /trends through it.
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
