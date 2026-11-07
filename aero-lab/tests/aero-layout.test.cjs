/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (aero-lab--aero-lab): five equal run buttons hid the main
 *   action, number fields showed ten decimals, preset notes named scripts and files, the engine block filled a rail and
 *   the analysis-document box sat under the concierge button. Guards the two views, one primary run, Export in the build
 *   package view, closed design groups with Reset to preset (and one Site & season), the field's own decimals with the
 *   full value on focus, one-line presets, the engine popover, the in-flow hand-off and the phone bottom bar.
 *
 * Dependency-free `node --test` suite over the shipped page and script (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'aero-lab.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'tools', 'aero-lab.js'), 'utf8');
const body = html.slice(html.indexOf('<body'));
function extract(src, name) {
  const start = src.indexOf(`function ${name}(`); assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1; else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}
const data = (() => { const s = html.indexOf('window.AERO_LAB_DATA = '); const e = html.indexOf('\n};', s); const ctx = { window: {} }; vm.runInNewContext(html.slice(s, e + 3), ctx); return ctx.window.AERO_LAB_DATA; })();

test('two views: Sizing & flight envelope by default, Vehicle record & build package with Export Build Files', () => {
  assert.match(body, /^<body data-view="sizing">/);
  assert.match(html, /body\[data-view="sizing"\] \[data-part="vehicle"\], body\[data-view="vehicle"\] \[data-part="sizing"\] \{ display: none !important; \}/);
  const vehicle = body.slice(body.indexOf('<section data-part="vehicle">'), body.indexOf('</main>'));
  assert.match(vehicle, /id="vehicleCard"/);
  assert.match(vehicle, /<button id="btnExport">Export Build Files<\/button>/);
  assert.doesNotMatch(body.slice(body.indexOf('id="runBar"'), body.indexOf('id="runStatus"')), /btnExport/);
});

test('one primary, Run 24 h Energy Loop; Polar, Screen and Mission are secondary', () => {
  assert.deepEqual([...body.matchAll(/<button id="(\w+)" class="primary"/g)].map((m) => m[1]), ['btnEval']);
  for (const id of ['btnPolar', 'btnScreen', 'btnMission']) assert.match(body, new RegExp(`<button id="${id}">`));
});

test('design groups are closed disclosures with Reset to preset; Site & season appears once, with its quick fills', () => {
  const form = extract(js, 'buildForm');
  assert.match(form, /document\.createElement\('details'\)/);
  assert.match(form, /Reset to preset/);
  assert.match(form, /if \(g\.id === 'site'\) \{ const chips = document\.createElement\('div'\);/);
  assert.doesNotMatch(body, /<h2>Site &amp; season<\/h2>/);
  assert.match(extract(js, 'resetGroup'), /setField\(f\.k, state\.presetDesign\[f\.k\], 'code'\)/);
});

test("number fields show the field's decimals and the full value on focus", () => {
  const ctx = { D: data };
  vm.runInNewContext(`${extract(js, 'shortValue')}\nthis.shortValue = shortValue;`, ctx);
  assert.equal(ctx.shortValue('aspect_ratio', 18.559593023255814), '18.56');
  assert.equal(ctx.shortValue('aspect_ratio', 12.019230769230768), '12.02');
  assert.equal(ctx.shortValue('extra_CD0', 0.006136666480766675), '0.00614');
  assert.equal(ctx.shortValue('day_of_year', 195), '195');
  assert.match(js, /num\.addEventListener\('focus', \(\) => \{ if \(state\.design\[f\.k\] != null\) num\.value = String\(state\.design\[f\.k\]\); \}\);/);
});

test('each preset reads one line without script or file names; the provenance note still reaches the designer', () => {
  for (const p of data.presets) {
    assert.ok(p.line && p.line.length < 120, p.key);
    assert.doesNotMatch(p.line, /\.(py|json|out)\b|[A-Z]+_[A-Z]+/, p.key);
  }
  assert.match(js, /let note = p\.line \|\| p\.note;/);
  assert.match(js, /state\.presetRecord = \{ name: p\.name, note: p\.note \};/);
});

test('the engine block is a popover on the badge; the hand-off is in the page flow, not fixed under the concierge', () => {
  assert.match(body, /<button type="button" id="engineBadge" popovertarget="enginePop"/);
  const pop = body.slice(body.indexOf('<div id="enginePop"'), body.indexOf('</div>\n<!-- Phone'));
  assert.match(pop, /id="engineCard"/);
  assert.match(html, /\.handoff-dock\{position:static;/);
  assert.doesNotMatch(html, /\.handoff-dock\{position:fixed/);
  assert.match(html, /slot\.appendChild\(box\)/);
});

test('a phone gets a bottom bar Design · Results · Verdict · More, and the design vector opens as a sheet', () => {
  assert.deepEqual([...body.matchAll(/<button type="button" id="pb-(\w+)"/g)].map((m) => m[1]), ['design', 'results', 'verdict', 'more']);
  assert.match(html, /body\.design-open #left \{ display: block; position: fixed;/);
  assert.match(html, /#right \{ order: 1; \} #center \{ order: 2; \}/, 'verdict and charts come first');
});

test('every bar, sheet and menu the page added is opaque: the theme card tone over the page colour (light-blue cards are 62% white)', () => {
  assert.match(html, /\.pop\[popover\], \.phone-bar \{ background: linear-gradient\(var\(--panel\), var\(--panel\)\), var\(--bg\); \}/);
  assert.match(html, /body\.design-open #left, body\.design-open #left \.sheet-head, #runBar \{ background: linear-gradient/);
});
