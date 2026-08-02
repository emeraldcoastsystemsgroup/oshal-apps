/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-27 23:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove every discovered lead puts exactly one figure on the board, on the square the hero walks to, without ever duplicating an authored prop — across every authored chapter, not just a fixture.
 * 2026-07-28 00:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Pin figure placement OFF blocking terrain and party seats (the leads.js array-vs-object shape bug) and prove the authoritative hero walk lands beside the figure, in bounds, off walls, unstacked — across every authored chapter.
 * 2026-07-31 11:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Require the prop link itself: "Tovin Quill, Assistant" vs authored prop "Tovin Quill" sailed past the duplicate-NAME check (the strings differ) while still putting the same person on the board twice — the astronomers adventure shipped with zero links while the other four were fully linked. Word overlap between a person lead and a same-scene prop now demands a declared link.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const cast = require('../lib/dnd-lead-cast.js');
const LEADS = require('../ui/leads.js');

const dataDir = path.join(__dirname, '..', 'data');

/** @description Every authored exploration chapter across every shipped adventure. */
function explorationScenes() {
  return fs.readdirSync(dataDir)
    .filter((file) => file.startsWith('adventure-') && file.endsWith('.json'))
    .flatMap((file) => {
      const adventure = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      return (adventure.scenes || [])
        .filter((scene) => scene.exploration && Array.isArray(scene.exploration.leads))
        .map((scene) => ({ file, scene }));
    });
}

/** @description The board a chapter opens with: the authored props, no party. */
function openingTokens(scene) {
  return (scene.props || []).map((prop) => ({
    id: prop.id, kind: 'prop', name: prop.name, x: prop.x, y: prop.y,
  }));
}

test('every discovered lead ends up represented on the board exactly once', () => {
  const scenes = explorationScenes();
  assert.ok(scenes.length >= 5, 'the shipped adventures must contribute exploration chapters');
  for (const { file, scene } of scenes) {
    const leads = scene.exploration.leads;
    const result = cast.reconcileDiscoveredCast(
      openingTokens(scene), leads, leads.map((lead) => lead.id), scene,
    );
    for (const lead of leads) {
      const authored = cast.authoredPropId(lead, scene);
      const id = authored || cast.castIdFor(lead);
      const matches = result.tokens.filter((token) => token.id === id);
      assert.equal(matches.length, 1, `${file}/${scene.id}: ${lead.id} must have one figure`);
    }
  }
});

test('a lead that names an authored prop never puts a second copy on the map', () => {
  for (const { file, scene } of explorationScenes()) {
    const leads = scene.exploration.leads;
    const result = cast.reconcileDiscoveredCast(
      openingTokens(scene), leads, leads.map((lead) => lead.id), scene,
    );
    const names = result.tokens.map((token) => token.name);
    assert.equal(new Set(names).size, names.length, `${file}/${scene.id} has a duplicated figure`);
    const cells = result.tokens.map((token) => `${token.x},${token.y}`);
    assert.equal(new Set(cells).size, cells.length, `${file}/${scene.id} stacks two figures on one square`);
  }
});

