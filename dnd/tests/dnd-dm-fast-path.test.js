/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 00:50:36 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove the dynamic storyteller is persona-grounded, reason-only, timeline-scoped, deduplicated, deadline-bounded, stale-safe, and absent from tactical resolution.
 * 2026-07-22 22:19:02 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove guarded combat highlights dramatize immutable results without directives while legacy resolve requests stay rejected.
 * 2026-07-22 22:49:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove optional combat prose cannot block live table conversation and browser timing covers the player-chat deadline.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createDmService } = require('../lib/dnd-dm-service');

const ROOT = path.join(__dirname, '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const rows = (value) => ({ rowCount: value.length, rows: value });

/** @description Build one valid completed presentation timeline marker. */
function gate(id, turnSerial = 3) {
  return {
    id, kind: 'opening', sceneId: 'coast-road', turnSerial,
    message: 'The road awaits.', createdAt: 1, complete: true,
    lease: 'host-tab', leaseAt: 1, completedAt: 2,
  };
}

/** @description Minimal mutable database used only for storyteller cursor reads. */
class StoryPool {
  constructor() {
    this.state = {
      mode: 'exploration', sceneId: 'coast-road', turnSerial: 3, turnIndex: 0,
      order: ['bram'], tokens: [], presentationGate: gate('timeline-a'),
    };
    this.rev = 7;
  }

  async query(sql) {
    if (/SELECT state, rev FROM dnd_encounters/.test(sql)) return rows([{ state: clone(this.state), rev: this.rev }]);
    if (/SELECT slug, name, sheet, level FROM dnd_characters/.test(sql)) return rows([]);
    if (/SELECT kind, content FROM dnd_archive/.test(sql)) return rows([]);
    throw new Error(`Unexpected storyteller SQL: ${sql}`);
  }
}

/** @description Create a service fixture with fake campaign persistence and orchestrator. */
function fixture(orchestrator, options) {
  const pool = new StoryPool(), archive = [];
  const campaign = {
    access: async () => ({ campaign_id: 'camp-1' }),
    archive: async (_sub, _id, kind, content, _payload, timelineId) => {
      const entry = { seq: archive.length + 1, kind, content, timelineId }; archive.push(entry); return entry;
    },
    sheetsOfWithRev: async () => ({ sheets: {}, sheetsRev: 'none' }),
  };
  const service = createDmService({
    pool, campaign, orchestrator, root: ROOT, adventure: { title: 'Ambush on the Coast Road' },
    sceneById: () => ({ title: 'Coast Road', objective: 'Find the missing driver.', grid: { w: 18, h: 12, unitFeet: 5 } }),
    hydratedSheet: (_slug, sheet) => sheet, dmDeadlineMs: options && options.deadline,
  });
  return { pool, archive, service };
}

/** @description Standard free-table request with an explicit idempotency key. */
function talk(requestId, message = 'I inspect the overturned cart.') {
  return { campaignId: 'camp-1', sceneId: 'coast-road', mode: 'narrate', requestId, message };
}

test('story calls retain DM attribution, exact personas, direct mode, and stable timeline memory', async () => {
  const calls = [];
  const orchestrator = { processMessage: async (...args) => {
    calls.push(args); return { success: true, response: 'The wheel creaks.\nCHOICES: Search it | Listen | Move on' };
  } };
  const { pool, service } = fixture(orchestrator);

  assert.equal((await service.dungeonMaster('host', talk('talk-1'))).ok, true);
  assert.equal((await service.dungeonMaster('host', talk('talk-2', 'I listen.'))).ok, true);
  assert.equal(calls[0][0], calls[1][0], 'ordinary beats share one campaign timeline task');
  assert.match(calls[0][0], /^dnd-dm-camp-1-/);
  assert.equal(calls[0][2].agenticMode, false);
  assert.equal(calls[0][2].direct, true);
  assert.equal(calls[0][2].agentId, 'dd000000-0000-0000-0000-000000000001');
  assert.equal('tools' in calls[0][2], false);
  assert.match(calls[0][2].systemPromptOverride, /System Reference Document \(SRD 5\.1\)/);
  assert.match(calls[0][2].systemPromptOverride, /make the next ten seconds the best part/);
  assert.match(calls[0][2].systemPromptOverride, /newest # LIVE TABLE REQUEST is authoritative/);

  pool.state.presentationGate = gate('timeline-b'); pool.rev++;
  assert.equal((await service.dungeonMaster('host', talk('talk-3'))).ok, true);
  assert.notEqual(calls[2][0], calls[1][0], 'rewind timeline gets isolated model memory');
});

test('same request shares one execution and replays one cached durable result', async () => {
  let release;
  const calls = [];
  const orchestrator = { processMessage: (...args) => {
    calls.push(args); return new Promise((resolve) => { release = resolve; });
  } };
  const { archive, service } = fixture(orchestrator);
  const first = service.dungeonMaster('host', talk('same-request'));
  await new Promise((resolve) => setImmediate(resolve));
  const duplicate = service.dungeonMaster('host', talk('same-request'));
  const busy = await service.dungeonMaster('host', talk('different-request', 'I search the ditch.'));
  assert.equal(busy.code, 'DM_BUSY');
  release({ success: true, response: 'Something glints beneath the axle.\nCHOICES: Reach | Study | Leave' });
  const [original, shared] = await Promise.all([first, duplicate]);
  assert.equal(original.ok, true); assert.equal(shared.deduplicated, true);
  assert.equal(calls.length, 1); assert.equal(archive.length, 1);

  const replay = await service.dungeonMaster('host', talk('same-request'));
  assert.equal(replay.deduplicated, true);
  assert.equal(calls.length, 1); assert.equal(archive.length, 1);
});

test('deadline releases the request while a late model reply remains side-effect free', async () => {
  let release;
  const orchestrator = { processMessage: () => new Promise((resolve) => { release = resolve; }) };
  const { pool, archive, service } = fixture(orchestrator, { deadline: 15 });
  const timedOut = await service.dungeonMaster('host', talk('slow-request'));
  assert.equal(timedOut.code, 'DM_TIMEOUT');
  const busy = await service.dungeonMaster('host', talk('next-request', 'I check the horses.'));
  assert.equal(busy.code, 'DM_BUSY', 'the timed-out subprocess cannot be stacked');

  pool.state.presentationGate = gate('timeline-rewound'); pool.rev++;
  release({ success: true, response: 'This abandoned future must never be archived.\nROLL: wisdom | 10' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(archive.length, 0);
});

test('turn changes discard fast replies before directives or archives can mutate the table', async () => {
  const orchestrator = { processMessage: async () => {
    fixtureState.pool.rev++; fixtureState.pool.state.turnSerial++;
    return { success: true, response: 'An obsolete omen.\nROLL: wisdom | 10' };
  } };
  const fixtureState = fixture(orchestrator);
  const result = await fixtureState.service.dungeonMaster('host', talk('stale-turn'));
  assert.equal(result.code, 'DM_STALE');
  assert.equal(fixtureState.archive.length, 0);
});

test('legacy tactical narration is rejected without calling the storyteller', async () => {
  let calls = 0;
  const { service } = fixture({ processMessage: async () => { calls++; return { response: 'unused' }; } });
  const result = await service.dungeonMaster('host', {
    campaignId: 'camp-1', sceneId: 'coast-road', mode: 'resolve', results: 'Bram hits for 4.',
  });
  assert.equal(result.code, 'DM_TACTICAL_LOCAL');
  assert.equal(calls, 0);
});

test('combat highlights use the DM for prose without changing tactical state', async () => {
  const calls = [];
  const fixtureState = fixture({ processMessage: async (...args) => {
    calls.push(args); return { success: true, response: 'The archer looses. The shaft hisses past Bram and buries itself in the cart.' };
  } });
  fixtureState.pool.state.mode = 'combat';
  fixtureState.pool.state.tokens = [
    { id: 'archer', kind: 'monster', name: 'Goblin (archer)', x: 8, y: 4, hp: 7, maxHp: 7 },
    { id: 'bram', slug: 'bram', kind: 'pc', name: 'Bram', x: 4, y: 7, hp: 12, maxHp: 12 },
  ];
  fixtureState.pool.state.order = ['archer', 'bram'];
  const before = clone(fixtureState.pool.state);
  const result = await fixtureState.service.dungeonMaster('host', {
    campaignId: 'camp-1', sceneId: 'coast-road', mode: 'combat', requestId: 'archer-shot-1',
    message: "Goblin Archer's Shortbow: 7+4=11 vs AC 18 — miss.",
    turnGuard: { sceneId: 'coast-road', turnSerial: 3, actorId: 'archer' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.archiveEntry.kind, 'narration');
  assert.deepEqual(fixtureState.pool.state, before);
  assert.match(calls[0][1], /COMBAT HIGHLIGHT/);
  assert.match(calls[0][1], /Never repeat dice totals, armor class/);
});

test('round highlights restore the scene objective without inventing combat results', async () => {
  const calls = [];
  const fixtureState = fixture({ processMessage: async (...args) => {
    calls.push(args); return { success: true, response: 'The missing merchant remains somewhere beyond the smoke while steel rings around the cart.' };
  } });
  fixtureState.pool.state.mode = 'combat';
  const result = await fixtureState.service.dungeonMaster('host', {
    campaignId: 'camp-1', sceneId: 'coast-road', mode: 'combat',
    highlightKind: 'round', requestId: 'round-coast-road-3',
    message: 'Round 3 begins.',
  });
  assert.equal(result.ok, true);
  assert.match(calls[0][1], /ROUND STORY HIGHLIGHT/);
  assert.match(calls[0][1], /unresolved story stake/);
  assert.doesNotMatch(calls[0][1], /EXACT RESOLVED FACTS/);
});

test('live table conversation does not queue behind optional combat prose', async () => {
  const pending = [];
  const fixtureState = fixture({ processMessage: (...args) => new Promise((resolve) => {
    pending.push({ args, resolve });
  }) }, { deadline: 1000 });
  fixtureState.pool.state.mode = 'combat';
  const combat = fixtureState.service.dungeonMaster('host', {
    campaignId: 'camp-1', mode: 'combat', requestId: 'combat-prose',
    message: 'The archer misses Bram.',
  });
  await new Promise((resolve) => setImmediate(resolve));
  const conversation = fixtureState.service.dungeonMaster('host', talk('player-question', 'Can I reach the archer?'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(pending.length, 2, 'both lanes reach the storyteller without returning DM_BUSY');
  assert.notEqual(pending[0].args[0], pending[1].args[0], 'combat and conversation use separate task lanes');
  pending[0].resolve({ success: true, response: 'An arrow bites into the cart beside Bram.' });
  pending[1].resolve({ success: true, response: 'The archer is within your movement and spell range.' });
  assert.equal((await combat).ok, true);
  assert.equal((await conversation).ok, true);
});

test('scene prose requires the exact client board cursor before model execution', async () => {
  let calls = 0;
  const { service } = fixture({ processMessage: async () => { calls++; return { response: 'unused' }; } });
  const result = await service.dungeonMaster('host', {
    campaignId: 'camp-1', sceneId: 'coast-road', mode: 'scene', message: 'The party wins.',
    storyGuard: {
      rev: 6, timelineId: 'timeline-a', sceneId: 'coast-road', mode: 'exploration',
      turnSerial: 3, actorId: 'bram',
    },
  });
  assert.equal(result.code, 'DM_STALE');
  assert.equal(calls, 0);
});

test('browser story code sends victory as guarded scene prose and never tactical resolve', () => {
  const story = fs.readFileSync(path.join(ROOT, 'ui', 'table-story.js'), 'utf8');
  const outcomes = fs.readFileSync(path.join(ROOT, 'ui', 'table-outcomes.js'), 'utf8');
  const routes = fs.readFileSync(path.join(ROOT, 'routes', 'dnd-routes.js'), 'utf8');
  assert.doesNotMatch(story, /mode:\s*['"]resolve['"]/);
  assert.doesNotMatch(`${story}\n${outcomes}`, /dmResolve\s*\(/);
  assert.doesNotMatch(story, /api\(['"]\/dm['"]/);
  assert.match(story, /api\(['"]\/chat['"]/);
  assert.match(story, /setTimeout\(\(\) => controller\.abort\(\), 35000\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'lib', 'dnd-dm-service.js'), 'utf8'), /DEFAULT_DM_DEADLINE_MS = 30000/);
  assert.match(routes, /['"]\/chat['"]:\s*\(body\)\s*=>\s*env\.dm\.dungeonMaster/);
  assert.match(routes, /['"]\/dm['"]:\s*\(body\)\s*=>\s*env\.dm\.dungeonMaster/);
  assert.match(story, /mode:\s*['"]scene['"][\s\S]{0,180}storyGuard:\s*context\.guard/);
  assert.match(outcomes, /dmScene\(`The party has won/);
});
