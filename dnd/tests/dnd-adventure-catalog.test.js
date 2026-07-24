/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove the multi-campaign catalog has complete story arcs, valid shared clue graphs, distinct themes, and packaged map art.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadAdventureCatalog, resolveAdventure, resolveScene,
} = require('../lib/dnd-adventure-catalog');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const catalog = loadAdventureCatalog(dataDir, readJson);
const addedIds = [
  'astronomers-last-night',
  'bells-beneath-blackwater',
  'crownfall-masquerade',
  'road-last-lantern',
];

/** @description Validate lead prerequisites stay inside their authored chapter. */
function validateLeadGraph(scene) {
  const leads = scene.exploration.leads;
  const ids = new Set(leads.map((lead) => lead.id));
  assert.equal(ids.size, leads.length, `${scene.id} lead ids must be unique`);
  leads.forEach((lead) => {
    (lead.requires || []).forEach((required) => {
      assert.ok(ids.has(required), `${scene.id}/${lead.id} requires an authored lead`);
      assert.notEqual(required, lead.id, `${scene.id}/${lead.id} cannot require itself`);
    });
    assert.ok(lead.name && lead.prompt && lead.reveal, `${scene.id}/${lead.id} is playable`);
  });
}

test('catalog preserves the starter and adds four original campaign worlds', () => {
  assert.equal(catalog.adventure.id, 'goblin-ambush');
  addedIds.forEach((id) => assert.equal(resolveAdventure(catalog, id).id, id));
  assert.equal(new Set(catalog.adventures.map((entry) => entry.theme && entry.theme.id)).size, 5);
});

test('every added campaign has beginning, middle, climax, and falling action', () => {
  for (const id of addedIds) {
    const adventure = resolveAdventure(catalog, id);
    assert.deepEqual(
      adventure.scenes.map((scene) => scene.act),
      ['beginning', 'middle', 'climax', 'falling-action'],
    );
    assert.deepEqual(
      adventure.scenes.map((scene) => scene.kind),
      ['exploration', 'exploration', 'combat', 'exploration'],
    );
    assert.equal(adventure.scenes.at(-1).next, null);
  }
});

test('investigations package valid shared clues and every scene has map art', () => {
  for (const adventure of catalog.adventures) {
    for (const scene of adventure.scenes || []) {
      assert.equal(resolveScene(catalog, scene.id).id, scene.id);
      assert.ok(fs.existsSync(path.join(dataDir, 'maps', `${scene.id}.jpg`)), `${scene.id} map`);
      if (scene.kind === 'exploration') {
        validateLeadGraph(scene);
        assert.ok(scene.exploration.required <= scene.exploration.leads.length);
      } else {
        assert.ok((scene.monsters || []).length > 0, `${scene.id} has a climax cast`);
      }
    }
  }
});
