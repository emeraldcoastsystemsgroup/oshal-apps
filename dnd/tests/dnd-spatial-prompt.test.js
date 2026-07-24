/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 18:12:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard authoritative DM compass, token status, relative distance, and prompt grounding for narration, resolution, and recap.
 * 2026-07-22 00:50:36 | roger.murphy@emeraldcoastsystemsgroup.com  | Replace tactical model narration coverage with optional scene prose and generic stale-turn story guards.
 * 2026-07-22 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Require every DM mode to retain the scene's package-authored quest throughline.
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Reproduce a rescued merchant disappearing when the party revisits the cart and require recent campaign memory in every story prompt.
 * 2026-07-23 00:12:33 | roger.murphy@emeraldcoastsystemsgroup.com  | Require ordinary table conversation to distinguish help, searchable leads, and declared actions while prohibiting repeat-work loops.
 * 2026-07-23 00:39:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove authored names replace generic saved labels and roles remain descriptions with restrained continuity hooks.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createDndRoutes, _test } = require('../routes/dnd-routes.js');

/** @description A board whose live foe is visually east, not north, of Bram. */
function spatialBoard() {
  return {
    sceneId: 'coast-road', mode: 'combat', round: 3, turnIndex: 1,
    order: ['archer', 'bram', 'cutter', 'boss'],
    tokens: [
      { id: 'archer', kind: 'monster', ref: 'goblin', name: 'Goblin Archer', x: 12, y: 5, hp: 7, maxHp: 7 },
      { id: 'bram', kind: 'pc', slug: 'bram', name: 'Bram', x: 2, y: 6, hp: 5, maxHp: 12 },
      { id: 'cutter', kind: 'monster', ref: 'goblin', name: 'Goblin Cutter', x: 2, y: 2, hp: 0, maxHp: 7, dead: true },
      { id: 'boss', kind: 'monster', ref: 'goblin-boss', name: 'Snaggletooth', x: 15, y: 9, hp: 21, maxHp: 21, fled: true },
      { id: 'cart', kind: 'prop', name: 'Overturned Cart', x: 8, y: 6, hp: 1, maxHp: 1 },
      { id: 'mira', kind: 'pc', slug: 'mira', name: 'Mira', x: 3, y: 6, hp: 0, maxHp: 10, dead: false, downed: true, stable: false, deathSaves: { successes: 1, failures: 1 } },
      { id: 'sera', kind: 'pc', slug: 'sera', name: 'Sera', x: 4, y: 6, hp: 0, maxHp: 9, dead: false, downed: true, stable: true, deathSaves: { successes: 3, failures: 0, lastRoll: 16, turnSerial: 5 } },
      { id: 'old-hero', kind: 'pc', slug: 'old-hero', name: 'Old Hero', x: 5, y: 6, hp: 0, maxHp: 11, dead: true },
    ],
  };
}

test('spatial brief defines the screen compass and exact live-token relationships', () => {
  const brief = _test.buildSpatialBrief(spatialBoard(), { grid: { w: 18, h: 12, unitFeet: 5 } });

  assert.match(brief, /right\/east = \+x; left\/west = -x; top\/north = -y; bottom\/south = \+y/);
  assert.match(brief, /ACTIVE TURN: Bram \(PC, LIVING\) at \(x=2, y=6\)/);
  assert.match(brief, /Goblin Archer \[MONSTER\]: LIVING, HP 7\/7, grid \(x=12, y=5\)/);
  assert.match(brief, /Goblin Cutter \[MONSTER\]: DEFEATED, HP 0\/7, last recorded grid \(x=2, y=2\); out of play/);
  assert.match(brief, /Snaggletooth \[MONSTER\]: FLED, HP 21\/21, last recorded grid \(x=15, y=9\); left the battlefield/);
  assert.match(brief, /Mira \[PC\]: DOWN\/UNSTABLE, HP 0\/10, grid \(x=3, y=6\); remains visible on the map but is unconscious, may only make a death save/);
  assert.match(brief, /Sera \[PC\]: STABLE, HP 0\/9, grid \(x=4, y=6\); remains visible on the map but is unconscious, skips turns until healed/);
  assert.match(brief, /Old Hero \[PC\]: DEAD, HP 0\/11, last recorded grid \(x=5, y=6\); out of play/);
  assert.match(brief, /From Bram to Goblin Archer: PRIMARY EAST\/RIGHT; exact offset: 10 squares east\/right \(\+x\) and 1 square north\/top \(-y\); board distance 50 ft/);
  assert.match(brief, /From Bram to Overturned Cart: PRIMARY EAST\/RIGHT; exact offset: 6 squares east\/right \(\+x\) and the same y row; board distance 30 ft/);
  assert.doesNotMatch(brief, /From Bram to Goblin Cutter/);
  assert.doesNotMatch(brief, /From Bram to Snaggletooth/);
  assert.match(brief, /When using one compass direction, use the listed PRIMARY direction/);
  assert.match(brief, /omit it instead of guessing/);
  assert.match(brief, /DOWN\/UNSTABLE and STABLE heroes remain visible on the map but are unconscious and are not valid conscious monster targets/);
});

