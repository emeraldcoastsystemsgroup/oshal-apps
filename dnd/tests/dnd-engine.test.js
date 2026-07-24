/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 18:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Pin downed heroes, idempotent unmodified death saves, legal revival healing, final legacy death, and auto-play turns that resolve death saves instead of letting 0-HP heroes act.
 * 2026-07-21 17:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Pin the movement-cost map used by the clearer tabletop movement HUD, including difficult-terrain cost and zero-budget behavior.
 * 2026-07-20 20:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Plays the game. Drives the REAL shared engine (ui/engine.js) — the same module the live surface runs — through complete, deterministic battles and asserts every rule. Two layers: (1) unit cases pinning dice/movement/targeting/combat/saves/cone/heal/slots/sneak/initiative/AI/end-state/level-up with a scripted RNG; (2) a full auto-played fight over 300 seeds proving the tuned encounter always terminates and is winnable, plus a forced-defeat scenario proving the loss path. Plain `node tests/dnd-engine.test.js` — no framework.
 * 2026-07-21 21:28:07 | roger.murphy@emeraldcoastsystemsgroup.com  | Require every terminal and revived death-save result to retain its visible natural d20.
 * 2026-07-21 21:48:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Pin exact structured roll groups for every deterministic combat resolution path.
 * 2026-07-23 11:36:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Require accumulated death-save failures to distinguish prior damage from the current roll.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../ui/engine.js');

const dataDir = path.join(__dirname, '..', 'data');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
const party = rd('party.json').party;
const roster = rd('srd-roster.json').roster;
const heroes = party.concat(roster);
const bestiary = rd('srd-monsters.json').monsters;
const adventure = rd('adventure-goblin-ambush.json');
const leveling = rd('srd-leveling.json');
const heroById = (id) => JSON.parse(JSON.stringify(heroes.find((h) => h.id === id)));

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

