/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Unit test suite for deeper spellcasting (v0.22.7): sphere AoE templates, concentration tracking and Constitution saves, canonical SRD 5.1 conditions, per-round reactions, and server multiplayer-guard persistence.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add PostgreSQL JSONB sorted-key round-trip parity check for presentation-gate completion with active conditions and concentration.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../ui/engine.js');
const MG = require('../lib/multiplayer-guard.js');

const d20as = (n) => (n - 0.5) / 20;
const d4as = (n) => (n - 0.5) / 4;
const d6as = (n) => (n - 0.5) / 6;
const d8as = (n) => (n - 0.5) / 8;
function seqRng(vals) {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
}

function makeWorld(tokens, sheetMap) {
  const sheets = sheetMap || {};
  return {
    grid: { w: 12, h: 12, unitFeet: 5 },
    blockSet: new Set(['0,0']),
    diffSet: new Set(),
    round: 1,
    tokens,
    sheetFor(t) { return sheets[t.id] || sheets[t.slug] || sheets[t.ref] || { mods: {}, actions: [] }; },
  };
}

test('Fireball 20-ft sphere covers 4-square radius, rolls shared damage once, and applies save-for-half', () => {
  const wiz = { id: 'fenwick', kind: 'pc', name: 'Fenwick', x: 1, y: 5, hp: 20, maxHp: 20, ac: 12, slots: { 3: 2 } };
  const g1 = { id: 'g1', kind: 'monster', name: 'Goblin A', x: 6, y: 5, hp: 40, maxHp: 40, ac: 13 };
  const g2 = { id: 'g2', kind: 'monster', name: 'Goblin B', x: 10, y: 5, hp: 40, maxHp: 40, ac: 13 };
  const gFar = { id: 'gFar', kind: 'monster', name: 'Goblin Far', x: 11, y: 5, hp: 40, maxHp: 40, ac: 13 };
  const allyIn = { id: 'bram', kind: 'pc', name: 'Bram', x: 7, y: 6, hp: 30, maxHp: 30, ac: 18 };
  const world = makeWorld([wiz, g1, g2, gFar, allyIn], { g1: { mods: { dex: 0 } }, g2: { mods: { dex: 2 } }, bram: { mods: { dex: 0 } } });
  const cells = E.sphereCells(world, { x: 6, y: 5 }, 20);
  assert.ok(cells.some((c) => c.x === 10 && c.y === 5), '4-square edge (20ft) is inside Fireball');
  assert.ok(!cells.some((c) => c.x === 11 && c.y === 5), '5-square cell (25ft) is outside Fireball');
  assert.ok(!cells.some((c) => c.x === 0 && c.y === 0), 'blocking cells are excluded');
  const caught = E.sphereTargets(world, wiz, E.SRD_SPELLS.fireball, { x: 6, y: 5 });
  assert.deepEqual(caught.map((t) => t.id), ['g1', 'g2', 'bram'], 'friendlyFire sphere hits all conscious creatures inside');
  // 8d6 shared damage (all 4s = 32), then saves: g1 nat 5 (fail -> 32), g2 nat 15+2=17 (save -> 16), bram nat 16 (save -> 16)
  E.setRng(seqRng([d6as(4), d6as(4), d6as(4), d6as(4), d6as(4), d6as(4), d6as(4), d6as(4), d20as(5), d20as(15), d20as(16)]));
  const res = E.resolveAction(world, wiz, E.SRD_SPELLS.fireball, { x: 6, y: 5 });
  assert.equal(res.blocked, false);
  assert.equal(wiz.slots['3'], 1, 'spent one 3rd-level slot');
  assert.equal(res.sharedDamage, 32, 'rolled 8d6 shared damage once');
  assert.equal(g1.hp, 8, 'failed save takes full 32 fire damage');
  assert.equal(g2.hp, 24, 'successful save takes half (16) fire damage');
  assert.equal(allyIn.hp, 14, 'ally inside friendlyFire sphere also saves for half');
  assert.equal(gFar.hp, 40, 'foe outside 20ft radius is untouched');
  const dmgRolls = res.rolls.filter((r) => r.kind === 'damage');
  assert.equal(dmgRolls.length, 3);
  assert.ok(dmgRolls.every((r) => r.total === 32), 'all caught targets share the single rolled damage total');
  E.setRng();
});

