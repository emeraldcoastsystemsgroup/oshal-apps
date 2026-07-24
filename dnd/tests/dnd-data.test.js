/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-20 22:25:05 | roger.murphy@emeraldcoastsystemsgroup.com   | Data-integrity guard for the D&D content pack: every adventure token spawns on a legal cell, every monster ref resolves, and every action is well-formed for the tabletop engine. Runs with plain `node` (no framework); exits non-zero on any failure.
 * 2026-07-20 23:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | v0.2: roster heroes covered; start-cell requirement scoped to the classic four.
 * 2026-07-20 19:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | v0.3: multi-SCENE adventure shape (positional partyStart seats, props, scene.next chain must terminate), leveling table coverage (every hero class has a level-2 delta), and cone-AoE action shape.
 * 2026-07-21 19:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Require coherent starting inventory for every bundled hero: typed mundane items, all five coin denominations, and one inventory item per weapon action.
 * 2026-07-22 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Require every adventure scene to carry a persistent player-visible story anchor.
 * 2026-07-23 00:39:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Require every recurring foe to have a proper name, distinct role, playable manner, and continuity hook.
 */

'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data');
const party = JSON.parse(fs.readFileSync(path.join(dir, 'party.json'), 'utf8')).party;
const roster = JSON.parse(fs.readFileSync(path.join(dir, 'srd-roster.json'), 'utf8')).roster;
const bestiary = JSON.parse(fs.readFileSync(path.join(dir, 'srd-monsters.json'), 'utf8')).monsters;
const adv = JSON.parse(fs.readFileSync(path.join(dir, 'adventure-goblin-ambush.json'), 'utf8'));
const leveling = JSON.parse(fs.readFileSync(path.join(dir, 'srd-leveling.json'), 'utf8'));

let failures = 0;
const check = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } };
const key = (x, y) => x + ',' + y;
const inventoryCategories = new Set(['weapon', 'armor', 'ammunition', 'adventuring-gear', 'focus', 'tool', 'clothing']);
const coinDenominations = ['cp', 'sp', 'ep', 'gp', 'pp'];

// The engine reads these fields per action.mode — assert every action supplies them.
function checkAction(owner, a) {
  check(!!a.name && !!a.mode && !!a.delivery, `${owner}: action "${a.id}" has name/mode/delivery`);
  if (a.mode === 'attack') { check(typeof a.toHit === 'number', `${owner}/${a.id}: attack has toHit`); check(a.damage && a.damage.dice, `${owner}/${a.id}: attack has damage.dice`); }
  if (a.mode === 'save') { check(a.save && typeof a.save.dc === 'number' && a.save.ability, `${owner}/${a.id}: save has dc+ability`); check(a.damage && a.damage.dice, `${owner}/${a.id}: save has damage.dice`); }
  if (a.mode === 'autohit') { check(a.damage && a.damage.dice, `${owner}/${a.id}: autohit has damage`); check(a.darts >= 1, `${owner}/${a.id}: autohit has darts`); }
  if (a.mode === 'heal') { check(a.heal && a.heal.dice, `${owner}/${a.id}: heal has heal.dice`); }
  if (a.delivery === 'ranged') check(typeof a.range === 'number', `${owner}/${a.id}: ranged has range`);
  if (a.type === 'spell' && a.slot) check(typeof a.slot === 'number', `${owner}/${a.id}: spell slot is numeric`);
  if (a.aoeShape) { check(a.aoeShape === 'cone', `${owner}/${a.id}: aoeShape supported`); check(typeof a.aoeSize === 'number' && a.aoeSize >= 5, `${owner}/${a.id}: aoeSize sane`); check(a.mode === 'save', `${owner}/${a.id}: cone AoE resolves via saves`); }
}