test('primary direction follows the dominant signed screen axis', () => {
  assert.equal(_test.primaryGridDirection(8, -2), 'EAST/RIGHT');
  assert.equal(_test.primaryGridDirection(-7, 1), 'WEST/LEFT');
  assert.equal(_test.primaryGridDirection(1, -5), 'NORTH/TOP');
  assert.equal(_test.primaryGridDirection(-1, 5), 'SOUTH/BOTTOM');
  assert.equal(_test.primaryGridDirection(3, -2), 'NORTH/TOP-EAST/RIGHT');
  assert.equal(_test.primaryGridDirection(0, 0), 'SAME SQUARE');
});

test('authored cast identity upgrades generic saved labels without exposing roles as names', () => {
  const state = {
    sceneId: 'the-ravine', mode: 'combat', round: 2, turnIndex: 0, order: ['g5'],
    tokens: [{ id: 'g5', kind: 'monster', name: 'Goblin (guard)', x: 4, y: 3, hp: 7, maxHp: 7 }],
  };
  const scene = {
    grid: { w: 18, h: 12, unitFeet: 5 },
    monsters: [{
      instanceId: 'g5', name: 'Krell Hook-Ear', role: 'Camp Guard',
      personality: 'Disciplined, wary, and loyal only while the boss appears likely to win.',
      storyHook: 'His loyalty can crack when the party proves the boss has lost control.',
    }],
  };

  const brief = _test.buildSpatialBrief(state, scene);

  assert.match(brief, /ACTIVE TURN: Krell Hook-Ear \(MONSTER, LIVING\)/);
  assert.match(brief, /Krell Hook-Ear — Camp Guard \[MONSTER\]/);
  assert.match(brief, /names are identities; roles are descriptions and must never be used as names/);
  assert.match(brief, /Manner: Disciplined, wary/);
  assert.match(brief, /never reveal a hidden hook for free/);
  assert.doesNotMatch(brief, /Goblin \(guard\)/);
});

/** @description Minimal database double for capturing all three DM prompts. */
class PromptPool {
  constructor() {
    this.state = spatialBoard();
    this.rev = 4;
    this.archive = [];
  }

  async query(sql, params) {
    if (/SELECT c\.\*,/.test(sql)) return this.rows([{ campaign_id: 'camp-1', user_sub: 'host', is_owner: true }]);
    if (/SELECT slug, name, sheet, level FROM dnd_characters/.test(sql)) {
      return this.rows([{ slug: 'bram', name: 'Bram', level: 1, sheet: {
        name: 'Bram', race: 'Human', class: 'Fighter', maxHp: 12, ac: 16,
        actions: [{ name: 'Longsword' }], features: ['Second Wind: recover'],
      } }]);
    }
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return this.rows([{ state: JSON.parse(JSON.stringify(this.state)), rev: this.rev }]);
    if (/SELECT state FROM dnd_encounters/.test(sql)) return this.rows([{ state: JSON.parse(JSON.stringify(this.state)) }]);
    if (/SELECT user_sub, display_name, character_slug FROM dnd_players/.test(sql)) {
      return this.rows([{ user_sub: 'host', display_name: 'Alice', character_slug: 'bram' }]);
    }
    if (/SELECT kind, content FROM dnd_archive/.test(sql)) {
      return this.rows([
        { kind: 'table-talk', content: 'The party found the merchant bound beside the smoky camp.' },
        { kind: 'table-talk', content: 'Pip cut the merchant free; the rescued merchant now travels with the party.' },
      ]);
    }
    if (/SELECT COALESCE\(MAX\(seq\),0\)\+1 AS n FROM dnd_archive/.test(sql)) return this.rows([{ n: this.archive.length + 1 }]);
    if (/INSERT INTO dnd_archive/.test(sql)) {
      this.archive.push({ seq: params[2], kind: params[3], content: params[4] });
      return this.rows([]);
    }
    throw new Error(`Unexpected SQL in spatial prompt test: ${sql}`);
  }