test('Shatter 10-ft sphere and friendlyFire:false / ally-buff spheres respect radius and team rules', () => {
  const caster = { id: 'zin', kind: 'pc', name: 'Zin', x: 1, y: 5, hp: 15, maxHp: 15, ac: 13, slots: { 1: 2, 2: 1 } };
  const ally = { id: 'bram', kind: 'pc', name: 'Bram', x: 5, y: 5, hp: 12, maxHp: 12, ac: 18 };
  const foeIn = { id: 'g1', kind: 'monster', name: 'Goblin 1', x: 7, y: 5, hp: 25, maxHp: 25, ac: 13 };
  const foeOut = { id: 'g2', kind: 'monster', name: 'Goblin 2', x: 8, y: 5, hp: 25, maxHp: 25, ac: 13 };
  const world = makeWorld([caster, ally, foeIn, foeOut], { g1: { mods: { con: 0 } } });
  const shatterNoFF = { ...E.SRD_SPELLS.shatter, friendlyFire: false };
  const targets = E.sphereTargets(world, caster, shatterNoFF, { x: 5, y: 5 });
  assert.deepEqual(targets.map((t) => t.id), ['g1'], '10-ft sphere hits 2 squares away and skips ally when friendlyFire is false');
  E.setRng(seqRng([d8as(5), d8as(5), d8as(5), d20as(2)]));
  const res = E.resolveAction(world, caster, shatterNoFF, { x: 5, y: 5 });
  assert.equal(foeIn.hp, 10, '3d8 all-5s = 15 thunder damage on failed CON save');
  assert.equal(ally.hp, 12);
  assert.equal(foeOut.hp, 25);
  const allyBuff = { id: 'aura', name: 'Bless Sphere', type: 'spell', slot: 1, mode: 'buff', delivery: 'ranged', range: 30, aoeShape: 'sphere', aoeSize: 10, targetTeam: 'ally', concentration: true, applyCondition: { id: 'blessed', concentration: true } };
  const buffRes = E.resolveAction(world, caster, allyBuff, { x: 5, y: 5 });
  assert.equal(buffRes.blocked, false);
  assert.equal(E.hasCondition(ally, 'blessed'), true);
  assert.equal(E.hasCondition(foeIn, 'blessed'), false);
  E.setRng();
});

test('Concentration drops prior spell and strips linked conditions when casting a second concentration spell', () => {
  const della = { id: 'della', kind: 'pc', name: 'Della', x: 2, y: 2, hp: 14, maxHp: 14, ac: 18, slots: { 1: 3, 2: 1 } };
  const bram = { id: 'bram', kind: 'pc', name: 'Bram', x: 3, y: 2, hp: 12, maxHp: 12, ac: 18 };
  const foe = { id: 'g1', kind: 'monster', name: 'Goblin', x: 4, y: 2, hp: 15, maxHp: 15, ac: 13 };
  const world = makeWorld([della, bram, foe], { g1: { mods: { wis: 0 } } });
  const first = E.resolveAction(world, della, E.SRD_SPELLS.bless, bram);
  assert.equal(first.blocked, false);
  assert.equal(della.concentration.spellId, 'bless');
  assert.equal(E.hasCondition(bram, 'blessed'), true);
  E.setRng(seqRng([d20as(2)]));
  const second = E.resolveAction(world, della, E.SRD_SPELLS['hold-person'], foe);
  assert.equal(second.blocked, false);
  assert.match(second.text, /loses concentration on Bless/i);
  assert.equal(della.concentration.spellId, 'hold-person');
  assert.equal(E.hasCondition(bram, 'blessed'), false, 'linked Bless condition stripped on spell switch');
  assert.equal(E.hasCondition(foe, 'incapacitated'), true);
  E.setRng();
});

