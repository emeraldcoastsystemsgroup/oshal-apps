/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The shipped Research Congress panel (tools/ui/view-research.js) sends a chamber/party choice to the server (GET /reports/congress?chamber=&party=&view=trades) rather than filtering only the newest 50 trades in the page, shows the matching trades with their filer, and says "no trades match" instead of the unfiltered summary when none do. Page globals are stood in; the payloads are synthetic.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'ui', 'view-research.js'), 'utf8');
const SUMMARY = { status: 'ok', rows: [{ symbol: 'NVDA', net: -1, buys: 0, sells: 1, disclosureDate: '2026-10-14T00:00:00.000Z' }],
  trades: [{ ticker: 'NVDA', representative: 'Daniel Meuser', party: 'Republican', chamber: 'House', direction: 'sell', disclosureDate: '2026-10-14' }] };
const SENATE = { status: 'ok', view: 'trades', rows: [],
  trades: [{ ticker: 'AAPL', representative: 'Jane Senator', party: 'Democrat', chamber: 'Senate', direction: 'buy', disclosureDate: '2026-10-13' }] };
const NONE = { ...SUMMARY, trades: [] };

/** Run the shipped view with stood-in globals; `answer(url)` is what GET <url> returns. */
function panel(answer) {
  const asked = [];
  const listeners = {};
  const wrap = { innerHTML: '' };
  const host = {
    id: 'rsCongress', attrs: {},
    set innerHTML(html) { this.html = html; const at = html.indexOf('<div id="cgTableWrap">'); wrap.innerHTML = at < 0 ? '' : html.slice(at); },
    get innerHTML() { return this.html; },
    getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { listeners[type] = fn; }, querySelector: () => wrap, querySelectorAll: () => [], contains: () => true,
  };
  const sandbox = {
    $: (id) => (id === 'rsCongress' ? host : null), RENDER_TOKEN: 1, tabGen: () => 1, stale: () => false, tabStale: () => false,
    esc: (v) => String(v), api: async (url) => { asked.push(url); return answer(url); }, console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { sandbox, host, wrap, asked, change: (id, value) => listeners.change({ target: { id, value } }) };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a Senate choice asks the server and shows the Senate trades with their filer', async () => {
  const p = panel((url) => (url.includes('chamber=Senate') ? SENATE : SUMMARY));
  await p.sandbox.loadCongressPanel('rsCongress');
  assert.deepEqual(p.asked, ['/reports/congress?limit=50']);
  assert.match(p.wrap.innerHTML, /Daniel Meuser/);
  p.change('cgChamber', 'Senate');
  await settle();
  assert.equal(p.asked.at(-1), '/reports/congress?limit=50&chamber=Senate&view=trades');
  assert.match(p.wrap.innerHTML, /Jane Senator/);
  assert.doesNotMatch(p.wrap.innerHTML, /Daniel Meuser/);
  p.change('cgParty', 'Democrat');
  await settle();
  assert.equal(p.asked.at(-1), '/reports/congress?limit=50&chamber=Senate&party=Democrat&view=trades');
});

test('a filter with no matching trades says so instead of showing the unfiltered summary', async () => {
  const p = panel((url) => (url.includes('party=') ? NONE : SUMMARY));
  await p.sandbox.loadCongressPanel('rsCongress');
  p.change('cgParty', 'Republican');
  await settle();
  assert.match(p.wrap.innerHTML, /No congressional trades match your filter criteria/);
  assert.doesNotMatch(p.wrap.innerHTML, /NVDA/, 'the unfiltered summary row is not shown under a filter');
});
