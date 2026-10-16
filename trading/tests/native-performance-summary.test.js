/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The shipped Performance summary (tools/ui/view-account.js drawPerformance) says "S&P unavailable" with the server's reason when the benchmark is null, never "+0.00% S&P · +0.00% vs market", and names Schwab when that source filled the line. Page globals are stood in; the payloads are synthetic.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'ui', 'view-account.js'), 'utf8');

/** Run the shipped view with the classic-script globals app.js provides, answering /performance with payload. */
async function summaryFor(payload) {
  const nodes = { perfC: { clientWidth: 600 }, perfMsg: { textContent: '', innerHTML: '' }, perfSum: { innerHTML: '' } };
  const series = { setData: () => {} };
  const chart = { addLineSeries: () => series, timeScale: () => ({ fitContent: () => {} }), applyOptions: () => {}, remove: () => {} };
  const sandbox = {
    document: { documentElement: {} }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class { observe() {} }, $: (id) => nodes[id], RENDER_TOKEN: 1, PERF_PERIOD: '1M',
    tabGen: () => 1, stale: () => false, tabStale: () => false, api: async () => payload,
    pct: (n) => (n >= 0 ? '+' : '') + Number(n || 0).toFixed(2) + '%', esc: (s) => String(s),
  };
  sandbox.LightweightCharts = { createChart: () => chart };
  sandbox.window = sandbox; // a classic script's window is its global object
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  await sandbox.drawPerformance();
  return { sum: nodes.perfSum.innerHTML, msg: nodes.perfMsg.textContent };
}

const portfolio = [{ t: 1, pct: 0 }, { t: 2, pct: -4.68 }];

test('a missing S&P benchmark reads as unavailable with its reason, never a flat +0.00%', async () => {
  const reason = 'The World price archive has no SPY close on or before 2026-09-15.';
  const { sum, msg } = await summaryFor({ portfolio, spy: [], summary: { totalReturnPct: -4.68, spyReturnPct: null, vsSpyPct: null,
    benchmark: { available: false, reason } } });
  assert.match(sum, /-4\.68%<\/strong> you/);
  assert.match(sum, /S&P unavailable/);
  assert.doesNotMatch(sum, /\+0\.00%/);
  assert.doesNotMatch(sum, /vs market/);
  assert.equal(msg, reason);
});

test('a Schwab-filled benchmark shows the S&P and vs-market figures and names the source', async () => {
  const { sum, msg } = await summaryFor({ portfolio, spy: [{ t: 1, pct: 0 }, { t: 2, pct: 2 }], summary: { totalReturnPct: -4.68,
    spyReturnPct: 2, vsSpyPct: -6.68, benchmark: { available: true, source: 'schwab' } } });
  assert.match(sum, /\+2\.00% S&P/);
  assert.match(sum, /-6\.68% vs market/);
  assert.equal(msg, 'S&P 500 line from Schwab daily closes.');
});
