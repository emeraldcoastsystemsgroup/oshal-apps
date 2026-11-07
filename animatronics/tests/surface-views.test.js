/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (animatronics--animatronics, SPLIT): the 11-column
 *   calibration table sat between the rig view and the pose and jog controls, pose buttons were 17px and Delete rig sat
 *   beside Rename. Guards the two views (Perform by default; Rig setup), every section's place, the phone sheets and
 *   the one Log sheet, one primary per view, E-STOP in the header, the 44px pose actions with delete in a row menu, the
 *   in-page Delete rig confirm, the disarm note on Save calibration and headings without inline sentences.
 *
 * Dependency-free `node --test` suite over the shipped page and script (the browser proof is surface.core.spec.mjs).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'animatronics.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'tools', 'animatronics.js'), 'utf8');
const body = html.slice(html.indexOf('<body'));
/** The data-part of the section (or aside) that holds a control. */
function partOf(id) {
  const at = body.indexOf(`id="${id}"`); assert.ok(at > 0, id);
  const open = body.lastIndexOf('data-part="', at);
  return body.slice(open + 11, body.indexOf('"', open + 11));
}

test('Perform is the default view; Rig setup holds templates, rigs, calibration, the controller and the budget', () => {
  assert.match(body, /^<body data-view="perform">/);
  assert.match(html, /setView\(\/\(\^\|\[#&\]\)view=setup\\b\/\.test\(location\.hash\) \? 'setup' : 'perform'\)/);
  for (const id of ['template-select', 'new-rig', 'rigs', 'channels', 'save-rig', 'connect', 'arm', 'budget']) assert.equal(partOf(id), 'setup', id);
  for (const id of ['view', 'replay', 'jog', 'poses', 'scenario-select', 'play', 'lookpad', 'verdict', 'runs', 'buildActions']) assert.equal(partOf(id), 'perform', id);
  assert.match(html, /body\[data-view="perform"\] \[data-part="setup"\], body\[data-view="setup"\] \[data-part="perform"\] \{ display: none !important; \}/);
});

test('on a phone the rig view stays and the rest are bottom-bar sheets; rehearsal, command log and build note are one Log', () => {
  assert.deepEqual([...body.matchAll(/class="view-tab phone" data-sheet="(\w+)"/g)].map((m) => m[1]), ['jog', 'poses', 'scenarios', 'look']);
  assert.match(body, /id="tab-more" aria-haspopup="menu" popovertarget="more-menu">More</);
  assert.equal((body.match(/data-sheet-id="log"/g) || []).length, 3, 'rehearsal, command log and build note');
  assert.match(body, /data-sheet-id="talk"/);
  assert.match(html, /\.rig-view \{ position: sticky;/);
  assert.match(html, /\.toast \{ bottom: calc\(72px \+ env\(safe-area-inset-bottom, 0px\)\); right: 84px; \}/, 'the toast sits above the bottom bar');
});

test('one primary per view (New rig, Play) and E-STOP in the header on every view', () => {
  assert.deepEqual([...body.matchAll(/<button id="([\w-]+)" class="primary"/g)].map((m) => m[1]), ['new-rig', 'play']);
  const header = body.slice(0, body.indexOf('</header>'));
  assert.match(header, /<button id="estop" class="estop"/);
});

test('pose actions are 44px with delete in a row menu; Delete rig confirms in the page, apart from Rename', () => {
  assert.match(js, /class: 'pose-act', text: 'view'/);
  assert.match(js, /'aria-haspopup': 'menu', popovertarget: menuId/);
  assert.doesNotMatch(js, /text: '×', title: 'delete'/);
  assert.match(html, /\.chip \.pose-act \{ min-width: 44px; min-height: 44px;/);
  assert.match(body, /<div id="rig-menu" class="menu" popover role="menu" aria-label="Rig actions"><button id="delete-rig"/);
  assert.doesNotMatch(js, /confirm\('Delete rig/, 'no native dialog for Delete rig');
  assert.match(js, /\$\('delete-confirm'\)\.hidden = false;/);
  assert.match(body, />Save calibration · disarms the rig</);
});

test('headings carry no inline sentences; Help holds them', () => {
  assert.doesNotMatch(body, /<h2>[^<]*<small/);
  assert.match(body, /<dialog id="help"/);
  assert.match(body, /Saving a calibration change disarms the rig; a rename does not\./);
});

test('every bar, sheet and menu the page added is opaque: the theme card tone over the page colour (light-blue cards are 62% white)', () => {
  assert.match(html, /\.view-bar, \.menu\[popover\], dialog#help, \.toast \{ background: linear-gradient\(var\(--an-panel\), var\(--an-panel\)\), var\(--an-bg\); \}/);
  assert.match(html, /\.sheet\.open, \.sheet\.open \.sheet-head, \.rig-view \{ background: linear-gradient/);
});