test('Damage triggers Constitution concentration save DC = max(10, floor(dmg/2)) and auto-breaks at 0 HP', () => {
  const della = { id: 'della', kind: 'pc', name: 'Della', x: 2, y: 2, hp: 30, maxHp: 30, ac: 18, slots: { 1: 2 } };
  const bram = { id: 'bram', kind: 'pc', name: 'Bram', x: 3, y: 2, hp: 12, maxHp: 12, ac: 18 };
  const ogre = { id: 'ogre', kind: 'monster', name: 'Ogre', x: 2, y: 3, hp: 40, maxHp: 40, ac: 11 };
  const world = makeWorld([della, bram, ogre], { della: { mods: { con: 3 } } });
  E.resolveAction(world, della, E.SRD_SPELLS.bless, bram);
  assert.equal(E.hasCondition(bram, 'blessed'), true);
  assert.equal(E.hasCondition(della, 'blessed'), true, 'Della is also blessed among 3 allies');
  // Hit for 24 damage -> DC = max(10, floor(24/2)) = 12; nat 8 + con 3 + bless 2 = 13 >= 12 -> maintains!
  E.setRng(seqRng([d20as(8), d4as(2)]));
  const passImpact = E.applyDamage(della, 24, { world, source: ogre });
  assert.equal(passImpact.concentrationCheck.dc, 12);
  assert.equal(passImpact.concentrationCheck.maintained, true);
  assert.equal(passImpact.concentrationCheck.blessBonus, 2);
  assert.equal(della.concentration.spellId, 'bless');
  // Hit for 4 damage -> DC = 10; nat 1 + con 3 + bless 1 = 5 < 10 -> fails and clears Bram's blessed!
  E.setRng(seqRng([d20as(1), d4as(1)]));
  const failImpact = E.applyDamage(della, 4, { world, source: ogre });
  assert.equal(failImpact.concentrationCheck.dc, 10);
  assert.equal(failImpact.concentrationCheck.maintained, false);
  assert.equal(della.concentration, undefined);
  assert.equal(E.hasCondition(bram, 'blessed'), false);
  // Downed to 0 HP auto-breaks concentration without rolling a save.
  E.resolveAction(world, della, E.SRD_SPELLS.bless, bram);
  const downImpact = E.applyDamage(della, 10, { world, source: ogre });
  assert.equal(downImpact.newlyDowned, true);
  assert.equal(downImpact.concentrationCheck.autoBroken, true);
  assert.equal(downImpact.concentrationCheck.maintained, false);
  assert.equal(E.hasCondition(bram, 'blessed'), false);
  E.setRng();
});