// ── Deterministic RNG helpers ────────────────────────────────────────────────
/** RNG that always returns `v` (v→0.99 forces max/nat-20; v→0 forces nat-1). */
const constRng = (v) => () => v;
/** RNG that yields the given 0..1 values in order, then holds the last. */
function seqRng(vals) { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; }
/** A d20 value → the rng() that produces exactly it (mid-bucket, stable). */
const d20as = (n) => (n - 0.5) / 20;
/** mulberry32 — a tiny seeded PRNG for repeatable full playthroughs. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── World builder (mirrors the route's buildSceneState) ──────────────────────
function buildWorld(scene, partySheets) {
  const tokens = partySheets.map((pc, i) => {
    const at = scene.partyStart[i] || scene.partyStart[0];
    return { id: pc.id, kind: 'pc', slug: pc.id, name: pc.name, x: at.x, y: at.y,
      hp: pc.maxHp, maxHp: pc.maxHp, ac: pc.ac, speed: pc.speed,
      slots: pc.slots ? JSON.parse(JSON.stringify(pc.slots)) : {}, initiative: pc.initiative || 0 };
  });
  (scene.props || []).forEach((p) => tokens.push({ id: p.id, kind: 'prop', name: p.name, x: p.x, y: p.y }));
  scene.monsters.forEach((m) => {
    const ref = bestiary[m.ref];
    tokens.push({ id: m.instanceId, kind: 'monster', ref: m.ref, name: m.name, x: m.x, y: m.y,
      hp: ref.maxHp, maxHp: ref.maxHp, ac: ref.ac, speed: ref.speed, initiative: ref.initiative || 0 });
  });
  const blockSet = new Set((scene.terrain.blocking || []).map((c) => c.x + ',' + c.y));
  const diffSet = new Set((scene.terrain.difficult || []).map((c) => c.x + ',' + c.y));
  const sheetFor = (t) => t.kind === 'pc' ? heroes.find((h) => h.id === t.slug) : (t.kind === 'monster' ? bestiary[t.ref] : {});
  return { grid: scene.grid, blockSet, diffSet, tokens, sheetFor };
}
const scene1 = adventure.scenes[0];

// ═════════════════════════════════════════════════════════════════════════════
// LAYER 1 — deterministic unit rules
// ═════════════════════════════════════════════════════════════════════════════

// Dice
E.setRng(constRng(0.99));
check(E.die(20) === 20, 'die(20) tops out at 20 with high rng');
check(E.rollDice({ dice: '2d6', bonus: 3 }).total === 15, '2d6+3 all-max = 15');
check(E.rollDice({ dice: '1d8' }, true).total === 16, 'crit doubles 1d8 → 2×8 = 16');
E.setRng(constRng(0));
check(E.die(20) === 1, 'die(20) bottoms out at 1 with zero rng');
check(E.rollDice({ dice: '0d0', bonus: 5 }).total === 5, '0d0+5 heal pool = 5 (no dice)');

// Movement range: speed, difficult terrain, blocking, occupancy
(() => {
  const world = { grid: { w: 6, h: 3 }, blockSet: new Set(['3,1']), diffSet: new Set(['2,1']),
    tokens: [{ id: 'me', kind: 'pc', x: 1, y: 1, speed: 15 }, { id: 'ally', kind: 'pc', x: 1, y: 0 }], sheetFor: () => ({}) };
  const r = E.computeReachable(world, world.tokens[0]);
  const costs = E.computeMovementCosts(world, world.tokens[0]);
  check(!r.has('3,1'), 'movement cannot enter a blocking cell');
  check(!r.has('1,0'), 'movement cannot end on an occupied cell');
  check(r.has('2,1'), 'difficult cell is reachable (costs 2 of 3)');
  check(costs.get('2,1') === 2, 'movement map exposes the exact difficult-terrain cost');
  check(costs.get('1,1') === 0, 'movement map includes the starting square at zero cost');
  const slow = E.computeReachable({ ...world, tokens: [{ id: 'me', kind: 'pc', x: 1, y: 1, speed: 5 }] }, { id: 'me', kind: 'pc', x: 1, y: 1, speed: 5 });
  check(!slow.has('2,1'), 'a 5-ft mover cannot afford difficult terrain (cost 2 > 1)');
  const stopped = E.computeMovementCosts({ ...world, tokens: [{ id: 'me', kind: 'pc', x: 1, y: 1, speed: 0 }] }, { id: 'me', kind: 'pc', x: 1, y: 1, speed: 0 });
  check(stopped.size === 1 && stopped.get('1,1') === 0, 'zero remaining movement exposes no destination tiles');
})();

// Range checks
check(E.inRange({ delivery: 'melee', reach: 5 }, { x: 2, y: 2 }, { x: 3, y: 3 }), 'melee reaches an adjacent (diagonal) foe');
check(!E.inRange({ delivery: 'melee', reach: 5 }, { x: 2, y: 2 }, { x: 4, y: 2 }), 'melee cannot reach 10 ft away');
check(E.inRange({ delivery: 'ranged', range: 80 }, { x: 0, y: 0 }, { x: 10, y: 0 }), '80-ft bow reaches 50 ft (10 sq)');
check(!E.inRange({ delivery: 'ranged', range: 30 }, { x: 0, y: 0 }, { x: 10, y: 0 }), '30-ft javelin cannot reach 50 ft');

// Attack resolution: crit, miss on nat-1, hit applies damage + death
(() => {
  const world = { grid: { w: 5, h: 5 }, blockSet: new Set(), diffSet: new Set(),
    tokens: [{ id: 'p', kind: 'pc', name: 'Bram', x: 1, y: 1, hp: 12, maxHp: 12, ac: 18 },
             { id: 'g', kind: 'monster', name: 'Goblin', x: 2, y: 1, hp: 7, maxHp: 7, ac: 15 }], sheetFor: () => ({ mods: {} }) };
  const g = world.tokens[1];
  const sword = { name: 'Longsword', type: 'weapon', mode: 'attack', delivery: 'melee', reach: 5, toHit: 5, damage: { dice: '1d8', bonus: 3, type: 'slashing' } };
  E.setRng(constRng(0)); // nat 1
  let r = E.resolveAction(world, world.tokens[0], sword, g);
  check(/miss/.test(r.text) && g.hp === 7, 'natural 1 always misses (no damage)');
  check(r.rolls.length === 1 && r.rolls[0].kind === 'attack' && r.rolls[0].faces[0] === 1 && r.rolls[0].outcome === 'miss', 'a miss exposes its exact authoritative attack d20');
  E.setRng(constRng(0.99)); // nat 20 → crit, max dmg 2d8+3 = 19 → goblin (7) dies
  r = E.resolveAction(world, world.tokens[0], sword, g);
  check(r.killed && g.dead && g.hp === 0, 'a critical hit kills the goblin and flags it dead');
  check(r.rolls.map((roll) => roll.kind).join(',') === 'attack,damage' && r.rolls[1].dice === '2d8' && r.rolls[1].faces.join(',') === '8,8', 'a critical hit retains its d20 and every doubled damage die');
})();

// PCs fall unconscious at 0 HP; monsters still die and legacy dead PCs stay dead.
(() => {
  const hero = { id: 'bram', kind: 'pc', name: 'Bram', x: 1, y: 1, hp: 5, maxHp: 12 };
  const impact = E.applyDamage(hero, 8);
  check(hero.hp === 0 && hero.downed === true && hero.dead === false, 'fresh lethal PC damage creates a downed hero, not a dead one');
  check(impact.newlyDowned && !impact.killed, 'damage reports the new downed transition separately from final death');
  check(JSON.stringify(hero.deathSaves) === JSON.stringify({ successes: 0, failures: 0 }), 'fresh downing starts clean death-save counters');
  const world = { grid: { w: 3, h: 3 }, blockSet: new Set(), diffSet: new Set(), tokens: [hero], sheetFor: () => ({}) };
  check(E.occupied(world, 1, 1), 'a downed hero remains visibly present and occupies their square');

  const legacy = { id: 'old', kind: 'pc', name: 'Old Hero', hp: 0, maxHp: 10, dead: true };
  E.applyDamage(legacy, 3);
  check(legacy.dead === true && !legacy.downed && !legacy.deathSaves, 'a legacy dead PC remains finally dead');

  const target = { id: 'della', kind: 'pc', name: 'Della', x: 1, y: 1, hp: 1, maxHp: 12, ac: 10 };
  const attacker = { id: 'g', kind: 'monster', name: 'Goblin', x: 2, y: 1 };
  const strike = { name: 'Scimitar', mode: 'attack', delivery: 'melee', reach: 5, toHit: 4, damage: { dice: '1d4', bonus: 0, type: 'slashing' } };
  E.setRng(constRng(0.5));
  const resolution = E.resolveAction({ ...world, tokens: [target, attacker] }, attacker, strike, target);
  check(resolution.killed && target.downed && /DOWN at 0 HP/.test(resolution.text), 'action resolution reports a newly downed PC as a decisive narrated event');
})();

// Death saves are raw d20 rolls, standard 5e outcomes, and idempotent per turn.
(() => {
  const down = (name) => {
    const hero = { id: name.toLowerCase(), kind: 'pc', name, hp: 4, maxHp: 10 };
    E.applyDamage(hero, 4); return hero;
  };

  const hero = down('Bram');
  E.setRng(constRng(0)); // natural 1; no ability modifier is consulted
  let result = E.resolveDeathSave(hero, 41);
  check(result.natural === 1 && result.failures === 2 && hero.deathSaves.failures === 2, 'natural 1 causes two failed death saves with no modifier');
  check(result.rolls.length === 1 && result.rolls[0].kind === 'death-save' && result.rolls[0].faces[0] === 1 && result.rolls[0].target === 10, 'a death save exposes its exact raw d20 and DC');
  let rngCalls = 0; E.setRng(() => { rngCalls++; return 0.99; });
  result = E.resolveDeathSave(hero, 41);
  check(result.blocked && result.duplicate && rngCalls === 0 && hero.deathSaves.failures === 2, 'the same turn serial cannot roll or mutate a death save twice');
  check(result.rolls[0].faces[0] === 1, 'a death-save retry reuses the stored die instead of rolling again');
  result = E.resolveDeathSave(hero, 42, 10);
  check(result.status === 'success' && hero.deathSaves.successes === 1, 'a natural 10 succeeds without an ability modifier');
  E.resolveDeathSave(hero, 43, 19);
  result = E.resolveDeathSave(hero, 44, 12);
  check(result.status === 'stable' && hero.stable && hero.downed && !hero.dead && hero.deathSaves.successes === 3, 'three successes stabilize the hero at 0 HP');
  check(/rolls 12: death save stable/.test(result.text), 'a stable result retains the authoritative natural d20');
  E.applyDamage(hero, 1);
  check(hero.downed && !hero.stable && hero.deathSaves.successes === 0 && hero.deathSaves.failures === 1, 'damage to a stable 0-HP hero ends stability and causes one failed save');

  const doomed = down('Pip');
  E.applyDamage(doomed, 2);
  result = E.resolveDeathSave(doomed, 1, 9);
  check(/2 failures; 1 before this roll \+ 1 now/.test(result.text), 'an accumulated failure explains the prior damage and current d20 separately');
  E.resolveDeathSave(doomed, 2, 12);
  result = E.resolveDeathSave(doomed, 3, 8);
  check(result.status === 'dead' && doomed.dead && !doomed.downed && doomed.deathSaves.failures === 3, 'three failures cause final death');
  check(/rolls 8: death save dead/.test(result.text), 'a final failure retains the authoritative natural d20');

  const lucky = down('Fenwick');
  result = E.resolveDeathSave(lucky, 77, 20);
  check(result.status === 'revived' && lucky.hp === 1 && !lucky.downed && !lucky.stable && !lucky.dead, 'natural 20 restores 1 HP and lets the hero continue the same turn');
  check(/rolls a natural 20: death save revived/.test(result.text), 'a natural-20 revival remains parseable as a visible death-save die');
  check(JSON.stringify(lucky.deathSaves) === JSON.stringify({ successes: 0, failures: 0, lastRoll: 20, turnSerial: 77 }), 'natural 20 retains an idempotent resolved-turn marker');
})();

// Sneak attack only with an adjacent ally
(() => {
  const mk = () => ({ grid: { w: 6, h: 3 }, blockSet: new Set(), diffSet: new Set(),
    tokens: [{ id: 'pip', kind: 'pc', name: 'Pip', x: 1, y: 1, hp: 10, maxHp: 10, ac: 14 },
             { id: 'ally', kind: 'pc', name: 'Bram', x: 3, y: 1, hp: 12, maxHp: 12, ac: 18 },
             { id: 'g', kind: 'monster', name: 'Goblin', x: 2, y: 1, hp: 30, maxHp: 30, ac: 5 }], sheetFor: () => ({ mods: {} }) });
  const stab = { name: 'Shortsword', mode: 'attack', delivery: 'melee', reach: 5, toHit: 5, damage: { dice: '1d6', bonus: 3, type: 'piercing' }, sneak: '1d6' };
  // Hit on a nat-15 (NOT a crit), then max the damage dice → isolate the sneak rider.
  E.setRng(seqRng([d20as(15), 0.99]));
  let w = mk(); let result = E.resolveAction(w, w.tokens[0], stab, w.tokens[2]);
  const withAlly = 30 - w.tokens[2].hp; // 1d6+3 + 1d6 sneak, dice maxed = 6+3+6 = 15
  check(withAlly === 15, 'sneak attack fires when an ally is adjacent to the target (15)');
  check(result.rolls.map((roll) => roll.kind).join(',') === 'attack,damage,sneak' && result.rolls[2].faces[0] === 6, 'sneak damage is a distinct visible roll after attack and weapon damage');
  w = mk(); w.tokens[1].x = 5; // ally now far
  E.setRng(seqRng([d20as(15), 0.99])); E.resolveAction(w, w.tokens[0], stab, w.tokens[2]);
  const noAlly = 30 - w.tokens[2].hp; // 6+3 = 9, no sneak
  check(noAlly === 9, 'sneak attack does NOT fire without an adjacent ally');
})();

// Saving throw: half on success, full on fail
(() => {
  const mk = () => ({ grid: { w: 5, h: 3 }, blockSet: new Set(), diffSet: new Set(),
    tokens: [{ id: 'c', kind: 'pc', name: 'Della', x: 1, y: 1 },
             { id: 'g', kind: 'monster', name: 'Goblin', x: 2, y: 1, hp: 20, maxHp: 20 }], sheetFor: (t) => ({ mods: { dex: 2 } }) });
  const flame = { name: 'Sacred Flame', mode: 'save', delivery: 'ranged', range: 60, save: { ability: 'DEX', dc: 13, half: false }, damage: { dice: '1d8', bonus: 0, type: 'radiant' } };
  // target DEX save: d20 + 2. Force nat 1 → 3 < 13 → fail → full 1d8 (max 8, forced).
  let w = mk(); E.setRng(seqRng([d20as(1), 0.99]));
  let result = E.resolveAction(w, w.tokens[0], flame, w.tokens[1]);
  check(w.tokens[1].hp === 12, 'failed save takes full damage (20-8)');
  check(result.rolls.map((roll) => roll.kind).join(',') === 'save,damage' && result.rolls[0].faces[0] === 1 && result.rolls[1].faces[0] === 8, 'a save action retains both the target d20 and damage die');
  // Force nat 20 → 22 ≥ 13 → save; half:false → 0 damage.
  w = mk(); E.setRng(seqRng([d20as(20), 0.99]));
  E.resolveAction(w, w.tokens[0], flame, w.tokens[1]);
  check(w.tokens[1].hp === 20, 'successful save vs a no-half cantrip takes 0 damage');
})();

// Autohit (Magic Missile): never rolls to hit, 3 darts always land
(() => {
  const world = { grid: { w: 5, h: 3 }, blockSet: new Set(), diffSet: new Set(),
    tokens: [{ id: 'w', kind: 'pc', name: 'Fenwick', slots: { '1': 2 } },
             { id: 'g', kind: 'monster', name: 'Goblin', hp: 20, maxHp: 20 }], sheetFor: () => ({ mods: {} }) };
  const mm = { name: 'Magic Missile', type: 'spell', slot: 1, mode: 'autohit', delivery: 'ranged', range: 120, darts: 3, damage: { dice: '1d4', bonus: 1, type: 'force' } };
  E.setRng(constRng(0.99)); // 3 × (4+1) = 15
  const result = E.resolveAction(world, world.tokens[0], mm, world.tokens[1]);
  check(world.tokens[1].hp === 5, 'magic missile auto-lands 3 darts (20-15)');
  check(world.tokens[0].slots['1'] === 1, 'casting spent one level-1 slot');
  check(result.rolls.length === 3 && result.rolls.every((roll, index) => roll.kind === 'autohit' && roll.faces[0] === 4 && roll.ordinal === index + 1 && roll.count === 3), 'Magic Missile exposes each authoritative dart without inventing an attack roll');
})();

// Heal caps at maxHp; a spent-out caster is blocked
(() => {
  const world = { grid: { w: 3, h: 3 }, blockSet: new Set(), diffSet: new Set(),
    tokens: [{ id: 'c', kind: 'pc', name: 'Della', x: 1, y: 1, slots: { '1': 1 } },
             { id: 'f', kind: 'pc', name: 'Bram', x: 1, y: 2, hp: 2, maxHp: 12 }], sheetFor: () => ({ mods: {} }) };
  const cure = { name: 'Cure Wounds', type: 'spell', slot: 1, mode: 'heal', delivery: 'melee', reach: 5, heal: { dice: '1d8', bonus: 6 } };
  E.setRng(constRng(0.99)); // 8+6 = 14, but caps at 12
  const healed = E.resolveAction(world, world.tokens[0], cure, world.tokens[1]);
  check(world.tokens[1].hp === 12, 'healing never exceeds maxHp');
  check(healed.rolls.length === 1 && healed.rolls[0].kind === 'healing' && healed.rolls[0].faces[0] === 8 && healed.rolls[0].total === 14, 'healing retains the rolled total even when the target caps at max HP');
  const blocked = E.resolveAction(world, world.tokens[0], cure, world.tokens[1]); // no slots left
  check(blocked.blocked && /no level-1 slots/.test(blocked.text), 'a caster with no slots left is blocked');
})();

// Healing can raise a downed hero and clears saves, but cannot revive final death.
(() => {
  const cleric = { id: 'della', kind: 'pc', name: 'Della', x: 1, y: 1, hp: 12, maxHp: 12, slots: { '1': 2 } };
  const downed = { id: 'bram', kind: 'pc', name: 'Bram', x: 1, y: 2, hp: 0, maxHp: 12, dead: false, downed: true, stable: false,
    deathSaves: { successes: 1, failures: 2, lastRoll: 4, turnSerial: 9 } };
  const legacyDead = { id: 'pip', kind: 'pc', name: 'Pip', x: 2, y: 1, hp: 0, maxHp: 10, dead: true };
  const world = { grid: { w: 3, h: 3 }, blockSet: new Set(), diffSet: new Set(), tokens: [cleric, downed, legacyDead], sheetFor: () => ({ mods: {} }) };
  const cure = { name: 'Cure Wounds', type: 'spell', slot: 1, mode: 'heal', delivery: 'melee', reach: 5, heal: { dice: '1d8', bonus: 3 } };
  const legal = E.validTargets(world, cleric, cure);
  check(legal.includes(downed) && !legal.includes(legacyDead), 'healing targets a downed ally but excludes a final/legacy dead ally');
  E.setRng(constRng(0)); // 1+3 = 4 HP
  const raised = E.resolveAction(world, cleric, cure, downed);
  check(!raised.blocked && downed.hp === 4 && !downed.downed && !downed.stable && !downed.dead && !('deathSaves' in downed), 'positive healing revives a downed hero and deletes death-save state');
  const slotsBefore = cleric.slots['1'];
  const refused = E.resolveAction(world, cleric, cure, legacyDead);
  check(refused.blocked && legacyDead.dead && legacyDead.hp === 0 && cleric.slots['1'] === slotsBefore, 'direct healing cannot revive a legacy dead PC or spend the spell slot');
})();

// Cone AoE sweeps everyone in the arc, spares those behind / out of range
(() => {
  const world = { grid: { w: 8, h: 5 }, blockSet: new Set(), diffSet: new Set(),
    tokens: [{ id: 'w', kind: 'pc', name: 'Fenwick', x: 1, y: 2, slots: { '1': 2 } },
             { id: 'a', kind: 'monster', name: 'A', x: 2, y: 2, hp: 20, maxHp: 20 }, // in cone, 5ft
             { id: 'b', kind: 'monster', name: 'B', x: 3, y: 3, hp: 20, maxHp: 20 }, // in cone, 15ft edge
             { id: 'c', kind: 'monster', name: 'C', x: 0, y: 2, hp: 20, maxHp: 20 }, // BEHIND caster
             { id: 'd', kind: 'monster', name: 'D', x: 7, y: 2, hp: 20, maxHp: 20 }], // beyond 15ft
    sheetFor: () => ({ mods: { dex: 0 } }) };
  const burn = { name: 'Burning Hands', type: 'spell', slot: 1, mode: 'save', aoeShape: 'cone', aoeSize: 15, delivery: 'ranged', range: 15, save: { ability: 'DEX', dc: 13, half: true }, damage: { dice: '3d6', bonus: 0, type: 'fire' } };
  E.setRng(seqRng([d20as(1), d20as(1), 0.99, 0.99, 0.99, 0.99])); // both fail, max dmg 18
  const result = E.resolveAction(world, world.tokens[0], burn, { x: 3, y: 2 }); // aim east
  check(world.tokens[1].hp < 20 && world.tokens[2].hp < 20, 'cone hits both foes inside the arc');
  check(world.tokens[3].hp === 20, 'cone spares the foe behind the caster');
  check(world.tokens[4].hp === 20, 'cone spares the foe beyond its depth');
  check(result.rolls.length === 4 && result.rolls.map((roll) => roll.kind).join(',') === 'save,damage,save,damage', 'a cone exposes one save and one damage group for every caught target');
  check(result.rolls.every((roll, index) => roll.ordinal === Math.floor(index / 2) + 1 && roll.count === 2), 'area-effect roll groups retain target order for deterministic presentation');
})();

// Initiative ordering (desc, PC wins ties)
(() => {
  E.setRng(seqRng([d20as(10), d20as(10), d20as(20)]));
  const toks = [{ id: 'pc', kind: 'pc', initiative: 0 }, { id: 'mon', kind: 'monster', initiative: 0 }, { id: 'fast', kind: 'pc', initiative: 0 }];
  const initiative = E.rollInitiativeDetailed(toks), order = initiative.order;
  check(order[0] === 'fast', 'highest initiative acts first');
  check(order.indexOf('pc') < order.indexOf('mon'), 'a PC wins an initiative tie vs a monster');
  check(initiative.rolls.map((roll) => roll.faces[0]).join(',') === '10,10,20' && initiative.rolls.every((roll) => roll.kind === 'initiative'), 'initiative exposes every exact d20 in original combatant order');
})();

// Monster tactics: nearest target, close to melee, pick an in-reach action, rout
(() => {
  const world = buildWorld(scene1, party.map((p) => heroById(p.id)));
  const boss = world.tokens.find((t) => t.ref === 'goblin-boss');
  const anyGoblin = world.tokens.find((t) => t.ref === 'goblin');
  const tgt = E.nearestPC(world, boss);
  check(tgt && tgt.kind === 'pc', 'a monster targets the nearest PC');
  const before = E.cheb(boss, tgt);
  E.stepToward(world, boss, tgt);
  check(E.cheb(boss, tgt) < before, 'stepToward closes distance to the target');
  check(!E.goblinsShouldFlee(world), 'goblins hold while the boss lives');
  boss.dead = true;
  check(E.goblinsShouldFlee(world), 'goblins rout once the boss falls');
  boss.dead = false;
})();

// checkEnd
(() => {
  const world = buildWorld(scene1, party.map((p) => heroById(p.id)));
  check(E.checkEnd(world) === null, 'a fresh board is neither win nor loss');
  world.tokens.filter((t) => t.kind === 'monster').forEach((m) => { m.dead = true; });
  check(E.checkEnd(world) === 'victory', 'all monsters down = victory');
  const w2 = buildWorld(scene1, party.map((p) => heroById(p.id)));
  w2.tokens.filter((t) => t.kind === 'pc').forEach((p) => { p.dead = true; });
  check(E.checkEnd(w2) === 'defeat', 'all heroes down = defeat');
  const w3 = buildWorld(scene1, party.map((p) => heroById(p.id)));
  w3.tokens.filter((t) => t.kind === 'pc').forEach((p) => { p.hp = 0; p.downed = true; p.dead = false; p.stable = false; p.deathSaves = { successes: 0, failures: 0 }; });
  check(E.checkEnd(w3) === null, 'unstable downed heroes keep combat open for death-save turns');
  w3.tokens.filter((t) => t.kind === 'pc').forEach((p) => { p.stable = true; });
  check(E.checkEnd(w3) === 'defeat', 'all-stable unconscious heroes end combat as defeat or capture');
})();

// Level-up mirror
(() => {
  const bram = heroById('bram');
  const up = E.applyLevelUp(bram, leveling.level2['Fighter'], 2);
  check(up.level === 2 && up.maxHp === bram.maxHp + 8, 'Fighter level 2 adds 8 HP');
  const della = heroById('della');
  const up2 = E.applyLevelUp(della, leveling.level2['Cleric (Life)'], 2);
  check(up2.slots['1'] === 3, 'Life Cleric level 2 grants a 3rd level-1 slot');
  const ranger = E.applyLevelUp(heroById('kara'), leveling.level2['Ranger'], 2);
  check(ranger.actions.some((a) => a.id === 'hunters-mark'), 'Ranger level 2 gains Hunter\'s Mark');
})();

// ═════════════════════════════════════════════════════════════════════════════
// LAYER 2 — play the game: auto-run full fights through the real engine
// ═════════════════════════════════════════════════════════════════════════════

/** A hero's turn: shoot/strike the lowest-HP reachable foe; else close in. */
function pcTurn(world, pc) {
  const sheet = world.sheetFor(pc);
  const attacks = (sheet.actions || []).filter((a) => a.mode === 'attack' || a.mode === 'autohit' || a.mode === 'save');
  const tryStrike = () => {
    for (const a of attacks) {
      if (a.type === 'spell' && a.slot && (!pc.slots || !pc.slots[String(a.slot)])) continue;
      const tg = E.validTargets(world, pc, a);
      if (tg.length) { const target = tg.reduce((x, y) => (x.hp <= y.hp ? x : y)); E.resolveAction(world, pc, a, target); return true; }
    }
    return false;
  };
  if (tryStrike()) return;
  // Move toward the nearest enemy, then try again.
  const foes = E.living(world, 'monster');
  if (!foes.length) return;
  const near = foes.reduce((x, y) => (E.cheb(pc, x) <= E.cheb(pc, y) ? x : y));
  const reach = E.computeReachable(world, pc);
  let best = null, bestD = E.cheb(pc, near);
  reach.forEach((k) => { const [x, y] = k.split(',').map(Number); const d = Math.max(Math.abs(x - near.x), Math.abs(y - near.y)); if (d < bestD) { bestD = d; best = { x, y }; } });
  if (best) { pc.x = best.x; pc.y = best.y; }
  tryStrike();
}

