/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06. eats-browse (MERGE): the "Restaurants" tile loaded /api/eats/app?view=browse and no
 *   code read view, so it was Order Food twice. The tile is gone, and the old address opens Order Food on its results (the page's own
 *   requestedView, and boot calls openOnResults for 'browse'). eats-concierge: one assistant entry (ribbon.hideAssistant), and the page follows
 *   the theme it wears: the parent-token copy that froze the first theme's palette inline (Ocean navy kept after a switch to Light Blue, white
 *   chat text on light grey) is gone, and no dark fill or literal ink is left on the surfaces the audit named.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PKG = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(PKG, 'tools', 'eats-app.html'), 'utf8');
const MANIFEST = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');

test('one Eats home: no Restaurants tile, and the in-page concierge is the one assistant', () => {
  const ui = MANIFEST.slice(MANIFEST.indexOf('\nui:\n'), MANIFEST.indexOf('\nsurface:\n'));
  assert.deepEqual([...ui.matchAll(/toolName: (\S+)/g)].map((m) => m[1]), ['eats-concierge']);
  assert.doesNotMatch(ui, /view=browse/);
  const ribbon = MANIFEST.slice(MANIFEST.indexOf('\nribbon:\n'), MANIFEST.indexOf('\nintegrations:\n'));
  assert.match(ribbon, /\n  hideAssistant: true\n/);
});

test('the old Restaurants address (?view=browse) opens Order Food on its results', () => {
  const start = HTML.indexOf('function requestedView('), end = HTML.indexOf('\n}\n', start) + 3;
  const requestedView = new Function(`${HTML.slice(start, end)}; return requestedView;`)();
  assert.equal(requestedView('?view=browse'), 'browse');
  assert.equal(requestedView('?v=123'), '');
  assert.equal(requestedView(''), '');
  const boot = HTML.slice(HTML.indexOf('async function boot()'), HTML.indexOf('\n}\n', HTML.indexOf('async function boot()')));
  assert.match(boot, /const view = requestedView\(\(window\.location \|\| \{\}\)\.search\);/);
  assert.match(boot, /await search\('', false, true\);\n  if \(view === 'browse'\) openOnResults\(\);/);
});

test('the page follows its own theme: no copy of the parent\'s tokens, no dark fills, accent ink from the theme', () => {
  assert.doesNotMatch(HTML, /parentWindow\.getComputedStyle|documentElement\.style\.setProperty\(localName/, 'no frozen inline palette');
  const css = HTML.slice(HTML.indexOf('<style>\n  :root {\n    --bg: var(--bg-primary'), HTML.indexOf('</style>', HTML.indexOf('--bg: var(--bg-primary')));
  for (const hex of ['#11151a', '#080a0d', '#2b313d', '#04130b', '#05150d', 'rgba(15,17,21']) assert.ok(!css.includes(hex), `${hex} is gone`);
  assert.match(css, /--on-accent: var\(--ds-on-accent, var\(--text-on-accent, #fff\)\);/);
  assert.match(css, /\.msg\.me \{[^}]*color: var\(--on-accent\);/);
  const outsideBadges = css.replace(/\n  \.(badge|eta) \{[^}]*\}/g, '');
  assert.doesNotMatch(outsideBadges, /color: #fff;/, 'white ink only on the dark photo badges');
});

test('the hand-off is said once under the results, and Map and the cuisine chips are 44px targets', () => {
  assert.equal((HTML.match(/you choose the dishes and pay/g) || []).length, 1);
  assert.match(HTML, /\.map-link \{[^}]*min-height: 44px;/);
  assert.match(HTML, /\.quick-row \.chip \{ flex: none; min-height: 44px; height: 44px;/);
  assert.match(HTML, /\.quick-row \{ flex-wrap: nowrap; overflow-x: auto;/);
});
