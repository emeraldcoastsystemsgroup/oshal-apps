/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.0, the design standard (kernel docs/ux/design-standard.md; Roger, 2026-11-06, F9, F10, F12; the reference products Shapr3D, Onshape and Tinkercad, CONVENTIONS.md §5.9). The served studio declares its contract (a studio whose first action is a press, its work marked), opens on New part as the empty canvas's one first action (no create-or-open paragraph), keeps one primary in its markup (Export, shown once a part is open; New part is a menu item), asks nothing natively (no window.prompt or confirm: New part opens a ready part on a 60 x 40 x 30 mm box, the name is edited in place), keeps the Part menu out of a disclosure (DS-09), and shows the reference functions CAD Studio lacks as greyed planned controls in their places through the shared helper (DS-45, RP-CAD-01 to -05). Static reads and a Node VM over the shipped functions; no browser, server or engine.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.5.0: prove all five reference-product functions (RP-CAD-01 Measure in mm/in, RP-CAD-02 7-orientation 3D View Cube + Fit, RP-CAD-03 OBJ/MTL + 3MF exports, RP-CAD-04 View in AR sheet with Quick Look USDZ + Scene Viewer GLB + QR, and RP-CAD-05 Send to printer sheet) are live in their places with zero planned-control placeholders remaining.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOOLS = path.join(__dirname, '..', 'tools');
const HTML = fs.readFileSync(path.join(TOOLS, 'cad-studio.html'), 'utf8');
const JS = fs.readFileSync(path.join(TOOLS, 'cad-studio.js'), 'utf8');
const ADAPTER = fs.readFileSync(path.join(TOOLS, 'editor-foundation-adapter.mjs'), 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body>'));

function blockOf(tag, attr) {
  const start = HTML.indexOf(`<${tag} ${attr}`);
  assert.ok(start >= 0, `the page has <${tag} ${attr}>`);
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(HTML))) { depth += m[0].startsWith('</') ? -1 : 1; if (depth === 0) return HTML.slice(start, m.index + m[0].length); }
  throw new Error(`<${tag} ${attr}> is never closed`);
}

test('the studio declares its contract and marks its work', () => {
  assert.match(HTML, /<html [^>]*data-ds-category="studio"/);
  assert.match(HTML, /<html [^>]*data-ds-first-action="tap"/);
  assert.match(ADAPTER, /root\.querySelector\('\.ef-viewport'\)\?\.setAttribute\('data-ds-work',''\)/, 'the editor viewport is the work');
});

