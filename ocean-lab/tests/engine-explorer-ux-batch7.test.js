/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit batch-7 (ocean-lab--ocean-lab-explorer): withhold Evaluate in air
 *   for the wave explorer; shrink lede to one line; split into Design & sea states (?view=design) and Parts & BOM
 *   (?view=parts) with an opaque phone bottom bar; format STAGE gates as an expandable checklist with counts and plain
 *   prose (no camelCase keys); move Delete into a card-head ⋯ menu with an in-page confirm dialog; move Open in CAD
 *   Studio into a per-part row ⋯ menu; contain wide tables inside scroll wrappers so phone scrollWidth stays <= 412 px.
 *
 * Dependency-free `node --test` suite over tools/explorer.html, tools/explorer.js and the compiled vehicle engine.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, request, parent, isMain);
};

const PKG = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(PKG, 'tools', 'explorer.html'), 'utf8');
const JS = fs.readFileSync(path.join(PKG, 'tools', 'explorer.js'), 'utf8');
const lib = require(path.join(PKG, 'routes', 'engine', 'vehicle', 'index.js'));
const wave = require(path.join(PKG, 'routes', 'engine', 'wave', 'index.js'));

test('explorer WITHHOLDS Evaluate in air and verifies wave-explorer is the sole vehicle kind', () => {
  assert.doesNotMatch(HTML, /id="evaluate-air"|Evaluate in air/);
  assert.doesNotMatch(JS, /evaluate-air/);
  assert.equal(lib.EXPLORER_KIND.id, 'wave-explorer');
  const routesJs = fs.readFileSync(path.join(PKG, 'routes', 'vehicle-routes.js'), 'utf8');
  assert.match(routesJs, /kinds:\s*\[vehicle_1\.EXPLORER_KIND\]/);
});

test('explorer splits into Design & sea states and Parts & BOM with one-line lede, one primary, and contained table scrollers', () => {
  assert.match(HTML, /<p class="lede">The 300 mm wave explorer, simulated: nothing here was built or tested\.<\/p>/);
  assert.match(HTML, /id="tab-design" data-view="design" aria-pressed="true">Design &amp; sea states<\/button>/);
  assert.match(HTML, /id="tab-parts" data-view="parts" aria-pressed="false">Parts &amp; BOM<\/button>/);
  const designView = HTML.slice(HTML.indexOf('id="view-design"'), HTML.indexOf('id="view-parts"'));
  const partsView = HTML.slice(HTML.indexOf('id="view-parts"'), HTML.indexOf('<div class="float-menu" id="part-menu"'));
  for (const id of ['stage-card', 'vector-table', 'sea-table', 'runs']) assert.ok(designView.includes(`id="${id}"`), `Design view holds #${id}`);
  for (const id of ['parts-card', 'printed-parts', 'bought-parts', 'limits']) assert.ok(partsView.includes(`id="${id}"`), `Parts view holds #${id}`);
  assert.equal((designView.match(/class="btn primary"/g) || []).length, 1, 'Design view has exactly one primary button');
  assert.match(designView, /<button class="btn primary" id="evaluate" type="button">Evaluate in seawater<\/button>/);
  assert.match(designView, /<button class="btn" id="save-design" type="button">Save design<\/button>/);
  for (const tableId of ['vector-table', 'sea-table', 'runs', 'printed-parts', 'bought-parts']) {
    assert.match(HTML, new RegExp(`<div class="table-scroll">\\s*<table id="${tableId}">`), `${tableId} scrolls inside its own wrapper`);
  }
  assert.match(HTML, /html,\s*body\s*\{\s*max-width:\s*100%;\s*overflow-x:\s*hidden;/);
  assert.match(HTML, /\.view-bar[\s\S]*?background:\s*linear-gradient\(var\(--panel\),\s*var\(--panel\)\),\s*var\(--bg\)\s*!important;/);
});

test('STAGE checklist renders expandable gates with counts and plain labels, and per-part CAD Studio opens from row ⋯', () => {
  const window = {};
  const document = { getElementById: () => ({ hidden: false, textContent: '', innerHTML: '', value: '', href: '', addEventListener() {}, querySelector() { return this; } }) };
  vm.runInNewContext(JS, { window, document, fetch: () => new Promise(() => {}), Promise, Object, String, JSON, isFinite });
  const seed = lib.explorerSeed().designVector;
  const run = {
    sequence: 1,
    mediumId: 'seawater',
    plant: lib.EVALUATION_PLANT,
    vectorFingerprint: lib.designVectorFingerprint(seed),
    result: { figures: lib.evaluateExplorer(seed, wave.mediumById('seawater')).figures },
  };
  const stage = lib.stageOf(lib.EXPLORER_KIND, seed, [run], lib.EXPLORER_KIND.limits, (v, s) => lib.explorerPartsGate(v, s));
  const because = window.OceanExplorer.humanizeProse(stage.because);
  assert.doesNotMatch(because, /meanSpeedMs|meanKnots|underWayFraction|kmPerDay|kmPerYear/);
  assert.match(because, /mean speed, mean knots, share under way, km\/day, km\/year/);
  const gates = stage.blockedBy.map((b) => window.OceanExplorer.parseGate(b));
  assert.deepEqual(gates.map((g) => g.label), [
    'Parts with no mass: 15',
    'Parts with no price: 16',
    'Parts on no body: 5',
    'Displacement budget: open',
  ]);
  assert.equal(gates[0].items.length, 15);
  assert.equal(gates[1].items.length, 16);
  assert.equal(gates[2].items.length, 5);
  assert.ok(gates[3].items.length > 0);
  assert.match(JS, /data-part-menu="/, 'CAD Studio action sits behind each part row ⋯ trigger');
});