test('Conditions enforce advantage, disadvantage, cancellation, Bless +1d4, speed limits, and turn expiry', () => {
  const hero = { id: 'bram', kind: 'pc', name: 'Bram', x: 2, y: 2, hp: 12, maxHp: 12, ac: 16, speed: 30 };
  const foe = { id: 'g1', kind: 'monster', name: 'Goblin', x: 3, y: 2, hp: 20, maxHp: 20, ac: 14, speed: 30 };
  const melee = { name: 'Longsword', mode: 'attack', delivery: 'melee', reach: 5, toHit: 5, damage: { dice: '1d8', bonus: 3, type: 'slashing' } };
  const ranged = { name: 'Shortbow', mode: 'attack', delivery: 'ranged', range: 80, toHit: 5, damage: { dice: '1d6', bonus: 2, type: 'piercing' } };
  E.addCondition(foe, 'prone');
  assert.equal(E.attackRollMode(hero, foe, melee).net, 'advantage', 'melee vs prone has advantage');
  assert.equal(E.attackRollMode(hero, foe, ranged).net, 'disadvantage', 'ranged vs prone has disadvantage');
  assert.equal(E.effectiveSpeed(foe), 15, 'prone halves speed');
  E.addCondition(hero, 'poisoned');
  assert.equal(E.attackRollMode(hero, foe, melee).net, 'normal', 'poisoned disadvantage cancels prone melee advantage');
  E.removeCondition(hero, 'poisoned');
  E.addCondition(hero, 'invisible');
  E.removeCondition(foe, 'prone');
  assert.equal(E.attackRollMode(hero, foe, ranged).net, 'advantage', 'invisible attacker has advantage');
  E.addCondition(foe, 'restrained');
  assert.equal(E.effectiveSpeed(foe), 0, 'restrained reduces speed to 0');
  assert.equal(E.saveRollMode(foe, 'DEX').net, 'disadvantage', 'restrained imposes DEX save disadvantage');
  const world = makeWorld([hero, foe], { g1: { mods: { dex: 1 } } });
  assert.equal(E.computeMovementCosts(world, foe).size, 1, 'restrained token cannot leave its square');
  // Blessed attacker adds +1d4 to attack roll
  E.removeCondition(hero, 'invisible');
  E.removeCondition(foe, 'restrained');
  E.addCondition(hero, { id: 'blessed', duration: 'until-next-turn' });
  E.setRng(seqRng([d20as(7), d4as(3), d8as(4)])); // 7 + 5 + 3 = 15 >= AC 14 -> hits!
  const hit = E.resolveAction(world, hero, melee, foe);
  assert.equal(hit.rolls[0].bonus, 8, 'Blessed +3 added to +5 attack modifier');
  assert.equal(hit.rolls[0].outcome, 'hit');
  // Turn-start tick expires until-next-turn conditions
  const tick = E.tickTurnConditions(world, hero);
  assert.deepEqual(tick.expired, ['blessed']);
  assert.equal(E.hasCondition(hero, 'blessed'), false);
  E.setRng();
});

