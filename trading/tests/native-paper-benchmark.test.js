/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The shipped withSchwabBenchmark fills the paper book's unavailable SPY benchmark from the caller's Schwab day bars (the World archive only holds SPY since the 2026-10-12 cutover, so Reports showed +0.00% S&P), and leaves the payload unchanged when native reads are off, there is no connection, the read fails, the benchmark is already available or the bars do not reach the base date. Bar data is synthetic.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { standIns, loadShipped } = require('./support/native-landing-host');

const load = () => loadShipped(standIns({}), (req) => req('trading-paper-benchmark'));
/** A Schwab daily candle stamped at midnight Central (05:00 UTC in daylight time) of its session date. */
const bar = (date, c) => ({ t: Date.parse(`${date}T05:00:00Z`) / 1000, o: c, h: c, l: c, c, v: 1 });
/** The paper /performance payload as performanceOf answers it when the archive has no base close. */
const unavailable = () => ({
  period: '1M', portfolio: [{ t: 1, pct: 0 }, { t: 2, pct: -4.68 }], spy: [],
  summary: { totalReturnPct: -4.68, spyReturnPct: null, vsSpyPct: null,
    benchmark: { symbol: 'SPY', available: false, baseDate: '2026-09-15', reason: 'The World price archive has no SPY close on or before 2026-09-15.' } },
});

test('unavailable paper benchmark is filled from the caller\'s Schwab SPY day bars', async () => {
  const { withSchwabBenchmark, closesFromBars } = load();
  assert.deepEqual(closesFromBars({ bars: [bar('2026-09-15', 600)] }), [{ date: '2026-09-15', price: 600 }], 'a candle\'s UTC date is its session date');
  const asked = [];
  const reads = { enabled: () => true, chart: async (_ctx, symbol, tf) => { asked.push([symbol, tf]); return { bars: [bar('2026-09-12', 590), bar('2026-09-15', 600), bar('2026-10-15', 612)], source: 'schwab' }; } };
  const perf = await withSchwabBenchmark({}, unavailable(), reads);
  assert.deepEqual(asked, [['SPY', '1Day']]);
  assert.deepEqual([perf.summary.spyReturnPct, perf.summary.vsSpyPct], [2, -6.68]);
  assert.deepEqual([perf.summary.benchmark.available, perf.summary.benchmark.source, perf.summary.benchmark.baseClose], [true, 'schwab', 600]);
  assert.equal(perf.spy.length, 2);
});

test('the unavailable reason stands whenever Schwab cannot cover the period', async () => {
  const { withSchwabBenchmark } = load();
  const bars = { bars: [bar('2026-09-15', 600), bar('2026-10-15', 612)] };
  const cases = [
    ['native reads off', { enabled: () => false, chart: async () => { throw new Error('must not read'); } }],
    ['no Schwab connection', { enabled: () => true, chart: async () => null }],
    ['failed read', { enabled: () => true, chart: async () => { throw new Error('schwab 503'); } }],
    ['bars start after the base date', { enabled: () => true, chart: async () => ({ bars: [bar('2026-09-16', 601)] }) }],
    ['malformed bars', { enabled: () => true, chart: async () => ({ bars: [{ t: 'x', c: -1 }] }) }],
  ];
  for (const [name, reads] of cases) {
    const input = unavailable();
    const perf = await withSchwabBenchmark({}, input, reads);
    assert.equal(perf, input, name);
    assert.equal(perf.summary.spyReturnPct, null, name);
  }
  const available = unavailable();
  available.summary.benchmark = { symbol: 'SPY', available: true, baseDate: '2026-09-15', source: 'world-archive' };
  assert.equal(await withSchwabBenchmark({}, available, { enabled: () => true, chart: async () => bars }), available, 'an available benchmark is not re-read');
});
