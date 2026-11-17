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
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.10.0, the Markets tab designed for a phone: the account line says "Paper
 *   trading" with the link that connects an account; one line carries the scan's and the model's age (the stale chip and
 *   its Scan now are gone; Scan now stays on the Scan tab); the bottom bar is five equal tabs; the list is cards, 50 then
 *   Show more, with Why as a sheet; search and the ticker lookup are one field; ratings, prices, close times and the
 *   estimate read in plain words (edgeWord, priceText, closesWords, shortSkip, estimateHtml). The layout itself is
 *   guarded in Chromium by kalshi-phone-design-browser.test.js.
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

test('the status line names the account: paper trading with the link that connects one, connected with its environment', () => {
  const { accountLine } = run(['accountLine']);
  assert.deepEqual({ ...accountLine(null, Object.assign(new Error('no Kalshi connection'), { status: 409 }), false) }, { tone: 'paper', text: 'Paper trading', link: true });
  assert.deepEqual({ ...accountLine(null, Object.assign(new Error('sign in'), { status: 401 }), false) }, { tone: 'paper', text: 'Paper trading', link: true });
  assert.match(accountLine(null, Object.assign(new Error('Kalshi said 503'), { status: 503 }), false).text, /could not be read: Kalshi said 503/);
  assert.deepEqual({ ...accountLine({ env: 'demo' }, null, false) }, { tone: 'ok', text: 'Paper trading · demo account connected', link: false });
  assert.equal(accountLine({ env: 'live' }, null, false).text, 'Live account connected · real-money orders are off');
  assert.equal(accountLine({ env: 'live' }, null, true).text, 'Live account connected · real money');
  assert.match(extract('loadPortfolio'), /renderAccountLine\(null, e\)/, 'a failed read is shown, not swallowed');
  assert.match(html, /<a class="kx-link" id="acct-link" href="\/utilities" target="_top" hidden>Connect your Kalshi account<\/a>/);
});

test('one line says how old the scan and the model are; an old one reads amber; nothing about the exchange while it is open', () => {
  const nodes = {};
  const $ = (id) => (nodes[id] = nodes[id] || { textContent: '', hidden: false, className: '' });
  const f = run(['calibrationLabel', 'exchangeState', 'scanAgeWords', 'setWords', 'renderFreshLine'], { $ });
  const now = Date.parse('2026-11-16T18:00:00Z');
  f.renderFreshLine({ generatedAt: '2026-11-16T17:48:00Z', calibrationGeneratedAt: '2026-07-13T00:00:00Z', exchangeActive: true }, now);
  assert.deepEqual([nodes['exch-label'].hidden, nodes['scan-age'].textContent, nodes['scan-age'].className, nodes['calib-label'].className], [true, 'Scanned 12 min ago', '', 'is-old']);
  assert.match(nodes['calib-label'].textContent, /^model from .+, 126 days old$/);
  f.renderFreshLine({ generatedAt: '2026-11-14T10:00:00Z', calibrationGeneratedAt: '2026-11-10T00:00:00Z', exchangeActive: false }, now);
  assert.deepEqual([nodes['exch-label'].textContent, nodes['exch-label'].className, nodes['exch-sep'].hidden, nodes['scan-age'].className, nodes['calib-label'].className], ['Kalshi has paused trading', 'is-bad', false, 'is-old', '']);
  f.renderFreshLine({ awaitingFirstScan: true }, now);
  assert.equal(nodes['scan-age'].textContent, 'Nothing scanned yet');
  assert.doesNotMatch(html, /id="stale-chip"|id="chip-scan-now"/, 'no stale chip: Scan now lives on the Scan tab');
  assert.match(html, /<button id="scan-now" title="Run one scan walk now">Scan now<\/button>/);
});

