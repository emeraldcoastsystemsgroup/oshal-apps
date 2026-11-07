/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The design standard on the Trading landing (docs/ux/design-standard.md; UX audit decision intelligent-trades--intelligent-trades-home), UI files only and nothing in the orderAuthority closure: the page declares its contract (a dashboard) and the account tiles are the work; the real-capital hero is drawn only once a real account is connected or its read failed, never for paper money alone; an idle paper tile says it is not started in one sentence with no empty balance rows, and an empty positions rollup is not drawn; an account tile is a card, not a button around its own buttons; a loading spinner is marked as progress; the watchlist's Remove is a full touch target, a watchlist price has two decimals and a phone row is symbol, last, today and Remove; the page paints no wash and its sizes and radii sit on the standard's scales; on a phone the four sections are one bottom bar; the connected-login roster with Discover accounts opens from ⚙ Settings. Every case fails on Trading 1.53.5.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const UI = path.join(__dirname, '../tools/ui');
const page = fs.readFileSync(path.join(__dirname, '../tools/trading.html'), 'utf8');
const style = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));

/** The landing's view code in a sandbox, with the shell's helpers it calls and the hero's DOM nodes. */
function landing() {
  const nodes = { heroTotal: {}, heroDay: {}, heroSub: {}, heroMissing: {}, heroPanel: { hidden: true } };
  const context = vm.createContext({ Date, console, BOOKS: [], ACCOUNTS: [], money: (n) => '$' + n, esc: String, $: (id) => nodes[id], dollarPctCell: () => '$0', spinner: () => '', detailsMoney: String, detailsGain: () => 0 });
  vm.runInContext(fs.readFileSync(path.join(UI, 'view-accounts.js'), 'utf8') + '\nthis.view={paintHero,tileHtml,accountsSkeleton};', context);
  return { view: context.view, nodes };
}

test('the page declares a dashboard contract and the account tiles are its work', () => {
  assert.match(page, /<html lang="en"[^>]*data-ds-category="dashboard"[^>]*data-ds-first-action="none"/);
  assert.match(landing().view.accountsSkeleton(), /<div class="tiles" id="tiles" data-ds-work>/);
});

test('the real-capital hero is drawn only for a real account, never for paper money alone', () => {
  const { view, nodes } = landing();
  view.paintHero({ capital: { real: { equity: null, dayChange: null }, paper: { equity: 100000 } }, accounts: [{ ref: 'paper', kind: 'paper', equity: 100000 }] }, null, []);
  assert.equal(nodes.heroPanel.hidden, true, 'paper only: no real-capital total and no "day change unavailable"');
  assert.equal(nodes.heroTotal.textContent, '—', 'the hero still holds its honest text for when it is shown');
  view.paintHero({ capital: { real: { equity: 12500, dayChange: 25 }, paper: { equity: null } }, accounts: [{ ref: 'live', kind: 'live', equity: 12500 }] }, null, []);
  assert.equal(nodes.heroPanel.hidden, false, 'a connected real account shows the hero');
  view.paintHero({ capital: { real: { equity: null, partial: true }, paper: { equity: null } }, accounts: [] }, null, []);
  assert.equal(nodes.heroPanel.hidden, false, 'a failed real read is said, not hidden');
  view.paintHero(null, new Error('summary unavailable'), []);
  assert.equal(nodes.heroPanel.hidden, false, 'a failed summary is said in the hero');
  assert.match(landing().view.accountsSkeleton(), /<div class="panel" id="heroPanel" hidden>/, 'nothing is drawn before the summary answers');
});