test('a person lead naming someone who already stands on the map declares its prop link', () => {
  // The duplicate-name check above cannot see "Tovin Quill, Assistant" and "Tovin
  // Quill" as the same person — the strings differ. Shared distinctive name words
  // between a person lead and a same-scene authored prop are the tell that the lead
  // is ABOUT that standing figure, and an unlinked one casts a second copy.
  const stop = new Set(['the', 'and', 'from', 'with', 'for', 'her', 'his', 'their']);
  const words = (name) => new Set(String(name).toLowerCase().replace(/['’]s\b/g, '')
    .split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !stop.has(word)));
  for (const { file, scene } of explorationScenes()) {
    for (const lead of scene.exploration.leads) {
      if (String(lead.type || 'person') !== 'person') continue;
      if (cast.authoredPropId(lead, scene)) continue;
      const leadWords = words(lead.name);
      for (const prop of scene.props || []) {
        const overlap = [...words(prop.name)].filter((word) => leadWords.has(word));
        assert.equal(overlap.length, 0,
          `${file}/${scene.id}: person lead "${lead.id}" (${lead.name}) shares "${overlap.join(', ')}" with unlinked prop "${prop.id}" (${prop.name}) — declare prop: or the party meets them twice`);
      }
    }
  }
});

test('a cast figure stands on the exact square the acting hero walks to', () => {
  const { scene } = explorationScenes().find((entry) => entry.scene.id === 'crownfall-joust');
  const leads = scene.exploration.leads;
  const taster = leads.find((lead) => lead.id === 'taster');
  const result = cast.withDiscoveredLead(openingTokens(scene), taster, scene, leads);
  const spot = LEADS.leadSpot(taster, scene, leads);
  assert.ok(result.cast, 'the missing royal taster must appear');
  assert.deepEqual({ x: result.cast.x, y: result.cast.y }, { x: spot.x, y: spot.y });
});

test('placement is deterministic — every device casts the same figure on the same cell', () => {
  for (const { scene } of explorationScenes()) {
    const leads = scene.exploration.leads;
    const first = cast.reconcileDiscoveredCast(openingTokens(scene), leads, leads.map((l) => l.id), scene);
    const second = cast.reconcileDiscoveredCast(openingTokens(scene), leads, leads.map((l) => l.id), scene);
    assert.deepEqual(
      first.tokens.map((t) => `${t.id}@${t.x},${t.y}`),
      second.tokens.map((t) => `${t.id}@${t.x},${t.y}`),
    );
  }
});

test('casting is idempotent — a repeated discovery never grows the board', () => {
  const { scene } = explorationScenes().find((entry) => entry.scene.id === 'crownfall-lantern-ward');
  const leads = scene.exploration.leads;
  const clerk = leads.find((lead) => lead.id === 'clerk');
  const once = cast.withDiscoveredLead(openingTokens(scene), clerk, scene, leads);
  const twice = cast.withDiscoveredLead(once.tokens, clerk, scene, leads);
  assert.equal(twice.tokens.length, once.tokens.length);
  assert.equal(twice.cast, null, 'a re-discovery reports no new arrival');
});

test('an undiscovered lead has no presence on the board', () => {
  const { scene } = explorationScenes().find((entry) => entry.scene.id === 'crownfall-joust');
  const leads = scene.exploration.leads;
  const result = cast.reconcileDiscoveredCast(openingTokens(scene), leads, ['taster'], scene);
  assert.ok(result.tokens.some((token) => token.id === cast.castIdFor({ id: 'taster' })));
  assert.ok(!result.tokens.some((token) => token.id === cast.castIdFor({ id: 'stable' })),
    'the royal stable must stay off the map until the party searches it');
});

test('a chapter played before figures existed repairs its whole cast at once', () => {
  const { scene } = explorationScenes().find((entry) => entry.scene.id === 'crownfall-joust');
  const leads = scene.exploration.leads;
  const alreadyFound = leads.map((lead) => lead.id);
  const result = cast.reconcileDiscoveredCast(openingTokens(scene), leads, alreadyFound, scene);
  const newFigures = result.cast.length;
  const authored = leads.filter((lead) => cast.authoredPropId(lead, scene)).length;
  assert.equal(newFigures + authored, leads.length, 'every already-found lead must be filled in');
});

test('a cast figure carries the identity the inspector needs', () => {
  const { scene } = explorationScenes().find((entry) => entry.scene.id === 'blackwater-harbor');
  const leads = scene.exploration.leads;
  const bell = leads.find((lead) => lead.id === 'bell');
  const result = cast.withDiscoveredLead(openingTokens(scene), bell, scene, leads);
  assert.equal(result.cast.kind, 'prop');
  assert.equal(result.cast.name, bell.name);
  assert.equal(result.cast.leadId, 'bell');
  assert.equal(result.cast.storyHook, bell.reveal);
  assert.ok(result.cast.role, 'a figure must say what it is doing in the story');
  assert.ok(result.cast.glyph && result.cast.color);
});

test('no figure is ever cast onto blocking terrain or a party start seat', () => {
  // Guards the leads.js blockedCells data-shape bug: authored terrain/partyStart
  // are {x,y} objects; reading [0]/[1] made avoidance a silent no-op and dropped
  // figures inside walls and onto heroes' spawn squares.
  for (const { file, scene } of explorationScenes()) {
    const leads = scene.exploration.leads;
    const result = cast.reconcileDiscoveredCast(
      openingTokens(scene), leads, leads.map((lead) => lead.id), scene,
    );
    const blocked = new Set(((scene.terrain || {}).blocking || []).map((cell) => `${cell.x},${cell.y}`));
    const seats = new Set((scene.partyStart || []).map((cell) => `${cell.x},${cell.y}`));
    for (const token of result.tokens.filter((entry) => entry.leadId)) {
      const at = `${token.x},${token.y}`;
      assert.ok(!blocked.has(at), `${file}/${scene.id}: ${token.id} stands inside blocking terrain at ${at}`);
      assert.ok(!seats.has(at), `${file}/${scene.id}: ${token.id} stands on a party spawn seat at ${at}`);
    }
  }
});

test('the authoritative hero walk lands beside the figure, in bounds, off walls', () => {
  for (const { file, scene } of explorationScenes()) {
    const leads = scene.exploration.leads;
    const blocked = new Set(((scene.terrain || {}).blocking || []).map((cell) => `${cell.x},${cell.y}`));
    const grid = scene.grid || { w: 18, h: 12 };
    for (const lead of leads) {
      const seeded = openingTokens(scene)
        .concat([{ id: 'hero-1', kind: 'pc', slug: 'hero-1', name: 'Hero', x: 0, y: 0 }]);
      const walked = cast.walkHeroBesideLead(seeded, 'hero-1', lead, scene, leads);
      const hero = walked.tokens.find((token) => token.id === 'hero-1');
      const spot = cast.figureCellForLead(lead, scene, walked.tokens, leads);
      if (!walked.moved) continue; // a full ring is allowed to leave the hero in place
      assert.ok(hero.x >= 0 && hero.y >= 0 && hero.x < grid.w && hero.y < grid.h, `${file}/${scene.id}/${lead.id} walk left the grid`);
      assert.ok(!blocked.has(`${hero.x},${hero.y}`), `${file}/${scene.id}/${lead.id} walked into a wall`);
      assert.equal(Math.max(Math.abs(hero.x - spot.x), Math.abs(hero.y - spot.y)), 1, `${file}/${scene.id}/${lead.id} hero must stand beside the figure`);
      assert.ok(!walked.tokens.some((other) => other.id !== 'hero-1' && other.x === hero.x && other.y === hero.y), `${file}/${scene.id}/${lead.id} hero stacked on another token`);
    }
  }
});