test('Reactions enforce Shield (+5 AC), Opportunity Attack (skipped on Disengage), and Counterspell', () => {
  const wiz = { id: 'fenwick', kind: 'pc', name: 'Fenwick', x: 2, y: 2, hp: 14, maxHp: 14, ac: 12, slots: { 1: 2, 3: 1 } };
  const fighter = { id: 'bram', kind: 'pc', name: 'Bram', x: 4, y: 2, hp: 16, maxHp: 16, ac: 18 };
  const foe = { id: 'mage', kind: 'monster', name: 'Cult Mage', x: 5, y: 2, hp: 20, maxHp: 20, ac: 12, slots: { 3: 1, 5: 1 } };
  const sheets = {
    fenwick: { mods: { int: 4 }, actions: [E.SRD_SPELLS.shield, E.SRD_SPELLS.counterspell] },
    bram: { mods: { str: 3 }, actions: [{ id: 'sword', name: 'Longsword', mode: 'attack', delivery: 'melee', reach: 5, toHit: 5, damage: { dice: '1d8', bonus: 3, type: 'slashing' } }] },
    mage: { mods: { int: 3 }, actions: [E.SRD_SPELLS.fireball] },
  };
  const world = makeWorld([wiz, fighter, foe], sheets);
  // Shield triggers on attackTotal 15 vs AC 12 (15 < 17)
  const shieldOpts = E.eligibleReactions(world, 'attack-hit', { target: wiz, attackTotal: 15, critical: false });
  assert.equal(shieldOpts.length, 1);
  const shieldRes = E.resolveReaction(world, wiz, shieldOpts[0], {});
  assert.equal(shieldRes.blocked, false);
  assert.equal(E.effectiveAc(wiz), 17);
  assert.equal(wiz.slots['1'], 1);
  assert.equal(wiz.reactionUsed, true);
  assert.equal(E.eligibleReactions(world, 'attack-hit', { target: wiz, attackTotal: 17 }).length, 0, 'cannot react twice in one round');
  E.tickTurnConditions(world, wiz);
  assert.equal(wiz.reactionUsed, false);
  assert.equal(E.effectiveAc(wiz), 12, 'Shield +5 AC expires at start of next turn');
  // Opportunity Attack triggers when leaving reach without Disengage, skipped with Disengage
  assert.equal(E.eligibleReactions(world, 'leave-reach', { mover: foe, from: { x: 5, y: 2 }, to: { x: 7, y: 2 }, disengage: true }).length, 0);
  const oaOpts = E.eligibleReactions(world, 'leave-reach', { mover: foe, from: { x: 5, y: 2 }, to: { x: 7, y: 2 } });
  assert.equal(oaOpts.length, 1);
  E.setRng(seqRng([d20as(14), d8as(5)]));
  const oaRes = E.resolveReaction(world, fighter, oaOpts[0], { target: foe });
  assert.equal(oaRes.blocked, false);
  assert.equal(fighter.reactionUsed, true);
  assert.equal(foe.hp, 12, 'Opportunity Attack hit for 5+3=8 damage');
  // Counterspell auto-counters 3rd-level Fireball, and rolls check for 5th-level spell
  const csOpts = E.eligibleReactions(world, 'spell-cast', { caster: foe, spell: E.SRD_SPELLS.fireball });
  assert.equal(csOpts.length, 1);
  const csAuto = E.resolveReaction(world, wiz, csOpts[0], { caster: foe, spell: E.SRD_SPELLS.fireball });
  assert.equal(csAuto.countered, true);
  assert.equal(csAuto.autoCountered, true);
  wiz.reactionUsed = false; wiz.slots['3'] = 1;
  const coneOfCold = { id: 'cone-of-cold', name: 'Cone of Cold', type: 'spell', level: 5, slot: 5 };
  E.setRng(seqRng([d20as(12)])); // 12 + int 4 = 16 >= DC 15
  const csHigh = E.resolveReaction(world, wiz, { id: 'counterspell', slot: 3, targetSpellLevel: 5 }, { caster: foe, spell: coneOfCold });
  assert.equal(csHigh.autoCountered, false);
  assert.equal(csHigh.dc, 15);
  assert.equal(csHigh.countered, true);
  E.setRng();
});

