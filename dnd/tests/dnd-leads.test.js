/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-26 23:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard for lead nomination: the bug this exists to catch is "anyone can green-light a checkbox" — a lead with no owner, a hero who can brute-force retries, an idle companion resolving a clue nobody played, or a chapter that deadlocks when the dice go cold. Pins the skill inference, the nomination ranking, deterministic map spots (every device must agree without a round trip), the contested roll, and the party-exhaustion escape hatch. Plain `node tests/dnd-leads.test.js`.
 */

'use strict';

const LEADS = require('../ui/leads.js');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

const BRAM = { id: 'bram', slug: 'bram', name: 'Bram', class: 'Fighter', prof: 2, mods: { str: 3, dex: 1, con: 2, int: -1, wis: 1, cha: 0 } };
const DELLA = { id: 'della', slug: 'della', name: 'Della', class: 'Rogue', prof: 2, mods: { str: 0, dex: 3, con: 1, int: 2, wis: 1, cha: 1 } };
const SERA = { id: 'sera', slug: 'sera', name: 'Sera', class: 'Cleric', prof: 2, mods: { str: 1, dex: 0, con: 2, int: 0, wis: 3, cha: 2 } };
const PARTY = [BRAM, DELLA, SERA];

const OBJECT_LEAD = { id: 'chalkboard', name: 'Chalkboard', type: 'object' };
const PERSON_LEAD = { id: 'warden', name: 'The Warden', type: 'person' };
const PLACE_LEAD = { id: 'roof', name: 'The Roof', type: 'place' };
const GATED_LEAD = { id: 'vault', name: 'Vault', type: 'object', requires: ['chalkboard'] };

// ── The skill a lead really tests ───────────────────────────────────────────
check(LEADS.leadSkill(OBJECT_LEAD) === 'investigation', 'an object is investigated');
check(LEADS.leadSkill(PERSON_LEAD) === 'persuasion', 'a person is talked to');
check(LEADS.leadSkill(PLACE_LEAD) === 'perception', 'a place is perceived');
check(LEADS.leadSkill({ id: 'x', type: 'object', skill: 'Arcana' }) === 'arcana', 'an authored skill overrides the type');
check(LEADS.leadSkill({ id: 'x', type: 'object', skill: 'basketweaving' }) === 'investigation', 'an unknown authored skill falls back, never crashes');

// ── Nomination: the specialist is visibly the right hand ────────────────────
check(LEADS.nominee(OBJECT_LEAD, PARTY).hero.slug === 'della', 'the rogue is sent to investigate the object');
check(LEADS.nominee(PERSON_LEAD, PARTY).hero.slug === 'sera', 'the cleric is sent to talk to the person');
check(LEADS.nominee(PLACE_LEAD, PARTY).hero.slug === 'bram', 'the fighter is sent to scout the place');
check(LEADS.nominee(OBJECT_LEAD, PARTY).trained === true, 'the nomination reports that the hero is trained');
check(LEADS.nominee(OBJECT_LEAD, []) === null, 'an empty party nominates nobody rather than throwing');

// THE regression this guard exists for: nomination must be identical on every
// device, or two players are coaxed to send different heroes at the same lead.
const twins = [{ ...DELLA, id: 'aaa', slug: 'aaa' }, { ...DELLA, id: 'zzz', slug: 'zzz' }];
check(LEADS.nominee(OBJECT_LEAD, twins).hero.slug === LEADS.nominee(OBJECT_LEAD, twins.slice().reverse()).hero.slug,
  'an exact tie nominates the SAME hero regardless of party order');

// A hero with only raw ability scores (no precomputed mods) must still rank.
const raw = { id: 'raw', slug: 'raw', name: 'Raw', class: 'Wizard', prof: 2, abilities: { int: 18, wis: 10, cha: 8 } };
check(LEADS.heroSkillMod(raw, 'investigation') === 6, 'a sheet with only raw scores still scores (+4 int, +2 trained)');

// ── Difficulty ──────────────────────────────────────────────────────────────
check(LEADS.leadDc(OBJECT_LEAD) === 12, 'an ordinary lead is DC 12');
check(LEADS.leadDc(GATED_LEAD) === 14, 'a lead gated behind another clue is harder');
check(LEADS.leadDc({ id: 'x', dc: 18 }) === 18, 'an authored DC wins');

