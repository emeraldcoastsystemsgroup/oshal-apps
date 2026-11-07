/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (embodied--embodied, SPLIT): a 4,000px page put the drive
 *   pad four screens below the cameras and mixed a hull-drop study and CAD part tables into the same scroll. Guards the
 *   three views (Mission console by default; Hardware sizing; Physics & medium lab), E-STOP in the header outside every
 *   view, the manual pad and the cameras in the console, the physics chip in the lab only, the part rows' row menu in
 *   place of a button per part, the setup choices out of the header, headings without essay subtitles (Help holds
 *   them), and every control id the surface script binds still on the page exactly once.
 *
 * Dependency-free `node --test` suite over the shipped HTML and JS (the browser proof is surface.core.spec.mjs).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'embodied.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'tools', 'embodied.js'), 'utf8');
const body = html.slice(html.indexOf('<body>'));
/** The markup of one view, from its opening tag to the next view (or the Help dialog). */
function view(id) {
  const start = body.indexOf(`id="view-${id}"`);
  assert.ok(start > 0, `view ${id} exists`);
  const next = ['view-console', 'view-sizing', 'view-lab', 'dialog id="help"'].map((m) => body.indexOf(m, start + 10)).filter((i) => i > start);
  return body.slice(start, Math.min(...next));
}

test('three views, Mission console by default, the other two hidden until their tab is pressed', () => {
  assert.match(body, /<div class="layout view" id="view-console" role="tabpanel"[^>]*>/);
  assert.match(body, /id="view-sizing" role="tabpanel"[^>]*hidden>/);
  assert.match(body, /id="view-lab" role="tabpanel"[^>]*hidden>/);
  assert.match(body, /id="tab-console" data-view="console"[^>]*aria-selected="true"/);
  for (const v of ['Mission console', 'Hardware sizing', 'Physics &amp; medium lab']) assert.ok(body.includes(v), v);
  assert.match(body, /setView\(m \? m\[1\] : 'console'\)/, 'no hash opens the console');
});

test('E-STOP sits in the header, outside every view, and the console holds the map, cameras, planner, log and pad', () => {
  const header = body.slice(0, body.indexOf('</header>'));
  assert.match(header, /<button id="estop" class="danger">E-STOP<\/button>/);
  assert.match(header, /id="take"/);
  const consoleView = view('console');
  for (const id of ['view3d', 'cams', 'pic-drone', 'pic-wrist', 'explore', 'task', 'draft', 'execute', 'log', 'pad-panel', 'map', 'surfaces', 'unit', 'drone']) {
    assert.ok(consoleView.includes(`id="${id}"`), `${id} is in the console`);
  }
  assert.ok(consoleView.indexOf('id="pad-panel"') < consoleView.indexOf('id="map"'), 'the pad leads the right column, beside the map');
});

test('sizing holds the two assemblies and the policies; the lab holds the hull drop and the only physics chip', () => {
  const sizing = view('sizing'), lab = view('lab');
  assert.equal((sizing.match(/<details class="panel assembly" open>/g) || []).length, 2, 'drone and arm collapse per assembly');
  for (const id of ['build-parts', 'arm-joints', 'arm-parts', 'arm-check', 'policies']) assert.ok(sizing.includes(`id="${id}"`), id);
  for (const id of ['medium', 'drop-hull', 'drop-result', 'fall', 'physics-status']) assert.ok(lab.includes(`id="${id}"`), id);
  assert.equal(body.split('id="physics-status"').length - 1, 1, 'the physics state shows once, in the lab');
  assert.ok(!body.slice(0, body.indexOf('id="view-console"')).includes('physics-status'), 'never a banner on the console');
});

test('a part row opens CAD Studio from one row menu, not a button per part', () => {
  assert.doesNotMatch(js, /btn\.textContent = 'Open in CAD Studio'/);
  assert.match(js, /tr\.append\(partMenu\(p\.name, \(\) => openInCadStudio\(fit, p\.id\)\)\)/);
  assert.match(js, /tr\.append\(partMenu\(p\.name, \(\) => openArmPartInCadStudio\(fit, p\.id\)\)\)/);
  assert.match(js, /setAttribute\('aria-haspopup', 'menu'\)/);
  assert.match(js, /menu\.setAttribute\('popover', ''\)/);
});

test('the setup choices left the header, and headings carry no essay subtitles (Help holds the explanations)', () => {
  const header = body.slice(0, body.indexOf('</header>'));
  for (const id of ['sensor-set', 'scenario', 'backend', 'controller', 'reset-world']) {
    assert.ok(!header.includes(`id="${id}"`), `${id} is not in the header`);
    assert.ok(body.slice(body.indexOf('id="setup"'), body.indexOf('<nav class="view-bar"')).includes(`id="${id}"`), `${id} is in Setup`);
  }
  assert.doesNotMatch(body, /<h[23][^>]*>[^<]*<small/, 'no heading carries a subtitle');
  assert.match(body, /<dialog id="help"/);
  assert.match(body, /The medium is a parameter, not a property of this lab/);
});

test('every control id the surface script reads is on the page exactly once', () => {
  const ids = [...new Set([...js.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]))];
  assert.ok(ids.length > 40, 'the scrape found the script\'s ids');
  for (const id of ids) assert.equal(body.split(`id="${id}"`).length - 1, 1, `#${id}`);
});

test('a cancelled Explore says it did not start; the hull-drop result wraps instead of widening the page', () => {
  assert.match(js, /\{ toast\('Explore not started: it was cancelled at the question\.', 'error'\); return; \}/);
  assert.match(html, /#drop-result, #drop-result \* \{ overflow-wrap: anywhere; word-break: break-word; white-space: normal; \}/);
});

test('every bar, sheet and menu the page added is opaque: the theme card tone over the page colour (light-blue cards are 62% white)', () => {
  assert.match(html, /\.view-bar, \.setup, \.cams, \.menu\[popover\], dialog#help, \.toast \{ background: linear-gradient\(var\(--em-panel\), var\(--em-panel\)\), var\(--em-bg\); \}/);
  assert.match(html, /\.sheet\.open \{ background: linear-gradient\(var\(--em-panel\)/);
});
