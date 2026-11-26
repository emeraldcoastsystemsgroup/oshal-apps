/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify SRD 5.1 Level 3-5 progression across all eight classes, server/client applyLevelUp parity, Level 5 Fireball/Counterspell/Spirit Guardians/Mass Healing Word/Sneak Attack 3d6/Extra Attack combat execution, and full 5-chapter Ashen Citadel campaign advancement.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ENG = require('../ui/engine.js');
const { _test: timeline } = require('../lib/dnd-timeline-service.js');
const { createDndRoutes } = require('../routes/dnd-routes.js');
const { xpProgressLabel } = require('../ui/table-character-sheet.js');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

const party = readJson('party.json').party;
const roster = readJson('srd-roster.json').roster;
const heroes = party.concat(roster);
const bestiary = readJson('srd-monsters.json').monsters;
const leveling = readJson('srd-leveling.json');
const ashenCitadel = readJson('adventure-ashen-citadel.json');

const heroById = (id) => clone(heroes.find((h) => h.id === id));
const constRng = (v) => () => v;
const seqRng = (vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
const d20as = (n) => (n - 0.5) / 20;

/** @description Minimal in-memory PostgreSQL double driving POST /advance across all 5 chapters. */
function makeArcPool(adventure, initialParty) {
  const scene0 = adventure.scenes[0];
  const state = {
    adventureId: adventure.id, sceneId: scene0.id, mode: 'resolved',
    round: 2, turnIndex: 0, turnSerial: 5, order: [], tokens: [],
  };
  const characters = initialParty.map((hero, idx) => ({
    character_id: `char-${idx + 1}`, user_sub: 'host', campaign_id: 'camp-arc',
    slug: hero.id, name: hero.name, xp: 0, level: 1, sheet: clone(hero),
  }));
  const pool = { state, rev: 1, status: 'active', characters, archive: [] };
  const rows = (r) => ({ rowCount: r.length, rows: r });
  const runSql = async (sql, params) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return rows([]);
    if (/SELECT c\.\*,/.test(sql)) return rows([{ campaign_id: 'camp-arc', user_sub: 'host', is_owner: true }]);
    if (/SELECT slug, sheet FROM dnd_characters/.test(sql)) return rows(pool.characters.map((c) => ({ slug: c.slug, sheet: clone(c.sheet) })));
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return rows([{ state: clone(pool.state), rev: pool.rev }]);
    if (/SELECT state FROM dnd_encounters/.test(sql)) return rows([{ state: clone(pool.state) }]);
    if (/SELECT \* FROM dnd_characters/.test(sql)) return rows(pool.characters.map(clone));
    if (/pg_advisory_xact_lock/.test(sql)) return rows([{ pg_advisory_xact_lock: null }]);
    if (/SELECT COALESCE\(MAX\(seq\),0\) AS seq FROM dnd_archive/.test(sql)) return rows([{ seq: pool.archive.length }]);
    if (/SELECT COALESCE\(MAX\(seq\),0\)\+1 AS n FROM dnd_archive/.test(sql)) return rows([{ n: pool.archive.length + 1 }]);
    if (/FROM dnd_snapshots|INTO dnd_snapshots/.test(sql)) return rows([]);
    if (/INSERT INTO dnd_archive/.test(sql)) { pool.archive.push({ seq: Number(params[2]), kind: params[3], content: params[4] }); return rows([]); }
    if (/UPDATE dnd_characters SET xp=/.test(sql)) {
      const target = pool.characters.find((c) => c.character_id === params[3]);
      target.xp = Number(params[0]); target.level = Number(params[1]); target.sheet = JSON.parse(params[2]);
      return rows([]);
    }
    if (/UPDATE dnd_encounters SET state=/.test(sql)) { pool.state = JSON.parse(params[0]); pool.rev++; return rows([{ rev: pool.rev }]); }
    if (/UPDATE dnd_campaigns SET updated_at=now\(\), status='archived'/.test(sql)) { pool.status = 'archived'; return rows([]); }
    throw new Error(`Unexpected SQL in arc pool: ${sql}`);
  };
  pool.query = runSql;
  pool.connect = async () => ({ query: runSql, release() {} });
  return pool;
}

/** @description Invoke one route request directly against createDndRoutes. */
async function callRoute(pool, method, url, body) {
  const router = createDndRoutes({ pool, appPackageDir: ROOT });
  let payload = '';
  const req = { method, url, body, oidc: { user: { sub: 'host', name: 'Host' } } };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { payload = String(v || ''); } };
  await router(req, res, () => { throw new Error(`Unhandled route ${method} ${url}`); });
  return { status: res.statusCode, body: JSON.parse(payload) };
}