test('a phone gets a bottom bar of five equal tabs, Markets, Scan, Account, Scorecard and More; More holds Trends, Alerts, Settings', () => {
  for (const tab of ['trends', 'alerts', 'settings']) assert.match(html, new RegExp(`<button class="tab overflow" data-tab="${tab}"`));
  assert.match(html, /<button class="more-tab" type="button" id="tab-more" aria-haspopup="menu" popovertarget="more-menu"><svg class="tab-ico"[^>]*>[\s\S]*?<\/svg><span>More<\/span><\/button>/);
  assert.deepEqual([...html.matchAll(/data-more="(\w+)"/g)].map((m) => m[1]), ['trends', 'alerts', 'settings']);
  assert.match(html, /\.tabnav \{ position: fixed;[^}]*display: grid !important; grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/);
  assert.doesNotMatch(html, /padding: 0 72px/, 'no tab gives up its width to the floating button');
  assert.match(html, /\.tab\.overflow \{ display: none; \}/);
  assert.doesNotMatch(html, /class="tab-dot"/, 'no unexplained dot');
  assert.match(extract('renderScorecard'), /setBadge\('badge-scorecard', proven \? proven \+ ' proven' : failing \? failing \+ ' failing' : ''/);
});

test('the market list is cards, 50 then Show more; a card opens Why as a sheet dated by its scan; search and the ticker lookup are one field', () => {
  assert.match(html, /var MK_PAGE = 50;/);
  assert.match(extract('renderMarkets'), /mk\.rows\.slice\(0, mk\.shown\)\.forEach\(function \(m\) \{ list\.appendChild\(mkItem\(m, now\)\); \}\)/);
  assert.match(extract('mkItem'), /card\.type = 'button'; card\.className = 'kx-card';/);
  assert.match(extract('whyBox'), /At the ' \+ esc\(at\.toLocaleDateString/);
  assert.match(extract('openWhy'), /openSheet\('kx-why'\)/);
  const search = html.slice(html.indexOf('<form id="mk-lookup"'), html.indexOf('</form>', html.indexOf('<form id="mk-lookup"')));
  assert.match(search, /<input type="search" id="mk-q" placeholder="Search markets or a ticker"/);
  assert.doesNotMatch(html, /id="mk-ticker"/, 'one field');
  assert.match(extract('lookupMarket'), /if \(!TICKER_SHAPE\.test\(ticker\)\)/);
});

test('a card speaks plainly: the rating, the price to buy each side, when it closes, our estimate and the edge', () => {
  const now = Date.parse('2026-11-16T18:00:00Z');
  const f = run(['esc', 'edgeWord', 'priceText', 'closesWords', 'shortSkip', 'estimateHtml'], {
    EDGE_WORDS: { monster: 'Big edge', strong: 'Good edge', playable: 'Small edge', fold: 'No edge', 'not-evaluable': 'No estimate' },
    document: { createElement: () => { const d = { set textContent(v) { d.innerHTML = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }; return d; } } });
  assert.deepEqual(['monster', 'strong', 'playable', 'fold', 'not-evaluable', 'other'].map(f.edgeWord), ['Big edge', 'Good edge', 'Small edge', 'No edge', 'No estimate', 'No estimate']);
  assert.deepEqual([f.priceText(0.54), f.priceText(0.545), f.priceText(0), f.priceText('x')], ['54¢', '54.5¢', '—', '—']);
  assert.deepEqual([f.closesWords('2026-11-16T18:25:00Z', now), f.closesWords('2026-11-17T14:00:00Z', now), f.closesWords('2026-11-16T17:00:00Z', now), f.closesWords(null, now)], ['Closes in 25 min', 'Closes in 20 h', 'Closed', '']);
  assert.match(f.closesWords('2026-11-21T18:00:00Z', now), /^Closes Nov 21$/);
  assert.equal(f.shortSkip('it closes in 5.2 days, beyond the 48-hour horizon the calibration table was measured on'), 'Too far from closing to estimate');
  assert.equal(f.shortSkip('it is a parlay leg (a multivariate market), which the evaluator never prices'), 'A parlay leg: not estimated');
  assert.equal(f.estimateHtml({ hand: { side: 'yes', edgeNet: 0.138, trueProb: 0.68 } }), 'Our estimate 68% Yes · <b class="pos">+13.8¢ on Yes</b>');
  assert.equal(f.estimateHtml({ hand: { side: 'no', edgeNet: -0.012, trueProb: 0.71 } }), 'Our estimate 71% No · <b class="neg">−1.2¢ on No</b>');
  assert.equal(f.estimateHtml({ hand: null, notEvaluable: 'its book is empty on one side, so there is no price to judge' }), 'One side has no price to judge');
});

test('every bar, sheet, card and menu the page draws is opaque: the theme card tone over the page colour (light-blue cards are 62% white)', () => {
  assert.match(html, /:root \{ --opaque: linear-gradient\(var\(--panel\), var\(--panel\)\), var\(--bg, #0d1117\); \}/);
  for (const rule of [/\.more-menu\[popover\] \{ background: var\(--opaque\); \}/, /\.kx-card \{[^}]*background: var\(--opaque\);/, /dialog\.kx-sheet \{[^}]*background: var\(--opaque\);/, /\.tabnav \{ position: fixed;[^}]*background: var\(--opaque\) !important;/]) {
    assert.match(html, rule);
  }
});