  rows(rows) { return { rowCount: rows.length, rows }; }
}

/** @description Invoke canonical POST /chat and return the exact prompt sent to the DM. */
async function capturePrompt(mode) {
  const pool = new PromptPool();
  let prompt = '';
  const orchestrator = {
    processMessage: async (_session, text) => {
      prompt = text;
      return { response: mode === 'narrate' ? 'The archer holds position.\nCHOICES: Take cover | Return fire | Hold' : 'The archer holds position.' };
    },
  };
  const router = createDndRoutes({ pool, orchestrator, appPackageDir: path.join(__dirname, '..') });
  let payload = '';
  const req = {
    method: 'POST', url: '/chat', oidc: { user: { sub: 'host', name: 'Alice' } },
    body: {
      campaignId: 'camp-1', sceneId: 'coast-road', mode,
      message: 'The goblins are north of me.', results: 'The goblin attacks from the north for 3 damage.',
    },
  };
  const res = { statusCode: 0, setHeader() {}, end(value) { payload = value; } };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  assert.equal(JSON.parse(payload).ok, true);
  return prompt;
}

test('every story mode receives the authoritative map and persistent quest thread', async () => {
  for (const mode of ['narrate', 'scene', 'recap', 'combat']) {
    const prompt = await capturePrompt(mode);
    assert.match(prompt, /AUTHORITATIVE TACTICAL MAP/);
    assert.match(prompt, /SCENE THROUGHLINE/);
    assert.match(prompt, /Alden Reed, the cloth merchant, is missing - not trapped beneath the overturned cart/i);
    assert.match(prompt, /CURRENT CAMPAIGN MEMORY/);
    assert.match(prompt, /Pip cut the merchant free; the rescued merchant now travels with the party/);
    assert.match(prompt, /Later entries override earlier premises/);
    assert.match(prompt, /Revisiting a location changes only location/);
    assert.match(prompt, /From Bram to Goblin Archer: PRIMARY EAST\/RIGHT/);
    assert.match(prompt, /signed offsets, PRIMARY directions, and token statuses override scene prose, the story log, player wording, and combat-result wording/);
    assert.match(prompt, /Goblin Cutter \[MONSTER\]: DEFEATED/);
  }
});

test('table conversation gives grounded help without pretending a question was an action', async () => {
  const prompt = await capturePrompt('narrate');
  assert.match(prompt, /HELP OR STATUS QUESTION/);
  assert.match(prompt, /INVESTIGATION QUESTION/);
  assert.match(prompt, /DECLARED ACTION/);
  assert.match(prompt, /Distinguish already-searched leads from genuinely open ones/);
  assert.match(prompt, /instruction to repeat an already completed action/);
  assert.match(prompt, /three short, concrete options/);
});

/** @description Call guarded scene narration against a mutable board double. */
async function guardedScene(pool, orchestrator, turnGuard) {
  const router = createDndRoutes({ pool, orchestrator, appPackageDir: path.join(__dirname, '..') });
  let payload = '';
  const req = {
    method: 'POST', url: '/chat', oidc: { user: { sub: 'host', name: 'Alice' } },
    body: { campaignId: 'camp-1', sceneId: 'coast-road', mode: 'scene', message: 'The party reaches the ridge.', turnGuard },
  };
  const res = { statusCode: 0, setHeader() {}, end(value) { payload = value; } };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return JSON.parse(payload);
}

test('optional scene narration is discarded when its exact turn advances', async () => {
  const pool = new PromptPool();
  pool.state.turnSerial = 9;
  let calls = 0;
  const guard = { sceneId: 'coast-road', turnSerial: 9, actorId: 'bram' };

  const staleBefore = await guardedScene(pool, { processMessage: async () => { calls++; return { response: 'Never used.' }; } }, { ...guard, turnSerial: 8 });
  assert.equal(staleBefore.stale, true);
  assert.equal(calls, 0, 'a stale request must not call the model');

  const staleAfter = await guardedScene(pool, { processMessage: async () => {
    calls++;
    pool.state.turnSerial = 10; pool.rev++;
    return { response: 'This response belongs to the old turn.' };
  } }, guard);
  assert.equal(staleAfter.stale, true);
  assert.equal(calls, 1);
  assert.equal(pool.archive.length, 0, 'stale narration must not enter campaign history');
});