test('srd-leveling.json covers all eight classes across Levels 2-5 with monotonic thresholds', () => {
  assert.deepEqual(leveling.thresholds, { 2: 300, 3: 900, 4: 2700, 5: 6500 });
  assert.deepEqual(leveling.proficiencyByLevel, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 3 });
  const expectedClasses = ['Fighter', 'Cleric (Life)', 'Wizard', 'Rogue', 'Barbarian', 'Ranger', 'Paladin', 'Bard'];
  for (const lvl of [2, 3, 4, 5]) {
    const bucket = leveling[`level${lvl}`];
    assert.ok(bucket && typeof bucket === 'object', `level${lvl} table exists`);
    for (const cls of expectedClasses) {
      const delta = ENG.levelDeltaFor(leveling, lvl, cls);
      assert.ok(delta && delta.hpGain > 0, `${cls} has valid level-${lvl} delta`);
    }
  }
});

test('server and client applyLevelUp produce exact parity from Level 1 to Level 5 for every hero', () => {
  const thresholds = [300, 900, 2700, 6500];
  for (const hero of heroes) {
    let clientSheet = clone(hero);
    let serverSheet = clone(hero);
    for (let i = 0; i < thresholds.length; i++) {
      const xp = thresholds[i];
      const cRes = ENG.applyLevelUp(clientSheet, leveling, { xp });
      const sRes = timeline.applyLevelUp({ leveling }, serverSheet, { xp });
      assert.deepEqual(cRes.sheet, sRes.sheet, `${hero.id} sheet parity at XP ${xp}`);
      assert.deepEqual(cRes.levelUps, sRes.levelUps, `${hero.id} levelUps parity at XP ${xp}`);
      assert.deepEqual(cRes.notes, sRes.notes, `${hero.id} notes parity at XP ${xp}`);
      clientSheet = cRes.sheet;
      serverSheet = sRes.sheet;
    }
    assert.equal(clientSheet.level, 5);
    assert.equal(clientSheet.proficiencyBonus, 3);
    assert.equal(clientSheet.prof, 3);
    const jump = ENG.applyLevelUp(clone(hero), leveling, { xp: 6500 });
    assert.equal(jump.levelUps.length, 4, `${hero.id} multi-threshold jump records all 4 levels`);
    assert.deepEqual(jump.sheet, clientSheet, `${hero.id} single-jump L1->L5 matches step-by-step`);
  }
});

test('class-specific Level 3-5 unlocks, slot tiers, sneak scaling, and deduplication hold', () => {
  const fenwick = ENG.applyLevelUp(heroById('fenwick'), leveling, { xp: 6500 });
  assert.deepEqual(fenwick.sheet.slots, { 1: 4, 2: 3, 3: 2 });
  assert.ok(fenwick.sheet.actions.some((a) => a.id === 'shatter'));
  assert.ok(fenwick.sheet.actions.some((a) => a.id === 'fireball' && a.save.dc === 15));
  assert.ok(fenwick.sheet.actions.some((a) => a.id === 'counterspell' && a.mode === 'reaction'));
  const della = ENG.applyLevelUp(heroById('della'), leveling, { xp: 6500 });
  assert.deepEqual(della.sheet.slots, { 1: 4, 2: 3, 3: 2 });
  assert.ok(della.sheet.actions.some((a) => a.id === 'spirit-guardians' && a.aoeShape === 'sphere'));
  assert.ok(della.sheet.actions.some((a) => a.id === 'mass-healing-word' && a.mode === 'heal'));
  const pipL3 = ENG.applyLevelUp(heroById('pip'), leveling, { xp: 900 }).sheet;
  assert.equal(pipL3.sneakDice, '2d6');
  const pipL5 = ENG.applyLevelUp(pipL3, leveling, { xp: 6500 }).sheet;
  assert.equal(pipL5.sneakDice, '3d6');
  assert.equal(pipL5.actions.find((a) => a.id === 'shortsword').sneak, '3d6');
  const reapplied = ENG.applyLevelUp(fenwick.sheet, leveling, { xp: 7000 });
  assert.equal(reapplied.levelUps.length, 0);
  assert.equal(reapplied.sheet.actions.filter((a) => a.id === 'fireball').length, 1);
  const thorinL5 = ENG.applyLevelUp(heroById('thorin'), leveling, { xp: 6500 }).sheet;
  assert.equal(thorinL5.attacksPerAction, 2);
  assert.equal(thorinL5.speed, 35);
});

