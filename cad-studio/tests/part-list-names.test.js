/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 8: two parts named 'Centre plate (top and bottom) - recon-mini',
 *                     |                             | made a day apart, read identically ('r1') in the parts list and the
 *                     |                             | concierge called them the same model. Runs the served
 *                     |                             | tools/cad-studio.js: a repeated title carries 'made <date>', a unique
 *                     |                             | title carries nothing, and the short id breaks a same-minute tie.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'tools', 'cad-studio.js'), 'utf8');

function loadPartNotes() {
  const AppView = { active: () => true }; // an audience view is active, so the full studio does not boot
  const window = { AppView };
  vm.runInNewContext(SRC, { window, AppView, document: {}, location: { search: '' }, URLSearchParams, Date, Map, Number, String });
  assert.ok(window.CadStudioParts, 'the served script exposes CadStudioParts');
  return window.CadStudioParts.partNotes;
}

const PLATE = 'Centre plate (top and bottom) - recon-mini';

test('two same-named parts made a day apart read differently; a unique part has no note', () => {
  const partNotes = loadPartNotes();
  const notes = partNotes([
    { model_id: 'a1111111-0000', title: PLATE, created_at: '2026-10-12T00:13:23Z' },
    { model_id: 'b2222222-0000', title: 'Bracket', created_at: '2026-10-10T09:00:00Z' },
    { model_id: 'c3333333-0000', title: ` ${PLATE.toUpperCase()} `, created_at: '2026-10-11T10:48:46Z' },
  ]);
  assert.equal(notes[1], '');
  assert.match(notes[0], /^made /);
  assert.match(notes[2], /^made /);
  assert.notEqual(notes[0], notes[2]);
});

test('same name made in the same minute adds the short id', () => {
  const partNotes = loadPartNotes();
  const notes = partNotes([
    { model_id: 'aaaaaaaa-1', title: 'Gear', created_at: '2026-10-12T00:13:01Z' },
    { model_id: 'bbbbbbbb-2', title: 'Gear', created_at: '2026-10-12T00:13:40Z' },
  ]);
  assert.match(notes[0], / · #aaaaaaaa$/);
  assert.match(notes[1], / · #bbbbbbbb$/);
});

test('the list renders the note beside the title', () => {
  assert.match(SRC, /const notes = partNotes\(state\.models\);/);
  assert.match(SRC, /el\('span', \{ class: 'model-note', text: notes\[i\] \}\)/);
});