test('an idle paper tile says it is not started in one sentence, with no empty balance rows; an empty rollup is not drawn', () => {
  const { view } = landing();
  const tile = view.tileHtml({ state: 'idle', label: 'Paper (reference book)', kind: 'paper', nativePaper: { armed: false }, note: 'Not started yet. Open this account and press Start paper autopilot to begin with paper cash; no broker is needed.' }, 0);
  assert.match(tile, />Not started yet\.<\/div>/);assert.doesNotMatch(tile, /class="t-eq"|Day P&amp;L|>Cash<|>Type</, 'no row without a figure, no repeated type');
  assert.match(tile, /title="Not started yet\. Open this account/, 'the full guidance stays in the tooltip');
  const nodes = { rollup: { innerHTML: '', closest: () => panel } }, panel = { hidden: false };
  const context = vm.createContext({ Date, console, BOOKS: [], ACCOUNTS: [], money: (n) => '$' + n, esc: String, $: (id) => nodes[id], dollarPctCell: () => '', spinner: () => '' });
  vm.runInContext(fs.readFileSync(path.join(UI, 'view-accounts.js'), 'utf8') + '\nthis.rollup=paintRollup;', context);
  context.rollup({ positionsRollup: [] }, null);assert.equal(panel.hidden, true, 'no position anywhere: no rollup panel');
  context.rollup({ positionsRollup: [{ symbol: 'AAPL', qty: 1, marketValue: 180, perBook: [] }] }, null);assert.equal(panel.hidden, false);
});

test('an account tile is a card whose own buttons are the controls', () => {
  const tile = landing().view.tileHtml({ state: 'ok', label: 'Paper (reference book)', kind: 'paper', nativePaper: { armed: true }, equity: 100000, cash: 100000, enabled: true }, 0);
  assert.doesNotMatch(tile, /role="button"/, 'no control around the tile\'s own buttons');
  assert.match(tile, /data-act="open">Open account →<\/button>/);
});

test('the connected-login roster and Discover accounts are configuration: hidden on the landing, shown in ⚙ Settings', () => {
  assert.match(landing().view.accountsSkeleton(), /<div class="panel" id="rosterPanel" hidden>[\s\S]*id="discoverBtn"/);
  const app = fs.readFileSync(path.join(UI, 'app.js'), 'utf8');
  assert.match(app, /const roster = \$\('rosterPanel'\); if \(roster\) \{ roster\.hidden = false; \$\('settingsBody'\)\.append\(roster\); \}/);
});

test('a spinner is marked as progress, and the watchlist Remove is a full touch target', () => {
  const app = fs.readFileSync(path.join(UI, 'app.js'), 'utf8');
  assert.match(app, /const spinner = \(msg\) => '<div class="spin" data-ds-progress>/);
  const research = fs.readFileSync(path.join(UI, 'view-research.js'), 'utf8');
  assert.match(research, /data-wl="remove"[^>]*aria-label="Remove">&times;<\/button>/);
  assert.doesNotMatch(research, /width:28px;min-height:26px/);
  // A watchlist price reads as a quote (two decimals), and on a phone a row is symbol, last, today and Remove.
  const context = vm.createContext({ Number, esc: String, money: (n) => '$' + n, pct: (n) => n + '%', rsDay: String, cgDay: String });
  vm.runInContext(research + '\nthis.rows=wlRowsHtml;', context);
  const rows = context.rows([{ symbol: 'AAPL', quote: { price: 181.6, dayChangePct: 1.2 }, addedAt: '2026-11-01' }]);
  assert.match(rows, />\$181\.60</, 'two decimals');
  assert.equal(context.rows([]), '<div class="foot" style="margin:0">No tickers yet.</div>');
  assert.match(rows, /<th class="wl-wide">Congress<\/th>/);assert.match(rows, /class="btn ghost sm wl-research"/);
  assert.match(style, /\.wl-table \.wl-wide, \.wl-table \.wl-research \{ display:none; \}/);
});

test('the page paints no wash; its type sizes and radii are on the scales; on a phone the sections are a bottom bar', () => {
  assert.doesNotMatch(style.replace(/\/\*[\s\S]*?\*\//g, ''), /body\s*\{[^}]*radial-gradient/, 'no wash behind the page');
  const sizes = new Set([...style.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => Number(m[1])));
  for (const size of sizes) assert.ok([12, 14, 15, 16, 18, 24, 32].includes(size), `font size ${size}px is off the type scale`);
  const radii = new Set([...style.matchAll(/border-radius:\s*([^;}]+)/g)].flatMap((m) => m[1].trim().split(/\s+/)).filter((v) => /px$/.test(v)).map((v) => Number(v.slice(0, -2))));
  for (const r of radii) assert.ok([0, 2, 6, 10, 14, 20].includes(r), `radius ${r}px is off the radius scale`);
  assert.match(style, /@media \(max-width:720px\) \{\s*\.nav \{ position:fixed; left:0; right:0; bottom:0;/);
  assert.match(style, /\.tile:hover \{ transform:none;/, 'no hover lift');
  assert.match(style, /\.btn, \.icon-btn \{ min-height:44px; \}/);
  assert.match(style, /#main > \.tiles:has\(> \.tile:only-child\) \{ flex:0 0 340px;/, 'one tile on a desktop: the watchlist sits beside it, no empty band');
});