test('Level 5 Wizard casts Fireball and Counterspell cleanly through DnDEngine', () => {
  const fenSheet = ENG.applyLevelUp(heroById('fenwick'), leveling, { xp: 6500 }).sheet;
  const fireball = fenSheet.actions.find((a) => a.id === 'fireball');
  const fenTok = { id: 'fenwick', kind: 'pc', slug: 'fenwick', name: fenSheet.name, x: 2, y: 5, hp: fenSheet.maxHp, maxHp: fenSheet.maxHp, ac: fenSheet.ac, speed: fenSheet.speed, slots: clone(fenSheet.slots) };
  const orcA = { id: 'o1', kind: 'monster', ref: 'orc-raider', name: 'Krag', x: 8, y: 5, hp: 60, maxHp: 60, ac: 13 };
  const orcB = { id: 'o2', kind: 'monster', ref: 'orc-raider', name: 'Morga', x: 10, y: 5, hp: 60, maxHp: 60, ac: 13 };
  const world = { grid: { w: 18, h: 12, unitFeet: 5 }, blockSet: new Set(), diffSet: new Set(), tokens: [fenTok, orcA, orcB], sheetFor: (t) => (t.id === 'fenwick' ? fenSheet : bestiary[t.ref]) };
  ENG.setRng(seqRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, d20as(2), d20as(19)]));
  const blast = ENG.resolveAction(world, fenTok, fireball, { x: 9, y: 5 });
  assert.equal(blast.blocked, false);
  assert.equal(fenTok.slots['3'], 1, 'Fireball spends one 3rd-level slot');
  assert.equal(blast.caughtIds.length, 2, '20-ft sphere catches both foes');
  assert.ok(orcA.hp < orcB.hp, 'failed DEX save takes full damage while successful save takes half');

  const fanatic = { id: 'f1', kind: 'monster', ref: 'cult-fanatic', name: 'Vaelen', x: 6, y: 5, hp: 33, maxHp: 33, ac: 13 };
  world.tokens.push(fanatic);
  const holdSpell = bestiary['cult-fanatic'].actions.find((a) => a.id === 'hold-person');
  const opts = ENG.eligibleReactions(world, 'spell-cast', { caster: fanatic, spell: holdSpell });
  assert.equal(opts.length, 1);
  assert.equal(opts[0].id, 'counterspell');
  const countered = ENG.resolveReaction(world, fenTok, opts[0], { caster: fanatic, spell: holdSpell });
  assert.equal(countered.countered, true);
  assert.equal(countered.autoCountered, true);
  assert.equal(fenTok.slots['3'], 0);
  ENG.setRng();
});

test('Level 5 Rogue 3d6 Sneak Attack, Fighter Extra Attack, and Cleric sphere spells work', () => {
  const pipSheet = ENG.applyLevelUp(heroById('pip'), leveling, { xp: 6500 }).sheet;
  const bramSheet = ENG.applyLevelUp(heroById('bram'), leveling, { xp: 6500 }).sheet;
  const dellaSheet = ENG.applyLevelUp(heroById('della'), leveling, { xp: 6500 }).sheet;
  const pipTok = { id: 'pip', kind: 'pc', slug: 'pip', name: pipSheet.name, x: 4, y: 5, hp: 20, maxHp: pipSheet.maxHp, ac: pipSheet.ac };
  const bramTok = { id: 'bram', kind: 'pc', slug: 'bram', name: bramSheet.name, x: 6, y: 5, hp: 20, maxHp: bramSheet.maxHp, ac: bramSheet.ac };
  const dellaTok = { id: 'della', kind: 'pc', slug: 'della', name: dellaSheet.name, x: 3, y: 5, hp: dellaSheet.maxHp, maxHp: dellaSheet.maxHp, ac: dellaSheet.ac, slots: clone(dellaSheet.slots) };
  const ogre = { id: 'ogre', kind: 'monster', ref: 'ogre-brute', name: 'Brug', x: 5, y: 5, hp: 90, maxHp: 90, ac: 11 };
  const mapSheets = { pip: pipSheet, bram: bramSheet, della: dellaSheet };
  const world = { grid: { w: 18, h: 12, unitFeet: 5 }, blockSet: new Set(), diffSet: new Set(), tokens: [pipTok, bramTok, dellaTok, ogre], sheetFor: (t) => (t.kind === 'pc' ? mapSheets[t.slug] : bestiary[t.ref]) };

  ENG.setRng(seqRng([d20as(15), 0.99]));
  const stab = ENG.resolveAction(world, pipTok, pipSheet.actions.find((a) => a.id === 'shortsword'), ogre);
  const sneakRoll = stab.rolls.find((r) => r.kind === 'sneak');
  assert.equal(sneakRoll.dice, '3d6', 'Level 5 Rogue rolls 3d6 sneak attack');
  assert.equal(sneakRoll.total, 18);

  ENG.setRng(constRng(0.6));
  const swings = ENG.resolveAction(world, bramTok, bramSheet.actions.find((a) => a.id === 'longsword'), ogre);
  assert.equal(swings.rolls.filter((r) => r.kind === 'attack').length, 2, 'Level 5 Fighter swings twice via Extra Attack');

  const massHeal = dellaSheet.actions.find((a) => a.id === 'mass-healing-word');
  const healed = ENG.resolveAction(world, dellaTok, massHeal, { x: 4, y: 5 });
  assert.equal(healed.blocked, false);
  assert.equal(healed.healedIds.length, 2, 'Mass Healing Word heals both wounded allies in sphere');
  assert.ok(pipTok.hp > 20 && bramTok.hp > 20);
  ENG.setRng();
});