test('multiplayer-guard preserves and validates concentration, conditions, reactionUsed, and tempAcBonus', () => {
  const raw = {
    mode: 'combat', sceneId: 'coast-road', round: 1, turnIndex: 0, turnSerial: 1, order: ['della', 'g1'],
    tokens: [
      { id: 'della', kind: 'pc', slug: 'della', name: 'Della', x: 2, y: 2, hp: 12, maxHp: 12, ac: 18, speed: 25, slots: { 1: 1 },
        concentration: { spellId: 'bless', spellName: 'Bless', startedRound: 1, targetIds: ['della'] },
        conditions: [{ id: 'blessed', sourceId: 'della', spellId: 'bless', concentration: true }],
        reactionUsed: true, tempAcBonus: 5, _lungeT0: 99 },
      { id: 'g1', kind: 'monster', ref: 'goblin', name: 'Tallow', x: 5, y: 2, hp: 7, maxHp: 7, ac: 13, speed: 30 },
    ],
  };
  const stripped = MG.stripTokenPrivateFields(raw);
  assert.equal(stripped.tokens[0]._lungeT0, undefined);
  assert.equal(stripped.tokens[0].concentration.spellName, 'Bless');
  assert.equal(stripped.tokens[0].conditions[0].id, 'blessed');
  assert.equal(stripped.tokens[0].reactionUsed, true);
  assert.equal(stripped.tokens[0].tempAcBonus, 5);
  // Setup-mode host write with valid spellcasting fields succeeds; malformed tempAcBonus rejected in combat.
  const current = {
    mode: 'combat', sceneId: 'coast-road', round: 1, turnIndex: 0, turnSerial: 1, order: ['della', 'g1'],
    tokens: [
      { id: 'della', kind: 'pc', slug: 'della', name: 'Della', x: 2, y: 2, hp: 12, maxHp: 12, ac: 18, speed: 25, slots: { 1: 2 },
        turnSerial: 1, moveRemaining: 25, moved: false, positionSet: true, acted: false },
      { id: 'g1', kind: 'monster', ref: 'goblin', name: 'Tallow', x: 5, y: 2, hp: 7, maxHp: 7, ac: 13, speed: 30 },
    ],
  };
  const proposedBuff = JSON.parse(JSON.stringify(current));
  proposedBuff.tokens[0].slots['1'] = 1;
  proposedBuff.tokens[0].acted = true;
  proposedBuff.tokens[0].concentration = { spellId: 'bless', spellName: 'Bless', startedRound: 1, targetIds: ['della'] };
  proposedBuff.tokens[0].conditions = [{ id: 'blessed', sourceId: 'della', spellId: 'bless', concentration: true }];
  proposedBuff.tokens[0].turnResult = { serial: 1, text: 'Della casts Bless on Della.', lease: 'c1', leaseAt: 1000, complete: false };
  const rules = { scene: { grid: { w: 12, h: 12, unitFeet: 5 }, terrain: {} }, sheets: { della: { speed: 25, maxHp: 12, actions: [E.SRD_SPELLS.bless] } }, monsters: {} };
  const ok = MG.stateWriteDecision({ is_owner: true, user_sub: 'u1' }, [{ user_sub: 'u1', character_slug: 'della' }], 'u1', current, proposedBuff, rules);
  assert.equal(ok.ok, true, ok.error || 'valid Bless action accepted');
  const bad = JSON.parse(JSON.stringify(proposedBuff));
  bad.tokens[0].tempAcBonus = 99;
  const rejected = MG.stateWriteDecision({ is_owner: true, user_sub: 'u1' }, [{ user_sub: 'u1', character_slug: 'della' }], 'u1', current, bad, rules);
  assert.equal(rejected.ok, false, 'out-of-bounds tempAcBonus must be rejected');
});

test('stripTokenPrivateFields preserves PostgreSQL JSONB sorted key order across presentation-gate completion', () => {
  const ts = Date.now();
  const current = {
    mode: 'combat', sceneId: 'coast-road', round: 1, turnIndex: 0, turnSerial: 1, order: ['della'],
    presentationGate: { complete: false, createdAt: ts, id: 'open-1', kind: 'opening', lease: 'p1', leaseAt: ts, message: 'Start.', sceneId: 'coast-road', turnSerial: 1 },
    tokens: [{
      ac: 18, concentration: { spellId: 'bless', spellName: 'Bless', startedRound: 1, targetIds: ['della'] },
      conditions: [{ concentration: true, id: 'blessed', sourceId: 'della', spellId: 'bless' }],
      hp: 12, id: 'della', kind: 'pc', maxHp: 12, name: 'Della', reactionUsed: true, slots: { 1: 2 }, slug: 'della', speed: 25, tempAcBonus: 5, x: 2, y: 2,
    }],
  };
  const proposed = MG.stripTokenPrivateFields(JSON.parse(JSON.stringify(current)));
  proposed.presentationGate.complete = true;
  proposed.presentationGate.completedAt = ts + 5;
  assert.equal(JSON.stringify(proposed.tokens), JSON.stringify(current.tokens), 'JSONB key order preserved');
  const decision = MG.stateWriteDecision({ is_owner: true, user_sub: 'u1' }, [{ user_sub: 'u1', character_slug: 'della' }], 'u1', current, proposed, {});
  assert.equal(decision.ok, true, decision.error || 'gate completion accepted with active spellcasting fields');
});