test('the empty canvas opens on New part, and the markup holds one primary: Export, once a part is open', () => {
  assert.doesNotMatch(BODY, /Create a part, open one, or start from a Scan to Print job/, 'no create-or-open gate');
  assert.match(ADAPTER, /start=\{when:\(\)=>!adapter\.state\.model,label:'New part'/, 'the shared start card is the empty canvas\'s first action');
  assert.match(ADAPTER, /navigationLabel:'Parts'/);
  const primaries = [...BODY.matchAll(/<button id="([\w-]+)"[^>]*class="primary[^"]*"/g)].map((m) => m[1]).sort();
  assert.deepEqual(primaries, ['export-go', 'export-model'], 'Export in the app row and at the bottom of its own sheet');
  assert.match(BODY, /<button id="export-model" type="button" class="primary" hidden>Export<\/button>/, 'hidden until a part is open');
  assert.match(BODY, /<button id="new-model" type="button" role="menuitem"/, 'New part is an item of the Part menu');
  assert.match(BODY, /<button id="feature-submit" class="ghost">/);
});

test('no native prompt or confirm, and no disclosure menu in the app row', () => {
  const code = JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /window\.(prompt|confirm|alert)\s*\(/);
  assert.doesNotMatch(ADAPTER, /group\('Project'/, 'the Project disclosure is gone');
  const header = BODY.slice(0, BODY.indexOf('</header>'));
  assert.doesNotMatch(header, /<details|<summary/);
  assert.match(header, /<button id="part-menu"[^>]*aria-haspopup="menu"[^>]*popovertarget="part-menu-items"/);
  assert.match(header, /<div id="part-menu-items" class="cs-menu" popover role="menu"/);
});

test('all five reference-product functions RP-CAD-01 to -05 are live controls in their places with zero planned placeholders', () => {
  assert.doesNotMatch(HTML, /planned-control\.js/, 'no planned-control helper remains');
  assert.doesNotMatch(HTML, /data-ds-not-yet|data-ds-backlog/, 'zero planned placeholders remain');
  assert.match(HTML, /<script src="\/api\/cad-studio\/assets\/cad-viewport-tools\.js"><\/script>/);
  const strip = blockOf('div', 'class="tool-strip"');
  assert.deepEqual([...strip.matchAll(/<button id="([\w-]+)"/g)].map((m) => m[1]), ['tool-add', 'tool-report', 'tool-measure'], 'Measure follows Add feature and Report in the tool strip');
  const measureBar = blockOf('div', 'id="cad-measure-bar"');
  assert.deepEqual([...measureBar.matchAll(/data-measure-mode="([\w-]+)"/g)].map((m) => m[1]), ['point', 'edge', 'face', 'bbox']);
  assert.deepEqual([...measureBar.matchAll(/<option value="([\w-]+)"/g)].map((m) => m[1]), ['mm', 'in']);
  const cube = blockOf('div', 'class="viewer-cube"');
  assert.deepEqual([...cube.matchAll(/data-cad-view="([\w-]+)"/g)].map((m) => m[1]), ['top', 'front', 'right', 'back', 'left', 'bottom', 'iso']);
  assert.match(cube, /id="view-fit"/);
  assert.match(blockOf('div', 'class="viewer-edge"'), /id="tool-ar"[^>]*>AR</, 'AR sits on the canvas\'s right edge');
  const arSheet = blockOf('dialog', 'id="ar-sheet"');
  assert.match(arSheet, /id="cad-ar-usdz"[^>]*rel="ar"/);
  assert.match(arSheet, /id="cad-ar-android"/);
  assert.match(arSheet, /id="cad-ar-qr"/);
  for (const fmt of ["'obj'", "'mtl'", "'3mf'"]) assert.ok(JS.includes(`[${fmt},`), `EXPORTS includes ${fmt}`);
  const exportSheet = blockOf('dialog', 'id="export-sheet"');
  assert.ok(exportSheet.indexOf('id="export-list"') < exportSheet.indexOf('id="send-printer"'), 'Send to printer follows the export file list');
  const printSheet = blockOf('dialog', 'id="print-sheet"');
  assert.match(printSheet, /id="printer-url"/);
  assert.match(printSheet, /id="printer-upload"/);
  assert.match(printSheet, /id="printer-dl-3mf"/);
});

test('New part opens a ready part on the 60 x 40 x 30 mm box without asking anything', async () => {
  const pick = (from, to) => { const a = JS.indexOf(from); assert.ok(a > 0, from); return JS.slice(a, JS.indexOf(to, a)); };
  const source = pick('  /** The base box a new part starts from', '  /** Rename puts the caret');
  const requests = [];
  const context = { selection: () => ({ epoch: 1 }), selected: () => true, toast() {}, startPoll() {}, loadModels: async () => {}, showBuild() {},
    applyResponse: () => true, api: async (route, opts) => { requests.push({ route, opts }); return { model: { model_id: 'm1' }, build: { ok: true } }; } };
  vm.createContext(context);
  vm.runInContext(source + ';this.createModel = createModel;', context);
  await context.createModel();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].route, '/models');
  assert.equal(requests[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].opts.json)), { title: 'Untitled part', base: { kind: 'box', sizeX: 60, sizeY: 40, sizeZ: 30 } });
});