// Starting inventory is deliberately small and data-oriented. `actionId` is the
// stable bridge from a carried weapon to the tested combat action it enables.
function checkInventory(pc) {
  const inv = pc.inventory;
  check(!!inv && typeof inv === 'object' && !Array.isArray(inv), `hero ${pc.id}: inventory object present`);
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) return;

  check(Array.isArray(inv.items) && inv.items.length > 0, `hero ${pc.id}: inventory has items`);
  const itemIds = new Set();
  (inv.items || []).forEach((item, i) => {
    const at = `hero ${pc.id}: inventory item ${i + 1}`;
    check(!!item && typeof item === 'object' && !Array.isArray(item), `${at} is an object`);
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    check(typeof item.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id), `${at} has a stable id`);
    check(!itemIds.has(item.id), `${at} id "${item.id}" is unique`);
    itemIds.add(item.id);
    check(typeof item.name === 'string' && item.name.trim().length > 0, `${at} has a name`);
    check(inventoryCategories.has(item.category), `${at} has a supported category`);
    check(Number.isInteger(item.quantity) && item.quantity > 0, `${at} has a positive integer quantity`);
    check(typeof item.equipped === 'boolean', `${at} declares equipped state`);
    if (item.category === 'weapon') check(typeof item.actionId === 'string' && item.actionId.length > 0, `${at} weapon maps to an actionId`);
    if (item.actionId !== undefined) {
      const action = (pc.actions || []).find((a) => a.id === item.actionId);
      check(item.category === 'weapon', `${at} actionId is only used by weapons`);
      check(!!action && action.type === 'weapon', `${at} actionId "${item.actionId}" resolves to a weapon action`);
    }
  });

  const coins = inv.coins;
  check(!!coins && typeof coins === 'object' && !Array.isArray(coins), `hero ${pc.id}: coin purse present`);
  if (coins && typeof coins === 'object' && !Array.isArray(coins)) {
    check(Object.keys(coins).sort().join(',') === coinDenominations.slice().sort().join(','), `hero ${pc.id}: coin purse has exactly cp/sp/ep/gp/pp`);
    coinDenominations.forEach((denom) => check(Number.isInteger(coins[denom]) && coins[denom] >= 0, `hero ${pc.id}: ${denom} is a non-negative integer`));
  }

  (pc.actions || []).filter((a) => a.type === 'weapon').forEach((action) => {
    const matches = (inv.items || []).filter((item) => item.actionId === action.id);
    check(matches.length === 1, `hero ${pc.id}: weapon action "${action.id}" has exactly one inventory item`);
  });
}

// Hero sanity (classic party + roster) + spells must be castable + unique ids.
const heroes = party.concat(roster);
heroes.forEach((pc) => {
  check(pc.id && pc.name && pc.maxHp > 0 && pc.ac > 0 && pc.speed > 0, `hero ${pc.id}: core stats present`);
  (pc.actions || []).forEach((a) => {
    checkAction('pc:' + pc.id, a);
    if (a.type === 'spell' && a.slot) check(pc.slots && pc.slots[String(a.slot)] >= 1, `pc:${pc.id}/${a.id}: has an L${a.slot} slot to cast it`);
  });
  checkInventory(pc);
  // Every playable class must have a level-2 delta so /advance never no-ops a class.
  check(!!leveling.level2[pc.class], `hero ${pc.id}: class "${pc.class}" has a level-2 delta`);
});
const ids = new Set();
heroes.forEach((pc) => { check(!ids.has(pc.id), `hero id ${pc.id} is unique`); ids.add(pc.id); });

