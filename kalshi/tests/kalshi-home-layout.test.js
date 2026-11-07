/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (kalshi--kalshi-home), layout only: the header said
 *   "trading active" beside a failing portfolio read (409) and a week-old scan, every market row repeated its title, 255
 *   rows loaded at once and seven tabs wrapped on a phone. Runs the shipped onceTitle, accountLine and renderStaleChip
 *   from tools/kalshi.html and checks the bottom bar with More, 50 rows then Show more, the dated Why verdict and the
 *   44px ticker lookup beside the search. No order path is touched.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'kalshi.html'), 'utf8');
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is defined in kalshi.html`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}
function run(names, extra = {}) {
  const ctx = { ...extra };
  vm.runInNewContext(`${names.map(extract).join('\n')}\nthis.f = { ${names.join(', ')} };`, ctx);
  return ctx.f;
}

test('a market title shows once: a subtitle that repeats the title is dropped, a different one kept', () => {
  const { onceTitle } = run(['onceTitle']);
  assert.equal(onceTitle('Ferencvarosi wins by more than 2.5 goals? — Ferencvarosi wins by more than 2.5 goals'), 'Ferencvarosi wins by more than 2.5 goals?');
  assert.equal(onceTitle('Will it rain in NYC? — Above 2 inches'), 'Will it rain in NYC? — Above 2 inches');
  assert.equal(onceTitle(''), '');
});

test('the header names the account: not connected with its fix on 409, connected with its environment', () => {
  const { accountLine } = run(['accountLine']);
  const missing = accountLine(null, Object.assign(new Error('no Kalshi connection'), { status: 409 }));
  assert.equal(missing.tone, 'warn');
  assert.equal(missing.text, 'Kalshi account not connected · paper mode · paste your API key on the Connections page');
  assert.match(accountLine(null, Object.assign(new Error('Kalshi said 503'), { status: 503 })).text, /could not be read: Kalshi said 503/);
  assert.deepEqual({ ...accountLine({ env: 'demo' }, null) }, { tone: 'ok', text: 'Kalshi account connected · demo (paper)' });
  assert.match(extract('loadPortfolio'), /renderAccountLine\(null, e\)/, 'a failed read is shown, not swallowed');
});

test('an old calibration table or an old scan is one warning chip with Scan now', () => {
  const nodes = { 'stale-chip': { hidden: true }, 'scan-age': { textContent: '' } };
  const { renderStaleChip } = run(['renderStaleChip'], { $: (id) => nodes[id] });
  const now = Date.parse('2026-11-06T08:00:00Z');
  renderStaleChip({ calibrationGeneratedAt: '2026-07-13T00:00:00Z', generatedAt: '2026-10-30T12:00:00Z' }, now);
  assert.equal(nodes['stale-chip'].hidden, false);
  assert.match(nodes['scan-age'].textContent, /last scan/);
  renderStaleChip({ calibrationGeneratedAt: '2026-11-01T00:00:00Z', generatedAt: '2026-11-06T07:00:00Z' }, now);
  assert.equal(nodes['stale-chip'].hidden, true, 'fresh: no chip');
  assert.match(html, /<span class="chip-warn" id="stale-chip" hidden><span id="calib-label"><\/span><span id="scan-age"><\/span><button type="button" id="chip-scan-now">Scan now<\/button><\/span>/);
});

test('a phone gets a bottom bar of Markets, Scan, Account, Scorecard and More; More holds Trends, Alerts, Settings', () => {
  for (const tab of ['trends', 'alerts', 'settings']) assert.match(html, new RegExp(`<button class="tab overflow" data-tab="${tab}"`));
  assert.match(html, /<button class="more-tab" type="button" id="tab-more" aria-haspopup="menu" popovertarget="more-menu">More<\/button>/);
  assert.deepEqual([...html.matchAll(/data-more="(\w+)"/g)].map((m) => m[1]), ['trends', 'alerts', 'settings']);
  assert.match(html, /@media \(max-width: 640px\) \{\n {2}\.tabnav \{ position: fixed;[^}]*flex-wrap: nowrap !important;/);
  assert.match(html, /\.tab\.overflow \{ display: none; \}/);
});

test('the market list shows 50 rows, then Show more; the Why panel dates a scan verdict; the lookup sits by the search', () => {
  assert.match(html, /var MK_PAGE = 50;/);
  assert.match(extract('renderMarkets'), /mk\.rows\.slice\(0, mk\.shown\)/);
  assert.match(extract('whyBox'), /At the ' \+ esc\(at\.toLocaleDateString/);
  const toolbar = html.slice(html.indexOf('id="mk-q"'), html.indexOf('id="mk-cat"'));
  assert.match(toolbar, /<form id="mk-lookup" class="mk-lookup">/);
  assert.match(html, /#mk-ticker, #mk-q \{ min-height: 44px;/);
});

test('every bar, sheet and menu the page added is opaque: the theme card tone over the page colour (light-blue cards are 62% white)', () => {
  assert.match(html, /\.tabnav \{ background: linear-gradient\(var\(--panel\), var\(--panel\)\), var\(--bg, #0d1117\) !important; \}/);
  assert.match(html, /\.more-menu\[popover\], \.chip-warn \{ background: linear-gradient/);
});