/** A monster's turn: rout if leaderless goblin, else close in and attack. */
function monsterTurn(world, m) {
  if (m.ref === 'goblin' && E.goblinsShouldFlee(world)) { m.fled = true; return; }
  const tgt = E.nearestPC(world, m);
  if (!tgt) return;
  const melee = (world.sheetFor(m).actions || []).find((a) => a.delivery === 'melee');
  if (melee && E.cheb(m, tgt) > 1) E.stepToward(world, m, tgt);
  const action = E.pickMonsterAction(world, m, tgt);
  if (action) E.resolveAction(world, m, action, tgt);
}

/** Exercise the same 0-HP turn split as the tabletop: save, act, or stay stable. */
function combatantTurn(world, token, turnSerial) {
  if (token.kind === 'pc') {
    if (E.isDowned(token)) { if (!token.stable) E.resolveDeathSave(token, turnSerial); return; }
    if (E.isConscious(token)) pcTurn(world, token);
    return;
  }
  monsterTurn(world, token);
}

/** Play one full encounter to its end; returns 'victory' | 'defeat' | 'stalemate'. */
function playFight(scene, seed) {
  E.setRng(mulberry32(seed));
  const world = buildWorld(scene, party.map((p) => heroById(p.id)));
  const order = E.rollInitiative(world.tokens);
  for (let round = 0; round < 40; round++) {
    for (let turn = 0; turn < order.length; turn++) {
      const id = order[turn];
      const t = world.tokens.find((x) => x.id === id);
      if (!t || t.dead || t.fled || t.kind === 'prop') continue;
      combatantTurn(world, t, round * order.length + turn + 1);
      const end = E.checkEnd(world);
      if (end) return end;
    }
  }
  return 'stalemate';
}