// Scenes: shape, spawn legality, monster refs, seat count, terminating chain.
check(Array.isArray(adv.scenes) && adv.scenes.length >= 2, 'adventure has at least two scenes');
const sceneIds = new Set(adv.scenes.map((s) => s.id));
adv.scenes.forEach((scene) => {
  const g = scene.grid;
  check(g && g.w > 0 && g.h > 0, `scene ${scene.id}: grid has positive dimensions`);
  check(typeof scene.opening === 'string' && scene.opening.length > 40, `scene ${scene.id}: has a real opening`);
  check(typeof scene.storyAnchor === 'string' && scene.storyAnchor.length > 40, `scene ${scene.id}: has a persistent story anchor`);
  check(Array.isArray(scene.openingChoices) && scene.openingChoices.length === 3 && scene.openingChoices.every((c) => typeof c === 'string' && c.length), `scene ${scene.id}: offers exactly 3 opening choices`);
  check(scene.next === null || scene.next === undefined || sceneIds.has(scene.next), `scene ${scene.id}: next points at a real scene`);
  const blocked = new Set((scene.terrain.blocking || []).map((c) => key(c.x, c.y)));
  check(Array.isArray(scene.partyStart) && scene.partyStart.length >= 4, `scene ${scene.id}: has 4 positional seats`);
  scene.partyStart.forEach((c, i) => {
    check(c.x >= 0 && c.y >= 0 && c.x < g.w && c.y < g.h, `scene ${scene.id} seat ${i}: in bounds`);
    check(!blocked.has(key(c.x, c.y)), `scene ${scene.id} seat ${i}: not on a blocking cell`);
  });
  (scene.props || []).forEach((p) => {
    check(p.x >= 0 && p.y >= 0 && p.x < g.w && p.y < g.h, `scene ${scene.id} prop ${p.id}: in bounds`);
  });
  scene.monsters.forEach((m) => {
    const ref = bestiary[m.ref];
    check(!!ref, `scene ${scene.id} monster ${m.instanceId}: ref "${m.ref}" exists`);
    check(typeof m.name === 'string' && m.name.trim().length >= 3, `scene ${scene.id} monster ${m.instanceId}: has a proper name`);
    check(typeof m.role === 'string' && m.role.trim().length >= 3, `scene ${scene.id} monster ${m.instanceId}: has a distinct role`);
    check(typeof m.personality === 'string' && m.personality.trim().length >= 20, `scene ${scene.id} monster ${m.instanceId}: has a playable personality`);
    check(typeof m.storyHook === 'string' && m.storyHook.trim().length >= 20, `scene ${scene.id} monster ${m.instanceId}: has a continuity hook`);
    check(!/^(goblin|wolf|guard|archer|skirmisher|cutter|cook)(?:\s|\(|$)/i.test(m.name), `scene ${scene.id} monster ${m.instanceId}: role is not used as its name`);
    check(m.x >= 0 && m.y >= 0 && m.x < g.w && m.y < g.h, `scene ${scene.id} ${m.instanceId}: in bounds`);
    check(!blocked.has(key(m.x, m.y)), `scene ${scene.id} ${m.instanceId}: not on a blocking cell`);
    if (ref) { check((ref.actions || []).length > 0, `${m.ref}: has actions`); ref.actions.forEach((a) => checkAction('mon:' + m.ref, a)); }
  });
  // No two starting tokens share a cell within a scene.
  const occ = {};
  [...scene.partyStart.map((c, i) => ({ id: 'seat' + i, x: c.x, y: c.y })), ...(scene.props || []), ...scene.monsters].forEach((t) => {
    const k = key(t.x, t.y);
    check(!occ[k], `scene ${scene.id} cell ${k}: one starting token (conflict: ${occ[k]} vs ${t.id || t.instanceId})`);
    occ[k] = t.id || t.instanceId;
  });
  check(typeof scene.xpReward === 'number' && scene.xpReward > 0, `scene ${scene.id}: awards XP`);
});

// The arc must terminate (no cycles): walk next pointers from scene 1.
let cursor = adv.scenes[0], hops = 0;
while (cursor && cursor.next && hops < 10) { cursor = adv.scenes.find((s) => s.id === cursor.next); hops++; }
check(cursor && !cursor.next, 'scene chain terminates');

// Leveling: thresholds sane; the arc must actually deliver a level-up — scene 1's
// award (combat + story) has to cross the level-2 threshold so /advance fires the
// level-up BEFORE the finale (the design intent: face the ravine at level 2).
check(leveling.thresholds['2'] > 0, 'level-2 threshold exists');
const perPcScene1 = Math.round(((adv.scenes[0].xpReward || 0) + (adv.scenes[0].storyAward || 0)) / 4);
check(perPcScene1 >= leveling.thresholds['2'], `scene-1 award (${perPcScene1}/pc) reaches the level-2 threshold (${leveling.thresholds['2']})`);

if (failures) { console.error(`\n✗ ${failures} data-integrity failure(s)`); process.exit(1); }
console.log('✓ D&D content pack is coherent and playable (heroes, bestiary, scenes, leveling all check out)');