test('The Ashen Citadel 5-scene arc is structurally valid and levels a party from L1 through L5', async () => {
  assert.equal(ashenCitadel.id, 'ashen-citadel');
  assert.equal(ashenCitadel.scenes.length, 5);
  const seen = new Set();
  let cur = ashenCitadel.scenes[0], cumulativePerPc = 0;
  const crossed = [];
  while (cur) {
    assert.ok(!seen.has(cur.id), `acyclic scene ${cur.id}`);
    seen.add(cur.id);
    const mapId = cur.mapId || cur.id;
    assert.ok(fs.existsSync(path.join(DATA, 'maps', `${mapId}.jpg`)), `map exists for ${cur.id}`);
    const blocked = new Set((cur.terrain.blocking || []).map((c) => `${c.x},${c.y}`));
    const occ = new Set();
    for (const seat of cur.partyStart) {
      const k = `${seat.x},${seat.y}`;
      assert.ok(!blocked.has(k) && !occ.has(k), `walkable seat ${k} in ${cur.id}`);
      occ.add(k);
    }
    for (const m of cur.monsters || []) {
      assert.ok(bestiary[m.ref], `monster ${m.ref} exists in bestiary`);
      const k = `${m.x},${m.y}`;
      assert.ok(!blocked.has(k) && !occ.has(k), `walkable monster ${m.instanceId} in ${cur.id}`);
      occ.add(k);
    }
    cumulativePerPc += Math.round(((cur.xpReward || 0) + (cur.storyAward || 0)) / 4);
    crossed.push(ENG.targetLevelForXp(leveling, cumulativePerPc, 1));
    cur = cur.next ? ashenCitadel.scenes.find((s) => s.id === cur.next) : null;
  }
  assert.equal(seen.size, 5);
  assert.deepEqual(crossed, [2, 3, 4, 5, 5], 'chapters 1-4 cross Levels 2, 3, 4, and 5 in order');

  const pool = makeArcPool(ashenCitadel, party);
  for (let chapter = 0; chapter < 5; chapter++) {
    pool.state.mode = 'resolved';
    const res = await callRoute(pool, 'POST', '/advance', { campaignId: 'camp-arc' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.done, chapter === 4);
    if (chapter < 4) {
      assert.equal(res.body.sceneId, ashenCitadel.scenes[chapter + 1].id);
      assert.equal(res.body.sheets.fenwick.level, chapter + 2);
    }
  }
  assert.equal(pool.status, 'archived');
  assert.equal(pool.characters.find((c) => c.slug === 'fenwick').level, 5);
  assert.deepEqual(pool.characters.find((c) => c.slug === 'fenwick').sheet.slots, { 1: 4, 2: 3, 3: 2 });
  assert.ok(pool.characters.find((c) => c.slug === 'fenwick').sheet.actions.some((a) => a.id === 'fireball'));
  assert.equal(pool.characters.find((c) => c.slug === 'pip').sheet.sneakDice, '3d6');
});

test('GET /content serves leveling table and xpProgressLabel formats progression through Level 5 Max', async () => {
  const pool = makeArcPool(ashenCitadel, party);
  const res = await callRoute(pool, 'GET', '/content');
  assert.equal(res.status, 200);
  assert.ok(res.body.leveling && res.body.leveling.level5 && res.body.leveling.level5.Wizard);
  assert.ok(res.body.adventures.some((a) => a.id === 'ashen-citadel' && a.scenes.length === 5));
  assert.equal(xpProgressLabel({ level: 1, xp: 0 }, leveling), 'Level 1 · 0 / 300 XP');
  assert.equal(xpProgressLabel({ level: 3, xp: 1200 }, leveling), 'Level 3 · 1,200 / 2,700 XP');
  assert.equal(xpProgressLabel({ level: 5, xp: 6600 }, leveling), 'Level 5 (Max) · 6,600 XP');
});