// Play coast-road 300 times: it must ALWAYS terminate, and be winnable.
(() => {
  let wins = 0, losses = 0, stalemates = 0;
  for (let s = 1; s <= 300; s++) {
    const r = playFight(scene1, s * 2654435761 % 2147483647);
    if (r === 'victory') wins++; else if (r === 'defeat') losses++; else stalemates++;
  }
  check(stalemates === 0, `every auto-played fight terminates within 40 rounds (stalemates=${stalemates})`);
  const rate = wins / 300;
  check(rate >= 0.5, `the ambush is winnable — party win rate ${(rate * 100).toFixed(0)}% over 300 seeds (wins=${wins}, losses=${losses})`);
  console.log(`  ▸ coast-road playthrough: ${wins} wins / ${losses} losses / ${stalemates} stalemates over 300 seeds (${(rate * 100).toFixed(0)}% win)`);
})();

// Force a defeat: one fragile hero against the whole ambush must lose.
(() => {
  const solo = buildWorld(scene1, [heroById('fenwick')]); // 7 HP wizard, alone
  E.setRng(mulberry32(42));
  const order = E.rollInitiative(solo.tokens);
  let end = null;
  for (let round = 0; round < 40 && !end; round++) {
    for (let turn = 0; turn < order.length; turn++) {
      const id = order[turn];
      const t = solo.tokens.find((x) => x.id === id);
      if (!t || t.dead || t.fled || t.kind === 'prop') continue;
      combatantTurn(solo, t, round * order.length + turn + 1);
      end = E.checkEnd(solo); if (end) break;
    }
  }
  check(end === 'defeat', 'a lone level-1 wizard is overwhelmed by the ambush (defeat path works)');
})();

// The Ravine (scene 2) is also fully playable end-to-end.
(() => {
  const scene2 = adventure.scenes[1];
  let terminated = 0;
  for (let s = 1; s <= 100; s++) { if (playFight(scene2, s * 40503) !== 'stalemate') terminated++; }
  check(terminated === 100, `The Ravine terminates every time too (${terminated}/100)`);
})();

// ── Report ───────────────────────────────────────────────────────────────────
E.setRng(); // reset to Math.random
if (failures) { console.error(`\n✗ ${failures} of ${checks} checks failed`); process.exit(1); }
console.log(`✓ D&D engine plays correctly — ${checks} checks, unit rules + 400 full auto-played fights, all green`);
