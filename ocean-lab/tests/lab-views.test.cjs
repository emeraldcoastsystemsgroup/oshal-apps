/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (ocean-lab--ocean-lab-harvest-console and
 *   ocean-lab--ocean-lab-blade-studio): 1,400 and 1,700 words of model text and a band of controls pushed every chart
 *   below the fold, and a fixed dark analysis box covered two KPI tiles. Guards, for both pages: two views; the
 *   parameters as a pane (a sheet on a phone) with a number field beside each slider and a reset; captions of one
 *   sentence with the long text and The model in Help; the brief as a sheet painted with the theme (no #142034 box);
 *   and for Blade Studio the Fit button on the 3-D view and one Export sheet that drives the same four exports.
 *
 * Dependency-free `node --test` suite over the shipped pages (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'tools', f), 'utf8');
const hc = read('harvest-console.html');
const bs = read('blade-studio.html');
const visibleCaptions = (html, viewIds) => viewIds.flatMap((id) => {
  const start = html.indexOf(`id="${id}"`); const end = html.indexOf('<dialog', start);
  return [...html.slice(start, end).matchAll(/<p class="cap">([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
});

test('harvest console: Soil siting and Tidal reference views; the marine chart lives only in the tidal view', () => {
  assert.match(hc, /id="tab-soil" data-view="soil" aria-pressed="true"/);
  assert.match(hc, /<div class="lab one" id="view-tidal" hidden>/);
  const tidal = hc.slice(hc.indexOf('id="view-tidal"'), hc.indexOf('<dialog id="help"'));
  assert.match(tidal, /id="cv-marine"/);
  assert.doesNotMatch(hc.slice(hc.indexOf('id="view-soil"'), hc.indexOf('id="view-tidal"')), /id="cv-marine"/);
});

test('harvest console: the parameters pane holds four groups in order, every control, and Reset to defaults', () => {
  const pane = hc.slice(hc.indexOf('<aside class="controls params" id="params"'), hc.indexOf('</aside>'));
  assert.deepEqual([...pane.matchAll(/<legend>([^<]+)<\/legend>/g)].map((m) => m[1]), ['Site', 'Junctions', 'Converter and storage', 'Cursor']);
  for (const id of ['c-site', 'c-soil', 'c-a-hot', 'c-a-cold', 'c-b-hot', 'c-b-cold', 'c-wiring', 'c-area', 'c-rteg', 'c-match', 'c-cutin', 'c-load', 'c-cap', 'c-day', 'c-hour']) assert.ok(pane.includes(`id="${id}"`), id);
  assert.match(pane, /id="reset-defaults">Reset to defaults</);
  assert.match(hc, /\.lab \{ display: grid; grid-template-columns: 320px minmax\(0, 1fr\);/);
  assert.match(hc, /body\.params-open \.controls\.params \{ display: block; position: fixed;/);
  assert.match(hc, /id="tab-params" aria-expanded="false" aria-controls="params">Parameters</);
});

for (const [name, html, views] of [['harvest console', hc, ['view-soil', 'view-tidal']], ['blade studio', bs, ['view-studio', 'view-analysis']]]) {
  test(`${name}: a number field beside each slider, short captions, the model in Help, the brief as a themed sheet`, () => {
    assert.match(html, /num\.type = 'number'; num\.className = 'num';/);
    assert.match(html, /range\.insertAdjacentElement\('afterend', num\)/);
    for (const cap of visibleCaptions(html, views)) assert.ok(cap.split(/[.;!?] /).length <= 2 && cap.length <= 200, `one sentence: ${cap.slice(0, 60)}`);
    const help = html.slice(html.indexOf('<dialog id="help"'), html.indexOf('</dialog>', html.indexOf('<dialog id="help"')));
    assert.match(help, /<h3>The model<\/h3>/);
    assert.match(html, /<dialog id="brief" class="brief-sheet"/);
    assert.doesNotMatch(html, /#142034/, 'the fixed dark box is gone');
    assert.match(html, /<button type="button" class="btn" id="captureLabEvidence">Use visible results<\/button>/, 'Use visible results is secondary');
  });
}

test('blade studio: the 3-D view and Cp curve lead the studio view; Fit sits on the view; one Export sheet drives the four exports', () => {
  const studio = bs.slice(bs.indexOf('id="view-studio"'), bs.indexOf('id="view-analysis"'));
  for (const id of ['params', 'verdict', 'gl', 'cv-cp']) assert.ok(studio.includes(`id="${id}"`), id);
  const analysis = bs.slice(bs.indexOf('id="view-analysis"'), bs.indexOf('<dialog id="export"'));
  for (const id of ['cv-span', 'cv-energy', 'table-body', 'span-body']) assert.ok(analysis.includes(`id="${id}"`), id);
  assert.match(studio, /<div class="gl-wrap">\s*<canvas id="gl"[\s\S]*?<button class="btn fit" id="c-reset"[^>]*>Fit<\/button>/);
  const sheet = bs.slice(bs.indexOf('<dialog id="export"'), bs.indexOf('</dialog>', bs.indexOf('<dialog id="export"')));
  assert.deepEqual([...sheet.matchAll(/value="(x-\w+)"/g)].map((m) => m[1]), ['x-stl', 'x-obj', 'x-scad', 'x-dxf']);
  for (const id of ['x-stl', 'x-obj', 'x-scad', 'x-dxf']) assert.ok(sheet.includes(`id="${id}"`), id + ' stays as the bound target');
  assert.equal((sheet.match(/class="btn primary"/g) || []).length, 1);
  assert.match(bs, /if \(pick\) \$\(pick\.value\)\.click\(\);/);
  assert.match(bs, /id="reset-blade">Reset blade</);
  assert.match(bs, /<b>Low-Reynolds warning:<\/b> Re <b id="lowre-value">—<\/b> at 75 % span, so treat the Cp as an upper bound/);
});

for (const [name, html] of [['harvest console', hc], ['blade studio', bs]]) {
  test(`${name}: the pane, sheets, dialogs and phone bar are opaque (the card tone over the page colour)`, () => {
    assert.match(html, /\.controls\.params, dialog#help, dialog#brief, dialog#export, \.gl-wrap \.fit \{ background: linear-gradient\(var\(--panel\), var\(--panel\)\), var\(--bg\); \}/);
    assert.match(html, /\.view-bar \{ background: linear-gradient\(var\(--panel\), var\(--panel\)\), var\(--bg\) !important; \}/);
  });
}