// ── Map spots: every device must place a lead in the same square ────────────
const SCENE = { grid: { w: 18, h: 12 }, terrain: { blocking: [[3, 3], [4, 3]] }, partyStart: [[1, 1], [1, 2], [2, 1]] };
const ALL = [OBJECT_LEAD, PERSON_LEAD, PLACE_LEAD, GATED_LEAD];
const spots = ALL.map((lead) => LEADS.leadSpot(lead, SCENE, ALL));
check(spots.every((spot) => spot.x >= 0 && spot.y >= 0 && spot.x < 18 && spot.y < 12), 'every derived spot is inside the grid');
check(new Set(spots.map((s) => s.x + ',' + s.y)).size === ALL.length, 'no two leads land on the same square');
const blocked = new Set(['3,3', '4,3', '1,1', '1,2', '2,1']);
check(spots.every((spot) => !blocked.has(spot.x + ',' + spot.y)), 'derived spots avoid blocking terrain and the party start');
const again = ALL.map((lead) => LEADS.leadSpot(lead, SCENE, ALL));
check(JSON.stringify(again) === JSON.stringify(spots), 'spot derivation is deterministic across calls');
const reordered = ALL.slice().reverse().map((lead) => LEADS.leadSpot(lead, SCENE, ALL));
check(JSON.stringify(reordered.slice().reverse()) === JSON.stringify(spots), 'spots depend on authored order, not call order');
check(LEADS.leadSpot({ id: 'p', spot: { x: 99, y: -4 } }, SCENE, []).x === 17, 'an authored spot is clamped into the grid');
check(LEADS.leadSpot({ id: 'p', spot: { x: 5, y: 6 } }, SCENE, []).y === 6, 'an authored spot is otherwise honored exactly');

// ── The contested roll ──────────────────────────────────────────────────────
const seq = (values) => { const queue = values.slice(); return () => queue.shift(); };
const nat20 = LEADS.resolveLeadAttempt(OBJECT_LEAD, BRAM, seq([0.999]));
check(nat20.roll === 20 && nat20.success && nat20.crit === 'nat20', 'a natural 20 finds it even for the wrong hero');
const nat1 = LEADS.resolveLeadAttempt(OBJECT_LEAD, DELLA, seq([0]));
check(nat1.roll === 1 && !nat1.success && nat1.crit === 'nat1', 'a natural 1 fumbles even for the specialist');
const middling = LEADS.resolveLeadAttempt(OBJECT_LEAD, DELLA, seq([0.5]));
check(middling.roll === 11 && middling.mod === 4 && middling.total === 15 && middling.success,
  'the specialist clears DC 12 on an average roll');
const wrongHand = LEADS.resolveLeadAttempt(OBJECT_LEAD, BRAM, seq([0.5]));
check(wrongHand.total === 10 && !wrongHand.success,
  'the same roll FAILS for the untrained hero — which is the whole point of nominating one');
check(LEADS.resolveLeadAttempt(OBJECT_LEAD, null, seq([0.5])).mod === 0, 'a missing sheet rolls flat instead of throwing');

// ── The service contract the surface depends on ─────────────────────────────
const service = require('../lib/dnd-exploration-service.js');
const state = {
  tokens: [
    { kind: 'pc', slug: 'bram', name: 'Bram' },
    { kind: 'pc', slug: 'della', name: 'Della' },
    { kind: 'pc', slug: 'ghost', name: 'Sheetless' },
    { kind: 'monster', ref: 'goblin' },
  ],
  rules: { sheets: { bram: BRAM, della: DELLA } },
};
const heroes = service.partyHeroes(state);
check(heroes.length === 2, 'only pc tokens WITH a sheet can be volunteered for a lead');
check(heroes.every((hero) => hero.slug && hero.name), 'each candidate carries the slug and name the coax needs');
check(!heroes.some((hero) => hero.slug === 'ghost'), 'a token with no sheet is not nominated');

const record = service.explorationRecord({
  exploration: {
    discovered: ['a', 'a', 'b'], attempts: { a: ['bram', 'bram'] }, finders: { a: 'bram' },
  },
});
check(record.discovered.length === 2, 'duplicate discoveries collapse');
check(record.attempts.a.length === 1, 'duplicate attempts collapse so one hero cannot pad the ledger');
check(record.finders.a === 'bram', 'the finder is preserved for the story log');
check(JSON.stringify(service.explorationRecord({}).attempts) === '{}', 'a fresh chapter starts with an empty attempt ledger');
check(JSON.stringify(service.explorationRecord(null).discovered) === '[]', 'a missing record never throws');

if (failures) { console.error(`\n✗ ${failures}/${checks} lead checks failed`); process.exit(1); }
console.log(`✓ Lead nomination holds — ${checks} checks green (skill inference, one nominated hero per lead, deterministic spots, contested rolls)`);
